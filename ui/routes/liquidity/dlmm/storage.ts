/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * Request storage instances for DLMM liquidity operations
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

import { RequestStorage } from '../shared';
import { DlmmWithdrawData, DlmmDepositData, DlmmCleanupSwapData } from './types';

/**
 * Storage for DLMM withdrawal requests
 */
export const withdrawRequests = new RequestStorage<DlmmWithdrawData>();

/**
 * Storage for DLMM deposit requests
 */
export const depositRequests = new RequestStorage<DlmmDepositData>();

/**
 * Storage for DLMM cleanup swap requests
 */
export const cleanupSwapRequests = new RequestStorage<DlmmCleanupSwapData>();
