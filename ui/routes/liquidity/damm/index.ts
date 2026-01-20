/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * DAMM Liquidity Routes
 *
 * Express router for Meteora DAMM v2 (Concentrated Pool AMM) liquidity management.
 * Handles withdrawal, deposit, and cleanup swap operations with manager wallet authorization.
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
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
