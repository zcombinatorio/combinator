/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Z Combinator
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

export interface Bookbuilding {
  id?: number;
  token_address: string;
  token_supply: bigint;
  token_decimals: number;
  creator_wallet: string;
  contribution_token_mint: string;
  contribution_token_decimals: number;
  vesting_duration_seconds: bigint;
  vesting_cliff_seconds?: bigint;
  clearing_fdv?: bigint;
  amm_pool_address?: string;
  escrow_public_key: string;
  escrow_priv_key: string;
  status: 'pending' | 'launched';
  created_at?: Date;
  launched_at?: Date;
}

export interface BookbuildingBid {
  id?: number;
  bookbuilding_id: number;
  user_wallet: string;
  bid_amount: bigint;
  max_fdv: bigint;
  transaction_signature: string;
  withdrawn: boolean;
  withdrawal_signature?: string;
  qualifying?: boolean;
  tokens_allocated: bigint;
  created_at?: Date;
}

export interface BookbuildingClaim {
  id?: number;
  bookbuilding_id: number;
  user_wallet: string;
  tokens_allocated: bigint;
  tokens_claimed: bigint;
  vesting_start_at: Date;
  last_claim_at?: Date;
  created_at?: Date;
}
