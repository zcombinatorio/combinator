/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
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
