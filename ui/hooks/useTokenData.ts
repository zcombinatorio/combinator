import useSWR from 'swr';

// Fetcher functions
const fetcher = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error('Failed to fetch');
  }
  return response.json();
};

// Hook for token info (supply and metadata)
export function useTokenInfo(tokenAddress: string) {
  const { data, error, isLoading, mutate } = useSWR(
    tokenAddress ? [`/api/token-info/${tokenAddress}`, tokenAddress] : null,
    ([url, address]) => fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenAddress: address })
    }),
    {
      revalidateOnFocus: false, // Don't refetch when window regains focus
      dedupingInterval: 60000, // Dedupe requests within 60 seconds
    }
  );

  return {
    tokenInfo: data,
    isLoading,
    error,
    mutate
  };
}

// Hook for launch info
export function useLaunchInfo(tokenAddress: string) {
  const { data, error, isLoading, mutate } = useSWR(
    tokenAddress ? [`/api/launches`, tokenAddress] : null,
    ([url, address]) => fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: address })
    }),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  return {
    launchData: data,
    isLoading,
    error,
    mutate
  };
}

// Hook for designated claims
export function useDesignatedClaims(tokenAddress: string) {
  const { data, error, isLoading, mutate } = useSWR(
    tokenAddress ? [`/api/designated-claims/${tokenAddress}`, tokenAddress] : null,
    ([url, address]) => fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenAddress: address })
    }),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  return {
    designatedData: data,
    isLoading,
    error,
    mutate
  };
}

// Hook for transactions
export function useTransactions(
  tokenAddress: string,
  creatorWallet: string | null,
  before?: string | null,
  fetchLabels?: boolean
) {
  const TRANSACTIONS_PER_PAGE = 10;

  const { data, error, isLoading, mutate } = useSWR(
    tokenAddress && creatorWallet
      ? [`/api/transactions/${tokenAddress}`, tokenAddress, creatorWallet, before, fetchLabels]
      : null,
    ([url]) => fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenAddress,
        walletAddress: creatorWallet,
        limit: TRANSACTIONS_PER_PAGE,
        fetchLabels,
        ...(before && { before })
      })
    }),
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000, // 30 seconds for transactions (more dynamic data)
    }
  );

  return {
    transactions: data?.transactions || [],
    hasMore: data?.hasMore || false,
    lastSignature: data?.lastSignature || null,
    isLoading,
    error,
    mutate
  };
}

// Hook for holders
export function useHolders(tokenAddress: string) {
  const { data, error, isLoading, mutate } = useSWR(
    tokenAddress ? [`/api/holders/${tokenAddress}`, tokenAddress] : null,
    ([url, address]) => fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenAddress: address })
    }),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  return {
    holders: data?.holders || [],
    stats: data?.stats || { totalHolders: 0, totalBalance: '0', lastSyncTime: null },
    isLoading,
    error,
    mutate
  };
}
