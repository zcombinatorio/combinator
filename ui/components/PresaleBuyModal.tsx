'use client';

import { useState } from 'react';
import { useWallet } from '@/components/WalletProvider';
import { usePrivy } from '@privy-io/react-auth';
import { Transaction, PublicKey, Connection } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction
} from '@solana/spl-token';
import { useParams } from 'next/navigation';

const connection = new Connection(
  process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com',
  'confirmed'
);

// $ZC Token Configuration
const ZC_TOKEN_MINT = new PublicKey("GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC");
const ZC_DECIMALS = 6;
const ZC_PER_TOKEN = Math.pow(10, ZC_DECIMALS);

interface PresaleBuyModalProps {
  tokenSymbol: string;
  status: string;
  maxContribution?: number;
  userContribution?: number;
  escrowAddress?: string;
  onSuccess?: () => void;
}

export function PresaleBuyModal({ tokenSymbol, status, maxContribution = 10, userContribution = 0, escrowAddress, onSuccess }: PresaleBuyModalProps) {
  const params = useParams();
  const tokenAddress = params.tokenAddress as string;
  const { wallet, activeWallet, connecting } = useWallet();
  const { login, authenticated, linkWallet } = usePrivy();
  const [amount, setAmount] = useState('');
  const [isContributing, setIsContributing] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string }>({});

  // Calculate remaining allowance
  const remainingAllowance = maxContribution === Infinity ? Infinity : maxContribution - userContribution;

  const validateInputs = () => {
    const newErrors: { amount?: string } = {};

    if (!amount || amount.trim() === '') {
      newErrors.amount = 'Amount is required';
    } else {
      const numAmount = parseInt(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        newErrors.amount = 'Amount must be a positive number';
      } else if (remainingAllowance !== Infinity && numAmount > remainingAllowance) {
        newErrors.amount = `Amount exceeds remaining allowance of ${Math.floor(remainingAllowance)} $ZC`;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAmountChange = (value: string) => {
    // Prevent negative values and decimal points
    if (value.startsWith('-') || value.includes('.')) {
      return;
    }

    // Only allow integer values
    const intValue = value.replace(/[^\d]/g, '');
    setAmount(intValue);

    // Real-time validation feedback
    if (intValue.trim() !== '') {
      const numAmount = parseInt(intValue);
      if (!isNaN(numAmount)) {
        if (remainingAllowance !== Infinity && numAmount > remainingAllowance) {
          setErrors({ amount: `Amount exceeds remaining allowance of ${Math.floor(remainingAllowance)} $ZC` });
        } else if (numAmount <= 0) {
          setErrors({ amount: 'Amount must be positive' });
        } else {
          setErrors({});
        }
      }
    } else {
      setErrors({});
    }
  };

  const handleConnectWallet = async () => {
    try {
      if (!authenticated) {
        login();
      } else {
        linkWallet();
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      setErrors({ amount: 'Failed to connect wallet. Please try again.' });
    }
  };

  const handleBuy = async () => {
    // If wallet is not connected, connect it instead
    if (!wallet) {
      await handleConnectWallet();
      return;
    }

    if (!validateInputs() || !activeWallet || !escrowAddress) return;

    setIsContributing(true);

    try {
      const amountZC = parseInt(amount);
      const amountWithDecimals = Math.floor(amountZC * ZC_PER_TOKEN);
      const walletAddress = wallet.toBase58();

      // Get user's $ZC token account
      const userTokenAccount = await getAssociatedTokenAddress(
        ZC_TOKEN_MINT,
        wallet,
        true
      );

      // Get escrow's $ZC token account
      const escrowPubkey = new PublicKey(escrowAddress);
      const escrowTokenAccount = await getAssociatedTokenAddress(
        ZC_TOKEN_MINT,
        escrowPubkey,
        true
      );

      // Check if user's token account exists and get balance
      let userTokenAccountInfo;
      let userZCBalance = 0;
      try {
        userTokenAccountInfo = await connection.getAccountInfo(userTokenAccount);
        if (userTokenAccountInfo) {
          // Fetch the actual token balance
          const tokenAccountData = await connection.getTokenAccountBalance(userTokenAccount);
          userZCBalance = Number(tokenAccountData.value.amount);
        }
      } catch (err) {
        // Account doesn't exist
        userTokenAccountInfo = null;
      }

      // Check user has enough $ZC tokens
      if (userZCBalance < amountWithDecimals) {
        throw new Error(`Insufficient $ZC balance. Required: ${amountZC} $ZC`);
      }

      // Check if escrow's token account exists
      let escrowTokenAccountInfo;
      try {
        escrowTokenAccountInfo = await connection.getAccountInfo(escrowTokenAccount);
      } catch (err) {
        escrowTokenAccountInfo = null;
      }

      // Create transaction
      const transaction = new Transaction();

      // Add instruction to create escrow's token account if it doesn't exist (user pays)
      if (!escrowTokenAccountInfo) {
        const createEscrowATAInstruction = createAssociatedTokenAccountInstruction(
          wallet, // payer (user pays)
          escrowTokenAccount,
          escrowPubkey, // owner
          ZC_TOKEN_MINT
        );
        transaction.add(createEscrowATAInstruction);
      }

      // Create transfer instruction
      const transferInstruction = createTransferInstruction(
        userTokenAccount,
        escrowTokenAccount,
        wallet,
        amountWithDecimals
      );
      transaction.add(transferInstruction);

      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
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

      // Deserialize the signed transaction
      const signedTx = Transaction.from(Buffer.from(signedResult.signedTransaction));

      // Send and confirm the signed transaction
      const signature = await connection.sendRawTransaction(
        signedTx.serialize()
      );

      await connection.confirmTransaction(signature, 'confirmed');

      // Record the transaction in the database (using api-server)
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const recordResponse = await fetch(`${apiUrl}/presale/${tokenAddress}/bids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionSignature: signature,
          walletAddress,
          amountTokens: amountWithDecimals, // Amount in $ZC smallest units (6 decimals)
          tokenMint: ZC_TOKEN_MINT.toBase58(), // Add token mint for verification
        }),
      });

      if (!recordResponse.ok) {
        const error = await recordResponse.json();
        console.error('Failed to record transaction:', error);
        // Don't throw - transaction succeeded, just recording failed
      }

      // Success!
      if (onSuccess) {
        onSuccess();
      }

      setAmount('');
      setErrors({});
    } catch (error) {
      console.error('Buy error:', error);

      // Determine error message based on error type
      let errorMessage = 'Transaction failed. Please try again.';

      if (error instanceof Error) {
        if (error.message.includes('User rejected')) {
          errorMessage = 'Transaction cancelled.';
        } else if (error.message.includes('Insufficient')) {
          errorMessage = error.message;
        } else if (error.message.includes('blockhash')) {
          errorMessage = 'Transaction expired. Please try again.';
        } else {
          errorMessage = error.message;
        }
      }

      setErrors({ amount: errorMessage });
    } finally {
      setIsContributing(false);
    }
  };

  const setPercentage = (percent: number) => {
    const calculatedAmount = Math.floor(remainingAllowance * percent / 100);
    setAmount(calculatedAmount.toString());
    if (errors.amount) {
      setErrors({});
    }
  };

  const setFixedAmount = (sol: number) => {
    setAmount(sol.toString());
    if (errors.amount) {
      setErrors({});
    }
  };

  const isDisabled = status !== 'pending';
  const isAmountInvalid = amount.trim() !== '' && (parseInt(amount) <= 0 || (remainingAllowance !== Infinity && parseInt(amount) > remainingAllowance) || isNaN(parseInt(amount)));
  const isUnlimited = maxContribution === Infinity;

  return (
    <div>
      <p className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Enter the presale</p>

      <div className="mt-1 space-y-4">
        {/* Info Section */}
        <div className="bg-[#2B2B2A] rounded-xl p-4 space-y-1">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Max contribution</span>
          <span className="text-sm font-semibold text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            {isUnlimited ? 'Unlimited' : `${maxContribution.toFixed(0)} $ZC`}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Your contribution</span>
          <span className="text-sm font-semibold text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            {userContribution.toFixed(0)} $ZC
          </span>
        </div>
      </div>

      {/* Amount Input */}
      <div className="bg-[#2B2B2A] rounded-xl p-4">
        <div className="flex justify-between mb-2">
          <label className="text-sm text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Amount</label>
        </div>
        <div className="flex items-center gap-3 relative">
          <div className="flex-1 relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="0"
              disabled={isDisabled}
              min="0"
              step="1"
              className="w-full bg-transparent text-3xl font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50 disabled:cursor-not-allowed pr-16"
              style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
              autoComplete="off"
            />
            {!isUnlimited && (
              <button
                type="button"
                onClick={() => setPercentage(100)}
                disabled={isDisabled}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#F7FCFE] bg-[#1E1E1E] hover:bg-[#141414] px-2 py-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                tabIndex={-1}
              >
                MAX
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 bg-[#1E1E1E] rounded-xl px-4 py-2">
            <span className="font-semibold" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>$ZC</span>
          </div>
        </div>
        {errors.amount && (
          <p className="text-sm text-red-400 mt-2" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            {errors.amount}
          </p>
        )}
      </div>

      {/* Quick Select Buttons */}
      <div className="grid grid-cols-4 gap-2">
        {isUnlimited ? (
          <>
            <button
              onClick={() => setFixedAmount(0.1)}
              disabled={isDisabled}
              className="bg-[#2B2B2A] hover:bg-[#333333] rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
            >
              0.1
            </button>
            <button
              onClick={() => setFixedAmount(0.2)}
              disabled={isDisabled}
              className="bg-[#2B2B2A] hover:bg-[#333333] rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
            >
              0.2
            </button>
            <button
              onClick={() => setFixedAmount(0.5)}
              disabled={isDisabled}
              className="bg-[#2B2B2A] hover:bg-[#333333] rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
            >
              0.5
            </button>
            <button
              onClick={() => setFixedAmount(1)}
              disabled={isDisabled}
              className="bg-[#2B2B2A] hover:bg-[#333333] rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
            >
              1
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setPercentage(10)}
              disabled={isDisabled}
              className="bg-[#2B2B2A] hover:bg-[#333333] rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
            >
              10%
            </button>
            <button
              onClick={() => setPercentage(25)}
              disabled={isDisabled}
              className="bg-[#2B2B2A] hover:bg-[#333333] rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
            >
              25%
            </button>
            <button
              onClick={() => setPercentage(50)}
              disabled={isDisabled}
              className="bg-[#2B2B2A] hover:bg-[#333333] rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
            >
              50%
            </button>
            <button
              onClick={() => setPercentage(75)}
              disabled={isDisabled}
              className="bg-[#2B2B2A] hover:bg-[#333333] rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
            >
              75%
            </button>
          </>
        )}
      </div>

      {/* Buy Button */}
      <button
        onClick={handleBuy}
        disabled={isContributing || connecting || (isDisabled && !!wallet) || (isAmountInvalid && !!wallet)}
        className="w-full py-3 text-[14px] font-bold bg-white text-black hover:bg-gray-200 rounded-xl transition-colors disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
        style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
      >
        {connecting ? 'Connecting...' : isContributing ? 'Processing...' : !wallet ? 'Connect Wallet' : status !== 'pending' ? 'Presale Closed' : 'Buy'}
      </button>
      </div>
    </div>
  );
}
