'use client';

import { TransferContent } from '@/components/TransferContent';
import { useParams } from 'next/navigation';

export default function TransferPage() {
  const params = useParams();
  const tokenAddress = params.tokenAddress as string;

  // Token symbol and userBalance will be fetched in TransferContent component
  // For now, pass empty strings - TransferContent should handle fetching this data

  return <TransferContent tokenAddress={tokenAddress} tokenSymbol="" userBalance="0" />;
}