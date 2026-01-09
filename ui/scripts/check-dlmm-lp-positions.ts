/**
 * Check DLMM LP positions for a wallet in a pool
 *
 * Equivalent to check-lp-positions.ts but for DLMM pools.
 *
 * Usage:
 *   POOL_ADDRESS="<pool>" ADMIN_WALLET="<wallet>" pnpm tsx scripts/check-dlmm-lp-positions.ts
 *
 * Required ENV:
 *   - RPC_URL: Solana RPC endpoint
 *   - POOL_ADDRESS: DLMM pool address
 *   - ADMIN_WALLET: Wallet to check positions for
 */
import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import DLMM from '@meteora-ag/dlmm';
import BN from 'bn.js';

async function main() {
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) throw new Error('RPC_URL required');

  const poolAddress = process.env.POOL_ADDRESS;
  const adminWallet = process.env.ADMIN_WALLET;

  if (!poolAddress) throw new Error('POOL_ADDRESS required');
  if (!adminWallet) throw new Error('ADMIN_WALLET required');

  const connection = new Connection(RPC_URL, 'confirmed');
  const pool = new PublicKey(poolAddress);
  const admin = new PublicKey(adminWallet);

  console.log('=== Checking DLMM LP Positions ===');
  console.log('Pool:', pool.toBase58());
  console.log('Admin:', admin.toBase58());
  console.log('');

  try {
    const dlmmPool = await DLMM.create(connection, pool);
    const lbPair = dlmmPool.lbPair;

    // Get token info
    const tokenXMint = lbPair.tokenXMint;
    const tokenYMint = lbPair.tokenYMint;
    const tokenXMintInfo = await getMint(connection, tokenXMint);
    const tokenYMintInfo = await getMint(connection, tokenYMint);
    const tokenXDecimals = tokenXMintInfo.decimals;
    const tokenYDecimals = tokenYMintInfo.decimals;

    console.log('Pool Info:');
    console.log(`  Token X: ${tokenXMint.toBase58()} (${tokenXDecimals} decimals)`);
    console.log(`  Token Y: ${tokenYMint.toBase58()} (${tokenYDecimals} decimals)`);

    // Get active bin price
    const activeBin = await dlmmPool.getActiveBin();
    console.log(`  Active Bin: ${activeBin.binId}`);
    console.log(`  Active Price: ${activeBin.price} Y per X`);
    console.log('');

    // Get positions for the admin wallet
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(admin);

    console.log(`Admin LP positions: ${userPositions.length}`);

    if (userPositions.length === 0) {
      console.log('  No positions found for this wallet');
      return;
    }

    for (const position of userPositions) {
      const posData = position.positionData;

      // Get amounts
      const rawX = posData.totalXAmount ? new BN(posData.totalXAmount.toString()) : new BN(0);
      const rawY = posData.totalYAmount ? new BN(posData.totalYAmount.toString()) : new BN(0);
      const humanX = Number(rawX.toString()) / Math.pow(10, tokenXDecimals);
      const humanY = Number(rawY.toString()) / Math.pow(10, tokenYDecimals);

      console.log('');
      console.log(`  Position: ${position.publicKey.toBase58()}`);
      console.log(`    Bin Range: ${posData.lowerBinId} - ${posData.upperBinId}`);
      console.log(`    Token X Amount: ${humanX.toLocaleString()} (${rawX.toString()} raw)`);
      console.log(`    Token Y Amount: ${humanY.toLocaleString()} (${rawY.toString()} raw)`);

      // Calculate total value in Y terms (SOL)
      const activeBinPrice = Number(activeBin.price);
      const xValueInY = humanX * activeBinPrice;
      const totalValueInY = xValueInY + humanY;
      console.log(`    Total Value: ~${totalValueInY.toFixed(4)} SOL equivalent`);
    }

    console.log('');
    console.log('✅ Position check complete');

  } catch (error) {
    console.error('Error checking positions:', error);
    process.exit(1);
  }
}

main().catch(console.error);
