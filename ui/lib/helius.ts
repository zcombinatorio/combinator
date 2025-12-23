/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
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

import { getCachedTokenMintHistory } from './transactionCache';
import { shouldUseMockHelius, mockHelius } from './mock';

interface TokenTransfer {
  timestamp: number;
  signature: string;
  mint: string;
  fromUserAccount: string | null;
  toUserAccount: string;
  fromTokenAccount: string | null;
  toTokenAccount: string;
  tokenAmount: number;
  tokenStandard: string;
}

interface ParsedTransaction {
  signature: string;
  timestamp: number;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  tokenTransfers?: TokenTransfer[];
  nativeTransfers?: unknown[];
  instructions?: unknown[];
  [key: string]: unknown;
}

async function getSignaturesForAddress(walletAddress: string, apiKey: string): Promise<string[]> {
  const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const allSignatures: string[] = [];
  let lastSignature: string | undefined = undefined;
  let pageCount = 0;

  while (true) {
    pageCount++;

    const params: [string, { limit: number; before?: string }] = [walletAddress, { limit: 1000 }];
    if (lastSignature) {
      params[1].before = lastSignature;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: pageCount.toString(),
        method: 'getSignaturesForAddress',
        params: params
      }),
    });

    if (!response.ok) {
      throw new Error(`Helius RPC error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`);
    }

    if (!data.result || !Array.isArray(data.result) || data.result.length === 0) {
      break;
    }

    const pageSignatures: string[] = [];
    data.result.forEach((sigInfo: { signature?: string }) => {
      if (sigInfo.signature) {
        pageSignatures.push(sigInfo.signature);
      }
    });

    allSignatures.push(...pageSignatures);

    // Set up for next page
    lastSignature = pageSignatures[pageSignatures.length - 1];

    // If we got less than the limit, we're done
    if (pageSignatures.length < 1000) {
      break;
    }
  }

  return allSignatures;
}

async function batchFetchTransactions(signatures: string[], apiKey: string): Promise<{ transactions: ParsedTransaction[]; missingSignatures: string[] }> {
  const allTransactions: ParsedTransaction[] = [];
  const allMissingSignatures: string[] = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < signatures.length; i += BATCH_SIZE) {
    const chunk = signatures.slice(i, i + BATCH_SIZE);

    const response = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transactions: chunk,
      }),
    });

    if (!response.ok) {
      throw new Error(`Helius batch transactions API error: ${response.statusText}`);
    }

    const transactionData = await response.json();

    for (let j = 0; j < chunk.length; j++) {
      const signature = chunk[j];
      const txData = transactionData[j];

      if (txData && txData.signature) {
        allTransactions.push(txData);
      } else {
        allMissingSignatures.push(signature);
      }
    }

    if (i + BATCH_SIZE < signatures.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return { transactions: allTransactions, missingSignatures: allMissingSignatures };
}

async function retryMissingTransactions(signatures: string[], apiKey: string, maxRetries: number = 3): Promise<ParsedTransaction[]> {
  const allTransactions: ParsedTransaction[] = [];
  let currentSignatures = signatures;

  for (let attempt = 0; attempt < maxRetries && currentSignatures.length > 0; attempt++) {
    const { transactions, missingSignatures } = await batchFetchTransactions(currentSignatures, apiKey);
    allTransactions.push(...transactions);

    currentSignatures = missingSignatures;

    if (currentSignatures.length > 0 && attempt < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  return allTransactions;
}

/**
 * Get all mint transactions for a specific token across ALL wallets
 * This allows us to calculate total claimed tokens from on-chain data
 * Now uses intelligent caching to dramatically improve performance
 */
export async function getTokenMintHistory(
  tokenAddress: string
): Promise<{ totalMinted: bigint; transactions: ParsedTransaction[] }> {
  // Use mock Helius if API key not available
  if (shouldUseMockHelius()) {
    const result = await mockHelius.calculateClaimEligibility(tokenAddress);
    return {
      totalMinted: BigInt(result.totalMinted),
      transactions: []
    };
  }

  const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

  if (!HELIUS_API_KEY) {
    throw new Error('HELIUS_API_KEY not configured');
  }

  try {
    // Use cached implementation with incremental sync
    const result = await getCachedTokenMintHistory(tokenAddress, HELIUS_API_KEY);

    // Convert cached transactions back to ParsedTransaction format for compatibility
    const transactions: ParsedTransaction[] = result.transactions.map(tx => tx.tx_data as ParsedTransaction);

    return {
      totalMinted: result.totalMinted,
      transactions
    };
  } catch (error) {
    console.error('Error fetching mint history (cached):', error);

    // Fallback to original implementation if cache fails
    console.log('Falling back to direct API fetch...');
    return await getTokenMintHistoryDirect(tokenAddress);
  }
}

/**
 * Original implementation kept as fallback
 * Direct API fetch without caching - use only when cache fails
 */
async function getTokenMintHistoryDirect(
  tokenAddress: string
): Promise<{ totalMinted: bigint; transactions: ParsedTransaction[] }> {
  const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
  const PROTOCOL_PUBLIC_KEY = 'Hq7Xh37tT4sesD6wA4DphYfxeMJRhhFWS3KVUSSGjqzc';

  if (!HELIUS_API_KEY) {
    throw new Error('HELIUS_API_KEY not configured');
  }

  try {
    // Step 1: Get transaction signatures from protocol public key (the one signing mint txs)
    const signatures = await getSignaturesForAddress(PROTOCOL_PUBLIC_KEY, HELIUS_API_KEY);

    // Step 2: Batch fetch transactions using Helius /v0/transactions endpoint
    const { transactions, missingSignatures } = await batchFetchTransactions(signatures, HELIUS_API_KEY);

    // Step 3: Retry any missing transactions
    const retryTransactions = await retryMissingTransactions(missingSignatures, HELIUS_API_KEY);
    const allTransactions = [...transactions, ...retryTransactions];

    // Filter for mint transactions of our specific token (to ANY wallet)
    const mintTransactions = allTransactions.filter(tx => {
      if (!tx.tokenTransfers) {
        return false;
      }
      if (tx.type !== "TOKEN_MINT") {
        return false;
      }

      const hasTargetMint = tx.tokenTransfers.some(transfer =>
        transfer.mint === tokenAddress &&
        transfer.fromUserAccount === ""
      );

      return hasTargetMint;
    });

    // Calculate total minted across all wallets
    let totalMinted = BigInt(0);
    mintTransactions.forEach(tx => {
      tx.tokenTransfers?.forEach(transfer => {
        if (transfer.mint === tokenAddress &&
            transfer.fromUserAccount === "") {
          const amount = BigInt(transfer.tokenAmount);
          totalMinted += amount;
        }
      });
    });

    return {
      totalMinted,
      transactions: mintTransactions
    };
  } catch (error) {
    console.error('Error fetching mint history from Helius (direct):', error);
    throw error;
  }
}

/**
 * Calculate claim eligibility based on on-chain data and launch time
 * Now only depends on token address, not user wallet
 */
export async function calculateClaimEligibility(
  tokenAddress: string,
  tokenLaunchTime: Date
): Promise<{
  totalClaimed: bigint;
  availableToClaim: bigint;
  maxClaimableNow: bigint;
  inflationPeriods: number;
  canClaimNow: boolean;
  nextInflationTime: Date;
}> {

  // Get total minted across ALL wallets using cached implementation
  let { totalMinted } = await getTokenMintHistory(tokenAddress);

  // Special case: For token GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC, subtract 163M from total claimed:
  // - 41M: Issue early in the project where people minted 41M tokens mistakenly. hands burned 41M of his own tokens after patching the issue.
  // - 122M: Tokens minted to facilitate the merger with percent markets
  if (tokenAddress === 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC') {
    const adjustment = BigInt(163000000);
    totalMinted = totalMinted > adjustment ? totalMinted - adjustment : BigInt(0);
  }

  // Special case: For token C7MGcMnN8cXUkj8JQuMhkJZh6WqY2r8QnT3AUfKTkrix, subtract 14M from total claimed
  // Since oogway migrated to ZC after the fact
  if (tokenAddress === 'C7MGcMnN8cXUkj8JQuMhkJZh6WqY2r8QnT3AUfKTkrix') {
    const adjustment = BigInt(14000000);
    totalMinted = totalMinted > adjustment ? totalMinted - adjustment : BigInt(0);
  }

  // Calculate periods: 1M at launch + 1M per 24-hour period elapsed
  const now = new Date();
  const msElapsed = now.getTime() - tokenLaunchTime.getTime();
  const fullDaysElapsed = Math.floor(msElapsed / (24 * 60 * 60 * 1000));

  // Special case: ZC token emissions end on March 2, 2027 at 11pm ET (March 3, 2027 4am UTC)
  const ZC_TOKEN_ADDRESS = 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC';
  const ZC_EMISSIONS_CUTOFF = new Date('2027-03-03T04:00:00.000Z');

  // Special case: Token emissions end on December 31, 2025 at 23:59:59 UTC
  const EOY_2025_TOKEN_ADDRESS = 'CtmadLp7st6DSehwFBE4BFvizBQib7kv8quJDTyoUJSP';
  const EOY_2025_EMISSIONS_CUTOFF = new Date('2025-12-31T23:59:59.999Z');

  let totalPeriods;
  if (tokenAddress === ZC_TOKEN_ADDRESS && now > ZC_EMISSIONS_CUTOFF) {
    // Cap periods at the cutoff date - no new emissions after this point
    const msToCutoff = ZC_EMISSIONS_CUTOFF.getTime() - tokenLaunchTime.getTime();
    const daysToCutoff = Math.floor(msToCutoff / (24 * 60 * 60 * 1000));
    totalPeriods = daysToCutoff + 1;
  } else if (tokenAddress === EOY_2025_TOKEN_ADDRESS && now > EOY_2025_EMISSIONS_CUTOFF) {
    // Cap periods at the cutoff date - no new emissions after this point
    const msToCutoff = EOY_2025_EMISSIONS_CUTOFF.getTime() - tokenLaunchTime.getTime();
    const daysToCutoff = Math.floor(msToCutoff / (24 * 60 * 60 * 1000));
    totalPeriods = daysToCutoff + 1;
  } else {
    totalPeriods = fullDaysElapsed + 1; // +1 for initial claim at launch
  }

  // Each period allows 1,000,000 tokens
  const TOKENS_PER_PERIOD = BigInt(1000000);
  const maxClaimableNow = BigInt(totalPeriods) * TOKENS_PER_PERIOD;

  // Available to claim = max allowed - already claimed
  const availableToClaim = maxClaimableNow > totalMinted ? maxClaimableNow - totalMinted : BigInt(0);

  // Next inflation is at the next 24-hour mark
  const nextInflationTime = new Date(tokenLaunchTime.getTime() + (fullDaysElapsed + 1) * 24 * 60 * 60 * 1000);

  return {
    totalClaimed: totalMinted,
    availableToClaim,
    maxClaimableNow,
    inflationPeriods: totalPeriods,
    canClaimNow: availableToClaim > BigInt(0),
    nextInflationTime
  };
}