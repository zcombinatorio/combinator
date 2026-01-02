import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';

async function main() {
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) throw new Error('RPC_URL required');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  const cpAmm = new CpAmm(connection);

  const pool = new PublicKey(process.env.POOL_ADDRESS || 'GhnEMGPkRHaaVDSm1bLXPUepALgVyxBaQEB8fh1HX1bJ');
  const admin = new PublicKey(process.env.ADMIN_WALLET || 'DyCW5nbNjX12JtjxsRDVFb6UEUV6u9GpEMW3rFVCW5WD');

  console.log('Checking LP positions...');
  console.log('Pool:', pool.toBase58());
  console.log('Admin:', admin.toBase58());
  console.log('');

  const positions = await cpAmm.getUserPositionByPool(pool, admin);
  console.log('Admin LP positions:', positions.length);
  for (const p of positions) {
    console.log('  NFT:', p.positionState.nftMint.toBase58());
    console.log('  Liquidity:', p.positionState.unlockedLiquidity.toString());
  }
}

main().catch(console.error);
