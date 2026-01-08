/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { Router, Request, Response } from 'express';
import { PublicKey, Transaction, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';
import { NATIVE_MINT, getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';
import { futarchy } from '@zcomb/programs-sdk';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import DLMM from '@meteora-ag/dlmm';

import { getPool } from '../../lib/db';
import { getDaoByPda, getDaoByModeratorPda } from '../../lib/db/daos';
import { fetchKeypair } from '../../lib/keyService';
import { isValidTokenMintAddress } from '../../lib/validation';
import { uploadProposalMetadata } from '../../lib/ipfs';
import {
  requireSignedHash,
  incrementProposalCount,
  MOCK_MODE,
  mockCreateProposal,
  checkDaoProposerAuthorization,
  checkMintAuthority,
  checkTokenMatchesPoolBase,
  checkAdminHoldsLP,
  checkNoActiveProposal,
  isDaoReadinessError,
  createReadOnlyClient,
  resolveLiquidityDao,
} from '../../lib/dao';

// Import sub-routers for modular route handling
import queriesRouter from './queries';
import creationRouter from './creation';
import proposersRouter from './proposers';
import { daoLimiter, getConnection, createProvider } from './shared';

const router = Router();

// ============================================================================
// Rate Limiting & Sub-routers
// ============================================================================

router.use(daoLimiter);
router.use('/', queriesRouter);
router.use('/', creationRouter);
router.use('/', proposersRouter);

// ============================================================================
// Proposal Lifecycle Routes
// ============================================================================
// The routes below handle proposal creation and lifecycle operations.
// GET endpoints, DAO creation, and proposer management are in sub-routers.
// ============================================================================

// ============================================================================
// POST /dao/proposal - Create a decision market proposal
// ============================================================================

router.post('/proposal', requireSignedHash, async (req: Request, res: Response) => {
  try {
    const {
      wallet,
      dao_pda,
      title,
      description,
      length_secs,
      warmup_secs,
      options,
    } = req.body;

    // Validate required fields
    if (!dao_pda || !title || !description || !length_secs || warmup_secs === undefined || !options) {
      return res.status(400).json({
        error: 'Missing required fields: dao_pda, title, description, length_secs, warmup_secs, options'
      });
    }

    // Validate title and description length
    if (title.length > 128) {
      return res.status(400).json({ error: 'Title must be 128 characters or less' });
    }
    if (description.length > 1024) {
      return res.status(400).json({ error: 'Description must be 1024 characters or less' });
    }

    // Validate options
    if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
      return res.status(400).json({ error: 'Options must be an array with 2-6 items' });
    }

    // Validate length_secs is a positive number (range validation after DAO lookup)
    if (typeof length_secs !== 'number' || length_secs <= 0) {
      return res.status(400).json({ error: 'length_secs must be a positive number' });
    }

    // Validate warmup_secs if provided (must be positive and <= 80% of length_secs)
    if (warmup_secs !== undefined) {
      if (typeof warmup_secs !== 'number' || warmup_secs <= 0) {
        return res.status(400).json({ error: 'warmup_secs must be a positive number' });
      }
      const maxWarmup = Math.floor(length_secs * 0.8);
      if (warmup_secs > maxWarmup) {
        return res.status(400).json({
          error: `warmup_secs must not exceed 80% of length_secs (max: ${maxWarmup} seconds)`,
        });
      }
    }

    const pool = getPool();

    // Fetch DAO
    const dao = await getDaoByPda(pool, dao_pda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    if (!dao.moderator_pda) {
      return res.status(500).json({ error: 'DAO has no moderator PDA' });
    }

    // Validate proposal duration based on proposer role
    // DAO owner: 1 minute to 7 days
    // Others (whitelist/token threshold): 24 hours to 4 days
    const isOwner = wallet === dao.owner_wallet;
    const ONE_MINUTE = 60;
    const ONE_HOUR = 3600;
    const ONE_DAY = 24 * ONE_HOUR;

    if (isOwner) {
      // Owner: 1 minute to 7 days
      const minDuration = ONE_MINUTE;
      const maxDuration = 7 * ONE_DAY;
      if (length_secs < minDuration || length_secs > maxDuration) {
        return res.status(400).json({
          error: 'Invalid proposal duration',
          reason: `DAO owner can create proposals from 1 minute to 7 days (${minDuration}-${maxDuration} seconds)`,
          provided: length_secs,
        });
      }
    } else {
      // Non-owner proposers: 24 hours to 4 days
      const minDuration = ONE_DAY;
      const maxDuration = 4 * ONE_DAY;
      if (length_secs < minDuration || length_secs > maxDuration) {
        return res.status(400).json({
          error: 'Invalid proposal duration',
          reason: `Proposers can create proposals from 24 hours to 4 days (${minDuration}-${maxDuration} seconds)`,
          provided: length_secs,
        });
      }
    }

    const connection = getConnection();

    // ========== PROPOSAL VALIDATION CHECKS ==========
    // These checks ensure the DAO is ready to create proposals

    // 0. Check proposer authorization using per-DAO settings (DB whitelist + token threshold)
    // Each DAO (parent or child) has independent settings managed via:
    //   - POST/DELETE /dao/:daoPda/proposers (wallet whitelist)
    //   - PUT /dao/:daoPda/proposer-threshold (token balance requirement)
    const proposerAuthResult = await checkDaoProposerAuthorization(
      connection,
      pool,
      dao.id!,
      wallet,
      dao.token_mint
    );
    if (!proposerAuthResult.isAuthorized) {
      return res.status(403).json({
        error: 'Not authorized to propose',
        reason: proposerAuthResult.reason,
        check: 'proposer_authorization',
      });
    }
    // Log authorization method for debugging
    if (proposerAuthResult.authMethod) {
      console.log(`Proposer ${wallet} authorized via: ${proposerAuthResult.authMethod}`);
    } else {
      console.log(`Proposer ${wallet} authorized (no restrictions configured for DAO)`);
    }

    // 1. Check mint authority - mint_auth_multisig must be authority for token_mint
    const mintAuthCheck = await checkMintAuthority(connection, dao.mint_auth_multisig, dao.token_mint);
    if (isDaoReadinessError(mintAuthCheck)) {
      return res.status(400).json({
        error: 'DAO not ready for proposals',
        reason: mintAuthCheck.reason,
        check: 'mint_authority',
      });
    }

    // 2. For parent DAOs only: Check token matches pool base token
    if (dao.dao_type === 'parent') {
      const tokenPoolCheck = await checkTokenMatchesPoolBase(connection, dao.token_mint, dao.pool_address, dao.pool_type);
      if (isDaoReadinessError(tokenPoolCheck)) {
        return res.status(400).json({
          error: 'DAO not ready for proposals',
          reason: tokenPoolCheck.reason,
          check: 'token_pool_match',
        });
      }
    }

    // 3. Check admin holds LP - for child DAOs, check parent's admin wallet
    // Also store liquidityDao for later use in withdrawal/deposit operations
    const liquidityDao = await resolveLiquidityDao(pool, dao);
    if (liquidityDao !== dao) {
      console.log(`Child DAO detected, using parent DAO for liquidity: ${liquidityDao.dao_name}`);
    }

    const lpCheck = await checkAdminHoldsLP(connection, liquidityDao.admin_wallet, liquidityDao.pool_address, liquidityDao.pool_type);
    if (isDaoReadinessError(lpCheck)) {
      return res.status(400).json({
        error: 'DAO not ready for proposals',
        reason: lpCheck.reason,
        check: 'admin_lp_holdings',
      });
    }

    // 4. Check no active proposal for this moderator
    const activeProposalCheck = await checkNoActiveProposal(connection, dao.moderator_pda, MOCK_MODE);
    if (isDaoReadinessError(activeProposalCheck)) {
      return res.status(400).json({
        error: 'DAO not ready for proposals',
        reason: activeProposalCheck.reason,
        check: 'active_proposal',
      });
    }

    // 5. Check admin wallet has sufficient SOL balance for transaction fees
    // The admin wallet is used to sign proposal creation and liquidity operations
    const MIN_ADMIN_BALANCE_SOL = 0.1;
    const adminBalance = await connection.getBalance(new PublicKey(liquidityDao.admin_wallet));
    const adminBalanceSol = adminBalance / 1e9;
    if (adminBalanceSol < MIN_ADMIN_BALANCE_SOL) {
      return res.status(400).json({
        error: 'DAO not ready for proposals',
        reason: `Admin wallet has insufficient SOL balance: ${adminBalanceSol.toFixed(4)} SOL. Minimum required: ${MIN_ADMIN_BALANCE_SOL} SOL. Use the fund-admin-wallet script to fund it.`,
        check: 'admin_wallet_balance',
        admin_wallet: liquidityDao.admin_wallet,
        current_balance: adminBalanceSol,
        required_balance: MIN_ADMIN_BALANCE_SOL,
      });
    }

    console.log('All proposal validation checks passed');

    // ========================================================================
    // LIQUIDITY MANAGEMENT: Withdraw LP before proposal creation
    // ========================================================================
    // Before creating a proposal, we:
    // 1. Call withdraw/build to get unsigned transaction and amounts
    // 2. Sign with admin keypair (from liquidityDao - parent for child DAOs)
    // 3. Call withdraw/confirm to execute the withdrawal
    // 4. Pass withdrawn amounts to SDK's createProposal
    // ========================================================================

    // Get admin keypair for liquidity operations (from parent if child DAO)
    const adminKeypair = await fetchKeypair(liquidityDao.admin_key_idx);
    const adminPubkey = adminKeypair.publicKey;

    // Determine pool type and withdrawal percentage (from DAO settings)
    const poolType = liquidityDao.pool_type;
    const poolAddress = liquidityDao.pool_address;
    const withdrawalPercentage = dao.withdrawal_percentage;

    console.log(`Withdrawing ${withdrawalPercentage}% liquidity from ${poolType} pool ${poolAddress}`);
    console.log(`  LP Owner (admin): ${adminPubkey.toBase58()}`);

    // Step 1: Call withdraw/build
    // Pass adminWallet to disambiguate when multiple DAOs share the same pool
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const withdrawBuildResponse = await fetch(`${baseUrl}/${poolType}/withdraw/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        withdrawalPercentage,
        poolAddress,
        adminWallet: liquidityDao.admin_wallet  // Use LP owner's wallet
      })
    });

    if (!withdrawBuildResponse.ok) {
      const error = await withdrawBuildResponse.json().catch(() => ({}));
      return res.status(500).json({
        error: 'Failed to build withdrawal transaction',
        details: (error as any).error || withdrawBuildResponse.statusText,
        check: 'liquidity_withdrawal'
      });
    }

    const withdrawBuildData = await withdrawBuildResponse.json() as {
      requestId: string;
      transaction?: string;  // DAMM single tx
      transactions?: string[];  // DLMM multi tx
      // DAMM uses estimatedAmounts
      estimatedAmounts?: { tokenA: string; tokenB: string; liquidityDelta: string };
      // DLMM uses withdrawn/transferred
      withdrawn?: { tokenA: string; tokenB: string };
      transferred?: { tokenA: string; tokenB: string };
      redeposited?: { tokenA: string; tokenB: string };
      marketPrice?: string;
    };

    // Normalize response format (DAMM uses estimatedAmounts, DLMM uses withdrawn/transferred)
    const buildAmounts = withdrawBuildData.estimatedAmounts || withdrawBuildData.withdrawn || { tokenA: '0', tokenB: '0' };

    console.log('Withdrawal build response:', {
      requestId: withdrawBuildData.requestId,
      amounts: buildAmounts,
    });

    // Step 2: Sign the transaction(s) with admin keypair
    let signedTxBase58: string | undefined;
    let signedTxsBase58: string[] | undefined;

    if (poolType === 'dlmm' && withdrawBuildData.transactions) {
      // DLMM: Sign all transactions in the array
      signedTxsBase58 = withdrawBuildData.transactions.map(txBase58 => {
        const transactionBuffer = bs58.decode(txBase58);
        const unsignedTx = Transaction.from(transactionBuffer);
        unsignedTx.partialSign(adminKeypair);
        return bs58.encode(unsignedTx.serialize({ requireAllSignatures: false }));
      });
      console.log(`Signed ${signedTxsBase58.length} DLMM transactions`);
    } else if (withdrawBuildData.transaction) {
      // DAMM: Sign single transaction
      const transactionBuffer = bs58.decode(withdrawBuildData.transaction);
      const unsignedTx = Transaction.from(transactionBuffer);
      unsignedTx.partialSign(adminKeypair);
      signedTxBase58 = bs58.encode(unsignedTx.serialize({ requireAllSignatures: false }));
      console.log('Signed DAMM transaction');
    } else {
      return res.status(500).json({
        error: 'No transaction(s) returned from withdrawal build',
        check: 'liquidity_withdrawal'
      });
    }

    // Step 3: Call withdraw/confirm to execute the withdrawal
    const withdrawConfirmResponse = await fetch(`${baseUrl}/${poolType}/withdraw/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: withdrawBuildData.requestId,
        signedTransaction: signedTxBase58,       // DAMM
        signedTransactions: signedTxsBase58,     // DLMM
      })
    });

    if (!withdrawConfirmResponse.ok) {
      const error = await withdrawConfirmResponse.json().catch(() => ({}));
      return res.status(500).json({
        error: 'Failed to confirm withdrawal transaction',
        details: (error as any).error || withdrawConfirmResponse.statusText,
        check: 'liquidity_withdrawal'
      });
    }

    const withdrawConfirmData = await withdrawConfirmResponse.json() as {
      signature?: string;
      signatures?: string[];
      // DAMM uses estimatedAmounts
      estimatedAmounts?: { tokenA: string; tokenB: string; liquidityDelta: string };
      // DLMM uses transferred
      transferred?: { tokenA: string; tokenB: string };
    };

    // Normalize response format (DAMM uses estimatedAmounts, DLMM uses transferred)
    const confirmAmounts = withdrawConfirmData.estimatedAmounts || withdrawConfirmData.transferred || buildAmounts;

    console.log('Withdrawal confirmed:', {
      signature: withdrawConfirmData.signature || withdrawConfirmData.signatures,
      amounts: confirmAmounts,
    });

    // Use withdrawn amounts for AMM initial liquidity
    const baseAmount = new BN(confirmAmounts.tokenA);
    const quoteAmount = new BN(confirmAmounts.tokenB);

    console.log(`Initial AMM liquidity: base=${baseAmount.toString()}, quote=${quoteAmount.toString()}`);

    // Calculate starting observation from liquidity ratio (price = quote/base scaled by PRICE_SCALE)
    // PRICE_SCALE = 10^12 (from @zcomb/programs-sdk/amm/constants)
    const PRICE_SCALE = new BN('1000000000000'); // 10^12

    // Calculate starting observation: (quoteAmount / baseAmount) * PRICE_SCALE * 10^(baseDecimals - quoteDecimals)
    let startingObservation: BN;
    if (baseAmount.isZero()) {
      // Fallback to 1:1 price if base amount is zero (shouldn't happen)
      startingObservation = PRICE_SCALE;
    } else {
      startingObservation = quoteAmount.mul(PRICE_SCALE).div(baseAmount);
    }

    // Calculate max observation delta as 5% of starting observation
    const maxObservationDelta = startingObservation.mul(new BN(5)).div(new BN(100));

    console.log(`TWAP config: startingObservation=${startingObservation.toString()}, maxObservationDelta=${maxObservationDelta.toString()} (5%)`);

    // Upload proposal metadata to IPFS (includes dao_pda for proposal-to-DAO mapping)
    let metadataCid: string;
    try {
      metadataCid = await uploadProposalMetadata(title, description, options, dao_pda);
      console.log(`Uploaded proposal metadata to IPFS: ${metadataCid}`);
    } catch (error) {
      console.error('Failed to upload proposal metadata to IPFS:', error);
      return res.status(500).json({
        error: 'Failed to upload proposal metadata to IPFS',
        details: String(error),
      });
    }

    let proposalPda: string;
    let proposalId: number;

    if (MOCK_MODE) {
      // ========== MOCK MODE ==========
      console.log('[MOCK MODE] Skipping FutarchyClient SDK calls for proposal creation');

      const mockResult = mockCreateProposal(dao_pda, title);
      proposalPda = mockResult.proposalPda;
      proposalId = mockResult.proposalId;
    } else {
      // ========== REAL MODE ==========
      // Create the proposal on-chain using admin keypair (already fetched above)
      const provider = createProvider(adminKeypair);
      const client = new futarchy.FutarchyClient(provider);

      const moderatorPda = new PublicKey(dao.moderator_pda);

      // Step 0: Create Address Lookup Table (ALT) for proposal accounts
      //
      // ALT enables versioned transactions that use 1-byte index lookups instead of
      // 32-byte pubkeys. This is REQUIRED for launchProposal which has:
      //   - 8 fixed accounts
      //   - 6 + 7*N remaining accounts (N = numOptions)
      //   - 4 options = 42 accounts = 1344+ bytes > 1232 byte limit (without ALT)
      //   - With ALT: 42 accounts = ~42 bytes (fits easily)
      //
      // The SDK's createProposalALT derives addresses using the moderator's CURRENT
      // proposalIdCounter, which will be the ID of the NEXT proposal we create.
      console.log('Step 0: Creating Address Lookup Table for versioned transactions...');
      console.log(`  Options: ${options.length} (accounts: ${8 + 6 + 7 * options.length})`);

      const altResult = await client.createProposalALT(
        adminKeypair.publicKey,
        moderatorPda,
        options.length,
      );
      const altAddress = altResult.altAddress;
      console.log(`  ✓ ALT created: ${altAddress.toBase58()}`);

      // Poll for ALT readiness (Solana needs 1-2 slots for ALT to be usable)
      console.log('  Waiting for ALT finalization...');
      const ALT_POLL_INTERVAL_MS = 500;
      const ALT_MAX_WAIT_MS = 10000;
      let altReady = false;
      let altAddressCount = 0;
      const startTime = Date.now();

      while (!altReady && Date.now() - startTime < ALT_MAX_WAIT_MS) {
        const altAccount = await provider.connection.getAddressLookupTable(altAddress);
        if (altAccount.value && altAccount.value.state.addresses.length > 0) {
          altReady = true;
          altAddressCount = altAccount.value.state.addresses.length;
        } else {
          await new Promise(resolve => setTimeout(resolve, ALT_POLL_INTERVAL_MS));
        }
      }

      if (!altReady) {
        throw new Error(
          `ALT not ready after ${ALT_MAX_WAIT_MS}ms. This may indicate an RPC issue or network congestion.`
        );
      }
      console.log(`  ✓ ALT verified with ${altAddressCount} addresses (waited ${Date.now() - startTime}ms)`);

      // Create proposal step by step, executing each transaction before building the next
      // (SDK's createProposal tries to fetch accounts during build phase before they exist)
      // warmupDuration must be <= 80% of length_secs (validated above)
      const warmupDuration = warmup_secs;

      const proposalParams = {
        length: length_secs,
        startingObservation,        // Calculated from liquidity ratio
        maxObservationDelta,        // 5% of starting observation
        warmupDuration,             // Client-specified warmup period
        marketBias: 0,              // 0% (Pass Fail Gap)
        fee: 50,                    // 0.5% fee
      };

      console.log(`Proposal params: length=${length_secs}s, warmup=${warmupDuration}s, obs=${startingObservation}, delta=${maxObservationDelta}`);

      // Step 1: Initialize proposal
      console.log('Step 1: Initializing proposal...');
      const initResult = await client.initializeProposal(
        adminKeypair.publicKey,
        moderatorPda,
        proposalParams,
        metadataCid,
      );

      console.log(`  Proposal PDA: ${initResult.proposalPda.toBase58()}`);
      console.log(`  Proposal ID: ${initResult.proposalId}`);
      console.log(`  Vault PDA: ${initResult.vaultPda.toBase58()}`);

      // Check if proposal already exists (from a previous failed run)
      const existingProposal = await provider.connection.getAccountInfo(initResult.proposalPda);
      if (existingProposal) {
        // Check the proposal state to see if it can still be launched
        try {
          const proposal = await client.fetchProposal(initResult.proposalPda);
          const { state } = futarchy.parseProposalState(proposal.state);

          if (state === futarchy.ProposalState.Pending || state === futarchy.ProposalState.Resolved) {
            // Proposal already launched or resolved - can't reuse
            throw new Error(
              `Proposal ${initResult.proposalPda.toBase58()} already exists in '${state}' state. ` +
              `This is a duplicate proposal attempt. The moderator counter may need to increment for a new proposal.`
            );
          }

          // Proposal exists but is in Setup state - can proceed to launch
          console.log(`  ⚠ Proposal already exists in Setup state, skipping initialization`);
        } catch (fetchError: any) {
          // If we can't fetch the proposal state, fail with the original error
          if (fetchError.message?.includes('already exists')) {
            throw fetchError;
          }
          console.log(`  ⚠ Proposal exists but could not fetch state, skipping initialization`);
        }
      } else {
        try {
          const initSig = await initResult.builder.rpc();
          console.log(`  ✓ Initialize tx: ${initSig}`);
          // Wait for confirmation before proceeding to addOption
          await provider.connection.confirmTransaction(initSig, 'confirmed');
        } catch (e) {
          console.error('  ✗ Initialize failed:', e);
          throw e;
        }
      }

      // Step 2: Add additional options (beyond initial 2) if needed
      for (let i = 2; i < options.length; i++) {
        console.log(`Step 2.${i-1}: Adding option ${i}...`);
        try {
          const addResult = await client.addOption(adminKeypair.publicKey, initResult.proposalPda);
          const optSig = await addResult.builder.rpc();
          console.log(`  ✓ AddOption ${i} tx: ${optSig}`);
          // Wait for confirmation before next iteration
          await provider.connection.confirmTransaction(optSig, 'confirmed');
        } catch (e) {
          console.error(`  ✗ AddOption ${i} failed:`, e);
          throw e;
        }
      }

      // Step 2.5: Wrap SOL to WSOL if quote mint is native SOL
      // DAMM withdrawal sends native SOL, but launchProposal expects WSOL in ATA
      const NATIVE_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
      if (new PublicKey(dao.quote_mint).equals(NATIVE_SOL_MINT)) {
        console.log('Step 2.5: Wrapping SOL to WSOL...');
        const { createSyncNativeInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } = await import('@solana/spl-token');
        const { SystemProgram, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');

        const wsolAta = getAssociatedTokenAddressSync(NATIVE_SOL_MINT, adminKeypair.publicKey);
        const wrapTx = new Transaction();

        // Create WSOL ATA if needed
        wrapTx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            adminKeypair.publicKey,
            wsolAta,
            adminKeypair.publicKey,
            NATIVE_SOL_MINT
          )
        );

        // Transfer SOL to WSOL ATA (add buffer for rent)
        const wrapAmount = quoteAmount.toNumber() + 10000; // Small buffer
        wrapTx.add(
          SystemProgram.transfer({
            fromPubkey: adminKeypair.publicKey,
            toPubkey: wsolAta,
            lamports: wrapAmount,
          })
        );

        // Sync native balance
        wrapTx.add(createSyncNativeInstruction(wsolAta));

        const { blockhash } = await provider.connection.getLatestBlockhash();
        wrapTx.recentBlockhash = blockhash;
        wrapTx.feePayer = adminKeypair.publicKey;

        const wrapSig = await sendAndConfirmTransaction(provider.connection, wrapTx, [adminKeypair]);
        console.log(`  ✓ Wrapped ${quoteAmount.toString()} lamports to WSOL: ${wrapSig}`);
      }

      // Step 3: Launch proposal using versioned transaction with ALT
      // ALT reduces account references from 32 bytes to 1 byte each
      console.log('Step 3: Launching proposal with versioned transaction...');
      try {
        const launchResult = await client.launchProposal(
          adminKeypair.publicKey,
          initResult.proposalPda,
          baseAmount,
          quoteAmount,
        );

        // Extract the instruction from the builder
        const launchInstruction = await launchResult.builder.instruction();

        // Add compute budget instruction (SDK defaults to 500k CUs via preInstructions,
        // but .instruction() doesn't include them - we must add manually)
        const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 });

        // Build versioned transaction using the ALT
        const versionedTx = await client.buildVersionedTx(
          adminKeypair.publicKey,
          [computeBudgetIx, launchInstruction],
          altAddress,
        );

        // Sign the versioned transaction
        versionedTx.sign([adminKeypair]);

        // Send and confirm
        const launchSig = await provider.connection.sendTransaction(versionedTx, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        // Wait for confirmation
        await provider.connection.confirmTransaction(launchSig, 'confirmed');

        console.log(`  ✓ Launch tx: ${launchSig}`);
      } catch (e) {
        console.error('  ✗ Launch failed:', e);
        throw e;
      }

      proposalPda = initResult.proposalPda.toBase58();
      proposalId = initResult.proposalId;
    }

    console.log(`Created proposal ${proposalPda} for DAO ${dao_pda}`);

    // Update the proposal count cache
    incrementProposalCount(dao_pda);

    res.json({
      proposal_pda: proposalPda,
      proposal_id: proposalId,
      metadata_cid: metadataCid,
      dao_pda,
      status: 'pending',
    });
  } catch (error) {
    console.error('Error creating proposal:', error);
    res.status(500).json({ error: 'Failed to create proposal', details: String(error) });
  }
});

// ============================================================================
// ============================================================================
// Mutex locks for preventing concurrent processing of proposals
// ============================================================================
const proposalLocks = new Map<string, Promise<void>>();

/**
 * Acquire a lock for a specific proposal
 * Prevents race conditions during redemption/deposit-back operations
 */
async function acquireProposalLock(proposalPda: string): Promise<() => void> {
  const key = `proposal:${proposalPda}`;

  // Wait for any existing lock to be released
  while (proposalLocks.has(key)) {
    await proposalLocks.get(key);
  }

  // Create a new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  proposalLocks.set(key, lockPromise);

  // Return the release function
  return () => {
    proposalLocks.delete(key);
    releaseLock!();
  };
}

// POST /dao/finalize-proposal - Finalize a proposal after it has ended
// ============================================================================
// This endpoint finalizes a proposal by reading the final TWAP values and
// determining the winning outcome. Can only be called after the proposal has ended.
// ============================================================================

router.post('/finalize-proposal', async (req: Request, res: Response) => {
  try {
    const { proposal_pda } = req.body;

    if (!proposal_pda) {
      return res.status(400).json({ error: 'Missing required field: proposal_pda' });
    }

    if (!isValidTokenMintAddress(proposal_pda)) {
      return res.status(400).json({ error: 'Invalid proposal_pda' });
    }

    const pool = getPool();
    const connection = getConnection();

    // Create a read-only client for on-chain fetching
    const readClient = createReadOnlyClient(connection);

    // Fetch proposal from on-chain
    const proposalPubkey = new PublicKey(proposal_pda);
    let proposal;
    try {
      proposal = await readClient.fetchProposal(proposalPubkey);
    } catch (err) {
      return res.status(404).json({
        error: 'Proposal not found on-chain',
        details: String(err)
      });
    }

    // Check current state
    const { state, winningIdx } = futarchy.parseProposalState(proposal.state);

    if (state === futarchy.ProposalState.Resolved) {
      return res.json({
        message: 'Proposal already resolved',
        proposal_pda,
        winning_option: winningIdx,
        state: 'resolved'
      });
    }

    if (state !== futarchy.ProposalState.Pending) {
      return res.status(400).json({
        error: 'Proposal cannot be finalized',
        state,
        message: 'Proposal must be in Pending state to finalize'
      });
    }

    // Check if proposal has ended
    const now = Math.floor(Date.now() / 1000);
    const createdAt = Number(proposal.createdAt?.toString() || 0);
    const length = Number(proposal.config?.length || 0);
    const endTime = createdAt + length;

    if (now < endTime) {
      const remaining = endTime - now;
      return res.status(400).json({
        error: 'Proposal has not ended yet',
        ends_in_seconds: remaining,
        end_time: endTime
      });
    }

    // Get moderator PDA from proposal and lookup DAO
    const moderatorPda = proposal.moderator.toBase58();
    const dao = await getDaoByModeratorPda(pool, moderatorPda);
    if (!dao) {
      return res.status(404).json({
        error: 'DAO not found for this proposal',
        moderator_pda: moderatorPda
      });
    }

    if (dao.admin_key_idx === undefined || dao.admin_key_idx === null) {
      return res.status(500).json({ error: 'DAO has no admin key index' });
    }

    // Get admin keypair
    const adminKeypair = await fetchKeypair(dao.admin_key_idx);

    // Create provider and client with admin keypair
    const provider = createProvider(adminKeypair);
    const client = new futarchy.FutarchyClient(provider);

    console.log(`Finalizing proposal ${proposal_pda}`);
    console.log(`  DAO: ${dao.dao_name} (${dao.dao_pda})`);

    // Finalize the proposal
    const { builder } = await client.finalizeProposal(
      adminKeypair.publicKey,
      proposalPubkey
    );

    const tx = await builder.rpc();
    console.log(`Proposal finalized: ${tx}`);

    // Fetch result
    const finalProposal = await readClient.fetchProposal(proposalPubkey);
    const finalState = futarchy.parseProposalState(finalProposal.state);

    res.json({
      message: 'Proposal finalized successfully',
      proposal_pda,
      signature: tx,
      winning_option: finalState.winningIdx,
      state: finalState.state
    });

  } catch (error) {
    console.error('Error finalizing proposal:', error);
    res.status(500).json({ error: 'Failed to finalize proposal', details: String(error) });
  }
});

// POST /dao/redeem-liquidity - Redeem liquidity from resolved proposal
// ============================================================================
// Called by os-percent after finalizing a proposal.
// This endpoint:
// 1. Fetches proposal from chain and derives DAO from its moderator
// 2. Verifies proposal is in "Resolved" state (on-chain)
// 3. Gets admin keypair from key service
// 4. Calls SDK redeemLiquidity() to withdraw liquidity and redeem tokens
// ============================================================================

router.post('/redeem-liquidity', async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;
  try {
    const { proposal_pda } = req.body;

    // Validate required fields
    if (!proposal_pda) {
      return res.status(400).json({
        error: 'Missing required field: proposal_pda'
      });
    }

    // Validate PDA is valid public key
    if (!isValidTokenMintAddress(proposal_pda)) {
      return res.status(400).json({ error: 'Invalid proposal_pda' });
    }

    // Acquire lock to prevent concurrent operations on this proposal
    console.log(`Acquiring lock for proposal ${proposal_pda}`);
    releaseLock = await acquireProposalLock(proposal_pda);
    console.log(`Lock acquired for proposal ${proposal_pda}`);

    const pool = getPool();
    const connection = getConnection();

    // Create a read-only provider to fetch proposal first
    const readProvider = new AnchorProvider(
      connection,
      { publicKey: PublicKey.default, signTransaction: async (tx: Transaction) => tx, signAllTransactions: async (txs: Transaction[]) => txs } as any,
      { commitment: 'confirmed' }
    );
    const readClient = new futarchy.FutarchyClient(readProvider);

    // Fetch proposal from on-chain
    const proposalPubkey = new PublicKey(proposal_pda);
    let proposal;
    try {
      proposal = await readClient.fetchProposal(proposalPubkey);
    } catch (err) {
      return res.status(404).json({
        error: 'Proposal not found on-chain',
        details: String(err)
      });
    }

    // Parse proposal state and verify it's resolved
    const { state, winningIdx } = futarchy.parseProposalState(proposal.state);
    if (state !== futarchy.ProposalState.Resolved) {
      return res.status(400).json({
        error: 'Proposal is not resolved',
        state,
        message: 'Call finalizeProposal() first to resolve the proposal'
      });
    }

    // Get moderator PDA from proposal and lookup DAO
    const moderatorPda = proposal.moderator.toBase58();
    const dao = await getDaoByModeratorPda(pool, moderatorPda);
    if (!dao) {
      return res.status(404).json({
        error: 'DAO not found for this proposal',
        moderator_pda: moderatorPda,
        message: 'This proposal belongs to a moderator not registered in our system'
      });
    }

    // For child DAOs, liquidity is managed by the parent DAO
    const liquidityDao = await resolveLiquidityDao(pool, dao);
    if (liquidityDao !== dao) {
      console.log(`Child DAO detected, using parent DAO for redemption: ${liquidityDao.dao_name}`);
    }

    if (liquidityDao.admin_key_idx === undefined || liquidityDao.admin_key_idx === null) {
      return res.status(500).json({ error: 'DAO has no admin key index' });
    }

    // Get admin keypair (from parent if child DAO)
    const adminKeypair = await fetchKeypair(liquidityDao.admin_key_idx);

    // Create provider and client with admin keypair
    const provider = createProvider(adminKeypair);
    const client = new futarchy.FutarchyClient(provider);

    console.log(`Redeeming liquidity for proposal ${proposal_pda}`);
    console.log(`  Winning index: ${winningIdx}`);
    console.log(`  Num options: ${proposal.numOptions}`);
    console.log(`  DAO: ${dao.dao_name} (${dao.dao_pda})`);
    if (liquidityDao !== dao) {
      console.log(`  Parent DAO (LP owner): ${liquidityDao.dao_name} (${liquidityDao.dao_pda})`);
    }

    let tx: string;

    // Use versioned transaction with ALT for 3+ option proposals
    // This avoids exceeding the 1232 byte transaction size limit
    if (proposal.numOptions >= 3) {
      console.log(`  Using versioned transaction (${proposal.numOptions} options)`);
      const result = await client.redeemLiquidityVersioned(
        adminKeypair.publicKey,
        proposalPubkey
      );

      // Sign the versioned transaction with admin keypair
      result.versionedTx.sign([adminKeypair]);

      // Send the signed transaction
      tx = await client.sendVersionedTransaction(result.versionedTx);
    } else {
      // Standard transaction for 2-option proposals
      const { builder } = await client.redeemLiquidity(
        adminKeypair.publicKey,
        proposalPubkey
      );
      tx = await builder.rpc();
    }

    console.log(`Liquidity redeemed successfully: ${tx}`);

    res.json({
      success: true,
      proposal_pda,
      dao_pda: dao.dao_pda,
      winning_index: winningIdx,
      transaction: tx,
    });
  } catch (error) {
    console.error('Error redeeming liquidity:', error);
    res.status(500).json({
      error: 'Failed to redeem liquidity',
      details: String(error)
    });
  } finally {
    // Always release the lock
    if (releaseLock) {
      releaseLock();
      console.log(`Lock released for proposal ${req.body.proposal_pda}`);
    }
  }
});

// ============================================================================
// POST /dao/deposit-back - Return liquidity to Meteora pool after redemption
// ============================================================================
// Called by os-percent after redeeming liquidity from a proposal.
// This endpoint:
// 1. Fetches proposal from chain and derives DAO from its moderator
// 2. Checks if admin wallet has meaningful token balance (>0.5% of supply)
// 3. Transfers tokens from admin wallet to LP owner
// 4. Calls cleanup swap + deposit to return liquidity to Meteora pool
// ============================================================================

router.post('/deposit-back', async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;
  try {
    const { proposal_pda } = req.body;

    // Validate required fields
    if (!proposal_pda) {
      return res.status(400).json({
        error: 'Missing required field: proposal_pda'
      });
    }

    // Validate PDA is valid public key
    if (!isValidTokenMintAddress(proposal_pda)) {
      return res.status(400).json({ error: 'Invalid proposal_pda' });
    }

    // Acquire lock to prevent concurrent operations on this proposal
    console.log(`Acquiring lock for deposit-back ${proposal_pda}`);
    releaseLock = await acquireProposalLock(proposal_pda);
    console.log(`Lock acquired for deposit-back ${proposal_pda}`);

    const pool = getPool();
    const connection = getConnection();

    // Create a read-only provider to fetch proposal first
    const readProvider = new AnchorProvider(
      connection,
      { publicKey: PublicKey.default, signTransaction: async (tx: Transaction) => tx, signAllTransactions: async (txs: Transaction[]) => txs } as any,
      { commitment: 'confirmed' }
    );
    const readClient = new futarchy.FutarchyClient(readProvider);

    // Fetch proposal from on-chain
    const proposalPubkey = new PublicKey(proposal_pda);
    let proposal;
    try {
      proposal = await readClient.fetchProposal(proposalPubkey);
    } catch (err) {
      return res.status(404).json({
        error: 'Proposal not found on-chain',
        details: String(err)
      });
    }

    // Parse proposal state and verify it's resolved
    const { state } = futarchy.parseProposalState(proposal.state);
    if (state !== futarchy.ProposalState.Resolved) {
      return res.status(400).json({
        error: 'Proposal is not resolved',
        state,
        message: 'Proposal must be resolved before deposit-back'
      });
    }

    // Get moderator PDA from proposal and lookup DAO
    const moderatorPda = proposal.moderator.toBase58();
    const dao = await getDaoByModeratorPda(pool, moderatorPda);
    if (!dao) {
      return res.status(404).json({
        error: 'DAO not found for this proposal',
        moderator_pda: moderatorPda,
        message: 'This proposal belongs to a moderator not registered in our system'
      });
    }

    // For child DAOs, liquidity is managed by the parent DAO
    const liquidityDao = await resolveLiquidityDao(pool, dao);
    if (liquidityDao !== dao) {
      console.log(`Child DAO detected, using parent DAO for liquidity: ${liquidityDao.dao_name}`);
    }

    if (liquidityDao.admin_key_idx === undefined || liquidityDao.admin_key_idx === null) {
      return res.status(500).json({ error: 'DAO has no admin key index' });
    }

    if (!liquidityDao.pool_address) {
      return res.status(500).json({ error: 'DAO has no pool address' });
    }

    if (!liquidityDao.token_mint) {
      return res.status(500).json({ error: 'DAO has no token mint' });
    }

    // Get admin keypair (from parent if child DAO)
    const adminKeypair = await fetchKeypair(liquidityDao.admin_key_idx);
    const adminPubkey = adminKeypair.publicKey;

    console.log(`Deposit-back for proposal ${proposal_pda}`);
    console.log(`  DAO: ${dao.dao_name} (${dao.dao_pda})`);
    if (liquidityDao !== dao) {
      console.log(`  Parent DAO: ${liquidityDao.dao_name} (${liquidityDao.dao_pda})`);
    }
    console.log(`  Pool: ${liquidityDao.pool_address} (${liquidityDao.pool_type})`);
    console.log(`  Admin wallet: ${adminPubkey.toBase58()}`);

    // Check if admin wallet has meaningful token balance (>0.5% of supply)
    const tokenMint = new PublicKey(liquidityDao.token_mint);
    const mintInfo = await connection.getParsedAccountInfo(tokenMint);
    if (!mintInfo.value || !('parsed' in mintInfo.value.data)) {
      return res.status(500).json({ error: 'Failed to fetch token mint info' });
    }

    const mintData = mintInfo.value.data.parsed;
    const totalSupply = BigInt(mintData.info.supply);

    // Get admin's token balance
    const adminAta = await getAssociatedTokenAddress(tokenMint, adminPubkey);
    let adminBalance = BigInt(0);
    try {
      const accountInfo = await connection.getTokenAccountBalance(adminAta);
      adminBalance = BigInt(accountInfo.value.amount);
    } catch {
      // Account doesn't exist or has no balance
      console.log(`  Admin has no token account or zero balance`);
    }

    // Calculate percentage (with precision)
    const balancePercent = (adminBalance * BigInt(10000)) / totalSupply; // basis points
    const percentFormatted = Number(balancePercent) / 100;

    console.log(`  Admin token balance: ${adminBalance} (${percentFormatted.toFixed(2)}% of supply)`);

    // If balance < 0.5% of supply, skip deposit-back
    if (balancePercent < BigInt(50)) { // 50 basis points = 0.5%
      console.log(`  Balance too small for deposit-back (< 0.5%), skipping`);
      return res.json({
        success: true,
        proposal_pda,
        dao_pda: dao.dao_pda,
        skipped: true,
        reason: 'Admin token balance below 0.5% threshold',
        balance_percent: percentFormatted,
      });
    }

    // For DAOs, the LP owner is the admin wallet
    // We use adminPubkey directly instead of fetching from pool config endpoint
    // This ensures we use the correct LP owner when multiple DAOs share the same pool
    const lpOwnerPubkey = adminPubkey;

    console.log(`  LP Owner (admin): ${lpOwnerPubkey.toBase58()}`);

    // For DAOs, LP owner = admin, so tokens are already in the right wallet after redemption
    // No transfer step needed - skip directly to cleanup swap + deposit
    let transferSignature = '';
    console.log(`  Skipping transfer step (LP owner = admin, tokens already in place)`);

    // Step 2: Call cleanup swap + deposit via internal endpoints
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const poolType = liquidityDao.pool_type;

    // Build cleanup swap
    let swapSignature = '';
    const swapBuildResponse = await fetch(`${baseUrl}/${poolType}/cleanup/swap/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poolAddress: liquidityDao.pool_address,
        adminWallet: liquidityDao.admin_wallet
      })
    });

    if (swapBuildResponse.ok) {
      const swapBuildData = await swapBuildResponse.json() as {
        requestId: string;
        transaction: string;
      };

      // Sign the swap transaction
      const swapTxBuffer = bs58.decode(swapBuildData.transaction);
      const swapTx = Transaction.from(swapTxBuffer);
      swapTx.partialSign(adminKeypair);
      const signedSwapTx = bs58.encode(swapTx.serialize({ requireAllSignatures: false }));

      // Confirm swap
      const swapConfirmResponse = await fetch(`${baseUrl}/${poolType}/cleanup/swap/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedTransaction: signedSwapTx,
          requestId: swapBuildData.requestId
        })
      });

      if (swapConfirmResponse.ok) {
        const swapConfirmData = await swapConfirmResponse.json() as { signature: string };
        swapSignature = swapConfirmData.signature;
        console.log(`  Cleanup swap: ${swapSignature}`);
      }
    } else {
      // No swap needed or error - continue to deposit
      const swapError = await swapBuildResponse.json().catch(() => ({}));
      console.log(`  Cleanup swap skipped: ${(swapError as any).error || 'unknown'}`);
    }

    // Build deposit (0, 0 = cleanup mode - uses LP owner balances)
    // Pass adminWallet to disambiguate when multiple DAOs share the same pool
    let depositSignature = '';
    const depositBuildResponse = await fetch(`${baseUrl}/${poolType}/deposit/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poolAddress: liquidityDao.pool_address,
        tokenAAmount: 0,
        tokenBAmount: 0,
        adminWallet: liquidityDao.admin_wallet
      })
    });

    if (depositBuildResponse.ok) {
      const depositBuildData = await depositBuildResponse.json() as {
        requestId: string;
        transaction: string;
      };

      // Sign the deposit transaction
      const depositTxBuffer = bs58.decode(depositBuildData.transaction);
      const depositTx = Transaction.from(depositTxBuffer);
      depositTx.partialSign(adminKeypair);
      const signedDepositTx = bs58.encode(depositTx.serialize({ requireAllSignatures: false }));

      // Confirm deposit
      const depositConfirmResponse = await fetch(`${baseUrl}/${poolType}/deposit/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedTransaction: signedDepositTx,
          requestId: depositBuildData.requestId
        })
      });

      if (depositConfirmResponse.ok) {
        const depositConfirmData = await depositConfirmResponse.json() as { signature: string };
        depositSignature = depositConfirmData.signature;
        console.log(`  Deposit: ${depositSignature}`);
      } else {
        const depositError = await depositConfirmResponse.json().catch(() => ({}));
        console.log(`  Deposit failed: ${(depositError as any).error || 'unknown'}`);
      }
    } else {
      const depositError = await depositBuildResponse.json().catch(() => ({}));
      console.log(`  Deposit build failed: ${(depositError as any).error || 'unknown'}`);
    }

    console.log(`Deposit-back completed for proposal ${proposal_pda}`);

    res.json({
      success: true,
      proposal_pda,
      dao_pda: dao.dao_pda,
      transfer_signature: transferSignature || null,
      swap_signature: swapSignature || null,
      deposit_signature: depositSignature || null,
    });
  } catch (error) {
    console.error('Error in deposit-back:', error);
    res.status(500).json({
      error: 'Failed to complete deposit-back',
      details: String(error)
    });
  } finally {
    // Always release the lock
    if (releaseLock) {
      releaseLock();
      console.log(`Lock released for deposit-back ${req.body.proposal_pda}`);
    }
  }
});

// POST /dao/crank-twap - Crank TWAP for all pools on a proposal
// ============================================================================
// Permissionless endpoint that updates the TWAP oracle for each pool on a proposal.
// This can be called by anyone to ensure TWAP values are current.
// The DAO's admin keypair is used to pay for transaction fees.
// ============================================================================

router.post('/crank-twap', async (req: Request, res: Response) => {
  try {
    const { proposal_pda } = req.body;

    // Validate required fields
    if (!proposal_pda) {
      return res.status(400).json({
        error: 'Missing required field: proposal_pda'
      });
    }

    // Validate PDA is valid public key
    if (!isValidTokenMintAddress(proposal_pda)) {
      return res.status(400).json({ error: 'Invalid proposal_pda' });
    }

    const pool = getPool();
    const connection = getConnection();

    // Create a read-only provider to fetch proposal first
    const readProvider = new AnchorProvider(
      connection,
      { publicKey: PublicKey.default, signTransaction: async (tx: Transaction) => tx, signAllTransactions: async (txs: Transaction[]) => txs } as any,
      { commitment: 'confirmed' }
    );
    const readClient = new futarchy.FutarchyClient(readProvider);

    // Fetch proposal from on-chain
    const proposalPubkey = new PublicKey(proposal_pda);
    let proposal;
    try {
      proposal = await readClient.fetchProposal(proposalPubkey);
    } catch (err) {
      return res.status(404).json({
        error: 'Proposal not found on-chain',
        details: String(err)
      });
    }

    // Get moderator PDA from proposal and lookup DAO
    const moderatorPda = proposal.moderator.toBase58();
    const dao = await getDaoByModeratorPda(pool, moderatorPda);
    if (!dao) {
      return res.status(404).json({
        error: 'DAO not found for this proposal',
        moderator_pda: moderatorPda
      });
    }

    if (dao.admin_key_idx === undefined || dao.admin_key_idx === null) {
      return res.status(500).json({ error: 'DAO has no admin key index' });
    }

    // Get admin keypair to pay for transactions
    const adminKeypair = await fetchKeypair(dao.admin_key_idx);

    // Create provider and client with admin keypair
    const provider = createProvider(adminKeypair);
    const client = new futarchy.FutarchyClient(provider);

    // Get all valid pools from the proposal
    // The pools array is fixed-size (6), but only numOptions are used.
    // Additionally, some pools may be null (Pubkey.default = 11111111111111111111111111111111)
    const numOptions = proposal.numOptions;
    const validPools = proposal.pools
      .slice(0, numOptions)
      .filter((pool: PublicKey) => !pool.equals(PublicKey.default));

    console.log(`Cranking TWAP for proposal ${proposal_pda}`);
    console.log(`  DAO: ${dao.dao_name} (${dao.dao_pda})`);
    console.log(`  Total options: ${numOptions}, valid pools: ${validPools.length}`);

    // Crank TWAP for all eligible pools in a single transaction
    // This ensures all pools are cranked at the exact same time interval
    const now = Math.floor(Date.now() / 1000);
    const results: { pool: string; signature?: string; skipped?: boolean; reason?: string }[] = [];
    const poolsToCrank: { index: number; poolPda: PublicKey }[] = [];

    // First pass: check eligibility and collect pools to crank
    for (let i = 0; i < validPools.length; i++) {
      const poolPda = validPools[i];
      try {
        const poolAccount = await client.amm.fetchPool(poolPda);
        const oracle = poolAccount.oracle;

        // Check 1: Warmup period must have passed
        const createdAt = Number(oracle.createdAtUnixTime);
        const warmupDuration = Number(oracle.warmupDuration);
        const warmupEndsAt = createdAt + warmupDuration;

        if (now < warmupEndsAt) {
          const waitTime = warmupEndsAt - now;
          console.log(`  Pool ${i} (${poolPda.toBase58()}): skipped, warmup ends in ${waitTime}s`);
          results.push({
            pool: poolPda.toBase58(),
            skipped: true,
            reason: `Warmup period: ${waitTime}s remaining`
          });
          continue;
        }

        // Check 2: Minimum recording interval must have passed since last crank
        const lastUpdate = Number(oracle.lastUpdateUnixTime);
        const minInterval = Number(oracle.minRecordingInterval);
        const timeSinceLastUpdate = now - lastUpdate;

        if (timeSinceLastUpdate < minInterval) {
          const waitTime = minInterval - timeSinceLastUpdate;
          console.log(`  Pool ${i} (${poolPda.toBase58()}): skipped, ${waitTime}s until next crank`);
          results.push({
            pool: poolPda.toBase58(),
            skipped: true,
            reason: `Rate limited: ${waitTime}s until next crank (interval: ${minInterval}s)`
          });
          continue;
        }

        poolsToCrank.push({ index: i, poolPda });
      } catch (err) {
        console.error(`  Pool ${i} (${poolPda.toBase58()}) failed to fetch:`, err);
        results.push({ pool: poolPda.toBase58(), reason: `error: ${String(err)}` });
      }
    }

    // Second pass: build all crank instructions and send in a single transaction
    if (poolsToCrank.length > 0) {
      try {
        const instructions = [];
        for (const { poolPda } of poolsToCrank) {
          const builder = await client.amm.crankTwap(poolPda);
          const ix = await builder.instruction();
          instructions.push(ix);
        }

        // Build and send single transaction with all crank instructions
        const tx = new Transaction();
        for (const ix of instructions) {
          tx.add(ix);
        }

        const { blockhash } = await provider.connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = adminKeypair.publicKey;

        const signature = await provider.connection.sendTransaction(tx, [adminKeypair]);
        await provider.connection.confirmTransaction(signature, 'confirmed');

        console.log(`  Cranked ${poolsToCrank.length} pools in single tx: ${signature}`);

        // Mark all pools as cranked with the same signature
        for (const { poolPda } of poolsToCrank) {
          results.push({ pool: poolPda.toBase58(), signature });
        }
      } catch (err) {
        console.error('  Batch crank failed:', err);
        for (const { poolPda } of poolsToCrank) {
          results.push({ pool: poolPda.toBase58(), reason: `batch error: ${String(err)}` });
        }
      }
    }

    res.json({
      message: 'TWAP crank completed',
      proposal_pda,
      dao_pda: dao.dao_pda,
      num_options: numOptions,
      pools_cranked: poolsToCrank.length,
      results
    });

  } catch (error) {
    console.error('Error cranking TWAP:', error);
    res.status(500).json({ error: 'Failed to crank TWAP', details: String(error) });
  }
});

export default router;
