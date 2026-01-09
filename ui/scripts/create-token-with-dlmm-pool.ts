/**
 * Create a new token AND a DLMM pool in one operation
 *
 * Convenience script that combines create-token.ts and create-dlmm-pool.ts
 * for quick test environment setup with DLMM pools paired with USDC.
 * Supports both standard SPL Token and Token-2022 as the base token.
 *
 * Usage:
 *   pnpm tsx scripts/create-token-with-dlmm-pool.ts
 *
 * With options:
 *   TOKEN_NAME="MyDAO" TOKEN_SYMBOL="MYDAO" USDC_AMOUNT=100 TOKEN_PERCENT=10 pnpm tsx scripts/create-token-with-dlmm-pool.ts
 *
 * With Token-2022:
 *   USE_TOKEN_2022=true TOKEN_NAME="MyDAO22" pnpm tsx scripts/create-token-with-dlmm-pool.ts
 *
 * Required ENV:
 *   - RPC_URL: Solana RPC endpoint
 *   - PROTOCOL_PRIVATE_KEY: Private key for protocol wallet
 *   - Payer must have USDC for pool liquidity
 *
 * Optional ENV:
 *   - TOKEN_NAME: Name of the token (default: "TestDAOToken")
 *   - TOKEN_SYMBOL: Symbol (default: "TDAO")
 *   - TOKEN_DECIMALS: Decimals (default: 6)
 *   - TOTAL_SUPPLY: Total tokens to mint (default: 1000000)
 *   - USE_TOKEN_2022: Create Token-2022 token (default: false)
 *   - USDC_AMOUNT: USDC for pool liquidity (default: 100)
 *   - TOKEN_PERCENT: % of tokens for pool (default: 10)
 *   - BIN_STEP: DLMM bin step size (default: 25)
 *   - FEE_BPS: Pool fee in bps (default: 100 = 1%)
 */
import 'dotenv/config';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { createToken, CreateTokenResult } from './create-token';
import { createDlmmPool, CreateDlmmPoolResult } from './create-dlmm-pool';

// Environment
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;

// Configuration with defaults for DAO testing
const TOKEN_NAME = process.env.TOKEN_NAME || 'TestDAOToken';
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || 'TDAO';
const TOKEN_DECIMALS = parseInt(process.env.TOKEN_DECIMALS || '6');
const TOTAL_SUPPLY = parseInt(process.env.TOTAL_SUPPLY || '1000000');
const USE_TOKEN_2022 = process.env.USE_TOKEN_2022 === 'true';
const USDC_AMOUNT = parseFloat(process.env.USDC_AMOUNT || '100'); // Default 100 USDC
const TOKEN_PERCENT = parseInt(process.env.TOKEN_PERCENT || '10');
const BIN_STEP = parseInt(process.env.BIN_STEP || '25');
const FEE_BPS = parseInt(process.env.FEE_BPS || '100');

if (!RPC_URL) throw new Error('RPC_URL not found');
if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY or PROTOCOL_PRIVATE_KEY not found');

const payer = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(RPC_URL, 'confirmed');

export interface CreateTokenWithDlmmPoolResult {
  token: CreateTokenResult;
  pool: CreateDlmmPoolResult;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function createTokenWithDlmmPool(options?: {
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: number;
  useToken2022?: boolean;
  usdcAmount?: number;
  tokenPercent?: number;
  binStep?: number;
  feeBps?: number;
  payer?: Keypair;
  connection?: Connection;
}): Promise<CreateTokenWithDlmmPoolResult> {
  const opts = {
    name: options?.name || TOKEN_NAME,
    symbol: options?.symbol || TOKEN_SYMBOL,
    decimals: options?.decimals ?? TOKEN_DECIMALS,
    totalSupply: options?.totalSupply ?? TOTAL_SUPPLY,
    useToken2022: options?.useToken2022 ?? USE_TOKEN_2022,
    usdcAmount: options?.usdcAmount ?? USDC_AMOUNT,
    tokenPercent: options?.tokenPercent ?? TOKEN_PERCENT,
    binStep: options?.binStep ?? BIN_STEP,
    feeBps: options?.feeBps ?? FEE_BPS,
    payer: options?.payer || payer,
    connection: options?.connection || connection,
  };

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║        Step 1: Create Token                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const tokenResult = await createToken({
    name: opts.name,
    symbol: opts.symbol,
    decimals: opts.decimals,
    totalSupply: opts.totalSupply,
    useToken2022: opts.useToken2022,
    payer: opts.payer,
    connection: opts.connection,
  });

  // Wait for token creation to be fully confirmed
  console.log('\nWaiting for token creation to finalize...');
  await sleep(3000);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║        Step 2: Create DLMM Pool                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const poolResult = await createDlmmPool({
    tokenMint: tokenResult.tokenMint,
    usdcAmount: opts.usdcAmount,
    tokenPercent: opts.tokenPercent,
    binStep: opts.binStep,
    feeBps: opts.feeBps,
    payer: opts.payer,
    connection: opts.connection,
  });

  return {
    token: tokenResult,
    pool: poolResult,
  };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         Create Token with DLMM Pool                          ║');
  console.log('║         (For DAO Testing)                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  console.log(`\nConfiguration:`);
  console.log(`  Token: ${TOKEN_NAME} (${TOKEN_SYMBOL})`);
  console.log(`  Token Program: ${USE_TOKEN_2022 ? 'Token-2022' : 'SPL Token'}`);
  console.log(`  Decimals: ${TOKEN_DECIMALS}`);
  console.log(`  Total Supply: ${TOTAL_SUPPLY.toLocaleString()}`);
  console.log(`  USDC Liquidity: ${USDC_AMOUNT} USDC`);
  console.log(`  Token % for Pool: ${TOKEN_PERCENT}%`);
  console.log(`  Bin Step: ${BIN_STEP} (${BIN_STEP / 100}% per bin)`);
  console.log(`  Pool Fee: ${FEE_BPS / 100}%`);

  // Check SOL balance for transaction fees
  const solBalance = await connection.getBalance(payer.publicKey);
  console.log(`\nPayer: ${payer.publicKey.toBase58()}`);
  console.log(`SOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);

  // Need at least 0.1 SOL for transaction fees
  if (solBalance < 0.1 * LAMPORTS_PER_SOL) {
    throw new Error(`Insufficient SOL for transaction fees. Need at least 0.1 SOL.`);
  }

  // Note: USDC balance check is done in createDlmmPool

  const result = await createTokenWithDlmmPool();

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    SUMMARY                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\nToken:');
  console.log(`  Mint: ${result.token.tokenMint}`);
  console.log(`  Name: ${result.token.tokenName}`);
  console.log(`  Symbol: ${result.token.tokenSymbol}`);
  console.log(`  Token Program: ${result.token.isToken2022 ? 'Token-2022' : 'SPL Token'}`);
  console.log(`  Mint Authority: ${result.token.mintAuthority}`);
  console.log('\nDLMM Pool:');
  console.log(`  Address: ${result.pool.pool}`);
  console.log(`  Position: ${result.pool.position}`);
  console.log(`  Token Amount: ${result.pool.tokenAmount}`);
  console.log(`  USDC Amount: ${result.pool.quoteAmount}`);
  console.log(`  Bin Step: ${result.pool.binStep}`);
  console.log(`  Active Bin ID: ${result.pool.activeBinId}`);
  console.log('\nUseful Links:');
  console.log(`  Token: https://solscan.io/token/${result.token.tokenMint}`);
  console.log(`  Pool: https://solscan.io/account/${result.pool.pool}`);

  return result;
}

// Run if executed directly (not imported)
if (require.main === module) {
  main()
    .then((result) => {
      console.log('\n\nFull Result JSON:');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error:', error.message);
      console.error(error);
      process.exit(1);
    });
}
