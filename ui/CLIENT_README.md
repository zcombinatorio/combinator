# Combinator Client Integration Guide

API Base URL: `https://api.zcombinator.io`

## Prerequisites

1. **Clone the Repository**
   ```bash
   git clone <repo-url>
   cd zcombinator/ui
   ```

2. **Install Dependencies**
   ```bash
   pnpm install
   ```

3. **Environment Setup**

   Create a `.env` file:
   ```bash
   RPC_URL=<your-solana-rpc-endpoint>
   PRIVATE_KEY=<your-base58-encoded-private-key>
   ```

---

## Building Block Scripts

### 1. create-token.ts

Creates a new SPL token with configurable metadata.

**Usage:**
```bash
TOKEN_NAME="MyToken" TOKEN_SYMBOL="MTK" SKIP_METADATA=true \
  pnpm tsx scripts/create-token.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | - | Solana RPC endpoint |
| `PRIVATE_KEY` | Yes | - | Your wallet private key (base58) |
| `TOKEN_NAME` | No | "TestToken" | Token name |
| `TOKEN_SYMBOL` | No | "TEST" | Token symbol |
| `TOKEN_DECIMALS` | No | 6 | Number of decimals |
| `TOTAL_SUPPLY` | No | 1000000 | Total tokens to mint |
| `SKIP_METADATA` | No | false | Set to "true" to skip metadata creation |

**Output:**
```
TOKEN_MINT=<mint-address>
```

---

### 2. create-damm-pool.ts

Creates a Meteora CP-AMM (DAMM) pool for an existing token.

**Usage:**
```bash
TOKEN_MINT="<mint-address>" SOL_AMOUNT=0.1 TOKEN_PERCENT=10 \
  pnpm tsx scripts/create-damm-pool.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | - | Solana RPC endpoint |
| `PRIVATE_KEY` | Yes | - | Your wallet private key |
| `TOKEN_MINT` | Yes | - | Token mint address |
| `SOL_AMOUNT` | No | 0.1 | SOL to provide as liquidity |
| `TOKEN_PERCENT` | No | 10 | Percentage of token balance to use |
| `TOKEN_AMOUNT` | No | - | Exact token amount (overrides TOKEN_PERCENT) |
| `FEE_BPS` | No | 25 | Pool fee in basis points (25 = 0.25%) |

**Output:**
```
POOL_ADDRESS=<pool-address>
POSITION_NFT=<nft-mint>
```

---

### 3. create-token-with-pool.ts

Convenience script that creates a token AND a DAMM pool in one operation.

**Usage:**
```bash
TOKEN_NAME="MyDAO" TOKEN_SYMBOL="MYDAO" SOL_AMOUNT=0.5 TOKEN_PERCENT=10 SKIP_METADATA=true \
  pnpm tsx scripts/create-token-with-pool.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | - | Solana RPC endpoint |
| `PRIVATE_KEY` | Yes | - | Your wallet private key |
| `TOKEN_NAME` | No | "TestDAOToken" | Token name |
| `TOKEN_SYMBOL` | No | "TDAO" | Token symbol |
| `TOKEN_DECIMALS` | No | 6 | Number of decimals |
| `TOTAL_SUPPLY` | No | 1000000 | Total supply |
| `SOL_AMOUNT` | No | 0.1 | SOL for pool liquidity |
| `TOKEN_PERCENT` | No | 10 | % of tokens for pool |
| `FEE_BPS` | No | 25 | Pool fee in bps |
| `SKIP_METADATA` | No | false | Skip metadata creation |

**Output:**
```
TOKEN_MINT=<mint-address>
POOL_ADDRESS=<pool-address>
```

---

### 4. test-dao-parent.ts

Creates a parent DAO via the API.

**Usage:**
```bash
API_URL=https://api.zcombinator.io \
  DAO_NAME="MyDAO" \
  TOKEN_MINT="<token-mint>" \
  POOL_ADDRESS="<pool-address>" \
  pnpm tsx scripts/test-dao-parent.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_URL` | Yes | - | https://api.zcombinator.io |
| `PRIVATE_KEY` | Yes | - | Your wallet private key |
| `DAO_NAME` | Yes | - | DAO name (max 32 chars) |
| `TOKEN_MINT` | Yes | - | Governance token mint |
| `POOL_ADDRESS` | Yes | - | Meteora DAMM pool address |
| `TREASURY_COSIGNER` | No | Your wallet | Treasury co-signer |

**Output:**
```
DAO_PDA=<dao-pda>
MODERATOR_PDA=<moderator-pda>
ADMIN_WALLET=<admin-wallet>
TREASURY_MULTISIG=<treasury-multisig>
MINT_AUTH_MULTISIG=<mint-auth-multisig>
```

---

### 5. test-dao-child.ts

Creates a child DAO under an existing parent DAO.

**Usage:**
```bash
API_URL=https://api.zcombinator.io \
  CHILD_DAO_NAME="MyChildDAO" \
  PARENT_PDA="<parent-dao-pda>" \
  TOKEN_MINT="<child-token-mint>" \
  pnpm tsx scripts/test-dao-child.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_URL` | Yes | - | https://api.zcombinator.io |
| `PRIVATE_KEY` | Yes | - | Parent DAO owner's private key |
| `CHILD_DAO_NAME` | Yes | - | Child DAO name (max 32 chars) |
| `PARENT_PDA` | Yes | - | Parent DAO PDA address |
| `TOKEN_MINT` | Yes | - | Child DAO's governance token |
| `TREASURY_COSIGNER` | No | Your wallet | Treasury co-signer |

**Note:** Child DAOs share the parent's liquidity pool and moderator. No LP transfer needed.

**Output:**
```
DAO_PDA=<child-dao-pda>
ADMIN_WALLET=<admin-wallet>
MINT_AUTH_MULTISIG=<mint-auth-multisig>
```

---

### 6. transfer-mint-authority.ts

Transfers token mint authority to the DAO's mint authority multisig.

**Usage:**
```bash
TOKEN_MINT="<token-mint>" \
  NEW_AUTHORITY="<mint-auth-multisig-from-dao-creation>" \
  pnpm tsx scripts/transfer-mint-authority.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | - | Solana RPC endpoint |
| `PRIVATE_KEY` | Yes | - | Current mint authority (your wallet) |
| `TOKEN_MINT` | Yes | - | Token mint address |
| `NEW_AUTHORITY` | Yes | - | The `MINT_AUTH_MULTISIG` from DAO creation |

**CRITICAL:** Use the EXACT `MINT_AUTH_MULTISIG` address returned from DAO creation. Do NOT derive or modify this address.

---

### 7. e2e-transfer-lp.ts

Transfers your LP position NFT to the DAO admin wallet.

**Usage:**
```bash
POOL_ADDRESS="<pool-address>" \
  ADMIN_WALLET="<admin-wallet-from-dao-creation>" \
  pnpm tsx scripts/e2e-transfer-lp.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | - | Solana RPC endpoint |
| `PRIVATE_KEY` | Yes | - | Current LP owner (your wallet) |
| `POOL_ADDRESS` | Yes | - | DAMM pool address |
| `ADMIN_WALLET` | Yes | - | The `ADMIN_WALLET` from DAO creation |

---

### 8. fund-admin-wallet.ts

Funds the DAO admin wallet with SOL for transaction fees. The admin wallet is used to sign proposal creation and liquidity operations.

**Usage:**
```bash
ADMIN_WALLET="<admin-wallet-from-dao-creation>" \
  pnpm tsx scripts/fund-admin-wallet.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | - | Solana RPC endpoint |
| `PRIVATE_KEY` | Yes | - | Your wallet (source of funds) |
| `ADMIN_WALLET` | Yes | - | The `ADMIN_WALLET` from DAO creation |
| `SOL_AMOUNT` | No | 0.2 | Amount of SOL to transfer |

**Note:** Minimum required balance is 0.1 SOL. Recommended: 0.2 SOL.

---

### 9. fetch-dao-info.ts

Fetches DAO information from the API. Use this to retrieve `ADMIN_WALLET`, `MINT_AUTH_MULTISIG`, and other values needed for subsequent operations.

**Usage:**
```bash
API_URL=https://api.zcombinator.io DAO_PDA="<dao-pda>" \
  pnpm tsx scripts/fetch-dao-info.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_URL` | Yes | - | https://api.zcombinator.io |
| `DAO_PDA` | Yes | - | DAO PDA address |

**Output:** Displays DAO details and outputs key values for use in other scripts.

---

### 10. check-moderator.ts

Checks on-chain moderator state including proposal counter.

**Usage:**
```bash
MODERATOR_PDA="<moderator-pda>" pnpm tsx scripts/check-moderator.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | - | Solana RPC endpoint |
| `PRIVATE_KEY` | Yes | - | Any valid private key |
| `MODERATOR_PDA` | Yes | - | Moderator PDA from DAO creation |

---

### 11. check-lp-positions.ts

Checks LP positions for a wallet in a pool.

**Usage:**
```bash
POOL_ADDRESS="<pool-address>" ADMIN_WALLET="<admin-wallet>" \
  pnpm tsx scripts/check-lp-positions.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | - | Solana RPC endpoint |
| `POOL_ADDRESS` | Yes | - | DAMM pool address |
| `ADMIN_WALLET` | Yes | - | Wallet to check |

---

## End-to-End Flows

### Flow 1: Parent DAO Creation

Complete setup for a new parent DAO with governance token and liquidity pool.

```bash
# 1. Create token + pool
TOKEN_NAME="MyDAO" TOKEN_SYMBOL="MYDAO" SOL_AMOUNT=1 TOKEN_PERCENT=10 SKIP_METADATA=true \
  pnpm tsx scripts/create-token-with-pool.ts
# Save: TOKEN_MINT, POOL_ADDRESS

# 2. Create parent DAO
API_URL=https://api.zcombinator.io \
  DAO_NAME="MyDAO" \
  TOKEN_MINT="<from-step-1>" \
  POOL_ADDRESS="<from-step-1>" \
  pnpm tsx scripts/test-dao-parent.ts
# Save: DAO_PDA, ADMIN_WALLET, MINT_AUTH_MULTISIG

# 3. Transfer mint authority
TOKEN_MINT="<from-step-1>" \
  NEW_AUTHORITY="<MINT_AUTH_MULTISIG from step-2>" \
  pnpm tsx scripts/transfer-mint-authority.ts

# 4. Transfer LP position to admin wallet
POOL_ADDRESS="<from-step-1>" \
  ADMIN_WALLET="<from-step-2>" \
  pnpm tsx scripts/e2e-transfer-lp.ts

# 5. Fund admin wallet
ADMIN_WALLET="<from-step-2>" \
  pnpm tsx scripts/fund-admin-wallet.ts

# 6. Verify setup
API_URL=https://api.zcombinator.io DAO_PDA="<from-step-2>" \
  pnpm tsx scripts/fetch-dao-info.ts
```

**DAO is now ready for proposals.**

---

### Flow 2: Child DAO Creation

Create a child DAO under an existing parent. Child DAOs share the parent's liquidity pool.

```bash
# Prerequisites: Parent DAO must be fully set up (Flow 1 complete)

# 1. Create token for child DAO
TOKEN_NAME="ChildDAO" TOKEN_SYMBOL="CHILD" SKIP_METADATA=true \
  pnpm tsx scripts/create-token.ts
# Save: TOKEN_MINT

# 2. Create child DAO
API_URL=https://api.zcombinator.io \
  CHILD_DAO_NAME="MyChildDAO" \
  PARENT_PDA="<parent-dao-pda>" \
  TOKEN_MINT="<from-step-1>" \
  pnpm tsx scripts/test-dao-child.ts
# Save: DAO_PDA, MINT_AUTH_MULTISIG

# 3. Transfer mint authority for child token
TOKEN_MINT="<from-step-1>" \
  NEW_AUTHORITY="<MINT_AUTH_MULTISIG from step-2>" \
  pnpm tsx scripts/transfer-mint-authority.ts

# 4. Verify setup
API_URL=https://api.zcombinator.io DAO_PDA="<from-step-2>" \
  pnpm tsx scripts/fetch-dao-info.ts
```

**Notes:**
- Child DAOs use the parent's LP, so no LP transfer needed
- Child DAOs use the parent's admin wallet for liquidity operations
- Parent admin wallet must be funded (done in Flow 1)

---

### Flow 3: Parent DAO Proposal (Create + Finalize)

Create and finalize a proposal on a parent DAO.

```bash
# Prerequisites: Parent DAO fully set up (Flow 1 complete)

# 1. Create proposal via API
curl -X POST https://api.zcombinator.io/dao/proposal \
  -H "Content-Type: application/json" \
  -d '{
    "dao_pda": "<dao-pda>",
    "title": "My Proposal",
    "description": "Description of the proposal",
    "options": ["Approve", "Reject"],
    "length_secs": 86400,
    "wallet": "<your-wallet-pubkey>",
    "signed_hash": "<signature>"
  }'
# Save: proposal_pda

# 2. Wait for proposal to end
# Warmup period: 60 seconds
# Proposal duration: length_secs (e.g., 86400 = 24 hours)
# Total wait: 60 + length_secs + buffer

# 3. Finalize proposal
curl -X POST https://api.zcombinator.io/dao/finalize-proposal \
  -H "Content-Type: application/json" \
  -d '{"proposal_pda": "<proposal-pda>"}'

# 4. Redeem liquidity
curl -X POST https://api.zcombinator.io/dao/redeem-liquidity \
  -H "Content-Type: application/json" \
  -d '{"proposal_pda": "<proposal-pda>"}'

# 5. Deposit back to pool
curl -X POST https://api.zcombinator.io/dao/deposit-back \
  -H "Content-Type: application/json" \
  -d '{"proposal_pda": "<proposal-pda>"}'

# 6. Verify LP restored
POOL_ADDRESS="<pool-address>" ADMIN_WALLET="<admin-wallet>" \
  pnpm tsx scripts/check-lp-positions.ts
```

**Notes:**
- Proposal creation requires a signed request (wallet + signed_hash)
- Use `test-dao-parent.ts` signing logic as reference for generating signed_hash
- Only one active proposal per moderator at a time

---

### Flow 4: Child DAO Proposal (Create + Finalize)

Create and finalize a proposal on a child DAO. Uses the parent's liquidity pool.

```bash
# Prerequisites:
# - Parent DAO fully set up (Flow 1 complete)
# - Child DAO created (Flow 2 complete)

# 1. Create proposal via API (same as parent, but with child DAO PDA)
curl -X POST https://api.zcombinator.io/dao/proposal \
  -H "Content-Type: application/json" \
  -d '{
    "dao_pda": "<child-dao-pda>",
    "title": "Child DAO Proposal",
    "description": "Description of the proposal",
    "options": ["Yes", "No"],
    "length_secs": 86400,
    "wallet": "<your-wallet-pubkey>",
    "signed_hash": "<signature>"
  }'
# Save: proposal_pda

# 2. Wait for proposal to end (same timing as parent)

# 3-5. Finalize, redeem, deposit-back (same as Flow 3)
curl -X POST https://api.zcombinator.io/dao/finalize-proposal \
  -H "Content-Type: application/json" \
  -d '{"proposal_pda": "<proposal-pda>"}'

curl -X POST https://api.zcombinator.io/dao/redeem-liquidity \
  -H "Content-Type: application/json" \
  -d '{"proposal_pda": "<proposal-pda>"}'

curl -X POST https://api.zcombinator.io/dao/deposit-back \
  -H "Content-Type: application/json" \
  -d '{"proposal_pda": "<proposal-pda>"}'

# 6. Verify LP restored (use PARENT's admin wallet and pool)
POOL_ADDRESS="<parent-pool-address>" ADMIN_WALLET="<parent-admin-wallet>" \
  pnpm tsx scripts/check-lp-positions.ts
```

**Key Differences from Parent DAO Proposals:**
- Uses child DAO PDA for proposal creation
- Liquidity operations use parent's pool and admin wallet
- Parent and child share the same moderator (only one active proposal across both)
