/**
 * Create a new token AND a DAMM pool in one operation
 *
 * Convenience script that combines create-token.ts and create-damm-pool.ts
 * for quick test environment setup.
 *
 * Usage:
 *   pnpm tsx scripts/create-token-with-pool.ts
 *
 * With options:
 *   TOKEN_NAME="MyDAO" TOKEN_SYMBOL="MYDAO" SOL_AMOUNT=0.1 TOKEN_PERCENT=10 pnpm tsx scripts/create-token-with-pool.ts
 *
 * Transfer mint authority to DAO admin:
 *   DAO_ADMIN="<pubkey>" pnpm tsx scripts/create-token-with-pool.ts
 *
 * Required ENV:
 *   - RPC_URL: Solana RPC endpoint
 *   - PROTOCOL_PRIVATE_KEY: Private key for protocol wallet
 *
 * Optional ENV:
 *   - TOKEN_NAME: Name of the token (default: "TestDAOToken")
 *   - TOKEN_SYMBOL: Symbol (default: "TDAO")
 *   - TOKEN_DECIMALS: Decimals (default: 6)
 *   - TOTAL_SUPPLY: Total tokens to mint (default: 1000000)
 *   - DAO_ADMIN: Transfer mint authority to this address
 *   - SOL_AMOUNT: SOL for pool liquidity (default: 0.1)
 *   - TOKEN_PERCENT: % of tokens for pool (default: 10)
 *   - FEE_BPS: Pool fee in bps (default: 100 = 1%)
 */
import 'dotenv/config';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { createToken, CreateTokenResult } from './create-token';
import { createDammPool, CreatePoolResult } from './create-damm-pool';

// Environment
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;

// Configuration with defaults for DAO testing
const TOKEN_NAME = process.env.TOKEN_NAME || 'TestDAOToken';
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || 'TDAO';
const TOKEN_DECIMALS = parseInt(process.env.TOKEN_DECIMALS || '6');
const TOTAL_SUPPLY = parseInt(process.env.TOTAL_SUPPLY || '1000000');
const DAO_ADMIN = process.env.DAO_ADMIN;
const SOL_AMOUNT = parseFloat(process.env.SOL_AMOUNT || '0.1');
const TOKEN_PERCENT = parseInt(process.env.TOKEN_PERCENT || '10');
const FEE_BPS = parseInt(process.env.FEE_BPS || '100');

if (!RPC_URL) throw new Error('RPC_URL not found');
if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY or PROTOCOL_PRIVATE_KEY not found');

const payer = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(RPC_URL, 'confirmed');

export interface CreateTokenWithPoolResult {
  token: CreateTokenResult;
  pool: CreatePoolResult;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function createTokenWithPool(options?: {
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: number;
  daoAdmin?: string;
  solAmount?: number;
  tokenPercent?: number;
  feeBps?: number;
  payer?: Keypair;
  connection?: Connection;
}): Promise<CreateTokenWithPoolResult> {
  const opts = {
    name: options?.name || TOKEN_NAME,
    symbol: options?.symbol || TOKEN_SYMBOL,
    decimals: options?.decimals ?? TOKEN_DECIMALS,
    totalSupply: options?.totalSupply ?? TOTAL_SUPPLY,
    daoAdmin: options?.daoAdmin || DAO_ADMIN,
    solAmount: options?.solAmount ?? SOL_AMOUNT,
    tokenPercent: options?.tokenPercent ?? TOKEN_PERCENT,
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
    daoAdmin: opts.daoAdmin,
    payer: opts.payer,
    connection: opts.connection,
  });

  // Wait for token creation to be fully confirmed
  console.log('\nWaiting for token creation to finalize...');
  await sleep(3000);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║        Step 2: Create DAMM Pool                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const poolResult = await createDammPool({
    tokenMint: tokenResult.tokenMint,
    solAmount: opts.solAmount,
    tokenPercent: opts.tokenPercent,
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
  console.log('║         Create Token with DAMM Pool                          ║');
  console.log('║         (For DAO Testing)                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  console.log(`\nConfiguration:`);
  console.log(`  Token: ${TOKEN_NAME} (${TOKEN_SYMBOL})`);
  console.log(`  Decimals: ${TOKEN_DECIMALS}`);
  console.log(`  Total Supply: ${TOTAL_SUPPLY.toLocaleString()}`);
  console.log(`  SOL Liquidity: ${SOL_AMOUNT} SOL`);
  console.log(`  Token % for Pool: ${TOKEN_PERCENT}%`);
  console.log(`  Pool Fee: ${FEE_BPS / 100}%`);
  if (DAO_ADMIN) {
    console.log(`  DAO Admin: ${DAO_ADMIN}`);
  }

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`\nPayer: ${payer.publicKey.toBase58()}`);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  const minRequired = SOL_AMOUNT + 0.05; // SOL for pool + transaction fees
  if (balance < minRequired * LAMPORTS_PER_SOL) {
    throw new Error(`Insufficient balance. Need at least ${minRequired} SOL.`);
  }

  const result = await createTokenWithPool();

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    SUMMARY                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\nToken:');
  console.log(`  Mint: ${result.token.tokenMint}`);
  console.log(`  Name: ${result.token.tokenName}`);
  console.log(`  Symbol: ${result.token.tokenSymbol}`);
  console.log(`  Mint Authority: ${result.token.mintAuthority}`);
  console.log('\nPool:');
  console.log(`  Address: ${result.pool.pool}`);
  console.log(`  Token Amount: ${result.pool.tokenAmount}`);
  console.log(`  SOL Amount: ${result.pool.solAmount}`);
  console.log(`  Position NFT: ${result.pool.positionNft}`);
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
