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

import { Request, Response } from 'express';
import * as nacl from 'tweetnacl';
import * as crypto from 'crypto';
import bs58 from 'bs58';
import { Transaction, PublicKey } from '@solana/web3.js';
import { isValidSolanaAddress } from '../validation';

const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

/**
 * Verify a signed_hash for request authentication.
 * The client signs a human-readable message containing the SHA-256 hash of the request body.
 *
 * Message format:
 * "Combinator Authentication\n\nSign this message to verify your request.\n\nRequest hash: <hex>"
 *
 * Note: We use a human-readable message instead of raw hash bytes because some wallets
 * (like Phantom) reject signing raw binary data that could be mistaken for transactions.
 */
export function verifySignedHash(
  body: Record<string, unknown>,
  wallet: string,
  signedHash: string
): boolean {
  try {
    // Reconstruct body without auth fields
    const { signed_hash: _, signed_transaction: __, ...bodyWithoutHash } = body;

    // Hash the stringified body
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify(bodyWithoutHash))
      .digest();

    // Convert hash to hex for human-readable message
    const hashHex = hash.toString('hex');

    // Reconstruct the human-readable message that was signed
    const message = `Combinator Authentication\n\nSign this message to verify your request.\n\nRequest hash: ${hashHex}`;
    const messageBytes = Buffer.from(message, 'utf-8');

    // Decode signature and public key
    const signature = bs58.decode(signedHash);
    const publicKey = bs58.decode(wallet);

    // Verify the signature against the human-readable message
    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Verify a signed Memo transaction for request authentication (Ledger fallback).
 * Ledger's Solana app doesn't support signMessage, so the client signs a Memo
 * transaction containing the auth message instead.
 *
 * Verification:
 * 1. Deserialize the transaction
 * 2. Verify it contains a Memo instruction with the expected auth message
 * 3. Verify the transaction signature matches the wallet's public key
 */
export function verifySignedTransaction(
  body: Record<string, unknown>,
  wallet: string,
  signedTransaction: string
): boolean {
  try {
    // Deserialize the signed transaction
    const txBytes = bs58.decode(signedTransaction);
    const transaction = Transaction.from(txBytes);

    // Reconstruct expected auth message from body (excluding auth fields)
    const { signed_hash: _, signed_transaction: __, ...bodyWithoutAuth } = body;
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify(bodyWithoutAuth))
      .digest();
    const hashHex = hash.toString('hex');
    const expectedMessage = `Combinator Authentication\n\nSign this message to verify your request.\n\nRequest hash: ${hashHex}`;

    // Verify the transaction contains exactly one instruction (the Memo)
    if (transaction.instructions.length !== 1) {
      console.error('Transaction verification: expected exactly 1 instruction, got', transaction.instructions.length);
      return false;
    }

    // Verify it's a Memo instruction with the expected auth message
    const memoIx = transaction.instructions[0];
    if (memoIx.programId.toBase58() !== MEMO_PROGRAM_ID) {
      console.error('Transaction verification: instruction is not a Memo');
      return false;
    }

    const memoData = memoIx.data.toString('utf-8');
    if (memoData !== expectedMessage) {
      console.error('Transaction verification: memo data mismatch');
      return false;
    }

    // Verify the transaction signature matches the wallet
    const publicKey = new PublicKey(wallet);
    const messageBytes = transaction.serializeMessage();
    const sigEntry = transaction.signatures.find(
      sig => sig.publicKey.equals(publicKey)
    );
    if (!sigEntry?.signature) {
      console.error('Transaction verification: no signature from wallet');
      return false;
    }

    return nacl.sign.detached.verify(
      messageBytes,
      sigEntry.signature,
      publicKey.toBytes()
    );
  } catch (error) {
    console.error('Transaction signature verification error:', error);
    return false;
  }
}

/**
 * Middleware to validate request authentication via signed_hash
 */
export function requireSignedHash(
  req: Request,
  res: Response,
  next: () => void
): void {
  const { wallet, signed_hash, signed_transaction } = req.body;

  if (!wallet || !signed_hash) {
    res.status(400).json({ error: 'Missing wallet or signed_hash' });
    return;
  }

  if (!isValidSolanaAddress(wallet)) {
    res.status(400).json({ error: 'Invalid wallet address' });
    return;
  }

  // If signed_transaction is present, use transaction-based verification (Ledger fallback)
  if (signed_transaction) {
    if (!verifySignedTransaction(req.body, wallet, signed_transaction)) {
      res.status(401).json({ error: 'Invalid transaction signature' });
      return;
    }
  } else {
    // Standard message-based verification
    if (!verifySignedHash(req.body, wallet, signed_hash)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  next();
}
