/**
 * Swap SOL to USDC using Jupiter API
 *
 * Useful for test setup when you need USDC for DLMM pool creation.
 * Uses Jupiter aggregator to get the best rate.
 *
 * Usage:
 *   pnpm tsx scripts/swap-sol-to-usdc.ts
 *
 * With options:
 *   SOL_AMOUNT=0.02 pnpm tsx scripts/swap-sol-to-usdc.ts
 *
 * Required ENV:
 *   - RPC_URL: Solana RPC endpoint
 *   - PRIVATE_KEY or DAO_PRIVATE_KEY: Wallet private key
 *
 * Optional ENV:
 *   - SOL_AMOUNT: Amount of SOL to swap (default: 0.02)
 *   - SLIPPAGE_BPS: Slippage tolerance in basis points (default: 50 = 0.5%)
 */
import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token';
import bs58 from 'bs58';

// Token mints
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Configuration
const SOL_AMOUNT = parseFloat(process.env.SOL_AMOUNT || '0.02');
const SLIPPAGE_BPS = parseInt(process.env.SLIPPAGE_BPS || '50');

// Jupiter API (requires API key)
const JUP_API_KEY = process.env.JUP_API_KEY;
const JUPITER_BASE_URL = 'https://api.jup.ag/swap/v1';
const JUPITER_QUOTE_URL = `${JUPITER_BASE_URL}/quote`;
const JUPITER_SWAP_URL = `${JUPITER_BASE_URL}/swap`;

export interface SwapResult {
  inputAmount: string;
  outputAmount: string;
  signature: string;
  inputMint: string;
  outputMint: string;
}

/**
 * Swap SOL to USDC using Jupiter
 */
export async function swapSolToUsdc(options?: {
  solAmount?: number;
  slippageBps?: number;
  payer?: Keypair;
  connection?: Connection;
}): Promise<SwapResult> {
  const RPC_URL = process.env.RPC_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.DAO_PRIVATE_KEY;

  if (!RPC_URL) throw new Error('RPC_URL not found');
  if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY or DAO_PRIVATE_KEY not found');
  if (!JUP_API_KEY) throw new Error('JUP_API_KEY not found in environment variables');

  const connection = options?.connection || new Connection(RPC_URL, 'confirmed');
  const payer = options?.payer || Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  const solAmount = options?.solAmount ?? SOL_AMOUNT;
  const slippageBps = options?.slippageBps ?? SLIPPAGE_BPS;

  console.log('\n=== Swap SOL to USDC via Jupiter ===\n');
  console.log(`Wallet: ${payer.publicKey.toBase58()}`);
  console.log(`Amount: ${solAmount} SOL`);
  console.log(`Slippage: ${slippageBps / 100}%`);

  // Check SOL balance
  const solBalance = await connection.getBalance(payer.publicKey);
  console.log(`\nSOL Balance: ${solBalance / 1e9} SOL`);

  const amountLamports = Math.floor(solAmount * 1e9);
  const minRequired = amountLamports + 0.005 * 1e9; // Keep some for fees

  if (solBalance < minRequired) {
    throw new Error(
      `Insufficient SOL. Have: ${solBalance / 1e9}, Need: ${minRequired / 1e9} (${solAmount} + fees)`
    );
  }

  // Get quote from Jupiter
  console.log('\nGetting quote from Jupiter...');
  const quoteUrl = `${JUPITER_QUOTE_URL}?inputMint=${SOL_MINT}&outputMint=${USDC_MINT.toBase58()}&amount=${amountLamports}&slippageBps=${slippageBps}`;

  const quoteResponse = await fetch(quoteUrl, {
    headers: { 'x-api-key': JUP_API_KEY! },
  });
  const quoteData = await quoteResponse.json();

  if (quoteData.error) {
    throw new Error(`Jupiter quote error: ${quoteData.error}`);
  }

  const expectedUsdc = Number(quoteData.outAmount) / 1e6;
  console.log(`Expected output: ${expectedUsdc} USDC`);
  console.log(`Price impact: ${quoteData.priceImpactPct || 'N/A'}%`);

  // Build swap transaction
  console.log('\nBuilding swap transaction...');
  const swapResponse = await fetch(JUPITER_SWAP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': JUP_API_KEY!,
    },
    body: JSON.stringify({
      quoteResponse: quoteData,
      userPublicKey: payer.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
    }),
  });

  const swapData = await swapResponse.json();

  if (swapData.error) {
    throw new Error(`Jupiter swap error: ${swapData.error}`);
  }

  // Deserialize and sign the transaction
  const swapTxBuf = Buffer.from(swapData.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(swapTxBuf);
  tx.sign([payer]);

  // Send the transaction
  console.log('Sending swap transaction...');
  const signature = await connection.sendTransaction(tx, {
    skipPreflight: false,
    maxRetries: 3,
  });

  console.log(`Swap tx: ${signature}`);
  console.log('Waiting for confirmation...');

  await connection.confirmTransaction(signature, 'confirmed');
  console.log('Swap confirmed!');

  // Check new USDC balance
  console.log('\nChecking new USDC balance...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  let usdcBalance = 0;
  try {
    const usdcAta = await getAssociatedTokenAddress(USDC_MINT, payer.publicKey);
    const usdcAccount = await getAccount(connection, usdcAta);
    usdcBalance = Number(usdcAccount.amount) / 1e6;
    console.log(`USDC Balance: ${usdcBalance} USDC`);
  } catch {
    console.log('USDC account not found (may still be propagating)');
  }

  const result: SwapResult = {
    inputAmount: solAmount.toString(),
    outputAmount: expectedUsdc.toString(),
    signature,
    inputMint: SOL_MINT,
    outputMint: USDC_MINT.toBase58(),
  };

  console.log('\n=== Swap Complete ===\n');
  console.log(JSON.stringify(result, null, 2));

  return result;
}

// Main execution
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              Swap SOL to USDC (Jupiter)                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const result = await swapSolToUsdc();
  return result;
}

// Run if executed directly (not imported)
if (require.main === module) {
  main()
    .then((result) => {
      console.log('\nFinal Result:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error:', error.message);
      console.error(error);
      process.exit(1);
    });
}
