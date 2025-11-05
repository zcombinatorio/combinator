'use client';

import { useState } from 'react';
import { useWallet } from './WalletProvider';
import { usePrivy } from '@privy-io/react-auth';
import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

interface VestingModalProps {
  tokenSymbol: string;
  tokenAddress: string;
  vestingInfo: VestingInfo | null;
  onClaimSuccess: () => void;
}

interface VestingInfo {
  totalAllocated: string;
  totalClaimed: string;
  claimableAmount: string;
  vestingProgress: number;
  isFullyVested: boolean;
  nextUnlockTime?: string;
  vestingEndTime: string;
}

export function VestingModal({
  tokenSymbol,
  tokenAddress,
  vestingInfo,
  onClaimSuccess
}: VestingModalProps) {
  const { wallet, activeWallet } = useWallet();
  const { authenticated, login, linkWallet } = usePrivy();
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState(false);

  // Format token amount with 6 decimals and K/M abbreviations
  const formatTokenAmount = (amount: string, decimals = 6): string => {
    if (!amount || amount === '0') return '0';
    const divisor = Math.pow(10, decimals);
    const value = parseFloat(amount) / divisor;

    // Format with K for thousands, M for millions
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(2)}K`;
    }

    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    });
  };

  const handleConnectWallet = async () => {
    try {
      if (!authenticated) {
        await login();
      } else {
        await linkWallet();
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
    }
  };

  const handleClaim = async () => {
    if (!wallet || !activeWallet || !vestingInfo) {
      return;
    }

    setIsClaiming(true);
    setClaimError(null);
    setClaimSuccess(false);

    try {
      // Step 1: Prepare the claim transaction
      const prepareResponse = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/presale/${tokenAddress}/claims/prepare`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userWallet: wallet.toBase58() })
        }
      );

      if (!prepareResponse.ok) {
        const errorData = await prepareResponse.json();
        throw new Error(errorData.error || 'Failed to prepare claim');
      }

      const { transaction: serializedTx, timestamp } = await prepareResponse.json();

      // Step 2: Sign the transaction WITHOUT modifying blockhash
      const txBuffer = bs58.decode(serializedTx);
      const transaction = Transaction.from(txBuffer);

      // Set fee payer (this doesn't affect signatures)
      transaction.feePayer = wallet;

      // Serialize transaction for Privy signing
      const serializedTransaction = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      // Sign transaction using Privy wallet
      const signedResult = await activeWallet.signTransaction({
        transaction: serializedTransaction,
      });

      // Get the signed transaction bytes (already a Uint8Array)
      const signedTransaction = signedResult.signedTransaction;

      // Step 3: Confirm the claim
      const confirmResponse = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/presale/${tokenAddress}/claims/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signedTransaction: bs58.encode(signedTransaction),
            timestamp
          })
        }
      );

      if (!confirmResponse.ok) {
        const errorData = await confirmResponse.json();
        throw new Error(errorData.error || 'Failed to confirm claim');
      }

      const { signature } = await confirmResponse.json();
      console.log('Claim successful! Signature:', signature);

      setClaimSuccess(true);
      onClaimSuccess();

      // Clear success message after 3 seconds
      setTimeout(() => setClaimSuccess(false), 3000);

    } catch (error) {
      console.error('Claim error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to claim tokens';
      setClaimError(errorMessage);
    } finally {
      setIsClaiming(false);
    }
  };

  if (!vestingInfo) {
    return (
      <div>
        <p className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Vesting</p>
        {!wallet ? (
          <>
            <p className="mt-6 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Connect your wallet to view vesting information</p>
            <button
              onClick={handleConnectWallet}
              className="mt-6 text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors"
              style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
            >
              [CONNECT WALLET]
            </button>
          </>
        ) : (
          <p className="mt-6 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>No vesting allocation found for your wallet</p>
        )}
      </div>
    );
  }

  const remainingTokens = parseFloat(vestingInfo.totalAllocated) - parseFloat(vestingInfo.totalClaimed);
  const hasTokensToClaimNow = parseFloat(vestingInfo.claimableAmount) > 0;
  const hoursRemaining = Math.floor((100 - vestingInfo.vestingProgress) * 3.36);

  // Check if we're in a cooldown period
  const isInCooldown = vestingInfo.nextUnlockTime && new Date(vestingInfo.nextUnlockTime) > new Date();
  const canClaimNow = hasTokensToClaimNow && !isInCooldown;

  // Calculate time until next unlock for display
  const getTimeUntilUnlock = () => {
    if (!vestingInfo.nextUnlockTime || !isInCooldown) return null;
    const timeUntil = new Date(vestingInfo.nextUnlockTime).getTime() - Date.now();
    const minutes = Math.ceil(timeUntil / 60000);
    if (minutes < 60) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    const hours = Math.ceil(minutes / 60);
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  };

  const timeUntilUnlock = getTimeUntilUnlock();

  return (
    <div>
      <p className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Vesting</p>

      <div className="mt-0.5">
        <p className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
          Your allocation: <span className="text-white">{formatTokenAmount(vestingInfo.totalAllocated)} {tokenSymbol}</span>
        </p>
        <p className="mt-0.5 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
          Already claimed: <span className="text-white">{formatTokenAmount(vestingInfo.totalClaimed)} {tokenSymbol}</span>
        </p>
        <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
          Vesting progress: <span className="text-white">{vestingInfo.vestingProgress.toFixed(1)}%</span>
          {vestingInfo.isFullyVested ? (
            <span className="text-green-400 ml-2">✓ Fully Vested</span>
          ) : (
            <span className="text-gray-500 ml-2">({hoursRemaining} hours left)</span>
          )}
        </p>
      </div>

      <div className="mt-0.5">
        <div>
          <p className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            Available to Claim: <span className={`${canClaimNow ? 'text-white' : 'text-gray-500'}`}>
              {formatTokenAmount(vestingInfo.claimableAmount)} {tokenSymbol}
            </span>
            {' '}
            {isInCooldown && <span className="text-yellow-400 text-[14px]">(Cooldown active)</span>}
          </p>
          {claimError && (
            <p className="mt-2 text-[14px] text-red-400" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
              {claimError}
            </p>
          )}
          {claimSuccess && (
            <p className="mt-2 text-[14px] text-green-400" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
              Tokens claimed successfully! ✓
            </p>
          )}
        </div>

        <div className="mt-1">
          <p className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            Remaining to vest: <span className="text-white">{formatTokenAmount(remainingTokens.toString())} {tokenSymbol}</span>
          </p>
          {!vestingInfo.isFullyVested && vestingInfo.nextUnlockTime && (
            <p className={`mt-0.5 text-[14px] ${isInCooldown ? 'text-yellow-400' : 'text-gray-300'}`} style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
              Next unlock: <span className="text-white">
                {isInCooldown ? (
                  <>In {timeUntilUnlock} ({new Date(vestingInfo.nextUnlockTime).toLocaleTimeString()})</>
                ) : (
                  new Date(vestingInfo.nextUnlockTime).toLocaleTimeString()
                )}
              </span>
            </p>
          )}
        </div>

        <button
          onClick={handleClaim}
          disabled={isClaiming || !canClaimNow}
          className="mt-6.5 text-[14px] text-gray-300 hover:text-[#EF6400] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
        >
          {isClaiming ? '[PROCESSING...]' :
           isInCooldown ? `[CLAIM AVAILABLE IN ${timeUntilUnlock}]` :
           hasTokensToClaimNow ? `[CLAIM ${formatTokenAmount(vestingInfo.claimableAmount)} ${tokenSymbol}]` :
           '[NO TOKENS AVAILABLE]'}
        </button>
      </div>
    </div>
  );
}