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
 * Verify historical DAO and proposal migrations
 *
 * Checks that on-chain state and database entries match expected values.
 *
 * Usage:
 *   # Verify specific DAOs
 *   DAO_NAMES="SURFTEST,TESTSURF" pnpm tsx scripts/verify-migration.ts
 *
 *   # Verify all DAOs
 *   pnpm tsx scripts/verify-migration.ts
 *
 *   # Sample IPFS metadata (slower, fetches from IPFS)
 *   VERIFY_IPFS=true pnpm tsx scripts/verify-migration.ts
 *
 *   # Skip database verification (only verify on-chain)
 *   SKIP_DB=true pnpm tsx scripts/verify-migration.ts
 *
 * Required environment variables:
 *   - RPC_URL: Solana RPC URL
 *   - DB_URL: PostgreSQL connection string (unless SKIP_DB=true)
 *
 * Optional:
 *   - DAO_NAMES: Comma-separated list of DAOs to verify (default: all)
 *   - VERIFY_IPFS: Set to "true" to also verify IPFS metadata
 *   - IPFS_SAMPLE_SIZE: Number of proposals to sample for IPFS verification (default: 3)
 *   - SKIP_DB: Set to "true" to skip database verification
 */

import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Keypair } from '@solana/web3.js';
import { FutarchyClient, parseProposalState } from '@zcomb/programs-sdk';
import { fetchFromIPFS, ProposalMetadata } from '../lib/ipfs';
import { getPool } from '../lib/db';
import { getDaoByName, getProposersByDao } from '../lib/db/daos';

// =============================================================================
// EXPECTED DATA - Import from migration scripts
// =============================================================================

interface HistoricalProposal {
  legacyId: number;
  title: string;
  description: string;
  options: string[];
  winningIdx: number;
  length: number;
  createdAt: number;
}

interface DaoConfig {
  name: string;
  baseMint: string;
  quoteMint: string;
  pool: string;
  poolType: 'damm' | 'dlmm';
  proposalIdCounter: number;
  treasuryMultisig: string;
  mintAuthMultisig: string;
  cosigner: string;
  // Database fields
  adminWallet: string;
  ownerWallet: string;
}

// Copy from migrate-historical-daos.ts
const DAO_CONFIGS: Record<string, DaoConfig> = {
  SURFTEST: {
    name: 'SURFTEST',
    baseMint: 'E7xktmaFNM6vd4GKa8FrXwX7sA7hrLzToxc64foGq3iW',
    quoteMint: 'So11111111111111111111111111111111111111112',
    pool: 'PS3rPSb49GnAkmh3tec1RQizgNSb1hUwPsYHGGuAy5r',
    poolType: 'damm',
    proposalIdCounter: 0,
    treasuryMultisig: 'CcNLEfshWM7EPcEUxtJkRWd5BCrjvFqJCexz5oU3SyFz',
    mintAuthMultisig: 'Ed8gTWnKvEVz17ucjJPm7nxPtE1uRBghbv8nRnGGnJHS',
    cosigner: 'Dobm8QnaCPQoc6koxC3wqBQqPTfDwspATb2u6EcWC9Aw',
    adminWallet: 'ESMiG5ppoVMtYq3EG8aKx3XzEtKPfiGQuAx2S4jhw3zf',
    ownerWallet: '83PbZortE6imDzJcZrd5eGS42zbSAskJw7eP26GaJbqE',
  },
  TESTSURF: {
    name: 'TESTSURF',
    baseMint: 'E7xktmaFNM6vd4GKa8FrXwX7sA7hrLzToxc64foGq3iW',
    quoteMint: 'So11111111111111111111111111111111111111112',
    pool: 'EC7MUufEpZcRZyXTFt16MMNLjJVnj9Vkku4UwdZ713Hx',
    poolType: 'dlmm',
    proposalIdCounter: 0,
    treasuryMultisig: '2YFLK2DMnkJzSLstZP2LZxD282LazBAVdWqKo4ypHnrG',
    mintAuthMultisig: 'DF4VNShA6GgSVmqtMCyFmMxypQEMRtuqdw93LSPxQWPp',
    cosigner: 'Dobm8QnaCPQoc6koxC3wqBQqPTfDwspATb2u6EcWC9Aw',
    adminWallet: 'BnzxLbNmM63RxhHDdfeWa7BmV2YM4q7KxDJ3w75kDZo',
    ownerWallet: '83PbZortE6imDzJcZrd5eGS42zbSAskJw7eP26GaJbqE',
  },
  ZC: {
    name: 'ZC',
    baseMint: 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC',
    quoteMint: 'So11111111111111111111111111111111111111112',
    pool: '7jbhVZcYqCRmciBcZzK8L5B96Pyw7i1SpXQFKBkzD3G2',
    poolType: 'dlmm',
    proposalIdCounter: 0,
    treasuryMultisig: '4Ckm4JKxJr6qZJHhoPnTkeVdV1qEPmt53hfVcFPCb5fU',
    mintAuthMultisig: 'DkbYcMeoMxk2qnUqYGtKhDGqmc1MDvw7H8a1Tcf7qotL',
    cosigner: '6MT2poUCxMNgFczNqmBVJ4D4ZSTidzwnNUdY4FivtSHU',
    adminWallet: '54A1ki4t5K9sB6oqLBVxVkUbkkCEAGeRACphsZuNPU5R',
    ownerWallet: '83PbZortE6imDzJcZrd5eGS42zbSAskJw7eP26GaJbqE',
  },
  SURF: {
    name: 'SURF',
    baseMint: 'SurfwRjQQFV6P7JdhxSptf4CjWU8sb88rUiaLCystar',
    quoteMint: 'So11111111111111111111111111111111111111112',
    pool: 'Ez1QYeC95xJRwPA9SR7YWC1H1Tj43exJr91QqKf8Puu1',
    poolType: 'damm',
    proposalIdCounter: 0,
    treasuryMultisig: 'BmfaxQCRqf4xZFmQa5GswShBZhRBf4bED7hadFkpgBC3',
    mintAuthMultisig: 'CwHv7RjFnJX39GygjoANeCpo1XER6MFUy2ezBm3ScKJd',
    cosigner: '4GctbRKwsQjECaY1nL8HiqkgvEUAi8EyhU1ezNmhB3hg',
    adminWallet: 'etBt7Ki2Gr2rhidNmXtHyxiGHkokKPayNhG787SusMj',
    ownerWallet: '83PbZortE6imDzJcZrd5eGS42zbSAskJw7eP26GaJbqE',
  },
};

// Copy from migrate-historical-proposals.ts
const HISTORICAL_PROPOSALS: Record<string, HistoricalProposal[]> = {
  SURFTEST: [
    { legacyId: 1, title: 'test', description: 'test', options: ['No', 'Yes'], winningIdx: 0, length: 600, createdAt: 1765569540 },
    { legacyId: 2, title: 'test', description: 'test', options: ['No', 'yes'], winningIdx: 0, length: 600, createdAt: 1765847227 },
    { legacyId: 3, title: 'test', description: 'test', options: ['No', 'yes'], winningIdx: 1, length: 120, createdAt: 1765850879 },
    { legacyId: 4, title: 'test', description: 'test', options: ['No', 'Yes'], winningIdx: 1, length: 240, createdAt: 1766696179 },
    { legacyId: 5, title: 'test2', description: 'test2', options: ['No', 'Yes'], winningIdx: 0, length: 240, createdAt: 1766698210 },
    { legacyId: 6, title: 'test6', description: 'test6', options: ['No', 'Yes'], winningIdx: 0, length: 240, createdAt: 1766699950 },
    { legacyId: 7, title: 'test7', description: 'test7', options: ['No', 'Yes'], winningIdx: 0, length: 240, createdAt: 1766701073 },
    { legacyId: 8, title: 'test8', description: 'test8', options: ['No', 'Yes'], winningIdx: 0, length: 240, createdAt: 1766701447 },
    { legacyId: 9, title: 'test9', description: 'test9', options: ['No', 'Yes'], winningIdx: 0, length: 240, createdAt: 1766705193 },
    { legacyId: 10, title: 'test10', description: 'test10', options: ['No', 'Yes'], winningIdx: 0, length: 240, createdAt: 1766705752 },
    { legacyId: 11, title: 'test11', description: 'test11', options: ['No', 'Yes'], winningIdx: 0, length: 240, createdAt: 1766706293 },
    { legacyId: 12, title: 'test12', description: 'test12', options: ['No', 'Yes'], winningIdx: 0, length: 240, createdAt: 1766706572 },
    { legacyId: 13, title: 'test13', description: 'test13', options: ['No', 'Yes'], winningIdx: 0, length: 240, createdAt: 1766707506 },
    { legacyId: 14, title: 'test14', description: 'test14', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766707983 },
    { legacyId: 15, title: 'test15', description: 'test15', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766708139 },
    { legacyId: 16, title: 'test16', description: 'test16', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766710562 },
    { legacyId: 17, title: 'test17', description: 'test17', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766710684 },
    { legacyId: 18, title: 'test18', description: 'test18', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766710847 },
    { legacyId: 19, title: 'test19', description: 'test19', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766710963 },
    { legacyId: 26, title: 'test28', description: 'test28', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1767374353 },
    // NOTE: legacyId 29 skipped - had 7 options, exceeds MAX_OPTIONS limit
    { legacyId: 30, title: 'test30', description: 'test30', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1767996387 },
    { legacyId: 31, title: 'test31', description: 'test31', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1768068180 },
  ],
  TESTSURF: [
    { legacyId: 1, title: 'test', description: 'test', options: ['No', 'Yes'], winningIdx: 0, length: 240, createdAt: 1766625525 },
    { legacyId: 2, title: 'test2', description: 'test2', options: ['No', 'Yes'], winningIdx: 1, length: 240, createdAt: 1766626996 },
    { legacyId: 3, title: 'test', description: 'test', options: ['No', 'Yes'], winningIdx: 0, length: 240, createdAt: 1766627492 },
    { legacyId: 4, title: 'test4', description: 'test4', options: ['No', 'Yes'], winningIdx: 1, length: 240, createdAt: 1766629600 },
    { legacyId: 7, title: 'test20', description: 'test20', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766711518 },
    { legacyId: 8, title: 'test21', description: 'test21', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766711705 },
    { legacyId: 9, title: 'test22', description: 'test22', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766711941 },
    { legacyId: 10, title: 'test23', description: 'test23', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766713732 },
    { legacyId: 11, title: 'test24', description: 'test24', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766713935 },
    { legacyId: 12, title: 'test25', description: 'test25', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766714698 },
    { legacyId: 13, title: 'test26', description: 'test26', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766716913 },
    { legacyId: 18, title: 'test25', description: 'test25', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766776290 },
    { legacyId: 19, title: 'test26', description: 'test26', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1766776457 },
  ],
  ZC: [
    { legacyId: 0, title: 'ZC Emissions Proposal', description: 'ZC Emissions Proposal', options: ['fail', 'pass'], winningIdx: 1, length: 1800, createdAt: 1759716409 },
    { legacyId: 1, title: 'ZC Emissions Proposal', description: 'ZC Emissions Proposal', options: ['fail', 'pass'], winningIdx: 1, length: 1800, createdAt: 1759718533 },
    { legacyId: 2, title: 'Update Staking Vault Rewards and Parameters', description: 'Update Staking Vault Rewards and Parameters', options: ['fail', 'pass'], winningIdx: 0, length: 900, createdAt: 1759762564 },
    { legacyId: 3, title: 'Update Staking Vault Rewards and Parameters', description: 'Update Staking Vault Rewards and Parameters', options: ['fail', 'pass'], winningIdx: 1, length: 86400, createdAt: 1759765625 },
    { legacyId: 4, title: 'SolPay Retroactive Holder Redistribution (ZC-2)', description: 'SolPay Retroactive Holder Redistribution (ZC-2)', options: ['fail', 'pass'], winningIdx: 1, length: 10800, createdAt: 1759943782 },
    { legacyId: 5, title: 'percent Pre-sale Mechanics Adjustment (ZC-3)', description: 'percent Pre-sale Mechanics Adjustment (ZC-3)', options: ['fail', 'pass'], winningIdx: 1, length: 57600, createdAt: 1760569883 },
    { legacyId: 6, title: 'What is the price of $oogway after OOG-1 settles?', description: 'What is the price of $oogway after OOG-1 settles?', options: ['fail', 'pass'], winningIdx: 1, length: 3600, createdAt: 1758065845 },
    { legacyId: 7, title: 'What is the price of $oogway after the OOG-2 market resolves?', description: 'What is the price of $oogway after the OOG-2 market resolves?', options: ['fail', 'pass'], winningIdx: 1, length: 86400, createdAt: 1758294591 },
    { legacyId: 8, title: 'ZC UI design overhaul', description: 'ZC UI design overhaul', options: ['fail', 'pass'], winningIdx: 1, length: 86400, createdAt: 1761689679 },
    { legacyId: 9, title: 'Percent, ZTORIO, SolPay - ZC emission splits', description: 'Percent, ZTORIO, SolPay - ZC emission splits', options: ['fail', 'pass'], winningIdx: 1, length: 86400, createdAt: 1761779523 },
    { legacyId: 11, title: 'ZTORIO Migration Script', description: 'Should ZC merge PR #2 into main? https://github.com/zcombinatorio/zcombinator/pull/2', options: ['fail', 'pass'], winningIdx: 1, length: 86400, createdAt: 1761877003 },
    { legacyId: 12, title: 'StreamVC Token Launch Spec', description: 'Should ZC execute on the proposal in PR #27? https://github.com/zcombinatorio/zcombinator/pull/27', options: ['fail', 'pass'], winningIdx: 1, length: 86400, createdAt: 1762209326 },
    { legacyId: 13, title: 'Infinite Supply Mitigation', description: 'Should ZC merge PR #29 into main? https://github.com/zcombinatorio/zcombinator/pull/29', options: ['fail', 'pass'], winningIdx: 1, length: 86400, createdAt: 1762301792 },
    { legacyId: 14, title: 'ZC Staking Benefits Proposal by Balloon', description: 'Should ZC execute on PR #36? https://github.com/zcombinatorio/zcombinator/pull/36', options: ['fail', 'pass'], winningIdx: 0, length: 86400, createdAt: 1762389014 },
    { legacyId: 15, title: 'Decision Market Gated Creator Fees by BORD', description: 'Should ZC execute on PR #35? https://github.com/zcombinatorio/zcombinator/pull/35', options: ['fail', 'pass'], winningIdx: 0, length: 64800, createdAt: 1762477730 },
    { legacyId: 16, title: 'Turn Off ZC Staking by Hands', description: 'Should ZC execute on PR #40? https://github.com/zcombinatorio/zcombinator/pull/40', options: ['fail', 'pass'], winningIdx: 1, length: 68400, createdAt: 1762551991 },
    { legacyId: 17, title: 'Transition to a Liquid, Commitment-Based Staking System by Deflation', description: 'Should ZC execute on PR #41? https://github.com/zcombinatorio/zcombinator/pull/41', options: ['fail', 'pass'], winningIdx: 0, length: 64800, createdAt: 1762710015 },
    { legacyId: 18, title: 'PERC <> ZC Merger by Oogway', description: 'Should ZC execute on PR #42? https://github.com/zcombinatorio/zcombinator/pull/42', options: ['fail', 'pass'], winningIdx: 1, length: 86400, createdAt: 1762801674 },
    { legacyId: 19, title: 'ZC Landing Page and App Redesign by Bennie', description: 'Should ZC merge PR #37? https://github.com/zcombinatorio/zcombinator/pull/37', options: ['fail', 'pass'], winningIdx: 0, length: 64800, createdAt: 1762897946 },
    { legacyId: 20, title: 'ZCxPERC UX/UI Redesign by 352oz', description: 'Should ZC merge PR #14? https://github.com/zcombinatorio/zcombinator/pull/14', options: ['fail', 'pass'], winningIdx: 1, length: 86400, createdAt: 1763061672 },
    { legacyId: 21, title: 'Mod Payment Proposal by Sadghost', description: 'Should ZC execute on PR #50? https://github.com/zcombinatorio/zcombinator/pull/50', options: ['fail', 'pass'], winningIdx: 0, length: 86400, createdAt: 1763578057 },
    { legacyId: 22, title: 'Multiple Staking Time Options by Maverick', description: 'Should ZC execute on PR #38? https://github.com/zcombinatorio/zcombinator/pull/38', options: ['fail', 'pass'], winningIdx: 0, length: 64800, createdAt: 1763677131 },
    { legacyId: 23, title: '$ZC Tokenomics', description: 'Should ZC implement the tokenomics described here?\n  https://x.com/handsdiff/status/1995184046771437988', options: ['No', 'Yes'], winningIdx: 1, length: 600, createdAt: 1764649920 },
    { legacyId: 24, title: 'Accept star.fun MOU?', description: 'https://github.com/zcombinatorio/percent/issues/16', options: ['No', 'Yes'], winningIdx: 1, length: 28800, createdAt: 1764688914 },
    { legacyId: 25, title: 'Bangit Launch', description: 'Should Combinator partner with @bangitdotxyz to facilitate their token launch and use of decision markets?', options: ['No', 'Yes', 'No'], winningIdx: 1, length: 57600, createdAt: 1764723372 },
    { legacyId: 27, title: 'Zita Reward by Zhirtless', description: 'How much should we (community) reward zita with minted $ZC for her futarchy trading explainer thread?', options: ['No', '150K ZC', '350K ZC', '1M ZC'], winningIdx: 0, length: 57600, createdAt: 1764865764 },
    { legacyId: 28, title: 'Zita Reward by Zhirtless (II)', description: 'How much should we (community) reward zita with minted $ZC for her futarchy trading explainer thread? https://x.com/OX_Katniss/status/1993010998010110403?s=20', options: ['No', '$25 (in ZC)', '$50 (in ZC)', '$75 (in ZC)'], winningIdx: 1, length: 86400, createdAt: 1764950662 },
    { legacyId: 31, title: 'Sadghost Emissions by Zhirtless', description: 'How much ZC per day in emissions should we (ZC holders) reward Sadghost for his continued work as our Discord mod?', options: ['No', '5K ZC', '20K ZC', '40K ZC', '350K ZC'], winningIdx: 0, length: 64800, createdAt: 1765043945 },
    { legacyId: 32, title: 'Invest into SurfCash?', description: 'How much $ZC should be minted and sold to deposit into the SurfCash raise on star.fun?', options: ['No', '$1000 ZC', '$2500 ZC', '$5000 ZC', '$10000 ZC'], winningIdx: 1, length: 86400, createdAt: 1765127562 },
    { legacyId: 33, title: 'BORD Referral Reward by Hands', description: 'How much should we reward BORD (@a87_) for flagging star.fun as a potential collab? https://x.com/stardotfun', options: ['No', '100K ZC', '300K ZC', '750K ZC', '3M ZC', '5M ZC'], winningIdx: 1, length: 86400, createdAt: 1765219330 },
    { legacyId: 36, title: 'Liquidity Borrow %?', description: 'What percent of the main ZC-SOL pool (CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad, DAMMv2 on Meteora on Solana) should be borrowed to seed liquidity for the conditional tokens to run the decision markets? Bet on \'No\' to keep current value: 12%.', options: ['No', '5%', '10%', '25%', '50%'], winningIdx: 4, length: 64800, createdAt: 1765323255 },
    { legacyId: 37, title: 'VeraX Launch', description: 'Should Combinator partner with @VeraxPay to facilitate their token launch and use of decision markets?', options: ['No', 'Yes'], winningIdx: 1, length: 86400, createdAt: 1765388438 },
    { legacyId: 38, title: 'Consolidate emissions?', description: 'Should this PR be merged to consolidate emissions as part of the tokenomics revamp? https://github.com/zcombinatorio/zcombinator/pull/53', options: ['No', 'Yes'], winningIdx: 1, length: 86400, createdAt: 1766434064 },
    { legacyId: 39, title: 'What would $ZC mcap be if Combinator (YES) enables connect with external wallet and (NO) doesn\'t, respectively?', description: 'YES coin = enable connect wallet; NO coin = don\'t do anything. https://discord.com/channels/1419789513382826006/1442575519353667823/1455313067016458406', options: ['No', 'Yes'], winningIdx: 0, length: 86400, createdAt: 1767129904 },
    { legacyId: 40, title: 'Should we slash Staker 5arq4ZbQ7QWtjAp366pCwC4i9TLWGNsFw3ixjA63DGP7?', description: 'Another ZC Staker believes 5arq4ZbQ7QWtjAp366pCwC4i9TLWGNsFw3ixjA63DGP7 did not fulfill their Staker\'s Obligation because they did not trade in either SURF proposals.', options: ['No', '10%', '20%', '30%', '40%', '60%'], winningIdx: 5, length: 86400, createdAt: 1768239490 },
    { legacyId: 43, title: 'Should we slash Staker 5arq4ZbQ7QWtjAp366pCwC4i9TLWGNsFw3ixjA63DGP7?', description: 'Another Staker wants to slash 5arq4Z again. No trading participation in any proposal, even the slash proposal targeted at them.', options: ['No', '20%', '40%', '60%', '80%', '100%'], winningIdx: 5, length: 86400, createdAt: 1768407626 },
  ],
  SURF: [
    { legacyId: 9, title: 'SURF-001: Revenue Sharing vs Growth', description: 'Should SurfCash distribute quarterly net transaction fees to $SURF stakers, or reinvest 100% into growth?', options: ['No', '20% - Balanced approach', '30% - Aggressive distribution', '40% - Maximum distribution'], winningIdx: 2, length: 432000, createdAt: 1767298161 },
    { legacyId: 10, title: 'SURF-002: $50K Monthly Operations Budget', description: 'Increase monthly operations budget from $25K to $50K starting January 2026.', options: ['No', 'Yes'], winningIdx: 1, length: 172800, createdAt: 1768070833 },
  ],
};

// =============================================================================
// VERIFICATION LOGIC
// =============================================================================

const RPC_URL = process.env.RPC_URL;
const VERIFY_IPFS = process.env.VERIFY_IPFS === 'true';
const SKIP_DB = process.env.SKIP_DB === 'true';
const IPFS_SAMPLE_SIZE = parseInt(process.env.IPFS_SAMPLE_SIZE || '3', 10);

if (!RPC_URL) {
  throw new Error('RPC_URL environment variable is required');
}

// Note: Database connection uses DB_URL via shared getPool() from lib/db.ts
// If SKIP_DB=true, database verification is skipped

interface VerificationResult {
  name: string;
  daoExists: boolean;
  moderatorExists: boolean;
  daoErrors: string[];
  moderatorErrors: string[];
  proposalCount: number;
  proposalErrors: string[];
  ipfsSampled: number;
  ipfsErrors: string[];
  dbExists: boolean;
  dbErrors: string[];
}

async function verifyDao(
  client: FutarchyClient,
  config: DaoConfig
): Promise<{ exists: boolean; errors: string[] }> {
  const errors: string[] = [];
  const [daoPda] = client.deriveDAOPDA(config.name);

  try {
    const dao = await client.fetchDAO(daoPda);

    // Verify version
    if (dao.version !== 0) {
      errors.push(`DAO version is ${dao.version}, expected 0 (historical)`);
    }

    // Verify token mint (baseMint in config = tokenMint on-chain)
    if (dao.tokenMint.toBase58() !== config.baseMint) {
      errors.push(`Token mint mismatch: ${dao.tokenMint.toBase58()} !== ${config.baseMint}`);
    }

    // Verify cosigner (cosigner is on DAO, not Moderator)
    if (dao.cosigner.toBase58() !== config.cosigner) {
      errors.push(`Cosigner mismatch: ${dao.cosigner.toBase58()} !== ${config.cosigner}`);
    }

    // Verify treasury multisig
    if (dao.treasuryMultisig.toBase58() !== config.treasuryMultisig) {
      errors.push(`Treasury multisig mismatch: ${dao.treasuryMultisig.toBase58()} !== ${config.treasuryMultisig}`);
    }

    // Verify mint auth multisig
    if (config.mintAuthMultisig && dao.mintAuthMultisig.toBase58() !== config.mintAuthMultisig) {
      errors.push(`Mint auth multisig mismatch: ${dao.mintAuthMultisig.toBase58()} !== ${config.mintAuthMultisig}`);
    }

    // Note: pool is not stored on-chain in DAO account, only in database

    return { exists: true, errors };
  } catch (error) {
    return { exists: false, errors: [`DAO not found: ${(error as Error).message}`] };
  }
}

async function verifyModerator(
  client: FutarchyClient,
  config: DaoConfig,
  expectedProposalCount: number
): Promise<{ exists: boolean; errors: string[]; proposalIdCounter: number }> {
  const errors: string[] = [];
  const [moderatorPda] = client.deriveModeratorPDA(config.name);

  try {
    const moderator = await client.fetchModerator(moderatorPda);

    // Verify version
    if (moderator.version !== 0) {
      errors.push(`Moderator version is ${moderator.version}, expected 0 (historical)`);
    }

    // Verify base mint (on Moderator account)
    if (moderator.baseMint.toBase58() !== config.baseMint) {
      errors.push(`Base mint mismatch: ${moderator.baseMint.toBase58()} !== ${config.baseMint}`);
    }

    // Verify quote mint (on Moderator account)
    if (moderator.quoteMint.toBase58() !== config.quoteMint) {
      errors.push(`Quote mint mismatch: ${moderator.quoteMint.toBase58()} !== ${config.quoteMint}`);
    }

    // Verify proposal counter
    if (moderator.proposalIdCounter !== expectedProposalCount) {
      errors.push(`Proposal counter is ${moderator.proposalIdCounter}, expected ${expectedProposalCount}`);
    }

    return { exists: true, errors, proposalIdCounter: moderator.proposalIdCounter };
  } catch (error) {
    return { exists: false, errors: [`Moderator not found: ${(error as Error).message}`], proposalIdCounter: 0 };
  }
}

async function verifyProposal(
  client: FutarchyClient,
  moderatorPda: PublicKey,
  daoPda: PublicKey,
  onChainId: number,
  expected: HistoricalProposal
): Promise<string[]> {
  const errors: string[] = [];

  try {
    const [proposalPda] = client.deriveProposalPDA(moderatorPda, onChainId);
    const proposal = await client.fetchProposal(proposalPda);

    // Verify num options
    if (proposal.numOptions !== expected.options.length) {
      errors.push(`#${onChainId} (legacy ${expected.legacyId}): numOptions is ${proposal.numOptions}, expected ${expected.options.length}`);
    }

    // Verify winning option (extracted from proposal.state using parseProposalState)
    const { winningIdx } = parseProposalState(proposal.state);
    if (winningIdx !== expected.winningIdx) {
      errors.push(`#${onChainId} (legacy ${expected.legacyId}): winningIdx is ${winningIdx}, expected ${expected.winningIdx}`);
    }

    // Verify length (on-chain stores in minutes, expected is in seconds)
    const expectedLengthMinutes = Math.ceil(expected.length / 60);
    if (proposal.config.length !== expectedLengthMinutes) {
      errors.push(`#${onChainId} (legacy ${expected.legacyId}): length is ${proposal.config.length} min, expected ${expectedLengthMinutes} min (${expected.length} sec)`);
    }

    // Verify createdAt
    const createdAt = proposal.createdAt.toNumber();
    if (createdAt !== expected.createdAt) {
      errors.push(`#${onChainId} (legacy ${expected.legacyId}): createdAt is ${createdAt}, expected ${expected.createdAt}`);
    }

    // Verify version
    if (proposal.version !== 0) {
      errors.push(`#${onChainId} (legacy ${expected.legacyId}): version is ${proposal.version}, expected 0`);
    }

  } catch (error) {
    errors.push(`#${onChainId} (legacy ${expected.legacyId}): Failed to fetch - ${(error as Error).message}`);
  }

  return errors;
}

async function verifyIpfsMetadata(
  client: FutarchyClient,
  moderatorPda: PublicKey,
  daoPda: PublicKey,
  onChainId: number,
  expected: HistoricalProposal
): Promise<string[]> {
  const errors: string[] = [];

  try {
    const [proposalPda] = client.deriveProposalPDA(moderatorPda, onChainId);
    const proposal = await client.fetchProposal(proposalPda);

    if (!proposal.metadata) {
      errors.push(`#${onChainId}: No metadata CID stored`);
      return errors;
    }

    const metadata = await fetchFromIPFS<ProposalMetadata>(proposal.metadata);

    // Verify title
    if (metadata.title !== expected.title) {
      errors.push(`#${onChainId} IPFS: title mismatch`);
    }

    // Verify options
    if (JSON.stringify(metadata.options) !== JSON.stringify(expected.options)) {
      errors.push(`#${onChainId} IPFS: options mismatch`);
    }

    // Verify legacy_id
    if (metadata.legacy_id !== expected.legacyId) {
      errors.push(`#${onChainId} IPFS: legacy_id is ${metadata.legacy_id}, expected ${expected.legacyId}`);
    }

    // Verify dao_pda
    if (metadata.dao_pda !== daoPda.toBase58()) {
      errors.push(`#${onChainId} IPFS: dao_pda mismatch`);
    }

  } catch (error) {
    errors.push(`#${onChainId} IPFS: Failed to fetch - ${(error as Error).message}`);
  }

  return errors;
}

async function verifyDatabase(
  config: DaoConfig,
  daoPda: string,
  moderatorPda: string
): Promise<{ exists: boolean; errors: string[] }> {
  const errors: string[] = [];

  if (SKIP_DB) {
    return { exists: false, errors: ['Database verification skipped (SKIP_DB=true)'] };
  }

  const pool = getPool();

  try {
    const dao = await getDaoByName(pool, config.name);

    if (!dao) {
      return { exists: false, errors: ['DAO not found in cmb_daos table'] };
    }

    // Verify dao_pda
    if (dao.dao_pda !== daoPda) {
      errors.push(`dao_pda mismatch: ${dao.dao_pda} !== ${daoPda}`);
    }

    // Verify moderator_pda
    if (dao.moderator_pda !== moderatorPda) {
      errors.push(`moderator_pda mismatch: ${dao.moderator_pda} !== ${moderatorPda}`);
    }

    // Verify admin_wallet
    if (config.adminWallet && dao.admin_wallet !== config.adminWallet) {
      errors.push(`admin_wallet mismatch: ${dao.admin_wallet} !== ${config.adminWallet}`);
    }

    // Verify owner_wallet
    if (config.ownerWallet && dao.owner_wallet !== config.ownerWallet) {
      errors.push(`owner_wallet mismatch: ${dao.owner_wallet} !== ${config.ownerWallet}`);
    }

    // Verify token_mint
    if (dao.token_mint !== config.baseMint) {
      errors.push(`token_mint mismatch: ${dao.token_mint} !== ${config.baseMint}`);
    }

    // Verify pool_address
    if (dao.pool_address !== config.pool) {
      errors.push(`pool_address mismatch: ${dao.pool_address} !== ${config.pool}`);
    }

    // Verify treasury_multisig
    if (dao.treasury_multisig !== config.treasuryMultisig) {
      errors.push(`treasury_multisig mismatch: ${dao.treasury_multisig} !== ${config.treasuryMultisig}`);
    }

    // Verify mint_auth_multisig
    if (config.mintAuthMultisig && dao.mint_auth_multisig !== config.mintAuthMultisig) {
      errors.push(`mint_auth_multisig mismatch: ${dao.mint_auth_multisig} !== ${config.mintAuthMultisig}`);
    }

    // Verify dao_type
    if (dao.dao_type !== 'parent') {
      errors.push(`dao_type mismatch: ${dao.dao_type} !== parent`);
    }

    // Verify admin_key_idx (should be -1 for historical DAOs)
    if (dao.admin_key_idx !== null) {
      errors.push(`admin_key_idx should be NULL for historical DAOs, got ${dao.admin_key_idx}`);
    }

    // Check that proposers exist
    const proposers = await getProposersByDao(pool, dao.id!);
    if (proposers.length === 0) {
      errors.push('No proposers found in cmb_dao_proposers');
    }

    return { exists: true, errors };
  } catch (error) {
    return { exists: false, errors: [`Database error: ${(error as Error).message}`] };
  }
}

async function verifyDaoMigration(
  client: FutarchyClient,
  daoName: string
): Promise<VerificationResult> {
  const config = DAO_CONFIGS[daoName];
  const proposals = HISTORICAL_PROPOSALS[daoName] || [];
  const expectedProposalCount = proposals.length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Verifying ${daoName}...`);
  console.log(`${'='.repeat(60)}`);

  const result: VerificationResult = {
    name: daoName,
    daoExists: false,
    moderatorExists: false,
    daoErrors: [],
    moderatorErrors: [],
    proposalCount: 0,
    proposalErrors: [],
    ipfsSampled: 0,
    ipfsErrors: [],
    dbExists: false,
    dbErrors: [],
  };

  // Verify DAO
  console.log(`\nVerifying DAO account...`);
  const daoResult = await verifyDao(client, config);
  result.daoExists = daoResult.exists;
  result.daoErrors = daoResult.errors;

  if (daoResult.exists) {
    if (daoResult.errors.length === 0) {
      console.log(`  ✅ DAO verified`);
    } else {
      console.log(`  ⚠️  DAO exists with ${daoResult.errors.length} error(s)`);
      daoResult.errors.forEach(e => console.log(`     - ${e}`));
    }
  } else {
    console.log(`  ❌ DAO not found`);
  }

  // Verify Moderator
  console.log(`\nVerifying Moderator account...`);
  const modResult = await verifyModerator(client, config, expectedProposalCount);
  result.moderatorExists = modResult.exists;
  result.moderatorErrors = modResult.errors;

  if (modResult.exists) {
    if (modResult.errors.length === 0) {
      console.log(`  ✅ Moderator verified (counter: ${modResult.proposalIdCounter})`);
    } else {
      console.log(`  ⚠️  Moderator exists with ${modResult.errors.length} error(s)`);
      modResult.errors.forEach(e => console.log(`     - ${e}`));
    }
  } else {
    console.log(`  ❌ Moderator not found`);
  }

  // Skip proposal verification if moderator doesn't exist
  if (!modResult.exists) {
    return result;
  }

  // Verify proposals
  console.log(`\nVerifying ${expectedProposalCount} proposals...`);
  const [daoPda] = client.deriveDAOPDA(daoName);
  const [moderatorPda] = client.deriveModeratorPDA(daoName);

  // Sort proposals by legacy ID to get correct on-chain order
  const sortedProposals = [...proposals].sort((a, b) => a.legacyId - b.legacyId);

  let verifiedCount = 0;
  for (let i = 0; i < sortedProposals.length; i++) {
    const expected = sortedProposals[i];
    const errors = await verifyProposal(client, moderatorPda, daoPda, i, expected);
    result.proposalErrors.push(...errors);
    if (errors.length === 0) {
      verifiedCount++;
    }
  }

  result.proposalCount = verifiedCount;
  console.log(`  ✅ ${verifiedCount}/${expectedProposalCount} proposals verified`);

  if (result.proposalErrors.length > 0) {
    console.log(`  ⚠️  ${result.proposalErrors.length} proposal error(s):`);
    result.proposalErrors.slice(0, 5).forEach(e => console.log(`     - ${e}`));
    if (result.proposalErrors.length > 5) {
      console.log(`     ... and ${result.proposalErrors.length - 5} more`);
    }
  }

  // Verify IPFS metadata (sample)
  if (VERIFY_IPFS && sortedProposals.length > 0) {
    console.log(`\nVerifying IPFS metadata (sampling ${Math.min(IPFS_SAMPLE_SIZE, sortedProposals.length)} proposals)...`);

    // Sample first, middle, and last proposals
    const sampleIndices: number[] = [];
    if (sortedProposals.length <= IPFS_SAMPLE_SIZE) {
      for (let i = 0; i < sortedProposals.length; i++) {
        sampleIndices.push(i);
      }
    } else {
      sampleIndices.push(0); // First
      sampleIndices.push(Math.floor(sortedProposals.length / 2)); // Middle
      sampleIndices.push(sortedProposals.length - 1); // Last
    }

    for (const idx of sampleIndices) {
      const expected = sortedProposals[idx];
      const errors = await verifyIpfsMetadata(client, moderatorPda, daoPda, idx, expected);
      result.ipfsErrors.push(...errors);
      result.ipfsSampled++;
    }

    if (result.ipfsErrors.length === 0) {
      console.log(`  ✅ ${result.ipfsSampled} IPFS metadata samples verified`);
    } else {
      console.log(`  ⚠️  ${result.ipfsErrors.length} IPFS error(s):`);
      result.ipfsErrors.forEach(e => console.log(`     - ${e}`));
    }
  }

  // Verify database entries
  if (!SKIP_DB) {
    console.log(`\nVerifying database entries...`);
    const dbResult = await verifyDatabase(config, daoPda.toBase58(), moderatorPda.toBase58());
    result.dbExists = dbResult.exists;
    result.dbErrors = dbResult.errors;

    if (dbResult.exists) {
      if (dbResult.errors.length === 0) {
        console.log(`  ✅ Database entries verified`);
      } else {
        console.log(`  ⚠️  Database entry exists with ${dbResult.errors.length} error(s)`);
        dbResult.errors.forEach(e => console.log(`     - ${e}`));
      }
    } else {
      console.log(`  ❌ Database entry not found`);
      if (dbResult.errors.length > 0) {
        dbResult.errors.forEach(e => console.log(`     - ${e}`));
      }
    }
  }

  return result;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║           Verify Historical DAO Migration                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  console.log(`RPC URL: ${RPC_URL}`);
  console.log(`IPFS verification: ${VERIFY_IPFS ? 'enabled' : 'disabled'}`);
  console.log(`Database verification: ${SKIP_DB ? 'disabled' : 'enabled'}`);

  // Setup client (read-only, no wallet needed)
  const connection = new Connection(RPC_URL!, 'confirmed');
  const dummyWallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, dummyWallet, {
    commitment: 'confirmed',
  });
  const client = new FutarchyClient(provider);

  // Determine which DAOs to verify
  const daoNames = process.env.DAO_NAMES
    ? process.env.DAO_NAMES.split(',').map(s => s.trim())
    : Object.keys(DAO_CONFIGS);

  console.log(`\nDAOs to verify: ${daoNames.join(', ')}`);

  // Verify each DAO
  const results: VerificationResult[] = [];

  for (const name of daoNames) {
    if (!DAO_CONFIGS[name]) {
      console.error(`\n❌ Unknown DAO: ${name}`);
      continue;
    }
    const result = await verifyDaoMigration(client, name);
    results.push(result);
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('VERIFICATION SUMMARY');
  console.log(`${'='.repeat(60)}\n`);

  let allPassed = true;

  for (const r of results) {
    const expectedProposals = HISTORICAL_PROPOSALS[r.name]?.length || 0;
    const daoOk = r.daoExists && r.daoErrors.length === 0;
    const modOk = r.moderatorExists && r.moderatorErrors.length === 0;
    const proposalsOk = r.proposalErrors.length === 0;
    const ipfsOk = r.ipfsErrors.length === 0;
    const dbOk = SKIP_DB || (r.dbExists && r.dbErrors.length === 0);
    const allOk = daoOk && modOk && proposalsOk && ipfsOk && dbOk;

    if (!allOk) allPassed = false;

    const status = allOk ? '✅' : '⚠️';
    console.log(`${status} ${r.name}:`);
    console.log(`   DAO: ${daoOk ? '✅' : '❌'} ${r.daoExists ? 'exists' : 'missing'}${r.daoErrors.length > 0 ? ` (${r.daoErrors.length} errors)` : ''}`);
    console.log(`   Moderator: ${modOk ? '✅' : '❌'} ${r.moderatorExists ? 'exists' : 'missing'}${r.moderatorErrors.length > 0 ? ` (${r.moderatorErrors.length} errors)` : ''}`);
    console.log(`   Proposals: ${proposalsOk ? '✅' : '⚠️'} ${r.proposalCount}/${expectedProposals} verified${r.proposalErrors.length > 0 ? ` (${r.proposalErrors.length} errors)` : ''}`);
    if (VERIFY_IPFS) {
      console.log(`   IPFS: ${ipfsOk ? '✅' : '⚠️'} ${r.ipfsSampled} sampled${r.ipfsErrors.length > 0 ? ` (${r.ipfsErrors.length} errors)` : ''}`);
    }
    if (!SKIP_DB) {
      console.log(`   Database: ${dbOk ? '✅' : '❌'} ${r.dbExists ? 'exists' : 'missing'}${r.dbErrors.length > 0 ? ` (${r.dbErrors.length} errors)` : ''}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  if (allPassed) {
    console.log('✅ All verifications passed!');
  } else {
    console.log('⚠️  Some verifications failed. Check errors above.');
  }
  console.log(`${'='.repeat(60)}\n`);

  // Cleanup database pool (only if we used it)
  if (!SKIP_DB) {
    const pool = getPool();
    await pool.end();
  }

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  // Cleanup database pool on error (only if we used it)
  if (!SKIP_DB) {
    try {
      const pool = getPool();
      await pool.end();
    } catch {
      // Ignore cleanup errors
    }
  }
  process.exit(1);
});
