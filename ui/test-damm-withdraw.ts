/*
 * Z Combinator - Meteora DAMM v2 Liquidity Withdrawal Test Script
 *
 * This script tests withdrawing 12.5% of liquidity from a Meteora DAMM v2
 * (Dynamic AMM) pool position and transferring it to a manager wallet.
 *
 * Required ENV variables:
 * - RPC_URL: Solana RPC endpoint
 * - LIQUIDITY_POOL_ADDRESS: Meteora DAMM v2 pool address for liquidity management
 * - LP_OWNER_PRIVATE_KEY: Private key of wallet that owns the LP position (Base58)
 * - MANAGER_WALLET: Destination address to send withdrawn tokens to
 * - PAYER_PRIVATE_KEY: (Optional) Private key for fee payer, defaults to LP owner
 */

import dotenv from 'dotenv';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { CpAmm, getTokenProgram } from '@meteora-ag/cp-amm-sdk';
import bs58 from 'bs58';
import { getMint, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddress, createTransferInstruction, NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';

dotenv.config();

// Set to true to simulate transactions without executing them
const SIMULATE_ONLY = true;

async function testDammWithdraw() {
  try {
    console.log('\n🧪 Meteora DAMM v2 Liquidity Withdrawal Test Script');
    console.log(`Mode: ${SIMULATE_ONLY ? '🔍 SIMULATION ONLY' : '⚡ LIVE EXECUTION'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    const LIQUIDITY_POOL_ADDRESS = process.env.LIQUIDITY_POOL_ADDRESS;
    const LP_OWNER_PRIVATE_KEY = process.env.LP_OWNER_PRIVATE_KEY || process.env.DAO_PRIVATE_KEY;
    const MANAGER_WALLET = process.env.MANAGER_WALLET;
    const FEE_PAYER_PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY || process.env.DAO_PRIVATE_KEY;

    if (!RPC_URL) {
      throw new Error('RPC_URL not set in environment');
    }
    if (!LIQUIDITY_POOL_ADDRESS) {
      throw new Error('LIQUIDITY_POOL_ADDRESS not set in environment');
    }
    if (!LP_OWNER_PRIVATE_KEY) {
      throw new Error('LP_OWNER_PRIVATE_KEY not set in environment');
    }
    if (!MANAGER_WALLET) {
      throw new Error('MANAGER_WALLET not set in environment');
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const feePayer = FEE_PAYER_PRIVATE_KEY
      ? Keypair.fromSecretKey(bs58.decode(FEE_PAYER_PRIVATE_KEY))
      : lpOwner;
    const poolAddress = new PublicKey(LIQUIDITY_POOL_ADDRESS);
    const managerWallet = new PublicKey(MANAGER_WALLET);

    console.log('Configuration:');
    console.log(`  Pool:             ${poolAddress.toBase58()}`);
    console.log(`  LP Owner:         ${lpOwner.publicKey.toBase58()}`);
    console.log(`  Fee Payer:        ${feePayer.publicKey.toBase58()}`);
    console.log(`  Manager Wallet:   ${managerWallet.toBase58()}`);
    console.log('');

    // Step 1: Create CpAmm instance
    console.log('📊 Step 1: Loading DAMM pool...');
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);

    console.log(`  Token A Mint: ${poolState.tokenAMint.toBase58()}`);
    console.log(`  Token B Mint: ${poolState.tokenBMint.toBase58()}`);
    console.log(`  Token A Vault: ${poolState.tokenAVault.toBase58()}`);
    console.log(`  Token B Vault: ${poolState.tokenBVault.toBase58()}`);
    console.log('');

    // Step 2: Get user positions
    console.log('💰 Step 2: Getting user positions...');

    const userPositions = await cpAmm.getUserPositionByPool(poolAddress, lpOwner.publicKey);

    if (userPositions.length === 0) {
      console.log('  ⚠️  No positions found for this owner in this pool');
      return;
    }

    console.log(`  Found ${userPositions.length} position(s)`);

    // Display position details
    for (let i = 0; i < userPositions.length; i++) {
      const { position, positionNftAccount, positionState } = userPositions[i];

      console.log(`\n  Position ${i + 1}:`);
      console.log(`    Address: ${position.toBase58()}`);
      console.log(`    NFT Account: ${positionNftAccount.toBase58()}`);
      console.log(`    Unlocked Liquidity: ${positionState.unlockedLiquidity.toString()}`);
      console.log(`    Vested Liquidity: ${positionState.vestedLiquidity.toString()}`);
      console.log(`    Permanent Locked: ${positionState.permanentLockedLiquidity.toString()}`);
    }
    console.log('');

    // Step 3: Calculate 12.5% withdrawal amount
    console.log('📐 Step 3: Calculating 12.5% withdrawal amount...');

    const { position, positionNftAccount, positionState } = userPositions[0];
    const totalLiquidity = positionState.unlockedLiquidity.add(positionState.vestedLiquidity).add(positionState.permanentLockedLiquidity);

    if (positionState.unlockedLiquidity.isZero()) {
      console.log('  ⚠️  No unlocked liquidity in position');
      return;
    }

    // Calculate 12.5% = 125/1000 (only from unlocked liquidity)
    const withdrawalPercentage = 12.5;
    const liquidityDelta = positionState.unlockedLiquidity.muln(125).divn(1000);

    console.log(`  Total Liquidity: ${totalLiquidity.toString()}`);
    console.log(`  Unlocked Liquidity: ${positionState.unlockedLiquidity.toString()}`);
    console.log(`  Withdrawal Amount (${withdrawalPercentage}%): ${liquidityDelta.toString()}`);
    console.log('');

    // Step 4: Calculate withdrawal quote (actual token amounts)
    console.log('💱 Step 4: Calculating token amounts to receive...');

    const tokenAMint = await getMint(connection, poolState.tokenAMint);
    const tokenBMint = await getMint(connection, poolState.tokenBMint);

    const withdrawQuote = cpAmm.getWithdrawQuote({
      liquidityDelta,
      minSqrtPrice: poolState.sqrtMinPrice,
      maxSqrtPrice: poolState.sqrtMaxPrice,
      sqrtPrice: poolState.sqrtPrice,
      tokenATokenInfo: {
        mint: tokenAMint,
        currentEpoch: await connection.getEpochInfo().then(e => e.epoch)
      },
      tokenBTokenInfo: {
        mint: tokenBMint,
        currentEpoch: await connection.getEpochInfo().then(e => e.epoch)
      }
    });

    const tokenAUiAmount = Number(withdrawQuote.outAmountA.toString()) / Math.pow(10, tokenAMint.decimals);
    const tokenBUiAmount = Number(withdrawQuote.outAmountB.toString()) / Math.pow(10, tokenBMint.decimals);

    // Check if Token B is native SOL (wrapped SOL)
    const isTokenBNativeSOL = poolState.tokenBMint.equals(NATIVE_MINT);
    console.log(`  Token A to receive: ${tokenAUiAmount.toFixed(6)} (${withdrawQuote.outAmountA.toString()} raw)`);
    console.log(`  Token B to receive: ${tokenBUiAmount.toFixed(6)} ${isTokenBNativeSOL ? 'SOL' : ''} (${withdrawQuote.outAmountB.toString()} ${isTokenBNativeSOL ? 'lamports' : 'raw'})`);
    console.log(`  Token B is ${isTokenBNativeSOL ? 'native SOL (unwrapped after withdrawal)' : 'SPL token'}`);
    console.log('');

    // Step 5: Build combined withdrawal and transfer transaction
    console.log('🔨 Step 5: Building combined withdrawal and transfer transaction...');

    // Get token programs for token A and B
    const tokenAProgram = getTokenProgram(tokenAMint.tlvData.length > 0 ? 1 : 0);
    const tokenBProgram = getTokenProgram(tokenBMint.tlvData.length > 0 ? 1 : 0);

    // Get owner's ATAs
    const tokenAAta = await getAssociatedTokenAddress(
      poolState.tokenAMint,
      lpOwner.publicKey,
      false,
      tokenAProgram
    );
    const tokenBAta = isTokenBNativeSOL ? lpOwner.publicKey : await getAssociatedTokenAddress(
      poolState.tokenBMint,
      lpOwner.publicKey,
      false,
      tokenBProgram
    );

    // Get destination ATAs
    const destTokenAAta = await getAssociatedTokenAddress(
      poolState.tokenAMint,
      managerWallet,
      false,
      tokenAProgram
    );
    const destTokenBAta = isTokenBNativeSOL ? managerWallet : await getAssociatedTokenAddress(
      poolState.tokenBMint,
      managerWallet,
      false,
      tokenBProgram
    );

    // Fetch vestings for this position (if any)
    const vestingsRaw = await cpAmm.getAllVestingsByPosition(position);
    const vestings = vestingsRaw.map(v => ({
      account: v.publicKey,
      vestingState: v.account
    }));
    console.log(`  Found ${vestings.length} vesting schedule(s)`);

    // Set slippage tolerance (0 for testing, adjust as needed)
    const tokenAAmountThreshold = new BN(0);
    const tokenBAmountThreshold = new BN(0);

    // Build combined transaction
    const combinedTx = new Transaction();
    combinedTx.feePayer = feePayer.publicKey;

    // Step 1: Create LP owner's ATAs (required before withdrawal)
    combinedTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        feePayer.publicKey,
        tokenAAta,
        lpOwner.publicKey,
        poolState.tokenAMint,
        tokenAProgram
      )
    );

    // Only create Token B ATA if it's NOT native SOL
    if (!isTokenBNativeSOL) {
      combinedTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          feePayer.publicKey,
          tokenBAta,
          lpOwner.publicKey,
          poolState.tokenBMint,
          tokenBProgram
        )
      );
    }

    // Step 2: Add remove liquidity instructions
    const removeLiquidityTx = await cpAmm.removeLiquidity({
      owner: lpOwner.publicKey,
      position,
      pool: poolAddress,
      positionNftAccount,
      liquidityDelta,
      tokenAAmountThreshold,
      tokenBAmountThreshold,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAProgram,
      tokenBProgram,
      vestings,
      currentPoint: new BN(0), // Current point for price calculations
    });

    combinedTx.add(...removeLiquidityTx.instructions);

    // Step 3: Create destination ATA for Token A (always SPL token)
    if (!withdrawQuote.outAmountA.isZero()) {
      combinedTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          feePayer.publicKey,
          destTokenAAta,
          managerWallet,
          poolState.tokenAMint,
          tokenAProgram
        )
      );
    }

    // Step 4: Create destination ATA for Token B (only if it's not native SOL)
    if (!withdrawQuote.outAmountB.isZero() && !isTokenBNativeSOL) {
      combinedTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          feePayer.publicKey,
          destTokenBAta,
          managerWallet,
          poolState.tokenBMint,
          tokenBProgram
        )
      );
    }

    // Step 5: Add transfer instruction for Token A (SPL token)
    if (!withdrawQuote.outAmountA.isZero()) {
      combinedTx.add(
        createTransferInstruction(
          tokenAAta,
          destTokenAAta,
          lpOwner.publicKey,
          BigInt(withdrawQuote.outAmountA.toString()),
          [],
          tokenAProgram
        )
      );
    }

    // Step 6: Add transfer instruction for Token B
    if (!withdrawQuote.outAmountB.isZero()) {
      if (isTokenBNativeSOL) {
        // Transfer native SOL using SystemProgram
        console.log(`  Adding native SOL transfer of ${tokenBUiAmount} SOL to ${managerWallet.toBase58()}`);
        combinedTx.add(
          SystemProgram.transfer({
            fromPubkey: lpOwner.publicKey,
            toPubkey: managerWallet,
            lamports: Number(withdrawQuote.outAmountB.toString())
          })
        );
      } else {
        // Transfer SPL token
        combinedTx.add(
          createTransferInstruction(
            tokenBAta,
            destTokenBAta,
            lpOwner.publicKey,
            BigInt(withdrawQuote.outAmountB.toString()),
            [],
            tokenBProgram
          )
        );
      }
    }

    console.log(`  Combined transaction has ${combinedTx.instructions.length} instruction(s)`);
    console.log('');

    // Step 6: Simulate/Execute combined transaction
    const stepLabel6 = SIMULATE_ONLY ? '🔍 Step 6: Simulating withdrawal transaction...' : '📤 Step 6: Sending withdrawal transaction...';
    console.log(stepLabel6);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    combinedTx.recentBlockhash = blockhash;

    // Sign transaction
    if (feePayer.publicKey.equals(lpOwner.publicKey)) {
      combinedTx.sign(lpOwner);
    } else {
      combinedTx.partialSign(lpOwner);
      combinedTx.partialSign(feePayer);
    }

    if (SIMULATE_ONLY) {
      // Simulate combined transaction
      const simulation = await connection.simulateTransaction(combinedTx);

      console.log(`  Withdrawal Transaction Simulation:`);
      if (simulation.value.err) {
        console.log(`    ❌ Error: ${JSON.stringify(simulation.value.err)}`);
        if (simulation.value.logs) {
          console.log(`    Logs:`);
          simulation.value.logs.forEach(log => console.log(`      ${log}`));
        }
      } else {
        console.log(`    ✅ Success`);
        console.log(`    Compute Units: ${simulation.value.unitsConsumed || 'N/A'}`);
      }

      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ Simulation completed successfully!');
      console.log('\n📊 Summary:');
      console.log(`  Pool: ${poolAddress.toBase58()}`);
      console.log(`  Positions Found: ${userPositions.length}`);
      console.log(`  Token A Mint: ${poolState.tokenAMint.toBase58()}`);
      console.log(`  Token B Mint: ${poolState.tokenBMint.toBase58()}`);
      console.log(`\n  💧 Tokens Withdrawn and Transferred to ${managerWallet.toBase58()}:`);
      console.log(`    Token A: ${tokenAUiAmount.toFixed(6)} (${withdrawQuote.outAmountA.toString()} raw)`);
      console.log(`    Token B: ${tokenBUiAmount.toFixed(6)} ${isTokenBNativeSOL ? 'SOL' : ''} (${withdrawQuote.outAmountB.toString()} ${isTokenBNativeSOL ? 'lamports - as native SOL' : 'raw'})`);
      console.log(`\n  📊 Liquidity Details:`);
      console.log(`    Total Liquidity: ${totalLiquidity.toString()}`);
      console.log(`    Liquidity Withdrawn (${withdrawalPercentage}%): ${liquidityDelta.toString()}`);
      console.log(`    Remaining Liquidity: ${totalLiquidity.sub(liquidityDelta).toString()}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } else {
      // Send combined transaction
      const signature = await connection.sendRawTransaction(combinedTx.serialize());
      console.log(`  Withdrawal TX: ${signature}`);
      console.log(`  Solscan: https://solscan.io/tx/${signature}`);

      // Wait for confirmation
      console.log('  Waiting for confirmation...');
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      });
      console.log('  ✅ Transaction confirmed');
      console.log('');

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ Test completed successfully!');
      console.log(`\nTransaction: https://solscan.io/tx/${signature}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testDammWithdraw();
