'use client';

import { HoldersContent } from '@/components/HoldersContent';
import { useParams } from 'next/navigation';

export default function HoldersPage() {
  const params = useParams();
  const tokenAddress = params.tokenAddress as string;

  return <HoldersContent tokenAddress={tokenAddress} tokenSymbol="" />;
}