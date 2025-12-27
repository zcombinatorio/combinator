/**
 * Fee Claiming & ZC Buyback -> Staking Vault Rewards Script
 *
 * This script runs daily via systemd to:
 * 1. Claim fees from LP positions
 * 2. Swap all SOL (minus 0.1 reserve) and USDC to ZC
 * 3. Send all ZC tokens to the staking vault as rewards
 *
 * Usage: npx tsx fee-buyback-workrewards.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import stakingVaultIdl from './staking-vault-idl.json';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // RPC endpoint
  RPC_URL: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',

  // Protocol fee wallet private key (base58 encoded)
  // This is the wallet that receives the protocol's share of LP fees (FEEnkcCNE2623LYCPtLf63LFzXpCFigBLTu4qZovRGZC)
  WALLET_PRIVATE_KEY: process.env.FEE_WALLET_PRIVATE_KEY || '',

  // Token addresses
  ZC_MINT: 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC',
  USDC_MINT: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Mainnet USDC

  // DAMM pool addresses to claim fees from (Dynamic AMM v2)
  DAMM_POOLS: [
    'BTYhoRPEUXs8ESYFjKDXRYf5qjH4chzZoBokMEApKEfJ', // SolPay
    'Ez1QYeC95xJRwPA9SR7YWC1H1Tj43exJr91QqKf8Puu1', // SurfCash
  ] as string[],

  // DLMM pool addresses to claim fees from (Dynamic Liquidity Market Maker)
  DLMM_POOLS: [
    '7jbhVZcYqCRmciBcZzK8L5B96Pyw7i1SpXQFKBkzD3G2', // ZC DLMM pool
  ] as string[],

  // API endpoint for fee claiming (zcombinator api-server)
  FEE_CLAIM_API_BASE: process.env.FEE_CLAIM_API_BASE || 'https://api.zcombinator.io',

  // Reserve SOL for gas (0.1 SOL)
  SOL_RESERVE_LAMPORTS: BigInt(100_000_000),

  // Jupiter API
  JUPITER_API_URL: 'https://api.jup.ag/swap/v1',

  // Slippage tolerance (in basis points, 100 = 1%)
  SLIPPAGE_BPS: 100,

  // Staking Vault Program ID
  STAKING_VAULT_PROGRAM_ID: '47rZ1jgK7zU6XAgffAfXkDX1JkiiRi4HRPBytossWR12',
};

// ============================================================================
// TYPES
// ============================================================================

interface FeeRecipient {
  address: string;
  percent: number;
}

interface FeeClaimPrepareResponse {
  success: boolean;
  transaction: string; // base58 encoded unsigned transaction
  requestId: string;
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  isTokenBNativeSOL: boolean;
  feeRecipients: FeeRecipient[];
  estimatedFees: {
    tokenA: string;
    tokenB: string;
  };
}

interface FeeClaimConfirmResponse {
  success: boolean;
  signature: string;
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  feeRecipients: FeeRecipient[];
  positionsCount: number;
  estimatedFees: {
    tokenA: string;
    tokenB: string;
  };
}

// DLMM API response types (handles multiple transactions)
interface DlmmFeeClaimPrepareResponse {
  success: boolean;
  transactions: string[]; // Array of base58 encoded unsigned transactions
  requestId: string;
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  isTokenXNativeSOL: boolean;
  isTokenYNativeSOL: boolean;
  feeRecipients: FeeRecipient[];
  transactionCount: number;
  instructionsCount: number;
  positionAddress: string;
  totalPositions: number;
  estimatedFees: {
    tokenX: string;
    tokenY: string;
  };
}

interface DlmmFeeClaimConfirmResponse {
  success: boolean;
  signatures: string[];
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  feeRecipients: FeeRecipient[];
  transactionCount: number;
  positionAddress: string;
  estimatedFees: {
    tokenX: string;
    tokenY: string;
  };
}

interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
}

interface JupiterSwapResponse {
  swapTransaction: string; // base64 encoded transaction
}

// Staking vault types
interface VaultState {
  admin: PublicKey;
  underlyingMint: PublicKey;
  pdaBump: number;
  operationsEnabled: boolean;
  isFrozen: boolean;
  totalShares: BN;
  totalAssets: BN;
  reservedAssets: BN;
  unbondingPeriod: BN;
  queuedRewards: BN;
  lastUpdateTs: BN;
  streamStartTs: BN;
  streamEndTs: BN;
  rewardRate: BN;
  rewardRateRemainder: BN;
  lastReblendTs: BN;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR: ${message}`);
  if (error instanceof Error) {
    console.error(error.message);
    console.error(error.stack);
  } else {
    console.error(error);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// DAMM FEE CLAIMING (via zcombinator api-server)
// ============================================================================

async function prepareFeeClaim(
  walletAddress: string,
  poolAddress: string
): Promise<FeeClaimPrepareResponse> {
  const response = await fetch(`${CONFIG.FEE_CLAIM_API_BASE}/fee-claim/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payerPublicKey: walletAddress,
      poolAddress,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to prepare fee claim: ${response.statusText} - ${errorBody}`);
  }

  return response.json();
}

async function confirmFeeClaim(
  signedTransaction: string,
  requestId: string
): Promise<FeeClaimConfirmResponse> {
  const response = await fetch(`${CONFIG.FEE_CLAIM_API_BASE}/fee-claim/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      signedTransaction,
      requestId,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to confirm fee claim: ${response.statusText} - ${errorBody}`);
  }

  return response.json();
}

async function claimFeesFromPool(
  wallet: Keypair,
  poolAddress: string
): Promise<string | null> {
  log(`Claiming fees from pool: ${poolAddress}`);

  try {
    // Step 1: Prepare the fee claim transaction
    const prepareResponse = await prepareFeeClaim(wallet.publicKey.toBase58(), poolAddress);

    if (!prepareResponse.success) {
      log(`No fees available to claim from pool ${poolAddress}`);
      return null;
    }

    log(`Fees claimable from pool ${prepareResponse.poolAddress}:`, prepareResponse.estimatedFees);

    // Check if there are fees to claim
    const tokenAFees = BigInt(prepareResponse.estimatedFees.tokenA);
    const tokenBFees = BigInt(prepareResponse.estimatedFees.tokenB);

    if (tokenAFees === BigInt(0) && tokenBFees === BigInt(0)) {
      log(`No fees to claim from pool ${poolAddress}`);
      return null;
    }

    // Step 2: Deserialize and sign the transaction (base58 encoded)
    const txBuffer = bs58.decode(prepareResponse.transaction);
    const transaction = Transaction.from(txBuffer);
    transaction.partialSign(wallet);

    // Step 3: Serialize the signed transaction (base58 for API)
    const signedTxBase58 = bs58.encode(transaction.serialize());

    // Step 4: Submit to the confirm endpoint
    const confirmResponse = await confirmFeeClaim(
      signedTxBase58,
      prepareResponse.requestId
    );

    if (confirmResponse.success) {
      log(`Successfully claimed fees from ${poolAddress}. Signature: ${confirmResponse.signature}`);
      return confirmResponse.signature;
    } else {
      logError(`Fee claim failed for pool ${poolAddress}`, confirmResponse);
      return null;
    }
  } catch (error) {
    logError(`Error claiming fees from DAMM pool ${poolAddress}`, error);
    return null;
  }
}

// ============================================================================
// DLMM FEE CLAIMING (via zcombinator api-server)
// ============================================================================

async function prepareDlmmFeeClaim(
  walletAddress: string,
  poolAddress: string
): Promise<DlmmFeeClaimPrepareResponse> {
  const response = await fetch(`${CONFIG.FEE_CLAIM_API_BASE}/dlmm-fee-claim/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payerPublicKey: walletAddress,
      poolAddress,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to prepare DLMM fee claim: ${response.statusText} - ${errorBody}`);
  }

  return response.json();
}

async function confirmDlmmFeeClaim(
  signedTransactions: string[],
  requestId: string
): Promise<DlmmFeeClaimConfirmResponse> {
  const response = await fetch(`${CONFIG.FEE_CLAIM_API_BASE}/dlmm-fee-claim/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      signedTransactions,
      requestId,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to confirm DLMM fee claim: ${response.statusText} - ${errorBody}`);
  }

  return response.json();
}

async function claimFeesFromDlmmPool(
  wallet: Keypair,
  poolAddress: string
): Promise<string[] | null> {
  log(`Claiming fees from DLMM pool: ${poolAddress}`);

  try {
    // Step 1: Prepare the fee claim transactions
    const prepareResponse = await prepareDlmmFeeClaim(wallet.publicKey.toBase58(), poolAddress);

    if (!prepareResponse.success) {
      log(`No fees available to claim from DLMM pool ${poolAddress}`);
      return null;
    }

    log(`DLMM fees claimable from pool ${prepareResponse.poolAddress}:`, prepareResponse.estimatedFees);
    log(`Transaction count: ${prepareResponse.transactionCount}`);

    // Check if there are fees to claim
    const tokenXFees = BigInt(prepareResponse.estimatedFees.tokenX);
    const tokenYFees = BigInt(prepareResponse.estimatedFees.tokenY);

    if (tokenXFees === BigInt(0) && tokenYFees === BigInt(0)) {
      log(`No fees to claim from DLMM pool ${poolAddress}`);
      return null;
    }

    // Step 2: Sign all transactions
    const signedTransactions: string[] = [];

    for (let i = 0; i < prepareResponse.transactions.length; i++) {
      const txBuffer = bs58.decode(prepareResponse.transactions[i]);
      const transaction = Transaction.from(txBuffer);
      transaction.partialSign(wallet);
      signedTransactions.push(bs58.encode(transaction.serialize({ requireAllSignatures: false })));
      log(`Signed DLMM transaction ${i + 1}/${prepareResponse.transactions.length}`);
    }

    // Step 3: Submit all signed transactions to the confirm endpoint
    const confirmResponse = await confirmDlmmFeeClaim(
      signedTransactions,
      prepareResponse.requestId
    );

    if (confirmResponse.success) {
      log(`Successfully claimed fees from DLMM ${poolAddress}. Signatures:`, confirmResponse.signatures);
      return confirmResponse.signatures;
    } else {
      logError(`DLMM fee claim failed for pool ${poolAddress}`, confirmResponse);
      return null;
    }
  } catch (error) {
    logError(`Error claiming fees from DLMM pool ${poolAddress}`, error);
    return null;
  }
}

// ============================================================================
// JUPITER SWAP FUNCTIONS
// ============================================================================

function getJupiterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const JUP_API_KEY = process.env.JUP_API_KEY;
  if (JUP_API_KEY) {
    headers['x-api-key'] = JUP_API_KEY;
  }
  return headers;
}

async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: bigint
): Promise<JupiterQuoteResponse> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: CONFIG.SLIPPAGE_BPS.toString(),
  });

  const response = await fetch(`${CONFIG.JUPITER_API_URL}/quote?${params}`, {
    headers: getJupiterHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to get Jupiter quote: ${response.statusText}`);
  }

  return response.json();
}

async function getJupiterSwapTransaction(
  quoteResponse: JupiterQuoteResponse,
  userPublicKey: string
): Promise<JupiterSwapResponse> {
  const response = await fetch(`${CONFIG.JUPITER_API_URL}/swap`, {
    method: 'POST',
    headers: getJupiterHeaders(),
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get Jupiter swap transaction: ${response.statusText}`);
  }

  return response.json();
}

async function executeSwap(
  connection: Connection,
  wallet: Keypair,
  inputMint: string,
  outputMint: string,
  amount: bigint,
  inputSymbol: string
): Promise<{ signature: string; outputAmount: bigint } | null> {
  log(`Getting quote to swap ${amount.toString()} ${inputSymbol} to ZC`);

  try {
    // Get quote
    const quote = await getJupiterQuote(inputMint, outputMint, amount);
    log(`Quote received: ${quote.inAmount} ${inputSymbol} -> ${quote.outAmount} ZC`);
    log(`Price impact: ${quote.priceImpactPct}%`);

    // Get swap transaction
    const swapResponse = await getJupiterSwapTransaction(quote, wallet.publicKey.toBase58());

    // Deserialize, sign, and send
    const txBuffer = Buffer.from(swapResponse.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuffer);
    transaction.sign([wallet]);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    log(`Swap transaction sent: ${signature}`);

    // Wait for confirmation
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    });

    log(`Swap confirmed: ${signature}`);

    return {
      signature,
      outputAmount: BigInt(quote.outAmount),
    };
  } catch (error) {
    logError(`Error executing ${inputSymbol} -> ZC swap`, error);
    return null;
  }
}

// ============================================================================
// STAKING VAULT REWARDS FUNCTION
// ============================================================================

async function sendRewardsToVault(
  connection: Connection,
  wallet: Keypair,
  amount: bigint
): Promise<string | null> {
  log(`Sending ${amount.toString()} ZC tokens to staking vault as rewards`);

  try {
    // Create Anchor provider
    const anchorWallet = new Wallet(wallet);
    const provider = new AnchorProvider(connection, anchorWallet, {
      commitment: 'confirmed',
    });

    // Initialize program
    const programId = new PublicKey(CONFIG.STAKING_VAULT_PROGRAM_ID);
    const program = new Program(stakingVaultIdl as anchor.Idl, provider);

    // Derive vault_state PDA
    const [vaultState] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault_state')],
      programId
    );

    // Fetch vault state to get underlying mint
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vaultAccount = await (program.account as any).vaultState.fetch(vaultState) as VaultState;
    const underlyingMint = vaultAccount.underlyingMint;

    log(`Vault underlying mint: ${underlyingMint.toBase58()}`);
    log(`Expected ZC mint: ${CONFIG.ZC_MINT}`);

    // Verify the vault's underlying mint matches ZC
    if (underlyingMint.toBase58() !== CONFIG.ZC_MINT) {
      throw new Error(`Vault underlying mint (${underlyingMint.toBase58()}) does not match ZC mint (${CONFIG.ZC_MINT})`);
    }

    // Get depositor's token account (the wallet's ZC ATA)
    const depositorTokenAccount = await getAssociatedTokenAddress(
      underlyingMint,
      wallet.publicKey
    );

    log(`Depositor token account: ${depositorTokenAccount.toBase58()}`);

    // Call addRewards instruction
    const tx = await program.methods
      .addRewards(new BN(amount.toString()))
      .accounts({
        depositorTokenAccount,
        signer: wallet.publicKey,
      })
      .rpc();

    log(`Rewards sent to vault. Signature: ${tx}`);

    return tx;
  } catch (error) {
    logError('Error sending rewards to vault', error);
    return null;
  }
}

// ============================================================================
// BALANCE FUNCTIONS
// ============================================================================

async function getSolBalance(connection: Connection, wallet: PublicKey): Promise<bigint> {
  const balance = await connection.getBalance(wallet);
  return BigInt(balance);
}

async function getTokenBalance(
  connection: Connection,
  wallet: PublicKey,
  mint: PublicKey
): Promise<bigint> {
  try {
    const tokenAccount = await getAssociatedTokenAddress(mint, wallet);
    const balance = await connection.getTokenAccountBalance(tokenAccount);
    return BigInt(balance.value.amount);
  } catch {
    // Token account doesn't exist
    return BigInt(0);
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  log('='.repeat(60));
  log('Starting Fee Buyback & Vault Rewards Script');
  log('='.repeat(60));

  // Validate configuration
  if (!CONFIG.WALLET_PRIVATE_KEY) {
    throw new Error('FEE_WALLET_PRIVATE_KEY environment variable is required');
  }

  // Initialize connection and wallet
  const connection = new Connection(CONFIG.RPC_URL, 'confirmed');
  const wallet = Keypair.fromSecretKey(bs58.decode(CONFIG.WALLET_PRIVATE_KEY));

  log(`Wallet address: ${wallet.publicKey.toBase58()}`);

  // ========================================================================
  // STEP 1: Claim fees from all LP pools (DAMM and DLMM)
  // ========================================================================
  log('\n--- STEP 1: Claiming LP Fees ---');

  // Track results for both DAMM and DLMM claims
  const dammClaimResults: { pool: string; signature: string | null }[] = [];
  const dlmmClaimResults: { pool: string; signatures: string[] | null }[] = [];

  // Claim from DAMM pools
  if (CONFIG.DAMM_POOLS.length === 0) {
    log('No DAMM pools configured.');
  } else {
    log(`Claiming from ${CONFIG.DAMM_POOLS.length} DAMM pool(s)...`);
    for (const poolAddress of CONFIG.DAMM_POOLS) {
      const signature = await claimFeesFromPool(wallet, poolAddress);
      dammClaimResults.push({ pool: poolAddress, signature });

      // Small delay between claims to avoid rate limiting
      await sleep(1000);
    }
  }

  // Claim from DLMM pools
  if (CONFIG.DLMM_POOLS.length === 0) {
    log('No DLMM pools configured.');
  } else {
    log(`Claiming from ${CONFIG.DLMM_POOLS.length} DLMM pool(s)...`);
    for (const poolAddress of CONFIG.DLMM_POOLS) {
      const signatures = await claimFeesFromDlmmPool(wallet, poolAddress);
      dlmmClaimResults.push({ pool: poolAddress, signatures });

      // Small delay between claims to avoid rate limiting
      await sleep(1000);
    }
  }

  log('DAMM fee claim results:', dammClaimResults);
  log('DLMM fee claim results:', dlmmClaimResults);

  // Wait for claims to settle
  const anyDammClaims = dammClaimResults.some((r) => r.signature !== null);
  const anyDlmmClaims = dlmmClaimResults.some((r) => r.signatures !== null);
  if (anyDammClaims || anyDlmmClaims) {
    log('Waiting for fee claims to settle...');
    await sleep(5000);
  }

  // ========================================================================
  // STEP 2: Get current balances
  // ========================================================================
  log('\n--- STEP 2: Checking Balances ---');

  const solBalance = await getSolBalance(connection, wallet.publicKey);
  const usdcBalance = await getTokenBalance(
    connection,
    wallet.publicKey,
    new PublicKey(CONFIG.USDC_MINT)
  );
  const zcBalance = await getTokenBalance(
    connection,
    wallet.publicKey,
    new PublicKey(CONFIG.ZC_MINT)
  );

  log(`SOL balance: ${solBalance.toString()} lamports (${Number(solBalance) / LAMPORTS_PER_SOL} SOL)`);
  log(`USDC balance: ${usdcBalance.toString()}`);
  log(`ZC balance: ${zcBalance.toString()}`);

  // ========================================================================
  // STEP 3: Swap SOL to ZC (keeping 0.1 SOL reserve)
  // ========================================================================
  log('\n--- STEP 3: Swapping SOL to ZC ---');

  const solToSwap = solBalance - CONFIG.SOL_RESERVE_LAMPORTS;

  if (solToSwap > BigInt(0)) {
    log(`Swapping ${solToSwap.toString()} lamports (keeping ${CONFIG.SOL_RESERVE_LAMPORTS.toString()} for gas)`);

    const solSwapResult = await executeSwap(
      connection,
      wallet,
      'So11111111111111111111111111111111111111112', // Native SOL
      CONFIG.ZC_MINT,
      solToSwap,
      'SOL'
    );

    if (solSwapResult) {
      log(`SOL swap successful. Received ${solSwapResult.outputAmount.toString()} ZC`);
    }

    await sleep(2000);
  } else {
    log('Insufficient SOL balance for swap (need to keep 0.1 SOL reserve)');
  }

  // ========================================================================
  // STEP 4: Swap USDC to ZC
  // ========================================================================
  log('\n--- STEP 4: Swapping USDC to ZC ---');

  if (usdcBalance > BigInt(0)) {
    log(`Swapping ${usdcBalance.toString()} USDC`);

    const usdcSwapResult = await executeSwap(
      connection,
      wallet,
      CONFIG.USDC_MINT,
      CONFIG.ZC_MINT,
      usdcBalance,
      'USDC'
    );

    if (usdcSwapResult) {
      log(`USDC swap successful. Received ${usdcSwapResult.outputAmount.toString()} ZC`);
    }

    await sleep(2000);
  } else {
    log('No USDC balance to swap');
  }

  // ========================================================================
  // STEP 5: Send all ZC tokens to staking vault as rewards
  // ========================================================================
  log('\n--- STEP 5: Sending ZC to Staking Vault ---');

  // Get updated ZC balance after swaps
  const finalZcBalance = await getTokenBalance(
    connection,
    wallet.publicKey,
    new PublicKey(CONFIG.ZC_MINT)
  );

  log(`Final ZC balance to send as rewards: ${finalZcBalance.toString()}`);

  if (finalZcBalance > BigInt(0)) {
    const rewardSignature = await sendRewardsToVault(connection, wallet, finalZcBalance);

    if (rewardSignature) {
      log(`Successfully sent ${finalZcBalance.toString()} ZC tokens to staking vault as rewards`);
    }
  } else {
    log('No ZC tokens to send as rewards');
  }

  // ========================================================================
  // SUMMARY
  // ========================================================================
  log('\n' + '='.repeat(60));
  log('Fee Buyback & Vault Rewards Complete');
  log('='.repeat(60));

  const finalSolBalance = await getSolBalance(connection, wallet.publicKey);
  log(`Final SOL balance: ${finalSolBalance.toString()} lamports`);
}

// Run the script
main()
  .then(() => {
    log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logError('Script failed', error);
    process.exit(1);
  });
