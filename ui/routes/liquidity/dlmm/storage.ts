/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * Request storage instances for DLMM liquidity operations
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
