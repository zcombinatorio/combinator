/**
 * List all Meteora LP positions owned by a given wallet
 * Works for both DLMM and DAMM positions
 *
 * Usage:
 *   1. Update OWNER_ADDRESS below
 *   2. Run: pnpm ts-node scripts/list-owner-positions.ts
 */
import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';

// ============================================================================
// CONFIGURATION - Update these values before running
// ============================================================================

// Owner wallet address to query
const OWNER_ADDRESS = '6VnokgtsvgbwXuP9mSiMVXkjo8iLNZJRrpA1bMy3rwqe';

// ============================================================================

// Known pools for context
const KNOWN_POOLS: Record<string, { ticker: string; type: string }> = {
  '7jbhVZcYqCRmciBcZzK8L5B96Pyw7i1SpXQFKBkzD3G2': { ticker: 'ZC', type: 'DLMM' },
  '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX': { ticker: 'OOGWAY', type: 'DAMM' },
  'Ez1QYeC95xJRwPA9SR7YWC1H1Tj43exJr91QqKf8Puu1': { ticker: 'SURF', type: 'DAMM' },
  'PS3rPSb49GnAkmh3tec1RQizgNSb1hUwPsYHGGuAy5r': { ticker: 'SURFTEST', type: 'DAMM' },
  'EC7MUufEpZcRZyXTFt16MMNLjJVnj9Vkku4UwdZ713Hx': { ticker: 'TESTSURF', type: 'DLMM' },
};

async function listOwnerPositions() {
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) {
    console.error('RPC_URL environment variable is required');
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const owner = new PublicKey(OWNER_ADDRESS);

  console.log('=== Owner Positions ===');
  console.log(`Owner: ${OWNER_ADDRESS}`);
  console.log('');

  try {
    // Query DLMM positions
    console.log('--- DLMM Positions ---');
    const dlmmPositions = await connection.getProgramAccounts(
      new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'), // DLMM program
      {
        filters: [
          { memcmp: { offset: 40, bytes: owner.toBase58() } }, // owner at offset 40
        ],
      }
    );

    if (dlmmPositions.length === 0) {
      console.log('No DLMM positions found\n');
    } else {
      console.log(`Found ${dlmmPositions.length} DLMM position(s):\n`);
      for (const pos of dlmmPositions) {
        const data = pos.account.data;
        const lbPair = new PublicKey(data.slice(8, 40));
        const poolInfo = KNOWN_POOLS[lbPair.toBase58()];

        console.log(`Position: ${pos.pubkey.toBase58()}`);
        console.log(`  Pool: ${lbPair.toBase58()}`);
        if (poolInfo) {
          console.log(`  Ticker: ${poolInfo.ticker} (${poolInfo.type})`);
        }
        console.log('');
      }
    }

    // Query DAMM positions
    console.log('--- DAMM Positions ---');
    const dammPositions = await connection.getProgramAccounts(
      new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'), // CP-AMM program
      {
        filters: [
          { memcmp: { offset: 40, bytes: owner.toBase58() } }, // owner at offset 40
        ],
      }
    );

    if (dammPositions.length === 0) {
      console.log('No DAMM positions found\n');
    } else {
      console.log(`Found ${dammPositions.length} DAMM position(s):\n`);
      for (const pos of dammPositions) {
        const data = pos.account.data;
        const pool = new PublicKey(data.slice(8, 40));
        const poolInfo = KNOWN_POOLS[pool.toBase58()];

        console.log(`Position: ${pos.pubkey.toBase58()}`);
        console.log(`  Pool: ${pool.toBase58()}`);
        if (poolInfo) {
          console.log(`  Ticker: ${poolInfo.ticker} (${poolInfo.type})`);
        }
        console.log('');
      }
    }

    // Summary
    const totalPositions = dlmmPositions.length + dammPositions.length;
    console.log('--- Summary ---');
    console.log(`Total: ${totalPositions} position(s)`);
    console.log(`  DLMM: ${dlmmPositions.length}`);
    console.log(`  DAMM: ${dammPositions.length}`);

  } catch (error) {
    console.error('Error fetching positions:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  listOwnerPositions();
}

export { listOwnerPositions };
