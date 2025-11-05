'use client';

import { useWallet } from '@/components/WalletProvider';
import { ClaimButton } from '@/components/ClaimButton';
import { SecureVerificationModal } from '@/components/SecureVerificationModal';
import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useTabContext } from '@/contexts/TabContext';
import { useRouter, usePathname } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

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
    <div className="min-h-screen py-12" style={{ backgroundColor: 'var(--background)' }}>
      <Container>
        {/* Hero Section */}
        <div className="mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-3" style={{ color: 'var(--foreground)' }}>
            Your Portfolio
          </h1>
          <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
            Manage and track your launched tokens
          </p>
        </div>

        {needsVerification && !hasVerified && (
          <Card variant="bordered" className="mb-8 border-2" style={{ borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <svg className="w-6 h-6 flex-shrink-0 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="flex-1">
                  <h3 className="font-semibold text-yellow-600 dark:text-yellow-400 mb-2">Verification Required</h3>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-4">
                    You have designated tokens waiting to be claimed. Please verify your wallet to access them.
                  </p>
                  <Button
                    onClick={() => setShowVerificationModal(true)}
                    size="sm"
                    className="bg-yellow-600 hover:bg-yellow-700 text-white"
                  >
                    Verify Now
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {wallet && (
          <Card variant="bordered" className="mb-8">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium mb-1" style={{ color: 'var(--foreground-secondary)' }}>
                    Active Wallet {externalWallet ? '(Connected)' : '(Embedded)'}
                  </p>
                  <button
                    onClick={copyWalletAddress}
                    className="flex items-center gap-2 group transition-colors"
                    title="Copy wallet address"
                  >
                    <span className="font-mono text-sm md:hidden" style={{ color: 'var(--accent)' }}>
                      {wallet.toString().slice(0, 6)}
                    </span>
                    <span className="hidden md:inline font-mono text-sm" style={{ color: 'var(--accent)' }}>
                      {wallet.toString().slice(0, 6)}...{wallet.toString().slice(-6)}
                    </span>
                    {copiedWallet ? (
                      <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 group-hover:scale-110 transition-transform" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
                <svg className="w-10 h-10" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
            </CardContent>
          </Card>
        )}

        {!ready || connecting ? (
          <Card variant="bordered">
            <CardContent className="p-12 text-center">
              <div className="inline-flex items-center gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2" style={{ borderColor: 'var(--accent)' }}></div>
                <p style={{ color: 'var(--foreground-secondary)' }}>Connecting to wallet...</p>
              </div>
            </CardContent>
          </Card>
        ) : !isPrivyAuthenticated ? (
          <Card variant="bordered">
            <CardContent className="p-12 text-center">
              <p style={{ color: 'var(--foreground-secondary)' }}>Please login to view your launches</p>
            </CardContent>
          </Card>
        ) : !wallet ? (
          <Card variant="bordered">
            <CardContent className="p-12 text-center">
              <Button
                onClick={handleConnectWallet}
                variant="primary"
                size="lg"
              >
                Connect Wallet
              </Button>
            </CardContent>
          </Card>
        ) : loading ? (
          <Card variant="bordered">
            <CardContent className="p-12 text-center">
              <div className="inline-flex items-center gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2" style={{ borderColor: 'var(--accent)' }}></div>
                <p style={{ color: 'var(--foreground-secondary)' }}>Loading your tokens...</p>
              </div>
            </CardContent>
          </Card>
        ) : error ? (
          <Card variant="bordered" className="border-red-500/50">
            <CardContent className="p-8 text-center">
              <svg className="w-12 h-12 mx-auto mb-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-500 mb-4">{error}</p>
              <Button
                onClick={() => setRetryCount(prev => prev + 1)}
                variant="secondary"
              >
                Try Again
              </Button>
            </CardContent>
          </Card>
        ) : (
        <>
          {launches.length > 0 && (() => {
            return (
              <div className="mb-6">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setViewMode('verified')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        viewMode === 'verified'
                          ? 'text-white shadow-md'
                          : 'hover:opacity-80'
                      }`}
                      style={{
                        backgroundColor: viewMode === 'verified' ? 'var(--accent)' : 'var(--background-secondary)',
                        color: viewMode === 'verified' ? 'white' : 'var(--foreground-secondary)'
                      }}
                    >
                      Verified
                    </button>
                    <button
                      onClick={() => setViewMode('all')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        viewMode === 'all'
                          ? 'text-white shadow-md'
                          : 'hover:opacity-80'
                      }`}
                      style={{
                        backgroundColor: viewMode === 'all' ? 'var(--accent)' : 'var(--background-secondary)',
                        color: viewMode === 'all' ? 'white' : 'var(--foreground-secondary)'
                      }}
                    >
                      All Tokens
                    </button>
                    <button
                      onClick={() => setViewMode('presale')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        viewMode === 'presale'
                          ? 'text-white shadow-md'
                          : 'hover:opacity-80'
                      }`}
                      style={{
                        backgroundColor: viewMode === 'presale' ? 'var(--accent)' : 'var(--background-secondary)',
                        color: viewMode === 'presale' ? 'white' : 'var(--foreground-secondary)'
                      }}
                    >
                      Presales
                    </button>
                  </div>
                  {wallet && (
                    <button
                      onClick={forceRefresh}
                      disabled={loading}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ backgroundColor: 'var(--background-secondary)', color: 'var(--foreground-secondary)' }}
                      title="Refresh data"
                    >
                      <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Refresh
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          <div>
            {(() => {
              // Handle presale view
              if (viewMode === 'presale') {
                return presales.length === 0 ? (
                  <Card variant="bordered">
                    <CardContent className="p-12 text-center">
                      <svg className="w-16 h-16 mx-auto mb-4 opacity-50" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                      </svg>
                      <p style={{ color: 'var(--foreground-secondary)' }}>No presales yet</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
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
                                  className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
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
                <Card variant="bordered">
                  <CardContent className="p-12 text-center">
                    <svg className="w-16 h-16 mx-auto mb-4 opacity-50" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p style={{ color: 'var(--foreground-secondary)' }}>No tokens {viewMode === 'verified' ? 'verified' : 'launched'} yet</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
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
                                    <span className="px-1 py-0.5 text-xs font-medium bg-[#EF6400]/20 text-[#EF6400]" title="You're designated as a creator for this token">
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
                                <span className="px-1 py-0.5 text-xs font-medium bg-[#EF6400]/20 text-[#EF6400]" title="You're designated as a creator for this token">
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
                            className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Manage Holders]
                          </button>
                          <button
                            onClick={() => {
                              addTab('history', launch.token_address, launch.token_symbol || 'Unknown', pathname);
                              router.push(`/history/${launch.token_address}`);
                            }}
                            className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
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
                            className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Transfer]
                          </button>
                          <button
                            onClick={() => window.open(`https://jup.ag/swap?sell=${launch.token_address}&buy=So11111111111111111111111111111111111111112`, '_blank')}
                            className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Sell]
                          </button>
                          <button
                            onClick={() => {
                              addTab('burn', launch.token_address, launch.token_symbol || 'Unknown', pathname);
                              router.push(`/burn/${launch.token_address}`);
                            }}
                            className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
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
                            className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Holders]
                          </button>
                          <button
                            onClick={() => {
                              addTab('history', launch.token_address, launch.token_symbol || 'Unknown', pathname);
                              router.push(`/history/${launch.token_address}`);
                            }}
                            className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
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
                            className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Transfer]
                          </button>
                          <button
                            onClick={() => window.open(`https://jup.ag/swap?sell=${launch.token_address}&buy=So11111111111111111111111111111111111111112`, '_blank')}
                            className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
                            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          >
                            [Sell]
                          </button>
                          <button
                            onClick={() => {
                              addTab('burn', launch.token_address, launch.token_symbol || 'Unknown', pathname);
                              router.push(`/burn/${launch.token_address}`);
                            }}
                            className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
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
      </Container>
    </div>
  );
}