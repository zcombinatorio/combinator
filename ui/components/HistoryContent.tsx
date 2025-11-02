'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from '@/components/WalletProvider';
import { useLaunchInfo, useTokenInfo, useDesignatedClaims, useTransactions } from '@/hooks/useTokenData';

interface Transaction {
  signature: string;
  timestamp: number;
  type: 'transfer' | 'buy' | 'sell' | 'burn' | 'mint' | 'unknown';
  amount: string;
  solAmount?: string;
  fromWallet: string;
  toWallet: string;
  fromLabel: string;
  toLabel: string;
  memo?: string | null;
  rawTransaction?: unknown;
}

interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  totalSupply: string;
  imageUri?: string;
}

interface LaunchInfo {
  creatorWallet: string;
  creatorTwitter?: string;
  creatorGithub?: string;
  isCreatorDesignated: boolean;
  verifiedWallet?: string;
  verifiedEmbeddedWallet?: string;
}

interface HistoryContentProps {
  tokenAddress: string;
  tokenSymbol?: string;
}

export function HistoryContent({ tokenAddress, tokenSymbol = '' }: HistoryContentProps) {
  const { wallet } = useWallet();

  // Use SWR hooks for cached data
  const { launchData, isLoading: launchLoading, mutate: mutateLaunch } = useLaunchInfo(tokenAddress);
  const { tokenInfo: supplyData, isLoading: supplyLoading, mutate: mutateSupply } = useTokenInfo(tokenAddress);
  const { designatedData, isLoading: designatedLoading, mutate: mutateDesignated } = useDesignatedClaims(tokenAddress);

  // State for UI
  const [transactionPages, setTransactionPages] = useState<Transaction[][]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [expandedTransactions, setExpandedTransactions] = useState<Set<string>>(new Set());
  const [loadingPage, setLoadingPage] = useState(false);
  const TRANSACTIONS_PER_PAGE = 10;

  // Compute combined data from cached responses
  const [tokenImageUri, setTokenImageUri] = useState<string | undefined>();

  const tokenInfo: TokenInfo = useMemo(() => {
    const launch = launchData?.launches?.[0];
    return {
      address: tokenAddress,
      symbol: launch?.token_symbol || tokenSymbol || '',
      name: launch?.token_name || 'Unknown Token',
      totalSupply: supplyData?.supply || '1000000000',
      imageUri: tokenImageUri || launch?.image_uri
    };
  }, [tokenAddress, tokenSymbol, launchData, supplyData, tokenImageUri]);

  // Fetch metadata image if not in DB
  useEffect(() => {
    const launch = launchData?.launches?.[0];
    if (!launch?.image_uri && launch?.token_metadata_url && !tokenImageUri) {
      fetch(launch.token_metadata_url)
        .then(res => res.json())
        .then(metadata => {
          if (metadata.image) {
            setTokenImageUri(metadata.image);
          }
        })
        .catch(() => {
          // Failed to fetch metadata
        });
    } else if (launch?.image_uri) {
      setTokenImageUri(launch.image_uri);
    }
  }, [launchData, tokenImageUri]);

  const launchInfo: LaunchInfo | null = useMemo(() => {
    const launch = launchData?.launches?.[0];
    const claim = designatedData?.claim;

    if (!launch) return null;

    const creatorWallet = claim?.original_launcher || launch.creator_wallet;
    if (!creatorWallet) return null;

    return {
      creatorWallet,
      creatorTwitter: launch.creator_twitter,
      creatorGithub: launch.creator_github,
      isCreatorDesignated: !!(claim?.verified_at || launch.is_creator_designated),
      verifiedWallet: claim?.verified_wallet,
      verifiedEmbeddedWallet: claim?.verified_embedded_wallet
    };
  }, [launchData, designatedData]);

  // Get creator wallet for transactions fetch
  const creatorWallet = launchInfo?.creatorWallet || null;
  const isUserDev = !!(wallet && creatorWallet && wallet.toBase58() === creatorWallet);

  // Fetch first page of transactions using SWR
  const {
    transactions: firstPageTransactions,
    hasMore,
    lastSignature: firstPageLastSig,
    isLoading: transactionsLoading,
    mutate: mutateTransactions
  } = useTransactions(tokenAddress, creatorWallet, null, isUserDev);

  // Overall loading state
  const loading = launchLoading || supplyLoading || designatedLoading || transactionsLoading;

  // Helper function to truncate addresses - memoized
  const truncateAddress = useCallback((address: string) => {
    if (!address || address.length < 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  }, []);

  // Helper function to replace user's wallet with "You" - memoized
  const processLabel = useCallback((label: string, walletAddress: string) => {
    // Check if the wallet address matches the user's wallet
    if (wallet && walletAddress === wallet.toBase58()) {
      return 'You';
    }
    // If label is an address, truncate it
    if (label === walletAddress || label.match(/^[A-Za-z0-9]{40,}$/)) {
      return truncateAddress(label);
    }
    // Otherwise return the label as-is
    return label;
  }, [wallet, truncateAddress]);

  // Process first page transactions with labels
  const currentTransactions = useMemo(() => {
    if (currentPage === 0 && firstPageTransactions.length > 0) {
      return firstPageTransactions.map((tx: Transaction) => ({
        ...tx,
        fromLabel: processLabel(tx.fromLabel, tx.fromWallet),
        toLabel: processLabel(tx.toLabel, tx.toWallet)
      }));
    }
    return transactionPages[currentPage] || [];
  }, [currentPage, firstPageTransactions, transactionPages, processLabel]);

  // Track hasMore for pagination
  const hasMorePages = currentPage === 0 ? hasMore : (transactionPages[currentPage + 1] !== undefined || lastSignature !== null);

  // Update pagination state when first page loads
  useEffect(() => {
    if (currentPage === 0 && firstPageTransactions.length > 0 && !transactionsLoading) {
      const processedTransactions = firstPageTransactions.map((tx: Transaction) => ({
        ...tx,
        fromLabel: processLabel(tx.fromLabel, tx.fromWallet),
        toLabel: processLabel(tx.toLabel, tx.toWallet)
      }));
      setTransactionPages([processedTransactions]);
      setLastSignature(firstPageLastSig);
    }
  }, [firstPageTransactions, firstPageLastSig, currentPage, processLabel, transactionsLoading]);

  // Helper function to calculate percentage of supply
  const calculateSupplyPercentage = (amount: string) => {
    const amountNum = parseFloat(amount.replace(/,/g, ''));
    const totalSupplyNum = parseFloat(tokenInfo.totalSupply.replace(/,/g, ''));
    if (totalSupplyNum === 0) return '0.00';
    return ((amountNum / totalSupplyNum) * 100).toFixed(4);
  };

  // Helper function to format token amounts with K/M/B
  const formatTokenAmount = (amount: string | undefined) => {
    if (!amount) return '0';
    // Remove commas before parsing (amounts come formatted as "1,000,000")
    const num = parseFloat(amount.replace(/,/g, ''));
    if (num >= 1_000_000_000) {
      const billions = num / 1_000_000_000;
      return billions >= 10 ? `${Math.floor(billions)}B` : `${billions.toFixed(1)}B`;
    } else if (num >= 1_000_000) {
      const millions = num / 1_000_000;
      return millions >= 10 ? `${Math.floor(millions)}M` : `${millions.toFixed(1)}M`;
    } else if (num >= 1_000) {
      const thousands = num / 1_000;
      return thousands >= 10 ? `${Math.floor(thousands)}K` : `${thousands.toFixed(1)}K`;
    }
    return Math.floor(num).toString();
  };

  // Handle page navigation - memoized
  const navigateToPage = useCallback(async (newPage: number) => {
    if (newPage < 0) return;

    if (!launchInfo?.creatorWallet) {
      return;
    }

    setCurrentPage(newPage);

    // Check if we already have this page cached
    if (transactionPages[newPage]) {
      setCurrentPage(newPage);
      return;
    }

    // Need to fetch this page
    setLoadingPage(true);

    try {
      const response = await fetch(`/api/transactions/${tokenAddress}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenAddress,
          walletAddress: launchInfo.creatorWallet,
          limit: TRANSACTIONS_PER_PAGE,
          fetchLabels: isUserDev,
          ...(lastSignature && { before: lastSignature })
        })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch transactions');
      }

      const data = await response.json();
      const transactions = data.transactions || [];
      const hasMore = data.hasMore || false;
      const newLastSignature = data.lastSignature || null;

      if (transactions.length > 0) {
        const processedTransactions = transactions.map((tx: Transaction) => ({
          ...tx,
          fromLabel: processLabel(tx.fromLabel, tx.fromWallet),
          toLabel: processLabel(tx.toLabel, tx.toWallet)
        }));

        const newPages = [...transactionPages];
        newPages[newPage] = processedTransactions;
        setTransactionPages(newPages);
        setLastSignature(newLastSignature);
      }
    } catch (error) {
      // Error fetching page
    } finally {
      setLoadingPage(false);
    }
  }, [tokenAddress, lastSignature, TRANSACTIONS_PER_PAGE, processLabel, transactionPages, launchInfo]);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };


  // Helper to check if label is a social label (not a wallet address)
  const isSocialLabel = (label: string, wallet: string) => {
    return label !== wallet && !label.match(/^[A-Za-z0-9]{6}\.\.\.[A-Za-z0-9]{6}$/);
  };

  const getTransactionDescription = (tx: Transaction) => {
    switch (tx.type) {
      case 'transfer':
        return {
          action: 'Reward',
          description: `${formatTokenAmount(tx.amount)} to `,
          toUser: tx.toLabel,
          toUserIsSocial: isSocialLabel(tx.toLabel, tx.toWallet)
        };
      case 'mint':
        return {
          action: 'Claim',
          description: formatTokenAmount(tx.amount),
          toUser: '',
          toUserIsSocial: false
        };
      case 'sell':
        return {
          action: 'Sell',
          description: tx.solAmount ? `${tx.solAmount} SOL` : `${formatTokenAmount(tx.amount)} ${tokenInfo.symbol}`,
          toUser: '',
          toUserIsSocial: false
        };
      case 'buy':
        return {
          action: 'Buy',
          description: formatTokenAmount(tx.amount),
          toUser: '',
          toUserIsSocial: false
        };
      case 'burn':
        return {
          action: 'Burn',
          description: formatTokenAmount(tx.amount),
          toUser: '',
          toUserIsSocial: false
        };
      default:
        return {
          action: 'Unknown',
          description: 'transaction',
          toUser: '',
          toUserIsSocial: false
        };
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'transfer': return 'text-[#b2e9fe]';
      case 'buy': return 'text-[#b2e9fe]';
      case 'sell': return 'text-[#b2e9fe]';
      case 'burn': return 'text-[#b2e9fe]';
      case 'mint': return 'text-[#b2e9fe]';
      default: return 'text-gray-300';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'transfer':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
          </svg>
        );
      case 'mint':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        );
      case 'sell':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
          </svg>
        );
      case 'buy':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        );
      case 'burn':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
          </svg>
        );
    }
  };

  return (
    <div>
      {/* Header */}
      <h1 className="text-7xl font-bold">Txn History</h1>
      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
        {'//'}Transaction history for ${tokenInfo.symbol}
      </p>

      <div className="mt-5.5">
        <div className="flex items-center gap-3 text-[14px]" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
          {tokenInfo.imageUri && (
            <img
              src={tokenInfo.imageUri}
              alt={tokenInfo.symbol}
              className="w-8 h-8 rounded-full"
              onError={(e) => {
                e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="gray"><circle cx="12" cy="12" r="10"/></svg>';
              }}
            />
          )}
          <span className="font-bold text-white">{tokenInfo.symbol}</span>
          <span className="text-white">{tokenInfo.name}</span>
          <span
            onClick={() => {
              navigator.clipboard.writeText(tokenInfo.address);
            }}
            className="text-gray-300 cursor-pointer hover:text-[#b2e9fe] transition-colors"
            title="Click to copy full address"
          >
            {tokenInfo.address.slice(0, 6)}...{tokenInfo.address.slice(-6)}
          </span>
        </div>
      </div>

      {/* Refresh Button */}
      {!loading && (
        <div className="mt-5">
          <button
            onClick={() => {
              // Clear local pagination state
              setTransactionPages([]);
              setCurrentPage(0);
              setLastSignature(null);
              // Revalidate all cached data
              mutateLaunch();
              mutateSupply();
              mutateDesignated();
              mutateTransactions();
            }}
            className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
          >
            [Refresh]
          </button>
        </div>
      )}

      {/* Transactions */}
      {loading ? (
        <p className="text-[14px] text-gray-300 mt-5.5" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
          [Loading...]
        </p>
      ) : (
        <div className="space-y-0 mt-6 max-w-2xl">
          {currentTransactions.length === 0 ? (
            <p className="text-[14px] text-gray-300 text-center py-12" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
              No transactions found
            </p>
          ) : (
            currentTransactions.map((tx: Transaction) => {
              const isExpanded = expandedTransactions.has(tx.signature);
              const hasMemo = tx.memo && tx.memo.trim().length > 0;

              return (
                <div key={tx.signature} className="pb-1">
                  {/* Transaction Row - Desktop */}
                  <div className="hidden md:flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          if (hasMemo) {
                            const newExpanded = new Set(expandedTransactions);
                            if (isExpanded) {
                              newExpanded.delete(tx.signature);
                            } else {
                              newExpanded.add(tx.signature);
                            }
                            setExpandedTransactions(newExpanded);
                          }
                        }}
                        className={`text-white ${hasMemo ? 'cursor-pointer hover:opacity-80' : 'cursor-default'} transition-opacity`}
                        aria-label={hasMemo ? (isExpanded ? "Collapse memo" : "Expand memo") : tx.type}
                        disabled={!hasMemo}
                      >
                        {getTypeIcon(tx.type)}
                      </button>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[14px] text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                          {(() => {
                            const desc = getTransactionDescription(tx);
                            return (
                              <>
                                <span className={getTypeColor(tx.type)}>{desc.action}</span>
                                : {desc.description}
                                {desc.toUser && (
                                  <span className={desc.toUserIsSocial ? 'font-bold' : ''}>
                                    {desc.toUser}
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </span>
                        <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                          ({calculateSupplyPercentage(tx.amount)}%)
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                        {formatDate(tx.timestamp)}
                      </span>
                      <a
                        href={`https://solscan.io/tx/${tx.signature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
                        title="View on Solscan"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </div>

                  {/* Transaction Row - Mobile */}
                  <div className="md:hidden">
                    {/* First Row: Icon, Label with amount and "to who", Solscan link */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            if (hasMemo) {
                              const newExpanded = new Set(expandedTransactions);
                              if (isExpanded) {
                                newExpanded.delete(tx.signature);
                              } else {
                                newExpanded.add(tx.signature);
                              }
                              setExpandedTransactions(newExpanded);
                            }
                          }}
                          className={`text-white ${hasMemo ? 'cursor-pointer hover:opacity-80' : 'cursor-default'} transition-opacity`}
                          aria-label={hasMemo ? (isExpanded ? "Collapse memo" : "Expand memo") : tx.type}
                          disabled={!hasMemo}
                        >
                          {getTypeIcon(tx.type)}
                        </button>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[14px] text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                            {(() => {
                              const desc = getTransactionDescription(tx);
                              return (
                                <>
                                  <span className={getTypeColor(tx.type)}>{desc.action}</span>
                                  : {desc.description}
                                  {desc.toUser && (
                                    <span className={desc.toUserIsSocial ? 'font-bold' : ''}>
                                      {desc.toUser}
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </span>
                          <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                            ({parseFloat(calculateSupplyPercentage(tx.amount)).toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                      <a
                        href={`https://solscan.io/tx/${tx.signature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
                        title="View on Solscan"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                    {/* Second Row: Timestamp */}
                    <div className="ml-8 mt-0.5">
                      <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                        {formatDate(tx.timestamp)}
                      </span>
                    </div>
                  </div>
                  {/* Memo Expansion */}
                  {hasMemo && isExpanded && (
                    <div className="mt-3 ml-8 pl-4 border-l-2 border-gray-700">
                      <p className="text-[14px] text-gray-300 italic" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                        {tx.memo}
                      </p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Pagination */}
      {!loading && (currentPage > 0 || hasMorePages) && (
        <div className="flex items-center justify-start gap-2 mt-5 max-w-2xl">
          <button
            onClick={() => navigateToPage(currentPage - 1)}
            disabled={currentPage === 0 || loadingPage}
            className={`text-[14px] transition-colors cursor-pointer ${
              currentPage === 0 || loadingPage
                ? 'text-gray-300 opacity-50 cursor-not-allowed'
                : 'text-gray-300 hover:text-[#b2e9fe]'
            }`}
            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
          >
            {loadingPage ? '[Loading...]' : '[Previous]'}
          </button>
          <span className="text-[14px] text-gray-300 px-4" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            Page {currentPage + 1}
          </span>
          <button
            onClick={() => navigateToPage(currentPage + 1)}
            disabled={!hasMorePages || loadingPage}
            className={`text-[14px] transition-colors cursor-pointer ${
              !hasMorePages || loadingPage
                ? 'text-gray-300 opacity-50 cursor-not-allowed'
                : 'text-gray-300 hover:text-[#b2e9fe]'
            }`}
            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
          >
            {loadingPage ? '[Loading...]' : '[Next]'}
          </button>
        </div>
      )}
    </div>
  );
}
