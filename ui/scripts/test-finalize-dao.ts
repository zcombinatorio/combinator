/**
 * Test script to validate on-chain DAO fetch and vault PDA derivation.
 *
 * Exercises the exact SDK calls that POST /dao/finalize-reserved will use.
 * Run against a known DAO to verify all fields before deploying the endpoint.
 *
 * Usage:
 *   RPC_URL=<mainnet-rpc> pnpm tsx scripts/test-finalize-dao.ts SURFTEST
 *   RPC_URL=<mainnet-rpc> pnpm tsx scripts/test-finalize-dao.ts <dao-pda-base58>
 */

import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { createReadOnlyClient } from '../lib/dao/client';
import { deriveSquadsVaultPda } from '../lib/dao/squads';
import { futarchy } from '@zcomb/programs-sdk';

const RPC_URL = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
if (!RPC_URL) {
  console.error('RPC_URL or NEXT_PUBLIC_RPC_URL must be set');
  process.exit(1);
}

const input = process.argv[2];
if (!input) {
  console.error('Usage: pnpm tsx scripts/test-finalize-dao.ts <DAO_NAME or DAO_PDA>');
  process.exit(1);
}

async function main() {
  const connection = new Connection(RPC_URL!, 'confirmed');
  const client = createReadOnlyClient(connection);

  // Determine if input is a name or PDA
  let daoPda: PublicKey;
  let inputName: string | null = null;

  try {
    // Try parsing as a public key first
    daoPda = new PublicKey(input);
    console.log(`Input parsed as PDA: ${daoPda.toBase58()}`);
  } catch {
    // Not a valid pubkey, treat as DAO name
    inputName = input;
    const [derived] = futarchy.deriveDAOPDA(inputName);
    daoPda = derived;
    console.log(`Input treated as name: "${inputName}"`);
    console.log(`Derived DAO PDA: ${daoPda.toBase58()}`);
  }

  // Also derive moderator PDA from name (if we have one)
  if (inputName) {
    const [derivedModerator] = futarchy.deriveModeratorPDA(inputName);
    console.log(`Derived Moderator PDA: ${derivedModerator.toBase58()}`);
  }

  console.log('\n--- Fetching on-chain DAO account ---\n');

  let onChainDao;
  try {
    onChainDao = await client.fetchDAO(daoPda);
  } catch (err) {
    console.error('Failed to fetch DAO account:', err);
    process.exit(1);
  }

  // Print all fields
  console.log('name:              ', onChainDao.name);
  console.log('admin:             ', onChainDao.admin.toBase58());
  console.log('tokenMint:         ', onChainDao.tokenMint.toBase58());
  console.log('cosigner:          ', onChainDao.cosigner.toBase58());
  console.log('treasuryMultisig:  ', onChainDao.treasuryMultisig.toBase58(), '(on-chain = multisig PDA)');
  console.log('mintAuthMultisig:  ', onChainDao.mintAuthMultisig.toBase58(), '(on-chain = multisig PDA)');

  // Parse daoType
  console.log('\n--- DAO Type ---\n');
  if ('parent' in onChainDao.daoType) {
    const parent = onChainDao.daoType.parent;
    console.log('type:              parent');
    console.log('moderator:         ', parent.moderator.toBase58());
    console.log('pool:              ', parent.pool.toBase58());
    console.log('poolType:          ', JSON.stringify(parent.poolType));

    // Cross-check moderator derivation if we have the name
    if (inputName) {
      const [derivedModerator] = futarchy.deriveModeratorPDA(inputName);
      const matches = derivedModerator.equals(parent.moderator);
      console.log(`\nModerator cross-check: derived=${derivedModerator.toBase58()} on-chain=${parent.moderator.toBase58()} match=${matches}`);
      if (!matches) {
        console.warn('WARNING: Derived moderator PDA does not match on-chain value!');
      }
    }
  } else if ('child' in onChainDao.daoType) {
    console.log('type:              child');
    console.log('parentDao:         ', onChainDao.daoType.child.parentDao.toBase58());
  } else {
    console.log('type:              UNKNOWN', JSON.stringify(onChainDao.daoType));
  }

  // Derive vault PDAs (what the DB stores)
  console.log('\n--- Derived Vault PDAs (for DB storage) ---\n');

  const treasuryVault = deriveSquadsVaultPda(onChainDao.treasuryMultisig);
  const mintVault = deriveSquadsVaultPda(onChainDao.mintAuthMultisig);

  console.log('treasury_multisig (vault): ', treasuryVault.toBase58());
  console.log('mint_auth_multisig (vault):', mintVault.toBase58());

  // Summary: what finalize-reserved would write to the DB
  console.log('\n--- Finalization Summary (DB UPDATE values) ---\n');
  console.log(JSON.stringify({
    dao_pda: daoPda.toBase58(),
    moderator_pda: 'parent' in onChainDao.daoType
      ? onChainDao.daoType.parent.moderator.toBase58()
      : 'N/A (child DAO)',
    treasury_multisig: treasuryVault.toBase58(),
    mint_auth_multisig: mintVault.toBase58(),
    admin_wallet: onChainDao.admin.toBase58(),
    token_mint: onChainDao.tokenMint.toBase58(),
    pool_address: 'parent' in onChainDao.daoType
      ? onChainDao.daoType.parent.pool.toBase58()
      : 'N/A (child DAO)',
  }, null, 2));
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
