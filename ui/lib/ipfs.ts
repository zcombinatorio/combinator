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

/**
 * IPFS utilities for uploading metadata via Pinata
 */

const PINATA_API_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

interface PinataResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

/**
 * Upload JSON metadata to IPFS via Pinata
 * Returns the IPFS CID (hash)
 */
export async function uploadToIPFS(
  content: Record<string, unknown>,
  name?: string
): Promise<string> {
  const pinataJwt = process.env.PINATA_JWT;
  if (!pinataJwt) {
    throw new Error('PINATA_JWT environment variable is not set');
  }

  const response = await fetch(PINATA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${pinataJwt}`,
    },
    body: JSON.stringify({
      pinataContent: content,
      pinataMetadata: {
        name: name || 'metadata.json',
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pinata upload failed: ${response.status} - ${errorText}`);
  }

  const data: PinataResponse = await response.json();
  return data.IpfsHash;
}

/**
 * Upload proposal metadata to IPFS
 * Returns the IPFS CID
 */
export async function uploadProposalMetadata(
  title: string,
  description: string,
  options: string[]
): Promise<string> {
  const metadata = {
    title,
    description,
    options,
    created_at: new Date().toISOString(),
  };

  return uploadToIPFS(metadata, `proposal-${Date.now()}.json`);
}
