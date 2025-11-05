'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletProvider';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  createBurnInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  getMint,
  getAccount
} from '@solana/spl-token';
import { useSignTransaction } from '@privy-io/react-auth/solana';
import { showToast } from '@/components/Toast';
import { useLaunchInfo } from '@/hooks/useTokenData';

interface BurnContentProps {
  tokenAddress: string;
  tokenSymbol: string;
  userBalance: string;
}

export function BurnContent({ tokenAddress, tokenSymbol: initialSymbol, userBalance: initialBalance }: BurnContentProps) {
  const { wallet, activeWallet } = useWallet();
  const { signTransaction } = useSignTransaction();
  const [amount, setAmount] = useState('');
  const [isBurning, setIsBurning] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string }>({});
  const [burnProgress, setBurnProgress] = useState<string>('');
  const [userBalance, setUserBalance] = useState(initialBalance);
  const [tokenSymbol, setTokenSymbol] = useState(initialSymbol);
  const [tokenName, setTokenName] = useState('');
  const [tokenImageUri, setTokenImageUri] = useState<string | undefined>();

  // Fetch token info from API
  const { launchData } = useLaunchInfo(tokenAddress);

  useEffect(() => {
    const launch = launchData?.launches?.[0];
    if (launch) {
      setTokenSymbol(launch.token_symbol || initialSymbol);
      setTokenName(launch.token_name || '');

      if (launch.image_uri) {
        setTokenImageUri(launch.image_uri);
      } else if (launch.token_metadata_url) {
        fetch(launch.token_metadata_url)
          .then(res => res.json())
          .then(metadata => {
            if (metadata.image) {
              setTokenImageUri(metadata.image);
            }
          })
          .catch(() => {});
      }
    }
  }, [launchData, initialSymbol]);

  // Fetch user balance
  useEffect(() => {
    if (!wallet) return;

    const fetchBalance = async () => {
      try {
        const { Connection } = await import('@solana/web3.js');
        const connection = new Connection(process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com');

        const mintPublicKey = new PublicKey(tokenAddress);
        const tokenAccount = await getAssociatedTokenAddress(mintPublicKey, wallet);

        const accountInfo = await getAccount(connection, tokenAccount);
        const mintInfo = await getMint(connection, mintPublicKey);

        const balance = Number(accountInfo.amount) / Math.pow(10, mintInfo.decimals);
        setUserBalance(balance.toString());
      } catch (error) {
        console.error('Error fetching balance:', error);
        setUserBalance('0');
      }
    };

    fetchBalance();
  }, [wallet, tokenAddress]);

  // Helper function to safely parse user balance
  const parseUserBalance = (balance: string): number => {
    if (balance === '--') return 0;
    const parsed = parseFloat(balance);
    return isNaN(parsed) ? 0 : parsed;
  };

  const validateInputs = () => {
    const newErrors: { amount?: string } = {};

    // Validate amount
    if (!amount || amount.trim() === '') {
      newErrors.amount = 'Amount is required';
    } else {
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        newErrors.amount = 'Amount must be a positive number';
      } else if (numAmount > parseUserBalance(userBalance)) {
        newErrors.amount = 'Amount exceeds available balance';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Live validation on input change
  const handleAmountChange = (value: string) => {
    setAmount(value);
    if (errors.amount) {
      const numAmount = parseFloat(value);
      if (!isNaN(numAmount) && numAmount > 0 && numAmount <= parseUserBalance(userBalance)) {
        setErrors({});
      }
    }
  };

  const handleBurn = async () => {
    if (!validateInputs() || !wallet || !activeWallet) return;

    setIsBurning(true);
    setBurnProgress('Preparing burn transaction...');

    try {
      const { Connection } = await import('@solana/web3.js');
      const connection = new Connection(process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com');

      const ownerPublicKey = wallet;
      const mintPublicKey = new PublicKey(tokenAddress);

      // Get actual token decimals
      const mintInfo = await getMint(connection, mintPublicKey);
      const decimals = mintInfo.decimals;

      // Convert amount to token units using actual decimals
      const amountInTokens = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, decimals)));

      // Get associated token account
      const tokenAccount = await getAssociatedTokenAddress(mintPublicKey, ownerPublicKey);

      // Create burn instruction
      const burnInstruction = createBurnInstruction(
        tokenAccount,
        mintPublicKey,
        ownerPublicKey,
        amountInTokens,
        [],
        TOKEN_PROGRAM_ID
      );

      // Create transaction
      const transaction = new Transaction();
      transaction.add(burnInstruction);

      // Get recent blockhash and set transaction properties
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = ownerPublicKey;

      // Sign and send transaction with modern approach
      setBurnProgress('Please approve transaction in your wallet...');
      const serializedTransaction = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });

      const { signedTransaction: signedTxBytes } = await signTransaction({
        transaction: serializedTransaction,
        wallet: activeWallet!
      });

      const signedTransaction = Transaction.from(signedTxBytes);
      const signature = await connection.sendRawTransaction(
        signedTransaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        }
      );

      setBurnProgress('Confirming burn transaction...');

      // Simple confirmation polling like other parts of the app
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

      // Show success toast
      showToast('success', `Successfully burned ${amount} ${tokenSymbol} tokens`);

      // Reset form and refresh balance
      setAmount('');

      // Refresh balance
      const mintPublicKey2 = new PublicKey(tokenAddress);
      const tokenAccount2 = await getAssociatedTokenAddress(mintPublicKey2, ownerPublicKey);
      const accountInfo = await getAccount(connection, tokenAccount2);
      const balance = Number(accountInfo.amount) / Math.pow(10, decimals);
      setUserBalance(balance.toString());

    } catch (error) {
      console.error('Burn error:', error);
      // Better error handling
      let errorMessage = 'Burn failed';
      if (error instanceof Error) {
        if (error.message.includes('User rejected')) {
          errorMessage = 'Transaction cancelled';
        } else if (error.message.includes('insufficient')) {
          errorMessage = 'Insufficient SOL for transaction fee';
        } else {
          errorMessage = error.message;
        }
      }
      showToast('error', errorMessage);
      setErrors({ amount: errorMessage });
    } finally {
      setIsBurning(false);
      setBurnProgress('');
    }
  };

  return (
    <div>
      {/* Header */}
      <h1 className="text-7xl font-bold">Burn Tokens</h1>
      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
        {'//'}Permanently burn ${tokenSymbol} tokens
      </p>

      {/* Token Info */}
      <div className="mt-5.5">
        <div className="flex items-center gap-3 text-[14px]" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
          {tokenImageUri && (
            <img
              src={tokenImageUri}
              alt={tokenSymbol}
              className="w-8 h-8 rounded-full"
              onError={(e) => {
                e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="gray"><circle cx="12" cy="12" r="10"/></svg>';
              }}
            />
          )}
          <span className="font-bold text-white">{tokenSymbol}</span>
          {tokenName && <span className="text-white">{tokenName}</span>}
          <span
            onClick={() => {
              navigator.clipboard.writeText(tokenAddress);
            }}
            className="text-gray-300 cursor-pointer hover:text-[#EF6400] transition-colors"
            title="Click to copy full address"
          >
            {tokenAddress.slice(0, 6)}...{tokenAddress.slice(-6)}
          </span>
        </div>
      </div>

      {/* Burn Form */}
      <div className="mt-7 max-w-xl">
        <div className="space-y-6">
          <div className="bg-[#2B2B2A] rounded-xl p-4 mb-4">
            <div className="flex justify-between mb-2">
              <label className="text-sm text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Amount to burn</label>
              <span className="text-sm text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                Available: {userBalance === '--' ? '--' : parseUserBalance(userBalance).toLocaleString()} {tokenSymbol}
              </span>
            </div>
            <div className="flex items-center gap-3 relative">
              <div className="flex-1 relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => handleAmountChange(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-transparent text-3xl font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none pr-16"
                  style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                  disabled={isBurning}
                />
                <button
                  type="button"
                  onClick={() => setAmount(userBalance === '--' ? '0' : userBalance)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#F7FCFE] bg-[#1E1E1E] hover:bg-[#141414] px-2 py-1 rounded transition-colors"
                  style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                  disabled={isBurning}
                >
                  MAX
                </button>
              </div>
            </div>
            {errors.amount && <p className="text-red-400 text-sm mt-2" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{errors.amount}</p>}
          </div>

          {burnProgress && (
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-400"></div>
              <p className="text-sm text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{burnProgress}</p>
            </div>
          )}

          <button
            onClick={handleBurn}
            disabled={isBurning}
            className="w-full py-3 text-[14px] font-bold bg-red-500 text-white hover:bg-red-600 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
          >
            {isBurning ? 'Burning...' : 'Burn Tokens'}
          </button>
        </div>
      </div>
    </div>
  );
}
