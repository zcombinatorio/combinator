#!/usr/bin/env tsx

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { config } from 'dotenv';

config();

interface MismatchedTransfer {
  signature: string;
  solIn: number;
  solInFrom: string;
  wsolOut: number;
  wsolOutTo: string;
  difference: number;
  txType: string;
  txSource: string;
  blockTime: number;
  date: string;
}

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

interface CachedData {
  wallet: string;
  fetchedAt: string;
  minSolChange: number;
  periodDays: number;
  sumOfDiffs: number;
  transfers: MismatchedTransfer[];
}

const WALLET = 'Hq7Xh37tT4sesD6wA4DphYfxeMJRhhFWS3KVUSSGjqzc';
const MIN_SOL_CHANGE = 0.05;
const PERIOD_DAYS = 70;
const OUTPUT_FILE = 'data/large-sol-changes.json';

async function fetchMismatchedTransfers(): Promise<MismatchedTransfer[]> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error('Error: HELIUS_API_KEY environment variable is required');
    process.exit(1);
  }

  const periodAgo = Math.floor(Date.now() / 1000) - (PERIOD_DAYS * 24 * 60 * 60);
  const now = Math.floor(Date.now() / 1000);

  console.log(`Fetching transactions for wallet: ${WALLET}`);
  console.log(`Period: past ${PERIOD_DAYS} days (since ${new Date(periodAgo * 1000).toISOString()})`);
  console.log(`Looking for: Large SOL IN + Large WSOL OUT where amounts differ`);
  console.log(`Minimum transfer: ${MIN_SOL_CHANGE} SOL`);
  console.log('---');

  // Step 1: Get signatures
  let paginationToken: string | undefined;
  const signatures: string[] = [];

  console.log('Fetching signatures...');
  do {
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransactionsForAddress',
        params: [
          WALLET,
          {
            transactionDetails: 'signatures',
            sortOrder: 'desc',
            limit: 1000,
            ...(paginationToken && { paginationToken }),
            filters: {
              blockTime: { gte: periodAgo, lte: now },
              status: 'succeeded'
            }
          }
        ]
      })
    });

    const data = await response.json();
    if (data.error) {
      console.error('API Error:', data.error);
      process.exit(1);
    }

    paginationToken = data.result?.paginationToken;
    for (const sig of data.result?.data || []) {
      signatures.push(sig.signature);
    }
    console.log(`  Found ${signatures.length} signatures...`);
  } while (paginationToken);

  console.log(`\nTotal signatures: ${signatures.length}`);

  // Step 2: Fetch parsed transactions in batches
  console.log('Fetching parsed transaction details...');
  const results: MismatchedTransfer[] = [];
  const batchSize = 100;

  for (let i = 0; i < signatures.length; i += batchSize) {
    const batch = signatures.slice(i, i + batchSize);

    const response = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: batch })
    });

    const parsedTxs = await response.json();
    console.log(`  Processing ${Math.min(i + batchSize, signatures.length)}/${signatures.length}...`);

    // Step 3: Find mismatched transfers
    for (const tx of parsedTxs) {
      if (!tx) continue;

      // Find large SOL inbound (native transfers TO wallet, excluding internal WSOL wrapping)
      let solIn = 0;
      let solInFrom = '';
      for (const t of tx.nativeTransfers || []) {
        const amount = t.amount / 1e9;
        if (t.toUserAccount === WALLET && t.fromUserAccount !== WALLET && amount >= MIN_SOL_CHANGE) {
          // Skip if from an ephemeral WSOL account (these are internal)
          const isFromWsolAccount = (tx.nativeTransfers || []).some(
            (nt: any) => nt.toUserAccount === t.fromUserAccount && nt.fromUserAccount === WALLET
          );
          if (!isFromWsolAccount) {
            solIn = amount;
            solInFrom = t.fromUserAccount;
          }
        }
      }

      // Find large WSOL outbound (token transfers FROM wallet)
      let wsolOut = 0;
      let wsolOutTo = '';
      for (const t of tx.tokenTransfers || []) {
        if (t.mint === WSOL_MINT && t.fromUserAccount === WALLET && t.tokenAmount >= MIN_SOL_CHANGE) {
          wsolOut = t.tokenAmount;
          wsolOutTo = t.toUserAccount;
        }
      }

      // Check if we have both and they're different
      if (solIn >= MIN_SOL_CHANGE && wsolOut >= MIN_SOL_CHANGE && Math.abs(solIn - wsolOut) >= 1) {
        results.push({
          signature: tx.signature,
          solIn,
          solInFrom,
          wsolOut,
          wsolOutTo,
          difference: solIn - wsolOut,
          txType: tx.type || 'UNKNOWN',
          txSource: tx.source || 'UNKNOWN',
          blockTime: tx.timestamp,
          date: new Date(tx.timestamp * 1000).toISOString()
        });
      }
    }
  }

  // Sort by blockTime descending
  results.sort((a, b) => b.blockTime - a.blockTime);

  console.log(`\nFound ${results.length} transactions with mismatched SOL IN / WSOL OUT`);
  return results;
}

async function main() {
  // Check for cached data
  if (existsSync(OUTPUT_FILE)) {
    const cached: CachedData = JSON.parse(readFileSync(OUTPUT_FILE, 'utf-8'));
    const cacheAge = Date.now() - new Date(cached.fetchedAt).getTime();
    const cacheAgeHours = (cacheAge / (1000 * 60 * 60)).toFixed(1);

    console.log(`Found cached data from ${cached.fetchedAt} (${cacheAgeHours} hours ago)`);
    console.log(`Cached transfers: ${cached.transfers?.length || 0}`);
    console.log('');

    const useCache = process.argv.includes('--use-cache');
    const forceRefresh = process.argv.includes('--refresh');

    if (useCache && !forceRefresh && cached.transfers) {
      console.log('Using cached data (pass --refresh to fetch new data)\n');
      printResults(cached.transfers);
      return;
    }

    if (!forceRefresh) {
      console.log('Fetching fresh data (pass --use-cache to use cached data)...\n');
    }
  }

  const transfers = await fetchMismatchedTransfers();
  const sumOfDiffs = transfers.reduce((sum, t) => sum + t.difference, 0);

  // Save to JSON
  const data: CachedData = {
    wallet: WALLET,
    fetchedAt: new Date().toISOString(),
    minSolChange: MIN_SOL_CHANGE,
    periodDays: PERIOD_DAYS,
    sumOfDiffs,
    transfers
  };

  // Ensure data directory exists
  const dataDir = OUTPUT_FILE.split('/')[0];
  if (!existsSync(dataDir)) {
    const { mkdirSync } = await import('fs');
    mkdirSync(dataDir, { recursive: true });
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
  console.log(`\nSaved to ${OUTPUT_FILE}`);

  printResults(transfers);
}

function printResults(transfers: MismatchedTransfer[]) {
  if (transfers.length === 0) {
    console.log('No mismatched SOL IN / WSOL OUT transfers found.');
    return;
  }

  console.log('\n=== Mismatched Transfers (SOL IN != WSOL OUT) ===\n');

  let totalSolIn = 0;
  let totalWsolOut = 0;

  for (const t of transfers) {
    const diffSign = t.difference >= 0 ? '+' : '';
    console.log(`📊 SOL IN: ${t.solIn.toFixed(2)} | WSOL OUT: ${t.wsolOut.toFixed(2)} | Diff: ${diffSign}${t.difference.toFixed(2)}`);
    console.log(`   From: ${t.solInFrom.slice(0, 8)}...${t.solInFrom.slice(-4)}`);
    console.log(`   To:   ${t.wsolOutTo.slice(0, 8)}...${t.wsolOutTo.slice(-4)}`);
    console.log(`   Type: ${t.txType} (${t.txSource})`);
    console.log(`   Date: ${t.date}`);
    console.log(`   Sig:  ${t.signature}`);
    console.log('');

    totalSolIn += t.solIn;
    totalWsolOut += t.wsolOut;
  }

  const totalDifference = transfers.reduce((sum, t) => sum + t.difference, 0);

  console.log('=== Summary ===');
  console.log(`Total SOL IN:     ${totalSolIn.toFixed(2)} SOL`);
  console.log(`Total WSOL OUT:   ${totalWsolOut.toFixed(2)} SOL`);
  console.log(`Sum of Diffs:     ${totalDifference.toFixed(2)} SOL`);
  console.log(`Transaction Count: ${transfers.length}`);
}

main().catch(console.error);
