'use client';

import { useState, useEffect, useMemo } from 'react';
import { useWallet } from '@/components/WalletProvider';
import { useSignTransaction } from '@privy-io/react-auth/solana';
import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import Image from 'next/image';
import { useTheme } from '@/contexts/ThemeContext';
import {
  ClaimInfoResult,
  MintClaimRequest,
  MintClaimResult,
  ConfirmClaimRequest,
  ConfirmClaimResult,
  isApiError,
  isClaimInfoResponse,
  isMintClaimResponse,
  isConfirmClaimResponse
} from '@/types/api';

interface TokenMetadata {
  name: string;
  symbol: string;
  image: string;
}

interface CreatedToken {
  id: string;
  name: string;
  symbol: string;
  tokenAddress: string;
  image?: string;
  verified: boolean;
}

// Extended interface for token launches from the API
interface TokenLaunchFromApi {
  id: number;
  launch_time: string;
  creator_wallet: string;
  token_address: string;
  token_metadata_url: string;
  token_name?: string;
  token_symbol?: string;
  verified?: boolean;
  is_creator_designated?: boolean;
  creator_twitter?: string;
  creator_github?: string;
}

// Claim info returned from the API
interface ClaimInfo {
  totalMinted: string;
  totalClaimed: string;
  availableToClaim: string;
  canClaimNow: boolean;
  maxClaimableNow: string;
  nextInflationTime: string;
  timeUntilNextClaim?: string;
}

export default function PortfolioPage() {
  const { wallet, activeWallet, twitterUsername, githubUsername, isPrivyAuthenticated } = useWallet();
  const { signTransaction } = useSignTransaction();
  const { theme } = useTheme();
  const cardBg = theme === 'dark' ? '#222222' : '#ffffff';
  const cardBorder = theme === 'dark' ? '#1C1C1C' : '#e5e5e5';
  const cardShadow = theme === 'dark'
    ? '0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.08)'
    : '0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03)';
  const primaryTextColor = theme === 'dark' ? '#ffffff' : '#0a0a0a';
  const secondaryTextColor = theme === 'dark' ? '#B8B8B8' : '#717182';

  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [tokenMetadata, setTokenMetadata] = useState<Record<string, TokenMetadata>>({});
  const [claiming, setClaiming] = useState<Record<string, boolean>>({});

  const [createdTokens, setCreatedTokens] = useState<CreatedToken[]>([]);
  const [createdTokensLoading, setCreatedTokensLoading] = useState(false);
  const [createdTokenClaimInfo, setCreatedTokenClaimInfo] = useState<Record<string, ClaimInfo>>({});
  const [createdTokenClaimLoading, setCreatedTokenClaimLoading] = useState<Record<string, boolean>>({});
  const [createdTokenFilter, setCreatedTokenFilter] = useState<'all' | 'verified' | 'unverified'>('all');

  // Fetch created tokens (tokens launched by this wallet or designated to this user via socials)
  useEffect(() => {
    if (!wallet || !isPrivyAuthenticated) {
      setCreatedTokens([]);
      return;
    }

    const fetchCreatedTokens = async () => {
      setCreatedTokensLoading(true);
      try {
        const response = await fetch('/api/launches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creator: wallet.toString(),
            includeSocials: true,
            twitterUrl: twitterUsername || undefined,
            githubUrl: githubUsername ? `https://github.com/${githubUsername}` : undefined
          })
        });

        if (response.ok) {
          const data = await response.json();
          const launches: TokenLaunchFromApi[] = data.launches || [];

          // Convert to CreatedToken format and fetch claim info for each
          const createdTokensData: CreatedToken[] = [];

          for (const launch of launches) {
            // Fetch metadata if available
            let metadata: TokenMetadata | null = null;
            if (launch.token_metadata_url) {
              try {
                const metadataRes = await fetch(launch.token_metadata_url);
                metadata = await metadataRes.json();
              } catch (err) {
                console.error(`Error fetching metadata for ${launch.token_address}:`, err);
              }
            }

            // Fetch claim info for this token
            try {
              setCreatedTokenClaimLoading(prev => ({ ...prev, [launch.token_address]: true }));
              const claimResponse = await fetch(`/api/claims/${launch.token_address}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tokenAddress: launch.token_address,
                  wallet: wallet.toString()
                })
              });

              if (claimResponse.ok) {
                const claimData = await claimResponse.json();
                setCreatedTokenClaimInfo(prev => ({
                  ...prev,
                  [launch.token_address]: claimData
                }));
              }
            } catch (err) {
              console.error(`Error fetching claim info for ${launch.token_address}:`, err);
            } finally {
              setCreatedTokenClaimLoading(prev => ({ ...prev, [launch.token_address]: false }));
            }

            const name = metadata?.name || launch.token_name || 'Unknown Token';
            const symbol = metadata?.symbol || launch.token_symbol || 'UNKNOWN';

            createdTokensData.push({
              id: launch.token_address,
              name,
              symbol,
              tokenAddress: launch.token_address,
              image: metadata?.image,
              verified: launch.verified || false
            });

            // Also store metadata for use in rendering
            if (metadata) {
              setTokenMetadata(prev => ({
                ...prev,
                [launch.token_address]: metadata!
              }));
            }
          }

          setCreatedTokens(createdTokensData);
        }
      } catch (error) {
        console.error('Error fetching created tokens:', error);
      } finally {
        setCreatedTokensLoading(false);
      }
    };

    fetchCreatedTokens();
  }, [wallet, isPrivyAuthenticated, twitterUsername, githubUsername]);

  // Filter created tokens based on verification status
  const filteredCreatedTokens = useMemo(() => {
    if (createdTokenFilter === 'all') return createdTokens;
    if (createdTokenFilter === 'verified') return createdTokens.filter(t => t.verified);
    return createdTokens.filter(t => !t.verified);
  }, [createdTokens, createdTokenFilter]);

  const formatBalance = (balance: number): string => {
    if (balance >= 1_000_000) {
      return `${(balance / 1_000_000).toFixed(2)}M`;
    } else if (balance >= 1_000) {
      return `${(balance / 1_000).toFixed(2)}K`;
    }
    return balance.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  const formatAddress = (address: string): string => {
    if (!address) return '';
    const start = address.slice(0, 4);
    const end = address.slice(-4);
    return `${start}...${end}`;
  };

  const handleCopyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch (error) {
      console.error('Failed to copy address:', error);
    }
  };

  const handleClaim = async (tokenAddress: string, tokenSymbol: string) => {
    if (!wallet || !activeWallet) {
      alert('Please connect your wallet to claim tokens');
      return;
    }

    try {
      setClaiming(prev => ({ ...prev, [tokenAddress]: true }));

      // Step 1: Get claim info
      const claimInfoResponse = await fetch(`/api/claims/${tokenAddress}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenAddress,
          wallet: wallet.toString()
        })
      });

      const claimInfoData: ClaimInfoResult = await claimInfoResponse.json();

      if (!claimInfoResponse.ok || !isClaimInfoResponse(claimInfoData)) {
        const errorMsg = isApiError(claimInfoData) ? claimInfoData.error : 'Failed to fetch claim info';
        alert(errorMsg);
        return;
      }

      if (!claimInfoData.canClaimNow) {
        alert(`Tokens are not yet available to claim. ${claimInfoData.timeUntilNextClaim ? `Available in ${claimInfoData.timeUntilNextClaim}` : ''}`);
        return;
      }

      const claimAmount = claimInfoData.availableToClaim;

      if (BigInt(claimAmount) <= 0) {
        alert('No tokens available to claim');
        return;
      }

      // Step 2: Get mint transaction from server
      const mintRequest: MintClaimRequest = {
        tokenAddress,
        userWallet: wallet.toString(),
        claimAmount
      };

      const mintResponse = await fetch('/api/claims/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mintRequest)
      });

      const mintData: MintClaimResult = await mintResponse.json();

      if (!mintResponse.ok || !isMintClaimResponse(mintData)) {
        const errorMsg = isApiError(mintData) ? mintData.error : 'Failed to create mint transaction';
        alert(errorMsg);
        return;
      }

      // Step 3: Deserialize and sign transaction
      const transactionBuffer = bs58.decode(mintData.transaction);
      const transaction = Transaction.from(transactionBuffer);

      const serializedTransaction = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });

      const { signedTransaction } = await signTransaction({
        transaction: serializedTransaction,
        wallet: activeWallet
      });

      const userSignedTransaction = Transaction.from(signedTransaction);

      // Step 4: Send signed transaction to server for protocol signing and submission
      const confirmRequest: ConfirmClaimRequest = {
        signedTransaction: bs58.encode(userSignedTransaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false
        })),
        transactionKey: mintData.transactionKey
      };

      const submitResponse = await fetch('/api/claims/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmRequest)
      });

      const submitData: ConfirmClaimResult = await submitResponse.json();

      if (!submitResponse.ok || !isConfirmClaimResponse(submitData)) {
        const errorMsg = isApiError(submitData) ? submitData.error : 'Failed to confirm claim transaction';
        alert(errorMsg);
        return;
      }

      alert(`Successfully claimed ${tokenSymbol} tokens!`);
      
      // Refresh held tokens to show updated balance
      if (wallet) {
        // Trigger a refresh of held tokens
        window.location.reload();
      }
    } catch (error) {
      console.error('Error claiming tokens:', error);
      alert(`Failed to claim tokens: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setClaiming(prev => ({ ...prev, [tokenAddress]: false }));
    }
  };

  return (
    <div className="flex-1" style={{ padding: '20px 40px', marginLeft: '-20px', marginRight: '-20px' }}>
      <div className="flex flex-col gap-[20px] w-full">
      {/* Token List */}
      <div className="flex flex-col gap-[12px] w-full">
        <>
            {/* Filter buttons for verified/unverified */}
            {createdTokens.length > 0 && !createdTokensLoading && (
              <div className="flex gap-[8px] mb-[12px]">
                <button
                  onClick={() => setCreatedTokenFilter('all')}
                  className="rounded-[6px] px-[10px] py-[6px] text-[11px] font-semibold leading-[11px] tracking-[0.22px] capitalize transition-colors"
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    backgroundColor: createdTokenFilter === 'all'
                      ? (theme === 'dark' ? '#5A5798' : '#403d6d')
                      : (theme === 'dark' ? '#222222' : '#ffffff'),
                    border: createdTokenFilter === 'all' ? 'none' : (theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5'),
                    color: createdTokenFilter === 'all' ? '#ffffff' : (theme === 'dark' ? '#ffffff' : '#0a0a0a')
                  }}
                >
                  All ({createdTokens.length})
                </button>
                <button
                  onClick={() => setCreatedTokenFilter('verified')}
                  className="rounded-[6px] px-[10px] py-[6px] text-[11px] font-semibold leading-[11px] tracking-[0.22px] capitalize transition-colors"
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    backgroundColor: createdTokenFilter === 'verified'
                      ? (theme === 'dark' ? '#5A5798' : '#403d6d')
                      : (theme === 'dark' ? '#222222' : '#ffffff'),
                    border: createdTokenFilter === 'verified' ? 'none' : (theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5'),
                    color: createdTokenFilter === 'verified' ? '#ffffff' : (theme === 'dark' ? '#ffffff' : '#0a0a0a')
                  }}
                >
                  Verified ({createdTokens.filter(t => t.verified).length})
                </button>
                <button
                  onClick={() => setCreatedTokenFilter('unverified')}
                  className="rounded-[6px] px-[10px] py-[6px] text-[11px] font-semibold leading-[11px] tracking-[0.22px] capitalize transition-colors"
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    backgroundColor: createdTokenFilter === 'unverified'
                      ? (theme === 'dark' ? '#5A5798' : '#403d6d')
                      : (theme === 'dark' ? '#222222' : '#ffffff'),
                    border: createdTokenFilter === 'unverified' ? 'none' : (theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5'),
                    color: createdTokenFilter === 'unverified' ? '#ffffff' : (theme === 'dark' ? '#ffffff' : '#0a0a0a')
                  }}
                >
                  Unverified ({createdTokens.filter(t => !t.verified).length})
                </button>
              </div>
            )}

            {createdTokensLoading ? (
              <div
                className="rounded-[12px] px-[12px] py-[20px] flex items-center justify-center min-h-[100px]"
                style={{
                  backgroundColor: cardBg,
                  border: `1px solid ${cardBorder}`,
                  boxShadow: cardShadow,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                <p className="text-[14px]" style={{ fontFamily: 'Inter, sans-serif', color: secondaryTextColor }}>
                  Loading your created tokens...
                </p>
              </div>
            ) : createdTokens.length === 0 ? (
              <div
                className="rounded-[12px] px-[12px] py-[20px] flex items-center justify-center min-h-[100px]"
                style={{
                  backgroundColor: cardBg,
                  border: `1px solid ${cardBorder}`,
                  boxShadow: cardShadow,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                <p className="text-[14px]" style={{ fontFamily: 'Inter, sans-serif', color: secondaryTextColor }}>
                  {!wallet ? 'Connect your wallet to see created tokens' : 'No created tokens yet'}
                </p>
              </div>
            ) : filteredCreatedTokens.length === 0 ? (
              <div
                className="rounded-[12px] px-[12px] py-[20px] flex items-center justify-center min-h-[100px]"
                style={{
                  backgroundColor: cardBg,
                  border: `1px solid ${cardBorder}`,
                  boxShadow: cardShadow,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                <p className="text-[14px]" style={{ fontFamily: 'Inter, sans-serif', color: secondaryTextColor }}>
                  No {createdTokenFilter === 'verified' ? 'verified' : 'unverified'} tokens
                </p>
              </div>
            ) : (
              filteredCreatedTokens.map((token) => {
                const claimInfo = createdTokenClaimInfo[token.tokenAddress];
                const isClaimLoading = createdTokenClaimLoading[token.tokenAddress];
                const availableToClaim = claimInfo ? Number(claimInfo.availableToClaim) : 0;
                const canClaim = claimInfo?.canClaimNow && availableToClaim > 0;

                return (
                <div
                  key={token.id}
                  className="rounded-[12px] px-[12px] py-[20px] flex flex-col gap-[10px]"
                  style={{
                    backgroundColor: cardBg,
                    border: `1px solid ${cardBorder}`,
                    boxShadow: cardShadow,
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  <div className="flex items-center justify-between gap-[20px] pl-[12px] pr-[20px]">
                    <div className="flex gap-[14px] items-center">
                      <div className="bg-[#030213] rounded-[12px] w-[42px] h-[42px] flex items-center justify-center shrink-0 overflow-hidden">
                        {token.image ? (
                          <Image
                            src={token.image}
                            alt={token.name}
                            width={30}
                            height={30}
                            className="w-[30px] h-[30px]"
                          />
                        ) : (
                          <div className="w-[30px] h-[30px] rounded-[8px] bg-[#403d6d]" />
                        )}
                      </div>
                      <div className="flex flex-col gap-[8px]">
                        <div className="flex gap-[6px] items-center text-[16px] font-medium leading-[1.4]" style={{ fontFamily: 'Inter, sans-serif' }}>
                          <p className="whitespace-nowrap" style={{ color: primaryTextColor }}>{token.name}</p>
                          <p className="uppercase whitespace-nowrap" style={{ color: secondaryTextColor }}>{token.symbol}</p>
                          {token.verified && (
                            <span
                              className="inline-flex items-center gap-[2px] px-[6px] py-[2px] rounded-[4px] text-[10px] font-semibold"
                              style={{
                                backgroundColor: theme === 'dark' ? 'rgba(74, 222, 128, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                                color: theme === 'dark' ? '#4ade80' : '#16a34a'
                              }}
                              title="This token is verified"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              Verified
                            </span>
                          )}
                        </div>
                        <div className="flex gap-[4px] items-center">
                          <button
                            type="button"
                            onClick={() => handleCopyAddress(token.tokenAddress)}
                            className="flex gap-[4px] items-center cursor-pointer group"
                            style={{ fontFamily: 'Inter, sans-serif' }}
                            title="Click to copy address"
                          >
                            <p className="text-[14px] font-medium leading-[14px] capitalize transition-opacity group-hover:opacity-80" style={{ color: secondaryTextColor }}>
                              {formatAddress(token.tokenAddress)}
                            </p>
                            {copiedAddress === token.tokenAddress ? (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                                <path d="M11.6667 3.5L5.25 9.91667L2.33333 7" stroke="#327755" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 transition-opacity group-hover:opacity-80">
                                <path d="M15.002 6.96045L15 4.60049C15 4.44136 14.9368 4.28875 14.8243 4.17622C14.7117 4.0637 14.5591 4.00049 14.4 4.00049H4.6C4.44087 4.00049 4.28826 4.0637 4.17574 4.17622C4.06321 4.28875 4 4.44136 4 4.60049V14.4005C4 14.5596 4.06321 14.7122 4.17574 14.8248C4.28826 14.9373 4.44087 15.0005 4.6 15.0005H7.00195M19.4 20.0005H9.6C9.44087 20.0005 9.28826 19.9373 9.17574 19.8248C9.06321 19.7122 9 19.5596 9 19.4005V9.60049C9 9.44136 9.06321 9.28875 9.17574 9.17622C9.28826 9.0637 9.44087 9.00049 9.6 9.00049H19.4C19.5591 9.00049 19.7117 9.0637 19.8243 9.17622C19.9368 9.28875 20 9.44136 20 9.60049V19.4005C20 19.5596 19.9368 19.7122 19.8243 19.8248C19.7117 19.9373 19.5591 20.0005 19.4 20.0005Z" stroke={secondaryTextColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Claim Info Display */}
                    {claimInfo && (
                      <div className="flex flex-col gap-[4px]">
                        <p className="text-[14px] font-medium" style={{ fontFamily: 'Inter, sans-serif', color: primaryTextColor }}>
                          Available: {formatBalance(availableToClaim)} ${token.symbol}
                        </p>
                        <p className="text-[12px]" style={{ fontFamily: 'Inter, sans-serif', color: secondaryTextColor }}>
                          Total claimed: {formatBalance(Number(claimInfo.totalClaimed))}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center gap-[20px]">
                      <button
                        type="button"
                        onClick={() => handleClaim(token.tokenAddress, token.symbol)}
                        disabled={!canClaim || claiming[token.tokenAddress] || isClaimLoading}
                        className="bg-[#403d6d] rounded-[6px] px-[12px] py-[10px] text-[12px] font-semibold leading-[12px] tracking-[0.24px] capitalize text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ fontFamily: 'Inter, sans-serif' }}
                      >
                        {claiming[token.tokenAddress]
                          ? 'Claiming...'
                          : isClaimLoading
                            ? 'Loading...'
                            : !canClaim && claimInfo
                              ? (availableToClaim <= 0 ? 'All claimed' : 'Not available')
                              : 'Claim'}
                      </button>
                    </div>
                  </div>
                </div>
              );
              })
            )}
        </>
      </div>
      </div>
    </div>
  );
}
