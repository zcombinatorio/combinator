/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import FormData from 'form-data';
import axios from 'axios';
import { recordTokenLaunch } from './db';

interface TokenMetadata {
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  website?: string;
  twitter?: string;
  caEnding?: string;
}

export async function uploadMetadataToPinata(metadata: TokenMetadata): Promise<string> {
  if (!metadata.name || !metadata.symbol) {
    throw new Error('Name and symbol are required');
  }

  const data = new FormData();
  data.append('file', Buffer.from(JSON.stringify(metadata)), {
    filename: 'metadata.json',
    contentType: 'application/json',
  });
  data.append(
    'pinataMetadata',
    JSON.stringify({ name: `${metadata.symbol}_metadata` })
  );

  const config = {
    headers: {
      Authorization: `Bearer ${process.env.PINATA_JWT}`,
      ...data.getHeaders(),
    },
  };

  const res = await axios.post<{ IpfsHash: string }>(
    'https://api.pinata.cloud/pinning/pinFileToIPFS',
    data,
    config
  );

  if (!res.data || !res.data.IpfsHash) {
    throw new Error(`Failed to upload metadata: ${JSON.stringify(res.data)}`);
  }

  return `${process.env.PINATA_GATEWAY_URL}/ipfs/${res.data.IpfsHash}`;
}

export async function generateTokenKeypair(caEnding?: string): Promise<Keypair> {
  if (!caEnding) {
    return Keypair.generate();
  }

  let keypair: Keypair;
  let attempts = 0;
  const maxAttempts = 10000000;

  do {
    keypair = Keypair.generate();
    attempts++;

    if (attempts % 10000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  } while (!keypair.publicKey.toString().endsWith(caEnding) && attempts < maxAttempts);

  if (!keypair.publicKey.toString().endsWith(caEnding)) {
    throw new Error(`Could not generate keypair ending with ${caEnding} after ${maxAttempts} attempts`);
  }

  return keypair;
}

export async function createLaunchTransaction(
  baseMintPublicKey: string,
  name: string,
  symbol: string,
  uri: string,
  payerPublicKey: string,
  quoteToken: 'SOL' | 'ZC' = 'SOL'
): Promise<{ transaction: string; baseMint: string }> {
  const RPC_URL = process.env.RPC_URL;
  const CONFIG_ADDRESS = process.env.CONFIG_ADDRESS;
  const FLYWHEEL_CONFIG_ADDRESS = process.env.FLYWHEEL_CONFIG_ADDRESS;

  if (!RPC_URL || !CONFIG_ADDRESS || !FLYWHEEL_CONFIG_ADDRESS) {
    throw new Error('RPC_URL, CONFIG_ADDRESS, and FLYWHEEL_CONFIG_ADDRESS must be configured');
  }

  if (quoteToken !== 'SOL' && quoteToken !== 'ZC') {
    throw new Error('Quote token must be SOL or ZC.');
  }

  const configAddress = quoteToken === 'ZC' ? FLYWHEEL_CONFIG_ADDRESS : CONFIG_ADDRESS;

  if (!baseMintPublicKey || !name || !symbol || !uri || !payerPublicKey) {
    throw new Error('Missing required parameters');
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const client = new DynamicBondingCurveClient(connection, "confirmed");

  const baseMint = new PublicKey(baseMintPublicKey);
  const payer = new PublicKey(payerPublicKey);

  const transaction = await client.pool.createPool({
    baseMint: baseMint,
    config: new PublicKey(configAddress),
    name,
    symbol,
    uri,
    payer,
    poolCreator: payer,
  });

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = payer;

  // Don't sign here - Phantom wallet needs to sign first to avoid security warnings

  const serializedTransaction = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false
  });

  return {
    transaction: bs58.encode(serializedTransaction),
    baseMint: baseMint.toString()
  };
}

export async function confirmAndRecordLaunch(
  transactionSignature: string,
  baseMint: string,
  name: string,
  symbol: string,
  uri: string,
  creatorWallet: string,
  creatorTwitter?: string,
  creatorGithub?: string
): Promise<{ success: boolean; confirmed: boolean; launch?: object; status?: string }> {
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) {
    throw new Error('RPC_URL not configured');
  }

  const connection = new Connection(RPC_URL, "confirmed");

  // Poll for confirmation status
  const maxAttempts = 20;
  const delayMs = 200;  // 200ms between polls
  let attempts = 0;

  while (attempts < maxAttempts) {
    const result = await connection.getSignatureStatus(transactionSignature, {
      searchTransactionHistory: true
    });

    console.log(`Attempt ${attempts + 1}: Transaction status:`, JSON.stringify(result, null, 2));

    if (!result || !result.value) {
      // Transaction not found yet, wait and retry
      attempts++;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      continue;
    }

    if (result.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
    }

    // If confirmed or finalized, we're done
    if (result.value.confirmationStatus === 'confirmed' ||
        result.value.confirmationStatus === 'finalized') {

      // await initializeDatabase();
      const launch = await recordTokenLaunch({
        creator_wallet: creatorWallet,
        token_address: baseMint,
        token_metadata_url: uri,
        token_name: name,
        token_symbol: symbol,
        creator_twitter: creatorTwitter,
        creator_github: creatorGithub
      });

      return {
        success: true,
        confirmed: true,
        launch,
        status: result.value.confirmationStatus
      };
    }

    // Still processing, wait and retry
    attempts++;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  // Timeout after max attempts
  throw new Error(`Transaction confirmation timeout after ${maxAttempts * delayMs / 1000} seconds`);
}

export interface LaunchTokenParams {
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  website?: string;
  twitter?: string;
  caEnding?: string;
  creatorTwitter?: string;
  creatorGithub?: string;
  payerPublicKey: string;
  quoteToken?: 'SOL' | 'ZC';
}

export async function launchToken(params: LaunchTokenParams) {
  // Step 1: Generate keypair
  const keypair = await generateTokenKeypair(params.caEnding);

  // Step 2: Upload metadata
  const metadataUrl = await uploadMetadataToPinata({
    name: params.name,
    symbol: params.symbol,
    description: params.description,
    image: params.image,
    website: params.website,
    twitter: params.twitter,
    caEnding: params.caEnding
  });

  // Step 3: Create launch transaction
  const { transaction, baseMint } = await createLaunchTransaction(
    keypair.publicKey.toString(),
    params.name,
    params.symbol,
    metadataUrl,
    params.payerPublicKey,
    params.quoteToken
  );

  // Step 4: Optimistically record launch in database
  // await initializeDatabase();
  await recordTokenLaunch({
    creator_wallet: params.payerPublicKey,
    token_address: baseMint,
    token_metadata_url: metadataUrl,
    token_name: params.name,
    token_symbol: params.symbol,
    creator_twitter: params.creatorTwitter,
    creator_github: params.creatorGithub
  });

  return {
    transaction,
    baseMint,
    metadataUrl,
    tokenKeypair: bs58.encode(keypair.secretKey)
  };
}

// Version without database recording for API /launch endpoint
export async function prepareTokenLaunch(params: LaunchTokenParams) {
  // Step 1: Generate keypair
  const keypair = await generateTokenKeypair(params.caEnding);

  // Step 2: Upload metadata
  const metadataUrl = await uploadMetadataToPinata({
    name: params.name,
    symbol: params.symbol,
    description: params.description,
    image: params.image,
    website: params.website,
    twitter: params.twitter,
    caEnding: params.caEnding
  });

  // Step 3: Create launch transaction (unsigned)
  const { transaction, baseMint } = await createLaunchTransaction(
    keypair.publicKey.toString(),
    params.name,
    params.symbol,
    metadataUrl,
    params.payerPublicKey,
    params.quoteToken
  );

  // Return without recording to database
  return {
    transaction,
    baseMint,
    metadataUrl,
    tokenKeypair: bs58.encode(keypair.secretKey)
  };
}