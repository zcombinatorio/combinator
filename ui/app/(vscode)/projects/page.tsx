'use client';
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

import { ProjectCard } from '@/components/ProjectCard';
import { FilterButton } from '@/components/FilterButton';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useWallet } from '@/components/WalletProvider';
import { useRouter, usePathname } from 'next/navigation';
import { useTheme } from '@/contexts/ThemeContext';

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
  discord?: string;
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
  price_change_24h?: number;
}

export default function ProjectsPage() {
  const { wallet, externalWallet } = useWallet();
  const router = useRouter();
  const { theme } = useTheme();
  const pathname = usePathname();
  const [tokens, setTokens] = useState<TokenLaunch[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'all' | 'verified'>('verified');
  const [searchQuery, setSearchQuery] = useState('');
  const [verifiedPage, setVerifiedPage] = useState(1);
  const [allPage, setAllPage] = useState(1);
  const [tokenMetadata, setTokenMetadata] = useState<Record<string, TokenMetadata>>({});
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [sortBy, setSortBy] = useState<'mcapHigher' | 'mcapLower' | 'ageNewer' | 'ageOlder'>('mcapHigher');
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setIsFilterDropdownOpen(false);
      }
    };

    if (isFilterDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isFilterDropdownOpen]);

  const ITEMS_PER_PAGE = 10;

  useEffect(() => {
    fetchTokens();
  }, []);


  const fetchMarketDataBatch = useCallback(async (addresses: string[]) => {
    if (addresses.length === 0) return;

    try {
      const results = await Promise.allSettled(
        addresses.map(async (tokenAddress) => {
          const response = await fetch(`/api/market-data/${tokenAddress}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tokenAddress })
          });

          if (!response.ok) return null;
          const result = await response.json();
          if (!result?.success || !result?.data) return null;
          return { tokenAddress, data: result.data as MarketData };
        })
      );

      const successful = results
        .map((res) => (res.status === 'fulfilled' ? res.value : null))
        .filter((value): value is { tokenAddress: string; data: MarketData } => Boolean(value));

      if (successful.length > 0) {
        setMarketData((prev) => {
          const next = { ...prev };
          successful.forEach(({ tokenAddress, data }) => {
            next[tokenAddress] = data;
          });
          return next;
        });
      }
    } catch (error) {
      console.error('Error fetching market data batch:', error);
    }
  }, []);

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

  useEffect(() => {
    if (tokens.length === 0) return;

    const relevantTokens =
      viewMode === 'all'
        ? tokens
        : tokens.filter((token) => token.verified);

    const addressesToFetch = relevantTokens
      .map((token) => token.token_address)
      .filter((address) => !marketData[address]);

    if (addressesToFetch.length === 0) return;

    fetchMarketDataBatch(addressesToFetch);
  }, [tokens, viewMode, marketData, fetchMarketDataBatch]);

  const handleRowClick = (token: TokenLaunch) => {
    router.push(`/projects/${token.token_address}`);
  };

  // Memoize filtered and sorted tokens to avoid recalculating on every render
  const filteredTokens = useMemo(() => {
    let filtered = tokens;

    // Apply view mode filter
    if (viewMode === 'verified') {
      filtered = filtered.filter(token => token.verified);
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(token => {
        const name = (token.token_name || '').toLowerCase();
        const symbol = (token.token_symbol || '').toLowerCase();
        const address = token.token_address.toLowerCase();
        return name.includes(query) || symbol.includes(query) || address.includes(query);
      });
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'mcapHigher') {
        const mcapA = marketData[a.token_address]?.market_cap || 0;
        const mcapB = marketData[b.token_address]?.market_cap || 0;
        return mcapB - mcapA; // Descending order (highest first)
      } else if (sortBy === 'mcapLower') {
        const mcapA = marketData[a.token_address]?.market_cap || 0;
        const mcapB = marketData[b.token_address]?.market_cap || 0;
        return mcapA - mcapB; // Ascending order (lowest first)
      } else if (sortBy === 'ageNewer') {
        const ageA = new Date(a.launch_time).getTime();
        const ageB = new Date(b.launch_time).getTime();
        return ageB - ageA; // Descending order (newest first)
      } else if (sortBy === 'ageOlder') {
        const ageA = new Date(a.launch_time).getTime();
        const ageB = new Date(b.launch_time).getTime();
        return ageA - ageB; // Ascending order (oldest first)
      }
      return 0;
    });

    return sorted;
  }, [tokens, viewMode, searchQuery, marketData, sortBy]);

  // Calculate pagination
  const currentPage = viewMode === 'verified' ? verifiedPage : allPage;
  const setCurrentPage = viewMode === 'verified' ? setVerifiedPage : setAllPage;

  const totalPages = Math.ceil(filteredTokens.length / ITEMS_PER_PAGE);
  const pageNumbers = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);
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
    <div className="flex flex-col gap-[20px] px-5 py-5 w-full">
      {/* Header with Title and Connect Wallet Button - handled by Header component */}
      
      {/* Search and Filters */}
      <div className="flex items-center justify-between w-full">
        {/* Search Bar */}
        <div className="flex gap-[20px] items-center flex-1">
          <div
            className="flex gap-[8px] items-center px-[9px] py-[6px] rounded-[8px] w-[400px]"
            style={{
              backgroundColor: theme === 'dark' ? '#222222' : '#f3f3f5',
            }}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              style={{ color: theme === 'dark' ? '#6C6C74' : '#717182' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter ticker, contract address..."
              className={`flex-1 bg-transparent text-[14px] leading-[20px] focus:outline-none ${
                theme === 'dark' ? 'text-[#ffffff] placeholder:text-[#6C6C74]' : 'text-[#0a0a0a] placeholder:text-[rgba(113,113,130,0.8)]'
              }`}
              style={{ fontFamily: 'SF Pro Text, sans-serif' }}
            />
          </div>
        </div>

        {/* Filter Chips */}
        <div className="flex gap-[6px] items-center">
          <FilterButton
            label="All"
            isActive={viewMode === 'all'}
            onClick={() => setViewMode('all')}
          />
          <FilterButton
            label="Only verified"
            isActive={viewMode === 'verified'}
            onClick={() => setViewMode('verified')}
          />
          <div className="relative" ref={filterDropdownRef}>
            <button
              onClick={() => setIsFilterDropdownOpen(!isFilterDropdownOpen)}
              className="rounded-[8px] px-[12px] py-[6px] flex gap-[4px] items-center justify-center transition-colors h-[32px]"
              style={{
                fontFamily: 'Inter, sans-serif',
                backgroundColor: theme === 'dark' ? '#222222' : '#ffffff',
                border: `1px solid ${theme === 'dark' ? '#1C1C1C' : '#e5e5e5'}`,
                color: theme === 'dark' ? '#ffffff' : '#0a0a0a',
              }}
              onMouseEnter={(e) => {
                if (!isFilterDropdownOpen) {
                  e.currentTarget.style.backgroundColor = theme === 'dark' ? '#2a2a2a' : '#f6f6f7';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = theme === 'dark' ? '#222222' : '#ffffff';
              }}
            >
              <span className="font-semibold text-[12px] leading-[12px] tracking-[0.24px] capitalize">Filter by</span>
              <svg 
                className={`w-3 h-3 transition-transform ${isFilterDropdownOpen ? 'rotate-180' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
                style={{ color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {isFilterDropdownOpen && (
              <div
                className="absolute right-0 top-[calc(100%+8px)] rounded-[8px] shadow-lg min-w-[200px] z-20 overflow-hidden"
                style={{
                  backgroundColor: theme === 'dark' ? '#2A2A2A' : '#ffffff',
                  border: `1px solid ${theme === 'dark' ? '#1C1C1C' : '#e5e5e5'}`,
                }}
              >
                {([
                  { key: 'mcapHigher', label: 'MCap (Higher)' },
                  { key: 'mcapLower', label: 'MCap (Lower)' },
                  { key: 'ageNewer', label: 'Age (Newer)' },
                  { key: 'ageOlder', label: 'Age (Older)' },
                ] as const).map(({ key, label }) => {
                  const isCurrent = sortBy === key;
                  const baseBg = theme === 'dark' ? (isCurrent ? '#35343F' : '#2A2A2A') : (isCurrent ? '#f6f6f7' : '#ffffff');
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setSortBy(key);
                        setIsFilterDropdownOpen(false);
                      }}
                      className="w-full text-left px-[12px] py-[8px] text-[12px] transition-colors"
                      style={{
                        fontFamily: 'Inter, sans-serif',
                        backgroundColor: baseBg,
                        color: theme === 'dark' ? '#ffffff' : '#0a0a0a',
                        fontWeight: isCurrent ? 600 : 400,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = theme === 'dark' ? '#35343F' : '#f6f6f7';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = baseBg;
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Projects List */}
      <div className="flex flex-col gap-[10px] w-full">
        {loading ? (
          <p className="text-[14px] text-[#717182]" style={{ fontFamily: 'Inter, sans-serif' }}>
            Loading tokens...
          </p>
        ) : filteredTokens.length === 0 ? (
          <p className="text-[14px] text-[#717182]" style={{ fontFamily: 'Inter, sans-serif' }}>
            No tokens launched yet
          </p>
        ) : (
          <>
            {paginatedTokens.map((token) => {
              const metadata = tokenMetadata[token.token_address];
              const market = marketData[token.token_address];
              return (
                <ProjectCard
                  key={token.id}
                  tokenName={token.token_name}
                  tokenSymbol={token.token_symbol}
                  tokenAddress={token.token_address}
                  creatorTwitter={token.creator_twitter}
                  creatorGithub={token.creator_github}
                  metadata={metadata}
                  launchTime={token.launch_time}
                  marketCap={market?.market_cap}
                  priceChange={market?.price_change_24h}
                  verified={token.verified}
                  onClick={() => handleRowClick(token)}
                />
              );
            })}
          </>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="text-[14px] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{ 
                fontFamily: 'Inter, sans-serif',
                color: theme === 'dark' ? '#717182' : '#717182',
              }}
              {...(currentPage !== 1 && {
                onMouseEnter: (e) => {
                  e.currentTarget.style.color = theme === 'dark' ? '#ffffff' : '#0a0a0a';
                },
                onMouseLeave: (e) => {
                  e.currentTarget.style.color = '#717182';
                },
              })}
            >
              Previous
            </button>
            <div className="flex items-center gap-[6px]">
              {pageNumbers.map((page) => {
                const isActive = page === currentPage;
                const activeBg = theme === 'dark' ? '#5A5798' : '#403d6d';
                const inactiveBg = theme === 'dark' ? '#2a2a2a' : '#ffffff';
                const inactiveBorder = theme === 'dark' ? '#1C1C1C' : '#e5e5e5';
                const inactiveText = theme === 'dark' ? '#ffffff' : '#0a0a0a';
                const inactiveHover = theme === 'dark' ? '#2a2a2a' : '#f6f6f7';
                
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className="min-w-[36px] rounded-[8px] px-[12px] py-[6px] text-[14px] transition-colors"
                    style={{ 
                      fontFamily: 'Inter, sans-serif',
                      backgroundColor: isActive ? activeBg : inactiveBg,
                      border: isActive ? 'none' : `1px solid ${inactiveBorder}`,
                      color: isActive ? '#ffffff' : inactiveText,
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = inactiveHover;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = inactiveBg;
                      }
                    }}
                  >
                    {page}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="text-[14px] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{ 
                fontFamily: 'Inter, sans-serif',
                color: theme === 'dark' ? '#717182' : '#717182',
              }}
              {...(currentPage !== totalPages && {
                onMouseEnter: (e) => {
                  e.currentTarget.style.color = theme === 'dark' ? '#ffffff' : '#0a0a0a';
                },
                onMouseLeave: (e) => {
                  e.currentTarget.style.color = '#717182';
                },
              })}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}