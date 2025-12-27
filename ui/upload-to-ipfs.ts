import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';

/**
 * Script to upload image and metadata to IPFS via Pinata
 *
 * Required ENV variables:
 * - PINATA_JWT: Pinata API JWT token
 *
 * Usage:
 *   PINATA_JWT=<jwt> tsx upload-to-ipfs.ts
 */

const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL || '';

// === CONFIGURE THESE ===

// Path to the image file (set to null to skip image upload and use existing URL)
const IMAGE_PATH: string | null = null;

// If you already have an image URL, set it here and set IMAGE_PATH to null
const EXISTING_IMAGE_URL: string | null = 'https://pbs.twimg.com/profile_images/1991222874401587200/V0ARKOcE_400x400.jpg';

// Token metadata
const TOKEN_NAME = 'Combinator';
const TOKEN_SYMBOL = 'ZC';
const TOKEN_DESCRIPTION = 'Decision market infrastructure';
const TWITTER = 'https://x.com/combinatortrade';  // optional, set to empty string to omit
const WEBSITE = 'https://combinator.trade';  // optional, set to empty string to omit

// ========================

async function uploadImage(imagePath: string): Promise<string> {
  const absolutePath = path.resolve(imagePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Image not found at: ${absolutePath}`);
  }

  console.log(`Uploading image: ${absolutePath}`);

  const formData = new FormData();
  formData.append('file', fs.createReadStream(absolutePath));
  formData.append('pinataMetadata', JSON.stringify({
    name: path.basename(absolutePath)
  }));

  const response = await axios.post<{ IpfsHash: string }>(
    'https://api.pinata.cloud/pinning/pinFileToIPFS',
    formData,
    {
      headers: {
        'Authorization': `Bearer ${process.env.PINATA_JWT}`,
        ...formData.getHeaders()
      }
    }
  );

  const ipfsHash = response.data.IpfsHash;
  const gatewayUrl = `${PINATA_GATEWAY}/ipfs/${ipfsHash}`;

  console.log('Image uploaded!');
  console.log(`  IPFS Hash: ${ipfsHash}`);
  console.log(`  URL: ${gatewayUrl}`);

  return gatewayUrl;
}

async function uploadMetadata(metadata: object): Promise<string> {
  console.log('\nUploading metadata:');
  console.log(JSON.stringify(metadata, null, 2));

  const response = await axios.post<{ IpfsHash: string }>(
    'https://api.pinata.cloud/pinning/pinJSONToIPFS',
    {
      pinataContent: metadata,
      pinataMetadata: {
        name: `${TOKEN_SYMBOL}-metadata.json`
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PINATA_JWT}`
      }
    }
  );

  const ipfsHash = response.data.IpfsHash;
  const gatewayUrl = `${PINATA_GATEWAY}/ipfs/${ipfsHash}`;

  console.log('\nMetadata uploaded!');
  console.log(`  IPFS Hash: ${ipfsHash}`);
  console.log(`  URL: ${gatewayUrl}`);

  return gatewayUrl;
}

async function main() {
  if (!process.env.PINATA_JWT) {
    console.error('Error: PINATA_JWT environment variable is required');
    process.exit(1);
  }

  console.log('Upload to IPFS via Pinata');
  console.log('=========================\n');

  // Step 1: Upload image (or use existing)
  let imageUrl: string;

  if (IMAGE_PATH) {
    imageUrl = await uploadImage(IMAGE_PATH);
  } else if (EXISTING_IMAGE_URL) {
    imageUrl = EXISTING_IMAGE_URL;
    console.log(`Using existing image URL: ${imageUrl}`);
  } else {
    console.error('Error: Either IMAGE_PATH or EXISTING_IMAGE_URL must be set');
    process.exit(1);
  }

  // Step 2: Build and upload metadata
  const metadata: Record<string, string> = {
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    description: TOKEN_DESCRIPTION,
    image: imageUrl,
  };

  if (TWITTER) {
    metadata.twitter = TWITTER;
  }
  if (WEBSITE) {
    metadata.website = WEBSITE;
  }

  const metadataUrl = await uploadMetadata(metadata);

  // Summary
  console.log('\n=========================');
  console.log('Done! Use this URI in update-token-metadata.ts:\n');
  console.log(`NEW_URI = '${metadataUrl}'`);
}

main().catch((error) => {
  console.error('\nError:', error.message);
  process.exit(1);
});
