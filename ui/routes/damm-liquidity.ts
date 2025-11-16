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
import { Connection, Keypair, Transaction, PublicKey, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getMint,
  createAssociatedTokenAccountIdempotentInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
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

    if (!poolAddressInput) {
      return res.status(400).json({
        error: 'Missing required field: poolAddress'
      });
    }

    // Validate poolAddress is a valid Solana public key
    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
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
 * 1. Lock system - Prevents concurrent operations for the same pool
 * 2. Blockhash validation - Prevents replay attacks
 * 3. Transaction structure validation - Prevents malicious instruction injection
 * 4. Manager wallet signature verification - ONLY manager wallet can submit
 * 5. Request expiry - 10 minute timeout
 * 6. Comprehensive logging
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
    const MANAGER_WALLET = process.env.MANAGER_WALLET;

    if (!RPC_URL || !LP_OWNER_PRIVATE_KEY || !MANAGER_WALLET) {
      return res.status(500).json({
        error: 'Server configuration incomplete'
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

    // Validate transaction structure
    console.log(`  Validating transaction structure (${transaction.instructions.length} instructions)...`);

    const COMPUTE_BUDGET_PROGRAM_ID = ComputeBudgetProgram.programId;
    const LIGHTHOUSE_PROGRAM_ID = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");
    const METEORA_CP_AMM_PROGRAM_ID = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
    const METEORA_DAMM_V2_PROGRAM_ID = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

    const lpOwnerAddress = new PublicKey(withdrawData.lpOwnerAddress);
    const managerAddress = new PublicKey(withdrawData.managerAddress);
    const tokenAMint = new PublicKey(withdrawData.tokenAMint);
    const tokenBMint = new PublicKey(withdrawData.tokenBMint);
    const isTokenBNativeSOL = tokenBMint.equals(NATIVE_MINT);

    // Validate instructions
    for (let i = 0; i < transaction.instructions.length; i++) {
      const instruction = transaction.instructions[i];
      const programId = instruction.programId;

      // Only allow safe programs
      if (!programId.equals(TOKEN_PROGRAM_ID) &&
          !programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) &&
          !programId.equals(COMPUTE_BUDGET_PROGRAM_ID) &&
          !programId.equals(LIGHTHOUSE_PROGRAM_ID) &&
          !programId.equals(METEORA_CP_AMM_PROGRAM_ID) &&
          !programId.equals(METEORA_DAMM_V2_PROGRAM_ID) &&
          !programId.equals(SystemProgram.programId)) {
        return res.status(400).json({
          error: 'Invalid transaction: unauthorized program instruction detected',
          details: `Instruction ${i} uses unauthorized program: ${programId.toBase58()}`
        });
      }

      // Validate TOKEN_PROGRAM instructions
      if (programId.equals(TOKEN_PROGRAM_ID)) {
        const opcode = instruction.data[0];

        if (opcode !== 3 && opcode !== 9 && opcode !== 12) {
          return res.status(400).json({
            error: 'Invalid transaction: unauthorized token instruction detected',
            details: `Instruction ${i} has invalid opcode: ${opcode}`
          });
        }

        // Validate transfer authority is LP owner
        if (opcode === 3 || opcode === 12) {
          const authorityIndex = opcode === 3 ? 2 : 3;
          if (instruction.keys.length > authorityIndex) {
            const authority = instruction.keys[authorityIndex].pubkey;
            if (!authority.equals(lpOwnerAddress)) {
              return res.status(400).json({
                error: 'Invalid transaction: transfer authority must be LP owner',
                details: `Instruction ${i} authority mismatch`
              });
            }

            // Validate destination is manager wallet's ATA
            const destIndex = opcode === 3 ? 1 : 2;
            const destination = instruction.keys[destIndex].pubkey;

            const managerTokenAAta = await getAssociatedTokenAddress(tokenAMint, managerAddress);
            const managerTokenBAta = isTokenBNativeSOL ? managerAddress : await getAssociatedTokenAddress(tokenBMint, managerAddress);
            const lpTokenAAta = await getAssociatedTokenAddress(tokenAMint, lpOwnerAddress);
            const lpTokenBAta = isTokenBNativeSOL ? lpOwnerAddress : await getAssociatedTokenAddress(tokenBMint, lpOwnerAddress);

            const validDestinations = [
              managerTokenAAta.toBase58(),
              managerTokenBAta.toBase58(),
              lpTokenAAta.toBase58(),
              lpTokenBAta.toBase58()
            ];

            if (!validDestinations.includes(destination.toBase58())) {
              return res.status(400).json({
                error: 'Invalid transaction: transfer destination not authorized',
                details: `Instruction ${i} invalid destination`
              });
            }

            // Validate transfer amounts
            const amountBytes = Buffer.from(instruction.data.subarray(1, 9));
            const transferAmount = new BN(amountBytes, 'le');

            const destinationKey = destination.toBase58();
            const isTokenATransfer = destinationKey === managerTokenAAta.toBase58() || destinationKey === lpTokenAAta.toBase58();
            const isTokenBTransfer = destinationKey === managerTokenBAta.toBase58() || destinationKey === lpTokenBAta.toBase58();

            if (isTokenATransfer) {
              const maxTokenA = new BN(withdrawData.estimatedTokenAAmount);
              if (transferAmount.gt(maxTokenA)) {
                return res.status(400).json({
                  error: 'Invalid transaction: Token A transfer amount exceeds expected',
                  details: `Instruction ${i} amount too large`
                });
              }
            } else if (isTokenBTransfer) {
              const maxTokenB = new BN(withdrawData.estimatedTokenBAmount);
              if (transferAmount.gt(maxTokenB)) {
                return res.status(400).json({
                  error: 'Invalid transaction: Token B transfer amount exceeds expected',
                  details: `Instruction ${i} amount too large`
                });
              }
            }
          }
        }
      }

      // Validate SystemProgram instructions (for native SOL)
      if (programId.equals(SystemProgram.programId)) {
        const instructionType = instruction.data.readUInt32LE(0);

        if (instructionType !== 2) {
          return res.status(400).json({
            error: 'Invalid transaction: unauthorized system program instruction',
            details: `Instruction ${i} invalid type`
          });
        }

        if (instruction.keys.length >= 2) {
          const from = instruction.keys[0].pubkey;
          const to = instruction.keys[1].pubkey;

          if (!from.equals(lpOwnerAddress)) {
            return res.status(400).json({
              error: 'Invalid transaction: system transfer must be from LP owner',
              details: `Instruction ${i} from mismatch`
            });
          }

          if (!to.equals(managerAddress)) {
            return res.status(400).json({
              error: 'Invalid transaction: system transfer destination must be manager wallet',
              details: `Instruction ${i} to mismatch`
            });
          }

          // Validate amount
          if (isTokenBNativeSOL && instruction.data.length >= 12) {
            const amountBytes = Buffer.from(instruction.data.subarray(4, 12));
            const transferAmount = new BN(amountBytes, 'le');
            const maxTokenB = new BN(withdrawData.estimatedTokenBAmount);

            if (transferAmount.gt(maxTokenB)) {
              return res.status(400).json({
                error: 'Invalid transaction: SOL transfer amount exceeds expected',
                details: `Instruction ${i} amount too large`
              });
            }
          }
        }
      }

      // Validate ATA instructions
      if (programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        if (instruction.data.length < 1 || instruction.data[0] !== 1) {
          const opcode = instruction.data.length > 0 ? instruction.data[0] : 'undefined';
          console.log(`  ⚠️  VALIDATION FAILED: Unauthorized ATA instruction in instruction ${i}`);
          console.log(`    Opcode: ${opcode}`);
          console.log(`    Expected: 1 (CreateIdempotent)`);
          return res.status(400).json({
            error: 'Invalid transaction: unauthorized ATA instruction detected',
            details: `Instruction ${i} invalid ATA opcode`
          });
        }
      }
    }

    console.log('  ✓ Transaction structure validated');

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

    if (!poolAddressInput) {
      return res.status(400).json({
        error: 'Missing required field: poolAddress'
      });
    }

    // Validate poolAddress is a valid Solana public key
    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
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
 * 1. Lock system - Prevents concurrent operations for the same pool
 * 2. Transaction hash comparison - Detects any tampering with unsigned transaction
 * 3. Blockhash validation - Prevents replay attacks
 * 4. Transaction structure validation - Prevents malicious instruction injection
 *    - Manager transfers: Must go to LP owner only
 *    - LP owner transfers: Must go to pool vaults only (CRITICAL: prevents fund drainage)
 *    - Transfer amounts validated against expected maximums
 * 5. Manager wallet signature verification - ONLY manager wallet can submit
 * 6. Request expiry - 10 minute timeout
 * 7. Comprehensive logging - All security validations logged
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
    const MANAGER_WALLET = process.env.MANAGER_WALLET;

    if (!RPC_URL || !LP_OWNER_PRIVATE_KEY || !MANAGER_WALLET) {
      return res.status(500).json({
        error: 'Server configuration incomplete'
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
    console.log(`  ✓ Transaction integrity verified`);

    // Validate transaction structure
    console.log(`  Validating transaction structure (${transaction.instructions.length} instructions)...`);

    const COMPUTE_BUDGET_PROGRAM_ID = ComputeBudgetProgram.programId;
    const LIGHTHOUSE_PROGRAM_ID = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");
    const METEORA_CP_AMM_PROGRAM_ID = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
    const METEORA_DAMM_V2_PROGRAM_ID = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

    const lpOwnerAddress = new PublicKey(depositData.lpOwnerAddress);
    const managerAddress = new PublicKey(depositData.managerAddress);
    const tokenAMint = new PublicKey(depositData.tokenAMint);
    const tokenBMint = new PublicKey(depositData.tokenBMint);
    const tokenAVault = new PublicKey(depositData.tokenAVault);
    const tokenBVault = new PublicKey(depositData.tokenBVault);
    const isTokenBNativeSOL = tokenBMint.equals(NATIVE_MINT);

    // Validate instructions
    for (let i = 0; i < transaction.instructions.length; i++) {
      const instruction = transaction.instructions[i];
      const programId = instruction.programId;

      // Only allow safe programs
      if (!programId.equals(TOKEN_PROGRAM_ID) &&
          !programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) &&
          !programId.equals(COMPUTE_BUDGET_PROGRAM_ID) &&
          !programId.equals(LIGHTHOUSE_PROGRAM_ID) &&
          !programId.equals(METEORA_CP_AMM_PROGRAM_ID) &&
          !programId.equals(METEORA_DAMM_V2_PROGRAM_ID) &&
          !programId.equals(SystemProgram.programId)) {
        console.log(`  ⚠️  VALIDATION FAILED: Unauthorized program in instruction ${i}`);
        console.log(`    Program ID: ${programId.toBase58()}`);
        return res.status(400).json({
          error: 'Invalid transaction: unauthorized program instruction detected',
          details: `Instruction ${i} uses unauthorized program: ${programId.toBase58()}`
        });
      }

      // Validate TOKEN_PROGRAM instructions
      if (programId.equals(TOKEN_PROGRAM_ID)) {
        const opcode = instruction.data[0];

        // Allowed opcodes:
        // 3 = Transfer, 9 = InitializeAccount, 12 = TransferChecked, 17 = SyncNative (for WSOL)
        if (opcode !== 3 && opcode !== 9 && opcode !== 12 && opcode !== 17) {
          console.log(`  ⚠️  VALIDATION FAILED: Unauthorized token instruction opcode ${opcode} in instruction ${i}`);
          console.log(`    Allowed opcodes: 3 (Transfer), 9 (InitializeAccount), 12 (TransferChecked), 17 (SyncNative)`);
          return res.status(400).json({
            error: 'Invalid transaction: unauthorized token instruction detected',
            details: `Instruction ${i} has invalid opcode: ${opcode}`
          });
        }

        // Validate transfer instructions (Transfer=3, TransferChecked=12)
        if (opcode === 3 || opcode === 12) {
          const authorityIndex = opcode === 3 ? 2 : 3;
          if (instruction.keys.length > authorityIndex) {
            const authority = instruction.keys[authorityIndex].pubkey;

            // Authority must be either manager wallet (for initial transfer) or LP owner (for add liquidity)
            if (!authority.equals(managerAddress) && !authority.equals(lpOwnerAddress)) {
              console.log(`  ⚠️  VALIDATION FAILED: Invalid transfer authority in instruction ${i}`);
              console.log(`    Authority: ${authority.toBase58()}`);
              console.log(`    Expected: ${managerAddress.toBase58()} (manager) or ${lpOwnerAddress.toBase58()} (LP owner)`);
              return res.status(400).json({
                error: 'Invalid transaction: transfer authority must be manager or LP owner',
                details: `Instruction ${i} authority mismatch`
              });
            }

            const destIndex = opcode === 3 ? 1 : 2;
            const destination = instruction.keys[destIndex].pubkey;

            // Get expected ATAs
            const lpTokenAAta = await getAssociatedTokenAddress(tokenAMint, lpOwnerAddress);
            const lpTokenBAta = isTokenBNativeSOL ? lpOwnerAddress : await getAssociatedTokenAddress(tokenBMint, lpOwnerAddress);

            // SECURITY FIX: Validate destination and amount for BOTH authorities
            if (authority.equals(managerAddress)) {
              // Manager transfers: Must go to LP owner's ATAs
              const validDestinations = [
                lpTokenAAta.toBase58(),
                lpTokenBAta.toBase58()
              ];

              if (!validDestinations.includes(destination.toBase58())) {
                console.log(`  ⚠️  VALIDATION FAILED: Unauthorized manager transfer destination in instruction ${i}`);
                console.log(`    Destination: ${destination.toBase58()}`);
                console.log(`    Valid destinations: ${validDestinations.join(', ')}`);
                return res.status(400).json({
                  error: 'Invalid transaction: transfer from manager must go to LP owner',
                  details: `Instruction ${i} invalid destination`
                });
              }

              // Validate transfer amounts
              const amountBytes = Buffer.from(instruction.data.subarray(1, 9));
              const transferAmount = new BN(amountBytes, 'le');

              const destinationKey = destination.toBase58();
              const isTokenATransfer = destinationKey === lpTokenAAta.toBase58();
              const isTokenBTransfer = destinationKey === lpTokenBAta.toBase58();

              if (isTokenATransfer) {
                const maxTokenA = new BN(depositData.tokenAAmount);
                if (transferAmount.gt(maxTokenA)) {
                  console.log(`  ⚠️  Blocked excessive Token A transfer: ${transferAmount.toString()} > ${maxTokenA.toString()}`);
                  return res.status(400).json({
                    error: 'Invalid transaction: Token A transfer amount exceeds expected',
                    details: `Instruction ${i} amount too large`
                  });
                }
              } else if (isTokenBTransfer) {
                const maxTokenB = new BN(depositData.tokenBAmount);
                if (transferAmount.gt(maxTokenB)) {
                  console.log(`  ⚠️  Blocked excessive Token B transfer: ${transferAmount.toString()} > ${maxTokenB.toString()}`);
                  return res.status(400).json({
                    error: 'Invalid transaction: Token B transfer amount exceeds expected',
                    details: `Instruction ${i} amount too large`
                  });
                }
              }
            } else if (authority.equals(lpOwnerAddress)) {
              // CRITICAL SECURITY: LP owner transfers must ONLY go to pool vaults or LP owner's own ATAs
              // This prevents malicious clients from draining LP owner funds
              const validDestinations = [
                lpTokenAAta.toBase58(),
                lpTokenBAta.toBase58(),
                tokenAVault.toBase58(),
                tokenBVault.toBase58()
              ];

              if (!validDestinations.includes(destination.toBase58())) {
                console.log(`  ⚠️  VALIDATION FAILED: Unauthorized LP owner transfer destination in instruction ${i}`);
                console.log(`    Destination: ${destination.toBase58()}`);
                console.log(`    Valid destinations: ${validDestinations.join(', ')}`);
                return res.status(400).json({
                  error: 'Invalid transaction: LP owner transfers must go to pool vaults only',
                  details: `Instruction ${i} unauthorized destination for LP owner transfer`
                });
              }

              // Validate amounts don't exceed what was provided
              const amountBytes = Buffer.from(instruction.data.subarray(1, 9));
              const transferAmount = new BN(amountBytes, 'le');

              const destinationKey = destination.toBase58();
              const isTokenATransfer = destinationKey === tokenAVault.toBase58() || destinationKey === lpTokenAAta.toBase58();
              const isTokenBTransfer = destinationKey === tokenBVault.toBase58() || destinationKey === lpTokenBAta.toBase58();

              if (isTokenATransfer) {
                const maxTokenA = new BN(depositData.tokenAAmount);
                if (transferAmount.gt(maxTokenA)) {
                  console.log(`  ⚠️  Blocked excessive LP Token A transfer: ${transferAmount.toString()} > ${maxTokenA.toString()}`);
                  return res.status(400).json({
                    error: 'Invalid transaction: Token A transfer amount exceeds expected',
                    details: `Instruction ${i} amount too large`
                  });
                }
              } else if (isTokenBTransfer) {
                const maxTokenB = new BN(depositData.tokenBAmount);
                if (transferAmount.gt(maxTokenB)) {
                  console.log(`  ⚠️  Blocked excessive LP Token B transfer: ${transferAmount.toString()} > ${maxTokenB.toString()}`);
                  return res.status(400).json({
                    error: 'Invalid transaction: Token B transfer amount exceeds expected',
                    details: `Instruction ${i} amount too large`
                  });
                }
              }
            }
          }
        }
      }

      // Validate SystemProgram instructions (for native SOL)
      if (programId.equals(SystemProgram.programId)) {
        const instructionType = instruction.data.readUInt32LE(0);

        if (instructionType !== 2) {
          console.log(`  ⚠️  VALIDATION FAILED: Unauthorized system program instruction type ${instructionType} in instruction ${i}`);
          console.log(`    Expected: 2 (Transfer)`);
          return res.status(400).json({
            error: 'Invalid transaction: unauthorized system program instruction',
            details: `Instruction ${i} invalid type`
          });
        }

        if (instruction.keys.length >= 2) {
          const from = instruction.keys[0].pubkey;
          const to = instruction.keys[1].pubkey;

          // Validate sender is manager or LP owner
          if (!from.equals(managerAddress) && !from.equals(lpOwnerAddress)) {
            console.log(`  ⚠️  VALIDATION FAILED: Invalid system transfer sender in instruction ${i}`);
            console.log(`    From: ${from.toBase58()}`);
            console.log(`    Expected: ${managerAddress.toBase58()} (manager) or ${lpOwnerAddress.toBase58()} (LP owner)`);
            return res.status(400).json({
              error: 'Invalid transaction: system transfer must be from manager or LP owner',
              details: `Instruction ${i} from mismatch`
            });
          }

          // SECURITY: Validate destination based on sender
          if (from.equals(managerAddress)) {
            // Manager can only send to LP owner
            if (!to.equals(lpOwnerAddress)) {
              console.log(`  ⚠️  VALIDATION FAILED: Unauthorized manager SOL transfer in instruction ${i}`);
              console.log(`    To: ${to.toBase58()}`);
              console.log(`    Expected: ${lpOwnerAddress.toBase58()} (LP owner)`);
              return res.status(400).json({
                error: 'Invalid transaction: manager SOL transfer must be to LP owner',
                details: `Instruction ${i} to mismatch`
              });
            }
          } else if (from.equals(lpOwnerAddress)) {
            // LP owner SOL transfers are allowed only for SOL wrapping (WSOL)
            // Valid destinations: LP owner's WSOL ATA (for wrapping)
            const lpOwnerWsolAta = await getAssociatedTokenAddress(
              NATIVE_MINT,
              lpOwnerAddress,
              false,
              TOKEN_PROGRAM_ID
            );

            const validDestinations = [
              lpOwnerWsolAta.toBase58(),
              lpOwnerAddress.toBase58(), // Allow self-transfers for account creation
            ];

            if (!validDestinations.includes(to.toBase58())) {
              console.log(`  ⚠️  VALIDATION FAILED: Unauthorized LP owner SOL transfer in instruction ${i}`);
              console.log(`    To: ${to.toBase58()}`);
              console.log(`    Valid destinations: ${validDestinations.join(', ')}`);
              return res.status(400).json({
                error: 'Invalid transaction: LP owner SOL transfers must be to WSOL account only',
                details: `Instruction ${i} unauthorized destination for LP owner SOL transfer`
              });
            }
          }

          // Validate amount
          if (isTokenBNativeSOL && instruction.data.length >= 12) {
            const amountBytes = Buffer.from(instruction.data.subarray(4, 12));
            const transferAmount = new BN(amountBytes, 'le');
            const maxTokenB = new BN(depositData.tokenBAmount);

            if (transferAmount.gt(maxTokenB)) {
              console.log(`  ⚠️  VALIDATION FAILED: Excessive SOL transfer amount in instruction ${i}`);
              console.log(`    Amount: ${transferAmount.toString()} lamports`);
              console.log(`    Maximum allowed: ${maxTokenB.toString()} lamports`);
              return res.status(400).json({
                error: 'Invalid transaction: SOL transfer amount exceeds expected',
                details: `Instruction ${i} amount too large`
              });
            }
          }
        }
      }

      // Validate ATA instructions
      if (programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        if (instruction.data.length < 1 || instruction.data[0] !== 1) {
          const opcode = instruction.data.length > 0 ? instruction.data[0] : 'undefined';
          console.log(`  ⚠️  VALIDATION FAILED: Unauthorized ATA instruction in instruction ${i}`);
          console.log(`    Opcode: ${opcode}`);
          console.log(`    Expected: 1 (CreateIdempotent)`);
          return res.status(400).json({
            error: 'Invalid transaction: unauthorized ATA instruction detected',
            details: `Instruction ${i} invalid ATA opcode`
          });
        }
      }
    }

    console.log('  ✓ Transaction structure validated');
    console.log(`    - Verified ${transaction.instructions.length} instructions`);
    console.log(`    - All transfers validated and authorized`);
    console.log(`    - Maximum amounts enforced`);

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
