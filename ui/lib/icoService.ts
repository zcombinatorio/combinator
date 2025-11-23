/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Keypair,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  NATIVE_MINT,
  getMint,
} from '@solana/spl-token';
import { generateEscrowKeypair, decryptEscrowKeypair } from './presale-escrow';
import {
  createIcoSale,
  getIcoSaleByTokenAddress,
  getIcoSaleById,
  recordIcoPurchase,
  getIcoPurchasesByWallet,
  getIcoClaimByWallet,
  updateIcoClaim,
  updateIcoSaleStatus,
} from './db';
import type { IcoSale } from './db/types';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

// ============================================================================
// ICO SALE TOKEN FLOW
// ============================================================================
//
// SETUP:
// 1. Creator deposits all tokens for sale into escrow
// 2. Escrow holds 100% of tokens initially
//
// DURING PURCHASE:
// 1. User sends SOL to escrow (on-chain, signed by user)
// 2. Server verifies transaction on-chain
// 3. Server records purchase in database
// 4. Server transfers 50% of tokens from escrow → vault (for immediate staking)
// 5. Remaining 50% stays in escrow (for user to claim later)
//
// AFTER SALE FINALIZES (sold out or manual finalization):
// 1. Users can claim their 50% from escrow
// 2. Server signs claim transaction with escrow key
// 3. Tokens transfer from escrow → user's wallet
//
// ESCROW BALANCE TRACKING:
// - Starts with: total_tokens_for_sale
// - After each purchase: loses 50% to vault, 50% held for claims
// - Should always have: remaining_sale_tokens + unclaimed_tokens
//
// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum treasury allocation as percentage of total SOL raised
 * Ensures sufficient liquidity remains for AMM pool creation
 */
const MAX_TREASURY_PERCENTAGE = 80;

/**
 * Percentage of tokens sent to vault after purchase is confirmed
 * This happens server-side AFTER the user's transaction is verified
 */
const VAULT_PERCENTAGE = 50;

/**
 * Percentage of tokens held in escrow for claiming after sale finalizes
 * These tokens remain in escrow until users claim them
 */
const CLAIMABLE_PERCENTAGE = 50;

// ============================================================================
// ICO Sale Management
// ============================================================================

/**
 * Create a new ICO sale
 */
export async function createNewIcoSale(params: {
  tokenAddress: string;
  creatorWallet: string;
  tokenMetadataUrl: string;
  totalTokensForSale: bigint;
  tokenPriceSol: string; // "0.00001428571"
  vaultTokenAccount: string; // Vault's token account for this token
  treasuryWallet: string;
  treasurySolAmount: bigint; // Portion for treasury in lamports
}): Promise<IcoSale> {
  const connection = new Connection(RPC_URL, 'confirmed');

  // Fetch token decimals from on-chain mint data
  const tokenMint = new PublicKey(params.tokenAddress);
  const mintInfo = await getMint(connection, tokenMint);
  const tokenDecimals = mintInfo.decimals;

  // Calculate total SOL that will be raised
  const priceFloat = parseFloat(params.tokenPriceSol);
  const totalSolLamports = BigInt(Math.floor(priceFloat * Number(params.totalTokensForSale) * 1_000_000_000));

  // Validate treasury amount does not exceed maximum percentage of total
  const maxTreasurySol = (totalSolLamports * BigInt(MAX_TREASURY_PERCENTAGE)) / BigInt(100);
  if (params.treasurySolAmount > maxTreasurySol) {
    throw new Error(
      `Treasury SOL amount (${params.treasurySolAmount}) exceeds ${MAX_TREASURY_PERCENTAGE}% of total SOL (${maxTreasurySol})`
    );
  }

  // Generate escrow keypair
  const { publicKey: escrowPubKey, encryptedPrivateKey: escrowPrivKey } = generateEscrowKeypair();

  const icoSale = await createIcoSale({
    token_address: params.tokenAddress,
    creator_wallet: params.creatorWallet,
    token_metadata_url: params.tokenMetadataUrl,
    total_tokens_for_sale: params.totalTokensForSale,
    token_price_sol: params.tokenPriceSol,
    token_decimals: tokenDecimals,
    escrow_pub_key: escrowPubKey,
    escrow_priv_key: escrowPrivKey,
    vault_token_account: params.vaultTokenAccount,
    treasury_wallet: params.treasuryWallet,
    treasury_sol_amount: params.treasurySolAmount,
  });

  return icoSale;
}

/**
 * Calculate tokens for a given SOL amount
 */
export function calculateTokensForSol(
  solAmountLamports: bigint,
  tokenPriceSol: string,
  tokenDecimals: number
): bigint {
  // tokenPriceSol is the price per 1 human-readable token (e.g., "0.0001" SOL per token)
  // We need to return raw token amount (with decimals included)

  const priceFloat = parseFloat(tokenPriceSol);
  const lamportsPerToken = BigInt(Math.floor(priceFloat * 1_000_000_000));

  // Calculate: (solAmount / price) * 10^tokenDecimals
  // Rearranged: (solAmount * 10^tokenDecimals) / lamportsPerToken
  const decimalMultiplier = BigInt(Math.pow(10, tokenDecimals));
  const tokens = (solAmountLamports * decimalMultiplier) / lamportsPerToken;

  return tokens;
}

/**
 * Calculate SOL needed for a given token amount (inverse of calculateTokensForSol)
 */
export function calculateSolForTokens(
  tokenAmount: bigint,
  tokenPriceSol: string,
  tokenDecimals: number
): bigint {
  // tokenPriceSol is the price per 1 human-readable token
  // tokenAmount is in raw units (with decimals included)

  const priceFloat = parseFloat(tokenPriceSol);
  const lamportsPerToken = BigInt(Math.floor(priceFloat * 1_000_000_000));

  // Calculate: (tokenAmount / 10^tokenDecimals) * price
  // Rearranged: (tokenAmount * lamportsPerToken) / 10^tokenDecimals
  const decimalDivisor = BigInt(Math.pow(10, tokenDecimals));
  const solAmount = (tokenAmount * lamportsPerToken) / decimalDivisor;

  return solAmount;
}

/**
 * Prepare an unsigned purchase transaction
 *
 * USER'S TRANSACTION (on-chain):
 * - User sends SOL to escrow
 *
 * SERVER'S ACTION (after confirmation):
 * - Server transfers 50% of tokens from escrow to vault (for immediate staking)
 * - Server keeps 50% of tokens in escrow (for later claiming by user)
 *
 * NOTE: If user requests more tokens than available, purchase is auto-capped to remaining tokens
 */
export async function preparePurchaseTransaction(params: {
  tokenAddress: string;
  buyerWallet: string;
  solAmountLamports: bigint;
}): Promise<{
  transaction: Transaction;
  icoSaleId: number;
  tokensBought: bigint;
  tokensToVault: bigint;
  tokensClaimable: bigint;
  escrowPubKey: string;
  actualSolAmount: bigint; // Actual SOL amount needed (may be less than requested if capped)
}> {
  const connection = new Connection(RPC_URL, 'confirmed');

  // Get ICO sale
  const icoSale = await getIcoSaleByTokenAddress(params.tokenAddress);
  if (!icoSale) {
    throw new Error('ICO sale not found');
  }

  if (icoSale.status !== 'active') {
    throw new Error(`ICO sale is not active (status: ${icoSale.status})`);
  }

  if (!icoSale.id) {
    throw new Error('ICO sale ID is missing');
  }

  // Get token decimals from database (with fallback to 9 for backwards compatibility)
  const tokenDecimals = icoSale.token_decimals || 9;

  // Calculate tokens based on SOL amount requested
  const tokensRequested = calculateTokensForSol(params.solAmountLamports, icoSale.token_price_sol, tokenDecimals);

  // Check tokens remaining and cap purchase to available amount
  const tokensRemainingForSale = icoSale.total_tokens_for_sale - icoSale.tokens_sold;

  if (tokensRemainingForSale <= BigInt(0)) {
    throw new Error('ICO sale is sold out');
  }

  // Cap purchase to available tokens (auto-adjust if user requests too much)
  const tokensBought = tokensRequested > tokensRemainingForSale ? tokensRemainingForSale : tokensRequested;

  // Calculate actual SOL amount needed for the capped token amount
  const actualSolAmount = tokensBought === tokensRequested
    ? params.solAmountLamports
    : calculateSolForTokens(tokensBought, icoSale.token_price_sol, tokenDecimals);

  const tokensToVault = (tokensBought * BigInt(VAULT_PERCENTAGE)) / BigInt(100);
  const tokensClaimable = tokensBought - tokensToVault;

  if (!icoSale.escrow_pub_key || !icoSale.vault_token_account) {
    throw new Error('Escrow or vault not configured');
  }

  const buyerPubKey = new PublicKey(params.buyerWallet);
  const escrowPubKey = new PublicKey(icoSale.escrow_pub_key);
  const tokenMint = new PublicKey(params.tokenAddress);
  const vaultTokenAccount = new PublicKey(icoSale.vault_token_account);

  // Get escrow's token account
  const escrowTokenAccount = await getAssociatedTokenAddress(tokenMint, escrowPubKey);

  // Verify escrow has enough tokens for all remaining ICO needs
  // NOTE: Server-side vault transfers mean escrow must hold:
  // 1. Tokens for ALL remaining sales (this + future)
  // 2. Tokens already sold but not yet claimed
  const escrowTokenBalance = await connection.getTokenAccountBalance(escrowTokenAccount);
  const escrowBalance = BigInt(escrowTokenBalance.value.amount);

  const tokensSoldSoFar = icoSale.tokens_sold;
  const tokensStillAvailable = icoSale.total_tokens_for_sale - tokensSoldSoFar;

  // Escrow started with total_tokens_for_sale
  // After each purchase, escrow loses: tokensBought (will transfer 50% to vault, 50% to claims)
  // So escrow should currently have: total_tokens_for_sale - tokens_sold
  // And it needs: tokensStillAvailable (to cover this and future purchases)

  const requiredEscrowBalance = tokensStillAvailable;

  if (escrowBalance < requiredEscrowBalance) {
    throw new Error(
      `Escrow has insufficient tokens. Has: ${escrowBalance}, Needs: ${requiredEscrowBalance} to cover remaining sale`
    );
  }

  const transaction = new Transaction();
  const instructions: TransactionInstruction[] = [];

  // 1. Transfer SOL from buyer to escrow (use actualSolAmount, not requested amount)
  instructions.push(
    SystemProgram.transfer({
      fromPubkey: buyerPubKey,
      toPubkey: escrowPubKey,
      lamports: actualSolAmount,
    })
  );

  // 2. Transfer VAULT_PERCENTAGE of tokens from escrow to vault
  // This makes the purchase atomic: either both SOL and tokens transfer, or neither
  // Both buyer and escrow must sign this transaction
  instructions.push(
    createTransferInstruction(
      escrowTokenAccount,
      vaultTokenAccount,
      escrowPubKey,
      tokensToVault
    )
  );

  transaction.add(...instructions);

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = buyerPubKey;

  // NOTE: We do NOT sign with escrow here
  // The signing flow is:
  // 1. Server creates unsigned transaction (this function)
  // 2. User signs on frontend
  // 3. User sends signed transaction to /confirm endpoint (NOT to blockchain)
  // 4. Server validates, adds escrow signature, and submits to blockchain

  return {
    transaction,
    icoSaleId: icoSale.id,
    tokensBought,
    tokensToVault,
    tokensClaimable,
    escrowPubKey: icoSale.escrow_pub_key,
    actualSolAmount, // Return actual SOL amount (may be less than requested if capped)
  };
}

/**
 * Process and record a completed purchase
 * Note: Auto-finalization happens in recordIcoPurchase when tokens_sold >= total_tokens_for_sale
 */
export async function processPurchase(params: {
  icoSaleId: number;
  walletAddress: string;
  solAmountLamports: bigint;
  tokensBought: bigint;
  tokensToVault: bigint;
  tokensClaimable: bigint;
  transactionSignature: string;
}): Promise<void> {
  await recordIcoPurchase({
    ico_sale_id: params.icoSaleId,
    wallet_address: params.walletAddress,
    sol_amount_lamports: params.solAmountLamports,
    tokens_bought: params.tokensBought,
    transaction_signature: params.transactionSignature,
  });
}

/**
 * Get user's purchase history
 */
export async function getUserPurchases(tokenAddress: string, walletAddress: string) {
  return getIcoPurchasesByWallet(tokenAddress, walletAddress);
}

/**
 * Get user's claimable balance
 */
export async function getUserClaimInfo(tokenAddress: string, walletAddress: string) {
  return getIcoClaimByWallet(tokenAddress, walletAddress);
}

/**
 * Prepare claim transaction
 * Only works after ICO is finalized (sold out)
 */
export async function prepareClaimTransaction(params: {
  tokenAddress: string;
  walletAddress: string;
}): Promise<{
  transaction: Transaction;
  icoSaleId: number;
  tokensToClaim: bigint;
  escrowPubKey: string;
}> {
  const connection = new Connection(RPC_URL, 'confirmed');

  // Get ICO sale
  const icoSale = await getIcoSaleByTokenAddress(params.tokenAddress);
  if (!icoSale) {
    throw new Error('ICO sale not found');
  }

  if (icoSale.status !== 'finalized') {
    throw new Error('ICO sale has not finalized yet. Claiming will be available once the sale is complete.');
  }

  if (!icoSale.id || !icoSale.escrow_pub_key || !icoSale.escrow_priv_key) {
    throw new Error('ICO sale not properly configured');
  }

  // Get claim info
  const claimInfo = await getIcoClaimByWallet(params.tokenAddress, params.walletAddress);
  if (!claimInfo) {
    throw new Error('No claimable tokens found');
  }

  const tokensToClaim = (claimInfo.tokens_claimable || BigInt(0)) - claimInfo.tokens_claimed;
  if (tokensToClaim <= BigInt(0)) {
    throw new Error('No tokens left to claim');
  }

  const walletPubKey = new PublicKey(params.walletAddress);
  const escrowPubKey = new PublicKey(icoSale.escrow_pub_key);
  const tokenMint = new PublicKey(params.tokenAddress);

  const escrowTokenAccount = await getAssociatedTokenAddress(tokenMint, escrowPubKey);
  const userTokenAccount = await getAssociatedTokenAddress(tokenMint, walletPubKey);

  const transaction = new Transaction();
  const instructions: TransactionInstruction[] = [];

  // Check if user's token account exists
  const accountInfo = await connection.getAccountInfo(userTokenAccount);
  if (!accountInfo) {
    // Create associated token account for user
    instructions.push(
      createAssociatedTokenAccountInstruction(
        walletPubKey, // payer
        userTokenAccount,
        walletPubKey, // owner
        tokenMint
      )
    );
  }

  // Transfer tokens from escrow to user
  instructions.push(
    createTransferInstruction(
      escrowTokenAccount,
      userTokenAccount,
      escrowPubKey,
      tokensToClaim
    )
  );

  transaction.add(...instructions);

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = walletPubKey;

  return {
    transaction,
    icoSaleId: icoSale.id,
    tokensToClaim,
    escrowPubKey: icoSale.escrow_pub_key,
  };
}

/**
 * Sign claim transaction with escrow key and return signed transaction
 */
export async function signClaimTransaction(params: {
  tokenAddress: string;
  transaction: Transaction;
}): Promise<Transaction> {
  // Get ICO sale
  const icoSale = await getIcoSaleByTokenAddress(params.tokenAddress);
  if (!icoSale || !icoSale.escrow_priv_key) {
    throw new Error('ICO sale or escrow key not found');
  }

  // Decrypt escrow keypair
  const escrowKeypair = decryptEscrowKeypair(icoSale.escrow_priv_key);

  // Sign transaction with escrow key
  params.transaction.partialSign(escrowKeypair);

  return params.transaction;
}

/**
 * Process completed claim
 */
export async function processClaim(params: {
  icoSaleId: number;
  walletAddress: string;
  tokensClaimed: bigint;
  claimSignature: string;
}): Promise<void> {
  await updateIcoClaim(
    params.icoSaleId,
    params.walletAddress,
    params.tokensClaimed,
    params.claimSignature
  );
}

/**
 * DEPRECATED: AMM creation is now manual, not automated
 * This function is kept for reference but should not be used
 *
 * Prepare ICO launch transaction
 * Creates CP-AMM pool and distributes SOL to treasury
 */
export async function prepareIcoLaunchTransaction(params: {
  tokenAddress: string;
  launcherWallet: string; // Wallet that will pay transaction fees
}): Promise<{
  transaction: Transaction;
  poolAddress: string;
  ammSolAmount: string;
  ammTokenAmount: string;
  treasurySolAmount: string;
  positionNftKeypair: string; // Base58 encoded secret key
}> {
  throw new Error('AMM creation is now manual. This automated function is deprecated.');

  /* DEPRECATED CODE - AMM creation is now manual
  const connection = new Connection(RPC_URL, 'confirmed');

  const icoSale = await getIcoSaleByTokenAddress(params.tokenAddress);
  if (!icoSale) {
    throw new Error('ICO sale not found');
  }

  if (icoSale.status !== 'finalized') {
    throw new Error('ICO must be finalized before launch');
  }

  if (!icoSale.id || !icoSale.escrow_pub_key || !icoSale.escrow_priv_key || !icoSale.treasury_wallet) {
    throw new Error('ICO sale not properly configured');
  }

  // Decrypt escrow keypair
  const escrowKeypair = decryptEscrowKeypair(icoSale.escrow_priv_key);

  const launcherPubKey = new PublicKey(params.launcherWallet);
  const tokenMint = new PublicKey(params.tokenAddress);
  const treasuryWallet = new PublicKey(icoSale.treasury_wallet);
  const escrowPubKey = escrowKeypair.publicKey;

  // Calculate token amount for AMM (from escrow's remaining balance after sales)
  const escrowTokenAccount = await getAssociatedTokenAddress(tokenMint, escrowPubKey);
  const escrowTokenInfo = await connection.getTokenAccountBalance(escrowTokenAccount);
  const ammTokenAmount = BigInt(escrowTokenInfo.value.amount);

  // Get configuration address for pool creation
  const CONFIG_ADDRESS = process.env.CP_AMM_CONFIG_ADDRESS;
  if (!CONFIG_ADDRESS) {
    throw new Error('CP_AMM_CONFIG_ADDRESS not configured');
  }
  const configPubKey = new PublicKey(CONFIG_ADDRESS);

  // Get token mint info for decimals
  const tokenMintInfo = await getMint(connection, tokenMint);
  const tokenProgram = getTokenProgram(tokenMintInfo.tlvData.length > 0 ? 1 : 0);

  // Create position NFT mint (required for pool creation)
  const positionNftKeypair = Keypair.generate();

  // Calculate initial sqrt price for the pool
  // Price = SOL per TOKEN = ammSolAmount / ammTokenAmount
  const solAmount = new Decimal(icoSale.amm_sol_amount.toString()).div(1e9); // Convert lamports to SOL
  const tokenAmount = new Decimal(ammTokenAmount.toString()).div(Math.pow(10, tokenMintInfo.decimals));
  const pricePerToken = solAmount.div(tokenAmount); // SOL per TOKEN

  // For DAMM, if tokenA is the custom token and tokenB is SOL:
  // getSqrtPriceFromPrice expects price as string, tokenA decimals, tokenB decimals
  // Price should be tokenB/tokenA (SOL per TOKEN)
  const initSqrtPrice = getSqrtPriceFromPrice(
    pricePerToken.toString(),
    tokenMintInfo.decimals,
    9 // SOL decimals
  );

  // Calculate liquidity delta
  const ammSolAmountBN = new BN(icoSale.amm_sol_amount.toString());
  const ammTokenAmountBN = new BN(ammTokenAmount.toString());

  // Initialize CP-AMM instance
  const cpAmm = new CpAmm(connection);

  // Create pool transaction
  const createPoolTx = await cpAmm.createPool({
    creator: escrowPubKey,
    payer: launcherPubKey,
    config: configPubKey,
    positionNft: positionNftKeypair.publicKey,
    tokenAMint: tokenMint,
    tokenBMint: NATIVE_MINT, // SOL
    initSqrtPrice,
    liquidityDelta: ammTokenAmountBN, // Initial liquidity based on token amount
    tokenAAmount: ammTokenAmountBN,
    tokenBAmount: ammSolAmountBN,
    activationPoint: null, // Activate immediately
    tokenAProgram: tokenProgram,
    tokenBProgram: TOKEN_PROGRAM_ID,
    isLockLiquidity: false,
  });

  // Derive pool address
  const poolPubKey = derivePoolAddress(
    configPubKey,
    tokenMint,
    NATIVE_MINT
  );

  // Build combined transaction
  const transaction = new Transaction();

  // 1. Transfer treasury SOL from escrow to treasury wallet
  if (icoSale.treasury_sol_amount > BigInt(0)) {
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: escrowPubKey,
        toPubkey: treasuryWallet,
        lamports: icoSale.treasury_sol_amount,
      })
    );
  }

  // 2. Add pool creation instructions
  transaction.add(...createPoolTx.instructions);

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = launcherPubKey;

  // Pool address for return
  const poolAddress = poolPubKey.toBase58();

  return {
    transaction,
    poolAddress,
    ammSolAmount: icoSale.amm_sol_amount.toString(),
    ammTokenAmount: ammTokenAmount.toString(),
    treasurySolAmount: icoSale.treasury_sol_amount.toString(),
    positionNftKeypair: Buffer.from(positionNftKeypair.secretKey).toString('base64'),
  };
  */
}

/**
 * DEPRECATED: AMM creation is now manual
 * Sign ICO launch transaction with escrow key and position NFT keypair
 */
export async function signIcoLaunchTransaction(params: {
  tokenAddress: string;
  transaction: Transaction;
  positionNftKeypair: string; // Base64 encoded secret key
}): Promise<Transaction> {
  throw new Error('AMM creation is now manual. This automated function is deprecated.');
}

/**
 * DEPRECATED: AMM creation is now manual
 * Process completed ICO launch
 */
export async function processIcoLaunch(params: {
  tokenAddress: string;
  poolAddress: string;
  launchSignature: string;
}): Promise<void> {
  throw new Error('AMM creation is now manual. This automated function is deprecated.');
}
