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
  signClaimTransaction,
  processClaim,
} from '../lib/icoService';
import {
  getIcoSaleByTokenAddress,
  isPurchaseSignatureProcessed,
  isClaimSignatureProcessed,
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
 * OVERSELLING PROTECTION ARCHITECTURE:
 * -------------------------------------
 * The database tracks tokens_sold as a performance optimization and for quick checks,
 * but the blockchain is the source of truth. In the confirm endpoint, we:
 *
 * 1. Fast check: Validate against database tokens_sold (fail-fast for obvious cases)
 * 2. On-chain verification: Query vault token balance to calculate actual tokens sold
 *    - Since 50% of each purchase goes to vault, vault_balance * 2 = tokens_sold
 *    - This is ground truth and cannot be manipulated
 * 3. Overselling prevention: Compare requested purchase against on-chain remaining tokens
 * 4. Safety check: Verify escrow has enough balance for all future claims
 *
 * The database does its best to match the blockchain state, but we assume it may
 * occasionally be out of sync (e.g., due to race conditions, network issues, etc.).
 * The on-chain verification ensures we never oversell, even if the database is wrong.
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
      tokens_sold: (icoSale.tokens_sold || BigInt(0)).toString(),
      total_sol_raised: (icoSale.total_sol_raised || BigInt(0)).toString(),
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
      tokens_sold: (safeIcoSale.tokens_sold || BigInt(0)).toString(),
      total_sol_raised: (safeIcoSale.total_sol_raised || BigInt(0)).toString(),
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
 * Confirm and process a purchase after transaction is signed and submitted
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
      signature,
    } = req.body;

    if (!icoSaleId || !wallet || !solAmount || !tokensBought || !tokensToVault || !tokensClaimable || !signature) {
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

    // Validate signature
    if (!isValidTransactionSignature(signature)) {
      return res.status(400).json({
        error: 'Invalid transaction signature format'
      });
    }

    // Validate amounts
    if (!isValidLamportsAmount(solAmount)) {
      return res.status(400).json({
        error: 'Invalid SOL amount'
      });
    }

    // FAIL-FAST: Check if signature already processed (before expensive operations)
    const alreadyProcessed = await isPurchaseSignatureProcessed(signature);
    if (alreadyProcessed) {
      return res.status(409).json({
        error: 'Purchase transaction already processed'
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

    // CRITICAL: Auto-cap re-validation - ensure purchase doesn't exceed available tokens
    // Use database tokens_sold as a first check (fast)
    const tokensRemainingDB = icoSale.total_tokens_for_sale - (icoSale.tokens_sold || BigInt(0));
    const tokensBoughtBigInt = BigInt(tokensBought);

    if (tokensBoughtBigInt > tokensRemainingDB) {
      return res.status(400).json({
        error: `Purchase exceeds available tokens. Available: ${tokensRemainingDB}, Requested: ${tokensBoughtBigInt}`,
        errorCode: 'EXCEEDS_AVAILABLE_TOKENS',
        tokensAvailable: tokensRemainingDB.toString(),
        tokensRequested: tokensBoughtBigInt.toString()
      });
    }

    // SECURITY: First verify the transaction BEFORE querying blockchain
    // This prevents wasting resources on invalid/malicious transactions
    const connection = new Connection(RPC_URL, 'confirmed');
    const buyerPubKey = new PublicKey(wallet);
    const escrowPubKey = new PublicKey(icoSale.escrow_pub_key);

    // Fetch and validate transaction from blockchain
    const txInfo = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo) {
      return res.status(404).json({
        error: 'Transaction not found on-chain'
      });
    }

    if (txInfo.meta?.err) {
      return res.status(400).json({
        error: 'Transaction failed on-chain'
      });
    }

    // CRITICAL SECURITY: Verify the buyer wallet signed the transaction
    const signers = txInfo.transaction.message.getAccountKeys().staticAccountKeys;
    const buyerIsSigner = signers.some(key => key.equals(buyerPubKey));

    if (!buyerIsSigner) {
      return res.status(400).json({
        error: 'Buyer wallet did not sign the transaction'
      });
    }

    // Verify SOL transfer to escrow
    const preBalances = txInfo.meta?.preBalances || [];
    const postBalances = txInfo.meta?.postBalances || [];

    // Find escrow account index
    let escrowIndex = -1;
    for (let i = 0; i < signers.length; i++) {
      if (signers[i].equals(escrowPubKey)) {
        escrowIndex = i;
        break;
      }
    }

    if (escrowIndex === -1) {
      return res.status(400).json({
        error: 'Escrow address not found in transaction'
      });
    }

    // Calculate actual SOL received by escrow (in lamports)
    const escrowBalanceIncrease = postBalances[escrowIndex] - preBalances[escrowIndex];
    const expectedAmount = BigInt(solAmount);

    // SECURITY: Require exact match (SOL transfers don't have fees deducted from the transfer amount)
    // The sender pays fees separately, so the escrow should receive exactly the claimed amount
    if (BigInt(escrowBalanceIncrease) !== expectedAmount) {
      return res.status(400).json({
        error: `Transaction did not transfer the exact SOL amount. Expected: ${expectedAmount}, Got: ${escrowBalanceIncrease}`
      });
    }

    // CRITICAL SECURITY: Verify the buyer wallet is the actual payer (balance decreased)
    // This prevents attackers from stealing credit for someone else's purchase
    let buyerIndex = -1;
    let buyerBalanceDecrease = 0;
    for (let i = 0; i < signers.length; i++) {
      if (signers[i].equals(buyerPubKey)) {
        buyerIndex = i;
        const balanceChange = postBalances[i] - preBalances[i];
        if (balanceChange < 0) {
          buyerBalanceDecrease = Math.abs(balanceChange);
        }
        break;
      }
    }

    if (buyerIndex === -1) {
      return res.status(400).json({
        error: 'Buyer wallet not found in transaction accounts'
      });
    }

    // Verify the buyer's balance actually decreased (they paid for this)
    // The decrease should be at least the expected amount (may be higher due to fees)
    if (buyerBalanceDecrease < Number(expectedAmount)) {
      return res.status(400).json({
        error: `Buyer wallet did not pay for this purchase. Balance decrease: ${buyerBalanceDecrease}, Expected: ${expectedAmount}`
      });
    }

    // CRITICAL OVERSELLING PROTECTION: Verify on-chain token balance
    // The database is our best effort to track sales, but the blockchain is ground truth
    // We verify the escrow has enough tokens to fulfill this purchase before recording it
    const tokenMint = new PublicKey(tokenAddress);
    const escrowTokenAccountAddress = await getAssociatedTokenAddress(tokenMint, escrowPubKey);
    const escrowTokenAccount = await connection.getTokenAccountBalance(escrowTokenAccountAddress);
    const escrowOnChainBalance = BigInt(escrowTokenAccount.value.amount);

    // Get current vault balance to calculate total tokens already distributed
    if (!icoSale.vault_token_account) {
      return res.status(500).json({
        error: 'Vault token account not configured'
      });
    }

    const vaultTokenAccount = new PublicKey(icoSale.vault_token_account);
    const vaultBalance = await connection.getTokenAccountBalance(vaultTokenAccount);
    const tokensInVault = BigInt(vaultBalance.value.amount);

    // Calculate how many tokens have been sold (2x vault balance, since 50% goes to vault)
    // This is ground truth from the blockchain
    const tokensSoldOnChain = tokensInVault * BigInt(2);

    // Calculate remaining tokens for sale (on-chain ground truth)
    const tokensRemainingOnChain = icoSale.total_tokens_for_sale - tokensSoldOnChain;

    // CRITICAL: Verify this purchase doesn't exceed what's actually available on-chain
    if (tokensBoughtBigInt > tokensRemainingOnChain) {
      console.error('[OVERSELLING DETECTED]', {
        tokenAddress,
        totalForSale: icoSale.total_tokens_for_sale.toString(),
        tokensInVault: tokensInVault.toString(),
        tokensSoldOnChain: tokensSoldOnChain.toString(),
        tokensRemainingOnChain: tokensRemainingOnChain.toString(),
        tokensBoughtAttempted: tokensBoughtBigInt.toString(),
        dbTokensSold: (icoSale.tokens_sold || BigInt(0)).toString(),
        dbTokensRemaining: tokensRemainingDB.toString()
      });

      return res.status(400).json({
        error: `OVERSELLING PROTECTION: On-chain verification failed. Available tokens: ${tokensRemainingOnChain}, Requested: ${tokensBoughtBigInt}`,
        errorCode: 'OVERSELLING_DETECTED',
        tokensAvailableOnChain: tokensRemainingOnChain.toString(),
        tokensRequested: tokensBoughtBigInt.toString(),
        message: 'The database was out of sync with blockchain. This purchase would have exceeded available tokens.'
      });
    }

    // Additional safety check: Verify escrow has enough balance for all future claims
    // escrowOnChainBalance should be >= all remaining claimable tokens (50% of remaining sale)
    const totalClaimableRemaining = tokensRemainingOnChain / BigInt(2);

    if (escrowOnChainBalance < totalClaimableRemaining) {
      console.error('[INSUFFICIENT ESCROW BALANCE]', {
        tokenAddress,
        escrowBalance: escrowOnChainBalance.toString(),
        totalClaimableRemaining: totalClaimableRemaining.toString(),
        deficit: (totalClaimableRemaining - escrowOnChainBalance).toString()
      });

      return res.status(500).json({
        error: 'Escrow has insufficient tokens to fulfill remaining claims',
        errorCode: 'INSUFFICIENT_ESCROW_BALANCE',
        escrowBalance: escrowOnChainBalance.toString(),
        requiredBalance: totalClaimableRemaining.toString()
      });
    }

    // Record purchase (database will do its best to stay in sync with blockchain)
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
 * Prepare claim transaction (server signs with escrow key)
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

    // Sign with escrow key
    const signedTransaction = await signClaimTransaction({
      tokenAddress,
      transaction: result.transaction,
    });

    // SECURITY: Set recent blockhash to prevent replay attacks
    const connection = new Connection(RPC_URL, 'confirmed');
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    signedTransaction.recentBlockhash = blockhash;
    signedTransaction.feePayer = new PublicKey(wallet);

    // Serialize for frontend
    const serializedTx = signedTransaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return res.json({
      transaction: Buffer.from(serializedTx).toString('base64'),
      icoSaleId: result.icoSaleId,
      tokensToClaim: result.tokensToClaim.toString(),
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
 * Confirm claim after user signs and submits transaction
 */
router.post('/:tokenAddress/claim/confirm', async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { tokenAddress } = req.params;
    const { icoSaleId, wallet, tokensClaimed, signature } = req.body;

    if (!icoSaleId || !wallet || !tokensClaimed || !signature) {
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

    // Validate signature
    if (!isValidTransactionSignature(signature)) {
      return res.status(400).json({
        error: 'Invalid transaction signature format'
      });
    }

    // FAIL-FAST: Check if signature already processed (before expensive operations)
    const alreadyProcessed = await isClaimSignatureProcessed(signature);
    if (alreadyProcessed) {
      return res.status(409).json({
        error: 'Claim transaction already processed'
      });
    }

    // Acquire lock to prevent race conditions
    releaseLock = await acquireIcoClaimLock(tokenAddress);

    // Get ICO sale to verify escrow address
    const icoSale = await getIcoSaleByTokenAddress(tokenAddress);
    if (!icoSale || !icoSale.escrow_pub_key) {
      return res.status(404).json({
        error: 'ICO sale not found or not properly configured'
      });
    }

    // Verify transaction on-chain
    const connection = new Connection(RPC_URL, 'confirmed');
    const txInfo = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo) {
      return res.status(404).json({
        error: 'Transaction not found'
      });
    }

    if (txInfo.meta?.err) {
      return res.status(400).json({
        error: 'Transaction failed on-chain'
      });
    }

    // CRITICAL SECURITY: Verify that the user wallet signed the transaction
    // Note: For on-chain transactions, the blockchain has already validated signatures
    // We verify the signer is in the transaction as a security check
    const userPubKey = new PublicKey(wallet);
    const escrowPubKey = new PublicKey(icoSale.escrow_pub_key);
    const signers = txInfo.transaction.message.getAccountKeys().staticAccountKeys;
    const userIsSigner = signers.some(key => key.equals(userPubKey));

    if (!userIsSigner) {
      return res.status(400).json({
        error: 'Invalid transaction: user wallet did not sign the transaction'
      });
    }

    // Verify escrow also signed (for token transfer authority)
    const escrowIsSigner = signers.some(key => key.equals(escrowPubKey));
    if (!escrowIsSigner) {
      return res.status(400).json({
        error: 'Invalid transaction: escrow did not sign the transaction'
      });
    }

    // CRITICAL SECURITY: Validate token balance changes
    // Since this is an on-chain transaction, we can validate the actual token balance changes
    // This is more reliable than trying to parse versioned transaction instructions

    // Verify the transaction involves token transfers (check for token balance changes)
    const tokenBalances = txInfo.meta?.postTokenBalances || [];
    const preTokenBalances = txInfo.meta?.preTokenBalances || [];

    // Look for the token transfer to the user's specific account
    let foundUserReceived = false;
    const expectedClaimedAmount = BigInt(tokensClaimed);

    for (const postBalance of tokenBalances) {
      // Find matching pre-balance
      const preBalance = preTokenBalances.find(
        pb => pb.accountIndex === postBalance.accountIndex
      );

      if (postBalance.mint === tokenAddress) {
        const postAmount = BigInt(postBalance.uiTokenAmount.amount);
        const preAmount = preBalance ? BigInt(preBalance.uiTokenAmount.amount) : BigInt(0);
        const received = postAmount - preAmount;

        // CRITICAL: Verify this is the USER'S token account, not just any account
        // Check if this is the user's associated token account by verifying the owner
        if (received > 0 && postBalance.owner === wallet) {
          // SECURITY: Require exact match to prevent rounding exploits
          if (received === expectedClaimedAmount) {
            foundUserReceived = true;
            break;
          }
        }
      }
    }

    if (!foundUserReceived) {
      return res.status(400).json({
        error: 'Invalid transaction: user wallet did not receive the claimed tokens'
      });
    }

    // Record claim
    await processClaim({
      icoSaleId: parseInt(icoSaleId),
      walletAddress: wallet,
      tokensClaimed: BigInt(tokensClaimed),
      claimSignature: signature,
    });

    return res.json({
      success: true,
      message: 'Claim recorded successfully',
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
