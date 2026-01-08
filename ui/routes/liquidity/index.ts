/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * Liquidity Management Routes
 *
 * Combined router for both DLMM and DAMM liquidity management endpoints.
 * Use this for a unified import in api-server.ts
 */

import { Router } from 'express';
import dlmmRouter from './dlmm';
import dammRouter from './damm';

const router = Router();

// Mount AMM-specific routers under their prefixes
router.use('/dlmm', dlmmRouter);
router.use('/damm', dammRouter);

export default router;

// Re-export sub-routers for individual use
export { default as dlmmRouter } from './dlmm';
export { default as dammRouter } from './damm';

// Re-export shared utilities
export * from './shared';
