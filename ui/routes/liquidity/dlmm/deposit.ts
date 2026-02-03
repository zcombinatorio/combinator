/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * DLMM deposit route handlers
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { Connection, Transaction, TransactionInstruction, PublicKey, SystemProgram, Keypair } from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getMint,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import BN from 'bn.js';
import DLMM, { StrategyType } from '@meteora-ag/dlmm';
import rateLimit from 'express-rate-limit';

import {
  getPoolConfig,
  acquireLiquidityLock,
  verifySignedTransactionBatch,
  isRestrictedLpOwner,
  REQUEST_EXPIRY,
  getTokenProgramsForMints,
  AdminKeyError,
} from '../shared';
import { depositRequests } from './storage';

const router = Router();

const dlmmLiquidityLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many liquidity requests, please wait a moment.'
});

/**
 * POST /deposit/build - Build deposit transaction
 */
router.post('/build', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { tokenXAmount, tokenYAmount, poolAddress: poolAddressInput, adminWallet } = req.body;

    console.log('DLMM deposit build request received:', { tokenXAmount, tokenYAmount, poolAddress: poolAddressInput, adminWallet });

    if (!poolAddressInput) {
      return res.status(400).json({ error: 'Missing required field: poolAddress' });
    }

    const useCleanupMode = (!tokenXAmount || tokenXAmount === '0') && (!tokenYAmount || tokenYAmount === '0');

    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch {
      return res.status(400).json({ error: 'Invalid poolAddress: must be a valid Solana public key' });
    }

    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) {
      return res.status(500).json({ error: 'Server configuration incomplete. Missing RPC_URL.' });
    }

    let poolConfig;
    try {
      poolConfig = await getPoolConfig(poolAddress.toBase58(), 'dlmm', adminWallet);
    } catch (error) {
      if (error instanceof AdminKeyError) {
        console.error('Admin key error details:', error.internalDetails);
        return res.status(503).json({ error: error.clientMessage });
      }
      return res.status(403).json({ error: 'Pool not authorized for liquidity operations', details: error instanceof Error ? error.message : String(error) });
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = poolConfig.lpOwnerKeypair;
    const manager = new PublicKey(poolConfig.managerWallet);
    const isSameWallet = lpOwner.publicKey.equals(manager);

    const dlmmPool = await DLMM.create(connection, poolAddress);
    const lbPair = dlmmPool.lbPair;
    const tokenXMint = lbPair.tokenXMint;
    const tokenYMint = lbPair.tokenYMint;

    // Detect token programs (Token-2022 vs SPL Token)
    const tokenPrograms = await getTokenProgramsForMints(connection, [tokenXMint, tokenYMint]);
    const tokenXProgram = tokenPrograms.get(tokenXMint.toBase58());
    const tokenYProgram = tokenPrograms.get(tokenYMint.toBase58());
    if (!tokenXProgram || !tokenYProgram) {
      throw new Error('Failed to detect token program for pool mints');
    }

    const tokenXMintInfo = await getMint(connection, tokenXMint, undefined, tokenXProgram);
    const tokenYMintInfo = await getMint(connection, tokenYMint, undefined, tokenYProgram);
    const isTokenXNativeSOL = tokenXMint.equals(NATIVE_MINT);
    const isTokenYNativeSOL = tokenYMint.equals(NATIVE_MINT);

    const lpOwnerTokenXAta = await getAssociatedTokenAddress(tokenXMint, lpOwner.publicKey, false, tokenXProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
    const lpOwnerTokenYAta = await getAssociatedTokenAddress(tokenYMint, lpOwner.publicKey, false, tokenYProgram, ASSOCIATED_TOKEN_PROGRAM_ID);

    let tokenXAmountRaw: BN;
    let tokenYAmountRaw: BN;

    if (useCleanupMode) {
      console.log('  Using cleanup mode - reading LP owner wallet balances');
      console.log('  Waiting 2s for RPC to propagate pool state...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (isRestrictedLpOwner(lpOwner.publicKey.toBase58())) {
        return res.status(403).json({ error: 'Deposit operations using LP owner balances are not permitted for this LP owner address' });
      }

      const tokenXAccount = await connection.getTokenAccountBalance(lpOwnerTokenXAta);
      tokenXAmountRaw = new BN(tokenXAccount.value.amount);

      if (isTokenYNativeSOL) {
        const solBalance = await connection.getBalance(lpOwner.publicKey);
        const reserveForFees = 333_000_000;
        tokenYAmountRaw = new BN(Math.max(0, solBalance - reserveForFees));
      } else {
        const tokenYAccount = await connection.getTokenAccountBalance(lpOwnerTokenYAta);
        tokenYAmountRaw = new BN(tokenYAccount.value.amount);
      }

      console.log(`  LP Owner X Balance: ${tokenXAmountRaw.toString()}`);
      console.log(`  LP Owner Y Balance: ${tokenYAmountRaw.toString()}`);

      // Fail if either balance is zero - cleanup mode should have both tokens after swap
      if (tokenXAmountRaw.isZero() || tokenYAmountRaw.isZero()) {
        return res.status(400).json({
          error: 'Unexpected zero balance in cleanup mode - RPC may have returned stale data',
          balances: { tokenX: tokenXAmountRaw.toString(), tokenY: tokenYAmountRaw.toString() }
        });
      }
    } else {
      tokenXAmountRaw = new BN(tokenXAmount || '0');
      tokenYAmountRaw = new BN(tokenYAmount || '0');
    }

    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(lpOwner.publicKey);

    // Get active bin price
    const activeBin = await dlmmPool.getActiveBin();
    const activeBinPrice = Number(activeBin.price);
    console.log(`  Active bin price: ${activeBinPrice} Y per X`);

    // Determine if we need to create a new position
    const isNewPosition = userPositions.length === 0;
    let positionPubkey: PublicKey;
    let positionKeypair: Keypair | null = null;
    let minBinId: number;
    let maxBinId: number;

    if (isNewPosition) {
      // Generate a new position keypair - we'll create the position during deposit
      positionKeypair = Keypair.generate();
      positionPubkey = positionKeypair.publicKey;
      // Use a reasonable bin range around the active bin (+/- 34 bins = 69 bins total, max is 70)
      const binRange = 34;
      minBinId = activeBin.binId - binRange;
      maxBinId = activeBin.binId + binRange;
      console.log(`  Creating new position: ${positionPubkey.toBase58()}`);
      console.log(`  Bin range: ${minBinId} to ${maxBinId}`);
    } else {
      const position = userPositions[0];
      positionPubkey = position.publicKey;
      minBinId = position.positionData.lowerBinId;
      maxBinId = position.positionData.upperBinId;
      console.log(`  Using existing position: ${positionPubkey.toBase58()}`);
    }

    // Calculate balanced deposit using active bin price
    // Convert raw price (raw_Y per raw_X) to decimal price (decimal_Y per decimal_X)
    const decimalPrice = activeBinPrice * Math.pow(10, tokenXMintInfo.decimals - tokenYMintInfo.decimals);
    const tokenXDecimal = Number(tokenXAmountRaw.toString()) / Math.pow(10, tokenXMintInfo.decimals);
    const tokenYDecimal = Number(tokenYAmountRaw.toString()) / Math.pow(10, tokenYMintInfo.decimals);

    const neededYForAllX = tokenXDecimal * decimalPrice;
    const neededXForAllY = tokenYDecimal / decimalPrice;

    let depositXDecimal: number;
    let depositYDecimal: number;
    let leftoverXDecimal: number;
    let leftoverYDecimal: number;

    if (neededYForAllX <= tokenYDecimal) {
      depositXDecimal = tokenXDecimal;
      depositYDecimal = neededYForAllX;
      leftoverXDecimal = 0;
      leftoverYDecimal = tokenYDecimal - neededYForAllX;
    } else {
      depositXDecimal = neededXForAllY;
      depositYDecimal = tokenYDecimal;
      leftoverXDecimal = tokenXDecimal - neededXForAllY;
      leftoverYDecimal = 0;
    }

    const depositTokenXAmount = new BN(Math.floor(depositXDecimal * Math.pow(10, tokenXMintInfo.decimals)));
    const depositTokenYAmount = new BN(Math.floor(depositYDecimal * Math.pow(10, tokenYMintInfo.decimals)));
    const leftoverTokenXAmount = new BN(Math.floor(leftoverXDecimal * Math.pow(10, tokenXMintInfo.decimals)));
    const leftoverTokenYAmount = new BN(Math.floor(leftoverYDecimal * Math.pow(10, tokenYMintInfo.decimals)));

    console.log(`  Deposit X: ${depositTokenXAmount.toString()}`);
    console.log(`  Deposit Y: ${depositTokenYAmount.toString()}`);
    console.log(`  Leftover X: ${leftoverTokenXAmount.toString()}`);
    console.log(`  Leftover Y: ${leftoverTokenYAmount.toString()}`);

    // Build transactions
    const allTransactions: Transaction[] = [];
    const { blockhash } = await connection.getLatestBlockhash();

    // Transfer transaction (if not same wallet and not cleanup mode)
    if (!isSameWallet && !useCleanupMode) {
      const transferTx = new Transaction();
      transferTx.recentBlockhash = blockhash;
      transferTx.feePayer = manager;

      const managerTokenXAta = await getAssociatedTokenAddress(tokenXMint, manager, false, tokenXProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
      const managerTokenYAta = await getAssociatedTokenAddress(tokenYMint, manager, false, tokenYProgram, ASSOCIATED_TOKEN_PROGRAM_ID);

      transferTx.add(createAssociatedTokenAccountIdempotentInstruction(manager, lpOwnerTokenXAta, lpOwner.publicKey, tokenXMint, tokenXProgram, ASSOCIATED_TOKEN_PROGRAM_ID));

      if (!isTokenYNativeSOL) {
        transferTx.add(createAssociatedTokenAccountIdempotentInstruction(manager, lpOwnerTokenYAta, lpOwner.publicKey, tokenYMint, tokenYProgram, ASSOCIATED_TOKEN_PROGRAM_ID));
      }

      if (!tokenXAmountRaw.isZero()) {
        if (isTokenXNativeSOL) {
          transferTx.add(SystemProgram.transfer({ fromPubkey: manager, toPubkey: lpOwner.publicKey, lamports: Number(tokenXAmountRaw.toString()) }));
        } else {
          transferTx.add(createTransferInstruction(managerTokenXAta, lpOwnerTokenXAta, manager, BigInt(tokenXAmountRaw.toString()), [], tokenXProgram));
        }
      }

      if (!tokenYAmountRaw.isZero()) {
        if (isTokenYNativeSOL) {
          transferTx.add(SystemProgram.transfer({ fromPubkey: manager, toPubkey: lpOwner.publicKey, lamports: Number(tokenYAmountRaw.toString()) }));
        } else {
          transferTx.add(createTransferInstruction(managerTokenYAta, lpOwnerTokenYAta, manager, BigInt(tokenYAmountRaw.toString()), [], tokenYProgram));
        }
      }

      allTransactions.push(transferTx);
    }

    // Build deposit transactions
    // NOTE: We do NOT add SOL wrapping instructions here because the Meteora DLMM SDK
    // handles SOL wrapping internally when tokenX or tokenY is NATIVE_MINT.
    // Adding wrapping here would cause a double-wrap bug where both our code and the SDK
    // try to transfer the same SOL amount, causing the second transfer to fail.
    const setupInstructions: TransactionInstruction[] = [];

    // Build deposit transaction(s) - use different method depending on whether position exists
    if (isNewPosition) {
      // Create new position and add liquidity in one transaction
      console.log(`  Creating new position with liquidity...`);
      const initAndAddLiquidityTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: positionPubkey,
        totalXAmount: depositTokenXAmount,
        totalYAmount: depositTokenYAmount,
        strategy: {
          maxBinId,
          minBinId,
          strategyType: StrategyType.Spot,
        },
        user: lpOwner.publicKey,
        slippage: 500,
      });

      const depositTx = new Transaction();
      depositTx.recentBlockhash = blockhash;
      depositTx.feePayer = manager;
      if (setupInstructions.length > 0) depositTx.add(...setupInstructions);
      depositTx.add(...initAndAddLiquidityTx.instructions);
      allTransactions.push(depositTx);

      console.log(`  Built 1 transaction (initialize position + add liquidity)`);
    } else {
      // Add to existing position using chunkable method
      const addLiquidityTxs = await dlmmPool.addLiquidityByStrategyChunkable({
        positionPubKey: positionPubkey,
        totalXAmount: depositTokenXAmount,
        totalYAmount: depositTokenYAmount,
        strategy: { maxBinId, minBinId, strategyType: StrategyType.Spot },
        user: lpOwner.publicKey,
        slippage: 500,
      });

      console.log(`  Deposit chunked into ${addLiquidityTxs.length} transaction(s)`);

      if (addLiquidityTxs.length > 0) {
        const firstTx = new Transaction();
        firstTx.recentBlockhash = blockhash;
        firstTx.feePayer = manager;
        if (setupInstructions.length > 0) firstTx.add(...setupInstructions);
        firstTx.add(...addLiquidityTxs[0].instructions);
        allTransactions.push(firstTx);

        for (let i = 1; i < addLiquidityTxs.length; i++) {
          const chunkTx = new Transaction();
          chunkTx.recentBlockhash = blockhash;
          chunkTx.feePayer = manager;
          chunkTx.add(...addLiquidityTxs[i].instructions);
          allTransactions.push(chunkTx);
        }
      }
    }

    const unsignedTransactions = allTransactions.map(tx => bs58.encode(tx.serialize({ requireAllSignatures: false })));
    const unsignedTransactionHashes = allTransactions.map(tx => crypto.createHash('sha256').update(tx.serializeMessage()).digest('hex'));
    const requestId = depositRequests.generateRequestId();

    console.log('✓ Deposit transactions built successfully');
    console.log(`  Request ID: ${requestId}`);

    depositRequests.set(requestId, {
      unsignedTransactions,
      unsignedTransactionHashes,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      tokenXDecimals: tokenXMintInfo.decimals,
      tokenYDecimals: tokenYMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: manager.toBase58(),
      transferredTokenXAmount: tokenXAmountRaw.toString(),
      transferredTokenYAmount: tokenYAmountRaw.toString(),
      depositedTokenXAmount: depositTokenXAmount.toString(),
      depositedTokenYAmount: depositTokenYAmount.toString(),
      leftoverTokenXAmount: leftoverTokenXAmount.toString(),
      leftoverTokenYAmount: leftoverTokenYAmount.toString(),
      activeBinPrice,
      positionAddress: positionPubkey.toBase58(),
      adminWallet,
      // Store position keypair secret if we're creating a new position
      isNewPosition,
      newPositionKeypairSecret: positionKeypair ? bs58.encode(positionKeypair.secretKey) : undefined,
    });

    const hasLeftover = !leftoverTokenXAmount.isZero() || !leftoverTokenYAmount.isZero();

    res.json({
      success: true,
      transactions: unsignedTransactions,
      transactionCount: unsignedTransactions.length,
      requestId,
      poolAddress: poolAddress.toBase58(),
      positionAddress: positionPubkey.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      tokenXDecimals: tokenXMintInfo.decimals,
      tokenYDecimals: tokenYMintInfo.decimals,
      cleanupMode: useCleanupMode,
      activeBinPrice,
      hasLeftover,
      isNewPosition,
      transferred: { tokenX: tokenXAmountRaw.toString(), tokenY: tokenYAmountRaw.toString() },
      deposited: { tokenX: depositTokenXAmount.toString(), tokenY: depositTokenYAmount.toString() },
      leftover: { tokenX: leftoverTokenXAmount.toString(), tokenY: leftoverTokenYAmount.toString() },
      message: isNewPosition
        ? 'Sign all transactions with the manager wallet and submit to /dlmm/deposit/confirm (new position will be created)'
        : 'Sign all transactions with the manager wallet and submit to /dlmm/deposit/confirm'
    });

  } catch (error) {
    console.error('DLMM deposit build error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create deposit transaction' });
  }
});

/**
 * POST /deposit/confirm - Confirm and submit deposit transactions
 */
router.post('/confirm', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransactions, requestId } = req.body;

    console.log('DLMM deposit confirm request received:', { requestId });

    if (!signedTransactions || !Array.isArray(signedTransactions) || signedTransactions.length === 0 || !requestId) {
      return res.status(400).json({ error: 'Missing required fields: signedTransactions (array) and requestId' });
    }

    const depositData = depositRequests.get(requestId);
    if (!depositData) {
      return res.status(400).json({ error: 'Deposit request not found or expired. Please call /dlmm/deposit/build first.' });
    }

    if (signedTransactions.length !== depositData.unsignedTransactions.length) {
      return res.status(400).json({ error: `Expected ${depositData.unsignedTransactions.length} transactions, got ${signedTransactions.length}` });
    }

    console.log('  Pool:', depositData.poolAddress);

    releaseLock = await acquireLiquidityLock(depositData.poolAddress);
    console.log('  Lock acquired');

    if (depositRequests.isExpired(requestId, REQUEST_EXPIRY.CONFIRM)) {
      depositRequests.delete(requestId);
      return res.status(400).json({ error: 'Deposit request expired. Please create a new request.' });
    }

    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) {
      return res.status(500).json({ error: 'Server configuration incomplete. Missing RPC_URL.' });
    }

    let poolConfig;
    try {
      poolConfig = await getPoolConfig(depositData.poolAddress, 'dlmm', depositData.adminWallet);
    } catch (error) {
      if (error instanceof AdminKeyError) {
        console.error('Admin key error details:', error.internalDetails);
        return res.status(503).json({ error: error.clientMessage });
      }
      return res.status(403).json({ error: 'Pool not authorized for liquidity operations' });
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwnerKeypair = poolConfig.lpOwnerKeypair;
    const managerWalletPubKey = new PublicKey(poolConfig.managerWallet);

    // Reconstruct position keypair if this is a new position
    let positionKeypair: Keypair | null = null;
    if (depositData.isNewPosition && depositData.newPositionKeypairSecret) {
      positionKeypair = Keypair.fromSecretKey(bs58.decode(depositData.newPositionKeypairSecret));
      console.log(`  New position keypair reconstructed: ${positionKeypair.publicKey.toBase58()}`);
    }

    const verifyResult = await verifySignedTransactionBatch(
      connection,
      signedTransactions,
      depositData.unsignedTransactionHashes,
      managerWalletPubKey
    );

    if (!verifyResult.success) {
      return res.status(400).json({ error: verifyResult.error, details: verifyResult.details });
    }

    const transactions = verifyResult.transactions;
    const signatures: string[] = [];
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    for (let i = 0; i < transactions.length; i++) {
      const transaction = transactions[i];
      transaction.partialSign(lpOwnerKeypair);

      // Also sign with position keypair if creating a new position (only needed for first tx)
      if (positionKeypair && i === 0) {
        transaction.partialSign(positionKeypair);
        console.log(`  Signed with new position keypair`);
      }

      console.log(`  Sending transaction ${i + 1}/${transactions.length}...`);
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
      signatures.push(signature);

      console.log(`  ✓ Transaction ${i + 1} sent: ${signature}`);

      try {
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
        console.log(`  ✓ Transaction ${i + 1} confirmed`);
      } catch (error) {
        console.error(`  ⚠ Transaction ${i + 1} confirmation timeout:`, error);
      }
    }

    console.log('✓ DLMM deposit transactions completed');

    depositRequests.delete(requestId);

    const hasLeftover = depositData.leftoverTokenXAmount !== '0' || depositData.leftoverTokenYAmount !== '0';

    res.json({
      success: true,
      signatures,
      poolAddress: depositData.poolAddress,
      positionAddress: depositData.positionAddress,
      isNewPosition: depositData.isNewPosition || false,
      tokenXMint: depositData.tokenXMint,
      tokenYMint: depositData.tokenYMint,
      tokenXDecimals: depositData.tokenXDecimals,
      tokenYDecimals: depositData.tokenYDecimals,
      activeBinPrice: depositData.activeBinPrice,
      hasLeftover,
      transferred: { tokenX: depositData.transferredTokenXAmount, tokenY: depositData.transferredTokenYAmount },
      deposited: { tokenX: depositData.depositedTokenXAmount, tokenY: depositData.depositedTokenYAmount },
      leftover: { tokenX: depositData.leftoverTokenXAmount, tokenY: depositData.leftoverTokenYAmount },
      message: depositData.isNewPosition
        ? 'New position created and liquidity deposited successfully'
        : hasLeftover
          ? 'Deposit transactions submitted successfully. Leftover tokens remain in LP owner wallet for cleanup.'
          : 'Deposit transactions submitted successfully'
    });

  } catch (error) {
    console.error('DLMM deposit confirm error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to confirm deposit' });
  } finally {
    if (releaseLock) releaseLock();
  }
});

export default router;
