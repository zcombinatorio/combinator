import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { shouldUseMockHelius, mockHelius } from '@/lib/mock';

interface SignatureInfo {
  signature: string;
  slot: number;
  err: object | null;
  memo: string | null;
  blockTime: number | null;
  confirmationStatus: string | null;
}

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
  description?: string;
  [key: string]: unknown;
}

// Batch fetch transaction details from Helius Enhanced Transactions API
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

// Helper function to check if a wallet address is on curve (not a PDA)
function isOnCurve(address: string): boolean {
  try {
    const pubkey = new PublicKey(address);
    return PublicKey.isOnCurve(pubkey.toBuffer());
  } catch {
    return false; // Invalid address format
  }
}

// Parse transactions to extract meaningful data for the specific token
function parseTransactionsForToken(transactions: ParsedTransaction[], tokenAddress: string) {
  return transactions.map(tx => {
    let transactionType = 'unknown';
    let amount = '0';
    let solAmount = '0';
    let fromWallet = '';
    let toWallet = '';
    const fromLabel = '';
    const toLabel = '';

    // Check if this transaction involves the target token
    const relevantTransfers = tx.tokenTransfers?.filter(transfer =>
      transfer.mint === tokenAddress
    ) || [];

    if (relevantTransfers.length > 0) {
      const transfer = relevantTransfers[0]; // Take the first relevant transfer

      // Check transaction type from Helius first
      if (tx.type === 'BURN') {
        // This is a burn transaction
        transactionType = 'burn';
        fromWallet = transfer.fromUserAccount || 'Unknown';
        toWallet = 'Burned';
        amount = transfer.tokenAmount.toLocaleString();
      } else if (transfer.fromUserAccount === null || transfer.fromUserAccount === '') {
        // This is a mint transaction
        transactionType = 'mint';
        fromWallet = 'Mint Authority';
        toWallet = transfer.toUserAccount;
        amount = transfer.tokenAmount.toLocaleString();
      } else {
        // Check if there's a SOL transfer to determine if this is a buy/sell
        const solTransfers = tx.tokenTransfers?.filter(t =>
          t.mint === 'So11111111111111111111111111111111111111112'
        ) || [];

        if (solTransfers.length > 0) {
          // Find SOL transfer involving the same user as the token transfer
          const tokenFromUser = transfer.fromUserAccount;
          const tokenToUser = transfer.toUserAccount;

          // Determine which wallets are on-curve
          const fromIsOnCurve = tokenFromUser ? isOnCurve(tokenFromUser) : false;
          const toIsOnCurve = tokenToUser ? isOnCurve(tokenToUser) : false;

          // Check if user who sent tokens received SOL (SELL)
          const userReceivedSol = solTransfers.some(sol =>
            sol.toUserAccount === tokenFromUser
          );

          // Check if user who received tokens sent SOL (BUY)
          const userSentSol = solTransfers.some(sol =>
            sol.fromUserAccount === tokenToUser
          );

          if (userReceivedSol) {
            // Original: tokens sent from tokenFromUser, SOL received by tokenFromUser = SELL
            if (fromIsOnCurve) {
              // On-curve wallet is selling
              transactionType = 'sell';
              fromWallet = transfer.fromUserAccount;
              toWallet = transfer.toUserAccount;
            } else if (toIsOnCurve) {
              // Off-curve wallet "sold" → on-curve wallet actually bought
              transactionType = 'buy';
              fromWallet = transfer.fromUserAccount; // Where tokens came from (PDA)
              toWallet = transfer.toUserAccount; // The on-curve wallet who bought
            } else {
              // Neither is on-curve, keep as is but mark as sell
              transactionType = 'sell';
              fromWallet = transfer.fromUserAccount;
              toWallet = transfer.toUserAccount;
            }
            amount = transfer.tokenAmount.toLocaleString();
            const solTransfer = solTransfers.find(sol => sol.toUserAccount === tokenFromUser);
            solAmount = solTransfer ? solTransfer.tokenAmount.toLocaleString() : '0';
          } else if (userSentSol) {
            // Original: tokens received by tokenToUser, SOL sent by tokenToUser = BUY
            if (toIsOnCurve) {
              // On-curve wallet is buying
              transactionType = 'buy';
              fromWallet = transfer.fromUserAccount;
              toWallet = transfer.toUserAccount;
            } else if (fromIsOnCurve) {
              // Off-curve wallet "bought" → on-curve wallet actually sold
              transactionType = 'sell';
              fromWallet = transfer.fromUserAccount; // The on-curve wallet
              toWallet = transfer.toUserAccount; // The PDA/off-curve wallet
            } else {
              // Neither is on-curve, keep as is but mark as buy
              transactionType = 'buy';
              fromWallet = transfer.fromUserAccount;
              toWallet = transfer.toUserAccount;
            }
            amount = transfer.tokenAmount.toLocaleString();
            const solTransfer = solTransfers.find(sol => sol.fromUserAccount === tokenToUser);
            solAmount = solTransfer ? solTransfer.tokenAmount.toLocaleString() : '0';
          } else {
            // Regular transfer (no SOL exchanged) - focus on on-curve wallet
            transactionType = 'transfer';
            if (fromIsOnCurve && toIsOnCurve) {
              // Both on-curve, normal transfer
              fromWallet = transfer.fromUserAccount;
              toWallet = transfer.toUserAccount;
            } else if (fromIsOnCurve) {
              // From is on-curve, they're transferring to PDA
              fromWallet = transfer.fromUserAccount;
              toWallet = transfer.toUserAccount;
            } else if (toIsOnCurve) {
              // To is on-curve, they're receiving from PDA
              fromWallet = transfer.fromUserAccount;
              toWallet = transfer.toUserAccount;
            } else {
              // Neither on-curve, keep as is
              fromWallet = transfer.fromUserAccount;
              toWallet = transfer.toUserAccount;
            }
            amount = transfer.tokenAmount.toLocaleString();
          }
        } else {
          // No SOL transfers, so it's a regular transfer
          transactionType = 'transfer';
          fromWallet = transfer.fromUserAccount;
          toWallet = transfer.toUserAccount;
          amount = transfer.tokenAmount.toLocaleString();
        }
      }
    }

    return {
      signature: tx.signature,
      timestamp: tx.timestamp || 0,
      type: transactionType,
      amount,
      solAmount,
      fromWallet,
      toWallet,
      fromLabel,
      toLabel,
      memo: null,  // Will be populated from signature memos only
      rawTransaction: tx
    };
  }).filter(tx => tx.type !== 'unknown'); // Only return transactions we could parse
}

export async function POST(
  request: NextRequest
) {
  try {
    const body = await request.json();
    const tokenAddress = body.tokenAddress;
    const walletAddress = body.walletAddress;
    const limit = parseInt(body.limit || '10');
    const before = body.before;

    if (!tokenAddress) {
      return NextResponse.json(
        { error: 'Token address is required' },
        { status: 400 }
      );
    }

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      );
    }

    // Validate limit (max 100 for this endpoint)
    if (limit < 1 || limit > 100) {
      return NextResponse.json(
        { error: 'Limit must be between 1 and 100' },
        { status: 400 }
      );
    }

    // Use mock data if in mock mode
    if (shouldUseMockHelius()) {
      console.log('📦 Mock Mode: Returning mock transaction history');

      // Get mock transactions for this token
      const mockTransactions = await mockHelius.getAddressTransactions(walletAddress, { limit, before });

      // Filter for transactions involving the specific token
      const relevantTransactions = mockTransactions.filter(tx =>
        tx.tokenTransfers?.some((transfer: any) => transfer.mint === tokenAddress)
      );

      // Parse transactions using the same parser
      const parsedTransactions = parseTransactionsForToken(relevantTransactions, tokenAddress);

      return NextResponse.json({
        transactions: parsedTransactions,
        hasMore: false, // Mock data has limited transactions
        lastSignature: null,
        isDemoMode: true
      });
    }

    const apiKey = process.env.HELIUS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Helius API key not configured' },
        { status: 500 }
      );
    }

    // Step 1: Keep fetching transactions until we have enough relevant ones
    const tokenRelevantTransactions: ParsedTransaction[] = [];
    let currentBefore = before;
    let hasMoreTransactions = true;
    let totalFetched = 0;
    const BATCH_SIZE = 50; // Fetch in larger batches
    const MAX_ITERATIONS = 20; // Safety limit to prevent infinite loops
    let iterations = 0;

    const startTime = Date.now();

    while (tokenRelevantTransactions.length < limit && hasMoreTransactions && iterations < MAX_ITERATIONS) {
      iterations++;

      const url = `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions`;
      const params = new URLSearchParams({
        'api-key': apiKey,
        limit: BATCH_SIZE.toString(),
      });
      if (currentBefore) {
        params.append('before', currentBefore);
      }

      const response = await fetch(`${url}?${params}`);

      if (!response.ok) {
        throw new Error(`Helius API error: ${response.statusText}`);
      }

      const transactions: ParsedTransaction[] = await response.json();
      totalFetched += transactions.length;

      if (transactions.length === 0) {
        hasMoreTransactions = false;
        break;
      }

      // Filter for transactions involving the token
      const relevantInBatch = transactions.filter(tx => {
        return tx.tokenTransfers?.some(transfer =>
          transfer.mint === tokenAddress
        );
      });

      tokenRelevantTransactions.push(...relevantInBatch);

      // Update cursor for next iteration
      if (transactions.length > 0) {
        currentBefore = transactions[transactions.length - 1].signature;
      }

      // If we got fewer transactions than requested, we've reached the end
      if (transactions.length < BATCH_SIZE) {
        hasMoreTransactions = false;
        break;
      }
    }

    if (tokenRelevantTransactions.length === 0) {
      return NextResponse.json({
        transactions: [],
        hasMore: false,
        lastSignature: null
      });
    }

    // Take only the requested number of transactions
    const transactionsToReturn = tokenRelevantTransactions.slice(0, limit);

    // Step 2: Parse transactions to extract meaningful data
    const parsedTransactions = parseTransactionsForToken(transactionsToReturn, tokenAddress);

    // Step 3.5: Fetch memos only for transfer transactions (Enhanced API doesn't include memos)
    const memoMap: Record<string, string | null> = {};

    // Only fetch memos for transfer transactions
    const transferTransactions = parsedTransactions.filter(tx => tx.type === 'transfer');

    if (transferTransactions.length > 0) {
      try {
        const transferSignatures = transferTransactions.map(tx => tx.signature);

        // Fetch transaction details to get memos
        const memoResponses = await Promise.all(
          transferSignatures.map(async (sig) => {
            try {
              const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 'memo-fetch',
                  method: 'getTransaction',
                  params: [
                    sig,
                    {
                      encoding: 'jsonParsed',
                      maxSupportedTransactionVersion: 0
                    }
                  ]
                })
              });

              if (!response.ok) return { signature: sig, memo: null };

              const data = await response.json();
              if (!data.result) {
                return { signature: sig, memo: null };
              }

              // Look for memo in instructions
              const instructions = data.result.transaction?.message?.instructions || [];
              for (const ix of instructions) {
                if (ix.program === 'spl-memo' || ix.programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') {
                  // Handle different memo formats
                  let memo = null;

                  // Try parsed field (jsonParsed format)
                  if (typeof ix.parsed === 'string') {
                    memo = ix.parsed;
                  } else if (ix.parsed && typeof ix.parsed === 'object') {
                    // Sometimes parsed is an object like { memo: "text" } or { type: "memo", value: "text" }
                    memo = ix.parsed.memo || ix.parsed.value || JSON.stringify(ix.parsed);
                  }

                  // If not found, try data field (might be base64 encoded)
                  if (!memo && ix.data) {
                    memo = ix.data;
                  }

                  if (memo) {
                    return { signature: sig, memo };
                  }
                }
              }

              return { signature: sig, memo: null };
            } catch (error) {
              return { signature: sig, memo: null };
            }
          })
        );

        memoResponses.forEach(({ signature, memo }) => {
          memoMap[signature] = memo;
        });
      } catch (error) {
        // Continue without memos if this fails
      }
    }

    // Step 4: Get social labels for wallet addresses
    const allWalletAddresses = new Set<string>();
    parsedTransactions.forEach(tx => {
      if (tx.fromWallet && tx.fromWallet !== 'Mint Authority' && tx.fromWallet !== 'Burn Address') {
        allWalletAddresses.add(tx.fromWallet);
      }
      if (tx.toWallet && tx.toWallet !== 'Mint Authority' && tx.toWallet !== 'Burn Address') {
        allWalletAddresses.add(tx.toWallet);
      }
    });

    let labelMap: Record<string, string> = {};
    // Only fetch labels if explicitly requested (user must be dev)
    const fetchLabels = body.fetchLabels === true;

    if (fetchLabels && allWalletAddresses.size > 0) {
      try {
        const labelResponse = await fetch(`${request.nextUrl.origin}/api/wallet-labels`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            walletAddresses: Array.from(allWalletAddresses)
          }),
        });

        if (labelResponse.ok) {
          const labelData = await labelResponse.json();
          labelMap = labelData.labels || {};
        }
      } catch (error) {
        // Continue without labels if this fails
      }
    }

    // Apply labels and memos to transactions
    const transactionsWithLabels = parsedTransactions.map(tx => ({
      ...tx,
      fromLabel: labelMap[tx.fromWallet] || tx.fromWallet,
      toLabel: labelMap[tx.toWallet] || tx.toWallet,
      memo: memoMap[tx.signature] || null  // Only use actual memos from signatures, not Helius descriptions
    }));

    return NextResponse.json({
      transactions: transactionsWithLabels,
      hasMore: hasMoreTransactions || tokenRelevantTransactions.length > limit, // More transactions available
      lastSignature: currentBefore // Cursor for next page
    });

  } catch (error) {
    console.error('Error fetching transaction details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transaction details' },
      { status: 500 }
    );
  }
}