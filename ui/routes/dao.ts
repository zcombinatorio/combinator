/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { Router, Request, Response } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { getMint, getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import * as nacl from 'tweetnacl';
import * as crypto from 'crypto';
import bs58 from 'bs58';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { futarchy } from '@zcomb/programs-sdk';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import DLMM from '@meteora-ag/dlmm';
import { getPool } from '../lib/db';
import { getDaoById } from '../lib/db/daos';
import {
  getNextKeyIndex,
  registerKey,
  updateKeyDaoId,
  createDao,
  getDaoByPda,
  getDaoByName,
  getAllDaos,
  getDaosByOwner,
  getChildDaos,
  isProposer,
  getProposersByDao,
  getDaoStats,
} from '../lib/db/daos';
import { allocateKey, fetchKeypair } from '../lib/keyService';
import { isValidSolanaAddress, isValidTokenMintAddress } from '../lib/validation';
import { uploadProposalMetadata } from '../lib/ipfs';

const router = Router();

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

// ============================================================================
// Simple Mutex for DAO Operations
// Prevents race conditions during key allocation and DAO creation
// ============================================================================

class SimpleMutex {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

// Single mutex for all DAO creation operations (parent + child)
const daoCreationMutex = new SimpleMutex();

// ============================================================================
// MOCK MODE CONFIGURATION
// ============================================================================
// When true: Skips Futarchy SDK on-chain calls, uses mock PDAs/transactions
// When false: Makes real on-chain calls via FutarchyClient SDK
//
// TODO [POST-DEPLOYMENT]: After Futarchy contracts are deployed on mainnet:
//   1. Set MOCK_MODE = false
//   2. Test with a real token where you control mint authority
//   3. Test with a Meteora pool where you hold LP positions
//   4. Verify all 5 proposal validation checks pass:
//      - Treasury has funds (SOL/USDC/token)
//      - Mint authority set to mint_auth_multisig
//      - Token matches pool base token (parent DAOs)
//      - Admin wallet holds LP positions
//      - No active proposal for moderator
//   5. Create a test proposal end-to-end
//   6. Remove this TODO block once verified
// ============================================================================
const MOCK_MODE = true;

/**
 * Generate a deterministic mock public key based on a seed string
 */
function mockPublicKey(seed: string): string {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(seed).digest();
  // Take first 32 bytes and encode as base58
  return bs58.encode(hash.slice(0, 32));
}

/**
 * Generate a mock transaction signature
 */
function mockTxSignature(): string {
  const crypto = require('crypto');
  const bytes = crypto.randomBytes(64);
  return bs58.encode(bytes);
}

/**
 * Mock response for initializeParentDAO
 */
function mockInitializeParentDAO(name: string) {
  return {
    daoPda: mockPublicKey(`dao:parent:${name}`),
    moderatorPda: mockPublicKey(`moderator:${name}`),
    treasuryMultisig: mockPublicKey(`treasury:${name}`),
    mintMultisig: mockPublicKey(`mint:${name}`),
    tx: mockTxSignature(),
  };
}

/**
 * Mock response for initializeChildDAO
 */
function mockInitializeChildDAO(parentName: string, childName: string) {
  return {
    daoPda: mockPublicKey(`dao:child:${parentName}:${childName}`),
    treasuryMultisig: mockPublicKey(`treasury:child:${childName}`),
    mintMultisig: mockPublicKey(`mint:child:${childName}`),
    tx: mockTxSignature(),
  };
}

/**
 * Mock response for createProposal
 */
function mockCreateProposal(daoPda: string, title: string) {
  return {
    proposalPda: mockPublicKey(`proposal:${daoPda}:${title}`),
    proposalId: Math.floor(Math.random() * 1000000),
  };
}

// ============================================================================
// Proposal Validation Helpers
// ============================================================================

// Known USDC mint address on mainnet
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// ============================================================================
// Proposer Authorization Configuration (os-percent style)
// ============================================================================
// Two authorization methods per token:
// 1. Pure whitelist: Explicit wallet addresses that can always propose
// 2. Token-gated: Minimum token balance required to propose
//
// Check order: whitelist first (fast, no RPC), then token balance
// ============================================================================

// Pure whitelist: wallets that can always propose for DAOs with these tokens
// Key: token mint address, Value: array of authorized wallet addresses
const PROPOSER_WHITELIST: Record<string, string[]> = {
  // SURF token whitelisted proposers
  'SurfwRjQQFV6P7JdhxSptf4CjWU8sb88rUiaLCystar': [
    // Add whitelisted wallets here as needed
    // Example: 'WalletPubkeyHere...',
  ],
};

// Token-gated proposer requirements
// Key: token mint address, Value: minimum balance and decimals
const TOKEN_GATED_PROPOSERS: Record<string, { minBalance: bigint; decimals: number }> = {
  // SURF token: 5M tokens required to propose
  'SurfwRjQQFV6P7JdhxSptf4CjWU8sb88rUiaLCystar': { minBalance: BigInt(5_000_000), decimals: 6 },
};

// Authorization result type (matching os-percent pattern)
interface ProposerAuthorizationResult {
  isAuthorized: boolean;
  authMethod: 'whitelist' | 'token_balance' | null;
  reason?: string;
}

/**
 * Check if a wallet is whitelisted for proposing (fast, no RPC call)
 */
function isWalletWhitelistedProposer(wallet: string, tokenMint: string): boolean {
  const whitelist = PROPOSER_WHITELIST[tokenMint];
  if (!whitelist) return false;
  return whitelist.includes(wallet);
}

/**
 * Check if a wallet has minimum token balance for proposing
 * Internal helper - use checkProposerAuthorization for full authorization check
 */
async function hasMinimumProposerTokenBalance(
  connection: Connection,
  wallet: string,
  tokenMint: string
): Promise<boolean> {
  const requirement = TOKEN_GATED_PROPOSERS[tokenMint];
  if (!requirement) {
    return false; // No token requirement = can't authorize via token balance
  }

  const walletPubkey = new PublicKey(wallet);
  const mintPubkey = new PublicKey(tokenMint);

  try {
    const ata = await getAssociatedTokenAddress(mintPubkey, walletPubkey);
    const account = await getAccount(connection, ata);
    const balance = account.amount;
    const minBalanceRaw = requirement.minBalance * BigInt(10 ** requirement.decimals);
    return balance >= minBalanceRaw;
  } catch {
    // Token account doesn't exist = 0 balance
    return false;
  }
}

/**
 * Check if a wallet is authorized to propose for a DAO (os-percent style)
 * Order: whitelist first (fast), then token balance
 *
 * If no authorization config exists for token, returns authorized=true (open)
 */
async function checkProposerAuthorization(
  connection: Connection,
  wallet: string,
  tokenMint: string
): Promise<ProposerAuthorizationResult> {
  // Check if this token has any authorization requirements
  const hasWhitelist = PROPOSER_WHITELIST[tokenMint] !== undefined;
  const hasTokenGating = TOKEN_GATED_PROPOSERS[tokenMint] !== undefined;

  // If no restrictions configured for this token, anyone can propose
  if (!hasWhitelist && !hasTokenGating) {
    return { isAuthorized: true, authMethod: null };
  }

  // 1. Check whitelist first (fast, no RPC call)
  if (isWalletWhitelistedProposer(wallet, tokenMint)) {
    return { isAuthorized: true, authMethod: 'whitelist' };
  }

  // 2. Check token balance (requires RPC call)
  if (hasTokenGating) {
    const hasBalance = await hasMinimumProposerTokenBalance(connection, wallet, tokenMint);
    if (hasBalance) {
      return { isAuthorized: true, authMethod: 'token_balance' };
    }
  }

  // Not authorized - provide helpful reason
  const requirement = TOKEN_GATED_PROPOSERS[tokenMint];
  const minBalanceHuman = requirement ? Number(requirement.minBalance).toLocaleString() : 'N/A';

  return {
    isAuthorized: false,
    authMethod: null,
    reason: `Wallet is not whitelisted and does not hold the required ${minBalanceHuman} tokens to propose`,
  };
}

interface DaoReadinessError {
  ready: false;
  reason: string;
}

interface DaoReadinessOk {
  ready: true;
}

type DaoReadinessResult = DaoReadinessOk | DaoReadinessError;

/**
 * Check if treasury multisig has funds (SOL > 0 OR USDC > 0 OR token_mint > 0)
 */
async function checkTreasuryHasFunds(
  connection: Connection,
  treasuryMultisig: string,
  tokenMint: string
): Promise<DaoReadinessResult> {
  const treasuryPubkey = new PublicKey(treasuryMultisig);
  const tokenMintPubkey = new PublicKey(tokenMint);

  // Check SOL balance
  const solBalance = await connection.getBalance(treasuryPubkey);
  if (solBalance > 0) {
    return { ready: true };
  }

  // Check USDC balance
  try {
    const usdcAta = await getAssociatedTokenAddress(USDC_MINT, treasuryPubkey, true);
    const usdcAccount = await getAccount(connection, usdcAta);
    if (usdcAccount.amount > BigInt(0)) {
      return { ready: true };
    }
  } catch {
    // USDC account doesn't exist, continue checking
  }

  // Check token_mint balance
  try {
    const tokenAta = await getAssociatedTokenAddress(tokenMintPubkey, treasuryPubkey, true);
    const tokenAccount = await getAccount(connection, tokenAta);
    if (tokenAccount.amount > BigInt(0)) {
      return { ready: true };
    }
  } catch {
    // Token account doesn't exist
  }

  return {
    ready: false,
    reason: 'Treasury multisig has no funds (SOL, USDC, or governance token)',
  };
}

/**
 * Check if mint_auth_multisig is the mint authority for token_mint
 */
async function checkMintAuthority(
  connection: Connection,
  mintAuthMultisig: string,
  tokenMint: string
): Promise<DaoReadinessResult> {
  const mintAuthPubkey = new PublicKey(mintAuthMultisig);
  const tokenMintPubkey = new PublicKey(tokenMint);

  try {
    const mintInfo = await getMint(connection, tokenMintPubkey);

    if (!mintInfo.mintAuthority) {
      return {
        ready: false,
        reason: 'Token mint has no mint authority (authority is null)',
      };
    }

    if (!mintInfo.mintAuthority.equals(mintAuthPubkey)) {
      return {
        ready: false,
        reason: `Mint authority mismatch: expected ${mintAuthMultisig}, got ${mintInfo.mintAuthority.toBase58()}`,
      };
    }

    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      reason: `Failed to fetch mint info: ${String(error)}`,
    };
  }
}

/**
 * Check if token_mint matches the base token of the pool (parent DAOs only)
 */
async function checkTokenMatchesPoolBase(
  connection: Connection,
  tokenMint: string,
  poolAddress: string,
  poolType: 'damm' | 'dlmm'
): Promise<DaoReadinessResult> {
  const poolPubkey = new PublicKey(poolAddress);

  try {
    let baseToken: string;

    if (poolType === 'damm') {
      const cpAmm = new CpAmm(connection);
      const poolState = await cpAmm.fetchPoolState(poolPubkey);
      // In DAMM, tokenA is typically the base token
      baseToken = poolState.tokenAMint.toBase58();
    } else {
      const dlmmPool = await DLMM.create(connection, poolPubkey);
      // In DLMM, tokenX is typically the base token
      baseToken = dlmmPool.lbPair.tokenXMint.toBase58();
    }

    if (baseToken !== tokenMint) {
      return {
        ready: false,
        reason: `Token mint does not match pool base token: expected ${baseToken}, got ${tokenMint}`,
      };
    }

    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      reason: `Failed to fetch pool info: ${String(error)}`,
    };
  }
}

/**
 * Check if admin wallet holds LP tokens for the pool
 * For child DAOs, checks the parent's admin wallet holds LP
 */
async function checkAdminHoldsLP(
  connection: Connection,
  adminWallet: string,
  poolAddress: string,
  poolType: 'damm' | 'dlmm'
): Promise<DaoReadinessResult> {
  const adminPubkey = new PublicKey(adminWallet);
  const poolPubkey = new PublicKey(poolAddress);

  try {
    if (poolType === 'damm') {
      // For DAMM v2, check position accounts (not LP tokens)
      const cpAmm = new CpAmm(connection);
      const userPositions = await cpAmm.getUserPositionByPool(poolPubkey, adminPubkey);

      if (userPositions.length > 0) {
        // Check if any position has liquidity
        const hasLiquidity = userPositions.some(pos =>
          !pos.positionState.unlockedLiquidity.isZero()
        );

        if (hasLiquidity) {
          return { ready: true };
        }
      }

      return {
        ready: false,
        reason: 'Admin wallet holds no LP positions for the DAMM pool',
      };
    } else {
      // For DLMM, check positions
      const dlmmPool = await DLMM.create(connection, poolPubkey);
      const positions = await dlmmPool.getPositionsByUserAndLbPair(adminPubkey);

      if (positions.userPositions.length > 0) {
        // Check if any position has liquidity (amounts are strings, convert to BN)
        const hasLiquidity = positions.userPositions.some(pos => {
          const xAmount = new BN(pos.positionData.totalXAmount || 0);
          const yAmount = new BN(pos.positionData.totalYAmount || 0);
          return !xAmount.isZero() || !yAmount.isZero();
        });

        if (hasLiquidity) {
          return { ready: true };
        }
      }

      return {
        ready: false,
        reason: 'Admin wallet holds no LP positions for the DLMM pool',
      };
    }
  } catch (error) {
    return {
      ready: false,
      reason: `Failed to check LP holdings: ${String(error)}`,
    };
  }
}

/**
 * Check if there's already an active proposal for this moderator
 * This uses the on-chain moderator state to check proposal count
 */
async function checkNoActiveProposal(
  _connection: Connection,
  _moderatorPda: string
): Promise<DaoReadinessResult> {
  // For now, we'll need to check on-chain via the SDK
  // The moderator account tracks proposal count/state
  // TODO: Implement proper on-chain check when SDK provides method

  // Placeholder: In mock mode, always return ready
  // In real mode, this would query the moderator account on-chain
  if (MOCK_MODE) {
    return { ready: true };
  }

  // TODO: Query moderator account to check for active proposals
  // For now, return ready to allow testing
  return { ready: true };
}

// Meteora program IDs for pool type detection
const DAMM_PROGRAM_ID = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

interface PoolInfo {
  poolType: 'damm' | 'dlmm';
  tokenAMint: string;
  tokenBMint: string;
}

/**
 * Derive pool type and token mints from a Meteora pool address
 * Checks the account owner to determine if DAMM or DLMM, then fetches pool state
 */
async function getPoolInfo(connection: Connection, poolAddress: PublicKey): Promise<PoolInfo> {
  // Fetch account info to check the owner program
  const accountInfo = await connection.getAccountInfo(poolAddress);
  if (!accountInfo) {
    throw new Error('Pool account not found');
  }

  const owner = accountInfo.owner;

  if (owner.equals(DAMM_PROGRAM_ID)) {
    // DAMM pool - use CpAmm SDK
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);
    return {
      poolType: 'damm',
      tokenAMint: poolState.tokenAMint.toBase58(),
      tokenBMint: poolState.tokenBMint.toBase58(),
    };
  } else if (owner.equals(DLMM_PROGRAM_ID)) {
    // DLMM pool - use DLMM SDK
    const dlmmPool = await DLMM.create(connection, poolAddress);
    return {
      poolType: 'dlmm',
      tokenAMint: dlmmPool.lbPair.tokenXMint.toBase58(),
      tokenBMint: dlmmPool.lbPair.tokenYMint.toBase58(),
    };
  } else {
    throw new Error(`Unknown pool program: ${owner.toBase58()}. Expected DAMM or DLMM.`);
  }
}

/**
 * Determine the quote mint given pool tokens and the base (governance) token
 */
function deriveQuoteMint(poolInfo: PoolInfo, tokenMint: string): string {
  if (poolInfo.tokenAMint === tokenMint) {
    return poolInfo.tokenBMint;
  } else if (poolInfo.tokenBMint === tokenMint) {
    return poolInfo.tokenAMint;
  } else {
    throw new Error(`Token mint ${tokenMint} not found in pool. Pool contains: ${poolInfo.tokenAMint}, ${poolInfo.tokenBMint}`);
  }
}

// ============================================================================
// Rate Limiting
// ============================================================================

const daoLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // 30 requests per window
  keyGenerator: (req) => {
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string') return ipKeyGenerator(cfIp);
    if (Array.isArray(cfIp)) return ipKeyGenerator(cfIp[0]);
    return ipKeyGenerator(req.ip || 'unknown');
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many DAO requests, please wait.'
});

router.use(daoLimiter);

// ============================================================================
// Signature Verification
// ============================================================================

/**
 * Verify a signed_hash for request authentication
 * The client signs SHA-256(JSON.stringify(bodyWithoutSignedHash))
 */
function verifySignedHash(
  body: Record<string, unknown>,
  wallet: string,
  signedHash: string
): boolean {
  try {
    // Reconstruct body without signed_hash
    const { signed_hash: _, ...bodyWithoutHash } = body;

    // Hash the stringified body
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify(bodyWithoutHash))
      .digest();

    // Decode signature and public key
    const signature = bs58.decode(signedHash);
    const publicKey = bs58.decode(wallet);

    // Verify the signature
    return nacl.sign.detached.verify(hash, signature, publicKey);
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Middleware to validate request authentication via signed_hash
 */
function requireSignedHash(
  req: Request,
  res: Response,
  next: () => void
): void {
  const { wallet, signed_hash } = req.body;

  if (!wallet || !signed_hash) {
    res.status(400).json({ error: 'Missing wallet or signed_hash' });
    return;
  }

  if (!isValidSolanaAddress(wallet)) {
    res.status(400).json({ error: 'Invalid wallet address' });
    return;
  }

  if (!verifySignedHash(req.body, wallet, signed_hash)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  next();
}

// ============================================================================
// Helper Functions
// ============================================================================

function getConnection(): Connection {
  return new Connection(RPC_URL, 'confirmed');
}

function createProvider(keypair: { publicKey: PublicKey; secretKey: Uint8Array }): AnchorProvider {
  const connection = getConnection();
  const wallet = {
    publicKey: keypair.publicKey,
    signTransaction: async (tx: any) => {
      tx.partialSign(keypair);
      return tx;
    },
    signAllTransactions: async (txs: any[]) => {
      txs.forEach(tx => tx.partialSign(keypair));
      return txs;
    },
  } as Wallet;
  return new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
}

// ============================================================================
// GET /dao - List all DAOs (for client indexing)
// ============================================================================

router.get('/', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { type, owner, limit, offset } = req.query;

    let daos;
    if (owner && typeof owner === 'string') {
      daos = await getDaosByOwner(pool, owner);
    } else {
      daos = await getAllDaos(pool, {
        daoType: type === 'parent' || type === 'child' ? type : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      });
    }

    // Enrich with stats and strip internal fields
    const enrichedDaos = await Promise.all(
      daos.map(async (dao) => {
        const stats = await getDaoStats(pool, dao.id!);
        const { admin_key_idx, ...publicDao } = dao;
        return { ...publicDao, stats };
      })
    );

    res.json({ daos: enrichedDaos });
  } catch (error) {
    console.error('Error fetching DAOs:', error);
    res.status(500).json({ error: 'Failed to fetch DAOs' });
  }
});

// ============================================================================
// GET /dao/:daoPda - Get specific DAO details
// ============================================================================

router.get('/:daoPda', async (req: Request, res: Response) => {
  try {
    const { daoPda } = req.params;
    const pool = getPool();

    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    const stats = await getDaoStats(pool, dao.id!);
    const proposers = await getProposersByDao(pool, dao.id!);

    // If parent, also fetch child DAOs (strip internal fields)
    let children: any[] = [];
    if (dao.dao_type === 'parent') {
      const childDaos = await getChildDaos(pool, dao.id!);
      children = childDaos.map(({ admin_key_idx, ...child }) => child);
    }

    // Strip internal fields from response
    const { admin_key_idx, ...publicDao } = dao;

    res.json({
      ...publicDao,
      stats,
      proposers,
      children,
    });
  } catch (error) {
    console.error('Error fetching DAO:', error);
    res.status(500).json({ error: 'Failed to fetch DAO' });
  }
});

// ============================================================================
// GET /dao/:daoPda/proposers - List proposers for a DAO
// ============================================================================

router.get('/:daoPda/proposers', async (req: Request, res: Response) => {
  try {
    const { daoPda } = req.params;
    const pool = getPool();

    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    const proposers = await getProposersByDao(pool, dao.id!);

    // Owner is always an implicit proposer
    res.json({
      owner: dao.owner_wallet,
      proposers,
    });
  } catch (error) {
    console.error('Error fetching proposers:', error);
    res.status(500).json({ error: 'Failed to fetch proposers' });
  }
});

// ============================================================================
// POST /dao/parent - Create a parent DAO
// ============================================================================

router.post('/parent', requireSignedHash, async (req: Request, res: Response) => {
  try {
    const {
      wallet,
      name,
      token_mint,
      treasury_cosigner,
      pool_address,
    } = req.body;

    // Validate required fields
    if (!name || !token_mint || !treasury_cosigner || !pool_address) {
      return res.status(400).json({
        error: 'Missing required fields: name, token_mint, treasury_cosigner, pool_address'
      });
    }

    // Validate name length
    if (name.length > 32) {
      return res.status(400).json({ error: 'DAO name must be 32 characters or less' });
    }

    // Validate addresses
    // token_mint can be a PDA (off-curve), so use isValidTokenMintAddress
    if (!isValidTokenMintAddress(token_mint)) {
      return res.status(400).json({ error: 'Invalid token_mint address' });
    }
    // treasury_cosigner must be a wallet (on-curve)
    if (!isValidSolanaAddress(treasury_cosigner)) {
      return res.status(400).json({ error: 'Invalid treasury_cosigner address' });
    }
    // pool_address is a PDA (off-curve), so use isValidTokenMintAddress
    if (!isValidTokenMintAddress(pool_address)) {
      return res.status(400).json({ error: 'Invalid pool_address' });
    }

    const pool = getPool();
    const connection = getConnection();

    // Derive pool_type and quote_mint from pool_address (on-chain read)
    let poolInfo: PoolInfo;
    try {
      poolInfo = await getPoolInfo(connection, new PublicKey(pool_address));
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid pool_address: could not fetch pool info',
        details: String(error),
      });
    }

    const pool_type = poolInfo.poolType;

    // Derive quote_mint from pool tokens and token_mint
    let quote_mint: string;
    try {
      quote_mint = deriveQuoteMint(poolInfo, token_mint);
    } catch (error) {
      return res.status(400).json({
        error: 'token_mint not found in pool',
        details: String(error),
      });
    }

    // Acquire lock for DAO creation to prevent race conditions
    await daoCreationMutex.acquire();

    try {
      // Check if DAO with this name already exists
      const existingDao = await getDaoByName(pool, name);
      if (existingDao) {
        return res.status(409).json({ error: 'DAO with this name already exists' });
      }

      // Get next key index and allocate a new managed wallet
      const keyIdx = await getNextKeyIndex(pool);
    let adminWallet: string;
    let daoPda: string;
    let moderatorPda: string;
    let treasuryMultisig: string;
    let mintMultisig: string;
    let tx: string;

    // Allocate and fund admin wallet from key service
    const { publicKey: allocatedWallet } = await allocateKey(connection, keyIdx);
    adminWallet = allocatedWallet;

    // Register the key
    await registerKey(pool, {
      key_idx: keyIdx,
      public_key: adminWallet,
      purpose: 'dao_parent',
    });

    if (MOCK_MODE) {
      // ========== MOCK MODE ==========
      // Only mock the FutarchyClient SDK write operations
      console.log('[MOCK MODE] Skipping FutarchyClient SDK calls for parent DAO creation');

      // Generate mock PDAs for SDK response
      const mockResult = mockInitializeParentDAO(name);
      daoPda = mockResult.daoPda;
      moderatorPda = mockResult.moderatorPda;
      treasuryMultisig = mockResult.treasuryMultisig;
      mintMultisig = mockResult.mintMultisig;
      tx = mockResult.tx;
    } else {
      // ========== REAL MODE ==========
      const adminKeypair = await fetchKeypair(keyIdx);

      // Create the DAO on-chain using the SDK
      const provider = createProvider(adminKeypair);
      const client = new futarchy.FutarchyClient(provider);

      const baseMint = new PublicKey(token_mint);
      const quoteMintPubkey = new PublicKey(quote_mint);
      const poolPubkey = new PublicKey(pool_address);
      const cosignerPubkey = new PublicKey(treasury_cosigner);

      // Call initializeParentDAO
      const result = await client.initializeParentDAO(
        adminKeypair.publicKey,      // admin
        adminKeypair.publicKey,      // parentAdmin (same for parent DAOs)
        name,
        baseMint,
        quoteMintPubkey,
        cosignerPubkey,
        poolPubkey,
        { [pool_type]: {} } as any,  // poolType enum
      );

      // Send the transaction
      tx = await result.builder.rpc();

      // Extract PDAs from result
      daoPda = result.daoPda.toBase58();
      moderatorPda = result.moderatorPda.toBase58();
      treasuryMultisig = result.treasuryMultisig.toBase58();
      mintMultisig = result.mintMultisig.toBase58();
    }

    // Store in database
    const dao = await createDao(pool, {
      dao_pda: daoPda,
      dao_name: name,
      moderator_pda: moderatorPda,
      owner_wallet: wallet,
      admin_key_idx: keyIdx,
      admin_wallet: adminWallet,
      token_mint,
      pool_address,
      pool_type,
      quote_mint,
      treasury_multisig: treasuryMultisig,
      mint_auth_multisig: mintMultisig,
      treasury_cosigner,
      dao_type: 'parent',
    });

    // Update key registry with dao_id
    await updateKeyDaoId(pool, keyIdx, dao.id!);

    console.log(`Created parent DAO: ${daoPda} (tx: ${tx})`);

      res.json({
        dao_pda: daoPda,
        moderator_pda: moderatorPda,
        treasury_multisig: treasuryMultisig,
        mint_multisig: mintMultisig,
        admin_wallet: adminWallet,
        pool_type,
        quote_mint,
        transaction: tx,
      });
    } finally {
      daoCreationMutex.release();
    }
  } catch (error) {
    console.error('Error creating parent DAO:', error);
    res.status(500).json({ error: 'Failed to create parent DAO', details: String(error) });
  }
});

// ============================================================================
// POST /dao/child - Create a child DAO
// ============================================================================

router.post('/child', requireSignedHash, async (req: Request, res: Response) => {
  try {
    const { wallet, name, parent_pda, token_mint, treasury_cosigner } = req.body;

    // Validate required fields
    if (!name || !parent_pda || !token_mint || !treasury_cosigner) {
      return res.status(400).json({
        error: 'Missing required fields: name, parent_pda, token_mint, treasury_cosigner'
      });
    }

    // Validate name length
    if (name.length > 32) {
      return res.status(400).json({ error: 'DAO name must be 32 characters or less' });
    }

    // Validate addresses
    // parent_pda is a PDA (off-curve)
    if (!isValidTokenMintAddress(parent_pda)) {
      return res.status(400).json({ error: 'Invalid parent_pda address' });
    }
    // token_mint can be a PDA (off-curve)
    if (!isValidTokenMintAddress(token_mint)) {
      return res.status(400).json({ error: 'Invalid token_mint address' });
    }
    // treasury_cosigner must be a wallet (on-curve)
    if (!isValidSolanaAddress(treasury_cosigner)) {
      return res.status(400).json({ error: 'Invalid treasury_cosigner address' });
    }

    const pool = getPool();
    const connection = getConnection();

    // Fetch parent DAO
    const parentDao = await getDaoByPda(pool, parent_pda);
    if (!parentDao) {
      return res.status(404).json({ error: 'Parent DAO not found' });
    }

    // Verify caller is the parent DAO owner
    if (parentDao.owner_wallet !== wallet) {
      return res.status(403).json({ error: 'Only the parent DAO owner can create child DAOs' });
    }

    // Verify parent is actually a parent DAO
    if (parentDao.dao_type !== 'parent') {
      return res.status(400).json({ error: 'Cannot create child of a child DAO' });
    }

    // Acquire lock for DAO creation to prevent race conditions
    await daoCreationMutex.acquire();

    try {
      // Check if DAO with this name already exists
      const existingDao = await getDaoByName(pool, name);
      if (existingDao) {
        return res.status(409).json({ error: 'DAO with this name already exists' });
      }

      // Get next key index and allocate admin wallet
      const keyIdx = await getNextKeyIndex(pool);
      const { publicKey: childAdminWallet } = await allocateKey(connection, keyIdx);

    // Register the key
    await registerKey(pool, {
      key_idx: keyIdx,
      public_key: childAdminWallet,
      purpose: 'dao_child',
    });

    let daoPda: string;
    let treasuryMultisig: string;
    let mintMultisig: string;
    let tx: string;

    if (MOCK_MODE) {
      // ========== MOCK MODE ==========
      // Only mock the FutarchyClient SDK write operations
      console.log('[MOCK MODE] Skipping FutarchyClient SDK calls for child DAO creation');

      // Generate mock PDAs
      const mockResult = mockInitializeChildDAO(parentDao.dao_name, name);
      daoPda = mockResult.daoPda;
      treasuryMultisig = mockResult.treasuryMultisig;
      mintMultisig = mockResult.mintMultisig;
      tx = mockResult.tx;
    } else {
      // ========== REAL MODE ==========
      const childKeypair = await fetchKeypair(keyIdx);

      // Get parent's admin keypair for signing
      const parentKeypair = await fetchKeypair(parentDao.admin_key_idx);

      // Create the child DAO on-chain using the SDK
      const provider = createProvider(childKeypair);
      const client = new futarchy.FutarchyClient(provider);

      const tokenMintPubkey = new PublicKey(token_mint);
      const cosignerPubkey = new PublicKey(treasury_cosigner);

      // Call initializeChildDAO
      const result = await client.initializeChildDAO(
        childKeypair.publicKey,      // admin
        parentKeypair.publicKey,     // parentAdmin
        parentDao.dao_name,          // parentDaoName
        name,                        // childDaoName
        tokenMintPubkey,
        cosignerPubkey,
      );

      // Send the transaction (need both signatures)
      tx = await result.builder.rpc();

      // Extract PDAs from result
      daoPda = result.daoPda.toBase58();
      treasuryMultisig = result.treasuryMultisig.toBase58();
      mintMultisig = result.mintMultisig.toBase58();
    }

    // Store in database
    const dao = await createDao(pool, {
      dao_pda: daoPda,
      dao_name: name,
      moderator_pda: parentDao.moderator_pda, // Child uses parent's moderator
      owner_wallet: wallet,
      admin_key_idx: keyIdx,
      admin_wallet: childAdminWallet,
      token_mint,  // Child has its own token mint
      pool_address: parentDao.pool_address, // Reference to parent's pool (for LP checks)
      pool_type: parentDao.pool_type,
      quote_mint: parentDao.quote_mint,
      treasury_multisig: treasuryMultisig,
      mint_auth_multisig: mintMultisig,
      treasury_cosigner,
      parent_dao_id: parentDao.id,
      dao_type: 'child',
    });

    // Update key registry with dao_id
    await updateKeyDaoId(pool, keyIdx, dao.id!);

    console.log(`Created child DAO: ${daoPda} under parent ${parent_pda} (tx: ${tx})`);

      res.json({
        dao_pda: daoPda,
        parent_dao_pda: parent_pda,
        treasury_multisig: treasuryMultisig,
        mint_multisig: mintMultisig,
        admin_wallet: childAdminWallet,
        transaction: tx,
      });
    } finally {
      daoCreationMutex.release();
    }
  } catch (error) {
    console.error('Error creating child DAO:', error);
    res.status(500).json({ error: 'Failed to create child DAO', details: String(error) });
  }
});

// ============================================================================
// POST /dao/proposal - Create a decision market proposal
// ============================================================================

router.post('/proposal', requireSignedHash, async (req: Request, res: Response) => {
  try {
    const {
      wallet,
      dao_pda,
      title,
      description,
      length_secs,
      options,
    } = req.body;

    // Validate required fields
    if (!dao_pda || !title || !description || !length_secs || !options) {
      return res.status(400).json({
        error: 'Missing required fields: dao_pda, title, description, length_secs, options'
      });
    }

    // Validate title and description length
    if (title.length > 128) {
      return res.status(400).json({ error: 'Title must be 128 characters or less' });
    }
    if (description.length > 1024) {
      return res.status(400).json({ error: 'Description must be 1024 characters or less' });
    }

    // Validate options
    if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
      return res.status(400).json({ error: 'Options must be an array with 2-6 items' });
    }

    // Validate length_secs
    if (typeof length_secs !== 'number' || length_secs <= 0) {
      return res.status(400).json({ error: 'length_secs must be a positive number' });
    }

    const pool = getPool();

    // Fetch DAO
    const dao = await getDaoByPda(pool, dao_pda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    // Verify caller is an authorized proposer
    // TODO: Implement proposer whitelist management endpoints:
    //   - POST /dao/:daoPda/proposers - Add proposer (owner only)
    //   - DELETE /dao/:daoPda/proposers/:wallet - Remove proposer (owner only)
    const canPropose = await isProposer(pool, dao.id!, wallet);
    if (!canPropose) {
      return res.status(403).json({ error: 'Not authorized to create proposals for this DAO' });
    }

    if (!dao.moderator_pda) {
      return res.status(500).json({ error: 'DAO has no moderator PDA' });
    }

    const connection = getConnection();

    // ========== PROPOSAL VALIDATION CHECKS ==========
    // These checks ensure the DAO is ready to create proposals

    // 0. Check proposer authorization (whitelist OR token balance)
    const proposerAuthResult = await checkProposerAuthorization(connection, wallet, dao.token_mint);
    if (!proposerAuthResult.isAuthorized) {
      return res.status(403).json({
        error: 'Not authorized to propose',
        reason: proposerAuthResult.reason,
        check: 'proposer_authorization',
      });
    }
    // Log authorization method for debugging
    if (proposerAuthResult.authMethod) {
      console.log(`Proposer authorized via: ${proposerAuthResult.authMethod}`);
    }

    // 1. Check treasury has funds (SOL, USDC, or DAO token)
    const treasuryCheck = await checkTreasuryHasFunds(connection, dao.treasury_multisig, dao.token_mint);
    if (!treasuryCheck.ready) {
      return res.status(400).json({
        error: 'DAO not ready for proposals',
        reason: treasuryCheck.reason,
        check: 'treasury_funds',
      });
    }

    // 2. Check mint authority - mint_auth_multisig must be authority for token_mint
    const mintAuthCheck = await checkMintAuthority(connection, dao.mint_auth_multisig, dao.token_mint);
    if (!mintAuthCheck.ready) {
      return res.status(400).json({
        error: 'DAO not ready for proposals',
        reason: mintAuthCheck.reason,
        check: 'mint_authority',
      });
    }

    // 3. For parent DAOs only: Check token matches pool base token
    if (dao.dao_type === 'parent') {
      const tokenPoolCheck = await checkTokenMatchesPoolBase(connection, dao.token_mint, dao.pool_address, dao.pool_type);
      if (!tokenPoolCheck.ready) {
        return res.status(400).json({
          error: 'DAO not ready for proposals',
          reason: tokenPoolCheck.reason,
          check: 'token_pool_match',
        });
      }
    }

    // 4. Check admin holds LP - for child DAOs, check parent's admin wallet
    let lpCheckWallet = dao.admin_wallet;
    let lpCheckPool = dao.pool_address;
    let lpCheckPoolType = dao.pool_type;

    if (dao.dao_type === 'child' && dao.parent_dao_id) {
      // Get parent DAO to check LP holdings
      const parentDao = await getDaoById(pool, dao.parent_dao_id);
      if (parentDao) {
        lpCheckWallet = parentDao.admin_wallet;
        lpCheckPool = parentDao.pool_address;
        lpCheckPoolType = parentDao.pool_type;
      }
    }

    const lpCheck = await checkAdminHoldsLP(connection, lpCheckWallet, lpCheckPool, lpCheckPoolType);
    if (!lpCheck.ready) {
      return res.status(400).json({
        error: 'DAO not ready for proposals',
        reason: lpCheck.reason,
        check: 'admin_lp_holdings',
      });
    }

    // 5. Check no active proposal for this moderator
    const activeProposalCheck = await checkNoActiveProposal(connection, dao.moderator_pda);
    if (!activeProposalCheck.ready) {
      return res.status(400).json({
        error: 'DAO not ready for proposals',
        reason: activeProposalCheck.reason,
        check: 'active_proposal',
      });
    }

    console.log('All proposal validation checks passed');

    // Upload proposal metadata to IPFS
    let metadataCid: string;
    try {
      metadataCid = await uploadProposalMetadata(title, description, options);
      console.log(`Uploaded proposal metadata to IPFS: ${metadataCid}`);
    } catch (error) {
      console.error('Failed to upload proposal metadata to IPFS:', error);
      return res.status(500).json({
        error: 'Failed to upload proposal metadata to IPFS',
        details: String(error),
      });
    }

    let proposalPda: string;
    let proposalId: number;

    if (MOCK_MODE) {
      // ========== MOCK MODE ==========
      console.log('[MOCK MODE] Skipping FutarchyClient SDK calls for proposal creation');

      const mockResult = mockCreateProposal(dao_pda, title);
      proposalPda = mockResult.proposalPda;
      proposalId = mockResult.proposalId;
    } else {
      // ========== REAL MODE ==========
      // Get the admin keypair for this DAO
      const adminKeypair = await fetchKeypair(dao.admin_key_idx);

      // Create the proposal on-chain
      const provider = createProvider(adminKeypair);
      const client = new futarchy.FutarchyClient(provider);

      const moderatorPda = new PublicKey(dao.moderator_pda);

      // Create proposal with the SDK
      // The SDK's createProposal handles: ALT creation -> initializeProposal -> addOption -> launchProposal
      const result = await client.createProposal(
        adminKeypair.publicKey,
        moderatorPda,
        {
          length: length_secs,
          startingObservation: new BN(0),
          maxObservationDelta: new BN('1000000000000'), // Large delta
          warmupDuration: 300, // 5 minutes
          marketBias: 5000, // 50% (centered)
          fee: 30, // 0.3% fee
        },
        new BN(0), // baseAmount - will be provided by liquidity withdrawal
        new BN(0), // quoteAmount
        options.length,
        metadataCid,
      );

      // Execute the transaction
      // Note: The actual implementation may need to handle multi-tx flow
      proposalPda = result.proposalPda.toBase58();
      proposalId = result.proposalId;
    }

    console.log(`Created proposal ${proposalPda} for DAO ${dao_pda}`);

    res.json({
      proposal_pda: proposalPda,
      proposal_id: proposalId,
      metadata_cid: metadataCid,
      dao_pda,
      status: 'pending',
    });
  } catch (error) {
    console.error('Error creating proposal:', error);
    res.status(500).json({ error: 'Failed to create proposal', details: String(error) });
  }
});

export default router;
