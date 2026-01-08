/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * DAMM deposit route handlers
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
import { CpAmm, getTokenProgram } from '@meteora-ag/cp-amm-sdk';
import rateLimit from 'express-rate-limit';

import {
  getPoolConfig,
  acquireLiquidityLock,
  verifySignedTransaction,
  isRestrictedLpOwner,
  REQUEST_EXPIRY,
} from '../shared';
import { depositRequests } from './storage';

const router = Router();

const dammLiquidityLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many liquidity requests, please wait a moment.'
});

/**
 * POST /deposit/build - Build deposit transaction
 */
router.post('/build', dammLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { tokenAAmount, tokenBAmount, poolAddress: poolAddressInput, adminWallet } = req.body;

    console.log('DAMM deposit build request received:', { tokenAAmount, tokenBAmount, poolAddress: poolAddressInput, adminWallet });

    if (!poolAddressInput) {
      return res.status(400).json({ error: 'Missing required field: poolAddress' });
    }

    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch {
      return res.status(400).json({ error: 'Invalid poolAddress: must be a valid Solana public key' });
    }

    // Cleanup mode: both amounts are 0 or undefined
    const useCleanupMode = (tokenAAmount === 0 && tokenBAmount === 0) ||
                           (tokenAAmount === undefined && tokenBAmount === undefined);

    if (!useCleanupMode) {
      if (tokenAAmount === undefined || tokenBAmount === undefined) {
        return res.status(400).json({ error: 'Missing required fields: tokenAAmount and tokenBAmount (or set both to 0 for cleanup mode)' });
      }
      if (typeof tokenAAmount !== 'number' || typeof tokenBAmount !== 'number') {
        return res.status(400).json({ error: 'tokenAAmount and tokenBAmount must be numbers' });
      }
      if (tokenAAmount < 0 || tokenBAmount < 0) {
        return res.status(400).json({ error: 'Token amounts must be non-negative' });
      }
    }

    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) {
      return res.status(500).json({ error: 'Server configuration incomplete. Missing RPC_URL.' });
    }

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

    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);

    const tokenAMint = await getMint(connection, poolState.tokenAMint);
    const tokenBMint = await getMint(connection, poolState.tokenBMint);
    const tokenAProgram = getTokenProgram(tokenAMint.tlvData.length > 0 ? 1 : 0);
    const tokenBProgram = getTokenProgram(tokenBMint.tlvData.length > 0 ? 1 : 0);
    const isTokenBNativeSOL = poolState.tokenBMint.equals(NATIVE_MINT);

    let tokenAAmountRaw: BN;
    let tokenBAmountRaw: BN;

    if (useCleanupMode) {
      console.log('  Using cleanup mode - reading LP owner wallet balances');
      console.log('  Waiting 2s for RPC to propagate pool state...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (isRestrictedLpOwner(lpOwner.publicKey.toBase58())) {
        return res.status(403).json({ error: 'Deposit operations using LP owner balances are not permitted for this LP owner address' });
      }

      const lpOwnerTokenAAta = await getAssociatedTokenAddress(poolState.tokenAMint, lpOwner.publicKey, false, tokenAProgram);
      const lpOwnerTokenBAta = isTokenBNativeSOL ? lpOwner.publicKey : await getAssociatedTokenAddress(poolState.tokenBMint, lpOwner.publicKey, false, tokenBProgram);

      tokenAAmountRaw = new BN(0);
      tokenBAmountRaw = new BN(0);

      try {
        const tokenAAccount = await connection.getTokenAccountBalance(lpOwnerTokenAAta);
        tokenAAmountRaw = new BN(tokenAAccount.value.amount);
      } catch { /* Account doesn't exist */ }

      try {
        if (isTokenBNativeSOL) {
          const solBalance = await connection.getBalance(lpOwner.publicKey);
          const reserveForFees = 333_000_000;
          tokenBAmountRaw = new BN(Math.max(0, solBalance - reserveForFees));
        } else {
          const tokenBAccount = await connection.getTokenAccountBalance(lpOwnerTokenBAta);
          tokenBAmountRaw = new BN(tokenBAccount.value.amount);
        }
      } catch { /* Account doesn't exist */ }

      console.log(`  LP Owner A Balance: ${tokenAAmountRaw.toString()}`);
      console.log(`  LP Owner B Balance: ${tokenBAmountRaw.toString()}`);

      if (tokenAAmountRaw.isZero() && tokenBAmountRaw.isZero()) {
        return res.status(400).json({ error: 'No tokens available in LP owner wallet for cleanup deposit' });
      }
    } else {
      tokenAAmountRaw = new BN(Math.floor((tokenAAmount as number) * Math.pow(10, tokenAMint.decimals)));
      tokenBAmountRaw = new BN(Math.floor((tokenBAmount as number) * Math.pow(10, tokenBMint.decimals)));
    }

    const userPositions = await cpAmm.getUserPositionByPool(poolAddress, lpOwner.publicKey);
    if (userPositions.length === 0) {
      return res.status(404).json({ error: 'No positions found for the LP owner. Create a position first.' });
    }

    const { position, positionNftAccount } = userPositions[0];

    // Calculate pool price
    const sqrtPriceNum = Number(poolState.sqrtPrice.toString());
    const Q64 = Math.pow(2, 64);
    const poolPrice = Math.pow(sqrtPriceNum / Q64, 2);
    console.log(`  Pool price: ${poolPrice} B per A`);

    // Calculate balanced deposit amounts
    const currentEpoch = await connection.getEpochInfo().then(e => e.epoch);

    const quoteFromA = cpAmm.getDepositQuote({
      inAmount: tokenAAmountRaw,
      isTokenA: true,
      inputTokenInfo: { mint: tokenAMint, currentEpoch },
      outputTokenInfo: { mint: tokenBMint, currentEpoch },
      minSqrtPrice: poolState.sqrtMinPrice,
      maxSqrtPrice: poolState.sqrtMaxPrice,
      sqrtPrice: poolState.sqrtPrice
    });

    let depositTokenAAmount: BN;
    let depositTokenBAmount: BN;
    let leftoverTokenAAmount: BN;
    let leftoverTokenBAmount: BN;
    let liquidityDelta: BN;

    if (quoteFromA.outputAmount.lte(tokenBAmountRaw)) {
      depositTokenAAmount = tokenAAmountRaw;
      depositTokenBAmount = quoteFromA.outputAmount;
      leftoverTokenAAmount = new BN(0);
      leftoverTokenBAmount = tokenBAmountRaw.sub(quoteFromA.outputAmount);
      liquidityDelta = quoteFromA.liquidityDelta;
    } else {
      const quoteFromB = cpAmm.getDepositQuote({
        inAmount: tokenBAmountRaw,
        isTokenA: false,
        inputTokenInfo: { mint: tokenBMint, currentEpoch },
        outputTokenInfo: { mint: tokenAMint, currentEpoch },
        minSqrtPrice: poolState.sqrtMinPrice,
        maxSqrtPrice: poolState.sqrtMaxPrice,
        sqrtPrice: poolState.sqrtPrice
      });
      depositTokenAAmount = quoteFromB.outputAmount;
      depositTokenBAmount = tokenBAmountRaw;
      leftoverTokenAAmount = tokenAAmountRaw.sub(quoteFromB.outputAmount);
      leftoverTokenBAmount = new BN(0);
      liquidityDelta = quoteFromB.liquidityDelta;
    }

    if (liquidityDelta.isZero()) {
      return res.status(400).json({ error: 'Deposit amount too small' });
    }

    // Build transaction
    const combinedTx = new Transaction();
    combinedTx.feePayer = managerWallet;
    const { blockhash } = await connection.getLatestBlockhash();
    combinedTx.recentBlockhash = blockhash;

    const managerTokenAAta = await getAssociatedTokenAddress(poolState.tokenAMint, managerWallet, false, tokenAProgram);
    const managerTokenBAta = isTokenBNativeSOL ? managerWallet : await getAssociatedTokenAddress(poolState.tokenBMint, managerWallet, false, tokenBProgram);
    const lpOwnerTokenAAta = await getAssociatedTokenAddress(poolState.tokenAMint, lpOwner.publicKey, false, tokenAProgram);
    const lpOwnerTokenBAta = isTokenBNativeSOL ? lpOwner.publicKey : await getAssociatedTokenAddress(poolState.tokenBMint, lpOwner.publicKey, false, tokenBProgram);

    // Create LP owner's ATAs
    combinedTx.add(createAssociatedTokenAccountIdempotentInstruction(managerWallet, lpOwnerTokenAAta, lpOwner.publicKey, poolState.tokenAMint, tokenAProgram));
    if (!isTokenBNativeSOL) {
      combinedTx.add(createAssociatedTokenAccountIdempotentInstruction(managerWallet, lpOwnerTokenBAta, lpOwner.publicKey, poolState.tokenBMint, tokenBProgram));
    }

    // Transfer from manager to LP owner (skip if same wallet or cleanup mode)
    if (!isSameWallet && !useCleanupMode) {
      if (!tokenAAmountRaw.isZero()) {
        combinedTx.add(createTransferInstruction(managerTokenAAta, lpOwnerTokenAAta, managerWallet, BigInt(tokenAAmountRaw.toString()), [], tokenAProgram));
      }
      if (!tokenBAmountRaw.isZero()) {
        if (isTokenBNativeSOL) {
          combinedTx.add(SystemProgram.transfer({ fromPubkey: managerWallet, toPubkey: lpOwner.publicKey, lamports: Number(tokenBAmountRaw.toString()) }));
        } else {
          combinedTx.add(createTransferInstruction(managerTokenBAta, lpOwnerTokenBAta, managerWallet, BigInt(tokenBAmountRaw.toString()), [], tokenBProgram));
        }
      }
    }

    // Add liquidity
    const addLiquidityTx = await cpAmm.addLiquidity({
      owner: lpOwner.publicKey,
      position,
      pool: poolAddress,
      positionNftAccount,
      liquidityDelta,
      maxAmountTokenA: depositTokenAAmount.muln(105).divn(100),
      maxAmountTokenB: depositTokenBAmount.muln(105).divn(100),
      tokenAAmountThreshold: depositTokenAAmount.muln(105).divn(100),
      tokenBAmountThreshold: depositTokenBAmount.muln(105).divn(100),
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAProgram,
      tokenBProgram,
    });

    combinedTx.add(...addLiquidityTx.instructions);

    const unsignedTransaction = bs58.encode(combinedTx.serialize({ requireAllSignatures: false }));
    const unsignedTransactionHash = crypto.createHash('sha256').update(combinedTx.serializeMessage()).digest('hex');
    const requestId = depositRequests.generateRequestId();

    console.log('✓ Deposit transaction built successfully');
    console.log(`  Request ID: ${requestId}`);

    depositRequests.set(requestId, {
      unsignedTransaction,
      unsignedTransactionHash,
      poolAddress: poolAddress.toBase58(),
      tokenAMint: poolState.tokenAMint.toBase58(),
      tokenBMint: poolState.tokenBMint.toBase58(),
      tokenADecimals: tokenAMint.decimals,
      tokenBDecimals: tokenBMint.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: managerWallet.toBase58(),
      transferredTokenAAmount: tokenAAmountRaw.toString(),
      transferredTokenBAmount: tokenBAmountRaw.toString(),
      depositedTokenAAmount: depositTokenAAmount.toString(),
      depositedTokenBAmount: depositTokenBAmount.toString(),
      leftoverTokenAAmount: leftoverTokenAAmount.toString(),
      leftoverTokenBAmount: leftoverTokenBAmount.toString(),
      poolPrice,
      liquidityDelta: liquidityDelta.toString(),
      positionAddress: position.toBase58(),
      adminWallet,
    });

    const hasLeftover = !leftoverTokenAAmount.isZero() || !leftoverTokenBAmount.isZero();

    res.json({
      success: true,
      transaction: unsignedTransaction,
      requestId,
      poolAddress: poolAddress.toBase58(),
      tokenAMint: poolState.tokenAMint.toBase58(),
      tokenBMint: poolState.tokenBMint.toBase58(),
      tokenADecimals: tokenAMint.decimals,
      tokenBDecimals: tokenBMint.decimals,
      isTokenBNativeSOL,
      cleanupMode: useCleanupMode,
      poolPrice,
      hasLeftover,
      transferred: { tokenA: tokenAAmountRaw.toString(), tokenB: tokenBAmountRaw.toString() },
      deposited: { tokenA: depositTokenAAmount.toString(), tokenB: depositTokenBAmount.toString(), liquidityDelta: liquidityDelta.toString() },
      leftover: { tokenA: leftoverTokenAAmount.toString(), tokenB: leftoverTokenBAmount.toString() },
      message: hasLeftover
        ? 'Sign this transaction with the manager wallet and submit to /damm/deposit/confirm. Note: leftover tokens will remain in LP owner wallet for cleanup.'
        : 'Sign this transaction with the manager wallet and submit to /damm/deposit/confirm'
    });

  } catch (error) {
    console.error('Deposit build error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create deposit transaction' });
  }
});

/**
 * POST /deposit/confirm - Confirm and submit deposit transaction
 */
router.post('/confirm', dammLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransaction, requestId } = req.body;

    console.log('DAMM deposit confirm request received:', { requestId });

    if (!signedTransaction || !requestId) {
      return res.status(400).json({ error: 'Missing required fields: signedTransaction and requestId' });
    }

    const depositData = depositRequests.get(requestId);
    if (!depositData) {
      return res.status(400).json({ error: 'Deposit request not found or expired. Please call /damm/deposit/build first.' });
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
      poolConfig = await getPoolConfig(depositData.poolAddress, 'damm', depositData.adminWallet);
    } catch {
      return res.status(403).json({ error: 'Pool not authorized for liquidity operations' });
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwnerKeypair = poolConfig.lpOwnerKeypair;
    const managerWalletPubKey = new PublicKey(poolConfig.managerWallet);

    const verifyResult = await verifySignedTransaction(
      connection,
      signedTransaction,
      depositData.unsignedTransactionHash,
      managerWalletPubKey
    );

    if (!verifyResult.success) {
      return res.status(400).json({ error: verifyResult.error, details: verifyResult.details });
    }

    const transaction = verifyResult.transaction;
    transaction.partialSign(lpOwnerKeypair);

    console.log('  Sending transaction...');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });

    console.log('✓ Deposit transaction sent');
    console.log(`  Signature: ${signature}`);

    try {
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
      console.log(`✓ Deposit confirmed: ${signature}`);
    } catch (error) {
      console.error(`⚠ Confirmation timeout for ${signature}:`, error);
    }

    depositRequests.delete(requestId);

    const hasLeftover = depositData.leftoverTokenAAmount !== '0' || depositData.leftoverTokenBAmount !== '0';

    res.json({
      success: true,
      signature,
      poolAddress: depositData.poolAddress,
      tokenAMint: depositData.tokenAMint,
      tokenBMint: depositData.tokenBMint,
      tokenADecimals: depositData.tokenADecimals,
      tokenBDecimals: depositData.tokenBDecimals,
      poolPrice: depositData.poolPrice,
      hasLeftover,
      transferred: { tokenA: depositData.transferredTokenAAmount, tokenB: depositData.transferredTokenBAmount },
      deposited: { tokenA: depositData.depositedTokenAAmount, tokenB: depositData.depositedTokenBAmount, liquidityDelta: depositData.liquidityDelta },
      leftover: { tokenA: depositData.leftoverTokenAAmount, tokenB: depositData.leftoverTokenBAmount },
      message: hasLeftover
        ? 'Deposit transaction submitted successfully. Leftover tokens remain in LP owner wallet for cleanup.'
        : 'Deposit transaction submitted successfully'
    });

  } catch (error) {
    console.error('Deposit confirm error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to confirm deposit' });
  } finally {
    if (releaseLock) releaseLock();
  }
});

export default router;
