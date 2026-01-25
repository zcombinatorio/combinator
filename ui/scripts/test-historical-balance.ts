/*
 * Test script for historical balance calculation
 * Tests the actual calculateAverageBalance implementation from lib/historicalBalance.ts
 *
 * Usage:
 *   npx tsx scripts/test-historical-balance.ts [wallet] [token] [decimals]
 *   npx tsx scripts/test-historical-balance.ts  # uses defaults
 */

import 'dotenv/config';
import { Connection } from '@solana/web3.js';
import { calculateAverageBalance } from '../lib/historicalBalance';

// Default test configuration
const DEFAULT_WALLET = 'EtdhMR3yYHsUP3cm36X83SpvnL5jB48p5b653pqLC23C';
const DEFAULT_TOKEN = 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC';

const TEST_WALLET = process.argv[2] || DEFAULT_WALLET;
const TEST_TOKEN = process.argv[3] || DEFAULT_TOKEN;
const TOKEN_DECIMALS = parseInt(process.argv[4] || '6', 10);
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

function formatTokenAmount(raw: bigint): string {
  const divisor = BigInt(10 ** TOKEN_DECIMALS);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  const fractionStr = fraction.toString().padStart(TOKEN_DECIMALS, '0');
  return `${whole.toLocaleString()}.${fractionStr}`;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Historical Balance Test (using lib/historicalBalance.ts)');
  console.log('='.repeat(60));
  console.log(`\nWallet: ${TEST_WALLET}`);
  console.log(`Token:  ${TEST_TOKEN}`);
  console.log(`RPC:    ${RPC_URL}`);

  if (!process.env.HELIUS_API_KEY) {
    console.error('\nError: HELIUS_API_KEY environment variable not set');
    process.exit(1);
  }

  const connection = new Connection(RPC_URL);

  // Test with different time periods
  const testPeriods = [1, 24, 168, 720]; // 1h, 1d, 1w, 1mo

  for (const hours of testPeriods) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing ${hours} hour period`);
    console.log('='.repeat(60));

    try {
      const result = await calculateAverageBalance(connection, TEST_WALLET, TEST_TOKEN, hours);

      console.log(`\nRESULT for ${hours}h period:`);
      console.log(`  Current balance:  ${formatTokenAmount(result.currentBalance)} (raw: ${result.currentBalance})`);
      console.log(`  Average balance:  ${formatTokenAmount(result.averageBalance)} (raw: ${result.averageBalance})`);
      console.log(`  Transfer count:   ${result.transferCount}`);

      if (result.currentBalance > 0) {
        const ratio = Number(result.averageBalance) / Number(result.currentBalance);
        console.log(`  Avg/Current ratio: ${(ratio * 100).toFixed(2)}%`);
      }
    } catch (error) {
      console.error(`\nError: ${error}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Test complete');
  console.log('='.repeat(60));
}

main().catch(console.error);
