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

import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { Pool } from 'pg';
import { getDaoByFundingSignature } from '../db/daos';

/**
 * DAO Public Key - the protocol wallet that receives funding payments.
 * Users must transfer SOL to this address before creating a DAO.
 */
export const DAO_PUBLIC_KEY = new PublicKey('83PbZortE6imDzJcZrd5eGS42zbSAskJw7eP26GaJbqE');

/**
 * Minimum funding amount in SOL required to create a DAO.
 * This covers admin wallet funding for proposal creation costs.
 */
export const MIN_FUNDING_AMOUNT_SOL = 0.11;

/**
 * Maximum age of a funding transaction in seconds.
 * Transactions older than this will be rejected.
 */
export const MAX_FUNDING_TX_AGE_SECONDS = 120;

export interface FundingVerificationResult {
  valid: boolean;
  error?: string;
  sender?: string;
  amount?: number;
  blockTime?: number;
}

/**
 * Verify a funding transaction for DAO creation.
 *
 * Checks:
 * 1. Transaction exists and is confirmed
 * 2. Transaction is recent (within MAX_FUNDING_TX_AGE_SECONDS)
 * 3. Transaction contains a SOL transfer to DAO_PUBLIC_KEY
 * 4. Transfer amount is >= MIN_FUNDING_AMOUNT_SOL
 * 5. Sender matches the expected wallet
 * 6. Signature has not already been used for another DAO
 *
 * @param connection - Solana connection
 * @param dbPool - Database connection pool
 * @param signature - Transaction signature to verify
 * @param expectedSender - Expected sender wallet address
 * @returns Verification result
 */
export async function verifyFundingTransaction(
  connection: Connection,
  dbPool: Pool,
  signature: string,
  expectedSender: string
): Promise<FundingVerificationResult> {
  try {
    // 0. If the sender IS the DAO funding wallet, skip verification (can't pay yourself)
    if (expectedSender === DAO_PUBLIC_KEY.toBase58()) {
      console.log(`[Funding] Skipping verification - sender is DAO funding wallet`);
      return {
        valid: true,
        sender: expectedSender,
        amount: 0,
        blockTime: Math.floor(Date.now() / 1000),
      };
    }

    // 1. Check if signature has already been used
    const existingDao = await getDaoByFundingSignature(dbPool, signature);
    if (existingDao) {
      return {
        valid: false,
        error: `Funding signature already used for DAO: ${existingDao.dao_name}`,
      };
    }

    // 2. Fetch the transaction
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return {
        valid: false,
        error: 'Transaction not found or not confirmed',
      };
    }

    // 3. Check transaction age
    const blockTime = tx.blockTime;
    if (!blockTime) {
      return {
        valid: false,
        error: 'Transaction has no block time',
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const age = now - blockTime;
    if (age > MAX_FUNDING_TX_AGE_SECONDS) {
      return {
        valid: false,
        error: `Transaction too old: ${age}s (max ${MAX_FUNDING_TX_AGE_SECONDS}s)`,
      };
    }

    // 4. Parse transaction for SOL transfer to DAO_PUBLIC_KEY
    // Get account keys from the transaction
    const message = tx.transaction.message;
    const accountKeys = message.staticAccountKeys;

    // For versioned transactions, also include loaded addresses
    let allAccountKeys = [...accountKeys];
    if ('loadedAddresses' in message && message.loadedAddresses) {
      const loaded = message.loadedAddresses as { writable: PublicKey[]; readonly: PublicKey[] };
      allAccountKeys = [...allAccountKeys, ...loaded.writable, ...loaded.readonly];
    }
    if (tx.meta?.loadedAddresses) {
      allAccountKeys = [
        ...allAccountKeys,
        ...tx.meta.loadedAddresses.writable.map(addr => new PublicKey(addr)),
        ...tx.meta.loadedAddresses.readonly.map(addr => new PublicKey(addr)),
      ];
    }

    // Check pre/post balances to find SOL transfers
    const preBalances = tx.meta?.preBalances;
    const postBalances = tx.meta?.postBalances;

    if (!preBalances || !postBalances) {
      return {
        valid: false,
        error: 'Transaction missing balance information',
      };
    }

    // Find the DAO_PUBLIC_KEY in the account list
    const daoKeyIndex = allAccountKeys.findIndex(key => key.equals(DAO_PUBLIC_KEY));
    if (daoKeyIndex === -1) {
      return {
        valid: false,
        error: `Transaction does not involve DAO public key (${DAO_PUBLIC_KEY.toBase58()})`,
      };
    }

    // Check if DAO_PUBLIC_KEY received SOL
    const daoPreBalance = preBalances[daoKeyIndex] ?? 0;
    const daoPostBalance = postBalances[daoKeyIndex] ?? 0;
    const daoReceived = daoPostBalance - daoPreBalance;

    if (daoReceived <= 0) {
      return {
        valid: false,
        error: 'Transaction did not transfer SOL to DAO public key',
      };
    }

    const amountSol = daoReceived / LAMPORTS_PER_SOL;
    if (amountSol < MIN_FUNDING_AMOUNT_SOL) {
      return {
        valid: false,
        error: `Insufficient funding: ${amountSol} SOL (min ${MIN_FUNDING_AMOUNT_SOL} SOL)`,
      };
    }

    // 5. Find the sender (account that lost the most SOL)
    // The fee payer (index 0) pays fees, so we look for the account with the largest decrease
    let senderIndex = -1;
    let maxDecrease = 0;

    for (let i = 0; i < preBalances.length; i++) {
      const decrease = preBalances[i] - postBalances[i];
      if (decrease > maxDecrease) {
        maxDecrease = decrease;
        senderIndex = i;
      }
    }

    if (senderIndex === -1 || senderIndex >= allAccountKeys.length) {
      return {
        valid: false,
        error: 'Could not determine transaction sender',
      };
    }

    const sender = allAccountKeys[senderIndex].toBase58();

    // 6. Verify sender matches expected wallet
    if (sender !== expectedSender) {
      return {
        valid: false,
        error: `Sender mismatch: transaction from ${sender}, expected ${expectedSender}`,
      };
    }

    return {
      valid: true,
      sender,
      amount: amountSol,
      blockTime,
    };
  } catch (error) {
    console.error('Error verifying funding transaction:', error);
    return {
      valid: false,
      error: `Verification error: ${String(error)}`,
    };
  }
}
