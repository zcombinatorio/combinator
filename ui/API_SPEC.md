# Combinator API Specification

## Overview

The Combinator API enables programmatic creation and management of DAOs on Solana.

**Capabilities:**
- Create parent and child DAOs
- Create decision markets
- Query DAOs and proposals (for client indexing)

After authenticating the request, the backend handles all on-chain operations.

---

## Authentication

All mutating operations require a `signed_hash` parameter for authentication and payload integrity.

### How It Works

1. Client builds the request body (without `signed_hash`)
2. Client computes `SHA-256(JSON.stringify(body))`
3. Client signs the hash with their Solana wallet
4. Client includes the signature as `signed_hash` in the request

### Server Validation

1. Server extracts `signed_hash` and `wallet` from body
2. Server computes `SHA-256(JSON.stringify(bodyWithoutSignedHash))`
3. Server verifies `signed_hash` was signed by `wallet`
4. If valid, authenticates the request as `wallet`

### Example

```typescript
import { sha256 } from "@noble/hashes/sha256";
import bs58 from "bs58";

// 1. Build request body (without signed_hash)
const body = {
  wallet: wallet.publicKey.toBase58(),
  name: "MyDAO",
  token_mint: "So11111111111111111111111111111111111111112",
  treasury_cosigner: wallet.publicKey.toBase58(),
  pool_address: "7jbhVZcYqCRmciBcZzK8L5B96Pyw7i1SpXQFKBkzD3G2",
};

// 2. Hash the stringified body
const hash = sha256(JSON.stringify(body));

// 3. Sign the hash with wallet
const signature = await wallet.signMessage(hash);

// 4. Add signed_hash to request
const request = {
  ...body,
  signed_hash: bs58.encode(signature),
};

// 5. POST to API
const response = await fetch("https://api.zcombinator.io/dao/parent", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(request),
});
```

---

## Base URL

```
https://api.zcombinator.io
```

---

## Endpoints

### 1. GET /dao

Lists all DAOs registered with this API. Used by clients to index supported DAOs.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | `string` | No | Filter by `"parent"` or `"child"` |
| `owner` | `string` | No | Filter by owner wallet address |
| `limit` | `number` | No | Max results to return |
| `offset` | `number` | No | Pagination offset |

**Response:**

```json
{
  "daos": [
    {
      "id": 1,
      "dao_pda": "DaoPdaAddress...",
      "dao_name": "MyDAO",
      "moderator_pda": "ModeratorPdaAddress...",
      "owner_wallet": "OwnerWalletAddress...",
      "admin_wallet": "AdminWalletAddress...",
      "token_mint": "TokenMintAddress...",
      "pool_address": "PoolAddress...",
      "pool_type": "damm",
      "quote_mint": "QuoteMintAddress...",
      "treasury_multisig": "TreasuryMultisigAddress...",
      "mint_auth_multisig": "MintMultisigAddress...",
      "treasury_cosigner": "CosignerAddress...",
      "dao_type": "parent",
      "created_at": "2025-01-01T00:00:00.000Z",
      "stats": {
        "proposerCount": 2,
        "proposalCount": 5,
        "activeProposalCount": 1,
        "childDaoCount": 3
      }
    }
  ]
}
```

---

### 2. GET /dao/:daoPda

Gets detailed information about a specific DAO.

**Response:**

```json
{
  "id": 1,
  "dao_pda": "DaoPdaAddress...",
  "dao_name": "MyDAO",
  "moderator_pda": "ModeratorPdaAddress...",
  "owner_wallet": "OwnerWalletAddress...",
  "admin_wallet": "AdminWalletAddress...",
  "token_mint": "TokenMintAddress...",
  "pool_address": "PoolAddress...",
  "pool_type": "damm",
  "quote_mint": "QuoteMintAddress...",
  "treasury_multisig": "TreasuryMultisigAddress...",
  "mint_auth_multisig": "MintMultisigAddress...",
  "treasury_cosigner": "CosignerAddress...",
  "dao_type": "parent",
  "created_at": "2025-01-01T00:00:00.000Z",
  "stats": { ... },
  "proposers": [ ... ],
  "proposals": [ ... ],
  "children": [ ... ]
}
```

---

### 3. GET /dao/:daoPda/proposers

Lists authorized proposers for a DAO.

**Response:**

```json
{
  "owner": "OwnerWalletAddress...",
  "proposers": [
    {
      "id": 1,
      "dao_id": 1,
      "proposer_wallet": "ProposerWalletAddress...",
      "added_by": "OwnerWalletAddress...",
      "created_at": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 4. POST /dao/parent

Creates a new parent DAO with its own liquidity pool, treasury, and mint authority.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wallet` | `string` | Yes | Signer wallet (used for authentication) |
| `name` | `string` | Yes | DAO name (max 32 chars, used for PDA derivation) |
| `token_mint` | `string` | Yes | The SPL token mint for this DAO |
| `treasury_cosigner` | `string` | Yes | Client wallet that co-signs treasury transactions |
| `pool_address` | `string` | Yes | Meteora DAMM/DLMM pool address for liquidity |
| `signed_hash` | `string` | Yes | Base58-encoded signature of SHA-256 hash of body |

**Note:** `pool_type` and `quote_mint` are automatically derived from `pool_address`. The server validates that `token_mint` exists in the pool and determines the quote mint from the other token in the pair.

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `dao_pda` | `string` | The DAO's on-chain address |
| `moderator_pda` | `string` | The moderator account for proposals |
| `treasury_multisig` | `string` | 2-of-3 treasury multisig (you + 2 platform keys) |
| `mint_multisig` | `string` | 2-of-2 mint authority multisig |
| `admin_wallet` | `string` | Wallet that manages the DAO and spot pool liquidity |
| `pool_type` | `string` | Derived pool type: `"damm"` or `"dlmm"` |
| `quote_mint` | `string` | Derived quote token mint |
| `transaction` | `string` | Transaction signature |

**Important:** The `admin_wallet` is generated internally and manages the DAO and spot pool liquidity. After creating a parent DAO, you must transfer LP tokens for your pool to the `admin_wallet` so that conditional markets can be created when proposals are submitted.

**Example:**

```bash
curl -X POST https://api.zcombinator.io/dao/parent \
  -H "Content-Type: application/json" \
  -d '{
    "wallet": "YourWalletAddress...",
    "name": "MyDAO",
    "token_mint": "TokenMintAddress...",
    "treasury_cosigner": "YourWalletAddress...",
    "pool_address": "PoolAddress...",
    "signed_hash": "SignatureBase58..."
  }'
```

**Response:**

```json
{
  "dao_pda": "DaoPdaAddress...",
  "moderator_pda": "ModeratorPdaAddress...",
  "treasury_multisig": "TreasuryMultisigAddress...",
  "mint_multisig": "MintMultisigAddress...",
  "admin_wallet": "AdminWalletAddress...",
  "pool_type": "damm",
  "quote_mint": "So11111111111111111111111111111111111111112",
  "transaction": "TxSignature..."
}
```

---

### 5. POST /dao/child

Creates a child DAO under an existing parent. Child DAOs share the parent's liquidity pool but have their own treasury.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wallet` | `string` | Yes | Signer wallet (must be the parent DAO creator) |
| `name` | `string` | Yes | Child DAO name (max 32 chars, used for PDA derivation) |
| `parent_pda` | `string` | Yes | The parent DAO's on-chain address |
| `treasury_cosigner` | `string` | Yes | Client wallet that co-signs treasury transactions |
| `signed_hash` | `string` | Yes | Base58-encoded signature of SHA-256 hash of body |

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `dao_pda` | `string` | The child DAO's on-chain address |
| `parent_dao_pda` | `string` | The parent DAO's address |
| `treasury_multisig` | `string` | 2-of-3 treasury multisig (you + 2 platform keys) |
| `mint_multisig` | `string` | 2-of-2 mint authority multisig |
| `admin_wallet` | `string` | Wallet that manages the child DAO |
| `transaction` | `string` | Transaction signature |

**Constraints:**

- Parent must be a valid parent DAO (not a child)
- `wallet` must be the same wallet that created the parent DAO
- Child inherits parent's pool for liquidity

---

### 6. POST /dao/proposal

Creates a decision market for a DAO. This withdraws liquidity from the DAO's pool, mints conditional tokens for each option, and seeds AMM pools. The winning option is determined by TWAP after the market closes.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wallet` | `string` | Yes | Signer wallet (must be DAO owner or whitelisted proposer) |
| `dao_pda` | `string` | Yes | The DAO creating the proposal |
| `title` | `string` | Yes | Proposal title (max 128 chars) |
| `description` | `string` | Yes | Proposal description (max 1024 chars) |
| `length_secs` | `number` | Yes | Voting duration in seconds |
| `options` | `string[]` | Yes | 2-6 outcome options (e.g., `["Yes", "No"]`) |
| `signed_hash` | `string` | Yes | Base58-encoded signature of SHA-256 hash of body |

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `proposal_pda` | `string` | The proposal's on-chain address |
| `proposal_id` | `number` | The proposal ID within the moderator |
| `status` | `string` | Initial proposal status (`"pending"`) |

**Constraints:**

- `wallet` must be the DAO owner (proposer whitelist management coming soon)
- Only one active decision market per parent DAO at a time (includes markets from child DAOs)
- For child DAOs: liquidity is withdrawn from the parent's pool

---

## Lifecycle

### Parent DAO Creation

```
1. Client builds request body with name, token_mint, pool_address, treasury_cosigner
2. Client signs SHA-256 hash of body
3. Client calls POST /dao/parent
4. Backend authenticates via signature
5. Backend derives pool_type and quote_mint from pool_address
6. Backend generates admin wallet internally and funds it
7. Backend creates DAO account, moderator, and multisigs on-chain
8. Client receives dao_pda, moderator_pda, admin_wallet, treasury_multisig, mint_multisig, pool_type, quote_mint
9. Client transfers LP tokens to admin_wallet for conditional market creation
10. Client transfers treasury funds to treasury_multisig
11. Client transfers mint authority to mint_multisig
```

**Note:** The wallet that creates the DAO is automatically authorized to create decision markets.

### Child DAO Creation

```
1. Client builds request body with name and parent_pda
2. Client signs SHA-256 hash of body
3. Client calls POST /dao/child
4. Backend validates parent exists and caller is authorized
5. Backend generates admin wallet internally and funds it
6. Backend creates child DAO on-chain, linked to parent
7. Child DAO can now create proposals using parent's liquidity
```

### Decision Market Flow

```
1. DAO owner builds request body with market details
2. Owner signs SHA-256 hash of body
3. Owner calls POST /dao/proposal
4. Backend checks authorization and one-active-market constraint
5. Backend withdraws liquidity from pool (parent's pool if child DAO)
6. Backend creates conditional token vaults and AMM pools for each option
7. Market is live for length_secs duration
8. After duration: final TWAP crank, winning option determined by highest TWAP
9. Liquidity returned to pool
10. Resolved tokens can be claimed on the Combinator UI
```

---

## Multisig Configuration

### Treasury (2-of-3)

| Member | Key | Role |
|--------|-----|------|
| 1 | Futarchy Key A | Futarchy governed |
| 2 | Futarchy Key B | Futarchy governed |
| 3 | `treasury_cosigner` | Your wallet |

Any 2 of 3 signatures required to move treasury funds. 2 of the 3 keys are futarchy governed.

### Mint Authority (2-of-2)

| Member | Key | Role |
|--------|-----|------|
| 1 | Futarchy Mint Key A | Futarchy governed |
| 2 | Futarchy Mint Key B | Futarchy governed |

Both signatures required to mint new tokens. Both keys are futarchy governed.

---

## Usage Examples

### Setup

```typescript
import { Keypair } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import nacl from "tweetnacl";
import bs58 from "bs58";

// Load keypair from file or environment
const secretKey = bs58.decode(process.env.WALLET_PRIVATE_KEY!);
const keypair = Keypair.fromSecretKey(secretKey);
```

### Helper Function

```typescript
async function signedRequest<T>(
  endpoint: string,
  body: Record<string, any>,
  keypair: Keypair
): Promise<T> {
  // 1. Add wallet to body
  const bodyWithWallet = {
    wallet: keypair.publicKey.toBase58(),
    ...body,
  };

  // 2. Hash the stringified body
  const hash = sha256(JSON.stringify(bodyWithWallet));

  // 3. Sign the hash
  const signature = nacl.sign.detached(hash, keypair.secretKey);

  // 4. Build final request with signed_hash
  const request = {
    ...bodyWithWallet,
    signed_hash: bs58.encode(signature),
  };

  // 5. POST to API
  const response = await fetch(`https://api.zcombinator.io${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}
```

### Create Parent DAO

```typescript
const dao = await signedRequest<DaoResponse>("/dao/parent", {
  name: "MyDAO",
  token_mint: "YourTokenMintAddress...",
  treasury_cosigner: keypair.publicKey.toBase58(),
  pool_address: "YourPoolAddress...",
}, keypair);

console.log("DAO created:", dao.dao_pda);
console.log("Moderator:", dao.moderator_pda);
console.log("Pool type (derived):", dao.pool_type);
console.log("Quote mint (derived):", dao.quote_mint);
console.log("Transfer LP to:", dao.admin_wallet);
console.log("Transfer treasury to:", dao.treasury_multisig);
console.log("Transfer mint authority to:", dao.mint_multisig);
```

### Create Child DAO

```typescript
const childDao = await signedRequest<ChildDaoResponse>("/dao/child", {
  name: "MyChildDAO",
  parent_pda: "ParentDaoPdaAddress...",
  treasury_cosigner: keypair.publicKey.toBase58(),
}, keypair); // keypair must be the parent DAO creator

console.log("Child DAO created:", childDao.dao_pda);
```

### Create Decision Market

```typescript
const proposal = await signedRequest<ProposalResponse>("/dao/proposal", {
  dao_pda: "DaoPdaAddress...",
  title: "Should we expand to new markets?",
  description: "Proposal to allocate treasury funds for market expansion.",
  length_secs: 86400, // 24 hours
  options: ["Yes", "No"],
}, keypair); // keypair must be the DAO owner

console.log("Decision market created:", proposal.proposal_pda);
```

---

## TypeScript Types

### Request Types

```typescript
interface CreateParentDaoRequest {
  wallet: string;
  name: string;
  token_mint: string;
  treasury_cosigner: string;
  pool_address: string;
  signed_hash: string;
}

interface CreateChildDaoRequest {
  wallet: string;           // Must be the parent DAO creator
  name: string;
  parent_pda: string;
  treasury_cosigner: string;
  signed_hash: string;
}

interface CreateProposalRequest {
  wallet: string;
  dao_pda: string;
  title: string;
  description: string;
  length_secs: number;
  options: string[];
  signed_hash: string;
}
```

### Response Types

```typescript
interface DaoResponse {
  dao_pda: string;
  moderator_pda: string;
  treasury_multisig: string;
  mint_multisig: string;
  admin_wallet: string;
  pool_type: "damm" | "dlmm";
  quote_mint: string;
  transaction: string;
}

interface ChildDaoResponse {
  dao_pda: string;
  parent_dao_pda: string;
  treasury_multisig: string;
  mint_multisig: string;
  admin_wallet: string;
  transaction: string;
}

interface ProposalResponse {
  proposal_pda: string;
  proposal_id: number;
  status: "pending";
}

interface DaoListResponse {
  daos: DaoWithStats[];
}

interface DaoWithStats {
  id: number;
  dao_pda: string;
  dao_name: string;
  moderator_pda: string;
  owner_wallet: string;
  admin_wallet: string;
  token_mint: string;
  pool_address: string;
  pool_type: "damm" | "dlmm";
  quote_mint: string;
  treasury_multisig: string;
  mint_auth_multisig: string;
  treasury_cosigner: string;
  parent_dao_id?: number;
  dao_type: "parent" | "child";
  created_at: string;
  stats: {
    proposerCount: number;
    proposalCount: number;
    activeProposalCount: number;
    childDaoCount: number;
  };
}
```