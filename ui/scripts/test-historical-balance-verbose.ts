/*
 * Verbose test script for historical balance calculation
 * Shows internal state to verify algorithm correctness
 */

import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';

const WALLET = process.argv[2] || 'FEEnkcCNE2623LYCPtLf63LFzXpCFigBLTu4qZovRGZC';
const TOKEN = process.argv[3] || 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC';
const PERIOD_HOURS = parseInt(process.argv[4] || '168', 10);
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;

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

async function main() {
  console.log('='.repeat(70));
  console.log('VERBOSE Historical Balance Test');
  console.log('='.repeat(70));
  console.log(`Wallet: ${WALLET}`);
  console.log(`Token:  ${TOKEN}`);
  console.log(`Period: ${PERIOD_HOURS} hours`);

  const connection = new Connection(RPC_URL);
  const walletPubkey = new PublicKey(WALLET);
  const mintPubkey = new PublicKey(TOKEN);

  // Get decimals
  let tokenDecimals = 6;
  try {
    const mintInfo = await getMint(connection, mintPubkey);
    tokenDecimals = mintInfo.decimals;
  } catch {}
  console.log(`Decimals: ${tokenDecimals}`);

  // Get current balance
  let currentBalance = BigInt(0);
  try {
    const ata = getAssociatedTokenAddressSync(mintPubkey, walletPubkey, true);
    console.log(`ATA: ${ata.toBase58()}`);
    const account = await getAccount(connection, ata);
    currentBalance = account.amount;
  } catch {}
  console.log(`Current balance: ${currentBalance}`);

  // Calculate time window
  const now = Date.now();
  const periodStart = now - PERIOD_HOURS * 60 * 60 * 1000;
  console.log(`\nTime window:`);
  console.log(`  Now:    ${new Date(now).toISOString()}`);
  console.log(`  Start:  ${new Date(periodStart).toISOString()}`);

  // Fetch signatures
  const ata = getAssociatedTokenAddressSync(mintPubkey, walletPubkey, true);
  let allSigs: { signature: string; blockTime: number }[] = [];
  let lastSig: string | undefined;
  let reachedBeginningOfHistory = false;

  console.log(`\nFetching signatures...`);
  while (true) {
    const params: [string, { limit: number; before?: string }] = [ata.toBase58(), { limit: 1000 }];
    if (lastSig) params[1].before = lastSig;

    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'getSignaturesForAddress', params }),
    });
    const data = await response.json();

    if (!data.result || data.result.length === 0) {
      console.log(`  -> No more signatures, reached BEGINNING OF HISTORY`);
      reachedBeginningOfHistory = true;
      break;
    }

    let reachedCutoff = false;
    for (const sig of data.result) {
      if (sig.blockTime && sig.blockTime * 1000 < periodStart) {
        console.log(`  -> Reached CUTOFF at ${new Date(sig.blockTime * 1000).toISOString()}`);
        reachedCutoff = true;
        break;
      }
      allSigs.push({ signature: sig.signature, blockTime: sig.blockTime });
    }

    if (reachedCutoff) {
      reachedBeginningOfHistory = false;
      break;
    }

    lastSig = data.result[data.result.length - 1].signature;
    if (data.result.length < 1000) {
      console.log(`  -> Less than 1000 results, reached BEGINNING OF HISTORY`);
      reachedBeginningOfHistory = true;
      break;
    }
  }

  console.log(`\nSignatures in window: ${allSigs.length}`);
  console.log(`reachedBeginningOfHistory: ${reachedBeginningOfHistory}`);

  if (allSigs.length > 0) {
    console.log(`\nFirst sig in window: ${new Date(allSigs[allSigs.length - 1].blockTime * 1000).toISOString()}`);
    console.log(`Last sig in window:  ${new Date(allSigs[0].blockTime * 1000).toISOString()}`);
  }

  // Fetch transaction details
  console.log(`\nFetching transaction details...`);
  const txDetails: ParsedTransaction[] = [];
  for (let i = 0; i < allSigs.length; i += 100) {
    const chunk = allSigs.slice(i, i + 100).map(s => s.signature);
    const response = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: chunk }),
    });
    const data = await response.json();
    txDetails.push(...data.filter((tx: any) => tx && tx.signature));
  }

  // Extract relevant transfers
  const decimalsMultiplier = 10 ** tokenDecimals;
  const transfers: { timestamp: number; delta: bigint }[] = [];

  for (const tx of txDetails) {
    if (!tx.tokenTransfers) continue;
    for (const transfer of tx.tokenTransfers) {
      const isIncoming = transfer.toUserAccount === WALLET;
      const isOutgoing = transfer.fromUserAccount === WALLET;
      if (!isIncoming && !isOutgoing) continue;

      const rawAmount = BigInt(Math.round(transfer.tokenAmount * decimalsMultiplier));
      const delta = isIncoming ? rawAmount : -rawAmount;
      transfers.push({ timestamp: tx.timestamp * 1000, delta });
    }
  }

  console.log(`Relevant transfers: ${transfers.length}`);

  if (transfers.length === 0) {
    console.log(`\nNo transfers -> average = current = ${currentBalance}`);
    return;
  }

  // Sort descending
  transfers.sort((a, b) => b.timestamp - a.timestamp);

  // Walk backwards
  console.log(`\n${'─'.repeat(70)}`);
  console.log('Balance reconstruction (newest to oldest):');
  console.log('─'.repeat(70));

  let balance = currentBalance;
  let weightedSum = BigInt(0);
  let prevTimestamp = now;

  console.log(`Starting balance: ${balance}`);

  for (const transfer of transfers) {
    const duration = prevTimestamp - Math.max(transfer.timestamp, periodStart);
    if (duration > 0) {
      const contribution = balance * BigInt(duration);
      weightedSum += contribution;
      console.log(`  ${new Date(prevTimestamp).toISOString()} -> ${new Date(Math.max(transfer.timestamp, periodStart)).toISOString()}`);
      console.log(`    Balance ${balance} × ${(duration / 3600000).toFixed(2)}h = ${contribution}`);
    }

    balance -= transfer.delta;
    console.log(`  Transfer: ${transfer.delta >= 0 ? '+' : ''}${transfer.delta} -> new balance: ${balance}`);
    prevTimestamp = transfer.timestamp;

    if (transfer.timestamp <= periodStart) break;
  }

  // Remainder
  if (prevTimestamp > periodStart) {
    const duration = prevTimestamp - periodStart;
    const balanceForRemainder = reachedBeginningOfHistory ? BigInt(0) : balance;

    console.log(`\n  REMAINDER: ${new Date(prevTimestamp).toISOString()} -> ${new Date(periodStart).toISOString()}`);
    console.log(`    reachedBeginningOfHistory: ${reachedBeginningOfHistory}`);
    console.log(`    Using balance: ${balanceForRemainder} (reconstructed was: ${balance})`);

    const contribution = balanceForRemainder * BigInt(duration);
    weightedSum += contribution;
    console.log(`    Balance ${balanceForRemainder} × ${(duration / 3600000).toFixed(2)}h = ${contribution}`);
  }

  const totalDuration = BigInt(now - periodStart);
  const averageBalance = totalDuration > 0 ? weightedSum / totalDuration : currentBalance;

  console.log(`\n${'═'.repeat(70)}`);
  console.log('FINAL RESULT:');
  console.log(`  Weighted sum:    ${weightedSum}`);
  console.log(`  Total duration:  ${totalDuration} ms (${Number(totalDuration) / 3600000}h)`);
  console.log(`  Current balance: ${currentBalance}`);
  console.log(`  Average balance: ${averageBalance}`);
  console.log(`  Ratio:           ${(Number(averageBalance) / Number(currentBalance) * 100).toFixed(2)}%`);
  console.log('═'.repeat(70));
}

main().catch(console.error);
