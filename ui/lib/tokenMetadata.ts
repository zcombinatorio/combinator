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

import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// In-memory cache for token decimals (mint -> decimals)
const tokenDecimalsCache = new Map<string, number>();

/**
 * Fetch the decimals for a token mint.
 * Supports both Token and Token-2022 programs.
 * Results are cached in memory (decimals never change for a mint).
 */
export async function getTokenDecimals(
  connection: Connection,
  mintAddress: string
): Promise<number> {
  // Check cache first
  if (tokenDecimalsCache.has(mintAddress)) {
    return tokenDecimalsCache.get(mintAddress)!;
  }

  try {
    const mint = new PublicKey(mintAddress);

    // First, fetch the account to determine which program owns it
    const accountInfo = await connection.getAccountInfo(mint);
    if (!accountInfo) {
      throw new Error(`Mint account not found: ${mintAddress}`);
    }

    // Determine the program ID based on account owner
    let programId: PublicKey;
    if (accountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
      programId = TOKEN_PROGRAM_ID;
    } else if (accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      programId = TOKEN_2022_PROGRAM_ID;
    } else {
      throw new Error(`Unknown token program owner: ${accountInfo.owner.toBase58()}`);
    }

    const mintInfo = await getMint(connection, mint, undefined, programId);
    const decimals = mintInfo.decimals;
    tokenDecimalsCache.set(mintAddress, decimals);
    return decimals;
  } catch (error) {
    console.error(`Failed to fetch token decimals for ${mintAddress}:`, error);
    throw error;
  }
}

/**
 * Batch fetch decimals for multiple tokens.
 * Returns a map of mint address -> decimals.
 */
export async function getTokenDecimalsBatch(
  connection: Connection,
  mintAddresses: string[]
): Promise<Map<string, number>> {
  const results = new Map<string, number>();

  // Fetch in parallel with a concurrency limit
  const BATCH_SIZE = 10;
  for (let i = 0; i < mintAddresses.length; i += BATCH_SIZE) {
    const batch = mintAddresses.slice(i, i + BATCH_SIZE);
    const decimals = await Promise.all(
      batch.map(mint => getTokenDecimals(connection, mint))
    );
    batch.forEach((mint, idx) => {
      results.set(mint, decimals[idx]);
    });
  }

  return results;
}

// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// In-memory cache for token icons (mint -> icon URL)
const tokenIconCache = new Map<string, string | null>();

/**
 * Derive the Metaplex metadata PDA for a token mint.
 */
function deriveMetadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

/**
 * Fetch the icon URL for a token from its Metaplex metadata.
 * Returns null if metadata doesn't exist or has no image.
 * Results are cached in memory.
 */
export async function getTokenIcon(
  connection: Connection,
  mintAddress: string
): Promise<string | null> {
  // Check cache first
  if (tokenIconCache.has(mintAddress)) {
    return tokenIconCache.get(mintAddress) ?? null;
  }

  try {
    const mint = new PublicKey(mintAddress);
    const metadataPDA = deriveMetadataPDA(mint);

    // Fetch the metadata account
    const accountInfo = await connection.getAccountInfo(metadataPDA);
    if (!accountInfo) {
      tokenIconCache.set(mintAddress, null);
      return null;
    }

    // Parse the metadata account data
    // The URI starts at offset 65 + name length + symbol length
    // Simplified parsing: look for the URI field
    const data = accountInfo.data;

    // Skip: key (1) + update_auth (32) + mint (32) = 65 bytes
    // Then: name (4 byte len + data), symbol (4 byte len + data), uri (4 byte len + data)
    let offset = 65;

    // Read name length (4 bytes, little endian)
    const nameLen = data.readUInt32LE(offset);
    offset += 4 + nameLen;

    // Read symbol length (4 bytes, little endian)
    const symbolLen = data.readUInt32LE(offset);
    offset += 4 + symbolLen;

    // Read URI length (4 bytes, little endian)
    const uriLen = data.readUInt32LE(offset);
    offset += 4;

    // Read URI
    const uri = data.slice(offset, offset + uriLen).toString('utf8').replace(/\0/g, '').trim();

    if (!uri) {
      tokenIconCache.set(mintAddress, null);
      return null;
    }

    // Fetch the JSON metadata from the URI
    const response = await fetch(uri, {
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    if (!response.ok) {
      tokenIconCache.set(mintAddress, null);
      return null;
    }

    const metadata = await response.json();
    const icon = metadata.image || null;

    tokenIconCache.set(mintAddress, icon);
    return icon;
  } catch (error) {
    console.warn(`Failed to fetch token icon for ${mintAddress}:`, error);
    tokenIconCache.set(mintAddress, null);
    return null;
  }
}

/**
 * Batch fetch icons for multiple tokens.
 * Returns a map of mint address -> icon URL (or null).
 */
export async function getTokenIcons(
  connection: Connection,
  mintAddresses: string[]
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();

  // Fetch in parallel with a concurrency limit
  const BATCH_SIZE = 10;
  for (let i = 0; i < mintAddresses.length; i += BATCH_SIZE) {
    const batch = mintAddresses.slice(i, i + BATCH_SIZE);
    const icons = await Promise.all(
      batch.map(mint => getTokenIcon(connection, mint))
    );
    batch.forEach((mint, idx) => {
      results.set(mint, icons[idx]);
    });
  }

  return results;
}
