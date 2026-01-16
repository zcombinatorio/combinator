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

import * as crypto from 'crypto';
import bs58 from 'bs58';

// MOCK MODE CONFIGURATION
// When true: Skips Futarchy SDK on-chain calls, uses mock PDAs/transactions
// When false: Makes real on-chain calls via FutarchyClient SDK
//
// TODO [POST-DEPLOYMENT]: After Futarchy contracts are deployed on mainnet:
//   1. Set MOCK_MODE = false
//   2. Test with a real token where you control mint authority
//   3. Test with a Meteora pool where you hold LP positions
//   4. Verify all 5 proposal validation checks pass:
//      - Treasury has funds (SOL/USDC/token)
//      - Mint authority set to mint_auth_multisig
//      - Token matches pool base token (parent DAOs)
//      - Admin wallet holds LP positions
//      - No active proposal for moderator
//   5. Create a test proposal end-to-end
//   6. Remove this TODO block once verified
export const MOCK_MODE = false;

/**
 * Generate a deterministic mock public key based on a seed string
 */
export function mockPublicKey(seed: string): string {
  const hash = crypto.createHash('sha256').update(seed).digest();
  // Take first 32 bytes and encode as base58
  return bs58.encode(hash.slice(0, 32));
}

/**
 * Generate a mock transaction signature
 */
export function mockTxSignature(): string {
  const bytes = crypto.randomBytes(64);
  return bs58.encode(bytes);
}

/**
 * Mock response for initializeParentDAO
 * Note: Returns vault PDAs, not multisig PDAs (vaults are where assets should go)
 */
export function mockInitializeParentDAO(name: string) {
  return {
    daoPda: mockPublicKey(`dao:parent:${name}`),
    moderatorPda: mockPublicKey(`moderator:${name}`),
    treasuryVault: mockPublicKey(`treasury-vault:${name}`),
    mintVault: mockPublicKey(`mint-vault:${name}`),
    tx: mockTxSignature(),
  };
}

/**
 * Mock response for initializeChildDAO
 * Note: Returns vault PDAs, not multisig PDAs (vaults are where assets should go)
 */
export function mockInitializeChildDAO(parentName: string, childName: string) {
  return {
    daoPda: mockPublicKey(`dao:child:${parentName}:${childName}`),
    treasuryVault: mockPublicKey(`treasury-vault:child:${childName}`),
    mintVault: mockPublicKey(`mint-vault:child:${childName}`),
    tx: mockTxSignature(),
  };
}

/**
 * Mock response for createProposal
 */
export function mockCreateProposal(daoPda: string, title: string) {
  return {
    proposalPda: mockPublicKey(`proposal:${daoPda}:${title}`),
    proposalId: Math.floor(Math.random() * 1000000),
  };
}
