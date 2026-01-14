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

/**
 * Trading API routes for third-party integration
 * Enables programmatic trading on futarchy proposal markets
 */

import { Router, Request, Response } from 'express';
import { PublicKey, Transaction } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';
import { futarchy, VaultType } from '@zcomb/programs-sdk';
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';

import { isValidSolanaAddress } from '../../lib/validation';
import { getConnection } from './shared';
import { RequestStorage, REQUEST_EXPIRY } from '../liquidity/shared/request-storage';
import {
  deserializeTransaction,
  computeTransactionHash,
  verifyWalletSignature,
  verifyTransactionIntegrity,
  verifyBlockhash,
  verifyFeePayer,
} from '../liquidity/shared/tx-verification';

const router = Router();

// ============================================================================
// Types
// ============================================================================

interface TradingRequestData {
  timestamp: number;
  poolAddress: string;
  hash: string;
  proposalPda: string;
  wallet: string;
  operation: 'swap' | 'deposit' | 'withdraw' | 'redeem';
  vaultType?: 'base' | 'quote';
}

// Request storage for build/execute pattern (15 min TTL)
const tradingStorage = new RequestStorage<TradingRequestData>();

// ============================================================================
// Utility Functions
// ============================================================================

function createReadOnlyClient(connection: ReturnType<typeof getConnection>) {
  const readProvider = new AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async (tx: Transaction) => tx,
      signAllTransactions: async (txs: Transaction[]) => txs,
    } as any,
    { commitment: 'confirmed' }
  );
  return new futarchy.FutarchyClient(readProvider);
}

function getVaultType(type: string): VaultType {
  if (type === 'base') return VaultType.Base;
  if (type === 'quote') return VaultType.Quote;
  throw new Error(`Invalid vault type: ${type}. Must be 'base' or 'quote'`);
}

async function getTokenProgramForMint(
  connection: ReturnType<typeof getConnection>,
  mint: PublicKey
): Promise<PublicKey> {
  const accountInfo = await connection.getAccountInfo(mint);
  if (!accountInfo) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }
  if (accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }
  return TOKEN_PROGRAM_ID;
}

// ============================================================================
// GET /dao/proposal/:proposalPda/market-status
// Returns TWAP values, spot prices, and leading option
// ============================================================================

router.get('/:proposalPda/market-status', async (req: Request, res: Response) => {
  try {
    const { proposalPda } = req.params;

    if (!isValidSolanaAddress(proposalPda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    const connection = getConnection();
    const client = createReadOnlyClient(connection);

    // Fetch proposal from chain
    const proposalPubkey = new PublicKey(proposalPda);
    let proposal;
    try {
      proposal = await client.fetchProposal(proposalPubkey);
    } catch (err) {
      return res.status(404).json({
        error: 'Proposal not found on-chain',
        details: String(err),
      });
    }

    // Parse proposal state
    const { state, winningIdx } = futarchy.parseProposalState(proposal.state);

    // Get all valid pools from proposal
    const numOptions = proposal.numOptions;
    const validPools = proposal.pools
      .slice(0, numOptions)
      .filter((pool: PublicKey) => !pool.equals(PublicKey.default));

    // Fetch spot prices and TWAP for each pool
    const poolData = await Promise.all(
      validPools.map(async (poolPda: PublicKey, index: number) => {
        try {
          const poolAccount = await client.amm.fetchPool(poolPda);
          const spotPrice = await client.amm.fetchSpotPrice(poolPda);
          const twap = await client.amm.fetchTwap(poolPda);

          return {
            index,
            poolPda: poolPda.toBase58(),
            spotPrice: spotPrice.toString(),
            twap: twap ? twap.toString() : null,
            oracle: {
              createdAt: Number(poolAccount.oracle.createdAtUnixTime),
              warmupDuration: Number(poolAccount.oracle.warmupDuration),
              lastUpdate: Number(poolAccount.oracle.lastUpdateUnixTime),
            },
          };
        } catch (err) {
          return {
            index,
            poolPda: poolPda.toBase58(),
            error: String(err),
          };
        }
      })
    );

    // Calculate leading option based on TWAP values
    let leadingOption: number | null = null;
    let highestTwap: BN | null = null;

    for (const pool of poolData) {
      if ('twap' in pool && pool.twap) {
        const twapBN = new BN(pool.twap);
        if (!highestTwap || twapBN.gt(highestTwap)) {
          highestTwap = twapBN;
          leadingOption = pool.index;
        }
      }
    }

    // Calculate time remaining
    const now = Math.floor(Date.now() / 1000);
    const createdAt = Number(proposal.createdAt?.toString() || 0);
    const length = Number(proposal.config?.length || 0);
    const endTime = createdAt + length;
    const timeRemaining = Math.max(0, endTime - now);

    res.json({
      proposalPda,
      state,
      winningIndex: state === 'resolved' ? winningIdx : undefined,
      numOptions,
      pools: poolData,
      leadingOption,
      timing: {
        createdAt,
        length,
        endTime,
        timeRemaining,
        hasEnded: timeRemaining === 0,
      },
    });
  } catch (error) {
    console.error('Error fetching market status:', error);
    res.status(500).json({ error: 'Failed to fetch market status', details: String(error) });
  }
});

// ============================================================================
// GET /dao/proposal/:proposalPda/quote
// Get swap quote for a specific pool
// ============================================================================

router.get('/:proposalPda/quote', async (req: Request, res: Response) => {
  try {
    const { proposalPda } = req.params;
    const { poolIndex, swapAToB, inputAmount } = req.query;

    if (!isValidSolanaAddress(proposalPda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    if (poolIndex === undefined || swapAToB === undefined || !inputAmount) {
      return res.status(400).json({
        error: 'Missing required query params: poolIndex, swapAToB, inputAmount',
      });
    }

    const poolIndexNum = parseInt(poolIndex as string);
    const swapAToBBool = swapAToB === 'true';
    const inputAmountBN = new BN(inputAmount as string);

    const connection = getConnection();
    const client = createReadOnlyClient(connection);

    // Fetch proposal to get pool address
    const proposalPubkey = new PublicKey(proposalPda);
    let proposal;
    try {
      proposal = await client.fetchProposal(proposalPubkey);
    } catch (err) {
      return res.status(404).json({
        error: 'Proposal not found on-chain',
        details: String(err),
      });
    }

    if (poolIndexNum >= proposal.numOptions) {
      return res.status(400).json({
        error: `Invalid pool index: ${poolIndexNum}. Proposal has ${proposal.numOptions} options.`,
      });
    }

    const poolPda = proposal.pools[poolIndexNum];
    if (poolPda.equals(PublicKey.default)) {
      return res.status(400).json({ error: `Pool ${poolIndexNum} is not initialized` });
    }

    // Get quote from AMM
    const quote = await client.amm.quote(poolPda, swapAToBBool, inputAmountBN);

    res.json({
      proposalPda,
      poolIndex: poolIndexNum,
      poolPda: poolPda.toBase58(),
      swapAToB: swapAToBBool,
      inputAmount: quote.inputAmount.toString(),
      outputAmount: quote.outputAmount.toString(),
      minOutputAmount: quote.minOutputAmount.toString(),
      feeAmount: quote.feeAmount.toString(),
      priceImpact: quote.priceImpact,
      spotPriceBefore: quote.spotPriceBefore.toString(),
      spotPriceAfter: quote.spotPriceAfter.toString(),
    });
  } catch (error) {
    console.error('Error getting swap quote:', error);
    res.status(500).json({ error: 'Failed to get swap quote', details: String(error) });
  }
});

// ============================================================================
// POST /dao/proposal/:proposalPda/swap/build
// Build a swap transaction for user to sign
// ============================================================================

router.post('/:proposalPda/swap/build', async (req: Request, res: Response) => {
  try {
    const { proposalPda } = req.params;
    const { wallet, poolIndex, swapAToB, inputAmount, slippageBps } = req.body;

    if (!isValidSolanaAddress(proposalPda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    if (!wallet || !isValidSolanaAddress(wallet)) {
      return res.status(400).json({ error: 'Invalid or missing wallet' });
    }

    if (poolIndex === undefined || swapAToB === undefined || !inputAmount) {
      return res.status(400).json({
        error: 'Missing required fields: poolIndex, swapAToB, inputAmount',
      });
    }

    const poolIndexNum = parseInt(poolIndex);
    const slippageBpsNum = slippageBps ? parseInt(slippageBps) : 200; // Default 2%
    const inputAmountBN = new BN(inputAmount.toString());
    const userPublicKey = new PublicKey(wallet);

    const connection = getConnection();
    const client = createReadOnlyClient(connection);

    // Fetch proposal to get pool address
    const proposalPubkey = new PublicKey(proposalPda);
    let proposal;
    try {
      proposal = await client.fetchProposal(proposalPubkey);
    } catch (err) {
      return res.status(404).json({
        error: 'Proposal not found on-chain',
        details: String(err),
      });
    }

    // Check proposal is in pending state
    const { state } = futarchy.parseProposalState(proposal.state);
    if (state !== 'pending') {
      return res.status(400).json({
        error: 'Proposal is not active',
        state,
        message: 'Trading is only available when proposal is in pending state',
      });
    }

    if (poolIndexNum >= proposal.numOptions) {
      return res.status(400).json({
        error: `Invalid pool index: ${poolIndexNum}. Proposal has ${proposal.numOptions} options.`,
      });
    }

    const poolPda = proposal.pools[poolIndexNum];
    if (poolPda.equals(PublicKey.default)) {
      return res.status(400).json({ error: `Pool ${poolIndexNum} is not initialized` });
    }

    // Convert basis points to percent for SDK
    const slippagePercent = slippageBpsNum / 100;

    // Build swap transaction using SDK
    const { builder, quote } = await client.amm.swapWithSlippage(
      userPublicKey,
      poolPda,
      swapAToB,
      inputAmountBN,
      slippagePercent,
      { autoCreateTokenAccounts: true }
    );

    // Build transaction
    const tx = await builder.transaction();
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = userPublicKey;

    // Compute hash for integrity verification
    const hash = computeTransactionHash(tx);

    // Store request data
    const requestId = tradingStorage.generateRequestId();
    tradingStorage.set(requestId, {
      hash,
      proposalPda,
      poolAddress: poolPda.toBase58(),
      wallet,
      operation: 'swap',
    });

    // Serialize transaction (without signatures)
    const serializedTx = tx.serialize({ requireAllSignatures: false });

    res.json({
      requestId,
      transaction: bs58.encode(serializedTx),
      expiresAt: Date.now() + REQUEST_EXPIRY.BUILD,
      quote: {
        inputAmount: quote.inputAmount.toString(),
        outputAmount: quote.outputAmount.toString(),
        minOutputAmount: quote.minOutputAmount.toString(),
        priceImpact: quote.priceImpact,
      },
    });
  } catch (error) {
    console.error('Error building swap transaction:', error);
    res.status(500).json({ error: 'Failed to build swap transaction', details: String(error) });
  }
});

// ============================================================================
// POST /dao/proposal/:proposalPda/swap/execute
// Execute a signed swap transaction
// ============================================================================

router.post('/:proposalPda/swap/execute', async (req: Request, res: Response) => {
  try {
    const { proposalPda } = req.params;
    const { requestId, signedTransaction } = req.body;

    if (!isValidSolanaAddress(proposalPda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    if (!requestId || !signedTransaction) {
      return res.status(400).json({ error: 'Missing required fields: requestId, signedTransaction' });
    }

    // Retrieve stored request
    const storedData = tradingStorage.get(requestId);
    if (!storedData) {
      return res.status(400).json({ error: 'Request not found or expired' });
    }

    if (tradingStorage.isExpired(requestId, REQUEST_EXPIRY.CONFIRM)) {
      tradingStorage.delete(requestId);
      return res.status(400).json({ error: 'Request has expired' });
    }

    if (storedData.operation !== 'swap') {
      return res.status(400).json({ error: 'Invalid request type' });
    }

    if (storedData.proposalPda !== proposalPda) {
      return res.status(400).json({ error: 'Proposal PDA mismatch' });
    }

    const connection = getConnection();
    const userPublicKey = new PublicKey(storedData.wallet);

    // Deserialize and verify transaction
    let transaction: Transaction;
    try {
      transaction = deserializeTransaction(signedTransaction);
    } catch (err) {
      return res.status(400).json({ error: 'Failed to deserialize transaction' });
    }

    // Verify fee payer
    const feePayerResult = verifyFeePayer(transaction, userPublicKey);
    if (!feePayerResult.success) {
      return res.status(400).json({ error: feePayerResult.error });
    }

    // Verify user signature
    const signatureResult = verifyWalletSignature(transaction, userPublicKey, 'User wallet');
    if (!signatureResult.success) {
      return res.status(400).json({ error: signatureResult.error });
    }

    // Verify transaction integrity
    const integrityResult = verifyTransactionIntegrity(transaction, storedData.hash);
    if (!integrityResult.success) {
      return res.status(400).json({ error: integrityResult.error });
    }

    // Verify blockhash
    const blockhashResult = await verifyBlockhash(connection, transaction);
    if (!blockhashResult.success) {
      return res.status(400).json({ error: blockhashResult.error });
    }

    // Send transaction
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // Wait for confirmation
    await connection.confirmTransaction(signature, 'confirmed');

    // Clean up
    tradingStorage.delete(requestId);

    console.log(`Swap executed for proposal ${proposalPda}: ${signature}`);

    res.json({
      success: true,
      signature,
      proposalPda,
      poolPda: storedData.poolAddress,
    });
  } catch (error) {
    console.error('Error executing swap:', error);
    res.status(500).json({ error: 'Failed to execute swap', details: String(error) });
  }
});

// ============================================================================
// POST /dao/proposal/:proposalPda/deposit/build
// Build a deposit (split) transaction
// ============================================================================

router.post('/:proposalPda/deposit/build', async (req: Request, res: Response) => {
  try {
    const { proposalPda } = req.params;
    const { wallet, vaultType, amount } = req.body;

    if (!isValidSolanaAddress(proposalPda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    if (!wallet || !isValidSolanaAddress(wallet)) {
      return res.status(400).json({ error: 'Invalid or missing wallet' });
    }

    if (!vaultType || !['base', 'quote'].includes(vaultType)) {
      return res.status(400).json({ error: 'Invalid vaultType. Must be "base" or "quote"' });
    }

    if (!amount) {
      return res.status(400).json({ error: 'Missing required field: amount' });
    }

    const amountBN = new BN(amount.toString());
    const userPublicKey = new PublicKey(wallet);
    const vt = getVaultType(vaultType);

    const connection = getConnection();
    const client = createReadOnlyClient(connection);

    // Fetch proposal
    const proposalPubkey = new PublicKey(proposalPda);
    let proposal;
    try {
      proposal = await client.fetchProposal(proposalPubkey);
    } catch (err) {
      return res.status(404).json({
        error: 'Proposal not found on-chain',
        details: String(err),
      });
    }

    // Check proposal is in pending state
    const { state } = futarchy.parseProposalState(proposal.state);
    if (state !== 'pending') {
      return res.status(400).json({
        error: 'Proposal is not active',
        state,
        message: 'Deposits are only available when proposal is in pending state',
      });
    }

    const vaultPda = proposal.vault;
    const numOptions = proposal.numOptions;

    // Build pre-instructions for ATAs if needed
    const preInstructions: any[] = [];
    for (let i = 0; i < numOptions; i++) {
      const [condMint] = client.vault.deriveConditionalMint(vaultPda, vt, i);
      const programId = await getTokenProgramForMint(connection, condMint);
      const ata = await getAssociatedTokenAddress(condMint, userPublicKey, false, programId);

      try {
        await getAccount(connection, ata, 'confirmed', programId);
      } catch {
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            userPublicKey,
            ata,
            userPublicKey,
            condMint,
            programId,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }
    }

    // Build deposit (split) transaction
    const builder = await client.vault.deposit(userPublicKey, vaultPda, vt, amountBN);
    if (preInstructions.length > 0) {
      builder.preInstructions(preInstructions);
    }

    const tx = await builder.transaction();
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = userPublicKey;

    // Compute hash for integrity verification
    const hash = computeTransactionHash(tx);

    // Store request data
    const requestId = tradingStorage.generateRequestId();
    tradingStorage.set(requestId, {
      hash,
      proposalPda,
      poolAddress: vaultPda.toBase58(),
      wallet,
      operation: 'deposit',
      vaultType,
    });

    const serializedTx = tx.serialize({ requireAllSignatures: false });

    res.json({
      requestId,
      transaction: bs58.encode(serializedTx),
      expiresAt: Date.now() + REQUEST_EXPIRY.BUILD,
      vaultPda: vaultPda.toBase58(),
      vaultType,
      amount: amountBN.toString(),
    });
  } catch (error) {
    console.error('Error building deposit transaction:', error);
    res.status(500).json({ error: 'Failed to build deposit transaction', details: String(error) });
  }
});

// ============================================================================
// POST /dao/proposal/:proposalPda/deposit/execute
// Execute a signed deposit (split) transaction
// ============================================================================

router.post('/:proposalPda/deposit/execute', async (req: Request, res: Response) => {
  try {
    const { proposalPda } = req.params;
    const { requestId, signedTransaction } = req.body;

    if (!isValidSolanaAddress(proposalPda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    if (!requestId || !signedTransaction) {
      return res.status(400).json({ error: 'Missing required fields: requestId, signedTransaction' });
    }

    const storedData = tradingStorage.get(requestId);
    if (!storedData) {
      return res.status(400).json({ error: 'Request not found or expired' });
    }

    if (tradingStorage.isExpired(requestId, REQUEST_EXPIRY.CONFIRM)) {
      tradingStorage.delete(requestId);
      return res.status(400).json({ error: 'Request has expired' });
    }

    if (storedData.operation !== 'deposit') {
      return res.status(400).json({ error: 'Invalid request type' });
    }

    if (storedData.proposalPda !== proposalPda) {
      return res.status(400).json({ error: 'Proposal PDA mismatch' });
    }

    const connection = getConnection();
    const userPublicKey = new PublicKey(storedData.wallet);

    let transaction: Transaction;
    try {
      transaction = deserializeTransaction(signedTransaction);
    } catch (err) {
      return res.status(400).json({ error: 'Failed to deserialize transaction' });
    }

    const feePayerResult = verifyFeePayer(transaction, userPublicKey);
    if (!feePayerResult.success) {
      return res.status(400).json({ error: feePayerResult.error });
    }

    const signatureResult = verifyWalletSignature(transaction, userPublicKey, 'User wallet');
    if (!signatureResult.success) {
      return res.status(400).json({ error: signatureResult.error });
    }

    const integrityResult = verifyTransactionIntegrity(transaction, storedData.hash);
    if (!integrityResult.success) {
      return res.status(400).json({ error: integrityResult.error });
    }

    const blockhashResult = await verifyBlockhash(connection, transaction);
    if (!blockhashResult.success) {
      return res.status(400).json({ error: blockhashResult.error });
    }

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction(signature, 'confirmed');
    tradingStorage.delete(requestId);

    console.log(`Deposit executed for proposal ${proposalPda}: ${signature}`);

    res.json({
      success: true,
      signature,
      proposalPda,
      vaultPda: storedData.poolAddress,
      vaultType: storedData.vaultType,
    });
  } catch (error) {
    console.error('Error executing deposit:', error);
    res.status(500).json({ error: 'Failed to execute deposit', details: String(error) });
  }
});

// ============================================================================
// POST /dao/proposal/:proposalPda/withdraw/build
// Build a withdraw (merge) transaction
// ============================================================================

router.post('/:proposalPda/withdraw/build', async (req: Request, res: Response) => {
  try {
    const { proposalPda } = req.params;
    const { wallet, vaultType, amount } = req.body;

    if (!isValidSolanaAddress(proposalPda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    if (!wallet || !isValidSolanaAddress(wallet)) {
      return res.status(400).json({ error: 'Invalid or missing wallet' });
    }

    if (!vaultType || !['base', 'quote'].includes(vaultType)) {
      return res.status(400).json({ error: 'Invalid vaultType. Must be "base" or "quote"' });
    }

    if (!amount) {
      return res.status(400).json({ error: 'Missing required field: amount' });
    }

    const amountBN = new BN(amount.toString());
    const userPublicKey = new PublicKey(wallet);
    const vt = getVaultType(vaultType);

    const connection = getConnection();
    const client = createReadOnlyClient(connection);

    const proposalPubkey = new PublicKey(proposalPda);
    let proposal;
    try {
      proposal = await client.fetchProposal(proposalPubkey);
    } catch (err) {
      return res.status(404).json({
        error: 'Proposal not found on-chain',
        details: String(err),
      });
    }

    const { state } = futarchy.parseProposalState(proposal.state);
    if (state !== 'pending') {
      return res.status(400).json({
        error: 'Proposal is not active',
        state,
        message: 'Withdrawals are only available when proposal is in pending state',
      });
    }

    const vaultPda = proposal.vault;

    // Build pre-instruction for underlying mint ATA if needed
    const preInstructions: any[] = [];
    const vault = await client.vault.fetchVault(vaultPda);
    const mintInfo = vt === VaultType.Base ? vault.baseMint : vault.quoteMint;
    const underlyingMint = 'address' in mintInfo ? mintInfo.address : (mintInfo as PublicKey);
    const programId = await getTokenProgramForMint(connection, underlyingMint);
    const ata = await getAssociatedTokenAddress(underlyingMint, userPublicKey, false, programId);

    try {
      await getAccount(connection, ata, 'confirmed', programId);
    } catch {
      preInstructions.push(
        createAssociatedTokenAccountInstruction(
          userPublicKey,
          ata,
          userPublicKey,
          underlyingMint,
          programId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    const builder = await client.vault.withdraw(userPublicKey, vaultPda, vt, amountBN);
    if (preInstructions.length > 0) {
      builder.preInstructions(preInstructions);
    }

    const tx = await builder.transaction();
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = userPublicKey;

    const hash = computeTransactionHash(tx);

    const requestId = tradingStorage.generateRequestId();
    tradingStorage.set(requestId, {
      hash,
      proposalPda,
      poolAddress: vaultPda.toBase58(),
      wallet,
      operation: 'withdraw',
      vaultType,
    });

    const serializedTx = tx.serialize({ requireAllSignatures: false });

    res.json({
      requestId,
      transaction: bs58.encode(serializedTx),
      expiresAt: Date.now() + REQUEST_EXPIRY.BUILD,
      vaultPda: vaultPda.toBase58(),
      vaultType,
      amount: amountBN.toString(),
    });
  } catch (error) {
    console.error('Error building withdraw transaction:', error);
    res.status(500).json({ error: 'Failed to build withdraw transaction', details: String(error) });
  }
});

// ============================================================================
// POST /dao/proposal/:proposalPda/withdraw/execute
// Execute a signed withdraw (merge) transaction
// ============================================================================

router.post('/:proposalPda/withdraw/execute', async (req: Request, res: Response) => {
  try {
    const { proposalPda } = req.params;
    const { requestId, signedTransaction } = req.body;

    if (!isValidSolanaAddress(proposalPda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    if (!requestId || !signedTransaction) {
      return res.status(400).json({ error: 'Missing required fields: requestId, signedTransaction' });
    }

    const storedData = tradingStorage.get(requestId);
    if (!storedData) {
      return res.status(400).json({ error: 'Request not found or expired' });
    }

    if (tradingStorage.isExpired(requestId, REQUEST_EXPIRY.CONFIRM)) {
      tradingStorage.delete(requestId);
      return res.status(400).json({ error: 'Request has expired' });
    }

    if (storedData.operation !== 'withdraw') {
      return res.status(400).json({ error: 'Invalid request type' });
    }

    if (storedData.proposalPda !== proposalPda) {
      return res.status(400).json({ error: 'Proposal PDA mismatch' });
    }

    const connection = getConnection();
    const userPublicKey = new PublicKey(storedData.wallet);

    let transaction: Transaction;
    try {
      transaction = deserializeTransaction(signedTransaction);
    } catch (err) {
      return res.status(400).json({ error: 'Failed to deserialize transaction' });
    }

    const feePayerResult = verifyFeePayer(transaction, userPublicKey);
    if (!feePayerResult.success) {
      return res.status(400).json({ error: feePayerResult.error });
    }

    const signatureResult = verifyWalletSignature(transaction, userPublicKey, 'User wallet');
    if (!signatureResult.success) {
      return res.status(400).json({ error: signatureResult.error });
    }

    const integrityResult = verifyTransactionIntegrity(transaction, storedData.hash);
    if (!integrityResult.success) {
      return res.status(400).json({ error: integrityResult.error });
    }

    const blockhashResult = await verifyBlockhash(connection, transaction);
    if (!blockhashResult.success) {
      return res.status(400).json({ error: blockhashResult.error });
    }

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction(signature, 'confirmed');
    tradingStorage.delete(requestId);

    console.log(`Withdraw executed for proposal ${proposalPda}: ${signature}`);

    res.json({
      success: true,
      signature,
      proposalPda,
      vaultPda: storedData.poolAddress,
      vaultType: storedData.vaultType,
    });
  } catch (error) {
    console.error('Error executing withdraw:', error);
    res.status(500).json({ error: 'Failed to execute withdraw', details: String(error) });
  }
});

// ============================================================================
// POST /dao/proposal/:proposalPda/redeem/build
// Build a redeem transaction (for resolved proposals)
// ============================================================================

router.post('/:proposalPda/redeem/build', async (req: Request, res: Response) => {
  try {
    const { proposalPda } = req.params;
    const { wallet, vaultType } = req.body;

    if (!isValidSolanaAddress(proposalPda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    if (!wallet || !isValidSolanaAddress(wallet)) {
      return res.status(400).json({ error: 'Invalid or missing wallet' });
    }

    if (!vaultType || !['base', 'quote'].includes(vaultType)) {
      return res.status(400).json({ error: 'Invalid vaultType. Must be "base" or "quote"' });
    }

    const userPublicKey = new PublicKey(wallet);
    const vt = getVaultType(vaultType);

    const connection = getConnection();
    const client = createReadOnlyClient(connection);

    const proposalPubkey = new PublicKey(proposalPda);
    let proposal;
    try {
      proposal = await client.fetchProposal(proposalPubkey);
    } catch (err) {
      return res.status(404).json({
        error: 'Proposal not found on-chain',
        details: String(err),
      });
    }

    const { state, winningIdx } = futarchy.parseProposalState(proposal.state);
    if (state !== 'resolved') {
      return res.status(400).json({
        error: 'Proposal is not resolved',
        state,
        message: 'Redemptions are only available after proposal is resolved',
      });
    }

    const vaultPda = proposal.vault;

    // Build pre-instruction for underlying mint ATA if needed
    const preInstructions: any[] = [];
    const vault = await client.vault.fetchVault(vaultPda);
    const mintInfo = vt === VaultType.Base ? vault.baseMint : vault.quoteMint;
    const underlyingMint = 'address' in mintInfo ? mintInfo.address : (mintInfo as PublicKey);
    const programId = await getTokenProgramForMint(connection, underlyingMint);
    const ata = await getAssociatedTokenAddress(underlyingMint, userPublicKey, false, programId);

    try {
      await getAccount(connection, ata, 'confirmed', programId);
    } catch {
      preInstructions.push(
        createAssociatedTokenAccountInstruction(
          userPublicKey,
          ata,
          userPublicKey,
          underlyingMint,
          programId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    const builder = await client.vault.redeemWinnings(userPublicKey, vaultPda, vt);
    if (preInstructions.length > 0) {
      builder.preInstructions(preInstructions);
    }

    const tx = await builder.transaction();
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = userPublicKey;

    const hash = computeTransactionHash(tx);

    const requestId = tradingStorage.generateRequestId();
    tradingStorage.set(requestId, {
      hash,
      proposalPda,
      poolAddress: vaultPda.toBase58(),
      wallet,
      operation: 'redeem',
      vaultType,
    });

    const serializedTx = tx.serialize({ requireAllSignatures: false });

    res.json({
      requestId,
      transaction: bs58.encode(serializedTx),
      expiresAt: Date.now() + REQUEST_EXPIRY.BUILD,
      vaultPda: vaultPda.toBase58(),
      vaultType,
      winningIndex: winningIdx,
    });
  } catch (error) {
    console.error('Error building redeem transaction:', error);
    res.status(500).json({ error: 'Failed to build redeem transaction', details: String(error) });
  }
});

// ============================================================================
// POST /dao/proposal/:proposalPda/redeem/execute
// Execute a signed redeem transaction
// ============================================================================

router.post('/:proposalPda/redeem/execute', async (req: Request, res: Response) => {
  try {
    const { proposalPda } = req.params;
    const { requestId, signedTransaction } = req.body;

    if (!isValidSolanaAddress(proposalPda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    if (!requestId || !signedTransaction) {
      return res.status(400).json({ error: 'Missing required fields: requestId, signedTransaction' });
    }

    const storedData = tradingStorage.get(requestId);
    if (!storedData) {
      return res.status(400).json({ error: 'Request not found or expired' });
    }

    if (tradingStorage.isExpired(requestId, REQUEST_EXPIRY.CONFIRM)) {
      tradingStorage.delete(requestId);
      return res.status(400).json({ error: 'Request has expired' });
    }

    if (storedData.operation !== 'redeem') {
      return res.status(400).json({ error: 'Invalid request type' });
    }

    if (storedData.proposalPda !== proposalPda) {
      return res.status(400).json({ error: 'Proposal PDA mismatch' });
    }

    const connection = getConnection();
    const userPublicKey = new PublicKey(storedData.wallet);

    let transaction: Transaction;
    try {
      transaction = deserializeTransaction(signedTransaction);
    } catch (err) {
      return res.status(400).json({ error: 'Failed to deserialize transaction' });
    }

    const feePayerResult = verifyFeePayer(transaction, userPublicKey);
    if (!feePayerResult.success) {
      return res.status(400).json({ error: feePayerResult.error });
    }

    const signatureResult = verifyWalletSignature(transaction, userPublicKey, 'User wallet');
    if (!signatureResult.success) {
      return res.status(400).json({ error: signatureResult.error });
    }

    const integrityResult = verifyTransactionIntegrity(transaction, storedData.hash);
    if (!integrityResult.success) {
      return res.status(400).json({ error: integrityResult.error });
    }

    const blockhashResult = await verifyBlockhash(connection, transaction);
    if (!blockhashResult.success) {
      return res.status(400).json({ error: blockhashResult.error });
    }

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction(signature, 'confirmed');
    tradingStorage.delete(requestId);

    console.log(`Redeem executed for proposal ${proposalPda}: ${signature}`);

    res.json({
      success: true,
      signature,
      proposalPda,
      vaultPda: storedData.poolAddress,
      vaultType: storedData.vaultType,
    });
  } catch (error) {
    console.error('Error executing redeem:', error);
    res.status(500).json({ error: 'Failed to execute redeem', details: String(error) });
  }
});

// ============================================================================
// GET /dao/proposal/:proposalPda/balances/:wallet
// Get user balances for both base and quote vaults
// ============================================================================

router.get('/:proposalPda/balances/:wallet', async (req: Request, res: Response) => {
  try {
    const { proposalPda, wallet } = req.params;

    if (!isValidSolanaAddress(proposalPda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    if (!isValidSolanaAddress(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const userPublicKey = new PublicKey(wallet);
    const connection = getConnection();
    const client = createReadOnlyClient(connection);

    const proposalPubkey = new PublicKey(proposalPda);
    let proposal;
    try {
      proposal = await client.fetchProposal(proposalPubkey);
    } catch (err) {
      return res.status(404).json({
        error: 'Proposal not found on-chain',
        details: String(err),
      });
    }

    const vaultPda = proposal.vault;

    const [baseBalances, quoteBalances] = await Promise.all([
      client.vault.fetchUserBalances(vaultPda, userPublicKey, VaultType.Base),
      client.vault.fetchUserBalances(vaultPda, userPublicKey, VaultType.Quote),
    ]);

    res.json({
      proposalPda,
      wallet,
      vaultPda: vaultPda.toBase58(),
      base: {
        regular: baseBalances.userBalance.toString(),
        conditionalBalances: baseBalances.condBalances.map((b: BN) => b.toString()),
      },
      quote: {
        regular: quoteBalances.userBalance.toString(),
        conditionalBalances: quoteBalances.condBalances.map((b: BN) => b.toString()),
      },
    });
  } catch (error) {
    console.error('Error fetching user balances:', error);
    res.status(500).json({ error: 'Failed to fetch user balances', details: String(error) });
  }
});

export default router;
