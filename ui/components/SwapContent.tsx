'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletProvider';
import { usePrivy } from '@privy-io/react-auth';
import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { showToast } from '@/components/Toast';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';

// Import refactored services
import { getQuote } from '@/app/(vscode)/swap/services/quoteService';
import { executeSwap } from '@/app/(vscode)/swap/services/swapService';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com';

const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const ZC_MINT = new PublicKey('GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC');
const TEST_MINT = new PublicKey('9q7QYACmxQmj1XATGua2eXpWfZHztibB4gw59FJobCts');
const SHIRTLESS_MINT = new PublicKey('34mjcwkHeZWqJ8Qe3WuMJjHnCZ1pZeAd3AQ1ZJkKH6is');
const GITPOST_MINT = new PublicKey('BSu52RaorX691LxPyGmLp2UiPzM6Az8w2Txd9gxbZN14');
const PERC_MINT = new PublicKey('zcQPTGhdiTMFM6erwko2DWBTkN8nCnAGM7MUX9RpERC');
const ZTORIO_MINT = new PublicKey('5LcnUNQqWZdp67Y7dd7jrSsrqFaBjAixMPVQ3aU7bZTo');

type Token = 'SOL' | 'ZC' | 'TEST' | 'SHIRTLESS' | 'GITPOST' | 'PERC' | 'ZTORIO';

interface SolanaWalletProvider {
  signAndSendTransaction: (transaction: Transaction) => Promise<{ signature: string }>;
}

interface WindowWithWallets extends Window {
  solana?: SolanaWalletProvider;
  solflare?: SolanaWalletProvider;
}

export function SwapContent() {
  const { wallet, isPrivyAuthenticated } = useWallet();
  const { login, authenticated, linkWallet } = usePrivy();
  const [fromToken, setFromToken] = useState<Token>('SOL');
  const [toToken, setToToken] = useState<Token>('ZC');
  const [amount, setAmount] = useState('');
  const [estimatedOutput, setEstimatedOutput] = useState('');
  const [priceImpact, setPriceImpact] = useState<string>('');
  const [isSwapping, setIsSwapping] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [slippage] = useState('1');
  const [lastQuoteTime, setLastQuoteTime] = useState<number>(0);
  const [quoteRefreshCountdown, setQuoteRefreshCountdown] = useState<number>(10);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [showFromSelector, setShowFromSelector] = useState(false);
  const [showToSelector, setShowToSelector] = useState(false);
  const [balances, setBalances] = useState<Record<Token, string>>({ SOL: '0', ZC: '0', TEST: '0', SHIRTLESS: '0', GITPOST: '0', PERC: '0', ZTORIO: '0' });
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [refreshingBalancesAfterSwap, setRefreshingBalancesAfterSwap] = useState(false);
  const [isMaxAmount, setIsMaxAmount] = useState(false);

  const getTokenSymbol = (token: Token): string => {
    if (token === 'SOL') return 'SOL';
    if (token === 'ZC') return 'ZC';
    if (token === 'TEST') return 'TEST';
    if (token === 'SHIRTLESS') return 'SHIRTLESS';
    if (token === 'GITPOST') return 'POST';
    if (token === 'PERC') return 'PERC';
    if (token === 'ZTORIO') return 'ZTORIO';
    return token;
  };

  const getTokenIcon = (token: Token) => {
    if (token === 'SOL') return '/solana_logo.png';
    if (token === 'ZC') return '/zcombinator-logo.png';
    if (token === 'TEST') return '/percent.png';
    if (token === 'SHIRTLESS') return '/shirtless-logo.png';
    if (token === 'GITPOST') return '/gitpost-logo.png';
    if (token === 'PERC') return '/percent.png';
    if (token === 'ZTORIO') return '/ztorio.png';
    return '/percent.png';
  };

  const formatBalance = (balance: string): string => {
    const bal = parseFloat(balance);
    if (bal >= 1000000000) return (bal / 1000000000).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (bal >= 1000000) return (bal / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (bal >= 1000) return (bal / 1000).toFixed(2).replace(/\.?0+$/, '') + 'K';
    return parseFloat(bal.toFixed(4)).toString();
  };

  const copyWalletAddress = () => {
    if (wallet) {
      navigator.clipboard.writeText(wallet.toBase58());
      setCopiedWallet(true);
      setTimeout(() => setCopiedWallet(false), 2000);
    }
  };

  const fetchBalances = async () => {
    if (!wallet) return;

    setIsLoadingBalances(true);
    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const newBalances: Record<Token, string> = { SOL: '0', ZC: '0', TEST: '0', SHIRTLESS: '0', GITPOST: '0', PERC: '0', ZTORIO: '0' };

      // Fetch SOL balance
      const solBalance = await connection.getBalance(wallet);
      newBalances.SOL = (solBalance / LAMPORTS_PER_SOL).toFixed(4);

      // Fetch ZC balance
      try {
        const zcAta = await getAssociatedTokenAddress(ZC_MINT, wallet, true);
        const zcAccount = await getAccount(connection, zcAta);
        newBalances.ZC = (Number(zcAccount.amount) / Math.pow(10, 6)).toFixed(4);
      } catch (e) {
        newBalances.ZC = '0';
      }

      // Fetch TEST balance
      try {
        const testAta = await getAssociatedTokenAddress(TEST_MINT, wallet, true);
        const testAccount = await getAccount(connection, testAta);
        newBalances.TEST = (Number(testAccount.amount) / Math.pow(10, 6)).toFixed(4);
      } catch (e) {
        newBalances.TEST = '0';
      }

      // Fetch SHIRTLESS balance
      try {
        const shirtlessAta = await getAssociatedTokenAddress(SHIRTLESS_MINT, wallet, true);
        const shirtlessAccount = await getAccount(connection, shirtlessAta);
        newBalances.SHIRTLESS = (Number(shirtlessAccount.amount) / Math.pow(10, 6)).toFixed(4);
      } catch (e) {
        newBalances.SHIRTLESS = '0';
      }

      // Fetch GITPOST balance
      try {
        const gitpostAta = await getAssociatedTokenAddress(GITPOST_MINT, wallet, true);
        const gitpostAccount = await getAccount(connection, gitpostAta);
        newBalances.GITPOST = (Number(gitpostAccount.amount) / Math.pow(10, 6)).toFixed(4);
      } catch (e) {
        newBalances.GITPOST = '0';
      }

      // Fetch PERC balance
      try {
        const percAta = await getAssociatedTokenAddress(PERC_MINT, wallet, true);
        const percAccount = await getAccount(connection, percAta);
        newBalances.PERC = (Number(percAccount.amount) / Math.pow(10, 6)).toFixed(4);
      } catch (e) {
        newBalances.PERC = '0';
      }

      // Fetch ZTORIO balance
      try {
        const ztorioAta = await getAssociatedTokenAddress(ZTORIO_MINT, wallet, true);
        const ztorioAccount = await getAccount(connection, ztorioAta);
        newBalances.ZTORIO = (Number(ztorioAccount.amount) / Math.pow(10, 6)).toFixed(4);
      } catch (e) {
        newBalances.ZTORIO = '0';
      }

      setBalances(newBalances);
    } catch (error) {
      console.error('Error fetching balances:', error);
    } finally {
      setIsLoadingBalances(false);
    }
  };

  // Fetch balances on mount and when wallet changes
  useEffect(() => {
    if (wallet && isPrivyAuthenticated) {
      fetchBalances();
    }
  }, [wallet, isPrivyAuthenticated]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setShowFromSelector(false);
      setShowToSelector(false);
    };

    if (showFromSelector || showToSelector) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showFromSelector, showToSelector]);

  const switchTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setAmount('');
    setEstimatedOutput('');
    setIsMaxAmount(false);
  };

  // Determine swap route based on from/to tokens and migration status
  const getSwapRoute = (from: Token, to: Token): 'direct-cp' | 'direct-dbc' | 'double' | 'triple' | 'invalid' => {
    if (from === to) return 'invalid';

    // Direct CP-AMM swaps
    if ((from === 'SOL' && to === 'ZC') || (from === 'ZC' && to === 'SOL')) return 'direct-cp';
    if ((from === 'ZC' && to === 'ZTORIO') || (from === 'ZTORIO' && to === 'ZC')) return 'direct-cp';

    // Direct DBC swaps
    if ((from === 'ZC' && to === 'TEST') || (from === 'TEST' && to === 'ZC')) return 'direct-dbc';
    if ((from === 'ZC' && to === 'SHIRTLESS') || (from === 'SHIRTLESS' && to === 'ZC')) return 'direct-dbc';
    if ((from === 'SHIRTLESS' && to === 'GITPOST') || (from === 'GITPOST' && to === 'SHIRTLESS')) return 'direct-dbc';
    if ((from === 'ZC' && to === 'PERC') || (from === 'PERC' && to === 'ZC')) return 'direct-dbc';

    // Double swaps (2 hops)
    if (from === 'SOL' && to === 'TEST') return 'double';
    if (from === 'TEST' && to === 'SOL') return 'double';
    if (from === 'SOL' && to === 'SHIRTLESS') return 'double';
    if (from === 'SHIRTLESS' && to === 'SOL') return 'double';
    if (from === 'ZC' && to === 'GITPOST') return 'double';
    if (from === 'GITPOST' && to === 'ZC') return 'double';
    if (from === 'SOL' && to === 'PERC') return 'double';
    if (from === 'PERC' && to === 'SOL') return 'double';
    if (from === 'SOL' && to === 'ZTORIO') return 'double';
    if (from === 'ZTORIO' && to === 'SOL') return 'double';
    if (from === 'TEST' && to === 'ZTORIO') return 'double';
    if (from === 'ZTORIO' && to === 'TEST') return 'double';
    if (from === 'SHIRTLESS' && to === 'ZTORIO') return 'double';
    if (from === 'ZTORIO' && to === 'SHIRTLESS') return 'double';
    if (from === 'PERC' && to === 'ZTORIO') return 'double';
    if (from === 'ZTORIO' && to === 'PERC') return 'double';

    // Triple swaps (3 hops)
    if (from === 'TEST' && to === 'SHIRTLESS') return 'triple';
    if (from === 'SHIRTLESS' && to === 'TEST') return 'triple';
    if (from === 'TEST' && to === 'GITPOST') return 'triple';
    if (from === 'GITPOST' && to === 'TEST') return 'triple';
    if (from === 'SOL' && to === 'GITPOST') return 'triple';
    if (from === 'GITPOST' && to === 'SOL') return 'triple';
    if (from === 'ZTORIO' && to === 'GITPOST') return 'triple';
    if (from === 'GITPOST' && to === 'ZTORIO') return 'triple';
    if (from === 'TEST' && to === 'PERC') return 'triple';
    if (from === 'PERC' && to === 'TEST') return 'triple';
    if (from === 'SHIRTLESS' && to === 'PERC') return 'triple';
    if (from === 'PERC' && to === 'SHIRTLESS') return 'triple';
    if (from === 'GITPOST' && to === 'PERC') return 'triple';
    if (from === 'PERC' && to === 'GITPOST') return 'triple';
    if (from === 'ZTORIO' && to === 'PERC') return 'triple';
    if (from === 'PERC' && to === 'ZTORIO') return 'triple';

    return 'invalid';
  };

  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0) {
      setEstimatedOutput('');
      setPriceImpact('');
      return;
    }

    const route = getSwapRoute(fromToken, toToken);
    if (route === 'invalid') {
      setEstimatedOutput('');
      setPriceImpact('');
      return;
    }

    const calculateQuote = async () => {
      setIsCalculating(true);
      try {
        const connection = new Connection(RPC_URL, 'confirmed');

        const quoteResult = await getQuote(
          connection,
          fromToken,
          toToken,
          amount,
          parseFloat(slippage)
        );

        if (quoteResult) {
          setEstimatedOutput(quoteResult.outputAmount);
          if (quoteResult.priceImpact) {
            setPriceImpact(quoteResult.priceImpact);
          }
          setLastQuoteTime(Date.now());
        }
      } catch (error) {
        console.error('Error calculating quote:', error);
        setEstimatedOutput('Error');
      } finally {
        setIsCalculating(false);
      }
    };

    const debounce = setTimeout(calculateQuote, 500);
    return () => clearTimeout(debounce);
  }, [amount, fromToken, toToken, slippage, refreshTrigger]);

  // Auto-refresh quotes every 10 seconds and update countdown
  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0 || !estimatedOutput || estimatedOutput === 'Error') {
      setQuoteRefreshCountdown(10);
      return;
    }

    // Update countdown every second
    const countdownInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastQuoteTime) / 1000);
      const remaining = Math.max(0, 10 - elapsed);
      setQuoteRefreshCountdown(remaining);
    }, 1000);

    // Trigger refresh every 10 seconds
    const refreshInterval = setInterval(() => {
      setRefreshTrigger(prev => prev + 1);
    }, 10000);

    return () => {
      clearInterval(countdownInterval);
      clearInterval(refreshInterval);
    };
  }, [amount, estimatedOutput, lastQuoteTime]);

  const handleConnectWallet = () => {
    try {
      if (!authenticated) {
        login();
      } else {
        linkWallet();
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      showToast('error', 'Failed to connect wallet. Please try again.');
    }
  };

  const handleSwap = async () => {
    const walletProvider = (window as WindowWithWallets).solana || (window as WindowWithWallets).solflare;
    if (!wallet || !isPrivyAuthenticated || !walletProvider) {
      showToast('error', 'Please connect your wallet');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      showToast('error', 'Please enter an amount');
      return;
    }

    setIsSwapping(true);
    try {
      const connection = new Connection(RPC_URL, 'confirmed');

      const result = await executeSwap({
        connection,
        wallet,
        fromToken,
        toToken,
        amount,
        slippage: parseFloat(slippage),
        isMaxAmount,
        walletProvider
      });

      showToast('success', 'Swap successful!');

      // Reset form
      setAmount('');
      setEstimatedOutput('');
      setIsMaxAmount(false);

      // Refresh balances after 10 seconds
      setRefreshingBalancesAfterSwap(true);
      setTimeout(async () => {
        await fetchBalances();
        setRefreshingBalancesAfterSwap(false);
      }, 10000);
    } catch (error: any) {
      console.error('Swap error:', error);
      showToast('error', error?.message || 'Swap failed');
    } finally {
      setIsSwapping(false);
    }
  };

  return (
    <Container>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 style={{ color: 'var(--foreground)' }}>Swap</h1>
          <p className="text-lg mt-2" style={{ color: 'var(--foreground-secondary)' }}>
            Swap tokens on the platform
          </p>
          <p className="text-sm mt-2" style={{ color: 'var(--foreground-secondary)' }}>
            Balances refresh 10 seconds after swap. Gas fees apply.
          </p>
        </div>

        {/* Wallet Info */}
        {isPrivyAuthenticated && wallet && (
          <div className="rounded-2xl p-6 mb-6" style={{ backgroundColor: 'var(--background-secondary)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--foreground-secondary)' }}>Connected Wallet</span>
                <button
                  onClick={copyWalletAddress}
                  className="flex items-center gap-1 text-sm transition-colors cursor-pointer"
                  style={{ color: 'var(--foreground-secondary)' }}
                  title="Copy wallet address"
                >
                  <span>{wallet.toBase58().slice(0, 4)}...{wallet.toBase58().slice(-4)}</span>
                  {copiedWallet ? (
                    <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
                {refreshingBalancesAfterSwap && (
                  <svg className="animate-spin h-4 w-4" style={{ color: 'var(--accent)' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
              </div>
              {isLoadingBalances && (
                <div className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" style={{ color: 'var(--accent)' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>Refreshing...</span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {(['SOL', 'ZC', 'SHIRTLESS', 'GITPOST', 'PERC', 'ZTORIO'] as Token[]).map((token) => (
                <div key={token} className="rounded-lg p-3 flex items-center gap-3" style={{ backgroundColor: 'var(--background-tertiary)' }}>
                  {getTokenIcon(token).startsWith('/') ? (
                    <img src={getTokenIcon(token)} alt={token} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-white">{getTokenIcon(token)}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                      {(() => {
                        const balance = parseFloat(balances[token]);
                        if (balance >= 1000000000) return (balance / 1000000000).toFixed(2).replace(/\.?0+$/, '') + 'B';
                        if (balance >= 1000000) return (balance / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
                        if (balance >= 1000) return (balance / 1000).toFixed(2).replace(/\.?0+$/, '') + 'K';
                        return parseFloat(balance.toFixed(4)).toString();
                      })()}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--foreground-secondary)' }}>{getTokenSymbol(token)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Swap Container */}
        <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--background-secondary)', border: '1px solid var(--border)' }}>
          {/* From Token */}
          <div className="rounded-xl p-4 mb-2" style={{ backgroundColor: 'var(--background-tertiary)' }}>
            <div className="flex justify-between mb-2">
              <label className="text-sm font-medium" style={{ color: 'var(--foreground-secondary)' }}>You pay</label>
              <div className="flex items-center gap-1">
                <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                  <span className="md:hidden">Bal:</span>
                  <span className="hidden md:inline">Balance:</span>
                </span>
                {getTokenIcon(fromToken).startsWith('/') ? (
                  <img src={getTokenIcon(fromToken)} alt={fromToken} className="w-4 h-4 rounded-full object-cover" />
                ) : (
                  <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">{getTokenIcon(fromToken)}</span>
                  </div>
                )}
                <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>{formatBalance(balances[fromToken])}</span>
              </div>
            </div>
            <div className="flex items-center gap-3 relative">
              <div className="flex-1 relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setIsMaxAmount(false);
                  }}
                  placeholder="0.0"
                  className="w-full bg-transparent text-3xl font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none pr-16"
                  style={{ color: 'var(--foreground)' }}
                  step="any"
                />
                <button
                  onClick={() => {
                    setAmount(balances[fromToken]);
                    setIsMaxAmount(true);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold px-2 py-1 rounded transition-colors"
                  style={{
                    color: 'var(--foreground)',
                    backgroundColor: 'var(--background-secondary)'
                  }}
                >
                  MAX
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFromSelector(!showFromSelector);
                    setShowToSelector(false);
                  }}
                  className="flex items-center gap-2 rounded-xl px-4 py-2 transition-colors"
                  style={{ backgroundColor: 'var(--background-secondary)' }}
                >
                  {getTokenIcon(fromToken).startsWith('/') ? (
                    <img src={getTokenIcon(fromToken)} alt={fromToken} className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                      <span className="text-xs font-bold text-white">{getTokenIcon(fromToken)}</span>
                    </div>
                  )}
                  <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{getTokenSymbol(fromToken)}</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--foreground-secondary)' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showFromSelector && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-full mt-2 left-0 rounded-xl overflow-hidden shadow-xl z-50 min-w-[160px]"
                    style={{ backgroundColor: 'var(--background-secondary)', border: '1px solid var(--border)' }}
                  >
                    {(['SOL', 'ZC', 'SHIRTLESS', 'GITPOST', 'PERC', 'ZTORIO'] as Token[]).filter(t => t !== fromToken && t !== toToken).map((token) => (
                      <button
                        key={token}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFromToken(token);
                          setShowFromSelector(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 transition-colors"
                        style={{
                          backgroundColor: 'transparent',
                          color: 'var(--foreground)'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--background-tertiary)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        {getTokenIcon(token).startsWith('/') ? (
                          <img src={getTokenIcon(token)} alt={token} className="w-6 h-6 rounded-full object-cover" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                            <span className="text-xs font-bold text-white">{getTokenIcon(token)}</span>
                          </div>
                        )}
                        <span className="font-semibold">{getTokenSymbol(token)}</span>
                      </button>
                    ))}
                  </div>
                )}
                </div>
              </div>
            </div>
          </div>

          {/* Switch Button */}
          <div className="flex justify-center -my-3 relative z-[5]">
            <button
              onClick={switchTokens}
              className="p-2 rounded-xl transition-colors border-4"
              style={{
                backgroundColor: 'var(--background-secondary)',
                borderColor: 'var(--background)',
                color: 'var(--foreground-secondary)'
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>

          {/* To Token */}
          <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'var(--background-tertiary)' }}>
            <div className="flex justify-between mb-2">
              <label className="text-sm font-medium" style={{ color: 'var(--foreground-secondary)' }}>You receive</label>
              <div className="flex items-center gap-1">
                <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                  <span className="md:hidden">Bal:</span>
                  <span className="hidden md:inline">Balance:</span>
                </span>
                {getTokenIcon(toToken).startsWith('/') ? (
                  <img src={getTokenIcon(toToken)} alt={toToken} className="w-4 h-4 rounded-full object-cover" />
                ) : (
                  <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">{getTokenIcon(toToken)}</span>
                  </div>
                )}
                <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>{formatBalance(balances[toToken])}</span>
              </div>
            </div>
            <div className="flex items-center gap-3 relative">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={isCalculating ? '...' : estimatedOutput}
                  readOnly
                  placeholder="0.0"
                  className="w-full bg-transparent text-3xl font-semibold focus:outline-none pr-16"
                  style={{ color: 'var(--foreground)' }}
                />
              </div>
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowToSelector(!showToSelector);
                    setShowFromSelector(false);
                  }}
                  className="flex items-center gap-2 rounded-xl px-4 py-2 transition-colors"
                  style={{ backgroundColor: 'var(--background-secondary)' }}
                >
                  {getTokenIcon(toToken).startsWith('/') ? (
                    <img src={getTokenIcon(toToken)} alt={toToken} className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                      <span className="text-xs font-bold text-white">{getTokenIcon(toToken)}</span>
                    </div>
                  )}
                  <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{getTokenSymbol(toToken)}</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--foreground-secondary)' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showToSelector && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-full mt-2 left-0 rounded-xl overflow-hidden shadow-xl z-10 min-w-[160px]"
                    style={{ backgroundColor: 'var(--background-secondary)', border: '1px solid var(--border)' }}
                  >
                    {(['SOL', 'ZC', 'SHIRTLESS', 'GITPOST', 'PERC', 'ZTORIO'] as Token[]).filter(t => t !== fromToken && t !== toToken).map((token) => (
                      <button
                        key={token}
                        onClick={(e) => {
                          e.stopPropagation();
                          setToToken(token);
                          setShowToSelector(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 transition-colors"
                        style={{
                          backgroundColor: 'transparent',
                          color: 'var(--foreground)'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--background-tertiary)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        {getTokenIcon(token).startsWith('/') ? (
                          <img src={getTokenIcon(token)} alt={token} className="w-6 h-6 rounded-full object-cover" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                            <span className="text-xs font-bold text-white">{getTokenIcon(token)}</span>
                          </div>
                        )}
                        <span className="font-semibold">{getTokenSymbol(token)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Swap Info */}
          {estimatedOutput && estimatedOutput !== 'Error' && (
            <div className="rounded-xl p-4 mb-4 text-sm space-y-2" style={{ backgroundColor: 'var(--background-tertiary)' }}>
              <div className="flex justify-between items-center" style={{ color: 'var(--foreground-secondary)' }}>
                <span>Rate</span>
                <div className="flex items-center gap-2">
                  <span>1 {getTokenSymbol(fromToken)} = {(parseFloat(estimatedOutput) / parseFloat(amount || '1')).toFixed(6)} {getTokenSymbol(toToken)}</span>
                  {quoteRefreshCountdown > 0 && (
                    <span className="text-xs" style={{ color: 'var(--foreground-secondary)', opacity: 0.7 }}>({quoteRefreshCountdown}s)</span>
                  )}
                </div>
              </div>
              {priceImpact && (
                <div className="flex justify-between" style={{ color: 'var(--foreground-secondary)' }}>
                  <span>Price impact</span>
                  <span className={parseFloat(priceImpact) >= 10 ? 'text-red-400' : parseFloat(priceImpact) >= 5 ? 'text-yellow-400' : 'text-green-400'}>
                    {parseFloat(priceImpact).toFixed(2)}%
                  </span>
                </div>
              )}
              <div className="flex justify-between" style={{ color: 'var(--foreground-secondary)' }}>
                <span>Route</span>
                <span className="flex items-center gap-1 text-right">
                  {getSwapRoute(fromToken, toToken) === 'direct-cp' && (
                    <>
                      {getTokenIcon(fromToken).startsWith('/') ? (
                        <img src={getTokenIcon(fromToken)} alt={fromToken} className="w-4 h-4 rounded-full object-cover" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                          <span className="text-[10px] font-bold text-white">{getTokenIcon(fromToken)}</span>
                        </div>
                      )}
                      <span>→</span>
                      {getTokenIcon(toToken).startsWith('/') ? (
                        <img src={getTokenIcon(toToken)} alt={toToken} className="w-4 h-4 rounded-full object-cover" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                          <span className="text-[10px] font-bold text-white">{getTokenIcon(toToken)}</span>
                        </div>
                      )}
                    </>
                  )}
                  {getSwapRoute(fromToken, toToken) === 'direct-dbc' && (
                    <>
                      {getTokenIcon(fromToken).startsWith('/') ? (
                        <img src={getTokenIcon(fromToken)} alt={fromToken} className="w-4 h-4 rounded-full object-cover" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                          <span className="text-[10px] font-bold text-white">{getTokenIcon(fromToken)}</span>
                        </div>
                      )}
                      <span>→</span>
                      {getTokenIcon(toToken).startsWith('/') ? (
                        <img src={getTokenIcon(toToken)} alt={toToken} className="w-4 h-4 rounded-full object-cover" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                          <span className="text-[10px] font-bold text-white">{getTokenIcon(toToken)}</span>
                        </div>
                      )}
                    </>
                  )}
                  {getSwapRoute(fromToken, toToken) === 'double' && (() => {
                    let middleToken: Token;
                    if ((fromToken === 'ZC' && toToken === 'GITPOST') || (fromToken === 'GITPOST' && toToken === 'ZC')) {
                      middleToken = 'SHIRTLESS';
                    } else if ((fromToken === 'SOL' && toToken === 'SHIRTLESS') || (fromToken === 'SHIRTLESS' && toToken === 'SOL')) {
                      middleToken = 'ZC';
                    } else {
                      middleToken = 'ZC';
                    }

                    return (
                      <>
                        {getTokenIcon(fromToken).startsWith('/') ? (
                          <img src={getTokenIcon(fromToken)} alt={fromToken} className="w-4 h-4 rounded-full object-cover" />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                            <span className="text-[10px] font-bold text-white">{getTokenIcon(fromToken)}</span>
                          </div>
                        )}
                        <span>→</span>
                        {getTokenIcon(middleToken).startsWith('/') ? (
                          <img src={getTokenIcon(middleToken)} alt={middleToken} className="w-4 h-4 rounded-full object-cover" />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                            <span className="text-[10px] font-bold text-white">{getTokenIcon(middleToken)}</span>
                          </div>
                        )}
                        <span>→</span>
                        {getTokenIcon(toToken).startsWith('/') ? (
                          <img src={getTokenIcon(toToken)} alt={toToken} className="w-4 h-4 rounded-full object-cover" />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                            <span className="text-[10px] font-bold text-white">{getTokenIcon(toToken)}</span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                  {getSwapRoute(fromToken, toToken) === 'triple' && (
                    <>
                      {getTokenIcon(fromToken).startsWith('/') ? (
                        <img src={getTokenIcon(fromToken)} alt={fromToken} className="w-4 h-4 rounded-full object-cover" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                          <span className="text-[10px] font-bold text-white">{getTokenIcon(fromToken)}</span>
                        </div>
                      )}
                      <span>→</span>
                      {getTokenIcon('ZC').startsWith('/') ? (
                        <img src={getTokenIcon('ZC')} alt="ZC" className="w-4 h-4 rounded-full object-cover" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                          <span className="text-[10px] font-bold text-white">{getTokenIcon('ZC')}</span>
                        </div>
                      )}
                      <span>→</span>
                      {getTokenIcon('SHIRTLESS').startsWith('/') ? (
                        <img src={getTokenIcon('SHIRTLESS')} alt="SHIRTLESS" className="w-4 h-4 rounded-full object-cover" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                          <span className="text-[10px] font-bold text-white">{getTokenIcon('SHIRTLESS')}</span>
                        </div>
                      )}
                      <span>→</span>
                      {getTokenIcon(toToken).startsWith('/') ? (
                        <img src={getTokenIcon(toToken)} alt={toToken} className="w-4 h-4 rounded-full object-cover" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                          <span className="text-[10px] font-bold text-white">{getTokenIcon(toToken)}</span>
                        </div>
                      )}
                    </>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Swap Button */}
          {!wallet ? (
            <Button
              variant="primary"
              size="lg"
              onClick={handleConnectWallet}
              className="w-full"
            >
              Connect Wallet
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              onClick={handleSwap}
              disabled={
                isSwapping ||
                !amount ||
                parseFloat(amount) <= 0 ||
                estimatedOutput === 'Error' ||
                parseFloat(amount) > parseFloat(balances[fromToken])
              }
              className="w-full"
            >
              {isSwapping
                ? 'Swapping...'
                : wallet && amount && parseFloat(amount) > parseFloat(balances[fromToken])
                ? <><span className="md:hidden">Insufficient Bal</span><span className="hidden md:inline">Insufficient Balance</span></>
                : 'Swap'}
            </Button>
          )}
        </div>
      </div>
    </Container>
  );
}
