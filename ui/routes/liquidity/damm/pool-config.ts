/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * DAMM pool configuration route handler
 */

import { Router, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { getPoolConfig, AdminKeyError } from '../shared';

const router = Router();

/**
 * GET /pool/:poolAddress/config - Get pool configuration (LP owner, manager)
 *
 * Returns the LP owner and manager wallet addresses for a given pool.
 * Used by os-percent to know where to transfer tokens before cleanup.
 * Supports both legacy whitelisted pools and DAO-managed pools.
 */
router.get('/:poolAddress/config', async (req: Request, res: Response) => {
  try {
    const { poolAddress: poolAddressInput } = req.params;

    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch {
      return res.status(400).json({ error: 'Invalid poolAddress: must be a valid Solana public key' });
    }

    let poolConfig;
    try {
      poolConfig = await getPoolConfig(poolAddress.toBase58(), 'damm');
    } catch (error) {
      if (error instanceof AdminKeyError) {
        console.error('Admin key error details:', error.internalDetails);
        return res.status(503).json({ error: error.clientMessage });
      }
      return res.status(403).json({ error: 'Pool not authorized for liquidity operations' });
    }

    return res.json({
      success: true,
      poolAddress: poolAddress.toBase58(),
      lpOwnerAddress: poolConfig.lpOwnerKeypair.publicKey.toBase58(),
      managerAddress: poolConfig.managerWallet,
      source: poolConfig.source,
      daoName: poolConfig.daoName,
    });

  } catch (error) {
    console.error('Error fetching pool config:', error);
    return res.status(500).json({
      error: 'Failed to fetch pool configuration',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
