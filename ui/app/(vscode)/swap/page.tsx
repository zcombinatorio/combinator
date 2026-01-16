'use client';
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

import { SwapContent } from '@/components/SwapContent';
import { useSearchParams } from 'next/navigation';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_CONFIG } from './constants';
import { Token } from './types';
import { Suspense } from 'react';

// Helper function to map token address to Token type
function getTokenFromAddress(address: string): Token | null {
  try {
    const pubkey = new PublicKey(address);
    for (const [token, config] of Object.entries(TOKEN_CONFIG)) {
      if (config.mint.equals(pubkey)) {
        return token as Token;
      }
    }
  } catch {
    // Invalid address
  }
  return null;
}

function SwapPageContent() {
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get('token');
  const selectedToken = tokenParam ? getTokenFromAddress(tokenParam) : null;

  return <SwapContent initialToToken={selectedToken || undefined} />;
}

export default function SwapPage() {
  return (
    <Suspense fallback={<SwapContent />}>
      <SwapPageContent />
    </Suspense>
  );
}