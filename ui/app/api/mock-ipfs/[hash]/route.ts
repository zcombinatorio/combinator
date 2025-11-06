import { NextRequest, NextResponse } from 'next/server';
import { MOCK_TOKEN_METADATA } from '@/lib/mock/mockData';

/**
 * Mock IPFS Metadata API Handler
 *
 * Serves token metadata when the browser tries to fetch from mock IPFS URLs
 * like: https://mock-ipfs.pinata.cloud/ipfs/QmMockHash1
 *
 * This is called via Next.js route when components fetch token_metadata_url
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;

  // Look up metadata by hash
  const metadata = MOCK_TOKEN_METADATA[hash];

  if (!metadata) {
    // Return default metadata with z-pfp.jpg if hash not found
    return NextResponse.json({
      name: 'Mock Token',
      symbol: 'MOCK',
      description: 'Mock token metadata',
      image: '/z-pfp.jpg',
      properties: {
        files: [{ uri: '/z-pfp.jpg', type: 'image/jpeg' }],
        category: 'image',
      },
    });
  }

  // Return the mock metadata
  return NextResponse.json(metadata, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
    },
  });
}
