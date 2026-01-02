/**
 * Transfer LP position from old DAO admin to new DAO admin
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
import { fetchKeypair } from '../lib/keyService';
import { getPool } from '../lib/db';
import { getDaoByPda } from '../lib/db/daos';

const OLD_DAO_PDA = process.env.OLD_DAO_PDA || 'CfsgE5ZLczDLUnBhkwKaNCUQtukhygKAwPXMEKUrEgAL';
const NEW_DAO_PDA = process.env.NEW_DAO_PDA || 'RCdAasUjKZRwLu5AJXQK6Hj8AudCxT9hGyqi5qr3a6f';

async function main() {
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) throw new Error('RPC_URL required');

  const connection = new Connection(RPC_URL, 'confirmed');
  const pool = getPool();

  console.log('=== Transfer LP Position ===');

  const oldDao = await getDaoByPda(pool, OLD_DAO_PDA);
  if (!oldDao) throw new Error('Old DAO not found');

  const newDao = await getDaoByPda(pool, NEW_DAO_PDA);
  if (!newDao) throw new Error('New DAO not found');

  console.log('Old DAO:', oldDao.dao_name, '- Admin:', oldDao.admin_wallet, '(key idx:', oldDao.admin_key_idx, ')');
  console.log('New DAO:', newDao.dao_name, '- Admin:', newDao.admin_wallet, '(key idx:', newDao.admin_key_idx, ')');

  // Fetch keypair using the key index from the DAO record
  const oldAdminKeypair = await fetchKeypair(oldDao.admin_key_idx);
  console.log('✓ Fetched old admin keypair');

  const cpAmm = new CpAmm(connection);
  const poolPubkey = new PublicKey(oldDao.pool_address);
  const oldAdmin = new PublicKey(oldDao.admin_wallet);
  const newAdmin = new PublicKey(newDao.admin_wallet);

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

    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('  Transferred! Signature:', sig);
  }

  console.log('\n=== Transfer Complete ===');

  const newPositions = await cpAmm.getUserPositionByPool(poolPubkey, newAdmin);
  console.log('New admin now has', newPositions.length, 'position(s)');
}

main().catch(console.error);
