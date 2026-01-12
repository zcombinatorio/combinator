/**
 * Test minting tokens via DAO mint vault (hardcoded to DAO 43)
 *
 * This script tests that the mint authority was properly transferred to the DAO's mint vault
 * by creating a Squads multisig proposal to mint 1% more tokens to the DAO owner.
 *
 * Prerequisites:
 * - The mint authority must have been transferred to the mint vault
 * - You need access to one of the mint multisig member private keys
 *
 * Usage:
 *   # Check status (no private key needed)
 *   pnpm tsx scripts/test-mint-via-vault.ts status
 *
 *   # Create the proposal (as member A or B)
 *   MEMBER_PRIVATE_KEY="..." pnpm tsx scripts/test-mint-via-vault.ts create
 *
 *   # Approve the proposal (as the other member) - auto-detects latest proposal
 *   MEMBER_PRIVATE_KEY="..." pnpm tsx scripts/test-mint-via-vault.ts approve
 *
 *   # Execute the proposal (after 2/2 approvals) - auto-detects latest proposal
 *   MEMBER_PRIVATE_KEY="..." pnpm tsx scripts/test-mint-via-vault.ts execute
 *
 * Expected Mint Multisig Members:
 *   - KEY_A: Dobm8QnaCPQoc6koxC3wqBQqPTfDwspATb2u6EcWC9Aw (also config authority)
 *   - KEY_B: 2xrEGvtxXKujqnHceiSzYDTAbTJEX3yGGPJgywH7LmcD
 */

import * as dotenv from 'dotenv';
dotenv.config();

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionMessage,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getMint,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  createMintToInstruction,
} from '@solana/spl-token';
import { AnchorProvider, Wallet, Program } from '@coral-xyz/anchor';
import { futarchy } from '@zcomb/programs-sdk';
import * as multisig from '@sqds/multisig';
import bs58 from 'bs58';
import { Pool } from 'pg';

const DAO_ID = 43;
const MINT_PERCENT = 1.0;

// Environment variables - read after dotenv.config()
function getEnv() {
  return {
    RPC_URL: process.env.RPC_URL!,
    MEMBER_PRIVATE_KEY: process.env.MEMBER_PRIVATE_KEY,
    DB_URL: process.env.DB_URL!,
  };
}

async function getLatestProposalIndex(connection: Connection, multisigPda: PublicKey): Promise<number> {
  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  return Number(multisigAccount.transactionIndex);
}

// Known mint multisig members (from constants.rs)
const MINT_MULTISIG_KEY_A = 'Dobm8QnaCPQoc6koxC3wqBQqPTfDwspATb2u6EcWC9Aw';
const MINT_MULTISIG_KEY_B = '2xrEGvtxXKujqnHceiSzYDTAbTJEX3yGGPJgywH7LmcD';

interface DAOInfo {
  id: number;
  dao_pda: string;
  token_mint: string;
  mint_multisig: string;
  mint_vault: string;
  owner_wallet: string;
}

async function getDAOInfo(connection: Connection, daoId: number, dbUrl: string): Promise<DAOInfo> {
  const pool = new Pool({ connectionString: dbUrl });

  try {
    const result = await pool.query(
      'SELECT id, dao_pda, token_mint, mint_auth_multisig as mint_vault, owner_wallet FROM cmb_daos WHERE id = $1',
      [daoId]
    );

    if (result.rows.length === 0) {
      throw new Error(`DAO ${daoId} not found`);
    }

    const dao = result.rows[0];

    // The database stores the vault address, but we need the multisig address.
    // Fetch the on-chain DAO account to get the actual mint multisig.
    const onChainDao = await getOnChainDAOInfo(connection, dao.dao_pda);
    const mintMultisig = onChainDao.mintAuthMultisig.toBase58();

    // Verify vault derivation
    const [derivedVault] = multisig.getVaultPda({
      multisigPda: new PublicKey(mintMultisig),
      index: 0,
    });

    if (derivedVault.toBase58() !== dao.mint_vault) {
      console.warn('Warning: Derived vault does not match database vault');
      console.warn('  Database vault:', dao.mint_vault);
      console.warn('  Derived vault:', derivedVault.toBase58());
    }

    return {
      id: dao.id,
      dao_pda: dao.dao_pda,
      token_mint: dao.token_mint,
      mint_multisig: mintMultisig,
      mint_vault: derivedVault.toBase58(),
      owner_wallet: dao.owner_wallet,
    };
  } finally {
    await pool.end();
  }
}

async function getOnChainDAOInfo(connection: Connection, daoPda: string) {
  const dummyWallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, dummyWallet, { commitment: 'confirmed' });
  const client = new futarchy.FutarchyClient(provider);
  return client.fetchDAO(new PublicKey(daoPda));
}

async function showStatus(connection: Connection, daoInfo: DAOInfo) {
  console.log('=== DAO Mint Authority Test Status ===\n');
  console.log('DAO ID:', daoInfo.id);
  console.log('DAO PDA:', daoInfo.dao_pda);
  console.log('Token Mint:', daoInfo.token_mint);
  console.log('Mint Multisig:', daoInfo.mint_multisig);
  console.log('Mint Vault (authority):', daoInfo.mint_vault);
  console.log('');

  // Check current mint authority
  const mint = await getMint(connection, new PublicKey(daoInfo.token_mint));
  console.log('=== Token Mint Info ===');
  console.log('Current Supply:', mint.supply.toString(), `(${Number(mint.supply) / Math.pow(10, mint.decimals)} tokens)`);
  console.log('Decimals:', mint.decimals);
  console.log('Mint Authority:', mint.mintAuthority?.toBase58() || 'None');
  console.log('Authority is Vault:', mint.mintAuthority?.toBase58() === daoInfo.mint_vault ? 'YES' : 'NO');
  console.log('');

  // Check multisig state
  const multisigPda = new PublicKey(daoInfo.mint_multisig);
  try {
    const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);

    console.log('=== Multisig Info ===');
    console.log('Threshold:', multisigAccount.threshold, 'of', multisigAccount.members.length);
    console.log('Transaction Index:', Number(multisigAccount.transactionIndex));
    console.log('Stale Transaction Index:', Number(multisigAccount.staleTransactionIndex));
    console.log('Members:');
    multisigAccount.members.forEach((m, i) => {
      const label = m.key.toBase58() === MINT_MULTISIG_KEY_A ? ' (KEY_A)' :
                    m.key.toBase58() === MINT_MULTISIG_KEY_B ? ' (KEY_B)' : '';
      console.log(`  ${i + 1}. ${m.key.toBase58()}${label}`);
    });
    console.log('');

    // Check pending proposals
    if (multisigAccount.transactionIndex > multisigAccount.staleTransactionIndex) {
      console.log('=== Pending Proposals ===');
      for (let i = Number(multisigAccount.staleTransactionIndex) + 1; i <= Number(multisigAccount.transactionIndex); i++) {
        try {
          const [proposalPda] = multisig.getProposalPda({
            multisigPda,
            transactionIndex: BigInt(i),
          });
          const proposal = await multisig.accounts.Proposal.fromAccountAddress(connection, proposalPda);
          console.log(`Proposal ${i}:`);
          console.log('  Status:', Object.keys(proposal.status)[0]);
          console.log('  Approved:', proposal.approved.length);
          console.log('  Rejected:', proposal.rejected.length);
          console.log('  Cancelled:', proposal.cancelled.length);
        } catch (e) {
          console.log(`Proposal ${i}: (not found or not created)`);
        }
      }
    }
  } catch (e) {
    console.log('Could not fetch multisig account:', e);
  }
}

async function createMintProposal(
  connection: Connection,
  memberKeypair: Keypair,
  daoInfo: DAOInfo,
  mintPercent: number
) {
  console.log('=== Create Mint Proposal ===\n');

  // Verify member is in the multisig
  const memberPubkey = memberKeypair.publicKey.toBase58();
  if (memberPubkey !== MINT_MULTISIG_KEY_A && memberPubkey !== MINT_MULTISIG_KEY_B) {
    throw new Error(`Member ${memberPubkey} is not a mint multisig member.\nExpected: ${MINT_MULTISIG_KEY_A} or ${MINT_MULTISIG_KEY_B}`);
  }
  console.log('Member:', memberPubkey, memberPubkey === MINT_MULTISIG_KEY_A ? '(KEY_A)' : '(KEY_B)');

  // Get token info
  const mint = await getMint(connection, new PublicKey(daoInfo.token_mint));
  const currentSupply = Number(mint.supply);
  const mintAmount = Math.floor(currentSupply * (mintPercent / 100));

  console.log('Token Mint:', daoInfo.token_mint);
  console.log('Current Supply:', currentSupply, `(${currentSupply / Math.pow(10, mint.decimals)} tokens)`);
  console.log('Mint Amount:', mintAmount, `(${mintPercent}% = ${mintAmount / Math.pow(10, mint.decimals)} tokens)`);

  // Mint to DAO owner
  const destinationWallet = daoInfo.owner_wallet;
  console.log('Destination Wallet:', destinationWallet);

  // Get or create destination ATA
  const destinationAta = await getAssociatedTokenAddress(
    new PublicKey(daoInfo.token_mint),
    new PublicKey(destinationWallet)
  );
  console.log('Destination ATA:', destinationAta.toBase58());

  // Check if ATA exists
  const ataInfo = await connection.getAccountInfo(destinationAta);
  const instructions = [];

  if (!ataInfo) {
    console.log('Creating destination ATA...');
    instructions.push(
      createAssociatedTokenAccountInstruction(
        memberKeypair.publicKey,
        destinationAta,
        new PublicKey(destinationWallet),
        new PublicKey(daoInfo.token_mint)
      )
    );
  }

  // Get multisig info
  const multisigPda = new PublicKey(daoInfo.mint_multisig);
  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const newTransactionIndex = BigInt(Number(multisigAccount.transactionIndex) + 1);

  console.log('Multisig:', daoInfo.mint_multisig);
  console.log('New Transaction Index:', newTransactionIndex.toString());

  // Derive PDAs
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  const [transactionPda] = multisig.getTransactionPda({
    multisigPda,
    index: newTransactionIndex,
  });
  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex: newTransactionIndex,
  });

  console.log('Vault PDA:', vaultPda.toBase58());
  console.log('Transaction PDA:', transactionPda.toBase58());
  console.log('Proposal PDA:', proposalPda.toBase58());

  // Create the mint instruction (to be executed by vault via CPI)
  const mintIx = createMintToInstruction(
    new PublicKey(daoInfo.token_mint),
    destinationAta,
    vaultPda, // mint authority is the vault
    BigInt(mintAmount)
  );

  // Create the transaction message for the vault transaction
  const { blockhash } = await connection.getLatestBlockhash();
  const txMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: blockhash,
    instructions: [mintIx],
  });

  // Create vault transaction instruction
  const vaultTxIx = multisig.instructions.vaultTransactionCreate({
    multisigPda,
    transactionIndex: newTransactionIndex,
    creator: memberKeypair.publicKey,
    rentPayer: memberKeypair.publicKey,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: txMessage,
  });

  // Create proposal
  const proposalCreateIx = multisig.instructions.proposalCreate({
    multisigPda,
    transactionIndex: newTransactionIndex,
    creator: memberKeypair.publicKey,
    isDraft: false,
  });

  // Auto-approve by creator
  const approveIx = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex: newTransactionIndex,
    member: memberKeypair.publicKey,
  });

  instructions.push(vaultTxIx, proposalCreateIx, approveIx);

  // Send transaction
  console.log('\nCreating proposal...');
  const tx = new Transaction().add(...instructions);
  const signature = await sendAndConfirmTransaction(connection, tx, [memberKeypair], {
    commitment: 'confirmed',
  });

  console.log('\n=== Proposal Created ===');
  console.log('Transaction:', signature);
  console.log('Proposal Index:', newTransactionIndex.toString());
  console.log('Proposal Address:', proposalPda.toBase58());
  console.log('Status: Active (awaiting 1 more approval)');
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Have the other member approve with:`);
  console.log(`     MEMBER_PRIVATE_KEY="<other_member_key>" DAO_ID=${daoInfo.id} PROPOSAL_INDEX=${newTransactionIndex} pnpm tsx scripts/test-mint-via-vault.ts approve`);
  console.log('');
  console.log(`  2. Execute after approval:`);
  console.log(`     MEMBER_PRIVATE_KEY="..." DAO_ID=${daoInfo.id} PROPOSAL_INDEX=${newTransactionIndex} pnpm tsx scripts/test-mint-via-vault.ts execute`);
  console.log('');
  console.log('Explorer:', `https://explorer.solana.com/tx/${signature}`);
}

async function approveProposal(
  connection: Connection,
  memberKeypair: Keypair,
  daoInfo: DAOInfo,
  proposalIndex: number
) {
  console.log('=== Approve Proposal ===\n');

  const memberPubkey = memberKeypair.publicKey.toBase58();
  if (memberPubkey !== MINT_MULTISIG_KEY_A && memberPubkey !== MINT_MULTISIG_KEY_B) {
    throw new Error(`Member ${memberPubkey} is not a mint multisig member.`);
  }
  console.log('Member:', memberPubkey, memberPubkey === MINT_MULTISIG_KEY_A ? '(KEY_A)' : '(KEY_B)');

  const multisigPda = new PublicKey(daoInfo.mint_multisig);
  const transactionIndex = BigInt(proposalIndex);

  const approveIx = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex,
    member: memberKeypair.publicKey,
  });

  console.log('Approving proposal', proposalIndex, '...');
  const tx = new Transaction().add(approveIx);
  const signature = await sendAndConfirmTransaction(connection, tx, [memberKeypair], {
    commitment: 'confirmed',
  });

  console.log('\n=== Proposal Approved ===');
  console.log('Transaction:', signature);
  console.log('');
  console.log('Next step: Execute the proposal');
  console.log(`  MEMBER_PRIVATE_KEY="..." DAO_ID=${daoInfo.id} PROPOSAL_INDEX=${proposalIndex} pnpm tsx scripts/test-mint-via-vault.ts execute`);
  console.log('');
  console.log('Explorer:', `https://explorer.solana.com/tx/${signature}`);
}

async function executeProposal(
  connection: Connection,
  memberKeypair: Keypair,
  daoInfo: DAOInfo,
  proposalIndex: number
) {
  console.log('=== Execute Proposal ===\n');

  const multisigPda = new PublicKey(daoInfo.mint_multisig);
  const transactionIndex = BigInt(proposalIndex);

  // Get transaction accounts
  const [transactionPda] = multisig.getTransactionPda({
    multisigPda,
    index: transactionIndex,
  });

  // Fetch the vault transaction to get the accounts it needs
  const vaultTransaction = await multisig.accounts.VaultTransaction.fromAccountAddress(
    connection,
    transactionPda
  );

  // Build execute instruction with proper accounts
  const { instruction: executeIx } = await multisig.instructions.vaultTransactionExecute({
    connection,
    multisigPda,
    transactionIndex,
    member: memberKeypair.publicKey,
  });

  console.log('Executing proposal', proposalIndex, '...');
  const tx = new Transaction().add(executeIx);
  const signature = await sendAndConfirmTransaction(connection, tx, [memberKeypair], {
    commitment: 'confirmed',
  });

  // Check new supply
  const mint = await getMint(connection, new PublicKey(daoInfo.token_mint));

  console.log('\n=== Proposal Executed ===');
  console.log('Transaction:', signature);
  console.log('New Token Supply:', mint.supply.toString(), `(${Number(mint.supply) / Math.pow(10, mint.decimals)} tokens)`);
  console.log('');
  console.log('Mint authority transfer test: SUCCESS');
  console.log('The DAO mint vault can successfully mint new tokens.');
  console.log('');
  console.log('Explorer:', `https://explorer.solana.com/tx/${signature}`);
}

async function main() {
  const env = getEnv();
  const command = process.argv[2] || 'status';

  if (!env.DB_URL) {
    throw new Error('DB_URL is required in .env');
  }

  const connection = new Connection(env.RPC_URL, 'confirmed');
  const daoInfo = await getDAOInfo(connection, DAO_ID, env.DB_URL);

  switch (command) {
    case 'status':
      await showStatus(connection, daoInfo);
      break;

    case 'create':
      if (!env.MEMBER_PRIVATE_KEY) {
        throw new Error('MEMBER_PRIVATE_KEY is required for create');
      }
      const createKeypair = Keypair.fromSecretKey(bs58.decode(env.MEMBER_PRIVATE_KEY));
      await createMintProposal(connection, createKeypair, daoInfo, MINT_PERCENT);
      break;

    case 'approve':
      if (!env.MEMBER_PRIVATE_KEY) {
        throw new Error('MEMBER_PRIVATE_KEY is required for approve');
      }
      const approveKeypair = Keypair.fromSecretKey(bs58.decode(env.MEMBER_PRIVATE_KEY));
      const approveIndex = await getLatestProposalIndex(connection, new PublicKey(daoInfo.mint_multisig));
      if (approveIndex === 0) {
        throw new Error('No proposals found. Create one first with: pnpm tsx scripts/test-mint-via-vault.ts create');
      }
      await approveProposal(connection, approveKeypair, daoInfo, approveIndex);
      break;

    case 'execute':
      if (!env.MEMBER_PRIVATE_KEY) {
        throw new Error('MEMBER_PRIVATE_KEY is required for execute');
      }
      const executeKeypair = Keypair.fromSecretKey(bs58.decode(env.MEMBER_PRIVATE_KEY));
      const executeIndex = await getLatestProposalIndex(connection, new PublicKey(daoInfo.mint_multisig));
      if (executeIndex === 0) {
        throw new Error('No proposals found. Create one first with: pnpm tsx scripts/test-mint-via-vault.ts create');
      }
      await executeProposal(connection, executeKeypair, daoInfo, executeIndex);
      break;

    default:
      console.log('Unknown command:', command);
      console.log('Usage: pnpm tsx scripts/test-mint-via-vault.ts [status|create|approve|execute]');
      process.exit(1);
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
