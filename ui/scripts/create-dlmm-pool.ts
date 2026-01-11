/**
 * Create a DLMM (Dynamic Liquidity Market Maker) pool
 *
 * Creates a Meteora DLMM pool pairing your token with USDC (default) or SOL.
 * DLMM pools use concentrated liquidity with discrete price bins.
 *
 * Usage (USDC quote - default):
 *   TOKEN_MINT="<mint_address>" USDC_AMOUNT=100 pnpm tsx scripts/create-dlmm-pool.ts
 *
 * Usage (SOL quote):
 *   TOKEN_MINT="..." QUOTE_MINT=SOL SOL_AMOUNT=0.5 pnpm tsx scripts/create-dlmm-pool.ts
 *
 * Required ENV:
 *   - RPC_URL: Solana RPC endpoint
 *   - DAO_PRIVATE_KEY: Private key for DAO wallet (pays for transactions)
 *   - TOKEN_MINT: The token mint address to create a pool for
 *
 * Optional ENV:
 *   - QUOTE_MINT: Quote token - "USDC" (default) or "SOL"
 *   - USDC_AMOUNT: Amount of USDC to provide as liquidity (default: 100)
 *   - SOL_AMOUNT: Amount of SOL to provide as liquidity (default: 0.5, used when QUOTE_MINT=SOL)
 *   - TOKEN_PERCENT: Percentage of token balance to use (default: 10)
 *   - TOKEN_AMOUNT: Exact token amount (overrides TOKEN_PERCENT)
 *   - BIN_STEP: Price bin step size (default: 25, range 1-400)
 *   - FEE_BPS: Pool fee in basis points (default: 100 = 1%)
 */
import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import { Transaction } from '@solana/web3.js';
import DLMM, {
  StrategyType,
  deriveCustomizablePermissionlessLbPair,
  ActivationType,
} from '@meteora-ag/dlmm';
import BN from 'bn.js';
import bs58 from 'bs58';

// Token mints (Mainnet)
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Environment variables (read at module load, validated in functions/main)
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.DAO_PRIVATE_KEY;
const TOKEN_MINT = process.env.TOKEN_MINT;

// Quote token configuration
const QUOTE_MINT_ENV = (process.env.QUOTE_MINT || 'USDC').toUpperCase();

// Pool configuration
const USDC_AMOUNT = parseFloat(process.env.USDC_AMOUNT || '10'); // Default 10 USDC
const SOL_AMOUNT = parseFloat(process.env.SOL_AMOUNT || '0.1'); // Default 0.1 SOL
const TOKEN_PERCENT = parseInt(process.env.TOKEN_PERCENT || '10');
const TOKEN_AMOUNT = process.env.TOKEN_AMOUNT ? parseInt(process.env.TOKEN_AMOUNT) : undefined;
const BIN_STEP = parseInt(process.env.BIN_STEP || '25'); // Default 25 (0.25% per bin)
const FEE_BPS = parseInt(process.env.FEE_BPS || '100'); // 1% default

// Quote token settings
type QuoteMintType = 'SOL' | 'USDC';
function getQuoteMintConfig(quoteMintType: QuoteMintType): { mint: PublicKey; decimals: number; symbol: string } {
  if (quoteMintType === 'SOL') {
    return { mint: WSOL_MINT, decimals: 9, symbol: 'SOL' };
  }
  return { mint: USDC_MINT, decimals: 6, symbol: 'USDC' };
}

// DLMM Program ID
const DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

// Lazy initialization - only created when needed for direct execution
let _payer: Keypair | null = null;
let _connection: Connection | null = null;

function getDefaultPayer(): Keypair {
  if (!_payer) {
    if (!PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY or DAO_PRIVATE_KEY not found in environment variables');
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

export interface CreateDlmmPoolResult {
  pool: string;
  position: string;
  tokenMint: string;
  quoteMint: string;
  quoteSymbol: string;
  tokenAmount: string;
  quoteAmount: string;
  binStep: number;
  feeBps: number;
  activeBinId: number;
  createPoolSignature: string;
  addLiquiditySignature: string;
  tokenProgram: string; // TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID
  isToken2022: boolean;
}

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

/**
 * Calculate the active bin ID from a price ratio
 * In DLMM: price = (1 + binStep/10000)^binId
 * So: binId = log(price) / log(1 + binStep/10000)
 */
function priceToActiveBinId(price: number, binStep: number): number {
  const binStepNum = 1 + binStep / 10000;
  return Math.round(Math.log(price) / Math.log(binStepNum));
}

/**
 * Creates a DLMM pool with the specified token and quote (USDC or SOL) amounts
 */
export async function createDlmmPool(options?: {
  tokenMint?: string;
  quoteMint?: 'SOL' | 'USDC';
  quoteAmount?: number;
  usdcAmount?: number;  // Alias for quoteAmount when quoteMint=USDC
  solAmount?: number;   // Alias for quoteAmount when quoteMint=SOL
  tokenPercent?: number;
  tokenAmount?: number;
  binStep?: number;
  feeBps?: number;
  payer?: Keypair;
  connection?: Connection;
}): Promise<CreateDlmmPoolResult> {
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
    binStep: options?.binStep ?? BIN_STEP,
    feeBps: options?.feeBps ?? FEE_BPS,
    payer: options?.payer || getDefaultPayer(),
    connection: options?.connection || getDefaultConnection(),
  };

  // Validate bin step
  if (opts.binStep < 1 || opts.binStep > 400) {
    throw new Error('binStep must be between 1 and 400');
  }

  const tokenMintPubkey = new PublicKey(opts.tokenMint);

  // Detect token program (supports both SPL Token and Token-2022)
  const { programId: tokenProgramId, isToken2022 } = await detectTokenProgram(
    opts.connection,
    tokenMintPubkey
  );

  console.log(`\n=== Creating DLMM Pool (TOKEN/${opts.quoteConfig.symbol}) ===\n`);
  console.log(`Token Mint: ${opts.tokenMint}`);
  console.log(`Token Program: ${isToken2022 ? 'Token-2022' : 'SPL Token'}`);
  console.log(`Quote Token: ${opts.quoteConfig.symbol}`);
  console.log(`Quote Amount: ${opts.quoteAmount} ${opts.quoteConfig.symbol}`);
  console.log(`Bin Step: ${opts.binStep} (${opts.binStep / 100}% per bin)`);
  console.log(`Fee: ${opts.feeBps / 100}%`);
  console.log(`Payer: ${opts.payer.publicKey.toBase58()}`);

  // Get token info (with correct program ID)
  const mintInfo = await getMint(opts.connection, tokenMintPubkey, undefined, tokenProgramId);
  const tokenDecimals = mintInfo.decimals;
  console.log(`Token Decimals: ${tokenDecimals}`);

  // Get payer's token balance (with correct program ID for Token-2022)
  const tokenAccount = getAssociatedTokenAddressSync(
    tokenMintPubkey,
    opts.payer.publicKey,
    false, // allowOwnerOffCurve
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

  // Get quote token decimals
  const quoteDecimals = opts.quoteConfig.decimals;

  // Check quote token balance
  if (opts.quoteMintType === 'SOL') {
    // For SOL, check native balance
    const solBalance = await opts.connection.getBalance(opts.payer.publicKey);
    const requiredSol = opts.quoteAmount + 0.1; // Extra for fees and WSOL wrapping
    console.log(`SOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);
    if (solBalance < requiredSol * LAMPORTS_PER_SOL) {
      throw new Error(`Insufficient SOL balance. Have: ${solBalance / LAMPORTS_PER_SOL}, Need: ${requiredSol}`);
    }
  } else {
    // For USDC, check token balance
    const quoteAccount = getAssociatedTokenAddressSync(
      opts.quoteConfig.mint,
      opts.payer.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    try {
      const accountInfo = await getAccount(opts.connection, quoteAccount);
      const quoteBalance = accountInfo.amount;
      console.log(`${opts.quoteConfig.symbol} Balance: ${Number(quoteBalance) / 10 ** quoteDecimals}`);
      if (BigInt(Math.floor(opts.quoteAmount * 10 ** quoteDecimals)) > quoteBalance) {
        throw new Error(`Insufficient ${opts.quoteConfig.symbol} balance. Have: ${Number(quoteBalance) / 10 ** quoteDecimals}, Need: ${opts.quoteAmount}`);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('Insufficient')) throw e;
      throw new Error(`No ${opts.quoteConfig.symbol} account found. Make sure you have ${opts.quoteConfig.symbol}.`);
    }

    // Check SOL balance for transaction fees
    const solBalance = await opts.connection.getBalance(opts.payer.publicKey);
    if (solBalance < 0.05 * LAMPORTS_PER_SOL) {
      throw new Error(`Insufficient SOL for transaction fees. Have: ${solBalance / LAMPORTS_PER_SOL}, Need: ~0.05`);
    }
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
  const rawQuoteAmount = new BN(Math.floor(opts.quoteAmount * 10 ** quoteDecimals));
  console.log(`Quote amount in raw units: ${rawQuoteAmount.toString()}`);

  // Token X = governance token (base), Token Y = quote (USDC or SOL)
  // This is the standard convention for token pairs
  const tokenX = tokenMintPubkey;
  const tokenY = opts.quoteConfig.mint;
  const tokenXAmount = rawTokenAmount;
  const tokenYAmount = rawQuoteAmount;

  console.log(`\nToken X (base): ${tokenX.toBase58()}`);
  console.log(`Token Y (quote/${opts.quoteConfig.symbol}): ${tokenY.toBase58()}`);
  console.log(`Token X amount: ${tokenXAmount.toString()}`);
  console.log(`Token Y amount: ${tokenYAmount.toString()}`);

  // Calculate initial price: quote per token
  // price = tokenYAmount / tokenXAmount (adjusted for decimals)
  const tokenXDecimalAmount = Number(tokenXAmount.toString()) / 10 ** tokenDecimals;
  const tokenYDecimalAmount = Number(tokenYAmount.toString()) / 10 ** quoteDecimals;
  const initialPrice = tokenYDecimalAmount / tokenXDecimalAmount;
  console.log(`\nInitial Price: ${initialPrice} ${opts.quoteConfig.symbol} per token`);

  // Calculate active bin ID from initial price
  const activeBinId = priceToActiveBinId(initialPrice, opts.binStep);
  console.log(`Active Bin ID: ${activeBinId}`);

  // Derive the pool address
  const [poolAddress] = deriveCustomizablePermissionlessLbPair(
    tokenX,
    tokenY,
    DLMM_PROGRAM_ID
  );
  console.log(`\nPool Address: ${poolAddress.toBase58()}`);

  // Check if pool already exists
  const existingPool = await opts.connection.getAccountInfo(poolAddress);
  if (existingPool) {
    throw new Error(`Pool already exists at ${poolAddress.toBase58()}`);
  }

  // Pre-step: Ensure user ATAs exist (required for Token-2022)
  // DLMM SDK expects ATAs to already exist when creating pool
  const userTokenXAta = getAssociatedTokenAddressSync(tokenX, opts.payer.publicKey, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
  const userTokenYAta = getAssociatedTokenAddressSync(tokenY, opts.payer.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const ensureAtasTx = new Transaction();
  let needsAtaCreation = false;

  // Check if Token X ATA exists
  const tokenXAtaInfo = await opts.connection.getAccountInfo(userTokenXAta);
  if (!tokenXAtaInfo) {
    console.log(`Creating ATA for Token X (${isToken2022 ? 'Token-2022' : 'SPL Token'})...`);
    ensureAtasTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        opts.payer.publicKey,
        userTokenXAta,
        opts.payer.publicKey,
        tokenX,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    needsAtaCreation = true;
  }

  // Check if Token Y (quote) ATA exists
  const tokenYAtaInfo = await opts.connection.getAccountInfo(userTokenYAta);
  if (!tokenYAtaInfo) {
    console.log(`Creating ATA for Token Y (${opts.quoteConfig.symbol})...`);
    ensureAtasTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        opts.payer.publicKey,
        userTokenYAta,
        opts.payer.publicKey,
        tokenY,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    needsAtaCreation = true;
  }

  if (needsAtaCreation) {
    const { blockhash: ataBlockhash } = await opts.connection.getLatestBlockhash();
    ensureAtasTx.recentBlockhash = ataBlockhash;
    ensureAtasTx.feePayer = opts.payer.publicKey;
    const ataSig = await sendAndConfirmTransaction(
      opts.connection,
      ensureAtasTx,
      [opts.payer],
      { skipPreflight: false, commitment: 'confirmed' }
    );
    console.log(`ATAs created: ${ataSig}`);
  }

  // Step 1: Create the pool
  // Use createCustomizablePermissionlessLbPair2 for Token-2022 tokens
  console.log('\nStep 1: Creating DLMM pool...');
  console.log(`  Using ${isToken2022 ? 'Token-2022 compatible' : 'standard'} pool creation method`);
  const createPoolTx = isToken2022
    ? await DLMM.createCustomizablePermissionlessLbPair2(
        opts.connection,
        new BN(opts.binStep),
        tokenX,
        tokenY,
        new BN(activeBinId),
        new BN(opts.feeBps),
        ActivationType.Timestamp,
        false, // hasAlphaVault
        opts.payer.publicKey,
        undefined, // activationPoint - activate immediately
        false, // creatorPoolOnOffControl
      )
    : await DLMM.createCustomizablePermissionlessLbPair(
        opts.connection,
        new BN(opts.binStep),
        tokenX,
        tokenY,
        new BN(activeBinId),
        new BN(opts.feeBps),
        ActivationType.Timestamp,
        false, // hasAlphaVault
        opts.payer.publicKey,
        undefined, // activationPoint - activate immediately
        false, // creatorPoolOnOffControl
      );

  const { blockhash } = await opts.connection.getLatestBlockhash();
  createPoolTx.recentBlockhash = blockhash;
  createPoolTx.feePayer = opts.payer.publicKey;

  const createPoolSig = await sendAndConfirmTransaction(
    opts.connection,
    createPoolTx,
    [opts.payer],
    { skipPreflight: false, commitment: 'confirmed' }
  );
  console.log(`Pool created: ${createPoolSig}`);

  // Wait for pool to be available
  console.log('Waiting for pool to be available...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 2: Initialize position and add liquidity
  console.log('\nStep 2: Adding initial liquidity...');
  const dlmmPool = await DLMM.create(opts.connection, poolAddress);

  // Generate position keypair
  const positionKeypair = Keypair.generate();
  console.log(`Position: ${positionKeypair.publicKey.toBase58()}`);

  // Get active bin to determine bin range
  const activeBin = await dlmmPool.getActiveBin();
  console.log(`Active Bin Price: ${activeBin.price}`);

  // Create position with liquidity spread across bins around the active bin
  // Using a range of +/- 34 bins around active (69 bins total, max is 70)
  const binRange = 34;
  const minBinId = activeBin.binId - binRange;
  const maxBinId = activeBin.binId + binRange;

  console.log(`Bin Range: ${minBinId} to ${maxBinId}`);

  const addLiquidityTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: positionKeypair.publicKey,
    user: opts.payer.publicKey,
    totalXAmount: tokenXAmount,
    totalYAmount: tokenYAmount,
    strategy: {
      minBinId,
      maxBinId,
      strategyType: StrategyType.Spot,
    },
    slippage: 100, // 1% slippage
  });

  const { blockhash: blockhash2 } = await opts.connection.getLatestBlockhash();
  addLiquidityTx.recentBlockhash = blockhash2;
  addLiquidityTx.feePayer = opts.payer.publicKey;

  const addLiquiditySig = await sendAndConfirmTransaction(
    opts.connection,
    addLiquidityTx,
    [opts.payer, positionKeypair],
    { skipPreflight: false, commitment: 'confirmed' }
  );
  console.log(`Liquidity added: ${addLiquiditySig}`);

  console.log(`\n✅ DLMM Pool created successfully!`);
  console.log(`Pool: https://solscan.io/account/${poolAddress.toBase58()}`);

  const result: CreateDlmmPoolResult = {
    pool: poolAddress.toBase58(),
    position: positionKeypair.publicKey.toBase58(),
    tokenMint: opts.tokenMint,
    quoteMint: opts.quoteConfig.mint.toBase58(),
    quoteSymbol: opts.quoteConfig.symbol,
    tokenAmount: (Number(rawTokenAmount.toString()) / 10 ** tokenDecimals).toString(),
    quoteAmount: opts.quoteAmount.toString(),
    binStep: opts.binStep,
    feeBps: opts.feeBps,
    activeBinId,
    createPoolSignature: createPoolSig,
    addLiquiditySignature: addLiquiditySig,
    tokenProgram: tokenProgramId.toBase58(),
    isToken2022,
  };

  console.log('\n=== Pool Creation Complete ===\n');
  console.log(JSON.stringify(result, null, 2));

  return result;
}

// Main execution
async function main() {
  // Determine quote type for header
  const quoteMintType: QuoteMintType = (QUOTE_MINT_ENV as QuoteMintType) || 'USDC';
  const quoteConfig = getQuoteMintConfig(quoteMintType);
  const quoteAmount = quoteMintType === 'SOL' ? SOL_AMOUNT : USDC_AMOUNT;

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log(`║      Create DLMM Pool (TOKEN/${quoteConfig.symbol.padEnd(4)})                        ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Validate TOKEN_MINT for direct execution
  if (!TOKEN_MINT) {
    throw new Error('TOKEN_MINT not found in environment variables');
  }

  const payer = getDefaultPayer();
  const connection = getDefaultConnection();

  console.log(`\nQuote Token: ${quoteConfig.symbol}`);
  console.log(`Quote Amount: ${quoteAmount} ${quoteConfig.symbol}`);

  // Check balances
  const solBalance = await connection.getBalance(payer.publicKey);
  console.log(`\nPayer: ${payer.publicKey.toBase58()}`);
  console.log(`SOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);

  if (solBalance < 0.05 * LAMPORTS_PER_SOL) {
    throw new Error(`Insufficient SOL for transaction fees. Need at least 0.05 SOL.`);
  }

  const result = await createDlmmPool();
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
