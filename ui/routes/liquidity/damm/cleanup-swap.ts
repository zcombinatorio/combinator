/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * DAMM cleanup swap route handlers
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { Connection, Transaction, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getMint, NATIVE_MINT } from '@solana/spl-token';
import bs58 from 'bs58';
import BN from 'bn.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import rateLimit from 'express-rate-limit';

import {
  getPoolConfig,
  acquireLiquidityLock,
  verifySignedTransaction,
  isRestrictedLpOwner,
  getJupiterSwapTransaction,
  REQUEST_EXPIRY,
  getTokenProgramsForMints,
  AdminKeyError,
} from '../shared';
import { cleanupSwapRequests } from './storage';

const router = Router();

const dammLiquidityLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many liquidity requests, please wait a moment.'
});

/**
 * POST /cleanup/swap/build - Build swap transaction for leftover tokens
 */
router.post('/build', dammLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { poolAddress: poolAddressInput, adminWallet } = req.body;

    console.log('DAMM cleanup swap build request received:', { poolAddress: poolAddressInput, adminWallet });

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
      poolConfig = await getPoolConfig(poolAddress.toBase58(), 'damm', adminWallet);
    } catch (error) {
      if (error instanceof AdminKeyError) {
        console.error('Admin key error details:', error.internalDetails);
        return res.status(503).json({ error: error.clientMessage });
      }
      return res.status(403).json({ error: 'Pool not authorized for liquidity operations' });
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = poolConfig.lpOwnerKeypair;
    const manager = new PublicKey(poolConfig.managerWallet);

    if (isRestrictedLpOwner(lpOwner.publicKey.toBase58())) {
      return res.status(403).json({ error: 'Cleanup swap operations are not permitted for this LP owner address' });
    }

    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);

    const tokenAMint = poolState.tokenAMint;
    const tokenBMint = poolState.tokenBMint;

    // Detect token programs (Token-2022 vs SPL Token) before calling getMint
    const tokenPrograms = await getTokenProgramsForMints(connection, [tokenAMint, tokenBMint]);
    const tokenAProgram = tokenPrograms.get(tokenAMint.toBase58())!;
    const tokenBProgram = tokenPrograms.get(tokenBMint.toBase58())!;

    const tokenAMintInfo = await getMint(connection, tokenAMint, undefined, tokenAProgram);
    const tokenBMintInfo = await getMint(connection, tokenBMint, undefined, tokenBProgram);
    const isTokenBNativeSOL = tokenBMint.equals(NATIVE_MINT);

    // Get LP owner token balances
    const lpOwnerTokenAAta = await getAssociatedTokenAddress(tokenAMint, lpOwner.publicKey, false, tokenAProgram);
    const lpOwnerTokenBAta = isTokenBNativeSOL ? lpOwner.publicKey : await getAssociatedTokenAddress(tokenBMint, lpOwner.publicKey, false, tokenBProgram);

    let tokenABalance = new BN(0);
    let tokenBBalance = new BN(0);

    try {
      const tokenAAccount = await connection.getTokenAccountBalance(lpOwnerTokenAAta);
      tokenABalance = new BN(tokenAAccount.value.amount);
    } catch { /* Account doesn't exist */ }

    try {
      if (isTokenBNativeSOL) {
        const solBalance = await connection.getBalance(lpOwner.publicKey);
        const reserveForFees = 333_000_000;
        tokenBBalance = new BN(Math.max(0, solBalance - reserveForFees));
      } else {
        const tokenBAccount = await connection.getTokenAccountBalance(lpOwnerTokenBAta);
        tokenBBalance = new BN(tokenBAccount.value.amount);
      }
    } catch { /* Account doesn't exist */ }

    console.log(`  LP Owner A Balance: ${tokenABalance.toString()}`);
    console.log(`  LP Owner B Balance: ${tokenBBalance.toString()}`);

    if (tokenABalance.isZero() && tokenBBalance.isZero()) {
      return res.status(400).json({ error: 'No leftover tokens to clean up', balances: { tokenA: '0', tokenB: '0' } });
    }

    // Calculate pool price
    const sqrtPriceNum = Number(poolState.sqrtPrice.toString());
    const Q64 = Math.pow(2, 64);
    const poolPrice = Math.pow(sqrtPriceNum / Q64, 2);
    console.log(`  Pool Price: ${poolPrice} (B per A)`);

    // Determine swap direction
    // Convert raw price (raw_B per raw_A) to decimal price (decimal_B per decimal_A)
    const decimalPrice = poolPrice * Math.pow(10, tokenAMintInfo.decimals - tokenBMintInfo.decimals);
    const tokenADecimal = Number(tokenABalance.toString()) / Math.pow(10, tokenAMintInfo.decimals);
    const tokenBDecimal = Number(tokenBBalance.toString()) / Math.pow(10, tokenBMintInfo.decimals);
    const neededBForAllA = tokenADecimal * decimalPrice;
    const neededAForAllB = tokenBDecimal / decimalPrice;

    let swapInputMint: PublicKey;
    let swapOutputMint: PublicKey;
    let swapInputAmount: BN;
    let swapDirection: 'AtoB' | 'BtoA';

    if (neededBForAllA > tokenBDecimal) {
      const excessADecimal = tokenADecimal - neededAForAllB;
      const swapADecimal = excessADecimal / 2;
      swapInputAmount = new BN(Math.floor(swapADecimal * Math.pow(10, tokenAMintInfo.decimals)));
      swapInputMint = tokenAMint;
      swapOutputMint = tokenBMint;
      swapDirection = 'AtoB';
      console.log(`  Swap direction: A → B (swapping ${swapADecimal} A)`);
    } else {
      const excessBDecimal = tokenBDecimal - neededBForAllA;
      const swapBDecimal = excessBDecimal / 2;
      swapInputAmount = new BN(Math.floor(swapBDecimal * Math.pow(10, tokenBMintInfo.decimals)));
      swapInputMint = tokenBMint;
      swapOutputMint = tokenAMint;
      swapDirection = 'BtoA';
      console.log(`  Swap direction: B → A (swapping ${swapBDecimal} B)`);
    }

    if (swapInputAmount.isZero()) {
      return res.status(400).json({
        error: 'Leftover amounts are too small to warrant cleanup',
        balances: { tokenA: tokenABalance.toString(), tokenB: tokenBBalance.toString() }
      });
    }

    // Try Jupiter swap, fallback to DAMM swap
    let swapTransaction: Transaction;
    let expectedOutputAmount: string;
    let swapSource: 'jupiter' | 'damm';

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
      console.log('  Falling back to direct DAMM swap...');

      try {
        const slot = await connection.getSlot();
        const blockTime = await connection.getBlockTime(slot);
        const currentTime = blockTime || Math.floor(Date.now() / 1000);

        const swapQuote = cpAmm.getQuote({
          inAmount: swapInputAmount,
          inputTokenMint: swapInputMint,
          slippage: 5,
          poolState,
          currentTime,
          currentSlot: slot,
          tokenADecimal: tokenAMintInfo.decimals,
          tokenBDecimal: tokenBMintInfo.decimals,
        });

        expectedOutputAmount = swapQuote.swapOutAmount.toString();
        console.log(`  DAMM quote: ${swapInputAmount.toString()} → ${expectedOutputAmount}`);

        swapTransaction = await cpAmm.swap({
          payer: lpOwner.publicKey,
          pool: poolAddress,
          inputTokenMint: swapInputMint,
          outputTokenMint: swapOutputMint,
          amountIn: swapInputAmount,
          minimumAmountOut: swapQuote.minSwapOutAmount,
          tokenAMint,
          tokenBMint,
          tokenAVault: poolState.tokenAVault,
          tokenBVault: poolState.tokenBVault,
          tokenAProgram,
          tokenBProgram,
          referralTokenAccount: null,
        });

        const { blockhash } = await connection.getLatestBlockhash();
        swapTransaction.recentBlockhash = blockhash;
        swapTransaction.feePayer = manager;
        swapSource = 'damm';
        console.log('  ✓ DAMM swap transaction built successfully');

      } catch (dammError: any) {
        return res.status(500).json({
          error: 'Both Jupiter and DAMM swap failed',
          jupiterError: jupiterError.message,
          dammError: dammError.message
        });
      }
    }

    const unsignedSwapTx = bs58.encode(swapTransaction.serialize({ requireAllSignatures: false }));
    const swapTxHash = crypto.createHash('sha256').update(swapTransaction.serializeMessage()).digest('hex');
    const requestId = cleanupSwapRequests.generateRequestId();

    console.log(`✓ DAMM cleanup swap transaction built (via ${swapSource.toUpperCase()})`);
    console.log(`  Request ID: ${requestId}`);

    cleanupSwapRequests.set(requestId, {
      unsignedTransaction: unsignedSwapTx,
      unsignedTransactionHash: swapTxHash,
      poolAddress: poolAddress.toBase58(),
      tokenAMint: tokenAMint.toBase58(),
      tokenBMint: tokenBMint.toBase58(),
      tokenADecimals: tokenAMintInfo.decimals,
      tokenBDecimals: tokenBMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: manager.toBase58(),
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
      tokenAMint: tokenAMint.toBase58(),
      tokenBMint: tokenBMint.toBase58(),
      tokenADecimals: tokenAMintInfo.decimals,
      tokenBDecimals: tokenBMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: manager.toBase58(),
      poolPrice,
      balances: { tokenA: tokenABalance.toString(), tokenB: tokenBBalance.toString() },
      swap: {
        inputMint: swapInputMint.toBase58(),
        inputAmount: swapInputAmount.toString(),
        outputMint: swapOutputMint.toBase58(),
        expectedOutputAmount,
        direction: swapDirection
      },
      message: 'Sign this transaction with the manager wallet and submit to /damm/cleanup/swap/confirm.'
    });

  } catch (error) {
    console.error('Error building DAMM cleanup swap transaction:', error);
    if (error instanceof AdminKeyError) {
      console.error('Admin key error details:', error.internalDetails);
      return res.status(503).json({ error: error.clientMessage });
    }
    return res.status(500).json({
      error: 'Failed to build cleanup swap transaction',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /cleanup/swap/confirm - Confirm and submit swap transaction
 */
router.post('/confirm', dammLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransaction, requestId } = req.body;

    console.log('DAMM cleanup swap confirm request received:', { requestId });

    if (!signedTransaction || !requestId) {
      return res.status(400).json({ error: 'Missing required fields: signedTransaction and requestId' });
    }

    const requestData = cleanupSwapRequests.get(requestId);
    if (!requestData) {
      return res.status(400).json({ error: 'Cleanup swap request not found or expired. Please call /damm/cleanup/swap/build first.' });
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
      poolConfig = await getPoolConfig(requestData.poolAddress, 'damm', requestData.adminWallet);
    } catch (error) {
      if (error instanceof AdminKeyError) {
        console.error('Admin key error details:', error.internalDetails);
        return res.status(503).json({ error: error.clientMessage });
      }
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
      tokenAMint: requestData.tokenAMint,
      tokenBMint: requestData.tokenBMint,
      swap: {
        inputMint: requestData.swapInputMint,
        inputAmount: requestData.swapInputAmount,
        outputMint: requestData.swapOutputMint,
        expectedOutputAmount: requestData.swapExpectedOutputAmount,
        direction: requestData.swapDirection
      },
      message: 'Swap transaction submitted successfully. Call /damm/deposit/build with tokenAAmount=0 and tokenBAmount=0 to deposit LP owner wallet balances.'
    });

  } catch (error) {
    console.error('DAMM cleanup swap confirm error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to confirm cleanup swap' });
  } finally {
    if (releaseLock) releaseLock();
  }
});

export default router;
