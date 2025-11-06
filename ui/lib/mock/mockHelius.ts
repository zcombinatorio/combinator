/**
 * Mock Helius RPC and Enhanced Transactions API
 * Provides mock blockchain transaction data when Helius API key is not available
 */

import {
  MOCK_TOKENS,
  MOCK_PROTOCOL_WALLET,
  generateMockTransactions,
  type MockTransaction,
} from './mockData';

class MockHeliusAPI {
  private transactionCache = new Map<string, MockTransaction[]>();

  constructor() {
    // Pre-generate transactions for all mock tokens
    MOCK_TOKENS.forEach((token) => {
      this.transactionCache.set(
        token.token_address,
        generateMockTransactions(token.token_address, 30, token.creator_wallet)
      );
    });
  }

  /**
   * Mock getSignaturesForAddress RPC call
   */
  async getSignaturesForAddress(
    address: string,
    options?: { limit?: number; before?: string }
  ): Promise<any[]> {
    const transactions = this.transactionCache.get(address) || [];
    const limit = options?.limit || 1000;

    // Convert to Solana signature format
    return transactions.slice(0, limit).map((tx) => ({
      signature: tx.signature,
      slot: Math.floor(Math.random() * 1000000) + 100000,
      err: null,
      memo: null,
      blockTime: tx.timestamp,
    }));
  }

  /**
   * Mock getTransaction RPC call
   */
  async getTransaction(signature: string): Promise<any | null> {
    // Find transaction across all tokens
    for (const [tokenAddress, transactions] of this.transactionCache.entries()) {
      const tx = transactions.find((t) => t.signature === signature);
      if (tx) {
        return this.formatTransaction(tx, tokenAddress);
      }
    }
    return null;
  }

  /**
   * Mock Enhanced Transactions API (batch)
   */
  async getEnhancedTransactions(signatures: string[]): Promise<any[]> {
    const results: any[] = [];

    for (const signature of signatures) {
      for (const [tokenAddress, transactions] of this.transactionCache.entries()) {
        const tx = transactions.find((t) => t.signature === signature);
        if (tx) {
          results.push(this.formatEnhancedTransaction(tx, tokenAddress));
          break;
        }
      }
    }

    return results;
  }

  /**
   * Mock address transactions endpoint
   */
  async getAddressTransactions(
    address: string,
    options?: { limit?: number; before?: string }
  ): Promise<any[]> {
    const limit = options?.limit || 100;
    const allTransactions: any[] = [];

    // Get transactions for all tokens
    for (const [tokenAddress, transactions] of this.transactionCache.entries()) {
      const relevantTxs = transactions.filter((tx) => {
        // Include if address is involved in token transfers
        return tx.tokenTransfers?.some(
          (transfer) =>
            transfer.fromUserAccount === address ||
            transfer.toUserAccount === address
        );
      });

      relevantTxs.forEach((tx) => {
        allTransactions.push(this.formatEnhancedTransaction(tx, tokenAddress));
      });
    }

    // Sort by timestamp descending
    allTransactions.sort((a, b) => b.timestamp - a.timestamp);

    return allTransactions.slice(0, limit);
  }

  /**
   * Calculate claim eligibility for a token (used by claim service)
   */
  async calculateClaimEligibility(tokenAddress: string): Promise<{
    totalMinted: number;
    totalClaimed: number;
    availableToClaim: number;
  }> {
    const token = MOCK_TOKENS.find((t) => t.token_address === tokenAddress);

    if (!token) {
      return {
        totalMinted: 0,
        totalClaimed: 0,
        availableToClaim: 0,
      };
    }

    const totalMinted = (token.totalClaimed || 0) + (token.availableToClaim || 0);

    return {
      totalMinted,
      totalClaimed: token.totalClaimed || 0,
      availableToClaim: token.availableToClaim || 0,
    };
  }

  /**
   * Get token holders (simulated from transactions)
   */
  async getTokenHolders(tokenAddress: string): Promise<any[]> {
    const transactions = this.transactionCache.get(tokenAddress) || [];
    const holders = new Map<string, number>();

    // Aggregate token transfers to calculate balances
    transactions.forEach((tx) => {
      tx.tokenTransfers?.forEach((transfer) => {
        if (transfer.fromUserAccount) {
          const current = holders.get(transfer.fromUserAccount) || 0;
          holders.set(transfer.fromUserAccount, current - transfer.tokenAmount);
        }
        if (transfer.toUserAccount) {
          const current = holders.get(transfer.toUserAccount) || 0;
          holders.set(transfer.toUserAccount, current + transfer.tokenAmount);
        }
      });
    });

    // Convert to array and filter positive balances
    return Array.from(holders.entries())
      .filter(([_, balance]) => balance > 0)
      .map(([address, balance]) => ({
        address,
        balance,
      }))
      .sort((a, b) => b.balance - a.balance);
  }

  /**
   * Format transaction for RPC response
   */
  private formatTransaction(tx: MockTransaction, tokenAddress: string): any {
    return {
      slot: Math.floor(Math.random() * 1000000) + 100000,
      transaction: {
        message: {
          accountKeys: [
            { pubkey: tx.feePayer, signer: true, writable: true },
            { pubkey: tokenAddress, signer: false, writable: true },
          ],
          instructions: [],
        },
        signatures: [tx.signature],
      },
      blockTime: tx.timestamp,
      meta: {
        err: null,
        fee: tx.fee,
        innerInstructions: [],
        logMessages: [],
        postBalances: [],
        postTokenBalances: [],
        preBalances: [],
        preTokenBalances: [],
        rewards: [],
      },
    };
  }

  /**
   * Format transaction for Enhanced Transactions API response
   */
  private formatEnhancedTransaction(tx: MockTransaction, tokenAddress: string): any {
    return {
      signature: tx.signature,
      timestamp: tx.timestamp,
      slot: Math.floor(Math.random() * 1000000) + 100000,
      type: tx.type,
      source: tx.source,
      fee: tx.fee,
      feePayer: tx.feePayer,
      tokenTransfers: tx.tokenTransfers || [],
      nativeTransfers: [],
      accountData: [],
      transactionError: null,
      instructions: [],
      events: {},
    };
  }

  /**
   * Get token supply info
   */
  async getTokenSupply(tokenAddress: string): Promise<any> {
    const token = MOCK_TOKENS.find((t) => t.token_address === tokenAddress);

    if (!token) {
      return {
        amount: '0',
        decimals: 9,
        uiAmount: 0,
        uiAmountString: '0',
      };
    }

    const supply = 100000000; // 100M default supply

    return {
      amount: (supply * 10 ** 9).toString(),
      decimals: 9,
      uiAmount: supply,
      uiAmountString: supply.toString(),
    };
  }

  /**
   * Get token account balance
   */
  async getTokenAccountBalance(tokenAddress: string, walletAddress: string): Promise<string> {
    const transactions = this.transactionCache.get(tokenAddress) || [];
    let balance = 0;

    // Calculate balance from transfers
    transactions.forEach((tx) => {
      tx.tokenTransfers?.forEach((transfer) => {
        if (transfer.fromUserAccount === walletAddress) {
          balance -= transfer.tokenAmount;
        }
        if (transfer.toUserAccount === walletAddress) {
          balance += transfer.tokenAmount;
        }
      });
    });

    return Math.max(0, balance).toString();
  }
}

// Export singleton instance
export const mockHelius = new MockHeliusAPI();
