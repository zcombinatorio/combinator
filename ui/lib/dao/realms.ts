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
import {
  getGovernance,
  getRealm,
  getAllTokenOwnerRecords,
  VoteThresholdType,
} from '@solana/spl-governance';

// SPL Governance program ID
export const SPL_GOVERNANCE_PROGRAM_ID = new PublicKey('GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw');

// Combinator's treasury multisig keys (must match on-chain constants in programs/futarchy/src/constants.rs)
const TREASURY_KEY_A = new PublicKey('HHroB8P1q3kijtyML9WPvfTXG8JicfmUoGZjVzam64PX');
const TREASURY_KEY_B = new PublicKey('3ogXyF6ovq5SqsneuGY6gHLG27NK6gw13SqfXMwRBYai');

// Combinator's mint multisig keys
const MINT_KEY_A = new PublicKey('Dobm8QnaCPQoc6koxC3wqBQqPTfDwspATb2u6EcWC9Aw');
const MINT_KEY_B = new PublicKey('2xrEGvtxXKujqnHceiSzYDTAbTJEX3yGGPJgywH7LmcD');

export interface GovernanceValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate that a governance account is configured as expected for Combinator treasury:
 * - Must be a valid SPL Governance account
 * - Council must have exactly 3 members
 * - 2 of 3 must be Combinator's treasury keys (KEY_A and KEY_B)
 * - Council vote threshold must require 2/3 approval (≤ 67%)
 */
export async function validateTreasuryGovernance(
  connection: Connection,
  governancePubkey: PublicKey,
  expectedCosigner: PublicKey,
): Promise<GovernanceValidationResult> {
  return validateGovernance(connection, governancePubkey, {
    label: 'Treasury',
    expectedMembers: [TREASURY_KEY_A, TREASURY_KEY_B, expectedCosigner],
    expectedMemberCount: 3,
    requiredCombinatorKeys: [TREASURY_KEY_A, TREASURY_KEY_B],
    minThresholdPercentage: 34, // > 33% so 1-of-3 can't pass
    maxThresholdPercentage: 67, // ≤ 67% so 2-of-3 can pass
  });
}

/**
 * Validate that a governance account is configured as expected for Combinator mint:
 * - Must be a valid SPL Governance account
 * - Council must have exactly 2 members
 * - Both must be Combinator's mint keys (KEY_A and KEY_B)
 * - Council vote threshold must require 2/2 approval (100%)
 */
export async function validateMintGovernance(
  connection: Connection,
  governancePubkey: PublicKey,
): Promise<GovernanceValidationResult> {
  return validateGovernance(connection, governancePubkey, {
    label: 'Mint',
    expectedMembers: [MINT_KEY_A, MINT_KEY_B],
    expectedMemberCount: 2,
    requiredCombinatorKeys: [MINT_KEY_A, MINT_KEY_B],
    minThresholdPercentage: 51, // > 50% so 1-of-2 can't pass
    maxThresholdPercentage: 100, // 2/2 = 100%
  });
}

interface GovernanceValidationConfig {
  label: string;
  expectedMembers: PublicKey[];
  expectedMemberCount: number;
  requiredCombinatorKeys: PublicKey[];
  minThresholdPercentage: number;
  maxThresholdPercentage: number;
}

async function validateGovernance(
  connection: Connection,
  governancePubkey: PublicKey,
  config: GovernanceValidationConfig,
): Promise<GovernanceValidationResult> {
  // 1. Fetch and deserialize the governance account
  let governance;
  try {
    governance = await getGovernance(connection, governancePubkey);
  } catch (error) {
    return {
      valid: false,
      error: `${config.label} governance account not found or invalid: ${String(error)}`,
    };
  }

  // 2. Check council vote threshold
  const councilThreshold = governance.account.config.councilVoteThreshold;
  if (councilThreshold.type === VoteThresholdType.Disabled) {
    return {
      valid: false,
      error: `${config.label} governance has council voting disabled`,
    };
  }
  if (councilThreshold.type !== VoteThresholdType.YesVotePercentage) {
    return {
      valid: false,
      error: `${config.label} governance council threshold must be YesVotePercentage, got type ${councilThreshold.type}`,
    };
  }
  if (councilThreshold.value === undefined || councilThreshold.value < config.minThresholdPercentage) {
    return {
      valid: false,
      error: `${config.label} governance council threshold is ${councilThreshold.value}%, expected ≥ ${config.minThresholdPercentage}%`,
    };
  }
  if (councilThreshold.value > config.maxThresholdPercentage) {
    return {
      valid: false,
      error: `${config.label} governance council threshold is ${councilThreshold.value}%, expected ≤ ${config.maxThresholdPercentage}%`,
    };
  }

  // 3. Fetch the realm to get the council mint
  let realm;
  try {
    realm = await getRealm(connection, governance.account.realm);
  } catch (error) {
    return {
      valid: false,
      error: `Failed to fetch realm for ${config.label} governance: ${String(error)}`,
    };
  }

  const councilMint = realm.account.config.councilMint;
  if (!councilMint) {
    return {
      valid: false,
      error: `${config.label} governance realm has no council mint configured`,
    };
  }

  // 4. Fetch all token owner records for the realm to find council members
  let tokenOwnerRecords;
  try {
    tokenOwnerRecords = await getAllTokenOwnerRecords(
      connection,
      SPL_GOVERNANCE_PROGRAM_ID,
      governance.account.realm,
    );
  } catch (error) {
    return {
      valid: false,
      error: `Failed to fetch token owner records: ${String(error)}`,
    };
  }

  // Filter to council token holders with deposited tokens
  const councilMembers = tokenOwnerRecords
    .filter(
      (r) =>
        r.account.governingTokenMint.equals(councilMint) &&
        !r.account.governingTokenDepositAmount.isZero(),
    )
    .map((r) => r.account.governingTokenOwner);

  // 5. Check member count
  if (councilMembers.length !== config.expectedMemberCount) {
    return {
      valid: false,
      error: `${config.label} governance has ${councilMembers.length} council members, expected ${config.expectedMemberCount}`,
    };
  }

  // 6. Check that all required Combinator keys are members
  for (const requiredKey of config.requiredCombinatorKeys) {
    const found = councilMembers.some((m) => m.equals(requiredKey));
    if (!found) {
      return {
        valid: false,
        error: `${config.label} governance missing required Combinator key: ${requiredKey.toBase58()}`,
      };
    }
  }

  // 7. Check that all expected members are present
  for (const expectedMember of config.expectedMembers) {
    const found = councilMembers.some((m) => m.equals(expectedMember));
    if (!found) {
      return {
        valid: false,
        error: `${config.label} governance missing expected member: ${expectedMember.toBase58()}`,
      };
    }
  }

  return { valid: true };
}
