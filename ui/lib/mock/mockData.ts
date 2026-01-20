/**
 * Comprehensive mock data for Combinator
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
    token_metadata_url: '/api/mock-ipfs/QmMockHashZC',
    token_name: 'Combinator',
    token_symbol: 'ZC',
    creator_twitter: 'combinator',
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
    token_address: 'ShirtlessToken123456789012345678901234567890',
    token_metadata_url: '/api/mock-ipfs/QmMockHashShirtless',
    token_name: 'Shirtless',
    token_symbol: 'SHIRTLESS',
    creator_twitter: 'shirtless',
    creator_github: 'shirtless',
    created_at: '2025-10-20T09:15:00Z',
    verified: true,
    totalClaimed: 8000000,
    availableToClaim: 12000000,
  },
  {
    id: 3,
    launch_time: '2025-10-25T11:20:00Z',
    creator_wallet: MOCK_WALLETS.creator2,
    token_address: 'PercentToken987654321098765432109876543210',
    token_metadata_url: '/api/mock-ipfs/QmMockHashPERC',
    token_name: 'Percent',
    token_symbol: 'PERC',
    creator_twitter: 'percent',
    creator_github: 'percent',
    created_at: '2025-10-25T11:20:00Z',
    verified: true,
    totalClaimed: 10000000,
    availableToClaim: 10000000,
  },
  {
    id: 6,
    launch_time: '2025-11-05T12:30:00Z',
    creator_wallet: MOCK_WALLETS.creator2,
    token_address: 'OogwayToken3333333333333333333333333333',
    token_metadata_url: '/api/mock-ipfs/QmMockHashOOGWAY',
    token_name: 'Oogway',
    token_symbol: 'OOGWAY',
    creator_twitter: 'oogway',
    creator_github: 'oogway',
    created_at: '2025-11-05T12:30:00Z',
    verified: true,
    totalClaimed: 11000000,
    availableToClaim: 9000000,
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
    price: 0.0075, // 640000 / 85000000
    liquidity: 320000,
    total_supply: 100000000,
    circulating_supply: 85000000,
    fdv: 750000,
    market_cap: 640000,
  },
  'ShirtlessToken123456789012345678901234567890': {
    price: 0.0006, // 50000 / 85000000
    liquidity: 25000,
    total_supply: 100000000,
    circulating_supply: 85000000,
    fdv: 60000,
    market_cap: 50000,
  },
  'PercentToken987654321098765432109876543210': {
    price: 0.0018, // 150000 / 85000000
    liquidity: 75000,
    total_supply: 100000000,
    circulating_supply: 85000000,
    fdv: 180000,
    market_cap: 150000,
  },
  'OogwayToken3333333333333333333333333333': {
    price: 0.0005, // 40000 / 85000000
    liquidity: 20000,
    total_supply: 100000000,
    circulating_supply: 85000000,
    fdv: 50000,
    market_cap: 40000,
  },
};

// Mock token metadata
export const MOCK_TOKEN_METADATA: Record<string, any> = {
  'QmMockHashZC': {
    name: 'Combinator',
    symbol: 'ZC',
    description: 'The official token of Combinator platform',
    image: '/z-pfp.jpg',
    website: 'https://combinator.io',
    twitter: 'https://x.com/combinator',
    discord: 'https://discord.com/invite/MQfcX9QM2r',
    attributes: [],
    properties: {
      files: [{ uri: '/z-pfp.jpg', type: 'image/jpeg' }],
      category: 'image',
    },
  },
  'QmMockHashShirtless': {
    name: 'Shirtless',
    symbol: 'SHIRTLESS',
    description: 'Shirtless token for the beach community',
    image: '/shirtless-logo.png',
    website: 'https://shirtless.example',
    twitter: 'https://x.com/shirtless',
    discord: 'https://discord.gg/shirtless',
    attributes: [],
    properties: {
      files: [{ uri: '/shirtless-logo.png', type: 'image/png' }],
      category: 'image',
    },
  },
  'QmMockHashPERC': {
    name: 'Percent',
    symbol: 'PERC',
    description: 'Percent token for percentage-based rewards and calculations',
    image: '/percent.png',
    website: 'https://percent.example',
    twitter: 'https://x.com/percent',
    discord: 'https://discord.gg/percent',
    attributes: [],
    properties: {
      files: [{ uri: '/percent.png', type: 'image/png' }],
      category: 'image',
    },
  },
  'QmMockHashOOGWAY': {
    name: 'Oogway',
    symbol: 'OOGWAY',
    description: 'Oogway token for wisdom and guidance',
    image: '/oogway-pfp.jpg',
    website: 'https://www.oogway.xyz',
    twitter: 'https://x.com/oogway',
    discord: 'https://discord.gg/oogway',
    attributes: [],
    properties: {
      files: [{ uri: '/oogway-pfp.jpg', type: 'image/jpeg' }],
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
    token_name: 'Combinator',
    token_symbol: 'ZC',
    token_metadata_url: '/api/mock-ipfs/QmMockHashZC',
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
    token_address: 'ShirtlessToken123456789012345678901234567890',
    base_mint_priv_key: 'MockBaseMintPrivKey222222222222222222222222222',
    creator_wallet: MOCK_WALLETS.creator1,
    token_name: 'Shirtless',
    token_symbol: 'SHIRTLESS',
    token_metadata_url: '/api/mock-ipfs/QmMockHashShirtless',
    presale_tokens: { amount: 15000000 },
    status: 'completed',
    escrow_pub_key: 'EscrowMockPublicKey2222222222222222222222222',
    tokens_bought: '15000000',
    base_mint_address: 'So11111111111111111111111111111111111111112',
    vesting_duration_hours: 1440,
    ca_ending: 'fun',
  },
  {
    id: 3,
    token_address: 'PercentToken987654321098765432109876543210',
    base_mint_priv_key: 'MockBaseMintPrivKey333333333333333333333333333',
    creator_wallet: MOCK_WALLETS.creator2,
    token_name: 'Percent',
    token_symbol: 'PERC',
    token_metadata_url: '/api/mock-ipfs/QmMockHashPERC',
    presale_tokens: { amount: 12000000 },
    status: 'active',
    escrow_pub_key: 'EscrowMockPublicKey3333333333333333333333333',
    tokens_bought: '8500000',
    base_mint_address: 'So11111111111111111111111111111111111111112',
    vesting_duration_hours: 1080,
    ca_ending: 'perc',
  },
  {
    id: 5,
    token_address: 'OogwayToken3333333333333333333333333333',
    base_mint_priv_key: 'MockBaseMintPrivKey555555555555555555555555555',
    creator_wallet: MOCK_WALLETS.creator2,
    token_name: 'Oogway',
    token_symbol: 'OOGWAY',
    token_metadata_url: '/api/mock-ipfs/QmMockHashOOGWAY',
    presale_tokens: { amount: 20000000 },
    status: 'active',
    escrow_pub_key: 'EscrowMockPublicKey5555555555555555555555555',
    tokens_bought: '11000000',
    base_mint_address: 'So11111111111111111111111111111111111111112',
    vesting_duration_hours: 1800,
    ca_ending: 'oogway',
  },
];

// Mock designated claims
export const MOCK_DESIGNATED_CLAIMS = [
  {
    id: 1,
    token_address: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    original_launcher: MOCK_WALLETS.creator1,
    designated_twitter: 'combinator',
    designated_github: null,
    verified_wallet: null,
    verified_embedded_wallet: null,
    verified_at: null,
    verification_lock_until: null,
    verification_attempts: 0,
    last_verification_attempt: null,
  },
  {
    id: 2,
    token_address: 'ShirtlessToken123456789012345678901234567890',
    original_launcher: MOCK_WALLETS.creator1,
    designated_twitter: 'shirtless',
    designated_github: null,
    verified_wallet: null,
    verified_embedded_wallet: null,
    verified_at: null,
    verification_lock_until: null,
    verification_attempts: 0,
    last_verification_attempt: null,
  },
  {
    id: 3,
    token_address: 'PercentToken987654321098765432109876543210',
    original_launcher: MOCK_WALLETS.creator2,
    designated_twitter: 'percent',
    designated_github: null,
    verified_wallet: null,
    verified_embedded_wallet: null,
    verified_at: null,
    verification_lock_until: null,
    verification_attempts: 0,
    last_verification_attempt: null,
  },
  {
    id: 5,
    token_address: 'OogwayToken3333333333333333333333333333',
    original_launcher: MOCK_WALLETS.creator2,
    designated_twitter: 'oogway',
    designated_github: null,
    verified_wallet: null,
    verified_embedded_wallet: null,
    verified_at: null,
    verification_lock_until: null,
    verification_attempts: 0,
    last_verification_attempt: null,
  },
];

// Mock emission splits
export const MOCK_EMISSION_SPLITS = [
  {
    id: 1,
    token_address: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    recipient_wallet: MOCK_WALLETS.creator1,
    split_percentage: 100,
    label: 'Primary Creator',
    created_at: new Date().toISOString(),
  },
  {
    id: 2,
    token_address: 'ShirtlessToken123456789012345678901234567890',
    recipient_wallet: MOCK_WALLETS.creator1,
    split_percentage: 100,
    label: 'Primary Creator',
    created_at: new Date().toISOString(),
  },
  {
    id: 3,
    token_address: 'PercentToken987654321098765432109876543210',
    recipient_wallet: MOCK_WALLETS.creator2,
    split_percentage: 100,
    label: 'Primary Creator',
    created_at: new Date().toISOString(),
  },
  {
    id: 5,
    token_address: 'OogwayToken3333333333333333333333333333',
    recipient_wallet: MOCK_WALLETS.creator2,
    split_percentage: 100,
    label: 'Primary Creator',
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
    token_address: 'ShirtlessToken123456789012345678901234567890',
    amount: 3000000,
    transaction_signature: 'mock_claim_sig_2',
    confirmed_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 3,
    wallet_address: MOCK_WALLETS.creator2,
    token_address: 'PercentToken987654321098765432109876543210',
    amount: 4000000,
    transaction_signature: 'mock_claim_sig_3',
    confirmed_at: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 5,
    wallet_address: MOCK_WALLETS.creator2,
    token_address: 'OogwayToken3333333333333333333333333333',
    amount: 5500000,
    transaction_signature: 'mock_claim_sig_5',
    confirmed_at: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
];
