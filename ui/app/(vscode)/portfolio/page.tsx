'use client';

import { useWallet } from '@/components/WalletProvider';
import { ClaimButton } from '@/components/ClaimButton';
import { SecureVerificationModal } from '@/components/SecureVerificationModal';
import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useTabContext } from '@/contexts/TabContext';
import { useRouter, usePathname } from 'next/navigation';

interface TokenLaunch {
  id: number;
  launch_time: string;
  creator_wallet: string;
  token_address: string;
  token_metadata_url: string;
  token_name?: string;
  token_symbol?: string;
  created_at: string;
  creator_twitter?: string;
  creator_github?: string;
  is_creator_designated?: boolean;
  verified?: boolean;
}

interface VerifiedTokenLaunch extends TokenLaunch {
  verified: boolean;
  userBalance?: string;
}

interface Presale {
  id: number;
  token_address: string;
  creator_wallet: string;
  token_name?: string;
  token_symbol?: string;
  token_metadata_url: string;
  presale_tokens?: string[];
  creator_twitter?: string;
  creator_github?: string;
  status: string;
  created_at: string;
}


export default function PortfolioPage() {
  const { wallet, isPrivyAuthenticated, connecting, externalWallet, hasTwitter, hasGithub, twitterUsername, githubUsername } = useWallet();
  const { ready, login, authenticated, linkWallet } = usePrivy();
  const { addTab } = useTabContext();
  const router = useRouter();
  const pathname = usePathname();
  const [launches, setLaunches] = useState<VerifiedTokenLaunch[]>([]);
  const [presales, setPresales] = useState<Presale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasVerified, setHasVerified] = useState(false);
  const [loadingBalances, setLoadingBalances] = useState<Set<string>>(new Set());
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [copiedTokens, setCopiedTokens] = useState<Set<string>>(new Set());
  const [retryCount, setRetryCount] = useState(0);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [viewMode, setViewMode] = useState<'verified' | 'all' | 'presale'>('verified');
  const [tokenMetadata, setTokenMetadata] = useState<Record<string, { image?: string }>>({});


  // Check if user needs to verify designated claims
  useEffect(() => {
    const checkDesignatedClaims = async () => {
      if (!isPrivyAuthenticated || hasVerified) return;
      if (!hasTwitter && !hasGithub) return;

      try {
        // Check if there are any designated claims for this user
        const params = new URLSearchParams();
        if (twitterUsername) params.append('twitter', twitterUsername);
        if (githubUsername) params.append('github', githubUsername);

        const response = await fetch(`/api/verify-designated`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            twitter: twitterUsername || undefined,
            github: githubUsername || undefined
          })
        });
        const data = await response.json();

        if (data.claims && data.claims.length > 0) {
          // User has designated tokens that need verification
          const unverifiedClaims = data.claims.filter((c: { verified_wallet?: string; has_verified_wallet?: boolean }) => !c.verified_wallet);
          if (unverifiedClaims.length > 0) {
            setNeedsVerification(true);
          }
        }
      } catch (error) {
        console.error('Error checking designated claims:', error);
      }
    };

    checkDesignatedClaims();
  }, [isPrivyAuthenticated, hasTwitter, hasGithub, twitterUsername, githubUsername, hasVerified]);

  useEffect(() => {
    console.log('Portfolio Page State:', {
      ready,
      isPrivyAuthenticated,
      wallet: wallet?.toString(),
      connecting
    });

    const fetchLaunches = async () => {
      if (!wallet) {
        setLaunches([]);
        setLoading(false);
        setError(null);
        return;
      }

      setError(null);
      setLoading(true);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        // Build URL with social profiles if available
        const params = new URLSearchParams();
        params.append('creator', wallet.toString());
        params.append('includeSocials', 'true');

        // Add social profile URLs if connected
        if (hasTwitter && twitterUsername) {
          // Send both twitter.com and x.com URLs to match either format in database
          params.append('twitterUrl', twitterUsername);
        }
        if (hasGithub && githubUsername) {
          params.append('githubUrl', `https://github.com/${githubUsername}`);
        }

        const response = await fetch(`/api/launches`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            creator: params.get('creator'),
            includeSocials: params.get('includeSocials') === 'true',
            twitterUrl: params.get('twitterUrl'),
            githubUrl: params.get('githubUrl')
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const data = await response.json();

        if (response.ok) {
          const allLaunches: TokenLaunch[] = data.launches || [];

          // Batch verify tokens - process in chunks for better performance
          const chunkSize = 5;
          const chunks = [];

          for (let i = 0; i < allLaunches.length; i += chunkSize) {
            chunks.push(allLaunches.slice(i, i + chunkSize));
          }

          const verifiedChunks = await Promise.all(
            chunks.map(async (chunk) => {
              return Promise.all(
                chunk.map(async (launch) => {
                  try {
                    // Use the verified property from the database, not the exists check
                    const verified = launch.verified || false;

                    let userBalance = '--';
                    if (wallet) {
                      // Always fetch live balance from API
                      try {
                        const balanceResponse = await fetch(`/api/balance/${launch.token_address}/${wallet.toString()}`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            tokenAddress: launch.token_address,
                            walletAddress: wallet.toString()
                          })
                        });
                        if (balanceResponse.ok) {
                          const balanceData = await balanceResponse.json();
                          userBalance = balanceData.balance || '--';
                        }
                      } catch (error) {
                        console.error('Error fetching live balance for', launch.token_address, error);
                        // Keep balance as '--' if fetch fails
                      }
                    }

                    return {
                      ...launch,
                      verified,
                      userBalance,
                      is_creator_designated: launch.is_creator_designated
                    };
                  } catch (error) {
                    console.error(`Error fetching balance for ${launch.token_address}:`, error);
                    return {
                      ...launch,
                      verified: launch.verified || false,
                      userBalance: '--'
                    };
                  }
                })
              );
            })
          );

          const verifiedLaunches = verifiedChunks.flat();

          // Store all launches, filtering will be done in the UI based on viewMode
          setLaunches(verifiedLaunches);

          // Fetch metadata for all launches
          verifiedLaunches.forEach((launch) => {
            if (launch.token_metadata_url) {
              fetch(launch.token_metadata_url)
                .then(res => res.json())
                .then(metadata => {
                  setTokenMetadata(prev => ({
                    ...prev,
                    [launch.token_address]: { image: metadata.image }
                  }));
                })
                .catch(err => console.error(`Error fetching metadata for ${launch.token_address}:`, err));
            }
          });
        } else {
          console.error('Failed to fetch launches:', data.error);
          setError(data.error || 'Failed to fetch launches');
          setLaunches([]);
        }
      } catch (error: unknown) {
        console.error('Error fetching launches:', error);
        if (error instanceof Error && error.name === 'AbortError') {
          setError('Request timeout. Please refresh the page.');
        } else {
          setError('Failed to load your tokens. Please try again.');
        }
        setLaunches([]);
      } finally {
        setLoading(false);
      }
    };

    fetchLaunches();
  }, [wallet, retryCount, connecting, isPrivyAuthenticated, ready, hasTwitter, hasGithub, twitterUsername, githubUsername]);

  // Fetch presales
  useEffect(() => {
    const fetchPresales = async () => {
      if (!wallet) {
        setPresales([]);
        return;
      }

      try {
        const response = await fetch(`/api/presale?creator=${wallet.toString()}`);
        const data = await response.json();

        if (response.ok) {
          setPresales(data.presales || []);

          // Fetch metadata for all presales
          (data.presales || []).forEach((presale: Presale) => {
            if (presale.token_metadata_url) {
              fetch(presale.token_metadata_url)
                .then(res => res.json())
                .then(metadata => {
                  setTokenMetadata(prev => ({
                    ...prev,
                    [presale.token_address]: { image: metadata.image }
                  }));
                })
                .catch(err => console.error(`Error fetching metadata for ${presale.token_address}:`, err));
            }
          });
        } else {
          console.error('Failed to fetch presales:', data.error);
          setPresales([]);
        }
      } catch (error) {
        console.error('Error fetching presales:', error);
        setPresales([]);
      }
    };

    fetchPresales();
  }, [wallet, retryCount]);

  const formatDate = (dateString: string, includeTime: boolean = true) => {
    const date = new Date(dateString);
    if (includeTime) {
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } else {
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
  };

  const formatNumberShort = (value: number | string) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return '--';

    if (num >= 1_000_000_000) {
      return `${(num / 1_000_000_000).toFixed(2)}B`;
    } else if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(2)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(2)}K`;
    }
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const refreshTokenBalance = async (tokenAddress: string, delayMs: number = 0) => {
    if (!wallet) return;

    // Set loading state
    setLoadingBalances(prev => new Set(prev).add(tokenAddress));

    try {
      // Wait for the specified delay to allow blockchain to propagate
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Retry logic for balance fetch
      let attempts = 0;
      const maxAttempts = 3;
      let balanceData = null;

      while (attempts < maxAttempts && !balanceData) {
        try {
          const balanceResponse = await fetch(`/api/balance/${tokenAddress}/${wallet.toString()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tokenAddress,
              walletAddress: wallet.toString()
            })
          });
          if (balanceResponse.ok) {
            balanceData = await balanceResponse.json();
          }
        } catch {
          attempts++;
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between retries
          }
        }
        attempts++;
      }

      if (balanceData) {
        const newBalance = balanceData.balance || '0';
        // Update the balance for this specific token
        setLaunches(prevLaunches =>
          prevLaunches.map(launch =>
            launch.token_address === tokenAddress
              ? { ...launch, userBalance: newBalance }
              : launch
          )
        );
      }
    } catch (error) {
      console.error('Error refreshing balance:', error);
    } finally {
      // Remove loading state
      setLoadingBalances(prev => {
        const newSet = new Set(prev);
        newSet.delete(tokenAddress);
        return newSet;
      });
    }
  };

  // Force refresh - refetches data
  const forceRefresh = () => {
    setRetryCount(prev => prev + 1);
  };

  const copyWalletAddress = async () => {
    if (!wallet) return;

    try {
      await navigator.clipboard.writeText(wallet.toString());
      setCopiedWallet(true);
      setTimeout(() => setCopiedWallet(false), 2000);
    } catch (error) {
      console.error('Failed to copy wallet address:', error);
    }
  };

  const handleConnectWallet = () => {
    try {
      if (!authenticated) {
        login();
      } else {
        linkWallet();
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      setError('Failed to connect wallet. Please try again.');
    }
  };

  const copyTokenAddress = async (tokenAddress: string) => {
    try {
      await navigator.clipboard.writeText(tokenAddress);
      setCopiedTokens(prev => new Set(prev).add(tokenAddress));
      setTimeout(() => {
        setCopiedTokens(prev => {
          const newSet = new Set(prev);
          newSet.delete(tokenAddress);
          return newSet;
        });
      }, 2000);
    } catch (error) {
      console.error('Failed to copy token address:', error);
    }
  };

  return (
    <>
      <h1 className="text-7xl font-bold">Portfolio</h1>

      {needsVerification && !hasVerified && (
        <div className="mt-7 p-4 bg-yellow-900/20 border border-yellow-600">
          <h3 className="font-bold text-yellow-300 mb-2">Verification Required</h3>
          <p className="text-yellow-200 mb-3">
            You have designated tokens waiting to be claimed. Please verify your wallet to access them.
          </p>
          <button
            onClick={() => setShowVerificationModal(true)}
            className="px-4 py-2 bg-yellow-600 text-white hover:bg-yellow-700"
          >
            Verify Now
          </button>
        </div>
      )}

      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Your launched ZC tokens</p>

      {wallet && (
        <div className="mt-7">
          <div className="flex items-center">
            <p className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
              Active Wallet {externalWallet ? '(Connected)' : '(Embedded)'}:
            </p>
            <button
              onClick={copyWalletAddress}
              className="flex items-center gap-1 ml-2 hover:opacity-80 transition-opacity cursor-pointer"
              title="Copy wallet address"
            >
              <span className="text-[14px] text-[#b2e9fe] font-mono md:hidden" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                {wallet.toString().slice(0, 6)}
              </span>
              <span className="hidden md:inline text-[14px] text-[#b2e9fe] font-mono" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                {wallet.toString().slice(0, 6)}...{wallet.toString().slice(-6)}
              </span>
              {copiedWallet ? (
                <svg className="w-4 h-4 text-[#b2e9fe]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-[#b2e9fe]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}

      {!ready || connecting ? (
        <p className="mt-7 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Connecting to wallet...</p>
      ) : !isPrivyAuthenticated ? (
        <p className="mt-7 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Please login to view your launches</p>
      ) : !wallet ? (
        <button
          onClick={handleConnectWallet}
          className="mt-7 text-[14px] text-[#b2e9fe] hover:text-[#d0f2ff] transition-colors cursor-pointer"
          style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
        >
          [CLICK TO CONNECT WALLET]
        </button>
      ) : loading ? (
        <p className="mt-6.5 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Loading your tokens...</p>
      ) : error ? (
        <div className="mt-7 space-y-4">
          <p className="text-[14px] text-red-400" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{error}</p>
          <button
            onClick={() => setRetryCount(prev => prev + 1)}
            className="text-[14px] text-[#b2e9fe] hover:text-[#d0f2ff] transition-colors cursor-pointer"
            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
          >
            [TRY AGAIN]
          </button>
        </div>
      ) : (
        <>
          {launches.length > 0 && (() => {
            return (
              <div className="mt-6.5">
                <div className="flex items-center gap-4">
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
                  <button
                    onClick={() => setViewMode('presale')}
                    className={`text-[14px] transition-colors cursor-pointer ${
                      viewMode === 'presale'
                        ? 'text-[#b2e9fe]'
                        : 'text-gray-300 hover:text-[#b2e9fe]'
                    }`}
                    style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                  >
                    [Presale]
                  </button>
                  {wallet && (
                    <button
                      onClick={forceRefresh}
                      disabled={loading}
                      className="hidden md:block text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                      title="Refresh data"
                    >
                      {loading ? '[REFRESHING...]' : '[REFRESH]'}
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="mt-7">
            {(() => {
              // Handle presale view
              if (viewMode === 'presale') {
                return presales.length === 0 ? (
                  <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>No presales yet</p>
                ) : (
                  <div className="mt-4 space-y-1 max-w-5xl">
                    {presales.map((presale) => {
                      const getStatusColor = (status: string) => {
                        switch (status.toLowerCase()) {
                          case 'pending':
                            return 'bg-yellow-500/20 text-yellow-400';
                          case 'launched':
                            return 'bg-green-500/20 text-green-400';
                          case 'cancelled':
                            return 'bg-red-500/20 text-red-400';
                          default:
                            return 'bg-gray-500/20 text-gray-400';
                        }
                      };

                      return (
                        <div key={presale.id} className="pb-6">
                          <div className="flex items-center gap-4">
                            {/* Token Icon */}
                            <div className="flex-shrink-0">
                              {tokenMetadata[presale.token_address]?.image ? (
                                <img
                                  src={tokenMetadata[presale.token_address].image}
                                  alt={presale.token_symbol || 'Token'}
                                  className="w-8 h-8 rounded object-cover"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded bg-gray-800"></div>
                              )}
                            </div>

                            <div className="flex-1">
                              {/* Top Row */}
                              <div className="flex items-baseline justify-between">
                                <div className="flex items-baseline gap-4">
                                  <h3 className="text-[14px] text-white font-bold" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                                    {presale.token_symbol || 'N/A'}
                                  </h3>
                                  <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                                    {presale.token_name || 'Unnamed Token'}
                                  </span>
                                  <span className={`px-2 py-0.5 text-xs font-medium ${getStatusColor(presale.status)}`}>
                                    {presale.status.toUpperCase()}
                                  </span>
                                </div>
                                <p className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                                  Created: {formatDate(presale.created_at)}
                                </p>
                              </div>

                              {/* Bottom Row */}
                              <div className="flex items-center mt-0.5">
                                <button
                                  onClick={() => {
                                    const tabType = presale.status === 'launched' ? 'vesting' : 'presale';
                                    addTab(tabType, presale.token_address, presale.token_symbol || 'Unknown', pathname);
                                    router.push(`/presale/${presale.token_address}`);
                                  }}
                                  className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
                                  style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                                >
                                  <span className="md:hidden">{presale.status === 'launched' ? '[Vesting]' : '[Presale]'}</span>
                                  <span className="hidden md:inline">{presale.status === 'launched' ? '[View Vesting]' : '[View Presale]'}</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              }

              // Handle token views (verified/all)
              const filteredLaunches = viewMode === 'verified'
                ? launches.filter(launch => launch.verified)
                : launches;

              return filteredLaunches.length === 0 ? (
                <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>No tokens {viewMode === 'verified' ? 'verified' : 'launched'} yet</p>
              ) : (
                <div className="mt-4 space-y-1 max-w-5xl">
                  {filteredLaunches.map((launch) => (
                    <div key={launch.id} className="pb-6">
                      <div className="flex items-center gap-4">
                        {/* Token Icon */}
                        <div className="flex-shrink-0">
                          {tokenMetadata[launch.token_address]?.image ? (
                            <img
                              src={tokenMetadata[launch.token_address].image}
                              alt={launch.token_symbol || 'Token'}
                              className="w-10 h-10 rounded object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded bg-gray-800"></div>
                          )}
                        </div>

                        <div className="flex-1">
                          {/* Desktop Layout */}
                          <div className="hidden md:block">
                            <div className="flex items-baseline justify-between">
                              <div className="flex items-baseline gap-4">
                                <h3 className="text-[14px] text-white font-bold" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                                  {launch.token_symbol || 'N/A'}
                                </h3>
                                <div className="flex items-center gap-2">
                                  <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                                    {launch.token_name || 'Unnamed Token'}
                                  </span>
                                  {launch.is_creator_designated && (
                                    <span className="px-1 py-0.5 text-xs font-medium bg-[#b2e9fe]/20 text-[#b2e9fe]" title="You're designated as a creator for this token">
                                      Designated
                                    </span>
                                  )}
                                  <button
                                    onClick={() => copyTokenAddress(launch.token_address)}
                                    className="inline-flex items-center justify-center text-gray-300 hover:text-white transition-colors cursor-pointer"
                                    title="Copy token address"
                                  >
                                    {copiedTokens.has(launch.token_address) ? (
                                      <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                    ) : (
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                      </svg>
                                    )}
                                  </button>
                                </div>
                                <div className="flex items-baseline gap-2">
                                  <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Balance:</span>
                                  <span className="text-[14px] text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                                    {launch.userBalance === '--'
                                    ? '--'
                                    : parseFloat(launch.userBalance || '0').toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                  </span>
                                  {loadingBalances.has(launch.token_address) && (
                                    <div className="inline-flex items-center">
                                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <p className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                                Launched: {formatDate(launch.launch_time)}
                              </p>
                            </div>
                          </div>

                          {/* Mobile Layout */}
                          <div className="md:hidden">
                            {/* First Row: Symbol, Name, Copy icon, Designated badge */}
                            <div className="flex items-center gap-2">
                              <h3 className="text-[14px] text-white font-bold" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                                {launch.token_symbol || 'N/A'}
                              </h3>
                              <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                                {launch.token_name || 'Unnamed Token'}
                              </span>
                              <button
                                onClick={() => copyTokenAddress(launch.token_address)}
                                className="inline-flex items-center justify-center text-gray-300 hover:text-white transition-colors cursor-pointer"
                                title="Copy token address"
                              >
                                {copiedTokens.has(launch.token_address) ? (
                                  <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                )}
                              </button>
                              {launch.is_creator_designated && (
                                <span className="px-1 py-0.5 text-xs font-medium bg-[#b2e9fe]/20 text-[#b2e9fe]" title="You're designated as a creator for this token">
                                  Designated
                                </span>
                              )}
                            </div>

                            {/* Second Row: Balance, Claim button */}
                            <div className="flex items-center gap-4 mt-0.5">
                              <div className="flex items-baseline gap-2">
                                <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Bal:</span>
                                <span className="text-[14px] text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                                  {launch.userBalance === '--'
                                  ? '--'
                                  : formatNumberShort(launch.userBalance || '0')}
                                </span>
                                {loadingBalances.has(launch.token_address) && (
                                  <div className="inline-flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                                  </div>
                                )}
                              </div>
                              <ClaimButton
                                tokenAddress={launch.token_address}
                                tokenSymbol={launch.token_symbol || 'TOKEN'}
                                onSuccess={() => refreshTokenBalance(launch.token_address, 5000)}
                                disabled={!launch.is_creator_designated && (launch.creator_twitter || launch.creator_github) ? true : false}
                                disabledReason="Rewards designated"
                                isMobile={true}
                              />
                            </div>
                          </div>

                      {/* Bottom Row - Desktop */}
                      <div className="hidden md:flex items-center mt-0.5">
                        <div className="flex items-center gap-8">
                          <button
                            onClick={() => {
                              addTab('holders', launch.token_address, launch.token_symbol || 'Unknown', pathname);
                              router.push(`/holders/${launch.token_address}`);
                            }}
                            className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Manage Holders]
                          </button>
                          <button
                            onClick={() => {
                              addTab('history', launch.token_address, launch.token_symbol || 'Unknown', pathname);
                              router.push(`/history/${launch.token_address}`);
                            }}
                            className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [View History]
                          </button>
                        </div>
                        <div className="flex items-center gap-4 ml-16">
                          <button
                            onClick={() => {
                              addTab('transfer', launch.token_address, launch.token_symbol || 'Unknown', pathname);
                              router.push(`/transfer/${launch.token_address}`);
                            }}
                            className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Transfer]
                          </button>
                          <button
                            onClick={() => window.open(`https://jup.ag/swap?sell=${launch.token_address}&buy=So11111111111111111111111111111111111111112`, '_blank')}
                            className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Sell]
                          </button>
                          <button
                            onClick={() => {
                              addTab('burn', launch.token_address, launch.token_symbol || 'Unknown', pathname);
                              router.push(`/burn/${launch.token_address}`);
                            }}
                            className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Burn]
                          </button>
                        </div>
                        <div className="ml-auto">
                          <ClaimButton
                            tokenAddress={launch.token_address}
                            tokenSymbol={launch.token_symbol || 'TOKEN'}
                            onSuccess={() => refreshTokenBalance(launch.token_address, 5000)}
                            disabled={!launch.is_creator_designated && (launch.creator_twitter || launch.creator_github) ? true : false}
                            disabledReason="Rewards designated"
                          />
                        </div>
                      </div>

                      {/* Bottom Rows - Mobile */}
                      <div className="md:hidden flex flex-col gap-2 mt-0.5">
                        {/* First Row: Holders, History */}
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => {
                              addTab('holders', launch.token_address, launch.token_symbol || 'Unknown', pathname);
                              router.push(`/holders/${launch.token_address}`);
                            }}
                            className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Holders]
                          </button>
                          <button
                            onClick={() => {
                              addTab('history', launch.token_address, launch.token_symbol || 'Unknown', pathname);
                              router.push(`/history/${launch.token_address}`);
                            }}
                            className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [History]
                          </button>
                        </div>

                        {/* Second Row: Transfer, Sell, Burn */}
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => {
                              addTab('transfer', launch.token_address, launch.token_symbol || 'Unknown', pathname);
                              router.push(`/transfer/${launch.token_address}`);
                            }}
                            className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Transfer]
                          </button>
                          <button
                            onClick={() => window.open(`https://jup.ag/swap?sell=${launch.token_address}&buy=So11111111111111111111111111111111111111112`, '_blank')}
                            className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Sell]
                          </button>
                          <button
                            onClick={() => {
                              addTab('burn', launch.token_address, launch.token_symbol || 'Unknown', pathname);
                              router.push(`/burn/${launch.token_address}`);
                            }}
                            className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Burn]
                          </button>
                        </div>
                      </div>
                    </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </>
      )}

      <SecureVerificationModal
        isOpen={showVerificationModal}
        onClose={() => setShowVerificationModal(false)}
        onSuccess={() => {
          setHasVerified(true);
          setNeedsVerification(false);
          // Reload launches to show newly accessible tokens
          window.location.reload();
        }}
      />
    </>
  );
}