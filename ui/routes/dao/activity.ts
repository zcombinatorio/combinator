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

/**
 * Activity Tracking API
 * Track wallet participation and volume on futarchy proposal markets
 */

import { Router, Request, Response } from 'express';

import { getPool } from '../../lib/db';
import { isValidSolanaAddress, isValidTokenMintAddress } from '../../lib/validation';
import {
  getWalletActivities,
  getWalletStats,
  getVolumeLeaderboard,
  getProposalActivities,
  getProposalStats,
} from '../../lib/db/trading-activities';

const router = Router();

// ============================================================================
// GET /dao/activity/leaderboard - Top traders by volume
// NOTE: Must be defined before /:wallet to prevent route interception
// ============================================================================

router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const { limit, offset, dao, proposal } = req.query;

    const pool = getPool();
    const parsedLimit = limit ? parseInt(limit as string, 10) : 50;
    const parsedOffset = offset ? parseInt(offset as string, 10) : 0;
    const daoName = dao && typeof dao === 'string' && dao.trim() ? dao.trim() : undefined;
    const proposalPda = proposal && typeof proposal === 'string' && isValidTokenMintAddress(proposal)
      ? proposal : undefined;

    // Validate pagination params
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return res.status(400).json({ error: 'limit must be between 1 and 100' });
    }
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({ error: 'offset must be non-negative' });
    }

    // Validate proposal param if provided but invalid
    if (proposal && !proposalPda) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    const leaderboard = await getVolumeLeaderboard(pool, {
      limit: parsedLimit,
      offset: parsedOffset,
      daoName,
      proposalPda,
    });

    const response: Record<string, unknown> = {
      leaderboard,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: leaderboard.length === parsedLimit,
      },
    };

    if (proposalPda) {
      response.proposal = proposalPda;
    } else if (daoName) {
      response.dao = daoName;
    }

    res.json(response);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard', details: String(error) });
  }
});

// ============================================================================
// GET /dao/activity/proposal/:pda - All activity on a proposal
// NOTE: Must be defined before /:wallet to prevent route interception
// ============================================================================

router.get('/proposal/:pda', async (req: Request, res: Response) => {
  try {
    const { pda } = req.params;
    const { limit, offset } = req.query;

    if (!isValidTokenMintAddress(pda)) {
      return res.status(400).json({ error: 'Invalid proposal PDA' });
    }

    const pool = getPool();
    const parsedLimit = limit ? parseInt(limit as string, 10) : 50;
    const parsedOffset = offset ? parseInt(offset as string, 10) : 0;

    // Validate pagination params
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return res.status(400).json({ error: 'limit must be between 1 and 100' });
    }
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({ error: 'offset must be non-negative' });
    }

    const [stats, activities] = await Promise.all([
      getProposalStats(pool, pda),
      getProposalActivities(pool, pda, { limit: parsedLimit, offset: parsedOffset }),
    ]);

    res.json({
      proposalPda: pda,
      stats,
      activities,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: activities.length === parsedLimit,
      },
    });
  } catch (error) {
    console.error('Error fetching proposal activity:', error);
    res.status(500).json({ error: 'Failed to fetch proposal activity', details: String(error) });
  }
});

// ============================================================================
// GET /dao/activity/:wallet - Wallet's trading history + stats
// ============================================================================

router.get('/:wallet', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    const { limit, offset, dao } = req.query;

    if (!isValidSolanaAddress(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const pool = getPool();
    const parsedLimit = limit ? parseInt(limit as string, 10) : 50;
    const parsedOffset = offset ? parseInt(offset as string, 10) : 0;
    const daoName = dao && typeof dao === 'string' && dao.trim() ? dao.trim() : undefined;

    // Validate pagination params
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return res.status(400).json({ error: 'limit must be between 1 and 100' });
    }
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({ error: 'offset must be non-negative' });
    }

    const [stats, activities] = await Promise.all([
      getWalletStats(pool, wallet, { daoName }),
      getWalletActivities(pool, wallet, { limit: parsedLimit, offset: parsedOffset, daoName }),
    ]);

    const response: Record<string, unknown> = {
      wallet,
      stats,
      activities,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: activities.length === parsedLimit,
      },
    };

    if (daoName) {
      response.dao = daoName;
    }

    res.json(response);
  } catch (error) {
    console.error('Error fetching wallet activity:', error);
    res.status(500).json({ error: 'Failed to fetch wallet activity', details: String(error) });
  }
});

export default router;
