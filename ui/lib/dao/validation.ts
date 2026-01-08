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

import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { getMint, getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { futarchy } from '@zcomb/programs-sdk';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import DLMM from '@meteora-ag/dlmm';
import { isProposer, getProposerThreshold } from '../db/daos';
import { getPool } from '../db';

export interface ProposerAuthorizationResult {
  isAuthorized: boolean;
  authMethod: 'whitelist' | 'token_balance' | null;
  reason?: string;
}

export interface DaoReadinessError {
  ready: false;
  reason: string;
}

export interface DaoReadinessOk {
  ready: true;
}

export type DaoReadinessResult = DaoReadinessOk | DaoReadinessError;

/**
 * Type guard to check if a DaoReadinessResult is an error
 */
export function isDaoReadinessError(result: DaoReadinessResult): result is DaoReadinessError {
  return !result.ready;
}

/**
 * Check if a wallet is authorized to propose for a specific DAO using DB settings.
 * Each DAO (parent or child) has independent whitelist and token threshold.
 *
 * Authorization flow:
 * 1. Check if wallet is in DAO's DB whitelist (fast, no RPC)
 * 2. If not whitelisted AND threshold is set, check token balance (RPC call)
 * 3. Otherwise deny (creator is always on whitelist by default)
 */
export async function checkDaoProposerAuthorization(
  connection: Connection,
  pool: ReturnType<typeof getPool>,
  daoId: number,
  wallet: string,
  tokenMint: string
): Promise<ProposerAuthorizationResult> {
  // 1. Check DB whitelist first (fast, no RPC)
  const onWhitelist = await isProposer(pool, daoId, wallet);
  if (onWhitelist) {
    return { isAuthorized: true, authMethod: 'whitelist' };
  }

  // 2. Get the DAO's token threshold setting
  const threshold = await getProposerThreshold(pool, daoId);

  // 3. If threshold is set, check token balance
  if (threshold && threshold !== '0') {
    const walletPubkey = new PublicKey(wallet);
    const mintPubkey = new PublicKey(tokenMint);

    try {
      const ata = await getAssociatedTokenAddress(mintPubkey, walletPubkey);
      const account = await getAccount(connection, ata);
      const balance = account.amount;
      const minBalanceRaw = BigInt(threshold);

      if (balance >= minBalanceRaw) {
        return { isAuthorized: true, authMethod: 'token_balance' };
      }

      // Has threshold requirement but balance too low
      return {
        isAuthorized: false,
        authMethod: null,
        reason: `Wallet not whitelisted and token balance (${balance.toString()}) is below required threshold (${threshold})`,
      };
    } catch {
      // Token account doesn't exist = 0 balance
      return {
        isAuthorized: false,
        authMethod: null,
        reason: `Wallet not whitelisted and no token balance (required: ${threshold})`,
      };
    }
  }

  // 4. Not whitelisted and no token threshold set - deny
  // (DAO creator is always added to whitelist on creation)
  return {
    isAuthorized: false,
    authMethod: null,
    reason: 'Wallet not on proposer whitelist for this DAO',
  };
}

/**
 * Check if mint_auth_multisig is the mint authority for token_mint
 */
export async function checkMintAuthority(
  connection: Connection,
  mintAuthMultisig: string,
  tokenMint: string
): Promise<DaoReadinessResult> {
  const mintAuthPubkey = new PublicKey(mintAuthMultisig);
  const tokenMintPubkey = new PublicKey(tokenMint);

  try {
    const mintInfo = await getMint(connection, tokenMintPubkey);

    if (!mintInfo.mintAuthority) {
      return {
        ready: false,
        reason: 'Token mint has no mint authority (authority is null)',
      };
    }

    if (!mintInfo.mintAuthority.equals(mintAuthPubkey)) {
      return {
        ready: false,
        reason: `Mint authority mismatch: expected ${mintAuthMultisig}, got ${mintInfo.mintAuthority.toBase58()}`,
      };
    }

    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      reason: `Failed to fetch mint info: ${String(error)}`,
    };
  }
}

/**
 * Check if token_mint matches the base token of the pool (parent DAOs only)
 */
export async function checkTokenMatchesPoolBase(
  connection: Connection,
  tokenMint: string,
  poolAddress: string,
  poolType: 'damm' | 'dlmm'
): Promise<DaoReadinessResult> {
  const poolPubkey = new PublicKey(poolAddress);

  try {
    let baseToken: string;

    if (poolType === 'damm') {
      const cpAmm = new CpAmm(connection);
      const poolState = await cpAmm.fetchPoolState(poolPubkey);
      // In DAMM, tokenA is typically the base token
      baseToken = poolState.tokenAMint.toBase58();
    } else {
      const dlmmPool = await DLMM.create(connection, poolPubkey);
      // In DLMM, tokenX is typically the base token
      baseToken = dlmmPool.lbPair.tokenXMint.toBase58();
    }

    if (baseToken !== tokenMint) {
      return {
        ready: false,
        reason: `Token mint does not match pool base token: expected ${baseToken}, got ${tokenMint}`,
      };
    }

    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      reason: `Failed to fetch pool info: ${String(error)}`,
    };
  }
}

/**
 * Check if admin wallet holds LP tokens for the pool
 * For child DAOs, checks the parent's admin wallet holds LP
 */
export async function checkAdminHoldsLP(
  connection: Connection,
  adminWallet: string,
  poolAddress: string,
  poolType: 'damm' | 'dlmm'
): Promise<DaoReadinessResult> {
  const adminPubkey = new PublicKey(adminWallet);
  const poolPubkey = new PublicKey(poolAddress);

  try {
    if (poolType === 'damm') {
      // For DAMM v2, check position accounts (not LP tokens)
      const cpAmm = new CpAmm(connection);
      const userPositions = await cpAmm.getUserPositionByPool(poolPubkey, adminPubkey);

      if (userPositions.length > 0) {
        // Check if any position has liquidity
        const hasLiquidity = userPositions.some(pos =>
          !pos.positionState.unlockedLiquidity.isZero()
        );

        if (hasLiquidity) {
          return { ready: true };
        }
      }

      return {
        ready: false,
        reason: 'Admin wallet holds no LP positions for the DAMM pool',
      };
    } else {
      // For DLMM, check positions
      const dlmmPool = await DLMM.create(connection, poolPubkey);
      const positions = await dlmmPool.getPositionsByUserAndLbPair(adminPubkey);

      if (positions.userPositions.length > 0) {
        // Check if any position has liquidity (amounts are strings, convert to BN)
        const hasLiquidity = positions.userPositions.some(pos => {
          const xAmount = new BN(pos.positionData.totalXAmount || 0);
          const yAmount = new BN(pos.positionData.totalYAmount || 0);
          return !xAmount.isZero() || !yAmount.isZero();
        });

        if (hasLiquidity) {
          return { ready: true };
        }
      }

      return {
        ready: false,
        reason: 'Admin wallet holds no LP positions for the DLMM pool',
      };
    }
  } catch (error) {
    return {
      ready: false,
      reason: `Failed to check LP holdings: ${String(error)}`,
    };
  }
}

/**
 * Check if there's already an active proposal for this moderator.
 *
 * IMPORTANT: Child DAOs share their parent's moderator_pda, so this check
 * naturally prevents sibling DAOs from creating proposals while one is active.
 * This is the desired behavior since they share liquidity from the parent's pool.
 */
export async function checkNoActiveProposal(
  connection: Connection,
  moderatorPda: string,
  mockMode: boolean = false
): Promise<DaoReadinessResult> {
  if (mockMode) {
    return { ready: true };
  }

  try {
    // Create a read-only provider (no wallet needed for fetching)
    const dummyWallet = {
      publicKey: PublicKey.default,
      signTransaction: async () => { throw new Error('Read-only'); },
      signAllTransactions: async () => { throw new Error('Read-only'); },
    } as unknown as Wallet;
    const provider = new AnchorProvider(connection, dummyWallet, { commitment: 'confirmed' });
    const client = new futarchy.FutarchyClient(provider);
    const moderatorPubkey = new PublicKey(moderatorPda);

    // Fetch moderator account to get proposal counter
    const moderator = await client.fetchModerator(moderatorPubkey);

    // No proposals ever created = ready to create first one
    if (moderator.proposalIdCounter === 0) {
      return { ready: true };
    }

    // Check the latest proposal (ID = counter - 1)
    const latestProposalId = moderator.proposalIdCounter - 1;
    const [proposalPda] = client.deriveProposalPDA(moderatorPubkey, latestProposalId);

    let proposal;
    try {
      proposal = await client.fetchProposal(proposalPda);
    } catch (fetchError) {
      // Proposal account doesn't exist (maybe closed) - OK to proceed
      console.log(`Could not fetch proposal ${latestProposalId}, proceeding:`, fetchError);
      return { ready: true };
    }

    // Check proposal state - only block if Pending and not expired
    // Setup state is allowed: each proposal has its own vault/pools (no shared state)
    // ProposalState is an enum-like object: { setup: {} } | { pending: {} } | { resolved: {} }
    const stateKey = Object.keys(proposal.state)[0];
    const isPending = stateKey === 'pending';
    const isExpired = client.isProposalExpired(proposal);

    if (isPending && !isExpired) {
      const timeRemaining = client.getTimeRemaining(proposal);
      const hoursRemaining = Math.ceil(timeRemaining / 3600);
      return {
        ready: false,
        reason: `Active proposal ${latestProposalId} in progress. ~${hoursRemaining}h remaining before it can be finalized.`,
      };
    }

    // Proposal is resolved or expired - ready for new proposal
    return { ready: true };
  } catch (error) {
    // If we can't check (RPC error, etc.), block proposal creation for safety
    // This is "fail closed" - we prefer correctness over availability
    console.error('Error checking for active proposal:', error);
    return {
      ready: false,
      reason: `Failed to verify proposal state: ${error instanceof Error ? error.message : String(error)}. Please try again.`,
    };
  }
}
