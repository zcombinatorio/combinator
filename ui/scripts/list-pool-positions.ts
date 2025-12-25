/**
 * List all LP positions for a given Meteora pool
 * Works for both DLMM and DAMM pools
 *
 * Usage:
 *   1. Update POOL_ADDRESS and POOL_TYPE below
 *   2. Run: pnpm ts-node scripts/list-pool-positions.ts
 */
import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';

// ============================================================================
// CONFIGURATION - Update these values before running
// ============================================================================

// Pool address to query
const POOL_ADDRESS = '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX';

// Pool type: 'dlmm' or 'damm'
const POOL_TYPE: 'dlmm' | 'damm' = 'damm';

// ============================================================================

async function listPoolPositions() {
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) {
    console.error('RPC_URL environment variable is required');
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const poolAddress = new PublicKey(POOL_ADDRESS);

  console.log('=== Pool Positions ===');
  console.log(`Pool: ${POOL_ADDRESS}`);
  console.log(`Type: ${POOL_TYPE.toUpperCase()}`);
  console.log('');

  try {
    if (POOL_TYPE === 'dlmm') {
      // DLMM pool
      const dlmmPool = await DLMM.create(connection, poolAddress);

      // Get all positions for this pool
      // Note: DLMM SDK doesn't have a direct "get all positions" method,
      // so we need to query the position accounts
      const positions = await connection.getProgramAccounts(
        new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'), // DLMM program
        {
          filters: [
            { memcmp: { offset: 8, bytes: poolAddress.toBase58() } }, // lbPair at offset 8
          ],
        }
      );

      console.log(`Found ${positions.length} position(s):\n`);

      for (const pos of positions) {
        // Parse position data to get owner
        // Position account structure: discriminator (8) + lbPair (32) + owner (32) + ...
        const data = pos.account.data;
        const owner = new PublicKey(data.slice(40, 72));

        console.log(`Position: ${pos.pubkey.toBase58()}`);
        console.log(`  Owner: ${owner.toBase58()}`);
        console.log('');
      }

    } else {
      // DAMM pool
      const cpAmm = new CpAmm(connection);

      // Get all positions for this pool using program accounts
      const positions = await connection.getProgramAccounts(
        new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'), // CP-AMM program
        {
          filters: [
            { memcmp: { offset: 8, bytes: poolAddress.toBase58() } }, // pool at offset 8
          ],
        }
      );

      console.log(`Found ${positions.length} position(s):\n`);

      for (const pos of positions) {
        // Parse position data to get owner
        // Position account structure: discriminator (8) + pool (32) + owner (32) + ...
        const data = pos.account.data;
        const owner = new PublicKey(data.slice(40, 72));

        console.log(`Position: ${pos.pubkey.toBase58()}`);
        console.log(`  Owner: ${owner.toBase58()}`);
        console.log('');
      }
    }

  } catch (error) {
    console.error('Error fetching positions:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  listPoolPositions();
}

export { listPoolPositions };
