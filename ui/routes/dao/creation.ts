/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
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
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

import { Router, Request, Response } from 'express';
import { PublicKey, Connection, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { futarchy } from '@zcomb/programs-sdk';

import { getPool } from '../../lib/db';
import {
  getNextKeyIndex,
  registerKey,
  updateKeyDaoId,
  createDao,
  getDaoByPda,
  getDaoByName,
  addProposer,
} from '../../lib/db/daos';
import { allocateKey, fetchKeypair, fetchAdminKeypair, AdminKeyError } from '../../lib/keyService';
import { isValidSolanaAddress, isValidTokenMintAddress } from '../../lib/validation';
import {
  requireSignedHash,
  MOCK_MODE,
  mockInitializeParentDAO,
  mockInitializeChildDAO,
  getPoolInfo,
  deriveQuoteMint,
  deriveSquadsVaultPda,
  verifyFundingTransaction,
  type PoolInfo,
} from '../../lib/dao';
import { getConnection, createProvider, daoCreationMutex } from './shared';

const router = Router();

/**
 * Check if a mint is a Token-2022 token.
 * Token-2022 base mints are not currently supported by the Futarchy on-chain program.
 * See /opt/spice/dev/programs/TOKEN22_SUPPORT.md for the roadmap to enable support.
 */
async function isToken2022Mint(connection: Connection, mint: PublicKey): Promise<boolean> {
  const accountInfo = await connection.getAccountInfo(mint);
  if (!accountInfo) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }
  return accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
}

// ============================================================================
// POST /dao/parent - Create a parent DAO
// ============================================================================

router.post('/parent', requireSignedHash, async (req: Request, res: Response) => {
  try {
    const {
      wallet,
      name,
      token_mint,
      treasury_cosigner,
      pool_address,
      funding_signature,
    } = req.body;

    // Validate required fields
    if (!name || !token_mint || !treasury_cosigner || !pool_address || !funding_signature) {
      return res.status(400).json({
        error: 'Missing required fields: name, token_mint, treasury_cosigner, pool_address, funding_signature'
      });
    }

    // Validate name length
    if (name.length > 32) {
      return res.status(400).json({ error: 'DAO name must be 32 characters or less' });
    }

    // Validate addresses
    if (!isValidTokenMintAddress(token_mint)) {
      return res.status(400).json({ error: 'Invalid token_mint address' });
    }
    if (!isValidSolanaAddress(treasury_cosigner)) {
      return res.status(400).json({ error: 'Invalid treasury_cosigner address' });
    }
    if (!isValidTokenMintAddress(pool_address)) {
      return res.status(400).json({ error: 'Invalid pool_address' });
    }

    const pool = getPool();
    const connection = getConnection();

    // Derive pool_type and quote_mint from pool_address
    let poolInfo: PoolInfo;
    try {
      poolInfo = await getPoolInfo(connection, new PublicKey(pool_address));
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid pool_address: could not fetch pool info',
        details: String(error),
      });
    }

    const pool_type = poolInfo.poolType;

    // Validate pool fee rate
    const MIN_FEE_BPS = 63;
    if (poolInfo.feeBps < MIN_FEE_BPS) {
      return res.status(400).json({
        error: `Pool fee rate too low. Minimum required: ${MIN_FEE_BPS}bps (${(MIN_FEE_BPS / 100).toFixed(2)}%). Pool has: ${poolInfo.feeBps}bps (${(poolInfo.feeBps / 100).toFixed(2)}%). Protocol requires at least 0.5% of swap volume after Meteora's 20% fee.`,
        pool_fee_bps: poolInfo.feeBps,
        min_fee_bps: MIN_FEE_BPS,
      });
    }

    // Derive quote_mint from pool tokens and token_mint
    let quote_mint: string;
    try {
      quote_mint = deriveQuoteMint(poolInfo, token_mint);
    } catch (error) {
      return res.status(400).json({
        error: 'token_mint not found in pool',
        details: String(error),
      });
    }

    // Check if base token is Token-2022 (not currently supported)
    try {
      const isToken2022 = await isToken2022Mint(connection, new PublicKey(token_mint));
      if (isToken2022) {
        return res.status(400).json({
          error: 'Token-2022 base mints are not currently supported',
          details: 'The Futarchy on-chain program requires SPL Token base mints. Token-2022 support is planned for a future release. See TOKEN22_SUPPORT.md in the programs repository for the roadmap.',
          token_mint,
          token_program: 'Token-2022',
        });
      }
    } catch (error) {
      return res.status(400).json({
        error: 'Failed to validate token_mint',
        details: String(error),
      });
    }

    // Acquire lock for DAO creation
    await daoCreationMutex.acquire();

    try {
      // Verify funding transaction (inside lock to prevent race conditions)
      const fundingResult = await verifyFundingTransaction(connection, pool, funding_signature, wallet);
      if (!fundingResult.valid) {
        return res.status(400).json({
          error: 'Invalid funding transaction',
          details: fundingResult.error,
        });
      }

      console.log(`[DAO] Verified funding tx ${funding_signature}: ${fundingResult.amount} SOL from ${fundingResult.sender}`);

      // Check if DAO with this name already exists
      const existingDao = await getDaoByName(pool, name);
      if (existingDao) {
        return res.status(409).json({ error: 'DAO with this name already exists' });
      }

      // Get next key index and allocate a new managed wallet
      const keyIdx = await getNextKeyIndex(pool);
      let adminWallet: string;
      let daoPda: string;
      let moderatorPda: string;
      let treasuryVault: string;
      let mintVault: string;
      let tx: string;

      // Allocate and fund admin wallet
      const { publicKey: allocatedWallet } = await allocateKey(connection, keyIdx, false);
      adminWallet = allocatedWallet;

      // Register the key
      await registerKey(pool, {
        key_idx: keyIdx,
        public_key: adminWallet,
        purpose: 'dao_parent',
      });

      if (MOCK_MODE) {
        console.log('[MOCK MODE] Skipping FutarchyClient SDK calls for parent DAO creation');
        const mockResult = mockInitializeParentDAO(name);
        daoPda = mockResult.daoPda;
        moderatorPda = mockResult.moderatorPda;
        treasuryVault = mockResult.treasuryVault;
        mintVault = mockResult.mintVault;
        tx = mockResult.tx;
      } else {
        const adminKeypair = await fetchKeypair(keyIdx);
        const provider = createProvider(adminKeypair);
        const client = new futarchy.FutarchyClient(provider);

        const baseMint = new PublicKey(token_mint);
        const quoteMintPubkey = new PublicKey(quote_mint);
        const poolPubkey = new PublicKey(pool_address);
        const cosignerPubkey = new PublicKey(treasury_cosigner);

        const result = await client.initializeParentDAO(
          adminKeypair.publicKey,
          adminKeypair.publicKey,
          name,
          baseMint,
          quoteMintPubkey,
          cosignerPubkey,
          poolPubkey,
          { [pool_type]: {} } as any,
        );

        // Build and send manually for robust confirmation
        const instruction = await result.builder.instruction();
        const createTx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
          instruction
        );
        const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash('confirmed');
        createTx.recentBlockhash = blockhash;
        createTx.feePayer = adminKeypair.publicKey;
        createTx.sign(adminKeypair);

        tx = await provider.connection.sendRawTransaction(createTx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });
        await provider.connection.confirmTransaction({
          signature: tx,
          blockhash,
          lastValidBlockHeight,
        }, 'confirmed');

        daoPda = result.daoPda.toBase58();
        moderatorPda = result.moderatorPda.toBase58();

        const treasuryMultisigPda = result.treasuryMultisig;
        const mintMultisigPda = result.mintMultisig;
        treasuryVault = deriveSquadsVaultPda(treasuryMultisigPda).toBase58();
        mintVault = deriveSquadsVaultPda(mintMultisigPda).toBase58();

        console.log(`[DAO] Created parent DAO ${name}`);
        console.log(`  Treasury Multisig: ${treasuryMultisigPda.toBase58()}`);
        console.log(`  Treasury Vault:    ${treasuryVault}`);
        console.log(`  Mint Multisig:     ${mintMultisigPda.toBase58()}`);
        console.log(`  Mint Vault:        ${mintVault}`);
      }

      // Store in database
      const dao = await createDao(pool, {
        dao_pda: daoPda,
        dao_name: name,
        moderator_pda: moderatorPda,
        owner_wallet: wallet,
        admin_key_idx: keyIdx,
        admin_wallet: adminWallet,
        token_mint,
        pool_address,
        pool_type,
        quote_mint,
        treasury_multisig: treasuryVault,
        mint_auth_multisig: mintVault,
        treasury_cosigner,
        dao_type: 'parent',
        withdrawal_percentage: 12,
        funding_signature,
      });

      await updateKeyDaoId(pool, keyIdx, dao.id!);

      // Add creator to proposer whitelist
      await addProposer(pool, {
        dao_id: dao.id!,
        proposer_wallet: wallet,
        added_by: wallet,
      });

      console.log(`Created parent DAO: ${daoPda} (tx: ${tx}, funding: ${funding_signature})`);

      res.json({
        dao_pda: daoPda,
        moderator_pda: moderatorPda,
        treasury_vault: treasuryVault,
        mint_vault: mintVault,
        admin_wallet: adminWallet,
        pool_type,
        quote_mint,
        transaction: tx,
      });
    } finally {
      daoCreationMutex.release();
    }
  } catch (error) {
    console.error('Error creating parent DAO:', error);
    res.status(500).json({ error: 'Failed to create parent DAO', details: String(error) });
  }
});

// ============================================================================
// POST /dao/child - Create a child DAO
// ============================================================================

router.post('/child', requireSignedHash, async (req: Request, res: Response) => {
  try {
    const { wallet, name, parent_pda, token_mint, treasury_cosigner, funding_signature } = req.body;

    // Validate required fields
    if (!name || !parent_pda || !token_mint || !treasury_cosigner || !funding_signature) {
      return res.status(400).json({
        error: 'Missing required fields: name, parent_pda, token_mint, treasury_cosigner, funding_signature'
      });
    }

    // Validate name length
    if (name.length > 32) {
      return res.status(400).json({ error: 'DAO name must be 32 characters or less' });
    }

    // Validate addresses
    if (!isValidTokenMintAddress(parent_pda)) {
      return res.status(400).json({ error: 'Invalid parent_pda address' });
    }
    if (!isValidTokenMintAddress(token_mint)) {
      return res.status(400).json({ error: 'Invalid token_mint address' });
    }
    if (!isValidSolanaAddress(treasury_cosigner)) {
      return res.status(400).json({ error: 'Invalid treasury_cosigner address' });
    }

    const pool = getPool();
    const connection = getConnection();

    // Fetch parent DAO
    const parentDao = await getDaoByPda(pool, parent_pda);
    if (!parentDao) {
      return res.status(404).json({ error: 'Parent DAO not found' });
    }

    // Verify caller is the parent DAO owner
    if (parentDao.owner_wallet !== wallet) {
      return res.status(403).json({ error: 'Only the parent DAO owner can create child DAOs' });
    }

    // Verify parent is actually a parent DAO
    if (parentDao.dao_type !== 'parent') {
      return res.status(400).json({ error: 'Cannot create child of a child DAO' });
    }

    // Check if base token is Token-2022 (not currently supported)
    try {
      const isToken2022 = await isToken2022Mint(connection, new PublicKey(token_mint));
      if (isToken2022) {
        return res.status(400).json({
          error: 'Token-2022 base mints are not currently supported',
          details: 'The Futarchy on-chain program requires SPL Token base mints. Token-2022 support is planned for a future release. See TOKEN22_SUPPORT.md in the programs repository for the roadmap.',
          token_mint,
          token_program: 'Token-2022',
        });
      }
    } catch (error) {
      return res.status(400).json({
        error: 'Failed to validate token_mint',
        details: String(error),
      });
    }

    // Acquire lock for DAO creation
    await daoCreationMutex.acquire();

    try {
      // Verify funding transaction (inside lock to prevent race conditions)
      const fundingResult = await verifyFundingTransaction(connection, pool, funding_signature, wallet);
      if (!fundingResult.valid) {
        return res.status(400).json({
          error: 'Invalid funding transaction',
          details: fundingResult.error,
        });
      }

      console.log(`[DAO] Verified funding tx ${funding_signature}: ${fundingResult.amount} SOL from ${fundingResult.sender}`);

      // Check if DAO with this name already exists
      const existingDao = await getDaoByName(pool, name);
      if (existingDao) {
        return res.status(409).json({ error: 'DAO with this name already exists' });
      }

      // Get next key index and allocate admin wallet
      const keyIdx = await getNextKeyIndex(pool);
      const { publicKey: childAdminWallet } = await allocateKey(connection, keyIdx, false);

      // Register the key
      await registerKey(pool, {
        key_idx: keyIdx,
        public_key: childAdminWallet,
        purpose: 'dao_child',
      });

      let daoPda: string;
      let treasuryVault: string;
      let mintVault: string;
      let tx: string;

      if (MOCK_MODE) {
        console.log('[MOCK MODE] Skipping FutarchyClient SDK calls for child DAO creation');
        const mockResult = mockInitializeChildDAO(parentDao.dao_name, name);
        daoPda = mockResult.daoPda;
        treasuryVault = mockResult.treasuryVault;
        mintVault = mockResult.mintVault;
        tx = mockResult.tx;
      } else {
        const childKeypair = await fetchKeypair(keyIdx);
        // Parent DAO may be historical (NULL admin_key_idx), so use fetchAdminKeypair
        const parentKeypair = await fetchAdminKeypair(parentDao.admin_key_idx, parentDao.dao_name);

        const provider = createProvider(childKeypair);
        const client = new futarchy.FutarchyClient(provider);

        const tokenMintPubkey = new PublicKey(token_mint);
        const cosignerPubkey = new PublicKey(treasury_cosigner);

        const result = await client.initializeChildDAO(
          childKeypair.publicKey,
          parentKeypair.publicKey,
          parentDao.dao_name,
          name,
          tokenMintPubkey,
          cosignerPubkey,
        );

        // Build and send manually for robust confirmation
        const instruction = await result.builder.instruction();
        const createTx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
          instruction
        );
        const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash('confirmed');
        createTx.recentBlockhash = blockhash;
        createTx.feePayer = childKeypair.publicKey;
        createTx.sign(childKeypair, parentKeypair);

        tx = await provider.connection.sendRawTransaction(createTx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });
        await provider.connection.confirmTransaction({
          signature: tx,
          blockhash,
          lastValidBlockHeight,
        }, 'confirmed');

        daoPda = result.daoPda.toBase58();

        const treasuryMultisigPda = result.treasuryMultisig;
        const mintMultisigPda = result.mintMultisig;
        treasuryVault = deriveSquadsVaultPda(treasuryMultisigPda).toBase58();
        mintVault = deriveSquadsVaultPda(mintMultisigPda).toBase58();

        console.log(`[DAO] Created child DAO ${name}`);
        console.log(`  Treasury Multisig: ${treasuryMultisigPda.toBase58()}`);
        console.log(`  Treasury Vault:    ${treasuryVault}`);
        console.log(`  Mint Multisig:     ${mintMultisigPda.toBase58()}`);
        console.log(`  Mint Vault:        ${mintVault}`);
      }

      // Store in database
      const dao = await createDao(pool, {
        dao_pda: daoPda,
        dao_name: name,
        moderator_pda: parentDao.moderator_pda,
        owner_wallet: wallet,
        admin_key_idx: keyIdx,
        admin_wallet: childAdminWallet,
        token_mint,
        pool_address: parentDao.pool_address,
        pool_type: parentDao.pool_type,
        quote_mint: parentDao.quote_mint,
        treasury_multisig: treasuryVault,
        mint_auth_multisig: mintVault,
        treasury_cosigner,
        parent_dao_id: parentDao.id,
        dao_type: 'child',
        withdrawal_percentage: 12,
        funding_signature,
      });

      await updateKeyDaoId(pool, keyIdx, dao.id!);

      // Add creator to proposer whitelist
      await addProposer(pool, {
        dao_id: dao.id!,
        proposer_wallet: wallet,
        added_by: wallet,
      });

      console.log(`Created child DAO: ${daoPda} under parent ${parent_pda} (tx: ${tx}, funding: ${funding_signature})`);

      res.json({
        dao_pda: daoPda,
        parent_dao_pda: parent_pda,
        treasury_vault: treasuryVault,
        mint_vault: mintVault,
        admin_wallet: childAdminWallet,
        transaction: tx,
      });
    } finally {
      daoCreationMutex.release();
    }
  } catch (error) {
    console.error('Error creating child DAO:', error);
    if (error instanceof AdminKeyError) {
      console.error('Admin key error details:', error.internalDetails);
      return res.status(503).json({ error: error.clientMessage });
    }
    res.status(500).json({ error: 'Failed to create child DAO', details: String(error) });
  }
});

export default router;
