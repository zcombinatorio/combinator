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

Creates a new SPL token with configurable metadata. Supports both standard SPL Token and Token-2022.

**Usage:**
```bash
TOKEN_NAME="MyToken" TOKEN_SYMBOL="MTK" SKIP_METADATA=true \
  pnpm tsx scripts/create-token.ts
```

**Token-2022:**
```bash
USE_TOKEN_2022=true TOKEN_NAME="MyToken22" TOKEN_SYMBOL="MT22" \
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
| `USE_TOKEN_2022` | No | false | Create Token-2022 token instead of SPL Token |
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
| `FEE_BPS` | No | 100 | Pool fee in basis points (100 = 1%) |

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
| `FEE_BPS` | No | 100 | Pool fee in bps |
| `SKIP_METADATA` | No | false | Skip metadata creation |

**Output:**
```
TOKEN_MINT=<mint-address>
POOL_ADDRESS=<pool-address>
```

---

### 3b. create-dlmm-pool.ts

Creates a Meteora DLMM (Dynamic Liquidity Market Maker) pool for an existing token.
DLMM uses concentrated liquidity with discrete price bins and USDC as the quote token.

**Usage:**
```bash
TOKEN_MINT="<mint-address>" USDC_AMOUNT=100 TOKEN_PERCENT=10 BIN_STEP=25 \
  pnpm tsx scripts/create-dlmm-pool.ts
```

**Prerequisites:**
- Payer wallet must have USDC for pool liquidity

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | - | Solana RPC endpoint |
| `PRIVATE_KEY` | Yes | - | Your wallet private key |
| `TOKEN_MINT` | Yes | - | Token mint address |
| `USDC_AMOUNT` | No | 100 | USDC to provide as liquidity |
| `TOKEN_PERCENT` | No | 10 | Percentage of token balance to use |
| `TOKEN_AMOUNT` | No | - | Exact token amount (overrides TOKEN_PERCENT) |
| `BIN_STEP` | No | 25 | Price bin step (1-400, affects price granularity) |
| `FEE_BPS` | No | 100 | Pool fee in basis points (100 = 1%) |

**Output:**
```
POOL_ADDRESS=<pool-address>
POSITION=<position-address>
```

---

### 3c. create-token-with-dlmm-pool.ts

Convenience script that creates a token AND a DLMM pool (TOKEN/USDC) in one operation.
Supports both SPL Token and Token-2022 as the base token.

**Usage:**
```bash
TOKEN_NAME="MyDAO" TOKEN_SYMBOL="MYDAO" USDC_AMOUNT=100 TOKEN_PERCENT=10 BIN_STEP=25 \
  pnpm tsx scripts/create-token-with-dlmm-pool.ts
```

**With Token-2022:**
```bash
USE_TOKEN_2022=true TOKEN_NAME="MyDAO22" USDC_AMOUNT=100 \
  pnpm tsx scripts/create-token-with-dlmm-pool.ts
```

**Prerequisites:**
- Payer wallet must have USDC for pool liquidity

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | - | Solana RPC endpoint |
| `PRIVATE_KEY` | Yes | - | Your wallet private key |
| `TOKEN_NAME` | No | "TestDAOToken" | Token name |
| `TOKEN_SYMBOL` | No | "TDAO" | Token symbol |
| `TOKEN_DECIMALS` | No | 6 | Number of decimals |
| `TOTAL_SUPPLY` | No | 1000000 | Total supply |
| `USE_TOKEN_2022` | No | false | Create Token-2022 token |
| `USDC_AMOUNT` | No | 100 | USDC for pool liquidity |
| `TOKEN_PERCENT` | No | 10 | % of tokens for pool |
| `BIN_STEP` | No | 25 | Price bin step (1-400) |
| `FEE_BPS` | No | 100 | Pool fee in bps |

**Output:**
```
TOKEN_MINT=<mint-address>
POOL_ADDRESS=<pool-address>
POSITION=<position-address>
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
TREASURY_VAULT=<treasury-vault>
MINT_VAULT=<mint-vault>
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
MINT_VAULT=<mint-vault>
```

---

### 6. transfer-mint-authority.ts

Transfers token mint authority to the DAO's mint vault.

**Usage:**
```bash
TOKEN_MINT="<token-mint>" \
  NEW_AUTHORITY="<mint-vault-from-dao-creation>" \
  pnpm tsx scripts/transfer-mint-authority.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | - | Solana RPC endpoint |
| `PRIVATE_KEY` | Yes | - | Current mint authority (your wallet) |
| `TOKEN_MINT` | Yes | - | Token mint address |
| `NEW_AUTHORITY` | Yes | - | The `MINT_VAULT` from DAO creation |

**CRITICAL:** Use the EXACT `MINT_VAULT` address returned from DAO creation. Do NOT derive or modify this address.

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

Fetches DAO information from the API. Use this to retrieve `ADMIN_WALLET`, `MINT_VAULT`, and other values needed for subsequent operations.

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

Checks LP positions for a wallet in a DAMM pool.

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

### 11b. check-dlmm-lp-positions.ts

Checks LP positions for a wallet in a DLMM pool.

**Usage:**
```bash
POOL_ADDRESS="<dlmm-pool-address>" ADMIN_WALLET="<admin-wallet>" \
  pnpm tsx scripts/check-dlmm-lp-positions.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | - | Solana RPC endpoint |
| `POOL_ADDRESS` | Yes | - | DLMM pool address |
| `ADMIN_WALLET` | Yes | - | Wallet to check |

---

### 11c. e2e-transfer-dlmm-lp.ts

Transfers LP liquidity from your wallet to the DAO admin wallet (DLMM version).

Unlike DAMM (which uses NFTs), DLMM positions cannot be directly transferred.
This script withdraws liquidity and transfers the tokens to the admin wallet.

**Usage:**
```bash
POOL_ADDRESS="<dlmm-pool-address>" ADMIN_WALLET="<admin-wallet>" \
  pnpm tsx scripts/e2e-transfer-dlmm-lp.ts
```

**Environment Variables:**
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | - | Solana RPC endpoint |
| `PRIVATE_KEY` | Yes | - | Current LP owner (your wallet) |
| `POOL_ADDRESS` | Yes | - | DLMM pool address |
| `ADMIN_WALLET` | Yes | - | The `ADMIN_WALLET` from DAO creation |

**Note:** After running this script, the admin wallet holds the tokens. A new DLMM
position will be created automatically when the first proposal is created.

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
# Save: DAO_PDA, ADMIN_WALLET, MINT_VAULT

# 3. Transfer mint authority
TOKEN_MINT="<from-step-1>" \
  NEW_AUTHORITY="<MINT_VAULT from step-2>" \
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
# Save: DAO_PDA, MINT_VAULT

# 3. Transfer mint authority for child token
TOKEN_MINT="<from-step-1>" \
  NEW_AUTHORITY="<MINT_VAULT from step-2>" \
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
    "options": ["Approve", "Reject", "Abstain"],
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
- Proposals support 2-6 options
- Only one pending (non-expired) proposal per moderator at a time

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
    "options": ["Yes", "No", "Abstain"],
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
- Parent and child share the same moderator (only one pending proposal across both)

---

### Flow 5: Parent DAO Creation (DLMM Pool with USDC)

Complete setup for a new parent DAO using a DLMM pool (TOKEN/USDC) instead of DAMM.
The API auto-detects the pool type, so most steps are identical.
Supports both SPL Token and Token-2022 as the base token.

**Prerequisites:**
- Payer wallet must have USDC for pool liquidity (default 100 USDC)
- Payer wallet must have SOL for transaction fees

```bash
# 1. Create token + DLMM pool (TOKEN/USDC)
# NOTE: Payer must have USDC in their wallet
TOKEN_NAME="MyDAO" TOKEN_SYMBOL="MYDAO" USDC_AMOUNT=100 TOKEN_PERCENT=10 BIN_STEP=25 \
  pnpm tsx scripts/create-token-with-dlmm-pool.ts
# Save: TOKEN_MINT, POOL_ADDRESS (pool field), POSITION

# For Token-2022 base token, add USE_TOKEN_2022=true:
# USE_TOKEN_2022=true TOKEN_NAME="MyDAO22" USDC_AMOUNT=100 BIN_STEP=25 \
#   pnpm tsx scripts/create-token-with-dlmm-pool.ts

# 2. Create parent DAO (pool_type will be auto-detected as 'dlmm')
API_URL=https://api.zcombinator.io \
  DAO_NAME="MyDAO" \
  TOKEN_MINT="<from-step-1>" \
  POOL_ADDRESS="<pool from step-1>" \
  pnpm tsx scripts/test-dao-parent.ts
# Save: DAO_PDA, ADMIN_WALLET, MINT_VAULT

# 3. Transfer mint authority (same as DAMM)
TOKEN_MINT="<from-step-1>" \
  NEW_AUTHORITY="<MINT_VAULT from step-2>" \
  pnpm tsx scripts/transfer-mint-authority.ts

# 4. Transfer LP liquidity to admin wallet (DLMM version)
# NOTE: DLMM positions can't be directly transferred like DAMM NFTs.
# This script withdraws liquidity and transfers tokens + USDC to admin.
POOL_ADDRESS="<pool from step-1>" \
  ADMIN_WALLET="<from-step-2>" \
  pnpm tsx scripts/e2e-transfer-dlmm-lp.ts

# 5. Fund admin wallet (may need more SOL for DLMM position creation)
ADMIN_WALLET="<from-step-2>" SOL_AMOUNT=0.3 \
  pnpm tsx scripts/fund-admin-wallet.ts

# 6. Verify setup
API_URL=https://api.zcombinator.io DAO_PDA="<from-step-2>" \
  pnpm tsx scripts/fetch-dao-info.ts

# 7. Verify DLMM LP state
POOL_ADDRESS="<pool from step-1>" ADMIN_WALLET="<from-step-2>" \
  pnpm tsx scripts/check-dlmm-lp-positions.ts
```

**DAO is now ready for proposals.**

**Key Differences from DAMM Flow:**
- DLMM uses USDC as quote token (DAMM uses SOL)
- Use `create-token-with-dlmm-pool.ts` instead of `create-token-with-pool.ts`
- Use `e2e-transfer-dlmm-lp.ts` instead of `e2e-transfer-lp.ts`
- Use `check-dlmm-lp-positions.ts` to verify LP state
- DLMM may require more SOL for admin wallet (position creation costs)
- BIN_STEP parameter controls price granularity (1-400, default 25)

---

## Pool Type Reference

The API supports two types of Meteora liquidity pools:

### DAMM (Dynamic AMM / CP-AMM)
- Traditional AMM with virtual price curve
- Uses SOL as quote token (TOKEN/SOL pairs)
- LP positions are represented as NFTs
- Positions can be directly transferred
- Lower transaction costs
- Scripts: `create-damm-pool.ts`, `check-lp-positions.ts`, `e2e-transfer-lp.ts`

### DLMM (Dynamic Liquidity Market Maker)
- Concentrated liquidity with discrete price bins
- Uses USDC as quote token (TOKEN/USDC pairs)
- LP positions are account-based (not NFTs)
- Positions cannot be directly transferred (use withdraw + deposit)
- More capital efficient but higher complexity
- BIN_STEP parameter (1-400) controls price granularity
- USDC Mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **Supports Token-2022 base tokens** (use `USE_TOKEN_2022=true`)
- Scripts: `create-dlmm-pool.ts`, `check-dlmm-lp-positions.ts`, `e2e-transfer-dlmm-lp.ts`

The pool type is **auto-detected** when creating a DAO - just provide any valid
Meteora pool address and the API will determine whether it's DAMM or DLMM.
The token program (SPL Token vs Token-2022) is also auto-detected.
