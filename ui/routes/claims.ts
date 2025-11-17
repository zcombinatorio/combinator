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
import { Connection, Keypair, Transaction, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getMint,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
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

    // Special case for ZC token: fixed amounts to ztorio and solpay only (90% of total claim)
    const ZC_TOKEN_ADDRESS = 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC';
    const ZTORIO_ADDRESS = 'A6R6fD82TaTSWKTpKKcRhBotYtc5izyauPFw3yHVYwuP'; // ztorio
    const SOLPAY_ADDRESS = 'J7xnWtfi5Fa3JC1creRBHzo7DkRf6etugCBv1s9vEe5N'; // solpay ($SP)

    if (tokenAddress === ZC_TOKEN_ADDRESS) {
      // ZC token: 25k to ztorio, 10k to solpay from the claimersTotal (90% portion)
      // The remaining 10% goes to admin as normal
      const ztorioAmount = BigInt(25000); // 25k tokens
      const solpayAmount = BigInt(10000); // 10k tokens

      splitRecipients.push(
        {
          wallet: ZTORIO_ADDRESS,
          amount: ztorioAmount,
          amountWithDecimals: ztorioAmount * BigInt(10 ** decimals),
          label: 'ztorio'
        },
        {
          wallet: SOLPAY_ADDRESS,
          amount: solpayAmount,
          amountWithDecimals: solpayAmount * BigInt(10 ** decimals),
          label: 'solpay'
        }
      );

      console.log(`ZC token emission split: 25k to ztorio ${ZTORIO_ADDRESS}, 10k to solpay ${SOLPAY_ADDRESS}, plus 10% admin fee`);
    } else {
      // Default: 100% of claimersTotal goes to the developer/creator
      splitRecipients.push({
        wallet: trimmedCreatorWallet,
        amount: claimersTotal, // 100% of the 90% claimers portion = 90% total
        amountWithDecimals: claimersTotal * BigInt(10 ** decimals),
        label: 'Developer'
      });

      console.log(`Hardcoded emission split: 100% of claimers portion (90% total) to creator ${trimmedCreatorWallet}`);
    }

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

    // Clean up old transactions FIRST (older than 5 minutes) to prevent race conditions
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    for (const [key, data] of claimTransactions.entries()) {
      if (data.timestamp < fiveMinutesAgo) {
        claimTransactions.delete(key);
      }
    }

    // Create a unique key for this transaction with random component to prevent collisions
    const transactionKey = `${tokenAddress}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;

    // Store transaction data for later confirmation
    claimTransactions.set(transactionKey, {
      tokenAddress,
      userWallet,
      claimAmount,
      mintDecimals: decimals,
      timestamp: Date.now()
    });

    // Store split recipients and admin info for validation in confirm endpoint
    const transactionMetadata = {
      splitRecipients: splitRecipients.map(r => ({
        wallet: r.wallet,
        amount: r.amount.toString(),
        label: r.label
      })),
      adminAmount: adminAmount.toString(),
      adminTokenAccount: adminTokenAccount.toString()
    };
    claimTransactions.set(`${transactionKey}_metadata`, transactionMetadata as any);

    // Serialize transaction for user to sign
    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false
    });

    const successResponse = {
      success: true as const,
      transaction: bs58.encode(serializedTransaction),
      transactionKey,
      claimAmount: requestedAmount.toString(),
      splitRecipients: splitRecipients.map(r => ({
        wallet: r.wallet,
        amount: r.amount.toString(),
        label: r.label
      })),
      adminAmount: adminAmount.toString(),
      mintDecimals: decimals,
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

    // Retrieve the metadata with split amounts
    const metadata = claimTransactions.get(`${transactionKey}_metadata`) as any;
    if (!metadata) {
      const errorResponse = { error: 'Transaction metadata not found. Please call /claims/mint first.' };
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

    // CRITICAL SECURITY: Derive the creator's Associated Token Account (ATA) address
    console.log("About to create mintPublicKey from tokenAddress:", { tokenAddress: claimData.tokenAddress });
    let mintPublicKey;
    try {
      mintPublicKey = new PublicKey(claimData.tokenAddress);
      console.log("Successfully created mintPublicKey:", mintPublicKey.toBase58());
    } catch (error) {
      console.error("Error creating PublicKey from tokenAddress:", error);
      const errorResponse = { error: 'Invalid token address format' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Mathematically derive the creator's ATA address (no blockchain calls)
    console.log("About to create PDA with program constants");
    console.log("TOKEN_PROGRAM_ID:", TOKEN_PROGRAM_ID.toBase58());
    console.log("ASSOCIATED_TOKEN_PROGRAM_ID:", ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());

    const [authorizedTokenAccountAddress] = PublicKey.findProgramAddressSync(
      [
        authorizedPublicKey.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(), // SPL Token program
        mintPublicKey.toBuffer()
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID // Associated Token program
    );
    console.log("Successfully created authorizedTokenAccountAddress:", authorizedTokenAccountAddress.toBase58());

    // CRITICAL SECURITY: Derive the admin's ATA address
    const adminPublicKey = new PublicKey(ADMIN_WALLET);
    const [adminTokenAccountAddress] = PublicKey.findProgramAddressSync(
      [
        adminPublicKey.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mintPublicKey.toBuffer()
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    console.log("Successfully created adminTokenAccountAddress:", adminTokenAccountAddress.toBase58());

    // Define safe program IDs that wallets may add for optimization
    const COMPUTE_BUDGET_PROGRAM_ID = ComputeBudgetProgram.programId;
    const LIGHTHOUSE_PROGRAM_ID = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");

    // CRITICAL SECURITY: Validate ONLY allowed instruction types are present
    // This prevents injection of malicious instructions that would receive protocol signature
    console.log("Validating transaction instruction types...");
    for (let i = 0; i < transaction.instructions.length; i++) {
      const instruction = transaction.instructions[i];
      const programId = instruction.programId;

      // Allow safe programs: TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, ComputeBudget, and Lighthouse
      if (!programId.equals(TOKEN_PROGRAM_ID) &&
          !programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) &&
          !programId.equals(COMPUTE_BUDGET_PROGRAM_ID) &&
          !programId.equals(LIGHTHOUSE_PROGRAM_ID)) {
        const errorResponse = {
          error: 'Invalid transaction: unauthorized program instruction detected',
          details: `Instruction ${i} uses unauthorized program: ${programId.toBase58()}`
        };
        console.log("claim/confirm error response:", errorResponse);
        return res.status(400).json(errorResponse);
      }

      // Validate TOKEN_PROGRAM instructions are only MintTo (opcode 7)
      if (programId.equals(TOKEN_PROGRAM_ID)) {
        if (instruction.data.length < 1 || instruction.data[0] !== 7) {
          const errorResponse = {
            error: 'Invalid transaction: unauthorized token instruction detected',
            details: `Instruction ${i} has invalid opcode: ${instruction.data[0]}`
          };
          console.log("claim/confirm error response:", errorResponse);
          return res.status(400).json(errorResponse);
        }
      }

      // Validate ASSOCIATED_TOKEN_PROGRAM instructions are only CreateIdempotent (opcode 1)
      if (programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        if (instruction.data.length < 1 || instruction.data[0] !== 1) {
          const errorResponse = {
            error: 'Invalid transaction: unauthorized ATA instruction detected',
            details: `Instruction ${i} has invalid ATA opcode: ${instruction.data[0]}`
          };
          console.log("claim/confirm error response:", errorResponse);
          return res.status(400).json(errorResponse);
        }
      }
    }
    console.log("✓ All instruction types validated - only authorized programs and opcodes");

    // CRITICAL SECURITY: Validate mint instructions match expected split recipients + admin
    const expectedSplitRecipients = metadata.splitRecipients || [];
    const expectedRecipientCount = expectedSplitRecipients.length + 1; // splits + admin
    let mintInstructionCount = 0;

    console.log("Validating transaction with", transaction.instructions.length, "instructions");
    console.log("Expected recipients:", {
      splitRecipients: expectedSplitRecipients.length,
      admin: 1,
      total: expectedRecipientCount
    });

    // First pass: count mint instructions
    for (const instruction of transaction.instructions) {
      if (instruction.programId.equals(TOKEN_PROGRAM_ID) &&
          instruction.data.length >= 9 &&
          instruction.data[0] === 7) {
        mintInstructionCount++;
      }
    }

    // Validate correct number of mint instructions
    if (mintInstructionCount === 0) {
      const errorResponse = { error: 'Invalid transaction: no mint instructions found' };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    if (mintInstructionCount !== expectedRecipientCount) {
      const errorResponse = {
        error: `Invalid transaction: expected ${expectedRecipientCount} mint instructions (${expectedSplitRecipients.length} recipients + 1 admin), found ${mintInstructionCount}`
      };
      console.log("claim/confirm error response:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    // Get the token decimals to convert claim amounts to base units
    const mintInfo = await getMint(connection, mintPublicKey);
    const expectedAdminAmountWithDecimals = BigInt(metadata.adminAmount) * BigInt(10 ** mintInfo.decimals);

    // Create expected recipient map with token account addresses and amounts
    const expectedRecipients = new Map<string, bigint>();

    // Add all split recipients
    for (const recipient of expectedSplitRecipients) {
      const recipientPublicKey = new PublicKey(recipient.wallet);
      const recipientTokenAccount = await getAssociatedTokenAddress(
        mintPublicKey,
        recipientPublicKey
      );
      const expectedAmount = BigInt(recipient.amount) * BigInt(10 ** mintInfo.decimals);
      expectedRecipients.set(recipientTokenAccount.toBase58(), expectedAmount);
    }

    // Add admin recipient
    expectedRecipients.set(adminTokenAccountAddress.toBase58(), expectedAdminAmountWithDecimals);

    console.log("Expected recipients with amounts:", {
      splitRecipients: expectedSplitRecipients.map((r: any) => ({
        wallet: r.wallet,
        amount: r.amount,
        amountWithDecimals: (BigInt(r.amount) * BigInt(10 ** mintInfo.decimals)).toString()
      })),
      admin: {
        wallet: ADMIN_WALLET,
        amount: metadata.adminAmount,
        amountWithDecimals: expectedAdminAmountWithDecimals.toString()
      }
    });

    // Track which recipients have been validated
    const validatedRecipients = new Set<string>();

    // Second pass: validate ALL mint instructions match expected recipients
    for (let i = 0; i < transaction.instructions.length; i++) {
      const instruction = transaction.instructions[i];
      console.log(`Instruction ${i}:`, {
        programId: instruction.programId.toString(),
        dataLength: instruction.data.length,
        keysLength: instruction.keys.length,
        firstByte: instruction.data.length > 0 ? instruction.data[0] : undefined
      });

      // Allow Compute Budget instructions (for priority fees and compute units)
      if (instruction.programId.equals(COMPUTE_BUDGET_PROGRAM_ID)) {
        continue;
      }

      // Allow ATA creation instructions (created by server in /claims/mint)
      if (instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        continue;
      }

      // Allow Lighthouse instructions (for transaction optimization)
      if (instruction.programId.equals(LIGHTHOUSE_PROGRAM_ID)) {
        continue;
      }

      // Check if this is a mintTo instruction (SPL Token program)
      if (instruction.programId.equals(TOKEN_PROGRAM_ID)) {
        // Parse mintTo instruction - first byte is instruction type (7 = mintTo)
        if (instruction.data.length >= 9 && instruction.data[0] === 7) {
          console.log("Found mintTo instruction!");

          // Validate mint amount (bytes 1-8 are amount as little-endian u64)
          const mintAmount = instruction.data.readBigUInt64LE(1);

          // Validate complete mint instruction structure
          if (instruction.keys.length >= 3) {
            const mintAccount = instruction.keys[0].pubkey; // mint account
            const recipientAccount = instruction.keys[1].pubkey; // recipient token account
            const mintAuthority = instruction.keys[2].pubkey; // mint authority

            console.log("Mint instruction validation:", {
              mintAccount: mintAccount.toBase58(),
              expectedMint: mintPublicKey.toBase58(),
              mintMatches: mintAccount.equals(mintPublicKey),
              recipientAccount: recipientAccount.toBase58(),
              mintAmount: mintAmount.toString(),
              mintAuthority: mintAuthority.toBase58(),
              expectedAuthority: protocolKeypair.publicKey.toBase58(),
              authorityMatches: mintAuthority.equals(protocolKeypair.publicKey)
            });

            // CRITICAL SECURITY: Validate mint account is correct
            if (!mintAccount.equals(mintPublicKey)) {
              const errorResponse = { error: 'Invalid transaction: mint instruction has wrong token mint' };
              console.log("claim/confirm error response:", errorResponse);
              return res.status(400).json(errorResponse);
            }

            // CRITICAL SECURITY: Validate mint authority is protocol keypair
            if (!mintAuthority.equals(protocolKeypair.publicKey)) {
              const errorResponse = { error: 'Invalid transaction: mint authority must be protocol wallet' };
              console.log("claim/confirm error response:", errorResponse);
              return res.status(400).json(errorResponse);
            }

            // CRITICAL SECURITY: Validate recipient and amount match expected
            const recipientKey = recipientAccount.toBase58();
            const expectedAmount = expectedRecipients.get(recipientKey);

            if (expectedAmount === undefined) {
              const errorResponse = { error: 'Invalid transaction: mint instruction has unauthorized recipient' };
              console.log("claim/confirm error response:", errorResponse);
              console.log("Unauthorized recipient:", {
                recipientAccount: recipientKey,
                expectedRecipients: Array.from(expectedRecipients.keys())
              });
              return res.status(400).json(errorResponse);
            }

            if (mintAmount !== expectedAmount) {
              const errorResponse = { error: 'Invalid transaction: mint instruction has incorrect amount' };
              console.log("claim/confirm error response:", errorResponse);
              console.log("Amount mismatch:", {
                recipientAccount: recipientKey,
                actualAmount: mintAmount.toString(),
                expectedAmount: expectedAmount.toString()
              });
              return res.status(400).json(errorResponse);
            }

            // Mark this recipient as validated
            validatedRecipients.add(recipientKey);
            console.log("✓ Valid mint instruction found for recipient:", recipientKey);
          }
        } else {
          // SECURITY: Reject any TOKEN_PROGRAM instruction that is not mintTo (opcode 7)
          const errorResponse = { error: 'Invalid transaction: contains unauthorized token program instructions' };
          console.log("claim/confirm error response:", errorResponse);
          return res.status(400).json(errorResponse);
        }
      } else {
        // SECURITY: Reject any unknown program instruction (defense-in-depth)
        const errorResponse = { error: 'Invalid transaction: contains unexpected instructions' };
        console.log("claim/confirm error response:", errorResponse);
        return res.status(400).json(errorResponse);
      }
    }

    // CRITICAL SECURITY: Ensure ALL expected recipients were validated
    if (validatedRecipients.size !== expectedRecipients.size) {
      const errorResponse = { error: 'Invalid transaction: missing mint instructions for some recipients' };
      console.log("claim/confirm error response:", errorResponse);
      console.log("Validation incomplete:", {
        validated: validatedRecipients.size,
        expected: expectedRecipients.size,
        missing: Array.from(expectedRecipients.keys()).filter(k => !validatedRecipients.has(k))
      });
      return res.status(400).json(errorResponse);
    }

    console.log("✓ All mint instructions validated successfully");

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


    // Get split recipients from metadata before cleanup
    const splitRecipients = metadata.splitRecipients || [];

    // Clean up the transaction data from memory
    claimTransactions.delete(transactionKey);
    claimTransactions.delete(`${transactionKey}_metadata`);

    const successResponse = {
      success: true as const,
      transactionSignature: signature,
      tokenAddress: claimData.tokenAddress,
      claimAmount: claimData.claimAmount,
      splitRecipients,
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
