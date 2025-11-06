import { NextResponse } from 'next/server';
import { isInMockMode } from '@/lib/mock';

export async function GET() {
  return NextResponse.json({
    isDemoMode: isInMockMode()
  });
}
