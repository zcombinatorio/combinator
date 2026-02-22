/**
 * Meteora DBC Launch Script
 *
 * Creates a custom Dynamic Bonding Curve config and launches a token pool on it.
 *
 * Curve: Pumpfun-like with 2x migration liquidity
 *   - Starting mcap: ~30 SOL
 *   - Migration mcap: ~400 SOL FDV
 *   - SOL raised at migration: ~170 SOL (2x pumpfun's ~85)
 *   - Token supply into AMM LP: ~42.5%
 *   - LP: locked to partner, 1-day cliff vest (effectively unlocked after 24h)
 *   - Mint authority: PartnerUpdateAndMintAuthority → feeClaimer address
 *
 * Usage:
 *   # Create new config + launch token with image:
 *   TOKEN_NAME="MyToken" TOKEN_SYMBOL="MTK" TOKEN_IMAGE=./logo.png \
 *     pnpm tsx scripts/create-dbc-launch.ts
 *
 *   # With pre-existing metadata URI (skips Pinata upload):
 *   TOKEN_NAME="MyToken" TOKEN_SYMBOL="MTK" TOKEN_URI="https://..." \
 *     pnpm tsx scripts/create-dbc-launch.ts
 *
 *   # Launch token on existing config:
 *   DBC_CONFIG=<address> TOKEN_NAME="MyToken" TOKEN_SYMBOL="MTK" TOKEN_IMAGE=./logo.png \
 *     pnpm tsx scripts/create-dbc-launch.ts
 *
 * Required ENV:
 *   - RPC_URL
 *   - PAYER_PRIVATE_KEY (or DAO_PRIVATE_KEY): Any funded wallet to pay for txs
 *   - TOKEN_NAME, TOKEN_SYMBOL
 *   - PINATA_JWT + PINATA_GATEWAY_URL (if using TOKEN_IMAGE)
 *
 * Optional ENV:
 *   - TOKEN_IMAGE: Path to image file (uploads to Pinata, builds metadata JSON)
 *   - TOKEN_URI: Pre-built metadata URI (skips image/metadata upload)
 *   - TOKEN_DESCRIPTION: Token description for metadata
 *   - DBC_CONFIG: Existing config address (skips config creation)
 *   - MINT_AUTHORITY: Address for mint authority (default: Hq7Xh37tT4sesD6wA4DphYfxeMJRhhFWS3KVUSSGjqzc)
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import axios from 'axios';
import FormData from 'form-data';
import {
  PartnerService,
  DynamicBondingCurveClient,
  buildCurve,
  MigrationOption,
  TokenDecimal,
  ActivationType,
  CollectFeeMode,
  MigrationFeeOption,
  TokenType,
  BaseFeeMode,
  TokenUpdateAuthorityOption,
  DammV2DynamicFeeMode,
} from '@meteora-ag/dynamic-bonding-curve-sdk';

// --- Config ---
const RPC_URL = process.env.RPC_URL;
const PAYER_KEY = process.env.PAYER_PRIVATE_KEY || process.env.DAO_PRIVATE_KEY;
const EXISTING_CONFIG = process.env.DBC_CONFIG;
const TOKEN_NAME = process.env.TOKEN_NAME;
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL;
const TOKEN_IMAGE = process.env.TOKEN_IMAGE;
const TOKEN_DESCRIPTION = process.env.TOKEN_DESCRIPTION || '';
const TOKEN_URI = process.env.TOKEN_URI;
const MINT_AUTHORITY = process.env.MINT_AUTHORITY || 'Hq7Xh37tT4sesD6wA4DphYfxeMJRhhFWS3KVUSSGjqzc';

const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

if (!RPC_URL) throw new Error('RPC_URL required');
if (!PAYER_KEY) throw new Error('PAYER_PRIVATE_KEY or DAO_PRIVATE_KEY required');
if (!TOKEN_NAME) throw new Error('TOKEN_NAME required');
if (!TOKEN_SYMBOL) throw new Error('TOKEN_SYMBOL required');
if (!TOKEN_URI && !TOKEN_IMAGE) throw new Error('TOKEN_URI or TOKEN_IMAGE required');

const payerKeypair = Keypair.fromSecretKey(bs58.decode(PAYER_KEY));
const connection = new Connection(RPC_URL, 'confirmed');
const mintAuthority = new PublicKey(MINT_AUTHORITY);

// =============================================================
// Pinata Upload (image + metadata)
// =============================================================
async function uploadImageToPinata(imagePath: string): Promise<string> {
  const PINATA_JWT = process.env.PINATA_JWT;
  const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL;
  if (!PINATA_JWT || !PINATA_GATEWAY) throw new Error('PINATA_JWT and PINATA_GATEWAY_URL required for image upload');

  const resolved = path.resolve(imagePath);
  if (!fs.existsSync(resolved)) throw new Error(`Image not found: ${resolved}`);

  const data = new FormData();
  data.append('file', fs.createReadStream(resolved));
  data.append('pinataMetadata', JSON.stringify({ name: `${TOKEN_SYMBOL}_image` }));

  const res = await axios.post<{ IpfsHash: string }>(
    'https://api.pinata.cloud/pinning/pinFileToIPFS',
    data,
    { headers: { Authorization: `Bearer ${PINATA_JWT}`, ...data.getHeaders() } },
  );

  if (!res.data?.IpfsHash) throw new Error(`Image upload failed: ${JSON.stringify(res.data)}`);
  return `${PINATA_GATEWAY}/ipfs/${res.data.IpfsHash}`;
}

async function uploadMetadataToPinata(imageUrl: string): Promise<string> {
  const PINATA_JWT = process.env.PINATA_JWT;
  const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL;
  if (!PINATA_JWT || !PINATA_GATEWAY) throw new Error('PINATA_JWT and PINATA_GATEWAY_URL required');

  const metadata = {
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    description: TOKEN_DESCRIPTION,
    image: imageUrl,
  };

  const data = new FormData();
  data.append('file', Buffer.from(JSON.stringify(metadata)), {
    filename: 'metadata.json',
    contentType: 'application/json',
  });
  data.append('pinataMetadata', JSON.stringify({ name: `${TOKEN_SYMBOL}_metadata` }));

  const res = await axios.post<{ IpfsHash: string }>(
    'https://api.pinata.cloud/pinning/pinFileToIPFS',
    data,
    { headers: { Authorization: `Bearer ${PINATA_JWT}`, ...data.getHeaders() } },
  );

  if (!res.data?.IpfsHash) throw new Error(`Metadata upload failed: ${JSON.stringify(res.data)}`);
  return `${PINATA_GATEWAY}/ipfs/${res.data.IpfsHash}`;
}

async function resolveTokenUri(): Promise<string> {
  if (TOKEN_URI) return TOKEN_URI;

  console.log('\n--- Uploading to Pinata ---');
  const imageUrl = await uploadImageToPinata(TOKEN_IMAGE!);
  console.log('Image:', imageUrl);

  const metadataUrl = await uploadMetadataToPinata(imageUrl);
  console.log('Metadata:', metadataUrl);

  return metadataUrl;
}

// =============================================================
// Step 1: Create DBC Config
// =============================================================
async function createDbcConfig(): Promise<PublicKey> {
  const partnerService = new PartnerService(connection, 'confirmed');
  const configKeypair = Keypair.generate();

  // Pumpfun-like curve with 2x migration liquidity:
  //   - 1B supply, 6 decimals (SPL token)
  //   - 42.5% of supply reserved for migration LP (~425M tokens)
  //   - ~170 SOL migration threshold (2x pumpfun's ~85)
  //   - At migration: 170 SOL + 425M tokens in AMM
  //     → migration price = 170/425M = 4e-7 SOL/token → ~400 SOL FDV
  const configParams = buildCurve({
    totalTokenSupply: 1_000_000_000,
    tokenBaseDecimal: TokenDecimal.SIX,
    tokenQuoteDecimal: TokenDecimal.NINE, // SOL = 9 decimals

    // Curve shape: explicit threshold + supply split
    percentageSupplyOnMigration: 42.5,
    migrationQuoteThreshold: 170, // SOL raised before migration

    // Migration → DAMM V2, no migration fees
    migrationOption: MigrationOption.MET_DAMM_V2,
    migrationFeeOption: MigrationFeeOption.Customizable,
    migrationFee: {
      feePercentage: 0,
      creatorFeePercentage: 0,
    },

    // Token: SPL, mintable by partner
    tokenType: TokenType.SPL,
    tokenUpdateAuthority: TokenUpdateAuthorityOption.PartnerUpdateAndMintAuthority,
    activationType: ActivationType.Timestamp,

    // Trading fee: 1% flat (pumpfun-like)
    baseFeeParams: {
      baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: {
        startingFeeBps: 100,
        endingFeeBps: 100,
        numberOfPeriod: 0,
        totalDuration: 0,
      },
    },
    dynamicFeeEnabled: false,
    collectFeeMode: CollectFeeMode.QuoteToken,

    // LP distribution: all LP tokens to partner (locked, 1-day vest)
    partnerLpPercentage: 0,
    creatorLpPercentage: 0,
    partnerLockedLpPercentage: 100,
    creatorLockedLpPercentage: 0,

    // No creator trading fee (partner collects via partner fee)
    creatorTradingFeePercentage: 0,

    // LP vesting: 100% unlocked after 1 day (cliff = full amount, no gradual vest)
    lockedVestingParam: {
      totalLockedVestingAmount: 100,
      numberOfVestingPeriod: 1,
      cliffUnlockAmount: 100,
      totalVestingDuration: 86400, // 1 day in seconds
      cliffDurationFromMigrationTime: 86400, // cliff at 1 day post-migration
    },

    // Post-migration DAMM V2 pool fee
    migratedPoolFee: {
      collectFeeMode: CollectFeeMode.QuoteToken,
      dynamicFee: DammV2DynamicFeeMode.Disabled,
      poolFeeBps: 100, // 1%
    },

    leftover: 0,
  });

  const tx = await partnerService.createConfig({
    ...configParams,
    config: configKeypair.publicKey,
    feeClaimer: mintAuthority,
    leftoverReceiver: mintAuthority,
    quoteMint: SOL_MINT,
    payer: payerKeypair.publicKey,
  });

  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [payerKeypair, configKeypair],
    { commitment: 'confirmed' },
  );

  console.log('Config created:', configKeypair.publicKey.toBase58());
  console.log('  Tx:', signature);

  return configKeypair.publicKey;
}

// =============================================================
// Step 2: Launch Token (create pool on config)
// =============================================================
async function launchToken(configAddress: PublicKey, uri: string): Promise<{
  baseMint: string;
  signature: string;
}> {
  const client = new DynamicBondingCurveClient(connection, 'confirmed');
  const baseMintKeypair = Keypair.generate();

  const tx = await client.pool.createPool({
    baseMint: baseMintKeypair.publicKey,
    config: configAddress,
    name: TOKEN_NAME!,
    symbol: TOKEN_SYMBOL!,
    uri,
    payer: payerKeypair.publicKey,
    poolCreator: payerKeypair.publicKey,
  });

  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [payerKeypair, baseMintKeypair],
    { commitment: 'confirmed' },
  );

  console.log('Token launched:', baseMintKeypair.publicKey.toBase58());
  console.log('  Tx:', signature);

  return {
    baseMint: baseMintKeypair.publicKey.toBase58(),
    signature,
  };
}

// =============================================================
// Main
// =============================================================
async function main() {
  console.log('=== Meteora DBC Launch ===');
  console.log('Payer:', payerKeypair.publicKey.toBase58());
  console.log('Mint Authority:', MINT_AUTHORITY);
  console.log('Token:', TOKEN_NAME, `(${TOKEN_SYMBOL})`);
  console.log('Image:', TOKEN_IMAGE || '(using TOKEN_URI)');

  const uri = await resolveTokenUri();

  let configAddress: PublicKey;

  if (EXISTING_CONFIG) {
    configAddress = new PublicKey(EXISTING_CONFIG);
    console.log('\nUsing existing config:', EXISTING_CONFIG);
  } else {
    console.log('\n--- Creating DBC Config ---');
    configAddress = await createDbcConfig();
  }

  console.log('\n--- Launching Token ---');
  const result = await launchToken(configAddress, uri);

  console.log('\n=== Done ===');
  console.log('Config:', configAddress.toBase58());
  console.log('Token Mint:', result.baseMint);
  console.log('Tx:', result.signature);
  console.log(`Solscan: https://solscan.io/token/${result.baseMint}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
