/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * DLMM deposit route handlers
 */

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { Connection, Transaction, TransactionInstruction, PublicKey, SystemProgram } from '@solana/web3.js';
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

import {
  getPoolConfig,
  acquireLiquidityLock,
  verifySignedTransactionBatch,
  isRestrictedLpOwner,
  REQUEST_EXPIRY,
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

    const tokenXMintInfo = await getMint(connection, tokenXMint);
    const tokenYMintInfo = await getMint(connection, tokenYMint);
    const isTokenXNativeSOL = tokenXMint.equals(NATIVE_MINT);
    const isTokenYNativeSOL = tokenYMint.equals(NATIVE_MINT);

    const lpOwnerTokenXAta = await getAssociatedTokenAddress(tokenXMint, lpOwner.publicKey);
    const lpOwnerTokenYAta = await getAssociatedTokenAddress(tokenYMint, lpOwner.publicKey);

    let tokenXAmountRaw: BN;
    let tokenYAmountRaw: BN;

    if (useCleanupMode) {
      console.log('  Using cleanup mode - reading LP owner wallet balances');
      console.log('  Waiting 2s for RPC to propagate pool state...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (isRestrictedLpOwner(lpOwner.publicKey.toBase58())) {
        return res.status(403).json({ error: 'Deposit operations using LP owner balances are not permitted for this LP owner address' });
      }

      tokenXAmountRaw = new BN(0);
      tokenYAmountRaw = new BN(0);

      try {
        const tokenXAccount = await connection.getTokenAccountBalance(lpOwnerTokenXAta);
        tokenXAmountRaw = new BN(tokenXAccount.value.amount);
      } catch { /* Account doesn't exist */ }

      try {
        if (isTokenYNativeSOL) {
          const solBalance = await connection.getBalance(lpOwner.publicKey);
          const reserveForFees = 333_000_000;
          tokenYAmountRaw = new BN(Math.max(0, solBalance - reserveForFees));
        } else {
          const tokenYAccount = await connection.getTokenAccountBalance(lpOwnerTokenYAta);
          tokenYAmountRaw = new BN(tokenYAccount.value.amount);
        }
      } catch { /* Account doesn't exist */ }

      console.log(`  LP Owner X Balance: ${tokenXAmountRaw.toString()}`);
      console.log(`  LP Owner Y Balance: ${tokenYAmountRaw.toString()}`);

      if (tokenXAmountRaw.isZero() && tokenYAmountRaw.isZero()) {
        return res.status(400).json({ error: 'No tokens available in LP owner wallet for cleanup deposit' });
      }
    } else {
      tokenXAmountRaw = new BN(tokenXAmount || '0');
      tokenYAmountRaw = new BN(tokenYAmount || '0');
    }

    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(lpOwner.publicKey);
    if (userPositions.length === 0) {
      return res.status(404).json({ error: 'No positions found for the LP owner. Create a position first.' });
    }

    const position = userPositions[0];
    const positionData = position.positionData;

    // Get active bin price
    const activeBin = await dlmmPool.getActiveBin();
    const activeBinPrice = Number(activeBin.price);
    console.log(`  Active bin price: ${activeBinPrice} Y per X`);

    // Calculate balanced deposit using active bin price
    const tokenXDecimal = Number(tokenXAmountRaw.toString()) / Math.pow(10, tokenXMintInfo.decimals);
    const tokenYDecimal = Number(tokenYAmountRaw.toString()) / Math.pow(10, tokenYMintInfo.decimals);

    const neededYForAllX = tokenXDecimal * activeBinPrice;
    const neededXForAllY = tokenYDecimal / activeBinPrice;

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

      const managerTokenXAta = await getAssociatedTokenAddress(tokenXMint, manager);
      const managerTokenYAta = await getAssociatedTokenAddress(tokenYMint, manager);

      transferTx.add(createAssociatedTokenAccountIdempotentInstruction(manager, lpOwnerTokenXAta, lpOwner.publicKey, tokenXMint));

      if (!isTokenYNativeSOL) {
        transferTx.add(createAssociatedTokenAccountIdempotentInstruction(manager, lpOwnerTokenYAta, lpOwner.publicKey, tokenYMint));
      }

      if (!tokenXAmountRaw.isZero()) {
        if (isTokenXNativeSOL) {
          transferTx.add(SystemProgram.transfer({ fromPubkey: manager, toPubkey: lpOwner.publicKey, lamports: Number(tokenXAmountRaw.toString()) }));
        } else {
          transferTx.add(createTransferInstruction(managerTokenXAta, lpOwnerTokenXAta, manager, BigInt(tokenXAmountRaw.toString())));
        }
      }

      if (!tokenYAmountRaw.isZero()) {
        if (isTokenYNativeSOL) {
          transferTx.add(SystemProgram.transfer({ fromPubkey: manager, toPubkey: lpOwner.publicKey, lamports: Number(tokenYAmountRaw.toString()) }));
        } else {
          transferTx.add(createTransferInstruction(managerTokenYAta, lpOwnerTokenYAta, manager, BigInt(tokenYAmountRaw.toString())));
        }
      }

      allTransactions.push(transferTx);
    }

    // Build deposit transactions
    const setupInstructions: TransactionInstruction[] = [];

    if (isTokenXNativeSOL && !depositTokenXAmount.isZero()) {
      setupInstructions.push(
        createAssociatedTokenAccountIdempotentInstruction(lpOwner.publicKey, lpOwnerTokenXAta, lpOwner.publicKey, NATIVE_MINT),
        SystemProgram.transfer({ fromPubkey: lpOwner.publicKey, toPubkey: lpOwnerTokenXAta, lamports: Number(depositTokenXAmount.toString()) }),
        createSyncNativeInstruction(lpOwnerTokenXAta)
      );
    }

    if (isTokenYNativeSOL && !depositTokenYAmount.isZero()) {
      setupInstructions.push(
        createAssociatedTokenAccountIdempotentInstruction(lpOwner.publicKey, lpOwnerTokenYAta, lpOwner.publicKey, NATIVE_MINT),
        SystemProgram.transfer({ fromPubkey: lpOwner.publicKey, toPubkey: lpOwnerTokenYAta, lamports: Number(depositTokenYAmount.toString()) }),
        createSyncNativeInstruction(lpOwnerTokenYAta)
      );
    }

    const addLiquidityTxs = await dlmmPool.addLiquidityByStrategyChunkable({
      positionPubKey: position.publicKey,
      totalXAmount: depositTokenXAmount,
      totalYAmount: depositTokenYAmount,
      strategy: { maxBinId: positionData.upperBinId, minBinId: positionData.lowerBinId, strategyType: 0 },
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
      positionAddress: position.publicKey.toBase58(),
      adminWallet,
    });

    const hasLeftover = !leftoverTokenXAmount.isZero() || !leftoverTokenYAmount.isZero();

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
      cleanupMode: useCleanupMode,
      activeBinPrice,
      hasLeftover,
      transferred: { tokenX: tokenXAmountRaw.toString(), tokenY: tokenYAmountRaw.toString() },
      deposited: { tokenX: depositTokenXAmount.toString(), tokenY: depositTokenYAmount.toString() },
      leftover: { tokenX: leftoverTokenXAmount.toString(), tokenY: leftoverTokenYAmount.toString() },
      message: 'Sign all transactions with the manager wallet and submit to /dlmm/deposit/confirm'
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
    } catch {
      return res.status(403).json({ error: 'Pool not authorized for liquidity operations' });
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwnerKeypair = poolConfig.lpOwnerKeypair;
    const managerWalletPubKey = new PublicKey(poolConfig.managerWallet);

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
      tokenXMint: depositData.tokenXMint,
      tokenYMint: depositData.tokenYMint,
      tokenXDecimals: depositData.tokenXDecimals,
      tokenYDecimals: depositData.tokenYDecimals,
      activeBinPrice: depositData.activeBinPrice,
      hasLeftover,
      transferred: { tokenX: depositData.transferredTokenXAmount, tokenY: depositData.transferredTokenYAmount },
      deposited: { tokenX: depositData.depositedTokenXAmount, tokenY: depositData.depositedTokenYAmount },
      leftover: { tokenX: depositData.leftoverTokenXAmount, tokenY: depositData.leftoverTokenYAmount },
      message: hasLeftover
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
