'use client';

import { useWallet } from './WalletProvider';
import { usePrivy } from '@privy-io/react-auth';
import { useState } from 'react';

interface WalletButtonProps {
  onLaunch?: () => void;
  disabled?: boolean;
  isLaunching?: boolean;
  isGeneratingCA?: boolean;
  isPresale?: boolean;
}

export const WalletButton = ({ onLaunch, disabled = false, isLaunching = false, isGeneratingCA = false, isPresale = false }: WalletButtonProps) => {
  const { connecting, externalWallet } = useWallet();
  const { login, authenticated, linkWallet } = usePrivy();
  const [error, setError] = useState<string | null>(null);

  const handleButtonClick = async () => {
    // Only allow launch if there's an external wallet connected
    if (externalWallet && onLaunch) {
      onLaunch();
      return;
    }

    try {
      setError(null);

      // First check if user is authenticated, if not, login first
      if (!authenticated) {
        // Login with wallet directly
        await login();
      } else {
        // If already authenticated, link additional wallet
        await linkWallet();
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      setError('Failed to connect wallet. Please try again.');
    }
  };

  // Show loading state while connecting
  if (connecting) {
    return (
      <button
        disabled
        className="text-[14px] opacity-50 cursor-not-allowed"
        style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace', color: 'var(--foreground-secondary)' }}
      >
        [CONNECTING...]
      </button>
    );
  }

  // Show error if there is one
  if (error) {
    return (
      <div className="space-y-2">
        <div className="text-sm" style={{ color: '#ef4444' }}>{error}</div>
        <button
          onClick={() => setError(null)}
          className="text-[14px] transition-colors cursor-pointer hover:opacity-80"
          style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace', color: 'var(--accent)' }}
        >
          [TRY AGAIN]
        </button>
      </div>
    );
  }


  return (
    <button
      onClick={handleButtonClick}
      disabled={connecting || disabled}
      className="text-[14px] transition-colors cursor-pointer hover:opacity-80"
      style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace', color: 'var(--accent)' }}
    >
      {isGeneratingCA
        ? '[GENERATING CA...]'
        : isLaunching
        ? '[LAUNCHING...]'
        : externalWallet
        ? disabled
          ? '[FILL OUT REQUIRED FIELDS TO LAUNCH]'
          : isPresale ? '[CLICK TO LAUNCH PRESALE]' : '[CLICK TO LAUNCH]'
        : '[CLICK TO CONNECT WALLET]'}
    </button>
  );
};