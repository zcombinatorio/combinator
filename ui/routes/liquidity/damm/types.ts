/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * Type definitions for DAMM liquidity operations
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

import { BaseRequestData } from '../shared';

/**
 * Data stored for DAMM withdrawal requests
 */
export interface DammWithdrawData extends BaseRequestData {
  unsignedTransaction: string;
  unsignedTransactionHash: string;
  tokenAMint: string;
  tokenBMint: string;
  lpOwnerAddress: string;
  managerAddress: string;
  destinationAddress: string;
  estimatedTokenAAmount: string;
  estimatedTokenBAmount: string;
  liquidityDelta: string;
  withdrawalPercentage: number;
}

/**
 * Data stored for DAMM deposit requests
 */
export interface DammDepositData extends BaseRequestData {
  unsignedTransaction: string;
  unsignedTransactionHash: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenADecimals: number;
  tokenBDecimals: number;
  lpOwnerAddress: string;
  managerAddress: string;
  // Total amounts transferred from manager to LP owner
  transferredTokenAAmount: string;
  transferredTokenBAmount: string;
  // Amounts actually deposited to DAMM (balanced at pool price)
  depositedTokenAAmount: string;
  depositedTokenBAmount: string;
  // Amounts left over in LP owner wallet (for cleanup)
  leftoverTokenAAmount: string;
  leftoverTokenBAmount: string;
  // Pool price used for balancing
  poolPrice: number; // tokenB per tokenA
  liquidityDelta: string;
  positionAddress: string;
}

/**
 * Data stored for DAMM cleanup swap requests
 */
export interface DammCleanupSwapData extends BaseRequestData {
  unsignedTransaction: string;
  unsignedTransactionHash: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenADecimals: number;
  tokenBDecimals: number;
  lpOwnerAddress: string;
  managerAddress: string;
  // Swap details
  swapInputMint: string;
  swapInputAmount: string;
  swapOutputMint: string;
  swapExpectedOutputAmount: string;
  swapDirection: 'AtoB' | 'BtoA';
}
