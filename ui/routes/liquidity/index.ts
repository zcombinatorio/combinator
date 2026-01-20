/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * Liquidity Management Routes
 *
 * Combined router for both DLMM and DAMM liquidity management endpoints.
 * Use this for a unified import in api-server.ts
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
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
