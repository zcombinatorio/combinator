'use client';

import { TokenCardVSCode } from '@/components/TokenCardVSCode';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';
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
    <Container>
      <div className="mb-8">
        <h1 style={{ color: 'var(--foreground)' }}>Projects</h1>
        <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
          Explore tokens launched on the platform
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-8">
        <div className="flex gap-2">
          <Button
            variant={viewMode === 'verified' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setViewMode('verified')}
          >
            Verified
          </Button>
          <Button
            variant={viewMode === 'all' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setViewMode('all')}
          >
            All Projects
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: 'var(--foreground-secondary)' }}>
            <span className="md:hidden">Total MCap:</span>
            <span className="hidden md:inline">Cumulative Market Cap:</span>
          </span>
          <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
            {formatMarketCap(cumulativeMarketCap)}
          </span>
        </div>
      </div>

      <div>
        {loading ? (
          <p style={{ color: 'var(--foreground-secondary)' }}>
            Loading projects...
          </p>
        ) : filteredTokens.length === 0 ? (
          <p style={{ color: 'var(--foreground-secondary)' }}>
            No projects found
          </p>
        ) : (
          <div className="space-y-4">
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
          <div className="flex items-center justify-center gap-3 mt-8">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm px-4" style={{ color: 'var(--foreground-secondary)' }}>
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </Container>
  );
}