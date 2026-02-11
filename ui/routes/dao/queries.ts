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
} from '../../lib/db/daos';
import { Dao } from '../../lib/db/types';
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

// ============================================================================
// Helper: Parallel fetch with concurrency limit
// ============================================================================

async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = fn(item).then((result) => {
      results.push(result);
    });
    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
      // Remove completed promises
      for (let i = executing.length - 1; i >= 0; i--) {
        // Check if promise is settled by trying to await with timeout 0
        const settled = await Promise.race([
          executing[i].then(() => true),
          Promise.resolve(false),
        ]);
        if (settled) {
          executing.splice(i, 1);
        }
      }
    }
  }

  await Promise.all(executing);
  return results;
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

    // Batch fetch token icons and decimals for all DAOs
    const tokenMints = daos.map(dao => dao.token_mint);
    const quoteMints = daos.map(dao => dao.quote_mint);
    // Collect unique mints for decimal fetching (both base and quote)
    const allMints = [...new Set([...tokenMints, ...quoteMints])];

    const [iconMap, decimalsMap] = await Promise.all([
      getTokenIcons(connection, tokenMints),
      getTokenDecimalsBatch(connection, allMints),
    ]);

    // Enrich with stats, icons, decimals, strip internal fields, and rename DB columns to API fields
    const enrichedDaos = await Promise.all(
      daos.map(async (dao) => {
        const stats = await getDaoStats(pool, dao.id!);
        const { admin_key_idx, treasury_multisig, mint_auth_multisig, ...rest } = dao;
        // Get proposal count from cache (undefined if not yet fetched)
        const proposalCount = getCachedProposalCount(dao.dao_pda);
        // Get icon from token metadata
        const icon = iconMap.get(dao.token_mint) || null;
        // Get decimals from on-chain data
        const token_decimals = decimalsMap.get(dao.token_mint)!;
        const quote_decimals = decimalsMap.get(dao.quote_mint)!;
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

    // Fetch token icon and decimals from on-chain data
    const [icon, token_decimals, quote_decimals] = await Promise.all([
      getTokenIcon(connection, dao.token_mint),
      getTokenDecimals(connection, dao.token_mint),
      getTokenDecimals(connection, dao.quote_mint),
    ]);

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

    if (!moderatorPda) {
      return res.json({ proposals: [] });
    }

    // Fetch token decimals for this DAO
    const [baseDecimals, quoteDecimals] = await Promise.all([
      getTokenDecimals(connection, dao.token_mint),
      getTokenDecimals(connection, dao.quote_mint),
    ]);

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
    const [baseDecimals, quoteDecimals] = await Promise.all([
      getTokenDecimals(connection, dao.token_mint),
      getTokenDecimals(connection, dao.quote_mint),
    ]);

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
// GET /dao/proposals/all - Get all proposals from all DAOs (OPTIMIZED)
// ============================================================================

interface ProposalInfo {
  dao: Dao;
  proposalId: number;
  proposalPda: PublicKey;
  moderatorPda: string;
}

router.get('/proposals/all', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const connection = getConnection();

    const allDaos = await getAllDaos(pool);

    if (allDaos.length === 0) {
      return res.json({ proposals: [] });
    }

    // Step 1: Pre-build parent DAO map to avoid N+1 queries
    const parentDaoMap = new Map<number, Dao>();
    for (const dao of allDaos) {
      if (dao.dao_type === 'parent' && dao.id) {
        parentDaoMap.set(dao.id, dao);
      }
    }

    // Step 2: Resolve moderator PDAs for all DAOs (using pre-built map)
    const daoWithModerator: { dao: Dao; moderatorPda: string }[] = [];
    for (const dao of allDaos) {
      let moderatorPda = dao.moderator_pda;
      if (!moderatorPda && dao.parent_dao_id) {
        const parentDao = parentDaoMap.get(dao.parent_dao_id);
        if (parentDao?.moderator_pda) {
          moderatorPda = parentDao.moderator_pda;
        }
      }
      // Skip if no moderator or if DAO is pending finalization
      if (moderatorPda && !moderatorPda.startsWith('PENDING')) {
        daoWithModerator.push({ dao, moderatorPda });
      }
    }

    if (daoWithModerator.length === 0) {
      return res.json({ proposals: [] });
    }

    // Step 3: Batch fetch token icons and decimals
    const tokenMints = allDaos.map(dao => dao.token_mint);
    const quoteMints = allDaos.map(dao => dao.quote_mint);
    const allMints = [...new Set([...tokenMints, ...quoteMints])];

    const [iconMap, decimalsMap] = await Promise.all([
      getTokenIcons(connection, tokenMints),
      getTokenDecimalsBatch(connection, allMints),
    ]);

    // Step 4: Fetch all moderators in parallel (with concurrency limit)
    const readClient = createReadOnlyClient(connection);
    const MODERATOR_CONCURRENCY = 10;

    const moderatorResults = await Promise.all(
      daoWithModerator.map(async ({ dao, moderatorPda }) => {
        try {
          const moderatorPubkey = new PublicKey(moderatorPda);
          const moderator = await readClient.fetchModerator(moderatorPubkey);
          return { dao, moderatorPda, moderatorPubkey, proposalCount: moderator.proposalIdCounter };
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          if (!errMsg.includes('Account does not exist')) {
            console.warn(`Failed to fetch moderator ${moderatorPda} for DAO ${dao.dao_name}:`, err);
          }
          return null;
        }
      })
    );

    // Step 5: Collect all proposal PDAs to fetch
    const proposalsToFetch: ProposalInfo[] = [];
    for (const result of moderatorResults) {
      if (!result || result.proposalCount === 0) continue;

      for (let i = 0; i < result.proposalCount; i++) {
        const [proposalPda] = readClient.deriveProposalPDA(result.moderatorPubkey, i);
        proposalsToFetch.push({
          dao: result.dao,
          proposalId: i,
          proposalPda,
          moderatorPda: result.moderatorPda,
        });
      }
    }

    if (proposalsToFetch.length === 0) {
      return res.json({ proposals: [] });
    }

    // Step 6: Fetch all proposals in parallel (with concurrency limit)
    const PROPOSAL_CONCURRENCY = 20;

    type ProposalResult = {
      info: ProposalInfo;
      account: Awaited<ReturnType<typeof readClient.fetchProposal>>;
      parsedState: ReturnType<typeof futarchy.parseProposalState>;
    } | null;

    const proposalResults: ProposalResult[] = await Promise.all(
      proposalsToFetch.map(async (info) => {
        try {
          const account = await readClient.fetchProposal(info.proposalPda);
          const parsedState = futarchy.parseProposalState(account.state);
          return { info, account, parsedState };
        } catch (err) {
          console.warn(`Failed to fetch proposal ${info.proposalId} for DAO ${info.dao.dao_name}:`, err);
          return null;
        }
      })
    );

    // Step 7: Collect IPFS CIDs and fetch metadata in parallel
    const IPFS_CONCURRENCY = 15;
    const validProposalResults = proposalResults.filter((r): r is NonNullable<typeof r> => r !== null);

    // Build a map of CID -> metadata
    const cidsToFetch = new Set<string>();
    for (const result of validProposalResults) {
      if (result.account.metadata) {
        cidsToFetch.add(result.account.metadata);
      }
    }

    const metadataMap = new Map<string, { title?: string; description?: string; options?: string[]; dao_pda?: string }>();

    // Fetch all IPFS metadata in parallel with concurrency limit
    const cidArray = Array.from(cidsToFetch);
    const metadataResults = await Promise.all(
      cidArray.map(async (cid) => {
        try {
          const metadata = await fetchFromIPFS<{ title?: string; description?: string; options?: string[]; dao_pda?: string }>(cid);
          return { cid, metadata };
        } catch (err) {
          console.warn(`Failed to fetch IPFS metadata for ${cid}: ${err instanceof Error ? err.message : err}`);
          return { cid, metadata: null };
        }
      })
    );

    for (const { cid, metadata } of metadataResults) {
      if (metadata) {
        metadataMap.set(cid, metadata);
      }
    }

    // Step 8: Build final proposal list
    const proposals = validProposalResults
      .map((result) => {
        const { info, account, parsedState } = result;
        const { dao, proposalId, proposalPda } = info;

        // Skip Setup proposals
        if (parsedState.state === 'setup') {
          return null;
        }

        const metadataCid = account.metadata || null;
        let title = `Proposal #${proposalId}`;
        let description = '';
        let options: string[] = ['Pass', 'Fail'];
        let metadataDaoPda: string | null = null;

        if (metadataCid) {
          const metadata = metadataMap.get(metadataCid);
          if (metadata) {
            title = metadata.title || title;
            description = metadata.description || description;
            options = metadata.options || options;
            metadataDaoPda = metadata.dao_pda || null;
          }
        }

        // Filter by DAO PDA if metadata was successfully fetched
        if (metadataCid && metadataMap.has(metadataCid) && metadataDaoPda !== dao.dao_pda) {
          return null;
        }

        const proposalLengthMinutes = account.config.length;
        const createdAt = account.createdAt.toNumber() * 1000;
        const endsAt = createdAt + (proposalLengthMinutes * 60 * 1000);

        let status: 'Pending' | 'Resolved' = 'Pending';
        let winningIndex: number | null = null;
        let finalizedAt: number | null = null;

        if (parsedState.state === 'resolved') {
          status = 'Resolved';
          winningIndex = parsedState.winningIdx;
          finalizedAt = endsAt;
        }

        return {
          id: proposalId,
          proposalPda: proposalPda.toBase58(),
          title,
          description,
          options,
          status,
          winningIndex,
          vault: account.vault.toBase58(),
          createdAt,
          endsAt,
          finalizedAt,
          metadataCid,
          marketBias: account.config.marketBias,
          baseDecimals: decimalsMap.get(dao.token_mint)!,
          quoteDecimals: decimalsMap.get(dao.quote_mint)!,
          daoPda: dao.dao_pda,
          daoName: dao.dao_name,
          tokenMint: dao.token_mint,
          tokenIcon: iconMap.get(dao.token_mint) || null,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .sort((a, b) => b.createdAt - a.createdAt);

    // Update proposal count cache for each DAO
    const proposalsByDao = new Map<string, number>();
    for (const p of proposals) {
      proposalsByDao.set(p.daoPda, (proposalsByDao.get(p.daoPda) || 0) + 1);
    }
    for (const [daoPda, count] of proposalsByDao) {
      setCachedProposalCount(daoPda, count);
    }

    res.json({ proposals });
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
