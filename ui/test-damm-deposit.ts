/*
 * Combinator - Meteora DAMM v2 Liquidity Deposit Test Script
 *
 * This script receives tokens from a manager wallet and deposits as much
 * liquidity as possible into a Meteora DAMM v2 pool position.
 *
 * Required ENV variables:
 * - RPC_URL: Solana RPC endpoint
 * - LIQUIDITY_POOL_ADDRESS: Meteora DAMM v2 pool address for liquidity management
 * - LP_OWNER_PRIVATE_KEY: Private key of wallet that owns the LP position (Base58)
 * - MANAGER_PRIVATE_KEY: Private key of manager wallet that will send tokens
 * - TOKEN_A_AMOUNT: Amount of Token A to send (in UI units, e.g., "1.5")
 * - TOKEN_B_AMOUNT: Amount of Token B to send (in UI units, e.g., "0.05")
 * - PAYER_PRIVATE_KEY: (Optional) Private key for fee payer, defaults to manager
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

async function testDammDeposit() {
  try {
    console.log('\n🧪 Meteora DAMM v2 Liquidity Deposit Test Script');
    console.log(`Mode: ${SIMULATE_ONLY ? '🔍 SIMULATION ONLY' : '⚡ LIVE EXECUTION'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    const LIQUIDITY_POOL_ADDRESS = process.env.LIQUIDITY_POOL_ADDRESS;
    const LP_OWNER_PRIVATE_KEY = process.env.LP_OWNER_PRIVATE_KEY || process.env.DAO_PRIVATE_KEY;
    const MANAGER_PRIVATE_KEY = process.env.MANAGER_PRIVATE_KEY || process.env.PAYER_PRIVATE_KEY;
    const TOKEN_A_AMOUNT = "3200000";
    const TOKEN_B_AMOUNT = "5.6";
    const FEE_PAYER_PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY || process.env.MANAGER_PRIVATE_KEY;

    if (!RPC_URL) {
      throw new Error('RPC_URL not set in environment');
    }
    if (!LIQUIDITY_POOL_ADDRESS) {
      throw new Error('LIQUIDITY_POOL_ADDRESS not set in environment');
    }
    if (!LP_OWNER_PRIVATE_KEY) {
      throw new Error('LP_OWNER_PRIVATE_KEY not set in environment');
    }
    if (!MANAGER_PRIVATE_KEY) {
      throw new Error('MANAGER_PRIVATE_KEY not set in environment');
    }
    if (!TOKEN_A_AMOUNT || !TOKEN_B_AMOUNT) {
      throw new Error('TOKEN_A_AMOUNT and TOKEN_B_AMOUNT must be set in environment');
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const manager = Keypair.fromSecretKey(bs58.decode(MANAGER_PRIVATE_KEY));
    const feePayer = FEE_PAYER_PRIVATE_KEY
      ? Keypair.fromSecretKey(bs58.decode(FEE_PAYER_PRIVATE_KEY))
      : manager;
    const poolAddress = new PublicKey(LIQUIDITY_POOL_ADDRESS);

    console.log('Configuration:');
    console.log(`  Pool:             ${poolAddress.toBase58()}`);
    console.log(`  LP Owner:         ${lpOwner.publicKey.toBase58()}`);
    console.log(`  Manager Wallet:   ${manager.publicKey.toBase58()}`);
    console.log(`  Fee Payer:        ${feePayer.publicKey.toBase58()}`);
    console.log('');

    // Step 1: Load DAMM pool
    console.log('📊 Step 1: Loading DAMM pool...');
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(poolAddress);

    // Get token mints to check decimals
    const tokenAMint = await getMint(connection, poolState.tokenAMint);
    const tokenBMint = await getMint(connection, poolState.tokenBMint);
    const tokenAProgram = getTokenProgram(tokenAMint.tlvData.length > 0 ? 1 : 0);
    const tokenBProgram = getTokenProgram(tokenBMint.tlvData.length > 0 ? 1 : 0);

    console.log(`  Token A Mint: ${poolState.tokenAMint.toBase58()}`);
    console.log(`  Token A Decimals: ${tokenAMint.decimals}`);
    console.log(`  Token B Mint: ${poolState.tokenBMint.toBase58()}`);
    console.log(`  Token B Decimals: ${tokenBMint.decimals}`);
    console.log(`  Token A Vault: ${poolState.tokenAVault.toBase58()}`);
    console.log(`  Token B Vault: ${poolState.tokenBVault.toBase58()}`);
    console.log('');

    // Check if Token B is native SOL
    const isTokenBNativeSOL = poolState.tokenBMint.equals(NATIVE_MINT);
    console.log(`  Token B is ${isTokenBNativeSOL ? 'native SOL' : 'SPL token'}`);
    console.log('');

    // Parse token amounts
    const tokenAAmountUi = parseFloat(TOKEN_A_AMOUNT);
    const tokenBAmountUi = parseFloat(TOKEN_B_AMOUNT);
    const tokenAAmountRaw = new BN(Math.floor(tokenAAmountUi * Math.pow(10, tokenAMint.decimals)));
    const tokenBAmountRaw = new BN(Math.floor(tokenBAmountUi * Math.pow(10, tokenBMint.decimals)));

    console.log(`💵 Step 2: Token amounts to transfer:`);
    console.log(`  Token A: ${tokenAAmountUi} (${tokenAAmountRaw.toString()} raw)`);
    console.log(`  Token B: ${tokenBAmountUi} ${isTokenBNativeSOL ? 'SOL' : ''} (${tokenBAmountRaw.toString()} ${isTokenBNativeSOL ? 'lamports' : 'raw'})`);
    console.log('');

    // Step 3: Get user positions
    console.log('🔍 Step 3: Getting user positions...');
    const userPositions = await cpAmm.getUserPositionByPool(poolAddress, lpOwner.publicKey);

    if (userPositions.length === 0) {
      console.log('  ⚠️  No positions found for this owner in this pool');
      console.log('  Note: You need an existing position to add liquidity. Create one first.');
      return;
    }

    const { position, positionNftAccount, positionState } = userPositions[0];
    console.log(`  Found ${userPositions.length} position(s)`);
    console.log(`  Using Position: ${position.toBase58()}`);
    console.log(`  Current Liquidity: ${positionState.unlockedLiquidity.toString()}`);
    console.log('');

    // Step 4: Calculate liquidity delta from our token amounts
    console.log('💱 Step 4: Calculating liquidity to add from token amounts...');

    const currentEpoch = await connection.getEpochInfo().then(e => e.epoch);

    // Use getLiquidityDelta to calculate the liquidity for BOTH tokens at once
    const liquidityDelta = cpAmm.getLiquidityDelta({
      maxAmountTokenA: tokenAAmountRaw,
      maxAmountTokenB: tokenBAmountRaw,
      sqrtPrice: poolState.sqrtPrice,
      sqrtMinPrice: poolState.sqrtMinPrice,
      sqrtMaxPrice: poolState.sqrtMaxPrice,
      tokenAInfo: {
        mint: tokenAMint,
        currentEpoch
      },
      tokenBInfo: {
        mint: tokenBMint,
        currentEpoch
      }
    });

    console.log(`  Input amounts:`);
    console.log(`    Token A: ${tokenAAmountUi} (${tokenAAmountRaw.toString()} raw)`);
    console.log(`    Token B: ${tokenBAmountUi} (${tokenBAmountRaw.toString()} raw)`);
    console.log(`  Calculated liquidity delta: ${liquidityDelta.toString()}`);
    console.log('');

    // Step 5: Build combined transfer and deposit transaction
    console.log('🔨 Step 5: Building combined transfer and deposit transaction...');

    // Get ATAs
    const managerTokenAAta = await getAssociatedTokenAddress(
      poolState.tokenAMint,
      manager.publicKey,
      false,
      tokenAProgram
    );
    const managerTokenBAta = isTokenBNativeSOL ? manager.publicKey : await getAssociatedTokenAddress(
      poolState.tokenBMint,
      manager.publicKey,
      false,
      tokenBProgram
    );

    const lpOwnerTokenAAta = await getAssociatedTokenAddress(
      poolState.tokenAMint,
      lpOwner.publicKey,
      false,
      tokenAProgram
    );
    const lpOwnerTokenBAta = isTokenBNativeSOL ? lpOwner.publicKey : await getAssociatedTokenAddress(
      poolState.tokenBMint,
      lpOwner.publicKey,
      false,
      tokenBProgram
    );

    // Build combined transaction
    const combinedTx = new Transaction();
    combinedTx.feePayer = feePayer.publicKey;

    // Step 1: Create LP owner's ATAs (idempotent)
    combinedTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        feePayer.publicKey,
        lpOwnerTokenAAta,
        lpOwner.publicKey,
        poolState.tokenAMint,
        tokenAProgram
      )
    );

    // Only create Token B ATA if it's NOT native SOL (Meteora handles WSOL wrapping)
    if (!isTokenBNativeSOL) {
      combinedTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          feePayer.publicKey,
          lpOwnerTokenBAta,
          lpOwner.publicKey,
          poolState.tokenBMint,
          tokenBProgram
        )
      );
    }

    // Step 2: Transfer Token A from manager to LP owner
    if (!tokenAAmountRaw.isZero()) {
      combinedTx.add(
        createTransferInstruction(
          managerTokenAAta,
          lpOwnerTokenAAta,
          manager.publicKey,
          BigInt(tokenAAmountRaw.toString()),
          [],
          tokenAProgram
        )
      );
    }

    // Step 3: Transfer Token B from manager to LP owner
    if (!tokenBAmountRaw.isZero()) {
      if (isTokenBNativeSOL) {
        // Transfer native SOL from manager to LP owner
        // The SDK's addLiquidity will then wrap it automatically
        console.log(`  Adding native SOL transfer of ${tokenBAmountUi} SOL from manager to LP owner`);
        console.log(`  (SDK will wrap it during addLiquidity)`);
        combinedTx.add(
          SystemProgram.transfer({
            fromPubkey: manager.publicKey,
            toPubkey: lpOwner.publicKey,
            lamports: Number(tokenBAmountRaw.toString())
          })
        );
      } else {
        // Transfer SPL token
        combinedTx.add(
          createTransferInstruction(
            managerTokenBAta,
            lpOwnerTokenBAta,
            manager.publicKey,
            BigInt(tokenBAmountRaw.toString()),
            [],
            tokenBProgram
          )
        );
      }
    }

    // Step 4: Add liquidity to position
    // For SDK: maxAmount parameters tell it how much SOL to wrap
    const maxAmountTokenA = tokenAAmountRaw;
    const maxAmountTokenB = tokenBAmountRaw;

    // For on-chain instruction: threshold parameters are the MAXIMUM you're willing to spend
    // Set them to what we have available
    const tokenAAmountThreshold = tokenAAmountRaw;
    const tokenBAmountThreshold = tokenBAmountRaw;

    console.log(`  Setting deposit parameters:`);
    console.log(`    Liquidity Delta: ${liquidityDelta.toString()}`);
    console.log(`    Max Token A (for SDK): ${Number(maxAmountTokenA.toString()) / Math.pow(10, tokenAMint.decimals)} (${maxAmountTokenA.toString()} raw)`);
    console.log(`    Max Token B (for SDK): ${Number(maxAmountTokenB.toString()) / Math.pow(10, tokenBMint.decimals)} (${maxAmountTokenB.toString()} raw)`);
    console.log(`    Threshold Token A (max to spend): ${Number(tokenAAmountThreshold.toString()) / Math.pow(10, tokenAMint.decimals)} (${tokenAAmountThreshold.toString()} raw)`);
    console.log(`    Threshold Token B (max to spend): ${Number(tokenBAmountThreshold.toString()) / Math.pow(10, tokenBMint.decimals)} (${tokenBAmountThreshold.toString()} raw)`);
    console.log('');

    const addLiquidityTx = await cpAmm.addLiquidity({
      owner: lpOwner.publicKey,
      position,
      pool: poolAddress,
      positionNftAccount,
      liquidityDelta,
      maxAmountTokenA,
      maxAmountTokenB,
      tokenAAmountThreshold,
      tokenBAmountThreshold,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAProgram,
      tokenBProgram,
    });

    combinedTx.add(...addLiquidityTx.instructions);

    console.log(`  Combined transaction has ${combinedTx.instructions.length} instruction(s)`);
    console.log('');

    // Step 6: Simulate/Execute combined transaction
    const stepLabel6 = SIMULATE_ONLY ? '🔍 Step 6: Simulating deposit transaction...' : '📤 Step 6: Sending deposit transaction...';
    console.log(stepLabel6);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    combinedTx.recentBlockhash = blockhash;

    // Sign transaction
    // For SOL deposits, only LP owner needs to sign (SDK wraps from their balance)
    // For SPL tokens, manager also needs to sign the transfer
    const needsManagerSignature = !tokenAAmountRaw.isZero() || (!isTokenBNativeSOL && !tokenBAmountRaw.isZero());

    if (feePayer.publicKey.equals(lpOwner.publicKey) && !needsManagerSignature) {
      combinedTx.sign(lpOwner);
    } else if (feePayer.publicKey.equals(manager.publicKey) && feePayer.publicKey.equals(lpOwner.publicKey)) {
      combinedTx.sign(manager);
    } else if (needsManagerSignature) {
      if (feePayer.publicKey.equals(manager.publicKey)) {
        combinedTx.partialSign(manager);
        combinedTx.partialSign(lpOwner);
      } else if (feePayer.publicKey.equals(lpOwner.publicKey)) {
        combinedTx.partialSign(manager);
        combinedTx.partialSign(lpOwner);
      } else {
        combinedTx.partialSign(manager);
        combinedTx.partialSign(lpOwner);
        combinedTx.partialSign(feePayer);
      }
    } else {
      // Only LP owner and fee payer need to sign
      if (feePayer.publicKey.equals(lpOwner.publicKey)) {
        combinedTx.sign(lpOwner);
      } else {
        combinedTx.partialSign(lpOwner);
        combinedTx.partialSign(feePayer);
      }
    }

    if (SIMULATE_ONLY) {
      // Simulate combined transaction
      const simulation = await connection.simulateTransaction(combinedTx);

      console.log(`  Deposit Transaction Simulation:`);
      if (simulation.value.err) {
        console.log(`    ❌ Error: ${JSON.stringify(simulation.value.err)}`);
        if (simulation.value.logs) {
          console.log(`    Logs:`);
          simulation.value.logs.forEach(log => console.log(`      ${log}`));
        }
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('❌ Simulation failed!');
        console.log('   Please review the error logs above.');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        process.exit(1);
      } else {
        console.log(`    ✅ Success`);
        console.log(`    Compute Units: ${simulation.value.unitsConsumed || 'N/A'}`);
      }

      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ Simulation completed successfully!');
      console.log('\n📊 Summary:');
      console.log(`  Pool: ${poolAddress.toBase58()}`);
      console.log(`  Position: ${position.toBase58()}`);
      console.log(`  Token A Mint: ${poolState.tokenAMint.toBase58()}`);
      console.log(`  Token B Mint: ${poolState.tokenBMint.toBase58()}`);
      console.log(`\n  💸 Tokens Transferred from Manager (${manager.publicKey.toBase58()}):`);
      console.log(`    Token A: ${tokenAAmountUi} (${tokenAAmountRaw.toString()} raw)`);
      console.log(`    Token B: ${tokenBAmountUi} ${isTokenBNativeSOL ? 'SOL' : ''} (${tokenBAmountRaw.toString()} ${isTokenBNativeSOL ? 'lamports' : 'raw'})`);
      console.log(`\n  💧 Liquidity Added:`);
      console.log(`    Liquidity Delta: ${liquidityDelta.toString()}`);
      console.log(`\n  Note: Actual token amounts used will be determined by the pool based on current price.`);
      console.log(`  Any leftover tokens will remain with the LP Owner.`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } else {
      // Send combined transaction
      const signature = await connection.sendRawTransaction(combinedTx.serialize());
      console.log(`  Deposit TX: ${signature}`);
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
testDammDeposit();
