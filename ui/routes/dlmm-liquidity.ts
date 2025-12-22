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
  createSyncNativeInstruction,
  NATIVE_MINT
} from '@solana/spl-token';
import bs58 from 'bs58';
import BN from 'bn.js';
import DLMM from '@meteora-ag/dlmm';
import rateLimit from 'express-rate-limit';

/**
 * DLMM Liquidity Routes
 *
 * Express router for Meteora DLMM liquidity management endpoints
 * Handles withdrawal and deposit operations with manager wallet authorization
 */

const router = Router();

// Rate limiter for DLMM liquidity endpoints
const dlmmLiquidityLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 requests per 5 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many liquidity requests, please wait a moment.'
});

// In-memory storage for liquidity transactions
interface DlmmWithdrawData {
  unsignedTransactions: string[];
  unsignedTransactionHashes: string[];
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  lpOwnerAddress: string;
  managerAddress: string;
  destinationAddress: string;
  estimatedTokenXAmount: string;
  estimatedTokenYAmount: string;
  positionAddress: string;
  fromBinId: number;
  toBinId: number;
  withdrawalPercentage: number;
  timestamp: number;
}

interface DlmmDepositData {
  unsignedTransaction: string;
  unsignedTransactionHash: string;
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  lpOwnerAddress: string;
  managerAddress: string;
  tokenXAmount: string;
  tokenYAmount: string;
  positionAddress: string;
  timestamp: number;
}

const withdrawRequests = new Map<string, DlmmWithdrawData>();
const depositRequests = new Map<string, DlmmDepositData>();

// Mutex locks for preventing concurrent processing
const liquidityLocks = new Map<string, Promise<void>>();

/**
 * Acquire a liquidity lock for a specific pool
 */
async function acquireLiquidityLock(poolAddress: string): Promise<() => void> {
  const key = poolAddress.toLowerCase();

  while (liquidityLocks.has(key)) {
    await liquidityLocks.get(key);
  }

  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  liquidityLocks.set(key, lockPromise);

  return () => {
    liquidityLocks.delete(key);
    releaseLock!();
  };
}

// Pool address to ticker mapping (whitelist)
const poolToTicker: Record<string, string> = {
  '7jbhVZcYqCRmciBcZzK8L5B96Pyw7i1SpXQFKBkzD3G2': 'ZC',
};

// Whitelisted DLMM pools
const WHITELISTED_DLMM_POOLS = new Set(Object.keys(poolToTicker));

/**
 * Get the manager wallet address for a specific pool
 * Uses same env var naming as DAMM: MANAGER_WALLET_<TICKER>
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
 * Uses same env var naming as DAMM: LP_OWNER_PRIVATE_KEY_<TICKER>
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
}, 5 * 60 * 1000);

// ============================================================================
// POST /dlmm/withdraw/build - Build withdrawal transaction
// ============================================================================

router.post('/withdraw/build', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { withdrawalPercentage, poolAddress: poolAddressInput } = req.body;

    console.log('DLMM withdraw build request received:', { withdrawalPercentage, poolAddress: poolAddressInput });

    // Validate required fields
    if (withdrawalPercentage === undefined || withdrawalPercentage === null) {
      return res.status(400).json({
        error: 'Missing required field: withdrawalPercentage'
      });
    }

    if (!poolAddressInput) {
      return res.status(400).json({
        error: 'Missing required field: poolAddress'
      });
    }

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
    if (!WHITELISTED_DLMM_POOLS.has(poolAddress.toBase58())) {
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

    // Create DLMM instance
    console.log('Creating DLMM instance...');
    const dlmmPool = await DLMM.create(connection, poolAddress);

    // Get pool state
    const lbPair = dlmmPool.lbPair;
    const tokenXMint = lbPair.tokenXMint;
    const tokenYMint = lbPair.tokenYMint;

    console.log(`  Token X Mint: ${tokenXMint.toBase58()}`);
    console.log(`  Token Y Mint: ${tokenYMint.toBase58()}`);

    // Get user positions
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(lpOwner.publicKey);

    if (userPositions.length === 0) {
      return res.status(404).json({
        error: 'No positions found for the LP owner in this pool'
      });
    }

    // Use first position
    const position = userPositions[0];
    const positionData = position.positionData;

    if (!positionData.totalXAmount || !positionData.totalYAmount) {
      return res.status(400).json({
        error: 'Position has no liquidity'
      });
    }

    const totalXAmount = new BN(positionData.totalXAmount);
    const totalYAmount = new BN(positionData.totalYAmount);

    if (totalXAmount.isZero() && totalYAmount.isZero()) {
      return res.status(400).json({
        error: 'No liquidity in position'
      });
    }

    console.log(`  Position: ${position.publicKey.toBase58()}`);
    console.log(`  Total X Amount: ${totalXAmount.toString()}`);
    console.log(`  Total Y Amount: ${totalYAmount.toString()}`);
    console.log(`  Lower Bin ID: ${positionData.lowerBinId}`);
    console.log(`  Upper Bin ID: ${positionData.upperBinId}`);

    // Calculate estimated withdrawal amounts
    const withdrawBps = Math.floor(withdrawalPercentage * 100); // Convert % to bps (50% = 5000)
    const estimatedTokenXAmount = totalXAmount.muln(withdrawBps).divn(10000);
    const estimatedTokenYAmount = totalYAmount.muln(withdrawBps).divn(10000);

    console.log(`  Withdrawal BPS: ${withdrawBps}`);
    console.log(`  Estimated X withdrawal: ${estimatedTokenXAmount.toString()}`);
    console.log(`  Estimated Y withdrawal: ${estimatedTokenYAmount.toString()}`);

    // Build remove liquidity transaction
    const removeLiquidityTxs = await dlmmPool.removeLiquidity({
      user: lpOwner.publicKey,
      position: position.publicKey,
      fromBinId: positionData.lowerBinId,
      toBinId: positionData.upperBinId,
      bps: new BN(withdrawBps),
      shouldClaimAndClose: false,
      skipUnwrapSOL: false,
    });

    // Get token mints info
    const tokenXMintInfo = await getMint(connection, tokenXMint);
    const tokenYMintInfo = await getMint(connection, tokenYMint);
    const isTokenXNativeSOL = tokenXMint.equals(NATIVE_MINT);
    const isTokenYNativeSOL = tokenYMint.equals(NATIVE_MINT);

    // Get ATAs
    const lpOwnerTokenXAta = await getAssociatedTokenAddress(tokenXMint, lpOwner.publicKey);
    const lpOwnerTokenYAta = await getAssociatedTokenAddress(tokenYMint, lpOwner.publicKey);
    const managerTokenXAta = await getAssociatedTokenAddress(tokenXMint, managerWallet);
    const managerTokenYAta = await getAssociatedTokenAddress(tokenYMint, managerWallet);

    // Build transfer transaction (separate from liquidity removal)
    const transferTx = new Transaction();

    // Create manager ATAs if needed
    transferTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        lpOwner.publicKey,
        managerTokenXAta,
        managerWallet,
        tokenXMint
      )
    );

    if (!isTokenYNativeSOL) {
      transferTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          lpOwner.publicKey,
          managerTokenYAta,
          managerWallet,
          tokenYMint
        )
      );
    }

    // Transfer Token X to manager
    if (!estimatedTokenXAmount.isZero()) {
      if (isTokenXNativeSOL) {
        transferTx.add(
          SystemProgram.transfer({
            fromPubkey: lpOwner.publicKey,
            toPubkey: managerWallet,
            lamports: Number(estimatedTokenXAmount.toString())
          })
        );
      } else {
        transferTx.add(
          createTransferInstruction(
            lpOwnerTokenXAta,
            managerTokenXAta,
            lpOwner.publicKey,
            BigInt(estimatedTokenXAmount.toString())
          )
        );
      }
    }

    // Transfer Token Y to manager
    if (!estimatedTokenYAmount.isZero()) {
      if (isTokenYNativeSOL) {
        transferTx.add(
          SystemProgram.transfer({
            fromPubkey: lpOwner.publicKey,
            toPubkey: managerWallet,
            lamports: Number(estimatedTokenYAmount.toString())
          })
        );
      } else {
        transferTx.add(
          createTransferInstruction(
            lpOwnerTokenYAta,
            managerTokenYAta,
            lpOwner.publicKey,
            BigInt(estimatedTokenYAmount.toString())
          )
        );
      }
    }

    // Prepare all transactions (SDK removal txs + transfer tx)
    const { blockhash } = await connection.getLatestBlockhash();
    const allTransactions: Transaction[] = [];

    // Add each removal transaction from the SDK (keeps them properly chunked)
    for (const tx of removeLiquidityTxs) {
      const removeTx = new Transaction();
      removeTx.add(...tx.instructions);
      removeTx.recentBlockhash = blockhash;
      removeTx.feePayer = managerWallet;
      allTransactions.push(removeTx);
    }

    // Add the transfer transaction as the final tx
    transferTx.recentBlockhash = blockhash;
    transferTx.feePayer = managerWallet;
    allTransactions.push(transferTx);

    console.log(`  Number of transactions: ${allTransactions.length}`);

    // Serialize all unsigned transactions
    const unsignedTransactions = allTransactions.map(tx =>
      bs58.encode(tx.serialize({ requireAllSignatures: false }))
    );

    // Create hashes of serialized messages for tamper detection
    const unsignedTransactionHashes = allTransactions.map(tx =>
      crypto.createHash('sha256').update(tx.serializeMessage()).digest('hex')
    );

    // Generate request ID
    const requestId = crypto.randomBytes(16).toString('hex');

    console.log('✓ Withdrawal transactions built successfully');
    console.log(`  Pool: ${poolAddress.toBase58()}`);
    console.log(`  Withdrawal: ${withdrawalPercentage}%`);
    console.log(`  Token X: ${estimatedTokenXAmount.toString()}`);
    console.log(`  Token Y: ${estimatedTokenYAmount.toString()}`);
    console.log(`  Request ID: ${requestId}`);
    console.log(`  Transaction count: ${allTransactions.length}`);

    // Store request data
    withdrawRequests.set(requestId, {
      unsignedTransactions,
      unsignedTransactionHashes,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: managerWallet.toBase58(),
      destinationAddress: managerWallet.toBase58(),
      estimatedTokenXAmount: estimatedTokenXAmount.toString(),
      estimatedTokenYAmount: estimatedTokenYAmount.toString(),
      positionAddress: position.publicKey.toBase58(),
      fromBinId: positionData.lowerBinId,
      toBinId: positionData.upperBinId,
      withdrawalPercentage,
      timestamp: Date.now()
    });

    return res.json({
      success: true,
      transactions: unsignedTransactions,
      transactionCount: unsignedTransactions.length,
      requestId,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      tokenXDecimals: tokenXMintInfo.decimals,
      tokenYDecimals: tokenYMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      destinationAddress: managerWallet.toBase58(),
      withdrawalPercentage,
      estimatedAmounts: {
        tokenX: estimatedTokenXAmount.toString(),
        tokenY: estimatedTokenYAmount.toString(),
      },
      message: 'Sign all transactions with the manager wallet and submit to /dlmm/withdraw/confirm'
    });

  } catch (error) {
    console.error('Error building DLMM withdrawal transaction:', error);
    return res.status(500).json({
      error: 'Failed to build withdrawal transaction',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// ============================================================================
// POST /dlmm/withdraw/confirm - Confirm and submit withdrawal
// ============================================================================
/**
 * Security measures (matching DAMM):
 * 1. Manager wallet signature - Transaction must be signed by manager wallet
 * 2. Lock system - Prevents concurrent operations for the same pool
 * 3. Request expiry - 10 minute timeout
 * 4. Blockhash validation - Prevents replay attacks
 * 5. Transaction hash validation - Prevents tampering
 * 6. Comprehensive logging
 */

router.post('/withdraw/confirm', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransactions, requestId } = req.body;

    console.log('DLMM withdraw confirm request received:', { requestId });

    // Validate required fields
    if (!signedTransactions || !Array.isArray(signedTransactions) || signedTransactions.length === 0 || !requestId) {
      return res.status(400).json({
        error: 'Missing required fields: signedTransactions (array) and requestId'
      });
    }

    // Retrieve request data
    const requestData = withdrawRequests.get(requestId);
    if (!requestData) {
      return res.status(400).json({
        error: 'Withdrawal request not found or expired. Please call /dlmm/withdraw/build first.'
      });
    }

    // Validate transaction count matches
    if (signedTransactions.length !== requestData.unsignedTransactions.length) {
      return res.status(400).json({
        error: `Expected ${requestData.unsignedTransactions.length} transactions, got ${signedTransactions.length}`
      });
    }

    console.log('  Pool:', requestData.poolAddress);
    console.log('  Transaction count:', signedTransactions.length);

    // Acquire lock
    releaseLock = await acquireLiquidityLock(requestData.poolAddress);
    console.log('  Lock acquired');

    // Check request age (10 minutes like DAMM)
    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - requestData.timestamp > TEN_MINUTES) {
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

    // Get pool-specific LP owner
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
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwnerKeypair = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const managerWalletPubKey = new PublicKey(requestData.managerAddress);

    // Validate and prepare all transactions first
    const transactions: Transaction[] = [];
    for (let i = 0; i < signedTransactions.length; i++) {
      const signedTx = signedTransactions[i];
      const expectedHash = requestData.unsignedTransactionHashes[i];

      // Deserialize transaction
      let transaction: Transaction;
      try {
        const transactionBuffer = bs58.decode(signedTx);
        transaction = Transaction.from(transactionBuffer);
      } catch (error) {
        return res.status(400).json({
          error: `Failed to deserialize transaction ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }

      // SECURITY: Validate blockhash
      if (!transaction.recentBlockhash) {
        return res.status(400).json({
          error: `Invalid transaction ${i + 1}: missing blockhash`
        });
      }

      // SECURITY: Verify fee payer is manager wallet
      if (!transaction.feePayer) {
        return res.status(400).json({
          error: `Transaction ${i + 1} missing fee payer`
        });
      }

      if (!transaction.feePayer.equals(managerWalletPubKey)) {
        return res.status(400).json({
          error: `Transaction ${i + 1} fee payer must be manager wallet`
        });
      }

      // SECURITY: Verify manager wallet has signed
      const managerSignature = transaction.signatures.find(sig =>
        sig.publicKey.equals(managerWalletPubKey)
      );

      if (!managerSignature || !managerSignature.signature) {
        return res.status(400).json({
          error: `Transaction ${i + 1} verification failed: Manager wallet has not signed`
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
          error: `Transaction ${i + 1} verification failed: Invalid manager wallet signature`
        });
      }

      // SECURITY: Verify transaction hasn't been tampered with
      const receivedTransactionHash = crypto.createHash('sha256')
        .update(transaction.serializeMessage())
        .digest('hex');

      if (receivedTransactionHash !== expectedHash) {
        console.log(`  ⚠️  Transaction ${i + 1} hash mismatch detected`);
        console.log(`    Expected: ${expectedHash.substring(0, 16)}...`);
        console.log(`    Received: ${receivedTransactionHash.substring(0, 16)}...`);
        return res.status(400).json({
          error: `Transaction ${i + 1} verification failed: transaction has been modified`,
          details: 'Transaction structure does not match the original unsigned transaction'
        });
      }

      transactions.push(transaction);
    }
    console.log(`  ✓ All ${transactions.length} transactions verified`);

    // Check blockhash validity (use first transaction's blockhash as they should all be the same)
    const isBlockhashValid = await connection.isBlockhashValid(
      transactions[0].recentBlockhash!,
      { commitment: 'confirmed' }
    );

    if (!isBlockhashValid) {
      return res.status(400).json({
        error: 'Invalid transaction: blockhash is expired. Please create new transactions.'
      });
    }

    // Send all transactions sequentially
    const signatures: string[] = [];
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    for (let i = 0; i < transactions.length; i++) {
      const transaction = transactions[i];

      // Add LP owner signature
      transaction.partialSign(lpOwnerKeypair);

      console.log(`  Sending transaction ${i + 1}/${transactions.length}...`);
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
      signatures.push(signature);

      console.log(`  ✓ Transaction ${i + 1} sent: ${signature}`);

      // Wait for confirmation before sending next transaction
      try {
        await connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight
        });
        console.log(`  ✓ Transaction ${i + 1} confirmed`);
      } catch (error) {
        console.error(`  ⚠ Transaction ${i + 1} confirmation timeout:`, error);
        // Continue anyway - the transaction may still succeed
      }
    }

    console.log('✓ DLMM withdrawal transactions completed');
    console.log(`  Pool: ${requestData.poolAddress}`);
    console.log(`  Withdrawal: ${requestData.withdrawalPercentage}%`);
    console.log(`  Signatures: ${signatures.join(', ')}`);

    // Clean up
    withdrawRequests.delete(requestId);

    res.json({
      success: true,
      signatures,
      poolAddress: requestData.poolAddress,
      tokenXMint: requestData.tokenXMint,
      tokenYMint: requestData.tokenYMint,
      withdrawalPercentage: requestData.withdrawalPercentage,
      estimatedAmounts: {
        tokenX: requestData.estimatedTokenXAmount,
        tokenY: requestData.estimatedTokenYAmount,
      },
      message: 'Withdrawal transactions submitted successfully'
    });

  } catch (error) {
    console.error('DLMM withdraw confirm error:', error);
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
// POST /dlmm/deposit/build - Build deposit transaction
// ============================================================================

router.post('/deposit/build', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { tokenXAmount, tokenYAmount, poolAddress: poolAddressInput } = req.body;

    console.log('DLMM deposit build request received:', { tokenXAmount, tokenYAmount, poolAddress: poolAddressInput });

    // Validate required fields
    if (!poolAddressInput) {
      return res.status(400).json({
        error: 'Missing required field: poolAddress'
      });
    }

    if ((!tokenXAmount || tokenXAmount === '0') && (!tokenYAmount || tokenYAmount === '0')) {
      return res.status(400).json({
        error: 'At least one of tokenXAmount or tokenYAmount must be provided and greater than 0'
      });
    }

    // Validate poolAddress
    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch {
      return res.status(400).json({
        error: 'Invalid poolAddress: must be a valid Solana public key'
      });
    }

    // Validate pool is whitelisted
    if (!WHITELISTED_DLMM_POOLS.has(poolAddress.toBase58())) {
      return res.status(403).json({
        error: 'Pool not authorized for liquidity operations'
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
    const manager = new PublicKey(MANAGER_WALLET);

    // Create DLMM instance
    console.log('Creating DLMM instance...');
    const dlmmPool = await DLMM.create(connection, poolAddress);

    const lbPair = dlmmPool.lbPair;
    const tokenXMint = lbPair.tokenXMint;
    const tokenYMint = lbPair.tokenYMint;

    // Get token mint info
    const tokenXMintInfo = await getMint(connection, tokenXMint);
    const tokenYMintInfo = await getMint(connection, tokenYMint);
    const isTokenXNativeSOL = tokenXMint.equals(NATIVE_MINT);
    const isTokenYNativeSOL = tokenYMint.equals(NATIVE_MINT);

    console.log(`  Token X Mint: ${tokenXMint.toBase58()} (decimals: ${tokenXMintInfo.decimals})`);
    console.log(`  Token Y Mint: ${tokenYMint.toBase58()} (decimals: ${tokenYMintInfo.decimals})`);

    // Parse amounts
    const tokenXAmountBN = new BN(tokenXAmount || '0');
    const tokenYAmountBN = new BN(tokenYAmount || '0');

    // Get user positions
    const { userPositions, activeBin } = await dlmmPool.getPositionsByUserAndLbPair(lpOwner.publicKey);

    if (userPositions.length === 0) {
      return res.status(404).json({
        error: 'No positions found for the LP owner in this pool. Create a position first.'
      });
    }

    const position = userPositions[0];
    const positionData = position.positionData;

    console.log(`  Position: ${position.publicKey.toBase58()}`);
    console.log(`  Active Bin: ${activeBin.binId}`);
    console.log(`  Position Range: ${positionData.lowerBinId} - ${positionData.upperBinId}`);

    // Build combined transaction
    const combinedTx = new Transaction();

    // Get ATAs
    const managerTokenXAta = await getAssociatedTokenAddress(tokenXMint, manager);
    const managerTokenYAta = await getAssociatedTokenAddress(tokenYMint, manager);
    const lpOwnerTokenXAta = await getAssociatedTokenAddress(tokenXMint, lpOwner.publicKey);
    const lpOwnerTokenYAta = await getAssociatedTokenAddress(tokenYMint, lpOwner.publicKey);

    // Create LP owner ATAs if needed (always create both, even for native SOL which needs wrapped SOL ATA)
    // Manager pays for ATA creation as fee payer
    combinedTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        manager,
        lpOwnerTokenXAta,
        lpOwner.publicKey,
        tokenXMint
      )
    );
    combinedTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        manager,
        lpOwnerTokenYAta,
        lpOwner.publicKey,
        tokenYMint
      )
    );

    // Transfer tokens from manager to LP owner
    if (!tokenXAmountBN.isZero()) {
      if (isTokenXNativeSOL) {
        // Transfer native SOL to wrapped SOL ATA and sync
        combinedTx.add(
          SystemProgram.transfer({
            fromPubkey: manager,
            toPubkey: lpOwnerTokenXAta,
            lamports: Number(tokenXAmountBN.toString())
          }),
          createSyncNativeInstruction(lpOwnerTokenXAta)
        );
      } else {
        combinedTx.add(
          createTransferInstruction(
            managerTokenXAta,
            lpOwnerTokenXAta,
            manager,
            BigInt(tokenXAmountBN.toString())
          )
        );
      }
    }

    if (!tokenYAmountBN.isZero()) {
      if (isTokenYNativeSOL) {
        // Transfer native SOL to wrapped SOL ATA and sync
        combinedTx.add(
          SystemProgram.transfer({
            fromPubkey: manager,
            toPubkey: lpOwnerTokenYAta,
            lamports: Number(tokenYAmountBN.toString())
          }),
          createSyncNativeInstruction(lpOwnerTokenYAta)
        );
      } else {
        combinedTx.add(
          createTransferInstruction(
            managerTokenYAta,
            lpOwnerTokenYAta,
            manager,
            BigInt(tokenYAmountBN.toString())
          )
        );
      }
    }

    // Add liquidity to position using strategy
    // Using spot distribution around active bin
    const addLiquidityTx = await dlmmPool.addLiquidityByStrategy({
      positionPubKey: position.publicKey,
      totalXAmount: tokenXAmountBN,
      totalYAmount: tokenYAmountBN,
      strategy: {
        maxBinId: positionData.upperBinId,
        minBinId: positionData.lowerBinId,
        strategyType: 0, // Spot strategy
      },
      user: lpOwner.publicKey,
      slippage: 100, // 1% slippage
    });

    // Add liquidity instructions - handle both single transaction and array of transactions
    if (Array.isArray(addLiquidityTx)) {
      for (const tx of addLiquidityTx) {
        combinedTx.add(...tx.instructions);
      }
    } else {
      combinedTx.add(...addLiquidityTx.instructions);
    }

    // Set transaction properties (manager wallet is fee payer for security)
    const { blockhash } = await connection.getLatestBlockhash();
    combinedTx.recentBlockhash = blockhash;
    combinedTx.feePayer = manager;

    // Serialize unsigned transaction (base58 like DAMM)
    const unsignedTransaction = bs58.encode(combinedTx.serialize({ requireAllSignatures: false }));

    // Create hash of serialized message for tamper detection
    const unsignedTransactionHash = crypto
      .createHash('sha256')
      .update(combinedTx.serializeMessage())
      .digest('hex');

    // Generate request ID
    const requestId = crypto.randomBytes(16).toString('hex');

    console.log('✓ Deposit transaction built successfully');
    console.log(`  Pool: ${poolAddress.toBase58()}`);
    console.log(`  Token X: ${tokenXAmountBN.toString()}`);
    console.log(`  Token Y: ${tokenYAmountBN.toString()}`);
    console.log(`  Request ID: ${requestId}`);

    // Store request data
    depositRequests.set(requestId, {
      unsignedTransaction,
      unsignedTransactionHash,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: manager.toBase58(),
      tokenXAmount: tokenXAmountBN.toString(),
      tokenYAmount: tokenYAmountBN.toString(),
      positionAddress: position.publicKey.toBase58(),
      timestamp: Date.now()
    });

    return res.json({
      success: true,
      transaction: unsignedTransaction,
      requestId,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      tokenXDecimals: tokenXMintInfo.decimals,
      tokenYDecimals: tokenYMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: manager.toBase58(),
      instructionsCount: combinedTx.instructions.length,
      amounts: {
        tokenX: tokenXAmountBN.toString(),
        tokenY: tokenYAmountBN.toString(),
      },
      message: 'Sign this transaction with the manager wallet and submit to /dlmm/deposit/confirm'
    });

  } catch (error) {
    console.error('Error building DLMM deposit transaction:', error);
    return res.status(500).json({
      error: 'Failed to build deposit transaction',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// ============================================================================
// POST /dlmm/deposit/confirm - Confirm and submit deposit
// ============================================================================
/**
 * Security measures (matching DAMM):
 * 1. Manager wallet signature - Transaction must be signed by manager wallet
 * 2. Lock system - Prevents concurrent operations for the same pool
 * 3. Request expiry - 10 minute timeout
 * 4. Blockhash validation - Prevents replay attacks
 * 5. Transaction hash validation - Prevents tampering
 * 6. Comprehensive logging
 */

router.post('/deposit/confirm', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransaction, requestId } = req.body;

    console.log('DLMM deposit confirm request received:', { requestId });

    // Validate required fields
    if (!signedTransaction || !requestId) {
      return res.status(400).json({
        error: 'Missing required fields: signedTransaction and requestId'
      });
    }

    // Retrieve request data
    const requestData = depositRequests.get(requestId);
    if (!requestData) {
      return res.status(400).json({
        error: 'Deposit request not found or expired. Please call /dlmm/deposit/build first.'
      });
    }

    console.log('  Pool:', requestData.poolAddress);
    console.log('  Manager:', requestData.managerAddress);

    // Acquire lock
    releaseLock = await acquireLiquidityLock(requestData.poolAddress);
    console.log('  Lock acquired');

    // Check request age (10 minutes like DAMM)
    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - requestData.timestamp > TEN_MINUTES) {
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

    // Get pool-specific LP owner
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
    const connection = new Connection(RPC_URL, 'confirmed');
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

    if (receivedTransactionHash !== requestData.unsignedTransactionHash) {
      console.log(`  ⚠️  Transaction hash mismatch detected`);
      console.log(`    Expected: ${requestData.unsignedTransactionHash.substring(0, 16)}...`);
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

    console.log('✓ DLMM deposit transaction sent');
    console.log(`  Signature: ${signature}`);
    console.log(`  Pool: ${requestData.poolAddress}`);
    console.log(`  Manager: ${requestData.managerAddress}`);
    console.log(`  LP Owner: ${requestData.lpOwnerAddress}`);
    console.log(`  Token X: ${requestData.tokenXAmount}`);
    console.log(`  Token Y: ${requestData.tokenYAmount}`);
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
      poolAddress: requestData.poolAddress,
      tokenXMint: requestData.tokenXMint,
      tokenYMint: requestData.tokenYMint,
      amounts: {
        tokenX: requestData.tokenXAmount,
        tokenY: requestData.tokenYAmount,
      },
      message: 'Deposit transaction submitted successfully'
    });

  } catch (error) {
    console.error('DLMM deposit confirm error:', error);
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
