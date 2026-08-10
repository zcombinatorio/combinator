/**
 * Transfer LP position from old DAO admin to new DAO admin
 *
 * Simulates by default; pass --send to broadcast.
 *
 * The destination is normally resolved from NEW_DAO_PDA's admin_wallet. When the
 * recipient is a plain wallet rather than a DAO in the DB, set NEW_OWNER_WALLET
 * instead and NEW_DAO_PDA is ignored.
 */
import 'dotenv/config';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID
} from '@solana/spl-token';
import { fetchAdminKeypair } from '../lib/keyService';
import { getPool } from '../lib/db';
import { getDaoByPda } from '../lib/db/daos';

const OLD_DAO_PDA = process.env.OLD_DAO_PDA || 'CfsgE5ZLczDLUnBhkwKaNCUQtukhygKAwPXMEKUrEgAL';
const NEW_DAO_PDA = process.env.NEW_DAO_PDA || 'RCdAasUjKZRwLu5AJXQK6Hj8AudCxT9hGyqi5qr3a6f';
const NEW_OWNER_WALLET = process.env.NEW_OWNER_WALLET;
const SEND = process.argv.includes('--send');

// The source DAO record is only consulted for these four fields. Supplying all of
// them explicitly skips the DB entirely, for environments without a DB connection.
const OLD_ADMIN_WALLET = process.env.OLD_ADMIN_WALLET;
const OLD_POOL_ADDRESS = process.env.OLD_POOL_ADDRESS;
const OLD_ADMIN_KEY_IDX = process.env.OLD_ADMIN_KEY_IDX;
const OLD_DAO_NAME = process.env.OLD_DAO_NAME;

async function main() {
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) throw new Error('RPC_URL required');

  const connection = new Connection(RPC_URL, 'confirmed');
  // Opened lazily so a fully env-specified run never touches the DB.
  let _pool: ReturnType<typeof getPool> | undefined;
  const db = () => (_pool ??= getPool());

  console.log('=== Transfer LP Position ===');

  let oldName: string;
  let oldAdminWallet: string;
  let oldKeyIdx: number | null;
  let oldPoolAddress: string;

  if (OLD_ADMIN_WALLET && OLD_POOL_ADDRESS) {
    oldName = OLD_DAO_NAME || '(unnamed)';
    oldAdminWallet = OLD_ADMIN_WALLET;
    oldPoolAddress = OLD_POOL_ADDRESS;
    if (!OLD_ADMIN_KEY_IDX || OLD_ADMIN_KEY_IDX === 'null') {
      // Mirrors a NULL admin_key_idx: fall back to the HISTORICAL_ADMIN_KEY_<name> env key.
      if (!OLD_DAO_NAME) throw new Error('OLD_DAO_NAME is required when OLD_ADMIN_KEY_IDX is omitted (historical DAO)');
      oldKeyIdx = null;
    } else {
      oldKeyIdx = Number(OLD_ADMIN_KEY_IDX);
      if (!Number.isInteger(oldKeyIdx)) throw new Error(`OLD_ADMIN_KEY_IDX must be an integer, got ${OLD_ADMIN_KEY_IDX}`);
    }
    console.log('Old DAO:', oldName, '- Admin:', oldAdminWallet, '(key idx:', oldKeyIdx, ') [from env, DB skipped]');
  } else {
    const oldDao = await getDaoByPda(db(), OLD_DAO_PDA);
    if (!oldDao) throw new Error('Old DAO not found');
    oldName = oldDao.dao_name;
    oldAdminWallet = oldDao.admin_wallet;
    oldPoolAddress = oldDao.pool_address;
    oldKeyIdx = oldDao.admin_key_idx;
    console.log('Old DAO:', oldName, '- Admin:', oldAdminWallet, '(key idx:', oldKeyIdx, ')');
  }

  let newAdminWallet: string;
  if (NEW_OWNER_WALLET) {
    newAdminWallet = NEW_OWNER_WALLET;
    console.log('New owner:', newAdminWallet, '(direct wallet, not a DAO record)');
  } else {
    const newDao = await getDaoByPda(db(), NEW_DAO_PDA);
    if (!newDao) throw new Error('New DAO not found');
    newAdminWallet = newDao.admin_wallet;
    console.log('New DAO:', newDao.dao_name, '- Admin:', newAdminWallet, '(key idx:', newDao.admin_key_idx, ')');
  }
  console.log(SEND ? 'Mode: SEND' : 'Mode: SIMULATE (pass --send to broadcast)');

  // Fetch keypair using the key index from the DAO record (supports historical DAOs)
  const oldAdminKeypair = await fetchAdminKeypair(oldKeyIdx, oldName);
  if (oldAdminKeypair.publicKey.toBase58() !== oldAdminWallet) {
    throw new Error(
      `key idx ${oldKeyIdx} is ${oldAdminKeypair.publicKey.toBase58()} but the DAO admin is ${oldAdminWallet}`,
    );
  }
  console.log('✓ Fetched old admin keypair (matches admin wallet)');

  const cpAmm = new CpAmm(connection);
  const poolPubkey = new PublicKey(oldPoolAddress);
  const oldAdmin = new PublicKey(oldAdminWallet);
  const newAdmin = new PublicKey(newAdminWallet);

  console.log('\nFetching LP positions...');
  const positions = await cpAmm.getUserPositionByPool(poolPubkey, oldAdmin);

  if (positions.length === 0) {
    console.log('No LP positions found for old admin');
    return;
  }

  console.log('Found', positions.length, 'position(s)');

  for (const pos of positions) {
    const nftMint = pos.positionState.nftMint;
    const liquidity = pos.positionState.unlockedLiquidity;
    
    console.log('\nPosition:', nftMint.toBase58());
    console.log('  Liquidity:', liquidity.toString());

    if (liquidity.isZero()) {
      console.log('  Skipping - no liquidity');
      continue;
    }

    // Use Token-2022 for position NFTs
    const oldAdminAta = getAssociatedTokenAddressSync(nftMint, oldAdmin, false, TOKEN_2022_PROGRAM_ID);
    const newAdminAta = getAssociatedTokenAddressSync(nftMint, newAdmin, false, TOKEN_2022_PROGRAM_ID);

    const tx = new Transaction();

    const ataInfo = await connection.getAccountInfo(newAdminAta);
    if (!ataInfo) {
      console.log('  Creating ATA for new admin...');
      tx.add(createAssociatedTokenAccountInstruction(
        oldAdmin, newAdminAta, newAdmin, nftMint, TOKEN_2022_PROGRAM_ID
      ));
    }

    tx.add(createTransferInstruction(oldAdminAta, newAdminAta, oldAdmin, 1, [], TOKEN_2022_PROGRAM_ID));

    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = oldAdmin;
    tx.sign(oldAdminKeypair);

    if (!SEND) {
      const sim = await connection.simulateTransaction(tx);
      console.log('  --- SIMULATION (no --send) ---');
      console.log('  err  :', sim.value.err);
      console.log('  units:', sim.value.unitsConsumed);
      for (const l of sim.value.logs ?? []) console.log('    ', l);
      if (sim.value.err) throw new Error('Simulation failed - see logs above');
      console.log('  Simulation OK. Re-run with --send to broadcast.');
      continue;
    }

    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('  Transferred! Signature:', sig);
  }

  if (!SEND) {
    console.log('\n=== Simulation Complete (nothing broadcast) ===');
    return;
  }

  console.log('\n=== Transfer Complete ===');

  const newPositions = await cpAmm.getUserPositionByPool(poolPubkey, newAdmin);
  console.log('New admin now has', newPositions.length, 'position(s)');
}

main().catch(console.error);
