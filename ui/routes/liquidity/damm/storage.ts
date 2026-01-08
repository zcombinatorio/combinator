/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * Request storage instances for DAMM liquidity operations
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
