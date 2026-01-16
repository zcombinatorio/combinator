/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * DAMM withdrawal route handlers
 */

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { Connection, Transaction, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getMint,
  createAssociatedTokenAccountIdempotentInstruction,
  NATIVE_MINT
} from '@solana/spl-token';
import bs58 from 'bs58';
import BN from 'bn.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import rateLimit from 'express-rate-limit';

import {
  getPoolConfig,
  acquireLiquidityLock,
  verifySignedTransaction,
  REQUEST_EXPIRY,
  getTokenProgramsForMints,
} from '../shared';
import { withdrawRequests } from './storage';

const router = Router();

// Rate limiter for DAMM liquidity endpoints
const dammLiquidityLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many liquidity requests, please wait a moment.'
});

/**
 * POST /withdraw/build - Build withdrawal transaction
 */
router.post('/build', dammLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { withdrawalPercentage, poolAddress: poolAddressInput, adminWallet } = req.body;

    console.log('DAMM withdraw build request received:', { withdrawalPercentage, poolAddress: poolAddressInput, adminWallet });

    // Validate required fields
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

    // Get pool config
    let poolConfig;
    try {
      poolConfig = await getPoolConfig(poolAddress.toBase58(), 'damm', adminWallet);
    } catch {
      return res.status(403).json({ error: 'Pool not authorized for liquidity operations' });
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = poolConfig.lpOwnerKeypair;
    const managerWallet = new PublicKey(poolConfig.managerWallet);
    const isSameWallet = lpOwner.publicKey.equals(managerWallet);

    // Create CpAmm instance and get pool state
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);

    // Get user positions
    const userPositions = await cpAmm.getUserPositionByPool(poolAddress, lpOwner.publicKey);
    if (userPositions.length === 0) {
      return res.status(404).json({ error: 'No positions found for the LP owner in this pool' });
    }

    const { position, positionNftAccount, positionState } = userPositions[0];
    if (positionState.unlockedLiquidity.isZero()) {
      return res.status(400).json({ error: 'No unlocked liquidity in position' });
    }

    // Calculate withdrawal amount
    const liquidityDelta = positionState.unlockedLiquidity
      .muln(withdrawalPercentage * 1000)
      .divn(100000);

    if (liquidityDelta.isZero()) {
      return res.status(400).json({ error: 'Withdrawal amount too small' });
    }

    // Get token info - detect token programs first (Token-2022 vs SPL Token)
    const tokenPrograms = await getTokenProgramsForMints(connection, [poolState.tokenAMint, poolState.tokenBMint]);
    const tokenAProgram = tokenPrograms.get(poolState.tokenAMint.toBase58())!;
    const tokenBProgram = tokenPrograms.get(poolState.tokenBMint.toBase58())!;

    const tokenAMint = await getMint(connection, poolState.tokenAMint, undefined, tokenAProgram);
    const tokenBMint = await getMint(connection, poolState.tokenBMint, undefined, tokenBProgram);

    // Calculate withdrawal quote
    const withdrawQuote = cpAmm.getWithdrawQuote({
      liquidityDelta,
      minSqrtPrice: poolState.sqrtMinPrice,
      maxSqrtPrice: poolState.sqrtMaxPrice,
      sqrtPrice: poolState.sqrtPrice,
      tokenATokenInfo: { mint: tokenAMint, currentEpoch: await connection.getEpochInfo().then(e => e.epoch) },
      tokenBTokenInfo: { mint: tokenBMint, currentEpoch: await connection.getEpochInfo().then(e => e.epoch) }
    });

    const isTokenBNativeSOL = poolState.tokenBMint.equals(NATIVE_MINT);

    // Build combined transaction
    const combinedTx = new Transaction();
    combinedTx.feePayer = managerWallet;
    const { blockhash } = await connection.getLatestBlockhash();
    combinedTx.recentBlockhash = blockhash;

    // Get token accounts
    const tokenAAta = await getAssociatedTokenAddress(poolState.tokenAMint, lpOwner.publicKey, false, tokenAProgram);
    const tokenBAta = isTokenBNativeSOL ? lpOwner.publicKey : await getAssociatedTokenAddress(poolState.tokenBMint, lpOwner.publicKey, false, tokenBProgram);
    const destTokenAAta = await getAssociatedTokenAddress(poolState.tokenAMint, managerWallet, false, tokenAProgram);
    const destTokenBAta = isTokenBNativeSOL ? managerWallet : await getAssociatedTokenAddress(poolState.tokenBMint, managerWallet, false, tokenBProgram);

    // Create LP owner's ATAs
    combinedTx.add(
      createAssociatedTokenAccountIdempotentInstruction(managerWallet, tokenAAta, lpOwner.publicKey, poolState.tokenAMint, tokenAProgram)
    );
    if (!isTokenBNativeSOL) {
      combinedTx.add(
        createAssociatedTokenAccountIdempotentInstruction(managerWallet, tokenBAta, lpOwner.publicKey, poolState.tokenBMint, tokenBProgram)
      );
    }

    // Add remove liquidity instructions
    const vestingsRaw = await cpAmm.getAllVestingsByPosition(position);
    const vestings = vestingsRaw.map(v => ({ account: v.publicKey, vestingState: v.account }));

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

    // Create destination ATAs and transfer instructions (skip if LP owner is manager)
    if (!isSameWallet) {
      if (!withdrawQuote.outAmountA.isZero()) {
        combinedTx.add(
          createAssociatedTokenAccountIdempotentInstruction(managerWallet, destTokenAAta, managerWallet, poolState.tokenAMint, tokenAProgram)
        );
      }
      if (!withdrawQuote.outAmountB.isZero() && !isTokenBNativeSOL) {
        combinedTx.add(
          createAssociatedTokenAccountIdempotentInstruction(managerWallet, destTokenBAta, managerWallet, poolState.tokenBMint, tokenBProgram)
        );
      }

      // Add transfer instructions
      if (!withdrawQuote.outAmountA.isZero()) {
        combinedTx.add(
          createTransferInstruction(tokenAAta, destTokenAAta, lpOwner.publicKey, BigInt(withdrawQuote.outAmountA.toString()), [], tokenAProgram)
        );
      }
      if (!withdrawQuote.outAmountB.isZero()) {
        if (isTokenBNativeSOL) {
          combinedTx.add(
            SystemProgram.transfer({ fromPubkey: lpOwner.publicKey, toPubkey: managerWallet, lamports: Number(withdrawQuote.outAmountB.toString()) })
          );
        } else {
          combinedTx.add(
            createTransferInstruction(tokenBAta, destTokenBAta, lpOwner.publicKey, BigInt(withdrawQuote.outAmountB.toString()), [], tokenBProgram)
          );
        }
      }
    }

    // Serialize unsigned transaction
    const unsignedTransaction = bs58.encode(combinedTx.serialize({ requireAllSignatures: false }));
    const unsignedTransactionHash = crypto.createHash('sha256').update(combinedTx.serializeMessage()).digest('hex');
    const requestId = withdrawRequests.generateRequestId();

    console.log('✓ Withdrawal transaction built successfully');
    console.log(`  Pool: ${poolAddress.toBase58()}`);
    console.log(`  Withdrawal: ${withdrawalPercentage}%`);
    console.log(`  Request ID: ${requestId}`);

    // Store transaction data
    withdrawRequests.set(requestId, {
      unsignedTransaction,
      unsignedTransactionHash,
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
      adminWallet,
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
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create withdrawal transaction' });
  }
});

/**
 * POST /withdraw/confirm - Confirm and submit withdrawal transaction
 */
router.post('/confirm', dammLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransaction, requestId } = req.body;

    console.log('DAMM withdraw confirm request received:', { requestId });

    if (!signedTransaction || !requestId) {
      return res.status(400).json({ error: 'Missing required fields: signedTransaction and requestId' });
    }

    const withdrawData = withdrawRequests.get(requestId);
    if (!withdrawData) {
      return res.status(400).json({ error: 'Withdrawal request not found or expired. Please call /damm/withdraw/build first.' });
    }

    console.log('  Pool:', withdrawData.poolAddress);

    // Acquire lock
    releaseLock = await acquireLiquidityLock(withdrawData.poolAddress);
    console.log('  Lock acquired');

    // Check request age
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
      poolConfig = await getPoolConfig(withdrawData.poolAddress, 'damm', withdrawData.adminWallet);
    } catch {
      return res.status(403).json({ error: 'Pool not authorized for liquidity operations' });
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwnerKeypair = poolConfig.lpOwnerKeypair;
    const managerWalletPubKey = new PublicKey(poolConfig.managerWallet);

    // Verify the signed transaction
    const verifyResult = await verifySignedTransaction(
      connection,
      signedTransaction,
      withdrawData.unsignedTransactionHash,
      managerWalletPubKey
    );

    if (!verifyResult.success) {
      return res.status(400).json({ error: verifyResult.error, details: verifyResult.details });
    }

    const transaction = verifyResult.transaction;

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
    console.log(`  Solscan: https://solscan.io/tx/${signature}`);

    // Wait for confirmation
    try {
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
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
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to confirm withdrawal' });
  } finally {
    if (releaseLock) releaseLock();
  }
});

export default router;
