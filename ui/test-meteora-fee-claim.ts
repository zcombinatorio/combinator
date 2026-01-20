/*
 * Combinator - Meteora DAMM v2 Fee Claim Test Script
 *
 * This script tests claiming fees from a Meteora DAMM v2 (Dynamic AMM) pool
 * and transferring 70% to a destination address.
 *
 * Required ENV variables:
 * - RPC_URL: Solana RPC endpoint
 * - DAMM_POOL_ADDRESS: Meteora DAMM v2 pool address to claim fees from
 * - LP_OWNER_PRIVATE_KEY: Private key of wallet that owns the LP position (Base58)
 * - FEE_DESTINATION_ADDRESS: Address to send 70% of claimed fees to
 * - FEE_PAYER_PRIVATE_KEY: (Optional) Private key for fee payer, defaults to LP owner
 */

import dotenv from 'dotenv';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { CpAmm, getTokenProgram, getUnClaimReward } from '@meteora-ag/cp-amm-sdk';
import bs58 from 'bs58';
import { createTransferInstruction, getAssociatedTokenAddress, getMint, createAssociatedTokenAccountIdempotentInstruction, NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';

dotenv.config();

// Set to true to simulate transactions without executing them
const SIMULATE_ONLY = true;

async function testMeteoraFeeClaim() {
  try {
    console.log('\n🧪 Meteora DAMM v2 Fee Claim Test Script');
    console.log(`Mode: ${SIMULATE_ONLY ? '🔍 SIMULATION ONLY' : '⚡ LIVE EXECUTION'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    const DAMM_POOL_ADDRESS = process.env.DAMM_POOL_ADDRESS;
    const LP_OWNER_PRIVATE_KEY = process.env.DAO_PRIVATE_KEY;
    const FEE_DESTINATION_ADDRESS = process.env.FEE_DESTINATION_ADDRESS;
    const FEE_PAYER_PRIVATE_KEY = process.env.DAO_PRIVATE_KEY;

    if (!RPC_URL) {
      throw new Error('RPC_URL not set in environment');
    }
    if (!DAMM_POOL_ADDRESS) {
      throw new Error('DAMM_POOL_ADDRESS not set in environment');
    }
    if (!LP_OWNER_PRIVATE_KEY) {
      throw new Error('LP_OWNER_PRIVATE_KEY not set in environment');
    }
    if (!FEE_DESTINATION_ADDRESS) {
      throw new Error('FEE_DESTINATION_ADDRESS not set in environment');
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const feePayer = FEE_PAYER_PRIVATE_KEY
      ? Keypair.fromSecretKey(bs58.decode(FEE_PAYER_PRIVATE_KEY))
      : lpOwner;
    const destinationAddress = new PublicKey(FEE_DESTINATION_ADDRESS);
    const poolAddress = new PublicKey(DAMM_POOL_ADDRESS);

    console.log('Configuration:');
    console.log(`  Pool:             ${poolAddress.toBase58()}`);
    console.log(`  LP Owner:         ${lpOwner.publicKey.toBase58()}`);
    console.log(`  Fee Payer:        ${feePayer.publicKey.toBase58()}`);
    console.log(`  Destination:      ${destinationAddress.toBase58()}`);
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

    // Display position details and unclaimed fees
    for (let i = 0; i < userPositions.length; i++) {
      const { position, positionNftAccount, positionState } = userPositions[i];

      // Calculate actual unclaimed fees using SDK helper
      const unclaimedFees = getUnClaimReward(poolState, positionState);

      console.log(`\n  Position ${i + 1}:`);
      console.log(`    Address: ${position.toBase58()}`);
      console.log(`    NFT Account: ${positionNftAccount.toBase58()}`);
      console.log(`    Unlocked Liquidity: ${positionState.unlockedLiquidity.toString()}`);
      console.log(`    Unclaimed Fee A: ${unclaimedFees.feeTokenA.toString()}`);
      console.log(`    Unclaimed Fee B: ${unclaimedFees.feeTokenB.toString()}`);
    }
    console.log('');

    // Step 3: Get balances before claim
    console.log('📈 Step 3: Checking balances before claim...');

    const tokenAAta = await getAssociatedTokenAddress(
      poolState.tokenAMint,
      lpOwner.publicKey
    );
    const tokenBAta = await getAssociatedTokenAddress(
      poolState.tokenBMint,
      lpOwner.publicKey
    );

    let tokenABalanceBefore = new BN(0);
    let tokenBBalanceBefore = new BN(0);

    try {
      const accountA = await connection.getTokenAccountBalance(tokenAAta);
      tokenABalanceBefore = new BN(accountA.value.amount);
      console.log(`  Token A balance: ${accountA.value.uiAmount}`);
    } catch (error) {
      console.log(`  Token A balance: 0 (no account)`);
    }

    try {
      const accountB = await connection.getTokenAccountBalance(tokenBAta);
      tokenBBalanceBefore = new BN(accountB.value.amount);
      console.log(`  Token B balance: ${accountB.value.uiAmount}`);
    } catch (error) {
      console.log(`  Token B balance: 0 (no account)`);
    }
    console.log('');

    // Step 4: Build combined claim and transfer transaction
    console.log('🔨 Step 4: Building combined claim and transfer transaction...');

    // Get token programs for token A and B
    const tokenAMint = await getMint(connection, poolState.tokenAMint);
    const tokenBMint = await getMint(connection, poolState.tokenBMint);
    const tokenAProgram = getTokenProgram(tokenAMint.tlvData.length > 0 ? 1 : 0);
    const tokenBProgram = getTokenProgram(tokenBMint.tlvData.length > 0 ? 1 : 0);

    // Calculate estimated claimable amounts for first position only
    const { position, positionNftAccount, positionState } = userPositions[0];
    const unclaimedFees = getUnClaimReward(poolState, positionState);
    const tokenAClaimedAmount = unclaimedFees.feeTokenA;
    const tokenBClaimedAmount = unclaimedFees.feeTokenB;

    const tokenAUiAmount = Number(tokenAClaimedAmount.toString()) / Math.pow(10, tokenAMint.decimals);
    const tokenBUiAmount = Number(tokenBClaimedAmount.toString()) / Math.pow(10, tokenBMint.decimals);

    console.log(`  Estimated Token A to be claimed: ${tokenAUiAmount} (${tokenAClaimedAmount.toString()} raw)`);
    console.log(`  Estimated Token B to be claimed: ${tokenBUiAmount} (${tokenBClaimedAmount.toString()} raw)`);

    // Check if Token B is native SOL (wrapped SOL)
    const isTokenBNativeSOL = poolState.tokenBMint.equals(NATIVE_MINT);
    console.log(`  Token B is ${isTokenBNativeSOL ? 'native SOL (unwrapped after claim)' : 'SPL token'}`);
    console.log('');

    // Calculate 70% of claimed fees
    const tokenATransferAmount = tokenAClaimedAmount.mul(new BN(70)).div(new BN(100));
    const tokenBTransferAmount = tokenBClaimedAmount.mul(new BN(70)).div(new BN(100));

    const tokenATransferUi = Number(tokenATransferAmount.toString()) / Math.pow(10, tokenAMint.decimals);
    const tokenBTransferUi = Number(tokenBTransferAmount.toString()) / Math.pow(10, tokenBMint.decimals);

    console.log(`  70% of Token A: ${tokenATransferUi} (${tokenATransferAmount.toString()} raw)`);
    console.log(`  70% of Token B: ${tokenBTransferUi} (${tokenBTransferAmount.toString()} raw)${isTokenBNativeSOL ? ' lamports' : ''}`);
    console.log('');

    // Get destination addresses
    const destTokenAAta = await getAssociatedTokenAddress(
      poolState.tokenAMint,
      destinationAddress
    );
    const destTokenBAta = isTokenBNativeSOL ? destinationAddress : await getAssociatedTokenAddress(
      poolState.tokenBMint,
      destinationAddress
    );

    // Create combined transaction
    const combinedTx = new Transaction();
    combinedTx.feePayer = feePayer.publicKey;

    // Step 1: Create LP owner's Token A ATA (required before claim)
    // Note: For wrapped SOL (Token B), no ATA needed - claim unwraps directly to native SOL
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

    // Step 2: Add claim fee instructions
    const claimInstructions = await cpAmm.claimPositionFee({
      owner: lpOwner.publicKey,
      position,
      pool: poolAddress,
      positionNftAccount,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAProgram,
      tokenBProgram,
    });

    combinedTx.add(...claimInstructions.instructions);

    // Step 3: Create destination ATA for Token A (always SPL token)
    if (!tokenATransferAmount.isZero()) {
      combinedTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          feePayer.publicKey,
          destTokenAAta,
          destinationAddress,
          poolState.tokenAMint,
          tokenAProgram
        )
      );
    }

    // Step 4: Create destination ATA for Token B (only if it's not native SOL)
    if (!tokenBTransferAmount.isZero() && !isTokenBNativeSOL) {
      combinedTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          feePayer.publicKey,
          destTokenBAta,
          destinationAddress,
          poolState.tokenBMint,
          tokenBProgram
        )
      );
    }

    // Step 5: Add transfer instruction for Token A (SPL token)
    if (!tokenATransferAmount.isZero()) {
      combinedTx.add(
        createTransferInstruction(
          tokenAAta,
          destTokenAAta,
          lpOwner.publicKey,
          BigInt(tokenATransferAmount.toString()),
          [],
          tokenAProgram
        )
      );
    }

    // Step 6: Add transfer instruction for Token B
    if (!tokenBTransferAmount.isZero()) {
      if (isTokenBNativeSOL) {
        // Transfer native SOL using SystemProgram
        console.log(`  Adding native SOL transfer of ${tokenBTransferUi} SOL to ${destinationAddress.toBase58()}`);
        combinedTx.add(
          SystemProgram.transfer({
            fromPubkey: lpOwner.publicKey,
            toPubkey: destinationAddress,
            lamports: Number(tokenBTransferAmount.toString())
          })
        );
      } else {
        // Transfer SPL token
        combinedTx.add(
          createTransferInstruction(
            tokenBAta,
            destTokenBAta,
            lpOwner.publicKey,
            BigInt(tokenBTransferAmount.toString()),
            [],
            tokenBProgram
          )
        );
      }
    }

    console.log(`  Combined transaction has ${combinedTx.instructions.length} instruction(s)`);
    console.log('');

    // Step 5: Simulate/Execute combined transaction
    const stepLabel5 = SIMULATE_ONLY ? '🔍 Step 5: Simulating combined transaction...' : '📤 Step 5: Sending combined transaction...';
    console.log(stepLabel5);

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

      console.log(`  Combined Transaction Simulation:`);
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
      console.log(`\n  💰 Fees to Claim:`);
      console.log(`    Token A: ${tokenAUiAmount} (${tokenAClaimedAmount.toString()} raw)`);
      console.log(`    Token B: ${tokenBUiAmount} (${tokenBClaimedAmount.toString()} raw)${isTokenBNativeSOL ? ' - will be unwrapped to native SOL' : ''}`);
      console.log(`\n  💸 70% to Transfer to ${destinationAddress.toBase58()}:`);
      console.log(`    Token A: ${tokenATransferUi} (${tokenATransferAmount.toString()} raw)`);
      console.log(`    Token B: ${tokenBTransferUi} (${tokenBTransferAmount.toString()} raw)${isTokenBNativeSOL ? ' - as native SOL' : ''}`);
      console.log(`\n  🏦 30% Remaining with LP Owner (${lpOwner.publicKey.toBase58()}):`);
      const tokenARemaining = tokenAClaimedAmount.sub(tokenATransferAmount);
      const tokenBRemaining = tokenBClaimedAmount.sub(tokenBTransferAmount);
      const tokenARemainingUi = Number(tokenARemaining.toString()) / Math.pow(10, tokenAMint.decimals);
      const tokenBRemainingUi = Number(tokenBRemaining.toString()) / Math.pow(10, tokenBMint.decimals);
      console.log(`    Token A: ${tokenARemainingUi} (${tokenARemaining.toString()} raw)`);
      console.log(`    Token B: ${tokenBRemainingUi} (${tokenBRemaining.toString()} raw)${isTokenBNativeSOL ? ' - as native SOL' : ''}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } else {
      // Send combined transaction
      const signature = await connection.sendRawTransaction(combinedTx.serialize());
      console.log(`  Combined TX: ${signature}`);
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
testMeteoraFeeClaim();
