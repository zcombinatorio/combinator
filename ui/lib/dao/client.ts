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
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { futarchy } from '@zcomb/programs-sdk';
import { Pool } from 'pg';

import { Dao } from '../db/types';
import { getDaoById } from '../db/daos';

/**
 * Create a read-only FutarchyClient for fetching on-chain data.
 * This client cannot sign transactions.
 */
export function createReadOnlyClient(connection: Connection): futarchy.FutarchyClient {
  const readProvider = new AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async () => { throw new Error('Read-only client cannot sign'); },
      signAllTransactions: async () => { throw new Error('Read-only client cannot sign'); },
    } as unknown as Wallet,
    { commitment: 'confirmed', skipPreflight: true }
  );
  return new futarchy.FutarchyClient(readProvider);
}

/**
 * Resolve the DAO that manages liquidity for a given DAO.
 * For parent DAOs, returns the DAO itself.
 * For child DAOs, returns the parent DAO (which owns the LP).
 */
export async function resolveLiquidityDao(pool: Pool, dao: Dao): Promise<Dao> {
  if (dao.dao_type === 'child' && dao.parent_dao_id) {
    const parentDao = await getDaoById(pool, dao.parent_dao_id);
    if (parentDao) {
      return parentDao;
    }
  }
  return dao;
}

/**
 * Fetch a proposal from on-chain and parse its state.
 * Returns null if proposal not found.
 */
export async function fetchProposalWithState(
  client: futarchy.FutarchyClient,
  proposalPda: PublicKey
): Promise<{
  proposal: Awaited<ReturnType<typeof client.fetchProposal>>;
  state: ReturnType<typeof futarchy.parseProposalState>;
} | null> {
  try {
    const proposal = await client.fetchProposal(proposalPda);
    const state = futarchy.parseProposalState(proposal.state);
    return { proposal, state };
  } catch {
    return null;
  }
}
