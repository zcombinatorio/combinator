'use client';

import { useState, useEffect, useCallback, useMemo } from "react";
import { PublicKey, Connection, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { useWallet } from '@/components/WalletProvider';
import { showToast } from '@/components/Toast';
import VaultIDL from '@/lib/vault-idl.json';
import { usePrivy } from '@privy-io/react-auth';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Callout } from '@/components/ui/Callout';

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
    <Container>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 style={{ color: 'var(--foreground)' }}>Stake</h1>
          <p className="text-lg mt-2" style={{ color: 'var(--foreground-secondary)' }}>
            Stake to earn yield and get rewarded more for your contributions
          </p>
          <p className="text-sm mt-2" style={{ color: 'var(--foreground-secondary)' }}>
            Staking for other ZC launches will be live soon
          </p>
        </div>

        {/* Important Notice */}
        <div className="mb-8">
          <Callout variant="warning" title="Important Notice">
            <p className="mb-2" style={{ color: 'var(--foreground-secondary)' }}>
              Once you stake, funds are <strong>locked</strong>. The next unlock will be Nov 7th.
            </p>
            <p style={{ color: 'var(--foreground-secondary)' }}>
              Staking earlier in each period leads to higher rewards.
            </p>
          </Callout>
        </div>

        {/* Wallet Section */}
        {!isPrivyAuthenticated || !wallet ? (
          <div className="text-center py-12">
            <Button
              variant="primary"
              size="lg"
              onClick={handleConnectWallet}
            >
              Connect Wallet
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Vault Stats */}
            <Card variant="bordered">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
                  Vault Statistics
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--foreground-secondary)' }}>APY Yield</span>
                    <span className="text-xl font-bold" style={{ color: 'var(--accent)' }}>
                      {calculateAPY().toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--foreground-secondary)' }}>Total Value Locked</span>
                    <span className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
                      {formatCompactNumber(vaultBalance)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Your Position */}
            <Card variant="bordered">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
                  Your Position
                </h3>

                {/* Wallet Address */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                    {formatAddress(wallet.toString())}
                  </span>
                  <button
                    onClick={() => copyAddress(wallet.toString())}
                    className="hover:opacity-80 transition-opacity"
                    style={{ color: 'var(--foreground-secondary)' }}
                    title="Copy wallet address"
                  >
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
                  <a
                    href={`https://solscan.io/account/${wallet.toString()}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:opacity-80 transition-opacity"
                    style={{ color: 'var(--foreground-secondary)' }}
                    title="View on Solscan"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>

                {postTransactionRefreshing && (
                  <div className="flex items-center gap-2 mb-4 text-sm" style={{ color: 'var(--accent)' }}>
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Updating...
                  </div>
                )}

                {/* Balances */}
                <div className="space-y-3 mb-4">
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--foreground-secondary)' }}>Held</span>
                    <div style={{ color: 'var(--foreground)' }}>
                      <span className="font-semibold">
                        {zcBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      {zcTotalSupply > 0 && (
                        <span className="text-sm ml-2" style={{ color: 'var(--foreground-secondary)' }}>
                          ({((zcBalance / zcTotalSupply) * 100).toFixed(3)}%)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--foreground-secondary)' }}>Staked</span>
                    <div style={{ color: 'var(--accent)' }}>
                      <span className="font-semibold">
                        {userShareValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      {zcTotalSupply > 0 && (
                        <span className="text-sm ml-2">
                          ({((userShareValue / zcTotalSupply) * 100).toFixed(3)}%)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--foreground-secondary)' }}>Exchange Rate</span>
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                      1 sZC : {exchangeRate.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })} ZC
                    </span>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => Promise.all([fetchVaultData(), fetchZcBalance()])}
                  disabled={refreshing || postTransactionRefreshing}
                >
                  {refreshing || postTransactionRefreshing ? (
                    postTransactionRefreshing ? 'Updating balances...' : 'Refreshing...'
                  ) : (
                    'Refresh'
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Vault Operations */}
            <Card variant="bordered">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
                  Stake & Redeem
                </h3>
                <div className="flex gap-2 mb-6">
                  <Button
                    variant={modalMode === "deposit" ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setModalMode("deposit")}
                  >
                    Stake
                  </Button>
                  <Button
                    variant={modalMode === "redeem" ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setModalMode("redeem")}
                  >
                    Redeem
                  </Button>
                </div>

                {modalMode === "deposit" && (
                  <div className="space-y-4">
                    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--background-tertiary)' }}>
                      <div className="flex justify-between mb-2">
                        <label className="text-sm font-medium" style={{ color: 'var(--foreground-secondary)' }}>Amount</label>
                        <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
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
                            style={{ color: 'var(--foreground)' }}
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
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold px-2 py-1 rounded transition-colors"
                            style={{
                              color: 'var(--foreground)',
                              backgroundColor: 'var(--background-secondary)'
                            }}
                            tabIndex={-1}
                          >
                            MAX
                          </button>
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="primary"
                      size="lg"
                      onClick={handleDeposit}
                      disabled={loading || !amount || parseFloat(amount) <= 0}
                      className="w-full"
                    >
                      {loading ? "Processing..." : "Stake"}
                    </Button>
                  </div>
                )}

                {modalMode === "redeem" && (
                  <div className="space-y-4">
                    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--background-tertiary)' }}>
                      <div className="flex justify-between mb-2">
                        <label className="text-sm font-medium" style={{ color: 'var(--foreground-secondary)' }}>Percentage to Redeem</label>
                        <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
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
                            style={{ color: 'var(--foreground)' }}
                            disabled={!withdrawalsEnabled}
                            autoComplete="off"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-3xl font-semibold" style={{ color: 'var(--foreground-secondary)' }}>%</span>
                        </div>
                      </div>
                    </div>

                    {parseFloat(redeemPercent) > 0 && (
                      <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: 'var(--background-tertiary)' }}>
                        <div className="flex justify-between items-center" style={{ color: 'var(--foreground-secondary)' }}>
                          <span>You will receive</span>
                          <span className="font-bold" style={{ color: 'var(--accent)' }}>
                            {((userShareValue * parseFloat(redeemPercent)) / 100).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ZC
                          </span>
                        </div>
                      </div>
                    )}

                    <Button
                      variant="primary"
                      size="lg"
                      onClick={handleRedeem}
                      disabled={loading || !redeemPercent || parseFloat(redeemPercent) <= 0 || !withdrawalsEnabled || userShareBalance === 0}
                      className="w-full"
                    >
                      {loading ? "Processing..." : !withdrawalsEnabled ? "Redemptions Disabled" : userShareBalance === 0 ? "No Shares to Redeem" : "Redeem"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </Container>
  );
}
