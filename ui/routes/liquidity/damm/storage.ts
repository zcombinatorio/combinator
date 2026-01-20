/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * Request storage instances for DAMM liquidity operations
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

import { RequestStorage } from '../shared';
import { DammWithdrawData, DammDepositData, DammCleanupSwapData } from './types';

/**
 * Storage for DAMM withdrawal requests
 */
export const withdrawRequests = new RequestStorage<DammWithdrawData>();

/**
 * Storage for DAMM deposit requests
 */
export const depositRequests = new RequestStorage<DammDepositData>();

/**
 * Storage for DAMM cleanup swap requests
 */
export const cleanupSwapRequests = new RequestStorage<DammCleanupSwapData>();
