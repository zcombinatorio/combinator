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

import { NextResponse } from 'next/server';
import { getTokenLaunches } from '@/lib/db';
import { calculateClaimEligibility } from '@/lib/helius';

// Simple in-memory cache
interface Token {
  id?: number;
  launch_time: string | Date;
  creator_wallet: string;
  token_address: string;
  token_metadata_url: string;
  token_name?: string | null;
  token_symbol?: string | null;
  creator_twitter?: string | null;
  creator_github?: string | null;
  created_at?: string | Date;
  is_creator_designated?: boolean;
  totalClaimed?: string;
  availableToClaim?: string;
}

interface CacheEntry {
  data: Token[];
  timestamp: number;
}

const cache: Map<string, CacheEntry> = new Map();
const CACHE_KEY = 'tokens-with-claims';
const CACHE_TTL = 60 * 1000; // 60 seconds cache - can be longer now with DB caching

export async function POST(request: Request) {
  try {
    // Check if we should force refresh (optional body param)
    const body = await request.json().catch(() => ({}));
    const forceRefresh = body.refresh === 'true' || body.refresh === true;

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = cache.get(CACHE_KEY);
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        console.log('Returning cached tokens data');
        return NextResponse.json({ tokens: cached.data, cached: true });
      }
    }

    console.log('Fetching fresh tokens data...');

    // Fetch all token launches, ordered by launch_time DESC (newest first)
    const tokens = await getTokenLaunches(undefined, 1000);

    // Process tokens in parallel batches to improve performance
    // Larger batch size since we're using DB cache now
    const BATCH_SIZE = 50;
    const tokensWithClaimData = [];

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (token) => {
          try {
            const launchTime = new Date(token.launch_time);
            const claimData = await calculateClaimEligibility(
              token.token_address,
              launchTime
            );

            return {
              ...token,
              totalClaimed: claimData.totalClaimed.toString(),
              availableToClaim: claimData.availableToClaim.toString(),
            };
          } catch (error) {
            console.error(`Error fetching claim data for ${token.token_address}:`, error);
            // Return token without claim data if there's an error
            return {
              ...token,
              totalClaimed: '0',
              availableToClaim: '0',
            };
          }
        })
      );

      tokensWithClaimData.push(...batchResults);
    }

    // Update cache
    cache.set(CACHE_KEY, {
      data: tokensWithClaimData,
      timestamp: Date.now()
    });

    return NextResponse.json({ tokens: tokensWithClaimData, cached: false });
  } catch (error) {
    console.error('Error fetching tokens:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tokens' },
      { status: 500 }
    );
  }
}