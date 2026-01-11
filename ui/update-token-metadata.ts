import {
  fetchDigitalAsset,
  mplTokenMetadata,
  updateV1,
} from '@metaplex-foundation/mpl-token-metadata';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import bs58 from 'bs58';
import 'dotenv/config';

/**
 * Script to update SPL token metadata
 *
 * Required ENV variables:
 * - PAYER_PRIVATE_KEY: Private key of update authority wallet (Base58)
 * - RPC_URL: Solana RPC endpoint
 *
 * Usage:
 *   PAYER_PRIVATE_KEY=<key> RPC_URL=<url> tsx update-token-metadata.ts
 */

// Token mint address to update
const MINT_ADDRESS = 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC';

// New metadata values (set to null to keep existing value)
const NEW_NAME: string | null = 'Combinator';        // e.g., 'My New Token Name'
const NEW_SYMBOL: string | null = 'ZC';      // e.g., 'NEW'
const NEW_URI: string | null = 'https://olive-imaginative-aardvark-508.mypinata.cloud/ipfs/QmSULXToDvT2vtpvwyzV2fBpcXA7Cncz3WMFZ2v5Vnv1fC';         // e.g., 'https://arweave.net/...'

async function updateTokenMetadata() {
  const PAYER_PRIVATE_KEY = process.env.DAO_PRIVATE_KEY;
  const RPC_URL = process.env.RPC_URL;

  if (!PAYER_PRIVATE_KEY) {
    console.error('Error: PAYER_PRIVATE_KEY environment variable is required');
    process.exit(1);
  }

  if (!RPC_URL) {
    console.error('Error: RPC_URL environment variable is required');
    process.exit(1);
  }

  console.log('Token Metadata Update');
  console.log('=====================');
  console.log(`RPC URL: ${RPC_URL}`);
  console.log(`Mint Address: ${MINT_ADDRESS}`);
  console.log();

  // Create Umi instance with Token Metadata plugin
  const umi = createUmi(RPC_URL).use(mplTokenMetadata());

  // Create keypair from private key
  const secretKey = bs58.decode(PAYER_PRIVATE_KEY);
  const keypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
  umi.use(keypairIdentity(keypair));

  console.log(`Update Authority: ${keypair.publicKey}`);
  console.log();

  // Fetch existing metadata
  console.log('Fetching current metadata...');
  const mintPubkey = publicKey(MINT_ADDRESS);
  const asset = await fetchDigitalAsset(umi, mintPubkey);

  console.log('Current metadata:');
  console.log(`  Name: ${asset.metadata.name}`);
  console.log(`  Symbol: ${asset.metadata.symbol}`);
  console.log(`  URI: ${asset.metadata.uri}`);
  console.log(`  Is Mutable: ${asset.metadata.isMutable}`);
  console.log(`  Update Authority: ${asset.metadata.updateAuthority}`);
  console.log();

  // Check if token is mutable
  if (!asset.metadata.isMutable) {
    console.error('Error: Token metadata is immutable and cannot be updated');
    process.exit(1);
  }

  // Check if we have update authority
  if (asset.metadata.updateAuthority.toString() !== keypair.publicKey.toString()) {
    console.error('Error: Provided keypair is not the update authority');
    console.error(`  Expected: ${asset.metadata.updateAuthority}`);
    console.error(`  Got: ${keypair.publicKey}`);
    process.exit(1);
  }

  // Prepare new metadata
  const newName = NEW_NAME ?? asset.metadata.name;
  const newSymbol = NEW_SYMBOL ?? asset.metadata.symbol;
  const newUri = NEW_URI ?? asset.metadata.uri;

  // Check if anything is actually changing
  if (newName === asset.metadata.name &&
      newSymbol === asset.metadata.symbol &&
      newUri === asset.metadata.uri) {
    console.log('No changes specified. Set NEW_NAME, NEW_SYMBOL, or NEW_URI in the script.');
    process.exit(0);
  }

  console.log('New metadata:');
  console.log(`  Name: ${newName}${newName !== asset.metadata.name ? ' (changed)' : ''}`);
  console.log(`  Symbol: ${newSymbol}${newSymbol !== asset.metadata.symbol ? ' (changed)' : ''}`);
  console.log(`  URI: ${newUri}${newUri !== asset.metadata.uri ? ' (changed)' : ''}`);
  console.log();

  process.exit(0);

  // Update metadata
  console.log('Updating metadata...');
  const result = await updateV1(umi, {
    mint: mintPubkey,
    authority: umi.identity,
    data: {
      ...asset.metadata,
      name: newName,
      symbol: newSymbol,
      uri: newUri,
    },
  }).sendAndConfirm(umi);

  console.log('Metadata updated successfully!');
  console.log(`Transaction signature: ${bs58.encode(result.signature)}`);
  console.log(`Solscan: https://solscan.io/tx/${bs58.encode(result.signature)}`);
}

updateTokenMetadata().catch(console.error);
