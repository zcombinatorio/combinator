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

import { Keypair, Connection, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

// Minimum SOL balance for a managed wallet to operate
const MIN_WALLET_BALANCE_SOL = 0.05;
// Funding amount needs to cover proposal creation costs + buffer for rent-exempt reserves
const FUNDING_AMOUNT_SOL = 0.11;

// Minimum key index allowed for DAO operations (indices 0-8 are reserved)
const MIN_KEY_INDEX = 9;

// Historical DAO admin keys (migrated DAOs use env-based keys instead of key service)
// Format: HISTORICAL_ADMIN_KEY_<DAO_NAME>=<base58 private key>
const HISTORICAL_KEY_PREFIX = 'HISTORICAL_ADMIN_KEY_';

interface KeyServiceResponse {
  idx: number;
  keypair: string;  // Base58 encoded secret key
  account: string;  // Public key
}

/**
 * Fetch a keypair from the key management service by index
 */
export async function fetchKeypair(idx: number): Promise<Keypair> {
  if (idx < MIN_KEY_INDEX) {
    throw new Error(`Key index ${idx} is reserved. Minimum allowed index is ${MIN_KEY_INDEX}.`);
  }

  const keyServiceUrl = process.env.KEY_SERVICE_URL;
  if (!keyServiceUrl) {
    throw new Error('KEY_SERVICE_URL environment variable is not set');
  }
  const sivKey = process.env.SIV_KEY;
  if (!sivKey) {
    throw new Error('SIV_KEY environment variable is not set');
  }

  const response = await fetch(`${keyServiceUrl}?idx=${idx}`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${Buffer.from(sivKey).toString('base64')}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Key service error: ${response.status} ${response.statusText}`);
  }

  const data: KeyServiceResponse = await response.json();

  // The service returns a base58-encoded secret key
  const secretKey = bs58.decode(data.keypair);
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Get the public key for a key index without fetching the full keypair
 */
export async function getPublicKey(idx: number): Promise<string> {
  const keypair = await fetchKeypair(idx);
  return keypair.publicKey.toBase58();
}

/**
 * Get the protocol keypair from environment
 * Used for token minting/claims operations
 */
export function getProtocolKeypair(): Keypair {
  const protocolKey = process.env.PROTOCOL_PRIVATE_KEY;
  if (!protocolKey) {
    throw new Error('PROTOCOL_PRIVATE_KEY environment variable is not set');
  }

  const secretKey = bs58.decode(protocolKey);
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Get the DAO keypair from environment
 * Used for funding admin wallets and DAO testing operations
 */
export function getDaoKeypair(): Keypair {
  const daoKey = process.env.DAO_PRIVATE_KEY;
  if (!daoKey) {
    throw new Error('DAO_PRIVATE_KEY environment variable is not set');
  }

  const secretKey = bs58.decode(daoKey);
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Custom error class for admin key configuration issues
 * Provides both a client-friendly message and internal details for logging
 */
export class AdminKeyError extends Error {
  public readonly clientMessage: string;
  public readonly internalDetails: string;

  constructor(clientMessage: string, internalDetails: string) {
    super(clientMessage);
    this.name = 'AdminKeyError';
    this.clientMessage = clientMessage;
    this.internalDetails = internalDetails;
  }
}

/**
 * Get the admin keypair for a historical/migrated DAO from environment
 * Historical DAOs have admin_key_idx = NULL and use env-based keys instead.
 *
 * Environment variable format: HISTORICAL_ADMIN_KEY_<DAO_NAME>=<base58 private key>
 * Example: HISTORICAL_ADMIN_KEY_ZC=5abc...xyz
 *
 * @param daoName - The DAO name (e.g., 'ZC', 'SURF', 'SURFTEST', 'TESTSURF')
 */
export function getHistoricalAdminKeypair(daoName: string): Keypair {
  const envKey = `${HISTORICAL_KEY_PREFIX}${daoName.toUpperCase()}`;
  const privateKey = process.env[envKey];

  if (!privateKey) {
    throw new AdminKeyError(
      'This DAO is temporarily unavailable for administrative operations. Please try again later or contact support.',
      `Historical admin key not configured for DAO "${daoName}". Set environment variable: ${envKey}`
    );
  }

  const secretKey = bs58.decode(privateKey);
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Fetch admin keypair for a DAO, handling both key-service and historical DAOs
 *
 * @param adminKeyIdx - Key index from cmb_daos.admin_key_idx (NULL for historical)
 * @param daoName - DAO name (required for historical DAOs with NULL key index)
 *
 * TODO: Replace daoName lookup with DAO PDA verification for more robust key mapping
 */
export async function fetchAdminKeypair(
  adminKeyIdx: number | null,
  daoName?: string
): Promise<Keypair> {
  // Historical DAO - use environment-based key
  if (adminKeyIdx === null || adminKeyIdx === undefined) {
    if (!daoName) {
      throw new AdminKeyError(
        'Unable to process request for this DAO. Please contact support.',
        'DAO name is required for historical DAOs with NULL admin_key_idx but was not provided'
      );
    }
    return getHistoricalAdminKeypair(daoName);
  }

  // Normal DAO - use key service
  return fetchKeypair(adminKeyIdx);
}

/**
 * Check the SOL balance of a wallet
 */
export async function getWalletBalance(
  connection: Connection,
  publicKey: string
): Promise<number> {
  const balance = await connection.getBalance(
    Keypair.fromSecretKey(bs58.decode(publicKey)).publicKey
  );
  return balance / LAMPORTS_PER_SOL;
}

/**
 * Check the SOL balance of a keypair
 */
export async function getKeypairBalance(
  connection: Connection,
  keypair: Keypair
): Promise<number> {
  const balance = await connection.getBalance(keypair.publicKey);
  return balance / LAMPORTS_PER_SOL;
}

/**
 * Fund a managed wallet from the DAO wallet if needed
 * Returns true if funding was performed, false if wallet already had sufficient balance
 */
export async function ensureWalletFunded(
  connection: Connection,
  targetKeypair: Keypair
): Promise<{ funded: boolean; balance: number; txSignature?: string }> {
  const currentBalance = await getKeypairBalance(connection, targetKeypair);

  if (currentBalance >= MIN_WALLET_BALANCE_SOL) {
    return { funded: false, balance: currentBalance };
  }

  const daoKeypair = getDaoKeypair();

  // Check DAO wallet has enough
  const daoBalance = await getKeypairBalance(connection, daoKeypair);
  if (daoBalance < FUNDING_AMOUNT_SOL + 0.01) {
    throw new Error(`DAO wallet has insufficient balance: ${daoBalance} SOL`);
  }

  // Create funding transaction
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: daoKeypair.publicKey,
      toPubkey: targetKeypair.publicKey,
      lamports: Math.floor(FUNDING_AMOUNT_SOL * LAMPORTS_PER_SOL),
    })
  );

  const txSignature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [daoKeypair],
    { commitment: 'confirmed' }
  );

  const newBalance = await getKeypairBalance(connection, targetKeypair);

  console.log(`Funded wallet ${targetKeypair.publicKey.toBase58()} with ${FUNDING_AMOUNT_SOL} SOL. Tx: ${txSignature}`);

  return { funded: true, balance: newBalance, txSignature };
}

/**
 * Allocate a new key for DAO operations
 * Fetches the keypair, ensures it's funded, and returns the keypair along with its index
 *
 * @param connection - Solana connection
 * @param keyIdx - Key index to allocate
 * @param skipFunding - If true, skip the funding step (useful for mock mode testing)
 */
export async function allocateKey(
  connection: Connection,
  keyIdx: number,
  skipFunding: boolean = false
): Promise<{ keypair: Keypair; publicKey: string }> {
  const keypair = await fetchKeypair(keyIdx);

  if (skipFunding) {
    console.log(`Allocated key ${keyIdx} (${keypair.publicKey.toBase58()}): skipping funding check`);
    return {
      keypair,
      publicKey: keypair.publicKey.toBase58(),
    };
  }

  // Ensure the wallet is funded
  const { funded, balance, txSignature } = await ensureWalletFunded(connection, keypair);

  if (funded) {
    console.log(`Allocated and funded key ${keyIdx} (${keypair.publicKey.toBase58()}): ${balance} SOL (tx: ${txSignature})`);
  } else {
    console.log(`Allocated key ${keyIdx} (${keypair.publicKey.toBase58()}): already funded with ${balance} SOL`);
  }

  return {
    keypair,
    publicKey: keypair.publicKey.toBase58(),
  };
}
