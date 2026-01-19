/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { CpAmm, feeNumeratorToBps, getFeeNumerator } from '@meteora-ag/cp-amm-sdk';
import DLMM from '@meteora-ag/dlmm';

// Meteora program IDs for pool type detection
export const DAMM_PROGRAM_ID = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
export const DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

export interface PoolInfo {
  poolType: 'damm' | 'dlmm';
  tokenAMint: string;
  tokenBMint: string;
  feeBps: number;  // Pool trading fee in basis points (e.g., 50 = 0.5%)
}

/**
 * Derive pool type and token mints from a Meteora pool address
 * Checks the account owner to determine if DAMM or DLMM, then fetches pool state
 */
export async function getPoolInfo(connection: Connection, poolAddress: PublicKey): Promise<PoolInfo> {
  // Fetch account info to check the owner program
  const accountInfo = await connection.getAccountInfo(poolAddress);
  if (!accountInfo) {
    throw new Error('Pool account not found');
  }

  const owner = accountInfo.owner;

  if (owner.equals(DAMM_PROGRAM_ID)) {
    // DAMM pool - use CpAmm SDK
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);

    // Calculate STEADY STATE fee rate (after all decay periods complete)
    // DAMM pools can have time-decaying fees, so we need to check what the
    // minimum fee will be to ensure the DAO always receives sufficient fees.
    // Compute a point far enough in the future that all periods have elapsed:
    // steadyStatePoint = activationPoint + (numberOfPeriod + 1) * periodFrequency
    const baseFee = poolState.poolFees.baseFee;
    const steadyStatePoint = poolState.activationPoint
      .add(baseFee.periodFrequency.muln(baseFee.numberOfPeriod + 1))
      .toNumber();

    const steadyStateFeeNumerator = getFeeNumerator(
      steadyStatePoint,
      poolState.activationPoint,
      baseFee.numberOfPeriod,
      baseFee.periodFrequency,
      baseFee.feeSchedulerMode,
      baseFee.cliffFeeNumerator,
      baseFee.reductionFactor,
    );

    const feeBps = feeNumeratorToBps(steadyStateFeeNumerator);
    return {
      poolType: 'damm',
      tokenAMint: poolState.tokenAMint.toBase58(),
      tokenBMint: poolState.tokenBMint.toBase58(),
      feeBps,
    };
  } else if (owner.equals(DLMM_PROGRAM_ID)) {
    // DLMM pool - use DLMM SDK
    const dlmmPool = await DLMM.create(connection, poolAddress);
    // Use SDK's getFeeInfo() which correctly calculates:
    // baseFee = baseFactor * binStep * 10 * 10^baseFeePowerFactor
    // Returns baseFeeRatePercentage as a Decimal (0-100%), multiply by 100 to get bps
    const feeInfo = dlmmPool.getFeeInfo();
    const feeBps = feeInfo.baseFeeRatePercentage.mul(100).toNumber();
    return {
      poolType: 'dlmm',
      tokenAMint: dlmmPool.lbPair.tokenXMint.toBase58(),
      tokenBMint: dlmmPool.lbPair.tokenYMint.toBase58(),
      feeBps,
    };
  } else {
    throw new Error(`Unknown pool program: ${owner.toBase58()}. Expected DAMM or DLMM.`);
  }
}

/**
 * Determine the quote mint given pool tokens and the base (governance) token
 */
export function deriveQuoteMint(poolInfo: PoolInfo, tokenMint: string): string {
  if (poolInfo.tokenAMint === tokenMint) {
    return poolInfo.tokenBMint;
  } else if (poolInfo.tokenBMint === tokenMint) {
    return poolInfo.tokenAMint;
  } else {
    throw new Error(`Token mint ${tokenMint} not found in pool. Pool contains: ${poolInfo.tokenAMint}, ${poolInfo.tokenBMint}`);
  }
}
