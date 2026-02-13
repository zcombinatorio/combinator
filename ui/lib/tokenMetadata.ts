/*
 * Combinator - Futarchy infrastructure for your project.
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
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
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
 * Batch fetch decimals for multiple tokens using getMultipleAccountsInfo.
 * Reads decimals at offset 44 of the SPL Mint layout (works for both Token and Token-2022).
 */
export async function getTokenDecimalsBatch(
  connection: Connection,
  mintAddresses: string[]
): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  const uncached: string[] = [];

  for (const mint of mintAddresses) {
    if (tokenDecimalsCache.has(mint)) {
      results.set(mint, tokenDecimalsCache.get(mint)!);
    } else if (!results.has(mint)) {
      uncached.push(mint);
    }
  }

  // Batch fetch all uncached mints in one RPC call (max 100 per call)
  for (let i = 0; i < uncached.length; i += 100) {
    const batch = uncached.slice(i, i + 100);
    const accounts = await connection.getMultipleAccountsInfo(batch.map(m => new PublicKey(m)));
    for (let j = 0; j < accounts.length; j++) {
      const info = accounts[j];
      if (!info || info.data.length < 45) continue;
      if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) continue;
      const decimals = info.data[44];
      tokenDecimalsCache.set(batch[j], decimals);
      results.set(batch[j], decimals);
    }
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
 * Batch fetch icons for multiple tokens using getMultipleAccountsInfo.
 * Fetches all Metaplex metadata accounts in one RPC call, then fetches JSON URIs in parallel.
 */
export async function getTokenIcons(
  connection: Connection,
  mintAddresses: string[]
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  const uncached: string[] = [];

  for (const mint of [...new Set(mintAddresses)]) {
    if (tokenIconCache.has(mint)) {
      results.set(mint, tokenIconCache.get(mint) ?? null);
    } else {
      uncached.push(mint);
    }
  }

  if (uncached.length === 0) return results;

  // Batch fetch all Metaplex metadata accounts
  const metadataPDAs = uncached.map(m => deriveMetadataPDA(new PublicKey(m)));
  const allAccounts: (import('@solana/web3.js').AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < metadataPDAs.length; i += 100) {
    const batch = metadataPDAs.slice(i, i + 100);
    allAccounts.push(...await connection.getMultipleAccountsInfo(batch));
  }

  // Parse URIs from on-chain metadata, then fetch JSON in parallel
  const uriFetches: Promise<void>[] = [];
  for (let i = 0; i < uncached.length; i++) {
    const mint = uncached[i];
    const info = allAccounts[i];
    if (!info) {
      tokenIconCache.set(mint, null);
      results.set(mint, null);
      continue;
    }

    try {
      const data = info.data;
      let offset = 65;
      const nameLen = data.readUInt32LE(offset);
      offset += 4 + nameLen;
      const symbolLen = data.readUInt32LE(offset);
      offset += 4 + symbolLen;
      const uriLen = data.readUInt32LE(offset);
      offset += 4;
      const uri = data.slice(offset, offset + uriLen).toString('utf8').replace(/\0/g, '').trim();

      if (!uri) {
        tokenIconCache.set(mint, null);
        results.set(mint, null);
        continue;
      }

      uriFetches.push(
        fetch(uri, { signal: AbortSignal.timeout(5000) })
          .then(r => r.ok ? r.json() : null)
          .then(metadata => {
            const icon = metadata?.image || null;
            tokenIconCache.set(mint, icon);
            results.set(mint, icon);
          })
          .catch(() => {
            tokenIconCache.set(mint, null);
            results.set(mint, null);
          })
      );
    } catch {
      tokenIconCache.set(mint, null);
      results.set(mint, null);
    }
  }

  await Promise.all(uriFetches);
  return results;
}
