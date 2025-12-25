/**
 * List all Meteora LP positions owned by a given wallet
 * Works for both DLMM and DAMM positions
 *
 * Uses the SDK to properly resolve positions by checking which position NFTs
 * are held by the wallet.
 *
 * Usage:
 *   1. Update OWNER_ADDRESS below
 *   2. Run: pnpm ts-node scripts/list-owner-positions.ts
 */
import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import DLMM from '@meteora-ag/dlmm';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';

// ============================================================================
// CONFIGURATION - Update these values before running
// ============================================================================

// Owner wallet address to query
// Manager wallets: ZC=54A1ki4t5K9sB6oqLBVxVkUbkkCEAGeRACphsZuNPU5R, OOGWAY=DaSkykmLmr1n1ExAWWZDYCfzFxX7UuUn1CnjYca8gz9D
// SURF=etBt7Ki2Gr2rhidNmXtHyxiGHkokKPayNhG787SusMj, SURFTEST=ESMiG5ppoVMtYq3EG8aKx3XzEtKPfiGQuAx2S4jhw3zf
// TESTSURF=BnzxLbNmM63RxhHDdfeWa7BmV2YM4q7KxDJ3w75kDZo
const OWNER_ADDRESS = 'etBt7Ki2Gr2rhidNmXtHyxiGHkokKPayNhG787SusMj'; // SURF

// ============================================================================

// Known pools to check for positions
const KNOWN_POOLS: { address: string; ticker: string; type: 'dlmm' | 'damm' }[] = [
  { address: '7jbhVZcYqCRmciBcZzK8L5B96Pyw7i1SpXQFKBkzD3G2', ticker: 'ZC', type: 'dlmm' },
  { address: '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX', ticker: 'OOGWAY', type: 'damm' },
  { address: 'Ez1QYeC95xJRwPA9SR7YWC1H1Tj43exJr91QqKf8Puu1', ticker: 'SURF', type: 'damm' },
  { address: 'PS3rPSb49GnAkmh3tec1RQizgNSb1hUwPsYHGGuAy5r', ticker: 'SURFTEST', type: 'damm' },
  { address: 'EC7MUufEpZcRZyXTFt16MMNLjJVnj9Vkku4UwdZ713Hx', ticker: 'TESTSURF', type: 'dlmm' },
];

async function listOwnerPositions() {
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) {
    console.error('RPC_URL environment variable is required');
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const owner = new PublicKey(OWNER_ADDRESS);

  console.log('=== Owner Positions ===');
  console.log(`Owner: ${OWNER_ADDRESS}`);
  console.log('');

  let dlmmCount = 0;
  let dammCount = 0;

  try {
    // Check DLMM pools
    console.log('--- DLMM Positions ---');
    const dlmmPools = KNOWN_POOLS.filter(p => p.type === 'dlmm');

    for (const pool of dlmmPools) {
      try {
        const dlmm = await DLMM.create(connection, new PublicKey(pool.address));
        const { userPositions } = await dlmm.getPositionsByUserAndLbPair(owner);

        if (userPositions.length > 0) {
          // Get token decimals
          const lbPair = dlmm.lbPair;
          const tokenXMintInfo = await getMint(connection, lbPair.tokenXMint);
          const tokenYMintInfo = await getMint(connection, lbPair.tokenYMint);

          for (const pos of userPositions) {
            const positionData = pos.positionData;
            const rawX = positionData.totalXAmount || new BN(0);
            const rawY = positionData.totalYAmount || new BN(0);
            const humanX = Number(rawX.toString()) / Math.pow(10, tokenXMintInfo.decimals);
            const humanY = Number(rawY.toString()) / Math.pow(10, tokenYMintInfo.decimals);

            console.log(`Position: ${pos.publicKey.toBase58()}`);
            console.log(`  Pool: ${pool.address}`);
            console.log(`  Ticker: ${pool.ticker}`);
            console.log(`  Token X: ${humanX.toLocaleString()} (${rawX.toString()} raw)`);
            console.log(`  Token Y: ${humanY.toLocaleString()} (${rawY.toString()} raw)`);
            console.log(`  Bin Range: ${positionData.lowerBinId} - ${positionData.upperBinId}`);
            console.log('');
            dlmmCount++;
          }
        }
      } catch (error) {
        // Pool might not exist or have issues
        console.log(`Could not query ${pool.ticker}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }

    if (dlmmCount === 0) {
      console.log('No DLMM positions found\n');
    }

    // Check DAMM pools
    console.log('--- DAMM Positions ---');
    const dammPools = KNOWN_POOLS.filter(p => p.type === 'damm');
    const cpAmm = new CpAmm(connection);

    for (const pool of dammPools) {
      try {
        const poolAddress = new PublicKey(pool.address);
        const positions = await cpAmm.getUserPositionByPool(poolAddress, owner);

        if (positions.length > 0) {
          // Fetch pool state for token info
          const poolState = await cpAmm.fetchPoolState(poolAddress);
          const tokenAMintInfo = await getMint(connection, poolState.tokenAMint);
          const tokenBMintInfo = await getMint(connection, poolState.tokenBMint);
          const currentEpoch = (await connection.getEpochInfo()).epoch;

          for (const pos of positions) {
            // DAMM SDK returns { position, positionNftAccount, positionState } objects
            const { position, positionState } = pos;
            const totalLiquidity = positionState.unlockedLiquidity
              .add(positionState.vestedLiquidity)
              .add(positionState.permanentLockedLiquidity);

            // Calculate actual token amounts using withdraw quote
            let tokenAAmount = 0;
            let tokenBAmount = 0;
            if (!totalLiquidity.isZero()) {
              try {
                const withdrawQuote = cpAmm.getWithdrawQuote({
                  liquidityDelta: totalLiquidity,
                  minSqrtPrice: poolState.sqrtMinPrice,
                  maxSqrtPrice: poolState.sqrtMaxPrice,
                  sqrtPrice: poolState.sqrtPrice,
                  tokenATokenInfo: { mint: tokenAMintInfo, currentEpoch },
                  tokenBTokenInfo: { mint: tokenBMintInfo, currentEpoch }
                });
                tokenAAmount = Number(withdrawQuote.outAmountA.toString()) / Math.pow(10, tokenAMintInfo.decimals);
                tokenBAmount = Number(withdrawQuote.outAmountB.toString()) / Math.pow(10, tokenBMintInfo.decimals);
              } catch {
                // Quote calculation failed
              }
            }

            console.log(`Position: ${position.toBase58()}`);
            console.log(`  Pool: ${pool.address}`);
            console.log(`  Ticker: ${pool.ticker}`);
            console.log(`  Token A: ${tokenAAmount.toLocaleString()}`);
            console.log(`  Token B: ${tokenBAmount.toLocaleString()}`);
            console.log(`  Liquidity: ${totalLiquidity.toString()} (unlocked: ${positionState.unlockedLiquidity.toString()})`);
            console.log('');
            dammCount++;
          }
        }
      } catch (error) {
        // Pool might not exist or have issues
        console.log(`Could not query ${pool.ticker}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }

    if (dammCount === 0) {
      console.log('No DAMM positions found\n');
    }

    // Summary
    const totalPositions = dlmmCount + dammCount;
    console.log('--- Summary ---');
    console.log(`Total: ${totalPositions} position(s)`);
    console.log(`  DLMM: ${dlmmCount}`);
    console.log(`  DAMM: ${dammCount}`);

  } catch (error) {
    console.error('Error fetching positions:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  listOwnerPositions();
}

export { listOwnerPositions };
