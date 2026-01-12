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

import { Request, Response } from 'express';
import * as nacl from 'tweetnacl';
import * as crypto from 'crypto';
import bs58 from 'bs58';
import { isValidSolanaAddress } from '../validation';

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
    // Reconstruct body without signed_hash
    const { signed_hash: _, ...bodyWithoutHash } = body;

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
 * Middleware to validate request authentication via signed_hash
 */
export function requireSignedHash(
  req: Request,
  res: Response,
  next: () => void
): void {
  const { wallet, signed_hash } = req.body;

  if (!wallet || !signed_hash) {
    res.status(400).json({ error: 'Missing wallet or signed_hash' });
    return;
  }

  if (!isValidSolanaAddress(wallet)) {
    res.status(400).json({ error: 'Invalid wallet address' });
    return;
  }

  if (!verifySignedHash(req.body, wallet, signed_hash)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  next();
}
