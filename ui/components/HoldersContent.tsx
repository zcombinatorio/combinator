'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from '@/components/WalletProvider';
import { PublicKey } from '@solana/web3.js';
import { useLaunchInfo, useHolders } from '@/hooks/useTokenData';
import { MOCK_TOKENS } from '@/lib/mock';

interface Holder {
  id?: number;
  wallet_address: string;
  token_balance: string;
  staked_balance: string;
  telegram_username?: string | null;
  x_username?: string | null;
  discord_username?: string | null;
  custom_label?: string | null;
  created_at?: string;
  updated_at?: string;
  last_sync_at?: string;
  percentage?: number;
}

interface HolderStats {
  totalHolders: number;
  totalBalance: string;
  lastSyncTime: string | null;
}

interface HoldersContentProps {
  tokenAddress: string;
  tokenSymbol?: string;
}

// Helper function to check if a wallet address is on curve (not a PDA)
function isOnCurve(address: string): boolean {
  try {
    const pubkey = new PublicKey(address);
    return PublicKey.isOnCurve(pubkey.toBuffer());
  } catch {
    return false;
  }
}

export function HoldersContent({ tokenAddress, tokenSymbol = '' }: HoldersContentProps) {
  const { wallet } = useWallet();

  // Use SWR hooks for cached data
  const { launchData, isLoading: launchLoading, mutate: mutateLaunch } = useLaunchInfo(tokenAddress);
  const { holders: rawHolders, stats, isLoading: holdersLoading, mutate: mutateHolders } = useHolders(tokenAddress);

  const [accessDenied, setAccessDenied] = useState(false);
  const [editingHolder, setEditingHolder] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    telegram_username: '',
    discord_username: '',
    x_username: '',
    custom_label: ''
  });
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Overall loading state
  const loading = launchLoading || holdersLoading;

  const calculatePercentages = (holders: Holder[], totalBalance: string): Holder[] => {
    const total = parseFloat(totalBalance);
    if (total === 0) return holders;

    return holders.map(holder => ({
      ...holder,
      percentage: (parseFloat(holder.token_balance) / total) * 100
    }));
  };

  // Get token symbol from launch data
  const actualTokenSymbol = useMemo(() => {
    const launch = launchData?.launches?.[0];
    return launch?.token_symbol || tokenSymbol || '';
  }, [launchData, tokenSymbol]);

  // Process holders: filter on-curve and add percentages
  const allHolders = useMemo(() => {
    const onCurveHolders = rawHolders.filter((holder: Holder) =>
      isOnCurve(holder.wallet_address) && parseFloat(holder.token_balance) > 0
    );
    return calculatePercentages(onCurveHolders, stats.totalBalance);
  }, [rawHolders, stats.totalBalance]);

  const holderStats = useMemo(() => ({
    ...stats,
    totalHolders: allHolders.length
  }), [stats, allHolders.length]);

  const triggerSync = useCallback(async () => {
    setSyncing(true);
    try {
      const response = await fetch(`/api/holders/${tokenAddress}/sync`, {
        method: 'POST'
      });

      if (response.ok) {
        // Revalidate all cached data
        await mutateHolders();
        await mutateLaunch();
      } else {
        console.error('Failed to sync holders:', response.status);
      }
    } catch (error) {
      console.error('Error syncing holders:', error);
    } finally {
      setSyncing(false);
    }
  }, [tokenAddress, mutateHolders, mutateLaunch]);

  // Filter holders based on search query
  const filteredHolders = allHolders.filter(holder => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    const walletMatch = holder.wallet_address.toLowerCase().includes(query);
    const telegramMatch = holder.telegram_username?.toLowerCase().includes(query);
    const discordMatch = holder.discord_username?.toLowerCase().includes(query);
    const xMatch = holder.x_username?.toLowerCase().includes(query);
    const customLabelMatch = holder.custom_label?.toLowerCase().includes(query);

    return walletMatch || telegramMatch || discordMatch || xMatch || customLabelMatch;
  });

  const [currentPage, setCurrentPage] = useState(0);
  const holdersPerPage = 10;
  const totalPages = Math.ceil(filteredHolders.length / holdersPerPage);
  const holders = filteredHolders.slice(
    currentPage * holdersPerPage,
    (currentPage + 1) * holdersPerPage
  );

  // Reset to first page when search query changes
  useEffect(() => {
    setCurrentPage(0);
  }, [searchQuery]);

  // Check access permissions
  useEffect(() => {
    if (!wallet) {
      setAccessDenied(true);
      return;
    }

    if (!launchLoading && launchData) {
      const launch = launchData.launches?.[0];
      if (launch) {
        const walletAddress = wallet.toString();
        const creatorAddress = launch.creator_wallet;
        // Allow access to mock tokens by checking if address exists in MOCK_TOKENS
        const isMockToken = MOCK_TOKENS.some(t => t.token_address === tokenAddress);
        setAccessDenied(!isMockToken && walletAddress !== creatorAddress);
      } else {
        setAccessDenied(true);
      }
    }
  }, [wallet, launchData, launchLoading, tokenAddress]);

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  const formatAddressMobile = (address: string) => {
    return address.slice(0, 6);
  };

  const formatNumberShort = (value: number) => {
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(2)}B`;
    } else if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)}M`;
    } else if (value >= 1_000) {
      return `${(value / 1_000).toFixed(2)}K`;
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const handleEditClick = (holder: Holder) => {
    setEditingHolder(holder.wallet_address);
    setEditForm({
      telegram_username: holder.telegram_username || '',
      discord_username: holder.discord_username || '',
      x_username: holder.x_username || '',
      custom_label: holder.custom_label || ''
    });
  };

  const handleCancelEdit = () => {
    setEditingHolder(null);
    setEditForm({
      telegram_username: '',
      discord_username: '',
      x_username: '',
      custom_label: ''
    });
  };

  const handleSaveEdit = async (holderAddress: string) => {
    try {
      const response = await fetch(`/api/holders/${tokenAddress}/${holderAddress}/labels`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editForm)
      });

      if (response.ok) {
        // Revalidate cached holders data
        await mutateHolders();
        console.log('Social labels saved successfully');
      } else {
        console.error('Failed to save social labels:', response.status);
      }
    } catch (error) {
      console.error('Error saving social labels:', error);
    }

    setEditingHolder(null);
    setEditForm({
      telegram_username: '',
      discord_username: '',
      x_username: '',
      custom_label: ''
    });
  };

  const handleInputChange = (field: 'telegram_username' | 'discord_username' | 'x_username' | 'custom_label', value: string) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <p className="text-[14px] text-gray-300 mt-8" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
        [Loading...]
      </p>
    );
  }

  if (accessDenied) {
    return (
      <div>
        <h1 className="text-7xl font-bold">Access Denied</h1>
        <div className="space-y-6 mt-7">
          <p className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            {!wallet
              ? "Please connect your wallet to view token holders."
              : "You are not the creator of this token. Only token creators can view and manage holder information."
            }
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <h1 className="text-7xl font-bold">Holders</h1>
      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
        {'//'}Manage holders for ${actualTokenSymbol} ({formatAddress(tokenAddress)})
      </p>

      <div className="mt-7">
        {/* Last sync and Sync button */}
        <div className="flex items-baseline gap-12 mb-1">
          {holderStats.lastSyncTime && (
            <span className="hidden md:inline text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
              Last sync: {new Date(holderStats.lastSyncTime).toLocaleString()}
            </span>
          )}
          {syncing && (
            <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Syncing holders...</span>
          )}
          <button
            onClick={triggerSync}
            disabled={syncing}
            className={`text-[14px] transition-colors cursor-pointer ${
              syncing
                ? 'text-gray-300 cursor-not-allowed opacity-50'
                : 'text-gray-300 hover:text-[#EF6400]'
            }`}
            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
          >
            {syncing ? '[Syncing...]' : '[Sync Holders]'}
          </button>
        </div>

        {/* Total Holders and Filter */}
        <div className="flex items-baseline gap-4 md:gap-12 mb-6.5">
          <div className="flex items-baseline gap-2">
            <span className="md:hidden text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Holders:</span>
            <span className="hidden md:inline text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Total Holders:</span>
            <span className="text-[14px] text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{holderStats.totalHolders}</span>
          </div>
          <div className="text-[14px]" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="text-gray-300">Filter: </span>
            <span className="text-gray-500">{'{'}</span>
            <input
              type="text"
              placeholder="wallet or label"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
              className="bg-transparent border-0 focus:outline-none placeholder:text-gray-500 text-[#EF6400]"
              style={{
                fontFamily: 'Monaco, Menlo, "Courier New", monospace',
                width: searchQuery ? `${searchQuery.length}ch` : '15ch'
              }}
            />
            <span className="text-gray-500">{'}'}</span>
          </div>
        </div>
      </div>

      <div className="space-y-0 mt-0 max-w-2xl">
        {holders.map((holder, index) => (
          <div key={holder.wallet_address} className="pb-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                  #{currentPage * holdersPerPage + index + 1}
                </span>
                {/* Desktop wallet address */}
                <span className="hidden md:inline text-[14px] text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                  {formatAddress(holder.wallet_address)}
                </span>
                {/* Mobile wallet address */}
                <span className="md:hidden text-[14px] text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                  {formatAddressMobile(holder.wallet_address)}
                </span>
                {wallet && holder.wallet_address === wallet.toBase58() && (
                  <span className="hidden md:inline text-[14px] text-[#EF6400] bg-[#EF6400]/10 px-1 py-0.5" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                    You
                  </span>
                )}
                {holder.custom_label && (
                  <span className="text-[14px] text-gray-300 bg-gray-300/10 px-2 py-1 rounded" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                    {holder.custom_label}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4">
                {/* Desktop balance */}
                <span className="hidden md:inline text-[14px] text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                  {parseFloat(holder.token_balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
                {/* Mobile balance */}
                <span className="md:hidden text-[14px] text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                  {formatNumberShort(parseFloat(holder.token_balance))}
                </span>
                <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                  {holder.percentage?.toFixed(2)}%
                </span>
                <button
                  onClick={() => handleEditClick(holder)}
                  className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
                  style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                >
                  [Labels]
                </button>
              </div>
            </div>

            {editingHolder === holder.wallet_address ? (
              <div className="mt-3 ml-8 space-y-2">
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <input
                    type="text"
                    placeholder="Telegram username"
                    value={editForm.telegram_username}
                    onChange={(e) => handleInputChange('telegram_username', e.target.value)}
                    className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-[14px] text-white placeholder:text-gray-300 focus:outline-none focus:border-[#EF6400]"
                    style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                  />
                  <input
                    type="text"
                    placeholder="Discord username"
                    value={editForm.discord_username}
                    onChange={(e) => handleInputChange('discord_username', e.target.value)}
                    className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-[14px] text-white placeholder:text-gray-300 focus:outline-none focus:border-[#EF6400]"
                    style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                  />
                  <input
                    type="text"
                    placeholder="X username"
                    value={editForm.x_username}
                    onChange={(e) => handleInputChange('x_username', e.target.value)}
                    className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-[14px] text-white placeholder:text-gray-300 focus:outline-none focus:border-[#EF6400]"
                    style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                  />
                  <input
                    type="text"
                    placeholder="Custom label"
                    value={editForm.custom_label}
                    onChange={(e) => handleInputChange('custom_label', e.target.value)}
                    className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-[14px] text-white placeholder:text-gray-300 focus:outline-none focus:border-[#EF6400]"
                    style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleSaveEdit(holder.wallet_address)}
                    className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
                    style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                  >
                    [Save]
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors cursor-pointer"
                    style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                  >
                    [Cancel]
                  </button>
                </div>
              </div>
            ) : (
              <>
                {(holder.telegram_username || holder.discord_username || holder.x_username) && (
                  <div className="flex items-center gap-4 mt-1 ml-8">
                    {holder.telegram_username && (
                      <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                        TG: {holder.telegram_username}
                      </span>
                    )}
                    {holder.discord_username && (
                      <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                        DC: {holder.discord_username}
                      </span>
                    )}
                    {holder.x_username && (
                      <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                        X: {holder.x_username}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 mt-6 max-w-2xl">
          <button
            onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            className={`text-[14px] transition-colors cursor-pointer ${
              currentPage === 0
                ? 'text-gray-300 cursor-not-allowed opacity-50'
                : 'text-gray-300 hover:text-[#EF6400]'
            }`}
            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
          >
            [Previous]
          </button>
          <span className="text-[14px] text-gray-300 px-4" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            Page {currentPage + 1} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
            disabled={currentPage === totalPages - 1}
            className={`text-[14px] transition-colors cursor-pointer ${
              currentPage === totalPages - 1
                ? 'text-gray-300 cursor-not-allowed opacity-50'
                : 'text-gray-300 hover:text-[#EF6400]'
            }`}
            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
          >
            [Next]
          </button>
        </div>
      )}


      {holders.length === 0 && (
        <p className="text-[14px] text-gray-300 mt-6" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>No holders found for this token</p>
      )}
    </div>
  );
}
