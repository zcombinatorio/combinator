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
import { Connection, PublicKey, Transaction, SystemProgram, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { getMint, getAccount, getAssociatedTokenAddress, NATIVE_MINT } from '@solana/spl-token';
import * as nacl from 'tweetnacl';
import * as crypto from 'crypto';
import bs58 from 'bs58';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { futarchy } from '@zcomb/programs-sdk';
import { CpAmm, feeNumeratorToBps, getFeeNumerator } from '@meteora-ag/cp-amm-sdk';
import DLMM from '@meteora-ag/dlmm';
import * as multisig from '@sqds/multisig';

// Squads v4 program ID (same as used by @zcomb/programs-sdk)
const SQUADS_PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

/**
 * Derive the Squads vault PDA from a multisig PDA.
 * The vault is where assets should be transferred to, NOT the multisig itself.
 * Sending to the multisig address instead of the vault leads to permanently lost funds!
 *
 * @param multisigPda - The Squads multisig PDA
 * @param index - Vault index (0 for default vault)
 * @returns The vault PDA
 */
function deriveSquadsVaultPda(multisigPda: PublicKey, index: number = 0): PublicKey {
  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index,
    programId: SQUADS_PROGRAM_ID,
  });
  return vaultPda;
}
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
import { uploadProposalMetadata, getIpfsUrl } from '../lib/ipfs';
import { getTokenIcon, getTokenIcons } from '../lib/tokenMetadata';

const router = Router();

// ============================================================================
// In-memory proposal count cache
// ============================================================================
// Caches proposal counts per DAO to avoid expensive on-chain fetches on the
// projects page. Populated lazily when proposals are fetched, updated on
// proposal creation. No TTL needed since we control proposal creation.
const proposalCountCache = new Map<string, number>();

/**
 * Get cached proposal count for a DAO.
 * Returns undefined if not cached (needs to be fetched).
 */
export function getCachedProposalCount(daoPda: string): number | undefined {
  return proposalCountCache.get(daoPda);
}

/**
 * Set the proposal count cache for a DAO.
 * Called after fetching proposals from chain.
 */
export function setCachedProposalCount(daoPda: string, count: number): void {
  proposalCountCache.set(daoPda, count);
}

/**
 * Increment the proposal count cache for a DAO.
 * Called after successfully creating a proposal.
 */
export function incrementProposalCount(daoPda: string): void {
  const current = proposalCountCache.get(daoPda);
  if (current !== undefined) {
    proposalCountCache.set(daoPda, current + 1);
  }
  // If not cached, don't initialize - let it be populated on next fetch
}

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
 * Note: Returns vault PDAs, not multisig PDAs (vaults are where assets should go)
 */
function mockInitializeParentDAO(name: string) {
  return {
    daoPda: mockPublicKey(`dao:parent:${name}`),
    moderatorPda: mockPublicKey(`moderator:${name}`),
    treasuryVault: mockPublicKey(`treasury-vault:${name}`),
    mintVault: mockPublicKey(`mint-vault:${name}`),
    tx: mockTxSignature(),
  };
}

/**
 * Mock response for initializeChildDAO
 * Note: Returns vault PDAs, not multisig PDAs (vaults are where assets should go)
 */
function mockInitializeChildDAO(parentName: string, childName: string) {
  return {
    daoPda: mockPublicKey(`dao:child:${parentName}:${childName}`),
    treasuryVault: mockPublicKey(`treasury-vault:child:${childName}`),
    mintVault: mockPublicKey(`mint-vault:child:${childName}`),
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

    // Check proposal state - only block if Pending and not expired
    // Setup state is allowed: each proposal has its own vault/pools (no shared state)
    // ProposalState is an enum-like object: { setup: {} } | { pending: {} } | { resolved: {} }
    const stateKey = Object.keys(proposal.state)[0];
    const isPending = stateKey === 'pending';
    const isExpired = client.isProposalExpired(proposal);

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
  feeBps: number;  // Pool trading fee in basis points (e.g., 50 = 0.5%)
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

    // Calculate STEADY STATE fee rate (after all decay periods complete)
    // DAMM pools can have time-decaying fees, so we need to check what the
    // minimum fee will be to ensure the DAO always receives sufficient fees.
    // Compute a point far enough in the future that all periods have elapsed:
    // steadyStatePoint = activationPoint + (numberOfPeriod + 1) * periodFrequency
    const baseFee = poolState.poolFees.baseFee;
    const steadyStatePoint = poolState.activationPoint
      .add(baseFee.periodFrequency.muln(baseFee.numberOfPeriod + 1))
      .toNumber();

    const steadyStateFeeNumerator = getFeeNumerator(
      steadyStatePoint,
      poolState.activationPoint,
      baseFee.numberOfPeriod,
      baseFee.periodFrequency,
      baseFee.feeSchedulerMode,
      baseFee.cliffFeeNumerator,
      baseFee.reductionFactor,
    );

    const feeBps = feeNumeratorToBps(steadyStateFeeNumerator);
    return {
      poolType: 'damm',
      tokenAMint: poolState.tokenAMint.toBase58(),
      tokenBMint: poolState.tokenBMint.toBase58(),
      feeBps,
    };
  } else if (owner.equals(DLMM_PROGRAM_ID)) {
    // DLMM pool - use DLMM SDK
    const dlmmPool = await DLMM.create(connection, poolAddress);
    // Use SDK's getFeeInfo() which correctly calculates:
    // baseFee = baseFactor * binStep * 10 * 10^baseFeePowerFactor
    // Returns baseFeeRatePercentage as a Decimal (0-100%), multiply by 100 to get bps
    const feeInfo = dlmmPool.getFeeInfo();
    const feeBps = feeInfo.baseFeeRatePercentage.mul(100).toNumber();
    return {
      poolType: 'dlmm',
      tokenAMint: dlmmPool.lbPair.tokenXMint.toBase58(),
      tokenBMint: dlmmPool.lbPair.tokenYMint.toBase58(),
      feeBps,
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
    const connection = getConnection();
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

    // Batch fetch token icons for all DAOs
    const tokenMints = daos.map(dao => dao.token_mint);
    const iconMap = await getTokenIcons(connection, tokenMints);

    // Enrich with stats, icons, strip internal fields, and rename DB columns to API fields
    const enrichedDaos = await Promise.all(
      daos.map(async (dao) => {
        const stats = await getDaoStats(pool, dao.id!);
        const { admin_key_idx, treasury_multisig, mint_auth_multisig, ...rest } = dao;
        // Get proposal count from cache (undefined if not yet fetched)
        const proposalCount = getCachedProposalCount(dao.dao_pda);
        // Get icon from token metadata
        const icon = iconMap.get(dao.token_mint) || null;
        return {
          ...rest,
          treasury_vault: treasury_multisig,
          mint_vault: mint_auth_multisig,
          icon,
          stats: {
            ...stats,
            proposalCount,
          },
        };
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
    const connection = getConnection();

    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    const stats = await getDaoStats(pool, dao.id!);
    const proposers = await getProposersByDao(pool, dao.id!);

    // Fetch token icon from metadata
    const icon = await getTokenIcon(connection, dao.token_mint);

    // If parent, also fetch child DAOs (strip internal fields)
    let children: any[] = [];
    if (dao.dao_type === 'parent') {
      const childDaos = await getChildDaos(pool, dao.id!);
      children = childDaos.map(({ admin_key_idx, ...child }) => child);
    }

    // Strip internal fields and rename DB columns to API fields
    const { admin_key_idx, treasury_multisig, mint_auth_multisig, ...rest } = dao;

    // Also rename fields in children
    const renamedChildren = children.map((child: any) => {
      const { treasury_multisig: tv, mint_auth_multisig: mv, ...childRest } = child;
      return { ...childRest, treasury_vault: tv, mint_vault: mv };
    });

    // Get proposal count from cache (undefined if not yet fetched)
    const proposalCount = getCachedProposalCount(daoPda);

    res.json({
      ...rest,
      treasury_vault: treasury_multisig,
      mint_vault: mint_auth_multisig,
      icon,
      stats: {
        ...stats,
        proposalCount,
      },
      proposers,
      children: renamedChildren,
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
// GET /dao/:daoPda/proposals - Get all proposals for a DAO
// ============================================================================
// Reads on-chain (source of truth): fetches moderator's proposalIdCounter,
// derives all proposal PDAs, fetches each proposal's state and metadata.
// UI can filter by status (Pending for live, Passed/Failed for history).

router.get('/:daoPda/proposals', async (req: Request, res: Response) => {
  try {
    const { daoPda } = req.params;
    const connection = getConnection();

    // Look up DAO to get moderator PDA (still need DB for DAO verification)
    const pool = getPool();
    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    // Get the moderator PDA - for child DAOs, use parent's moderator
    let moderatorPda = dao.moderator_pda;
    if (!moderatorPda && dao.parent_dao_id) {
      // Child DAO - get moderator from parent
      const parentDao = await getDaoById(pool, dao.parent_dao_id);
      if (parentDao?.moderator_pda) {
        moderatorPda = parentDao.moderator_pda;
      }
    }

    if (!moderatorPda) {
      return res.json({ proposals: [] });
    }

    // Create a read-only client for on-chain fetching
    const readProvider = new AnchorProvider(
      connection,
      { signTransaction: async () => { throw new Error('Read-only'); }, signAllTransactions: async () => { throw new Error('Read-only'); }, publicKey: PublicKey.default } as unknown as Wallet,
      { commitment: 'confirmed', skipPreflight: true }
    );
    const readClient = new futarchy.FutarchyClient(readProvider);

    // Fetch moderator from chain to get the proposal count (on-chain is source of truth)
    const moderatorPubkey = new PublicKey(moderatorPda);
    let proposalCount = 0;
    try {
      const moderator = await readClient.fetchModerator(moderatorPubkey);
      proposalCount = moderator.proposalIdCounter;
    } catch (err) {
      console.error(`Failed to fetch moderator ${moderatorPda}:`, err);
      return res.status(500).json({ error: 'Failed to fetch moderator from chain' });
    }

    if (proposalCount === 0) {
      return res.json({ proposals: [] });
    }

    // Fetch all proposals (0 to proposalCount-1) directly from chain
    const proposals = await Promise.all(
      Array.from({ length: proposalCount }, (_, i) => i).map(async (proposalId) => {
        // Derive the proposal PDA
        const [proposalPda] = readClient.deriveProposalPDA(moderatorPubkey, proposalId);
        const proposalPdaStr = proposalPda.toBase58();

        let title = `Proposal #${proposalId}`;
        let description = '';
        let options: string[] = ['Pass', 'Fail'];
        let status: 'Setup' | 'Pending' | 'Resolved' = 'Pending';
        let finalizedAt: number | null = null;
        let endsAt: number | null = null;
        let createdAt: number = Date.now();
        let metadataCid: string | null = null;
        let metadataDaoPda: string | null = null;
        let winningIndex: number | null = null;
        let vault: string = '';

        // Fetch on-chain state
        try {
          const proposalAccount = await readClient.fetchProposal(proposalPda);
          const parsedState = futarchy.parseProposalState(proposalAccount.state);

          // Get timing info from on-chain
          const proposalLength = proposalAccount.config.length; // in seconds
          createdAt = proposalAccount.createdAt.toNumber() * 1000; // Convert to milliseconds
          endsAt = createdAt + (proposalLength * 1000);

          // Get metadata CID and vault from on-chain
          metadataCid = proposalAccount.metadata || null;
          vault = proposalAccount.vault.toBase58();

          // Determine status
          if (parsedState.state === 'setup') {
            status = 'Setup';
          } else if (parsedState.state === 'resolved') {
            status = 'Resolved';
            winningIndex = parsedState.winningIdx;
            finalizedAt = Date.now(); // Approximate
          } else {
            status = 'Pending';
          }
        } catch (err) {
          // Proposal might be closed or inaccessible
          console.warn(`Failed to fetch on-chain state for proposal ${proposalId} (${proposalPdaStr}):`, err);
          return null;
        }

        // Fetch IPFS metadata if available
        if (metadataCid) {
          try {
            const metadataRes = await fetch(`${getIpfsUrl(metadataCid)}`);
            if (metadataRes.ok) {
              const metadata = await metadataRes.json();
              title = metadata.title || title;
              description = metadata.description || description;
              options = metadata.options || options;
              metadataDaoPda = metadata.dao_pda || null;
            }
          } catch (err) {
            console.warn(`Failed to fetch IPFS metadata for ${metadataCid}:`, err);
          }
        }

        return {
          id: proposalId,
          proposalPda: proposalPdaStr,
          title,
          description,
          options,
          status,
          winningIndex,
          vault,
          createdAt,
          endsAt,
          finalizedAt,
          metadataCid,
          metadataDaoPda,
        };
      })
    );

    // Filter out null entries (failed fetches), filter by dao_pda matching requested DAO,
    // and sort by ID descending (newest first)
    const validProposals = proposals
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .filter((p) => p.metadataDaoPda === daoPda)
      .sort((a, b) => b.id - a.id);

    // Cache the proposal count for this DAO
    setCachedProposalCount(daoPda, validProposals.length);

    res.json({ proposals: validProposals });
  } catch (error) {
    console.error('Error fetching proposals:', error);
    res.status(500).json({ error: 'Failed to fetch proposals' });
  }
});

// ============================================================================
// GET /dao/proposals/all - Get all proposals from all DAOs
// ============================================================================
// Aggregates proposals from all futarchy DAOs for the markets page.
// Returns proposals with DAO metadata (name, icon, daoPda).

router.get('/proposals/all', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const connection = getConnection();

    // Fetch all DAOs (including unverified)
    const allDaos = await getAllDaos(pool);

    if (allDaos.length === 0) {
      return res.json({ proposals: [] });
    }

    // Batch fetch token icons for all DAOs
    const tokenMints = allDaos.map(dao => dao.token_mint);
    const iconMap = await getTokenIcons(connection, tokenMints);

    // Create a read-only client for on-chain fetching
    const readProvider = new AnchorProvider(
      connection,
      { signTransaction: async () => { throw new Error('Read-only'); }, signAllTransactions: async () => { throw new Error('Read-only'); }, publicKey: PublicKey.default } as unknown as Wallet,
      { commitment: 'confirmed', skipPreflight: true }
    );
    const readClient = new futarchy.FutarchyClient(readProvider);

    // Fetch proposals from all DAOs in parallel
    const allProposals = await Promise.all(
      allDaos.map(async (dao) => {
        // Get moderator PDA - for child DAOs, use parent's moderator
        let moderatorPda = dao.moderator_pda;
        if (!moderatorPda && dao.parent_dao_id) {
          const parentDao = await getDaoById(pool, dao.parent_dao_id);
          if (parentDao?.moderator_pda) {
            moderatorPda = parentDao.moderator_pda;
          }
        }

        if (!moderatorPda) {
          return [];
        }

        const moderatorPubkey = new PublicKey(moderatorPda);
        let proposalCount = 0;

        try {
          const moderator = await readClient.fetchModerator(moderatorPubkey);
          proposalCount = moderator.proposalIdCounter;
        } catch (err: any) {
          // Don't log full stack for expected "account does not exist" errors (test DAOs, failed creations)
          const errMsg = err?.message || String(err);
          if (errMsg.includes('Account does not exist')) {
            // Expected for unverified/test DAOs - skip silently
          } else {
            console.warn(`Failed to fetch moderator ${moderatorPda} for DAO ${dao.dao_name}:`, err);
          }
          return [];
        }

        if (proposalCount === 0) {
          return [];
        }

        // Fetch all proposals for this DAO
        const proposals = await Promise.all(
          Array.from({ length: proposalCount }, (_, i) => i).map(async (proposalId) => {
            const [proposalPda] = readClient.deriveProposalPDA(moderatorPubkey, proposalId);
            const proposalPdaStr = proposalPda.toBase58();

            let title = `Proposal #${proposalId}`;
            let description = '';
            let options: string[] = ['Pass', 'Fail'];
            let status: 'Setup' | 'Pending' | 'Resolved' = 'Pending';
            let finalizedAt: number | null = null;
            let endsAt: number | null = null;
            let createdAt: number = Date.now();
            let metadataCid: string | null = null;
            let metadataDaoPda: string | null = null;
            let winningIndex: number | null = null;
            let vault: string = '';

            try {
              const proposalAccount = await readClient.fetchProposal(proposalPda);
              const parsedState = futarchy.parseProposalState(proposalAccount.state);

              const proposalLength = proposalAccount.config.length;
              createdAt = proposalAccount.createdAt.toNumber() * 1000;
              endsAt = createdAt + (proposalLength * 1000);
              metadataCid = proposalAccount.metadata || null;
              vault = proposalAccount.vault.toBase58();

              if (parsedState.state === 'setup') {
                status = 'Setup';
              } else if (parsedState.state === 'resolved') {
                status = 'Resolved';
                winningIndex = parsedState.winningIdx;
                finalizedAt = Date.now();
              } else {
                status = 'Pending';
              }
            } catch (err) {
              console.warn(`Failed to fetch proposal ${proposalId} for DAO ${dao.dao_name}:`, err);
              return null;
            }

            // Fetch IPFS metadata
            let metadataFetchSucceeded = false;
            if (metadataCid) {
              try {
                const metadataRes = await fetch(`${getIpfsUrl(metadataCid)}`);
                if (metadataRes.ok) {
                  const metadata = await metadataRes.json();
                  title = metadata.title || title;
                  description = metadata.description || description;
                  options = metadata.options || options;
                  metadataDaoPda = metadata.dao_pda || null;
                  metadataFetchSucceeded = true;
                }
              } catch (err) {
                console.warn(`Failed to fetch IPFS metadata for ${metadataCid}:`, err);
              }
            }

            // Only filter out proposals if we successfully fetched metadata and it belongs to a different DAO.
            // If metadata fetch failed, include the proposal (don't silently drop it due to IPFS issues).
            // This check is important for child DAOs that share the parent's moderator.
            if (metadataFetchSucceeded && metadataDaoPda !== dao.dao_pda) {
              return null;
            }

            return {
              id: proposalId,
              proposalPda: proposalPdaStr,
              title,
              description,
              options,
              status,
              winningIndex,
              vault,
              createdAt,
              endsAt,
              finalizedAt,
              metadataCid,
              // DAO metadata for markets page
              daoPda: dao.dao_pda,
              daoName: dao.dao_name,
              tokenMint: dao.token_mint,
              tokenIcon: iconMap.get(dao.token_mint) || null,
            };
          })
        );

        // Filter out nulls and Setup status, update proposal count cache
        const validProposals = proposals.filter((p): p is NonNullable<typeof p> => p !== null && p.status !== 'Setup');
        setCachedProposalCount(dao.dao_pda, validProposals.length);

        return validProposals;
      })
    );

    // Flatten and sort by createdAt descending (newest first)
    const flattenedProposals = allProposals
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt);

    res.json({ proposals: flattenedProposals });
  } catch (error) {
    console.error('Error fetching all proposals:', error);
    res.status(500).json({ error: 'Failed to fetch proposals' });
  }
});

// ============================================================================
// GET /dao/proposal/:proposalPda - Get a single proposal by PDA
// ============================================================================
// Reads proposal directly from on-chain, fetches IPFS metadata.

router.get('/proposal/:proposalPda', async (req: Request, res: Response) => {
  try {
    const { proposalPda } = req.params;
    const connection = getConnection();

    // Validate the PDA
    if (!isValidTokenMintAddress(proposalPda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    const proposalPubkey = new PublicKey(proposalPda);

    // Create a read-only client for on-chain fetching
    const readProvider = new AnchorProvider(
      connection,
      { signTransaction: async () => { throw new Error('Read-only'); }, signAllTransactions: async () => { throw new Error('Read-only'); }, publicKey: PublicKey.default } as unknown as Wallet,
      { commitment: 'confirmed', skipPreflight: true }
    );
    const readClient = new futarchy.FutarchyClient(readProvider);

    // Fetch proposal from on-chain
    let proposalAccount;
    try {
      proposalAccount = await readClient.fetchProposal(proposalPubkey);
    } catch (err) {
      console.error(`Failed to fetch proposal ${proposalPda} from chain:`, err);
      return res.status(404).json({ error: 'Proposal not found on-chain' });
    }

    // Parse on-chain state
    const parsedState = futarchy.parseProposalState(proposalAccount.state);
    let status: 'Setup' | 'Pending' | 'Resolved' = 'Pending';
    let winningIndex: number | null = null;
    if (parsedState.state === 'setup') {
      status = 'Setup';
    } else if (parsedState.state === 'resolved') {
      status = 'Resolved';
      winningIndex = parsedState.winningIdx;
    }

    // Get proposal timing info from config
    const proposalLength = proposalAccount.config.length; // in seconds
    const createdAt = proposalAccount.createdAt.toNumber() * 1000; // Convert to milliseconds
    const endsAt = createdAt + (proposalLength * 1000);
    const warmupDuration = proposalAccount.config.warmupDuration; // in seconds
    const warmupEndsAt = createdAt + (warmupDuration * 1000);

    // Get metadata CID from on-chain
    const metadataCid = proposalAccount.metadata || null;

    // Default values
    let title = `Proposal #${proposalAccount.id}`;
    let description = '';
    let options: string[] = ['Pass', 'Fail'];
    let daoPda: string | null = null;

    // Fetch IPFS metadata if available
    if (metadataCid) {
      try {
        const metadataRes = await fetch(`${getIpfsUrl(metadataCid)}`);
        if (metadataRes.ok) {
          const metadata = await metadataRes.json();
          title = metadata.title || title;
          description = metadata.description || description;
          options = metadata.options || options;
          daoPda = metadata.dao_pda || null;
        }
      } catch (err) {
        console.warn(`Failed to fetch IPFS metadata for ${metadataCid}:`, err);
      }
    }

    // Return proposal data
    res.json({
      id: proposalAccount.id,
      proposalPda,
      title,
      description,
      options,
      status,
      winningIndex,
      numOptions: proposalAccount.numOptions,
      createdAt,
      endsAt,
      warmupEndsAt,
      moderator: proposalAccount.moderator.toBase58(),
      creator: proposalAccount.creator.toBase58(),
      vault: proposalAccount.vault.toBase58(),
      baseMint: proposalAccount.baseMint.toBase58(),
      quoteMint: proposalAccount.quoteMint.toBase58(),
      pools: proposalAccount.pools.map((p: PublicKey) => p.toBase58()),
      metadataCid,
      daoPda,
      // Config details
      config: {
        length: proposalLength,
        warmupDuration,
        marketBias: proposalAccount.config.marketBias,
        fee: proposalAccount.config.fee,
      },
    });
  } catch (error) {
    console.error('Error fetching proposal:', error);
    res.status(500).json({ error: 'Failed to fetch proposal' });
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

    // Validate pool fee rate is sufficient for protocol to capture 0.5% of swap volume
    // Meteora takes 20% of pool fees, so LP only receives 80%
    // To capture 0.5% of swap volume: poolFee * 0.8 >= 0.5% → poolFee >= 0.625% (63bps)
    const MIN_FEE_BPS = 63;
    if (poolInfo.feeBps < MIN_FEE_BPS) {
      return res.status(400).json({
        error: `Pool fee rate too low. Minimum required: ${MIN_FEE_BPS}bps (${(MIN_FEE_BPS / 100).toFixed(2)}%). Pool has: ${poolInfo.feeBps}bps (${(poolInfo.feeBps / 100).toFixed(2)}%). Protocol requires at least 0.5% of swap volume after Meteora's 20% fee.`,
        pool_fee_bps: poolInfo.feeBps,
        min_fee_bps: MIN_FEE_BPS,
      });
    }

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
    let treasuryVault: string;  // Vault PDA (NOT multisig) - where treasury funds go
    let mintVault: string;      // Vault PDA (NOT multisig) - mint authority target
    let tx: string;

    // Allocate and fund admin wallet from key service
    const { publicKey: allocatedWallet } = await allocateKey(connection, keyIdx, false);
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
      treasuryVault = mockResult.treasuryVault;
      mintVault = mockResult.mintVault;
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

      // CRITICAL: Derive vault PDAs from multisig PDAs
      // The SDK returns multisig PDAs, but we need vault PDAs for:
      // - Mint authority transfer (mint vault)
      // - Treasury funds (treasury vault)
      // Sending to multisig address instead of vault = permanently lost funds!
      const treasuryMultisigPda = result.treasuryMultisig;
      const mintMultisigPda = result.mintMultisig;
      treasuryVault = deriveSquadsVaultPda(treasuryMultisigPda).toBase58();
      mintVault = deriveSquadsVaultPda(mintMultisigPda).toBase58();

      console.log(`[DAO] Created parent DAO ${name}`);
      console.log(`  Treasury Multisig: ${treasuryMultisigPda.toBase58()}`);
      console.log(`  Treasury Vault:    ${treasuryVault}`);
      console.log(`  Mint Multisig:     ${mintMultisigPda.toBase58()}`);
      console.log(`  Mint Vault:        ${mintVault}`);
    }

    // Store in database
    // Note: DB columns still named *_multisig for backward compat, but store vault PDAs
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
      treasury_multisig: treasuryVault,      // Actually vault PDA
      mint_auth_multisig: mintVault,         // Actually vault PDA
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
        treasury_vault: treasuryVault,  // Vault PDA (where funds should go)
        mint_vault: mintVault,          // Vault PDA (mint authority target)
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
      const { publicKey: childAdminWallet } = await allocateKey(connection, keyIdx, false);

    // Register the key
    await registerKey(pool, {
      key_idx: keyIdx,
      public_key: childAdminWallet,
      purpose: 'dao_child',
    });

    let daoPda: string;
    let treasuryVault: string;  // Vault PDA (NOT multisig) - where treasury funds go
    let mintVault: string;      // Vault PDA (NOT multisig) - mint authority target
    let tx: string;

    if (MOCK_MODE) {
      // ========== MOCK MODE ==========
      // Only mock the FutarchyClient SDK write operations
      console.log('[MOCK MODE] Skipping FutarchyClient SDK calls for child DAO creation');

      // Generate mock PDAs
      const mockResult = mockInitializeChildDAO(parentDao.dao_name, name);
      daoPda = mockResult.daoPda;
      treasuryVault = mockResult.treasuryVault;
      mintVault = mockResult.mintVault;
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

      // CRITICAL: Derive vault PDAs from multisig PDAs
      // The SDK returns multisig PDAs, but we need vault PDAs for:
      // - Mint authority transfer (mint vault)
      // - Treasury funds (treasury vault)
      // Sending to multisig address instead of vault = permanently lost funds!
      const treasuryMultisigPda = result.treasuryMultisig;
      const mintMultisigPda = result.mintMultisig;
      treasuryVault = deriveSquadsVaultPda(treasuryMultisigPda).toBase58();
      mintVault = deriveSquadsVaultPda(mintMultisigPda).toBase58();

      console.log(`[DAO] Created child DAO ${name}`);
      console.log(`  Treasury Multisig: ${treasuryMultisigPda.toBase58()}`);
      console.log(`  Treasury Vault:    ${treasuryVault}`);
      console.log(`  Mint Multisig:     ${mintMultisigPda.toBase58()}`);
      console.log(`  Mint Vault:        ${mintVault}`);
    }

    // Store in database
    // Note: DB columns still named *_multisig for backward compat, but store vault PDAs
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
      treasury_multisig: treasuryVault,      // Actually vault PDA
      mint_auth_multisig: mintVault,         // Actually vault PDA
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
        treasury_vault: treasuryVault,  // Vault PDA (where funds should go)
        mint_vault: mintVault,          // Vault PDA (mint authority target)
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
      warmup_secs,
      options,
    } = req.body;

    // Validate required fields
    if (!dao_pda || !title || !description || !length_secs || warmup_secs === undefined || !options) {
      return res.status(400).json({
        error: 'Missing required fields: dao_pda, title, description, length_secs, warmup_secs, options'
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

    // Validate length_secs is a positive number (range validation after DAO lookup)
    if (typeof length_secs !== 'number' || length_secs <= 0) {
      return res.status(400).json({ error: 'length_secs must be a positive number' });
    }

    // Validate warmup_secs if provided (must be positive and <= 80% of length_secs)
    if (warmup_secs !== undefined) {
      if (typeof warmup_secs !== 'number' || warmup_secs <= 0) {
        return res.status(400).json({ error: 'warmup_secs must be a positive number' });
      }
      const maxWarmup = Math.floor(length_secs * 0.8);
      if (warmup_secs > maxWarmup) {
        return res.status(400).json({
          error: `warmup_secs must not exceed 80% of length_secs (max: ${maxWarmup} seconds)`,
        });
      }
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

    // Validate proposal duration based on proposer role
    // DAO owner: 1 minute to 7 days
    // Others (whitelist/token threshold): 24 hours to 4 days
    const isOwner = wallet === dao.owner_wallet;
    const ONE_MINUTE = 60;
    const ONE_HOUR = 3600;
    const ONE_DAY = 24 * ONE_HOUR;

    if (isOwner) {
      // Owner: 1 minute to 7 days
      const minDuration = ONE_MINUTE;
      const maxDuration = 7 * ONE_DAY;
      if (length_secs < minDuration || length_secs > maxDuration) {
        return res.status(400).json({
          error: 'Invalid proposal duration',
          reason: `DAO owner can create proposals from 1 minute to 7 days (${minDuration}-${maxDuration} seconds)`,
          provided: length_secs,
        });
      }
    } else {
      // Non-owner proposers: 24 hours to 4 days
      const minDuration = ONE_DAY;
      const maxDuration = 4 * ONE_DAY;
      if (length_secs < minDuration || length_secs > maxDuration) {
        return res.status(400).json({
          error: 'Invalid proposal duration',
          reason: `Proposers can create proposals from 24 hours to 4 days (${minDuration}-${maxDuration} seconds)`,
          provided: length_secs,
        });
      }
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
    // Also store liquidityDao for later use in withdrawal/deposit operations
    let lpCheckWallet = dao.admin_wallet;
    let lpCheckPool = dao.pool_address;
    let lpCheckPoolType = dao.pool_type;
    let liquidityDao = dao;  // The DAO that owns the LP (parent for child DAOs)

    if (dao.dao_type === 'child' && dao.parent_dao_id) {
      // Get parent DAO - child DAOs use parent's LP
      const parentDao = await getDaoById(pool, dao.parent_dao_id);
      if (parentDao) {
        lpCheckWallet = parentDao.admin_wallet;
        lpCheckPool = parentDao.pool_address;
        lpCheckPoolType = parentDao.pool_type;
        liquidityDao = parentDao;
        console.log(`Child DAO detected, using parent DAO for liquidity: ${parentDao.dao_name}`);
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

    // 5. Check admin wallet has sufficient SOL balance for transaction fees
    // The admin wallet is used to sign proposal creation and liquidity operations
    const MIN_ADMIN_BALANCE_SOL = 0.1;
    const adminBalance = await connection.getBalance(new PublicKey(lpCheckWallet));
    const adminBalanceSol = adminBalance / 1e9;
    if (adminBalanceSol < MIN_ADMIN_BALANCE_SOL) {
      return res.status(400).json({
        error: 'DAO not ready for proposals',
        reason: `Admin wallet has insufficient SOL balance: ${adminBalanceSol.toFixed(4)} SOL. Minimum required: ${MIN_ADMIN_BALANCE_SOL} SOL. Use the fund-admin-wallet script to fund it.`,
        check: 'admin_wallet_balance',
        admin_wallet: lpCheckWallet,
        current_balance: adminBalanceSol,
        required_balance: MIN_ADMIN_BALANCE_SOL,
      });
    }

    console.log('All proposal validation checks passed');

    // ========================================================================
    // LIQUIDITY MANAGEMENT: Withdraw LP before proposal creation
    // ========================================================================
    // Before creating a proposal, we:
    // 1. Call withdraw/build to get unsigned transaction and amounts
    // 2. Sign with admin keypair (from liquidityDao - parent for child DAOs)
    // 3. Call withdraw/confirm to execute the withdrawal
    // 4. Pass withdrawn amounts to SDK's createProposal
    // ========================================================================

    // Get admin keypair for liquidity operations (from parent if child DAO)
    const adminKeypair = await fetchKeypair(liquidityDao.admin_key_idx);
    const adminPubkey = adminKeypair.publicKey;

    // Determine pool type and withdrawal percentage (from DAO settings)
    const poolType = lpCheckPoolType;
    const poolAddress = lpCheckPool;
    const withdrawalPercentage = dao.withdrawal_percentage;

    console.log(`Withdrawing ${withdrawalPercentage}% liquidity from ${poolType} pool ${poolAddress}`);
    console.log(`  LP Owner (admin): ${adminPubkey.toBase58()}`);

    // Step 1: Call withdraw/build
    // Pass adminWallet to disambiguate when multiple DAOs share the same pool
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const withdrawBuildResponse = await fetch(`${baseUrl}/${poolType}/withdraw/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        withdrawalPercentage,
        poolAddress,
        adminWallet: liquidityDao.admin_wallet  // Use LP owner's wallet
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
      // DAMM uses estimatedAmounts
      estimatedAmounts?: { tokenA: string; tokenB: string; liquidityDelta: string };
      // DLMM uses withdrawn/transferred
      withdrawn?: { tokenA: string; tokenB: string };
      transferred?: { tokenA: string; tokenB: string };
      redeposited?: { tokenA: string; tokenB: string };
      marketPrice?: string;
    };

    // Normalize response format (DAMM uses estimatedAmounts, DLMM uses withdrawn/transferred)
    const buildAmounts = withdrawBuildData.estimatedAmounts || withdrawBuildData.withdrawn || { tokenA: '0', tokenB: '0' };

    console.log('Withdrawal build response:', {
      requestId: withdrawBuildData.requestId,
      amounts: buildAmounts,
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
      // DAMM uses estimatedAmounts
      estimatedAmounts?: { tokenA: string; tokenB: string; liquidityDelta: string };
      // DLMM uses transferred
      transferred?: { tokenA: string; tokenB: string };
    };

    // Normalize response format (DAMM uses estimatedAmounts, DLMM uses transferred)
    const confirmAmounts = withdrawConfirmData.estimatedAmounts || withdrawConfirmData.transferred || buildAmounts;

    console.log('Withdrawal confirmed:', {
      signature: withdrawConfirmData.signature || withdrawConfirmData.signatures,
      amounts: confirmAmounts,
    });

    // Use withdrawn amounts for AMM initial liquidity
    const baseAmount = new BN(confirmAmounts.tokenA);
    const quoteAmount = new BN(confirmAmounts.tokenB);

    console.log(`Initial AMM liquidity: base=${baseAmount.toString()}, quote=${quoteAmount.toString()}`);

    // Calculate starting observation from liquidity ratio (price = quote/base scaled by PRICE_SCALE)
    // PRICE_SCALE = 10^12 (from @zcomb/programs-sdk/amm/constants)
    const PRICE_SCALE = new BN('1000000000000'); // 10^12

    // Get token decimals for proper price calculation
    // For now, fetch from the DAO's token info
    const baseMintInfo = await getMint(connection, new PublicKey(dao.token_mint));
    const quoteMintInfo = await getMint(connection, new PublicKey(dao.quote_mint));

    // Calculate starting observation: (quoteAmount / baseAmount) * PRICE_SCALE * 10^(baseDecimals - quoteDecimals)
    let startingObservation: BN;
    if (baseAmount.isZero()) {
      // Fallback to 1:1 price if base amount is zero (shouldn't happen)
      startingObservation = PRICE_SCALE;
    } else {
      startingObservation = quoteAmount.mul(PRICE_SCALE).div(baseAmount);
    }

    // Calculate max observation delta as 5% of starting observation
    const maxObservationDelta = startingObservation.mul(new BN(5)).div(new BN(100));

    console.log(`TWAP config: startingObservation=${startingObservation.toString()}, maxObservationDelta=${maxObservationDelta.toString()} (5%)`);

    // Upload proposal metadata to IPFS (includes dao_pda for proposal-to-DAO mapping)
    let metadataCid: string;
    try {
      metadataCid = await uploadProposalMetadata(title, description, options, dao_pda);
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

      // Step 0: Create Address Lookup Table (ALT) for proposal accounts
      //
      // ALT enables versioned transactions that use 1-byte index lookups instead of
      // 32-byte pubkeys. This is REQUIRED for launchProposal which has:
      //   - 8 fixed accounts
      //   - 6 + 7*N remaining accounts (N = numOptions)
      //   - 4 options = 42 accounts = 1344+ bytes > 1232 byte limit (without ALT)
      //   - With ALT: 42 accounts = ~42 bytes (fits easily)
      //
      // The SDK's createProposalALT derives addresses using the moderator's CURRENT
      // proposalIdCounter, which will be the ID of the NEXT proposal we create.
      console.log('Step 0: Creating Address Lookup Table for versioned transactions...');
      console.log(`  Options: ${options.length} (accounts: ${8 + 6 + 7 * options.length})`);

      const altResult = await client.createProposalALT(
        adminKeypair.publicKey,
        moderatorPda,
        options.length,
      );
      const altAddress = altResult.altAddress;
      console.log(`  ✓ ALT created: ${altAddress.toBase58()}`);

      // Poll for ALT readiness (Solana needs 1-2 slots for ALT to be usable)
      console.log('  Waiting for ALT finalization...');
      const ALT_POLL_INTERVAL_MS = 500;
      const ALT_MAX_WAIT_MS = 10000;
      let altReady = false;
      let altAddressCount = 0;
      const startTime = Date.now();

      while (!altReady && Date.now() - startTime < ALT_MAX_WAIT_MS) {
        const altAccount = await provider.connection.getAddressLookupTable(altAddress);
        if (altAccount.value && altAccount.value.state.addresses.length > 0) {
          altReady = true;
          altAddressCount = altAccount.value.state.addresses.length;
        } else {
          await new Promise(resolve => setTimeout(resolve, ALT_POLL_INTERVAL_MS));
        }
      }

      if (!altReady) {
        throw new Error(
          `ALT not ready after ${ALT_MAX_WAIT_MS}ms. This may indicate an RPC issue or network congestion.`
        );
      }
      console.log(`  ✓ ALT verified with ${altAddressCount} addresses (waited ${Date.now() - startTime}ms)`);

      // Create proposal step by step, executing each transaction before building the next
      // (SDK's createProposal tries to fetch accounts during build phase before they exist)
      // warmupDuration must be <= 80% of length_secs (validated above)
      const warmupDuration = warmup_secs;

      const proposalParams = {
        length: length_secs,
        startingObservation,        // Calculated from liquidity ratio
        maxObservationDelta,        // 5% of starting observation
        warmupDuration,             // Client-specified warmup period
        marketBias: 0,              // 0% (Pass Fail Gap)
        fee: 50,                    // 0.5% fee
      };

      console.log(`Proposal params: length=${length_secs}s, warmup=${warmupDuration}s, obs=${startingObservation}, delta=${maxObservationDelta}`);

      // Step 1: Initialize proposal
      console.log('Step 1: Initializing proposal...');
      const initResult = await client.initializeProposal(
        adminKeypair.publicKey,
        moderatorPda,
        proposalParams,
        metadataCid,
      );

      console.log(`  Proposal PDA: ${initResult.proposalPda.toBase58()}`);
      console.log(`  Proposal ID: ${initResult.proposalId}`);
      console.log(`  Vault PDA: ${initResult.vaultPda.toBase58()}`);

      // Check if proposal already exists (from a previous failed run)
      const existingProposal = await provider.connection.getAccountInfo(initResult.proposalPda);
      if (existingProposal) {
        // Check the proposal state to see if it can still be launched
        try {
          const proposal = await client.fetchProposal(initResult.proposalPda);
          const { state } = futarchy.parseProposalState(proposal.state);

          if (state === futarchy.ProposalState.Pending || state === futarchy.ProposalState.Resolved) {
            // Proposal already launched or resolved - can't reuse
            throw new Error(
              `Proposal ${initResult.proposalPda.toBase58()} already exists in '${state}' state. ` +
              `This is a duplicate proposal attempt. The moderator counter may need to increment for a new proposal.`
            );
          }

          // Proposal exists but is in Setup state - can proceed to launch
          console.log(`  ⚠ Proposal already exists in Setup state, skipping initialization`);
        } catch (fetchError: any) {
          // If we can't fetch the proposal state, fail with the original error
          if (fetchError.message?.includes('already exists')) {
            throw fetchError;
          }
          console.log(`  ⚠ Proposal exists but could not fetch state, skipping initialization`);
        }
      } else {
        try {
          const initSig = await initResult.builder.rpc();
          console.log(`  ✓ Initialize tx: ${initSig}`);
          // Wait for confirmation before proceeding to addOption
          await provider.connection.confirmTransaction(initSig, 'confirmed');
        } catch (e) {
          console.error('  ✗ Initialize failed:', e);
          throw e;
        }
      }

      // Step 2: Add additional options (beyond initial 2) if needed
      for (let i = 2; i < options.length; i++) {
        console.log(`Step 2.${i-1}: Adding option ${i}...`);
        try {
          const addResult = await client.addOption(adminKeypair.publicKey, initResult.proposalPda);
          const optSig = await addResult.builder.rpc();
          console.log(`  ✓ AddOption ${i} tx: ${optSig}`);
          // Wait for confirmation before next iteration
          await provider.connection.confirmTransaction(optSig, 'confirmed');
        } catch (e) {
          console.error(`  ✗ AddOption ${i} failed:`, e);
          throw e;
        }
      }

      // Step 2.5: Wrap SOL to WSOL if quote mint is native SOL
      // DAMM withdrawal sends native SOL, but launchProposal expects WSOL in ATA
      const NATIVE_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
      if (new PublicKey(dao.quote_mint).equals(NATIVE_SOL_MINT)) {
        console.log('Step 2.5: Wrapping SOL to WSOL...');
        const { createSyncNativeInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } = await import('@solana/spl-token');
        const { SystemProgram, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');

        const wsolAta = getAssociatedTokenAddressSync(NATIVE_SOL_MINT, adminKeypair.publicKey);
        const wrapTx = new Transaction();

        // Create WSOL ATA if needed
        wrapTx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            adminKeypair.publicKey,
            wsolAta,
            adminKeypair.publicKey,
            NATIVE_SOL_MINT
          )
        );

        // Transfer SOL to WSOL ATA (add buffer for rent)
        const wrapAmount = quoteAmount.toNumber() + 10000; // Small buffer
        wrapTx.add(
          SystemProgram.transfer({
            fromPubkey: adminKeypair.publicKey,
            toPubkey: wsolAta,
            lamports: wrapAmount,
          })
        );

        // Sync native balance
        wrapTx.add(createSyncNativeInstruction(wsolAta));

        const { blockhash } = await provider.connection.getLatestBlockhash();
        wrapTx.recentBlockhash = blockhash;
        wrapTx.feePayer = adminKeypair.publicKey;

        const wrapSig = await sendAndConfirmTransaction(provider.connection, wrapTx, [adminKeypair]);
        console.log(`  ✓ Wrapped ${quoteAmount.toString()} lamports to WSOL: ${wrapSig}`);
      }

      // Step 3: Launch proposal using versioned transaction with ALT
      // ALT reduces account references from 32 bytes to 1 byte each
      console.log('Step 3: Launching proposal with versioned transaction...');
      try {
        const launchResult = await client.launchProposal(
          adminKeypair.publicKey,
          initResult.proposalPda,
          baseAmount,
          quoteAmount,
        );

        // Extract the instruction from the builder
        const launchInstruction = await launchResult.builder.instruction();

        // Add compute budget instruction (SDK defaults to 500k CUs via preInstructions,
        // but .instruction() doesn't include them - we must add manually)
        const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 });

        // Build versioned transaction using the ALT
        const versionedTx = await client.buildVersionedTx(
          adminKeypair.publicKey,
          [computeBudgetIx, launchInstruction],
          altAddress,
        );

        // Sign the versioned transaction
        versionedTx.sign([adminKeypair]);

        // Send and confirm
        const launchSig = await provider.connection.sendTransaction(versionedTx, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        // Wait for confirmation
        await provider.connection.confirmTransaction(launchSig, 'confirmed');

        console.log(`  ✓ Launch tx: ${launchSig}`);
      } catch (e) {
        console.error('  ✗ Launch failed:', e);
        throw e;
      }

      proposalPda = initResult.proposalPda.toBase58();
      proposalId = initResult.proposalId;
    }

    console.log(`Created proposal ${proposalPda} for DAO ${dao_pda}`);

    // Update the proposal count cache
    incrementProposalCount(dao_pda);

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

// POST /dao/finalize-proposal - Finalize a proposal after it has ended
// ============================================================================
// This endpoint finalizes a proposal by reading the final TWAP values and
// determining the winning outcome. Can only be called after the proposal has ended.
// ============================================================================

router.post('/finalize-proposal', async (req: Request, res: Response) => {
  try {
    const { proposal_pda } = req.body;

    if (!proposal_pda) {
      return res.status(400).json({ error: 'Missing required field: proposal_pda' });
    }

    if (!isValidTokenMintAddress(proposal_pda)) {
      return res.status(400).json({ error: 'Invalid proposal_pda' });
    }

    const pool = getPool();
    const connection = getConnection();

    // Create a read-only provider first
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

    // Check current state
    const { state, winningIdx } = futarchy.parseProposalState(proposal.state);

    if (state === futarchy.ProposalState.Resolved) {
      return res.json({
        message: 'Proposal already resolved',
        proposal_pda,
        winning_option: winningIdx,
        state: 'resolved'
      });
    }

    if (state !== futarchy.ProposalState.Pending) {
      return res.status(400).json({
        error: 'Proposal cannot be finalized',
        state,
        message: 'Proposal must be in Pending state to finalize'
      });
    }

    // Check if proposal has ended
    const now = Math.floor(Date.now() / 1000);
    const createdAt = Number(proposal.createdAt?.toString() || 0);
    const length = Number(proposal.config?.length || 0);
    const endTime = createdAt + length;

    if (now < endTime) {
      const remaining = endTime - now;
      return res.status(400).json({
        error: 'Proposal has not ended yet',
        ends_in_seconds: remaining,
        end_time: endTime
      });
    }

    // Get moderator PDA from proposal and lookup DAO
    const moderatorPda = proposal.moderator.toBase58();
    const dao = await getDaoByModeratorPda(pool, moderatorPda);
    if (!dao) {
      return res.status(404).json({
        error: 'DAO not found for this proposal',
        moderator_pda: moderatorPda
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

    console.log(`Finalizing proposal ${proposal_pda}`);
    console.log(`  DAO: ${dao.dao_name} (${dao.dao_pda})`);

    // Finalize the proposal
    const { builder } = await client.finalizeProposal(
      adminKeypair.publicKey,
      proposalPubkey
    );

    const tx = await builder.rpc();
    console.log(`Proposal finalized: ${tx}`);

    // Fetch result
    const finalProposal = await readClient.fetchProposal(proposalPubkey);
    const finalState = futarchy.parseProposalState(finalProposal.state);

    res.json({
      message: 'Proposal finalized successfully',
      proposal_pda,
      signature: tx,
      winning_option: finalState.winningIdx,
      state: finalState.state
    });

  } catch (error) {
    console.error('Error finalizing proposal:', error);
    res.status(500).json({ error: 'Failed to finalize proposal', details: String(error) });
  }
});

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

    // For child DAOs, liquidity is managed by the parent DAO
    // We need to use parent's admin so tokens go to the LP owner
    let liquidityDao = dao;
    if (dao.dao_type === 'child' && dao.parent_dao_id) {
      const parentDao = await getDaoById(pool, dao.parent_dao_id);
      if (parentDao) {
        console.log(`Child DAO detected, using parent DAO for redemption: ${parentDao.dao_name}`);
        liquidityDao = parentDao;
      }
    }

    if (liquidityDao.admin_key_idx === undefined || liquidityDao.admin_key_idx === null) {
      return res.status(500).json({ error: 'DAO has no admin key index' });
    }

    // Get admin keypair (from parent if child DAO)
    const adminKeypair = await fetchKeypair(liquidityDao.admin_key_idx);

    // Create provider and client with admin keypair
    const provider = createProvider(adminKeypair);
    const client = new futarchy.FutarchyClient(provider);

    console.log(`Redeeming liquidity for proposal ${proposal_pda}`);
    console.log(`  Winning index: ${winningIdx}`);
    console.log(`  Num options: ${proposal.numOptions}`);
    console.log(`  DAO: ${dao.dao_name} (${dao.dao_pda})`);
    if (liquidityDao !== dao) {
      console.log(`  Parent DAO (LP owner): ${liquidityDao.dao_name} (${liquidityDao.dao_pda})`);
    }

    let tx: string;

    // Use versioned transaction with ALT for 3+ option proposals
    // This avoids exceeding the 1232 byte transaction size limit
    if (proposal.numOptions >= 3) {
      console.log(`  Using versioned transaction (${proposal.numOptions} options)`);
      const result = await client.redeemLiquidityVersioned(
        adminKeypair.publicKey,
        proposalPubkey
      );

      // Sign the versioned transaction with admin keypair
      result.versionedTx.sign([adminKeypair]);

      // Send the signed transaction
      tx = await client.sendVersionedTransaction(result.versionedTx);
    } else {
      // Standard transaction for 2-option proposals
      const { builder } = await client.redeemLiquidity(
        adminKeypair.publicKey,
        proposalPubkey
      );
      tx = await builder.rpc();
    }

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

    // For child DAOs, liquidity is managed by the parent DAO
    // We need to use parent's pool, admin, and token for deposit-back
    let liquidityDao = dao;
    if (dao.dao_type === 'child' && dao.parent_dao_id) {
      const parentDao = await getDaoById(pool, dao.parent_dao_id);
      if (parentDao) {
        console.log(`Child DAO detected, using parent DAO for liquidity: ${parentDao.dao_name}`);
        liquidityDao = parentDao;
      }
    }

    if (liquidityDao.admin_key_idx === undefined || liquidityDao.admin_key_idx === null) {
      return res.status(500).json({ error: 'DAO has no admin key index' });
    }

    if (!liquidityDao.pool_address) {
      return res.status(500).json({ error: 'DAO has no pool address' });
    }

    if (!liquidityDao.token_mint) {
      return res.status(500).json({ error: 'DAO has no token mint' });
    }

    // Get admin keypair (from parent if child DAO)
    const adminKeypair = await fetchKeypair(liquidityDao.admin_key_idx);
    const adminPubkey = adminKeypair.publicKey;

    console.log(`Deposit-back for proposal ${proposal_pda}`);
    console.log(`  DAO: ${dao.dao_name} (${dao.dao_pda})`);
    if (liquidityDao !== dao) {
      console.log(`  Parent DAO: ${liquidityDao.dao_name} (${liquidityDao.dao_pda})`);
    }
    console.log(`  Pool: ${liquidityDao.pool_address} (${liquidityDao.pool_type})`);
    console.log(`  Admin wallet: ${adminPubkey.toBase58()}`);

    // Check if admin wallet has meaningful token balance (>0.5% of supply)
    const tokenMint = new PublicKey(liquidityDao.token_mint);
    const mintInfo = await connection.getParsedAccountInfo(tokenMint);
    if (!mintInfo.value || !('parsed' in mintInfo.value.data)) {
      return res.status(500).json({ error: 'Failed to fetch token mint info' });
    }

    const mintData = mintInfo.value.data.parsed;
    const totalSupply = BigInt(mintData.info.supply);

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

    // For DAOs, the LP owner is the admin wallet
    // We use adminPubkey directly instead of fetching from pool config endpoint
    // This ensures we use the correct LP owner when multiple DAOs share the same pool
    const lpOwnerPubkey = adminPubkey;

    console.log(`  LP Owner (admin): ${lpOwnerPubkey.toBase58()}`);

    // For DAOs, LP owner = admin, so tokens are already in the right wallet after redemption
    // No transfer step needed - skip directly to cleanup swap + deposit
    let transferSignature = '';
    console.log(`  Skipping transfer step (LP owner = admin, tokens already in place)`);

    // Step 2: Call cleanup swap + deposit via internal endpoints
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const poolType = liquidityDao.pool_type;

    // Build cleanup swap
    let swapSignature = '';
    const swapBuildResponse = await fetch(`${baseUrl}/${poolType}/cleanup/swap/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poolAddress: liquidityDao.pool_address,
        adminWallet: liquidityDao.admin_wallet
      })
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
    // Pass adminWallet to disambiguate when multiple DAOs share the same pool
    let depositSignature = '';
    const depositBuildResponse = await fetch(`${baseUrl}/${poolType}/deposit/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poolAddress: liquidityDao.pool_address,
        tokenAAmount: 0,
        tokenBAmount: 0,
        adminWallet: liquidityDao.admin_wallet
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

// POST /dao/crank-twap - Crank TWAP for all pools on a proposal
// ============================================================================
// Permissionless endpoint that updates the TWAP oracle for each pool on a proposal.
// This can be called by anyone to ensure TWAP values are current.
// The DAO's admin keypair is used to pay for transaction fees.
// ============================================================================

router.post('/crank-twap', async (req: Request, res: Response) => {
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

    // Get moderator PDA from proposal and lookup DAO
    const moderatorPda = proposal.moderator.toBase58();
    const dao = await getDaoByModeratorPda(pool, moderatorPda);
    if (!dao) {
      return res.status(404).json({
        error: 'DAO not found for this proposal',
        moderator_pda: moderatorPda
      });
    }

    if (dao.admin_key_idx === undefined || dao.admin_key_idx === null) {
      return res.status(500).json({ error: 'DAO has no admin key index' });
    }

    // Get admin keypair to pay for transactions
    const adminKeypair = await fetchKeypair(dao.admin_key_idx);

    // Create provider and client with admin keypair
    const provider = createProvider(adminKeypair);
    const client = new futarchy.FutarchyClient(provider);

    // Get all valid pools from the proposal
    // The pools array is fixed-size (6), but only numOptions are used.
    // Additionally, some pools may be null (Pubkey.default = 11111111111111111111111111111111)
    const numOptions = proposal.numOptions;
    const validPools = proposal.pools
      .slice(0, numOptions)
      .filter((pool: PublicKey) => !pool.equals(PublicKey.default));

    console.log(`Cranking TWAP for proposal ${proposal_pda}`);
    console.log(`  DAO: ${dao.dao_name} (${dao.dao_pda})`);
    console.log(`  Total options: ${numOptions}, valid pools: ${validPools.length}`);

    // Crank TWAP for all eligible pools in a single transaction
    // This ensures all pools are cranked at the exact same time interval
    const now = Math.floor(Date.now() / 1000);
    const results: { pool: string; signature?: string; skipped?: boolean; reason?: string }[] = [];
    const poolsToCrank: { index: number; poolPda: PublicKey }[] = [];

    // First pass: check eligibility and collect pools to crank
    for (let i = 0; i < validPools.length; i++) {
      const poolPda = validPools[i];
      try {
        const poolAccount = await client.amm.fetchPool(poolPda);
        const oracle = poolAccount.oracle;

        // Check 1: Warmup period must have passed
        const createdAt = Number(oracle.createdAtUnixTime);
        const warmupDuration = Number(oracle.warmupDuration);
        const warmupEndsAt = createdAt + warmupDuration;

        if (now < warmupEndsAt) {
          const waitTime = warmupEndsAt - now;
          console.log(`  Pool ${i} (${poolPda.toBase58()}): skipped, warmup ends in ${waitTime}s`);
          results.push({
            pool: poolPda.toBase58(),
            skipped: true,
            reason: `Warmup period: ${waitTime}s remaining`
          });
          continue;
        }

        // Check 2: Minimum recording interval must have passed since last crank
        const lastUpdate = Number(oracle.lastUpdateUnixTime);
        const minInterval = Number(oracle.minRecordingInterval);
        const timeSinceLastUpdate = now - lastUpdate;

        if (timeSinceLastUpdate < minInterval) {
          const waitTime = minInterval - timeSinceLastUpdate;
          console.log(`  Pool ${i} (${poolPda.toBase58()}): skipped, ${waitTime}s until next crank`);
          results.push({
            pool: poolPda.toBase58(),
            skipped: true,
            reason: `Rate limited: ${waitTime}s until next crank (interval: ${minInterval}s)`
          });
          continue;
        }

        poolsToCrank.push({ index: i, poolPda });
      } catch (err) {
        console.error(`  Pool ${i} (${poolPda.toBase58()}) failed to fetch:`, err);
        results.push({ pool: poolPda.toBase58(), reason: `error: ${String(err)}` });
      }
    }

    // Second pass: build all crank instructions and send in a single transaction
    if (poolsToCrank.length > 0) {
      try {
        const instructions = [];
        for (const { poolPda } of poolsToCrank) {
          const builder = await client.amm.crankTwap(poolPda);
          const ix = await builder.instruction();
          instructions.push(ix);
        }

        // Build and send single transaction with all crank instructions
        const tx = new Transaction();
        for (const ix of instructions) {
          tx.add(ix);
        }

        const { blockhash } = await provider.connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = adminKeypair.publicKey;

        const signature = await provider.connection.sendTransaction(tx, [adminKeypair]);
        await provider.connection.confirmTransaction(signature, 'confirmed');

        console.log(`  Cranked ${poolsToCrank.length} pools in single tx: ${signature}`);

        // Mark all pools as cranked with the same signature
        for (const { poolPda } of poolsToCrank) {
          results.push({ pool: poolPda.toBase58(), signature });
        }
      } catch (err) {
        console.error('  Batch crank failed:', err);
        for (const { poolPda } of poolsToCrank) {
          results.push({ pool: poolPda.toBase58(), reason: `batch error: ${String(err)}` });
        }
      }
    }

    res.json({
      message: 'TWAP crank completed',
      proposal_pda,
      dao_pda: dao.dao_pda,
      num_options: numOptions,
      pools_cranked: poolsToCrank.length,
      results
    });

  } catch (error) {
    console.error('Error cranking TWAP:', error);
    res.status(500).json({ error: 'Failed to crank TWAP', details: String(error) });
  }
});

export default router;
