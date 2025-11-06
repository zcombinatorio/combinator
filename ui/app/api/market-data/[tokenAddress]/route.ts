import { NextResponse } from 'next/server';
import { shouldUseMockBirdeye, mockBirdeye } from '@/lib/mock';

export async function POST(
  request: Request
) {
  try {
    const body = await request.json();
    const tokenAddress = body.tokenAddress;

    // Use mock Birdeye if API key not available
    if (shouldUseMockBirdeye()) {
      const mockData = await mockBirdeye.getTokenMarketData(tokenAddress);
      return NextResponse.json(mockData);
    }

    const response = await fetch(
      `https://public-api.birdeye.so/defi/v3/token/market-data?address=${tokenAddress}`,
      {
        headers: {
          'accept': 'application/json',
          'x-chain': 'solana',
          'X-API-KEY': process.env.BIRDEYE_API_KEY || ''
        }
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch market data' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching market data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market data' },
      { status: 500 }
    );
  }
}