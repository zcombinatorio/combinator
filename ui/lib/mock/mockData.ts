/**
 * Comprehensive mock data for Z Combinator
 * Used when running in development mode without API keys or database access
 */

export interface MockToken {
  id: number;
  launch_time: string;
  creator_wallet: string;
  token_address: string;
  token_metadata_url: string;
  token_name: string;
  token_symbol: string;
  creator_twitter: string | null;
  creator_github: string | null;
  created_at: string;
  verified: boolean;
  totalClaimed?: number;
  availableToClaim?: number;
}

export interface MockTransaction {
  signature: string;
  timestamp: number;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  tokenTransfers?: {
    timestamp: number;
    signature: string;
    mint: string;
    fromUserAccount: string | null;
    toUserAccount: string;
    tokenAmount: number;
    tokenStandard: string;
  }[];
}

export interface MockHolder {
  id: number;
  token_address: string;
  wallet_address: string;
  token_balance: string;
  staked_balance: string;
  telegram_username: string | null;
  x_username: string | null;
  discord_username: string | null;
  custom_label: string | null;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
}

export interface MockMarketData {
  price: number;
  liquidity: number;
  total_supply: number;
  circulating_supply: number;
  fdv: number;
  market_cap: number;
}

export interface MockPresale {
  id: number;
  token_address: string;
  base_mint_priv_key: string;
  creator_wallet: string;
  token_name: string;
  token_symbol: string;
  token_metadata_url: string;
  presale_tokens: any;
  status: string;
  escrow_pub_key: string;
  escrow_priv_key?: string;
  tokens_bought: string;
  base_mint_address: string;
  vesting_duration_hours: number;
  ca_ending: string;
}

// Protocol wallet (all mints signed by this)
export const MOCK_PROTOCOL_WALLET = 'Hq7Xh37tT4sesD6wA4DphYfxeMJRhhFWS3KVUSSGjqzc';

// Sample wallets for testing
export const MOCK_WALLETS = {
  creator1: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  creator2: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  creator3: 'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf',
  holder1: 'AZ8pQo7Qc8JK9MhYhv4FN3XKHy9WzXj7RFpT2VnLkqMU',
  holder2: 'BYth9pQUkLmZ4wN5Rs6xHq8VjKMwXzTaP3uL7bQm9vPQ',
  holder3: 'CX4mPr9VnQw3xL6Nz7TgWu2YjRzUt8vSy5cK4dHnEwRT',
};

// Mock tokens with realistic data
export const MOCK_TOKENS: MockToken[] = [
  {
    id: 1,
    launch_time: '2025-10-15T14:30:00Z',
    creator_wallet: MOCK_WALLETS.creator1,
    token_address: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    token_metadata_url: '/api/mock-ipfs/QmMockHash1',
    token_name: 'ZCombinator Token',
    token_symbol: 'ZCOM',
    creator_twitter: 'zcombinator',
    creator_github: 'zcombinatorio',
    created_at: '2025-10-15T14:30:00Z',
    verified: true,
    totalClaimed: 15000000,
    availableToClaim: 5000000,
  },
  {
    id: 2,
    launch_time: '2025-10-20T09:15:00Z',
    creator_wallet: MOCK_WALLETS.creator1,
    token_address: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2Y1dD1j',
    token_metadata_url: '/api/mock-ipfs/QmMockHash2',
    token_name: 'Demo Coin',
    token_symbol: 'DEMO',
    creator_twitter: 'democoin',
    creator_github: null,
    created_at: '2025-10-20T09:15:00Z',
    verified: true,
    totalClaimed: 8000000,
    availableToClaim: 12000000,
  },
  {
    id: 3,
    launch_time: '2025-10-22T16:45:00Z',
    creator_wallet: MOCK_WALLETS.creator2,
    token_address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    token_metadata_url: '/api/mock-ipfs/QmMockHash3',
    token_name: 'Test Token',
    token_symbol: 'TEST',
    creator_twitter: null,
    creator_github: 'testdev',
    created_at: '2025-10-22T16:45:00Z',
    verified: false,
    totalClaimed: 3000000,
    availableToClaim: 7000000,
  },
  {
    id: 4,
    launch_time: '2025-10-25T11:20:00Z',
    creator_wallet: MOCK_WALLETS.creator2,
    token_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    token_metadata_url: '/api/mock-ipfs/QmMockHash4',
    token_name: 'Moon Token',
    token_symbol: 'MOON',
    creator_twitter: 'moontoken',
    creator_github: 'moondev',
    created_at: '2025-10-25T11:20:00Z',
    verified: true,
    totalClaimed: 25000000,
    availableToClaim: 15000000,
  },
  {
    id: 5,
    launch_time: '2025-10-26T08:00:00Z',
    creator_wallet: MOCK_WALLETS.creator3,
    token_address: '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj',
    token_metadata_url: '/api/mock-ipfs/QmMockHash5',
    token_name: 'Alpha Protocol',
    token_symbol: 'ALPHA',
    creator_twitter: 'alphaprotocol',
    creator_github: null,
    created_at: '2025-10-26T08:00:00Z',
    verified: true,
    totalClaimed: 10000000,
    availableToClaim: 20000000,
  },
  {
    id: 6,
    launch_time: '2025-10-27T13:30:00Z',
    creator_wallet: MOCK_WALLETS.creator3,
    token_address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    token_metadata_url: '/api/mock-ipfs/QmMockHash6',
    token_name: 'Beta Launch',
    token_symbol: 'BETA',
    creator_twitter: null,
    creator_github: 'betalabs',
    created_at: '2025-10-27T13:30:00Z',
    verified: false,
    totalClaimed: 5000000,
    availableToClaim: 5000000,
  },
  {
    id: 7,
    launch_time: '2025-10-28T10:00:00Z',
    creator_wallet: MOCK_WALLETS.creator1,
    token_address: 'So11111111111111111111111111111111111111112',
    token_metadata_url: '/api/mock-ipfs/QmMockHash7',
    token_name: 'Gamma Token',
    token_symbol: 'GAMMA',
    creator_twitter: 'gammatoken',
    creator_github: 'gammadev',
    created_at: '2025-10-28T10:00:00Z',
    verified: true,
    totalClaimed: 18000000,
    availableToClaim: 2000000,
  },
  {
    id: 8,
    launch_time: '2025-10-29T15:45:00Z',
    creator_wallet: MOCK_WALLETS.creator2,
    token_address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    token_metadata_url: '/api/mock-ipfs/QmMockHash8',
    token_name: 'Delta Rewards',
    token_symbol: 'DELTA',
    creator_twitter: 'deltarewards',
    creator_github: null,
    created_at: '2025-10-29T15:45:00Z',
    verified: true,
    totalClaimed: 12000000,
    availableToClaim: 8000000,
  },
];

// Generate mock transactions for a token with realistic patterns
export function generateMockTransactions(tokenAddress: string, count: number = 25, creatorWallet?: string): MockTransaction[] {
  const transactions: MockTransaction[] = [];
  const now = Date.now();

  // Weighted distribution: more transfers/buys/sells, fewer mints/burns
  const typeWeights = [
    { type: 'mint', weight: 5 },
    { type: 'transfer', weight: 30 },
    { type: 'buy', weight: 30 },
    { type: 'sell', weight: 30 },
    { type: 'burn', weight: 5 },
  ];

  const wallets = Object.values(MOCK_WALLETS);
  const SOL_MINT = 'So11111111111111111111111111111111111111112';

  // PDA addresses (off-curve) for liquidity pools
  const MOCK_POOL_PDA = 'PDAxyz123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabc';

  for (let i = 0; i < count; i++) {
    // Vary time intervals: some transactions close together, others far apart
    const timeVariation = Math.random() < 0.3
      ? Math.floor(Math.random() * 600000)  // 0-10 minutes (clustered activity)
      : Math.floor(Math.random() * 7200000); // 0-2 hours (spread out)
    const timestamp = now - (i * 1800000) - timeVariation;

    // Select transaction type based on weights
    const totalWeight = typeWeights.reduce((sum, w) => sum + w.weight, 0);
    let random = Math.random() * totalWeight;
    let selectedType = 'transfer';

    for (const { type, weight } of typeWeights) {
      random -= weight;
      if (random <= 0) {
        selectedType = type;
        break;
      }
    }

    const tokenAmount = Math.floor(Math.random() * 5000000) + 10000;
    const solAmount = Math.floor(Math.random() * 50000) + 1000; // SOL in lamports

    // If creator wallet provided, use it for 70-80% of transactions
    // This ensures transaction history shows entries for the creator
    const useCreatorWallet = creatorWallet && Math.random() < 0.75;
    const userWallet = useCreatorWallet ? creatorWallet : wallets[Math.floor(Math.random() * wallets.length)];

    const tx: MockTransaction = {
      signature: `mock_sig_${tokenAddress.slice(0, 8)}_${i}_${timestamp}`,
      timestamp: Math.floor(timestamp / 1000),
      type: selectedType === 'mint' ? 'TOKEN_MINT' : selectedType === 'burn' ? 'BURN' : 'TRANSFER',
      source: Math.random() > 0.5 ? 'METEORA' : 'RAYDIUM',
      fee: 5000,
      feePayer: userWallet,
      tokenTransfers: [],
    };

    // Build token transfers based on type
    if (selectedType === 'mint') {
      // Mint: no fromUserAccount, tokens created to user
      tx.tokenTransfers = [{
        timestamp: Math.floor(timestamp / 1000),
        signature: tx.signature,
        mint: tokenAddress,
        fromUserAccount: null,
        toUserAccount: userWallet,
        tokenAmount,
        tokenStandard: 'Fungible',
      }];
    } else if (selectedType === 'burn') {
      // Burn transactions are marked by type, usually no token transfers in the array
      tx.tokenTransfers = [];
    } else if (selectedType === 'transfer') {
      // Simple transfer: user to user, no SOL exchange
      // For variety, sometimes creator sends, sometimes creator receives
      const useCreatorAsRecipient = creatorWallet && !useCreatorWallet && Math.random() < 0.5;
      const recipient = useCreatorAsRecipient ? creatorWallet : wallets[Math.floor(Math.random() * wallets.length)];
      tx.tokenTransfers = [{
        timestamp: Math.floor(timestamp / 1000),
        signature: tx.signature,
        mint: tokenAddress,
        fromUserAccount: userWallet,
        toUserAccount: recipient,
        tokenAmount,
        tokenStandard: 'Fungible',
      }];
    } else if (selectedType === 'buy') {
      // Buy: user receives tokens from PDA, user sends SOL
      tx.tokenTransfers = [
        // Token transfer: PDA -> user
        {
          timestamp: Math.floor(timestamp / 1000),
          signature: tx.signature,
          mint: tokenAddress,
          fromUserAccount: MOCK_POOL_PDA,
          toUserAccount: userWallet,
          tokenAmount,
          tokenStandard: 'Fungible',
        },
        // SOL transfer: user -> PDA (user pays for tokens)
        {
          timestamp: Math.floor(timestamp / 1000),
          signature: tx.signature,
          mint: SOL_MINT,
          fromUserAccount: userWallet,
          toUserAccount: MOCK_POOL_PDA,
          tokenAmount: solAmount,
          tokenStandard: 'Fungible',
        },
      ];
    } else if (selectedType === 'sell') {
      // Sell: user sends tokens to PDA, user receives SOL
      tx.tokenTransfers = [
        // Token transfer: user -> PDA
        {
          timestamp: Math.floor(timestamp / 1000),
          signature: tx.signature,
          mint: tokenAddress,
          fromUserAccount: userWallet,
          toUserAccount: MOCK_POOL_PDA,
          tokenAmount,
          tokenStandard: 'Fungible',
        },
        // SOL transfer: PDA -> user (user receives payment)
        {
          timestamp: Math.floor(timestamp / 1000),
          signature: tx.signature,
          mint: SOL_MINT,
          fromUserAccount: MOCK_POOL_PDA,
          toUserAccount: userWallet,
          tokenAmount: solAmount,
          tokenStandard: 'Fungible',
        },
      ];
    }

    transactions.push(tx);
  }

  return transactions;
}

// Generate mock holders for a token
export function generateMockHolders(tokenAddress: string, count: number = 12): MockHolder[] {
  const holders: MockHolder[] = [];

  for (let i = 0; i < count; i++) {
    const balance = Math.floor(Math.random() * 5000000) + 100000;
    const stakedBalance = Math.floor(balance * Math.random() * 0.5);
    const walletAddress = Object.values(MOCK_WALLETS)[i % Object.values(MOCK_WALLETS).length];

    holders.push({
      id: i + 1,
      token_address: tokenAddress,
      wallet_address: walletAddress,
      token_balance: balance.toString(),
      staked_balance: stakedBalance.toString(),
      telegram_username: null,
      x_username: null,
      discord_username: null,
      custom_label: null,
      created_at: new Date(Date.now() - (i * 86400000)).toISOString(),
      updated_at: new Date().toISOString(),
      last_sync_at: new Date().toISOString(),
    });
  }

  return holders;
}

// Mock market data for tokens
export const MOCK_MARKET_DATA: Record<string, MockMarketData> = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': {
    price: 0.0234,
    liquidity: 456789,
    total_supply: 100000000,
    circulating_supply: 85000000,
    fdv: 2340000,
    market_cap: 1989000,
  },
  'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2Y1dD1j': {
    price: 0.0089,
    liquidity: 234567,
    total_supply: 100000000,
    circulating_supply: 92000000,
    fdv: 890000,
    market_cap: 818800,
  },
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': {
    price: 0.0012,
    liquidity: 89123,
    total_supply: 100000000,
    circulating_supply: 78000000,
    fdv: 120000,
    market_cap: 93600,
  },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
    price: 0.0456,
    liquidity: 789456,
    total_supply: 100000000,
    circulating_supply: 90000000,
    fdv: 4560000,
    market_cap: 4104000,
  },
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj': {
    price: 0.0178,
    liquidity: 345678,
    total_supply: 100000000,
    circulating_supply: 88000000,
    fdv: 1780000,
    market_cap: 1566400,
  },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
    price: 0.0034,
    liquidity: 123456,
    total_supply: 100000000,
    circulating_supply: 75000000,
    fdv: 340000,
    market_cap: 255000,
  },
  'So11111111111111111111111111111111111111112': {
    price: 0.0289,
    liquidity: 567890,
    total_supply: 100000000,
    circulating_supply: 95000000,
    fdv: 2890000,
    market_cap: 2745500,
  },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': {
    price: 0.0145,
    liquidity: 298765,
    total_supply: 100000000,
    circulating_supply: 82000000,
    fdv: 1450000,
    market_cap: 1189000,
  },
};

// Mock token metadata
export const MOCK_TOKEN_METADATA: Record<string, any> = {
  'QmMockHash1': {
    name: 'ZCombinator Token',
    symbol: 'ZCOM',
    description: 'The official token of Z Combinator platform',
    image: '/z-pfp.jpg',
    website: 'https://zcombinator.io',
    twitter: 'https://x.com/zcombinator',
    attributes: [],
    properties: {
      files: [{ uri: '/z-pfp.jpg', type: 'image/jpeg' }],
      category: 'image',
    },
  },
  'QmMockHash2': {
    name: 'Demo Coin',
    symbol: 'DEMO',
    description: 'A demonstration token for testing purposes',
    image: '/z-pfp.jpg',
    website: 'https://democoin.example',
    twitter: 'https://x.com/democoin',
    attributes: [],
    properties: {
      files: [{ uri: '/z-pfp.jpg', type: 'image/jpeg' }],
      category: 'image',
    },
  },
  'QmMockHash3': {
    name: 'Test Token',
    symbol: 'TEST',
    description: 'Testing the waters with this new token launch',
    image: '/z-pfp.jpg',
    website: 'https://testtoken.example',
    twitter: 'https://x.com/testtoken',
    attributes: [],
    properties: {
      files: [{ uri: '/z-pfp.jpg', type: 'image/jpeg' }],
      category: 'image',
    },
  },
  'QmMockHash4': {
    name: 'Moon Token',
    symbol: 'MOON',
    description: 'To the moon! Join our journey to the stars',
    image: '/z-pfp.jpg',
    website: 'https://moontoken.example',
    twitter: 'https://x.com/moontoken',
    attributes: [],
    properties: {
      files: [{ uri: '/z-pfp.jpg', type: 'image/jpeg' }],
      category: 'image',
    },
  },
  'QmMockHash5': {
    name: 'Alpha Protocol',
    symbol: 'ALPHA',
    description: 'First-mover advantage in DeFi innovation',
    image: '/z-pfp.jpg',
    website: 'https://alphaprotocol.example',
    twitter: 'https://x.com/alphaprotocol',
    attributes: [],
    properties: {
      files: [{ uri: '/z-pfp.jpg', type: 'image/jpeg' }],
      category: 'image',
    },
  },
  'QmMockHash6': {
    name: 'Beta Launch',
    symbol: 'BETA',
    description: 'Beta testing our new token economics model',
    image: '/z-pfp.jpg',
    website: 'https://betalabs.example',
    twitter: 'https://x.com/betalabs',
    attributes: [],
    properties: {
      files: [{ uri: '/z-pfp.jpg', type: 'image/jpeg' }],
      category: 'image',
    },
  },
  'QmMockHash7': {
    name: 'Gamma Token',
    symbol: 'GAMMA',
    description: 'High-energy token for the gamma community',
    image: '/z-pfp.jpg',
    website: 'https://gammatoken.example',
    twitter: 'https://x.com/gammatoken',
    attributes: [],
    properties: {
      files: [{ uri: '/z-pfp.jpg', type: 'image/jpeg' }],
      category: 'image',
    },
  },
  'QmMockHash8': {
    name: 'Delta Rewards',
    symbol: 'DELTA',
    description: 'Rewarding our community with Delta tokens',
    image: '/z-pfp.jpg',
    website: 'https://deltarewards.example',
    twitter: 'https://x.com/deltarewards',
    attributes: [],
    properties: {
      files: [{ uri: '/z-pfp.jpg', type: 'image/jpeg' }],
      category: 'image',
    },
  },
};

// Mock presales
export const MOCK_PRESALES: MockPresale[] = [
  {
    id: 1,
    token_address: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    base_mint_priv_key: 'MockBaseMintPrivKey111111111111111111111111111',
    creator_wallet: MOCK_WALLETS.creator1,
    token_name: 'ZCombinator Token',
    token_symbol: 'ZCOM',
    token_metadata_url: '/api/mock-ipfs/QmMockHash1',
    presale_tokens: { amount: 10000000 },
    status: 'active',
    escrow_pub_key: 'EscrowMockPublicKey1111111111111111111111111',
    tokens_bought: '3500000',
    base_mint_address: 'So11111111111111111111111111111111111111112',
    vesting_duration_hours: 720,
    ca_ending: 'pump',
  },
  {
    id: 2,
    token_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    base_mint_priv_key: 'MockBaseMintPrivKey222222222222222222222222222',
    creator_wallet: MOCK_WALLETS.creator2,
    token_name: 'Moon Token',
    token_symbol: 'MOON',
    token_metadata_url: '/api/mock-ipfs/QmMockHash4',
    presale_tokens: { amount: 15000000 },
    status: 'completed',
    escrow_pub_key: 'EscrowMockPublicKey2222222222222222222222222',
    tokens_bought: '15000000',
    base_mint_address: 'So11111111111111111111111111111111111111112',
    vesting_duration_hours: 1440,
    ca_ending: 'fun',
  },
];

// Mock designated claims
export const MOCK_DESIGNATED_CLAIMS = [
  {
    id: 1,
    token_address: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    original_launcher: MOCK_WALLETS.creator1,
    designated_twitter: 'zcombinator',
    designated_github: null,
    verified_wallet: null,
    verified_embedded_wallet: null,
    verified_at: null,
    verification_lock_until: null,
    verification_attempts: 0,
    last_verification_attempt: null,
  },
];

// Mock emission splits (multi-claimer example for MOON token)
export const MOCK_EMISSION_SPLITS = [
  {
    id: 1,
    token_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    recipient_wallet: MOCK_WALLETS.creator2,
    split_percentage: 60,
    label: 'Primary Creator',
    created_at: new Date().toISOString(),
  },
  {
    id: 2,
    token_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    recipient_wallet: MOCK_WALLETS.holder1,
    split_percentage: 25,
    label: 'Co-Creator',
    created_at: new Date().toISOString(),
  },
  {
    id: 3,
    token_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    recipient_wallet: MOCK_WALLETS.holder2,
    split_percentage: 15,
    label: 'Advisor',
    created_at: new Date().toISOString(),
  },
];

// Mock claim records
export const MOCK_CLAIM_RECORDS = [
  {
    id: 1,
    wallet_address: MOCK_WALLETS.creator1,
    token_address: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    amount: 5000000,
    transaction_signature: 'mock_claim_sig_1',
    confirmed_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 2,
    wallet_address: MOCK_WALLETS.creator1,
    token_address: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2Y1dD1j',
    amount: 3000000,
    transaction_signature: 'mock_claim_sig_2',
    confirmed_at: new Date(Date.now() - 86400000).toISOString(),
  },
];
