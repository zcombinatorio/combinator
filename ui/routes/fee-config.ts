/*
 * Z Combinator - Solana Token Launchpad
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
 */

/**
 * Fee Configuration
 *
 * Shared fee configuration for DAMM and DLMM fee claim routes.
 */

// Protocol fee wallet - receives protocol's share of trading fees
export const PROTOCOL_FEE_WALLET = 'FEEnkcCNE2623LYCPtLf63LFzXpCFigBLTu4qZovRGZC';

// Protocol target fee rate: 0.5% of swap volume
// Meteora takes 20% of pool fees, so LP owner only receives 80%
// Formula: protocol_percent = (0.5 / (pool_fee_rate * 0.8)) * 100
export const PROTOCOL_TARGET_FEE_PERCENT = 0.5;
export const METEORA_FEE_PERCENT = 0.20;  // Meteora takes 20% of collected fees

// ============================================================================
// Partner Fee Configuration
// ============================================================================

// Special partner: 0% protocol fee, 100% to DAO treasury
export const PARTNER_DAO_PDA = '6Eykhr9PfnjKFGWxgACCUKo1sy9zRKEBAQV8n94Qo33y';

// Partner's treasury address (receives 3/7 of fees from referred DAOs)
export const PARTNER_TREASURY = 'EtdhMR3yYHsUP3cm36X83SpvnL5jB48p5b653pqLC23C';

// DAOs referred by the partner get special fee split:
// - 1/7 (~14.29%) to protocol
// - 3/7 (~42.86%) to partner treasury
// - 3/7 (~42.86%) to the DAO's own treasury
export const PARTNER_REFERRED_DAO_PDAS: Set<string> = new Set([
  // Add referred DAO PDAs here
]);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate protocol fee percentage based on pool fee rate.
 * Protocol targets 0.5% of swap volume.
 * Meteora takes 20% of pool fees, so LP only receives 80%.
 * Formula: protocol_percent = (0.5 / (pool_fee_rate * 0.8)) * 100
 *
 * Example with 2% pool fee:
 * - Pool collects 2% of swap volume
 * - Meteora takes 20% → 0.4% goes to Meteora
 * - LP receives 80% → 1.6% of swap volume
 * - Protocol wants 0.5% → needs 0.5/1.6 = 31.25% of LP's share
 *
 * @param poolFeeBps - Pool fee rate in basis points
 * @returns Protocol fee percentage (0-100)
 */
export function calculateProtocolFeePercent(poolFeeBps: number): number {
  if (poolFeeBps <= 0) {
    throw new Error(`Invalid pool fee: ${poolFeeBps}bps. Pool fee must be positive.`);
  }
  const poolFeePercent = poolFeeBps / 100;  // Convert bps to percent
  const lpSharePercent = poolFeePercent * (1 - METEORA_FEE_PERCENT);  // LP gets 80%
  const protocolPercent = (PROTOCOL_TARGET_FEE_PERCENT / lpSharePercent) * 100;
  // Cap at 100% (for pools where LP share equals or is less than 0.5%)
  return Math.min(protocolPercent, 100);
}

export interface FeeRecipient {
  address: string;  // Solana wallet address
  percent: number;  // Percentage of fees (0-100)
}
