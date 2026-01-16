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
  NATIVE_MINT,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { getTokenProgramsForMints } from './liquidity/shared';
import bs58 from 'bs58';
import BN from 'bn.js';
import DLMM from '@meteora-ag/dlmm';
import rateLimit from 'express-rate-limit';
import { getPool } from '../lib/db';
import { getDaoByPoolAddress } from '../lib/db/daos';
import { fetchKeypair } from '../lib/keyService';
import {
  PROTOCOL_FEE_WALLET,
  PARTNER_DAO_PDA,
  PARTNER_TREASURY,
  PARTNER_REFERRED_DAO_PDAS,
  calculateProtocolFeePercent,
  FeeRecipient,
} from './fee-config';

/**
 * DLMM Fee Claim Routes
 *
 * Express router for Meteora DLMM fee claiming endpoints
 * Mirrors the security patterns of DAMM fee-claim.ts
 */

const router = Router();

interface PoolFeeConfigResult {
  feeRecipients: FeeRecipient[];
  lpOwnerKeypair: Keypair;
  source: 'legacy' | 'dao';
  daoName?: string;
}

// Legacy hardcoded pool configurations (for backward compatibility)
const LEGACY_POOL_FEE_CONFIG: Record<string, FeeRecipient[]> = {
  // ZC DLMM Pool
  '7jbhVZcYqCRmciBcZzK8L5B96Pyw7i1SpXQFKBkzD3G2': [
    { address: PROTOCOL_FEE_WALLET, percent: 100 },
  ],
};

/**
 * Get fee configuration for a DLMM pool.
 * First checks legacy hardcoded config, then database for DAO pools.
 * For DAO pools, dynamically calculates protocol fee based on pool fee rate.
 */
async function getPoolFeeConfig(
  connection: Connection,
  poolAddress: string
): Promise<PoolFeeConfigResult | null> {
  // First, check legacy hardcoded config
  const legacyConfig = LEGACY_POOL_FEE_CONFIG[poolAddress];
  if (legacyConfig) {
    // Get pool-specific LP private key from env
    const poolPrefix = poolAddress.substring(0, 8);
    const lpPrivateKeyEnvName = `LP_PRIVATE_KEY_${poolPrefix}`;
    const lpPrivateKey = process.env[lpPrivateKeyEnvName];
    if (!lpPrivateKey) {
      return null;  // Legacy pool but no key configured
    }
    return {
      feeRecipients: legacyConfig,
      lpOwnerKeypair: Keypair.fromSecretKey(bs58.decode(lpPrivateKey)),
      source: 'legacy',
    };
  }

  // Check database for DAO pools
  const pool = getPool();
  const dao = await getDaoByPoolAddress(pool, poolAddress);

  if (dao && dao.pool_type === 'dlmm') {
    // Get LP owner keypair from key service
    const lpOwnerKeypair = await fetchKeypair(dao.admin_key_idx);

    // Check for special partner fee configurations
    if (dao.dao_pda === PARTNER_DAO_PDA) {
      // Special partner: 0% protocol, 100% to their treasury
      if (!dao.treasury_multisig) {
        throw new Error(`Partner DAO "${dao.dao_name}" has no treasury configured. The DAO must set up a treasury before fees can be claimed.`);
      }

      console.log(`[DLMM Fee Claim] Partner DAO ${dao.dao_name}: 0% protocol, 100% DAO treasury`);

      return {
        feeRecipients: [
          { address: dao.treasury_multisig, percent: 100 },
        ],
        lpOwnerKeypair,
        source: 'dao',
        daoName: dao.dao_name,
      };
    }

    if (PARTNER_REFERRED_DAO_PDAS.has(dao.dao_pda)) {
      // Referred DAO: 1/7 protocol, 3/7 partner, 3/7 DAO treasury
      if (!dao.treasury_multisig) {
        throw new Error(`Referred DAO "${dao.dao_name}" has no treasury configured. The DAO must set up a treasury before fees can be claimed.`);
      }
      if (!PARTNER_TREASURY) {
        throw new Error(`Partner treasury not configured. Cannot process fee claim for referred DAO "${dao.dao_name}".`);
      }

      // 1/7 ≈ 14.285714%, 3/7 ≈ 42.857143%
      const protocolPercent = 100 / 7;      // 1/7
      const partnerPercent = 300 / 7;       // 3/7
      const daoPercent = 300 / 7;           // 3/7

      console.log(`[DLMM Fee Claim] Referred DAO ${dao.dao_name}: ${protocolPercent.toFixed(2)}% protocol, ${partnerPercent.toFixed(2)}% partner, ${daoPercent.toFixed(2)}% DAO`);

      return {
        feeRecipients: [
          { address: PROTOCOL_FEE_WALLET, percent: protocolPercent },
          { address: PARTNER_TREASURY, percent: partnerPercent },
          { address: dao.treasury_multisig, percent: daoPercent },
        ],
        lpOwnerKeypair,
        source: 'dao',
        daoName: dao.dao_name,
      };
    }

    // Standard DAO: Calculate dynamic protocol fee based on pool fee rate
    // Get DLMM pool to fetch fee rate
    const dlmmPool = await DLMM.create(connection, new PublicKey(poolAddress));

    // Use SDK's getFeeInfo() which correctly calculates:
    // baseFee = baseFactor * binStep * 10 * 10^baseFeePowerFactor
    // Returns baseFeeRatePercentage as a Decimal (0-100%), multiply by 100 to get bps
    const feeInfo = dlmmPool.getFeeInfo();
    const poolFeeBps = feeInfo.baseFeeRatePercentage.mul(100).toNumber();

    // Calculate dynamic protocol fee percentage
    const protocolPercent = calculateProtocolFeePercent(poolFeeBps);
    const daoPercent = 100 - protocolPercent;

    // Build fee recipients: protocol + DAO treasury
    const feeRecipients: FeeRecipient[] = [
      { address: PROTOCOL_FEE_WALLET, percent: protocolPercent },
    ];

    // Add DAO treasury if they get a share
    if (daoPercent > 0) {
      if (!dao.treasury_multisig) {
        throw new Error(`DAO "${dao.dao_name}" is entitled to ${daoPercent.toFixed(2)}% of fees but has no treasury configured. The DAO must set up a treasury before fees can be claimed.`);
      }
      feeRecipients.push({
        address: dao.treasury_multisig,  // This is actually treasury_vault (see dao.ts comment)
        percent: daoPercent,
      });
    }

    console.log(`[DLMM Fee Claim] DAO pool ${dao.dao_name}: pool fee ${poolFeeBps}bps, protocol ${protocolPercent.toFixed(2)}%, DAO ${daoPercent.toFixed(2)}%`);

    return {
      feeRecipients,
      lpOwnerKeypair,
      source: 'dao',
      daoName: dao.dao_name,
    };
  }

  return null;  // Pool not found
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
interface DlmmFeeClaimData {
  // Array of base58-encoded unsigned transactions (claim txs + transfer tx)
  unsignedTransactions: string[];
  // Array of SHA-256 hashes for tamper detection (one per transaction)
  unsignedTransactionHashes: string[];
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  lpOwnerAddress: string;
  feePayerAddress: string;
  feeRecipients: FeeRecipient[];
  estimatedTokenXFees: string;
  estimatedTokenYFees: string;
  positionAddress: string;
  timestamp: number;
}
const feeClaimRequests = new Map<string, DlmmFeeClaimData>();

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
// POST /dlmm-fee-claim/claim - Build fee claim transactions
// ============================================================================

router.post('/claim', feeClaimLimiter, async (req: Request, res: Response) => {
  try {
    const { payerPublicKey, poolAddress: poolAddressInput } = req.body;

    console.log('DLMM fee claim request received:', { payerPublicKey, poolAddress: poolAddressInput });

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

    // Initialize connection
    const connection = new Connection(RPC_URL, 'confirmed');

    // Get pool fee configuration (checks legacy config, then database for DAO pools)
    const feeConfig = await getPoolFeeConfig(connection, poolAddress.toBase58());
    if (!feeConfig) {
      return res.status(400).json({
        error: `Pool not supported for fee claiming. No fee configuration for pool: ${poolAddress.toBase58()}`
      });
    }

    const { feeRecipients, lpOwnerKeypair: lpOwner, source, daoName } = feeConfig;

    // Validate fee percentages sum to 100
    const totalPercent = feeRecipients.reduce((sum, r) => sum + r.percent, 0);
    if (Math.abs(totalPercent - 100) > 0.01) {  // Allow small floating point tolerance
      return res.status(500).json({
        error: `Invalid fee configuration for pool. Percentages sum to ${totalPercent}, expected 100.`
      });
    }

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

    // Use first position (matching DAMM pattern)
    const position = userPositions[0];
    const positionData = position.positionData;

    // Get claimable fees from position data
    const totalTokenXFees = new BN(positionData.feeX);
    const totalTokenYFees = new BN(positionData.feeY);

    console.log(`  Position: ${position.publicKey.toBase58()}`);
    console.log(`  Token X fees: ${totalTokenXFees.toString()}`);
    console.log(`  Token Y fees: ${totalTokenYFees.toString()}`);

    // Check if there are any fees to claim
    if (totalTokenXFees.isZero() && totalTokenYFees.isZero()) {
      return res.status(400).json({
        error: 'No fees available to claim'
      });
    }

    // Detect token programs (Token-2022 vs SPL Token) before calling getMint
    const tokenPrograms = await getTokenProgramsForMints(connection, [tokenXMint, tokenYMint]);
    const tokenXProgram = tokenPrograms.get(tokenXMint.toBase58())!;
    const tokenYProgram = tokenPrograms.get(tokenYMint.toBase58())!;

    const tokenXMintInfo = await getMint(connection, tokenXMint, undefined, tokenXProgram);
    const tokenYMintInfo = await getMint(connection, tokenYMint, undefined, tokenYProgram);

    // Check if tokens are native SOL (wrapped SOL)
    const isTokenXNativeSOL = tokenXMint.equals(NATIVE_MINT);
    const isTokenYNativeSOL = tokenYMint.equals(NATIVE_MINT);

    // Build the claim fee transactions using DLMM SDK
    // SDK returns multiple transactions for positions spanning many bins
    const claimFeeTxs = await dlmmPool.claimSwapFee({
      owner: lpOwner.publicKey,
      position: position,
    });

    const { blockhash } = await connection.getLatestBlockhash();

    // Prepare all transactions (claim txs from SDK + transfer tx)
    const allTransactions: Transaction[] = [];
    const unsignedTransactions: string[] = [];
    const unsignedTransactionHashes: string[] = [];

    // Process each claim transaction from SDK
    for (const claimTx of claimFeeTxs) {
      claimTx.feePayer = payerPubKey;
      claimTx.recentBlockhash = blockhash;
      allTransactions.push(claimTx);
    }

    // Build separate transfer transaction for distributing fees to recipients
    const transferTx = new Transaction();
    transferTx.feePayer = payerPubKey;
    transferTx.recentBlockhash = blockhash;

    // Get LP owner's token accounts (with correct token programs)
    const tokenXAta = await getAssociatedTokenAddress(
      tokenXMint,
      lpOwner.publicKey,
      false,
      tokenXProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const tokenYAta = await getAssociatedTokenAddress(
      tokenYMint,
      lpOwner.publicKey,
      false,
      tokenYProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Add transfer instructions for each fee recipient based on their percentage
    for (const recipient of feeRecipients) {
      const destinationAddress = new PublicKey(recipient.address);

      // Calculate this recipient's share of fees
      // Use basis points (percent * 1000) for precision with decimal percentages
      const basisPoints = Math.round(recipient.percent * 1000);
      const tokenXTransferAmount = totalTokenXFees.mul(new BN(basisPoints)).div(new BN(100000));
      const tokenYTransferAmount = totalTokenYFees.mul(new BN(basisPoints)).div(new BN(100000));

      // Get destination token accounts (with correct token programs)
      // allowOwnerOffCurve: true allows PDAs as fee recipients
      const destTokenXAta = isTokenXNativeSOL ? destinationAddress : await getAssociatedTokenAddress(
        tokenXMint,
        destinationAddress,
        true, // allowOwnerOffCurve
        tokenXProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const destTokenYAta = isTokenYNativeSOL ? destinationAddress : await getAssociatedTokenAddress(
        tokenYMint,
        destinationAddress,
        true, // allowOwnerOffCurve
        tokenYProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Add ATA creation instruction for Token X destination (if not native SOL)
      if (!tokenXTransferAmount.isZero() && !isTokenXNativeSOL) {
        transferTx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            payerPubKey,
            destTokenXAta,
            destinationAddress,
            tokenXMint,
            tokenXProgram,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }

      // Add ATA creation instruction for Token Y destination (if not native SOL)
      if (!tokenYTransferAmount.isZero() && !isTokenYNativeSOL) {
        transferTx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            payerPubKey,
            destTokenYAta,
            destinationAddress,
            tokenYMint,
            tokenYProgram,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }

      // Add transfer instruction for Token X
      if (!tokenXTransferAmount.isZero()) {
        if (isTokenXNativeSOL) {
          // Transfer native SOL using SystemProgram.transfer
          transferTx.add(
            SystemProgram.transfer({
              fromPubkey: lpOwner.publicKey,
              toPubkey: destinationAddress,
              lamports: Number(tokenXTransferAmount.toString())
            })
          );
        } else {
          // Transfer SPL token using Token Program
          transferTx.add(
            createTransferInstruction(
              tokenXAta,
              destTokenXAta,
              lpOwner.publicKey,
              BigInt(tokenXTransferAmount.toString()),
              [],
              tokenXProgram
            )
          );
        }
      }

      // Add transfer instruction for Token Y
      if (!tokenYTransferAmount.isZero()) {
        if (isTokenYNativeSOL) {
          // Transfer native SOL using SystemProgram.transfer
          transferTx.add(
            SystemProgram.transfer({
              fromPubkey: lpOwner.publicKey,
              toPubkey: destinationAddress,
              lamports: Number(tokenYTransferAmount.toString())
            })
          );
        } else {
          // Transfer SPL token using Token Program
          transferTx.add(
            createTransferInstruction(
              tokenYAta,
              destTokenYAta,
              lpOwner.publicKey,
              BigInt(tokenYTransferAmount.toString()),
              [],
              tokenYProgram
            )
          );
        }
      }
    }

    // Add transfer transaction to the list
    allTransactions.push(transferTx);

    // Serialize all transactions and compute hashes
    for (const tx of allTransactions) {
      unsignedTransactions.push(bs58.encode(tx.serialize({ requireAllSignatures: false })));
      unsignedTransactionHashes.push(
        crypto.createHash('sha256').update(tx.serializeMessage()).digest('hex')
      );
    }

    // Generate unique request ID
    const requestId = crypto.randomBytes(16).toString('hex');

    const totalInstructions = allTransactions.reduce((sum, tx) => sum + tx.instructions.length, 0);

    console.log('✓ DLMM fee claim transactions built successfully');
    console.log(`  Pool: ${poolAddress.toBase58()}`);
    console.log(`  Position: ${position.publicKey.toBase58()}`);
    console.log(`  Token X fees: ${totalTokenXFees.toString()}`);
    console.log(`  Token Y fees: ${totalTokenYFees.toString()}`);
    console.log(`  Transactions: ${allTransactions.length} (${claimFeeTxs.length} claim + 1 transfer)`);
    console.log(`  Fee recipients: ${feeRecipients.map(r => `${r.address.substring(0, 8)}...(${r.percent}%)`).join(', ')}`);
    console.log(`  Request ID: ${requestId}`);

    // Store transaction data in memory
    feeClaimRequests.set(requestId, {
      unsignedTransactions,
      unsignedTransactionHashes,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      feePayerAddress: payerPubKey.toBase58(),
      feeRecipients,
      estimatedTokenXFees: totalTokenXFees.toString(),
      estimatedTokenYFees: totalTokenYFees.toString(),
      positionAddress: position.publicKey.toBase58(),
      timestamp: Date.now()
    });

    res.json({
      success: true,
      transactions: unsignedTransactions,
      transactionCount: unsignedTransactions.length,
      requestId,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      tokenXDecimals: tokenXMintInfo.decimals,
      tokenYDecimals: tokenYMintInfo.decimals,
      isTokenXNativeSOL,
      isTokenYNativeSOL,
      positionAddress: position.publicKey.toBase58(),
      totalPositions: userPositions.length,
      instructionsCount: totalInstructions,
      feeRecipients,
      estimatedFees: {
        tokenX: totalTokenXFees.toString(),
        tokenY: totalTokenYFees.toString(),
      },
      message: `Sign all ${unsignedTransactions.length} transactions and submit to /dlmm-fee-claim/confirm`
    });

  } catch (error) {
    console.error('DLMM claim fees error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create fee claim transaction'
    });
  }
});

// ============================================================================
// POST /dlmm-fee-claim/confirm - Confirm and submit fee claim transactions
// ============================================================================
/**
 * Security measures implemented (matching DAMM):
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
    const { signedTransactions, requestId } = req.body;

    console.log('DLMM fee claim confirm request received:', { requestId });

    // Validate required fields
    if (!signedTransactions || !Array.isArray(signedTransactions) || !requestId) {
      return res.status(400).json({
        error: 'Missing required fields: signedTransactions (array) and requestId'
      });
    }

    // Retrieve the fee claim data from memory
    const feeClaimData = feeClaimRequests.get(requestId);
    if (!feeClaimData) {
      return res.status(400).json({
        error: 'Fee claim request not found or expired. Please call /dlmm-fee-claim/claim first.'
      });
    }

    // Validate transaction count matches
    if (signedTransactions.length !== feeClaimData.unsignedTransactions.length) {
      return res.status(400).json({
        error: `Transaction count mismatch. Expected ${feeClaimData.unsignedTransactions.length}, got ${signedTransactions.length}`
      });
    }

    console.log('  Pool:', feeClaimData.poolAddress);
    console.log('  Transactions:', signedTransactions.length);

    // Acquire lock for this pool IMMEDIATELY to prevent race conditions
    releaseLock = await acquireFeeClaimLock(feeClaimData.poolAddress);
    console.log('  Lock acquired');

    // NOTE: No authorization check needed - fee recipients are either:
    // 1. Hardcoded in LEGACY_POOL_FEE_CONFIG for legacy pools
    // 2. Dynamically determined from database for DAO pools (protocol + DAO treasury)
    // Transaction hash verification ensures the exact transactions from /claim are submitted
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

    // Initialize connection
    const connection = new Connection(RPC_URL, 'confirmed');

    // Get pool fee configuration to retrieve LP keypair (checks legacy config, then database)
    const poolFeeConfig = await getPoolFeeConfig(connection, feeClaimData.poolAddress);
    if (!poolFeeConfig) {
      return res.status(400).json({
        error: `Pool not supported for fee claiming: ${feeClaimData.poolAddress}`
      });
    }

    const lpOwnerKeypair = poolFeeConfig.lpOwnerKeypair;
    const expectedFeePayer = new PublicKey(feeClaimData.feePayerAddress);

    // Deserialize and verify ALL transactions before sending any
    const transactions: Transaction[] = [];

    for (let i = 0; i < signedTransactions.length; i++) {
      const signedTx = signedTransactions[i];
      const expectedHash = feeClaimData.unsignedTransactionHashes[i];

      let transaction: Transaction;
      try {
        const transactionBuffer = bs58.decode(signedTx);
        transaction = Transaction.from(transactionBuffer);
      } catch (error) {
        return res.status(400).json({
          error: `Failed to deserialize transaction ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }

      // SECURITY: Validate transaction has recent blockhash to prevent replay attacks
      if (!transaction.recentBlockhash) {
        return res.status(400).json({
          error: `Invalid transaction ${i + 1}: missing blockhash`
        });
      }

      // Check if blockhash is still valid
      const isBlockhashValid = await connection.isBlockhashValid(
        transaction.recentBlockhash,
        { commitment: 'confirmed' }
      );

      if (!isBlockhashValid.value) {
        return res.status(400).json({
          error: `Invalid transaction ${i + 1}: blockhash is expired. Please create a new request.`
        });
      }

      // Verify fee payer
      if (!transaction.feePayer) {
        return res.status(400).json({
          error: `Transaction ${i + 1} missing fee payer`
        });
      }

      if (!transaction.feePayer.equals(expectedFeePayer)) {
        return res.status(400).json({
          error: `Transaction ${i + 1} fee payer mismatch`
        });
      }

      // Verify transaction contains instructions
      if (transaction.instructions.length === 0) {
        return res.status(400).json({
          error: `Transaction ${i + 1} verification failed: No instructions found`
        });
      }

      // Verify fee payer has signed
      const feePayerSignature = transaction.signatures.find(sig =>
        sig.publicKey.equals(transaction.feePayer!)
      );

      if (!feePayerSignature || !feePayerSignature.signature) {
        return res.status(400).json({
          error: `Transaction ${i + 1} verification failed: Fee payer has not signed`
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
          error: `Transaction ${i + 1} verification failed: Invalid fee payer signature`
        });
      }

      // ========================================================================
      // CRITICAL SECURITY: Verify transaction hasn't been tampered with
      // ========================================================================
      const receivedTransactionHash = crypto.createHash('sha256')
        .update(transaction.serializeMessage())
        .digest('hex');

      if (receivedTransactionHash !== expectedHash) {
        console.log(`  ⚠️  Transaction ${i + 1} hash mismatch detected`);
        console.log(`    Expected: ${expectedHash.substring(0, 16)}...`);
        console.log(`    Received: ${receivedTransactionHash.substring(0, 16)}...`);
        // Delete the request to prevent further attempts with tampered transactions
        feeClaimRequests.delete(requestId);
        return res.status(400).json({
          error: `Transaction ${i + 1} verification failed: transaction has been modified`,
          details: 'Transaction structure does not match the original unsigned transaction'
        });
      }

      transactions.push(transaction);
    }

    console.log(`  ✓ All ${transactions.length} transactions validated`);

    // Send all transactions sequentially
    const signatures: string[] = [];
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    for (let i = 0; i < transactions.length; i++) {
      const transaction = transactions[i];

      // Add LP owner signature
      transaction.partialSign(lpOwnerKeypair);

      // Send the transaction
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
        console.error(`  ⚠ Confirmation timeout for transaction ${i + 1}:`, error);
        // Continue even if confirmation fails - transaction may still succeed
      }
    }

    console.log('✓ DLMM fee claim transactions sent');
    console.log(`  Pool: ${feeClaimData.poolAddress}`);
    console.log(`  Token X: ${feeClaimData.tokenXMint}, Fees: ${feeClaimData.estimatedTokenXFees}`);
    console.log(`  Token Y: ${feeClaimData.tokenYMint}, Fees: ${feeClaimData.estimatedTokenYFees}`);
    console.log(`  Fee recipients: ${feeClaimData.feeRecipients.map(r => `${r.address.substring(0, 8)}...(${r.percent}%)`).join(', ')}`);
    console.log(`  Signatures: ${signatures.join(', ')}`);

    // Clean up the request from memory after successful submission
    feeClaimRequests.delete(requestId);

    res.json({
      success: true,
      signatures,
      transactionCount: signatures.length,
      poolAddress: feeClaimData.poolAddress,
      tokenXMint: feeClaimData.tokenXMint,
      tokenYMint: feeClaimData.tokenYMint,
      positionAddress: feeClaimData.positionAddress,
      feeRecipients: feeClaimData.feeRecipients,
      estimatedFees: {
        tokenX: feeClaimData.estimatedTokenXFees,
        tokenY: feeClaimData.estimatedTokenYFees
      },
      message: `${signatures.length} fee claim transactions submitted successfully`
    });

  } catch (error) {
    console.error('DLMM confirm fee claim error:', error);
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
