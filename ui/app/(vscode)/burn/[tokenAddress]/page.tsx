'use client';

import { BurnContent } from '@/components/BurnContent';
import { useParams } from 'next/navigation';

export default function BurnPage() {
  const params = useParams();
  const tokenAddress = params.tokenAddress as string;

  // Token symbol and userBalance will be fetched in BurnContent component
  // For now, pass empty strings - BurnContent should handle fetching this data

  return <BurnContent tokenAddress={tokenAddress} tokenSymbol="" userBalance="0" />;
}
