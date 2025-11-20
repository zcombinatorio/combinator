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
import * as crypto from 'crypto';
import nacl from 'tweetnacl';
import { Connection, Keypair, Transaction, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getMint,
  createAssociatedTokenAccountIdempotentInstruction,
  NATIVE_MINT
} from '@solana/spl-token';
import bs58 from 'bs58';
import BN from 'bn.js';
import { CpAmm, getTokenProgram } from '@meteora-ag/cp-amm-sdk';
import rateLimit from 'express-rate-limit';

/**
 * DAMM Liquidity Routes
 *
 * Express router for Meteora DAMM v2 liquidity management endpoints
 * Handles withdrawal and deposit operations with manager wallet authorization
 */

const router = Router();

// Rate limiter for DAMM liquidity endpoints
const dammLiquidityLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 requests per 5 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many liquidity requests, please wait a moment.'
});

// In-memory storage for liquidity transactions
// Maps requestId -> transaction data
interface DammWithdrawData {
  unsignedTransaction: string;
  unsignedTransactionHash: string;
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  lpOwnerAddress: string;
  managerAddress: string;
  destinationAddress: string;
  estimatedTokenAAmount: string;
  estimatedTokenBAmount: string;
  liquidityDelta: string;
  withdrawalPercentage: number;
  timestamp: number;
}

interface DammDepositData {
  unsignedTransaction: string;
  unsignedTransactionHash: string; // SHA-256 hash for tamper detection
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenAVault: string;
  tokenBVault: string;
  lpOwnerAddress: string;
  managerAddress: string;
  tokenAAmount: string;
  tokenBAmount: string;
  liquidityDelta: string;
  timestamp: number;
}

const withdrawRequests = new Map<string, DammWithdrawData>();
const depositRequests = new Map<string, DammDepositData>();

// Mutex locks for preventing concurrent processing
const liquidityLocks = new Map<string, Promise<void>>();

/**
 * Acquire a liquidity lock for a specific pool
 * Prevents race conditions during liquidity operations
 */
async function acquireLiquidityLock(poolAddress: string): Promise<() => void> {
  const key = poolAddress.toLowerCase();

  // Wait for any existing lock to be released
  while (liquidityLocks.has(key)) {
    await liquidityLocks.get(key);
  }

  // Create a new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  liquidityLocks.set(key, lockPromise);

  // Return the release function
  return () => {
    liquidityLocks.delete(key);
    releaseLock!();
  };
}

/**
 * Get the manager wallet address for a specific pool
 * Supports per-pool manager wallets via environment variables
 *
 * Environment variable priority:
 * 1. MANAGER_WALLET_<POOL_TICKER> - Pool-specific manager (e.g., MANAGER_WALLET_ZC)
 * 2. MANAGER_WALLET - Default/fallback manager wallet
 *
 * @param poolAddress - The DAMM pool address
 * @returns Manager wallet public key string
 */
function getManagerWalletForPool(poolAddress: string): string {
  // Pool address to ticker mapping (from whitelist config)
  const poolToTicker: Record<string, string> = {
    'CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad': 'ZC',
    '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX': 'OOGWAY',
  };

  // Get ticker for this pool
  const ticker = poolToTicker[poolAddress];

  // Try pool-specific manager wallet first
  if (ticker) {
    const poolSpecificManager = process.env[`MANAGER_WALLET_${ticker}`];
    if (poolSpecificManager) {
      console.log(`Using pool-specific manager for ${ticker}:`, poolSpecificManager);
      return poolSpecificManager;
    }
  }

  // Fallback to default manager wallet
  const defaultManager = process.env.MANAGER_WALLET;
  if (!defaultManager) {
    throw new Error('MANAGER_WALLET environment variable not configured');
  }

  console.log(`Using default manager wallet:`, defaultManager);
  return defaultManager;
}

// Clean up expired requests every 5 minutes
setInterval(() => {
  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  const now = Date.now();

  for (const [requestId, data] of withdrawRequests.entries()) {
    if (now - data.timestamp > FIFTEEN_MINUTES) {
      withdrawRequests.delete(requestId);
    }
  }

  for (const [requestId, data] of depositRequests.entries()) {
    if (now - data.timestamp > FIFTEEN_MINUTES) {
      depositRequests.delete(requestId);
    }
  }
}, 5 * 60 * 1000);

// ============================================================================
// POST /damm/withdraw/build - Build withdrawal transaction
// ============================================================================

router.post('/withdraw/build', dammLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { withdrawalPercentage, poolAddress: poolAddressInput } = req.body;

    console.log('DAMM withdraw build request received:', { withdrawalPercentage, poolAddress: poolAddressInput });

    // Validate required fields
    if (withdrawalPercentage === undefined || withdrawalPercentage === null) {
      return res.status(400).json({
        error: 'Missing required field: withdrawalPercentage'
      });
    }

    // Validate poolAddress is a valid Solana public key (default to main pool if not provided)
    const DEFAULT_POOL_ADDRESS = 'CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad';
    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput || DEFAULT_POOL_ADDRESS);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid poolAddress: must be a valid Solana public key'
      });
    }

    // Validate withdrawal percentage (maximum 15%)
    if (typeof withdrawalPercentage !== 'number' || withdrawalPercentage <= 0 || withdrawalPercentage > 15) {
      return res.status(400).json({
        error: 'withdrawalPercentage must be a number between 0 and 15'
      });
    }

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    const LP_OWNER_PRIVATE_KEY = process.env.LP_OWNER_PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;
    const MANAGER_WALLET = process.env.MANAGER_WALLET;

    if (!RPC_URL || !LP_OWNER_PRIVATE_KEY || !MANAGER_WALLET) {
      return res.status(500).json({
        error: 'Server configuration incomplete. Missing required environment variables.'
      });
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const managerWallet = new PublicKey(MANAGER_WALLET);

    // Create CpAmm instance and get pool state
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);

    // Get user positions
    const userPositions = await cpAmm.getUserPositionByPool(poolAddress, lpOwner.publicKey);

    if (userPositions.length === 0) {
      return res.status(404).json({
        error: 'No positions found for the LP owner in this pool'
      });
    }

    // Use first position
    const { position, positionNftAccount, positionState } = userPositions[0];

    if (positionState.unlockedLiquidity.isZero()) {
      return res.status(400).json({
        error: 'No unlocked liquidity in position'
      });
    }

    // Calculate withdrawal amount
    const liquidityDelta = positionState.unlockedLiquidity
      .muln(withdrawalPercentage * 1000)
      .divn(100000);

    if (liquidityDelta.isZero()) {
      return res.status(400).json({
        error: 'Withdrawal amount too small'
      });
    }

    // Get token info
    const tokenAMint = await getMint(connection, poolState.tokenAMint);
    const tokenBMint = await getMint(connection, poolState.tokenBMint);
    const tokenAProgram = getTokenProgram(tokenAMint.tlvData.length > 0 ? 1 : 0);
    const tokenBProgram = getTokenProgram(tokenBMint.tlvData.length > 0 ? 1 : 0);

    // Calculate withdrawal quote
    const withdrawQuote = cpAmm.getWithdrawQuote({
      liquidityDelta,
      minSqrtPrice: poolState.sqrtMinPrice,
      maxSqrtPrice: poolState.sqrtMaxPrice,
      sqrtPrice: poolState.sqrtPrice,
      tokenATokenInfo: {
        mint: tokenAMint,
        currentEpoch: await connection.getEpochInfo().then(e => e.epoch)
      },
      tokenBTokenInfo: {
        mint: tokenBMint,
        currentEpoch: await connection.getEpochInfo().then(e => e.epoch)
      }
    });

    const isTokenBNativeSOL = poolState.tokenBMint.equals(NATIVE_MINT);

    // Build combined transaction
    const combinedTx = new Transaction();
    combinedTx.feePayer = managerWallet;

    const { blockhash } = await connection.getLatestBlockhash();
    combinedTx.recentBlockhash = blockhash;

    // Get token accounts
    const tokenAAta = await getAssociatedTokenAddress(
      poolState.tokenAMint,
      lpOwner.publicKey,
      false,
      tokenAProgram
    );
    const tokenBAta = isTokenBNativeSOL ? lpOwner.publicKey : await getAssociatedTokenAddress(
      poolState.tokenBMint,
      lpOwner.publicKey,
      false,
      tokenBProgram
    );

    const destTokenAAta = await getAssociatedTokenAddress(
      poolState.tokenAMint,
      managerWallet,
      false,
      tokenAProgram
    );
    const destTokenBAta = isTokenBNativeSOL ? managerWallet : await getAssociatedTokenAddress(
      poolState.tokenBMint,
      managerWallet,
      false,
      tokenBProgram
    );

    // Create LP owner's ATAs
    combinedTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        managerWallet,
        tokenAAta,
        lpOwner.publicKey,
        poolState.tokenAMint,
        tokenAProgram
      )
    );

    if (!isTokenBNativeSOL) {
      combinedTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          managerWallet,
          tokenBAta,
          lpOwner.publicKey,
          poolState.tokenBMint,
          tokenBProgram
        )
      );
    }

    // Add remove liquidity instructions
    const vestingsRaw = await cpAmm.getAllVestingsByPosition(position);
    const vestings = vestingsRaw.map(v => ({
      account: v.publicKey,
      vestingState: v.account
    }));

    const removeLiquidityTx = await cpAmm.removeLiquidity({
      owner: lpOwner.publicKey,
      position,
      pool: poolAddress,
      positionNftAccount,
      liquidityDelta,
      tokenAAmountThreshold: new BN(0),
      tokenBAmountThreshold: new BN(0),
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAProgram,
      tokenBProgram,
      vestings,
      currentPoint: new BN(0),
    });

    combinedTx.add(...removeLiquidityTx.instructions);

    // Create destination ATAs
    if (!withdrawQuote.outAmountA.isZero()) {
      combinedTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          managerWallet,
          destTokenAAta,
          managerWallet,
          poolState.tokenAMint,
          tokenAProgram
        )
      );
    }

    if (!withdrawQuote.outAmountB.isZero() && !isTokenBNativeSOL) {
      combinedTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          managerWallet,
          destTokenBAta,
          managerWallet,
          poolState.tokenBMint,
          tokenBProgram
        )
      );
    }

    // Add transfer instructions
    if (!withdrawQuote.outAmountA.isZero()) {
      combinedTx.add(
        createTransferInstruction(
          tokenAAta,
          destTokenAAta,
          lpOwner.publicKey,
          BigInt(withdrawQuote.outAmountA.toString()),
          [],
          tokenAProgram
        )
      );
    }

    if (!withdrawQuote.outAmountB.isZero()) {
      if (isTokenBNativeSOL) {
        combinedTx.add(
          SystemProgram.transfer({
            fromPubkey: lpOwner.publicKey,
            toPubkey: managerWallet,
            lamports: Number(withdrawQuote.outAmountB.toString())
          })
        );
      } else {
        combinedTx.add(
          createTransferInstruction(
            tokenBAta,
            destTokenBAta,
            lpOwner.publicKey,
            BigInt(withdrawQuote.outAmountB.toString()),
            [],
            tokenBProgram
          )
        );
      }
    }

    // Serialize unsigned transaction
    const unsignedTransaction = bs58.encode(combinedTx.serialize({ requireAllSignatures: false }));

    // Compute hash of unsigned transaction for integrity verification
    const unsignedTransactionHash = crypto.createHash('sha256')
      .update(combinedTx.serializeMessage())
      .digest('hex');

    // Generate unique request ID
    const requestId = crypto.randomBytes(16).toString('hex');

    console.log('✓ Withdrawal transaction built successfully');
    console.log(`  Pool: ${poolAddress.toBase58()}`);
    console.log(`  Withdrawal: ${withdrawalPercentage}%`);
    console.log(`  Liquidity Delta: ${liquidityDelta.toString()}`);
    console.log(`  Token A: ${withdrawQuote.outAmountA.toString()}`);
    console.log(`  Token B: ${withdrawQuote.outAmountB.toString()}`);
    console.log(`  Request ID: ${requestId}`);

    // Store transaction data
    withdrawRequests.set(requestId, {
      unsignedTransaction,
      unsignedTransactionHash,
      poolAddress: poolAddress.toBase58(),
      tokenAMint: poolState.tokenAMint.toBase58(),
      tokenBMint: poolState.tokenBMint.toBase58(),
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: managerWallet.toBase58(),
      destinationAddress: managerWallet.toBase58(),
      estimatedTokenAAmount: withdrawQuote.outAmountA.toString(),
      estimatedTokenBAmount: withdrawQuote.outAmountB.toString(),
      liquidityDelta: liquidityDelta.toString(),
      withdrawalPercentage,
      timestamp: Date.now()
    });

    res.json({
      success: true,
      transaction: unsignedTransaction,
      requestId,
      poolAddress: poolAddress.toBase58(),
      tokenAMint: poolState.tokenAMint.toBase58(),
      tokenBMint: poolState.tokenBMint.toBase58(),
      isTokenBNativeSOL,
      withdrawalPercentage,
      instructionsCount: combinedTx.instructions.length,
      estimatedAmounts: {
        tokenA: withdrawQuote.outAmountA.toString(),
        tokenB: withdrawQuote.outAmountB.toString(),
        liquidityDelta: liquidityDelta.toString()
      },
      message: 'Sign this transaction with the manager wallet and submit to /damm/withdraw/confirm'
    });

  } catch (error) {
    console.error('Withdraw build error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create withdrawal transaction'
    });
  }
});

// ============================================================================
// POST /damm/withdraw/confirm - Confirm and submit withdrawal transaction
// ============================================================================
/**
 * Security measures:
 * 1. Authority wallet signature - Transaction must be signed by pool's authority wallet (only percent backend has keys)
 * 2. Lock system - Prevents concurrent operations for the same pool
 * 3. Request expiry - 10 minute timeout
 * 4. Blockhash validation - Prevents replay attacks
 * 5. Comprehensive logging
 *
 * Note: User authorization (attestation & whitelist) validated in percent backend before calling this endpoint.
 */

router.post('/withdraw/confirm', dammLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransaction, requestId } = req.body;

    console.log('DAMM withdraw confirm request received:', { requestId });

    // Validate required fields
    if (!signedTransaction || !requestId) {
      return res.status(400).json({
        error: 'Missing required fields: signedTransaction and requestId'
      });
    }

    // Retrieve request data
    const withdrawData = withdrawRequests.get(requestId);
    if (!withdrawData) {
      return res.status(400).json({
        error: 'Withdrawal request not found or expired. Please call /damm/withdraw/build first.'
      });
    }

    console.log('  Pool:', withdrawData.poolAddress);

    // Acquire lock
    releaseLock = await acquireLiquidityLock(withdrawData.poolAddress);
    console.log('  Lock acquired');

    // Check request age
    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - withdrawData.timestamp > TEN_MINUTES) {
      withdrawRequests.delete(requestId);
      return res.status(400).json({
        error: 'Withdrawal request expired. Please create a new request.'
      });
    }

    // Validate environment
    const RPC_URL = process.env.RPC_URL;
    const LP_OWNER_PRIVATE_KEY = process.env.LP_OWNER_PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;

    if (!RPC_URL || !LP_OWNER_PRIVATE_KEY) {
      return res.status(500).json({
        error: 'Server configuration incomplete'
      });
    }

    // Get pool-specific manager wallet
    let MANAGER_WALLET: string;
    try {
      MANAGER_WALLET = getManagerWalletForPool(withdrawData.poolAddress);
    } catch (error) {
      return res.status(500).json({
        error: 'Manager wallet configuration error',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Initialize connection
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwnerKeypair = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const managerWalletPubKey = new PublicKey(MANAGER_WALLET);

    // Deserialize transaction
    let transaction: Transaction;
    try {
      const transactionBuffer = bs58.decode(signedTransaction);
      transaction = Transaction.from(transactionBuffer);
    } catch (error) {
      return res.status(400).json({
        error: `Failed to deserialize transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }

    // SECURITY: Validate blockhash
    if (!transaction.recentBlockhash) {
      return res.status(400).json({
        error: 'Invalid transaction: missing blockhash'
      });
    }

    const isBlockhashValid = await connection.isBlockhashValid(
      transaction.recentBlockhash,
      { commitment: 'confirmed' }
    );

    if (!isBlockhashValid) {
      return res.status(400).json({
        error: 'Invalid transaction: blockhash is expired. Please create a new transaction.'
      });
    }

    // SECURITY: Verify fee payer is manager wallet
    if (!transaction.feePayer) {
      return res.status(400).json({
        error: 'Transaction missing fee payer'
      });
    }

    if (!transaction.feePayer.equals(managerWalletPubKey)) {
      return res.status(400).json({
        error: 'Transaction fee payer must be manager wallet'
      });
    }

    // SECURITY: Verify manager wallet has signed
    const managerSignature = transaction.signatures.find(sig =>
      sig.publicKey.equals(managerWalletPubKey)
    );

    if (!managerSignature || !managerSignature.signature) {
      return res.status(400).json({
        error: 'Transaction verification failed: Manager wallet has not signed'
      });
    }

    // Verify manager signature is valid
    const messageData = transaction.serializeMessage();
    const managerSigValid = nacl.sign.detached.verify(
      messageData,
      managerSignature.signature,
      managerSignature.publicKey.toBytes()
    );

    if (!managerSigValid) {
      return res.status(400).json({
        error: 'Transaction verification failed: Invalid manager wallet signature'
      });
    }

    // SECURITY: Verify transaction hasn't been tampered with
    const receivedTransactionHash = crypto.createHash('sha256')
      .update(transaction.serializeMessage())
      .digest('hex');

    if (receivedTransactionHash !== withdrawData.unsignedTransactionHash) {
      console.log(`  ⚠️  Transaction hash mismatch detected`);
      console.log(`    Expected: ${withdrawData.unsignedTransactionHash.substring(0, 16)}...`);
      console.log(`    Received: ${receivedTransactionHash.substring(0, 16)}...`);
      return res.status(400).json({
        error: 'Transaction verification failed: transaction has been modified',
        details: 'Transaction structure does not match the original unsigned transaction'
      });
    }
    console.log(`  ✓ Transaction integrity verified (cryptographic hash match)`);

    // Add LP owner signature
    transaction.partialSign(lpOwnerKeypair);

    // Send transaction
    console.log('  Sending transaction...');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });

    console.log('✓ Withdrawal transaction sent');
    console.log(`  Signature: ${signature}`);
    console.log(`  Pool: ${withdrawData.poolAddress}`);
    console.log(`  Withdrawal: ${withdrawData.withdrawalPercentage}%`);
    console.log(`  Solscan: https://solscan.io/tx/${signature}`);

    // Wait for confirmation
    try {
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      });
      console.log(`✓ Withdrawal confirmed: ${signature}`);
    } catch (error) {
      console.error(`⚠ Confirmation timeout for ${signature}:`, error);
    }

    // Clean up
    withdrawRequests.delete(requestId);

    res.json({
      success: true,
      signature,
      poolAddress: withdrawData.poolAddress,
      tokenAMint: withdrawData.tokenAMint,
      tokenBMint: withdrawData.tokenBMint,
      withdrawalPercentage: withdrawData.withdrawalPercentage,
      estimatedAmounts: {
        tokenA: withdrawData.estimatedTokenAAmount,
        tokenB: withdrawData.estimatedTokenBAmount,
        liquidityDelta: withdrawData.liquidityDelta
      },
      message: 'Withdrawal transaction submitted successfully'
    });

  } catch (error) {
    console.error('Withdraw confirm error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to confirm withdrawal'
    });
  } finally {
    if (releaseLock) {
      releaseLock();
    }
  }
});

// ============================================================================
// POST /damm/deposit/build - Build deposit transaction
// ============================================================================

router.post('/deposit/build', dammLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { tokenAAmount, tokenBAmount, poolAddress: poolAddressInput } = req.body;

    console.log('DAMM deposit build request received:', { tokenAAmount, tokenBAmount, poolAddress: poolAddressInput });

    // Validate required fields
    if (tokenAAmount === undefined || tokenBAmount === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: tokenAAmount and tokenBAmount'
      });
    }

    // Validate poolAddress is a valid Solana public key (default to main pool if not provided)
    const DEFAULT_POOL_ADDRESS = 'CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad';
    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput || DEFAULT_POOL_ADDRESS);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid poolAddress: must be a valid Solana public key'
      });
    }

    // Validate amounts are numbers
    if (typeof tokenAAmount !== 'number' || typeof tokenBAmount !== 'number') {
      return res.status(400).json({
        error: 'tokenAAmount and tokenBAmount must be numbers'
      });
    }

    if (tokenAAmount < 0 || tokenBAmount < 0) {
      return res.status(400).json({
        error: 'Token amounts must be non-negative'
      });
    }

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    const LP_OWNER_PRIVATE_KEY = process.env.LP_OWNER_PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;
    const MANAGER_WALLET = process.env.MANAGER_WALLET;

    if (!RPC_URL || !LP_OWNER_PRIVATE_KEY || !MANAGER_WALLET) {
      return res.status(500).json({
        error: 'Server configuration incomplete. Missing required environment variables.'
      });
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const managerWallet = new PublicKey(MANAGER_WALLET);

    // Create CpAmm instance and get pool state
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);

    // Get token info
    const tokenAMint = await getMint(connection, poolState.tokenAMint);
    const tokenBMint = await getMint(connection, poolState.tokenBMint);
    const tokenAProgram = getTokenProgram(tokenAMint.tlvData.length > 0 ? 1 : 0);
    const tokenBProgram = getTokenProgram(tokenBMint.tlvData.length > 0 ? 1 : 0);

    const isTokenBNativeSOL = poolState.tokenBMint.equals(NATIVE_MINT);

    // Convert UI amounts to raw amounts
    const tokenAAmountRaw = new BN(Math.floor(tokenAAmount * Math.pow(10, tokenAMint.decimals)));
    const tokenBAmountRaw = new BN(Math.floor(tokenBAmount * Math.pow(10, tokenBMint.decimals)));

    // Get user positions
    const userPositions = await cpAmm.getUserPositionByPool(poolAddress, lpOwner.publicKey);

    if (userPositions.length === 0) {
      return res.status(404).json({
        error: 'No positions found for the LP owner. Create a position first.'
      });
    }

    const { position, positionNftAccount } = userPositions[0];

    // Calculate liquidity delta
    const currentEpoch = await connection.getEpochInfo().then(e => e.epoch);

    const liquidityDelta = cpAmm.getLiquidityDelta({
      maxAmountTokenA: tokenAAmountRaw,
      maxAmountTokenB: tokenBAmountRaw,
      sqrtPrice: poolState.sqrtPrice,
      sqrtMinPrice: poolState.sqrtMinPrice,
      sqrtMaxPrice: poolState.sqrtMaxPrice,
      tokenAInfo: {
        mint: tokenAMint,
        currentEpoch
      },
      tokenBInfo: {
        mint: tokenBMint,
        currentEpoch
      }
    });

    if (liquidityDelta.isZero()) {
      return res.status(400).json({
        error: 'Deposit amount too small'
      });
    }

    // Build combined transaction
    const combinedTx = new Transaction();
    combinedTx.feePayer = managerWallet;

    const { blockhash } = await connection.getLatestBlockhash();
    combinedTx.recentBlockhash = blockhash;

    // Get ATAs
    const managerTokenAAta = await getAssociatedTokenAddress(
      poolState.tokenAMint,
      managerWallet,
      false,
      tokenAProgram
    );
    const managerTokenBAta = isTokenBNativeSOL ? managerWallet : await getAssociatedTokenAddress(
      poolState.tokenBMint,
      managerWallet,
      false,
      tokenBProgram
    );

    const lpOwnerTokenAAta = await getAssociatedTokenAddress(
      poolState.tokenAMint,
      lpOwner.publicKey,
      false,
      tokenAProgram
    );
    const lpOwnerTokenBAta = isTokenBNativeSOL ? lpOwner.publicKey : await getAssociatedTokenAddress(
      poolState.tokenBMint,
      lpOwner.publicKey,
      false,
      tokenBProgram
    );

    // Create LP owner's ATAs
    combinedTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        managerWallet,
        lpOwnerTokenAAta,
        lpOwner.publicKey,
        poolState.tokenAMint,
        tokenAProgram
      )
    );

    if (!isTokenBNativeSOL) {
      combinedTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          managerWallet,
          lpOwnerTokenBAta,
          lpOwner.publicKey,
          poolState.tokenBMint,
          tokenBProgram
        )
      );
    }

    // Add transfer instructions from manager to LP owner
    if (!tokenAAmountRaw.isZero()) {
      combinedTx.add(
        createTransferInstruction(
          managerTokenAAta,
          lpOwnerTokenAAta,
          managerWallet,
          BigInt(tokenAAmountRaw.toString()),
          [],
          tokenAProgram
        )
      );
    }

    if (!tokenBAmountRaw.isZero()) {
      if (isTokenBNativeSOL) {
        combinedTx.add(
          SystemProgram.transfer({
            fromPubkey: managerWallet,
            toPubkey: lpOwner.publicKey,
            lamports: Number(tokenBAmountRaw.toString())
          })
        );
      } else {
        combinedTx.add(
          createTransferInstruction(
            managerTokenBAta,
            lpOwnerTokenBAta,
            managerWallet,
            BigInt(tokenBAmountRaw.toString()),
            [],
            tokenBProgram
          )
        );
      }
    }

    // Add liquidity to position
    const addLiquidityTx = await cpAmm.addLiquidity({
      owner: lpOwner.publicKey,
      position,
      pool: poolAddress,
      positionNftAccount,
      liquidityDelta,
      maxAmountTokenA: tokenAAmountRaw,
      maxAmountTokenB: tokenBAmountRaw,
      tokenAAmountThreshold: tokenAAmountRaw,
      tokenBAmountThreshold: tokenBAmountRaw,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAProgram,
      tokenBProgram,
    });

    combinedTx.add(...addLiquidityTx.instructions);

    // Serialize unsigned transaction
    const unsignedTransaction = bs58.encode(combinedTx.serialize({ requireAllSignatures: false }));

    // Calculate transaction hash for tamper detection
    const transactionBuffer = combinedTx.serializeMessage();
    const unsignedTransactionHash = crypto.createHash('sha256').update(transactionBuffer).digest('hex');

    // Generate unique request ID
    const requestId = crypto.randomBytes(16).toString('hex');

    console.log('✓ Deposit transaction built successfully');
    console.log(`  Pool: ${poolAddress.toBase58()}`);
    console.log(`  Token A: ${tokenAAmount} (${tokenAAmountRaw.toString()} raw)`);
    console.log(`  Token B: ${tokenBAmount} (${tokenBAmountRaw.toString()} raw)`);
    console.log(`  Liquidity Delta: ${liquidityDelta.toString()}`);
    console.log(`  Request ID: ${requestId}`);
    console.log(`  TX Hash: ${unsignedTransactionHash.substring(0, 16)}...`);

    // Store transaction data
    depositRequests.set(requestId, {
      unsignedTransaction,
      unsignedTransactionHash,
      poolAddress: poolAddress.toBase58(),
      tokenAMint: poolState.tokenAMint.toBase58(),
      tokenBMint: poolState.tokenBMint.toBase58(),
      tokenAVault: poolState.tokenAVault.toBase58(),
      tokenBVault: poolState.tokenBVault.toBase58(),
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: managerWallet.toBase58(),
      tokenAAmount: tokenAAmountRaw.toString(),
      tokenBAmount: tokenBAmountRaw.toString(),
      liquidityDelta: liquidityDelta.toString(),
      timestamp: Date.now()
    });

    res.json({
      success: true,
      transaction: unsignedTransaction,
      requestId,
      poolAddress: poolAddress.toBase58(),
      tokenAMint: poolState.tokenAMint.toBase58(),
      tokenBMint: poolState.tokenBMint.toBase58(),
      isTokenBNativeSOL,
      instructionsCount: combinedTx.instructions.length,
      amounts: {
        tokenA: tokenAAmountRaw.toString(),
        tokenB: tokenBAmountRaw.toString(),
        liquidityDelta: liquidityDelta.toString()
      },
      message: 'Sign this transaction with the manager wallet and submit to /damm/deposit/confirm'
    });

  } catch (error) {
    console.error('Deposit build error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create deposit transaction'
    });
  }
});

// ============================================================================
// POST /damm/deposit/confirm - Confirm and submit deposit transaction
// ============================================================================
/**
 * Security measures:
 * 1. Authority wallet signature - Transaction must be signed by pool's authority wallet (only percent backend has keys)
 * 2. Lock system - Prevents concurrent operations for the same pool
 * 3. Request expiry - 10 minute timeout
 * 4. Blockhash validation - Prevents replay attacks
 * 5. Transaction structure validation - Prevents malicious instruction injection
 * 6. Comprehensive logging
 *
 * Note: User authorization (attestation & whitelist) validated in percent backend before calling this endpoint.
 */

router.post('/deposit/confirm', dammLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransaction, requestId } = req.body;

    console.log('DAMM deposit confirm request received:', { requestId });

    // Validate required fields
    if (!signedTransaction || !requestId) {
      return res.status(400).json({
        error: 'Missing required fields: signedTransaction and requestId'
      });
    }

    // Retrieve request data
    const depositData = depositRequests.get(requestId);
    if (!depositData) {
      return res.status(400).json({
        error: 'Deposit request not found or expired. Please call /damm/deposit/build first.'
      });
    }

    console.log('  Pool:', depositData.poolAddress);
    console.log('  Manager:', depositData.managerAddress);

    // Acquire lock
    releaseLock = await acquireLiquidityLock(depositData.poolAddress);
    console.log('  Lock acquired');

    // Check request age
    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - depositData.timestamp > TEN_MINUTES) {
      depositRequests.delete(requestId);
      return res.status(400).json({
        error: 'Deposit request expired. Please create a new request.'
      });
    }

    // Validate environment
    const RPC_URL = process.env.RPC_URL;
    const LP_OWNER_PRIVATE_KEY = process.env.LP_OWNER_PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;

    if (!RPC_URL || !LP_OWNER_PRIVATE_KEY) {
      return res.status(500).json({
        error: 'Server configuration incomplete'
      });
    }

    // Get pool-specific manager wallet
    let MANAGER_WALLET: string;
    try {
      MANAGER_WALLET = getManagerWalletForPool(depositData.poolAddress);
    } catch (error) {
      return res.status(500).json({
        error: 'Manager wallet configuration error',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Initialize connection
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwnerKeypair = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const managerWalletPubKey = new PublicKey(MANAGER_WALLET);

    // Deserialize transaction
    let transaction: Transaction;
    try {
      const transactionBuffer = bs58.decode(signedTransaction);
      transaction = Transaction.from(transactionBuffer);
    } catch (error) {
      return res.status(400).json({
        error: `Failed to deserialize transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }

    // SECURITY: Validate blockhash
    if (!transaction.recentBlockhash) {
      return res.status(400).json({
        error: 'Invalid transaction: missing blockhash'
      });
    }

    const isBlockhashValid = await connection.isBlockhashValid(
      transaction.recentBlockhash,
      { commitment: 'confirmed' }
    );

    if (!isBlockhashValid) {
      return res.status(400).json({
        error: 'Invalid transaction: blockhash is expired. Please create a new transaction.'
      });
    }

    // SECURITY: Verify fee payer is manager wallet
    if (!transaction.feePayer) {
      return res.status(400).json({
        error: 'Transaction missing fee payer'
      });
    }

    if (!transaction.feePayer.equals(managerWalletPubKey)) {
      return res.status(400).json({
        error: 'Transaction fee payer must be manager wallet'
      });
    }

    // SECURITY: Verify manager wallet has signed
    const managerSignature = transaction.signatures.find(sig =>
      sig.publicKey.equals(managerWalletPubKey)
    );

    if (!managerSignature || !managerSignature.signature) {
      return res.status(400).json({
        error: 'Transaction verification failed: Manager wallet has not signed'
      });
    }

    // Verify manager signature is valid
    const messageData = transaction.serializeMessage();
    const managerSigValid = nacl.sign.detached.verify(
      messageData,
      managerSignature.signature,
      managerSignature.publicKey.toBytes()
    );

    if (!managerSigValid) {
      return res.status(400).json({
        error: 'Transaction verification failed: Invalid manager wallet signature'
      });
    }

    // SECURITY: Verify transaction hasn't been tampered with
    const receivedTransactionHash = crypto.createHash('sha256')
      .update(transaction.serializeMessage())
      .digest('hex');

    if (receivedTransactionHash !== depositData.unsignedTransactionHash) {
      console.log(`  ⚠️  Transaction hash mismatch detected`);
      console.log(`    Expected: ${depositData.unsignedTransactionHash.substring(0, 16)}...`);
      console.log(`    Received: ${receivedTransactionHash.substring(0, 16)}...`);
      return res.status(400).json({
        error: 'Transaction verification failed: transaction has been modified',
        details: 'Transaction structure does not match the original unsigned transaction'
      });
    }
    console.log(`  ✓ Transaction integrity verified (cryptographic hash match)`);

    // Add LP owner signature
    transaction.partialSign(lpOwnerKeypair);

    // Send transaction
    console.log('  Sending transaction...');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });

    console.log('✓ Deposit transaction sent');
    console.log(`  Signature: ${signature}`);
    console.log(`  Pool: ${depositData.poolAddress}`);
    console.log(`  Manager: ${depositData.managerAddress}`);
    console.log(`  LP Owner: ${depositData.lpOwnerAddress}`);
    console.log(`  Token A: ${depositData.tokenAMint} (${depositData.tokenAAmount} raw)`);
    console.log(`  Token B: ${depositData.tokenBMint} (${depositData.tokenBAmount} raw)`);
    console.log(`  Liquidity Delta: ${depositData.liquidityDelta}`);
    console.log(`  Solscan: https://solscan.io/tx/${signature}`);

    // Wait for confirmation
    try {
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      });
      console.log(`✓ Deposit confirmed: ${signature}`);
    } catch (error) {
      console.error(`⚠ Confirmation timeout for ${signature}:`, error);
    }

    // Clean up
    depositRequests.delete(requestId);

    res.json({
      success: true,
      signature,
      poolAddress: depositData.poolAddress,
      tokenAMint: depositData.tokenAMint,
      tokenBMint: depositData.tokenBMint,
      amounts: {
        tokenA: depositData.tokenAAmount,
        tokenB: depositData.tokenBAmount,
        liquidityDelta: depositData.liquidityDelta
      },
      message: 'Deposit transaction submitted successfully'
    });

  } catch (error) {
    console.error('Deposit confirm error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to confirm deposit'
    });
  } finally {
    if (releaseLock) {
      releaseLock();
    }
  }
});

export default router;
