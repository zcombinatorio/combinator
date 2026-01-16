/*
 * Z Combinator - Solana Token Launchpad
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
 */

import { Router, Request, Response } from 'express';
import { Connection, Keypair, Transaction, PublicKey, ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getMint,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction
} from '@solana/spl-token';
import bs58 from 'bs58';
import BN from 'bn.js';
import nacl from 'tweetnacl';
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import * as crypto from 'crypto';
import {
  getPresaleByTokenAddress,
  getUserPresaleContribution,
  getPresaleBids,
  getTotalPresaleBids,
  recordPresaleBid,
  getPresaleBidBySignature,
  updatePresaleStatus
} from '../lib/db';
import {
  calculateVestingInfo,
  recordPresaleClaim,
  getPresaleStats,
  initializePresaleClaims,
  type VestingInfo
} from '../lib/presaleVestingService';
import { decryptEscrowKeypair } from '../lib/presale-escrow';
import { decrypt } from '../lib/crypto';
import {
  isValidSolanaAddress,
  isValidTransactionSignature
} from '../lib/validation';
import { verifyPresaleTokenTransaction } from '../lib/solana-verification';
import {
  presaleClaimTransactions,
  presaleLaunchTransactions,
  acquirePresaleClaimLock,
  startPresaleTransactionCleanup
} from '../lib/presaleService';

/**
 * Presale Routes
 *
 * Express router for presale-related endpoints including:
 * - Presale claims (prepare, confirm, info)
 * - Presale stats and bids
 * - Presale launch
 */

const router = Router();

// Presale claim rate limiter (more lenient for claim operations)
const presaleClaimLimiter = rateLimit({
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
  message: 'Too many claim requests, please wait a moment.'
});

// Start transaction cleanup
startPresaleTransactionCleanup();

// Get presale claim info endpoint
router.get('/:tokenAddress/claims/:wallet', presaleClaimLimiter, async (req: Request, res: Response) => {
  try {
    const { tokenAddress, wallet } = req.params;

    if (!tokenAddress || !wallet) {
      return res.status(400).json({
        success: false,
        error: 'Token address and wallet are required'
      });
    }

    // Validate Solana addresses
    if (!isValidSolanaAddress(tokenAddress)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid token address format'
      });
    }

    if (!isValidSolanaAddress(wallet)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address format'
      });
    }

    const vestingInfo: VestingInfo = await calculateVestingInfo(tokenAddress, wallet);

    res.json({ success: true, ...vestingInfo });
  } catch (error) {
    console.error('Error fetching presale claim info:', error);

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('No allocation')) {
        return res.status(404).json({
          success: false,
          error: 'No allocation found for this wallet'
        });
      }
      if (error.message.includes('not launched')) {
        return res.status(400).json({
          success: false,
          error: 'Presale not launched yet'
        });
      }
    }

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch claim info'
    });
  }
});

// Create unsigned presale claim transaction
router.post('/:tokenAddress/claims/prepare', presaleClaimLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { tokenAddress } = req.params;
    const { userWallet } = req.body;

    if (!userWallet) {
      return res.status(400).json({ error: 'User wallet is required' });
    }

    // Validate Solana addresses
    if (!isValidSolanaAddress(tokenAddress)) {
      return res.status(400).json({ error: 'Invalid token address format' });
    }

    if (!isValidSolanaAddress(userWallet)) {
      return res.status(400).json({ error: 'Invalid user wallet address format' });
    }

    // Acquire lock for this token (using presale-specific lock)
    releaseLock = await acquirePresaleClaimLock(tokenAddress);

    // Get presale and vesting info
    const presale = await getPresaleByTokenAddress(tokenAddress);
    if (!presale || presale.status !== 'launched') {
      return res.status(400).json({ error: 'Presale not found or not launched' });
    }

    if (!presale.base_mint_address || !presale.escrow_priv_key) {
      return res.status(400).json({ error: 'Presale configuration incomplete' });
    }

    // Calculate claimable amount and validate
    const vestingInfo: VestingInfo = await calculateVestingInfo(tokenAddress, userWallet);

    // Validate user has a contribution/allocation
    if (!vestingInfo.totalAllocated || vestingInfo.totalAllocated === '0') {
      return res.status(400).json({ error: 'No token allocation found for this wallet' });
    }

    // Validate user's actual contribution exists in the database
    const userContribution = await getUserPresaleContribution(tokenAddress, userWallet);
    if (!userContribution || userContribution === BigInt(0)) {
      return res.status(400).json({ error: 'No contribution found for this wallet' });
    }

    // ENFORCE NEXT UNLOCK TIME - Prevent claiming before the next unlock period
    if (vestingInfo.nextUnlockTime && new Date() < vestingInfo.nextUnlockTime) {
      const timeUntilNextUnlock = vestingInfo.nextUnlockTime.getTime() - Date.now();
      const minutesRemaining = Math.ceil(timeUntilNextUnlock / 60000);
      return res.status(400).json({
        error: `Cannot claim yet. Next unlock in ${minutesRemaining} minutes at ${vestingInfo.nextUnlockTime.toISOString()}`,
        nextUnlockTime: vestingInfo.nextUnlockTime.toISOString(),
        minutesRemaining
      });
    }

    // The claimableAmount from vestingInfo already accounts for:
    // 1. Vesting schedule (how much has vested so far)
    // 2. Already claimed amounts (subtracts what was previously claimed)
    // So we just need to validate it's positive
    const claimAmount = new BN(vestingInfo.claimableAmount);

    if (claimAmount.isZero() || claimAmount.isNeg()) {
      return res.status(400).json({ error: 'No tokens available to claim at this time' });
    }

    // Decrypt escrow keypair only to get the public key for transaction building
    const escrowKeypair = decryptEscrowKeypair(presale.escrow_priv_key);

    // Setup connection and get token info
    const connection = new Connection(process.env.RPC_URL!, 'confirmed');
    const baseMintPubkey = new PublicKey(presale.base_mint_address);
    const userPubkey = new PublicKey(userWallet);

    // Get mint info for decimals
    const mintInfo = await getMint(connection, baseMintPubkey);

    // Get user's token account address
    const userTokenAccountAddress = await getAssociatedTokenAddress(
      baseMintPubkey,
      userPubkey,
      true // Allow owner off curve
    );

    // Check if account exists
    let userTokenAccountInfo;
    try {
      userTokenAccountInfo = await connection.getAccountInfo(userTokenAccountAddress);
    } catch (err) {
      // Account doesn't exist
      userTokenAccountInfo = null;
    }

    // Get escrow's token account address
    const escrowTokenAccountAddress = await getAssociatedTokenAddress(
      baseMintPubkey,
      escrowKeypair.publicKey,
      true // Allow owner off curve
    );

    // Check if escrow account exists
    let escrowTokenAccountInfo;
    try {
      escrowTokenAccountInfo = await connection.getAccountInfo(escrowTokenAccountAddress);
    } catch (err) {
      escrowTokenAccountInfo = null;
    }

    // Create transaction
    const transaction = new Transaction();

    // Add instruction to create user's token account if it doesn't exist (user pays)
    if (!userTokenAccountInfo) {
      const createUserATAInstruction = createAssociatedTokenAccountInstruction(
        userPubkey, // payer (user pays)
        userTokenAccountAddress,
        userPubkey, // owner
        baseMintPubkey
      );
      transaction.add(createUserATAInstruction);
    }

    // Add instruction to create escrow's token account if it doesn't exist (user pays)
    if (!escrowTokenAccountInfo) {
      const createEscrowATAInstruction = createAssociatedTokenAccountInstruction(
        userPubkey, // payer (user pays for escrow account too)
        escrowTokenAccountAddress,
        escrowKeypair.publicKey, // owner
        baseMintPubkey
      );
      transaction.add(createEscrowATAInstruction);
    }

    // Create transfer instruction from escrow to user
    const transferInstruction = createTransferInstruction(
      escrowTokenAccountAddress,
      userTokenAccountAddress,
      escrowKeypair.publicKey,
      BigInt(claimAmount.toString())
    );
    transaction.add(transferInstruction);
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPubkey; // User pays for transaction fees

    // Store transaction data with encrypted escrow key
    const timestamp = Date.now();
    const claimKey = `${tokenAddress}:${timestamp}`;
    presaleClaimTransactions.set(claimKey, {
      tokenAddress,
      userWallet,
      claimAmount: claimAmount.toString(),
      userTokenAccount: userTokenAccountAddress.toBase58(),
      escrowTokenAccount: escrowTokenAccountAddress.toBase58(), // Store the actual escrow token account
      mintDecimals: mintInfo.decimals,
      timestamp,
      escrowPublicKey: escrowKeypair.publicKey.toBase58(),
      encryptedEscrowKey: presale.escrow_priv_key // Store encrypted key from DB
    });

    // Serialize transaction
    const serializedTx = bs58.encode(transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    }));

    res.json({
      success: true,
      transaction: serializedTx,
      timestamp,
      claimAmount: claimAmount.toString(),
      decimals: mintInfo.decimals
    });

  } catch (error) {
    console.error('Error preparing presale claim:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to prepare claim'
    });
  } finally {
    if (releaseLock) releaseLock();
  }
});

// Confirm presale claim transaction
router.post('/:tokenAddress/claims/confirm', presaleClaimLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { tokenAddress } = req.params;
    const { signedTransaction, timestamp } = req.body;

    if (!signedTransaction || !timestamp) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Validate token address
    if (!isValidSolanaAddress(tokenAddress)) {
      return res.status(400).json({ error: 'Invalid token address format' });
    }

    // Validate timestamp
    if (typeof timestamp !== 'number' || timestamp < 0 || timestamp > Date.now() + 60000) {
      return res.status(400).json({ error: 'Invalid timestamp' });
    }

    // Acquire lock (using presale-specific lock)
    releaseLock = await acquirePresaleClaimLock(tokenAddress);

    // Get stored transaction
    const claimKey = `${tokenAddress}:${timestamp}`;
    const storedClaim = presaleClaimTransactions.get(claimKey);

    if (!storedClaim) {
      console.error('[PRESALE CLAIM] Stored claim not found for key:', claimKey);
      return res.status(400).json({ error: 'Claim transaction not found or expired' });
    }

    // Verify timestamp (5 minute expiry)
    if (Date.now() - storedClaim.timestamp > 5 * 60 * 1000) {
      presaleClaimTransactions.delete(claimKey);
      return res.status(400).json({ error: 'Claim transaction expired' });
    }

    // RE-VALIDATE VESTING SCHEDULE - Critical security check
    // Even if a transaction was prepared, we must ensure it's still valid at confirm time
    const vestingInfo: VestingInfo = await calculateVestingInfo(tokenAddress, storedClaim.userWallet);

    // Enforce next unlock time
    if (vestingInfo.nextUnlockTime && new Date() < vestingInfo.nextUnlockTime) {
      const timeUntilNextUnlock = vestingInfo.nextUnlockTime.getTime() - Date.now();
      const minutesRemaining = Math.ceil(timeUntilNextUnlock / 60000);

      // Clean up the stored transaction since it's no longer valid
      presaleClaimTransactions.delete(claimKey);

      return res.status(400).json({
        error: `Cannot claim yet. Next unlock in ${minutesRemaining} minutes at ${vestingInfo.nextUnlockTime.toISOString()}`,
        nextUnlockTime: vestingInfo.nextUnlockTime.toISOString(),
        minutesRemaining
      });
    }

    // Verify the claim amount is still valid
    const currentClaimableAmount = new BN(vestingInfo.claimableAmount);
    const storedClaimAmount = new BN(storedClaim.claimAmount);

    if (currentClaimableAmount.lt(storedClaimAmount)) {
      // The claimable amount has decreased (shouldn't happen, but check for safety)
      presaleClaimTransactions.delete(claimKey);
      return res.status(400).json({
        error: 'Claim amount is no longer valid. Please prepare a new transaction.',
        currentClaimable: currentClaimableAmount.toString(),
        requestedAmount: storedClaimAmount.toString()
      });
    }

    // Deserialize the user-signed transaction
    const connection = new Connection(process.env.RPC_URL!, 'confirmed');
    const txBuffer = bs58.decode(signedTransaction);
    const transaction = Transaction.from(txBuffer);

    // SECURITY: Validate transaction has recent blockhash to prevent replay attacks
    if (!transaction.recentBlockhash) {
      return res.status(400).json({ error: 'Invalid transaction: missing blockhash' });
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

    // CRITICAL SECURITY: Verify the transaction is signed by the claiming wallet
    const userPubkey = new PublicKey(storedClaim.userWallet);
    let validUserSigner = false;

    // Compile the transaction message for signature verification
    const message = transaction.compileMessage();
    const messageBytes = message.serialize();

    // Find the user wallet's signer index
    const userSignerIndex = message.accountKeys.findIndex(key =>
      key.equals(userPubkey)
    );

    if (userSignerIndex >= 0 && userSignerIndex < transaction.signatures.length) {
      const signature = transaction.signatures[userSignerIndex];
      if (signature.signature) {
        // CRITICAL: Verify the signature is cryptographically valid using nacl
        const isValid = nacl.sign.detached.verify(
          messageBytes,
          signature.signature,
          userPubkey.toBytes()
        );
        validUserSigner = isValid;
      }
    }

    if (!validUserSigner) {
      return res.status(400).json({
        error: 'Invalid transaction: must be cryptographically signed by the claiming wallet'
      });
    }

    // CRITICAL SECURITY: Validate transaction structure
    // Check that it only contains expected instructions (transfer from escrow to user)
    let transferInstructionCount = 0;
    let validTransfer = false;
    const escrowPubkey = new PublicKey(storedClaim.escrowPublicKey);
    const userTokenAccount = new PublicKey(storedClaim.userTokenAccount);
    const mintPubkey = new PublicKey(tokenAddress);

    // Get the Compute Budget Program ID
    const COMPUTE_BUDGET_PROGRAM_ID = ComputeBudgetProgram.programId;
    const LIGHTHOUSE_PROGRAM_ID = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");

    for (const instruction of transaction.instructions) {
      // Check if it's a Compute Budget instruction (optional, for setting compute units)
      if (instruction.programId.equals(COMPUTE_BUDGET_PROGRAM_ID)) {
        // This is fine, it's a compute budget instruction for optimizing transaction fees
        continue;
      }

      // Check if it's an ATA creation instruction (optional, only if account doesn't exist)
      if (instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        // This is fine, it's creating the user's token account
        continue;
      }

      // Check if it's a Lighthouse instruction
      if (instruction.programId.equals(LIGHTHOUSE_PROGRAM_ID)) {
        // This is fine, it's a Lighthouse instruction for optimizing transaction fees
        continue;
      }

      // Check if it's a transfer instruction
      if (instruction.programId.equals(TOKEN_PROGRAM_ID)) {
        // Transfer instruction has opcode 3 or 12 (Transfer or TransferChecked)
        const opcode = instruction.data[0];

        if (opcode === 3 || opcode === 12) {
          transferInstructionCount++;

          // Validate the transfer is from escrow to user
          // For Transfer (opcode 3): accounts are [source, destination, authority]
          // For TransferChecked (opcode 12): accounts are [source, mint, destination, authority]
          const sourceIndex = 0;
          const destIndex = opcode === 3 ? 1 : 2;
          const authorityIndex = opcode === 3 ? 2 : 3;

          if (instruction.keys.length > authorityIndex) {
            const source = instruction.keys[sourceIndex].pubkey;
            const destination = instruction.keys[destIndex].pubkey;
            const authority = instruction.keys[authorityIndex].pubkey;

            // For presale claims, we need to validate:
            // 1. The authority MUST be the escrow
            // 2. The destination MUST be the user's token account
            // 3. The source MUST be owned by the escrow (but might not be the ATA)

            const authorityMatchesEscrow = authority.equals(escrowPubkey);
            const destMatchesUser = destination.equals(userTokenAccount);

            // Since the source might not be an ATA, we should verify it's owned by the escrow
            // by checking the transaction itself or trusting that the escrow signature validates ownership
            // For now, we'll accept any source as long as the escrow is signing

            // Validate: authority is escrow and destination is user's account
            // We trust the source because only the escrow can sign for its accounts
            if (destMatchesUser && authorityMatchesEscrow) {

              // Validate transfer amount
              const amountBytes = opcode === 3
                ? instruction.data.slice(1, 9)  // Transfer: 8 bytes starting at index 1
                : instruction.data.slice(1, 9); // TransferChecked: 8 bytes starting at index 1

              const amount = new BN(amountBytes, 'le');
              const expectedAmount = new BN(storedClaim.claimAmount);

              if (amount.eq(expectedAmount)) {
                validTransfer = true;
              }
            }
          }
        } else {
          // Unexpected SPL Token instruction
          return res.status(400).json({
            error: 'Invalid transaction: unexpected token program instruction'
          });
        }
      } else if (!instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) &&
                 !instruction.programId.equals(COMPUTE_BUDGET_PROGRAM_ID) &&
                 !instruction.programId.equals(LIGHTHOUSE_PROGRAM_ID)) {
        console.log("instruction", instruction);
        // Unknown program - reject
        return res.status(400).json({
          error: 'Invalid transaction: contains unexpected instructions'
        });
      }
    }

    if (transferInstructionCount === 0) {
      return res.status(400).json({ error: 'Invalid transaction: no transfer instruction found' });
    }

    if (transferInstructionCount > 1) {
      return res.status(400).json({ error: 'Invalid transaction: only one transfer allowed' });
    }

    if (!validTransfer) {
      return res.status(400).json({
        error: 'Invalid transaction: transfer details do not match claim'
      });
    }

    // Now decrypt and add the escrow signature after all validations pass
    const escrowKeypair = decryptEscrowKeypair(storedClaim.encryptedEscrowKey);
    transaction.partialSign(escrowKeypair);

    // Send the fully signed transaction
    const fullySignedTxBuffer = transaction.serialize();
    const signature = await connection.sendRawTransaction(fullySignedTxBuffer, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3
    });

    // Wait for confirmation using polling
    let confirmed = false;
    let retries = 0;
    const maxRetries = 60; // 60 seconds max

    while (!confirmed && retries < maxRetries) {
      try {
        const status = await connection.getSignatureStatus(signature);

        if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
          confirmed = true;
          break;
        }

        if (status?.value?.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        retries++;
      } catch (statusError) {
        console.error('Status check error:', statusError);
        retries++;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!confirmed) {
      throw new Error('Transaction confirmation timeout after 60 seconds');
    }

    // Get transaction details for verification
    const txDetails = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });

    // Record the claim in database
    await recordPresaleClaim(
      tokenAddress,
      storedClaim.userWallet,
      storedClaim.claimAmount,
      signature,
      txDetails?.blockTime || undefined,
      txDetails?.slot ? BigInt(txDetails.slot) : undefined
    );

    // Clean up stored transaction
    presaleClaimTransactions.delete(claimKey);

    const responseData = {
      success: true,
      signature,
      claimedAmount: storedClaim.claimAmount,
      decimals: storedClaim.mintDecimals
    };

    res.json(responseData);

  } catch (error) {
    console.error('[PRESALE CLAIM] Error confirming claim:', error);

    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to confirm claim'
    });
  } finally {
    if (releaseLock) releaseLock();
  }
});

// Get presale stats endpoint
router.get('/:tokenAddress/stats', async (req: Request, res: Response) => {
  try {
    const { tokenAddress } = req.params;

    // Validate token address
    if (!isValidSolanaAddress(tokenAddress)) {
      return res.status(400).json({
        error: 'Invalid token address format'
      });
    }

    const stats = await getPresaleStats(tokenAddress);

    res.json({ success: true, ...stats });
  } catch (error) {
    console.error('Error fetching presale stats:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch stats'
    });
  }
});

// ===== PRESALE BID ENDPOINTS =====

// In-memory lock to prevent concurrent processing of the same transaction
const transactionLocks = new Map<string, Promise<void>>();

async function acquireTransactionLock(signature: string): Promise<() => void> {
  const key = signature.toLowerCase();

  // Wait for any existing lock to be released
  while (transactionLocks.has(key)) {
    await transactionLocks.get(key);
  }

  // Create a new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  transactionLocks.set(key, lockPromise);

  // Return the release function
  return () => {
    transactionLocks.delete(key);
    releaseLock();
  };
}

const ZC_TOKEN_MINT = 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC';
const ZC_DECIMALS = 6;
const ZC_PER_TOKEN = Math.pow(10, ZC_DECIMALS);

// Get presale bids endpoint
router.get('/:tokenAddress/bids', async (req: Request, res: Response) => {
  try {
    const { tokenAddress } = req.params;

    if (!tokenAddress) {
      return res.status(400).json({
        error: 'Token address is required'
      });
    }

    // Validate token address
    if (!isValidSolanaAddress(tokenAddress)) {
      return res.status(400).json({
        error: 'Invalid token address format'
      });
    }

    // Fetch all bids and totals
    const [bids, totals] = await Promise.all([
      getPresaleBids(tokenAddress),
      getTotalPresaleBids(tokenAddress)
    ]);

    // Convert smallest units to $ZC for frontend display (6 decimals)
    const contributions = bids.map(bid => ({
      wallet: bid.wallet_address,
      amount: Number(bid.amount_lamports) / ZC_PER_TOKEN, // Now in $ZC
      transactionSignature: bid.transaction_signature,
      createdAt: bid.created_at
    }));

    const totalRaisedZC = Number(totals.totalAmount) / ZC_PER_TOKEN; // Now in $ZC

    res.json({
      totalRaised: totalRaisedZC,
      totalBids: totals.totalBids,
      contributions
    });

  } catch (error) {
    console.error('Error fetching presale bids:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch presale bids'
    });
  }
});

// Record presale bid endpoint
router.post('/:tokenAddress/bids', async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { tokenAddress } = req.params;
    const { transactionSignature, walletAddress, amountTokens, tokenMint } = req.body;

    // Validate required fields
    if (!tokenAddress || !transactionSignature || !walletAddress || !amountTokens) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    // Validate token mint is $ZC
    if (!tokenMint || tokenMint !== ZC_TOKEN_MINT) {
      return res.status(400).json({
        error: 'Invalid token mint. Only $ZC tokens are accepted'
      });
    }

    // Validate Solana addresses
    if (!isValidSolanaAddress(tokenAddress)) {
      return res.status(400).json({
        error: 'Invalid token address format'
      });
    }

    if (!isValidSolanaAddress(walletAddress)) {
      return res.status(400).json({
        error: 'Invalid wallet address format'
      });
    }

    // Validate transaction signature
    if (!isValidTransactionSignature(transactionSignature)) {
      return res.status(400).json({
        error: 'Invalid transaction signature format'
      });
    }

    // Validate amount (now in token units with 6 decimals)
    if (!amountTokens || typeof amountTokens !== 'number' || amountTokens <= 0) {
      return res.status(400).json({
        error: 'Invalid amount: must be a positive number of tokens'
      });
    }

    // Acquire lock for this transaction to prevent concurrent processing
    releaseLock = await acquireTransactionLock(transactionSignature);

    // Fetch presale from database
    const presale = await getPresaleByTokenAddress(tokenAddress);

    if (!presale) {
      return res.status(404).json({
        error: 'Presale not found'
      });
    }

    // Verify escrow address exists
    if (!presale.escrow_pub_key) {
      return res.status(400).json({
        error: 'Presale escrow not configured'
      });
    }

    // CRITICAL: Check if transaction already exists BEFORE expensive verification
    let existingBid = await getPresaleBidBySignature(transactionSignature);
    if (existingBid) {
      console.log(`Transaction ${transactionSignature} already recorded`);
      return res.status(400).json({
        error: 'Transaction already recorded'
      });
    }

    // Now verify the $ZC token transaction on-chain
    console.log(`Verifying $ZC token transaction ${transactionSignature} for presale ${tokenAddress}`);

    const verification = await verifyPresaleTokenTransaction(
      transactionSignature,
      walletAddress, // sender owner
      presale.escrow_pub_key, // recipient owner
      ZC_TOKEN_MINT, // token mint
      BigInt(amountTokens), // amount in smallest units (6 decimals)
      300 // 5 minutes max age
    );

    if (!verification.valid) {
      console.error(`Token transaction verification failed: ${verification.error}`);
      return res.status(400).json({
        error: `Transaction verification failed: ${verification.error}`
      });
    }

    console.log(`Transaction ${transactionSignature} verified successfully`);

    // Double-check one more time after verification (belt and suspenders)
    existingBid = await getPresaleBidBySignature(transactionSignature);
    if (existingBid) {
      console.log(`Transaction ${transactionSignature} was recorded by another request during verification`);
      return res.status(400).json({
        error: 'Transaction already recorded'
      });
    }

    // Record the verified bid in the database
    // Note: We're keeping the database field as amount_lamports for backward compatibility
    // but now it represents smallest units of $ZC (6 decimals)
    try {
      const bid = await recordPresaleBid({
        presale_id: presale.id!,
        token_address: tokenAddress,
        wallet_address: walletAddress,
        amount_lamports: BigInt(amountTokens), // Now represents $ZC smallest units
        transaction_signature: transactionSignature,
        block_time: verification.details?.blockTime,
        slot: verification.details?.slot ? BigInt(verification.details.slot) : undefined,
        verified_at: new Date()
      });

      res.json({
        success: true,
        bid: {
          transactionSignature: bid.transaction_signature,
          amountZC: Number(bid.amount_lamports) / ZC_PER_TOKEN, // Convert to $ZC
        },
        verification: {
          blockTime: verification.details?.blockTime,
          slot: verification.details?.slot,
          verified: true
        }
      });

    } catch (error) {
      // Check if it's a duplicate transaction error
      if (error instanceof Error && error.message.includes('already recorded')) {
        return res.status(400).json({
          error: 'Transaction already recorded'
        });
      }

      console.error('Error recording bid:', error);
      return res.status(500).json({
        error: 'Failed to record bid'
      });
    }

  } catch (error) {
    console.error('Error saving presale bid:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to save bid'
    });
  } finally {
    // Always release the lock
    if (releaseLock) {
      releaseLock();
    }
  }
});

// Create presale launch transaction
router.post('/:tokenAddress/launch', async (req: Request, res: Response) => {
  try {
    const { tokenAddress } = req.params;
    const { payerPublicKey } = req.body;

    if (!tokenAddress) {
      return res.status(400).json({ error: 'Token address is required' });
    }

    if (!payerPublicKey) {
      return res.status(400).json({ error: 'Payer public key is required' });
    }

    const RPC_URL = process.env.RPC_URL;
    const CONFIG_ADDRESS = process.env.FLYWHEEL_CONFIG_ADDRESS;
    const ZC_TOKEN_MINT = new PublicKey("GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC");
    const ZC_DECIMALS = 6;
    const ZC_PER_TOKEN = Math.pow(10, ZC_DECIMALS);

    if (!RPC_URL || !CONFIG_ADDRESS) {
      throw new Error('RPC_URL and CONFIG_ADDRESS must be configured');
    }

    // Fetch presale from database
    const presale = await getPresaleByTokenAddress(tokenAddress);

    if (!presale) {
      throw new Error('Presale not found');
    }

    // Verify caller is the creator
    if (presale.creator_wallet !== payerPublicKey) {
      throw new Error('Only the presale creator can launch');
    }

    // Check if already launched
    if (presale.status !== 'pending') {
      throw new Error('Presale has already been launched or is not pending');
    }

    // Verify escrow keys exist
    if (!presale.escrow_pub_key || !presale.escrow_priv_key) {
      throw new Error('Escrow keypair not found for this presale');
    }

    // Decrypt escrow keypair
    const escrowKeypair = decryptEscrowKeypair(presale.escrow_priv_key);

    // Verify escrow public key matches
    if (escrowKeypair.publicKey.toBase58() !== presale.escrow_pub_key) {
      throw new Error('Escrow keypair verification failed');
    }

    // Verify base mint key exists
    if (!presale.base_mint_priv_key) {
      throw new Error('Base mint keypair not found');
    }

    // Decrypt base mint keypair (stored as encrypted base58 string, not JSON array)
    const decryptedBase58 = decrypt(presale.base_mint_priv_key);
    const baseMintKeypair = Keypair.fromSecretKey(bs58.decode(decryptedBase58));

    // Verify base mint keypair by checking if we can recreate the same base58 string
    if (bs58.encode(baseMintKeypair.secretKey) !== decryptedBase58) {
      throw new Error('Base mint keypair verification failed');
    }

    // Get escrow's $ZC token balance
    const connection = new Connection(RPC_URL, "confirmed");

    // Get escrow's $ZC token account
    const escrowTokenAccount = await getAssociatedTokenAddress(
      ZC_TOKEN_MINT,
      escrowKeypair.publicKey,
      true
    );

    let escrowZCBalance = 0;
    try {
      const escrowTokenAccountInfo = await getAccount(connection, escrowTokenAccount);
      escrowZCBalance = Number(escrowTokenAccountInfo.amount);
    } catch (err) {
      throw new Error('Escrow $ZC token account not found or has no balance');
    }

    if (escrowZCBalance === 0) {
      throw new Error('Escrow wallet has no $ZC tokens');
    }

    // Use full escrow balance for the buy (no buffer needed for $ZC)
    const buyAmountTokens = escrowZCBalance;

    // Initialize Meteora client
    const client = new DynamicBondingCurveClient(connection, "confirmed");

    const baseMint = baseMintKeypair.publicKey;
    const payer = new PublicKey(payerPublicKey);
    const config = new PublicKey(CONFIG_ADDRESS);

    // Create pool with first buy using Meteora SDK - using $ZC as quote
    const { createPoolTx, swapBuyTx } = await client.pool.createPoolWithFirstBuy({
      createPoolParam: {
        baseMint,
        config, // This config must be configured for $ZC as quote token
        name: presale.token_name || '',
        symbol: presale.token_symbol || '',
        uri: presale.token_metadata_url,
        payer,
        poolCreator: payer
      },
      firstBuyParam: {
        buyer: escrowKeypair.publicKey,
        receiver: escrowKeypair.publicKey,
        buyAmount: new BN(buyAmountTokens), // Amount in $ZC smallest units (6 decimals)
        minimumAmountOut: new BN(0), // Accept any amount (no slippage protection for first buy)
        referralTokenAccount: null
      }
    });

    // Combine transactions into a single atomic transaction
    const combinedTx = new Transaction();

    // First, transfer SOL to escrow for token account creation and transaction fees
    // 0.005 SOL should cover rent exemption (~0.002 SOL) plus transaction fees
    const transferAmount = 5000000; // 0.005 SOL in lamports
    const transferSolInstruction = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: escrowKeypair.publicKey,
      lamports: transferAmount,
    });

    // Add SOL transfer first
    combinedTx.add(transferSolInstruction);

    // Add all instructions from createPoolTx (this creates the mint first)
    combinedTx.add(...createPoolTx.instructions);

    // Add swap instructions if they exist
    if (swapBuyTx && swapBuyTx.instructions.length > 0) {
      combinedTx.add(...swapBuyTx.instructions);
    }

    // Set recent blockhash and fee payer
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    combinedTx.recentBlockhash = blockhash;
    combinedTx.feePayer = payer;

    // Serialize the combined transaction
    const combinedTxSerialized = bs58.encode(
      combinedTx.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      })
    );

    // Generate a unique transaction ID
    const transactionId = crypto.randomBytes(16).toString('hex');

    // Store transaction details for later verification
    presaleLaunchTransactions.set(transactionId, {
      combinedTx: combinedTxSerialized,
      tokenAddress,
      payerPublicKey,
      escrowPublicKey: escrowKeypair.publicKey.toBase58(),
      baseMintKeypair: bs58.encode(baseMintKeypair.secretKey), // Store the keypair for signing later
      timestamp: Date.now()
    });

    res.json({
      combinedTx: combinedTxSerialized,
      transactionId
    });

  } catch (error) {
    console.error('Presale launch error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create presale launch transaction'
    });
  }
});

// Confirm presale launch transaction
router.post('/:tokenAddress/launch-confirm', async (req: Request, res: Response) => {
  try {
    const { tokenAddress } = req.params;
    const { signedTransaction, transactionId } = req.body;

    if (!tokenAddress) {
      return res.status(400).json({ error: 'Token address is required' });
    }

    if (!signedTransaction) {
      return res.status(400).json({ error: 'Signed transaction is required' });
    }

    if (!transactionId) {
      return res.status(400).json({ error: 'Transaction ID is required' });
    }

    const RPC_URL = process.env.RPC_URL;

    if (!RPC_URL) {
      throw new Error('RPC_URL must be configured');
    }

    // Retrieve stored transaction
    const storedTx = presaleLaunchTransactions.get(transactionId);

    if (!storedTx) {
      throw new Error('Transaction not found or expired. Please restart the launch process.');
    }

    // Verify this is for the correct token
    if (storedTx.tokenAddress !== tokenAddress) {
      throw new Error('Transaction token mismatch');
    }

    // Clean up stored transaction (one-time use)
    presaleLaunchTransactions.delete(transactionId);

    // Fetch presale from database to get escrow keypair
    const presale = await getPresaleByTokenAddress(tokenAddress);

    if (!presale) {
      throw new Error('Presale not found');
    }

    if (!presale.escrow_priv_key) {
      throw new Error('Escrow keypair not found');
    }

    // Decrypt escrow keypair
    const escrowKeypair = decryptEscrowKeypair(presale.escrow_priv_key);

    // Verify escrow public key matches
    if (escrowKeypair.publicKey.toBase58() !== storedTx.escrowPublicKey) {
      throw new Error('Escrow keypair mismatch');
    }

    // Reconstruct baseMint keypair from stored data (declare it in outer scope)
    if (!storedTx.baseMintKeypair) {
      throw new Error('BaseMint keypair not found in transaction data');
    }
    const baseMintKeypair = Keypair.fromSecretKey(bs58.decode(storedTx.baseMintKeypair));

    // Initialize connection for validation
    const connection = new Connection(RPC_URL, "confirmed");

    // Deserialize the signed transaction
    const transaction = Transaction.from(bs58.decode(signedTransaction));

    // SECURITY: Validate transaction has recent blockhash to prevent replay attacks
    if (!transaction.recentBlockhash) {
      return res.status(400).json({ error: 'Invalid transaction: missing blockhash' });
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

    // CRITICAL SECURITY: Verify the transaction is cryptographically signed by the payer
    const payerPubkey = new PublicKey(storedTx.payerPublicKey);
    let validPayerSigner = false;

    // Compile the transaction message for signature verification
    const message = transaction.compileMessage();
    const messageBytes = message.serialize();

    // Find the payer's signer index
    const payerSignerIndex = message.accountKeys.findIndex(key =>
      key.equals(payerPubkey)
    );

    if (payerSignerIndex >= 0 && payerSignerIndex < transaction.signatures.length) {
      const signature = transaction.signatures[payerSignerIndex];
      if (signature.signature) {
        // CRITICAL: Verify the signature is cryptographically valid using nacl
        const isValid = nacl.sign.detached.verify(
          messageBytes,
          signature.signature,
          payerPubkey.toBytes()
        );
        validPayerSigner = isValid;
      }
    }

    if (!validPayerSigner) {
      return res.status(400).json({
        error: 'Invalid transaction: must be cryptographically signed by the payer'
      });
    }

    // CRITICAL SECURITY: Validate transaction structure matches the original
    // Deserialize the stored original transaction
    const originalTransaction = Transaction.from(bs58.decode(storedTx.combinedTx));

    // Validate instruction count matches
    if (transaction.instructions.length !== originalTransaction.instructions.length) {
      return res.status(400).json({
        error: `Invalid transaction: instruction count mismatch. Expected ${originalTransaction.instructions.length}, got ${transaction.instructions.length}`
      });
    }

    // Validate each instruction matches the original
    for (let i = 0; i < transaction.instructions.length; i++) {
      const userInstruction = transaction.instructions[i];
      const originalInstruction = originalTransaction.instructions[i];

      // Validate program ID matches
      if (!userInstruction.programId.equals(originalInstruction.programId)) {
        return res.status(400).json({
          error: `Invalid transaction: instruction ${i} program mismatch`
        });
      }

      // Validate instruction data matches
      if (!userInstruction.data.equals(originalInstruction.data)) {
        return res.status(400).json({
          error: `Invalid transaction: instruction ${i} data mismatch`
        });
      }

      // Validate account keys count matches
      if (userInstruction.keys.length !== originalInstruction.keys.length) {
        return res.status(400).json({
          error: `Invalid transaction: instruction ${i} account count mismatch`
        });
      }

      // Validate each account key matches
      for (let j = 0; j < userInstruction.keys.length; j++) {
        const userKey = userInstruction.keys[j];
        const originalKey = originalInstruction.keys[j];

        if (!userKey.pubkey.equals(originalKey.pubkey)) {
          return res.status(400).json({
            error: `Invalid transaction: instruction ${i} account ${j} pubkey mismatch`
          });
        }

        if (userKey.isSigner !== originalKey.isSigner || userKey.isWritable !== originalKey.isWritable) {
          return res.status(400).json({
            error: `Invalid transaction: instruction ${i} account ${j} metadata mismatch`
          });
        }
      }
    }

    console.log('✓ Transaction validation passed: structure matches original');

    // Add escrow and baseMint signatures
    transaction.partialSign(escrowKeypair);
    transaction.partialSign(baseMintKeypair);

    // Send the fully signed transaction
    const signature = await connection.sendRawTransaction(
      transaction.serialize(),
      {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      }
    );

    // Wait for confirmation
    await connection.confirmTransaction(signature, 'confirmed');

    // Calculate tokens bought by escrow after the swap
    let tokensBought = '0';
    try {
      // Use the baseMint from the generated keypair
      const baseMintPubKey = baseMintKeypair.publicKey;

      // Get escrow's token account address for the launched token
      const escrowTokenAccount = await getAssociatedTokenAddress(
        baseMintPubKey,
        escrowKeypair.publicKey
      );

      // Get the token account to read balance
      const tokenAccount = await getAccount(connection, escrowTokenAccount);
      tokensBought = tokenAccount.amount.toString();

      // Initialize presale claims with vesting (using the generated baseMint address)
      await initializePresaleClaims(tokenAddress, baseMintPubKey.toBase58(), tokensBought);

      console.log(`Presale ${tokenAddress}: ${tokensBought} tokens bought, claims initialized`);
    } catch (error) {
      console.error('Error initializing presale claims:', error);
      // Don't fail the launch if we can't initialize claims
    }

    // Update presale status with base mint address and tokens bought
    await updatePresaleStatus(tokenAddress, 'launched', baseMintKeypair.publicKey.toBase58(), tokensBought);

    res.json({
      success: true,
      signature,
      message: 'Presale launched successfully!'
    });

  } catch (error) {
    console.error('Presale launch confirmation error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to confirm presale launch'
    });
  }
});

export default router;
