'use client';

import { TokenCardVSCode } from '@/components/TokenCardVSCode';
import { useEffect, useState, useMemo } from 'react';
import { useWallet } from '@/components/WalletProvider';
import { useTabContext } from '@/contexts/TabContext';
import { useRouter, usePathname } from 'next/navigation';

interface TokenLaunch {
  id: number;
  launch_time: string;
  creator_wallet: string;
  token_address: string;
  token_metadata_url: string;
  token_name: string | null;
  token_symbol: string | null;
  creator_twitter: string | null;
  creator_github: string | null;
  created_at: string;
  totalClaimed?: string;
  availableToClaim?: string;
  verified?: boolean;
}

interface TokenMetadata {
  name: string;
  symbol: string;
  image: string;
  website?: string;
  twitter?: string;
  caEnding?: string;
  description?: string;
}

interface MarketData {
  price: number;
  liquidity: number;
  total_supply: number;
  circulating_supply: number;
  fdv: number;
  market_cap: number;
}

export default function ProjectsPage() {
  const { wallet, externalWallet } = useWallet();
  const { addTab } = useTabContext();
  const router = useRouter();
  const pathname = usePathname();
  const [tokens, setTokens] = useState<TokenLaunch[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'verified' | 'all'>('verified');
  const [verifiedPage, setVerifiedPage] = useState(1);
  const [allPage, setAllPage] = useState(1);
  const [tokenMetadata, setTokenMetadata] = useState<Record<string, TokenMetadata>>({});
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});

  const ITEMS_PER_PAGE = 10;

  useEffect(() => {
    fetchTokens();
  }, []);

  // Fetch market data when switching to 'all' view
  useEffect(() => {
    if (viewMode === 'all' && tokens.length > 0) {
      tokens.forEach((token) => {
        // Only fetch if we don't already have the data
        if (!marketData[token.token_address]) {
          fetchMarketData(token.token_address);
        }
      });
    }
  }, [viewMode, tokens]);

  const fetchTokens = async (forceRefresh = false) => {
    try {
      const response = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: forceRefresh })
      });
      if (response.ok) {
        const data = await response.json();
        setTokens(data.tokens);

        // Fetch metadata for all tokens
        data.tokens.forEach((token: TokenLaunch) => {
          fetchTokenMetadata(token.token_address, token.token_metadata_url);
        });

        // Only fetch market data for verified tokens on initial load
        const verifiedTokens = data.tokens.filter((token: TokenLaunch) =>
          token.verified
        );
        verifiedTokens.forEach((token: TokenLaunch) => {
          fetchMarketData(token.token_address);
        });

        // If we got cached data and it's been more than 30 seconds since page load,
        // silently fetch fresh data in background
        if (data.cached && !forceRefresh) {
          setTimeout(() => {
            fetch('/api/tokens', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh: true })
            })
              .then(res => res.json())
              .then(freshData => {
                if (freshData.tokens) {
                  setTokens(freshData.tokens);
                  freshData.tokens.forEach((token: TokenLaunch) => {
                    fetchTokenMetadata(token.token_address, token.token_metadata_url);
                  });

                  // Only fetch market data for verified tokens or if in 'all' view
                  const tokensToFetchMarketData = viewMode === 'all'
                    ? freshData.tokens
                    : freshData.tokens.filter((token: TokenLaunch) =>
                        token.verified
                      );
                  tokensToFetchMarketData.forEach((token: TokenLaunch) => {
                    fetchMarketData(token.token_address);
                  });
                }
              })
              .catch(console.error);
          }, 1000); // Fetch fresh data after 1 second
        }
      }
    } catch (error) {
      console.error('Error fetching tokens:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTokenMetadata = async (tokenAddress: string, metadataUrl: string) => {
    try {
      const response = await fetch(metadataUrl);
      if (response.ok) {
        const metadata: TokenMetadata = await response.json();
        setTokenMetadata(prev => ({
          ...prev,
          [tokenAddress]: metadata
        }));
      }
    } catch (error) {
      console.error(`Error fetching metadata for ${tokenAddress}:`, error);
    }
  };

  const fetchMarketData = async (tokenAddress: string) => {
    try {
      const response = await fetch(`/api/market-data/${tokenAddress}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress })
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          setMarketData(prev => ({
            ...prev,
            [tokenAddress]: result.data
          }));
        }
      }
    } catch (error) {
      console.error(`Error fetching market data for ${tokenAddress}:`, error);
    }
  };

  const handleRowClick = (token: TokenLaunch) => {
    addTab('history', token.token_address, token.token_symbol || 'Unknown', pathname);
    router.push(`/history/${token.token_address}`);
  };

  // Memoize filtered tokens to avoid recalculating on every render
  const filteredTokens = useMemo(() => {
    // Apply verified filter if in verified mode
    if (viewMode === 'verified') {
      return tokens.filter(token =>
        token.verified
      );
    }

    return tokens;
  }, [tokens, viewMode]);

  // Calculate pagination
  const currentPage = viewMode === 'verified' ? verifiedPage : allPage;
  const setCurrentPage = viewMode === 'verified' ? setVerifiedPage : setAllPage;

  const totalPages = Math.ceil(filteredTokens.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedTokens = filteredTokens.slice(startIndex, endIndex);

  // Calculate cumulative market cap
  const cumulativeMarketCap = useMemo(() => {
    return filteredTokens.reduce((total, token) => {
      const market = marketData[token.token_address];
      return total + (market?.market_cap || 0);
    }, 0);
  }, [filteredTokens, marketData]);

  const formatMarketCap = (marketCap: number) => {
    if (!marketCap || marketCap === 0) return '-';
    if (marketCap >= 1_000_000) {
      return `$${(marketCap / 1_000_000).toFixed(2)}M`;
    } else if (marketCap >= 1_000) {
      return `$${(marketCap / 1_000).toFixed(2)}K`;
    }
    return `$${marketCap.toFixed(2)}`;
  };

  return (
    <>
      <h1 className="text-7xl font-bold">Projects</h1>
      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}See ZC launched projects here</p>

      <div className="flex items-center gap-4 mt-7">
        <button
          onClick={() => setViewMode('verified')}
          className={`text-[14px] transition-colors cursor-pointer ${
            viewMode === 'verified'
              ? 'text-[#b2e9fe]'
              : 'text-gray-300 hover:text-[#b2e9fe]'
          }`}
          style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
        >
          [Verified]
        </button>
        <button
          onClick={() => setViewMode('all')}
          className={`text-[14px] transition-colors cursor-pointer ${
            viewMode === 'all'
              ? 'text-[#b2e9fe]'
              : 'text-gray-300 hover:text-[#b2e9fe]'
          }`}
          style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
        >
          [All]
        </button>
        <div className="flex items-baseline gap-2">
          <span className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="md:hidden">{'//'}Total MCap:</span>
            <span className="hidden md:inline">{'//'}Cumulative Market Cap:</span>
          </span>
          <span className="text-[14px] font-semibold text-[#b2e9fe]" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            {formatMarketCap(cumulativeMarketCap)}
          </span>
        </div>
      </div>

      <div className="mt-6">
        {loading ? (
          <p className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            Loading tokens...
          </p>
        ) : filteredTokens.length === 0 ? (
          <p className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            No tokens launched yet
          </p>
        ) : (
          <div className="space-y-4 max-w-5xl">
            {paginatedTokens.map((token) => {
              const metadata = tokenMetadata[token.token_address];
              const market = marketData[token.token_address];
              return (
                <TokenCardVSCode
                  key={token.id}
                  tokenName={token.token_name}
                  tokenSymbol={token.token_symbol}
                  tokenAddress={token.token_address}
                  creatorWallet={token.creator_wallet}
                  creatorTwitter={token.creator_twitter}
                  creatorGithub={token.creator_github}
                  metadata={metadata}
                  launchTime={token.launch_time}
                  marketCap={market?.market_cap}
                  onClick={() => handleRowClick(token)}
                  isCreator={!!(externalWallet && wallet && token.creator_wallet === wallet.toBase58())}
                />
              );
            })}
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-start gap-2 mt-6">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="text-[14px] text-gray-300 hover:text-[#b2e9fe] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
            >
              [Previous]
            </button>
            <span className="text-[14px] text-gray-300 px-4" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="text-[14px] text-gray-300 hover:text-[#b2e9fe] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
            >
              [Next]
            </button>
          </div>
        )}
      </div>
    </>
  );
}