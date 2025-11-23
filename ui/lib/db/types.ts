/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
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
 * Database Type Definitions
 *
 * All TypeScript interfaces representing database table schemas
 * for the Z Combinator token launchpad platform.
 */

export interface TokenLaunch {
  id?: number;
  launch_time: Date;
  creator_wallet: string;
  token_address: string;
  token_metadata_url: string;
  token_name?: string;
  token_symbol?: string;
  image_uri?: string;
  creator_twitter?: string;
  creator_github?: string;
  created_at?: Date;
  is_creator_designated?: boolean;
  verified?: boolean;
}

export interface VerificationChallenge {
  id?: number;
  wallet_address: string;
  challenge_nonce: string;
  challenge_message: string;
  expires_at: Date;
  used: boolean;
  created_at?: Date;
}

export interface MintTransaction {
  id?: number;
  signature: string;
  timestamp: number;
  token_address: string;
  wallet_address: string;
  amount: bigint;
  tx_data: Record<string, unknown>;
  created_at?: Date;
}

export interface ClaimRecord {
  id?: number;
  wallet_address: string;
  token_address: string;
  amount: string;
  transaction_signature: string;
  confirmed_at: Date;
}

export interface TokenHolder {
  id?: number;
  token_address: string;
  wallet_address: string;
  token_balance: string;
  staked_balance: string;
  telegram_username?: string | null;
  x_username?: string | null;
  discord_username?: string | null;
  custom_label?: string | null;
  created_at?: Date;
  updated_at?: Date;
  last_sync_at?: Date;
}

export interface DesignatedClaim {
  id?: number;
  token_address: string;
  original_launcher: string;
  designated_twitter?: string | null;
  designated_github?: string | null;
  verified_wallet?: string | null;
  verified_embedded_wallet?: string | null;
  verified_at?: Date | null;
  created_at?: Date;
}

export interface EmissionSplit {
  id?: number;
  token_address: string;
  recipient_wallet: string;
  split_percentage: number; // 0-100
  label?: string | null;
  created_at?: Date;
}

export interface Presale {
  id?: number;
  token_address: string;
  base_mint_priv_key: string;
  creator_wallet: string;
  token_name?: string;
  token_symbol?: string;
  token_metadata_url: string;
  presale_tokens?: string[];
  creator_twitter?: string;
  creator_github?: string;
  status: string;
  escrow_pub_key?: string;
  escrow_priv_key?: string;
  tokens_bought?: string;
  launched_at?: Date;
  base_mint_address?: string;
  vesting_duration_hours?: number;
  ca_ending?: string;
  created_at?: Date;
}

export interface PresaleBid {
  id?: number;
  presale_id: number;
  token_address: string;
  wallet_address: string;
  amount_lamports: bigint;
  transaction_signature: string;
  block_time?: number;
  slot?: bigint;
  verified_at?: Date;
  created_at?: Date;
}

export interface PresaleClaim {
  id?: number;
  presale_id: number;
  wallet_address: string;
  tokens_allocated: string;
  tokens_claimed: string;
  last_claim_at?: Date;
  vesting_start_at: Date;
  created_at?: Date;
  updated_at?: Date;
}

export interface PresaleClaimTransaction {
  id?: number;
  presale_id: number;
  wallet_address: string;
  amount_claimed: string;
  transaction_signature: string;
  block_time?: number;
  slot?: bigint;
  verified_at: Date;
  created_at?: Date;
}

export interface Contribution {
  id?: number;
  discord_id: string;
  pr: string;
  reward_zc: string;
  reward_usd: string;
  time: number;
  created_at?: Date;
}

// ============================================================================
// ICO Types
// ============================================================================

export interface IcoSale {
  id?: number;
  token_address: string;
  creator_wallet: string;
  token_metadata_url: string;
  total_tokens_for_sale: bigint; // Total tokens for sale
  token_price_sol: string; // Price per token in SOL (e.g., "0.00001428571")
  token_decimals: number; // Token decimals (e.g., 9 for most SPL tokens)
  tokens_sold?: bigint; // Calculated from purchases (not stored in DB)
  total_sol_raised?: bigint; // Calculated from purchases in lamports (not stored in DB)
  status: 'active' | 'finalized'; // active -> finalized (when sold out, claiming enabled)
  escrow_pub_key?: string;
  escrow_priv_key?: string; // Encrypted
  vault_token_account?: string; // Where 50% of tokens go immediately
  treasury_wallet?: string; // Where SOL goes (manual transfer)
  treasury_sol_amount: bigint; // Portion of raised SOL for treasury (AMM amount = total - treasury)
  created_at?: Date;
}

export interface IcoPurchase {
  id?: number;
  ico_sale_id: number;
  wallet_address: string;
  sol_amount_lamports: bigint; // SOL sent by user
  tokens_bought: bigint; // Total tokens (100%)
  tokens_to_vault?: bigint; // 50% sent to vault immediately (calculated, not stored in DB)
  tokens_claimable?: bigint; // 50% claimable after sale finalizes (calculated, not stored in DB)
  transaction_signature: string;
  created_at?: Date;
}

export interface IcoClaim {
  id?: number;
  ico_sale_id: number;
  wallet_address: string;
  tokens_claimable?: bigint; // Calculated from purchases (not stored in DB)
  tokens_claimed: bigint; // Amount claimed
  claim_transaction_signature?: string;
  claimed_at?: Date;
  created_at?: Date;
  updated_at?: Date;
}
