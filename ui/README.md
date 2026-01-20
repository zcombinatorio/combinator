# Combinator Backend

Backend API for Combinator.

## Repository Structure

```
ui/
├── app/api/          # Next.js API routes (see endpoints below)
├── lib/              # Core services
│   ├── db/           # Database queries and schema
│   ├── services/     # Business logic (launches, claims, presales)
│   ├── solana/       # Solana transaction building
│   └── validation/   # Input validation
├── routes/           # Express router modules
├── scripts/          # Utility scripts for operations
├── types/            # TypeScript type definitions
└── api-server.ts     # Express server entry point
```

## API Endpoints

### Token Launches
- `POST /api/launch` - Create a new token launch
- `POST /api/launch/confirm` - Confirm launch transaction
- `GET /api/launches` - List all launches

### Presales
- `GET /api/presale` - List presales
- `GET /api/presale/[tokenAddress]` - Get presale details
- `POST /api/presale/[tokenAddress]/contribution` - Contribute to presale
- `GET /api/presale/max-contribution` - Get max contribution limits

### Claims
- `GET /api/claims/[tokenAddress]` - Get claim info for token
- `POST /api/claims/mint` - Mint claim transaction
- `POST /api/claims/confirm` - Confirm claim
- `GET /api/designated-claims/[tokenAddress]` - Designated claims

### Token Info
- `GET /api/tokens` - List all tokens
- `GET /api/tokens-basic` - Basic token list
- `GET /api/tokens-claims` - Tokens with claim info
- `GET /api/token-info/[tokenAddress]` - Detailed token info
- `GET /api/verify-token/[address]` - Verify token address

### Holders & Wallets
- `GET /api/holders/[tokenAddress]` - Get token holders
- `POST /api/holders/[tokenAddress]/sync` - Sync holder data
- `GET /api/holders/[tokenAddress]/[walletAddress]/labels` - Wallet labels
- `GET /api/balance/[tokenAddress]/[walletAddress]` - Wallet balance
- `GET /api/wallet-labels` - All wallet labels

### Market Data
- `GET /api/market-data/[tokenAddress]` - Price and market data
- `GET /api/transactions/[tokenAddress]` - Transaction history

### Trading API (Proposal Markets)

Programmatic trading on futarchy proposal markets. All endpoints use build/execute pattern.

**Market Info:**
- `GET /dao/proposal/:proposalPda/market-status` - TWAP values, spot prices, leading option
- `GET /dao/proposal/:proposalPda/quote` - Get swap quote (params: poolIndex, swapAToB, inputAmount)
- `GET /dao/proposal/:proposalPda/balances/:wallet` - User balances for base/quote vaults

**Swap:**
- `POST /dao/proposal/:proposalPda/swap/build` - Build swap tx (body: wallet, poolIndex, swapAToB, inputAmount, slippageBps?)
- `POST /dao/proposal/:proposalPda/swap/execute` - Execute signed swap (body: requestId, signedTransaction)

**Deposit (Split):**
- `POST /dao/proposal/:proposalPda/deposit/build` - Build deposit tx (body: wallet, vaultType, amount)
- `POST /dao/proposal/:proposalPda/deposit/execute` - Execute signed deposit

**Withdraw (Merge):**
- `POST /dao/proposal/:proposalPda/withdraw/build` - Build withdraw tx (body: wallet, vaultType, amount)
- `POST /dao/proposal/:proposalPda/withdraw/execute` - Execute signed withdraw

**Redeem (Post-Resolution):**
- `POST /dao/proposal/:proposalPda/redeem/build` - Build redeem tx (body: wallet, vaultType)
- `POST /dao/proposal/:proposalPda/redeem/execute` - Execute signed redeem

### Verification
- `POST /api/verify-designated/challenge` - Get verification challenge
- `POST /api/verify-designated/verify` - Verify wallet ownership
- `GET /api/verify-designated` - Verification status

### Uploads
- `POST /api/upload` - Upload file
- `POST /api/upload-metadata` - Upload token metadata

## Using Claude Code for Exploration

Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and point it at this repo. Example prompts:

**Understanding the product:**
- "What features does this API support?"
- "Walk me through the token launch flow end-to-end"
- "How does the presale contribution process work?"

**Integration planning:**
- "What endpoints would I need to build a token launch UI?"
- "What data does the claims endpoint return?"
- "How are Solana transactions built and signed?"

**Gap analysis:**
- "What's missing that I'd need to build myself?"
- "What external services does this depend on?"
- "How is authentication handled?"

## Contact

Questions? Reach out to the Combinator team:

- **Telegram Group:** https://t.me/+Ao05jBnpEE0yZGVh
- **Direct:** https://t.me/handsdiff
