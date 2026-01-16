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

import { PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

// Squads v4 program ID (same as used by @zcomb/programs-sdk)
export const SQUADS_PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

/**
 * Derive the Squads vault PDA from a multisig PDA.
 * The vault is where assets should be transferred to, NOT the multisig itself.
 * Sending to the multisig address instead of the vault leads to permanently lost funds!
 *
 * @param multisigPda - The Squads multisig PDA
 * @param index - Vault index (0 for default vault)
 * @returns The vault PDA
 */
export function deriveSquadsVaultPda(multisigPda: PublicKey, index: number = 0): PublicKey {
  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index,
    programId: SQUADS_PROGRAM_ID,
  });
  return vaultPda;
}
