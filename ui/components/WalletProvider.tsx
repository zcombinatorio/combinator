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

import { FC, ReactNode, createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { PublicKey } from '@solana/web3.js';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets, ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana';

// Type for Privy linked accounts - using more flexible typing to match Privy's types
type PrivyLinkedAccount = {
  type: string;
  address?: string;
  walletClientType?: string;
  connectorType?: string;
  username?: string | null;
  [key: string]: unknown;
};

// Using Privy's ConnectedWallet type directly - no need for custom adapter

interface WalletContextType {
  wallet: PublicKey | null;
  connecting: boolean;
  connected: boolean;
  activeWallet: ConnectedStandardSolanaWallet | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  // Privy-specific additions
  privyUser: unknown;
  isPrivyAuthenticated: boolean;
  hasTwitter: boolean;
  hasGithub: boolean;
  twitterUsername?: string;
  githubUsername?: string;
  // Separate tracking for embedded vs external wallets
  embeddedWallet: PublicKey | null;
  externalWallet: PublicKey | null;
}

const WalletContext = createContext<WalletContextType | null>(null);

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletContextProvider');
  }
  return context;
};

export const WalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [wallet, setWallet] = useState<PublicKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [activeWallet, setActiveWallet] = useState<ConnectedStandardSolanaWallet | null>(null);
  const [embeddedWallet, setEmbeddedWallet] = useState<PublicKey | null>(null);
  const [externalWallet, setExternalWallet] = useState<PublicKey | null>(null);

  // Privy hooks
  const { user, authenticated, ready, login, linkWallet } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();


  // Get only EXTERNAL Solana wallets from Privy (exclude embedded wallets)
  // We need to filter out embedded wallets by checking against the embedded wallet address
  const externalSolanaWallets = useMemo(() => {
    // First, get the embedded wallet address from user's linked accounts
    const embeddedWallet = user?.linkedAccounts?.find((acc) =>
      (acc as unknown as PrivyLinkedAccount).type === 'wallet' &&
      (acc as unknown as PrivyLinkedAccount).walletClientType === 'privy' &&
      (acc as unknown as PrivyLinkedAccount).connectorType === 'embedded'
    ) as PrivyLinkedAccount | undefined;
    const embeddedAddress = embeddedWallet?.address;

    // Also check if there are any external wallets in linkedAccounts
    // External wallets would be in linkedAccounts but without walletClientType: 'privy'
    const hasLinkedExternalWallet = user?.linkedAccounts?.some((acc) =>
      (acc as unknown as PrivyLinkedAccount).type === 'wallet' &&
      (acc as unknown as PrivyLinkedAccount).walletClientType !== 'privy' &&
      (acc as unknown as PrivyLinkedAccount).address &&
      !(acc as unknown as PrivyLinkedAccount).address?.startsWith('0x')
    );

    // Only return wallets if they're actually linked in the user account
    if (!hasLinkedExternalWallet) {
      return [];
    }

    return wallets.filter((w: ConnectedStandardSolanaWallet) => {
      // Filter out non-Solana wallets and the embedded wallet
      return w.address &&
             !w.address.startsWith('0x') &&
             w.address !== embeddedAddress;
    });
  }, [wallets, user]);

  // Use the first available external Solana wallet
  const activeSolanaWallet = useMemo(() => {
    return externalSolanaWallets[0] || null;
  }, [externalSolanaWallets]);

  // Check for social accounts
  const hasTwitter = useMemo(() => {
    return user?.linkedAccounts?.some(account => account.type === 'twitter_oauth') || false;
  }, [user]);

  const hasGithub = useMemo(() => {
    return user?.linkedAccounts?.some(account => account.type === 'github_oauth') || false;
  }, [user]);

  const twitterUsername = useMemo(() => {
    const twitterAccount = user?.linkedAccounts?.find(account => account.type === 'twitter_oauth');
    return twitterAccount?.username || undefined;
  }, [user]);

  const githubUsername = useMemo(() => {
    const githubAccount = user?.linkedAccounts?.find(account => account.type === 'github_oauth');
    return githubAccount?.username || undefined;
  }, [user]);


  // Connect wallet (now uses Privy)
  const connectWallet = useCallback(async () => {
    try {
      setConnecting(true);

      if (!authenticated) {
        // If not authenticated with Privy, trigger login
        login();
        return;
      }

      // If already authenticated but no external Solana wallet, link one
      if (externalSolanaWallets.length === 0) {
        linkWallet();
        return;
      }

      // If we have an external wallet, set it as active
      if (activeSolanaWallet) {
        const publicKey = new PublicKey(activeSolanaWallet.address);
        setWallet(publicKey);
        setExternalWallet(publicKey);
        setActiveWallet(activeSolanaWallet);
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      throw error;
    } finally {
      setConnecting(false);
    }
  }, [authenticated, login, linkWallet, activeSolanaWallet, externalSolanaWallets.length]);

  // Disconnect wallet (now uses Privy)
  const disconnectWallet = useCallback(async () => {
    try {
      if (activeSolanaWallet) {
        await activeSolanaWallet.disconnect();
      }

      // Optionally logout from Privy entirely
      // await logout();

      setWallet(null);
      setActiveWallet(null);
      setExternalWallet(null);
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
    }
  }, [activeSolanaWallet]);

  // Sync with Privy wallet state
  useEffect(() => {
    const setupWallet = async () => {
      if (ready && authenticated && walletsReady && user) {

        // Find embedded wallet from user's linked accounts
        // Embedded wallets have walletClientType: 'privy' and connectorType: 'embedded'
        const embeddedWalletAccount = user?.linkedAccounts?.find((acc) =>
          (acc as unknown as PrivyLinkedAccount).type === 'wallet' &&
          (acc as unknown as PrivyLinkedAccount).walletClientType === 'privy' &&
          (acc as unknown as PrivyLinkedAccount).connectorType === 'embedded' &&
          (acc as unknown as PrivyLinkedAccount).address &&
          !(acc as unknown as PrivyLinkedAccount).address?.startsWith('0x') &&
          (acc as unknown as PrivyLinkedAccount).address?.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
        ) as PrivyLinkedAccount | undefined;

        // Set embedded wallet if found
        if (embeddedWalletAccount?.address) {
          try {
            const embeddedPubKey = new PublicKey(embeddedWalletAccount.address);
            setEmbeddedWallet(embeddedPubKey);
          } catch (error) {
            console.error('Failed to set embedded wallet:', error);
          }
        } else {
          setEmbeddedWallet(null);
        }

        // Check if we have external wallets from the wallets array
        // The wallets array from useWallets should only contain externally connected wallets
        // Embedded wallets are NOT included in this array
        const hasExternalWallet = wallets.length > 0 && activeSolanaWallet;

        if (hasExternalWallet) {
          const publicKey = new PublicKey(activeSolanaWallet.address);
          setWallet(publicKey);
          setExternalWallet(publicKey);
          setActiveWallet(activeSolanaWallet);
        } else {
          // No external wallet connected
          setExternalWallet(null);
          setActiveWallet(null);

          if (embeddedWalletAccount?.address) {
            // Use embedded wallet as primary if no external wallet
            try {
              const embeddedPubKey = new PublicKey(embeddedWalletAccount.address);
              setWallet(embeddedPubKey);
            } catch (error) {
              console.error('Failed to set embedded wallet as primary:', error);
            }
          } else {
            // No wallet at all
            setWallet(null);
          }
        }
      } else if (!authenticated) {
        setWallet(null);
        setActiveWallet(null);
        setEmbeddedWallet(null);
        setExternalWallet(null);
      }
    };

    setupWallet();
  }, [ready, authenticated, walletsReady, activeSolanaWallet, user, externalSolanaWallets.length, wallets.length]);


  return (
    <WalletContext.Provider
      value={{
        wallet,
        connecting,
        connected: !!wallet,
        activeWallet,
        connectWallet,
        disconnectWallet,
        // Privy-specific values
        privyUser: user,
        isPrivyAuthenticated: authenticated,
        hasTwitter,
        hasGithub,
        twitterUsername,
        githubUsername,
        // Separate wallet tracking
        embeddedWallet,
        externalWallet,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};