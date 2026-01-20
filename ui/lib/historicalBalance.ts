/*
 * Z Combinator - Solana Token Launchpad
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
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';

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

export interface AverageBalanceResult {
  averageBalance: bigint;
  currentBalance: bigint;
  transferCount: number;
}

/**
 * Fetch token transfers for a wallet from Helius API.
 * Returns transfers sorted by timestamp descending (newest first).
 */
async function fetchWalletTokenTransfers(
  walletAddress: string,
  tokenMint: string,
  periodHours: number,
  apiKey: string
): Promise<ParsedTransaction[]> {
  const cutoffTime = Date.now() - periodHours * 60 * 60 * 1000;
  const allTransactions: ParsedTransaction[] = [];
  let lastSignature: string | undefined = undefined;

  // Fetch signatures for the wallet's associated token account
  const walletPubkey = new PublicKey(walletAddress);
  const mintPubkey = new PublicKey(tokenMint);
  // allowOwnerOffCurve=true to support PDA wallets
  const ata = getAssociatedTokenAddressSync(mintPubkey, walletPubkey, true);
  const ataAddress = ata.toBase58();

  while (true) {
    const params: [string, { limit: number; before?: string }] = [ataAddress, { limit: 1000 }];
    if (lastSignature) {
      params[1].before = lastSignature;
    }

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
      break;
    }

    const signatures: string[] = [];
    let reachedCutoff = false;

    for (const sigInfo of data.result) {
      if (!sigInfo.signature) continue;

      // Check if we've gone past the cutoff time
      if (sigInfo.blockTime && sigInfo.blockTime * 1000 < cutoffTime) {
        reachedCutoff = true;
        break;
      }

      signatures.push(sigInfo.signature);
    }

    if (signatures.length > 0) {
      // Batch fetch transaction details
      const txDetails = await fetchTransactionDetails(signatures, apiKey);
      allTransactions.push(...txDetails);
      lastSignature = signatures[signatures.length - 1];
    }

    if (reachedCutoff || data.result.length < 1000) {
      break;
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return allTransactions;
}

/**
 * Fetch transaction details from Helius API.
 */
async function fetchTransactionDetails(
  signatures: string[],
  apiKey: string
): Promise<ParsedTransaction[]> {
  const BATCH_SIZE = 100;
  const results: ParsedTransaction[] = [];

  for (let i = 0; i < signatures.length; i += BATCH_SIZE) {
    const chunk = signatures.slice(i, i + BATCH_SIZE);

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

/**
 * Calculate the time-weighted average token balance for a wallet over a period.
 *
 * Algorithm:
 * 1. Get current balance from RPC
 * 2. Fetch token transfers within the time window from Helius
 * 3. Walk backwards through transfers, reconstructing balance at each point
 * 4. Calculate sum(balance × duration) / total_duration
 *
 * @param connection - Solana RPC connection
 * @param walletAddress - The wallet to check
 * @param tokenMint - The token mint address
 * @param periodHours - Number of hours to look back
 * @returns Average balance, current balance, and transfer count
 */
export async function calculateAverageBalance(
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

  // Get token decimals for converting Helius amounts to raw units
  let tokenDecimals = 6; // Default to 6 decimals
  try {
    const mintInfo = await getMint(connection, mintPubkey);
    tokenDecimals = mintInfo.decimals;
  } catch {
    // Use default if can't fetch mint info
  }

  // Get current balance
  // allowOwnerOffCurve=true to support PDA wallets
  let currentBalance = BigInt(0);
  try {
    const ata = getAssociatedTokenAddressSync(mintPubkey, walletPubkey, true);
    const account = await getAccount(connection, ata);
    currentBalance = account.amount;
  } catch {
    // Account doesn't exist - balance is 0
  }

  // Fetch transfers within the period
  const now = Date.now();
  const periodStart = now - periodHours * 60 * 60 * 1000;

  let transactions: ParsedTransaction[];
  try {
    transactions = await fetchWalletTokenTransfers(walletAddress, tokenMint, periodHours, HELIUS_API_KEY);
  } catch (error) {
    if (error instanceof Error && error.message === 'HELIUS_RATE_LIMIT') {
      throw error;
    }
    // If fetching fails, fall back to treating current balance as held for entire period
    console.warn('Failed to fetch transfer history, using current balance:', error);
    return {
      averageBalance: currentBalance,
      currentBalance,
      transferCount: 0,
    };
  }

  // Filter to only transfers involving this token and wallet
  const relevantTransfers: { timestamp: number; delta: bigint }[] = [];

  // Helius returns tokenAmount as the decimal-adjusted value (human-readable)
  // We need to convert to raw units by multiplying by 10^decimals
  const decimalsMultiplier = 10 ** tokenDecimals;

  for (const tx of transactions) {
    if (!tx.tokenTransfers) continue;

    for (const transfer of tx.tokenTransfers) {
      const isIncoming = transfer.toUserAccount === walletAddress;
      const isOutgoing = transfer.fromUserAccount === walletAddress;

      if (!isIncoming && !isOutgoing) continue;

      // Convert from decimal form to raw units
      const rawAmount = BigInt(Math.round(transfer.tokenAmount * decimalsMultiplier));
      const delta = isIncoming ? rawAmount : -rawAmount;

      relevantTransfers.push({
        timestamp: tx.timestamp * 1000, // Convert to ms
        delta,
      });
    }
  }

  // If no transfers in period, current balance has been held the entire time
  if (relevantTransfers.length === 0) {
    return {
      averageBalance: currentBalance,
      currentBalance,
      transferCount: 0,
    };
  }

  // Sort by timestamp descending (newest first)
  relevantTransfers.sort((a, b) => b.timestamp - a.timestamp);

  // Walk backwards through time, calculating balance at each point
  // Start from current balance at current time
  let balance = currentBalance;
  let weightedSum = BigInt(0);
  let prevTimestamp = now;

  for (const transfer of relevantTransfers) {
    // Time this balance was held
    const duration = prevTimestamp - Math.max(transfer.timestamp, periodStart);

    if (duration > 0) {
      weightedSum += balance * BigInt(duration);
    }

    // Reverse the transfer to get balance before it happened
    balance -= transfer.delta;
    prevTimestamp = transfer.timestamp;

    // Stop if we've gone past the period start
    if (transfer.timestamp <= periodStart) {
      break;
    }
  }

  // Add the remaining time at the earliest balance
  if (prevTimestamp > periodStart) {
    const duration = prevTimestamp - periodStart;
    weightedSum += balance * BigInt(duration);
  }

  // Calculate average
  const totalDuration = BigInt(now - periodStart);
  const averageBalance = totalDuration > 0 ? weightedSum / totalDuration : currentBalance;

  return {
    averageBalance,
    currentBalance,
    transferCount: relevantTransfers.length,
  };
}
