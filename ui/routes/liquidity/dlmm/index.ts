/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * DLMM Liquidity Routes
 *
 * Express router for Meteora DLMM (Dynamic Liquidity Market Maker) liquidity management.
 * Handles withdrawal, deposit, and cleanup swap operations with manager wallet authorization.
 */

import { Router } from 'express';
import poolConfigRouter from './pool-config';
import withdrawRouter from './withdraw';
import depositRouter from './deposit';
import cleanupSwapRouter from './cleanup-swap';

const router = Router();

// Mount sub-routers
router.use('/pool', poolConfigRouter);
router.use('/withdraw', withdrawRouter);
router.use('/deposit', depositRouter);
router.use('/cleanup/swap', cleanupSwapRouter);

export default router;

// Re-export types for external use
export * from './types';
