/*
 * Test script for historical balance calculation
 * Tests the time-weighted average balance function used for proposer threshold validation
 *
 * Usage: npx tsx scripts/test-historical-balance.ts
 */

import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';

// Test configuration
const TEST_WALLET = 'EtdhMR3yYHsUP3cm36X83SpvnL5jB48p5b653pqLC23C';
const TEST_TOKEN = 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC';
const TOKEN_DECIMALS = 6; // ZC token has 6 decimals
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

function formatTokenAmount(raw: bigint): string {
  const divisor = BigInt(10 ** TOKEN_DECIMALS);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  return `${whole.toLocaleString()}.${fraction.toString().padStart(TOKEN_DECIMALS, '0')}`;
}

interface TokenTransfer {
  timestamp: number;
  signature: string;
  fromUserAccount: string | null;
  toUserAccount: string;
  tokenAmount: number;
}

interface ParsedTransaction {
  signature: string;
  timestamp: number;
  tokenTransfers?: TokenTransfer[];
}

interface AverageBalanceResult {
  averageBalance: bigint;
  currentBalance: bigint;
  transferCount: number;
}

async function fetchWalletTokenTransfers(
  walletAddress: string,
  tokenMint: string,
  periodHours: number,
  apiKey: string
): Promise<ParsedTransaction[]> {
  const cutoffTime = Date.now() - periodHours * 60 * 60 * 1000;
  const allTransactions: ParsedTransaction[] = [];
  let lastSignature: string | undefined = undefined;

  const walletPubkey = new PublicKey(walletAddress);
  const mintPubkey = new PublicKey(tokenMint);
  const ata = getAssociatedTokenAddressSync(mintPubkey, walletPubkey, true); // allowOwnerOffCurve
  const ataAddress = ata.toBase58();

  console.log(`  ATA address: ${ataAddress}`);
  console.log(`  Cutoff time: ${new Date(cutoffTime).toISOString()}`);

  let pageCount = 0;
  while (true) {
    pageCount++;
    const params: [string, { limit: number; before?: string }] = [ataAddress, { limit: 1000 }];
    if (lastSignature) {
      params[1].before = lastSignature;
    }

    console.log(`  Fetching signatures page ${pageCount}...`);

    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'getSignaturesForAddress',
        params: params,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('HELIUS_RATE_LIMIT');
      }
      throw new Error(`Helius RPC error: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`);
    }

    if (!data.result || !Array.isArray(data.result) || data.result.length === 0) {
      console.log(`  No more signatures found`);
      break;
    }

    const signatures: string[] = [];
    let reachedCutoff = false;

    for (const sigInfo of data.result) {
      if (!sigInfo.signature) continue;

      if (sigInfo.blockTime && sigInfo.blockTime * 1000 < cutoffTime) {
        console.log(`  Reached cutoff at signature ${sigInfo.signature.slice(0, 20)}... (${new Date(sigInfo.blockTime * 1000).toISOString()})`);
        reachedCutoff = true;
        break;
      }

      signatures.push(sigInfo.signature);
    }

    console.log(`  Found ${signatures.length} signatures in time window`);

    if (signatures.length > 0) {
      const txDetails = await fetchTransactionDetails(signatures, apiKey);
      allTransactions.push(...txDetails);
      lastSignature = signatures[signatures.length - 1];
    }

    if (reachedCutoff || data.result.length < 1000) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return allTransactions;
}

async function fetchTransactionDetails(
  signatures: string[],
  apiKey: string
): Promise<ParsedTransaction[]> {
  const BATCH_SIZE = 100;
  const results: ParsedTransaction[] = [];

  for (let i = 0; i < signatures.length; i += BATCH_SIZE) {
    const chunk = signatures.slice(i, i + BATCH_SIZE);
    console.log(`  Fetching tx details batch ${Math.floor(i / BATCH_SIZE) + 1}...`);

    const response = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: chunk }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('HELIUS_RATE_LIMIT');
      }
      throw new Error(`Helius API error: ${response.statusText}`);
    }

    const data = await response.json();
    for (const tx of data) {
      if (tx && tx.signature) {
        results.push(tx);
      }
    }

    if (i + BATCH_SIZE < signatures.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}

async function calculateAverageBalance(
  connection: Connection,
  walletAddress: string,
  tokenMint: string,
  periodHours: number
): Promise<AverageBalanceResult> {
  const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

  if (!HELIUS_API_KEY) {
    throw new Error('HELIUS_API_KEY not configured');
  }

  const walletPubkey = new PublicKey(walletAddress);
  const mintPubkey = new PublicKey(tokenMint);

  // Get current balance
  let currentBalance = BigInt(0);
  try {
    const ata = getAssociatedTokenAddressSync(mintPubkey, walletPubkey, true); // allowOwnerOffCurve
    const account = await getAccount(connection, ata);
    currentBalance = account.amount;
    console.log(`  Current balance: ${currentBalance.toString()}`);
  } catch {
    console.log(`  Token account doesn't exist - balance is 0`);
  }

  // Fetch transfers within the period
  const now = Date.now();
  const periodStart = now - periodHours * 60 * 60 * 1000;

  console.log(`\nFetching transfers...`);
  const transactions = await fetchWalletTokenTransfers(walletAddress, tokenMint, periodHours, HELIUS_API_KEY);
  console.log(`  Total transactions fetched: ${transactions.length}`);

  // Filter to only transfers involving this token and wallet
  const relevantTransfers: { timestamp: number; delta: bigint; signature: string }[] = [];

  // Helius returns tokenAmount as the decimal-adjusted value
  // We need to convert to raw units by multiplying by 10^decimals

  for (const tx of transactions) {
    if (!tx.tokenTransfers) continue;

    for (const transfer of tx.tokenTransfers) {
      const isIncoming = transfer.toUserAccount === walletAddress;
      const isOutgoing = transfer.fromUserAccount === walletAddress;

      if (!isIncoming && !isOutgoing) continue;

      // Convert from decimal form to raw units
      const rawAmount = BigInt(Math.round(transfer.tokenAmount * (10 ** TOKEN_DECIMALS)));
      const delta = isIncoming ? rawAmount : -rawAmount;

      relevantTransfers.push({
        timestamp: tx.timestamp * 1000,
        delta,
        signature: tx.signature,
      });
    }
  }

  console.log(`\nRelevant transfers: ${relevantTransfers.length}`);

  // If no transfers in period, current balance has been held the entire time
  if (relevantTransfers.length === 0) {
    console.log(`  No transfers in period - current balance held entire time`);
    return {
      averageBalance: currentBalance,
      currentBalance,
      transferCount: 0,
    };
  }

  // Sort by timestamp descending (newest first)
  relevantTransfers.sort((a, b) => b.timestamp - a.timestamp);

  // Print transfer details
  console.log(`\nTransfer history (newest first):`);
  for (const transfer of relevantTransfers) {
    const deltaStr = transfer.delta >= 0 ? `+${transfer.delta}` : transfer.delta.toString();
    console.log(`  ${new Date(transfer.timestamp).toISOString()} | ${deltaStr} | ${transfer.signature.slice(0, 20)}...`);
  }

  // Walk backwards through time, calculating balance at each point
  let balance = currentBalance;
  let weightedSum = BigInt(0);
  let prevTimestamp = now;

  console.log(`\nBalance reconstruction:`);
  console.log(`  Starting from current balance: ${balance}`);

  for (const transfer of relevantTransfers) {
    const duration = prevTimestamp - Math.max(transfer.timestamp, periodStart);

    if (duration > 0) {
      const contribution = balance * BigInt(duration);
      weightedSum += contribution;
      console.log(`  Balance ${balance} held for ${(duration / 3600000).toFixed(2)}h -> contribution: ${contribution}`);
    }

    // Reverse the transfer to get balance before it happened
    balance -= transfer.delta;
    console.log(`  After reversing transfer (${transfer.delta >= 0 ? '+' : ''}${transfer.delta}): balance = ${balance}`);
    prevTimestamp = transfer.timestamp;

    if (transfer.timestamp <= periodStart) {
      break;
    }
  }

  // Add the remaining time at the earliest balance
  if (prevTimestamp > periodStart) {
    const duration = prevTimestamp - periodStart;
    const contribution = balance * BigInt(duration);
    weightedSum += contribution;
    console.log(`  Balance ${balance} held for ${(duration / 3600000).toFixed(2)}h (remainder) -> contribution: ${contribution}`);
  }

  // Calculate average
  const totalDuration = BigInt(now - periodStart);
  const averageBalance = totalDuration > 0 ? weightedSum / totalDuration : currentBalance;

  console.log(`\nCalculation:`);
  console.log(`  Weighted sum: ${weightedSum}`);
  console.log(`  Total duration (ms): ${totalDuration}`);
  console.log(`  Average balance: ${averageBalance}`);

  return {
    averageBalance,
    currentBalance,
    transferCount: relevantTransfers.length,
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Historical Balance Test');
  console.log('='.repeat(60));
  console.log(`\nWallet: ${TEST_WALLET}`);
  console.log(`Token:  ${TEST_TOKEN}`);
  console.log(`RPC:    ${RPC_URL}`);

  if (!process.env.HELIUS_API_KEY) {
    console.error('\nError: HELIUS_API_KEY environment variable not set');
    console.error('Make sure HELIUS_API_KEY is set in .env file');
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

      console.log(`\n${'─'.repeat(40)}`);
      console.log(`RESULT for ${hours}h period:`);
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
