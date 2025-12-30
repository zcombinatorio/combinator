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
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { getMint, getAccount, getAssociatedTokenAddress, NATIVE_MINT } from '@solana/spl-token';
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
  getDaoByModeratorPda,
  getAllDaos,
  getDaosByOwner,
  getChildDaos,
  isProposer,
  getProposersByDao,
  getDaoStats,
  addProposer,
  removeProposer,
  updateProposerThreshold,
  getProposerThreshold,
  updateWithdrawalPercentage,
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
const MOCK_MODE = false;

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

interface ProposerAuthorizationResult {
  isAuthorized: boolean;
  authMethod: 'whitelist' | 'token_balance' | null;
  reason?: string;
}

/**
 * Check if a wallet is authorized to propose for a specific DAO using DB settings.
 * Each DAO (parent or child) has independent whitelist and token threshold.
 *
 * Authorization flow:
 * 1. Check if wallet is in DAO's DB whitelist (fast, no RPC)
 * 2. If not whitelisted AND threshold is set, check token balance (RPC call)
 * 3. Otherwise deny (creator is always on whitelist by default)
 */
async function checkDaoProposerAuthorization(
  connection: Connection,
  pool: ReturnType<typeof getPool>,
  daoId: number,
  wallet: string,
  tokenMint: string
): Promise<ProposerAuthorizationResult> {
  // 1. Check DB whitelist first (fast, no RPC)
  const onWhitelist = await isProposer(pool, daoId, wallet);
  if (onWhitelist) {
    return { isAuthorized: true, authMethod: 'whitelist' };
  }

  // 2. Get the DAO's token threshold setting
  const threshold = await getProposerThreshold(pool, daoId);

  // 3. If threshold is set, check token balance
  if (threshold && threshold !== '0') {
    const walletPubkey = new PublicKey(wallet);
    const mintPubkey = new PublicKey(tokenMint);

    try {
      const ata = await getAssociatedTokenAddress(mintPubkey, walletPubkey);
      const account = await getAccount(connection, ata);
      const balance = account.amount;
      const minBalanceRaw = BigInt(threshold);

      if (balance >= minBalanceRaw) {
        return { isAuthorized: true, authMethod: 'token_balance' };
      }

      // Has threshold requirement but balance too low
      return {
        isAuthorized: false,
        authMethod: null,
        reason: `Wallet not whitelisted and token balance (${balance.toString()}) is below required threshold (${threshold})`,
      };
    } catch {
      // Token account doesn't exist = 0 balance
      return {
        isAuthorized: false,
        authMethod: null,
        reason: `Wallet not whitelisted and no token balance (required: ${threshold})`,
      };
    }
  }

  // 4. Not whitelisted and no token threshold set - deny
  // (DAO creator is always added to whitelist on creation)
  return {
    isAuthorized: false,
    authMethod: null,
    reason: 'Wallet not on proposer whitelist for this DAO',
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
 * Check if there's already an active proposal for this moderator.
 *
 * IMPORTANT: Child DAOs share their parent's moderator_pda, so this check
 * naturally prevents sibling DAOs from creating proposals while one is active.
 * This is the desired behavior since they share liquidity from the parent's pool.
 */
async function checkNoActiveProposal(
  connection: Connection,
  moderatorPda: string
): Promise<DaoReadinessResult> {
  if (MOCK_MODE) {
    return { ready: true };
  }

  try {
    // Create a read-only provider (no wallet needed for fetching)
    const dummyWallet = {
      publicKey: PublicKey.default,
      signTransaction: async () => { throw new Error('Read-only'); },
      signAllTransactions: async () => { throw new Error('Read-only'); },
    } as unknown as Wallet;
    const provider = new AnchorProvider(connection, dummyWallet, { commitment: 'confirmed' });
    const client = new futarchy.FutarchyClient(provider);
    const moderatorPubkey = new PublicKey(moderatorPda);

    // Fetch moderator account to get proposal counter
    const moderator = await client.fetchModerator(moderatorPubkey);

    // No proposals ever created = ready to create first one
    if (moderator.proposalIdCounter === 0) {
      return { ready: true };
    }

    // Check the latest proposal (ID = counter - 1)
    const latestProposalId = moderator.proposalIdCounter - 1;
    const [proposalPda] = client.deriveProposalPDA(moderatorPubkey, latestProposalId);

    let proposal;
    try {
      proposal = await client.fetchProposal(proposalPda);
    } catch (fetchError) {
      // Proposal account doesn't exist (maybe closed) - OK to proceed
      console.log(`Could not fetch proposal ${latestProposalId}, proceeding:`, fetchError);
      return { ready: true };
    }

    // Check proposal state - block if Setup or (Pending and not expired)
    // ProposalState is an enum-like object: { setup: {} } | { pending: {} } | { resolved: {} }
    const stateKey = Object.keys(proposal.state)[0];
    const isSetup = stateKey === 'setup';
    const isPending = stateKey === 'pending';
    const isExpired = client.isProposalExpired(proposal);

    if (isSetup) {
      return {
        ready: false,
        reason: `Proposal ${latestProposalId} is still being set up. Complete or cancel it before creating a new one.`,
      };
    }

    if (isPending && !isExpired) {
      const timeRemaining = client.getTimeRemaining(proposal);
      const hoursRemaining = Math.ceil(timeRemaining / 3600);
      return {
        ready: false,
        reason: `Active proposal ${latestProposalId} in progress. ~${hoursRemaining}h remaining before it can be finalized.`,
      };
    }

    // Proposal is resolved or expired - ready for new proposal
    return { ready: true };
  } catch (error) {
    // If we can't check (RPC error, etc.), block proposal creation for safety
    // This is "fail closed" - we prefer correctness over availability
    console.error('Error checking for active proposal:', error);
    return {
      ready: false,
      reason: `Failed to verify proposal state: ${error instanceof Error ? error.message : String(error)}. Please try again.`,
    };
  }
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
      withdrawal_percentage: 12,
    });

    // Update key registry with dao_id
    await updateKeyDaoId(pool, keyIdx, dao.id!);

    // Add creator to proposer whitelist by default
    await addProposer(pool, {
      dao_id: dao.id!,
      proposer_wallet: wallet,
      added_by: wallet,
    });

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

      // Send the transaction with both admin signatures
      tx = await result.builder.signers([parentKeypair]).rpc();

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
      withdrawal_percentage: 12,
    });

    // Update key registry with dao_id
    await updateKeyDaoId(pool, keyIdx, dao.id!);

    // Add creator to proposer whitelist by default
    await addProposer(pool, {
      dao_id: dao.id!,
      proposer_wallet: wallet,
      added_by: wallet,
    });

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
// Proposer Whitelist Management
// ============================================================================
// Each DAO (parent or child) has its own independent proposer whitelist
// and token holding threshold. These are managed by the DAO owner.

/**
 * POST /dao/:daoPda/proposers - Add a proposer to the whitelist
 * Only callable by the DAO owner (the wallet that created the DAO)
 */
router.post('/:daoPda/proposers', requireSignedHash, async (req: Request, res: Response) => {
  try {
    const { daoPda } = req.params;
    const { wallet, proposer_wallet } = req.body;

    // Validate DAO PDA (off-curve PDA, so use token mint validation)
    if (!isValidTokenMintAddress(daoPda)) {
      return res.status(400).json({ error: 'Invalid DAO PDA' });
    }

    // Validate proposer wallet (on-curve wallet address)
    if (!proposer_wallet || !isValidSolanaAddress(proposer_wallet)) {
      return res.status(400).json({ error: 'Invalid or missing proposer_wallet' });
    }

    const pool = getPool();

    // Fetch the DAO
    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    // Verify the caller is the DAO owner
    if (dao.owner_wallet !== wallet) {
      return res.status(403).json({ error: 'Only the DAO owner can manage proposers' });
    }

    // Add the proposer
    const proposer = await addProposer(pool, {
      dao_id: dao.id!,
      proposer_wallet,
      added_by: wallet,
    });

    console.log(`Added proposer ${proposer_wallet} to DAO ${dao.dao_name} by ${wallet}`);

    res.json({
      success: true,
      proposer: {
        id: proposer.id,
        dao_id: proposer.dao_id,
        proposer_wallet: proposer.proposer_wallet,
        added_by: proposer.added_by,
        created_at: proposer.created_at,
      },
    });
  } catch (error) {
    console.error('Error adding proposer:', error);
    res.status(500).json({ error: 'Failed to add proposer', details: String(error) });
  }
});

/**
 * DELETE /dao/:daoPda/proposers/:proposerWallet - Remove a proposer from the whitelist
 * Only callable by the DAO owner
 */
router.delete('/:daoPda/proposers/:proposerWallet', requireSignedHash, async (req: Request, res: Response) => {
  try {
    const { daoPda, proposerWallet } = req.params;
    const { wallet } = req.body;

    // Validate DAO PDA (off-curve PDA)
    if (!isValidTokenMintAddress(daoPda)) {
      return res.status(400).json({ error: 'Invalid DAO PDA' });
    }

    // Validate proposer wallet (on-curve wallet)
    if (!isValidSolanaAddress(proposerWallet)) {
      return res.status(400).json({ error: 'Invalid proposer wallet' });
    }

    const pool = getPool();

    // Fetch the DAO
    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    // Verify the caller is the DAO owner
    if (dao.owner_wallet !== wallet) {
      return res.status(403).json({ error: 'Only the DAO owner can manage proposers' });
    }

    // Remove the proposer
    const removed = await removeProposer(pool, dao.id!, proposerWallet);
    if (!removed) {
      return res.status(404).json({ error: 'Proposer not found in whitelist' });
    }

    console.log(`Removed proposer ${proposerWallet} from DAO ${dao.dao_name} by ${wallet}`);

    res.json({
      success: true,
      removed_wallet: proposerWallet,
    });
  } catch (error) {
    console.error('Error removing proposer:', error);
    res.status(500).json({ error: 'Failed to remove proposer', details: String(error) });
  }
});

/**
 * PUT /dao/:daoPda/proposer-threshold - Update the token holding threshold
 * Only callable by the DAO owner
 *
 * The threshold is the minimum token balance (in raw units) required to create proposals.
 * Set to null or "0" to disable token holding requirement.
 * Each DAO (parent or child) has its own independent threshold.
 */
router.put('/:daoPda/proposer-threshold', requireSignedHash, async (req: Request, res: Response) => {
  try {
    const { daoPda } = req.params;
    const { wallet, threshold } = req.body;

    // Validate DAO PDA (off-curve PDA)
    if (!isValidTokenMintAddress(daoPda)) {
      return res.status(400).json({ error: 'Invalid DAO PDA' });
    }

    // Validate threshold - must be a non-negative number string or null
    let normalizedThreshold: string | null = null;
    if (threshold !== null && threshold !== undefined && threshold !== '' && threshold !== '0') {
      // Validate it's a valid number string
      if (!/^\d+$/.test(threshold)) {
        return res.status(400).json({ error: 'Threshold must be a non-negative integer string (raw token units)' });
      }
      normalizedThreshold = threshold;
    }

    const pool = getPool();

    // Fetch the DAO
    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    // Verify the caller is the DAO owner
    if (dao.owner_wallet !== wallet) {
      return res.status(403).json({ error: 'Only the DAO owner can update the proposer threshold' });
    }

    // Update the threshold
    await updateProposerThreshold(pool, dao.id!, normalizedThreshold);

    console.log(`Updated proposer threshold for DAO ${dao.dao_name} to ${normalizedThreshold ?? 'null (disabled)'} by ${wallet}`);

    res.json({
      success: true,
      dao_pda: daoPda,
      dao_name: dao.dao_name,
      proposer_token_threshold: normalizedThreshold,
    });
  } catch (error) {
    console.error('Error updating proposer threshold:', error);
    res.status(500).json({ error: 'Failed to update proposer threshold', details: String(error) });
  }
});

/**
 * PUT /dao/:daoPda/withdrawal-percentage - Update the liquidity withdrawal percentage
 * Only callable by the DAO owner
 *
 * The withdrawal percentage determines how much LP liquidity is withdrawn when creating proposals.
 * Valid range: 1-50 (percentage of total LP position).
 * Default: 12%
 */
router.put('/:daoPda/withdrawal-percentage', requireSignedHash, async (req: Request, res: Response) => {
  try {
    const { daoPda } = req.params;
    const { wallet, percentage } = req.body;

    // Validate DAO PDA (off-curve PDA)
    if (!isValidTokenMintAddress(daoPda)) {
      return res.status(400).json({ error: 'Invalid DAO PDA' });
    }

    // Validate percentage - must be an integer between 5 and 50
    const percentageNum = parseInt(percentage);
    if (isNaN(percentageNum) || percentageNum < 5 || percentageNum > 50) {
      return res.status(400).json({
        error: 'Invalid withdrawal percentage',
        details: 'Percentage must be an integer between 5 and 50',
      });
    }

    const pool = getPool();

    // Fetch the DAO
    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    // Verify the caller is the DAO owner
    if (dao.owner_wallet !== wallet) {
      return res.status(403).json({ error: 'Only the DAO owner can update the withdrawal percentage' });
    }

    // Update the withdrawal percentage
    await updateWithdrawalPercentage(pool, dao.id!, percentageNum);

    console.log(`Updated withdrawal percentage for DAO ${dao.dao_name} to ${percentageNum}% by ${wallet}`);

    res.json({
      success: true,
      dao_pda: daoPda,
      dao_name: dao.dao_name,
      withdrawal_percentage: percentageNum,
    });
  } catch (error) {
    console.error('Error updating withdrawal percentage:', error);
    res.status(500).json({ error: 'Failed to update withdrawal percentage', details: String(error) });
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

    if (!dao.moderator_pda) {
      return res.status(500).json({ error: 'DAO has no moderator PDA' });
    }

    const connection = getConnection();

    // ========== PROPOSAL VALIDATION CHECKS ==========
    // These checks ensure the DAO is ready to create proposals

    // 0. Check proposer authorization using per-DAO settings (DB whitelist + token threshold)
    // Each DAO (parent or child) has independent settings managed via:
    //   - POST/DELETE /dao/:daoPda/proposers (wallet whitelist)
    //   - PUT /dao/:daoPda/proposer-threshold (token balance requirement)
    const proposerAuthResult = await checkDaoProposerAuthorization(
      connection,
      pool,
      dao.id!,
      wallet,
      dao.token_mint
    );
    if (!proposerAuthResult.isAuthorized) {
      return res.status(403).json({
        error: 'Not authorized to propose',
        reason: proposerAuthResult.reason,
        check: 'proposer_authorization',
      });
    }
    // Log authorization method for debugging
    if (proposerAuthResult.authMethod) {
      console.log(`Proposer ${wallet} authorized via: ${proposerAuthResult.authMethod}`);
    } else {
      console.log(`Proposer ${wallet} authorized (no restrictions configured for DAO)`);
    }

    // 1. Check mint authority - mint_auth_multisig must be authority for token_mint
    const mintAuthCheck = await checkMintAuthority(connection, dao.mint_auth_multisig, dao.token_mint);
    if (!mintAuthCheck.ready) {
      return res.status(400).json({
        error: 'DAO not ready for proposals',
        reason: mintAuthCheck.reason,
        check: 'mint_authority',
      });
    }

    // 2. For parent DAOs only: Check token matches pool base token
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

    // 3. Check admin holds LP - for child DAOs, check parent's admin wallet
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

    // 4. Check no active proposal for this moderator
    const activeProposalCheck = await checkNoActiveProposal(connection, dao.moderator_pda);
    if (!activeProposalCheck.ready) {
      return res.status(400).json({
        error: 'DAO not ready for proposals',
        reason: activeProposalCheck.reason,
        check: 'active_proposal',
      });
    }

    console.log('All proposal validation checks passed');

    // ========================================================================
    // LIQUIDITY MANAGEMENT: Withdraw LP before proposal creation
    // ========================================================================
    // Before creating a proposal, we:
    // 1. Call withdraw/build to get unsigned transaction and amounts
    // 2. Sign with admin keypair
    // 3. Call withdraw/confirm to execute the withdrawal
    // 4. Pass withdrawn amounts to SDK's createProposal
    // ========================================================================

    // Get admin keypair for this DAO (needed for signing withdrawal)
    const adminKeypair = await fetchKeypair(dao.admin_key_idx);
    const adminPubkey = adminKeypair.publicKey;

    // Determine pool type and withdrawal percentage (from DAO settings)
    const poolType = lpCheckPoolType;
    const poolAddress = lpCheckPool;
    const withdrawalPercentage = dao.withdrawal_percentage;

    console.log(`Withdrawing ${withdrawalPercentage}% liquidity from ${poolType} pool ${poolAddress}`);

    // Step 1: Call withdraw/build
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const withdrawBuildResponse = await fetch(`${baseUrl}/${poolType}/withdraw/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        withdrawalPercentage,
        poolAddress
      })
    });

    if (!withdrawBuildResponse.ok) {
      const error = await withdrawBuildResponse.json().catch(() => ({}));
      return res.status(500).json({
        error: 'Failed to build withdrawal transaction',
        details: (error as any).error || withdrawBuildResponse.statusText,
        check: 'liquidity_withdrawal'
      });
    }

    const withdrawBuildData = await withdrawBuildResponse.json() as {
      requestId: string;
      transaction?: string;  // DAMM single tx
      transactions?: string[];  // DLMM multi tx
      withdrawn: { tokenA: string; tokenB: string };
      transferred: { tokenA: string; tokenB: string };
      redeposited: { tokenA: string; tokenB: string };
      marketPrice?: string;
    };

    console.log('Withdrawal build response:', {
      requestId: withdrawBuildData.requestId,
      withdrawn: withdrawBuildData.withdrawn,
      transferred: withdrawBuildData.transferred,
    });

    // Step 2: Sign the transaction(s) with admin keypair
    let signedTxBase58: string | undefined;
    let signedTxsBase58: string[] | undefined;

    if (poolType === 'dlmm' && withdrawBuildData.transactions) {
      // DLMM: Sign all transactions in the array
      signedTxsBase58 = withdrawBuildData.transactions.map(txBase58 => {
        const transactionBuffer = bs58.decode(txBase58);
        const unsignedTx = Transaction.from(transactionBuffer);
        unsignedTx.partialSign(adminKeypair);
        return bs58.encode(unsignedTx.serialize({ requireAllSignatures: false }));
      });
      console.log(`Signed ${signedTxsBase58.length} DLMM transactions`);
    } else if (withdrawBuildData.transaction) {
      // DAMM: Sign single transaction
      const transactionBuffer = bs58.decode(withdrawBuildData.transaction);
      const unsignedTx = Transaction.from(transactionBuffer);
      unsignedTx.partialSign(adminKeypair);
      signedTxBase58 = bs58.encode(unsignedTx.serialize({ requireAllSignatures: false }));
      console.log('Signed DAMM transaction');
    } else {
      return res.status(500).json({
        error: 'No transaction(s) returned from withdrawal build',
        check: 'liquidity_withdrawal'
      });
    }

    // Step 3: Call withdraw/confirm to execute the withdrawal
    const withdrawConfirmResponse = await fetch(`${baseUrl}/${poolType}/withdraw/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: withdrawBuildData.requestId,
        signedTransaction: signedTxBase58,       // DAMM
        signedTransactions: signedTxsBase58,     // DLMM
      })
    });

    if (!withdrawConfirmResponse.ok) {
      const error = await withdrawConfirmResponse.json().catch(() => ({}));
      return res.status(500).json({
        error: 'Failed to confirm withdrawal transaction',
        details: (error as any).error || withdrawConfirmResponse.statusText,
        check: 'liquidity_withdrawal'
      });
    }

    const withdrawConfirmData = await withdrawConfirmResponse.json() as {
      signature?: string;
      signatures?: string[];
      transferred: { tokenA: string; tokenB: string };
    };

    console.log('Withdrawal confirmed:', {
      signature: withdrawConfirmData.signature || withdrawConfirmData.signatures,
      transferred: withdrawConfirmData.transferred,
    });

    // Use transferred amounts (what admin received after market-price swap) for AMM initial liquidity
    const baseAmount = new BN(withdrawConfirmData.transferred.tokenA);
    const quoteAmount = new BN(withdrawConfirmData.transferred.tokenB);

    console.log(`Initial AMM liquidity: base=${baseAmount.toString()}, quote=${quoteAmount.toString()}`);

    // Calculate starting observation from liquidity ratio (price = quote/base scaled by PRICE_SCALE)
    // PRICE_SCALE = 10^12 (from @zcomb/programs-sdk/amm/constants)
    const PRICE_SCALE = new BN('1000000000000'); // 10^12

    // Get token decimals for proper price calculation
    // For now, fetch from the DAO's token info
    const baseMintInfo = await getMint(connection, new PublicKey(dao.token_mint));
    const quoteMintInfo = await getMint(connection, new PublicKey(dao.quote_mint));
    const baseDecimals = baseMintInfo.decimals;
    const quoteDecimals = quoteMintInfo.decimals;

    // Calculate starting observation: (quoteAmount / baseAmount) * PRICE_SCALE * 10^(baseDecimals - quoteDecimals)
    let startingObservation: BN;
    if (baseAmount.isZero()) {
      // Fallback to 1:1 price if base amount is zero (shouldn't happen)
      startingObservation = PRICE_SCALE;
    } else {
      const decimalDiff = baseDecimals - quoteDecimals;
      if (decimalDiff >= 0) {
        const multiplier = new BN(10).pow(new BN(decimalDiff));
        startingObservation = quoteAmount.mul(multiplier).mul(PRICE_SCALE).div(baseAmount);
      } else {
        const divisor = new BN(10).pow(new BN(-decimalDiff));
        startingObservation = quoteAmount.mul(PRICE_SCALE).div(baseAmount).div(divisor);
      }
    }

    // Calculate max observation delta as 5% of starting observation
    const maxObservationDelta = startingObservation.mul(new BN(5)).div(new BN(100));

    console.log(`TWAP config: startingObservation=${startingObservation.toString()}, maxObservationDelta=${maxObservationDelta.toString()} (5%)`);

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
      // Create the proposal on-chain using admin keypair (already fetched above)
      const provider = createProvider(adminKeypair);
      const client = new futarchy.FutarchyClient(provider);

      const moderatorPda = new PublicKey(dao.moderator_pda);

      // Create proposal with the SDK using withdrawn liquidity amounts
      // The SDK's createProposal handles: ALT creation -> initializeProposal -> addOption -> launchProposal
      const result = await client.createProposal(
        adminKeypair.publicKey,
        moderatorPda,
        {
          length: length_secs,
          startingObservation,        // Calculated from liquidity ratio
          maxObservationDelta,        // 5% of starting observation
          warmupDuration: 300,        // 5 minutes
          marketBias: 0,              // 0% (Pass Fail Gap)
          fee: 50,                    // 0.5% fee
        },
        baseAmount,  // From liquidity withdrawal
        quoteAmount, // From liquidity withdrawal
        options.length,
        metadataCid,
      );

      // Execute the transactions in order: initialize -> addOptions -> launch
      // The SDK returns separate builders that must be executed sequentially
      await result.initializeBuilder.rpc();

      for (const addOptionBuilder of result.addOptionBuilders) {
        await addOptionBuilder.rpc();
      }

      await result.launchBuilder.rpc();

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

// ============================================================================
// ============================================================================
// Mutex locks for preventing concurrent processing of proposals
// ============================================================================
const proposalLocks = new Map<string, Promise<void>>();

/**
 * Acquire a lock for a specific proposal
 * Prevents race conditions during redemption/deposit-back operations
 */
async function acquireProposalLock(proposalPda: string): Promise<() => void> {
  const key = `proposal:${proposalPda}`;

  // Wait for any existing lock to be released
  while (proposalLocks.has(key)) {
    await proposalLocks.get(key);
  }

  // Create a new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  proposalLocks.set(key, lockPromise);

  // Return the release function
  return () => {
    proposalLocks.delete(key);
    releaseLock!();
  };
}

// POST /dao/redeem-liquidity - Redeem liquidity from resolved proposal
// ============================================================================
// Called by os-percent after finalizing a proposal.
// This endpoint:
// 1. Fetches proposal from chain and derives DAO from its moderator
// 2. Verifies proposal is in "Resolved" state (on-chain)
// 3. Gets admin keypair from key service
// 4. Calls SDK redeemLiquidity() to withdraw liquidity and redeem tokens
// ============================================================================

router.post('/redeem-liquidity', async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;
  try {
    const { proposal_pda } = req.body;

    // Validate required fields
    if (!proposal_pda) {
      return res.status(400).json({
        error: 'Missing required field: proposal_pda'
      });
    }

    // Validate PDA is valid public key
    if (!isValidTokenMintAddress(proposal_pda)) {
      return res.status(400).json({ error: 'Invalid proposal_pda' });
    }

    // Acquire lock to prevent concurrent operations on this proposal
    console.log(`Acquiring lock for proposal ${proposal_pda}`);
    releaseLock = await acquireProposalLock(proposal_pda);
    console.log(`Lock acquired for proposal ${proposal_pda}`);

    const pool = getPool();
    const connection = getConnection();

    // Create a read-only provider to fetch proposal first
    const readProvider = new AnchorProvider(
      connection,
      { publicKey: PublicKey.default, signTransaction: async (tx: Transaction) => tx, signAllTransactions: async (txs: Transaction[]) => txs } as any,
      { commitment: 'confirmed' }
    );
    const readClient = new futarchy.FutarchyClient(readProvider);

    // Fetch proposal from on-chain
    const proposalPubkey = new PublicKey(proposal_pda);
    let proposal;
    try {
      proposal = await readClient.fetchProposal(proposalPubkey);
    } catch (err) {
      return res.status(404).json({
        error: 'Proposal not found on-chain',
        details: String(err)
      });
    }

    // Parse proposal state and verify it's resolved
    const { state, winningIdx } = futarchy.parseProposalState(proposal.state);
    if (state !== futarchy.ProposalState.Resolved) {
      return res.status(400).json({
        error: 'Proposal is not resolved',
        state,
        message: 'Call finalizeProposal() first to resolve the proposal'
      });
    }

    // Get moderator PDA from proposal and lookup DAO
    const moderatorPda = proposal.moderator.toBase58();
    const dao = await getDaoByModeratorPda(pool, moderatorPda);
    if (!dao) {
      return res.status(404).json({
        error: 'DAO not found for this proposal',
        moderator_pda: moderatorPda,
        message: 'This proposal belongs to a moderator not registered in our system'
      });
    }

    if (dao.admin_key_idx === undefined || dao.admin_key_idx === null) {
      return res.status(500).json({ error: 'DAO has no admin key index' });
    }

    // Get admin keypair
    const adminKeypair = await fetchKeypair(dao.admin_key_idx);

    // Create provider and client with admin keypair
    const provider = createProvider(adminKeypair);
    const client = new futarchy.FutarchyClient(provider);

    console.log(`Redeeming liquidity for proposal ${proposal_pda}`);
    console.log(`  Winning index: ${winningIdx}`);
    console.log(`  DAO: ${dao.dao_name} (${dao.dao_pda})`);

    // Call SDK redeemLiquidity
    const { builder } = await client.redeemLiquidity(
      adminKeypair.publicKey,
      proposalPubkey
    );

    // Execute the transaction
    const tx = await builder.rpc();

    console.log(`Liquidity redeemed successfully: ${tx}`);

    res.json({
      success: true,
      proposal_pda,
      dao_pda: dao.dao_pda,
      winning_index: winningIdx,
      transaction: tx,
    });
  } catch (error) {
    console.error('Error redeeming liquidity:', error);
    res.status(500).json({
      error: 'Failed to redeem liquidity',
      details: String(error)
    });
  } finally {
    // Always release the lock
    if (releaseLock) {
      releaseLock();
      console.log(`Lock released for proposal ${req.body.proposal_pda}`);
    }
  }
});

// ============================================================================
// POST /dao/deposit-back - Return liquidity to Meteora pool after redemption
// ============================================================================
// Called by os-percent after redeeming liquidity from a proposal.
// This endpoint:
// 1. Fetches proposal from chain and derives DAO from its moderator
// 2. Checks if admin wallet has meaningful token balance (>0.5% of supply)
// 3. Transfers tokens from admin wallet to LP owner
// 4. Calls cleanup swap + deposit to return liquidity to Meteora pool
// ============================================================================

router.post('/deposit-back', async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;
  try {
    const { proposal_pda } = req.body;

    // Validate required fields
    if (!proposal_pda) {
      return res.status(400).json({
        error: 'Missing required field: proposal_pda'
      });
    }

    // Validate PDA is valid public key
    if (!isValidTokenMintAddress(proposal_pda)) {
      return res.status(400).json({ error: 'Invalid proposal_pda' });
    }

    // Acquire lock to prevent concurrent operations on this proposal
    console.log(`Acquiring lock for deposit-back ${proposal_pda}`);
    releaseLock = await acquireProposalLock(proposal_pda);
    console.log(`Lock acquired for deposit-back ${proposal_pda}`);

    const pool = getPool();
    const connection = getConnection();

    // Create a read-only provider to fetch proposal first
    const readProvider = new AnchorProvider(
      connection,
      { publicKey: PublicKey.default, signTransaction: async (tx: Transaction) => tx, signAllTransactions: async (txs: Transaction[]) => txs } as any,
      { commitment: 'confirmed' }
    );
    const readClient = new futarchy.FutarchyClient(readProvider);

    // Fetch proposal from on-chain
    const proposalPubkey = new PublicKey(proposal_pda);
    let proposal;
    try {
      proposal = await readClient.fetchProposal(proposalPubkey);
    } catch (err) {
      return res.status(404).json({
        error: 'Proposal not found on-chain',
        details: String(err)
      });
    }

    // Parse proposal state and verify it's resolved
    const { state } = futarchy.parseProposalState(proposal.state);
    if (state !== futarchy.ProposalState.Resolved) {
      return res.status(400).json({
        error: 'Proposal is not resolved',
        state,
        message: 'Proposal must be resolved before deposit-back'
      });
    }

    // Get moderator PDA from proposal and lookup DAO
    const moderatorPda = proposal.moderator.toBase58();
    const dao = await getDaoByModeratorPda(pool, moderatorPda);
    if (!dao) {
      return res.status(404).json({
        error: 'DAO not found for this proposal',
        moderator_pda: moderatorPda,
        message: 'This proposal belongs to a moderator not registered in our system'
      });
    }

    if (dao.admin_key_idx === undefined || dao.admin_key_idx === null) {
      return res.status(500).json({ error: 'DAO has no admin key index' });
    }

    if (!dao.pool_address) {
      return res.status(500).json({ error: 'DAO has no pool address' });
    }

    if (!dao.token_mint) {
      return res.status(500).json({ error: 'DAO has no token mint' });
    }

    // Get admin keypair
    const adminKeypair = await fetchKeypair(dao.admin_key_idx);
    const adminPubkey = adminKeypair.publicKey;

    console.log(`Deposit-back for proposal ${proposal_pda}`);
    console.log(`  DAO: ${dao.dao_name} (${dao.dao_pda})`);
    console.log(`  Pool: ${dao.pool_address} (${dao.pool_type})`);
    console.log(`  Admin wallet: ${adminPubkey.toBase58()}`);

    // Check if admin wallet has meaningful token balance (>0.5% of supply)
    const tokenMint = new PublicKey(dao.token_mint);
    const mintInfo = await connection.getParsedAccountInfo(tokenMint);
    if (!mintInfo.value || !('parsed' in mintInfo.value.data)) {
      return res.status(500).json({ error: 'Failed to fetch token mint info' });
    }

    const mintData = mintInfo.value.data.parsed;
    const totalSupply = BigInt(mintData.info.supply);
    const decimals = mintData.info.decimals;

    // Get admin's token balance
    const adminAta = await getAssociatedTokenAddress(tokenMint, adminPubkey);
    let adminBalance = BigInt(0);
    try {
      const accountInfo = await connection.getTokenAccountBalance(adminAta);
      adminBalance = BigInt(accountInfo.value.amount);
    } catch {
      // Account doesn't exist or has no balance
      console.log(`  Admin has no token account or zero balance`);
    }

    // Calculate percentage (with precision)
    const balancePercent = (adminBalance * BigInt(10000)) / totalSupply; // basis points
    const percentFormatted = Number(balancePercent) / 100;

    console.log(`  Admin token balance: ${adminBalance} (${percentFormatted.toFixed(2)}% of supply)`);

    // If balance < 0.5% of supply, skip deposit-back
    if (balancePercent < BigInt(50)) { // 50 basis points = 0.5%
      console.log(`  Balance too small for deposit-back (< 0.5%), skipping`);
      return res.json({
        success: true,
        proposal_pda,
        dao_pda: dao.dao_pda,
        skipped: true,
        reason: 'Admin token balance below 0.5% threshold',
        balance_percent: percentFormatted,
      });
    }

    // Get pool config to find LP owner address
    const poolConfigUrl = `${req.protocol}://${req.get('host')}/${dao.pool_type}/pool/${dao.pool_address}/config`;
    const poolConfigResponse = await fetch(poolConfigUrl);
    if (!poolConfigResponse.ok) {
      return res.status(500).json({
        error: 'Failed to fetch pool config',
        details: await poolConfigResponse.text()
      });
    }
    const poolConfig = await poolConfigResponse.json() as { lpOwnerAddress: string; managerAddress: string };
    const lpOwnerPubkey = new PublicKey(poolConfig.lpOwnerAddress);

    console.log(`  LP Owner: ${lpOwnerPubkey.toBase58()}`);

    // Step 1: Transfer tokens from admin to LP owner
    // Get quote mint from pool (SOL or other)
    const quoteMint = new PublicKey(dao.quote_mint);
    const isQuoteNativeSOL = quoteMint.equals(NATIVE_MINT);

    // Reserve SOL for transaction fees + rent (0.1 SOL)
    const SOL_RESERVE = BigInt(100_000_000);

    // Get admin's quote balance (native SOL or SPL token)
    let adminQuoteBalance = BigInt(0);
    if (isQuoteNativeSOL) {
      // For native SOL, get lamport balance minus reserve
      const solBalance = await connection.getBalance(adminPubkey);
      adminQuoteBalance = BigInt(solBalance) > SOL_RESERVE
        ? BigInt(solBalance) - SOL_RESERVE
        : BigInt(0);
      console.log(`  Admin native SOL balance: ${solBalance} lamports (transferring ${adminQuoteBalance})`);
    } else {
      // For SPL tokens, get token account balance
      const adminQuoteAta = await getAssociatedTokenAddress(quoteMint, adminPubkey);
      try {
        const quoteAccountInfo = await connection.getTokenAccountBalance(adminQuoteAta);
        adminQuoteBalance = BigInt(quoteAccountInfo.value.amount);
      } catch {
        // Account doesn't exist
      }
    }

    // Build transfer transactions
    const { Transaction: SolanaTransaction } = await import('@solana/web3.js');
    const { createTransferInstruction, createAssociatedTokenAccountIdempotentInstruction } = await import('@solana/spl-token');

    const transferTx = new SolanaTransaction();
    const { blockhash } = await connection.getLatestBlockhash();
    transferTx.recentBlockhash = blockhash;
    transferTx.feePayer = adminPubkey;

    // Transfer base token (always SPL token)
    if (adminBalance > BigInt(0)) {
      const lpOwnerAta = await getAssociatedTokenAddress(tokenMint, lpOwnerPubkey);
      transferTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          adminPubkey,
          lpOwnerAta,
          lpOwnerPubkey,
          tokenMint
        )
      );
      transferTx.add(
        createTransferInstruction(
          adminAta,
          lpOwnerAta,
          adminPubkey,
          adminBalance
        )
      );
    }

    // Transfer quote token (native SOL or SPL token)
    if (adminQuoteBalance > BigInt(0)) {
      if (isQuoteNativeSOL) {
        // Native SOL - use SystemProgram.transfer
        transferTx.add(
          SystemProgram.transfer({
            fromPubkey: adminPubkey,
            toPubkey: lpOwnerPubkey,
            lamports: adminQuoteBalance,
          })
        );
        console.log(`  Adding native SOL transfer: ${adminQuoteBalance} lamports`);
      } else {
        // SPL token - use token transfer
        const adminQuoteAta = await getAssociatedTokenAddress(quoteMint, adminPubkey);
        const lpOwnerQuoteAta = await getAssociatedTokenAddress(quoteMint, lpOwnerPubkey);
        transferTx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            adminPubkey,
            lpOwnerQuoteAta,
            lpOwnerPubkey,
            quoteMint
          )
        );
        transferTx.add(
          createTransferInstruction(
            adminQuoteAta,
            lpOwnerQuoteAta,
            adminPubkey,
            adminQuoteBalance
          )
        );
      }
    }

    let transferSignature = '';
    if (transferTx.instructions.length > 0) {
      transferTx.sign(adminKeypair);
      transferSignature = await connection.sendRawTransaction(transferTx.serialize());
      await connection.confirmTransaction(transferSignature, 'confirmed');
      console.log(`  Transfer to LP owner: ${transferSignature}`);
    }

    // Step 2: Call cleanup swap + deposit via internal endpoints
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const poolType = dao.pool_type;

    // Build cleanup swap
    let swapSignature = '';
    const swapBuildResponse = await fetch(`${baseUrl}/${poolType}/cleanup/swap/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poolAddress: dao.pool_address })
    });

    if (swapBuildResponse.ok) {
      const swapBuildData = await swapBuildResponse.json() as {
        requestId: string;
        transaction: string;
      };

      // Sign the swap transaction
      const swapTxBuffer = bs58.decode(swapBuildData.transaction);
      const swapTx = Transaction.from(swapTxBuffer);
      swapTx.partialSign(adminKeypair);
      const signedSwapTx = bs58.encode(swapTx.serialize({ requireAllSignatures: false }));

      // Confirm swap
      const swapConfirmResponse = await fetch(`${baseUrl}/${poolType}/cleanup/swap/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedTransaction: signedSwapTx,
          requestId: swapBuildData.requestId
        })
      });

      if (swapConfirmResponse.ok) {
        const swapConfirmData = await swapConfirmResponse.json() as { signature: string };
        swapSignature = swapConfirmData.signature;
        console.log(`  Cleanup swap: ${swapSignature}`);
      }
    } else {
      // No swap needed or error - continue to deposit
      const swapError = await swapBuildResponse.json().catch(() => ({}));
      console.log(`  Cleanup swap skipped: ${(swapError as any).error || 'unknown'}`);
    }

    // Build deposit (0, 0 = cleanup mode - uses LP owner balances)
    let depositSignature = '';
    const depositBuildResponse = await fetch(`${baseUrl}/${poolType}/deposit/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poolAddress: dao.pool_address,
        tokenAAmount: 0,
        tokenBAmount: 0
      })
    });

    if (depositBuildResponse.ok) {
      const depositBuildData = await depositBuildResponse.json() as {
        requestId: string;
        transaction: string;
      };

      // Sign the deposit transaction
      const depositTxBuffer = bs58.decode(depositBuildData.transaction);
      const depositTx = Transaction.from(depositTxBuffer);
      depositTx.partialSign(adminKeypair);
      const signedDepositTx = bs58.encode(depositTx.serialize({ requireAllSignatures: false }));

      // Confirm deposit
      const depositConfirmResponse = await fetch(`${baseUrl}/${poolType}/deposit/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedTransaction: signedDepositTx,
          requestId: depositBuildData.requestId
        })
      });

      if (depositConfirmResponse.ok) {
        const depositConfirmData = await depositConfirmResponse.json() as { signature: string };
        depositSignature = depositConfirmData.signature;
        console.log(`  Deposit: ${depositSignature}`);
      } else {
        const depositError = await depositConfirmResponse.json().catch(() => ({}));
        console.log(`  Deposit failed: ${(depositError as any).error || 'unknown'}`);
      }
    } else {
      const depositError = await depositBuildResponse.json().catch(() => ({}));
      console.log(`  Deposit build failed: ${(depositError as any).error || 'unknown'}`);
    }

    console.log(`Deposit-back completed for proposal ${proposal_pda}`);

    res.json({
      success: true,
      proposal_pda,
      dao_pda: dao.dao_pda,
      transfer_signature: transferSignature || null,
      swap_signature: swapSignature || null,
      deposit_signature: depositSignature || null,
    });
  } catch (error) {
    console.error('Error in deposit-back:', error);
    res.status(500).json({
      error: 'Failed to complete deposit-back',
      details: String(error)
    });
  } finally {
    // Always release the lock
    if (releaseLock) {
      releaseLock();
      console.log(`Lock released for deposit-back ${req.body.proposal_pda}`);
    }
  }
});

export default router;
