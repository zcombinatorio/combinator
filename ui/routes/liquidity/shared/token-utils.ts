/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * Token utility functions for Token-2022 compatibility
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

/**
 * Detects which token program owns a mint account.
 * Returns TOKEN_2022_PROGRAM_ID for Token-2022 mints, TOKEN_PROGRAM_ID otherwise.
 */
export async function getTokenProgramForMint(
  connection: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const accountInfo = await connection.getAccountInfo(mint);
  if (!accountInfo) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }

  if (accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }

  return TOKEN_PROGRAM_ID;
}

/**
 * Batch version - gets token programs for multiple mints in parallel.
 * Returns a Map of mint address to token program.
 */
export async function getTokenProgramsForMints(
  connection: Connection,
  mints: PublicKey[]
): Promise<Map<string, PublicKey>> {
  const programs = new Map<string, PublicKey>();

  const accountInfos = await connection.getMultipleAccountsInfo(mints);

  for (let i = 0; i < mints.length; i++) {
    const mint = mints[i];
    const accountInfo = accountInfos[i];

    if (!accountInfo) {
      throw new Error(`Mint account not found: ${mint.toBase58()}`);
    }

    const program = accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    programs.set(mint.toBase58(), program);
  }

  return programs;
}
