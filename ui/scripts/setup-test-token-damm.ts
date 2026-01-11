/*
 * Setup Test Token with DAMM Pool
 *
 * This script creates a test token via DBC (Dynamic Bonding Curve) with a low
 * migration threshold, then buys tokens to trigger migration to DAMM v2.
 *
 * Flow:
 * 1. Create DBC config with low migration market cap (0.1 SOL)
 * 2. Create pool with first buy
 * 3. Buy more tokens to trigger migration
 * 4. Verify migration and return DAMM pool address
 *
 * Usage:
 *   pnpm tsx scripts/setup-test-token-damm.ts
 *
 * Required ENV:
 *   - RPC_URL: Solana RPC endpoint
 *   - DAO_PRIVATE_KEY: Private key for DAO wallet (pays for transactions)
 */

import 'dotenv/config';
import {
  DynamicBondingCurveClient,
  BaseFeeMode,
  type BuildCurveWithMarketCapParam,
  MigrationOption,
  TokenDecimal,
  ActivationType,
  CollectFeeMode,
  MigrationFeeOption,
  TokenType,
  TokenUpdateAuthorityOption,
  DammV2DynamicFeeMode,
  buildCurveWithMarketCap,
  deriveDammV2PoolAddress,
  deriveDbcPoolAddress,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import BN from 'bn.js';

const RPC_URL = process.env.RPC_URL;
const DAO_PRIVATE_KEY = process.env.DAO_PRIVATE_KEY;

// Native SOL mint (WSOL)
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

if (!RPC_URL) {
  throw new Error('RPC_URL not found in environment variables');
}
if (!DAO_PRIVATE_KEY) {
  throw new Error('DAO_PRIVATE_KEY not found in environment variables');
}

const payer = Keypair.fromSecretKey(bs58.decode(DAO_PRIVATE_KEY));
const connection = new Connection(RPC_URL, 'confirmed');
const client = new DynamicBondingCurveClient(connection, 'confirmed');

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createTestConfig(): Promise<PublicKey> {
  console.log('\n=== Step 1: Creating DBC Config with Low Migration Threshold ===\n');

  const config = Keypair.generate();
  console.log(`Config account: ${config.publicKey.toString()}`);
  console.log(`Payer account: ${payer.publicKey.toString()}`);

  // Config for testing - minimal curve for ~0.1 SOL migration
  // migrationQuoteAmount = migrationMarketCap * percentageSupplyOnMigration / 100
  // With 0.15/0.3 ratio and 20.69% leftover, percentageSupplyOnMigration ≈ 32.85%
  // So migrationQuoteAmount = 0.3 * 32.85 / 100 ≈ 0.1 SOL
  const curveParams: BuildCurveWithMarketCapParam = {
    totalTokenSupply: 100_000, // 100k tokens (tiny supply)
    initialMarketCap: 0.15, // 0.15 SOL initial market cap
    migrationMarketCap: 0.3, // 0.3 SOL market cap → ~0.1 SOL to migrate
    migrationOption: MigrationOption.MET_DAMM_V2,
    tokenBaseDecimal: TokenDecimal.SIX,
    tokenQuoteDecimal: TokenDecimal.NINE, // SOL has 9 decimals
    lockedVestingParam: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    baseFeeParams: {
      baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: {
        startingFeeBps: 100, // 1% fee
        endingFeeBps: 100,
        numberOfPeriod: 0,
        totalDuration: 0,
      },
    },
    dynamicFeeEnabled: false,
    activationType: ActivationType.Slot,
    collectFeeMode: CollectFeeMode.QuoteToken,
    migrationFeeOption: MigrationFeeOption.FixedBps25,
    tokenType: TokenType.SPL,
    partnerLpPercentage: 100,
    creatorLpPercentage: 0,
    partnerLockedLpPercentage: 0,
    creatorLockedLpPercentage: 0,
    creatorTradingFeePercentage: 0,
    leftover: 20_690, // ~20.69% of 100k tokens
    tokenUpdateAuthority: TokenUpdateAuthorityOption.PartnerUpdateAndMintAuthority,
    migrationFee: {
      feePercentage: 0,
      creatorFeePercentage: 0,
    },
    migratedPoolFee: {
      collectFeeMode: CollectFeeMode.QuoteToken,
      dynamicFee: DammV2DynamicFeeMode.Disabled,
      poolFeeBps: 25, // 0.25% pool fee
    },
  };

  const curveConfig = buildCurveWithMarketCap(curveParams);

  const configParams = {
    config: config.publicKey,
    feeClaimer: payer.publicKey,
    leftoverReceiver: payer.publicKey,
    payer: payer.publicKey,
    quoteMint: WSOL_MINT,
    ...curveConfig,
  };

  const transaction = await client.partner.createConfig(configParams);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = payer.publicKey;
  transaction.partialSign(config);

  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [payer, config],
    { commitment: 'confirmed' }
  );

  console.log(`Config created: ${config.publicKey.toString()}`);
  console.log(`Transaction: https://solscan.io/tx/${signature}`);
  console.log(`Migration threshold: ~0.1 SOL`);

  // Wait for config to be fully confirmed on-chain
  console.log('Waiting for config confirmation...');
  await sleep(5000);

  return config.publicKey;
}

async function createPoolWithFirstBuy(configAddress: PublicKey): Promise<{ baseMint: PublicKey; poolAddress: string }> {
  console.log('\n=== Step 2: Creating Pool with First Buy ===\n');

  const baseMint = Keypair.generate();
  const timestamp = Date.now();
  const tokenName = `TestDAMM${timestamp}`;
  const tokenSymbol = 'TDAMM';
  const tokenUri = 'https://example.com/metadata.json';

  console.log(`Token Name: ${tokenName}`);
  console.log(`Token Symbol: ${tokenSymbol}`);
  console.log(`Base Mint: ${baseMint.publicKey.toString()}`);

  // Small first buy to create the pool (0.01 SOL)
  const firstBuyAmount = new BN(0.01 * LAMPORTS_PER_SOL);

  const { createPoolTx, swapBuyTx } = await client.pool.createPoolWithFirstBuy({
    createPoolParam: {
      baseMint: baseMint.publicKey,
      config: configAddress,
      name: tokenName,
      symbol: tokenSymbol,
      uri: tokenUri,
      payer: payer.publicKey,
      poolCreator: payer.publicKey,
    },
    firstBuyParam: {
      buyer: payer.publicKey,
      buyAmount: firstBuyAmount,
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    },
  });

  const combinedTx = new Transaction();
  combinedTx.add(...createPoolTx.instructions);
  if (swapBuyTx) {
    combinedTx.add(...swapBuyTx.instructions);
  }

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  combinedTx.recentBlockhash = blockhash;
  combinedTx.feePayer = payer.publicKey;
  combinedTx.partialSign(baseMint);

  const signature = await sendAndConfirmTransaction(
    connection,
    combinedTx,
    [payer, baseMint],
    { commitment: 'confirmed' }
  );

  // Derive pool address using SDK function (quoteMint, baseMint, config)
  const poolAddress = deriveDbcPoolAddress(WSOL_MINT, baseMint.publicKey, configAddress);

  console.log(`Pool created successfully!`);
  console.log(`Transaction: https://solscan.io/tx/${signature}`);
  console.log(`Base Mint: ${baseMint.publicKey.toString()}`);
  console.log(`DBC Pool: ${poolAddress.toString()}`);

  return { baseMint: baseMint.publicKey, poolAddress: poolAddress.toString() };
}

async function buyToTriggerMigration(poolAddress: string, configAddress: PublicKey, baseMint: PublicKey): Promise<string> {
  console.log('\n=== Step 3: Buying Tokens to Trigger Migration ===\n');

  // Buy enough to trigger migration
  const buyAmount = new BN(0.35 * LAMPORTS_PER_SOL);
  console.log(`Buy amount: ${buyAmount.toNumber() / LAMPORTS_PER_SOL} SOL`);
  console.log(`Pool address: ${poolAddress}`);

  // Wait for pool to be fully confirmed
  await sleep(3000);

  // Try direct pool lookup first
  let poolState = await client.state.getPool(poolAddress);

  // If not found, try looking up by base mint
  if (!poolState) {
    console.log(`Pool not found at derived address, trying lookup by base mint...`);
    const poolByMint = await client.state.getPoolByBaseMint(baseMint);
    if (poolByMint) {
      console.log(`Found pool by base mint at: ${poolByMint.publicKey.toString()}`);
      poolState = poolByMint.account;
      // Update pool address for subsequent calls
      poolAddress = poolByMint.publicKey.toString();
    }
  }

  if (!poolState) {
    throw new Error(`Pool not found at address: ${poolAddress} or by base mint. The pool may not have been created correctly.`);
  }
  console.log(`Pool found. Migration status: ${poolState.isMigrated}`);

  const config = await client.state.getPoolConfig(poolState.config);

  // Debug: show migration threshold
  try {
    const migrationThreshold = await client.state.getPoolMigrationQuoteThreshold(poolAddress);
    console.log(`Migration quote threshold: ${migrationThreshold.toNumber() / LAMPORTS_PER_SOL} SOL`);
  } catch (e) {
    console.log(`Could not get migration threshold: ${e}`);
  }

  // Show current pool state
  console.log(`Current base reserve: ${poolState.baseReserve?.toString()}`);
  console.log(`Current quote reserve: ${poolState.quoteReserve?.toString()}`);
  console.log(`Current curve progress: ${await client.state.getPoolCurveProgress(poolAddress)}%`);

  const quote = client.pool.swapQuote({
    virtualPool: poolState,
    config: config,
    swapBaseForQuote: false, // Buy base token with SOL
    amountIn: buyAmount,
    hasReferral: false,
    currentPoint: poolState.activationPoint,
  });

  console.log(`Expected tokens: ${quote.outputAmount.toString()}`);

  const swapTx = await client.pool.swap({
    owner: payer.publicKey,
    pool: new PublicKey(poolAddress),
    amountIn: buyAmount,
    minimumAmountOut: new BN(0),
    swapBaseForQuote: false,
    referralTokenAccount: null,
  });

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  swapTx.recentBlockhash = blockhash;
  swapTx.feePayer = payer.publicKey;

  const signature = await sendAndConfirmTransaction(
    connection,
    swapTx,
    [payer],
    { commitment: 'confirmed' }
  );

  console.log(`Buy transaction: https://solscan.io/tx/${signature}`);

  // Wait for migration
  console.log('\nWaiting for migration to complete...');
  await sleep(3000);

  // Check migration status
  const updatedPoolState = await client.state.getPool(poolAddress);

  if (updatedPoolState.isMigrated === 1) {
    console.log('\n✅ Migration completed!');

    // Derive DAMM v2 pool address
    const dammPoolAddress = deriveDammV2PoolAddress(
      poolState.config,
      config.quoteMint,
      baseMint
    );

    console.log(`DAMM v2 Pool Address: ${dammPoolAddress.toString()}`);
    return dammPoolAddress.toString();
  } else {
    console.log('\n⚠️ Migration not yet triggered. Current state:');
    console.log(`  isMigrated: ${updatedPoolState.isMigrated}`);
    console.log(`  migrationProgress: ${updatedPoolState.migrationProgress}`);

    // Try another buy
    console.log('\nTrying another buy to trigger migration...');
    const extraBuyAmount = new BN(0.1 * LAMPORTS_PER_SOL);

    const extraSwapTx = await client.pool.swap({
      owner: payer.publicKey,
      pool: new PublicKey(poolAddress),
      amountIn: extraBuyAmount,
      minimumAmountOut: new BN(0),
      swapBaseForQuote: false,
      referralTokenAccount: null,
    });

    const { blockhash: bh2 } = await connection.getLatestBlockhash('confirmed');
    extraSwapTx.recentBlockhash = bh2;
    extraSwapTx.feePayer = payer.publicKey;

    const sig2 = await sendAndConfirmTransaction(
      connection,
      extraSwapTx,
      [payer],
      { commitment: 'confirmed' }
    );

    console.log(`Extra buy transaction: https://solscan.io/tx/${sig2}`);
    await sleep(3000);

    const finalPoolState = await client.state.getPool(poolAddress);
    if (finalPoolState.isMigrated === 1) {
      const dammPoolAddress = deriveDammV2PoolAddress(
        poolState.config,
        config.quoteMint,
        baseMint
      );
      console.log(`\n✅ Migration completed! DAMM v2 Pool: ${dammPoolAddress.toString()}`);
      return dammPoolAddress.toString();
    }

    throw new Error('Migration did not trigger after multiple buys');
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         DAMM Test Token Setup Script                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nPayer: ${payer.publicKey.toString()}`);

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    throw new Error('Insufficient balance. Need at least 0.05 SOL for setup.');
  }

  try {
    // Step 1: Create config
    const configAddress = await createTestConfig();

    // Step 2: Create pool with first buy
    const { baseMint, poolAddress } = await createPoolWithFirstBuy(configAddress);

    // Step 3: User will manually buy ~0.1 SOL to trigger migration
    // and provide the DAMM v2 pool address

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║              DBC POOL CREATED - READY FOR MIGRATION          ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`\nToken Mint: ${baseMint.toString()}`);
    console.log(`DBC Pool: ${poolAddress}`);
    console.log(`Config: ${configAddress.toString()}`);
    console.log(`\nMigration threshold: ~0.1 SOL`);
    console.log(`Buy ~0.1 SOL worth of tokens to trigger migration to DAMM v2.`);

    return {
      tokenMint: baseMint.toString(),
      dbcPool: poolAddress,
      config: configAddress.toString(),
    };

  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    throw error;
  }
}

main()
  .then(result => {
    console.log('\nResult:', JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
