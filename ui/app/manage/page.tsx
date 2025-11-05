'use client';

import { useWallet } from '@/components/WalletProvider';
import { ClaimButton } from '@/components/ClaimButton';
import { Navigation } from '@/components/Navigation';
import { SecureVerificationModal } from '@/components/SecureVerificationModal';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';

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


export default function ManagePage() {
  const { wallet, isPrivyAuthenticated, connecting, externalWallet, hasTwitter, hasGithub, twitterUsername, githubUsername } = useWallet();
  const { ready, login, authenticated, linkWallet } = usePrivy();
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
  const [viewMode, setViewMode] = useState<'verified' | 'all'>('verified');


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
    console.log('Manage Page State:', {
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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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
    <div className="min-h-screen bg-[#000000]">
      <main className="px-0 sm:px-4 relative">
        <div className="bg-[#141414] min-h-screen text-[#F7FCFE] rounded-none sm:rounded-4xl relative">
          <div className="max-w-7xl mx-auto px-8 py-12 sm:px-12 sm:py-16">
        {needsVerification && !hasVerified && (
          <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-600 rounded-lg">
            <h3 className="font-bold text-yellow-300 mb-2">Verification Required</h3>
            <p className="text-yellow-200 mb-3">
              You have designated tokens waiting to be claimed. Please verify your wallet to access them.
            </p>
            <button
              onClick={() => setShowVerificationModal(true)}
              className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700"
            >
              Verify Now
            </button>
          </div>
        )}

        <div className="flex justify-between items-center mb-12">
          <h1 className="text-5xl font-bold">𝓩 Portfolio</h1>
          {wallet && (
            <button
              onClick={forceRefresh}
              disabled={loading}
              className="px-4 py-2 text-gray-300 hover:text-white transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh data"
            >
              ↻ {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
        </div>

        {wallet && (
          <div className="mb-8">
            <div className="flex items-center">
              <p className="text-xl text-gray-300">
                Active Wallet {externalWallet ? '(Connected)' : '(Embedded)'}:
              </p>
              <button
                onClick={copyWalletAddress}
                className="flex items-center gap-1 ml-2 hover:opacity-80 transition-opacity cursor-pointer"
                title="Copy wallet address"
              >
                <span className="text-xl text-white font-mono">
                  {wallet.toString().slice(0, 6)}...{wallet.toString().slice(-6)}
                </span>
                {copiedWallet ? (
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        )}

        {!ready || connecting ? (
          <p className="text-xl text-gray-300">Connecting to wallet...</p>
        ) : !isPrivyAuthenticated ? (
          <p className="text-xl text-gray-300">Please login to view your launches</p>
        ) : !wallet ? (
          <button
            onClick={handleConnectWallet}
            className="text-xl font-bold text-gray-300 hover:text-white transition-colors cursor-pointer"
          >
            CONNECT WALLET
          </button>
        ) : loading ? (
          <p className="text-xl text-gray-300">Loading your tokens...</p>
        ) : error ? (
          <div className="space-y-4">
            <p className="text-xl text-red-400">{error}</p>
            <button
              onClick={() => setRetryCount(prev => prev + 1)}
              className="text-xl text-gray-300 hover:text-white transition-colors cursor-pointer"
            >
              Try Again
            </button>
          </div>
        ) : (
          <>
            {launches.length > 0 && (() => {
              const verifiedCount = launches.filter(l => l.verified).length;

              return (
                <div className="mb-6">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setViewMode('verified')}
                      className={`px-4 py-2 rounded font-medium transition-colors ${
                        viewMode === 'verified'
                          ? 'bg-[#F7FCFE] text-black'
                          : 'bg-zinc-900/50 text-gray-300 hover:text-gray-200 border border-gray-800'
                      }`}
                    >
                      Verified {verifiedCount > 0 && `(${verifiedCount})`}
                    </button>
                    <button
                      onClick={() => setViewMode('all')}
                      className={`px-4 py-2 rounded font-medium transition-colors ${
                        viewMode === 'all'
                          ? 'bg-[#F7FCFE] text-black'
                          : 'bg-zinc-900/50 text-gray-300 hover:text-gray-200 border border-gray-800'
                      }`}
                    >
                      All {launches.length > 0 && `(${launches.length})`}
                    </button>
                  </div>
                </div>
              );
            })()}

            <div className="space-y-8">
            <h2 className="text-3xl font-bold">Launched Tokens</h2>
            {(() => {
              const filteredLaunches = viewMode === 'verified'
                ? launches.filter(launch => launch.verified)
                : launches;

              return filteredLaunches.length === 0 ? (
                <p className="text-xl text-gray-300">No tokens {viewMode === 'verified' ? 'verified' : 'launched'} yet</p>
              ) : (
                filteredLaunches.map((launch) => (
                <div key={launch.id} className="border-b border-gray-800 pb-6">
                  {/* Top Row */}
                  <div className="flex items-baseline justify-between">
                    <div className="flex items-baseline gap-4">
                      <h3 className="text-2xl text-white font-bold">
                        {launch.token_symbol || 'N/A'}
                      </h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xl text-gray-300">
                          {launch.token_name || 'Unnamed Token'}
                        </span>
                        {launch.is_creator_designated && (
                          <span className="px-2 py-0.5 text-sm font-medium bg-[#EF6400]/20 text-[#EF6400] rounded-md" title="You're designated as a creator for this token">
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
                        <span className="text-lg text-gray-300-temp">Balance:</span>
                        <span className="text-lg text-white">
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
                    <p className="text-lg text-gray-300-temp">
                      Launched: {formatDate(launch.launch_time)}
                    </p>
                  </div>

                  {/* Bottom Row */}
                  <div className="flex items-center mt-4">
                    <div className="flex items-center gap-8">
                      <Link
                        href={`/holders/${launch.token_address}`}
                        className="text-xl text-gray-300 hover:text-white transition-colors cursor-pointer"
                      >
                        Manage Holders
                      </Link>
                      <Link
                        href={`/history/${launch.token_address}`}
                        className="text-xl text-gray-300 hover:text-white transition-colors cursor-pointer"
                      >
                        View History
                      </Link>
                    </div>
                    <div className="flex items-center gap-4 ml-16">
                      <Link
                        href={`/transfer/${launch.token_address}`}
                        className="text-lg text-gray-300 hover:text-white transition-colors cursor-pointer"
                      >
                        Transfer
                      </Link>
                      <button
                        onClick={() => window.open(`https://jup.ag/swap?sell=${launch.token_address}&buy=So11111111111111111111111111111111111111112`, '_blank')}
                        className="text-lg text-gray-300 hover:text-white transition-colors cursor-pointer"
                      >
                        Sell
                      </button>
                      <Link
                        href={`/burn/${launch.token_address}`}
                        className="text-lg text-gray-300 hover:text-white transition-colors cursor-pointer"
                      >
                        Burn
                      </Link>
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
                </div>
              ))
              );
            })()}
            </div>

            {/* Presales Section */}
            {presales.length > 0 && (
              <div className="space-y-8 mt-16">
                <h2 className="text-3xl font-bold">Presales</h2>
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
                    <div key={presale.id} className="border-b border-gray-800 pb-6">
                      {/* Top Row */}
                      <div className="flex items-baseline justify-between">
                        <div className="flex items-baseline gap-4">
                          <h3 className="text-2xl text-white font-bold">
                            {presale.token_symbol || 'N/A'}
                          </h3>
                          <span className="text-xl text-gray-300">
                            {presale.token_name || 'Unnamed Token'}
                          </span>
                          <span className={`px-2 py-0.5 text-sm font-medium rounded-md ${getStatusColor(presale.status)}`}>
                            {presale.status.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-lg text-gray-300">
                          Created: {formatDate(presale.created_at)}
                        </p>
                      </div>

                      {/* Bottom Row */}
                      <div className="flex items-center mt-4">
                        <Link
                          href={`/presale/${presale.token_address}`}
                          className="text-xl text-gray-300 hover:text-white transition-colors cursor-pointer"
                        >
                          View Presale →
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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

        <Navigation />
          </div>
        </div>
      </main>
    </div>
  );
}