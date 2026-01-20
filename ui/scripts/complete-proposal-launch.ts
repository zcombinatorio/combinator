/**
 * Complete Proposal Launch with Versioned Transaction
 *
 * This script launches a proposal that has already been initialized (Step 1)
 * and had options added (Step 2).
 *
 * Usage:
 *   npx ts-node scripts/complete-proposal-launch.ts
 *
 * Required env vars:
 *   RPC_URL - Solana RPC endpoint
 *   ADMIN_PRIVATE_KEY - Admin keypair (bs58 encoded)
 *
 * Hardcoded values below - update for your test case:
 */
import 'dotenv/config';
import { Connection, Keypair, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { futarchy } from '@zcomb/programs-sdk';
import bs58 from 'bs58';

// ============================================================================
// HARDCODED TEST DATA - Update these for your test case
// ============================================================================

// Proposal PDA - must be in Setup state (initialized but not launched)
const PROPOSAL_PDA = '2wBQLf8BViJSbyXLyk2kZQx9nfrLvXpYmxsxWSArszxy';

// ALT address created in Step 0
const ALT_ADDRESS = '4f3t1AQWZwi9GFygLsDqbTQSRi7buFEaV94N7TcAwiSH';

// Amounts from withdrawal (in raw token units)
const BASE_AMOUNT = '10343512533468658'; // e.g., 1 token with 9 decimals
const QUOTE_AMOUNT = '86243132607'; // e.g., 0.5 SOL in lamports

// ============================================================================
// Script
// ============================================================================

async function main() {
  const RPC_URL = process.env.RPC_URL;
  const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

  if (!RPC_URL) throw new Error('RPC_URL required');
  if (!ADMIN_PRIVATE_KEY) throw new Error('ADMIN_PRIVATE_KEY required');

  // Validate hardcoded values
  if (PROPOSAL_PDA === 'REPLACE_WITH_PROPOSAL_PDA') {
    throw new Error('Update PROPOSAL_PDA with actual value');
  }
  if (ALT_ADDRESS === 'REPLACE_WITH_ALT_ADDRESS') {
    throw new Error('Update ALT_ADDRESS with actual value');
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const adminKeypair = Keypair.fromSecretKey(bs58.decode(ADMIN_PRIVATE_KEY));

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║           Step 3: Launch Proposal (Isolated Test)                ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Config:');
  console.log(`  RPC URL: ${RPC_URL}`);
  console.log(`  Admin: ${adminKeypair.publicKey.toBase58()}`);
  console.log(`  Proposal PDA: ${PROPOSAL_PDA}`);
  console.log(`  ALT Address: ${ALT_ADDRESS}`);
  console.log(`  Base Amount: ${BASE_AMOUNT}`);
  console.log(`  Quote Amount: ${QUOTE_AMOUNT}`);
  console.log('');

  // Create provider and client
  const provider = new AnchorProvider(
    connection,
    new Wallet(adminKeypair),
    { commitment: 'confirmed' }
  );
  const client = new futarchy.FutarchyClient(provider);

  const proposalPubkey = new PublicKey(PROPOSAL_PDA);
  const altAddress = new PublicKey(ALT_ADDRESS);
  const baseAmount = new BN(BASE_AMOUNT);
  const quoteAmount = new BN(QUOTE_AMOUNT);

  // Fetch proposal to verify state
  console.log('Fetching proposal state...');
  const proposal = await client.fetchProposal(proposalPubkey);
  const { state } = futarchy.parseProposalState(proposal.state);

  console.log(`  Current state: ${state}`);
  console.log(`  Num options: ${proposal.numOptions}`);
  console.log(`  Moderator: ${proposal.moderator.toBase58()}`);

  if (state !== futarchy.ProposalState.Setup) {
    throw new Error(`Proposal must be in Setup state to launch. Current: ${state}`);
  }

  // Verify ALT exists and is ready
  console.log('');
  console.log('Verifying ALT...');
  const altAccount = await connection.getAddressLookupTable(altAddress);
  if (!altAccount.value) {
    throw new Error('ALT not found');
  }
  console.log(`  ALT addresses: ${altAccount.value.state.addresses.length}`);

  // Step 3: Launch proposal using versioned transaction with ALT
  console.log('');
  console.log('Step 3: Launching proposal with versioned transaction...');
  console.log(`  Base amount: ${baseAmount.toString()}`);
  console.log(`  Quote amount: ${quoteAmount.toString()}`);

  try {
    const launchResult = await client.launchProposal(
      adminKeypair.publicKey,
      proposalPubkey,
      baseAmount,
      quoteAmount,
    );

    console.log('  launchProposal() returned successfully');

    // Extract the instruction from the builder
    const launchInstruction = await launchResult.builder.instruction();
    console.log(`  Instruction program: ${launchInstruction.programId.toBase58()}`);
    console.log(`  Instruction keys: ${launchInstruction.keys.length}`);

    // Add compute budget instruction
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 });

    // Build versioned transaction using the ALT
    console.log('  Building versioned transaction with ALT...');
    const { versionedTx, blockhash, lastValidBlockHeight } = await client.buildVersionedTx(
      adminKeypair.publicKey,
      [computeBudgetIx, launchInstruction],
      altAddress,
    );

    console.log(`  Blockhash: ${blockhash}`);
    console.log(`  Last valid block height: ${lastValidBlockHeight}`);

    // Sign the versioned transaction
    console.log('  Signing transaction...');
    versionedTx.sign([adminKeypair]);

    // Send and confirm
    console.log('  Sending transaction...');
    const launchSig = await provider.connection.sendTransaction(versionedTx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log(`  Transaction sent: ${launchSig}`);

    // Wait for confirmation
    console.log('  Waiting for confirmation...');
    await provider.connection.confirmTransaction({
      signature: launchSig,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    console.log(`  ✓ Launch tx confirmed: ${launchSig}`);

    // Verify final state
    console.log('');
    console.log('Verifying final state...');
    const finalProposal = await client.fetchProposal(proposalPubkey);
    const { state: finalState } = futarchy.parseProposalState(finalProposal.state);
    console.log(`  Final state: ${finalState}`);

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║                        SUCCESS                                   ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('');

  } catch (e: any) {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════════════╗');
    console.error('║                        FAILED                                    ║');
    console.error('╚══════════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('Error:', e.message || e);

    // Log transaction logs if available
    if (e.logs) {
      console.error('');
      console.error('Transaction logs:');
      for (const log of e.logs) {
        console.error(`  ${log}`);
      }
    }

    // Log additional error details
    if (e.error) {
      console.error('');
      console.error('Error details:', JSON.stringify(e.error, null, 2));
    }

    throw e;
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
