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

/**
 * Script to fetch DAO data from the API
 *
 * Usage:
 *   # List all DAOs
 *   pnpm tsx scripts/fetch-dao.ts
 *
 *   # Get specific DAO by PDA
 *   DAO_PDA=<pda> pnpm tsx scripts/fetch-dao.ts
 *
 *   # List DAOs by owner
 *   DAO_OWNER=<wallet> pnpm tsx scripts/fetch-dao.ts
 *
 *   # List only parent or child DAOs
 *   DAO_TYPE=parent pnpm tsx scripts/fetch-dao.ts
 *   DAO_TYPE=child pnpm tsx scripts/fetch-dao.ts
 *
 * Environment variables:
 *   - API_URL: API base URL (defaults to http://localhost:3001)
 *   - DAO_PDA: (optional) Specific DAO PDA to fetch
 *   - DAO_OWNER: (optional) Filter DAOs by owner wallet
 *   - DAO_TYPE: (optional) Filter by "parent" or "child"
 */

import 'dotenv/config';

const API_URL = process.env.API_URL || 'http://localhost:3001';

interface DaoStats {
  proposerCount: number;
  childDaoCount: number;
}

interface Dao {
  id: number;
  dao_pda: string;
  dao_name: string;
  moderator_pda: string;
  owner_wallet: string;
  admin_wallet: string;
  token_mint: string;
  pool_address: string;
  pool_type: 'damm' | 'dlmm';
  quote_mint: string;
  treasury_vault: string;
  mint_vault: string;
  treasury_cosigner: string;
  parent_dao_id?: number;
  dao_type: 'parent' | 'child';
  created_at: string;
  stats?: DaoStats;
}

interface DaoListResponse {
  daos: Dao[];
}

interface DaoDetailResponse extends Dao {
  proposers: { proposer_wallet: string; created_at: string }[];
  children?: Dao[];
}

async function fetchDaoList(params?: { type?: string; owner?: string }): Promise<DaoListResponse> {
  const url = new URL(`${API_URL}/dao`);
  if (params?.type) url.searchParams.set('type', params.type);
  if (params?.owner) url.searchParams.set('owner', params.owner);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const data = await response.json();
    throw new Error(`API error: ${response.status} - ${JSON.stringify(data)}`);
  }
  return response.json();
}

async function fetchDaoDetail(daoPda: string): Promise<DaoDetailResponse> {
  const response = await fetch(`${API_URL}/dao/${daoPda}`);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(`API error: ${response.status} - ${JSON.stringify(data)}`);
  }
  return response.json();
}

function formatDao(dao: Dao, indent = ''): void {
  console.log(`${indent}DAO: ${dao.dao_name}`);
  console.log(`${indent}  PDA: ${dao.dao_pda}`);
  console.log(`${indent}  Type: ${dao.dao_type}`);
  console.log(`${indent}  Owner: ${dao.owner_wallet}`);
  console.log(`${indent}  Admin wallet: ${dao.admin_wallet}`);
  console.log(`${indent}  Token mint: ${dao.token_mint}`);
  console.log(`${indent}  Pool: ${dao.pool_address} (${dao.pool_type})`);
  console.log(`${indent}  Quote mint: ${dao.quote_mint}`);
  console.log(`${indent}  Treasury vault: ${dao.treasury_vault}`);
  console.log(`${indent}  Mint vault: ${dao.mint_vault}`);
  console.log(`${indent}  Treasury cosigner: ${dao.treasury_cosigner}`);
  if (dao.moderator_pda) {
    console.log(`${indent}  Moderator PDA: ${dao.moderator_pda}`);
  }
  if (dao.stats) {
    console.log(`${indent}  Stats:`);
    console.log(`${indent}    Proposers: ${dao.stats.proposerCount}`);
    console.log(`${indent}    Child DAOs: ${dao.stats.childDaoCount}`);
  }
  console.log(`${indent}  Created: ${dao.created_at}`);
}

async function main() {
  console.log('=== DAO Data Fetcher ===\n');
  console.log(`API URL: ${API_URL}\n`);

  const daoPda = process.env.DAO_PDA;
  const daoOwner = process.env.DAO_OWNER;
  const daoType = process.env.DAO_TYPE;

  if (daoPda) {
    // Fetch specific DAO
    console.log(`Fetching DAO: ${daoPda}\n`);

    try {
      const dao = await fetchDaoDetail(daoPda);

      formatDao(dao);

      if (dao.proposers && dao.proposers.length > 0) {
        console.log('\n  Proposers:');
        for (const proposer of dao.proposers) {
          console.log(`    - ${proposer.proposer_wallet} (added: ${proposer.created_at})`);
        }
      }

      if (dao.children && dao.children.length > 0) {
        console.log('\n  Child DAOs:');
        for (const child of dao.children) {
          formatDao(child, '    ');
          console.log('');
        }
      }
    } catch (error) {
      console.error('❌ Error fetching DAO:', error);
      process.exit(1);
    }
  } else {
    // List DAOs
    const filters: string[] = [];
    if (daoType) filters.push(`type=${daoType}`);
    if (daoOwner) filters.push(`owner=${daoOwner}`);

    if (filters.length > 0) {
      console.log(`Listing DAOs with filters: ${filters.join(', ')}\n`);
    } else {
      console.log('Listing all DAOs\n');
    }

    try {
      const response = await fetchDaoList({
        type: daoType,
        owner: daoOwner,
      });

      if (response.daos.length === 0) {
        console.log('No DAOs found.');
      } else {
        console.log(`Found ${response.daos.length} DAO(s):\n`);
        for (const dao of response.daos) {
          formatDao(dao);
          console.log('');
        }
      }
    } catch (error) {
      console.error('❌ Error listing DAOs:', error);
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
