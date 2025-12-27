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
import { CpAmm, getTokenProgram, getUnClaimReward } from '@meteora-ag/cp-amm-sdk';
import rateLimit from 'express-rate-limit';

/**
 * Fee Claim Routes
 *
 * Express router for Meteora DAMM v2 fee claiming endpoints
 */

const router = Router();

// ============================================================================
// Pool Fee Configuration
// ============================================================================
// Maps pool address to list of fee recipients with their percentage share
// Percentages must sum to 100 for each pool

interface FeeRecipient {
  address: string;  // Solana wallet address
  percent: number;  // Percentage of fees (0-100)
}

const POOL_FEE_CONFIG: Record<string, FeeRecipient[]> = {
  // SolPay
  'BTYhoRPEUXs8ESYFjKDXRYf5qjH4chzZoBokMEApKEfJ': [
    { address: '3KJab78N7AmVU8ZwRx5bVyVnSxHd9W1cKzvuwbx3sW1r', percent: 70 },
    { address: '7rajfxUQBHRXiSrQWQo9FZ2zBbLy4Xvh9yYfa7tkvj4U', percent: 30 },
  ],
  // SurfCash
  'Ez1QYeC95xJRwPA9SR7YWC1H1Tj43exJr91QqKf8Puu1': [
    { address: 'BmfaxQCRqf4xZFmQa5GswShBZhRBf4bED7hadFkpgBC3', percent: 34.375 },
    { address: 'HU65idnreBAe9gsLzSGTV7w7tVTzaSzXBw518F1aQrGv', percent: 34.375 },
    { address: '7rajfxUQBHRXiSrQWQo9FZ2zBbLy4Xvh9yYfa7tkvj4U', percent: 31.25 },
  ],
};

function getPoolFeeConfig(poolAddress: string): FeeRecipient[] | null {
  return POOL_FEE_CONFIG[poolAddress] || null;
}

// Rate limiter for fee claim endpoints
const feeClaimLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 requests per 5 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many fee claim requests, please wait a moment.'
});

// In-memory storage for fee claim transactions
// Maps requestId -> transaction data
interface FeeClaimData {
  unsignedTransaction: string; // Single base58-encoded unsigned transaction
  unsignedTransactionHash: string; // SHA-256 hash for tamper detection
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  lpOwnerAddress: string;
  feePayerAddress: string;
  feeRecipients: FeeRecipient[];  // List of fee recipients with their percentages
  estimatedTokenAFees: string;
  estimatedTokenBFees: string;
  positionsCount: number;
  timestamp: number;
}
const feeClaimRequests = new Map<string, FeeClaimData>();

// Mutex locks for preventing concurrent fee claim processing
// Maps pool address -> Promise that resolves when processing is done
const feeClaimLocks = new Map<string, Promise<void>>();

/**
 * Acquire a fee claim lock for a specific pool
 * Prevents race conditions during fee claim processing
 *
 * @param poolAddress - The pool address to lock
 * @returns A function to release the lock
 */
async function acquireFeeClaimLock(poolAddress: string): Promise<() => void> {
  const key = poolAddress.toLowerCase();

  // Wait for any existing lock to be released
  while (feeClaimLocks.has(key)) {
    await feeClaimLocks.get(key);
  }

  // Create a new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  feeClaimLocks.set(key, lockPromise);

  // Return the release function
  return () => {
    feeClaimLocks.delete(key);
    releaseLock!();
  };
}

// Clean up expired requests every 5 minutes (requests expire after 10 minutes in confirm endpoint)
setInterval(() => {
  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  const now = Date.now();
  for (const [requestId, data] of feeClaimRequests.entries()) {
    if (now - data.timestamp > FIFTEEN_MINUTES) {
      feeClaimRequests.delete(requestId);
    }
  }
}, 5 * 60 * 1000);

// ============================================================================
// POST /fee-claim/claim - Build fee claim transactions
// ============================================================================

router.post('/claim', feeClaimLimiter, async (req: Request, res: Response) => {
  try {
    const { payerPublicKey, poolAddress: poolAddressInput } = req.body;

    console.log('Fee claim request received:', { payerPublicKey, poolAddress: poolAddressInput });

    // Validate required fields
    if (!payerPublicKey || !poolAddressInput) {
      return res.status(400).json({
        error: 'Missing required fields: payerPublicKey and poolAddress'
      });
    }

    // Validate payer public key format
    let payerPubKey: PublicKey;
    try {
      payerPubKey = new PublicKey(payerPublicKey);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid payerPublicKey format'
      });
    }

    // Validate pool address format
    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid poolAddress format'
      });
    }

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;

    if (!RPC_URL) {
      return res.status(500).json({
        error: 'Server configuration incomplete. Missing required environment variables.'
      });
    }

    // Get pool fee configuration
    const feeConfig = getPoolFeeConfig(poolAddress.toBase58());
    if (!feeConfig || feeConfig.length === 0) {
      return res.status(400).json({
        error: `Pool not supported for fee claiming. No fee configuration for pool: ${poolAddress.toBase58()}`
      });
    }

    // Validate fee percentages sum to 100
    const totalPercent = feeConfig.reduce((sum, r) => sum + r.percent, 0);
    if (totalPercent !== 100) {
      return res.status(500).json({
        error: `Invalid fee configuration for pool. Percentages sum to ${totalPercent}, expected 100.`
      });
    }

    // Get pool-specific LP private key using first 8 characters of pool address
    const poolPrefix = poolAddress.toBase58().substring(0, 8);
    const lpPrivateKeyEnvName = `LP_PRIVATE_KEY_${poolPrefix}`;
    const lpPrivateKey = process.env[lpPrivateKeyEnvName];

    if (!lpPrivateKey) {
      return res.status(400).json({
        error: `Pool not supported for fee claiming. No LP key configured for pool prefix: ${poolPrefix}`
      });
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(lpPrivateKey));

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

    // IMPORTANT: This endpoint only claims fees from the FIRST position
    // This is intentional to keep transaction size manageable and reduce complexity
    // If multiple positions exist, only the first position's fees will be claimed
    const { positionState } = userPositions[0];
    const unclaimedFees = getUnClaimReward(poolState, positionState);
    const totalTokenAFees = unclaimedFees.feeTokenA;
    const totalTokenBFees = unclaimedFees.feeTokenB;

    // Check if there are any fees to claim
    if (totalTokenAFees.isZero() && totalTokenBFees.isZero()) {
      return res.status(400).json({
        error: 'No fees available to claim'
      });
    }

    // Get token programs for token A and B
    const tokenAMintInfo = await getMint(connection, poolState.tokenAMint);
    const tokenBMintInfo = await getMint(connection, poolState.tokenBMint);
    const tokenAProgram = getTokenProgram(tokenAMintInfo.tlvData.length > 0 ? 1 : 0);
    const tokenBProgram = getTokenProgram(tokenBMintInfo.tlvData.length > 0 ? 1 : 0);

    // Check if Token B is native SOL (wrapped SOL)
    // When claiming wrapped SOL fees from Meteora, the SDK automatically unwraps them to native SOL
    // This means we receive native SOL directly instead of wSOL tokens in an ATA
    const isTokenBNativeSOL = poolState.tokenBMint.equals(NATIVE_MINT);

    // Build single combined transaction with all claim + transfer instructions
    const combinedTx = new Transaction();
    combinedTx.feePayer = payerPubKey;

    const { blockhash } = await connection.getLatestBlockhash();
    combinedTx.recentBlockhash = blockhash;

    // Get LP owner's token accounts
    const tokenAAta = await getAssociatedTokenAddress(
      poolState.tokenAMint,
      lpOwner.publicKey
    );
    const tokenBAta = await getAssociatedTokenAddress(
      poolState.tokenBMint,
      lpOwner.publicKey
    );

    // Create LP owner's Token A ATA only if there are Token A fees to claim
    // Token A is always an SPL token, so we need an ATA to receive it
    if (!totalTokenAFees.isZero()) {
      combinedTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          payerPubKey,
          tokenAAta,
          lpOwner.publicKey,
          poolState.tokenAMint,
          tokenAProgram
        )
      );
    }

    // Create LP owner's Token B ATA only if there are Token B fees AND it's NOT native SOL
    // If Token B is native SOL (NATIVE_MINT), the Meteora claim automatically unwraps it
    // to native SOL in the wallet, so no token account is needed
    if (!totalTokenBFees.isZero() && !isTokenBNativeSOL) {
      combinedTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          payerPubKey,
          tokenBAta,
          lpOwner.publicKey,
          poolState.tokenBMint,
          tokenBProgram
        )
      );
    }

    // Add claim fee instructions for first position only
    const { position, positionNftAccount } = userPositions[0];
    const claimTx = await cpAmm.claimPositionFee({
      owner: lpOwner.publicKey,
      position,
      pool: poolAddress,
      positionNftAccount,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAProgram,
      tokenBProgram,
    });

    // Add all claim instructions to combined transaction
    combinedTx.add(...claimTx.instructions);

    // Add transfer instructions for each fee recipient based on their percentage
    for (const recipient of feeConfig) {
      const destinationAddress = new PublicKey(recipient.address);

      // Calculate this recipient's share of fees
      // Use basis points (percent * 1000) for precision with decimal percentages
      const basisPoints = Math.round(recipient.percent * 1000);
      const tokenATransferAmount = totalTokenAFees.mul(new BN(basisPoints)).div(new BN(100000));
      const tokenBTransferAmount = totalTokenBFees.mul(new BN(basisPoints)).div(new BN(100000));

      // Get destination token accounts
      // allowOwnerOffCurve: true allows PDAs as fee recipients
      const destTokenAAta = await getAssociatedTokenAddress(
        poolState.tokenAMint,
        destinationAddress,
        true // allowOwnerOffCurve
      );
      const destTokenBAta = isTokenBNativeSOL ? destinationAddress : await getAssociatedTokenAddress(
        poolState.tokenBMint,
        destinationAddress,
        true // allowOwnerOffCurve
      );

      // Add ATA creation instruction for Token A destination (always SPL token)
      if (!tokenATransferAmount.isZero()) {
        combinedTx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            payerPubKey,
            destTokenAAta,
            destinationAddress,
            poolState.tokenAMint,
            tokenAProgram
          )
        );
      }

      // Add ATA creation instruction for Token B destination (only if it's NOT native SOL)
      if (!tokenBTransferAmount.isZero() && !isTokenBNativeSOL) {
        combinedTx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            payerPubKey,
            destTokenBAta,
            destinationAddress,
            poolState.tokenBMint,
            tokenBProgram
          )
        );
      }

      // Add transfer instruction for Token A (always an SPL token)
      if (!tokenATransferAmount.isZero()) {
        combinedTx.add(
          createTransferInstruction(
            tokenAAta,
            destTokenAAta,
            lpOwner.publicKey,
            BigInt(tokenATransferAmount.toString()),
            [],
            tokenAProgram
          )
        );
      }

      // Add transfer instruction for Token B
      if (!tokenBTransferAmount.isZero()) {
        if (isTokenBNativeSOL) {
          // Transfer native SOL using SystemProgram.transfer
          combinedTx.add(
            SystemProgram.transfer({
              fromPubkey: lpOwner.publicKey,
              toPubkey: destinationAddress,
              lamports: Number(tokenBTransferAmount.toString())
            })
          );
        } else {
          // Transfer SPL token using Token Program
          combinedTx.add(
            createTransferInstruction(
              tokenBAta,
              destTokenBAta,
              lpOwner.publicKey,
              BigInt(tokenBTransferAmount.toString()),
              [],
              tokenBProgram
            )
          );
        }
      }
    }

    // Serialize the combined unsigned transaction
    const unsignedTransaction = bs58.encode(combinedTx.serialize({ requireAllSignatures: false }));

    // Compute hash of unsigned transaction for integrity verification
    const unsignedTransactionHash = crypto.createHash('sha256')
      .update(combinedTx.serializeMessage())
      .digest('hex');

    // Generate unique request ID
    const requestId = crypto.randomBytes(16).toString('hex');

    console.log('✓ Fee claim transaction built successfully');
    console.log(`  Pool: ${poolAddress.toBase58()}`);
    console.log(`  Positions: ${userPositions.length} (claiming from position 1)`);
    console.log(`  Token A fees: ${totalTokenAFees.toString()}`);
    console.log(`  Token B fees: ${totalTokenBFees.toString()}`);
    console.log(`  Fee recipients: ${feeConfig.map(r => `${r.address.substring(0, 8)}...(${r.percent}%)`).join(', ')}`);
    console.log(`  Request ID: ${requestId}`);

    // Store transaction data in memory
    feeClaimRequests.set(requestId, {
      unsignedTransaction,
      unsignedTransactionHash,
      poolAddress: poolAddress.toBase58(),
      tokenAMint: poolState.tokenAMint.toBase58(),
      tokenBMint: poolState.tokenBMint.toBase58(),
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      feePayerAddress: payerPubKey.toBase58(),
      feeRecipients: feeConfig,
      estimatedTokenAFees: totalTokenAFees.toString(),
      estimatedTokenBFees: totalTokenBFees.toString(),
      positionsCount: 1,
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
      totalPositions: userPositions.length,
      claimingPosition: 1,
      instructionsCount: combinedTx.instructions.length,
      feeRecipients: feeConfig,
      estimatedFees: {
        tokenA: totalTokenAFees.toString(),
        tokenB: totalTokenBFees.toString(),
      },
      message: `Sign this transaction and submit to /fee-claim/confirm${isTokenBNativeSOL ? ' (Token B will be transferred as native SOL)' : ''}`
    });

  } catch (error) {
    console.error('Claim fees error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create fee claim transaction'
    });
  }
});

// ============================================================================
// POST /fee-claim/confirm - Confirm and submit fee claim transactions
// ============================================================================
/**
 * Security measures implemented:
 * 1. Lock system - Prevents concurrent claims for the same pool
 * 2. Blockhash validation - Prevents replay attacks
 * 3. Transaction hash verification - SHA-256 hash comparison ensures the exact
 *    transaction built in /claim is submitted, preventing any tampering
 * 4. Fee payer signature verification - Ensures user authorized the transaction
 * 5. Request expiry - 10 minute timeout for pending claims
 * 6. Request deletion on tamper detection - Prevents retry attacks
 * 7. Comprehensive logging - Transaction details logged for monitoring
 *
 * No authorization required - fee recipients are hardcoded in POOL_FEE_CONFIG,
 * fee payer only covers tx costs and cannot redirect funds
 */

router.post('/confirm', feeClaimLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransaction, requestId } = req.body;

    console.log('Fee claim confirm request received:', { requestId });

    // Validate required fields
    if (!signedTransaction || !requestId) {
      return res.status(400).json({
        error: 'Missing required fields: signedTransaction and requestId'
      });
    }

    // Retrieve the fee claim data from memory
    const feeClaimData = feeClaimRequests.get(requestId);
    if (!feeClaimData) {
      return res.status(400).json({
        error: 'Fee claim request not found or expired. Please call /fee-claim/claim first.'
      });
    }

    console.log('  Pool:', feeClaimData.poolAddress);

    // Acquire lock for this pool IMMEDIATELY to prevent race conditions
    releaseLock = await acquireFeeClaimLock(feeClaimData.poolAddress);
    console.log('  Lock acquired');

    // NOTE: No authorization check needed - fee recipients are hardcoded in POOL_FEE_CONFIG
    // Transaction hash verification ensures the exact transaction from /claim is submitted
    // Fee payer only covers transaction costs, cannot redirect funds
    // This allows anyone to trigger fee claims, which is the intended design

    // Check if request is not too old (10 minutes timeout)
    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - feeClaimData.timestamp > TEN_MINUTES) {
      feeClaimRequests.delete(requestId);
      return res.status(400).json({
        error: 'Fee claim request expired. Please create a new request.'
      });
    }

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;

    if (!RPC_URL) {
      return res.status(500).json({
        error: 'Server configuration incomplete'
      });
    }

    // Get pool-specific LP private key using first 8 characters of pool address
    const poolPrefix = feeClaimData.poolAddress.substring(0, 8);
    const lpPrivateKeyEnvName = `LP_PRIVATE_KEY_${poolPrefix}`;
    const lpPrivateKey = process.env[lpPrivateKeyEnvName];

    if (!lpPrivateKey) {
      return res.status(400).json({
        error: `Pool not supported for fee claiming. No LP key configured for pool prefix: ${poolPrefix}`
      });
    }

    // Initialize connection and LP owner keypair
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwnerKeypair = Keypair.fromSecretKey(bs58.decode(lpPrivateKey));

    // Deserialize and verify the transaction
    const expectedFeePayer = new PublicKey(feeClaimData.feePayerAddress);

    let transaction: Transaction;
    try {
      const transactionBuffer = bs58.decode(signedTransaction);
      transaction = Transaction.from(transactionBuffer);
    } catch (error) {
      return res.status(400).json({
        error: `Failed to deserialize transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }

    // SECURITY: Validate transaction has recent blockhash to prevent replay attacks
    if (!transaction.recentBlockhash) {
      return res.status(400).json({
        error: 'Invalid transaction: missing blockhash'
      });
    }

    // Check if blockhash is still valid (within last 150 slots ~60 seconds)
    const isBlockhashValid = await connection.isBlockhashValid(
      transaction.recentBlockhash,
      { commitment: 'confirmed' }
    );

    if (!isBlockhashValid.value) {
      return res.status(400).json({
        error: 'Invalid transaction: blockhash is expired. Please create a new transaction.'
      });
    }

    // Verify the transaction hasn't been tampered with
    if (!transaction.feePayer) {
      return res.status(400).json({
        error: 'Transaction missing fee payer'
      });
    }

    // Verify fee payer matches expected payer
    if (!transaction.feePayer.equals(expectedFeePayer)) {
      return res.status(400).json({
        error: 'Transaction fee payer mismatch'
      });
    }

    // Check that LP owner is a required signer
    const lpOwnerIsRequired = transaction.instructions.some(ix =>
      ix.keys.some(key =>
        key.pubkey.equals(lpOwnerKeypair.publicKey) && key.isSigner
      )
    );

    if (!lpOwnerIsRequired) {
      return res.status(400).json({
        error: 'Transaction verification failed: LP owner signature not required'
      });
    }

    // Verify transaction contains instructions
    if (transaction.instructions.length === 0) {
      return res.status(400).json({
        error: 'Transaction verification failed: No instructions found'
      });
    }

    // Verify fee payer has signed
    const feePayerSignature = transaction.signatures.find(sig =>
      sig.publicKey.equals(transaction.feePayer!)
    );

    if (!feePayerSignature || !feePayerSignature.signature) {
      return res.status(400).json({
        error: 'Transaction verification failed: Fee payer has not signed'
      });
    }

    // Verify the fee payer signature is valid
    const messageData = transaction.serializeMessage();
    const feePayerSigValid = nacl.sign.detached.verify(
      messageData,
      feePayerSignature.signature,
      feePayerSignature.publicKey.toBytes()
    );

    if (!feePayerSigValid) {
      return res.status(400).json({
        error: 'Transaction verification failed: Invalid fee payer signature'
      });
    }

    // ========================================================================
    // CRITICAL SECURITY: Verify transaction hasn't been tampered with
    // ========================================================================
    // Compare hash of received transaction message against stored hash from /claim
    const receivedTransactionHash = crypto.createHash('sha256')
      .update(transaction.serializeMessage())
      .digest('hex');

    if (receivedTransactionHash !== feeClaimData.unsignedTransactionHash) {
      console.log(`  ⚠️  Transaction hash mismatch detected`);
      console.log(`    Expected: ${feeClaimData.unsignedTransactionHash.substring(0, 16)}...`);
      console.log(`    Received: ${receivedTransactionHash.substring(0, 16)}...`);
      // Delete the request to prevent further attempts with tampered transactions
      feeClaimRequests.delete(requestId);
      return res.status(400).json({
        error: 'Transaction verification failed: transaction has been modified',
        details: 'Transaction structure does not match the original unsigned transaction'
      });
    }

    console.log('  ✓ Transaction structure validated');

    // Add LP owner signature
    transaction.partialSign(lpOwnerKeypair);

    // Send the transaction
    console.log('  Sending transaction...');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });

    console.log('✓ Fee claim transaction sent');
    console.log(`  Signature: ${signature}`);
    console.log(`  Pool: ${feeClaimData.poolAddress}`);
    console.log(`  Token A: ${feeClaimData.tokenAMint}, Fees: ${feeClaimData.estimatedTokenAFees}`);
    console.log(`  Token B: ${feeClaimData.tokenBMint}, Fees: ${feeClaimData.estimatedTokenBFees}`);
    console.log(`  Fee recipients: ${feeClaimData.feeRecipients.map(r => `${r.address.substring(0, 8)}...(${r.percent}%)`).join(', ')}`);
    console.log(`  Solscan: https://solscan.io/tx/${signature}`);

    // Wait for confirmation
    try {
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      });
      console.log(`✓ Fee claim confirmed: ${signature}`);
    } catch (error) {
      console.error(`⚠ Confirmation timeout for ${signature}:`, error);
      // Continue even if confirmation fails - transaction may still succeed
    }

    // Clean up the request from memory after successful submission
    feeClaimRequests.delete(requestId);

    res.json({
      success: true,
      signature,
      poolAddress: feeClaimData.poolAddress,
      tokenAMint: feeClaimData.tokenAMint,
      tokenBMint: feeClaimData.tokenBMint,
      feeRecipients: feeClaimData.feeRecipients,
      positionsCount: feeClaimData.positionsCount,
      estimatedFees: {
        tokenA: feeClaimData.estimatedTokenAFees,
        tokenB: feeClaimData.estimatedTokenBFees
      },
      message: 'Fee claim transaction submitted successfully'
    });

  } catch (error) {
    console.error('Confirm fee claim error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to confirm fee claim'
    });
  } finally {
    // Always release the lock, even if an error occurred
    if (releaseLock) {
      releaseLock();
    }
  }
});

export default router;
