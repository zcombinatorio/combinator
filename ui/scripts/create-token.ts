/**
 * Create a new SPL token with configurable mint authority
 *
 * Creates a new token mint and optionally transfers mint authority to a DAO admin.
 * Useful for testing DAO creation and proposal flows.
 *
 * Usage:
 *   pnpm tsx scripts/create-token.ts
 *
 * With options:
 *   TOKEN_NAME="MyToken" TOKEN_SYMBOL="MTK" TOKEN_DECIMALS=6 TOTAL_SUPPLY=1000000 pnpm tsx scripts/create-token.ts
 *
 * Transfer mint authority to DAO admin:
 *   DAO_ADMIN="<pubkey>" pnpm tsx scripts/create-token.ts
 *
 * Required ENV:
 *   - RPC_URL: Solana RPC endpoint
 *   - PROTOCOL_PRIVATE_KEY: Private key for protocol wallet (pays for transactions)
 *
 * Optional ENV:
 *   - TOKEN_NAME: Name of the token (default: "TestToken")
 *   - TOKEN_SYMBOL: Symbol of the token (default: "TEST")
 *   - TOKEN_DECIMALS: Number of decimals (default: 6)
 *   - TOTAL_SUPPLY: Total tokens to mint (default: 1000000)
 *   - DAO_ADMIN: Public key to transfer mint authority to (default: keep with protocol wallet)
 *   - TOKEN_URI: Metadata URI (default: empty)
 *   - SKIP_METADATA: Set to "true" to skip metadata creation (useful for test tokens)
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
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  setAuthority,
} from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplTokenMetadata,
  createMetadataAccountV3,
  findMetadataPda,
} from '@metaplex-foundation/mpl-token-metadata';
import {
  keypairIdentity,
  publicKey as umiPublicKey,
  none,
} from '@metaplex-foundation/umi';
import bs58 from 'bs58';

// Environment variables (read at module load, validated in functions/main)
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;

// Token configuration
const TOKEN_NAME = process.env.TOKEN_NAME || 'TestToken';
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || 'TEST';
const TOKEN_DECIMALS = parseInt(process.env.TOKEN_DECIMALS || '6');
const TOTAL_SUPPLY = parseInt(process.env.TOTAL_SUPPLY || '1000000');
const DAO_ADMIN = process.env.DAO_ADMIN; // Optional: transfer mint authority to this address
const TOKEN_URI = process.env.TOKEN_URI || '';

// Lazy initialization - only created when needed
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

export interface CreateTokenResult {
  tokenMint: string;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  totalSupply: number;
  mintAuthority: string;
  tokenAccount: string;
  signature: string;
}

/**
 * Creates a new SPL token with metadata
 */
export async function createToken(options?: {
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: number;
  daoAdmin?: string;
  uri?: string;
  payer?: Keypair;
  connection?: Connection;
}): Promise<CreateTokenResult> {
  const opts = {
    name: options?.name || TOKEN_NAME,
    symbol: options?.symbol || TOKEN_SYMBOL,
    decimals: options?.decimals ?? TOKEN_DECIMALS,
    totalSupply: options?.totalSupply ?? TOTAL_SUPPLY,
    daoAdmin: options?.daoAdmin || DAO_ADMIN,
    uri: options?.uri || TOKEN_URI,
    payer: options?.payer || getDefaultPayer(),
    connection: options?.connection || getDefaultConnection(),
  };

  console.log('\n=== Creating New SPL Token ===\n');
  console.log(`Name: ${opts.name}`);
  console.log(`Symbol: ${opts.symbol}`);
  console.log(`Decimals: ${opts.decimals}`);
  console.log(`Total Supply: ${opts.totalSupply.toLocaleString()}`);
  console.log(`Payer: ${opts.payer.publicKey.toBase58()}`);
  if (opts.daoAdmin) {
    console.log(`DAO Admin (mint authority target): ${opts.daoAdmin}`);
  }

  // Generate new mint keypair
  const mintKeypair = Keypair.generate();
  console.log(`\nMint Address: ${mintKeypair.publicKey.toBase58()}`);

  // Get rent exemption
  const lamports = await getMinimumBalanceForRentExemptMint(opts.connection);

  // Calculate raw amount with decimals
  const rawAmount = BigInt(opts.totalSupply) * BigInt(10 ** opts.decimals);

  // Get associated token account for payer
  const tokenAccount = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    opts.payer.publicKey
  );

  // Build transaction for mint creation and token minting
  const transaction = new Transaction();

  // 1. Create mint account
  transaction.add(
    SystemProgram.createAccount({
      fromPubkey: opts.payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    })
  );

  // 2. Initialize mint (mint authority = payer initially)
  transaction.add(
    createInitializeMint2Instruction(
      mintKeypair.publicKey,
      opts.decimals,
      opts.payer.publicKey, // mint authority
      opts.payer.publicKey, // freeze authority (can be null)
      TOKEN_PROGRAM_ID
    )
  );

  // 3. Create associated token account for payer
  transaction.add(
    createAssociatedTokenAccountInstruction(
      opts.payer.publicKey,
      tokenAccount,
      opts.payer.publicKey,
      mintKeypair.publicKey
    )
  );

  // 4. Mint total supply to payer
  transaction.add(
    createMintToInstruction(
      mintKeypair.publicKey,
      tokenAccount,
      opts.payer.publicKey,
      rawAmount
    )
  );

  // Send mint creation transaction
  const { blockhash } = await opts.connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = opts.payer.publicKey;

  const signature = await sendAndConfirmTransaction(
    opts.connection,
    transaction,
    [opts.payer, mintKeypair],
    { commitment: 'confirmed' }
  );

  console.log(`\nToken mint created!`);
  console.log(`Transaction: https://solscan.io/tx/${signature}`);
  console.log(`Token Account: ${tokenAccount.toBase58()}`);

  // 5. Create metadata using UMI (optional, can be skipped for test tokens)
  const skipMetadata = process.env.SKIP_METADATA === 'true';

  if (!skipMetadata) {
    try {
      console.log(`\nCreating metadata...`);
      const umi = createUmi(opts.connection.rpcEndpoint).use(mplTokenMetadata());
      const umiKeypair = umi.eddsa.createKeypairFromSecretKey(opts.payer.secretKey);
      umi.use(keypairIdentity(umiKeypair));

      const mintUmiPubkey = umiPublicKey(mintKeypair.publicKey.toBase58());

      await createMetadataAccountV3(umi, {
        mint: mintUmiPubkey,
        mintAuthority: umi.identity,
        payer: umi.identity,
        updateAuthority: umi.identity.publicKey,
        data: {
          name: opts.name,
          symbol: opts.symbol,
          uri: opts.uri,
          sellerFeeBasisPoints: 0,
          creators: none(),
          collection: none(),
          uses: none(),
        },
        isMutable: true,
        collectionDetails: none(),
      }).sendAndConfirm(umi);

      console.log(`Metadata created!`);
    } catch (metadataError: any) {
      console.log(`\n⚠️ Metadata creation failed (token still usable): ${metadataError.message}`);
      console.log(`Tip: Set SKIP_METADATA=true to skip metadata creation for test tokens.`);
    }
  } else {
    console.log(`\nSkipping metadata creation (SKIP_METADATA=true)`);
  }

  // Transfer mint authority to DAO admin if specified
  let finalMintAuthority = opts.payer.publicKey.toBase58();

  if (opts.daoAdmin) {
    console.log(`\n=== Transferring Mint Authority to DAO Admin ===\n`);
    const newAuthority = new PublicKey(opts.daoAdmin);

    const authSig = await setAuthority(
      opts.connection,
      opts.payer,
      mintKeypair.publicKey,
      opts.payer,
      AuthorityType.MintTokens,
      newAuthority
    );

    console.log(`Mint authority transferred to: ${opts.daoAdmin}`);
    console.log(`Transaction: https://solscan.io/tx/${authSig}`);
    finalMintAuthority = opts.daoAdmin;
  }

  const result: CreateTokenResult = {
    tokenMint: mintKeypair.publicKey.toBase58(),
    tokenName: opts.name,
    tokenSymbol: opts.symbol,
    decimals: opts.decimals,
    totalSupply: opts.totalSupply,
    mintAuthority: finalMintAuthority,
    tokenAccount: tokenAccount.toBase58(),
    signature,
  };

  console.log('\n=== Token Creation Complete ===\n');
  console.log(JSON.stringify(result, null, 2));

  return result;
}

// Main execution
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              Create Token Script                             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const payer = getDefaultPayer();
  const connection = getDefaultConnection();

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`\nPayer: ${payer.publicKey.toBase58()}`);
  console.log(`Balance: ${balance / 1e9} SOL`);

  if (balance < 0.01 * 1e9) {
    throw new Error('Insufficient balance. Need at least 0.01 SOL.');
  }

  const result = await createToken();
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
      process.exit(1);
    });
}
