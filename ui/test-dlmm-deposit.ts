/*
 * Combinator - Meteora DLMM Liquidity Deposit Test Script
 *
 * This script tests depositing liquidity into a Meteora DLMM
 * (Dynamic Liquidity Market Maker) pool position. It mirrors the production flow:
 * 1. Manager wallet transfers tokens to LP owner (if different wallets)
 * 2. LP owner deposits into the DLMM pool
 *
 * Required ENV variables:
 * - RPC_URL: Solana RPC endpoint
 * - DLMM_POOL_ADDRESS: Meteora DLMM pool address for liquidity management
 * - LP_OWNER_PRIVATE_KEY: Private key of wallet that owns/will own the LP position (Base58)
 * - MANAGER_PRIVATE_KEY: Private key of manager wallet that holds the tokens to deposit
 * - PAYER_PRIVATE_KEY: (Optional) Private key for fee payer, defaults to LP owner
 *
 * Optional ENV variables:
 * - DEPOSIT_TOKEN_X_AMOUNT: Amount of Token X to deposit (in UI units, e.g., "1000.5")
 * - DEPOSIT_TOKEN_Y_AMOUNT: Amount of Token Y to deposit (in UI units, e.g., "0.5")
 */

import dotenv from 'dotenv';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import bs58 from 'bs58';
import { getMint, getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, createTransferInstruction, NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';

dotenv.config();

// Set to true to simulate transactions without executing them
const SIMULATE_ONLY = true;

// Deposit amounts (in UI units - will be converted to raw amounts. NO COMMAS)
const DEPOSIT_TOKEN_X_AMOUNT = '72589.941374'; // Default 1000 Token X
const DEPOSIT_TOKEN_Y_AMOUNT = '0.33694114'; // Default 0.01 Token Y (SOL)

async function testDlmmDeposit() {
  try {
    console.log('\n🧪 Meteora DLMM Liquidity Deposit Test Script');
    console.log(`Mode: ${SIMULATE_ONLY ? '🔍 SIMULATION ONLY' : '⚡ LIVE EXECUTION'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    const DLMM_POOL_ADDRESS = process.env.DLMM_POOL_ADDRESS;
    const LP_OWNER_PRIVATE_KEY = process.env.NEW_LP_OWNER_PRIVATE_KEY;
    const MANAGER_PRIVATE_KEY = process.env.NEW_LP_OWNER_PRIVATE_KEY;
    const FEE_PAYER_PRIVATE_KEY = LP_OWNER_PRIVATE_KEY;

    if (!RPC_URL) {
      throw new Error('RPC_URL not set in environment');
    }
    if (!DLMM_POOL_ADDRESS) {
      throw new Error('DLMM_POOL_ADDRESS not set in environment');
    }
    if (!LP_OWNER_PRIVATE_KEY) {
      throw new Error('LP_OWNER_PRIVATE_KEY not set in environment');
    }
    if (!MANAGER_PRIVATE_KEY) {
      throw new Error('MANAGER_PRIVATE_KEY not set in environment');
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const manager = Keypair.fromSecretKey(bs58.decode(MANAGER_PRIVATE_KEY));
    const feePayer = FEE_PAYER_PRIVATE_KEY
      ? Keypair.fromSecretKey(bs58.decode(FEE_PAYER_PRIVATE_KEY))
      : lpOwner;
    const poolAddress = new PublicKey(DLMM_POOL_ADDRESS);

    // Check if LP owner and manager are the same wallet
    const isSameWallet = lpOwner.publicKey.equals(manager.publicKey);

    console.log('Configuration:');
    console.log(`  Pool:             ${poolAddress.toBase58()}`);
    console.log(`  LP Owner:         ${lpOwner.publicKey.toBase58()}`);
    console.log(`  Manager Wallet:   ${manager.publicKey.toBase58()}`);
    console.log(`  Fee Payer:        ${feePayer.publicKey.toBase58()}`);
    console.log(`  Same Wallet:      ${isSameWallet ? 'Yes (skipping transfers)' : 'No'}`);
    console.log(`  Deposit X:        ${DEPOSIT_TOKEN_X_AMOUNT}`);
    console.log(`  Deposit Y:        ${DEPOSIT_TOKEN_Y_AMOUNT}`);
    console.log('');

    // Step 1: Create DLMM instance
    console.log('📊 Step 1: Loading DLMM pool...');
    const dlmmPool = await DLMM.create(connection, poolAddress);
    const lbPair = dlmmPool.lbPair;

    const tokenXMint = lbPair.tokenXMint;
    const tokenYMint = lbPair.tokenYMint;
    const binStep = lbPair.binStep;
    const activeId = lbPair.activeId;

    console.log(`  Token X Mint: ${tokenXMint.toBase58()}`);
    console.log(`  Token Y Mint: ${tokenYMint.toBase58()}`);
    console.log(`  Bin Step: ${binStep} bps (${(binStep / 100).toFixed(2)}%)`);
    console.log(`  Active Bin ID: ${activeId}`);
    console.log('');

    // Step 2: Get token mint info and calculate raw amounts
    console.log('💰 Step 2: Calculating deposit amounts...');

    const tokenXMintInfo = await getMint(connection, tokenXMint);
    const tokenYMintInfo = await getMint(connection, tokenYMint);

    const isTokenXNativeSOL = tokenXMint.equals(NATIVE_MINT);
    const isTokenYNativeSOL = tokenYMint.equals(NATIVE_MINT);

    const depositXRaw = new BN(
      Math.floor(parseFloat(DEPOSIT_TOKEN_X_AMOUNT) * Math.pow(10, tokenXMintInfo.decimals))
    );
    const depositYRaw = new BN(
      Math.floor(parseFloat(DEPOSIT_TOKEN_Y_AMOUNT) * Math.pow(10, tokenYMintInfo.decimals))
    );

    console.log(`  Token X Decimals: ${tokenXMintInfo.decimals}`);
    console.log(`  Token Y Decimals: ${tokenYMintInfo.decimals}`);
    console.log(`  Token X is ${isTokenXNativeSOL ? 'native SOL' : 'SPL token'}`);
    console.log(`  Token Y is ${isTokenYNativeSOL ? 'native SOL' : 'SPL token'}`);
    console.log(`  Deposit X Amount: ${DEPOSIT_TOKEN_X_AMOUNT} (${depositXRaw.toString()} raw)`);
    console.log(`  Deposit Y Amount: ${DEPOSIT_TOKEN_Y_AMOUNT} ${isTokenYNativeSOL ? 'SOL' : ''} (${depositYRaw.toString()} raw)`);
    console.log('');

    // Step 3: Check for existing positions
    console.log('🔍 Step 3: Checking for existing positions...');

    const { userPositions, activeBin } = await dlmmPool.getPositionsByUserAndLbPair(lpOwner.publicKey);

    console.log(`  Active Bin Price: ${activeBin.price}`);
    console.log(`  Found ${userPositions.length} existing position(s)`);

    let existingPosition = null;
    if (userPositions.length > 0) {
      existingPosition = userPositions[0];
      const posData = existingPosition.positionData;
      console.log(`  Using existing position: ${existingPosition.publicKey.toBase58()}`);
      console.log(`    Lower Bin ID: ${posData.lowerBinId}`);
      console.log(`    Upper Bin ID: ${posData.upperBinId}`);
      console.log(`    Current X Amount: ${posData.totalXAmount}`);
      console.log(`    Current Y Amount: ${posData.totalYAmount}`);
    } else {
      console.log('  No existing position found - will create new position');
    }
    console.log('');

    // Step 4: Build transactions (keep SDK transactions separate)
    console.log('🔨 Step 4: Building deposit transactions...');

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const allTransactions: Transaction[] = [];

    // Get ATAs
    const lpOwnerTokenXAta = await getAssociatedTokenAddress(tokenXMint, lpOwner.publicKey);
    const lpOwnerTokenYAta = await getAssociatedTokenAddress(tokenYMint, lpOwner.publicKey);
    const managerTokenXAta = await getAssociatedTokenAddress(tokenXMint, manager.publicKey);
    const managerTokenYAta = await getAssociatedTokenAddress(tokenYMint, manager.publicKey);

    // Build transfer transaction (only if manager and LP owner are different)
    if (!isSameWallet) {
      const transferTx = new Transaction();
      transferTx.recentBlockhash = blockhash;
      transferTx.feePayer = feePayer.publicKey;

      // Create LP owner ATAs if needed
      transferTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          feePayer.publicKey,
          lpOwnerTokenXAta,
          lpOwner.publicKey,
          tokenXMint
        )
      );
      transferTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          feePayer.publicKey,
          lpOwnerTokenYAta,
          lpOwner.publicKey,
          tokenYMint
        )
      );

      // Transfer Token X from manager to LP owner
      if (!depositXRaw.isZero()) {
        if (isTokenXNativeSOL) {
          console.log(`  Transferring ${DEPOSIT_TOKEN_X_AMOUNT} SOL from manager to LP owner (Token X)...`);
          transferTx.add(
            SystemProgram.transfer({
              fromPubkey: manager.publicKey,
              toPubkey: lpOwnerTokenXAta,
              lamports: depositXRaw.toNumber()
            }),
            createSyncNativeInstruction(lpOwnerTokenXAta)
          );
        } else {
          console.log(`  Transferring ${DEPOSIT_TOKEN_X_AMOUNT} Token X from manager to LP owner...`);
          transferTx.add(
            createTransferInstruction(
              managerTokenXAta,
              lpOwnerTokenXAta,
              manager.publicKey,
              BigInt(depositXRaw.toString())
            )
          );
        }
      }

      // Transfer Token Y from manager to LP owner
      if (!depositYRaw.isZero()) {
        if (isTokenYNativeSOL) {
          console.log(`  Transferring ${DEPOSIT_TOKEN_Y_AMOUNT} SOL from manager to LP owner (Token Y)...`);
          transferTx.add(
            SystemProgram.transfer({
              fromPubkey: manager.publicKey,
              toPubkey: lpOwnerTokenYAta,
              lamports: depositYRaw.toNumber()
            }),
            createSyncNativeInstruction(lpOwnerTokenYAta)
          );
        } else {
          console.log(`  Transferring ${DEPOSIT_TOKEN_Y_AMOUNT} Token Y from manager to LP owner...`);
          transferTx.add(
            createTransferInstruction(
              managerTokenYAta,
              lpOwnerTokenYAta,
              manager.publicKey,
              BigInt(depositYRaw.toString())
            )
          );
        }
      }

      allTransactions.push(transferTx);
      console.log('  Built transfer transaction');
    } else {
      console.log('  Skipping transfer (same wallet)');
    }

    // Define position range (bins around active bin)
    const binRange = 34; // Number of bins on each side of active bin
    const minBinId = activeId - binRange;
    const maxBinId = activeId + binRange;

    // Track new position keypair if creating new position
    let newPositionKeypair: Keypair | null = null;

    // Create position and add liquidity
    if (existingPosition) {
      // Add to existing position
      console.log('  Adding liquidity to existing position...');
      const binCount = existingPosition.positionData.upperBinId - existingPosition.positionData.lowerBinId + 1;
      console.log(`  Position bin range: ${existingPosition.positionData.lowerBinId} to ${existingPosition.positionData.upperBinId} (${binCount} bins)`);

      // Use addLiquidityByStrategyChunkable for wide bin ranges to avoid OOM errors
      const addLiquidityTxs = await dlmmPool.addLiquidityByStrategyChunkable({
        positionPubKey: existingPosition.publicKey,
        user: lpOwner.publicKey,
        totalXAmount: depositXRaw,
        totalYAmount: depositYRaw,
        strategy: {
          maxBinId: existingPosition.positionData.upperBinId,
          minBinId: existingPosition.positionData.lowerBinId,
          strategyType: 0, // Spot strategy
        },
        slippage: 100, // 1% slippage
      });

      // Keep each SDK transaction separate (don't combine!)
      for (const tx of addLiquidityTxs) {
        const depositTx = new Transaction();
        depositTx.add(...tx.instructions);
        depositTx.recentBlockhash = blockhash;
        depositTx.feePayer = feePayer.publicKey;
        allTransactions.push(depositTx);
      }
      console.log(`  Built ${addLiquidityTxs.length} liquidity transaction(s)`);
    } else {
      // Create new position
      console.log('  Creating new position with liquidity...');
      console.log(`  Position range: Bin ${minBinId} to ${maxBinId} (${binRange * 2 + 1} bins)`);

      newPositionKeypair = Keypair.generate();
      console.log(`  New position address: ${newPositionKeypair.publicKey.toBase58()}`);

      const createPositionTxs = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newPositionKeypair.publicKey,
        user: lpOwner.publicKey,
        totalXAmount: depositXRaw,
        totalYAmount: depositYRaw,
        strategy: {
          maxBinId,
          minBinId,
          strategyType: 0, // Spot strategy
        },
        slippage: 100, // 1% slippage
      });

      // Keep each SDK transaction separate (don't combine!)
      const txArray = Array.isArray(createPositionTxs) ? createPositionTxs : [createPositionTxs];
      for (const tx of txArray) {
        const depositTx = new Transaction();
        depositTx.add(...tx.instructions);
        depositTx.recentBlockhash = blockhash;
        depositTx.feePayer = feePayer.publicKey;
        allTransactions.push(depositTx);
      }
      console.log(`  Built ${txArray.length} position creation transaction(s)`);
    }

    console.log(`  Total transactions: ${allTransactions.length}${!isSameWallet ? ` (1 transfer + ${allTransactions.length - 1} liquidity)` : ''}`);
    console.log('');

    // Step 5: Sign all transactions
    console.log('🔏 Step 5: Signing transactions...');

    for (let i = 0; i < allTransactions.length; i++) {
      const tx = allTransactions[i];
      const isTransferTx = !isSameWallet && i === 0;

      if (isTransferTx) {
        // Transfer tx needs manager signature
        tx.partialSign(manager);
        if (!feePayer.publicKey.equals(manager.publicKey)) {
          tx.partialSign(feePayer);
        }
      } else {
        // Liquidity txs need LP owner signature
        tx.partialSign(lpOwner);
        if (!feePayer.publicKey.equals(lpOwner.publicKey)) {
          tx.partialSign(feePayer);
        }
        // New position needs position keypair signature
        if (newPositionKeypair) {
          tx.partialSign(newPositionKeypair);
        }
      }
    }
    console.log(`  Signed ${allTransactions.length} transaction(s)`);
    console.log('');

    // Step 6: Simulate/Execute transactions
    const stepLabel = SIMULATE_ONLY ? '🔍 Step 6: Simulating deposit transactions...' : '📤 Step 6: Sending deposit transactions...';
    console.log(stepLabel);

    if (SIMULATE_ONLY) {
      // Simulate all transactions
      for (let i = 0; i < allTransactions.length; i++) {
        const simulation = await connection.simulateTransaction(allTransactions[i]);

        console.log(`  Transaction ${i + 1}/${allTransactions.length} Simulation:`);
        if (simulation.value.err) {
          console.log(`    ❌ Error: ${JSON.stringify(simulation.value.err)}`);
          if (simulation.value.logs) {
            console.log(`    Logs:`);
            simulation.value.logs.forEach(log => console.log(`      ${log}`));
          }
          console.log('');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('❌ Simulation failed!');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          process.exit(1);
        } else {
          console.log(`    ✅ Success`);
          console.log(`    Compute Units: ${simulation.value.unitsConsumed || 'N/A'}`);
        }
      }

      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ Simulation completed successfully!');
      console.log('\n📊 Summary:');
      console.log(`  Pool: ${poolAddress.toBase58()}`);
      console.log(`  Pool Type: DLMM (Bin Step: ${binStep} bps)`);
      console.log(`  Token X Mint: ${tokenXMint.toBase58()}`);
      console.log(`  Token Y Mint: ${tokenYMint.toBase58()}`);
      console.log(`  Transactions: ${allTransactions.length}`);
      console.log(`\n  💧 Tokens to Deposit${!isSameWallet ? ` (from manager ${manager.publicKey.toBase58()})` : ''}:`);
      console.log(`    Token X: ${DEPOSIT_TOKEN_X_AMOUNT} (${depositXRaw.toString()} raw)`);
      console.log(`    Token Y: ${DEPOSIT_TOKEN_Y_AMOUNT} ${isTokenYNativeSOL ? 'SOL' : ''} (${depositYRaw.toString()} raw)`);
      if (existingPosition) {
        console.log(`\n  📍 Adding to existing position: ${existingPosition.publicKey.toBase58()}`);
      } else {
        console.log(`\n  📍 Creating new position: ${newPositionKeypair?.publicKey.toBase58()}`);
        console.log(`     Range: Bin ${minBinId} to ${maxBinId}`);
      }
      console.log('\n⚠️  To execute for real, set SIMULATE_ONLY=false');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } else {
      // Send all transactions sequentially
      const signatures: string[] = [];

      for (let i = 0; i < allTransactions.length; i++) {
        console.log(`  Sending transaction ${i + 1}/${allTransactions.length}...`);
        const signature = await connection.sendRawTransaction(allTransactions[i].serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        });
        signatures.push(signature);
        console.log(`    TX: ${signature}`);
        console.log(`    Solscan: https://solscan.io/tx/${signature}`);

        // Wait for confirmation before sending next
        console.log('    Waiting for confirmation...');
        await connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight
        });
        console.log('    ✅ Confirmed');
      }

      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ Deposit completed successfully!');
      console.log('\nTransactions:');
      signatures.forEach((sig, i) => {
        console.log(`  ${i + 1}. https://solscan.io/tx/${sig}`);
      });
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
testDlmmDeposit();
