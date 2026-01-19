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
 * Fetch migration data from os-percent database
 *
 * Queries the old system's database to extract:
 * - Moderator state (proposal counters)
 * - Historical proposals (titles, descriptions, outcomes)
 *
 * Usage:
 *   DB_URL="postgresql://..." pnpm tsx scripts/fetch-migration-data.ts
 *
 * Or use the os-percent DB_URL from .env:
 *   source ../os-percent/.env && pnpm tsx scripts/fetch-migration-data.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';

// Moderator ID to DAO name mapping (from os-percent/src/config/pools.ts)
const MODERATOR_MAP: Record<number, { name: string; ticker: string }> = {
  2: { name: 'ZC', ticker: 'ZC' },
  3: { name: 'OOGWAY', ticker: 'OOGWAY' },
  4: { name: 'SURFTEST', ticker: 'SURFTEST' },
  5: { name: 'TESTSURF', ticker: 'TESTSURF' },
  6: { name: 'SURF', ticker: 'SURF' },
};

// Filter to specific DAOs if needed
const TARGET_MODERATOR_IDS = process.env.MODERATOR_IDS
  ? process.env.MODERATOR_IDS.split(',').map(Number)
  : [2, 4, 5, 6]; // ZC, SURFTEST, TESTSURF, SURF by default

interface ModeratorState {
  id: number;
  proposal_id_counter: number;
  protocol_name: string | null;
  config: Record<string, unknown>;
}

interface Proposal {
  id: number;
  moderator_id: number;
  proposal_id: number;
  title: string | null;
  description: string | null;
  status: string;
  created_at: Date;
  finalized_at: Date;
  proposal_length: number;
  base_mint: string;
  quote_mint: string;
}

async function fetchModerators(pool: Pool): Promise<ModeratorState[]> {
  const result = await pool.query<ModeratorState>(`
    SELECT id, proposal_id_counter, protocol_name, config
    FROM moderator_state
    WHERE id = ANY($1)
    ORDER BY id
  `, [TARGET_MODERATOR_IDS]);

  return result.rows;
}

async function fetchProposals(pool: Pool, moderatorId: number): Promise<Proposal[]> {
  const result = await pool.query<Proposal>(`
    SELECT
      id,
      moderator_id,
      proposal_id,
      title,
      description,
      status,
      created_at,
      finalized_at,
      proposal_length,
      base_mint,
      quote_mint
    FROM proposals
    WHERE moderator_id = $1
    ORDER BY proposal_id ASC
  `, [moderatorId]);

  return result.rows;
}

function statusToWinningIdx(status: string): number {
  // Passed = 0 (pass option won), Failed = 1 (fail option won)
  switch (status.toLowerCase()) {
    case 'passed':
      return 0;
    case 'failed':
      return 1;
    default:
      console.warn(`  ⚠ Unknown status: ${status}, defaulting to 1 (failed)`);
      return 1;
  }
}

async function main() {
  const dbUrl = process.env.DB_URL;
  if (!dbUrl) {
    console.error('Error: DB_URL environment variable is required');
    console.error('Usage: DB_URL="postgresql://..." pnpm tsx scripts/fetch-migration-data.ts');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });

  try {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║           Fetching Migration Data from os-percent                ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');

    // Fetch moderator state
    console.log('Fetching moderator states...\n');
    const moderators = await fetchModerators(pool);

    if (moderators.length === 0) {
      console.log('No moderators found for IDs:', TARGET_MODERATOR_IDS);
      return;
    }

    // Output for use in migration scripts
    console.log('=== MODERATOR DATA (for migrate-historical-daos.ts) ===\n');

    for (const mod of moderators) {
      const daoInfo = MODERATOR_MAP[mod.id] || { name: `UNKNOWN_${mod.id}`, ticker: `UNK${mod.id}` };
      console.log(`${daoInfo.name}:`);
      console.log(`  moderatorId: ${mod.id}`);
      console.log(`  proposalIdCounter: ${mod.proposal_id_counter}`);
      console.log(`  protocolName: ${mod.protocol_name || 'null'}`);
      console.log('');
    }

    // Fetch proposals for each moderator
    console.log('\n=== PROPOSAL DATA (for migrate-historical-proposals.ts) ===\n');

    const allProposalData: Record<string, Array<{
      proposalId: number;
      title: string;
      description: string;
      winningIdx: number;
      length: number;
      createdAt: number;
      status: string;
    }>> = {};

    for (const mod of moderators) {
      const daoInfo = MODERATOR_MAP[mod.id] || { name: `UNKNOWN_${mod.id}`, ticker: `UNK${mod.id}` };
      const proposals = await fetchProposals(pool, mod.id);

      console.log(`${daoInfo.name} (moderatorId: ${mod.id}) - ${proposals.length} proposals:`);

      if (proposals.length === 0) {
        console.log('  No proposals found\n');
        continue;
      }

      allProposalData[daoInfo.name] = [];

      for (const prop of proposals) {
        const winningIdx = statusToWinningIdx(prop.status);
        const createdAtUnix = Math.floor(new Date(prop.created_at).getTime() / 1000);

        console.log(`  Proposal #${prop.proposal_id}:`);
        console.log(`    title: "${prop.title || 'Untitled'}"`);
        console.log(`    description: "${(prop.description || '').substring(0, 50)}${(prop.description?.length || 0) > 50 ? '...' : ''}"`);
        console.log(`    status: ${prop.status} (winningIdx: ${winningIdx})`);
        console.log(`    length: ${prop.proposal_length} seconds`);
        console.log(`    createdAt: ${createdAtUnix} (${prop.created_at})`);
        console.log('');

        allProposalData[daoInfo.name].push({
          proposalId: prop.proposal_id,
          title: prop.title || 'Untitled',
          description: prop.description || '',
          winningIdx,
          length: Number(prop.proposal_length),
          createdAt: createdAtUnix,
          status: prop.status,
        });
      }
    }

    // Output JSON for easy copy-paste into migration scripts
    console.log('\n=== JSON OUTPUT (copy into migration scripts) ===\n');
    console.log('// Moderator proposal counters');
    console.log('const PROPOSAL_COUNTERS: Record<string, number> = {');
    for (const mod of moderators) {
      const daoInfo = MODERATOR_MAP[mod.id] || { name: `UNKNOWN_${mod.id}`, ticker: `UNK${mod.id}` };
      console.log(`  ${daoInfo.name}: ${mod.proposal_id_counter},`);
    }
    console.log('};\n');

    console.log('// Historical proposals by DAO');
    console.log('const HISTORICAL_PROPOSALS: Record<string, Array<{');
    console.log('  proposalId: number;');
    console.log('  title: string;');
    console.log('  description: string;');
    console.log('  winningIdx: number;');
    console.log('  length: number;');
    console.log('  createdAt: number;');
    console.log('}>> = ');
    console.log(JSON.stringify(allProposalData, null, 2) + ';\n');

  } catch (error) {
    console.error('Error fetching migration data:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
