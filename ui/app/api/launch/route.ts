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

import { NextRequest, NextResponse } from 'next/server';
import { createLaunchTransaction } from '@/lib/launchService';

interface LaunchRequest {
  baseMintPublicKey: string;
  name: string;
  symbol: string;
  uri: string;
  payerPublicKey: string;
  quoteToken?: 'SOL' | 'ZC';
}

export async function POST(request: NextRequest) {
  try {
    const {
      baseMintPublicKey,
      name,
      symbol,
      uri,
      payerPublicKey,
      quoteToken
    }: LaunchRequest = await request.json();

    const result = await createLaunchTransaction(
      baseMintPublicKey,
      name,
      symbol,
      uri,
      payerPublicKey,
      quoteToken || 'SOL'
    );

    return NextResponse.json(result);

  } catch (error) {
    console.error('Launch error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create launch transaction' },
      { status: 500 }
    );
  }
}