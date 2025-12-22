/*
 * Z Combinator - Meteora DLMM Liquidity Withdrawal Test Script
 *
 * This script tests withdrawing a percentage of liquidity from a Meteora DLMM
 * (Dynamic Liquidity Market Maker) pool position and transferring it to a manager wallet.
 *
 * Required ENV variables:
 * - RPC_URL: Solana RPC endpoint
 * - DLMM_POOL_ADDRESS: Meteora DLMM pool address for liquidity management
 * - LP_OWNER_PRIVATE_KEY: Private key of wallet that owns the LP position (Base58)
 * - MANAGER_WALLET: Destination address to send withdrawn tokens to
 * - PAYER_PRIVATE_KEY: (Optional) Private key for fee payer, defaults to LP owner
 */

import dotenv from 'dotenv';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import bs58 from 'bs58';
import { getMint, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddress, createTransferInstruction, NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';

dotenv.config();

// Set to true to simulate transactions without executing them
const SIMULATE_ONLY = false;

// Withdrawal percentage (in %)
const WITHDRAWAL_PERCENTAGE = 12.5;

async function testDlmmWithdraw() {
  try {
    console.log('\n🧪 Meteora DLMM Liquidity Withdrawal Test Script');
    console.log(`Mode: ${SIMULATE_ONLY ? '🔍 SIMULATION ONLY' : '⚡ LIVE EXECUTION'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    const DLMM_POOL_ADDRESS = process.env.DLMM_POOL_ADDRESS;
    const LP_OWNER_PRIVATE_KEY = process.env.LP_OWNER_PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;
    const MANAGER_WALLET = process.env.MANAGER_WALLET;
    const FEE_PAYER_PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY || LP_OWNER_PRIVATE_KEY;

    if (!RPC_URL) {
      throw new Error('RPC_URL not set in environment');
    }
    if (!DLMM_POOL_ADDRESS) {
      throw new Error('DLMM_POOL_ADDRESS not set in environment');
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
    const poolAddress = new PublicKey(DLMM_POOL_ADDRESS);
    const managerWallet = new PublicKey(MANAGER_WALLET);

    console.log('Configuration:');
    console.log(`  Pool:             ${poolAddress.toBase58()}`);
    console.log(`  LP Owner:         ${lpOwner.publicKey.toBase58()}`);
    console.log(`  Fee Payer:        ${feePayer.publicKey.toBase58()}`);
    console.log(`  Manager Wallet:   ${managerWallet.toBase58()}`);
    console.log(`  Withdrawal %:     ${WITHDRAWAL_PERCENTAGE}%`);
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

    // Step 2: Get user positions
    console.log('💰 Step 2: Getting user positions...');

    const { userPositions, activeBin } = await dlmmPool.getPositionsByUserAndLbPair(lpOwner.publicKey);

    if (userPositions.length === 0) {
      console.log('  ⚠️  No positions found for this owner in this pool');
      return;
    }

    console.log(`  Found ${userPositions.length} position(s)`);
    console.log(`  Active Bin Price: ${activeBin.price}`);

    // Display position details
    for (let i = 0; i < userPositions.length; i++) {
      const pos = userPositions[i];
      const posData = pos.positionData;

      console.log(`\n  Position ${i + 1}:`);
      console.log(`    Address: ${pos.publicKey.toBase58()}`);
      console.log(`    Lower Bin ID: ${posData.lowerBinId}`);
      console.log(`    Upper Bin ID: ${posData.upperBinId}`);
      console.log(`    Total X Amount: ${posData.totalXAmount}`);
      console.log(`    Total Y Amount: ${posData.totalYAmount}`);
      console.log(`    Fee X: ${posData.feeX.toString()}`);
      console.log(`    Fee Y: ${posData.feeY.toString()}`);
    }
    console.log('');

    // Use first position
    const position = userPositions[0];
    const positionData = position.positionData;

    // Step 3: Calculate withdrawal amount
    console.log(`📐 Step 3: Calculating ${WITHDRAWAL_PERCENTAGE}% withdrawal amount...`);

    const totalXAmount = new BN(positionData.totalXAmount);
    const totalYAmount = new BN(positionData.totalYAmount);

    if (totalXAmount.isZero() && totalYAmount.isZero()) {
      console.log('  ⚠️  No liquidity in position');
      return;
    }

    // Convert percentage to basis points (12.5% = 1250 bps)
    const withdrawalBps = Math.floor(WITHDRAWAL_PERCENTAGE * 100);

    // Estimate withdrawal amounts
    const estimatedXWithdraw = totalXAmount.muln(withdrawalBps).divn(10000);
    const estimatedYWithdraw = totalYAmount.muln(withdrawalBps).divn(10000);

    // Get token mint info
    const tokenXMintInfo = await getMint(connection, tokenXMint);
    const tokenYMintInfo = await getMint(connection, tokenYMint);

    const isTokenXNativeSOL = tokenXMint.equals(NATIVE_MINT);
    const isTokenYNativeSOL = tokenYMint.equals(NATIVE_MINT);

    const tokenXUiAmount = Number(estimatedXWithdraw.toString()) / Math.pow(10, tokenXMintInfo.decimals);
    const tokenYUiAmount = Number(estimatedYWithdraw.toString()) / Math.pow(10, tokenYMintInfo.decimals);

    console.log(`  Total X Amount: ${positionData.totalXAmount}`);
    console.log(`  Total Y Amount: ${positionData.totalYAmount}`);
    console.log(`  Withdrawal BPS: ${withdrawalBps} (${WITHDRAWAL_PERCENTAGE}%)`);
    console.log(`  Estimated X to withdraw: ${tokenXUiAmount.toFixed(6)} (${estimatedXWithdraw.toString()} raw)`);
    console.log(`  Estimated Y to withdraw: ${tokenYUiAmount.toFixed(6)} ${isTokenYNativeSOL ? 'SOL' : ''} (${estimatedYWithdraw.toString()} raw)`);
    console.log(`  Token X is ${isTokenXNativeSOL ? 'native SOL' : 'SPL token'}`);
    console.log(`  Token Y is ${isTokenYNativeSOL ? 'native SOL' : 'SPL token'}`);
    console.log('');

    // Step 4: Build remove liquidity transaction
    console.log('🔨 Step 4: Building removal liquidity transaction...');

    const removeLiquidityTxs = await dlmmPool.removeLiquidity({
      user: lpOwner.publicKey,
      position: position.publicKey,
      fromBinId: positionData.lowerBinId,
      toBinId: positionData.upperBinId,
      bps: new BN(withdrawalBps),
      shouldClaimAndClose: false,
      skipUnwrapSOL: false,
    });

    console.log(`  Generated ${removeLiquidityTxs.length} remove liquidity transaction(s)`);
    console.log('');

    // Step 5: Build withdrawal and transfer transactions (separate to avoid size limits)
    console.log('🔨 Step 5: Building withdrawal and transfer transactions...');

    // Get ATAs
    const lpOwnerTokenXAta = await getAssociatedTokenAddress(tokenXMint, lpOwner.publicKey);
    const lpOwnerTokenYAta = await getAssociatedTokenAddress(tokenYMint, lpOwner.publicKey);
    const managerTokenXAta = await getAssociatedTokenAddress(tokenXMint, managerWallet);
    const managerTokenYAta = await getAssociatedTokenAddress(tokenYMint, managerWallet);

    // Build transfer transaction (separate from liquidity removal to avoid tx size limits)
    const transferTx = new Transaction();

    // Create manager ATAs
    transferTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        feePayer.publicKey,
        managerTokenXAta,
        managerWallet,
        tokenXMint
      )
    );

    if (!isTokenYNativeSOL) {
      transferTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          feePayer.publicKey,
          managerTokenYAta,
          managerWallet,
          tokenYMint
        )
      );
    }

    // Transfer Token X to manager
    if (!estimatedXWithdraw.isZero()) {
      if (isTokenXNativeSOL) {
        console.log(`  Adding native SOL transfer of ${tokenXUiAmount.toFixed(6)} SOL (Token X) to ${managerWallet.toBase58()}`);
        transferTx.add(
          SystemProgram.transfer({
            fromPubkey: lpOwner.publicKey,
            toPubkey: managerWallet,
            lamports: Number(estimatedXWithdraw.toString())
          })
        );
      } else {
        transferTx.add(
          createTransferInstruction(
            lpOwnerTokenXAta,
            managerTokenXAta,
            lpOwner.publicKey,
            BigInt(estimatedXWithdraw.toString())
          )
        );
      }
    }

    // Transfer Token Y to manager
    if (!estimatedYWithdraw.isZero()) {
      if (isTokenYNativeSOL) {
        console.log(`  Adding native SOL transfer of ${tokenYUiAmount.toFixed(6)} SOL (Token Y) to ${managerWallet.toBase58()}`);
        transferTx.add(
          SystemProgram.transfer({
            fromPubkey: lpOwner.publicKey,
            toPubkey: managerWallet,
            lamports: Number(estimatedYWithdraw.toString())
          })
        );
      } else {
        transferTx.add(
          createTransferInstruction(
            lpOwnerTokenYAta,
            managerTokenYAta,
            lpOwner.publicKey,
            BigInt(estimatedYWithdraw.toString())
          )
        );
      }
    }

    // Build all transactions (keep SDK transactions separate + add transfer tx at end)
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const allTransactions: Transaction[] = [];

    // Add each removal transaction from the SDK (keeps them properly chunked)
    for (const tx of removeLiquidityTxs) {
      const removeTx = new Transaction();
      removeTx.add(...tx.instructions);
      removeTx.recentBlockhash = blockhash;
      removeTx.feePayer = feePayer.publicKey;
      allTransactions.push(removeTx);
    }

    // Add the transfer transaction as the final tx
    transferTx.recentBlockhash = blockhash;
    transferTx.feePayer = feePayer.publicKey;
    allTransactions.push(transferTx);

    console.log(`  Total transactions: ${allTransactions.length} (${removeLiquidityTxs.length} removal + 1 transfer)`);
    console.log('');

    // Step 6: Simulate/Execute transactions
    const stepLabel6 = SIMULATE_ONLY ? '🔍 Step 6: Simulating withdrawal transactions...' : '📤 Step 6: Sending withdrawal transactions...';
    console.log(stepLabel6);

    // Sign all transactions
    for (const tx of allTransactions) {
      if (feePayer.publicKey.equals(lpOwner.publicKey)) {
        tx.sign(lpOwner);
      } else {
        tx.partialSign(lpOwner);
        tx.partialSign(feePayer);
      }
    }

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
      console.log(`  Positions Found: ${userPositions.length}`);
      console.log(`  Token X Mint: ${tokenXMint.toBase58()}`);
      console.log(`  Token Y Mint: ${tokenYMint.toBase58()}`);
      console.log(`  Position Range: Bin ${positionData.lowerBinId} - ${positionData.upperBinId}`);
      console.log(`  Transactions: ${allTransactions.length}`);
      console.log(`\n  💧 Estimated Tokens to Withdraw and Transfer to ${managerWallet.toBase58()}:`);
      console.log(`    Token X: ${tokenXUiAmount.toFixed(6)} (${estimatedXWithdraw.toString()} raw)`);
      console.log(`    Token Y: ${tokenYUiAmount.toFixed(6)} ${isTokenYNativeSOL ? 'SOL' : ''} (${estimatedYWithdraw.toString()} raw)`);
      console.log(`\n  📊 Liquidity Details:`);
      console.log(`    Total X before: ${positionData.totalXAmount}`);
      console.log(`    Total Y before: ${positionData.totalYAmount}`);
      console.log(`    Withdrawal: ${WITHDRAWAL_PERCENTAGE}% (${withdrawalBps} bps)`);
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
      console.log('✅ Test completed successfully!');
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
testDlmmWithdraw();
