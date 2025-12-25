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
  tokenADecimals: number;
  tokenBDecimals: number;
  lpOwnerAddress: string;
  managerAddress: string;
  // Total amounts transferred from manager to LP owner
  transferredTokenAAmount: string;
  transferredTokenBAmount: string;
  // Amounts actually deposited to DAMM (balanced at pool price)
  depositedTokenAAmount: string;
  depositedTokenBAmount: string;
  // Amounts left over in LP owner wallet (for cleanup)
  leftoverTokenAAmount: string;
  leftoverTokenBAmount: string;
  // Pool price used for balancing
  poolPrice: number; // tokenB per tokenA
  liquidityDelta: string;
  positionAddress: string;
  timestamp: number;
}

interface DammCleanupSwapData {
  unsignedTransaction: string;
  unsignedTransactionHash: string;
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenADecimals: number;
  tokenBDecimals: number;
  lpOwnerAddress: string;
  managerAddress: string;
  // Swap details
  swapInputMint: string;
  swapInputAmount: string;
  swapOutputMint: string;
  swapExpectedOutputAmount: string;
  swapDirection: 'AtoB' | 'BtoA';
  timestamp: number;
}

const withdrawRequests = new Map<string, DammWithdrawData>();
const depositRequests = new Map<string, DammDepositData>();
const cleanupSwapRequests = new Map<string, DammCleanupSwapData>();

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

// Pool address to ticker mapping (shared config)
const poolToTicker: Record<string, string> = {
  '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX': 'OOGWAY',
  'Ez1QYeC95xJRwPA9SR7YWC1H1Tj43exJr91QqKf8Puu1': 'SURF',
  'PS3rPSb49GnAkmh3tec1RQizgNSb1hUwPsYHGGuAy5r': 'SURFTEST',
};

// Whitelisted DAMM pools
const WHITELISTED_DAMM_POOLS = new Set(Object.keys(poolToTicker));

// Restricted LP owner address - never allow cleanup swap or deposit using LP balances for this address
const RESTRICTED_LP_OWNER = 'Hq7Xh37tT4sesD6wA4DphYfxeMJRhhFWS3KVUSSGjqzc';

/**
 * Get the manager wallet address for a specific pool
 * Requires pool-specific MANAGER_WALLET_<TICKER> environment variable
 *
 * @param poolAddress - The DAMM pool address
 * @returns Manager wallet public key string
 * @throws Error if pool not in whitelist or env var not configured
 */
function getManagerWalletForPool(poolAddress: string): string {
  const ticker = poolToTicker[poolAddress];

  if (!ticker) {
    throw new Error(`Pool ${poolAddress} not found in whitelist`);
  }

  const poolSpecificManager = process.env[`MANAGER_WALLET_${ticker}`];
  if (!poolSpecificManager) {
    throw new Error(`MANAGER_WALLET_${ticker} environment variable not configured`);
  }

  console.log(`Using manager wallet for ${ticker}:`, poolSpecificManager);
  return poolSpecificManager;
}

/**
 * Get the LP owner private key for a specific pool
 * Requires pool-specific LP_OWNER_PRIVATE_KEY_<TICKER> environment variable
 *
 * @param poolAddress - The DAMM pool address
 * @returns LP owner private key (base58 encoded)
 * @throws Error if pool not in whitelist or env var not configured
 */
function getLpOwnerPrivateKeyForPool(poolAddress: string): string {
  const ticker = poolToTicker[poolAddress];

  if (!ticker) {
    throw new Error(`Pool ${poolAddress} not found in whitelist`);
  }

  const poolSpecificLpOwner = process.env[`LP_OWNER_PRIVATE_KEY_${ticker}`];
  if (!poolSpecificLpOwner) {
    throw new Error(`LP_OWNER_PRIVATE_KEY_${ticker} environment variable not configured`);
  }

  console.log(`Using LP owner for ${ticker}`);
  return poolSpecificLpOwner;
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

  for (const [requestId, data] of cleanupSwapRequests.entries()) {
    if (now - data.timestamp > FIFTEEN_MINUTES) {
      cleanupSwapRequests.delete(requestId);
    }
  }
}, 5 * 60 * 1000);

// ============================================================================
// GET /damm/pool/:poolAddress/config - Get pool configuration (LP owner, manager)
// ============================================================================
/**
 * Returns the LP owner and manager wallet addresses for a given pool
 * Used by os-percent to know where to transfer tokens before cleanup
 */
router.get('/pool/:poolAddress/config', async (req: Request, res: Response) => {
  try {
    const { poolAddress: poolAddressInput } = req.params;

    // Validate poolAddress is a valid Solana public key
    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch {
      return res.status(400).json({
        error: 'Invalid poolAddress: must be a valid Solana public key'
      });
    }

    // Validate pool is whitelisted
    if (!WHITELISTED_DAMM_POOLS.has(poolAddress.toBase58())) {
      return res.status(403).json({
        error: 'Pool not authorized for liquidity operations'
      });
    }

    // Get LP owner and manager wallet for this pool
    let lpOwnerPrivateKey: string;
    let managerWallet: string;
    try {
      lpOwnerPrivateKey = getLpOwnerPrivateKeyForPool(poolAddress.toBase58());
      managerWallet = getManagerWalletForPool(poolAddress.toBase58());
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Derive LP owner public key from private key
    const lpOwnerKeypair = Keypair.fromSecretKey(bs58.decode(lpOwnerPrivateKey));

    return res.json({
      success: true,
      poolAddress: poolAddress.toBase58(),
      lpOwnerAddress: lpOwnerKeypair.publicKey.toBase58(),
      managerAddress: managerWallet
    });

  } catch (error) {
    console.error('Error fetching pool config:', error);
    return res.status(500).json({
      error: 'Failed to fetch pool configuration',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

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

    // Validate poolAddress is a valid Solana public key
    if (!poolAddressInput) {
      return res.status(400).json({
        error: 'Missing required field: poolAddress'
      });
    }

    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid poolAddress: must be a valid Solana public key'
      });
    }

    // Validate pool is whitelisted
    if (!WHITELISTED_DAMM_POOLS.has(poolAddress.toBase58())) {
      return res.status(403).json({
        error: 'Pool not authorized for liquidity operations'
      });
    }

    // Validate withdrawal percentage (maximum 50%)
    if (typeof withdrawalPercentage !== 'number' || withdrawalPercentage <= 0 || withdrawalPercentage > 50) {
      return res.status(400).json({
        error: 'withdrawalPercentage must be a number between 0 and 50'
      });
    }

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) {
      return res.status(500).json({
        error: 'Server configuration incomplete. Missing RPC_URL.'
      });
    }

    // Get pool-specific LP owner and manager wallet
    let LP_OWNER_PRIVATE_KEY: string;
    let MANAGER_WALLET: string;
    try {
      LP_OWNER_PRIVATE_KEY = getLpOwnerPrivateKeyForPool(poolAddress.toBase58());
      MANAGER_WALLET = getManagerWalletForPool(poolAddress.toBase58());
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const managerWallet = new PublicKey(MANAGER_WALLET);
    const isSameWallet = lpOwner.publicKey.equals(managerWallet);

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

    // Create destination ATAs and transfer instructions (skip if LP owner is manager)
    if (!isSameWallet) {
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
    if (!RPC_URL) {
      return res.status(500).json({
        error: 'Server configuration incomplete. Missing RPC_URL.'
      });
    }

    // Get pool-specific LP owner and manager wallet
    let LP_OWNER_PRIVATE_KEY: string;
    let MANAGER_WALLET: string;
    try {
      LP_OWNER_PRIVATE_KEY = getLpOwnerPrivateKeyForPool(withdrawData.poolAddress);
      MANAGER_WALLET = getManagerWalletForPool(withdrawData.poolAddress);
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
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

    // Validate poolAddress is a valid Solana public key
    if (!poolAddressInput) {
      return res.status(400).json({
        error: 'Missing required field: poolAddress'
      });
    }

    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid poolAddress: must be a valid Solana public key'
      });
    }

    // Validate pool is whitelisted
    if (!WHITELISTED_DAMM_POOLS.has(poolAddress.toBase58())) {
      return res.status(403).json({
        error: 'Pool not authorized for liquidity operations'
      });
    }

    // Determine if we're using LP owner wallet balances (cleanup mode)
    // Cleanup mode: tokenAAmount and tokenBAmount are both 0 or both undefined
    const useCleanupMode = (tokenAAmount === 0 && tokenBAmount === 0) ||
                           (tokenAAmount === undefined && tokenBAmount === undefined);

    // Validate amounts if not in cleanup mode
    if (!useCleanupMode) {
      if (tokenAAmount === undefined || tokenBAmount === undefined) {
        return res.status(400).json({
          error: 'Missing required fields: tokenAAmount and tokenBAmount (or set both to 0 for cleanup mode)'
        });
      }

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
    }

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) {
      return res.status(500).json({
        error: 'Server configuration incomplete. Missing RPC_URL.'
      });
    }

    // Get pool-specific LP owner and manager wallet
    let LP_OWNER_PRIVATE_KEY: string;
    let MANAGER_WALLET: string;
    try {
      LP_OWNER_PRIVATE_KEY = getLpOwnerPrivateKeyForPool(poolAddress.toBase58());
      MANAGER_WALLET = getManagerWalletForPool(poolAddress.toBase58());
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const managerWallet = new PublicKey(MANAGER_WALLET);
    const isSameWallet = lpOwner.publicKey.equals(managerWallet);

    // Create CpAmm instance and get pool state
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);

    // Get token info
    const tokenAMint = await getMint(connection, poolState.tokenAMint);
    const tokenBMint = await getMint(connection, poolState.tokenBMint);
    const tokenAProgram = getTokenProgram(tokenAMint.tlvData.length > 0 ? 1 : 0);
    const tokenBProgram = getTokenProgram(tokenBMint.tlvData.length > 0 ? 1 : 0);

    const isTokenBNativeSOL = poolState.tokenBMint.equals(NATIVE_MINT);

    // Determine deposit amounts - either from request or from LP owner wallet balances
    let tokenAAmountRaw: BN;
    let tokenBAmountRaw: BN;

    if (useCleanupMode) {
      console.log('  Using cleanup mode - reading LP owner wallet balances');

      // SAFETY CHECK: Prevent deposit using LP balances for restricted LP owner address
      if (lpOwner.publicKey.toBase58() === RESTRICTED_LP_OWNER) {
        return res.status(403).json({
          error: 'Deposit operations using LP owner balances are not permitted for this LP owner address'
        });
      }

      // Get LP owner token balances
      const lpOwnerTokenAAta = await getAssociatedTokenAddress(poolState.tokenAMint, lpOwner.publicKey, false, tokenAProgram);
      const lpOwnerTokenBAta = isTokenBNativeSOL ? lpOwner.publicKey : await getAssociatedTokenAddress(poolState.tokenBMint, lpOwner.publicKey, false, tokenBProgram);

      tokenAAmountRaw = new BN(0);
      tokenBAmountRaw = new BN(0);

      try {
        const tokenAAccount = await connection.getTokenAccountBalance(lpOwnerTokenAAta);
        tokenAAmountRaw = new BN(tokenAAccount.value.amount);
      } catch {
        // Account doesn't exist or has 0 balance
      }

      try {
        if (isTokenBNativeSOL) {
          const solBalance = await connection.getBalance(lpOwner.publicKey);
          // Reserve SOL for transaction fees + rent for new accounts (0.1 SOL)
          const reserveForFees = 100_000_000;
          tokenBAmountRaw = new BN(Math.max(0, solBalance - reserveForFees));
        } else {
          const tokenBAccount = await connection.getTokenAccountBalance(lpOwnerTokenBAta);
          tokenBAmountRaw = new BN(tokenBAccount.value.amount);
        }
      } catch {
        // Account doesn't exist or has 0 balance
      }

      console.log(`  LP Owner A Balance: ${tokenAAmountRaw.toString()}`);
      console.log(`  LP Owner B Balance: ${tokenBAmountRaw.toString()}`);

      if (tokenAAmountRaw.isZero() && tokenBAmountRaw.isZero()) {
        return res.status(400).json({
          error: 'No tokens available in LP owner wallet for cleanup deposit'
        });
      }
    } else {
      // Convert UI amounts to raw amounts
      tokenAAmountRaw = new BN(Math.floor((tokenAAmount as number) * Math.pow(10, tokenAMint.decimals)));
      tokenBAmountRaw = new BN(Math.floor((tokenBAmount as number) * Math.pow(10, tokenBMint.decimals)));
    }

    // Get user positions
    const userPositions = await cpAmm.getUserPositionByPool(poolAddress, lpOwner.publicKey);

    if (userPositions.length === 0) {
      return res.status(404).json({
        error: 'No positions found for the LP owner. Create a position first.'
      });
    }

    const { position, positionNftAccount } = userPositions[0];

    // Calculate pool price from sqrtPrice (Q64.64 format)
    // price = (sqrtPrice / 2^64)^2
    const sqrtPriceNum = Number(poolState.sqrtPrice.toString());
    const Q64 = Math.pow(2, 64);
    const poolPrice = Math.pow(sqrtPriceNum / Q64, 2);

    console.log(`  Pool price: ${poolPrice} B per A`);

    // Calculate balanced deposit amounts using getDepositQuote
    const currentEpoch = await connection.getEpochInfo().then(e => e.epoch);

    // Try depositing all of token A first
    const quoteFromA = cpAmm.getDepositQuote({
      inAmount: tokenAAmountRaw,
      isTokenA: true,
      inputTokenInfo: { mint: tokenAMint, currentEpoch },
      outputTokenInfo: { mint: tokenBMint, currentEpoch },
      minSqrtPrice: poolState.sqrtMinPrice,
      maxSqrtPrice: poolState.sqrtMaxPrice,
      sqrtPrice: poolState.sqrtPrice
    });

    let depositTokenAAmount: BN;
    let depositTokenBAmount: BN;
    let leftoverTokenAAmount: BN;
    let leftoverTokenBAmount: BN;
    let liquidityDelta: BN;

    // Check if we can deposit all A with matching B
    if (quoteFromA.outputAmount.lte(tokenBAmountRaw)) {
      // Use all A, matching B amount, leave excess B
      depositTokenAAmount = tokenAAmountRaw;
      depositTokenBAmount = quoteFromA.outputAmount;
      leftoverTokenAAmount = new BN(0);
      leftoverTokenBAmount = tokenBAmountRaw.sub(quoteFromA.outputAmount);
      liquidityDelta = quoteFromA.liquidityDelta;
      console.log(`  Case: Excess tokenB - leaving ${leftoverTokenBAmount.toString()} B in LP wallet`);
    } else {
      // Use all B, matching A amount, leave excess A
      const quoteFromB = cpAmm.getDepositQuote({
        inAmount: tokenBAmountRaw,
        isTokenA: false,
        inputTokenInfo: { mint: tokenBMint, currentEpoch },
        outputTokenInfo: { mint: tokenAMint, currentEpoch },
        minSqrtPrice: poolState.sqrtMinPrice,
        maxSqrtPrice: poolState.sqrtMaxPrice,
        sqrtPrice: poolState.sqrtPrice
      });
      depositTokenAAmount = quoteFromB.outputAmount;
      depositTokenBAmount = tokenBAmountRaw;
      leftoverTokenAAmount = tokenAAmountRaw.sub(quoteFromB.outputAmount);
      leftoverTokenBAmount = new BN(0);
      liquidityDelta = quoteFromB.liquidityDelta;
      console.log(`  Case: Excess tokenA - leaving ${leftoverTokenAAmount.toString()} A in LP wallet`);
    }

    console.log(`  Deposit A: ${depositTokenAAmount.toString()}`);
    console.log(`  Deposit B: ${depositTokenBAmount.toString()}`);
    console.log(`  Leftover A: ${leftoverTokenAAmount.toString()}`);
    console.log(`  Leftover B: ${leftoverTokenBAmount.toString()}`);
    console.log(`  Liquidity Delta: ${liquidityDelta.toString()}`);

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
    // Skip if: same wallet, or cleanup mode (tokens already in LP owner wallet)
    if (!isSameWallet && !useCleanupMode) {
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
    }

    // Add liquidity to position (using balanced deposit amounts)
    const addLiquidityTx = await cpAmm.addLiquidity({
      owner: lpOwner.publicKey,
      position,
      pool: poolAddress,
      positionNftAccount,
      liquidityDelta,
      // Match Meteora UI: thresholds = deposit amounts + 0.09% buffer
      maxAmountTokenA: depositTokenAAmount.muln(10009).divn(10000),
      maxAmountTokenB: depositTokenBAmount.muln(10009).divn(10000),
      tokenAAmountThreshold: depositTokenAAmount.muln(10009).divn(10000),
      tokenBAmountThreshold: depositTokenBAmount.muln(10009).divn(10000),
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
    console.log(`  Transferred: ${tokenAAmountRaw.toString()} A, ${tokenBAmountRaw.toString()} B`);
    console.log(`  Deposited: ${depositTokenAAmount.toString()} A, ${depositTokenBAmount.toString()} B`);
    console.log(`  Leftover: ${leftoverTokenAAmount.toString()} A, ${leftoverTokenBAmount.toString()} B`);
    console.log(`  Pool Price: ${poolPrice}`);
    console.log(`  Liquidity Delta: ${liquidityDelta.toString()}`);
    console.log(`  Request ID: ${requestId}`);

    const hasLeftover = !leftoverTokenAAmount.isZero() || !leftoverTokenBAmount.isZero();

    // Store transaction data
    depositRequests.set(requestId, {
      unsignedTransaction,
      unsignedTransactionHash,
      poolAddress: poolAddress.toBase58(),
      tokenAMint: poolState.tokenAMint.toBase58(),
      tokenBMint: poolState.tokenBMint.toBase58(),
      tokenADecimals: tokenAMint.decimals,
      tokenBDecimals: tokenBMint.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: managerWallet.toBase58(),
      transferredTokenAAmount: tokenAAmountRaw.toString(),
      transferredTokenBAmount: tokenBAmountRaw.toString(),
      depositedTokenAAmount: depositTokenAAmount.toString(),
      depositedTokenBAmount: depositTokenBAmount.toString(),
      leftoverTokenAAmount: leftoverTokenAAmount.toString(),
      leftoverTokenBAmount: leftoverTokenBAmount.toString(),
      poolPrice,
      liquidityDelta: liquidityDelta.toString(),
      positionAddress: position.toBase58(),
      timestamp: Date.now()
    });

    res.json({
      success: true,
      transaction: unsignedTransaction,
      requestId,
      poolAddress: poolAddress.toBase58(),
      tokenAMint: poolState.tokenAMint.toBase58(),
      tokenBMint: poolState.tokenBMint.toBase58(),
      tokenADecimals: tokenAMint.decimals,
      tokenBDecimals: tokenBMint.decimals,
      isTokenBNativeSOL,
      cleanupMode: useCleanupMode,
      poolPrice,
      hasLeftover,
      transferred: {
        tokenA: tokenAAmountRaw.toString(),
        tokenB: tokenBAmountRaw.toString(),
      },
      deposited: {
        tokenA: depositTokenAAmount.toString(),
        tokenB: depositTokenBAmount.toString(),
        liquidityDelta: liquidityDelta.toString()
      },
      leftover: {
        tokenA: leftoverTokenAAmount.toString(),
        tokenB: leftoverTokenBAmount.toString(),
      },
      message: hasLeftover
        ? 'Sign this transaction with the manager wallet and submit to /damm/deposit/confirm. Note: leftover tokens will remain in LP owner wallet for cleanup.'
        : 'Sign this transaction with the manager wallet and submit to /damm/deposit/confirm'
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
    if (!RPC_URL) {
      return res.status(500).json({
        error: 'Server configuration incomplete. Missing RPC_URL.'
      });
    }

    // Get pool-specific LP owner and manager wallet
    let LP_OWNER_PRIVATE_KEY: string;
    let MANAGER_WALLET: string;
    try {
      LP_OWNER_PRIVATE_KEY = getLpOwnerPrivateKeyForPool(depositData.poolAddress);
      MANAGER_WALLET = getManagerWalletForPool(depositData.poolAddress);
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
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
    console.log(`  Transferred: ${depositData.transferredTokenAAmount} A, ${depositData.transferredTokenBAmount} B`);
    console.log(`  Deposited: ${depositData.depositedTokenAAmount} A, ${depositData.depositedTokenBAmount} B`);
    console.log(`  Leftover: ${depositData.leftoverTokenAAmount} A, ${depositData.leftoverTokenBAmount} B`);
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

    const hasLeftover = depositData.leftoverTokenAAmount !== '0' || depositData.leftoverTokenBAmount !== '0';

    res.json({
      success: true,
      signature,
      poolAddress: depositData.poolAddress,
      tokenAMint: depositData.tokenAMint,
      tokenBMint: depositData.tokenBMint,
      tokenADecimals: depositData.tokenADecimals,
      tokenBDecimals: depositData.tokenBDecimals,
      poolPrice: depositData.poolPrice,
      hasLeftover,
      transferred: {
        tokenA: depositData.transferredTokenAAmount,
        tokenB: depositData.transferredTokenBAmount,
      },
      deposited: {
        tokenA: depositData.depositedTokenAAmount,
        tokenB: depositData.depositedTokenBAmount,
        liquidityDelta: depositData.liquidityDelta
      },
      leftover: {
        tokenA: depositData.leftoverTokenAAmount,
        tokenB: depositData.leftoverTokenBAmount,
      },
      message: hasLeftover
        ? 'Deposit transaction submitted successfully. Leftover tokens remain in LP owner wallet for cleanup.'
        : 'Deposit transaction submitted successfully'
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

// ============================================================================
// POST /damm/cleanup/swap/build - Build swap transaction for leftover tokens
// ============================================================================
/**
 * Cleanup swap endpoint - Step 1 of cleanup process
 *
 * This endpoint:
 * 1. Reads LP owner's token balances
 * 2. Determines which token is in excess based on pool price
 * 3. Fetches Jupiter quote for swapping excess token
 * 4. Returns unsigned swap transaction for manager to sign
 */
router.post('/cleanup/swap/build', dammLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { poolAddress: poolAddressInput } = req.body;

    console.log('DAMM cleanup swap build request received:', { poolAddress: poolAddressInput });

    // Validate poolAddress
    if (!poolAddressInput) {
      return res.status(400).json({
        error: 'Missing required field: poolAddress'
      });
    }

    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch {
      return res.status(400).json({
        error: 'Invalid poolAddress: must be a valid Solana public key'
      });
    }

    // Validate pool is whitelisted
    if (!WHITELISTED_DAMM_POOLS.has(poolAddress.toBase58())) {
      return res.status(403).json({
        error: 'Pool not authorized for liquidity operations'
      });
    }

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    const JUP_API_KEY = process.env.JUP_API_KEY;
    if (!RPC_URL) {
      return res.status(500).json({
        error: 'Server configuration incomplete. Missing RPC_URL.'
      });
    }

    // Get pool-specific LP owner and manager wallet
    let LP_OWNER_PRIVATE_KEY: string;
    let MANAGER_WALLET: string;
    try {
      LP_OWNER_PRIVATE_KEY = getLpOwnerPrivateKeyForPool(poolAddress.toBase58());
      MANAGER_WALLET = getManagerWalletForPool(poolAddress.toBase58());
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const manager = new PublicKey(MANAGER_WALLET);

    // SAFETY CHECK: Prevent cleanup swap for restricted LP owner address
    if (lpOwner.publicKey.toBase58() === RESTRICTED_LP_OWNER) {
      return res.status(403).json({
        error: 'Cleanup swap operations are not permitted for this LP owner address'
      });
    }

    // Create CpAmm instance and get pool state
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);

    const tokenAMint = poolState.tokenAMint;
    const tokenBMint = poolState.tokenBMint;

    // Get token mint info
    const tokenAMintInfo = await getMint(connection, tokenAMint);
    const tokenBMintInfo = await getMint(connection, tokenBMint);
    const tokenAProgram = getTokenProgram(tokenAMintInfo.tlvData.length > 0 ? 1 : 0);
    const tokenBProgram = getTokenProgram(tokenBMintInfo.tlvData.length > 0 ? 1 : 0);
    const isTokenBNativeSOL = tokenBMint.equals(NATIVE_MINT);

    console.log(`  Token A Mint: ${tokenAMint.toBase58()} (decimals: ${tokenAMintInfo.decimals})`);
    console.log(`  Token B Mint: ${tokenBMint.toBase58()} (decimals: ${tokenBMintInfo.decimals})`);

    // Get LP owner token balances
    const lpOwnerTokenAAta = await getAssociatedTokenAddress(tokenAMint, lpOwner.publicKey, false, tokenAProgram);
    const lpOwnerTokenBAta = isTokenBNativeSOL ? lpOwner.publicKey : await getAssociatedTokenAddress(tokenBMint, lpOwner.publicKey, false, tokenBProgram);

    let tokenABalance = new BN(0);
    let tokenBBalance = new BN(0);

    try {
      const tokenAAccount = await connection.getTokenAccountBalance(lpOwnerTokenAAta);
      tokenABalance = new BN(tokenAAccount.value.amount);
    } catch {
      // Account doesn't exist or has 0 balance
    }

    try {
      if (isTokenBNativeSOL) {
        // For native SOL, check the account balance
        const solBalance = await connection.getBalance(lpOwner.publicKey);
        // Reserve SOL for transaction fees + rent for new accounts (0.1 SOL)
        const reserveForFees = 100_000_000; // 0.1 SOL in lamports
        tokenBBalance = new BN(Math.max(0, solBalance - reserveForFees));
      } else {
        const tokenBAccount = await connection.getTokenAccountBalance(lpOwnerTokenBAta);
        tokenBBalance = new BN(tokenBAccount.value.amount);
      }
    } catch {
      // Account doesn't exist or has 0 balance
    }

    console.log(`  LP Owner A Balance: ${tokenABalance.toString()}`);
    console.log(`  LP Owner B Balance: ${tokenBBalance.toString()}`);

    // Check if there's anything to clean up
    if (tokenABalance.isZero() && tokenBBalance.isZero()) {
      return res.status(400).json({
        error: 'No leftover tokens to clean up',
        balances: {
          tokenA: '0',
          tokenB: '0'
        }
      });
    }

    // Calculate pool price from sqrtPrice
    // sqrtPrice is in Q64.64 format, so actual price = (sqrtPrice / 2^64)^2
    const sqrtPriceNum = Number(poolState.sqrtPrice.toString());
    const Q64 = Math.pow(2, 64);
    const poolPrice = Math.pow(sqrtPriceNum / Q64, 2);

    console.log(`  Pool Price: ${poolPrice} (B per A)`);

    // Determine which token is in excess and needs to be swapped
    const tokenADecimal = Number(tokenABalance.toString()) / Math.pow(10, tokenAMintInfo.decimals);
    const tokenBDecimal = Number(tokenBBalance.toString()) / Math.pow(10, tokenBMintInfo.decimals);

    // Calculate what we'd need of each token for a balanced deposit
    // At price P (B per A): B = A * P
    const neededBForAllA = tokenADecimal * poolPrice;
    const neededAForAllB = tokenBDecimal / poolPrice;

    let swapInputMint: PublicKey;
    let swapOutputMint: PublicKey;
    let swapInputAmount: BN;
    let swapDirection: 'AtoB' | 'BtoA';

    if (neededBForAllA > tokenBDecimal) {
      // We have excess A, need to swap some A for B
      // Swap HALF the excess - heuristic to account for price impact moving toward our ratio
      const excessADecimal = tokenADecimal - neededAForAllB;
      const swapADecimal = excessADecimal / 2;
      swapInputAmount = new BN(Math.floor(swapADecimal * Math.pow(10, tokenAMintInfo.decimals)));
      swapInputMint = tokenAMint;
      swapOutputMint = tokenBMint;
      swapDirection = 'AtoB';
      console.log(`  Swap direction: A → B (excess: ${excessADecimal}, swapping half: ${swapADecimal} A)`);
    } else {
      // We have excess B, need to swap some B for A
      // Swap HALF the excess - heuristic to account for price impact moving toward our ratio
      const excessBDecimal = tokenBDecimal - neededBForAllA;
      const swapBDecimal = excessBDecimal / 2;
      swapInputAmount = new BN(Math.floor(swapBDecimal * Math.pow(10, tokenBMintInfo.decimals)));
      swapInputMint = tokenBMint;
      swapOutputMint = tokenAMint;
      swapDirection = 'BtoA';
      console.log(`  Swap direction: B → A (excess: ${excessBDecimal}, swapping half: ${swapBDecimal} B)`);
    }

    if (swapInputAmount.isZero()) {
      return res.status(400).json({
        error: 'Leftover amounts are too small to warrant cleanup',
        balances: {
          tokenA: tokenABalance.toString(),
          tokenB: tokenBBalance.toString()
        }
      });
    }

    // Fetch Jupiter quote with timeout and fallback
    const jupiterHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (JUP_API_KEY) {
      jupiterHeaders['x-api-key'] = JUP_API_KEY;
    }

    // Helper to fetch with timeout
    const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number = 10000) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeout);
        return response;
      } catch (error: any) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw error;
      }
    };

    let swapTransaction: Transaction;
    let expectedOutputAmount: string;
    let swapSource: 'jupiter' | 'damm';

    try {
      console.log('  Fetching Jupiter quote...');
      const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${swapInputMint.toBase58()}&outputMint=${swapOutputMint.toBase58()}&amount=${swapInputAmount.toString()}&slippageBps=500&asLegacyTransaction=true`;

      const quoteResponse = await fetchWithTimeout(quoteUrl, { headers: jupiterHeaders }, 10000);

      if (!quoteResponse.ok) {
        const errorText = await quoteResponse.text();
        console.log(`  Jupiter quote failed: ${quoteResponse.status} - ${errorText}`);
        throw new Error(`Jupiter quote failed: ${quoteResponse.status}`);
      }

      const quoteData = await quoteResponse.json();

      // Check for "no route" error
      if (quoteData.error || quoteData.errorCode) {
        console.log(`  Jupiter quote error: ${quoteData.error || quoteData.errorCode}`);
        throw new Error(`Jupiter: ${quoteData.error || quoteData.errorCode}`);
      }

      expectedOutputAmount = quoteData.outAmount;
      console.log(`  Jupiter quote: ${swapInputAmount.toString()} → ${expectedOutputAmount}`);

      // Fetch Jupiter swap transaction
      console.log('  Fetching Jupiter swap transaction...');
      const swapResponse = await fetchWithTimeout('https://api.jup.ag/swap/v1/swap', {
        method: 'POST',
        headers: jupiterHeaders,
        body: JSON.stringify({
          quoteResponse: quoteData,
          userPublicKey: lpOwner.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto',
          asLegacyTransaction: true
        })
      }, 15000);

      if (!swapResponse.ok) {
        const errorText = await swapResponse.text();
        console.log(`  Jupiter swap failed: ${swapResponse.status} - ${errorText}`);
        throw new Error(`Jupiter swap failed: ${swapResponse.status}`);
      }

      const swapData = await swapResponse.json();
      const swapTransactionBase64 = swapData.swapTransaction;

      // Decode the swap transaction
      const swapTransactionBuffer = Buffer.from(swapTransactionBase64, 'base64');
      swapTransaction = Transaction.from(swapTransactionBuffer);

      // Set transaction properties
      const { blockhash } = await connection.getLatestBlockhash();
      swapTransaction.recentBlockhash = blockhash;
      swapTransaction.feePayer = manager;
      swapSource = 'jupiter';
      console.log('  ✓ Jupiter swap transaction built successfully');

    } catch (jupiterError: any) {
      // Fallback to direct DAMM swap
      console.log(`  Jupiter failed: ${jupiterError.message}`);
      console.log('  Falling back to direct DAMM swap...');

      try {
        // Get current slot and time for quote
        const slot = await connection.getSlot();
        const blockTime = await connection.getBlockTime(slot);
        const currentTime = blockTime || Math.floor(Date.now() / 1000);

        // Get swap quote from DAMM
        const swapQuote = cpAmm.getQuote({
          inAmount: swapInputAmount,
          inputTokenMint: swapInputMint,
          slippage: 5, // 5% slippage
          poolState,
          currentTime,
          currentSlot: slot,
          tokenADecimal: tokenAMintInfo.decimals,
          tokenBDecimal: tokenBMintInfo.decimals,
        });

        expectedOutputAmount = swapQuote.swapOutAmount.toString();
        console.log(`  DAMM quote: ${swapInputAmount.toString()} → ${expectedOutputAmount}`);

        // Build DAMM swap transaction
        swapTransaction = await cpAmm.swap({
          payer: lpOwner.publicKey,
          pool: poolAddress,
          inputTokenMint: swapInputMint,
          outputTokenMint: swapOutputMint,
          amountIn: swapInputAmount,
          minimumAmountOut: swapQuote.minSwapOutAmount,
          tokenAMint: tokenAMint,
          tokenBMint: tokenBMint,
          tokenAVault: poolState.tokenAVault,
          tokenBVault: poolState.tokenBVault,
          tokenAProgram,
          tokenBProgram,
          referralTokenAccount: null,
        });

        // Set transaction properties
        const { blockhash } = await connection.getLatestBlockhash();
        swapTransaction.recentBlockhash = blockhash;
        swapTransaction.feePayer = manager;
        swapSource = 'damm';
        console.log('  ✓ DAMM swap transaction built successfully');

      } catch (dammError: any) {
        console.log(`  DAMM swap also failed: ${dammError.message}`);
        return res.status(500).json({
          error: 'Both Jupiter and DAMM swap failed',
          jupiterError: jupiterError.message,
          dammError: dammError.message
        });
      }
    }

    // Serialize transaction
    const unsignedSwapTx = bs58.encode(swapTransaction.serialize({ requireAllSignatures: false }));
    const swapTxHash = crypto.createHash('sha256').update(swapTransaction.serializeMessage()).digest('hex');

    // Generate request ID
    const requestId = crypto.randomBytes(16).toString('hex');

    console.log(`✓ DAMM cleanup swap transaction built successfully (via ${swapSource.toUpperCase()})`);
    console.log(`  Pool: ${poolAddress.toBase58()}`);
    console.log(`  Swap: ${swapInputAmount.toString()} ${swapDirection === 'AtoB' ? 'A→B' : 'B→A'}`);
    console.log(`  Expected output: ${expectedOutputAmount}`);
    console.log(`  Swap source: ${swapSource}`);
    console.log(`  Request ID: ${requestId}`);

    // Store request data
    cleanupSwapRequests.set(requestId, {
      unsignedTransaction: unsignedSwapTx,
      unsignedTransactionHash: swapTxHash,
      poolAddress: poolAddress.toBase58(),
      tokenAMint: tokenAMint.toBase58(),
      tokenBMint: tokenBMint.toBase58(),
      tokenADecimals: tokenAMintInfo.decimals,
      tokenBDecimals: tokenBMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: manager.toBase58(),
      swapInputMint: swapInputMint.toBase58(),
      swapInputAmount: swapInputAmount.toString(),
      swapOutputMint: swapOutputMint.toBase58(),
      swapExpectedOutputAmount: expectedOutputAmount,
      swapDirection,
      timestamp: Date.now()
    });

    return res.json({
      success: true,
      transaction: unsignedSwapTx,
      requestId,
      poolAddress: poolAddress.toBase58(),
      tokenAMint: tokenAMint.toBase58(),
      tokenBMint: tokenBMint.toBase58(),
      tokenADecimals: tokenAMintInfo.decimals,
      tokenBDecimals: tokenBMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: manager.toBase58(),
      poolPrice,
      balances: {
        tokenA: tokenABalance.toString(),
        tokenB: tokenBBalance.toString(),
      },
      swap: {
        inputMint: swapInputMint.toBase58(),
        inputAmount: swapInputAmount.toString(),
        outputMint: swapOutputMint.toBase58(),
        expectedOutputAmount,
        direction: swapDirection
      },
      message: 'Sign this transaction with the manager wallet and submit to /damm/cleanup/swap/confirm. After swap completes, call /damm/deposit/build with tokenAAmount=0 and tokenBAmount=0 to deposit LP owner wallet balances.'
    });

  } catch (error) {
    console.error('Error building DAMM cleanup swap transaction:', error);
    return res.status(500).json({
      error: 'Failed to build cleanup swap transaction',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// ============================================================================
// POST /damm/cleanup/swap/confirm - Confirm and submit swap transaction
// ============================================================================
/**
 * Cleanup swap confirm - Step 2 of cleanup process
 *
 * Security measures:
 * 1. Manager wallet signature verification
 * 2. Lock system - Prevents concurrent operations
 * 3. Request expiry - 10 minute timeout
 * 4. Transaction hash validation - Prevents tampering
 */
router.post('/cleanup/swap/confirm', dammLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransaction, requestId } = req.body;

    console.log('DAMM cleanup swap confirm request received:', { requestId });

    // Validate required fields
    if (!signedTransaction || !requestId) {
      return res.status(400).json({
        error: 'Missing required fields: signedTransaction and requestId'
      });
    }

    // Retrieve request data
    const requestData = cleanupSwapRequests.get(requestId);
    if (!requestData) {
      return res.status(400).json({
        error: 'Cleanup swap request not found or expired. Please call /damm/cleanup/swap/build first.'
      });
    }

    console.log('  Pool:', requestData.poolAddress);
    console.log('  Manager:', requestData.managerAddress);
    console.log('  LP Owner:', requestData.lpOwnerAddress);

    // Acquire lock
    releaseLock = await acquireLiquidityLock(requestData.poolAddress);
    console.log('  Lock acquired');

    // Check request age
    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - requestData.timestamp > TEN_MINUTES) {
      cleanupSwapRequests.delete(requestId);
      return res.status(400).json({
        error: 'Cleanup swap request expired. Please create a new request.'
      });
    }

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    let LP_OWNER_PRIVATE_KEY: string;

    try {
      LP_OWNER_PRIVATE_KEY = getLpOwnerPrivateKeyForPool(requestData.poolAddress);
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Initialize connection
    const connection = new Connection(RPC_URL!, 'confirmed');
    const lpOwnerKeypair = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const managerWalletPubKey = new PublicKey(requestData.managerAddress);

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

    if (receivedTransactionHash !== requestData.unsignedTransactionHash) {
      console.log('  ⚠️  Transaction hash mismatch detected');
      return res.status(400).json({
        error: 'Transaction verification failed: transaction has been modified'
      });
    }
    console.log('  ✓ Transaction integrity verified');

    // Add LP owner signature
    transaction.partialSign(lpOwnerKeypair);

    // Send transaction
    console.log('  Sending swap transaction...');
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });

    console.log(`  ✓ Swap transaction sent: ${signature}`);

    // Wait for confirmation
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    try {
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      });
      console.log(`  ✓ Swap confirmed: ${signature}`);
    } catch (error) {
      console.error(`  ⚠ Swap confirmation timeout for ${signature}:`, error);
    }

    console.log('✓ DAMM cleanup swap completed');
    console.log(`  Signature: ${signature}`);
    console.log(`  Pool: ${requestData.poolAddress}`);

    // Clean up
    cleanupSwapRequests.delete(requestId);

    res.json({
      success: true,
      signature,
      poolAddress: requestData.poolAddress,
      tokenAMint: requestData.tokenAMint,
      tokenBMint: requestData.tokenBMint,
      swap: {
        inputMint: requestData.swapInputMint,
        inputAmount: requestData.swapInputAmount,
        outputMint: requestData.swapOutputMint,
        expectedOutputAmount: requestData.swapExpectedOutputAmount,
        direction: requestData.swapDirection
      },
      message: 'Swap transaction submitted successfully. Call /damm/deposit/build with tokenAAmount=0 and tokenBAmount=0 to deposit LP owner wallet balances.'
    });

  } catch (error) {
    console.error('DAMM cleanup swap confirm error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to confirm cleanup swap'
    });
  } finally {
    if (releaseLock) {
      releaseLock();
    }
  }
});

export default router;
