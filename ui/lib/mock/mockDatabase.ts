/**
 * Mock Database Implementation
 * Provides in-memory database functionality when PostgreSQL is not available
 */

import {
  MOCK_TOKENS,
  MOCK_PRESALES,
  MOCK_DESIGNATED_CLAIMS,
  MOCK_EMISSION_SPLITS,
  MOCK_CLAIM_RECORDS,
  MOCK_WALLETS,
  generateMockHolders,
  generateMockTransactions,
  type MockToken,
  type MockHolder,
  type MockPresale,
} from './mockData';

import type {
  TokenLaunch,
  VerificationChallenge,
  MintTransaction,
  ClaimRecord,
  TokenHolder,
  DesignatedClaim,
  EmissionSplit,
  Presale,
  PresaleBid,
  PresaleClaim,
  PresaleClaimTransaction,
} from '../db/types';

/**
 * Mock Database - In-memory storage for all tables
 */
export class MockDatabase {
  // Tables
  private tokenLaunches: TokenLaunch[];
  private mintTransactions: MintTransaction[];
  private claimRecords: ClaimRecord[];
  private tokenHolders: TokenHolder[];
  private designatedClaims: DesignatedClaim[];
  private emissionSplits: EmissionSplit[];
  private verificationChallenges: VerificationChallenge[];
  private verificationAuditLogs: any[];
  private presales: Presale[];
  private presaleBids: PresaleBid[];
  private presaleClaims: PresaleClaim[];
  private presaleClaimTransactions: PresaleClaimTransaction[];

  // ID counters
  private nextId = {
    tokenLaunches: 100,
    mintTransactions: 100,
    claimRecords: 100,
    tokenHolders: 100,
    designatedClaims: 100,
    emissionSplits: 100,
    verificationChallenges: 100,
    verificationAuditLogs: 100,
    presales: 100,
    presaleBids: 100,
    presaleClaims: 100,
    presaleClaimTransactions: 100,
  };

  constructor() {
    // Initialize with mock data
    this.tokenLaunches = MOCK_TOKENS.map((token) => ({
      ...token,
      launch_time: new Date(token.launch_time),
      created_at: new Date(token.created_at),
      creator_twitter: token.creator_twitter || undefined,
      creator_github: token.creator_github || undefined,
      verified: token.verified || false,
    }));

    this.presales = MOCK_PRESALES.map((presale) => ({ ...presale }));

    // Generate presale bids for each presale
    this.presaleBids = [];
    this.presales.forEach((presale, index) => {
      if (!presale.id) return; // Skip presales without IDs
      // Generate 3-5 mock bids per presale
      const numBids = Math.floor(Math.random() * 3) + 3;
      for (let i = 0; i < numBids; i++) {
        const walletAddress = Object.values(MOCK_WALLETS)[i % Object.values(MOCK_WALLETS).length];
        const amount = Math.floor(Math.random() * 5000000000) + 1000000000; // 1-5 SOL in lamports
        this.presaleBids.push({
          id: this.nextId.presaleBids++,
          presale_id: presale.id!,
          token_address: presale.token_address,
          wallet_address: walletAddress,
          amount_lamports: BigInt(amount),
          transaction_signature: `mock_presale_bid_${presale.id}_${i}_${Date.now()}`,
          created_at: new Date(Date.now() - (i * 3600000)),
        });
      }
    });

    this.designatedClaims = MOCK_DESIGNATED_CLAIMS.map((claim) => ({
      ...claim,
      created_at: new Date(),
    }));

    this.emissionSplits = MOCK_EMISSION_SPLITS.map((split) => ({
      ...split,
      created_at: split.created_at ? new Date(split.created_at) : new Date(),
    }));

    this.claimRecords = MOCK_CLAIM_RECORDS.map((record) => ({
      ...record,
      amount: record.amount.toString(),
      confirmed_at: record.confirmed_at ? new Date(record.confirmed_at) : new Date(),
    }));

    // Generate holders for each token
    this.tokenHolders = [];
    MOCK_TOKENS.forEach((token) => {
      const holders = generateMockHolders(token.token_address, 12);
      const convertedHolders = holders.map(holder => ({
        ...holder,
        created_at: new Date(holder.created_at),
        updated_at: new Date(holder.updated_at),
        last_sync_at: holder.last_sync_at ? new Date(holder.last_sync_at) : undefined,
      }));
      this.tokenHolders.push(...convertedHolders);
    });

    // Generate mint transactions from mock transactions
    this.mintTransactions = [];
    MOCK_TOKENS.forEach((token) => {
      const transactions = generateMockTransactions(token.token_address, 25);
      transactions.forEach((tx, idx) => {
        if (tx.type === 'TOKEN_MINT' && tx.tokenTransfers && tx.tokenTransfers.length > 0) {
          const transfer = tx.tokenTransfers[0];
          this.mintTransactions.push({
            id: this.mintTransactions.length + 1,
            signature: tx.signature,
            timestamp: tx.timestamp,
            token_address: token.token_address,
            wallet_address: transfer.toUserAccount,
            amount: BigInt(transfer.tokenAmount),
            tx_data: tx as unknown as Record<string, unknown>,
            created_at: new Date(tx.timestamp * 1000),
          });
        }
      });
    });

    this.verificationChallenges = [];
    this.verificationAuditLogs = [];
    this.presaleBids = [];
    this.presaleClaims = [];
    this.presaleClaimTransactions = [];

    console.log('📦 Mock Database initialized with:');
    console.log(`  - ${this.tokenLaunches.length} token launches`);
    console.log(`  - ${this.mintTransactions.length} mint transactions`);
    console.log(`  - ${this.tokenHolders.length} token holders`);
    console.log(`  - ${this.presales.length} presales`);
  }

  // ==================== TOKEN LAUNCHES ====================

  async recordTokenLaunch(
    launch: Omit<TokenLaunch, 'id' | 'created_at' | 'launch_time'>
  ): Promise<TokenLaunch> {
    // Check if already exists
    const existing = this.tokenLaunches.find(
      (t) => t.token_address === launch.token_address
    );
    if (existing) {
      return existing;
    }

    const newLaunch: TokenLaunch = {
      id: this.nextId.tokenLaunches++,
      launch_time: new Date(),
      created_at: new Date(),
      verified: false,
      ...launch,
    };

    this.tokenLaunches.push(newLaunch);

    // Create designated claim if socials provided
    if (launch.creator_twitter || launch.creator_github) {
      await this.createDesignatedClaim(
        launch.token_address,
        launch.creator_wallet,
        launch.creator_twitter,
        launch.creator_github
      );
    }

    return newLaunch;
  }

  async getTokenLaunches(creatorWallet?: string, limit = 100): Promise<TokenLaunch[]> {
    let launches = [...this.tokenLaunches];

    if (creatorWallet) {
      launches = launches.filter((l) => l.creator_wallet === creatorWallet);
    }

    // Sort by launch_time descending
    launches.sort((a, b) => new Date(b.launch_time).getTime() - new Date(a.launch_time).getTime());

    return launches.slice(0, limit);
  }

  async getTokenLaunchByAddress(tokenAddress: string): Promise<TokenLaunch | null> {
    return this.tokenLaunches.find((t) => t.token_address === tokenAddress) || null;
  }

  async getTokenLaunchesBySocials(
    twitterUsername?: string,
    githubUrl?: string,
    limit = 100
  ): Promise<TokenLaunch[]> {
    if (!twitterUsername && !githubUrl) {
      return [];
    }

    const launches = this.tokenLaunches.filter((launch) => {
      if (twitterUsername && launch.creator_twitter) {
        const username = twitterUsername.replace(/@/g, '');
        return launch.creator_twitter.toLowerCase().includes(username.toLowerCase());
      }
      if (githubUrl && launch.creator_github) {
        return launch.creator_github.toLowerCase().includes(githubUrl.toLowerCase());
      }
      return false;
    });

    return launches.slice(0, limit);
  }

  async getTokenLaunchTime(tokenAddress: string): Promise<Date | null> {
    const launch = await this.getTokenLaunchByAddress(tokenAddress);
    return launch ? new Date(launch.launch_time) : null;
  }

  async getTokenCreatorWallet(tokenAddress: string): Promise<string | null> {
    const launch = await this.getTokenLaunchByAddress(tokenAddress);
    return launch?.creator_wallet || null;
  }

  // ==================== MINT TRANSACTIONS ====================

  async getCachedMintTransactions(
    tokenAddress: string,
    afterTimestamp?: number
  ): Promise<MintTransaction[]> {
    let transactions = this.mintTransactions.filter((t) => t.token_address === tokenAddress);

    if (afterTimestamp) {
      transactions = transactions.filter((t) => t.timestamp > afterTimestamp);
    }

    return transactions.sort((a, b) => a.timestamp - b.timestamp);
  }

  async storeMintTransaction(transaction: Omit<MintTransaction, 'id' | 'created_at'>): Promise<MintTransaction> {
    // Check if already exists
    const existing = this.mintTransactions.find((t) => t.signature === transaction.signature);
    if (existing) {
      return existing;
    }

    const newTx: MintTransaction = {
      id: this.nextId.mintTransactions++,
      created_at: new Date(),
      ...transaction,
    };

    this.mintTransactions.push(newTx);
    return newTx;
  }

  async batchStoreMintTransactions(transactions: Omit<MintTransaction, 'id' | 'created_at'>[]): Promise<void> {
    for (const tx of transactions) {
      await this.storeMintTransaction(tx);
    }
  }

  async getTotalMintedFromCache(tokenAddress: string): Promise<bigint> {
    const transactions = await this.getCachedMintTransactions(tokenAddress);
    return transactions.reduce((sum, tx) => sum + tx.amount, BigInt(0));
  }

  async getLatestCachedTransaction(tokenAddress: string): Promise<MintTransaction | null> {
    const transactions = await this.getCachedMintTransactions(tokenAddress);
    if (transactions.length === 0) return null;
    return transactions[transactions.length - 1];
  }

  // ==================== CLAIM RECORDS ====================

  async hasRecentClaim(tokenAddress: string, windowMinutes = 5): Promise<boolean> {
    const windowMs = windowMinutes * 60 * 1000;
    const cutoff = new Date(Date.now() - windowMs);

    return this.claimRecords.some(
      (record) =>
        record.token_address === tokenAddress &&
        new Date(record.confirmed_at) > cutoff
    );
  }

  async hasRecentClaimByWallet(
    tokenAddress: string,
    walletAddress: string,
    windowMinutes = 5
  ): Promise<boolean> {
    const windowMs = windowMinutes * 60 * 1000;
    const cutoff = new Date(Date.now() - windowMs);

    return this.claimRecords.some(
      (record) =>
        record.token_address === tokenAddress &&
        record.wallet_address === walletAddress &&
        new Date(record.confirmed_at) > cutoff
    );
  }

  async getTotalClaimedByWallet(tokenAddress: string, walletAddress: string): Promise<number> {
    const records = this.claimRecords.filter(
      (r) => r.token_address === tokenAddress && r.wallet_address === walletAddress
    );

    return records.reduce((sum, record) => sum + parseFloat(record.amount), 0);
  }

  async preRecordClaim(
    walletAddress: string,
    tokenAddress: string,
    amount: string
  ): Promise<ClaimRecord> {
    const newRecord: ClaimRecord = {
      id: this.nextId.claimRecords++,
      wallet_address: walletAddress,
      token_address: tokenAddress,
      amount,
      transaction_signature: `pending_${Date.now()}_${Math.random()}`,
      confirmed_at: new Date(),
    };

    this.claimRecords.push(newRecord);
    return newRecord;
  }

  async updateClaimSignature(
    walletAddress: string,
    tokenAddress: string,
    oldSignature: string,
    newSignature: string
  ): Promise<void> {
    const record = this.claimRecords.find(
      (r) =>
        r.wallet_address === walletAddress &&
        r.token_address === tokenAddress &&
        r.transaction_signature === oldSignature
    );

    if (record) {
      record.transaction_signature = newSignature;
      record.confirmed_at = new Date();
    }
  }

  async removeFailedClaim(walletAddress: string, tokenAddress: string, signature: string): Promise<void> {
    this.claimRecords = this.claimRecords.filter(
      (r) =>
        !(
          r.wallet_address === walletAddress &&
          r.token_address === tokenAddress &&
          r.transaction_signature === signature
        )
    );
  }

  // ==================== TOKEN HOLDERS ====================

  async getTokenHolders(tokenAddress: string): Promise<TokenHolder[]> {
    return this.tokenHolders
      .filter((h) => h.token_address === tokenAddress)
      .sort((a, b) => parseFloat(b.token_balance) - parseFloat(a.token_balance));
  }

  async upsertTokenHolder(holder: Omit<TokenHolder, 'id' | 'created_at' | 'updated_at'>): Promise<TokenHolder> {
    const existing = this.tokenHolders.find(
      (h) =>
        h.token_address === holder.token_address &&
        h.wallet_address === holder.wallet_address
    );

    if (existing) {
      Object.assign(existing, {
        ...holder,
        updated_at: new Date(),
      });
      return existing;
    }

    const newHolder: TokenHolder = {
      id: this.nextId.tokenHolders++,
      created_at: new Date(),
      updated_at: new Date(),
      ...holder,
    };

    this.tokenHolders.push(newHolder);
    return newHolder;
  }

  async batchUpsertTokenHolders(
    tokenAddress: string,
    holders: Array<{
      wallet_address: string;
      token_balance: string;
      staked_balance?: string;
    }>
  ): Promise<void> {
    for (const holder of holders) {
      await this.upsertTokenHolder({
        token_address: tokenAddress,
        wallet_address: holder.wallet_address,
        token_balance: holder.token_balance,
        staked_balance: holder.staked_balance || '0',
        last_sync_at: new Date(),
      });
    }
  }

  async updateTokenHolderLabels(
    tokenAddress: string,
    walletAddress: string,
    labels: {
      telegram_username?: string | null;
      x_username?: string | null;
      discord_username?: string | null;
      custom_label?: string | null;
    }
  ): Promise<TokenHolder | null> {
    const holder = this.tokenHolders.find(
      (h) =>
        h.token_address === tokenAddress &&
        h.wallet_address === walletAddress
    );

    if (!holder) return null;

    Object.assign(holder, {
      ...labels,
      updated_at: new Date(),
    });

    return holder;
  }

  async getTokenHolderStats(tokenAddress: string): Promise<any> {
    const holders = await this.getTokenHolders(tokenAddress);

    const totalBalance = holders.reduce(
      (sum, h) => sum + parseFloat(h.token_balance),
      0
    );
    const totalStaked = holders.reduce(
      (sum, h) => sum + parseFloat(h.staked_balance),
      0
    );

    return {
      totalHolders: holders.length,
      totalBalance: totalBalance.toString(),
      lastSyncTime: holders.length > 0 ? new Date(holders[0].last_sync_at || new Date()) : null,
    };
  }

  // ==================== DESIGNATED CLAIMS ====================

  async createDesignatedClaim(
    tokenAddress: string,
    originalLauncher: string,
    designatedTwitter?: string | null,
    designatedGithub?: string | null
  ): Promise<DesignatedClaim> {
    // Check if already exists
    const existing = this.designatedClaims.find((c) => c.token_address === tokenAddress);
    if (existing) {
      return existing;
    }

    const newClaim: DesignatedClaim = {
      id: this.nextId.designatedClaims++,
      token_address: tokenAddress,
      original_launcher: originalLauncher,
      designated_twitter: designatedTwitter || undefined,
      designated_github: designatedGithub || undefined,
      verified_wallet: undefined,
      verified_embedded_wallet: undefined,
      verified_at: undefined,
      created_at: new Date(),
    };

    this.designatedClaims.push(newClaim);
    return newClaim;
  }

  async getDesignatedClaimByToken(tokenAddress: string): Promise<DesignatedClaim | null> {
    return this.designatedClaims.find((c) => c.token_address === tokenAddress) || null;
  }

  async getDesignatedClaimsBySocials(
    twitterUsername?: string,
    githubUsername?: string
  ): Promise<DesignatedClaim[]> {
    return this.designatedClaims.filter((claim) => {
      if (twitterUsername && claim.designated_twitter) {
        return claim.designated_twitter.toLowerCase().includes(twitterUsername.toLowerCase());
      }
      if (githubUsername && claim.designated_github) {
        return claim.designated_github.toLowerCase().includes(githubUsername.toLowerCase());
      }
      return false;
    });
  }

  async verifyDesignatedClaim(
    tokenAddress: string,
    verifiedWallet: string,
    verifiedEmbeddedWallet?: string | null
  ): Promise<DesignatedClaim | null> {
    const claim = await this.getDesignatedClaimByToken(tokenAddress);
    if (!claim) return null;

    claim.verified_wallet = verifiedWallet;
    claim.verified_embedded_wallet = verifiedEmbeddedWallet || null;
    claim.verified_at = new Date();

    return claim;
  }

  async getVerifiedClaimWallets(tokenAddress: string): Promise<string[]> {
    const claim = await this.getDesignatedClaimByToken(tokenAddress);
    if (!claim) return [];

    const wallets: string[] = [];
    if (claim.verified_wallet) wallets.push(claim.verified_wallet);
    if (claim.verified_embedded_wallet) wallets.push(claim.verified_embedded_wallet);

    return wallets;
  }

  // ==================== EMISSION SPLITS ====================

  async createEmissionSplits(
    tokenAddress: string,
    splits: Array<{ recipient_wallet: string; split_percentage: number; label?: string }>
  ): Promise<EmissionSplit[]> {
    // Validate total doesn't exceed 100%
    const total = splits.reduce((sum, s) => sum + s.split_percentage, 0);
    if (total > 100) {
      throw new Error('Total split percentage cannot exceed 100%');
    }

    const newSplits: EmissionSplit[] = [];

    for (const split of splits) {
      const newSplit: EmissionSplit = {
        id: this.nextId.emissionSplits++,
        token_address: tokenAddress,
        recipient_wallet: split.recipient_wallet,
        split_percentage: split.split_percentage,
        label: split.label || null,
        created_at: new Date(),
      };

      this.emissionSplits.push(newSplit);
      newSplits.push(newSplit);
    }

    return newSplits;
  }

  async getEmissionSplits(tokenAddress: string): Promise<EmissionSplit[]> {
    return this.emissionSplits.filter((s) => s.token_address === tokenAddress);
  }

  async getWalletEmissionSplit(tokenAddress: string, walletAddress: string): Promise<number | null> {
    const split = this.emissionSplits.find(
      (s) => s.token_address === tokenAddress && s.recipient_wallet === walletAddress
    );

    return split ? split.split_percentage : null;
  }

  async hasClaimRights(tokenAddress: string, walletAddress: string): Promise<boolean> {
    const splits = await this.getEmissionSplits(tokenAddress);

    // If no splits, check if wallet is original launcher or designated claimer
    if (splits.length === 0) {
      const launch = await this.getTokenLaunchByAddress(tokenAddress);
      if (launch?.creator_wallet === walletAddress) return true;

      const verifiedWallets = await this.getVerifiedClaimWallets(tokenAddress);
      return verifiedWallets.includes(walletAddress);
    }

    // If splits exist, check if wallet has a split
    return splits.some((s) => s.recipient_wallet === walletAddress);
  }

  async getTokensWithClaimRights(walletAddress: string): Promise<string[]> {
    const tokens: string[] = [];

    // Check emission splits
    const splitsForWallet = this.emissionSplits.filter(
      (s) => s.recipient_wallet === walletAddress
    );
    tokens.push(...splitsForWallet.map((s) => s.token_address));

    // Check creator launches
    const creatorLaunches = await this.getTokenLaunches(walletAddress);
    tokens.push(...creatorLaunches.map((l) => l.token_address));

    // Check verified designated claims
    const verifiedClaims = this.designatedClaims.filter(
      (c) =>
        c.verified_wallet === walletAddress ||
        c.verified_embedded_wallet === walletAddress
    );
    tokens.push(...verifiedClaims.map((c) => c.token_address));

    // Remove duplicates
    return [...new Set(tokens)];
  }

  // ==================== PRESALES ====================

  async createPresale(presale: Omit<Presale, 'id' | 'created_at'>): Promise<Presale> {
    const newPresale: Presale = {
      id: this.nextId.presales++,
      created_at: new Date(),
      ...presale,
    };

    this.presales.push(newPresale);
    return newPresale;
  }

  async getPresaleByTokenAddress(tokenAddress: string): Promise<Presale | null> {
    return this.presales.find((p) => p.token_address === tokenAddress) || null;
  }

  async updatePresaleStatus(tokenAddress: string, status: string): Promise<Presale | null> {
    const presale = await this.getPresaleByTokenAddress(tokenAddress);
    if (!presale) return null;

    presale.status = status;
    return presale;
  }

  async recordPresaleBid(bid: Omit<PresaleBid, 'id'>): Promise<PresaleBid> {
    const newBid: PresaleBid = {
      id: this.nextId.presaleBids++,
      ...bid,
    };

    this.presaleBids.push(newBid);
    return newBid;
  }

  async getPresaleBids(tokenAddress: string): Promise<PresaleBid[]> {
    const presale = await this.getPresaleByTokenAddress(tokenAddress);
    if (!presale) return [];
    return this.presaleBids.filter((b) => b.presale_id === presale.id);
  }

  async getTotalPresaleBids(tokenAddress: string): Promise<{ totalBids: number; totalAmount: bigint }> {
    const presale = await this.getPresaleByTokenAddress(tokenAddress);
    if (!presale) return { totalBids: 0, totalAmount: BigInt(0) };

    const bids = this.presaleBids.filter((b) => b.presale_id === presale.id);
    const totalAmount = bids.reduce((sum, bid) => sum + BigInt(bid.amount_lamports), BigInt(0));
    return { totalBids: bids.length, totalAmount };
  }

  async getUserPresaleContribution(tokenAddress: string, walletAddress: string): Promise<bigint> {
    const presale = await this.getPresaleByTokenAddress(tokenAddress);
    if (!presale) return BigInt(0);

    const bids = this.presaleBids.filter(
      (b) => b.presale_id === presale.id && b.wallet_address === walletAddress
    );
    return bids.reduce((sum, bid) => sum + BigInt(bid.amount_lamports), BigInt(0));
  }

  async getPresalesByCreatorWallet(creatorWallet: string, limit: number = 100): Promise<Presale[]> {
    return this.presales
      .filter((p) => p.creator_wallet === creatorWallet)
      .slice(0, limit);
  }

  // ==================== VERIFICATION ====================

  async createVerificationChallenge(
    walletAddress: string,
    challengeNonce: string,
    challengeMessage: string,
    expiresAt: Date
  ): Promise<VerificationChallenge> {
    const newChallenge: VerificationChallenge = {
      id: this.nextId.verificationChallenges++,
      wallet_address: walletAddress,
      challenge_nonce: challengeNonce,
      challenge_message: challengeMessage,
      expires_at: expiresAt,
      used: false,
      created_at: new Date(),
    };

    this.verificationChallenges.push(newChallenge);
    return newChallenge;
  }

  async getVerificationChallenge(challengeNonce: string): Promise<VerificationChallenge | null> {
    return (
      this.verificationChallenges.find(
        (c) => c.challenge_nonce === challengeNonce && !c.used
      ) || null
    );
  }

  async markChallengeUsed(challengeNonce: string): Promise<void> {
    const challenge = this.verificationChallenges.find(
      (c) => c.challenge_nonce === challengeNonce
    );
    if (challenge) {
      challenge.used = true;
    }
  }

  async incrementVerificationAttempts(tokenAddress: string): Promise<void> {
    // Mock implementation - do nothing since these fields aren't in the type
    return;
  }

  // Mock function for verification lock
  async acquireVerificationLockDB(tokenAddress: string, lockDurationMs: number): Promise<boolean> {
    // In mock mode, always allow lock
    const claim = await this.getDesignatedClaimByToken(tokenAddress);
    return !!claim;
  }
}

// Singleton instance
let mockDbInstance: MockDatabase | null = null;

export function getMockDatabase(): MockDatabase {
  if (!mockDbInstance) {
    mockDbInstance = new MockDatabase();
  }
  return mockDbInstance;
}
