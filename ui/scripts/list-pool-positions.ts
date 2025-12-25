/**
 * List all LP positions for a given Meteora pool
 * Works for both DLMM and DAMM pools
 *
 * Resolves actual wallet owners and shows LP sizes.
 *
 * Usage:
 *   1. Update POOL_ADDRESS and POOL_TYPE below
 *   2. Run: pnpm ts-node scripts/list-pool-positions.ts
 */
import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, unpackAccount, getMint } from '@solana/spl-token';
import DLMM from '@meteora-ag/dlmm';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';

// ============================================================================
// CONFIGURATION - Update these values before running
// ============================================================================

// Pool address to query (update this to test different pools)
// DAMM pools: OOGWAY, SURF, SURFTEST
// DLMM pools: ZC, TESTSURF
const POOL_ADDRESS = 'Ez1QYeC95xJRwPA9SR7YWC1H1Tj43exJr91QqKf8Puu1'; // SURF

// Pool type: 'dlmm' or 'damm'
const POOL_TYPE: 'dlmm' | 'damm' = 'damm';

// ============================================================================

/**
 * Find the actual wallet owner of a position NFT
 * Position accounts store the NFT mint, not the owner.
 * The actual owner is whoever holds the NFT in their token account.
 */
async function findNftOwner(connection: Connection, nftMint: PublicKey): Promise<string> {
  try {
    const tokenAccounts = await connection.getTokenLargestAccounts(nftMint, 'confirmed');
    for (const account of tokenAccounts.value) {
      if (account.amount === '1') {
        const accountInfo = await connection.getAccountInfo(account.address);
        if (accountInfo) {
          // Try Token-2022 program first
          try {
            const parsed = unpackAccount(account.address, accountInfo, TOKEN_2022_PROGRAM_ID);
            return parsed.owner.toBase58();
          } catch {
            // Try standard Token program
            try {
              const parsed = unpackAccount(account.address, accountInfo, TOKEN_PROGRAM_ID);
              return parsed.owner.toBase58();
            } catch {
              // Fall through
            }
          }
        }
      }
    }
  } catch {
    // Mint might not exist or have no holders
  }

  return 'unknown';
}

async function listPoolPositions() {
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) {
    console.error('RPC_URL environment variable is required');
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const poolAddress = new PublicKey(POOL_ADDRESS);

  console.log('=== Pool Positions ===');
  console.log(`Pool: ${POOL_ADDRESS}`);
  console.log(`Type: ${POOL_TYPE.toUpperCase()}`);
  console.log('');

  try {
    if (POOL_TYPE === 'dlmm') {
      // Use DLMM SDK to get all positions
      const dlmm = await DLMM.create(connection, poolAddress);

      // Get token decimals
      const lbPair = dlmm.lbPair;
      const tokenXMint = lbPair.tokenXMint;
      const tokenYMint = lbPair.tokenYMint;
      const tokenXMintInfo = await getMint(connection, tokenXMint);
      const tokenYMintInfo = await getMint(connection, tokenYMint);
      const tokenXDecimals = tokenXMintInfo.decimals;
      const tokenYDecimals = tokenYMintInfo.decimals;

      console.log(`Token X: ${tokenXMint.toBase58()} (${tokenXDecimals} decimals)`);
      console.log(`Token Y: ${tokenYMint.toBase58()} (${tokenYDecimals} decimals)`);
      console.log('');

      // Get all position accounts for this pool
      const positions = await connection.getProgramAccounts(
        new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
        {
          filters: [
            { memcmp: { offset: 8, bytes: poolAddress.toBase58() } },
          ],
        }
      );

      console.log(`Found ${positions.length} position(s):\n`);

      for (const pos of positions) {
        const data = pos.account.data;
        // DLMM structure: discriminator(8) + lbPair(32) + owner(32) + ...
        const owner = new PublicKey(data.slice(40, 72));

        // Try to get position data from SDK
        try {
          const { userPositions } = await dlmm.getPositionsByUserAndLbPair(owner);
          const posData = userPositions.find(p => p.publicKey.equals(pos.pubkey));

          if (posData && posData.positionData) {
            const rawX = posData.positionData.totalXAmount || new BN(0);
            const rawY = posData.positionData.totalYAmount || new BN(0);
            const humanX = Number(rawX.toString()) / Math.pow(10, tokenXDecimals);
            const humanY = Number(rawY.toString()) / Math.pow(10, tokenYDecimals);

            console.log(`Position: ${pos.pubkey.toBase58()}`);
            console.log(`  Owner: ${owner.toBase58()}`);
            console.log(`  Token X: ${humanX.toLocaleString()} (${rawX.toString()} raw)`);
            console.log(`  Token Y: ${humanY.toLocaleString()} (${rawY.toString()} raw)`);
            console.log(`  Bin Range: ${posData.positionData.lowerBinId} - ${posData.positionData.upperBinId}`);
          } else {
            console.log(`Position: ${pos.pubkey.toBase58()}`);
            console.log(`  Owner: ${owner.toBase58()}`);
          }
        } catch {
          console.log(`Position: ${pos.pubkey.toBase58()}`);
          console.log(`  Owner: ${owner.toBase58()}`);
        }
        console.log('');
      }

    } else {
      // Use DAMM SDK
      const cpAmm = new CpAmm(connection);

      // Fetch pool state for token info
      const poolState = await cpAmm.fetchPoolState(poolAddress);
      const tokenAMintInfo = await getMint(connection, poolState.tokenAMint);
      const tokenBMintInfo = await getMint(connection, poolState.tokenBMint);
      const tokenADecimals = tokenAMintInfo.decimals;
      const tokenBDecimals = tokenBMintInfo.decimals;
      const currentEpoch = (await connection.getEpochInfo()).epoch;

      console.log(`Token A: ${poolState.tokenAMint.toBase58()} (${tokenADecimals} decimals)`);
      console.log(`Token B: ${poolState.tokenBMint.toBase58()} (${tokenBDecimals} decimals)`);
      console.log('');

      // Get all position accounts for this pool
      const positions = await connection.getProgramAccounts(
        new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'),
        {
          filters: [
            { memcmp: { offset: 8, bytes: poolAddress.toBase58() } },
          ],
        }
      );

      console.log(`Found ${positions.length} position(s):\n`);

      for (const pos of positions) {
        const data = pos.account.data;
        // DAMM structure: discriminator(8) + pool(32) + positionNftMint(32) + ...
        const nftMint = new PublicKey(data.slice(40, 72));
        const owner = await findNftOwner(connection, nftMint);

        // Try to get position state from SDK
        try {
          const ownerPubkey = new PublicKey(owner);
          const userPositions = await cpAmm.getUserPositionByPool(poolAddress, ownerPubkey);
          const posData = userPositions.find(p => p.position.equals(pos.pubkey));

          if (posData && posData.positionState) {
            const totalLiquidity = posData.positionState.unlockedLiquidity
              .add(posData.positionState.vestedLiquidity)
              .add(posData.positionState.permanentLockedLiquidity);

            // Calculate actual token amounts using withdraw quote for full liquidity
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
                tokenAAmount = Number(withdrawQuote.outAmountA.toString()) / Math.pow(10, tokenADecimals);
                tokenBAmount = Number(withdrawQuote.outAmountB.toString()) / Math.pow(10, tokenBDecimals);
              } catch {
                // Quote calculation failed, show liquidity only
              }
            }

            console.log(`Position: ${pos.pubkey.toBase58()}`);
            console.log(`  NFT Mint: ${nftMint.toBase58()}`);
            console.log(`  Owner: ${owner}`);
            console.log(`  Token A: ${tokenAAmount.toLocaleString()}`);
            console.log(`  Token B: ${tokenBAmount.toLocaleString()}`);
            console.log(`  Liquidity: ${totalLiquidity.toString()} (unlocked: ${posData.positionState.unlockedLiquidity.toString()})`);
          } else {
            console.log(`Position: ${pos.pubkey.toBase58()}`);
            console.log(`  NFT Mint: ${nftMint.toBase58()}`);
            console.log(`  Owner: ${owner}`);
          }
        } catch {
          console.log(`Position: ${pos.pubkey.toBase58()}`);
          console.log(`  NFT Mint: ${nftMint.toBase58()}`);
          console.log(`  Owner: ${owner}`);
        }
        console.log('');
      }
    }

  } catch (error) {
    console.error('Error fetching positions:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  listPoolPositions();
}

export { listPoolPositions };
