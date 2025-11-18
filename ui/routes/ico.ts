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
import { Connection, PublicKey, Transaction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import * as nacl from 'tweetnacl';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  createNewIcoSale,
  preparePurchaseTransaction,
  processPurchase,
  getUserPurchases,
  getUserClaimInfo,
  prepareClaimTransaction,
  processClaim,
} from '../lib/icoService';
import {
  getIcoSaleByTokenAddress,
  isPurchaseSignatureProcessed,
  getIcoClaimByWallet,
  getPool,
} from '../lib/db';
import {
  isValidSolanaAddress,
  isValidTokenAddress,
  isValidTransactionSignature,
  isValidLamportsAmount,
} from '../lib/validation';
import {
  acquireIcoPurchaseLock,
  acquireIcoClaimLock,
  startIcoTransactionCleanup,
} from '../lib/icoTransactionService';

/**
 * ICO Routes
 *
 * Express router for ICO-related endpoints including:
 * - ICO sale information
 * - Purchase transactions (prepare, confirm, history)
 * - Claim transactions (prepare, confirm, info)
 * - Launch transactions (prepare, confirm) - DEPRECATED
 *
 * TOKEN DISTRIBUTION FLOW:
 * -------------------------
 * When a user purchases tokens during an ICO:
 * 1. /prepare endpoint: Server creates unsigned transaction with 2 instructions:
 *    - Instruction 1: Transfer SOL from user to escrow
 *    - Instruction 2: Transfer 50% of tokens from escrow to vault
 * 2. User signs: User signs transaction on frontend
 * 3. /confirm endpoint: User sends signed transaction to server
 * 4. Server validation: Server validates all transaction instructions
 * 5. Server signing: Server adds escrow signature (for token transfer)
 * 6. Submission: Server submits fully-signed transaction to blockchain
 * 7. Database recording: Server records purchase in database
 *
 * Result: Atomic transaction ensures both SOL payment and vault token transfer
 * happen together (or both fail). Remaining 50% stays in escrow for user to claim.
 *
 * ICO SALE MODES:
 * ----------------
 * The ICO has two distinct modes that never overlap:
 * - ACTIVE MODE: Users can purchase, claiming is blocked
 * - FINALIZED MODE: Users can claim, purchasing is blocked
 *
 * OVERSELLING PROTECTION (ACTIVE MODE ONLY):
 * ------------------------------------------
 * Overselling protection only applies during ACTIVE MODE when purchases occur.
 * The /purchase/confirm endpoint validates:
 * 1. Status check: Verify sale status is 'active' (not 'finalized')
 * 2. Database check: Ensure tokens_sold + this_purchase <= total_tokens_for_sale
 * 3. Transaction validation: Verify transaction instructions are correct
 * 4. Transaction lock: Use per-token mutex to prevent race conditions
 *
 * NOTE: We do NOT use vault balance to calculate tokens sold because:
 * - Vault may have initial balance from other sources
 * - Users can stake/unstake during ICO, changing vault balance unpredictably
 * - This would make vault_balance * 2 = tokens_sold completely unreliable
 *
 * Database tracking (tokens_sold aggregated from purchases) is the source of truth.
 *
 * CLAIMING (FINALIZED MODE ONLY):
 * --------------------------------
 * During FINALIZED MODE, users claim their 50% that stayed in escrow.
 * No overselling protection is needed - users are claiming tokens already purchased.
 */

const router = Router();

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

// ICO rate limiter
const icoLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  keyGenerator: (req) => {
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string') return ipKeyGenerator(cfIp);
    if (Array.isArray(cfIp)) return ipKeyGenerator(cfIp[0]);
    return ipKeyGenerator(req.ip || 'unknown');
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many ICO requests, please wait a moment.'
});

// Apply rate limiter to all ICO routes
router.use(icoLimiter);

// Start transaction cleanup
startIcoTransactionCleanup();

/**
 * POST /ico/create
 * Create a new ICO sale
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const {
      tokenAddress,
      creatorWallet,
      tokenMetadataUrl,
      totalTokensForSale,
      tokenPriceSol,
      vaultTokenAccount,
      treasuryWallet,
      treasurySolAmount,
    } = req.body;

    // Validate required fields
    if (!tokenAddress || !creatorWallet || !tokenMetadataUrl || !totalTokensForSale ||
        !tokenPriceSol || !vaultTokenAccount || !treasuryWallet ||
        treasurySolAmount === undefined) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    // Validate Solana addresses
    if (!isValidTokenAddress(tokenAddress)) {
      return res.status(400).json({
        error: 'Invalid token address format'
      });
    }

    if (!isValidSolanaAddress(creatorWallet)) {
      return res.status(400).json({
        error: 'Invalid creator wallet address format'
      });
    }

    if (!isValidTokenAddress(vaultTokenAccount)) {
      return res.status(400).json({
        error: 'Invalid vault token account address format'
      });
    }

    if (!isValidSolanaAddress(treasuryWallet)) {
      return res.status(400).json({
        error: 'Invalid treasury wallet address format'
      });
    }

    // Validate amounts
    if (!isValidLamportsAmount(treasurySolAmount)) {
      return res.status(400).json({
        error: 'Invalid treasury SOL amount'
      });
    }

    // Validate token metadata URL
    try {
      new URL(tokenMetadataUrl);
    } catch {
      return res.status(400).json({
        error: 'Invalid token metadata URL format'
      });
    }

    // Validate token price format (must be a positive decimal number)
    if (typeof tokenPriceSol !== 'string' || !/^\d+\.?\d*$/.test(tokenPriceSol)) {
      return res.status(400).json({
        error: 'Invalid token price format (must be a decimal string)'
      });
    }

    const tokenPriceFloat = parseFloat(tokenPriceSol);
    if (tokenPriceFloat <= 0) {
      return res.status(400).json({
        error: 'Token price must be greater than 0'
      });
    }

    // Validate total tokens for sale is a valid positive BigInt
    try {
      const totalTokensBigInt = BigInt(totalTokensForSale);
      if (totalTokensBigInt <= BigInt(0)) {
        return res.status(400).json({
          error: 'Total tokens for sale must be greater than 0'
        });
      }
    } catch {
      return res.status(400).json({
        error: 'Invalid total tokens for sale format'
      });
    }

    const icoSale = await createNewIcoSale({
      tokenAddress,
      creatorWallet,
      tokenMetadataUrl,
      totalTokensForSale: BigInt(totalTokensForSale),
      tokenPriceSol,
      vaultTokenAccount,
      treasuryWallet,
      treasurySolAmount: BigInt(treasurySolAmount),
    });

    // Convert BigInts to strings for JSON serialization
    const responseData = {
      ...icoSale,
      total_tokens_for_sale: icoSale.total_tokens_for_sale.toString(),
      tokens_sold: "0",
      total_sol_raised: "0",
      treasury_sol_amount: icoSale.treasury_sol_amount.toString(),
    };

    // Remove sensitive data
    const { escrow_priv_key, ...safeData } = responseData;

    return res.json({
      success: true,
      icoSale: safeData,
    });
  } catch (error: any) {
    console.error('Error creating ICO sale:', error);
    return res.status(500).json({
      error: error.message || 'Failed to create ICO sale'
    });
  }
});

/**
 * GET /ico/:tokenAddress
 * Get ICO sale information
 */
router.get('/:tokenAddress', async (req: Request, res: Response) => {
  try {
    const { tokenAddress } = req.params;

    if (!tokenAddress) {
      return res.status(400).json({
        error: 'Token address is required'
      });
    }

    const icoSale = await getIcoSaleByTokenAddress(tokenAddress);

    if (!icoSale) {
      return res.status(404).json({
        error: 'ICO sale not found'
      });
    }

    // Remove sensitive data before returning
    const { escrow_priv_key, ...safeIcoSale } = icoSale;

    // Convert BigInts to strings for JSON serialization
    const responseData = {
      ...safeIcoSale,
      total_tokens_for_sale: safeIcoSale.total_tokens_for_sale.toString(),
      tokens_sold: safeIcoSale.tokens_sold.toString(),
      total_sol_raised: safeIcoSale.total_sol_raised.toString(),
      treasury_sol_amount: safeIcoSale.treasury_sol_amount.toString(),
    };

    return res.json(responseData);
  } catch (error) {
    console.error('Error fetching ICO sale:', error);
    return res.status(500).json({
      error: 'Failed to fetch ICO sale'
    });
  }
});

/**
 * GET /ico/:tokenAddress/purchase?wallet=<address>
 * Get user's purchase history
 */
router.get('/:tokenAddress/purchase', async (req: Request, res: Response) => {
  try {
    const { tokenAddress } = req.params;
    const { wallet } = req.query;

    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({
        error: 'Wallet address is required'
      });
    }

    // Validate addresses
    if (!isValidTokenAddress(tokenAddress)) {
      return res.status(400).json({
        error: 'Invalid token address format'
      });
    }

    if (!isValidSolanaAddress(wallet)) {
      return res.status(400).json({
        error: 'Invalid wallet address format'
      });
    }

    const purchases = await getUserPurchases(tokenAddress, wallet);

    // Convert BigInts to strings
    const responsePurchases = purchases.map((p) => ({
      ...p,
      sol_amount_lamports: p.sol_amount_lamports.toString(),
      tokens_bought: p.tokens_bought.toString(),
      tokens_to_vault: (p.tokens_to_vault || BigInt(0)).toString(),
      tokens_claimable: (p.tokens_claimable || BigInt(0)).toString(),
    }));

    return res.json({ purchases: responsePurchases });
  } catch (error) {
    console.error('Error fetching purchases:', error);
    return res.status(500).json({
      error: 'Failed to fetch purchases'
    });
  }
});

/**
 * POST /ico/:tokenAddress/purchase/prepare
 * Prepare unsigned purchase transaction
 */
router.post('/:tokenAddress/purchase/prepare', async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { tokenAddress } = req.params;
    const { wallet, solAmount } = req.body;

    if (!wallet || !solAmount) {
      return res.status(400).json({
        error: 'Wallet and solAmount are required'
      });
    }

    // Validate addresses
    if (!isValidTokenAddress(tokenAddress)) {
      return res.status(400).json({
        error: 'Invalid token address format'
      });
    }

    if (!isValidSolanaAddress(wallet)) {
      return res.status(400).json({
        error: 'Invalid wallet address format'
      });
    }

    // Validate amount
    if (!isValidLamportsAmount(solAmount)) {
      return res.status(400).json({
        error: 'Invalid SOL amount'
      });
    }

    // Acquire lock for this token to prevent overselling (CRITICAL)
    releaseLock = await acquireIcoPurchaseLock(tokenAddress);

    const solAmountLamports = BigInt(solAmount);

    const result = await preparePurchaseTransaction({
      tokenAddress,
      buyerWallet: wallet,
      solAmountLamports,
    });

    // SECURITY: Set recent blockhash to prevent replay attacks
    const connection = new Connection(RPC_URL, 'confirmed');
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    result.transaction.recentBlockhash = blockhash;
    result.transaction.feePayer = new PublicKey(wallet);

    // Serialize transaction
    const serializedTx = result.transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return res.json({
      transaction: Buffer.from(serializedTx).toString('base64'),
      icoSaleId: result.icoSaleId,
      tokensBought: result.tokensBought.toString(),
      tokensToVault: result.tokensToVault.toString(),
      tokensClaimable: result.tokensClaimable.toString(),
      escrowPubKey: result.escrowPubKey,
      actualSolAmount: result.actualSolAmount.toString(), // Actual SOL required (may be less than requested)
    });
  } catch (error: any) {
    console.error('Error preparing purchase:', error);
    return res.status(500).json({
      error: error.message || 'Failed to prepare purchase'
    });
  } finally {
    // Release lock when done (success or failure)
    if (releaseLock) {
      releaseLock();
    }
  }
});

/**
 * POST /ico/:tokenAddress/purchase/confirm
 * Confirm and process a purchase after user signs the transaction
 *
 * FLOW:
 * 1. User calls /prepare to get unsigned transaction
 * 2. User signs transaction on frontend
 * 3. User sends signed transaction to this endpoint (NOT to blockchain)
 * 4. Server validates, adds escrow signature, and submits to blockchain
 * 5. Server records purchase in database
 * 6. Returns transaction signature
 */
router.post('/:tokenAddress/purchase/confirm', async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { tokenAddress } = req.params;
    const {
      icoSaleId,
      wallet,
      solAmount,
      tokensBought,
      tokensToVault,
      tokensClaimable,
      signedTransaction, // User-signed transaction (base64)
    } = req.body;

    if (!icoSaleId || !wallet || !solAmount || !tokensBought || !tokensToVault || !tokensClaimable || !signedTransaction) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    // Validate addresses
    if (!isValidTokenAddress(tokenAddress)) {
      return res.status(400).json({
        error: 'Invalid token address format'
      });
    }

    if (!isValidSolanaAddress(wallet)) {
      return res.status(400).json({
        error: 'Invalid wallet address format'
      });
    }

    // Validate amounts
    if (!isValidLamportsAmount(solAmount)) {
      return res.status(400).json({
        error: 'Invalid SOL amount'
      });
    }

    // Deserialize the user-signed transaction
    let transaction: Transaction;
    try {
      const txBuffer = Buffer.from(signedTransaction, 'base64');
      transaction = Transaction.from(txBuffer);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid transaction format'
      });
    }

    // Acquire lock to prevent race conditions (CRITICAL for preventing duplicate processing)
    releaseLock = await acquireIcoPurchaseLock(tokenAddress);

    // Get ICO sale to verify escrow address
    const icoSale = await getIcoSaleByTokenAddress(tokenAddress);
    if (!icoSale || !icoSale.escrow_pub_key) {
      return res.status(404).json({
        error: 'ICO sale not found or not properly configured'
      });
    }

    // CRITICAL: Verify sale is active (not finalized)
    if (icoSale.status !== 'active') {
      return res.status(400).json({
        error: 'ICO sale is not active. Purchasing is only allowed during active sales.',
        errorCode: 'SALE_NOT_ACTIVE',
        currentStatus: icoSale.status
      });
    }

    // SECURITY: Validate the user-signed transaction before adding escrow signature
    const connection = new Connection(RPC_URL, 'confirmed');
    const buyerPubKey = new PublicKey(wallet);
    const escrowPubKey = new PublicKey(icoSale.escrow_pub_key);

    // CRITICAL SECURITY: Verify the user signed the transaction
    const userSignature = transaction.signatures.find(sig =>
      sig.publicKey.equals(buyerPubKey)
    );

    if (!userSignature || !userSignature.signature) {
      return res.status(400).json({
        error: 'Transaction not signed by user wallet'
      });
    }

    // CRITICAL SECURITY: Comprehensive transaction validation
    // We must verify the transaction structure BEFORE adding escrow signature

    // 1. Verify the transaction structure matches what we expect
    // Should have exactly 2 instructions: SOL transfer + token transfer
    const instructions = transaction.instructions;
    if (instructions.length !== 2) {
      return res.status(400).json({
        error: `Invalid transaction: expected 2 instructions, got ${instructions.length}`
      });
    }

    // 2. Verify fee payer is the buyer
    if (!transaction.feePayer || !transaction.feePayer.equals(buyerPubKey)) {
      return res.status(400).json({
        error: 'Invalid transaction: fee payer must be buyer wallet'
      });
    }

    // 3. Verify only allowed programs are called
    const allowedPrograms = new Set([
      SystemProgram.programId.toBase58(), // For SOL transfer
      TOKEN_PROGRAM_ID.toBase58(), // For token transfer
    ]);

    for (const instruction of instructions) {
      if (!allowedPrograms.has(instruction.programId.toBase58())) {
        console.error('[MALICIOUS PROGRAM DETECTED]', {
          wallet,
          tokenAddress,
          maliciousProgramId: instruction.programId.toBase58(),
        });
        return res.status(400).json({
          error: `Invalid transaction: unauthorized program called: ${instruction.programId.toBase58()}`
        });
      }
    }

    // 4. Verify instruction 1: SOL transfer from buyer to escrow
    const solTransferIx = instructions[0];
    if (!solTransferIx.programId.equals(SystemProgram.programId)) {
      return res.status(400).json({
        error: 'Invalid transaction: first instruction must be System Program (SOL transfer)'
      });
    }

    // Verify accounts in SOL transfer: [from, to]
    if (solTransferIx.keys.length < 2) {
      return res.status(400).json({
        error: 'Invalid transaction: SOL transfer missing required accounts'
      });
    }

    const from = solTransferIx.keys[0].pubkey;
    const to = solTransferIx.keys[1].pubkey;

    if (!from.equals(buyerPubKey)) {
      return res.status(400).json({
        error: 'Invalid transaction: SOL must be sent FROM buyer wallet'
      });
    }

    if (!to.equals(escrowPubKey)) {
      return res.status(400).json({
        error: 'Invalid transaction: SOL must be sent TO escrow'
      });
    }

    // Decode SOL transfer amount
    const solTransferData = solTransferIx.data;
    if (solTransferData.length !== 12) {
      return res.status(400).json({
        error: 'Invalid transaction: SOL transfer has invalid data length'
      });
    }

    // System Program transfer instruction format: [4 byte instruction discriminator][8 byte amount]
    const transferredLamports = solTransferData.readBigUInt64LE(4);
    const expectedLamports = BigInt(solAmount);

    if (transferredLamports !== expectedLamports) {
      return res.status(400).json({
        error: `Invalid transaction: SOL amount mismatch. Expected: ${expectedLamports}, Got: ${transferredLamports}`
      });
    }

    // 5. Verify instruction 2: Token transfer from escrow to vault
    const tokenTransferIx = instructions[1];
    if (!tokenTransferIx.programId.equals(TOKEN_PROGRAM_ID)) {
      return res.status(400).json({
        error: 'Invalid transaction: second instruction must be Token Program (token transfer)'
      });
    }

    // Get vault token account (reusing variables declared below)
    let tokenMint = new PublicKey(tokenAddress);
    const vaultTokenAccount = new PublicKey(icoSale.vault_token_account!);
    let escrowTokenAccount = await getAssociatedTokenAddress(tokenMint, escrowPubKey);

    // Verify accounts in token transfer: [source, destination, authority]
    if (tokenTransferIx.keys.length < 3) {
      return res.status(400).json({
        error: 'Invalid transaction: token transfer missing required accounts'
      });
    }

    const tokenSource = tokenTransferIx.keys[0].pubkey;
    const tokenDest = tokenTransferIx.keys[1].pubkey;
    const tokenAuthority = tokenTransferIx.keys[2].pubkey;

    if (!tokenSource.equals(escrowTokenAccount)) {
      return res.status(400).json({
        error: 'Invalid transaction: tokens must be sent FROM escrow token account'
      });
    }

    if (!tokenDest.equals(vaultTokenAccount)) {
      return res.status(400).json({
        error: 'Invalid transaction: tokens must be sent TO vault'
      });
    }

    if (!tokenAuthority.equals(escrowPubKey)) {
      return res.status(400).json({
        error: 'Invalid transaction: token transfer authority must be escrow'
      });
    }

    // Decode token transfer amount
    const tokenTransferData = tokenTransferIx.data;
    if (tokenTransferData.length !== 9) {
      return res.status(400).json({
        error: 'Invalid transaction: token transfer has invalid data length'
      });
    }

    // Token Program transfer instruction format: [1 byte instruction discriminator][8 byte amount]
    const transferredTokens = tokenTransferData.readBigUInt64LE(1);
    const expectedTokens = BigInt(tokensToVault);

    if (transferredTokens !== expectedTokens) {
      return res.status(400).json({
        error: `Invalid transaction: token amount mismatch. Expected: ${expectedTokens}, Got: ${transferredTokens}`
      });
    }

    // CRITICAL OVERSELLING PROTECTION: Check tokens available BEFORE submitting transaction
    const tokensBoughtBigInt = BigInt(tokensBought);
    const dbTokensSold = icoSale.tokens_sold;
    const dbTokensRemaining = icoSale.total_tokens_for_sale - dbTokensSold;

    if (tokensBoughtBigInt > dbTokensRemaining) {
      console.error('[PURCHASE EXCEEDS AVAILABLE]', {
        tokenAddress,
        wallet,
        totalForSale: icoSale.total_tokens_for_sale.toString(),
        alreadySold: dbTokensSold.toString(),
        remaining: dbTokensRemaining.toString(),
        attempted: tokensBoughtBigInt.toString(),
      });

      return res.status(400).json({
        error: `Purchase amount exceeds available tokens. Available: ${dbTokensRemaining}, Requested: ${tokensBoughtBigInt}`,
        errorCode: 'EXCEEDS_AVAILABLE_TOKENS',
        tokensAvailable: dbTokensRemaining.toString(),
        tokensRequested: tokensBoughtBigInt.toString()
      });
    }

    // Add escrow signature to the transaction
    if (!icoSale.escrow_priv_key) {
      return res.status(500).json({
        error: 'Escrow private key not configured'
      });
    }

    const { decryptEscrowKeypair } = await import('../lib/presale-escrow');
    const escrowKeypair = decryptEscrowKeypair(icoSale.escrow_priv_key);
    transaction.partialSign(escrowKeypair);

    // Get blockhash for confirmation
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    // Submit transaction to blockchain
    const rawTransaction = transaction.serialize();
    let signature: string;
    try {
      signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    } catch (error: any) {
      console.error('[TX_SUBMISSION_FAILED]', {
        tokenAddress,
        wallet,
        error: error.message,
      });
      return res.status(500).json({
        error: `Failed to submit transaction: ${error.message}`
      });
    }

    // Wait for confirmation
    try {
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });
    } catch (error: any) {
      console.error('[TX_CONFIRMATION_FAILED]', {
        tokenAddress,
        wallet,
        signature,
        error: error.message,
      });
      return res.status(500).json({
        error: `Transaction submitted but confirmation failed: ${signature}. ${error.message}`
      });
    }

    // Verify transaction succeeded on-chain
    const txInfo = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo) {
      return res.status(500).json({
        error: `Transaction confirmed but not found: ${signature}`
      });
    }

    if (txInfo.meta?.err) {
      return res.status(400).json({
        error: `Transaction failed on-chain: ${JSON.stringify(txInfo.meta.err)}`
      });
    }

    // Record purchase in database
    await processPurchase({
      icoSaleId: parseInt(icoSaleId),
      walletAddress: wallet,
      solAmountLamports: BigInt(solAmount),
      tokensBought: BigInt(tokensBought),
      tokensToVault: BigInt(tokensToVault),
      tokensClaimable: BigInt(tokensClaimable),
      transactionSignature: signature,
    });

    return res.json({
      success: true,
      message: 'Purchase recorded successfully',
      signature,
    });
  } catch (error: any) {
    console.error('Error confirming purchase:', error);
    return res.status(500).json({
      error: error.message || 'Failed to confirm purchase'
    });
  } finally {
    // Release lock when done (success or failure)
    if (releaseLock) {
      releaseLock();
    }
  }
});

/**
 * GET /ico/:tokenAddress/claim?wallet=<address>
 * Get user's claimable balance
 */
router.get('/:tokenAddress/claim', async (req: Request, res: Response) => {
  try {
    const { tokenAddress } = req.params;
    const { wallet } = req.query;

    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({
        error: 'Wallet address is required'
      });
    }

    // Validate addresses
    if (!isValidTokenAddress(tokenAddress)) {
      return res.status(400).json({
        error: 'Invalid token address format'
      });
    }

    if (!isValidSolanaAddress(wallet)) {
      return res.status(400).json({
        error: 'Invalid wallet address format'
      });
    }

    const claimInfo = await getUserClaimInfo(tokenAddress, wallet);

    if (!claimInfo) {
      return res.json({
        tokens_claimable: '0',
        tokens_claimed: '0',
      });
    }

    return res.json({
      tokens_claimable: (claimInfo.tokens_claimable || BigInt(0)).toString(),
      tokens_claimed: claimInfo.tokens_claimed.toString(),
      claimed_at: claimInfo.claimed_at,
    });
  } catch (error) {
    console.error('Error fetching claim info:', error);
    return res.status(500).json({
      error: 'Failed to fetch claim info'
    });
  }
});

/**
 * POST /ico/:tokenAddress/claim/prepare
 * Prepare unsigned claim transaction for user to sign
 */
router.post('/:tokenAddress/claim/prepare', async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { tokenAddress } = req.params;
    const { wallet } = req.body;

    if (!wallet) {
      return res.status(400).json({
        error: 'Wallet address is required'
      });
    }

    // Validate addresses
    if (!isValidTokenAddress(tokenAddress)) {
      return res.status(400).json({
        error: 'Invalid token address format'
      });
    }

    if (!isValidSolanaAddress(wallet)) {
      return res.status(400).json({
        error: 'Invalid wallet address format'
      });
    }

    // Acquire lock for this token to prevent race conditions
    releaseLock = await acquireIcoClaimLock(tokenAddress);

    // Prepare unsigned transaction
    const result = await prepareClaimTransaction({
      tokenAddress,
      walletAddress: wallet,
    });

    // SECURITY: Set recent blockhash to prevent replay attacks
    const connection = new Connection(RPC_URL, 'confirmed');
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    result.transaction.recentBlockhash = blockhash;
    result.transaction.feePayer = new PublicKey(wallet);

    // Serialize unsigned transaction for frontend
    const serializedTx = result.transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return res.json({
      transaction: Buffer.from(serializedTx).toString('base64'),
      icoSaleId: result.icoSaleId,
      tokensToClaim: result.tokensToClaim.toString(),
      escrowPubKey: result.escrowPubKey,
    });
  } catch (error: any) {
    console.error('Error preparing claim:', error);
    return res.status(500).json({
      error: error.message || 'Failed to prepare claim'
    });
  } finally {
    // Release lock when done (success or failure)
    if (releaseLock) {
      releaseLock();
    }
  }
});

/**
 * POST /ico/:tokenAddress/claim/confirm
 * Confirm and process a claim after user signs the transaction
 *
 * FLOW:
 * 1. User calls /prepare to get unsigned transaction
 * 2. User signs transaction on frontend
 * 3. User sends signed transaction to this endpoint (NOT to blockchain)
 * 4. Server validates, adds escrow signature, and submits to blockchain
 * 5. Server records claim in database
 * 6. Returns transaction signature
 */
router.post('/:tokenAddress/claim/confirm', async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { tokenAddress } = req.params;
    const {
      icoSaleId,
      wallet,
      tokensClaimed,
      signedTransaction, // User-signed transaction (base64)
    } = req.body;

    if (!icoSaleId || !wallet || !tokensClaimed || !signedTransaction) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    // Validate addresses
    if (!isValidTokenAddress(tokenAddress)) {
      return res.status(400).json({
        error: 'Invalid token address format'
      });
    }

    if (!isValidSolanaAddress(wallet)) {
      return res.status(400).json({
        error: 'Invalid wallet address format'
      });
    }

    // Deserialize the user-signed transaction
    let transaction: Transaction;
    try {
      const txBuffer = Buffer.from(signedTransaction, 'base64');
      transaction = Transaction.from(txBuffer);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid transaction format'
      });
    }

    // Acquire lock to prevent race conditions (CRITICAL for preventing duplicate processing)
    releaseLock = await acquireIcoClaimLock(tokenAddress);

    // Get ICO sale to verify escrow address
    const icoSale = await getIcoSaleByTokenAddress(tokenAddress);
    if (!icoSale || !icoSale.escrow_pub_key) {
      return res.status(404).json({
        error: 'ICO sale not found or not properly configured'
      });
    }

    // CRITICAL: Verify sale is finalized (not active)
    if (icoSale.status !== 'finalized') {
      return res.status(400).json({
        error: 'ICO sale is not finalized. Claiming is only allowed after the sale is complete.',
        errorCode: 'SALE_NOT_FINALIZED',
        currentStatus: icoSale.status
      });
    }

    // SECURITY: Validate the user-signed transaction before adding escrow signature
    const connection = new Connection(RPC_URL, 'confirmed');
    const walletPubKey = new PublicKey(wallet);
    const escrowPubKey = new PublicKey(icoSale.escrow_pub_key);

    // CRITICAL SECURITY: Verify the user signed the transaction
    const userSignature = transaction.signatures.find(sig =>
      sig.publicKey.equals(walletPubKey)
    );

    if (!userSignature || !userSignature.signature) {
      return res.status(400).json({
        error: 'Transaction not signed by user wallet'
      });
    }

    // CRITICAL SECURITY: Comprehensive transaction validation
    // We must verify the transaction structure BEFORE adding escrow signature

    // 1. Verify the transaction structure matches what we expect
    // Should have 1 or 2 instructions: optional ATA creation + token transfer
    const instructions = transaction.instructions;
    if (instructions.length < 1 || instructions.length > 2) {
      return res.status(400).json({
        error: `Invalid transaction: expected 1-2 instructions, got ${instructions.length}`
      });
    }

    // 2. Verify fee payer is the user
    if (!transaction.feePayer || !transaction.feePayer.equals(walletPubKey)) {
      return res.status(400).json({
        error: 'Invalid transaction: fee payer must be user wallet'
      });
    }

    // 3. Verify only allowed programs are called
    const allowedPrograms = new Set([
      TOKEN_PROGRAM_ID.toBase58(), // For token transfer
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), // For ATA creation
    ]);

    for (const instruction of instructions) {
      if (!allowedPrograms.has(instruction.programId.toBase58())) {
        console.error('[MALICIOUS PROGRAM DETECTED]', {
          wallet,
          tokenAddress,
          maliciousProgramId: instruction.programId.toBase58(),
        });
        return res.status(400).json({
          error: `Invalid transaction: unauthorized program called: ${instruction.programId.toBase58()}`
        });
      }
    }

    // 4. Find the token transfer instruction (should be last)
    const tokenTransferIx = instructions[instructions.length - 1];
    if (!tokenTransferIx.programId.equals(TOKEN_PROGRAM_ID)) {
      return res.status(400).json({
        error: 'Invalid transaction: last instruction must be Token Program (token transfer)'
      });
    }

    // 5. Verify token transfer instruction structure
    // Get escrow and user token accounts
    const tokenMint = new PublicKey(tokenAddress);
    const escrowTokenAccount = await getAssociatedTokenAddress(tokenMint, escrowPubKey);
    const userTokenAccount = await getAssociatedTokenAddress(tokenMint, walletPubKey);

    // Verify accounts in token transfer: [source, destination, authority]
    if (tokenTransferIx.keys.length < 3) {
      return res.status(400).json({
        error: 'Invalid transaction: token transfer missing required accounts'
      });
    }

    const tokenSource = tokenTransferIx.keys[0].pubkey;
    const tokenDest = tokenTransferIx.keys[1].pubkey;
    const tokenAuthority = tokenTransferIx.keys[2].pubkey;

    if (!tokenSource.equals(escrowTokenAccount)) {
      return res.status(400).json({
        error: 'Invalid transaction: tokens must be sent FROM escrow token account'
      });
    }

    if (!tokenDest.equals(userTokenAccount)) {
      return res.status(400).json({
        error: 'Invalid transaction: tokens must be sent TO user token account'
      });
    }

    if (!tokenAuthority.equals(escrowPubKey)) {
      return res.status(400).json({
        error: 'Invalid transaction: token transfer authority must be escrow'
      });
    }

    // 6. Decode token transfer amount
    const tokenTransferData = tokenTransferIx.data;
    if (tokenTransferData.length !== 9) {
      return res.status(400).json({
        error: 'Invalid transaction: token transfer has invalid data length'
      });
    }

    // Token Program transfer instruction format: [1 byte instruction discriminator][8 byte amount]
    const transferredTokens = tokenTransferData.readBigUInt64LE(1);
    const expectedTokens = BigInt(tokensClaimed);

    if (transferredTokens !== expectedTokens) {
      return res.status(400).json({
        error: `Invalid transaction: token amount mismatch. Expected: ${expectedTokens}, Got: ${transferredTokens}`
      });
    }

    // 7. Verify user has enough claimable tokens in database
    const claimInfo = await getIcoClaimByWallet(tokenAddress, wallet);
    if (!claimInfo) {
      return res.status(400).json({
        error: 'No claimable tokens found for this wallet'
      });
    }

    const tokensClaimableBigInt = BigInt(tokensClaimed);
    const tokensRemainingToClaim = (claimInfo.tokens_claimable || BigInt(0)) - claimInfo.tokens_claimed;

    if (tokensClaimableBigInt > tokensRemainingToClaim) {
      return res.status(400).json({
        error: `Claim amount exceeds available tokens. Available: ${tokensRemainingToClaim}, Requested: ${tokensClaimableBigInt}`
      });
    }

    // Add escrow signature to the transaction
    if (!icoSale.escrow_priv_key) {
      return res.status(500).json({
        error: 'Escrow private key not configured'
      });
    }

    const { decryptEscrowKeypair } = await import('../lib/presale-escrow');
    const escrowKeypair = decryptEscrowKeypair(icoSale.escrow_priv_key);
    transaction.partialSign(escrowKeypair);

    // Get blockhash for confirmation
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    // Submit transaction to blockchain
    const rawTransaction = transaction.serialize();
    let signature: string;
    try {
      signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    } catch (error: any) {
      console.error('[TX_SUBMISSION_FAILED]', {
        tokenAddress,
        wallet,
        error: error.message,
      });
      return res.status(500).json({
        error: `Failed to submit transaction: ${error.message}`
      });
    }

    // Wait for confirmation
    try {
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });
    } catch (error: any) {
      console.error('[TX_CONFIRMATION_FAILED]', {
        tokenAddress,
        wallet,
        signature,
        error: error.message,
      });
      return res.status(500).json({
        error: `Transaction submitted but confirmation failed: ${signature}. ${error.message}`
      });
    }

    // Verify transaction succeeded on-chain
    const txInfo = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo) {
      return res.status(500).json({
        error: `Transaction confirmed but not found: ${signature}`
      });
    }

    if (txInfo.meta?.err) {
      return res.status(400).json({
        error: `Transaction failed on-chain: ${JSON.stringify(txInfo.meta.err)}`
      });
    }

    // Record claim in database
    await processClaim({
      icoSaleId: parseInt(icoSaleId),
      walletAddress: wallet,
      tokensClaimed: BigInt(tokensClaimed),
      claimSignature: signature,
    });

    return res.json({
      success: true,
      message: 'Claim recorded successfully',
      signature,
    });
  } catch (error: any) {
    console.error('Error confirming claim:', error);
    return res.status(500).json({
      error: error.message || 'Failed to confirm claim'
    });
  } finally {
    // Release lock when done (success or failure)
    if (releaseLock) {
      releaseLock();
    }
  }
});

/**
 * POST /ico/:tokenAddress/launch/prepare
 * DEPRECATED: AMM creation is now manual
 * Prepare ICO launch transaction (create AMM pool + distribute SOL)
 */
router.post('/:tokenAddress/launch/prepare', async (_req: Request, res: Response) => {
  return res.status(410).json({
    error: 'AMM creation is now manual. This automated endpoint is deprecated.'
  });
});

/**
 * POST /ico/:tokenAddress/launch/confirm
 * DEPRECATED: AMM creation is now manual
 * Confirm ICO launch after transaction is signed and submitted
 */
router.post('/:tokenAddress/launch/confirm', async (_req: Request, res: Response) => {
  return res.status(410).json({
    error: 'AMM creation is now manual. This automated endpoint is deprecated.'
  });
});

export default router;
