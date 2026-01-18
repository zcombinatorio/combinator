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

/**
 * Migrate historical proposals from the old system to the new on-chain system
 *
 * For each historical proposal:
 * 1. Uploads metadata to IPFS (title, description, options)
 * 2. Calls addHistoricalProposal on-chain
 *
 * Usage:
 *   # Migrate proposals for specific DAOs
 *   DAO_NAMES="SURFTEST,TESTSURF" pnpm tsx scripts/migrate-historical-proposals.ts
 *
 *   # Migrate all DAOs
 *   pnpm tsx scripts/migrate-historical-proposals.ts
 *
 * Prerequisites:
 *   1. Run fetch-migration-data.ts first to get proposal data
 *   2. Run migrate-historical-daos.ts first to create on-chain DAOs
 *   3. Update HISTORICAL_PROPOSALS below with output from fetch-migration-data.ts
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Base58-encoded admin private key
 *   - RPC_URL: Solana RPC URL
 *   - IPFS_API_URL + IPFS_BASIC_AUTH or PINATA_JWT: For IPFS uploads
 *
 * Optional:
 *   - DAO_NAMES: Comma-separated list of DAOs to migrate (default: all)
 *   - DRY_RUN: Set to "true" to simulate without sending transactions
 */

import 'dotenv/config';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { FutarchyClient } from '@zcomb/programs-sdk';
import { uploadToIPFS, ProposalMetadata } from '../lib/ipfs';

// =============================================================================
// CONFIGURATION - Update with output from fetch-migration-data.ts
// =============================================================================

interface HistoricalProposal {
  legacyId: number;    // Original proposal ID from os-percent (may have gaps)
  title: string;
  description: string;
  options: string[];   // Market labels (e.g., ['No', 'Yes'] or ['fail', 'pass'])
  winningIdx: number;  // Index of winning option (highest TWAP)
  length: number;      // seconds
  createdAt: number;   // unix timestamp
}

/**
 * Historical proposals by DAO
 *
 * Data fetched from qm_proposals and qm_twap_history tables.
 * Winning index determined by highest TWAP aggregation value.
 *
 * NOTE: On-chain proposal IDs will be sequential (0, 1, 2, ...)
 * regardless of legacy IDs. The legacyId is stored in metadata
 * for reference.
 *
 * Data verified from production database on 2026-01-17.
 */
const HISTORICAL_PROPOSALS: Record<string, HistoricalProposal[]> = {
  // ==========================================================================
  // TEST DAOs - Migrate these first for testing
  // ==========================================================================
  SURFTEST: [
    // Moderator ID: 4, 23 proposals total
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
    { legacyId: 29, title: 'test29', description: 'test29', options: ['No', 'Yes', 'Yes2', 'Yes3', 'Yes4', 'Yes5', 'Yes6'], winningIdx: 0, length: 60, createdAt: 1767375252 },
    { legacyId: 30, title: 'test30', description: 'test30', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1767996387 },
    { legacyId: 31, title: 'test31', description: 'test31', options: ['No', 'Yes'], winningIdx: 0, length: 60, createdAt: 1768068180 },
  ],
  TESTSURF: [
    // Moderator ID: 5, 13 proposals total
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

  // ==========================================================================
  // PRODUCTION DAOs - Migrate after testing
  // ==========================================================================
  ZC: [
    // Moderator ID: 2, 36 proposals total
    // Note: Proposals 6,7 were created before 0-5 (lower timestamps), but have higher legacy IDs
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
    // Moderator ID: 6, 2 proposals total
    { legacyId: 9, title: 'SURF-001: Revenue Sharing vs Growth', description: 'Should SurfCash distribute quarterly net transaction fees to $SURF stakers, or reinvest 100% into growth?', options: ['No', '20% - Balanced approach', '30% - Aggressive distribution', '40% - Maximum distribution'], winningIdx: 2, length: 432000, createdAt: 1767298161 },
    { legacyId: 10, title: 'SURF-002: $50K Monthly Operations Budget', description: 'Increase monthly operations budget from $25K to $50K starting January 2026.', options: ['No', 'Yes'], winningIdx: 1, length: 172800, createdAt: 1768070833 },
  ],
};

// =============================================================================
// MIGRATION SCRIPT
// =============================================================================

const RPC_URL = process.env.RPC_URL;
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!RPC_URL) {
  throw new Error('RPC_URL environment variable is required');
}

function loadKeypair(privateKey: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(privateKey));
}

async function uploadProposalMetadata(
  proposal: HistoricalProposal,
  daoPda: string,
  onChainId: number
): Promise<string> {
  const metadata: ProposalMetadata = {
    title: proposal.title,
    description: proposal.description,
    options: proposal.options,
    dao_pda: daoPda,
    created_at: new Date(proposal.createdAt * 1000).toISOString(),
    legacy_id: proposal.legacyId,
  };

  const cid = await uploadToIPFS(
    metadata,
    `proposal-${daoPda.slice(0, 8)}-${onChainId}.json`
  );

  return cid;
}

async function migrateProposal(
  client: FutarchyClient,
  adminKeypair: Keypair,
  moderatorPda: PublicKey,
  daoPda: PublicKey,
  proposal: HistoricalProposal,
  onChainId: number  // Sequential on-chain ID (may differ from legacy ID)
): Promise<{ proposalPda: string; metadata: string; signature: string; onChainId: number }> {
  console.log(`\n  Legacy #${proposal.legacyId} → On-chain #${onChainId}: "${proposal.title}"`);

  // Upload metadata to IPFS (includes legacy_id for reference)
  console.log(`    Uploading metadata to IPFS...`);
  let metadataCid: string;

  if (DRY_RUN) {
    metadataCid = 'DRY_RUN_CID';
    console.log(`    [DRY RUN] Would upload metadata`);
  } else {
    metadataCid = await uploadProposalMetadata(proposal, daoPda.toBase58(), onChainId);
    console.log(`    Metadata CID: ${metadataCid}`);
  }

  // Build and send transaction
  console.log(`    Building transaction...`);
  console.log(`      winningIdx: ${proposal.winningIdx} (${proposal.options[proposal.winningIdx]})`);
  console.log(`      length: ${proposal.length} seconds`);
  console.log(`      createdAt: ${proposal.createdAt}`);
  console.log(`      numOptions: ${proposal.options.length}`);

  if (DRY_RUN) {
    const [proposalPda] = client.deriveProposalPDA(moderatorPda, onChainId);
    console.log(`    [DRY RUN] Would create proposal at ${proposalPda.toBase58()}`);
    return {
      proposalPda: proposalPda.toBase58(),
      metadata: metadataCid,
      signature: 'DRY_RUN',
      onChainId,
    };
  }

  const { builder, proposalPda, proposalId } = await client.addHistoricalProposal(
    adminKeypair.publicKey,
    moderatorPda,
    proposal.options.length,  // numOptions
    proposal.winningIdx,
    proposal.length,
    new BN(proposal.createdAt),
    metadataCid
  );

  console.log(`    Sending transaction...`);
  const signature = await builder.rpc();

  console.log(`    ✅ Proposal migrated!`);
  console.log(`      Proposal PDA: ${proposalPda.toBase58()}`);
  console.log(`      On-chain ID: ${proposalId} (legacy: ${proposal.legacyId})`);
  console.log(`      Transaction: ${signature}`);

  return {
    proposalPda: proposalPda.toBase58(),
    metadata: metadataCid,
    signature,
    onChainId: proposalId,
  };
}

async function migrateProposalsForDao(
  client: FutarchyClient,
  adminKeypair: Keypair,
  daoName: string,
  proposals: HistoricalProposal[]
): Promise<{
  success: number;
  failed: number;
  results: Array<{ legacyId: number; onChainId: number; success: boolean; error?: string }>;
}> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Migrating proposals for ${daoName}...`);
  console.log(`${'='.repeat(60)}`);

  if (proposals.length === 0) {
    console.log(`  No proposals to migrate for ${daoName}`);
    return { success: 0, failed: 0, results: [] };
  }

  // Derive PDAs
  const [daoPda] = client.deriveDAOPDA(daoName);
  const [moderatorPda] = client.deriveModeratorPDA(daoName);

  console.log(`  DAO PDA: ${daoPda.toBase58()}`);
  console.log(`  Moderator PDA: ${moderatorPda.toBase58()}`);

  // Verify moderator exists and get current counter
  let moderator;
  try {
    moderator = await client.fetchModerator(moderatorPda);
    console.log(`  Current proposal counter: ${moderator.proposalIdCounter}`);
  } catch (error) {
    throw new Error(
      `Moderator not found for ${daoName}. ` +
      `Run migrate-historical-daos.ts first.`
    );
  }

  // Sort proposals by legacy ID to maintain original creation order
  const sortedProposals = [...proposals].sort((a, b) => a.legacyId - b.legacyId);

  // Check current on-chain counter to determine how many already migrated
  const startingOnChainId = moderator.proposalIdCounter;

  if (startingOnChainId > 0) {
    console.log(`  ⚠ On-chain counter is ${startingOnChainId}, skipping first ${startingOnChainId} proposals`);
  }

  // Skip already-migrated proposals (based on position, not legacy ID)
  const proposalsToMigrate = sortedProposals.slice(startingOnChainId);

  console.log(`  Total proposals: ${sortedProposals.length}`);
  console.log(`  Already migrated: ${startingOnChainId}`);
  console.log(`  Proposals to migrate: ${proposalsToMigrate.length}`);

  const results: Array<{ legacyId: number; onChainId: number; success: boolean; error?: string }> = [];
  let currentOnChainId = startingOnChainId;

  for (const proposal of proposalsToMigrate) {
    try {
      const result = await migrateProposal(
        client,
        adminKeypair,
        moderatorPda,
        daoPda,
        proposal,
        currentOnChainId
      );
      results.push({ legacyId: proposal.legacyId, onChainId: result.onChainId, success: true });
      currentOnChainId++;
    } catch (error) {
      console.error(`    ❌ Failed: ${(error as Error).message}`);
      results.push({
        legacyId: proposal.legacyId,
        onChainId: currentOnChainId,
        success: false,
        error: (error as Error).message,
      });
      // Stop on first failure to maintain sequential order
      console.log(`    Stopping migration for ${daoName} due to error.`);
      break;
    }
  }

  return {
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║         Migrate Historical Proposals to On-Chain                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  if (DRY_RUN) {
    console.log('🔵 DRY RUN MODE - No transactions will be sent\n');
  }

  // Verify IPFS is configured
  const hasKubo = !!(process.env.IPFS_API_URL && process.env.IPFS_BASIC_AUTH);
  const hasPinata = !!process.env.PINATA_JWT;

  if (!hasKubo && !hasPinata) {
    throw new Error(
      'IPFS not configured. Set either:\n' +
      '  - IPFS_API_URL + IPFS_BASIC_AUTH (Kubo)\n' +
      '  - PINATA_JWT (Pinata)'
    );
  }
  console.log(`IPFS: ${hasKubo ? 'Kubo' : 'Pinata'}`);

  // Load admin wallet
  const privateKey = process.env.PRIVATE_KEY || process.env.DAO_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required');
  }
  const adminKeypair = loadKeypair(privateKey);
  console.log(`Admin wallet: ${adminKeypair.publicKey.toBase58()}`);
  console.log(`RPC URL: ${RPC_URL}\n`);

  // Setup client
  const connection = new Connection(RPC_URL!, 'confirmed');
  const wallet = new Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  const client = new FutarchyClient(provider);

  // Determine which DAOs to migrate
  const daoNames = process.env.DAO_NAMES
    ? process.env.DAO_NAMES.split(',').map(s => s.trim())
    : Object.keys(HISTORICAL_PROPOSALS);

  console.log(`DAOs to migrate: ${daoNames.join(', ')}`);

  // Check for proposals
  let totalProposals = 0;
  for (const name of daoNames) {
    const proposals = HISTORICAL_PROPOSALS[name];
    if (!proposals) {
      console.warn(`⚠ No proposal data found for ${name}`);
      continue;
    }
    totalProposals += proposals.length;
    console.log(`  ${name}: ${proposals.length} proposals`);
  }

  if (totalProposals === 0) {
    console.log('\n⚠ No proposals to migrate.');
    console.log('Update HISTORICAL_PROPOSALS with output from fetch-migration-data.ts');
    return;
  }

  // Migrate proposals for each DAO
  const allResults: Record<string, {
    success: number;
    failed: number;
    results: Array<{ legacyId: number; onChainId: number; success: boolean; error?: string }>;
  }> = {};

  for (const name of daoNames) {
    const proposals = HISTORICAL_PROPOSALS[name];
    if (!proposals || proposals.length === 0) {
      continue;
    }

    try {
      allResults[name] = await migrateProposalsForDao(
        client,
        adminKeypair,
        name,
        proposals
      );
    } catch (error) {
      console.error(`\n❌ Failed to migrate ${name}:`, (error as Error).message);
      allResults[name] = {
        success: 0,
        failed: proposals.length,
        results: [{ legacyId: -1, onChainId: -1, success: false, error: (error as Error).message }],
      };
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('MIGRATION SUMMARY');
  console.log(`${'='.repeat(60)}\n`);

  let totalSuccess = 0;
  let totalFailed = 0;

  for (const [name, result] of Object.entries(allResults)) {
    console.log(`${name}:`);
    console.log(`  ✅ Success: ${result.success}`);
    console.log(`  ❌ Failed: ${result.failed}`);
    totalSuccess += result.success;
    totalFailed += result.failed;

    if (result.failed > 0) {
      for (const r of result.results.filter(r => !r.success)) {
        console.log(`     Legacy #${r.legacyId} → On-chain #${r.onChainId}: ${r.error}`);
      }
    }
  }

  console.log(`\nTotal: ${totalSuccess} succeeded, ${totalFailed} failed`);

  console.log(`\n${'='.repeat(60)}`);
  console.log('Next steps:');
  console.log('1. Run verify-migration.ts to verify the on-chain proposals');
  console.log(`${'='.repeat(60)}\n`);

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
