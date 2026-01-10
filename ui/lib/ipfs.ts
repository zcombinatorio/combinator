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
 * IPFS utilities for uploading metadata
 * Supports both Kubo RPC API (self-hosted) and Pinata
 *
 * Environment variables:
 *   IPFS_API_URL     - Kubo API base URL (e.g., https://web.hm.sivalik.com/cmb/ipfs)
 *   IPFS_BASIC_AUTH  - Basic auth credentials for Kubo (e.g., user:password)
 *   PINATA_JWT       - Pinata JWT token (fallback if Kubo not configured)
 *   PINATA_GATEWAY_URL - Gateway URL for fetching (used with Pinata)
 *
 * Priority: Kubo > Pinata
 */

const PINATA_API_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

interface PinataResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

interface KuboAddResponse {
  Name: string;
  Hash: string;
  Size: string;
}

export interface ProposalMetadata {
  title: string;
  description: string;
  options: string[];
  dao_pda: string;
  created_at: string;
}

/**
 * Check if Kubo IPFS is configured
 */
function isKuboConfigured(): boolean {
  return !!(process.env.IPFS_API_URL && process.env.IPFS_BASIC_AUTH);
}

/**
 * Get Basic Auth header value for Kubo
 */
function getKuboAuthHeader(): string {
  const auth = process.env.IPFS_BASIC_AUTH || '';
  return 'Basic ' + Buffer.from(auth).toString('base64');
}

/**
 * Upload JSON metadata to IPFS via Kubo RPC API
 */
async function uploadToKubo(
  content: object,
  _name?: string
): Promise<string> {
  const apiUrl = process.env.IPFS_API_URL;
  const jsonData = JSON.stringify(content);

  // Kubo /api/v0/add expects multipart form-data
  const formData = new FormData();
  const blob = new Blob([jsonData], { type: 'application/json' });
  formData.append('file', blob);

  const response = await fetch(`${apiUrl}/api/v0/add`, {
    method: 'POST',
    headers: {
      'Authorization': getKuboAuthHeader(),
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kubo IPFS upload failed: ${response.status} - ${errorText}`);
  }

  const data: KuboAddResponse = await response.json();
  return data.Hash;
}

/**
 * Upload JSON metadata to IPFS via Pinata
 */
async function uploadToPinata(
  content: object,
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
 * Upload JSON metadata to IPFS
 * Returns the IPFS CID (hash)
 * Uses Kubo if configured, otherwise falls back to Pinata
 */
export async function uploadToIPFS(
  content: object,
  name?: string
): Promise<string> {
  if (isKuboConfigured()) {
    return uploadToKubo(content, name);
  }
  return uploadToPinata(content, name);
}

/**
 * Upload proposal metadata to IPFS
 * Returns the IPFS CID
 *
 * @param dao_pda - The DAO this proposal belongs to (for filtering proposals by DAO)
 */
export async function uploadProposalMetadata(
  title: string,
  description: string,
  options: string[],
  dao_pda: string
): Promise<string> {
  const metadata: ProposalMetadata = {
    title,
    description,
    options,
    dao_pda,
    created_at: new Date().toISOString(),
  };

  return uploadToIPFS(metadata, `proposal-${Date.now()}.json`);
}

/**
 * Get the Pinata gateway URL for fetching IPFS content.
 * Uses the dedicated gateway from PINATA_GATEWAY_URL env var for faster, more reliable access.
 * Falls back to public gateway if not configured.
 */
export function getPinataGatewayUrl(): string {
  return process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';
}

/**
 * Build full IPFS URL for a given CID.
 * Note: For Kubo, use fetchFromIPFS() instead as it requires POST with auth.
 * This function is kept for backward compatibility with Pinata gateway URLs.
 */
export function getIpfsUrl(cid: string): string {
  const gateway = getPinataGatewayUrl();
  return `${gateway}/ipfs/${cid}`;
}

/**
 * Fetch content from IPFS by CID.
 * Uses Kubo /api/v0/cat if configured, otherwise fetches from Pinata gateway.
 * Returns the parsed JSON content.
 */
export async function fetchFromIPFS<T = unknown>(cid: string): Promise<T> {
  if (isKuboConfigured()) {
    const apiUrl = process.env.IPFS_API_URL;
    const response = await fetch(`${apiUrl}/api/v0/cat?arg=${cid}`, {
      method: 'POST',
      headers: {
        'Authorization': getKuboAuthHeader(),
      },
    });

    if (!response.ok) {
      throw new Error(`Kubo IPFS fetch failed: ${response.status}`);
    }

    return response.json();
  }

  // Fallback to Pinata gateway (simple GET)
  const response = await fetch(getIpfsUrl(cid));
  if (!response.ok) {
    throw new Error(`IPFS gateway fetch failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch raw content from IPFS by CID (as text).
 * Uses Kubo /api/v0/cat if configured, otherwise fetches from Pinata gateway.
 */
export async function fetchRawFromIPFS(cid: string): Promise<string> {
  if (isKuboConfigured()) {
    const apiUrl = process.env.IPFS_API_URL;
    const response = await fetch(`${apiUrl}/api/v0/cat?arg=${cid}`, {
      method: 'POST',
      headers: {
        'Authorization': getKuboAuthHeader(),
      },
    });

    if (!response.ok) {
      throw new Error(`Kubo IPFS fetch failed: ${response.status}`);
    }

    return response.text();
  }

  // Fallback to Pinata gateway (simple GET)
  const response = await fetch(getIpfsUrl(cid));
  if (!response.ok) {
    throw new Error(`IPFS gateway fetch failed: ${response.status}`);
  }

  return response.text();
}
