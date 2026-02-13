/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
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
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

import { Router, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { futarchy } from '@zcomb/programs-sdk';

import { getPool } from '../../lib/db';
import { getDaoById } from '../../lib/db/daos';
import {
  getDaoByPda,
  getAllDaos,
  getDaosByOwner,
  getChildDaos,
  getProposersByDao,
  getDaoStats,
  getDaoStatsBatch,
} from '../../lib/db/daos';
import { isValidTokenMintAddress } from '../../lib/validation';
import { fetchFromIPFS } from '../../lib/ipfs';
import { getTokenIcon, getTokenIcons, getTokenDecimals, getTokenDecimalsBatch } from '../../lib/tokenMetadata';
import {
  getCachedProposalCount,
  setCachedProposalCount,
  createReadOnlyClient,
} from '../../lib/dao';
import { getConnection } from './shared';

const router = Router();

// Simple response cache with TTL
const responseCache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 30_000;

function cached(key: string): any | null {
  const entry = responseCache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data;
  return null;
}

// ============================================================================
// GET /dao - List all DAOs (for client indexing)
// ============================================================================

router.get('/', async (req: Request, res: Response) => {
  try {
    const { type, owner, limit, offset } = req.query;
    const cacheKey = `dao:${type || ''}:${owner || ''}:${limit || ''}:${offset || ''}`;
    const hit = cached(cacheKey);
    if (hit) return res.json(hit);

    const pool = getPool();
    const connection = getConnection();

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

    // Batch fetch token icons, decimals, and stats for all DAOs
    const tokenMints = daos.map(dao => dao.token_mint);
    const quoteMints = daos.map(dao => dao.quote_mint);
    const daoIds = daos.map(dao => dao.id!);
    // Collect unique mints for decimal fetching (both base and quote)
    const allMints = [...new Set([...tokenMints, ...quoteMints])];

    const [iconMap, decimalsMap, statsMap] = await Promise.all([
      getTokenIcons(connection, tokenMints),
      getTokenDecimalsBatch(connection, allMints),
      getDaoStatsBatch(pool, daoIds),
    ]);

    // Enrich with stats, icons, decimals, strip internal fields, and rename DB columns to API fields
    const enrichedDaos = daos.map((dao) => {
      const stats = statsMap.get(dao.id!) || { proposerCount: 0, childDaoCount: 0 };
      const { admin_key_idx, treasury_multisig, mint_auth_multisig, ...rest } = dao;
      // Get proposal count from cache (undefined if not yet fetched)
      const proposalCount = getCachedProposalCount(dao.dao_pda);
      // Get icon from token metadata
      const icon = iconMap.get(dao.token_mint) || null;
      // Get decimals from on-chain data (skip DAOs with missing mint data)
      const token_decimals = decimalsMap.get(dao.token_mint);
      const quote_decimals = decimalsMap.get(dao.quote_mint);
      if (token_decimals === undefined || quote_decimals === undefined) {
        return null;
      }
      return {
        ...rest,
        treasury_vault: treasury_multisig,
        mint_vault: mint_auth_multisig,
        icon,
        token_decimals,
        quote_decimals,
        stats: {
          ...stats,
          proposalCount,
        },
      };
    });

    const result = { daos: enrichedDaos.filter((d): d is NonNullable<typeof d> => d !== null) };
    responseCache.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL });
    res.json(result);
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

    // Fetch token icon and decimals from on-chain data
    const [iconResult, tokenDecResult, quoteDecResult] = await Promise.allSettled([
      getTokenIcon(connection, dao.token_mint),
      getTokenDecimals(connection, dao.token_mint),
      getTokenDecimals(connection, dao.quote_mint),
    ]);
    const icon = iconResult.status === 'fulfilled' ? iconResult.value : null;
    const token_decimals = tokenDecResult.status === 'fulfilled' ? tokenDecResult.value : null;
    const quote_decimals = quoteDecResult.status === 'fulfilled' ? quoteDecResult.value : null;

    let children: any[] = [];
    if (dao.dao_type === 'parent') {
      const childDaos = await getChildDaos(pool, dao.id!);
      children = childDaos.map(({ admin_key_idx, ...child }) => child);
    }

    const { admin_key_idx, treasury_multisig, mint_auth_multisig, ...rest } = dao;

    const renamedChildren = children.map((child: any) => {
      const { treasury_multisig: tv, mint_auth_multisig: mv, ...childRest } = child;
      return { ...childRest, treasury_vault: tv, mint_vault: mv };
    });

    const proposalCount = getCachedProposalCount(daoPda);

    res.json({
      ...rest,
      treasury_vault: treasury_multisig,
      mint_vault: mint_auth_multisig,
      icon,
      token_decimals,
      quote_decimals,
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

router.get('/:daoPda/proposals', async (req: Request, res: Response) => {
  try {
    const { daoPda } = req.params;
    const connection = getConnection();
    const pool = getPool();

    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    let moderatorPda = dao.moderator_pda;
    if (!moderatorPda && dao.parent_dao_id) {
      const parentDao = await getDaoById(pool, dao.parent_dao_id);
      if (parentDao?.moderator_pda) {
        moderatorPda = parentDao.moderator_pda;
      }
    }

    // Return empty if no moderator or if DAO is pending finalization (reserved but not yet created on-chain)
    if (!moderatorPda || moderatorPda.startsWith('PENDING')) {
      return res.json({ proposals: [] });
    }

    // Fetch token decimals for this DAO
    const [baseDecResult, quoteDecResult] = await Promise.allSettled([
      getTokenDecimals(connection, dao.token_mint),
      getTokenDecimals(connection, dao.quote_mint),
    ]);
    const baseDecimals = baseDecResult.status === 'fulfilled' ? baseDecResult.value : null;
    const quoteDecimals = quoteDecResult.status === 'fulfilled' ? quoteDecResult.value : null;

    // Create a read-only client for on-chain fetching
    const readClient = createReadOnlyClient(connection);
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
        let marketBias: number = 0;

        try {
          const proposalAccount = await readClient.fetchProposal(proposalPda);
          const parsedState = futarchy.parseProposalState(proposalAccount.state);

          // On-chain length is in minutes, convert to seconds then milliseconds
          const proposalLengthMinutes = proposalAccount.config.length;
          createdAt = proposalAccount.createdAt.toNumber() * 1000;
          endsAt = createdAt + (proposalLengthMinutes * 60 * 1000);
          metadataCid = proposalAccount.metadata || null;
          vault = proposalAccount.vault.toBase58();
          marketBias = proposalAccount.config.marketBias;

          if (parsedState.state === 'setup') {
            status = 'Setup';
          } else if (parsedState.state === 'resolved') {
            status = 'Resolved';
            winningIndex = parsedState.winningIdx;
            finalizedAt = endsAt;  // Use endsAt as proxy for finalization time
          } else {
            status = 'Pending';
          }
        } catch (err) {
          console.warn(`Failed to fetch on-chain state for proposal ${proposalId} (${proposalPdaStr}):`, err);
          return null;
        }

        if (metadataCid) {
          try {
            const metadata = await fetchFromIPFS<{ title?: string; description?: string; options?: string[]; dao_pda?: string }>(metadataCid);
            title = metadata.title || title;
            description = metadata.description || description;
            options = metadata.options || options;
            metadataDaoPda = metadata.dao_pda || null;
          } catch (err) {
            console.warn(`Failed to fetch IPFS metadata for ${metadataCid}: ${err instanceof Error ? err.message : err}`);
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
          marketBias,
          baseDecimals,
          quoteDecimals,
        };
      })
    );

    const validProposals = proposals
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .filter((p) => p.metadataDaoPda === daoPda)
      .sort((a, b) => b.id - a.id);

    setCachedProposalCount(daoPda, validProposals.length);

    res.json({ proposals: validProposals });
  } catch (error) {
    console.error('Error fetching proposals:', error);
    res.status(500).json({ error: 'Failed to fetch proposals' });
  }
});

// ============================================================================
// GET /dao/:daoPda/proposal/live - Get the live (Pending) proposal for a DAO
// ============================================================================

router.get('/:daoPda/proposal/live', async (req: Request, res: Response) => {
  try {
    const { daoPda } = req.params;
    const connection = getConnection();
    const pool = getPool();

    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    // Fetch token decimals in parallel with moderator lookup
    const [baseDecResult, quoteDecResult] = await Promise.allSettled([
      getTokenDecimals(connection, dao.token_mint),
      getTokenDecimals(connection, dao.quote_mint),
    ]);
    const baseDecimals = baseDecResult.status === 'fulfilled' ? baseDecResult.value : null;
    const quoteDecimals = quoteDecResult.status === 'fulfilled' ? quoteDecResult.value : null;

    // Get the moderator PDA - for child DAOs, use parent's moderator
    let moderatorPda = dao.moderator_pda;
    if (!moderatorPda && dao.parent_dao_id) {
      const parentDao = await getDaoById(pool, dao.parent_dao_id);
      if (parentDao?.moderator_pda) {
        moderatorPda = parentDao.moderator_pda;
      }
    }

    // Return 404 if no moderator or if DAO is pending finalization (reserved but not yet created on-chain)
    if (!moderatorPda || moderatorPda.startsWith('PENDING')) {
      return res.status(404).json({ error: 'No live proposal found' });
    }

    // Create a read-only client for on-chain fetching
    const readClient = createReadOnlyClient(connection);
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
      return res.status(404).json({ error: 'No live proposal found' });
    }

    // Search proposals from newest to oldest for efficiency
    for (let proposalId = proposalCount - 1; proposalId >= 0; proposalId--) {
      const [proposalPda] = readClient.deriveProposalPDA(moderatorPubkey, proposalId);

      try {
        const proposalAccount = await readClient.fetchProposal(proposalPda);
        const parsedState = futarchy.parseProposalState(proposalAccount.state);

        if (parsedState.state !== 'pending') {
          continue;
        }

        const metadataCid = proposalAccount.metadata || null;
        let title = `Proposal #${proposalId}`;
        let description = '';
        let options: string[] = ['Pass', 'Fail'];
        let metadataDaoPda: string | null = null;

        if (metadataCid) {
          try {
            const metadata = await fetchFromIPFS<{ title?: string; description?: string; options?: string[]; dao_pda?: string }>(metadataCid);
            title = metadata.title || title;
            description = metadata.description || description;
            options = metadata.options || options;
            metadataDaoPda = metadata.dao_pda || null;
          } catch (err) {
            console.warn(`Failed to fetch IPFS metadata for ${metadataCid}: ${err instanceof Error ? err.message : err}`);
          }
        }

        if (metadataDaoPda !== daoPda) {
          continue;
        }

        // On-chain length is in minutes, convert to seconds for API
        const proposalLengthMinutes = proposalAccount.config.length;
        const proposalLengthSecs = proposalLengthMinutes * 60;
        const createdAt = proposalAccount.createdAt.toNumber() * 1000;
        const endsAt = createdAt + (proposalLengthSecs * 1000);
        const warmupDuration = proposalAccount.config.warmupDuration;
        const warmupEndsAt = createdAt + (warmupDuration * 1000);

        return res.json({
          id: proposalId,
          proposalPda: proposalPda.toBase58(),
          title,
          description,
          options,
          status: 'Pending',
          winningIndex: null,
          numOptions: proposalAccount.numOptions,
          createdAt,
          endsAt,
          warmupEndsAt,
          moderator: proposalAccount.moderator.toBase58(),
          creator: proposalAccount.creator.toBase58(),
          vault: proposalAccount.vault.toBase58(),
          baseMint: proposalAccount.baseMint.toBase58(),
          quoteMint: proposalAccount.quoteMint.toBase58(),
          baseDecimals,
          quoteDecimals,
          pools: proposalAccount.pools.map((p: PublicKey) => p.toBase58()),
          metadataCid,
          daoPda,
          config: {
            length: proposalLengthSecs,  // Return in seconds for API consumers
            warmupDuration,
            marketBias: proposalAccount.config.marketBias,
            fee: proposalAccount.config.fee,
          },
        });
      } catch (err) {
        console.warn(`Failed to fetch proposal ${proposalId}:`, err);
        continue;
      }
    }

    return res.status(404).json({ error: 'No live proposal found' });
  } catch (error) {
    console.error('Error fetching live proposal:', error);
    res.status(500).json({ error: 'Failed to fetch live proposal' });
  }
});

// ============================================================================
// GET /dao/proposals/all - Get all proposals from all DAOs
// ============================================================================

router.get('/proposals/all', async (_req: Request, res: Response) => {
  try {
    const hit = cached('proposals:all');
    if (hit) return res.json(hit);

    const pool = getPool();
    const connection = getConnection();
    const allDaos = await getAllDaos(pool);
    if (allDaos.length === 0) return res.json({ proposals: [] });

    // Batch fetch token metadata
    const tokenMints = allDaos.map(dao => dao.token_mint);
    const allMints = [...new Set([...tokenMints, ...allDaos.map(dao => dao.quote_mint)])];
    const [iconMap, decimalsMap] = await Promise.all([
      getTokenIcons(connection, tokenMints),
      getTokenDecimalsBatch(connection, allMints),
    ]);

    const readClient = createReadOnlyClient(connection);
    const coder = readClient.program.coder.accounts;

    // Resolve moderator PDAs from DB (no RPC needed)
    const daosByMod = new Map<string, typeof allDaos>();
    for (const dao of allDaos) {
      let modPda = dao.moderator_pda;
      if (!modPda && dao.parent_dao_id) {
        const parent = await getDaoById(pool, dao.parent_dao_id);
        if (parent?.moderator_pda) modPda = parent.moderator_pda;
      }
      if (!modPda || modPda.startsWith('PENDING')) continue;
      const arr = daosByMod.get(modPda) || [];
      arr.push(dao);
      daosByMod.set(modPda, arr);
    }

    // Batch fetch moderator accounts (1 RPC call per 100)
    const modPdas = [...daosByMod.keys()];
    const modCounts = new Map<string, number>();
    for (let i = 0; i < modPdas.length; i += 100) {
      const batch = modPdas.slice(i, i + 100);
      const accounts = await connection.getMultipleAccountsInfo(batch.map(p => new PublicKey(p)));
      for (let j = 0; j < accounts.length; j++) {
        if (!accounts[j]) continue;
        try {
          const decoded = coder.decode('moderatorAccount', accounts[j]!.data) as any;
          modCounts.set(batch[j], decoded.proposalIdCounter);
        } catch { /* skip */ }
      }
    }
    // Derive all proposal PDAs, then batch fetch
    const tasks: { dao: typeof allDaos[0]; proposalId: number; pda: PublicKey }[] = [];
    for (const [modPda, daos] of daosByMod) {
      const count = modCounts.get(modPda) || 0;
      const modPubkey = new PublicKey(modPda);
      for (let i = 0; i < count; i++) {
        const [pda] = readClient.deriveProposalPDA(modPubkey, i);
        for (const dao of daos) {
          tasks.push({ dao, proposalId: i, pda });
        }
      }
    }

    // Batch fetch all proposal accounts
    const decoded: (any | null)[] = new Array(tasks.length).fill(null);
    for (let i = 0; i < tasks.length; i += 100) {
      const batch = tasks.slice(i, i + 100).map(t => t.pda);
      const accounts = await connection.getMultipleAccountsInfo(batch);
      for (let j = 0; j < accounts.length; j++) {
        if (!accounts[j]) continue;
        try { decoded[i + j] = coder.decode('proposalAccount', accounts[j]!.data); } catch { /* skip */ }
      }
    }
    // Fetch IPFS metadata in parallel (cached permanently by fetchFromIPFS)
    const ipfsPromises = new Map<string, Promise<{ title?: string; description?: string; options?: string[]; dao_pda?: string } | null>>();
    for (let i = 0; i < tasks.length; i++) {
      const account = decoded[i];
      if (!account?.metadata) continue;
      const cid = account.metadata;
      if (!ipfsPromises.has(cid)) {
        ipfsPromises.set(cid, fetchFromIPFS<any>(cid).catch(() => null));
      }
    }
    const ipfsResults = new Map<string, any>();
    for (const [cid, promise] of ipfsPromises) {
      ipfsResults.set(cid, await promise);
    }
    // Assemble results
    const proposals: any[] = [];
    const countsByDao = new Map<string, number>();

    for (let i = 0; i < tasks.length; i++) {
      const account = decoded[i];
      if (!account) continue;

      const { dao, proposalId, pda } = tasks[i];
      const parsedState = futarchy.parseProposalState(account.state);
      if (parsedState.state === 'setup') continue;

      let title = `Proposal #${proposalId}`;
      let description = '';
      let options: string[] = ['Pass', 'Fail'];
      const metadataCid = account.metadata || null;

      if (metadataCid) {
        const metadata = ipfsResults.get(metadataCid);
        if (metadata) {
          title = metadata.title || title;
          description = metadata.description || description;
          options = metadata.options || options;
          if ((metadata.dao_pda || null) !== dao.dao_pda) continue;
        } else {
          // Can't verify DAO ownership without metadata
          continue;
        }
      }

      const lengthMin = account.config.length;
      const createdAt = account.createdAt.toNumber() * 1000;
      const endsAt = createdAt + (lengthMin * 60 * 1000);

      proposals.push({
        id: proposalId,
        proposalPda: pda.toBase58(),
        title,
        description,
        options,
        status: parsedState.state === 'resolved' ? 'Resolved' : 'Pending',
        winningIndex: parsedState.state === 'resolved' ? parsedState.winningIdx : null,
        vault: account.vault.toBase58(),
        createdAt,
        endsAt,
        finalizedAt: parsedState.state === 'resolved' ? endsAt : null,
        metadataCid,
        marketBias: account.config.marketBias,
        baseDecimals: decimalsMap.get(dao.token_mint) ?? null,
        quoteDecimals: decimalsMap.get(dao.quote_mint) ?? null,
        daoPda: dao.dao_pda,
        daoName: dao.dao_name,
        tokenMint: dao.token_mint,
        tokenIcon: iconMap.get(dao.token_mint) || null,
      });

      countsByDao.set(dao.dao_pda, (countsByDao.get(dao.dao_pda) || 0) + 1);
    }

    for (const [daoPda, count] of countsByDao) {
      setCachedProposalCount(daoPda, count);
    }

    proposals.sort((a, b) => b.createdAt - a.createdAt);

    const result = { proposals };
    responseCache.set('proposals:all', { data: result, expiry: Date.now() + CACHE_TTL });
    res.json(result);
  } catch (error) {
    console.error('Error fetching all proposals:', error);
    res.status(500).json({ error: 'Failed to fetch proposals' });
  }
});

// ============================================================================
// GET /dao/proposal/:proposalPda - Get a single proposal by PDA
// ============================================================================

router.get('/proposal/:proposalPda', async (req: Request, res: Response) => {
  try {
    const { proposalPda } = req.params;
    const connection = getConnection();

    if (!isValidTokenMintAddress(proposalPda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    const proposalPubkey = new PublicKey(proposalPda);
    const readClient = createReadOnlyClient(connection);

    let proposalAccount;
    try {
      proposalAccount = await readClient.fetchProposal(proposalPubkey);
    } catch (err) {
      console.error(`Failed to fetch proposal ${proposalPda} from chain:`, err);
      return res.status(404).json({ error: 'Proposal not found on-chain' });
    }

    const parsedState = futarchy.parseProposalState(proposalAccount.state);
    let status: 'Setup' | 'Pending' | 'Resolved' = 'Pending';
    let winningIndex: number | null = null;
    if (parsedState.state === 'setup') {
      status = 'Setup';
    } else if (parsedState.state === 'resolved') {
      status = 'Resolved';
      winningIndex = parsedState.winningIdx;
    }

    // On-chain length is in minutes, convert to seconds for API
    const proposalLengthMinutes = proposalAccount.config.length;
    const proposalLengthSecs = proposalLengthMinutes * 60;
    const createdAt = proposalAccount.createdAt.toNumber() * 1000;
    const endsAt = createdAt + (proposalLengthSecs * 1000);
    const warmupDuration = proposalAccount.config.warmupDuration;
    const warmupEndsAt = createdAt + (warmupDuration * 1000);
    const metadataCid = proposalAccount.metadata || null;

    let title = `Proposal #${proposalAccount.id}`;
    let description = '';
    let options: string[] = ['Pass', 'Fail'];
    let daoPda: string | null = null;

    if (metadataCid) {
      try {
        const metadata = await fetchFromIPFS<{ title?: string; description?: string; options?: string[]; dao_pda?: string }>(metadataCid);
        title = metadata.title || title;
        description = metadata.description || description;
        options = metadata.options || options;
        daoPda = metadata.dao_pda || null;
      } catch (err) {
        console.warn(`Failed to fetch IPFS metadata for ${metadataCid}: ${err instanceof Error ? err.message : err}`);
      }
    }

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
      config: {
        length: proposalLengthSecs,  // Return in seconds for API consumers
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

export default router;
