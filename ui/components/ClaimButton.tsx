'use client';

import { useWallet } from '@/components/WalletProvider';
import { useState, useEffect, useCallback } from 'react';
import { Transaction, Connection } from '@solana/web3.js';
import { useSignTransaction } from '@privy-io/react-auth/solana';
import bs58 from 'bs58';
import {
  ClaimInfoResult,
  ClaimInfoResponse,
  MintClaimRequest,
  MintClaimResult,
  ConfirmClaimRequest,
  ConfirmClaimResult,
  isApiError,
  isClaimInfoResponse,
  isMintClaimResponse,
  isConfirmClaimResponse
} from '@/types/api';

interface ClaimButtonProps {
  tokenAddress: string;
  tokenSymbol: string;
  onSuccess?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  isMobile?: boolean;
}

type ClaimInfo = ClaimInfoResponse;

export function ClaimButton({ tokenAddress, tokenSymbol, onSuccess, disabled = false, disabledReason, isMobile = false }: ClaimButtonProps) {
  const { wallet, activeWallet } = useWallet();
  const { signTransaction } = useSignTransaction();
  const [claimInfo, setClaimInfo] = useState<ClaimInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  const fetchClaimInfo = useCallback(async () => {
    if (!wallet || disabled) return;

    try {
      setLoading(true);
      const response = await fetch(`/api/claims/${tokenAddress}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenAddress,
          wallet: wallet.toString()
        })
      });
      const data: ClaimInfoResult = await response.json();

      if (response.ok && isClaimInfoResponse(data)) {
        setClaimInfo(data);
      } else {
        const errorMsg = isApiError(data) ? data.error : 'Unknown error';
        console.error('Failed to fetch claim info:', errorMsg);
      }
    } catch (error) {
      console.error('Error fetching claim info:', error);
    } finally {
      setLoading(false);
    }
  }, [wallet, tokenAddress, disabled]);

  const formatTimeRemaining = (milliseconds: number): string => {
    if (milliseconds <= 0) return 'Available now';

    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const formatNumberShort = (value: number) => {
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(2)}B`;
    } else if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)}M`;
    } else if (value >= 1_000) {
      return `${(value / 1_000).toFixed(2)}K`;
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  useEffect(() => {
    fetchClaimInfo();
  }, [fetchClaimInfo]);

  useEffect(() => {
    if (!claimInfo || claimInfo.canClaimNow) {
      setTimeRemaining('');
      return;
    }

    const updateTimer = () => {
      const now = new Date().getTime();
      const nextClaim = new Date(claimInfo.nextInflationTime).getTime();
      const remaining = nextClaim - now;

      if (remaining <= 0) {
        setTimeRemaining('Available now');
        fetchClaimInfo(); // Refresh claim info
      } else {
        setTimeRemaining(formatTimeRemaining(remaining));
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [claimInfo, fetchClaimInfo]);

  const handleClaim = async () => {
    if (!wallet || !activeWallet || !claimInfo || !claimInfo.canClaimNow) return;

    try {
      setClaiming(true);

      // Calculate claim amount (for now, claim all available)
      const claimAmount = claimInfo.availableToClaim;

      if (BigInt(claimAmount) <= 0) {
        alert('No tokens available to claim');
        return;
      }

      // Step 1: Get mint transaction from server
      const mintRequest: MintClaimRequest = {
        tokenAddress,
        userWallet: wallet.toString(),
        claimAmount
      };

      const mintResponse = await fetch('/api/claims/mint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mintRequest),
      });

      const mintData: MintClaimResult = await mintResponse.json();

      if (!mintResponse.ok || !isMintClaimResponse(mintData)) {
        const errorMsg = isApiError(mintData) ? mintData.error : 'Failed to create mint transaction';
        throw new Error(errorMsg);
      }

      // Step 2: Deserialize unsigned transaction
      const transactionBuffer = bs58.decode(mintData.transaction);
      const transaction = Transaction.from(transactionBuffer);

      // Step 3: User signs the transaction first (following Phantom's recommended order)
      const serializedTransaction = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });

      const { signedTransaction } = await signTransaction({
        transaction: serializedTransaction,
        wallet: activeWallet!
      });

      const userSignedTransaction = Transaction.from(signedTransaction);

      // Step 4: Send user-signed transaction to server for protocol signing and submission
      const confirmRequest: ConfirmClaimRequest = {
        signedTransaction: bs58.encode(userSignedTransaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false
        })),
        transactionKey: mintData.transactionKey
      };

      const submitResponse = await fetch('/api/claims/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(confirmRequest),
      });

      const submitData: ConfirmClaimResult = await submitResponse.json();

      if (!submitResponse.ok || !isConfirmClaimResponse(submitData)) {
        const errorMsg = isApiError(submitData) ? submitData.error : 'Failed to submit claim transaction';
        throw new Error(errorMsg);
      }

      const signature = submitData.transactionSignature;

      // Step 5: Confirm the transaction client-side
      console.log('Transaction sent with signature:', signature);

      // Poll for transaction confirmation
      const connection = new Connection(process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
      let confirmed = false;
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds timeout

      while (!confirmed && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        attempts++;

        try {
          const status = await connection.getSignatureStatus(signature, {
            searchTransactionHistory: false
          });

          if (status.value) {
            if (status.value.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
            }

            if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
              confirmed = true;
              console.log('Transaction confirmed:', signature);
              break;
            }
          }
        } catch (pollError) {
          console.warn('Error polling transaction status:', pollError);
        }
      }

      if (!confirmed) {
        throw new Error('Transaction confirmation timeout');
      }

      // Transaction confirmed successfully (user receives 90%, 10% goes to protocol fees)
      const amountReceived = Math.round(Number(claimAmount) * 0.9);
      alert(`Successfully claimed ${amountReceived.toLocaleString()} ${tokenSymbol} tokens!`);

      // Call success callback to refresh balance
      if (onSuccess) {
        onSuccess();
      }

      // Optimistically update UI - assume user has nothing left to claim
      if (claimInfo) {
        const claimedAmount = BigInt(claimAmount);
        const newTotalClaimed = BigInt(claimInfo.totalClaimed) + claimedAmount;

        setClaimInfo({
          ...claimInfo,
          totalClaimed: newTotalClaimed.toString(),
          availableToClaim: "0",
          canClaimNow: false,
          // Keep maxClaimableNow the same since it's based on time periods
        });
      }

    } catch (error) {
      console.error('Claim error:', error);
      alert(`Failed to claim tokens: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setClaiming(false);
    }
  };

  if (!wallet) {
    return null;
  }

  if (disabled) {
    return (
      <div className="text-[14px] text-gray-300 cursor-not-allowed" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }} title={disabledReason}>
        [Claim]
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
        [Loading claim info...]
      </div>
    );
  }

  if (!claimInfo) {
    return (
      <div className="text-[14px] text-red-400" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
        {isMobile ? '[Failed]' : '[Failed to load claim information]'}
      </div>
    );
  }

  const availableToClaim = Number(claimInfo.availableToClaim);
  const amountUserReceives = Math.round(availableToClaim * 0.9); // User receives 90%, 10% goes to protocol fees

  return (
    <div className="flex items-center">
      {!claimInfo.canClaimNow && timeRemaining ? (
        <div className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
          [Next Claim: {timeRemaining}]
        </div>
      ) : (
        <button
          onClick={handleClaim}
          disabled={claiming || !claimInfo.canClaimNow || availableToClaim <= 0}
          className={`text-[14px] transition-colors cursor-pointer ${
            claiming || !claimInfo.canClaimNow || availableToClaim <= 0
              ? 'text-gray-300 cursor-not-allowed'
              : 'text-gray-300 hover:text-[#b2e9fe]'
          }`}
          style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
        >
          {claiming
            ? '[Claiming...]'
            : availableToClaim <= 0
            ? '[All Tokens Claimed]'
            : isMobile
            ? `[Claim ${formatNumberShort(amountUserReceives)}]`
            : `[Claim ${amountUserReceives.toLocaleString()}]`
          }
        </button>
      )}
    </div>
  );
}