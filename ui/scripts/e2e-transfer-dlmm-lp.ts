/**
 * E2E Test: Transfer DLMM LP Position to admin wallet
 *
 * Unlike DAMM (which uses NFTs for position ownership), DLMM positions
 * are account-based and cannot be directly transferred. Instead, this script:
 * 1. Removes liquidity from the current owner's position
 * 2. Transfers the withdrawn tokens (token + USDC) to the admin wallet
 *
 * The admin wallet will create a new DLMM position automatically when needed
 * (via the deposit-back flow or first proposal).
 *
 * Works with:
 *   - TOKEN/USDC and TOKEN/SOL pools (auto-detects quote token type)
 *   - Both SPL Token and Token-2022 base tokens (auto-detects token program)
 *
 * Usage:
 *   POOL_ADDRESS="<pool>" ADMIN_WALLET="<admin>" pnpm tsx scripts/e2e-transfer-dlmm-lp.ts
 *
 * Required ENV:
 *   - RPC_URL: Solana RPC endpoint
 *   - PRIVATE_KEY or DAO_PRIVATE_KEY: Current position owner's private key
 *   - POOL_ADDRESS: DLMM pool address
 *   - ADMIN_WALLET: Target admin wallet address
 */
import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAccount,
  NATIVE_MINT,
  createSyncNativeInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import DLMM, { StrategyType } from '@meteora-ag/dlmm';
import BN from 'bn.js';
import bs58 from 'bs58';

// Configuration from environment
const DLMM_POOL = process.env.DLMM_POOL || process.env.POOL_ADDRESS;
const ADMIN_WALLET = process.env.ADMIN_WALLET;

/**
 * Detects which token program owns a mint account
 */
async function detectTokenProgram(
  connection: Connection,
  mint: PublicKey
): Promise<{ programId: PublicKey; isToken2022: boolean }> {
  const accountInfo = await connection.getAccountInfo(mint);
  if (!accountInfo) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }

  if (accountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    return { programId: TOKEN_PROGRAM_ID, isToken2022: false };
  } else if (accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return { programId: TOKEN_2022_PROGRAM_ID, isToken2022: true };
  } else {
    throw new Error(`Unknown token program owner: ${accountInfo.owner.toBase58()}`);
  }
}

async function main() {
  const RPC_URL = process.env.RPC_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.DAO_PRIVATE_KEY;

  if (!RPC_URL) throw new Error('RPC_URL required');
  if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY or DAO_PRIVATE_KEY required');
  if (!DLMM_POOL) throw new Error('DLMM_POOL or POOL_ADDRESS required');
  if (!ADMIN_WALLET) throw new Error('ADMIN_WALLET required');

  const connection = new Connection(RPC_URL, 'confirmed');
  const payer = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  const poolAddress = new PublicKey(DLMM_POOL);
  const adminWallet = new PublicKey(ADMIN_WALLET);

  console.log('=== E2E DLMM LP Position Transfer ===');
  console.log(`DLMM Pool: ${DLMM_POOL}`);
  console.log(`Current Owner: ${payer.publicKey.toBase58()}`);
  console.log(`Target Admin Wallet: ${ADMIN_WALLET}`);
  console.log('');

  // Load the DLMM pool
  console.log('Loading DLMM pool...');
  const dlmmPool = await DLMM.create(connection, poolAddress);
  const lbPair = dlmmPool.lbPair;
  const tokenXMint = lbPair.tokenXMint;
  const tokenYMint = lbPair.tokenYMint;

  // Detect token programs (supports both SPL Token and Token-2022)
  const { programId: tokenXProgramId, isToken2022: isTokenXToken2022 } = await detectTokenProgram(connection, tokenXMint);
  const { programId: tokenYProgramId } = await detectTokenProgram(connection, tokenYMint);

  console.log(`Token X: ${tokenXMint.toBase58()}`);
  console.log(`  Program: ${isTokenXToken2022 ? 'Token-2022' : 'SPL Token'}`);
  console.log(`Token Y: ${tokenYMint.toBase58()}`);
  console.log('');

  // Check if admin already has positions
  const { userPositions: adminPositions } = await dlmmPool.getPositionsByUserAndLbPair(adminWallet);
  if (adminPositions.length > 0) {
    console.log(`Admin wallet already has ${adminPositions.length} position(s) in this pool.`);
    console.log('LP transfer may have already been completed.');

    for (const pos of adminPositions) {
      const posData = pos.positionData;
      const rawX = posData.totalXAmount ? new BN(posData.totalXAmount.toString()) : new BN(0);
      const rawY = posData.totalYAmount ? new BN(posData.totalYAmount.toString()) : new BN(0);
      console.log(`  Position: ${pos.publicKey.toBase58()}`);
      console.log(`    Token X: ${rawX.toString()}`);
      console.log(`    Token Y: ${rawY.toString()}`);
    }
    return;
  }

  // Get payer's positions
  const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(payer.publicKey);

  if (userPositions.length === 0) {
    console.log('No positions found for the current owner.');
    console.error('Error: No transferable position found');
    process.exit(1);
  }

  console.log(`Found ${userPositions.length} position(s) to transfer:`);
  for (const pos of userPositions) {
    const posData = pos.positionData;
    const rawX = posData.totalXAmount ? new BN(posData.totalXAmount.toString()) : new BN(0);
    const rawY = posData.totalYAmount ? new BN(posData.totalYAmount.toString()) : new BN(0);
    console.log(`  Position: ${pos.publicKey.toBase58()}`);
    console.log(`    Bin Range: ${posData.lowerBinId} - ${posData.upperBinId}`);
    console.log(`    Token X: ${rawX.toString()}`);
    console.log(`    Token Y: ${rawY.toString()}`);
  }
  console.log('');

  // Use the first position with liquidity
  const sourcePosition = userPositions[0];
  const sourcePosData = sourcePosition.positionData;
  const sourceXAmount = sourcePosData.totalXAmount ? new BN(sourcePosData.totalXAmount.toString()) : new BN(0);
  const sourceYAmount = sourcePosData.totalYAmount ? new BN(sourcePosData.totalYAmount.toString()) : new BN(0);

  if (sourceXAmount.isZero() && sourceYAmount.isZero()) {
    console.log('Position has no liquidity to transfer.');
    process.exit(1);
  }

  console.log('=== Step 1: Remove Liquidity from Current Owner ===');
  console.log(`Position: ${sourcePosition.publicKey.toBase58()}`);

  // Remove all liquidity from the source position
  const removeLiquidityTxs = await dlmmPool.removeLiquidity({
    position: sourcePosition.publicKey,
    user: payer.publicKey,
    fromBinId: sourcePosData.lowerBinId,
    toBinId: sourcePosData.upperBinId,
    bps: new BN(10000), // 100% of liquidity
    shouldClaimAndClose: false, // Keep the position account
  });

  // Handle both single tx and array of txs
  const txsToSend = Array.isArray(removeLiquidityTxs) ? removeLiquidityTxs : [removeLiquidityTxs];

  for (let i = 0; i < txsToSend.length; i++) {
    const tx = txsToSend[i];
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;

    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      skipPreflight: false,
      commitment: 'confirmed',
    });
    console.log(`  Remove liquidity tx ${i + 1}/${txsToSend.length}: ${sig}`);
  }

  // Wait for state to propagate
  console.log('Waiting for state to propagate...');
  await new Promise(r => setTimeout(r, 2000));

  // Check balances after withdrawal (using correct program IDs)
  const payerXAta = await getAssociatedTokenAddress(tokenXMint, payer.publicKey, false, tokenXProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
  const payerYAta = await getAssociatedTokenAddress(tokenYMint, payer.publicKey, false, tokenYProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);

  let withdrawnX = new BN(0);
  let withdrawnY = new BN(0);

  try {
    const xAccount = await connection.getTokenAccountBalance(payerXAta);
    withdrawnX = new BN(xAccount.value.amount);
  } catch { /* Account might not exist */ }

  // For SOL (token Y), check native balance too
  const isTokenYNativeSOL = tokenYMint.equals(NATIVE_MINT);
  if (isTokenYNativeSOL) {
    const solBalance = await connection.getBalance(payer.publicKey);
    // Keep some for fees
    withdrawnY = new BN(Math.max(0, solBalance - 50_000_000)); // Keep 0.05 SOL for fees
  } else {
    try {
      const yAccount = await connection.getTokenAccountBalance(payerYAta);
      withdrawnY = new BN(yAccount.value.amount);
    } catch { /* Account might not exist */ }
  }

  console.log(`  Withdrawn X: ${withdrawnX.toString()}`);
  console.log(`  Withdrawn Y: ${withdrawnY.toString()}`);
  console.log('');

  if (withdrawnX.isZero() && withdrawnY.isZero()) {
    console.log('No tokens withdrawn. Position may have been empty.');
    process.exit(1);
  }

  console.log('=== Step 2: Transfer Tokens to Admin Wallet ===');

  const transferTx = new Transaction();
  const adminXAta = await getAssociatedTokenAddress(tokenXMint, adminWallet, false, tokenXProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
  const adminYAta = await getAssociatedTokenAddress(tokenYMint, adminWallet, false, tokenYProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);

  // Create ATAs for admin if needed (with correct program IDs)
  transferTx.add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, adminXAta, adminWallet, tokenXMint, tokenXProgramId, ASSOCIATED_TOKEN_PROGRAM_ID)
  );

  if (!isTokenYNativeSOL) {
    transferTx.add(
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, adminYAta, adminWallet, tokenYMint, tokenYProgramId, ASSOCIATED_TOKEN_PROGRAM_ID)
    );
  }

  // Transfer tokens (with correct program IDs)
  if (!withdrawnX.isZero()) {
    transferTx.add(
      createTransferInstruction(payerXAta, adminXAta, payer.publicKey, BigInt(withdrawnX.toString()), [], tokenXProgramId)
    );
  }

  if (!withdrawnY.isZero()) {
    if (isTokenYNativeSOL) {
      // Transfer SOL directly
      transferTx.add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: adminWallet,
          lamports: Number(withdrawnY.toString()),
        })
      );
    } else {
      transferTx.add(
        createTransferInstruction(payerYAta, adminYAta, payer.publicKey, BigInt(withdrawnY.toString()), [], tokenYProgramId)
      );
    }
  }

  const { blockhash: transferBlockhash } = await connection.getLatestBlockhash();
  transferTx.recentBlockhash = transferBlockhash;
  transferTx.feePayer = payer.publicKey;

  const transferSig = await sendAndConfirmTransaction(connection, transferTx, [payer], {
    skipPreflight: false,
    commitment: 'confirmed',
  });
  console.log(`  Transfer tx: ${transferSig}`);
  console.log('');

  console.log('=== Transfer Complete ===');
  console.log('');
  console.log('NOTE: The admin wallet now holds the tokens that were in the LP position.');
  console.log('To complete the DAO setup, the admin wallet needs to create a new DLMM position.');
  console.log('This will happen automatically when the first proposal is created.');
  console.log('');
  console.log('Alternatively, you can manually create a position for the admin:');
  console.log('  1. Fund the admin wallet with SOL for transaction fees');
  console.log('  2. Use the DAO deposit-back flow to create a position');
  console.log('');

  // Verify tokens arrived at admin
  console.log('Verifying token balances at admin wallet...');
  await new Promise(r => setTimeout(r, 2000));

  let adminXBalance = new BN(0);
  let adminYBalance = new BN(0);

  try {
    const xAccount = await connection.getTokenAccountBalance(adminXAta);
    adminXBalance = new BN(xAccount.value.amount);
  } catch { /* Account might not exist */ }

  if (isTokenYNativeSOL) {
    const solBalance = await connection.getBalance(adminWallet);
    adminYBalance = new BN(solBalance);
  } else {
    try {
      const yAccount = await connection.getTokenAccountBalance(adminYAta);
      adminYBalance = new BN(yAccount.value.amount);
    } catch { /* Account might not exist */ }
  }

  console.log(`  Admin Token X Balance: ${adminXBalance.toString()}`);
  console.log(`  Admin Token Y Balance: ${adminYBalance.toString()}`);

  if (!adminXBalance.isZero() || !adminYBalance.isZero()) {
    console.log('');
    console.log('✅ LP position liquidity successfully transferred to admin wallet');
  } else {
    console.log('');
    console.log('⚠️ Could not verify admin balances - may take time to propagate');
  }
}

main().catch(console.error);
