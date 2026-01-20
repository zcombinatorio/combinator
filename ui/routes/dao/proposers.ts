/*
 * Z Combinator - Solana Token Launchpad
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
 */

import { Router, Request, Response } from 'express';

import { getPool } from '../../lib/db';
import {
  getDaoByPda,
  addProposer,
  removeProposer,
  updateProposerThreshold,
  updateProposerHoldingPeriod,
  updateWithdrawalPercentage,
} from '../../lib/db/daos';
import { isValidSolanaAddress, isValidTokenMintAddress } from '../../lib/validation';
import { requireSignedHash } from '../../lib/dao';

const router = Router();

// ============================================================================
// Proposer Whitelist Management
// ============================================================================

/**
 * POST /dao/:daoPda/proposers - Add a proposer to the whitelist
 * Only callable by the DAO owner
 */
router.post('/:daoPda/proposers', requireSignedHash, async (req: Request, res: Response) => {
  try {
    const { daoPda } = req.params;
    const { wallet, proposer_wallet } = req.body;

    if (!isValidTokenMintAddress(daoPda)) {
      return res.status(400).json({ error: 'Invalid DAO PDA' });
    }

    if (!proposer_wallet || !isValidSolanaAddress(proposer_wallet)) {
      return res.status(400).json({ error: 'Invalid or missing proposer_wallet' });
    }

    const pool = getPool();

    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    if (dao.owner_wallet !== wallet) {
      return res.status(403).json({ error: 'Only the DAO owner can manage proposers' });
    }

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

    if (!isValidTokenMintAddress(daoPda)) {
      return res.status(400).json({ error: 'Invalid DAO PDA' });
    }

    if (!isValidSolanaAddress(proposerWallet)) {
      return res.status(400).json({ error: 'Invalid proposer wallet' });
    }

    const pool = getPool();

    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    if (dao.owner_wallet !== wallet) {
      return res.status(403).json({ error: 'Only the DAO owner can manage proposers' });
    }

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
 * PUT /dao/:daoPda/proposer-threshold - Update the token holding threshold and optional holding period
 * Only callable by the DAO owner
 *
 * Request body:
 * - wallet: Owner wallet address (required)
 * - threshold: Token amount threshold (required, string of raw token units)
 * - holding_period_hours: Optional hours over which to calculate average balance (1-8760)
 */
router.put('/:daoPda/proposer-threshold', requireSignedHash, async (req: Request, res: Response) => {
  try {
    const { daoPda } = req.params;
    const { wallet, threshold, holding_period_hours } = req.body;

    if (!isValidTokenMintAddress(daoPda)) {
      return res.status(400).json({ error: 'Invalid DAO PDA' });
    }

    // Validate threshold
    let normalizedThreshold: string | null = null;
    if (threshold !== null && threshold !== undefined && threshold !== '' && threshold !== '0') {
      if (!/^\d+$/.test(threshold)) {
        return res.status(400).json({ error: 'Threshold must be a non-negative integer string (raw token units)' });
      }
      normalizedThreshold = threshold;
    }

    // Validate holding period
    let normalizedHoldingPeriod: number | null = null;
    if (holding_period_hours !== null && holding_period_hours !== undefined && holding_period_hours !== '') {
      const hours = parseInt(holding_period_hours, 10);
      if (isNaN(hours) || hours < 1 || hours > 8760) {
        return res.status(400).json({ error: 'Holding period must be a positive integer between 1 and 8760 hours (1 year)' });
      }
      // Can't set holding period without a threshold
      if (!normalizedThreshold) {
        return res.status(400).json({ error: 'Cannot set holding period without a token threshold' });
      }
      normalizedHoldingPeriod = hours;
    }

    const pool = getPool();

    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    if (dao.owner_wallet !== wallet) {
      return res.status(403).json({ error: 'Only the DAO owner can update the proposer threshold' });
    }

    await updateProposerThreshold(pool, dao.id!, normalizedThreshold);
    await updateProposerHoldingPeriod(pool, dao.id!, normalizedHoldingPeriod);

    console.log(`Updated proposer threshold for DAO ${dao.dao_name} to ${normalizedThreshold ?? 'null (disabled)'}, holding period: ${normalizedHoldingPeriod ?? 'null (disabled)'} by ${wallet}`);

    res.json({
      success: true,
      dao_pda: daoPda,
      dao_name: dao.dao_name,
      proposer_token_threshold: normalizedThreshold,
      proposer_holding_period_hours: normalizedHoldingPeriod,
    });
  } catch (error) {
    console.error('Error updating proposer threshold:', error);
    res.status(500).json({ error: 'Failed to update proposer threshold', details: String(error) });
  }
});

/**
 * PUT /dao/:daoPda/withdrawal-percentage - Update the liquidity withdrawal percentage
 * Only callable by the DAO owner
 */
router.put('/:daoPda/withdrawal-percentage', requireSignedHash, async (req: Request, res: Response) => {
  try {
    const { daoPda } = req.params;
    const { wallet, percentage } = req.body;

    if (!isValidTokenMintAddress(daoPda)) {
      return res.status(400).json({ error: 'Invalid DAO PDA' });
    }

    // Validate percentage
    const percentageNum = parseInt(percentage);
    if (isNaN(percentageNum) || percentageNum < 5 || percentageNum > 50) {
      return res.status(400).json({
        error: 'Invalid withdrawal percentage',
        details: 'Percentage must be an integer between 5 and 50',
      });
    }

    const pool = getPool();

    const dao = await getDaoByPda(pool, daoPda);
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found' });
    }

    if (dao.owner_wallet !== wallet) {
      return res.status(403).json({ error: 'Only the DAO owner can update the withdrawal percentage' });
    }

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

export default router;
