/**
 * Create a DAMM (Dynamic AMM) pool directly with existing tokens
 *
 * Creates a Meteora CP-AMM pool with specified token amounts.
 * Much simpler than DBC flow - no migration required.
 *
 * Usage:
 *   TOKEN_MINT="<mint_address>" pnpm tsx scripts/create-damm-pool.ts
 *
 * With options:
 *   TOKEN_MINT="..." SOL_AMOUNT=0.1 TOKEN_PERCENT=10 pnpm tsx scripts/create-damm-pool.ts
 *
 * Required ENV:
 *   - RPC_URL: Solana RPC endpoint
 *   - PROTOCOL_PRIVATE_KEY: Private key for protocol wallet (pays for transactions)
 *   - TOKEN_MINT: The token mint address to create a pool for
 *
 * Optional ENV:
 *   - SOL_AMOUNT: Amount of SOL to provide as liquidity (default: 0.1)
 *   - TOKEN_PERCENT: Percentage of token balance to use (default: 10)
 *   - TOKEN_AMOUNT: Exact token amount (overrides TOKEN_PERCENT)
 *   - FEE_BPS: Pool fee in basis points (default: 100 = 1%)
 */
import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
} from '@solana/spl-token';
import {
  CpAmm,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  PoolFeesParams,
} from '@meteora-ag/cp-amm-sdk';
import { BN } from '@coral-xyz/anchor';
import bs58 from 'bs58';

// Environment variables (read at module load, validated in functions/main)
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;
const TOKEN_MINT = process.env.TOKEN_MINT;

// Pool configuration
const SOL_AMOUNT = parseFloat(process.env.SOL_AMOUNT || '0.1');
const TOKEN_PERCENT = parseInt(process.env.TOKEN_PERCENT || '10');
const TOKEN_AMOUNT = process.env.TOKEN_AMOUNT ? parseInt(process.env.TOKEN_AMOUNT) : undefined;
const FEE_BPS = parseInt(process.env.FEE_BPS || '100'); // 1% default

// Native SOL mint (WSOL)
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// Lazy initialization - only created when needed for direct execution
let _payer: Keypair | null = null;
let _connection: Connection | null = null;

function getDefaultPayer(): Keypair {
  if (!_payer) {
    if (!PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY or PROTOCOL_PRIVATE_KEY not found in environment variables');
    }
    _payer = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  }
  return _payer;
}

function getDefaultConnection(): Connection {
  if (!_connection) {
    if (!RPC_URL) {
      throw new Error('RPC_URL not found in environment variables');
    }
    _connection = new Connection(RPC_URL, 'confirmed');
  }
  return _connection;
}

export interface CreatePoolResult {
  pool: string;
  position: string;
  positionNft: string;
  tokenMint: string;
  quoteMint: string;
  tokenAmount: string;
  solAmount: string;
  feeBps: number;
  signature: string;
}

/**
 * Creates a DAMM pool with the specified token and SOL amounts
 */
export async function createDammPool(options?: {
  tokenMint?: string;
  solAmount?: number;
  tokenPercent?: number;
  tokenAmount?: number;
  feeBps?: number;
  payer?: Keypair;
  connection?: Connection;
}): Promise<CreatePoolResult> {
  // Validate tokenMint is provided either via options or env
  const tokenMintValue = options?.tokenMint || TOKEN_MINT;
  if (!tokenMintValue) {
    throw new Error('tokenMint is required - provide via options or TOKEN_MINT env var');
  }

  const opts = {
    tokenMint: tokenMintValue,
    solAmount: options?.solAmount ?? SOL_AMOUNT,
    tokenPercent: options?.tokenPercent ?? TOKEN_PERCENT,
    tokenAmount: options?.tokenAmount ?? TOKEN_AMOUNT,
    feeBps: options?.feeBps ?? FEE_BPS,
    payer: options?.payer || getDefaultPayer(),
    connection: options?.connection || getDefaultConnection(),
  };

  const tokenMintPubkey = new PublicKey(opts.tokenMint);
  const localCpAmm = new CpAmm(opts.connection);

  console.log('\n=== Creating DAMM Pool ===\n');
  console.log(`Token Mint: ${opts.tokenMint}`);
  console.log(`SOL Amount: ${opts.solAmount} SOL`);
  console.log(`Fee: ${opts.feeBps / 100}%`);
  console.log(`Payer: ${opts.payer.publicKey.toBase58()}`);

  // Get token info
  const mintInfo = await getMint(opts.connection, tokenMintPubkey);
  const tokenDecimals = mintInfo.decimals;
  console.log(`Token Decimals: ${tokenDecimals}`);

  // Get payer's token balance
  const tokenAccount = getAssociatedTokenAddressSync(
    tokenMintPubkey,
    opts.payer.publicKey
  );

  let tokenBalance: bigint;
  try {
    const accountInfo = await getAccount(opts.connection, tokenAccount);
    tokenBalance = accountInfo.amount;
    console.log(`Token Balance: ${Number(tokenBalance) / 10 ** tokenDecimals}`);
  } catch {
    throw new Error(`No token account found for ${opts.tokenMint}. Make sure you have tokens.`);
  }

  // Calculate token amount
  let rawTokenAmount: BN;
  if (opts.tokenAmount !== undefined) {
    // Use exact amount specified
    rawTokenAmount = new BN(opts.tokenAmount).mul(new BN(10 ** tokenDecimals));
    console.log(`Using specified token amount: ${opts.tokenAmount}`);
  } else {
    // Use percentage of balance
    const percentAmount = (tokenBalance * BigInt(opts.tokenPercent)) / BigInt(100);
    rawTokenAmount = new BN(percentAmount.toString());
    console.log(`Using ${opts.tokenPercent}% of balance: ${Number(percentAmount) / 10 ** tokenDecimals}`);
  }

  // Validate we have enough tokens
  if (BigInt(rawTokenAmount.toString()) > tokenBalance) {
    throw new Error(`Insufficient token balance. Have: ${tokenBalance}, Need: ${rawTokenAmount.toString()}`);
  }

  // Calculate SOL amount in lamports
  const rawSolAmount = new BN(Math.floor(opts.solAmount * LAMPORTS_PER_SOL));
  console.log(`SOL in lamports: ${rawSolAmount.toString()}`);

  // Check SOL balance
  const solBalance = await opts.connection.getBalance(opts.payer.publicKey);
  if (solBalance < rawSolAmount.toNumber() + 0.01 * LAMPORTS_PER_SOL) {
    throw new Error(`Insufficient SOL balance. Have: ${solBalance / LAMPORTS_PER_SOL}, Need: ${opts.solAmount + 0.01}`);
  }

  // Generate position NFT keypair
  const positionNftKeypair = Keypair.generate();
  console.log(`\nPosition NFT: ${positionNftKeypair.publicKey.toBase58()}`);

  // Token A = governance token (base), Token B = SOL (quote)
  // This is the standard convention for token pairs
  const tokenAMint = tokenMintPubkey;
  const tokenBMint = WSOL_MINT;
  const tokenAAmount = rawTokenAmount;
  const tokenBAmount = rawSolAmount;
  const tokenADecimals = tokenDecimals;
  const tokenBDecimals = 9;

  console.log(`\nToken A (${tokenAMint.toBase58().slice(0, 8)}...): ${tokenAAmount.toString()}`);
  console.log(`Token B (${tokenBMint.toBase58().slice(0, 8)}...): ${tokenBAmount.toString()}`);

  // Calculate initial parameters
  const { initSqrtPrice, liquidityDelta } = localCpAmm.preparePoolCreationParams({
    tokenAAmount: tokenAAmount,
    tokenBAmount: tokenBAmount,
    minSqrtPrice: MIN_SQRT_PRICE,
    maxSqrtPrice: MAX_SQRT_PRICE,
  });

  console.log(`Initial sqrt price: ${initSqrtPrice.toString()}`);
  console.log(`Liquidity delta: ${liquidityDelta.toString()}`);

  // Configure pool fees
  const feeNumerator = opts.feeBps * 100_000; // Convert bps to numerator (out of 1B)
  const poolFees: PoolFeesParams = {
    baseFee: {
      feeSchedulerMode: 0, // Linear fee schedule (constant)
      cliffFeeNumerator: new BN(feeNumerator),
      numberOfPeriod: 0,
      reductionFactor: new BN(0),
      periodFrequency: new BN(0),
    },
    dynamicFee: null,
    padding: [],
  };

  console.log(`\nFee numerator: ${feeNumerator} (${opts.feeBps}bps = ${opts.feeBps / 100}%)`);

  // Build create pool transaction
  console.log('\nBuilding pool creation transaction...');

  const { tx, pool, position } = await localCpAmm.createCustomPool({
    payer: opts.payer.publicKey,
    creator: opts.payer.publicKey,
    positionNft: positionNftKeypair.publicKey,
    tokenAMint: tokenAMint,
    tokenBMint: tokenBMint,
    tokenAAmount: tokenAAmount,
    tokenBAmount: tokenBAmount,
    sqrtMinPrice: MIN_SQRT_PRICE,
    sqrtMaxPrice: MAX_SQRT_PRICE,
    initSqrtPrice: initSqrtPrice,
    liquidityDelta: liquidityDelta,
    poolFees: poolFees,
    hasAlphaVault: false,
    collectFeeMode: 1, // Collect fees in quote token only (B)
    activationPoint: null, // Activate immediately
    activationType: 1, // Activation by timestamp
    tokenAProgram: TOKEN_PROGRAM_ID,
    tokenBProgram: TOKEN_PROGRAM_ID,
  });

  console.log(`Pool address: ${pool.toBase58()}`);
  console.log(`Position address: ${position.toBase58()}`);

  // Set transaction parameters
  const { blockhash } = await opts.connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = opts.payer.publicKey;

  // Sign transaction
  tx.sign(opts.payer, positionNftKeypair);

  // Send transaction
  console.log('\nSending transaction...');
  const signature = await opts.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  console.log(`Transaction sent: ${signature}`);
  console.log('Waiting for confirmation...');

  await opts.connection.confirmTransaction(signature, 'confirmed');

  console.log(`\n✅ Pool created successfully!`);
  console.log(`Transaction: https://solscan.io/tx/${signature}`);

  const result: CreatePoolResult = {
    pool: pool.toBase58(),
    position: position.toBase58(),
    positionNft: positionNftKeypair.publicKey.toBase58(),
    tokenMint: opts.tokenMint,
    quoteMint: WSOL_MINT.toBase58(),
    tokenAmount: (Number(rawTokenAmount.toString()) / 10 ** tokenDecimals).toString(),
    solAmount: opts.solAmount.toString(),
    feeBps: opts.feeBps,
    signature,
  };

  console.log('\n=== Pool Creation Complete ===\n');
  console.log(JSON.stringify(result, null, 2));

  return result;
}

// Main execution
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              Create DAMM Pool Script                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Validate TOKEN_MINT for direct execution
  if (!TOKEN_MINT) {
    throw new Error('TOKEN_MINT not found in environment variables');
  }

  const payer = getDefaultPayer();
  const connection = getDefaultConnection();

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`\nPayer: ${payer.publicKey.toBase58()}`);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  const minRequired = SOL_AMOUNT + 0.02; // SOL for liquidity + fees
  if (balance < minRequired * LAMPORTS_PER_SOL) {
    throw new Error(`Insufficient balance. Need at least ${minRequired} SOL.`);
  }

  const result = await createDammPool();
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
