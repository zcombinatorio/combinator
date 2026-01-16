/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * Type definitions for DLMM liquidity operations
 */

import { BaseRequestData } from '../shared';

/**
 * Data stored for DLMM withdrawal requests
 */
export interface DlmmWithdrawData extends BaseRequestData {
  unsignedTransactions: string[];
  unsignedTransactionHashes: string[];
  tokenXMint: string;
  tokenYMint: string;
  lpOwnerAddress: string;
  managerAddress: string;
  destinationAddress: string;
  // Amounts withdrawn from DLMM bins
  withdrawnTokenXAmount: string;
  withdrawnTokenYAmount: string;
  // Amounts transferred to manager (at market price ratio)
  transferTokenXAmount: string;
  transferTokenYAmount: string;
  // Amounts redeposited back to DLMM
  redepositTokenXAmount: string;
  redepositTokenYAmount: string;
  // Market price info
  marketPrice: number; // tokenY per tokenX
  positionAddress: string;
  fromBinId: number;
  toBinId: number;
  withdrawalPercentage: number;
}

/**
 * Data stored for DLMM deposit requests
 */
export interface DlmmDepositData extends BaseRequestData {
  unsignedTransactions: string[];  // Array for chunked deposits (wide bin ranges)
  unsignedTransactionHashes: string[];
  tokenXMint: string;
  tokenYMint: string;
  tokenXDecimals: number;
  tokenYDecimals: number;
  lpOwnerAddress: string;
  managerAddress: string;
  // Total amounts transferred from manager to LP owner
  transferredTokenXAmount: string;
  transferredTokenYAmount: string;
  // Amounts actually deposited to DLMM (balanced at pool price)
  depositedTokenXAmount: string;
  depositedTokenYAmount: string;
  // Amounts left over in LP owner wallet (for cleanup)
  leftoverTokenXAmount: string;
  leftoverTokenYAmount: string;
  // Pool price used for balancing
  activeBinPrice: number; // tokenY per tokenX
  positionAddress: string;
  // If a new position was created, store the keypair secret for signing during confirm
  newPositionKeypairSecret?: string;
  isNewPosition?: boolean;
}

/**
 * Data stored for DLMM cleanup swap requests
 */
export interface DlmmCleanupSwapData extends BaseRequestData {
  unsignedTransaction: string;
  unsignedTransactionHash: string;
  tokenXMint: string;
  tokenYMint: string;
  tokenXDecimals: number;
  tokenYDecimals: number;
  lpOwnerAddress: string;
  managerAddress: string;
  activeBinPrice: number;
  // Swap details
  swapInputMint: string;
  swapInputAmount: string;
  swapOutputMint: string;
  swapExpectedOutputAmount: string;
  swapDirection: 'XtoY' | 'YtoX';
}
