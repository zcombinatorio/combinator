'use client';

import { PresaleBuyModal } from '@/components/PresaleBuyModal';
import { VestingModal } from '@/components/VestingModal';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useWallet } from '@/components/WalletProvider';
import { usePrivy } from '@privy-io/react-auth';
import { Transaction } from '@solana/web3.js';
import { useSignTransaction } from '@privy-io/react-auth/solana';
import bs58 from 'bs58';

interface Presale {
  id: number;
  token_address: string;
  creator_wallet: string;
  token_name: string;
  token_symbol: string;
  token_metadata_url: string;
  presale_tokens: string[];
  creator_twitter?: string;
  creator_github?: string;
  status: string;
  escrow_pub_key?: string;
  tokens_bought?: string;
  base_mint_address?: string;
  launched_at?: string;
  created_at: string;
}

interface VestingInfo {
  totalAllocated: string;
  totalClaimed: string;
  claimableAmount: string;
  vestingProgress: number;
  isFullyVested: boolean;
  nextUnlockTime?: string;
  vestingEndTime: string;
}

interface TokenMetadata {
  name: string;
  symbol: string;
  image: string;
  website?: string;
  twitter?: string;
  description?: string;
}

interface Contribution {
  wallet: string;
  amount: number;
  transactionSignature: string;
  createdAt: string;
}

interface BidsData {
  totalRaised: number;
  totalBids: number;
  contributions: Contribution[];
}

export function PresaleContent() {
  const params = useParams();
  const tokenAddress = params.tokenAddress as string;
  const { wallet, externalWallet, activeWallet } = useWallet();
  const { signTransaction } = useSignTransaction();
  const [presale, setPresale] = useState<Presale | null>(null);
  const [metadata, setMetadata] = useState<TokenMetadata | null>(null);
  const [bidsData, setBidsData] = useState<BidsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [maxContribution, setMaxContribution] = useState<number>(0);
  const [userContribution, setUserContribution] = useState<number>(0);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchSuccess, setLaunchSuccess] = useState<{
    poolCreationSignature: string;
    swapSignature: string | null;
  } | null>(null);
  const [vestingInfo, setVestingInfo] = useState<VestingInfo | null>(null);

  // Check if connected wallet is the creator
  const isCreator = wallet && presale && wallet.toBase58() === presale.creator_wallet;

  useEffect(() => {
    async function fetchPresaleData() {
      try {
        // Fetch presale info and bids in parallel
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const [presaleResponse, bidsResponse] = await Promise.all([
          fetch(`/api/presale/${tokenAddress}`),
          fetch(`${apiUrl}/presale/${tokenAddress}/bids`)
        ]);

        if (!presaleResponse.ok) {
          throw new Error('Failed to fetch presale');
        }

        const presaleData = await presaleResponse.json();
        setPresale(presaleData);

        // Fetch bids data (even if it fails, we can still show the presale)
        if (bidsResponse.ok) {
          const bidsData = await bidsResponse.json();
          setBidsData(bidsData);
        } else {
          console.warn('Failed to fetch bids data');
          setBidsData({ totalRaised: 0, totalBids: 0, contributions: [] });
        }

        // Fetch metadata
        if (presaleData.token_metadata_url) {
          try {
            const metadataResponse = await fetch(presaleData.token_metadata_url);
            if (metadataResponse.ok) {
              const metadataData = await metadataResponse.json();
              setMetadata(metadataData);
            }
          } catch (err) {
            console.error('Error fetching metadata:', err);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    if (tokenAddress) {
      fetchPresaleData();
    }
  }, [tokenAddress]);

  // Fetch max contribution when wallet or presale changes
  useEffect(() => {
    async function fetchMaxContribution() {
      if (!wallet || !presale) {
        setMaxContribution(0);
        return;
      }

      // If there's no whitelist, allow unlimited contributions
      if (!presale.presale_tokens || presale.presale_tokens.length === 0) {
        setMaxContribution(Infinity);
        return;
      }

      try {
        const whitelistedTokens = presale.presale_tokens.join(',');
        const response = await fetch(
          `/api/presale/max-contribution?walletAddress=${wallet.toBase58()}&whitelistedTokens=${whitelistedTokens}`
        );

        if (response.ok) {
          const data = await response.json();
          setMaxContribution(data.maxContributionZC);
        } else {
          console.error('Failed to fetch max contribution');
          setMaxContribution(0);
        }
      } catch (err) {
        console.error('Error fetching max contribution:', err);
        setMaxContribution(0);
      }
    }

    fetchMaxContribution();
  }, [wallet, presale]);

  // Fetch user's existing contribution when wallet or presale changes
  useEffect(() => {
    async function fetchUserContribution() {
      if (!wallet || !presale) {
        setUserContribution(0);
        return;
      }

      try {
        const response = await fetch(
          `/api/presale/${tokenAddress}/contribution?walletAddress=${wallet.toBase58()}`
        );

        if (response.ok) {
          const data = await response.json();
          setUserContribution(data.contributionSol);
        } else {
          console.error('Failed to fetch user contribution');
          setUserContribution(0);
        }
      } catch (err) {
        console.error('Error fetching user contribution:', err);
        setUserContribution(0);
      }
    }

    fetchUserContribution();
  }, [wallet, presale, tokenAddress]);

  // Auto-refresh presale status and bids data every 10 seconds
  useEffect(() => {
    if (!tokenAddress) return;

    // Function to check presale status
    const checkPresaleStatus = async () => {
      try {
        const response = await fetch(`/api/presale/${tokenAddress}`);
        if (response.ok) {
          const presaleData = await response.json();
          setPresale(presaleData);

          // If presale has launched, you might want to trigger additional actions
          if (presaleData.status === 'launched' && presale?.status === 'pending') {
            console.log('Presale has launched!');
          }
        }
      } catch (err) {
        console.error('Error checking presale status:', err);
      }
    };

    // Set up interval to refresh presale status and bids data
    const interval = setInterval(async () => {
      await Promise.all([
        checkPresaleStatus(),
        refreshBidsData()
      ]);
    }, 10000);

    return () => clearInterval(interval);
  }, [tokenAddress, presale?.status]);

  // Fetch vesting info when wallet or presale status changes
  useEffect(() => {
    async function fetchVestingInfo() {
      if (!wallet || !presale || presale.status !== 'launched') {
        setVestingInfo(null);
        return;
      }

      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const response = await fetch(
          `${apiUrl}/presale/${tokenAddress}/claims/${wallet.toBase58()}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          setVestingInfo(data);
        } else {
          const errorData = await response.json().catch(() => null);
          console.error('Failed to fetch vesting info:', response.status, errorData);
          setVestingInfo(null);
        }
      } catch (err) {
        console.error('Error fetching vesting info:', err);
        setVestingInfo(null);
      }
    }

    fetchVestingInfo();
    // Refresh vesting info every 30 seconds
    const interval = setInterval(fetchVestingInfo, 30000);
    return () => clearInterval(interval);
  }, [wallet, presale?.status, tokenAddress]);

  const refreshBidsData = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const bidsResponse = await fetch(`${apiUrl}/presale/${tokenAddress}/bids`);
      if (bidsResponse.ok) {
        const bidsData = await bidsResponse.json();
        setBidsData(bidsData);
      }

      // Also refresh user contribution
      if (wallet) {
        const contributionResponse = await fetch(
          `/api/presale/${tokenAddress}/contribution?walletAddress=${wallet.toBase58()}`
        );
        if (contributionResponse.ok) {
          const data = await contributionResponse.json();
          setUserContribution(data.contributionSol);
        }
      }
    } catch (err) {
      console.error('Error refreshing bids data:', err);
    }
  };

  const handleLaunch = async () => {
    if (!wallet || !externalWallet || !activeWallet || !presale) {
      console.error('Wallet or presale not available');
      return;
    }

    setIsLaunching(true);
    setLaunchError(null);

    try {
      // Step 1: Call API to get launch transactions
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const launchResponse = await fetch(`${apiUrl}/presale/${tokenAddress}/launch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payerPublicKey: externalWallet.toString(),
        }),
      });

      if (!launchResponse.ok) {
        const errorData = await launchResponse.json();
        throw new Error(errorData.error || 'Failed to create launch transaction');
      }

      const launchData = await launchResponse.json();
      const { combinedTx, transactionId } = launchData;

      // Step 2: Deserialize and sign the combined transaction
      const combinedTxBuffer = bs58.decode(combinedTx);
      const combinedTransaction = Transaction.from(combinedTxBuffer);

      // Sign with user wallet
      const combinedSerialized = combinedTransaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });

      const { signedTransaction: signedTxBytes } = await signTransaction({
        transaction: combinedSerialized,
        wallet: activeWallet
      });

      // Convert signed transaction to base58 string
      const signedTxBase58 = bs58.encode(signedTxBytes);

      console.log('Transaction signed by user, sending to confirmation endpoint...');

      // Step 3: Send signed transaction to confirmation endpoint
      const confirmResponse = await fetch(`${apiUrl}/presale/${tokenAddress}/launch-confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signedTransaction: signedTxBase58,
          transactionId,
        }),
      });

      if (!confirmResponse.ok) {
        const errorData = await confirmResponse.json();
        throw new Error(errorData.error || 'Failed to confirm launch transaction');
      }

      const confirmData = await confirmResponse.json();
      console.log('Launch confirmed:', confirmData.signature);

      // Update local state
      setPresale({ ...presale, status: 'launched' });

      // Set success state (will show green text with transaction links)
      setLaunchSuccess({
        poolCreationSignature: confirmData.signature,
        swapSignature: null // Combined into single transaction now
      });

    } catch (error) {
      console.error('Launch error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setLaunchError(errorMessage);
    } finally {
      setIsLaunching(false);
    }
  };

  const formatWalletAddress = (address: string) => {
    return `${address.slice(0, 4)}....${address.slice(-4)}`;
  };

  const formatWalletAddressMobile = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  const copyToClipboard = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-7xl font-bold">Presale</h1>
        <p className="mt-7 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Loading presale...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-7xl font-bold">Presale</h1>
        <p className="mt-7 text-[14px] text-red-400" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Error: {error}</p>
      </div>
    );
  }

  if (!presale) {
    return (
      <div>
        <h1 className="text-7xl font-bold">Presale</h1>
        <p className="mt-7 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Presale not found</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex justify-between items-center">
        <h1 className="text-7xl font-bold">Presale</h1>
        {isCreator && presale.status === 'pending' && (
          <button
            onClick={handleLaunch}
            disabled={isLaunching}
            className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
          >
            {isLaunching ? '[LAUNCHING...]' : '[LAUNCH]'}
          </button>
        )}
      </div>

      {launchError && (
        <p className="mt-7 text-[14px] text-red-400" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
          Launch Error: {launchError}
        </p>
      )}

      {launchSuccess && (
        <p className="mt-7 text-[14px] text-green-400" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
          Success! Presale launched.{' '}
          <a
            href={`https://solscan.io/tx/${launchSuccess.poolCreationSignature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-green-300"
          >
            View Transaction
          </a>
        </p>
      )}

      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}${presale.token_symbol} presale</p>

      {/* Token Info - Desktop */}
      <div className="mt-1 hidden md:flex items-center gap-4">
        {metadata?.image && (
          <img
            src={metadata.image}
            alt={presale.token_symbol}
            className="w-10 h-10 rounded object-cover"
          />
        )}
        <div>
          <p className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="text-white">${presale.token_symbol}</span> {presale.token_name} <span className="text-gray-500 ml-4">Status:</span> <span className={`${presale.status === 'launched' ? 'text-[#b2e9fe]' : presale.status === 'pending' ? 'text-yellow-400' : 'text-red-400'}`} style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{presale.status.toUpperCase()}</span>
          </p>
          {metadata?.description && (
            <p className="mt-0.5 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
              {metadata.description}
            </p>
          )}
        </div>
      </div>

      {/* Token Info - Mobile */}
      <div className="mt-1 md:hidden flex items-center gap-4">
        {metadata?.image && (
          <img
            src={metadata.image}
            alt={presale.token_symbol}
            className="w-10 h-10 rounded object-cover"
          />
        )}
        <div>
          <p className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="text-white">${presale.token_symbol}</span> {presale.token_name}
          </p>
          <p className="text-[14px] text-gray-300 mt-0.5" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="text-gray-500">Status:</span> <span className={`${presale.status === 'launched' ? 'text-[#b2e9fe]' : presale.status === 'pending' ? 'text-yellow-400' : 'text-red-400'}`}>{presale.status.toUpperCase()}</span>
          </p>
          {metadata?.description && (
            <p className="mt-0.5 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
              {metadata.description}
            </p>
          )}
        </div>
      </div>

      {/* Presale Requirements Section */}
      <div className="mt-7">
        <p className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Presale requirements</p>
        {presale.presale_tokens && presale.presale_tokens.length > 0 ? (
          <>
            <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
              Only holders of the following tokens at the time of snapshot are allowed to participate:
            </p>
            <div className="mt-0.5 space-y-1">
              {presale.presale_tokens.map((token, index) => (
                <p
                  key={index}
                  className="text-[14px] text-gray-300 pb-0"
                  style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                >
                  <span className="hidden md:inline">{token}</span>
                  <span className="md:hidden">{formatWalletAddressMobile(token)}</span>
                </p>
              ))}
            </div>
            <p className="mt-0.5 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
              <a
                href="https://docs.percent.markets/presale"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-300 hover:text-white"
              >
                [View Docs]
              </a>
            </p>
          </>
        ) : (
          <p className="mt-4 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            No token requirements - this presale is open to everyone!
          </p>
        )}
      </div>

      {/* Buy or Vesting Section */}
      <div className="mt-7 max-w-xl">
        {presale.status === 'launched' ? (
          <VestingModal
            tokenSymbol={presale.token_symbol}
            tokenAddress={tokenAddress}
            vestingInfo={vestingInfo}
            onClaimSuccess={async () => {
              // Refresh vesting info after successful claim
              if (wallet) {
                try {
                  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
                  const response = await fetch(
                    `${apiUrl}/presale/${tokenAddress}/claims/${wallet.toBase58()}`
                  );
                  if (response.ok) {
                    const data = await response.json();
                    setVestingInfo(data);
                  }
                } catch (err) {
                  console.error('Error refreshing vesting info:', err);
                }
              }
            }}
          />
        ) : (
          <PresaleBuyModal
            tokenSymbol={presale.token_symbol}
            status={presale.status}
            maxContribution={maxContribution}
            userContribution={userContribution}
            escrowAddress={presale.escrow_pub_key}
            onSuccess={refreshBidsData}
          />
        )}
      </div>

      {/* Total Raised Section */}
      <div className="mt-7">
        <p className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
          {'//'}Total raised
        </p>
        <p className="mt-0.5 text-[14px] text-[#b2e9fe] font-semibold" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
          {bidsData ? bidsData.totalRaised.toFixed(0) : '0'} $ZC{' '}
          {presale.escrow_pub_key && (
            <a
              href={`https://solscan.io/account/${presale.escrow_pub_key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-300 hover:text-[#b2e9fe] font-normal"
              title="View escrow wallet on Solscan"
            >
              [View Escrow]
            </a>
          )}
        </p>
      </div>

      {/* All Contributions Section */}
      <div className="mt-7 max-w-xl">
        <p className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}All contributions</p>
        {bidsData && bidsData.contributions.length > 0 ? (
          <div className="mt-0 max-h-[400px] overflow-y-auto">
            <div className="space-y-0">
              {bidsData.contributions.map((contribution) => (
                <div
                  key={contribution.transactionSignature}
                  className="flex justify-between items-center py-0.5"
                  style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                >
                  <button
                    onClick={() => copyToClipboard(contribution.wallet)}
                    className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors"
                  >
                    {copiedAddress === contribution.wallet ? '✓ Copied' : (
                      <>
                        <span className="hidden md:inline">{formatWalletAddress(contribution.wallet)}</span>
                        <span className="md:hidden">{formatWalletAddressMobile(contribution.wallet)}</span>
                      </>
                    )}
                  </button>
                  <span className="text-[14px] text-white">{contribution.amount.toFixed(0)} $ZC</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            No contributions yet
          </p>
        )}
      </div>
    </div>
  );
}
