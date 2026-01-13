/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * DLMM cleanup swap route handlers
 */

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { Connection, Transaction, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getMint, NATIVE_MINT, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import BN from 'bn.js';
import DLMM from '@meteora-ag/dlmm';
import rateLimit from 'express-rate-limit';

import {
  getPoolConfig,
  acquireLiquidityLock,
  verifySignedTransaction,
  isRestrictedLpOwner,
  getJupiterSwapTransaction,
  REQUEST_EXPIRY,
  getTokenProgramsForMints,
} from '../shared';
import { cleanupSwapRequests } from './storage';

const router = Router();

const dlmmLiquidityLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many liquidity requests, please wait a moment.'
});

/**
 * POST /cleanup/swap/build - Build swap transaction for leftover tokens
 */
router.post('/build', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { poolAddress: poolAddressInput, adminWallet } = req.body;

    console.log('DLMM cleanup swap build request received:', { poolAddress: poolAddressInput, adminWallet });

    if (!poolAddressInput) {
      return res.status(400).json({ error: 'Missing required field: poolAddress' });
    }

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
    } catch {
      return res.status(403).json({ error: 'Pool not authorized for liquidity operations' });
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = poolConfig.lpOwnerKeypair;
    const manager = new PublicKey(poolConfig.managerWallet);

    if (isRestrictedLpOwner(lpOwner.publicKey.toBase58())) {
      return res.status(403).json({ error: 'Cleanup swap operations are not permitted for this LP owner address' });
    }

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
    const isTokenYNativeSOL = tokenYMint.equals(NATIVE_MINT);

    const lpOwnerTokenXAta = await getAssociatedTokenAddress(tokenXMint, lpOwner.publicKey, false, tokenXProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
    const lpOwnerTokenYAta = isTokenYNativeSOL ? lpOwner.publicKey : await getAssociatedTokenAddress(tokenYMint, lpOwner.publicKey, false, tokenYProgram, ASSOCIATED_TOKEN_PROGRAM_ID);

    let tokenXBalance = new BN(0);
    let tokenYBalance = new BN(0);

    try {
      const tokenXAccount = await connection.getTokenAccountBalance(lpOwnerTokenXAta);
      tokenXBalance = new BN(tokenXAccount.value.amount);
    } catch { /* Account doesn't exist */ }

    try {
      if (isTokenYNativeSOL) {
        const solBalance = await connection.getBalance(lpOwner.publicKey);
        const reserveForFees = 333_000_000;
        tokenYBalance = new BN(Math.max(0, solBalance - reserveForFees));
      } else {
        const tokenYAccount = await connection.getTokenAccountBalance(lpOwnerTokenYAta);
        tokenYBalance = new BN(tokenYAccount.value.amount);
      }
    } catch { /* Account doesn't exist */ }

    console.log(`  LP Owner X Balance: ${tokenXBalance.toString()}`);
    console.log(`  LP Owner Y Balance: ${tokenYBalance.toString()}`);

    if (tokenXBalance.isZero() && tokenYBalance.isZero()) {
      return res.status(400).json({ error: 'No leftover tokens to clean up', balances: { tokenX: '0', tokenY: '0' } });
    }

    // Get active bin price
    const activeBin = await dlmmPool.getActiveBin();
    const activeBinPrice = Number(activeBin.price);
    console.log(`  Active bin price: ${activeBinPrice} Y per X`);

    // Determine swap direction
    // Convert raw price (raw_Y per raw_X) to decimal price (decimal_Y per decimal_X)
    const decimalPrice = activeBinPrice * Math.pow(10, tokenXMintInfo.decimals - tokenYMintInfo.decimals);
    const tokenXDecimal = Number(tokenXBalance.toString()) / Math.pow(10, tokenXMintInfo.decimals);
    const tokenYDecimal = Number(tokenYBalance.toString()) / Math.pow(10, tokenYMintInfo.decimals);
    const neededYForAllX = tokenXDecimal * decimalPrice;
    const neededXForAllY = tokenYDecimal / decimalPrice;

    let swapInputMint: PublicKey;
    let swapOutputMint: PublicKey;
    let swapInputAmount: BN;
    let swapDirection: 'XtoY' | 'YtoX';

    if (neededYForAllX > tokenYDecimal) {
      const excessXDecimal = tokenXDecimal - neededXForAllY;
      const swapXDecimal = excessXDecimal / 2;
      swapInputAmount = new BN(Math.floor(swapXDecimal * Math.pow(10, tokenXMintInfo.decimals)));
      swapInputMint = tokenXMint;
      swapOutputMint = tokenYMint;
      swapDirection = 'XtoY';
      console.log(`  Swap direction: X → Y (swapping ${swapXDecimal} X)`);
    } else {
      const excessYDecimal = tokenYDecimal - neededYForAllX;
      const swapYDecimal = excessYDecimal / 2;
      swapInputAmount = new BN(Math.floor(swapYDecimal * Math.pow(10, tokenYMintInfo.decimals)));
      swapInputMint = tokenYMint;
      swapOutputMint = tokenXMint;
      swapDirection = 'YtoX';
      console.log(`  Swap direction: Y → X (swapping ${swapYDecimal} Y)`);
    }

    if (swapInputAmount.isZero()) {
      return res.status(400).json({
        error: 'Leftover amounts are too small to warrant cleanup',
        balances: { tokenX: tokenXBalance.toString(), tokenY: tokenYBalance.toString() }
      });
    }

    // Try Jupiter swap, fallback to DLMM swap
    let swapTransaction: Transaction;
    let expectedOutputAmount: string;
    let swapSource: 'jupiter' | 'dlmm';

    try {
      const jupResult = await getJupiterSwapTransaction(
        swapInputMint.toBase58(),
        swapOutputMint.toBase58(),
        swapInputAmount.toString(),
        lpOwner.publicKey,
        500
      );
      swapTransaction = jupResult.transaction;
      expectedOutputAmount = jupResult.expectedOutput;
      swapSource = 'jupiter';

      const { blockhash } = await connection.getLatestBlockhash();
      swapTransaction.recentBlockhash = blockhash;
      swapTransaction.feePayer = manager;

    } catch (jupiterError: any) {
      console.log(`  Jupiter failed: ${jupiterError.message}`);
      console.log('  Falling back to direct DLMM swap...');

      try {
        const binArrays = await dlmmPool.getBinArrayForSwap(swapDirection === 'XtoY');
        const swapQuote = dlmmPool.swapQuote(swapInputAmount, swapDirection === 'XtoY', new BN(500), binArrays);

        expectedOutputAmount = swapQuote.outAmount.toString();
        console.log(`  DLMM quote: ${swapInputAmount.toString()} → ${expectedOutputAmount}`);

        swapTransaction = await dlmmPool.swap({
          inToken: swapInputMint,
          outToken: swapOutputMint,
          inAmount: swapInputAmount,
          minOutAmount: swapQuote.minOutAmount,
          lbPair: poolAddress,
          user: lpOwner.publicKey,
          binArraysPubkey: swapQuote.binArraysPubkey,
        });

        const { blockhash } = await connection.getLatestBlockhash();
        swapTransaction.recentBlockhash = blockhash;
        swapTransaction.feePayer = manager;
        swapSource = 'dlmm';
        console.log('  ✓ DLMM swap transaction built successfully');

      } catch (dlmmError: any) {
        return res.status(500).json({
          error: 'Both Jupiter and DLMM swap failed',
          jupiterError: jupiterError.message,
          dlmmError: dlmmError.message
        });
      }
    }

    const unsignedSwapTx = bs58.encode(swapTransaction.serialize({ requireAllSignatures: false }));
    const swapTxHash = crypto.createHash('sha256').update(swapTransaction.serializeMessage()).digest('hex');
    const requestId = cleanupSwapRequests.generateRequestId();

    console.log(`✓ DLMM cleanup swap transaction built (via ${swapSource.toUpperCase()})`);
    console.log(`  Request ID: ${requestId}`);

    cleanupSwapRequests.set(requestId, {
      unsignedTransaction: unsignedSwapTx,
      unsignedTransactionHash: swapTxHash,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      tokenXDecimals: tokenXMintInfo.decimals,
      tokenYDecimals: tokenYMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: manager.toBase58(),
      activeBinPrice,
      swapInputMint: swapInputMint.toBase58(),
      swapInputAmount: swapInputAmount.toString(),
      swapOutputMint: swapOutputMint.toBase58(),
      swapExpectedOutputAmount: expectedOutputAmount,
      swapDirection,
      adminWallet,
    });

    return res.json({
      success: true,
      transaction: unsignedSwapTx,
      requestId,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      tokenXDecimals: tokenXMintInfo.decimals,
      tokenYDecimals: tokenYMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: manager.toBase58(),
      activeBinPrice,
      balances: { tokenX: tokenXBalance.toString(), tokenY: tokenYBalance.toString() },
      swap: {
        inputMint: swapInputMint.toBase58(),
        inputAmount: swapInputAmount.toString(),
        outputMint: swapOutputMint.toBase58(),
        expectedOutputAmount,
        direction: swapDirection
      },
      message: 'Sign this transaction with the manager wallet and submit to /dlmm/cleanup/swap/confirm.'
    });

  } catch (error) {
    console.error('Error building DLMM cleanup swap transaction:', error);
    return res.status(500).json({
      error: 'Failed to build cleanup swap transaction',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /cleanup/swap/confirm - Confirm and submit swap transaction
 */
router.post('/confirm', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransaction, requestId } = req.body;

    console.log('DLMM cleanup swap confirm request received:', { requestId });

    if (!signedTransaction || !requestId) {
      return res.status(400).json({ error: 'Missing required fields: signedTransaction and requestId' });
    }

    const requestData = cleanupSwapRequests.get(requestId);
    if (!requestData) {
      return res.status(400).json({ error: 'Cleanup swap request not found or expired. Please call /dlmm/cleanup/swap/build first.' });
    }

    console.log('  Pool:', requestData.poolAddress);

    releaseLock = await acquireLiquidityLock(requestData.poolAddress);
    console.log('  Lock acquired');

    if (cleanupSwapRequests.isExpired(requestId, REQUEST_EXPIRY.CONFIRM)) {
      cleanupSwapRequests.delete(requestId);
      return res.status(400).json({ error: 'Cleanup swap request expired. Please create a new request.' });
    }

    const RPC_URL = process.env.RPC_URL;

    let poolConfig;
    try {
      poolConfig = await getPoolConfig(requestData.poolAddress, 'dlmm', requestData.adminWallet);
    } catch {
      return res.status(403).json({ error: 'Pool not authorized for liquidity operations' });
    }

    const connection = new Connection(RPC_URL!, 'confirmed');
    const lpOwnerKeypair = poolConfig.lpOwnerKeypair;
    const managerWalletPubKey = new PublicKey(poolConfig.managerWallet);

    const verifyResult = await verifySignedTransaction(
      connection,
      signedTransaction,
      requestData.unsignedTransactionHash,
      managerWalletPubKey
    );

    if (!verifyResult.success) {
      return res.status(400).json({ error: verifyResult.error, details: verifyResult.details });
    }

    const transaction = verifyResult.transaction;
    transaction.partialSign(lpOwnerKeypair);

    console.log('  Sending swap transaction...');
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });

    console.log(`  ✓ Swap transaction sent: ${signature}`);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    try {
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
      console.log(`  ✓ Swap confirmed: ${signature}`);
    } catch (error) {
      console.error(`  ⚠ Swap confirmation timeout for ${signature}:`, error);
    }

    cleanupSwapRequests.delete(requestId);

    res.json({
      success: true,
      signature,
      poolAddress: requestData.poolAddress,
      tokenXMint: requestData.tokenXMint,
      tokenYMint: requestData.tokenYMint,
      swap: {
        inputMint: requestData.swapInputMint,
        inputAmount: requestData.swapInputAmount,
        outputMint: requestData.swapOutputMint,
        expectedOutputAmount: requestData.swapExpectedOutputAmount,
        direction: requestData.swapDirection
      },
      message: 'Swap transaction submitted successfully. Call /dlmm/deposit/build with tokenXAmount=0 and tokenYAmount=0 to deposit LP owner wallet balances.'
    });

  } catch (error) {
    console.error('DLMM cleanup swap confirm error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to confirm cleanup swap' });
  } finally {
    if (releaseLock) releaseLock();
  }
});

export default router;
