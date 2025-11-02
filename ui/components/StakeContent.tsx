'use client';

import { useState, useEffect, useCallback, useMemo } from "react";
import { PublicKey, Connection, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { useWallet } from '@/components/WalletProvider';
import { showToast } from '@/components/Toast';
import VaultIDL from '@/lib/vault-idl.json';
import { usePrivy } from '@privy-io/react-auth';

const ZC_TOKEN_MINT = new PublicKey("GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC");
const PROGRAM_ID = new PublicKey("6CETAFdgoMZgNHCcjnnQLN2pu5pJgUz8QQd7JzcynHmD");

interface SolanaWalletProvider {
  signAndSendTransaction: (transaction: Transaction) => Promise<{ signature: string }>;
}

interface WindowWithWallets extends Window {
  solana?: SolanaWalletProvider;
  solflare?: SolanaWalletProvider;
}

export function StakeContent() {
  const { wallet, isPrivyAuthenticated } = useWallet();
  const { login, authenticated, linkWallet } = usePrivy();

  const [loading, setLoading] = useState(false);
  const [modalMode, setModalMode] = useState<"deposit" | "redeem">("deposit");
  const [amount, setAmount] = useState<string>("");
  const [redeemPercent, setRedeemPercent] = useState<string>("");

  const [zcBalance, setZcBalance] = useState<number>(0);
  const [vaultBalance, setVaultBalance] = useState<number>(0);
  const [userShareBalance, setUserShareBalance] = useState<number>(0);
  const [userShareValue, setUserShareValue] = useState<number>(0);
  const [exchangeRate, setExchangeRate] = useState<number>(0);
  const [zcTotalSupply, setZcTotalSupply] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);
  const [postTransactionRefreshing, setPostTransactionRefreshing] = useState(false);
  const [withdrawalsEnabled, setWithdrawalsEnabled] = useState<boolean>(true);
  const [copiedWallet, setCopiedWallet] = useState(false);

  const connection = useMemo(() => new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com"), []);

  const getProvider = useCallback(() => {
    if (typeof window === 'undefined') return null;

    const walletProvider = (window as WindowWithWallets).solana || (window as WindowWithWallets).solflare;
    if (!wallet || !walletProvider) return null;

    try {
      const provider = new AnchorProvider(
        connection,
        walletProvider as unknown as AnchorProvider['wallet'],
        { commitment: "confirmed" }
      );
      return provider;
    } catch (error) {
      console.error("Failed to create provider:", error);
      return null;
    }
  }, [wallet, connection]);

  const getProgram = useCallback((): Program | null => {
    const provider = getProvider();
    if (!provider) return null;
    return new Program(VaultIDL as unknown as Program['idl'], provider);
  }, [getProvider]);

  const program = useMemo(() => getProgram(), [getProgram]);

  const calculateAPY = useCallback((): number => {
    if (vaultBalance === 0) return 0;
    const REWARD_TOKENS = 15000000;
    const rewardPerToken = REWARD_TOKENS / vaultBalance;
    const compoundingPeriodsPerYear = 52;
    return 100 * (Math.pow(1 + rewardPerToken, compoundingPeriodsPerYear) - 1);
  }, [vaultBalance]);

  const fetchZcBalance = useCallback(async () => {
    if (!wallet) {
      setZcBalance(0);
      return;
    }

    try {
      const userTokenAccount = await getAssociatedTokenAddress(ZC_TOKEN_MINT, wallet);
      const userTokenAccountInfo = await getAccount(connection, userTokenAccount);
      const balance = Number(userTokenAccountInfo.amount) / 1_000_000;
      setZcBalance(balance);

      const mintInfo = await connection.getParsedAccountInfo(ZC_TOKEN_MINT);
      if (mintInfo.value?.data && 'parsed' in mintInfo.value.data) {
        const supply = Number(mintInfo.value.data.parsed.info.supply) / 1_000_000;
        setZcTotalSupply(supply);
      }
    } catch {
      console.log("User ZC token account not found");
      setZcBalance(0);
    }
  }, [wallet, connection]);

  const fetchVaultData = useCallback(async (retryCount = 0, maxRetries = 3) => {
    try {
      setRefreshing(true);
      if (!program || !wallet) {
        console.log("No program or wallet available");
        return;
      }

      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );
      const [shareMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("share_mint")],
        PROGRAM_ID
      );

      try {
        const vaultStateAccountInfo = await connection.getAccountInfo(vaultState);
        if (vaultStateAccountInfo && vaultStateAccountInfo.data) {
          const vaultStateAccount = program.coder.accounts.decode("vaultState", vaultStateAccountInfo.data);
          setWithdrawalsEnabled(vaultStateAccount.operationsEnabled);
        } else {
          setWithdrawalsEnabled(false);
        }
      } catch (error) {
        console.error("Failed to fetch vault state:", error);
        setWithdrawalsEnabled(false);
      }

      try {
        const totalAssets = await program.methods
          .totalAssets()
          .accounts({
            vaultTokenAccount,
            mintOfTokenBeingSent: ZC_TOKEN_MINT,
          })
          .view();
        setVaultBalance(Number(totalAssets) / 1_000_000);
      } catch (error) {
        console.error("Failed to fetch vault metrics:", error);
        setVaultBalance(0);
      }

      try {
        const oneShare = new BN(1_000_000);
        const assetsForOneShare = await program.methods
          .previewRedeem(oneShare)
          .accounts({
            shareMint,
            vaultTokenAccount,
            mintOfTokenBeingSent: ZC_TOKEN_MINT,
          })
          .view();
        setExchangeRate(Number(assetsForOneShare) / 1_000_000);
      } catch (error) {
        console.error("Failed to fetch exchange rate:", error);
        setExchangeRate(1);
      }

      try {
        const userShareAccount = await getAssociatedTokenAddress(shareMint, wallet);
        const userShareAccountInfo = await getAccount(connection, userShareAccount);
        const shareBalance = Number(userShareAccountInfo.amount) / 1_000_000;
        setUserShareBalance(shareBalance);

        if (shareBalance > 0) {
          const assets = await program.methods
            .previewRedeem(new BN(userShareAccountInfo.amount.toString()))
            .accounts({
              shareMint,
              vaultTokenAccount,
              mintOfTokenBeingSent: ZC_TOKEN_MINT,
            })
            .view();
          setUserShareValue(Number(assets) / 1_000_000);
        } else {
          setUserShareValue(0);
        }
      } catch {
        console.log("User share account not found");
        if (retryCount < maxRetries) {
          const delay = Math.pow(2, retryCount) * 1000;
          setTimeout(() => {
            fetchVaultData(retryCount + 1, maxRetries);
          }, delay);
          return;
        }
        setUserShareBalance(0);
        setUserShareValue(0);
      }
    } catch (error) {
      console.error("Failed to fetch vault data:", error);
    } finally {
      setRefreshing(false);
    }
  }, [wallet, connection, program]);

  useEffect(() => {
    if (wallet) {
      fetchZcBalance();
      fetchVaultData();
    }
  }, [wallet, fetchZcBalance, fetchVaultData]);

  const handleDeposit = async () => {
    const depositAmount = parseFloat(amount);
    if (!depositAmount || depositAmount <= 0) {
      showToast('error', 'Please enter a valid deposit amount');
      return;
    }

    const walletProvider = (window as WindowWithWallets).solana || (window as WindowWithWallets).solflare;
    if (!wallet || !walletProvider) {
      showToast('error', 'Please connect your wallet first');
      return;
    }

    try {
      setLoading(true);
      if (!program) throw new Error("Program not available");

      const depositAmountBN = new BN(depositAmount * 1_000_000);

      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );
      const [tokenAccountOwnerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_account_owner_pda")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );
      const [shareMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("share_mint")],
        PROGRAM_ID
      );

      const senderTokenAccount = await getAssociatedTokenAddress(ZC_TOKEN_MINT, wallet);
      const senderShareAccount = await getAssociatedTokenAddress(shareMint, wallet);

      const transaction = new Transaction();
      try {
        await getAccount(connection, senderShareAccount);
      } catch {
        const createATAIx = createAssociatedTokenAccountInstruction(
          wallet,
          senderShareAccount,
          wallet,
          shareMint,
          TOKEN_PROGRAM_ID
        );
        transaction.add(createATAIx);
      }

      const depositIx = await program.methods
        .deposit(depositAmountBN)
        .accounts({
          vaultState,
          tokenAccountOwnerPda,
          vaultTokenAccount,
          senderTokenAccount,
          senderShareAccount,
          shareMint,
          mintOfTokenBeingSent: ZC_TOKEN_MINT,
          signer: wallet,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      transaction.add(depositIx);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet;

      const { signature } = await walletProvider.signAndSendTransaction(transaction);
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      showToast('success', `Staked ${depositAmount} ZC to the vault`);
      setAmount("");

      setPostTransactionRefreshing(true);
      setTimeout(async () => {
        await Promise.all([fetchVaultData(), fetchZcBalance()]);
        setPostTransactionRefreshing(false);
      }, 8000);
    } catch (error) {
      console.error("Deposit failed:", error);
      showToast('error', error instanceof Error ? error.message : "Failed to deposit tokens");
    } finally {
      setLoading(false);
    }
  };

  const handleRedeem = async () => {
    const redeemPercentNum = parseFloat(redeemPercent);
    if (!redeemPercentNum || redeemPercentNum <= 0 || redeemPercentNum > 100) {
      showToast('error', 'Please enter a valid percentage between 0 and 100');
      return;
    }

    const walletProvider = (window as WindowWithWallets).solana || (window as WindowWithWallets).solflare;
    if (!wallet || !walletProvider) {
      showToast('error', 'Please connect your wallet first');
      return;
    }

    try {
      setLoading(true);
      if (!program) throw new Error("Program not available");

      const [shareMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("share_mint")],
        PROGRAM_ID
      );
      const userShareAccount = await getAssociatedTokenAddress(shareMint, wallet);
      const userShareAccountInfo = await getAccount(connection, userShareAccount);
      const totalShares = userShareAccountInfo.amount;
      const sharesToRedeem = (totalShares * BigInt(Math.floor(redeemPercentNum * 100))) / BigInt(10000);

      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );
      const [tokenAccountOwnerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_account_owner_pda")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );

      const senderTokenAccount = await getAssociatedTokenAddress(ZC_TOKEN_MINT, wallet);
      const senderShareAccount = userShareAccount;

      const transaction = new Transaction();

      try {
        await getAccount(connection, senderTokenAccount);
      } catch {
        const createATAIx = createAssociatedTokenAccountInstruction(
          wallet,
          senderTokenAccount,
          wallet,
          ZC_TOKEN_MINT,
          TOKEN_PROGRAM_ID
        );
        transaction.add(createATAIx);
      }

      const redeemIx = await program.methods
        .redeem(new BN(sharesToRedeem.toString()))
        .accounts({
          vaultState,
          tokenAccountOwnerPda,
          vaultTokenAccount,
          senderTokenAccount,
          senderShareAccount,
          shareMint,
          mintOfTokenBeingSent: ZC_TOKEN_MINT,
          signer: wallet,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      transaction.add(redeemIx);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet;

      const { signature } = await walletProvider.signAndSendTransaction(transaction);
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      showToast('success', `Redeemed ${redeemPercentNum}% of your vault shares for ZC`);
      setRedeemPercent("");

      setPostTransactionRefreshing(true);
      setTimeout(async () => {
        await Promise.all([fetchVaultData(), fetchZcBalance()]);
        setPostTransactionRefreshing(false);
      }, 8000);
    } catch (error) {
      console.error("Redemption failed:", error);
      showToast('error', error instanceof Error ? error.message : "Failed to redeem shares");
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const formatCompactNumber = (num: number): string => {
    if (num >= 1_000_000_000) {
      return `${(num / 1_000_000_000).toFixed(1)}B`;
    } else if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toLocaleString();
  };

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    showToast('success', 'Address copied to clipboard');
    setCopiedWallet(true);
    setTimeout(() => setCopiedWallet(false), 2000);
  };

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

  return (
    <div style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
      <h1 className="text-7xl font-bold">Stake</h1>

      <div>
        {/* Wallet Section */}
        <div className="space-y-8">
          {/* Vault Description */}
          <div className="pb-0">
            <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Stake to earn yield and get rewarded more for your contributions</p>
            <p className="mt-1 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Staking for other ZC launches will be live soon</p>
            <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Once you stake, funds are <span className="font-bold text-white">locked</span>. The next unlock will be Nov 7th.</p>
            <p className="mt-0.5 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Staking earlier in each period leads to higher rewards.</p>
          </div>

          {/* Wallet Section */}
          <div className="-mt-1.5">
            {!isPrivyAuthenticated ? (
              <div className="flex items-center gap-4">
                <button
                  onClick={handleConnectWallet}
                  className="text-[14px] text-[#b2e9fe] hover:text-[#d0f2ff] transition-colors cursor-pointer"
                  style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                >
                  [CLICK TO CONNECT WALLET]
                </button>
              </div>
            ) : !wallet ? (
              <button
                onClick={handleConnectWallet}
                className="text-[14px] text-[#b2e9fe] hover:text-[#d0f2ff] transition-colors cursor-pointer"
                style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
              >
                [CLICK TO CONNECT WALLET]
              </button>
            ) : (
              <div className="space-y-7">
                {/* Vault Stats */}
                <div>
                  <h3 className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}ZC staked vaults stats</h3>

                  <div className="text-[14px] font-bold text-[#b2e9fe] mt-1" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                    {calculateAPY().toFixed(0)}% APY Yield
                  </div>
                  <div className="text-[14px] font-bold mt-0.5" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                    {formatCompactNumber(vaultBalance)} TVL
                  </div>
                </div>

                {/* Your Position */}
                <div>
                  <h3 className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Your staked and unstaked ZC positions</h3>

                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-[14px]" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{formatAddress(wallet.toString())}</p>
                    <button
                      onClick={() => copyAddress(wallet.toString())}
                      className="flex items-center gap-1 hover:opacity-80 transition-opacity cursor-pointer"
                      title="Copy wallet address"
                    >
                      {copiedWallet ? (
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                    <a
                      href={`https://solscan.io/account/${wallet.toString()}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white hover:opacity-80 transition-opacity cursor-pointer"
                      title="View on Solscan"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>

                  {postTransactionRefreshing && (
                    <div className="flex items-center gap-1 text-[14px] text-gray-300 mt-3" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                      <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Updating...
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Held:</span>
                    <div className="text-[14px] font-bold" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                      {zcBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {zcTotalSupply > 0 && (
                        <span className="text-[14px] text-gray-300 ml-2">
                          ({((zcBalance / zcTotalSupply) * 100).toFixed(3)}%)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Staked:</span>
                    <div className="text-[14px] font-bold text-[#b2e9fe]" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                      {userShareValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {zcTotalSupply > 0 && (
                        <span className="text-[14px] text-[#b2e9fe] ml-2">
                          ({((userShareValue / zcTotalSupply) * 100).toFixed(3)}%)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Exchange Rate:</span>
                    <div className="text-[14px] font-bold" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                      1 sZC : {exchangeRate.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })} ZC
                    </div>
                  </div>

                  <button
                    onClick={() => Promise.all([fetchVaultData(), fetchZcBalance()])}
                    disabled={refreshing || postTransactionRefreshing}
                    className="text-[14px] text-gray-300 hover:text-[#b2e9fe] transition-colors cursor-pointer disabled:opacity-50"
                    style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                  >
                    {refreshing || postTransactionRefreshing ? (
                      postTransactionRefreshing ? '[Updating balances...]' : '[Refreshing...]'
                    ) : (
                      '[Refresh]'
                    )}
                  </button>
                </div>

                {/* Vault Operations */}
                <div className="space-y-8 mt-6 max-w-xl">
                  <div>
                    <h3 className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Stake your ZC and redeem your staked ZC below</h3>
                    <div className="flex gap-4 mt-0.5">
                      <button
                        onClick={() => setModalMode("deposit")}
                        className={`text-[14px] transition-colors cursor-pointer ${
                          modalMode === "deposit" ? "text-[#b2e9fe]" : "text-gray-300 hover:text-[#b2e9fe]"
                        }`}
                        style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                      >
                        [Stake]
                      </button>
                      <button
                        onClick={() => setModalMode("redeem")}
                        className={`text-[14px] transition-colors cursor-pointer ${
                          modalMode === "redeem" ? "text-[#b2e9fe]" : "text-gray-300 hover:text-[#b2e9fe]"
                        }`}
                        style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                      >
                        [Redeem]
                      </button>
                    </div>

                    {modalMode === "deposit" && (
                      <div className="space-y-6 mt-2">
                        <div className="bg-[#2B2B2A] rounded-xl p-4 mb-4">
                          <div className="flex justify-between mb-2">
                            <label className="text-sm text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Amount</label>
                            <span className="text-sm text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                              Available: {zcBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ZC
                            </span>
                          </div>
                          <div className="flex items-center gap-3 relative">
                            <div className="flex-1 relative">
                              <input
                                type="text"
                                placeholder="0.00"
                                value={amount}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  if (value === "" || /^\d*\.?\d*$/.test(value)) {
                                    setAmount(value);
                                  }
                                }}
                                className="w-full bg-transparent text-3xl font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none pr-16"
                                style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                                disabled={false}
                                autoComplete="off"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (zcBalance) {
                                    setAmount(zcBalance.toString());
                                  }
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#F7FCFE] bg-[#1E1E1E] hover:bg-[#141414] px-2 py-1 rounded transition-colors"
                                style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                                tabIndex={-1}
                              >
                                MAX
                              </button>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={handleDeposit}
                          className="w-full py-3 text-[14px] font-bold bg-white text-black hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          disabled={loading || !amount || parseFloat(amount) <= 0}
                        >
                          {loading ? "Processing..." : "Stake"}
                        </button>
                      </div>
                    )}

                    {modalMode === "redeem" && (
                      <div className="space-y-6 mt-2">
                        <div className="bg-[#2B2B2A] rounded-xl p-4 mb-4">
                          <div className="flex justify-between mb-2">
                            <label className="text-sm text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Percentage to Redeem</label>
                            <span className="text-sm text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                              Available: {userShareBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} shares ({userShareValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ZC)
                            </span>
                          </div>
                          <div className="flex items-center gap-3 relative">
                            <div className="flex-1 relative">
                              <input
                                type="text"
                                placeholder="0"
                                value={redeemPercent}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  if (value === "" || (/^\d*\.?\d*$/.test(value) && parseFloat(value) <= 100)) {
                                    setRedeemPercent(value);
                                  }
                                }}
                                className="w-full bg-transparent text-3xl font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none pr-8"
                                style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                                disabled={!withdrawalsEnabled}
                                autoComplete="off"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-3xl font-semibold text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>%</span>
                            </div>
                          </div>
                        </div>

                        {parseFloat(redeemPercent) > 0 && (
                          <div className="bg-[#2B2B2A] rounded-xl p-4 mb-4 text-sm space-y-2" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                            <div className="flex justify-between items-center text-gray-300">
                              <span>You will receive</span>
                              <span className="font-bold">
                                {((userShareValue * parseFloat(redeemPercent)) / 100).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ZC
                              </span>
                            </div>
                          </div>
                        )}

                        <button
                          onClick={handleRedeem}
                          className="w-full py-3 text-[14px] font-bold bg-white text-black hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                          disabled={loading || !redeemPercent || parseFloat(redeemPercent) <= 0 || !withdrawalsEnabled || userShareBalance === 0}
                        >
                          {loading ? "Processing..." : !withdrawalsEnabled ? "Redemptions Disabled" : userShareBalance === 0 ? "No Shares to Redeem" : "Redeem"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
