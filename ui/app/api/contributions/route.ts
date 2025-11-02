import { NextResponse } from 'next/server';
import { getContributions } from '@/lib/db';

export async function POST(request: Request) {
  try {
    // Accept request body for future extensibility (filtering, pagination, etc.)
    await request.json().catch(() => ({}));

    const contributions = await getContributions();

    return NextResponse.json({
      contributions,
      count: contributions.length
    });

  } catch (error) {
    console.error('Error fetching contributions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contributions' },
      { status: 500 }
    );
  }
}
