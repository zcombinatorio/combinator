'use client';

import { HistoryContent } from '@/components/HistoryContent';
import { useParams } from 'next/navigation';

export default function HistoryPage() {
  const params = useParams();
  const tokenAddress = params.tokenAddress as string;

  // Extract token symbol from URL if needed, or fetch it
  // For now, we'll pass it as a query param or fetch it in HistoryContent

  return <HistoryContent tokenAddress={tokenAddress} tokenSymbol="" />;
}