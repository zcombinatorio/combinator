/*
 * Script to check DAO data in database
 * Usage: DAO_PDA="..." pnpm tsx scripts/check-dao-db.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DB_URL });

async function main() {
  const daoPda = process.env.DAO_PDA;

  if (!daoPda) {
    console.log('Fetching all recent DAOs...\n');
    const result = await pool.query(`
      SELECT id, dao_pda, dao_name, dao_type, owner_wallet, pool_type, quote_mint, withdrawal_percentage, created_at
      FROM cmb_daos
      ORDER BY created_at DESC
      LIMIT 5
    `);
    console.log('Recent DAOs:');
    for (const row of result.rows) {
      console.log(`  ID: ${row.id}`);
      console.log(`    DAO PDA: ${row.dao_pda}`);
      console.log(`    Name: ${row.dao_name}`);
      console.log(`    Type: ${row.dao_type}`);
      console.log(`    Owner: ${row.owner_wallet}`);
      console.log(`    Pool Type: ${row.pool_type}`);
      console.log(`    Quote Mint: ${row.quote_mint}`);
      console.log(`    Withdrawal %: ${row.withdrawal_percentage}`);
      console.log(`    Created: ${row.created_at}`);
      console.log('');
    }
  } else {
    console.log(`Fetching DAO: ${daoPda}\n`);
    const daoResult = await pool.query(`
      SELECT * FROM cmb_daos WHERE dao_pda = $1
    `, [daoPda]);

    if (daoResult.rows.length === 0) {
      console.log('DAO not found');
    } else {
      const dao = daoResult.rows[0];
      // Rename DB columns to API field names for consistency
      const { treasury_multisig, mint_auth_multisig, ...rest } = dao;
      const output = {
        ...rest,
        treasury_vault: treasury_multisig,
        mint_vault: mint_auth_multisig,
      };
      console.log('DAO Details:');
      console.log(JSON.stringify(output, null, 2));

      // Check proposers
      const proposersResult = await pool.query(`
        SELECT * FROM cmb_dao_proposers WHERE dao_id = $1
      `, [dao.id]);
      console.log(`\nProposers (${proposersResult.rows.length}):`);
      for (const p of proposersResult.rows) {
        console.log(`  - ${p.proposer_wallet} (added by ${p.added_by})`);
      }
    }
  }

  await pool.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
