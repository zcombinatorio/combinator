/**
 * Create a DAMM (Dynamic AMM) pool directly with existing tokens
 *
 * Creates a Meteora CP-AMM pool with specified token amounts.
 * Supports both SOL and USDC as quote tokens.
 * Much simpler than DBC flow - no migration required.
 *
 * Usage (USDC quote - default):
 *   TOKEN_MINT="<mint_address>" USDC_AMOUNT=10 pnpm tsx scripts/create-damm-pool.ts
 *
 * Usage (SOL quote):
 *   TOKEN_MINT="..." QUOTE_MINT=SOL SOL_AMOUNT=0.1 pnpm tsx scripts/create-damm-pool.ts
 *
 * Required ENV:
 *   - RPC_URL: Solana RPC endpoint
 *   - PROTOCOL_PRIVATE_KEY: Private key for protocol wallet (pays for transactions)
 *   - TOKEN_MINT: The token mint address to create a pool for
 *
 * Optional ENV:
 *   - QUOTE_MINT: Quote token - "USDC" (default) or "SOL"
 *   - USDC_AMOUNT: Amount of USDC to provide as liquidity (default: 10)
 *   - SOL_AMOUNT: Amount of SOL to provide as liquidity (default: 0.1, used when QUOTE_MINT=SOL)
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
  TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
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

// Quote token configuration
const QUOTE_MINT_ENV = (process.env.QUOTE_MINT || 'USDC').toUpperCase();

// Pool configuration
const USDC_AMOUNT = parseFloat(process.env.USDC_AMOUNT || '10');
const SOL_AMOUNT = parseFloat(process.env.SOL_AMOUNT || '0.1');
const TOKEN_PERCENT = parseInt(process.env.TOKEN_PERCENT || '10');
const TOKEN_AMOUNT = process.env.TOKEN_AMOUNT ? parseInt(process.env.TOKEN_AMOUNT) : undefined;
const FEE_BPS = parseInt(process.env.FEE_BPS || '100'); // 1% default

// Token mints
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// Quote token settings
type QuoteMintType = 'SOL' | 'USDC';
function getQuoteMintConfig(quoteMintType: QuoteMintType): { mint: PublicKey; decimals: number; symbol: string } {
  if (quoteMintType === 'SOL') {
    return { mint: WSOL_MINT, decimals: 9, symbol: 'SOL' };
  }
  return { mint: USDC_MINT, decimals: 6, symbol: 'USDC' };
}

/**
 * Detects which token program owns a mint account.
 * Returns TOKEN_2022_PROGRAM_ID for Token-2022 mints, SPL_TOKEN_PROGRAM_ID otherwise.
 */
async function getTokenProgramForMint(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const accountInfo = await connection.getAccountInfo(mint);
  if (!accountInfo) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }
  if (accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }
  return SPL_TOKEN_PROGRAM_ID;
}

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
  quoteSymbol: string;
  tokenAmount: string;
  quoteAmount: string;
  feeBps: number;
  signature: string;
}

/**
 * Creates a DAMM pool with the specified token and quote amounts
 * Supports both SOL and USDC as quote tokens
 */
export async function createDammPool(options?: {
  tokenMint?: string;
  quoteMint?: 'SOL' | 'USDC';
  quoteAmount?: number;
  solAmount?: number;  // Legacy alias for quoteAmount when quoteMint=SOL
  usdcAmount?: number; // Alias for quoteAmount when quoteMint=USDC
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

  // Determine quote mint type
  const quoteMintType: QuoteMintType = options?.quoteMint || (QUOTE_MINT_ENV as QuoteMintType) || 'USDC';
  if (quoteMintType !== 'SOL' && quoteMintType !== 'USDC') {
    throw new Error('QUOTE_MINT must be either "SOL" or "USDC"');
  }
  const quoteConfig = getQuoteMintConfig(quoteMintType);

  // Determine quote amount based on quote type
  let quoteAmount: number;
  if (options?.quoteAmount !== undefined) {
    quoteAmount = options.quoteAmount;
  } else if (quoteMintType === 'SOL') {
    quoteAmount = options?.solAmount ?? SOL_AMOUNT;
  } else {
    quoteAmount = options?.usdcAmount ?? USDC_AMOUNT;
  }

  const opts = {
    tokenMint: tokenMintValue,
    quoteMintType,
    quoteConfig,
    quoteAmount,
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
  console.log(`Quote Token: ${opts.quoteConfig.symbol}`);
  console.log(`Quote Amount: ${opts.quoteAmount} ${opts.quoteConfig.symbol}`);
  console.log(`Fee: ${opts.feeBps / 100}%`);
  console.log(`Payer: ${opts.payer.publicKey.toBase58()}`);

  // Detect token program (SPL Token vs Token-2022)
  const tokenProgramId = await getTokenProgramForMint(opts.connection, tokenMintPubkey);
  const isToken2022 = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID);
  console.log(`Token Program: ${isToken2022 ? 'Token-2022' : 'SPL Token'}`);

  // Get token info (with correct program ID)
  const mintInfo = await getMint(opts.connection, tokenMintPubkey, undefined, tokenProgramId);
  const tokenDecimals = mintInfo.decimals;
  console.log(`Token Decimals: ${tokenDecimals}`);

  // Get payer's token balance (with correct program ID)
  const tokenAccount = getAssociatedTokenAddressSync(
    tokenMintPubkey,
    opts.payer.publicKey,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  let tokenBalance: bigint;
  try {
    const accountInfo = await getAccount(opts.connection, tokenAccount, undefined, tokenProgramId);
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

  // Calculate quote amount in raw units
  const quoteDecimals = opts.quoteConfig.decimals;
  const rawQuoteAmount = new BN(Math.floor(opts.quoteAmount * 10 ** quoteDecimals));
  console.log(`Quote amount raw: ${rawQuoteAmount.toString()}`);

  // Check quote token balance
  if (opts.quoteMintType === 'SOL') {
    const solBalance = await opts.connection.getBalance(opts.payer.publicKey);
    if (solBalance < rawQuoteAmount.toNumber() + 0.01 * LAMPORTS_PER_SOL) {
      throw new Error(`Insufficient SOL balance. Have: ${solBalance / LAMPORTS_PER_SOL}, Need: ${opts.quoteAmount + 0.01}`);
    }
  } else {
    // Check USDC balance
    const quoteTokenAccount = getAssociatedTokenAddressSync(opts.quoteConfig.mint, opts.payer.publicKey);
    try {
      const quoteAccountInfo = await getAccount(opts.connection, quoteTokenAccount);
      const quoteBalance = quoteAccountInfo.amount;
      console.log(`${opts.quoteConfig.symbol} Balance: ${Number(quoteBalance) / 10 ** quoteDecimals}`);
      if (BigInt(rawQuoteAmount.toString()) > quoteBalance) {
        throw new Error(`Insufficient ${opts.quoteConfig.symbol} balance. Have: ${Number(quoteBalance) / 10 ** quoteDecimals}, Need: ${opts.quoteAmount}`);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('Insufficient')) throw e;
      throw new Error(`No ${opts.quoteConfig.symbol} token account found. Make sure you have ${opts.quoteConfig.symbol}.`);
    }
  }

  // Generate position NFT keypair
  const positionNftKeypair = Keypair.generate();
  console.log(`\nPosition NFT: ${positionNftKeypair.publicKey.toBase58()}`);

  // Token A = governance token (base), Token B = quote (SOL or USDC)
  // This is the standard convention for token pairs
  const tokenAMint = tokenMintPubkey;
  const tokenBMint = opts.quoteConfig.mint;
  const tokenAAmount = rawTokenAmount;
  const tokenBAmount = rawQuoteAmount;
  const tokenADecimals = tokenDecimals;
  const tokenBDecimals = quoteDecimals;

  console.log(`\nToken A (${tokenAMint.toBase58().slice(0, 8)}...): ${tokenAAmount.toString()}`);
  console.log(`Token B (${tokenBMint.toBase58().slice(0, 8)}... ${opts.quoteConfig.symbol}): ${tokenBAmount.toString()}`);

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

  // Determine token programs for pool creation
  // Token A (base) may be Token-2022, Token B (quote) is always SPL Token (WSOL or USDC)
  const tokenAProgram = tokenProgramId;
  const tokenBProgram = SPL_TOKEN_PROGRAM_ID; // Quote tokens (SOL/USDC) are always SPL Token

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
    tokenAProgram: tokenAProgram,
    tokenBProgram: tokenBProgram,
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
    quoteMint: opts.quoteConfig.mint.toBase58(),
    quoteSymbol: opts.quoteConfig.symbol,
    tokenAmount: (Number(rawTokenAmount.toString()) / 10 ** tokenDecimals).toString(),
    quoteAmount: opts.quoteAmount.toString(),
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
  console.log('║         Create DAMM Pool Script (SOL or USDC Quote)          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Validate TOKEN_MINT for direct execution
  if (!TOKEN_MINT) {
    throw new Error('TOKEN_MINT not found in environment variables');
  }

  const payer = getDefaultPayer();
  const connection = getDefaultConnection();

  // Determine quote type
  const quoteMintType: QuoteMintType = (QUOTE_MINT_ENV as QuoteMintType) || 'USDC';
  const quoteConfig = getQuoteMintConfig(quoteMintType);
  const quoteAmount = quoteMintType === 'SOL' ? SOL_AMOUNT : USDC_AMOUNT;

  console.log(`\nPayer: ${payer.publicKey.toBase58()}`);
  console.log(`Quote Token: ${quoteConfig.symbol}`);
  console.log(`Quote Amount: ${quoteAmount} ${quoteConfig.symbol}`);

  // Check SOL balance for fees
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`SOL Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  const minSolForFees = 0.02 * LAMPORTS_PER_SOL;
  if (quoteMintType === 'SOL') {
    const minRequired = quoteAmount + 0.02;
    if (balance < minRequired * LAMPORTS_PER_SOL) {
      throw new Error(`Insufficient SOL balance. Need at least ${minRequired} SOL.`);
    }
  } else {
    if (balance < minSolForFees) {
      throw new Error(`Insufficient SOL for fees. Need at least 0.02 SOL.`);
    }
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
