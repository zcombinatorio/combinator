/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * DLMM withdrawal route handlers
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
  NATIVE_MINT,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import BN from 'bn.js';
import DLMM from '@meteora-ag/dlmm';
import rateLimit from 'express-rate-limit';

import {
  getPoolConfig,
  acquireLiquidityLock,
  verifySignedTransactionBatch,
  getJupiterPrice,
  REQUEST_EXPIRY,
  getTokenProgramsForMints,
} from '../shared';
import { withdrawRequests } from './storage';

const router = Router();

const dlmmLiquidityLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many liquidity requests, please wait a moment.'
});

/**
 * POST /withdraw/build - Build withdrawal transaction
 */
router.post('/build', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { withdrawalPercentage, poolAddress: poolAddressInput, adminWallet } = req.body;

    console.log('DLMM withdraw build request received:', { withdrawalPercentage, poolAddress: poolAddressInput, adminWallet });

    if (withdrawalPercentage === undefined || withdrawalPercentage === null) {
      return res.status(400).json({ error: 'Missing required field: withdrawalPercentage' });
    }

    if (!poolAddressInput) {
      return res.status(400).json({ error: 'Missing required field: poolAddress' });
    }

    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch {
      return res.status(400).json({ error: 'Invalid poolAddress: must be a valid Solana public key' });
    }

    if (typeof withdrawalPercentage !== 'number' || withdrawalPercentage <= 0 || withdrawalPercentage > 50) {
      return res.status(400).json({ error: 'withdrawalPercentage must be a number between 0 and 50' });
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
    const managerWallet = new PublicKey(poolConfig.managerWallet);

    console.log('Creating DLMM instance...');
    const dlmmPool = await DLMM.create(connection, poolAddress);

    const lbPair = dlmmPool.lbPair;
    const tokenXMint = lbPair.tokenXMint;
    const tokenYMint = lbPair.tokenYMint;

    console.log(`  Token X Mint: ${tokenXMint.toBase58()}`);
    console.log(`  Token Y Mint: ${tokenYMint.toBase58()}`);

    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(lpOwner.publicKey);

    if (userPositions.length === 0) {
      return res.status(404).json({ error: 'No positions found for the LP owner in this pool' });
    }

    const position = userPositions[0];
    const positionData = position.positionData;

    if (!positionData.totalXAmount || !positionData.totalYAmount) {
      return res.status(400).json({ error: 'Position has no liquidity' });
    }

    const totalXAmount = new BN(positionData.totalXAmount);
    const totalYAmount = new BN(positionData.totalYAmount);

    if (totalXAmount.isZero() && totalYAmount.isZero()) {
      return res.status(400).json({ error: 'No liquidity in position' });
    }

    console.log(`  Position: ${position.publicKey.toBase58()}`);
    console.log(`  Total X Amount: ${totalXAmount.toString()}`);
    console.log(`  Total Y Amount: ${totalYAmount.toString()}`);

    // Calculate estimated withdrawal amounts
    const withdrawBps = Math.floor(withdrawalPercentage * 100);
    const estimatedTokenXAmount = totalXAmount.muln(withdrawBps).divn(10000);
    const estimatedTokenYAmount = totalYAmount.muln(withdrawBps).divn(10000);

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
    const managerTokenXAta = await getAssociatedTokenAddress(tokenXMint, managerWallet, false, tokenXProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
    const managerTokenYAta = await getAssociatedTokenAddress(tokenYMint, managerWallet, false, tokenYProgram, ASSOCIATED_TOKEN_PROGRAM_ID);

    // Fetch Jupiter market price, fall back to pool price if not available
    console.log('  Fetching Jupiter market price...');
    let marketPrice: number;
    try {
      const jupiterPrice = await getJupiterPrice(tokenXMint.toBase58(), tokenYMint.toBase58());
      marketPrice = jupiterPrice.tokenBPerTokenA;
    } catch (jupiterError) {
      // Jupiter doesn't have price data (common for new/test tokens)
      // Use the pool's active bin price as fallback
      console.log(`  Jupiter price not available: ${jupiterError instanceof Error ? jupiterError.message : String(jupiterError)}`);
      console.log('  Using pool active bin price as fallback...');
      const activeBin = await dlmmPool.getActiveBin();
      // activeBin.price is in Y per X (quote per base)
      marketPrice = Number(activeBin.price);
      console.log(`  Pool active bin price: ${marketPrice} tokenY per tokenX`);
    }

    const withdrawnXDecimal = Number(estimatedTokenXAmount.toString()) / Math.pow(10, tokenXMintInfo.decimals);
    const withdrawnYDecimal = Number(estimatedTokenYAmount.toString()) / Math.pow(10, tokenYMintInfo.decimals);

    console.log(`  Withdrawn: ${withdrawnXDecimal} tokenX, ${withdrawnYDecimal} tokenY`);
    console.log(`  Market price: ${marketPrice} tokenY per tokenX`);

    const neededYForAllX = withdrawnXDecimal * marketPrice;
    const neededXForAllY = withdrawnYDecimal / marketPrice;

    let transferXDecimal: number;
    let transferYDecimal: number;
    let redepositXDecimal: number;
    let redepositYDecimal: number;

    if (neededYForAllX <= withdrawnYDecimal) {
      transferXDecimal = withdrawnXDecimal;
      transferYDecimal = neededYForAllX;
      redepositXDecimal = 0;
      redepositYDecimal = withdrawnYDecimal - neededYForAllX;
      console.log(`  Case: Excess tokenY - redepositing ${redepositYDecimal} tokenY`);
    } else {
      transferXDecimal = neededXForAllY;
      transferYDecimal = withdrawnYDecimal;
      redepositXDecimal = withdrawnXDecimal - neededXForAllY;
      redepositYDecimal = 0;
      console.log(`  Case: Excess tokenX - redepositing ${redepositXDecimal} tokenX`);
    }

    const transferTokenXAmount = new BN(Math.floor(transferXDecimal * Math.pow(10, tokenXMintInfo.decimals)));
    const transferTokenYAmount = new BN(Math.floor(transferYDecimal * Math.pow(10, tokenYMintInfo.decimals)));
    const redepositTokenXAmount = new BN(Math.floor(redepositXDecimal * Math.pow(10, tokenXMintInfo.decimals)));
    const redepositTokenYAmount = new BN(Math.floor(redepositYDecimal * Math.pow(10, tokenYMintInfo.decimals)));

    // Build redeposit transactions if needed
    // Skip redeposit if amounts are too small (less than 0.1% of withdrawn)
    // because DLMM deposits require both tokens and may cause insufficient funds
    const redepositTxs: Transaction[] = [];
    const minRedepositThreshold = 0.001; // 0.1%
    const redepositXRatio = withdrawnXDecimal > 0 ? redepositXDecimal / withdrawnXDecimal : 0;
    const redepositYRatio = withdrawnYDecimal > 0 ? redepositYDecimal / withdrawnYDecimal : 0;
    const hasSignificantRedeposit = redepositXRatio > minRedepositThreshold || redepositYRatio > minRedepositThreshold;

    if (hasSignificantRedeposit) {
      console.log('  Building redeposit transactions...');

      const setupInstructions: TransactionInstruction[] = [];

      if (isTokenXNativeSOL) {
        setupInstructions.push(
          createAssociatedTokenAccountIdempotentInstruction(lpOwner.publicKey, lpOwnerTokenXAta, lpOwner.publicKey, NATIVE_MINT)
        );
        if (!redepositTokenXAmount.isZero()) {
          setupInstructions.push(
            SystemProgram.transfer({ fromPubkey: lpOwner.publicKey, toPubkey: lpOwnerTokenXAta, lamports: Number(redepositTokenXAmount.toString()) }),
            createSyncNativeInstruction(lpOwnerTokenXAta)
          );
        }
      }

      if (isTokenYNativeSOL) {
        setupInstructions.push(
          createAssociatedTokenAccountIdempotentInstruction(lpOwner.publicKey, lpOwnerTokenYAta, lpOwner.publicKey, NATIVE_MINT)
        );
        if (!redepositTokenYAmount.isZero()) {
          setupInstructions.push(
            SystemProgram.transfer({ fromPubkey: lpOwner.publicKey, toPubkey: lpOwnerTokenYAta, lamports: Number(redepositTokenYAmount.toString()) }),
            createSyncNativeInstruction(lpOwnerTokenYAta)
          );
        }
      }

      const addLiquidityTxs = await dlmmPool.addLiquidityByStrategyChunkable({
        positionPubKey: position.publicKey,
        totalXAmount: redepositTokenXAmount,
        totalYAmount: redepositTokenYAmount,
        strategy: { maxBinId: positionData.upperBinId, minBinId: positionData.lowerBinId, strategyType: 0 },
        user: lpOwner.publicKey,
        slippage: 500,
      });

      console.log(`  Redeposit chunked into ${addLiquidityTxs.length} transaction(s)`);

      if (addLiquidityTxs.length > 0) {
        const firstTx = new Transaction();
        if (setupInstructions.length > 0) firstTx.add(...setupInstructions);
        firstTx.add(...addLiquidityTxs[0].instructions);
        redepositTxs.push(firstTx);

        for (let i = 1; i < addLiquidityTxs.length; i++) {
          const chunkTx = new Transaction();
          chunkTx.add(...addLiquidityTxs[i].instructions);
          redepositTxs.push(chunkTx);
        }
      }
    }

    // Build transfer transaction
    const transferTx = new Transaction();
    transferTx.add(createAssociatedTokenAccountIdempotentInstruction(lpOwner.publicKey, managerTokenXAta, managerWallet, tokenXMint, tokenXProgram, ASSOCIATED_TOKEN_PROGRAM_ID));

    if (!isTokenYNativeSOL) {
      transferTx.add(createAssociatedTokenAccountIdempotentInstruction(lpOwner.publicKey, managerTokenYAta, managerWallet, tokenYMint, tokenYProgram, ASSOCIATED_TOKEN_PROGRAM_ID));
    }

    if (!transferTokenXAmount.isZero()) {
      if (isTokenXNativeSOL) {
        transferTx.add(SystemProgram.transfer({ fromPubkey: lpOwner.publicKey, toPubkey: managerWallet, lamports: Number(transferTokenXAmount.toString()) }));
      } else {
        transferTx.add(createTransferInstruction(lpOwnerTokenXAta, managerTokenXAta, lpOwner.publicKey, BigInt(transferTokenXAmount.toString()), [], tokenXProgram));
      }
    }

    if (!transferTokenYAmount.isZero()) {
      if (isTokenYNativeSOL) {
        transferTx.add(SystemProgram.transfer({ fromPubkey: lpOwner.publicKey, toPubkey: managerWallet, lamports: Number(transferTokenYAmount.toString()) }));
      } else {
        transferTx.add(createTransferInstruction(lpOwnerTokenYAta, managerTokenYAta, lpOwner.publicKey, BigInt(transferTokenYAmount.toString()), [], tokenYProgram));
      }
    }

    // Prepare all transactions
    const { blockhash } = await connection.getLatestBlockhash();
    const allTransactions: Transaction[] = [];

    for (const tx of removeLiquidityTxs) {
      const removeTx = new Transaction();
      removeTx.add(...tx.instructions);
      removeTx.recentBlockhash = blockhash;
      removeTx.feePayer = managerWallet;
      allTransactions.push(removeTx);
    }

    for (const tx of redepositTxs) {
      tx.recentBlockhash = blockhash;
      tx.feePayer = managerWallet;
      allTransactions.push(tx);
    }

    transferTx.recentBlockhash = blockhash;
    transferTx.feePayer = managerWallet;
    allTransactions.push(transferTx);

    console.log(`  Number of transactions: ${allTransactions.length}`);

    const unsignedTransactions = allTransactions.map(tx => bs58.encode(tx.serialize({ requireAllSignatures: false })));
    const unsignedTransactionHashes = allTransactions.map(tx => crypto.createHash('sha256').update(tx.serializeMessage()).digest('hex'));
    const requestId = withdrawRequests.generateRequestId();

    console.log('✓ Withdrawal transactions built successfully');
    console.log(`  Request ID: ${requestId}`);

    withdrawRequests.set(requestId, {
      unsignedTransactions,
      unsignedTransactionHashes,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: managerWallet.toBase58(),
      destinationAddress: managerWallet.toBase58(),
      withdrawnTokenXAmount: estimatedTokenXAmount.toString(),
      withdrawnTokenYAmount: estimatedTokenYAmount.toString(),
      transferTokenXAmount: transferTokenXAmount.toString(),
      transferTokenYAmount: transferTokenYAmount.toString(),
      redepositTokenXAmount: redepositTokenXAmount.toString(),
      redepositTokenYAmount: redepositTokenYAmount.toString(),
      marketPrice,
      positionAddress: position.publicKey.toBase58(),
      fromBinId: positionData.lowerBinId,
      toBinId: positionData.upperBinId,
      withdrawalPercentage,
      adminWallet,
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
      marketPrice,
      withdrawn: { tokenX: estimatedTokenXAmount.toString(), tokenY: estimatedTokenYAmount.toString() },
      transferred: { tokenX: transferTokenXAmount.toString(), tokenY: transferTokenYAmount.toString() },
      redeposited: { tokenX: redepositTokenXAmount.toString(), tokenY: redepositTokenYAmount.toString() },
      message: 'Sign all transactions with the manager wallet and submit to /dlmm/withdraw/confirm'
    });

  } catch (error) {
    console.error('Error building DLMM withdrawal transaction:', error);
    return res.status(500).json({ error: 'Failed to build withdrawal transaction', details: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /withdraw/confirm - Confirm and submit withdrawal transactions
 */
router.post('/confirm', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransactions, requestId } = req.body;

    console.log('DLMM withdraw confirm request received:', { requestId });

    if (!signedTransactions || !Array.isArray(signedTransactions) || signedTransactions.length === 0 || !requestId) {
      return res.status(400).json({ error: 'Missing required fields: signedTransactions (array) and requestId' });
    }

    const requestData = withdrawRequests.get(requestId);
    if (!requestData) {
      return res.status(400).json({ error: 'Withdrawal request not found or expired. Please call /dlmm/withdraw/build first.' });
    }

    if (signedTransactions.length !== requestData.unsignedTransactions.length) {
      return res.status(400).json({ error: `Expected ${requestData.unsignedTransactions.length} transactions, got ${signedTransactions.length}` });
    }

    console.log('  Pool:', requestData.poolAddress);
    console.log('  Transaction count:', signedTransactions.length);

    releaseLock = await acquireLiquidityLock(requestData.poolAddress);
    console.log('  Lock acquired');

    if (withdrawRequests.isExpired(requestId, REQUEST_EXPIRY.CONFIRM)) {
      withdrawRequests.delete(requestId);
      return res.status(400).json({ error: 'Withdrawal request expired. Please create a new request.' });
    }

    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) {
      return res.status(500).json({ error: 'Server configuration incomplete. Missing RPC_URL.' });
    }

    let poolConfig;
    try {
      poolConfig = await getPoolConfig(requestData.poolAddress, 'dlmm', requestData.adminWallet);
    } catch (error) {
      return res.status(403).json({ error: 'Pool not authorized for liquidity operations', details: error instanceof Error ? error.message : String(error) });
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwnerKeypair = poolConfig.lpOwnerKeypair;
    const managerWalletPubKey = new PublicKey(poolConfig.managerWallet);

    const verifyResult = await verifySignedTransactionBatch(
      connection,
      signedTransactions,
      requestData.unsignedTransactionHashes,
      managerWalletPubKey
    );

    if (!verifyResult.success) {
      return res.status(400).json({ error: verifyResult.error, details: verifyResult.details });
    }

    const transactions = verifyResult.transactions;

    // Send all transactions sequentially
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

    console.log('✓ DLMM withdrawal transactions completed');
    console.log(`  Signatures: ${signatures.join(', ')}`);

    withdrawRequests.delete(requestId);

    res.json({
      success: true,
      signatures,
      poolAddress: requestData.poolAddress,
      tokenXMint: requestData.tokenXMint,
      tokenYMint: requestData.tokenYMint,
      withdrawalPercentage: requestData.withdrawalPercentage,
      marketPrice: requestData.marketPrice,
      withdrawn: { tokenX: requestData.withdrawnTokenXAmount, tokenY: requestData.withdrawnTokenYAmount },
      transferred: { tokenX: requestData.transferTokenXAmount, tokenY: requestData.transferTokenYAmount },
      redeposited: { tokenX: requestData.redepositTokenXAmount, tokenY: requestData.redepositTokenYAmount },
      message: 'Withdrawal transactions submitted successfully'
    });

  } catch (error) {
    console.error('DLMM withdraw confirm error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to confirm withdrawal' });
  } finally {
    if (releaseLock) releaseLock();
  }
});

export default router;
