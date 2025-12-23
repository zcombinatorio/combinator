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
import { Connection, Keypair, Transaction, PublicKey } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getMint,
  getAssociatedTokenAddress
} from '@solana/spl-token';
import bs58 from 'bs58';
import type {
  MintClaimRequestBody,
  ConfirmClaimRequestBody,
  MintClaimResponseBody,
  ConfirmClaimResponseBody,
  ClaimInfoResponseBody,
  ErrorResponseBody
} from '../types/server';
import {
  getTokenLaunchTime,
  hasRecentClaim,
  preRecordClaim,
  getTokenCreatorWallet,
  getDesignatedClaimByToken,
  getVerifiedClaimWallets
} from '../lib/db';
import { calculateClaimEligibility } from '../lib/helius';
import {
  claimTransactions,
  acquireClaimLock
} from '../lib/claimService';

/**
 * Claim Routes
 *
 * Express router for token emission claim endpoints
 */

const router = Router();

// ============================================================================
// GET /claims/:tokenAddress - Get claim eligibility info
// ============================================================================

router.get('/:tokenAddress', async (
  req: Request,
  res: Response<ClaimInfoResponseBody | ErrorResponseBody>
) => {
  try {
    const { tokenAddress } = req.params;
    const walletAddress = req.query.wallet as string;

    if (!walletAddress) {
      return res.status(400).json({
        error: 'Wallet address is required'
      });
    }

    // Get token launch time from database
    const tokenLaunchTime = await getTokenLaunchTime(tokenAddress);

    if (!tokenLaunchTime) {
      return res.status(404).json({
        error: 'Token not found'
      });
    }

    // Get claim data from on-chain with DB launch time
    const claimData = await calculateClaimEligibility(tokenAddress, tokenLaunchTime);

    const timeUntilNextClaim = Math.max(0, claimData.nextInflationTime.getTime() - new Date().getTime());

    res.json({
      walletAddress,
      tokenAddress,
      totalClaimed: claimData.totalClaimed.toString(),
      availableToClaim: claimData.availableToClaim.toString(),
      maxClaimableNow: claimData.maxClaimableNow.toString(),
      tokensPerPeriod: '1000000',
      inflationPeriods: claimData.inflationPeriods,
      tokenLaunchTime,
      nextInflationTime: claimData.nextInflationTime,
      canClaimNow: claimData.canClaimNow,
      timeUntilNextClaim,
    });
  } catch (error) {
    console.error('Error fetching claim info:', error);
    res.status(500).json({
      error: 'Failed to fetch claim information'
    });
  }
});

// ============================================================================
// POST /claims/mint - Create unsigned mint transaction for claiming
// ============================================================================

router.post('/mint', async (
  req: Request<Record<string, never>, MintClaimResponseBody | ErrorResponseBody, MintClaimRequestBody>,
  res: Response<MintClaimResponseBody | ErrorResponseBody>
) => {
  try {
    console.log("claim/mint request body:", req.body);
    const { tokenAddress, userWallet, claimAmount } = req.body;
    console.log("mint request", tokenAddress, userWallet, claimAmount);

    // Validate required environment variables
    const RPC_URL = process.env.RPC_URL;
    const PROTOCOL_PRIVATE_KEY = process.env.PROTOCOL_PRIVATE_KEY;
    const ADMIN_WALLET = process.env.ADMIN_WALLET || 'PLACEHOLDER_ADMIN_WALLET';

    if (!RPC_URL) {
      const errorResponse = { error: 'RPC_URL not configured' };
      console.log("claim/mint error response:", errorResponse);
      return res.status(500).json(errorResponse);
    }

    if (!PROTOCOL_PRIVATE_KEY) {
      const errorResponse = { error: 'PROTOCOL_PRIVATE_KEY not configured' };
      console.log("claim/mint error response:", errorResponse);
      return res.status(500).json(errorResponse);
    }

    if (!ADMIN_WALLET || ADMIN_WALLET === 'PLACEHOLDER_ADMIN_WALLET') {
      const errorResponse = { error: 'ADMIN_WALLET not configured' };
      console.log("claim/mint error response:", errorResponse);
      return res.status(500).json(errorResponse);
    }

    // Validate required parameters
    if (!tokenAddress || !userWallet || !claimAmount) {
      const errorResponse = { error: 'Missing required parameters' };
      console.log("claim/mint error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Initialize connection
    const connection = new Connection(RPC_URL, "confirmed");
    const protocolKeypair = Keypair.fromSecretKey(bs58.decode(PROTOCOL_PRIVATE_KEY));
    const tokenMint = new PublicKey(tokenAddress);
    const userPublicKey = new PublicKey(userWallet);
    const adminPublicKey = new PublicKey(ADMIN_WALLET);

    // Get token launch time from database
    const tokenLaunchTime = await getTokenLaunchTime(tokenAddress);

    if (!tokenLaunchTime) {
      const errorResponse = { error: 'Token not found' };
      console.log("claim/mint error response:", errorResponse);
      return res.status(404).json(errorResponse);
    }

    // Validate claim amount input
    if (!claimAmount || typeof claimAmount !== 'string') {
      const errorResponse = { error: 'Invalid claim amount: must be a string' };
      console.log("claim/mint error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    if (!/^\d+$/.test(claimAmount)) {
      const errorResponse = { error: 'Invalid claim amount: must contain only digits' };
      console.log("claim/mint error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    const requestedAmount = BigInt(claimAmount);

    // Check for valid amount bounds
    if (requestedAmount <= BigInt(0)) {
      const errorResponse = { error: 'Invalid claim amount: must be greater than 0' };
      console.log("claim/mint error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    if (requestedAmount > BigInt(Number.MAX_SAFE_INTEGER)) {
      const errorResponse = { error: 'Invalid claim amount: exceeds maximum safe value' };
      console.log("claim/mint error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Calculate 90/10 split (claimers get 90%, admin gets 10%)
    const claimersTotal = (requestedAmount * BigInt(9)) / BigInt(10);
    const adminAmount = requestedAmount - claimersTotal; // Ensures total equals exactly requestedAmount

    // Validate claim eligibility from on-chain data
    const claimEligibility = await calculateClaimEligibility(tokenAddress, tokenLaunchTime);

    if (requestedAmount > claimEligibility.availableToClaim) {
      const errorResponse = { error: 'Requested amount exceeds available claim amount' };
      console.log("claim/mint error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Check if this is a designated token and validate the claimer
    const designatedClaim = await getDesignatedClaimByToken(tokenAddress);

    if (designatedClaim) {
      // This is a designated token
      const { verifiedWallet, embeddedWallet, originalLauncher } = await getVerifiedClaimWallets(tokenAddress);

      // Block the original launcher
      if (userWallet === originalLauncher) {
        const errorResponse = { error: 'This token has been designated to someone else. The designated user must claim it.' };
        console.log("claim/mint error response: Original launcher blocked from claiming designated token");
        return res.status(403).json(errorResponse);
      }

      // Check if the current user is authorized
      if (verifiedWallet || embeddedWallet) {
        if (userWallet !== verifiedWallet && userWallet !== embeddedWallet) {
          const errorResponse = { error: 'Only the verified designated user can claim this token' };
          console.log("claim/mint error response: Unauthorized wallet attempting to claim designated token");
          return res.status(403).json(errorResponse);
        }
      } else {
        const errorResponse = { error: 'The designated user must verify their social accounts before claiming' };
        console.log("claim/mint error response: Designated user not yet verified");
        return res.status(403).json(errorResponse);
      }
    } else {
      // Normal token - only creator can claim
      const creatorWallet = await getTokenCreatorWallet(tokenAddress);
      if (!creatorWallet) {
        const errorResponse = { error: 'Token creator not found' };
        console.log("claim/mint error response:", errorResponse);
        return res.status(400).json(errorResponse);
      }

      if (userWallet !== creatorWallet.trim()) {
        const errorResponse = { error: 'Only the token creator can claim rewards' };
        console.log("claim/mint error response: Non-creator attempting to claim");
        return res.status(403).json(errorResponse);
      }
    }

    // User can claim now if they have available tokens to claim
    if (claimEligibility.availableToClaim <= BigInt(0)) {
      const errorResponse = {
        error: 'No tokens available to claim yet',
        nextInflationTime: claimEligibility.nextInflationTime
      };
      console.log("claim/mint error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Get mint info to calculate amount with decimals
    const mintInfo = await getMint(connection, tokenMint);
    const decimals = mintInfo.decimals;
    const adminAmountWithDecimals = adminAmount * BigInt(10 ** decimals);

    // Verify protocol has mint authority
    if (!mintInfo.mintAuthority || !mintInfo.mintAuthority.equals(protocolKeypair.publicKey)) {
      const errorResponse = { error: 'Protocol does not have mint authority for this token' };
      console.log("claim/mint error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Hardcoded emission splits - supports N participants
    // Currently configured for 2 participants: Developer (90%) + Admin fee (10%)

    // Get the creator wallet (developer)
    const creatorWallet = await getTokenCreatorWallet(tokenAddress);
    if (!creatorWallet) {
      const errorResponse = { error: 'Token creator not found' };
      console.log("claim/mint error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Validate creator wallet address before using as split recipient
    const trimmedCreatorWallet = creatorWallet.trim();
    try {
      const creatorPubkey = new PublicKey(trimmedCreatorWallet);
      if (!PublicKey.isOnCurve(creatorPubkey.toBuffer())) {
        const errorResponse = { error: 'Invalid creator wallet address: not on curve' };
        console.log("claim/mint error response:", errorResponse);
        return res.status(400).json(errorResponse);
      }
    } catch (error) {
      const errorResponse = { error: 'Invalid creator wallet address format' };
      console.log("claim/mint error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Calculate split amounts and prepare recipients
    interface SplitRecipient {
      wallet: string;
      amount: bigint;
      amountWithDecimals: bigint;
      label?: string;
    }

    // Hardcoded split configuration
    // claimersTotal represents the 90% portion for claimers (excluding 10% admin fee)
    const splitRecipients: SplitRecipient[] = [];

    // All tokens: 100% of claimersTotal goes to the developer/creator
    splitRecipients.push({
      wallet: trimmedCreatorWallet,
      amount: claimersTotal, // 100% of the 90% claimers portion = 90% total
      amountWithDecimals: claimersTotal * BigInt(10 ** decimals),
      label: 'Developer'
    });

    console.log(`Emission split: 100% of claimers portion (90% total) to creator ${trimmedCreatorWallet}`);

    // Get admin token account address
    const adminTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      adminPublicKey,
      true // allowOwnerOffCurve
    );

    // Create mint transaction
    const transaction = new Transaction();

    // Add idempotent instruction to create admin account (user pays)
    const createAdminAccountInstruction = createAssociatedTokenAccountIdempotentInstruction(
      userPublicKey, // payer
      adminTokenAccount,
      adminPublicKey, // owner
      tokenMint
    );
    transaction.add(createAdminAccountInstruction);

    // Create token accounts and mint instructions for each split recipient
    for (const recipient of splitRecipients) {
      const recipientPublicKey = new PublicKey(recipient.wallet);
      const recipientTokenAccount = await getAssociatedTokenAddress(
        tokenMint,
        recipientPublicKey
      );

      // Add idempotent instruction to create recipient account (user pays)
      const createRecipientAccountInstruction = createAssociatedTokenAccountIdempotentInstruction(
        userPublicKey, // payer
        recipientTokenAccount,
        recipientPublicKey, // owner
        tokenMint
      );
      transaction.add(createRecipientAccountInstruction);

      // Add mint instruction for this recipient
      const recipientMintInstruction = createMintToInstruction(
        tokenMint,
        recipientTokenAccount,
        protocolKeypair.publicKey,
        recipient.amountWithDecimals
      );
      transaction.add(recipientMintInstruction);
    }

    // Add mint instruction for admin (10%)
    const adminMintInstruction = createMintToInstruction(
      tokenMint,
      adminTokenAccount,
      protocolKeypair.publicKey,
      adminAmountWithDecimals
    );
    transaction.add(adminMintInstruction);

    // Get latest blockhash and set fee payer to user
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPublicKey;

    // Compute SHA-256 hash of the unsigned transaction message for tamper detection
    const unsignedTransactionHash = crypto.createHash('sha256')
      .update(transaction.serializeMessage())
      .digest('hex');

    // Clean up old transactions FIRST (older than 5 minutes) to prevent race conditions
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    for (const [key, data] of claimTransactions.entries()) {
      if (data.timestamp < fiveMinutesAgo) {
        claimTransactions.delete(key);
      }
    }

    // Create a unique key for this transaction with random component to prevent collisions
    const transactionKey = `${tokenAddress}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;

    // Store transaction data for later confirmation (hash-based validation)
    claimTransactions.set(transactionKey, {
      tokenAddress,
      userWallet,
      claimAmount,
      mintDecimals: decimals,
      timestamp: Date.now(),
      unsignedTransactionHash
    });

    // Serialize transaction for user to sign
    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false
    });

    const successResponse = {
      success: true as const,
      transaction: bs58.encode(serializedTransaction),
      transactionKey,
      claimAmount: requestedAmount.toString(),
      message: 'Sign this transaction and submit to /claims/confirm'
    };

    console.log("claim/mint successful response:", successResponse);
    res.json(successResponse);

  } catch (error) {
    console.error('Mint transaction creation error:', error);
    const errorResponse = {
      error: 'Failed to create mint transaction',
      details: error instanceof Error ? error.message : 'Unknown error'
    };
    console.log("claim/mint error response:", errorResponse);
    res.status(500).json(errorResponse);
  }
});

// ============================================================================
// POST /claims/confirm - Confirm claim transaction
// ============================================================================

router.post('/confirm', async (
  req: Request<Record<string, never>, ConfirmClaimResponseBody | ErrorResponseBody, ConfirmClaimRequestBody>,
  res: Response<ConfirmClaimResponseBody | ErrorResponseBody>
) => {
  let releaseLock: (() => void) | null = null;

  try {
    console.log("claim/confirm request body:", req.body);
    const { signedTransaction, transactionKey } = req.body;

    // Validate required parameters
    if (!signedTransaction || !transactionKey) {
      const errorResponse = { error: 'Missing required fields: signedTransaction and transactionKey' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Retrieve the transaction data from memory
    const claimData = claimTransactions.get(transactionKey);
    if (!claimData) {
      const errorResponse = { error: 'Transaction data not found. Please call /claims/mint first.' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Acquire lock IMMEDIATELY after getting claim data to prevent race conditions
    releaseLock = await acquireClaimLock(claimData.tokenAddress);

    // Check if ANY user has claimed this token recently
    const hasRecent = await hasRecentClaim(claimData.tokenAddress, 360);
    if (hasRecent) {
      const errorResponse = { error: 'This token has been claimed recently. Please wait before claiming again.' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Pre-record the claim in database for audit trail
    // Global token lock prevents race conditions
    await preRecordClaim(
      claimData.userWallet,
      claimData.tokenAddress,
      claimData.claimAmount
    );

    // Validate required environment variables
    const RPC_URL = process.env.RPC_URL;
    const PROTOCOL_PRIVATE_KEY = process.env.PROTOCOL_PRIVATE_KEY;
    const ADMIN_WALLET = process.env.ADMIN_WALLET || 'PLACEHOLDER_ADMIN_WALLET';

    if (!RPC_URL || !PROTOCOL_PRIVATE_KEY) {
      const errorResponse = { error: 'Server configuration error' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(500).json(errorResponse);
    }

    if (!ADMIN_WALLET || ADMIN_WALLET === 'PLACEHOLDER_ADMIN_WALLET') {
      const errorResponse = { error: 'ADMIN_WALLET not configured' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(500).json(errorResponse);
    }

    // Initialize connection and keypair
    const connection = new Connection(RPC_URL, "confirmed");
    const protocolKeypair = Keypair.fromSecretKey(bs58.decode(PROTOCOL_PRIVATE_KEY));

    // Re-validate claim eligibility (security check)
    const tokenLaunchTime = await getTokenLaunchTime(claimData.tokenAddress);
    if (!tokenLaunchTime) {
      const errorResponse = { error: 'Token not found' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(404).json(errorResponse);
    }

    const claimEligibility = await calculateClaimEligibility(
      claimData.tokenAddress,
      tokenLaunchTime
    );

    const requestedAmount = BigInt(claimData.claimAmount);
    if (requestedAmount > claimEligibility.availableToClaim) {
      const errorResponse = { error: 'Claim eligibility has changed. Requested amount exceeds available claim amount.' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    if (claimEligibility.availableToClaim <= BigInt(0)) {
      const errorResponse = { error: 'No tokens available to claim anymore' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Check if this token has a designated claim
    const designatedClaim = await getDesignatedClaimByToken(claimData.tokenAddress);

    let authorizedClaimWallet: string | null = null;
    let isDesignated = false;

    if (designatedClaim) {
      // This is a designated token
      isDesignated = true;

      // Check if the designated user has verified their account
      const { verifiedWallet, embeddedWallet, originalLauncher } = await getVerifiedClaimWallets(claimData.tokenAddress);

      // Block the original launcher from claiming designated tokens
      if (claimData.userWallet === originalLauncher) {
        const errorResponse = { error: 'This token has been designated to someone else. The designated user must claim it.' };
        console.log("claim/confirm error response: Original launcher blocked from claiming designated token");
        return res.status(403).json(errorResponse);
      }

      // Check if the current user is authorized to claim
      if (verifiedWallet || embeddedWallet) {
        // Allow either the verified wallet or embedded wallet to claim
        if (claimData.userWallet === verifiedWallet || claimData.userWallet === embeddedWallet) {
          authorizedClaimWallet = claimData.userWallet;
          console.log("Designated user authorized to claim:", { userWallet: claimData.userWallet, verifiedWallet, embeddedWallet });
        } else {
          const errorResponse = { error: 'Only the verified designated user can claim this token' };
          console.log("claim/confirm error response: Unauthorized wallet attempting to claim designated token");
          return res.status(403).json(errorResponse);
        }
      } else {
        // Designated user hasn't verified yet
        const errorResponse = { error: 'The designated user must verify their social accounts before claiming' };
        console.log("claim/confirm error response: Designated user not yet verified");
        return res.status(403).json(errorResponse);
      }
    } else {
      // Normal token - only creator can claim
      const rawCreatorWallet = await getTokenCreatorWallet(claimData.tokenAddress);
      if (!rawCreatorWallet) {
        const errorResponse = { error: 'Token creator not found' };
        console.log("claim/confirm error response:", errorResponse);
        return res.status(400).json(errorResponse);
      }

      const creatorWallet = rawCreatorWallet.trim();
      if (claimData.userWallet !== creatorWallet) {
        const errorResponse = { error: 'Only the token creator can claim rewards' };
        console.log("claim/confirm error response: Non-creator attempting to claim");
        return res.status(403).json(errorResponse);
      }

      authorizedClaimWallet = claimData.userWallet;
      console.log("User is the token creator:", claimData.userWallet);
    }

    // At this point, authorizedClaimWallet is set to the wallet allowed to claim
    console.log("Authorized claim wallet:", authorizedClaimWallet);

    // Deserialize the user-signed transaction
    const transactionBuffer = bs58.decode(signedTransaction);
    const transaction = Transaction.from(transactionBuffer);

    // SECURITY: Validate transaction has recent blockhash to prevent replay attacks
    if (!transaction.recentBlockhash) {
      const errorResponse = { error: 'Invalid transaction: missing blockhash' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Check if blockhash is still valid (within last 150 slots ~60 seconds)
    const isBlockhashValid = await connection.isBlockhashValid(
      transaction.recentBlockhash,
      { commitment: 'confirmed' }
    );

    if (!isBlockhashValid) {
      const errorResponse = { error: 'Invalid transaction: blockhash is expired. Please create a new transaction.' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // CRITICAL SECURITY: Verify the transaction is cryptographically signed by the authorized wallet
    console.log("About to create PublicKey from authorizedClaimWallet:", { authorizedClaimWallet });
    let authorizedPublicKey;
    try {
      authorizedPublicKey = new PublicKey(authorizedClaimWallet!);
      console.log("Successfully created authorizedPublicKey:", authorizedPublicKey.toBase58());
    } catch (error) {
      console.error("Error creating PublicKey from authorizedClaimWallet:", error);
      const errorResponse = { error: 'Invalid authorized wallet format' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }
    let validAuthorizedSigner = false;

    // Compile the transaction message for signature verification
    const message = transaction.compileMessage();
    const messageBytes = message.serialize();

    // Find the authorized wallet's signer index
    const authorizedSignerIndex = message.accountKeys.findIndex(key =>
      key.equals(authorizedPublicKey)
    );

    if (authorizedSignerIndex >= 0 && authorizedSignerIndex < transaction.signatures.length) {
      const signature = transaction.signatures[authorizedSignerIndex];
      if (signature.signature) {
        // CRITICAL: Verify the signature is cryptographically valid using nacl
        const isValid = nacl.sign.detached.verify(
          messageBytes,
          signature.signature,
          authorizedPublicKey.toBytes()
        );
        validAuthorizedSigner = isValid;
      }
    }

    if (!validAuthorizedSigner) {
      const errorResponse = { error: isDesignated ? 'Invalid transaction: must be cryptographically signed by the verified designated wallet' : 'Invalid transaction: must be cryptographically signed by the token creator wallet' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // CRITICAL SECURITY: Verify transaction hasn't been tampered with using hash comparison
    // This is simpler and more secure than instruction-by-instruction validation
    const receivedTransactionHash = crypto.createHash('sha256')
      .update(transaction.serializeMessage())
      .digest('hex');

    if (receivedTransactionHash !== claimData.unsignedTransactionHash) {
      console.log(`  ⚠️  Transaction hash mismatch detected`);
      console.log(`    Expected: ${claimData.unsignedTransactionHash.substring(0, 16)}...`);
      console.log(`    Received: ${receivedTransactionHash.substring(0, 16)}...`);
      const errorResponse = {
        error: 'Transaction verification failed: transaction has been modified',
        details: 'Transaction structure does not match the original unsigned transaction'
      };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }
    console.log(`✓ Transaction integrity verified (cryptographic hash match)`);
    console.log(`  Hash: ${receivedTransactionHash.substring(0, 16)}...`);

    // Add protocol signature (mint authority)
    transaction.partialSign(protocolKeypair);

    // Send the fully signed transaction with proper configuration
    const signature = await connection.sendRawTransaction(
      transaction.serialize(),
      {
        skipPreflight: false,
        preflightCommitment: 'processed'
      }
    );

    // Poll for confirmation status
    const maxAttempts = 20;
    const delayMs = 200;  // 200ms between polls
    let attempts = 0;
    let confirmation;

    while (attempts < maxAttempts) {
      const result = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true
      });

      console.log(`Attempt ${attempts + 1}: Transaction status:`, JSON.stringify(result, null, 2));

      if (!result || !result.value) {
        // Transaction not found yet, wait and retry
        attempts++;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      if (result.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
      }

      // If confirmed or finalized, we're done
      if (result.value.confirmationStatus === 'confirmed' ||
          result.value.confirmationStatus === 'finalized') {
        confirmation = result.value;
        break;
      }

      // Still processing, wait and retry
      attempts++;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    if (!confirmation) {
      throw new Error('Transaction confirmation timeout');
    }


    // Clean up the transaction data from memory
    claimTransactions.delete(transactionKey);

    const successResponse = {
      success: true as const,
      transactionSignature: signature,
      tokenAddress: claimData.tokenAddress,
      claimAmount: claimData.claimAmount,
      confirmation
    };

    console.log("claim/confirm successful response:", successResponse);
    res.json(successResponse);

  } catch (error) {
    console.error('Confirm claim error:', error);
    const errorResponse = {
      error: error instanceof Error ? error.message : 'Failed to confirm claim'
    };
    console.log("claim/confirm error response:", errorResponse);
    res.status(500).json(errorResponse);
  } finally {
    // Always release the lock, even if an error occurred
    if (releaseLock) {
      releaseLock();
    }
  }
});

export default router;
