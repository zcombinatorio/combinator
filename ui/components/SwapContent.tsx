'use client';
/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { useState, useEffect } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { useWallet } from '@/components/WalletProvider';
import { usePrivy } from '@privy-io/react-auth';
import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { showToast } from '@/components/Toast';

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

interface SwapContentProps {
  initialToToken?: Token;
}

export function SwapContent({ initialToToken }: SwapContentProps = {} as SwapContentProps) {
  const { wallet, isPrivyAuthenticated } = useWallet();
  const { theme } = useTheme();
  const headingColor = theme === 'dark' ? '#ffffff' : '#0a0a0a';
  const subtitleColor = theme === 'dark' ? '#B8B8B8' : '#717182';
  const { login, authenticated, linkWallet } = usePrivy();
  const [fromToken, setFromToken] = useState<Token>('SOL');
  const [toToken, setToToken] = useState<Token>(initialToToken || 'ZC');
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
    <div className="flex flex-col items-center gap-6 px-5 pt-[160px]">
      {/* Swap Header */}
      <div className="flex flex-col gap-2 items-start w-full max-w-[576px]">
        <h2 className="font-medium text-[20px] leading-[1.34] tracking-[-0.2px]" style={{ fontFamily: 'Inter, sans-serif', color: headingColor }}>
          Swap ZC tokens
        </h2>
        <p className="font-normal text-[14px] leading-[1.2]" style={{ fontFamily: 'Inter, sans-serif', color: subtitleColor }}>
          Balances refresh 10 seconds after swap. Gas fees apply.
        </p>
      </div>

      {/* Swap Container */}
      <div className="flex flex-col gap-5 max-w-[576px] w-full">
        <div className="relative h-[208px]">
          {/* From Token */}
          <div 
            className="absolute rounded-[12px] p-4 top-0 left-0 right-0"
            style={{
              backgroundColor: theme === 'dark' ? '#222222' : '#fafafa',
              border: theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5',
            }}
          >
            <div className="flex justify-between mb-2">
              <label className="text-sm" style={{ fontFamily: 'Inter, sans-serif', color: subtitleColor }}>You pay</label>
              <div className="flex items-center gap-1">
                <span className="text-sm" style={{ fontFamily: 'Inter, sans-serif', color: subtitleColor }}>Balance:</span>
                {getTokenIcon(fromToken).startsWith('/') ? (
                  <img src={getTokenIcon(fromToken)} alt={fromToken} className="w-4 h-4 rounded-full object-cover" />
                ) : (
                  <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">{getTokenIcon(fromToken)}</span>
                  </div>
                )}
                <span className="text-sm" style={{ fontFamily: 'Inter, sans-serif', color: subtitleColor }}>{formatBalance(balances[fromToken])}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setIsMaxAmount(false);
                  }}
                  placeholder="0.0"
                  className={`w-full bg-transparent text-[20px] font-medium leading-[1.34] tracking-[-0.2px] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none pr-12 ${theme === 'dark' ? 'placeholder:text-[#B8B8B8]' : 'placeholder:text-[rgba(164,164,164,0.8)]'}`}
                  style={{ 
                    fontFamily: 'Inter, sans-serif',
                    color: theme === 'dark' ? '#ffffff' : '#0a0a0a',
                  }}
                  step="any"
                />
                <button
                  onClick={() => {
                    setAmount(balances[fromToken]);
                    setIsMaxAmount(true);
                  }}
                  className="absolute right-0 top-1/2 -translate-y-1/2 rounded-[4px] px-2 py-1 text-[12px] font-semibold leading-[16px] transition-colors cursor-pointer"
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    backgroundColor: theme === 'dark' ? '#303030' : '#ffffff',
                    border: theme === 'dark' ? '2px solid #1C1C1C' : '1px solid #e5e5e5',
                    color: subtitleColor,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = theme === 'dark' ? '#3F3E4F' : '#f6f6f7';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = theme === 'dark' ? '#303030' : '#ffffff';
                  }}
                >
                  MAX
                </button>
              </div>
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFromSelector(!showFromSelector);
                    setShowToSelector(false);
                  }}
                  className="flex items-center gap-3 rounded-[12px] px-4 py-2 transition-colors cursor-pointer"
                  style={{
                    backgroundColor: theme === 'dark' ? '#303030' : '#ffffff',
                    border: theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = theme === 'dark' ? '#3F3E4F' : '#f6f6f7';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = theme === 'dark' ? '#303030' : '#ffffff';
                  }}
                >
                  {getTokenIcon(fromToken).startsWith('/') ? (
                    <img src={getTokenIcon(fromToken)} alt={fromToken} className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                      <span className="text-xs font-bold text-white">{getTokenIcon(fromToken)}</span>
                    </div>
                  )}
                  <span className="font-semibold text-[16px] leading-[16px] tracking-[0.32px]" style={{ fontFamily: 'Inter, sans-serif', color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}>{getTokenSymbol(fromToken)}</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showFromSelector && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-full mt-2 left-0 rounded-[12px] overflow-hidden shadow-xl z-50 min-w-[160px]"
                    style={{
                      backgroundColor: theme === 'dark' ? '#303030' : '#ffffff',
                      border: theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5',
                    }}
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
                          backgroundColor: theme === 'dark' ? '#303030' : '#ffffff',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = theme === 'dark' ? '#3F3E4F' : '#fafafa';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = theme === 'dark' ? '#303030' : '#ffffff';
                        }}
                      >
                        {getTokenIcon(token).startsWith('/') ? (
                          <img src={getTokenIcon(token)} alt={token} className="w-6 h-6 rounded-full object-cover" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                            <span className="text-xs font-bold text-white">{getTokenIcon(token)}</span>
                          </div>
                        )}
                        <span className="font-semibold" style={{ fontFamily: 'Inter, sans-serif', color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}>{getTokenSymbol(token)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Switch Button */}
          <div className="absolute left-1/2 top-[86px] -translate-x-1/2 z-10">
            <button
              onClick={switchTokens}
              className="rounded-[12px] p-3 transition-colors cursor-pointer"
              style={{
                backgroundColor: theme === 'dark' ? '#2a2a2a' : '#ffffff',
                border: theme === 'dark' ? '2px solid #1C1C1C' : '2px solid #e5e5e5',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = theme === 'dark' ? '#35343F' : '#f6f6f7';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = theme === 'dark' ? '#2a2a2a' : '#ffffff';
              }}
            >
              <svg 
                className="w-5 h-5" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
                style={{ color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>

          {/* To Token */}
          <div 
            className="absolute rounded-[12px] p-4 top-[108px] left-0 right-0"
            style={{
              backgroundColor: theme === 'dark' ? '#222222' : '#fafafa',
              border: theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5',
            }}
          >
            <div className="flex justify-between mb-2">
              <label className="text-sm" style={{ fontFamily: 'Inter, sans-serif', color: subtitleColor }}>You receive</label>
              <div className="flex items-center gap-1">
                <span className="text-sm" style={{ fontFamily: 'Inter, sans-serif', color: subtitleColor }}>Balance:</span>
                {getTokenIcon(toToken).startsWith('/') ? (
                  <img src={getTokenIcon(toToken)} alt={toToken} className="w-4 h-4 rounded-full object-cover" />
                ) : (
                  <div className="w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">{getTokenIcon(toToken)}</span>
                  </div>
                )}
                <span className="text-sm" style={{ fontFamily: 'Inter, sans-serif', color: subtitleColor }}>{formatBalance(balances[toToken])}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={isCalculating ? '...' : estimatedOutput}
                  readOnly
                  placeholder="0.0"
                  className={`w-full bg-transparent text-[20px] font-medium leading-[1.34] tracking-[-0.2px] focus:outline-none ${theme === 'dark' ? 'placeholder:text-[#B8B8B8]' : 'placeholder:text-[rgba(164,164,164,0.8)]'}`}
                  style={{ 
                    fontFamily: 'Inter, sans-serif',
                    color: theme === 'dark' ? '#ffffff' : '#0a0a0a',
                  }}
                />
              </div>
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowToSelector(!showToSelector);
                    setShowFromSelector(false);
                  }}
                  className="flex items-center gap-3 rounded-[12px] px-4 py-2 transition-colors cursor-pointer"
                  style={{
                    backgroundColor: theme === 'dark' ? '#303030' : '#ffffff',
                    border: theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = theme === 'dark' ? '#3F3E4F' : '#f6f6f7';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = theme === 'dark' ? '#303030' : '#ffffff';
                  }}
                >
                  {getTokenIcon(toToken).startsWith('/') ? (
                    <img src={getTokenIcon(toToken)} alt={toToken} className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                      <span className="text-xs font-bold text-white">{getTokenIcon(toToken)}</span>
                    </div>
                  )}
                  <span className="font-semibold text-[16px] leading-[16px] tracking-[0.32px]" style={{ fontFamily: 'Inter, sans-serif', color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}>{getTokenSymbol(toToken)}</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showToSelector && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-full mt-2 left-0 rounded-[12px] overflow-hidden shadow-xl z-10 min-w-[160px]"
                    style={{
                      backgroundColor: theme === 'dark' ? '#303030' : '#ffffff',
                      border: theme === 'dark' ? '1px solid #1C1C1C' : '1px solid #e5e5e5',
                    }}
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
                          backgroundColor: theme === 'dark' ? '#303030' : '#ffffff',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = theme === 'dark' ? '#3F3E4F' : '#fafafa';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = theme === 'dark' ? '#303030' : '#ffffff';
                        }}
                      >
                        {getTokenIcon(token).startsWith('/') ? (
                          <img src={getTokenIcon(token)} alt={token} className="w-6 h-6 rounded-full object-cover" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                            <span className="text-xs font-bold text-white">{getTokenIcon(token)}</span>
                          </div>
                        )}
                        <span className="font-semibold" style={{ fontFamily: 'Inter, sans-serif', color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}>{getTokenSymbol(token)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Swap Button */}
        <div className="flex items-center justify-center">
          <button
            onClick={!wallet ? handleConnectWallet : handleSwap}
            disabled={
              !!wallet &&
              (isSwapping ||
               !amount ||
               parseFloat(amount) <= 0 ||
               estimatedOutput === 'Error' ||
               parseFloat(amount) > parseFloat(balances[fromToken]))
            }
            className="w-[280px] rounded-[8px] px-4 py-3 transition-opacity disabled:cursor-not-allowed"
            style={{
              fontFamily: 'Inter, sans-serif',
              backgroundColor: !wallet
                ? (theme === 'dark' ? '#404040' : '#f1f3f9')
                : (wallet && amount && parseFloat(amount) > 0 && parseFloat(amount) <= parseFloat(balances[fromToken]) && estimatedOutput !== 'Error')
                ? (theme === 'dark' ? '#5A5798' : '#403d6d')
                : (theme === 'dark' ? '#404040' : '#f1f3f9'),
              color: !wallet
                ? (theme === 'dark' ? '#ffffff' : '#0a0a0a')
                : (wallet && amount && parseFloat(amount) > 0 && parseFloat(amount) <= parseFloat(balances[fromToken]) && estimatedOutput !== 'Error')
                ? '#ffffff'
                : (theme === 'dark' ? '#ffffff' : '#0a0a0a'),
              opacity: (!wallet || (wallet && (!amount || parseFloat(amount) <= 0 || estimatedOutput === 'Error' || parseFloat(amount) > parseFloat(balances[fromToken])))) && theme !== 'dark' ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!e.currentTarget.disabled && !wallet) {
                e.currentTarget.style.backgroundColor = theme === 'dark' ? '#4A4A4A' : '#f1f3f9';
              } else if (!e.currentTarget.disabled && wallet && amount && parseFloat(amount) > 0 && parseFloat(amount) <= parseFloat(balances[fromToken]) && estimatedOutput !== 'Error') {
                e.currentTarget.style.backgroundColor = theme === 'dark' ? '#2F2D4F' : '#403d6d';
              }
            }}
            onMouseLeave={(e) => {
              if (!wallet) {
                e.currentTarget.style.backgroundColor = theme === 'dark' ? '#404040' : '#f1f3f9';
              } else if (wallet && amount && parseFloat(amount) > 0 && parseFloat(amount) <= parseFloat(balances[fromToken]) && estimatedOutput !== 'Error') {
                e.currentTarget.style.backgroundColor = theme === 'dark' ? '#5A5798' : '#403d6d';
              } else {
                e.currentTarget.style.backgroundColor = theme === 'dark' ? '#404040' : '#f1f3f9';
              }
            }}
          >
            <span className="font-semibold text-[16px] leading-[16px] tracking-[0.32px] capitalize">
              {!wallet
                ? 'Connect a wallet'
                : isSwapping
                ? 'Swapping...'
                : wallet && amount && parseFloat(amount) > parseFloat(balances[fromToken])
                ? 'Insufficient Balance'
                : 'Swap'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
