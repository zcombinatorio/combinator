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
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { SimpleMutex } from '../../lib/mutex';

export const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

// Single mutex for all DAO creation operations (parent + child)
export const daoCreationMutex = new SimpleMutex();

// Rate limiting configuration
export const daoLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 300, // 300 requests per window
  keyGenerator: (req) => {
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string') return ipKeyGenerator(cfIp);
    if (Array.isArray(cfIp)) return ipKeyGenerator(cfIp[0]);
    return ipKeyGenerator(req.ip || 'unknown');
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many DAO requests, please wait.'
});

export function getConnection(): Connection {
  return new Connection(RPC_URL, 'confirmed');
}

export function createProvider(keypair: { publicKey: PublicKey; secretKey: Uint8Array }): AnchorProvider {
  const connection = getConnection();
  const wallet = {
    publicKey: keypair.publicKey,
    signTransaction: async (tx: any) => {
      tx.partialSign(keypair);
      return tx;
    },
    signAllTransactions: async (txs: any[]) => {
      txs.forEach(tx => tx.partialSign(keypair));
      return txs;
    },
  } as Wallet;
  return new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
}
