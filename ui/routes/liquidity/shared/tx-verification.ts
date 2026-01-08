/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import * as crypto from 'crypto';
import nacl from 'tweetnacl';
import { Connection, Transaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Result of transaction verification
 */
export interface VerificationResult {
  success: boolean;
  error?: string;
  details?: string;
}

/**
 * Deserialize a base58-encoded transaction
 */
export function deserializeTransaction(signedTransaction: string): Transaction {
  const transactionBuffer = bs58.decode(signedTransaction);
  return Transaction.from(transactionBuffer);
}

/**
 * Compute SHA-256 hash of transaction message
 * Used for tamper detection
 */
export function computeTransactionHash(transaction: Transaction): string {
  return crypto.createHash('sha256')
    .update(transaction.serializeMessage())
    .digest('hex');
}

/**
 * Verify that a transaction has a valid blockhash
 */
export async function verifyBlockhash(
  connection: Connection,
  transaction: Transaction
): Promise<VerificationResult> {
  if (!transaction.recentBlockhash) {
    return {
      success: false,
      error: 'Invalid transaction: missing blockhash'
    };
  }

  const isBlockhashValid = await connection.isBlockhashValid(
    transaction.recentBlockhash,
    { commitment: 'confirmed' }
  );

  if (!isBlockhashValid.value) {
    return {
      success: false,
      error: 'Invalid transaction: blockhash is expired. Please create a new transaction.'
    };
  }

  return { success: true };
}

/**
 * Verify that a transaction has the correct fee payer
 */
export function verifyFeePayer(
  transaction: Transaction,
  expectedFeePayer: PublicKey
): VerificationResult {
  if (!transaction.feePayer) {
    return {
      success: false,
      error: 'Transaction missing fee payer'
    };
  }

  if (!transaction.feePayer.equals(expectedFeePayer)) {
    return {
      success: false,
      error: 'Transaction fee payer must be manager wallet'
    };
  }

  return { success: true };
}

/**
 * Verify that a specific wallet has signed the transaction with a valid signature
 */
export function verifyWalletSignature(
  transaction: Transaction,
  walletPubKey: PublicKey,
  walletLabel: string = 'Wallet'
): VerificationResult {
  const signature = transaction.signatures.find(sig =>
    sig.publicKey.equals(walletPubKey)
  );

  if (!signature || !signature.signature) {
    return {
      success: false,
      error: `Transaction verification failed: ${walletLabel} has not signed`
    };
  }

  // Verify signature is cryptographically valid
  const messageData = transaction.serializeMessage();
  const isValid = nacl.sign.detached.verify(
    messageData,
    signature.signature,
    signature.publicKey.toBytes()
  );

  if (!isValid) {
    return {
      success: false,
      error: `Transaction verification failed: Invalid ${walletLabel} signature`
    };
  }

  return { success: true };
}

/**
 * Verify that the transaction hasn't been tampered with by comparing hashes
 */
export function verifyTransactionIntegrity(
  transaction: Transaction,
  expectedHash: string
): VerificationResult {
  const receivedHash = computeTransactionHash(transaction);

  if (receivedHash !== expectedHash) {
    console.log(`  ⚠️  Transaction hash mismatch detected`);
    console.log(`    Expected: ${expectedHash.substring(0, 16)}...`);
    console.log(`    Received: ${receivedHash.substring(0, 16)}...`);
    return {
      success: false,
      error: 'Transaction verification failed: transaction has been modified',
      details: 'Transaction structure does not match the original unsigned transaction'
    };
  }

  console.log(`  ✓ Transaction integrity verified (cryptographic hash match)`);
  return { success: true };
}

/**
 * Complete verification of a signed transaction
 * Performs all security checks required before co-signing
 */
export async function verifySignedTransaction(
  connection: Connection,
  signedTransaction: string,
  expectedHash: string,
  managerWalletPubKey: PublicKey,
  options?: {
    skipBlockhashCheck?: boolean;
    transactionIndex?: number;
  }
): Promise<{ success: true; transaction: Transaction } | { success: false; error: string; details?: string }> {
  const txLabel = options?.transactionIndex !== undefined
    ? `Transaction ${options.transactionIndex + 1}`
    : 'Transaction';

  // Deserialize
  let transaction: Transaction;
  try {
    transaction = deserializeTransaction(signedTransaction);
  } catch (error) {
    return {
      success: false,
      error: `Failed to deserialize ${txLabel.toLowerCase()}: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }

  // Verify fee payer
  const feePayerResult = verifyFeePayer(transaction, managerWalletPubKey);
  if (!feePayerResult.success) {
    return {
      success: false,
      error: `${txLabel}: ${feePayerResult.error}`
    };
  }

  // Verify manager signature
  const signatureResult = verifyWalletSignature(transaction, managerWalletPubKey, 'Manager wallet');
  if (!signatureResult.success) {
    return {
      success: false,
      error: `${txLabel}: ${signatureResult.error}`
    };
  }

  // Verify transaction integrity
  const integrityResult = verifyTransactionIntegrity(transaction, expectedHash);
  if (!integrityResult.success) {
    return {
      success: false,
      error: `${txLabel}: ${integrityResult.error}`,
      details: integrityResult.details
    };
  }

  // Verify blockhash (optional, can be skipped for batch verification)
  if (!options?.skipBlockhashCheck) {
    const blockhashResult = await verifyBlockhash(connection, transaction);
    if (!blockhashResult.success) {
      return {
        success: false,
        error: `${txLabel}: ${blockhashResult.error}`
      };
    }
  }

  return { success: true, transaction };
}

/**
 * Verify multiple signed transactions in batch
 * Performs blockhash check only once (assumes all use same blockhash)
 */
export async function verifySignedTransactionBatch(
  connection: Connection,
  signedTransactions: string[],
  expectedHashes: string[],
  managerWalletPubKey: PublicKey
): Promise<{ success: true; transactions: Transaction[] } | { success: false; error: string; details?: string }> {
  if (signedTransactions.length !== expectedHashes.length) {
    return {
      success: false,
      error: `Expected ${expectedHashes.length} transactions, got ${signedTransactions.length}`
    };
  }

  const transactions: Transaction[] = [];

  // Verify each transaction (skip blockhash check except for first)
  for (let i = 0; i < signedTransactions.length; i++) {
    const result = await verifySignedTransaction(
      connection,
      signedTransactions[i],
      expectedHashes[i],
      managerWalletPubKey,
      { skipBlockhashCheck: i > 0, transactionIndex: i }
    );

    if (!result.success) {
      return result;
    }

    transactions.push(result.transaction);
  }

  // Verify blockhash for first transaction (they should all be the same)
  if (transactions.length > 0 && transactions[0].recentBlockhash) {
    const blockhashResult = await verifyBlockhash(connection, transactions[0]);
    if (!blockhashResult.success) {
      return {
        success: false,
        error: blockhashResult.error!
      };
    }
  }

  console.log(`  ✓ All ${transactions.length} transactions verified`);
  return { success: true, transactions };
}
