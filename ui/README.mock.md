# Mock Data Mode Documentation

## Overview

Z Combinator includes a comprehensive **Mock Data Mode** that allows developers to run the entire UI without any external dependencies:
- ✅ **No Database Required** - In-memory PostgreSQL mock
- ✅ **No API Keys Needed** - Mock implementations for Helius, Birdeye, Pinata
- ✅ **No Authentication Required** - Optional mock authentication
- ✅ **Full Feature Access** - All pages and components work with realistic data

This makes it perfect for:
- 🚀 **Quick onboarding** - Get started in seconds
- 🎨 **UI/UX development** - Build and test interfaces
- 🧪 **Component testing** - Test with realistic data
- 📱 **Demo presentations** - Show features without backend setup

---

## Quick Start

### 1. Clone and Install
```bash
git clone <repository>
cd ui
pnpm install
```

### 2. Run in Mock Mode (Default)
```bash
pnpm run dev
```

That's it! The app will automatically detect that no API keys or database are configured and run in mock mode. You'll see a yellow banner at the top indicating "Demo Mode".

### 3. Access the App
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## How It Works

The mock system uses **automatic detection** to determine when to use mock data:

| Service | Detection Logic | Mock Behavior |
|---------|----------------|---------------|
| **Database** | No `DB_URL` or `DB_URL=mock://localhost` | In-memory PostgreSQL with 11 tables |
| **Helius RPC** | No `HELIUS_API_KEY` | Mock blockchain transactions |
| **Birdeye API** | No `BIRDEYE_API_KEY` | Mock market data (prices, liquidity) |
| **Pinata IPFS** | No `PINATA_JWT` | Returns `/z-pfp.jpg` for all uploads |
| **Privy Auth** | No `NEXT_PUBLIC_PRIVY_APP_ID` | Optional mock wallet connection |

---

## Mock Data Contents

### Tokens
- **8 sample tokens** with varied characteristics
- Mix of verified and unverified tokens
- Realistic metadata (names, symbols, descriptions)
- All use `/public/z-pfp.jpg` as token image

### Transactions
- **25-30 transactions per token**
- Types: TOKEN_MINT, TRANSFER, SWAP_BUY, SWAP_SELL, BURN
- Realistic timestamps and amounts
- Protocol wallet: `Hq7Xh37tT4sesD6wA4DphYfxeMJRhhFWS3KVUSSGjqzc`

### Token Holders
- **10-15 holders per token**
- Varied balances and staked amounts
- Social labels (Twitter, Telegram, Discord)
- Custom labels for top holders

### Market Data
- **Realistic price ranges**: $0.0001 - $0.50
- **Liquidity**: $50K - $500K
- **Market cap and FDV** calculations
- Slight randomization on each fetch (simulates price changes)

### Presales
- **2 sample presales** (active and completed)
- Bid tracking and contribution history
- Vesting calculations

### Designated Claims
- **1 token with designated claimer** (ZCOM)
- Verification flow demonstration

### Emission Splits
- **1 token with multi-claimer** (MOON)
- 60% / 25% / 15% split example

---

## File Structure

```
ui/
├── lib/
│   └── mock/
│       ├── index.ts              # Environment detection & exports
│       ├── mockData.ts           # All sample data
│       ├── mockDatabase.ts       # In-memory DB implementation
│       ├── mockHelius.ts         # Mock blockchain API
│       ├── mockBirdeye.ts        # Mock market data API
│       └── mockPinata.ts         # Mock IPFS uploads
├── components/
│   └── DemoModeBanner.tsx        # Yellow banner indicator
└── app/
    └── api/
        ├── demo-mode-check/      # Detection endpoint
        ├── market-data/          # Updated for mock mode
        └── upload/               # Updated for mock mode
```

---

## Configuration

### Force Mock Mode

You can explicitly force mock mode even if API keys are present:

```bash
# .env.local
USE_MOCK_DATA=true        # Force mock database
USE_MOCK_HELIUS=true      # Force mock Helius
```

### Mock-Specific URLs

The database connection can be explicitly set to mock mode:

```bash
DB_URL=mock://localhost
```

### Disable Mock Mode

To use real services, simply provide the API keys:

```bash
# .env.local
DB_URL=postgresql://user:password@host:5432/database
HELIUS_API_KEY=your_helius_key
BIRDEYE_API_KEY=your_birdeye_key
PINATA_JWT=your_pinata_jwt
PINATA_GATEWAY_URL=https://gateway.pinata.cloud
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
```

---

## Features Available in Mock Mode

### ✅ Fully Functional
- Browse all tokens on `/tokens` and `/projects` pages
- View token details and market data
- View transaction history (`/history/[tokenAddress]`)
- View token holders (`/holders/[tokenAddress]`)
- View presale information
- Portfolio page with user tokens
- Image uploads (returns z-pfp.jpg)
- Metadata browsing

### ⚠️ Limited Functionality
- **Real transactions**: Cannot execute real blockchain transactions
- **Wallet connections**: Optional mock wallet (no real signing)
- **Claims**: Can view eligibility but not execute
- **Persistence**: Data resets on server restart (in-memory only)
- **Real-time updates**: No WebSocket or polling (static data)

### ❌ Not Available
- Writing to real blockchain
- Real token launches
- Real claiming/minting
- Real presale contributions
- Permanent data storage

---

## Development Workflow

### Scenario 1: UI Development
```bash
# Just run without any setup
pnpm run dev

# Make UI changes and see them reflected immediately
# All data is pre-populated and realistic
```

### Scenario 2: Component Testing
```tsx
// Components automatically use mock data
import { getTokenLaunches } from '@/lib/db';

// This returns mock data if no DB is configured
const tokens = await getTokenLaunches();
```

### Scenario 3: API Route Development
```typescript
// API routes automatically detect mock mode
import { shouldUseMockData, getMockDatabase } from '@/lib/mock';

export async function GET() {
  if (shouldUseMockData()) {
    // Use mock implementation
    return getMockDatabase().getTokenLaunches();
  }

  // Use real implementation
  return realDatabase.getTokenLaunches();
}
```

---

## Customizing Mock Data

### Adding New Tokens

Edit `/lib/mock/mockData.ts`:

```typescript
export const MOCK_TOKENS: MockToken[] = [
  // ... existing tokens
  {
    id: 9,
    launch_time: '2025-10-30T12:00:00Z',
    creator_wallet: MOCK_WALLETS.creator1,
    token_address: 'YourNewTokenAddress11111111111111111111111',
    token_metadata_url: 'https://mock-ipfs.pinata.cloud/ipfs/QmNewHash',
    token_name: 'My New Token',
    token_symbol: 'MNT',
    creator_twitter: 'mytoken',
    creator_github: null,
    created_at: '2025-10-30T12:00:00Z',
    verified: true,
    totalClaimed: 5000000,
    availableToClaim: 10000000,
  },
];
```

### Changing Mock Wallets

Update `MOCK_WALLETS` in `mockData.ts`:

```typescript
export const MOCK_WALLETS = {
  creator1: 'YourWalletAddress1111111111111111111111111',
  creator2: 'YourWalletAddress2222222222222222222222222',
  // ... add more as needed
};
```

### Adjusting Market Data

Modify price ranges and liquidity in `mockBirdeye.ts`:

```typescript
const price = Math.random() * 0.05 + 0.001; // Adjust range
const liquidity = Math.random() * 500000 + 50000; // Adjust range
```

---

## Troubleshooting

### Banner Doesn't Appear
- Check console for errors
- Verify `/api/demo-mode-check` returns `{"isDemoMode": true}`
- Try hard refresh (Cmd+Shift+R / Ctrl+Shift+F5)

### Data Not Loading
- Check browser console for errors
- Verify mock files exist in `/lib/mock/`
- Check that environment variables are NOT set (should be missing for mock mode)

### Token Images Not Showing
- Verify `/public/z-pfp.jpg` exists
- Check browser network tab for 404 errors
- Clear browser cache

### TypeScript Errors
- Run `pnpm run build` to check for type issues
- Ensure all mock types match real database types
- Check `/lib/db/types.ts` for type definitions

---

## Production Use

**⚠️ Important**: Mock mode is for development only!

Before deploying to production:
1. ✅ Set all required environment variables
2. ✅ Configure real database connection
3. ✅ Add all API keys (Helius, Birdeye, Pinata, Privy)
4. ✅ Test with real data
5. ✅ Verify demo banner does NOT appear

---

## Contributing

When adding new features:
1. Update mock data in `/lib/mock/mockData.ts`
2. Update mock implementations (Database, Helius, Birdeye, Pinata)
3. Test in both mock and real modes
4. Update this documentation

---

## Technical Details

### Mock Database Architecture
- **In-memory storage**: JavaScript Map/Array structures
- **Stateful**: Changes persist during server runtime
- **Type-safe**: Matches PostgreSQL schema exactly
- **Auto-incrementing IDs**: Mimics SERIAL PRIMARY KEY

### Detection Logic
```typescript
// Example from /lib/mock/index.ts
export function shouldUseMockData(): boolean {
  if (process.env.USE_MOCK_DATA === 'true') return true;
  if (!process.env.DB_URL || process.env.DB_URL === 'mock://localhost') return true;
  return false;
}
```

### Performance
- **Fast startup**: No database connections
- **No network latency**: Everything is local
- **Instant responses**: In-memory operations
- **Memory usage**: ~50MB for all mock data

---

## FAQ

**Q: Will my changes persist after restarting the server?**
A: No, mock data is in-memory only and resets on restart.

**Q: Can I use some real services and mock others?**
A: Yes! Each service (Database, Helius, Birdeye, Pinata) is detected independently.

**Q: How do I switch from mock to real mode?**
A: Just add the required API keys to `.env.local` - detection is automatic.

**Q: Can I use this for production demos?**
A: Yes, but be clear it's demo data. The banner indicates mock mode.

**Q: How do I add more mock tokens?**
A: Edit `/lib/mock/mockData.ts` and add to the `MOCK_TOKENS` array.

---

## Support

For issues or questions:
1. Check this documentation
2. Review `/lib/mock/` source code
3. Open an issue on GitHub
4. Check existing issues for similar problems

---

**Happy Developing! 🚀**
