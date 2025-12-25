/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
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

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import nacl from 'tweetnacl';
import { Connection, Keypair, Transaction, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getMint,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT
} from '@solana/spl-token';
import bs58 from 'bs58';
import BN from 'bn.js';
import DLMM from '@meteora-ag/dlmm';
import rateLimit from 'express-rate-limit';

/**
 * DLMM Liquidity Routes
 *
 * Express router for Meteora DLMM liquidity management endpoints
 * Handles withdrawal and deposit operations with manager wallet authorization
 */

const router = Router();

// Rate limiter for DLMM liquidity endpoints
const dlmmLiquidityLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 requests per 5 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many liquidity requests, please wait a moment.'
});

// In-memory storage for liquidity transactions
interface DlmmWithdrawData {
  unsignedTransactions: string[];
  unsignedTransactionHashes: string[];
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  lpOwnerAddress: string;
  managerAddress: string;
  destinationAddress: string;
  // Amounts withdrawn from DLMM bins
  withdrawnTokenXAmount: string;
  withdrawnTokenYAmount: string;
  // Amounts transferred to manager (at market price ratio)
  transferTokenXAmount: string;
  transferTokenYAmount: string;
  // Amounts redeposited back to DLMM
  redepositTokenXAmount: string;
  redepositTokenYAmount: string;
  // Market price info
  marketPrice: number; // tokenY per tokenX (e.g., SOL per ZC)
  positionAddress: string;
  fromBinId: number;
  toBinId: number;
  withdrawalPercentage: number;
  timestamp: number;
}

interface DlmmDepositData {
  unsignedTransaction: string;
  unsignedTransactionHash: string;
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  tokenXDecimals: number;
  tokenYDecimals: number;
  lpOwnerAddress: string;
  managerAddress: string;
  // Total amounts transferred from manager to LP owner
  transferredTokenXAmount: string;
  transferredTokenYAmount: string;
  // Amounts actually deposited to DLMM (balanced at pool price)
  depositedTokenXAmount: string;
  depositedTokenYAmount: string;
  // Amounts left over in LP owner wallet (for cleanup)
  leftoverTokenXAmount: string;
  leftoverTokenYAmount: string;
  // Pool price used for balancing
  activeBinPrice: number; // tokenY per tokenX
  positionAddress: string;
  timestamp: number;
}

interface DlmmCleanupSwapData {
  unsignedTransaction: string;
  unsignedTransactionHash: string;
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  tokenXDecimals: number;
  tokenYDecimals: number;
  lpOwnerAddress: string;
  managerAddress: string;
  activeBinPrice: number;
  // Swap details
  swapInputMint: string;
  swapInputAmount: string;
  swapOutputMint: string;
  swapExpectedOutputAmount: string;
  swapDirection: 'XtoY' | 'YtoX';
  timestamp: number;
}

const withdrawRequests = new Map<string, DlmmWithdrawData>();
const depositRequests = new Map<string, DlmmDepositData>();
const cleanupSwapRequests = new Map<string, DlmmCleanupSwapData>();

// Mutex locks for preventing concurrent processing
const liquidityLocks = new Map<string, Promise<void>>();

/**
 * Acquire a liquidity lock for a specific pool
 */
async function acquireLiquidityLock(poolAddress: string): Promise<() => void> {
  const key = poolAddress.toLowerCase();

  while (liquidityLocks.has(key)) {
    await liquidityLocks.get(key);
  }

  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  liquidityLocks.set(key, lockPromise);

  return () => {
    liquidityLocks.delete(key);
    releaseLock!();
  };
}

// Pool address to ticker mapping (whitelist)
const poolToTicker: Record<string, string> = {
  '7jbhVZcYqCRmciBcZzK8L5B96Pyw7i1SpXQFKBkzD3G2': 'ZC',
  'EC7MUufEpZcRZyXTFt16MMNLjJVnj9Vkku4UwdZ713Hx': 'TESTSURF',
};

// Whitelisted DLMM pools
const WHITELISTED_DLMM_POOLS = new Set(Object.keys(poolToTicker));

// Restricted LP owner address - never allow cleanup swap or deposit using LP balances for this address
const RESTRICTED_LP_OWNER = 'Hq7Xh37tT4sesD6wA4DphYfxeMJRhhFWS3KVUSSGjqzc';

/**
 * Get the manager wallet address for a specific pool
 * Uses same env var naming as DAMM: MANAGER_WALLET_<TICKER>
 */
function getManagerWalletForPool(poolAddress: string): string {
  const ticker = poolToTicker[poolAddress];

  if (!ticker) {
    throw new Error(`Pool ${poolAddress} not found in whitelist`);
  }

  const poolSpecificManager = process.env[`MANAGER_WALLET_${ticker}`];
  if (!poolSpecificManager) {
    throw new Error(`MANAGER_WALLET_${ticker} environment variable not configured`);
  }

  console.log(`Using manager wallet for ${ticker}:`, poolSpecificManager);
  return poolSpecificManager;
}

/**
 * Get the LP owner private key for a specific pool
 * Uses same env var naming as DAMM: LP_OWNER_PRIVATE_KEY_<TICKER>
 */
function getLpOwnerPrivateKeyForPool(poolAddress: string): string {
  const ticker = poolToTicker[poolAddress];

  if (!ticker) {
    throw new Error(`Pool ${poolAddress} not found in whitelist`);
  }

  const poolSpecificLpOwner = process.env[`LP_OWNER_PRIVATE_KEY_${ticker}`];
  if (!poolSpecificLpOwner) {
    throw new Error(`LP_OWNER_PRIVATE_KEY_${ticker} environment variable not configured`);
  }

  console.log(`Using LP owner for ${ticker}`);
  return poolSpecificLpOwner;
}

// Clean up expired requests every 5 minutes
setInterval(() => {
  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  const now = Date.now();

  for (const [requestId, data] of withdrawRequests.entries()) {
    if (now - data.timestamp > FIFTEEN_MINUTES) {
      withdrawRequests.delete(requestId);
    }
  }

  for (const [requestId, data] of depositRequests.entries()) {
    if (now - data.timestamp > FIFTEEN_MINUTES) {
      depositRequests.delete(requestId);
    }
  }

  for (const [requestId, data] of cleanupSwapRequests.entries()) {
    if (now - data.timestamp > FIFTEEN_MINUTES) {
      cleanupSwapRequests.delete(requestId);
    }
  }
}, 5 * 60 * 1000);

// ============================================================================
// GET /dlmm/pool/:poolAddress/config - Get pool configuration (LP owner, manager)
// ============================================================================
/**
 * Returns the LP owner and manager wallet addresses for a given pool
 * Used by os-percent to know where to transfer tokens before cleanup
 */
router.get('/pool/:poolAddress/config', async (req: Request, res: Response) => {
  try {
    const { poolAddress: poolAddressInput } = req.params;

    // Validate poolAddress is a valid Solana public key
    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch {
      return res.status(400).json({
        error: 'Invalid poolAddress: must be a valid Solana public key'
      });
    }

    // Validate pool is whitelisted
    if (!WHITELISTED_DLMM_POOLS.has(poolAddress.toBase58())) {
      return res.status(403).json({
        error: 'Pool not authorized for liquidity operations'
      });
    }

    // Get LP owner and manager wallet for this pool
    let lpOwnerPrivateKey: string;
    let managerWallet: string;
    try {
      lpOwnerPrivateKey = getLpOwnerPrivateKeyForPool(poolAddress.toBase58());
      managerWallet = getManagerWalletForPool(poolAddress.toBase58());
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Derive LP owner public key from private key
    const lpOwnerKeypair = Keypair.fromSecretKey(bs58.decode(lpOwnerPrivateKey));

    return res.json({
      success: true,
      poolAddress: poolAddress.toBase58(),
      lpOwnerAddress: lpOwnerKeypair.publicKey.toBase58(),
      managerAddress: managerWallet
    });

  } catch (error) {
    console.error('Error fetching DLMM pool config:', error);
    return res.status(500).json({
      error: 'Failed to fetch pool configuration',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// ============================================================================
// Jupiter Price API Helper
// ============================================================================

interface JupiterPriceResponse {
  [mint: string]: {
    usdPrice: number;
    blockId: number;
    decimals: number;
    priceChange24h?: number;
  };
}

/**
 * Fetch token prices from Jupiter Price API V3
 * Returns price of tokenX in terms of tokenY (e.g., SOL per ZC)
 */
async function getJupiterPrice(tokenXMint: string, tokenYMint: string): Promise<{
  tokenXUsdPrice: number;
  tokenYUsdPrice: number;
  tokenYPerTokenX: number; // How many tokenY per 1 tokenX (e.g., SOL per ZC)
}> {
  const JUPITER_API_KEY = process.env.JUP_API_KEY;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (JUPITER_API_KEY) {
    headers['x-api-key'] = JUPITER_API_KEY;
  }

  const response = await fetch(
    `https://api.jup.ag/price/v3?ids=${tokenXMint},${tokenYMint}`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`Jupiter API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as JupiterPriceResponse;

  const tokenXData = data[tokenXMint];
  const tokenYData = data[tokenYMint];

  if (!tokenXData || !tokenXData.usdPrice) {
    throw new Error(`Jupiter API: No price data for token X (${tokenXMint})`);
  }

  if (!tokenYData || !tokenYData.usdPrice) {
    throw new Error(`Jupiter API: No price data for token Y (${tokenYMint})`);
  }

  // tokenYPerTokenX = how many tokenY you get for 1 tokenX
  // e.g., if ZC = $0.001 and SOL = $100, then tokenYPerTokenX = 0.001 / 100 = 0.00001 SOL per ZC
  const tokenYPerTokenX = tokenXData.usdPrice / tokenYData.usdPrice;

  console.log(`  Jupiter prices: tokenX=$${tokenXData.usdPrice}, tokenY=$${tokenYData.usdPrice}`);
  console.log(`  Market rate: 1 tokenX = ${tokenYPerTokenX} tokenY`);

  return {
    tokenXUsdPrice: tokenXData.usdPrice,
    tokenYUsdPrice: tokenYData.usdPrice,
    tokenYPerTokenX,
  };
}

// ============================================================================
// POST /dlmm/withdraw/build - Build withdrawal transaction
// ============================================================================

router.post('/withdraw/build', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { withdrawalPercentage, poolAddress: poolAddressInput } = req.body;

    console.log('DLMM withdraw build request received:', { withdrawalPercentage, poolAddress: poolAddressInput });

    // Validate required fields
    if (withdrawalPercentage === undefined || withdrawalPercentage === null) {
      return res.status(400).json({
        error: 'Missing required field: withdrawalPercentage'
      });
    }

    if (!poolAddressInput) {
      return res.status(400).json({
        error: 'Missing required field: poolAddress'
      });
    }

    // Validate poolAddress is a valid Solana public key
    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch {
      return res.status(400).json({
        error: 'Invalid poolAddress: must be a valid Solana public key'
      });
    }

    // Validate pool is whitelisted
    if (!WHITELISTED_DLMM_POOLS.has(poolAddress.toBase58())) {
      return res.status(403).json({
        error: 'Pool not authorized for liquidity operations'
      });
    }

    // Validate withdrawal percentage (maximum 50%)
    if (typeof withdrawalPercentage !== 'number' || withdrawalPercentage <= 0 || withdrawalPercentage > 50) {
      return res.status(400).json({
        error: 'withdrawalPercentage must be a number between 0 and 50'
      });
    }

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) {
      return res.status(500).json({
        error: 'Server configuration incomplete. Missing RPC_URL.'
      });
    }

    // Get pool-specific LP owner and manager wallet
    let LP_OWNER_PRIVATE_KEY: string;
    let MANAGER_WALLET: string;
    try {
      LP_OWNER_PRIVATE_KEY = getLpOwnerPrivateKeyForPool(poolAddress.toBase58());
      MANAGER_WALLET = getManagerWalletForPool(poolAddress.toBase58());
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const managerWallet = new PublicKey(MANAGER_WALLET);

    // Create DLMM instance
    console.log('Creating DLMM instance...');
    const dlmmPool = await DLMM.create(connection, poolAddress);

    // Get pool state
    const lbPair = dlmmPool.lbPair;
    const tokenXMint = lbPair.tokenXMint;
    const tokenYMint = lbPair.tokenYMint;

    console.log(`  Token X Mint: ${tokenXMint.toBase58()}`);
    console.log(`  Token Y Mint: ${tokenYMint.toBase58()}`);

    // Get user positions
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(lpOwner.publicKey);

    if (userPositions.length === 0) {
      return res.status(404).json({
        error: 'No positions found for the LP owner in this pool'
      });
    }

    // Use first position
    const position = userPositions[0];
    const positionData = position.positionData;

    if (!positionData.totalXAmount || !positionData.totalYAmount) {
      return res.status(400).json({
        error: 'Position has no liquidity'
      });
    }

    const totalXAmount = new BN(positionData.totalXAmount);
    const totalYAmount = new BN(positionData.totalYAmount);

    if (totalXAmount.isZero() && totalYAmount.isZero()) {
      return res.status(400).json({
        error: 'No liquidity in position'
      });
    }

    console.log(`  Position: ${position.publicKey.toBase58()}`);
    console.log(`  Total X Amount: ${totalXAmount.toString()}`);
    console.log(`  Total Y Amount: ${totalYAmount.toString()}`);
    console.log(`  Lower Bin ID: ${positionData.lowerBinId}`);
    console.log(`  Upper Bin ID: ${positionData.upperBinId}`);

    // Calculate estimated withdrawal amounts
    const withdrawBps = Math.floor(withdrawalPercentage * 100); // Convert % to bps (50% = 5000)
    const estimatedTokenXAmount = totalXAmount.muln(withdrawBps).divn(10000);
    const estimatedTokenYAmount = totalYAmount.muln(withdrawBps).divn(10000);

    console.log(`  Withdrawal BPS: ${withdrawBps}`);
    console.log(`  Estimated X withdrawal: ${estimatedTokenXAmount.toString()}`);
    console.log(`  Estimated Y withdrawal: ${estimatedTokenYAmount.toString()}`);

    // Build remove liquidity transaction
    const removeLiquidityTxs = await dlmmPool.removeLiquidity({
      user: lpOwner.publicKey,
      position: position.publicKey,
      fromBinId: positionData.lowerBinId,
      toBinId: positionData.upperBinId,
      bps: new BN(withdrawBps),
      shouldClaimAndClose: false,
      skipUnwrapSOL: false,
    });

    // Get token mints info
    const tokenXMintInfo = await getMint(connection, tokenXMint);
    const tokenYMintInfo = await getMint(connection, tokenYMint);
    const isTokenXNativeSOL = tokenXMint.equals(NATIVE_MINT);
    const isTokenYNativeSOL = tokenYMint.equals(NATIVE_MINT);

    // Get ATAs
    const lpOwnerTokenXAta = await getAssociatedTokenAddress(tokenXMint, lpOwner.publicKey);
    const lpOwnerTokenYAta = await getAssociatedTokenAddress(tokenYMint, lpOwner.publicKey);
    const managerTokenXAta = await getAssociatedTokenAddress(tokenXMint, managerWallet);
    const managerTokenYAta = await getAssociatedTokenAddress(tokenYMint, managerWallet);

    // =========================================================================
    // Fetch Jupiter market price and calculate correct amounts
    // =========================================================================
    console.log('  Fetching Jupiter market price...');
    const jupiterPrice = await getJupiterPrice(
      tokenXMint.toBase58(),
      tokenYMint.toBase58()
    );

    // Convert withdrawn amounts to decimal for price calculations
    const withdrawnXDecimal = Number(estimatedTokenXAmount.toString()) / Math.pow(10, tokenXMintInfo.decimals);
    const withdrawnYDecimal = Number(estimatedTokenYAmount.toString()) / Math.pow(10, tokenYMintInfo.decimals);

    // Market price: tokenY per tokenX (e.g., SOL per ZC)
    const marketPrice = jupiterPrice.tokenYPerTokenX;

    console.log(`  Withdrawn: ${withdrawnXDecimal} tokenX, ${withdrawnYDecimal} tokenY`);
    console.log(`  Market price: ${marketPrice} tokenY per tokenX`);

    // Calculate what amounts we need at market price
    // Option A: Use all tokenX, calculate needed tokenY
    const neededYForAllX = withdrawnXDecimal * marketPrice;
    // Option B: Use all tokenY, calculate needed tokenX
    const neededXForAllY = withdrawnYDecimal / marketPrice;

    let transferXDecimal: number;
    let transferYDecimal: number;
    let redepositXDecimal: number;
    let redepositYDecimal: number;

    if (neededYForAllX <= withdrawnYDecimal) {
      // We have excess tokenY (SOL) - use all tokenX, redeposit excess tokenY
      transferXDecimal = withdrawnXDecimal;
      transferYDecimal = neededYForAllX;
      redepositXDecimal = 0;
      redepositYDecimal = withdrawnYDecimal - neededYForAllX;
      console.log(`  Case: Excess tokenY - redepositing ${redepositYDecimal} tokenY`);
    } else {
      // We have excess tokenX (ZC) - use all tokenY, redeposit excess tokenX
      transferXDecimal = neededXForAllY;
      transferYDecimal = withdrawnYDecimal;
      redepositXDecimal = withdrawnXDecimal - neededXForAllY;
      redepositYDecimal = 0;
      console.log(`  Case: Excess tokenX - redepositing ${redepositXDecimal} tokenX`);
    }

    // Convert back to raw amounts (BN)
    const transferTokenXAmount = new BN(Math.floor(transferXDecimal * Math.pow(10, tokenXMintInfo.decimals)));
    const transferTokenYAmount = new BN(Math.floor(transferYDecimal * Math.pow(10, tokenYMintInfo.decimals)));
    const redepositTokenXAmount = new BN(Math.floor(redepositXDecimal * Math.pow(10, tokenXMintInfo.decimals)));
    const redepositTokenYAmount = new BN(Math.floor(redepositYDecimal * Math.pow(10, tokenYMintInfo.decimals)));

    console.log(`  Transfer to manager: ${transferTokenXAmount.toString()} tokenX, ${transferTokenYAmount.toString()} tokenY`);
    console.log(`  Redeposit to DLMM: ${redepositTokenXAmount.toString()} tokenX, ${redepositTokenYAmount.toString()} tokenY`);

    // =========================================================================
    // Build redeposit transaction (if needed)
    // =========================================================================
    let redepositTx: Transaction | null = null;
    const hasRedeposit = !redepositTokenXAmount.isZero() || !redepositTokenYAmount.isZero();

    if (hasRedeposit) {
      console.log('  Building redeposit transaction...');

      redepositTx = new Transaction();

      // If redepositing native SOL, we need to wrap it first
      // After withdrawal with skipUnwrapSOL: false, SOL is in native balance
      // addLiquidityByStrategy expects wSOL in ATA
      if (isTokenXNativeSOL && !redepositTokenXAmount.isZero()) {
        // Ensure wSOL ATA exists
        redepositTx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            lpOwner.publicKey,
            lpOwnerTokenXAta,
            lpOwner.publicKey,
            NATIVE_MINT
          )
        );
        // Transfer native SOL to wSOL ATA and sync
        redepositTx.add(
          SystemProgram.transfer({
            fromPubkey: lpOwner.publicKey,
            toPubkey: lpOwnerTokenXAta,
            lamports: Number(redepositTokenXAmount.toString())
          }),
          createSyncNativeInstruction(lpOwnerTokenXAta)
        );
      }

      if (isTokenYNativeSOL && !redepositTokenYAmount.isZero()) {
        // Ensure wSOL ATA exists
        redepositTx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            lpOwner.publicKey,
            lpOwnerTokenYAta,
            lpOwner.publicKey,
            NATIVE_MINT
          )
        );
        // Transfer native SOL to wSOL ATA and sync
        redepositTx.add(
          SystemProgram.transfer({
            fromPubkey: lpOwner.publicKey,
            toPubkey: lpOwnerTokenYAta,
            lamports: Number(redepositTokenYAmount.toString())
          }),
          createSyncNativeInstruction(lpOwnerTokenYAta)
        );
      }

      // Build add liquidity transaction for the excess tokens
      const addLiquidityTx = await dlmmPool.addLiquidityByStrategy({
        positionPubKey: position.publicKey,
        totalXAmount: redepositTokenXAmount,
        totalYAmount: redepositTokenYAmount,
        strategy: {
          maxBinId: positionData.upperBinId,
          minBinId: positionData.lowerBinId,
          strategyType: 0, // Spot strategy
        },
        user: lpOwner.publicKey,
        slippage: 100, // 1% slippage
      });

      if (Array.isArray(addLiquidityTx)) {
        for (const tx of addLiquidityTx) {
          redepositTx.add(...tx.instructions);
        }
      } else {
        redepositTx.add(...addLiquidityTx.instructions);
      }
    }

    // =========================================================================
    // Build transfer transaction (only needed amounts to manager)
    // =========================================================================
    const transferTx = new Transaction();

    // Create manager ATAs if needed
    transferTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        lpOwner.publicKey,
        managerTokenXAta,
        managerWallet,
        tokenXMint
      )
    );

    if (!isTokenYNativeSOL) {
      transferTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          lpOwner.publicKey,
          managerTokenYAta,
          managerWallet,
          tokenYMint
        )
      );
    }

    // Transfer Token X to manager (only the needed amount)
    if (!transferTokenXAmount.isZero()) {
      if (isTokenXNativeSOL) {
        transferTx.add(
          SystemProgram.transfer({
            fromPubkey: lpOwner.publicKey,
            toPubkey: managerWallet,
            lamports: Number(transferTokenXAmount.toString())
          })
        );
      } else {
        transferTx.add(
          createTransferInstruction(
            lpOwnerTokenXAta,
            managerTokenXAta,
            lpOwner.publicKey,
            BigInt(transferTokenXAmount.toString())
          )
        );
      }
    }

    // Transfer Token Y to manager (only the needed amount)
    if (!transferTokenYAmount.isZero()) {
      if (isTokenYNativeSOL) {
        transferTx.add(
          SystemProgram.transfer({
            fromPubkey: lpOwner.publicKey,
            toPubkey: managerWallet,
            lamports: Number(transferTokenYAmount.toString())
          })
        );
      } else {
        transferTx.add(
          createTransferInstruction(
            lpOwnerTokenYAta,
            managerTokenYAta,
            lpOwner.publicKey,
            BigInt(transferTokenYAmount.toString())
          )
        );
      }
    }

    // =========================================================================
    // Prepare all transactions
    // Order: 1) Remove liquidity, 2) Redeposit excess, 3) Transfer to manager
    // =========================================================================
    const { blockhash } = await connection.getLatestBlockhash();
    const allTransactions: Transaction[] = [];

    // Add each removal transaction from the SDK (keeps them properly chunked)
    for (const tx of removeLiquidityTxs) {
      const removeTx = new Transaction();
      removeTx.add(...tx.instructions);
      removeTx.recentBlockhash = blockhash;
      removeTx.feePayer = managerWallet;
      allTransactions.push(removeTx);
    }

    // Add redeposit transaction if needed
    if (redepositTx) {
      redepositTx.recentBlockhash = blockhash;
      redepositTx.feePayer = managerWallet;
      allTransactions.push(redepositTx);
    }

    // Add the transfer transaction as the final tx
    transferTx.recentBlockhash = blockhash;
    transferTx.feePayer = managerWallet;
    allTransactions.push(transferTx);

    console.log(`  Number of transactions: ${allTransactions.length}`);

    // Serialize all unsigned transactions
    const unsignedTransactions = allTransactions.map(tx =>
      bs58.encode(tx.serialize({ requireAllSignatures: false }))
    );

    // Create hashes of serialized messages for tamper detection
    const unsignedTransactionHashes = allTransactions.map(tx =>
      crypto.createHash('sha256').update(tx.serializeMessage()).digest('hex')
    );

    // Generate request ID
    const requestId = crypto.randomBytes(16).toString('hex');

    console.log('✓ Withdrawal transactions built successfully');
    console.log(`  Pool: ${poolAddress.toBase58()}`);
    console.log(`  Withdrawal: ${withdrawalPercentage}%`);
    console.log(`  Withdrawn: ${estimatedTokenXAmount.toString()} tokenX, ${estimatedTokenYAmount.toString()} tokenY`);
    console.log(`  Transfer: ${transferTokenXAmount.toString()} tokenX, ${transferTokenYAmount.toString()} tokenY`);
    console.log(`  Redeposit: ${redepositTokenXAmount.toString()} tokenX, ${redepositTokenYAmount.toString()} tokenY`);
    console.log(`  Market price: ${marketPrice} tokenY/tokenX`);
    console.log(`  Request ID: ${requestId}`);
    console.log(`  Transaction count: ${allTransactions.length}`);

    // Store request data
    withdrawRequests.set(requestId, {
      unsignedTransactions,
      unsignedTransactionHashes,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: managerWallet.toBase58(),
      destinationAddress: managerWallet.toBase58(),
      withdrawnTokenXAmount: estimatedTokenXAmount.toString(),
      withdrawnTokenYAmount: estimatedTokenYAmount.toString(),
      transferTokenXAmount: transferTokenXAmount.toString(),
      transferTokenYAmount: transferTokenYAmount.toString(),
      redepositTokenXAmount: redepositTokenXAmount.toString(),
      redepositTokenYAmount: redepositTokenYAmount.toString(),
      marketPrice,
      positionAddress: position.publicKey.toBase58(),
      fromBinId: positionData.lowerBinId,
      toBinId: positionData.upperBinId,
      withdrawalPercentage,
      timestamp: Date.now()
    });

    return res.json({
      success: true,
      transactions: unsignedTransactions,
      transactionCount: unsignedTransactions.length,
      requestId,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      tokenXDecimals: tokenXMintInfo.decimals,
      tokenYDecimals: tokenYMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      destinationAddress: managerWallet.toBase58(),
      withdrawalPercentage,
      marketPrice,
      withdrawn: {
        tokenX: estimatedTokenXAmount.toString(),
        tokenY: estimatedTokenYAmount.toString(),
      },
      transferred: {
        tokenX: transferTokenXAmount.toString(),
        tokenY: transferTokenYAmount.toString(),
      },
      redeposited: {
        tokenX: redepositTokenXAmount.toString(),
        tokenY: redepositTokenYAmount.toString(),
      },
      message: 'Sign all transactions with the manager wallet and submit to /dlmm/withdraw/confirm'
    });

  } catch (error) {
    console.error('Error building DLMM withdrawal transaction:', error);
    return res.status(500).json({
      error: 'Failed to build withdrawal transaction',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// ============================================================================
// POST /dlmm/withdraw/confirm - Confirm and submit withdrawal
// ============================================================================
/**
 * Security measures (matching DAMM):
 * 1. Manager wallet signature - Transaction must be signed by manager wallet
 * 2. Lock system - Prevents concurrent operations for the same pool
 * 3. Request expiry - 10 minute timeout
 * 4. Blockhash validation - Prevents replay attacks
 * 5. Transaction hash validation - Prevents tampering
 * 6. Comprehensive logging
 */

router.post('/withdraw/confirm', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransactions, requestId } = req.body;

    console.log('DLMM withdraw confirm request received:', { requestId });

    // Validate required fields
    if (!signedTransactions || !Array.isArray(signedTransactions) || signedTransactions.length === 0 || !requestId) {
      return res.status(400).json({
        error: 'Missing required fields: signedTransactions (array) and requestId'
      });
    }

    // Retrieve request data
    const requestData = withdrawRequests.get(requestId);
    if (!requestData) {
      return res.status(400).json({
        error: 'Withdrawal request not found or expired. Please call /dlmm/withdraw/build first.'
      });
    }

    // Validate transaction count matches
    if (signedTransactions.length !== requestData.unsignedTransactions.length) {
      return res.status(400).json({
        error: `Expected ${requestData.unsignedTransactions.length} transactions, got ${signedTransactions.length}`
      });
    }

    console.log('  Pool:', requestData.poolAddress);
    console.log('  Transaction count:', signedTransactions.length);

    // Acquire lock
    releaseLock = await acquireLiquidityLock(requestData.poolAddress);
    console.log('  Lock acquired');

    // Check request age (10 minutes like DAMM)
    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - requestData.timestamp > TEN_MINUTES) {
      withdrawRequests.delete(requestId);
      return res.status(400).json({
        error: 'Withdrawal request expired. Please create a new request.'
      });
    }

    // Validate environment
    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) {
      return res.status(500).json({
        error: 'Server configuration incomplete. Missing RPC_URL.'
      });
    }

    // Get pool-specific LP owner
    let LP_OWNER_PRIVATE_KEY: string;
    try {
      LP_OWNER_PRIVATE_KEY = getLpOwnerPrivateKeyForPool(requestData.poolAddress);
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Initialize connection
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwnerKeypair = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const managerWalletPubKey = new PublicKey(requestData.managerAddress);

    // Validate and prepare all transactions first
    const transactions: Transaction[] = [];
    for (let i = 0; i < signedTransactions.length; i++) {
      const signedTx = signedTransactions[i];
      const expectedHash = requestData.unsignedTransactionHashes[i];

      // Deserialize transaction
      let transaction: Transaction;
      try {
        const transactionBuffer = bs58.decode(signedTx);
        transaction = Transaction.from(transactionBuffer);
      } catch (error) {
        return res.status(400).json({
          error: `Failed to deserialize transaction ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }

      // SECURITY: Validate blockhash
      if (!transaction.recentBlockhash) {
        return res.status(400).json({
          error: `Invalid transaction ${i + 1}: missing blockhash`
        });
      }

      // SECURITY: Verify fee payer is manager wallet
      if (!transaction.feePayer) {
        return res.status(400).json({
          error: `Transaction ${i + 1} missing fee payer`
        });
      }

      if (!transaction.feePayer.equals(managerWalletPubKey)) {
        return res.status(400).json({
          error: `Transaction ${i + 1} fee payer must be manager wallet`
        });
      }

      // SECURITY: Verify manager wallet has signed
      const managerSignature = transaction.signatures.find(sig =>
        sig.publicKey.equals(managerWalletPubKey)
      );

      if (!managerSignature || !managerSignature.signature) {
        return res.status(400).json({
          error: `Transaction ${i + 1} verification failed: Manager wallet has not signed`
        });
      }

      // Verify manager signature is valid
      const messageData = transaction.serializeMessage();
      const managerSigValid = nacl.sign.detached.verify(
        messageData,
        managerSignature.signature,
        managerSignature.publicKey.toBytes()
      );

      if (!managerSigValid) {
        return res.status(400).json({
          error: `Transaction ${i + 1} verification failed: Invalid manager wallet signature`
        });
      }

      // SECURITY: Verify transaction hasn't been tampered with
      const receivedTransactionHash = crypto.createHash('sha256')
        .update(transaction.serializeMessage())
        .digest('hex');

      if (receivedTransactionHash !== expectedHash) {
        console.log(`  ⚠️  Transaction ${i + 1} hash mismatch detected`);
        console.log(`    Expected: ${expectedHash.substring(0, 16)}...`);
        console.log(`    Received: ${receivedTransactionHash.substring(0, 16)}...`);
        return res.status(400).json({
          error: `Transaction ${i + 1} verification failed: transaction has been modified`,
          details: 'Transaction structure does not match the original unsigned transaction'
        });
      }

      transactions.push(transaction);
    }
    console.log(`  ✓ All ${transactions.length} transactions verified`);

    // Check blockhash validity (use first transaction's blockhash as they should all be the same)
    const isBlockhashValid = await connection.isBlockhashValid(
      transactions[0].recentBlockhash!,
      { commitment: 'confirmed' }
    );

    if (!isBlockhashValid) {
      return res.status(400).json({
        error: 'Invalid transaction: blockhash is expired. Please create new transactions.'
      });
    }

    // Send all transactions sequentially
    const signatures: string[] = [];
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    for (let i = 0; i < transactions.length; i++) {
      const transaction = transactions[i];

      // Add LP owner signature
      transaction.partialSign(lpOwnerKeypair);

      console.log(`  Sending transaction ${i + 1}/${transactions.length}...`);
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
      signatures.push(signature);

      console.log(`  ✓ Transaction ${i + 1} sent: ${signature}`);

      // Wait for confirmation before sending next transaction
      try {
        await connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight
        });
        console.log(`  ✓ Transaction ${i + 1} confirmed`);
      } catch (error) {
        console.error(`  ⚠ Transaction ${i + 1} confirmation timeout:`, error);
        // Continue anyway - the transaction may still succeed
      }
    }

    console.log('✓ DLMM withdrawal transactions completed');
    console.log(`  Pool: ${requestData.poolAddress}`);
    console.log(`  Withdrawal: ${requestData.withdrawalPercentage}%`);
    console.log(`  Signatures: ${signatures.join(', ')}`);

    // Clean up
    withdrawRequests.delete(requestId);

    res.json({
      success: true,
      signatures,
      poolAddress: requestData.poolAddress,
      tokenXMint: requestData.tokenXMint,
      tokenYMint: requestData.tokenYMint,
      withdrawalPercentage: requestData.withdrawalPercentage,
      marketPrice: requestData.marketPrice,
      withdrawn: {
        tokenX: requestData.withdrawnTokenXAmount,
        tokenY: requestData.withdrawnTokenYAmount,
      },
      transferred: {
        tokenX: requestData.transferTokenXAmount,
        tokenY: requestData.transferTokenYAmount,
      },
      redeposited: {
        tokenX: requestData.redepositTokenXAmount,
        tokenY: requestData.redepositTokenYAmount,
      },
      message: 'Withdrawal transactions submitted successfully'
    });

  } catch (error) {
    console.error('DLMM withdraw confirm error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to confirm withdrawal'
    });
  } finally {
    if (releaseLock) {
      releaseLock();
    }
  }
});

// ============================================================================
// POST /dlmm/deposit/build - Build deposit transaction
// ============================================================================

router.post('/deposit/build', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { tokenXAmount, tokenYAmount, poolAddress: poolAddressInput } = req.body;

    console.log('DLMM deposit build request received:', { tokenXAmount, tokenYAmount, poolAddress: poolAddressInput });

    // Validate required fields
    if (!poolAddressInput) {
      return res.status(400).json({
        error: 'Missing required field: poolAddress'
      });
    }

    // Determine if we're using LP owner wallet balances (cleanup mode)
    // Cleanup mode: both tokenXAmount and tokenYAmount are 0 or undefined
    const useCleanupMode = (!tokenXAmount || tokenXAmount === '0') && (!tokenYAmount || tokenYAmount === '0');

    // Validate poolAddress
    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch {
      return res.status(400).json({
        error: 'Invalid poolAddress: must be a valid Solana public key'
      });
    }

    // Validate pool is whitelisted
    if (!WHITELISTED_DLMM_POOLS.has(poolAddress.toBase58())) {
      return res.status(403).json({
        error: 'Pool not authorized for liquidity operations'
      });
    }

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) {
      return res.status(500).json({
        error: 'Server configuration incomplete. Missing RPC_URL.'
      });
    }

    // Get pool-specific LP owner and manager wallet
    let LP_OWNER_PRIVATE_KEY: string;
    let MANAGER_WALLET: string;
    try {
      LP_OWNER_PRIVATE_KEY = getLpOwnerPrivateKeyForPool(poolAddress.toBase58());
      MANAGER_WALLET = getManagerWalletForPool(poolAddress.toBase58());
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const manager = new PublicKey(MANAGER_WALLET);

    // Create DLMM instance
    console.log('Creating DLMM instance...');
    const dlmmPool = await DLMM.create(connection, poolAddress);

    const lbPair = dlmmPool.lbPair;
    const tokenXMint = lbPair.tokenXMint;
    const tokenYMint = lbPair.tokenYMint;

    // Get token mint info
    const tokenXMintInfo = await getMint(connection, tokenXMint);
    const tokenYMintInfo = await getMint(connection, tokenYMint);
    const isTokenXNativeSOL = tokenXMint.equals(NATIVE_MINT);
    const isTokenYNativeSOL = tokenYMint.equals(NATIVE_MINT);

    console.log(`  Token X Mint: ${tokenXMint.toBase58()} (decimals: ${tokenXMintInfo.decimals})`);
    console.log(`  Token Y Mint: ${tokenYMint.toBase58()} (decimals: ${tokenYMintInfo.decimals})`);

    // Get LP owner ATAs
    const lpOwnerTokenXAta = await getAssociatedTokenAddress(tokenXMint, lpOwner.publicKey);
    const lpOwnerTokenYAta = await getAssociatedTokenAddress(tokenYMint, lpOwner.publicKey);

    // Determine deposit amounts - either from request or from LP owner wallet balances
    let tokenXAmountBN: BN;
    let tokenYAmountBN: BN;

    if (useCleanupMode) {
      console.log('  Using cleanup mode - reading LP owner wallet balances');

      // SAFETY CHECK: Prevent deposit using LP balances for restricted LP owner address
      if (lpOwner.publicKey.toBase58() === RESTRICTED_LP_OWNER) {
        return res.status(403).json({
          error: 'Deposit operations using LP owner balances are not permitted for this LP owner address'
        });
      }

      tokenXAmountBN = new BN(0);
      tokenYAmountBN = new BN(0);

      try {
        const tokenXAccount = await connection.getTokenAccountBalance(lpOwnerTokenXAta);
        tokenXAmountBN = new BN(tokenXAccount.value.amount);
      } catch {
        // Account doesn't exist or has 0 balance
      }

      try {
        if (isTokenYNativeSOL) {
          const solBalance = await connection.getBalance(lpOwner.publicKey);
          // Reserve some SOL for transaction fees (0.01 SOL)
          const reserveForFees = 10_000_000; // 0.01 SOL in lamports
          tokenYAmountBN = new BN(Math.max(0, solBalance - reserveForFees));

          // Also check wSOL ATA if it exists
          try {
            const wsolAccount = await connection.getTokenAccountBalance(lpOwnerTokenYAta);
            tokenYAmountBN = tokenYAmountBN.add(new BN(wsolAccount.value.amount));
          } catch {
            // wSOL ATA doesn't exist
          }
        } else {
          const tokenYAccount = await connection.getTokenAccountBalance(lpOwnerTokenYAta);
          tokenYAmountBN = new BN(tokenYAccount.value.amount);
        }
      } catch {
        // Account doesn't exist or has 0 balance
      }

      console.log(`  LP Owner X Balance: ${tokenXAmountBN.toString()}`);
      console.log(`  LP Owner Y Balance: ${tokenYAmountBN.toString()}`);

      if (tokenXAmountBN.isZero() && tokenYAmountBN.isZero()) {
        return res.status(400).json({
          error: 'No tokens available in LP owner wallet for cleanup deposit'
        });
      }
    } else {
      // Parse amounts from request
      tokenXAmountBN = new BN(tokenXAmount || '0');
      tokenYAmountBN = new BN(tokenYAmount || '0');
    }

    // Get user positions
    const { userPositions, activeBin } = await dlmmPool.getPositionsByUserAndLbPair(lpOwner.publicKey);

    if (userPositions.length === 0) {
      return res.status(404).json({
        error: 'No positions found for the LP owner in this pool. Create a position first.'
      });
    }

    const position = userPositions[0];
    const positionData = position.positionData;

    console.log(`  Position: ${position.publicKey.toBase58()}`);
    console.log(`  Active Bin: ${activeBin.binId}`);
    console.log(`  Active Bin Price (per token): ${activeBin.pricePerToken}`);
    console.log(`  Position Range: ${positionData.lowerBinId} - ${positionData.upperBinId}`);

    // =========================================================================
    // Calculate balanced deposit amounts based on active bin price
    // =========================================================================
    // Active bin price is tokenY per tokenX (e.g., SOL per ZC)
    // We need to determine which token is in excess and only deposit balanced amounts
    const activeBinPrice = parseFloat(activeBin.pricePerToken);

    // Convert requested amounts to decimal for calculations
    const requestedXDecimal = Number(tokenXAmountBN.toString()) / Math.pow(10, tokenXMintInfo.decimals);
    const requestedYDecimal = Number(tokenYAmountBN.toString()) / Math.pow(10, tokenYMintInfo.decimals);

    console.log(`  Requested X (decimal): ${requestedXDecimal}`);
    console.log(`  Requested Y (decimal): ${requestedYDecimal}`);
    console.log(`  Active bin price: ${activeBinPrice} Y per X`);

    // Calculate balanced amounts
    // Option A: Use all X, calculate needed Y
    const neededYForAllX = requestedXDecimal * activeBinPrice;
    // Option B: Use all Y, calculate needed X
    const neededXForAllY = requestedYDecimal / activeBinPrice;

    let depositXDecimal: number;
    let depositYDecimal: number;
    let leftoverXDecimal: number;
    let leftoverYDecimal: number;

    if (neededYForAllX <= requestedYDecimal) {
      // We have excess tokenY - use all tokenX, deposit matching tokenY, leave excess Y
      depositXDecimal = requestedXDecimal;
      depositYDecimal = neededYForAllX;
      leftoverXDecimal = 0;
      leftoverYDecimal = requestedYDecimal - neededYForAllX;
      console.log(`  Case: Excess tokenY - leaving ${leftoverYDecimal} Y in LP wallet`);
    } else {
      // We have excess tokenX - use all tokenY, deposit matching tokenX, leave excess X
      depositXDecimal = neededXForAllY;
      depositYDecimal = requestedYDecimal;
      leftoverXDecimal = requestedXDecimal - neededXForAllY;
      leftoverYDecimal = 0;
      console.log(`  Case: Excess tokenX - leaving ${leftoverXDecimal} X in LP wallet`);
    }

    // Convert back to raw amounts (BN)
    const depositTokenXAmount = new BN(Math.floor(depositXDecimal * Math.pow(10, tokenXMintInfo.decimals)));
    const depositTokenYAmount = new BN(Math.floor(depositYDecimal * Math.pow(10, tokenYMintInfo.decimals)));
    const leftoverTokenXAmount = new BN(Math.floor(leftoverXDecimal * Math.pow(10, tokenXMintInfo.decimals)));
    const leftoverTokenYAmount = new BN(Math.floor(leftoverYDecimal * Math.pow(10, tokenYMintInfo.decimals)));

    console.log(`  Deposit X: ${depositTokenXAmount.toString()} (${depositXDecimal})`);
    console.log(`  Deposit Y: ${depositTokenYAmount.toString()} (${depositYDecimal})`);
    console.log(`  Leftover X: ${leftoverTokenXAmount.toString()} (${leftoverXDecimal})`);
    console.log(`  Leftover Y: ${leftoverTokenYAmount.toString()} (${leftoverYDecimal})`);

    // Build combined transaction
    const combinedTx = new Transaction();

    // Get manager ATAs
    const managerTokenXAta = await getAssociatedTokenAddress(tokenXMint, manager);
    const managerTokenYAta = await getAssociatedTokenAddress(tokenYMint, manager);

    // Create LP owner ATAs if needed (always create both, even for native SOL which needs wrapped SOL ATA)
    // Manager pays for ATA creation as fee payer
    combinedTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        manager,
        lpOwnerTokenXAta,
        lpOwner.publicKey,
        tokenXMint
      )
    );
    combinedTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        manager,
        lpOwnerTokenYAta,
        lpOwner.publicKey,
        tokenYMint
      )
    );

    // Transfer tokens from manager to LP owner
    // Skip if cleanup mode (tokens already in LP owner wallet)
    if (!useCleanupMode) {
      if (!tokenXAmountBN.isZero()) {
        if (isTokenXNativeSOL) {
          // Transfer native SOL to wrapped SOL ATA and sync
          combinedTx.add(
            SystemProgram.transfer({
              fromPubkey: manager,
              toPubkey: lpOwnerTokenXAta,
              lamports: Number(tokenXAmountBN.toString())
            }),
            createSyncNativeInstruction(lpOwnerTokenXAta)
          );
        } else {
          combinedTx.add(
            createTransferInstruction(
              managerTokenXAta,
              lpOwnerTokenXAta,
              manager,
              BigInt(tokenXAmountBN.toString())
            )
          );
        }
      }

      if (!tokenYAmountBN.isZero()) {
        if (isTokenYNativeSOL) {
          // Transfer native SOL to wrapped SOL ATA and sync
          combinedTx.add(
            SystemProgram.transfer({
              fromPubkey: manager,
              toPubkey: lpOwnerTokenYAta,
            lamports: Number(tokenYAmountBN.toString())
          }),
          createSyncNativeInstruction(lpOwnerTokenYAta)
        );
      } else {
        combinedTx.add(
          createTransferInstruction(
            managerTokenYAta,
            lpOwnerTokenYAta,
            manager,
            BigInt(tokenYAmountBN.toString())
          )
        );
      }
      }
    } // end if (!useCleanupMode)

    // Add liquidity to position using strategy
    // Using spot distribution around active bin
    // Only deposit the BALANCED amounts, leaving excess in LP owner wallet
    const addLiquidityTx = await dlmmPool.addLiquidityByStrategy({
      positionPubKey: position.publicKey,
      totalXAmount: depositTokenXAmount,
      totalYAmount: depositTokenYAmount,
      strategy: {
        maxBinId: positionData.upperBinId,
        minBinId: positionData.lowerBinId,
        strategyType: 0, // Spot strategy
      },
      user: lpOwner.publicKey,
      slippage: 100, // 1% slippage
    });

    // Add liquidity instructions - handle both single transaction and array of transactions
    if (Array.isArray(addLiquidityTx)) {
      for (const tx of addLiquidityTx) {
        combinedTx.add(...tx.instructions);
      }
    } else {
      combinedTx.add(...addLiquidityTx.instructions);
    }

    // Set transaction properties (manager wallet is fee payer for security)
    const { blockhash } = await connection.getLatestBlockhash();
    combinedTx.recentBlockhash = blockhash;
    combinedTx.feePayer = manager;

    // Serialize unsigned transaction (base58 like DAMM)
    const unsignedTransaction = bs58.encode(combinedTx.serialize({ requireAllSignatures: false }));

    // Create hash of serialized message for tamper detection
    const unsignedTransactionHash = crypto
      .createHash('sha256')
      .update(combinedTx.serializeMessage())
      .digest('hex');

    // Generate request ID
    const requestId = crypto.randomBytes(16).toString('hex');

    console.log('✓ Deposit transaction built successfully');
    console.log(`  Pool: ${poolAddress.toBase58()}`);
    console.log(`  Transferred: ${tokenXAmountBN.toString()} X, ${tokenYAmountBN.toString()} Y`);
    console.log(`  Deposited: ${depositTokenXAmount.toString()} X, ${depositTokenYAmount.toString()} Y`);
    console.log(`  Leftover: ${leftoverTokenXAmount.toString()} X, ${leftoverTokenYAmount.toString()} Y`);
    console.log(`  Active Bin Price: ${activeBinPrice}`);
    console.log(`  Request ID: ${requestId}`);

    const hasLeftover = !leftoverTokenXAmount.isZero() || !leftoverTokenYAmount.isZero();

    // Store request data
    depositRequests.set(requestId, {
      unsignedTransaction,
      unsignedTransactionHash,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      tokenXDecimals: tokenXMintInfo.decimals,
      tokenYDecimals: tokenYMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: manager.toBase58(),
      transferredTokenXAmount: tokenXAmountBN.toString(),
      transferredTokenYAmount: tokenYAmountBN.toString(),
      depositedTokenXAmount: depositTokenXAmount.toString(),
      depositedTokenYAmount: depositTokenYAmount.toString(),
      leftoverTokenXAmount: leftoverTokenXAmount.toString(),
      leftoverTokenYAmount: leftoverTokenYAmount.toString(),
      activeBinPrice,
      positionAddress: position.publicKey.toBase58(),
      timestamp: Date.now()
    });

    return res.json({
      success: true,
      transaction: unsignedTransaction,
      requestId,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      tokenXDecimals: tokenXMintInfo.decimals,
      tokenYDecimals: tokenYMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: manager.toBase58(),
      instructionsCount: combinedTx.instructions.length,
      cleanupMode: useCleanupMode,
      activeBinPrice,
      hasLeftover,
      transferred: {
        tokenX: tokenXAmountBN.toString(),
        tokenY: tokenYAmountBN.toString(),
      },
      deposited: {
        tokenX: depositTokenXAmount.toString(),
        tokenY: depositTokenYAmount.toString(),
      },
      leftover: {
        tokenX: leftoverTokenXAmount.toString(),
        tokenY: leftoverTokenYAmount.toString(),
      },
      message: hasLeftover
        ? 'Sign this transaction with the manager wallet and submit to /dlmm/deposit/confirm. Note: leftover tokens will remain in LP owner wallet for cleanup.'
        : 'Sign this transaction with the manager wallet and submit to /dlmm/deposit/confirm'
    });

  } catch (error) {
    console.error('Error building DLMM deposit transaction:', error);
    return res.status(500).json({
      error: 'Failed to build deposit transaction',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// ============================================================================
// POST /dlmm/deposit/confirm - Confirm and submit deposit
// ============================================================================
/**
 * Security measures (matching DAMM):
 * 1. Manager wallet signature - Transaction must be signed by manager wallet
 * 2. Lock system - Prevents concurrent operations for the same pool
 * 3. Request expiry - 10 minute timeout
 * 4. Blockhash validation - Prevents replay attacks
 * 5. Transaction hash validation - Prevents tampering
 * 6. Comprehensive logging
 */

router.post('/deposit/confirm', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransaction, requestId } = req.body;

    console.log('DLMM deposit confirm request received:', { requestId });

    // Validate required fields
    if (!signedTransaction || !requestId) {
      return res.status(400).json({
        error: 'Missing required fields: signedTransaction and requestId'
      });
    }

    // Retrieve request data
    const requestData = depositRequests.get(requestId);
    if (!requestData) {
      return res.status(400).json({
        error: 'Deposit request not found or expired. Please call /dlmm/deposit/build first.'
      });
    }

    console.log('  Pool:', requestData.poolAddress);
    console.log('  Manager:', requestData.managerAddress);

    // Acquire lock
    releaseLock = await acquireLiquidityLock(requestData.poolAddress);
    console.log('  Lock acquired');

    // Check request age (10 minutes like DAMM)
    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - requestData.timestamp > TEN_MINUTES) {
      depositRequests.delete(requestId);
      return res.status(400).json({
        error: 'Deposit request expired. Please create a new request.'
      });
    }

    // Validate environment
    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) {
      return res.status(500).json({
        error: 'Server configuration incomplete. Missing RPC_URL.'
      });
    }

    // Get pool-specific LP owner
    let LP_OWNER_PRIVATE_KEY: string;
    try {
      LP_OWNER_PRIVATE_KEY = getLpOwnerPrivateKeyForPool(requestData.poolAddress);
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Initialize connection
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwnerKeypair = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const managerWalletPubKey = new PublicKey(requestData.managerAddress);

    // Deserialize transaction
    let transaction: Transaction;
    try {
      const transactionBuffer = bs58.decode(signedTransaction);
      transaction = Transaction.from(transactionBuffer);
    } catch (error) {
      return res.status(400).json({
        error: `Failed to deserialize transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }

    // SECURITY: Validate blockhash
    if (!transaction.recentBlockhash) {
      return res.status(400).json({
        error: 'Invalid transaction: missing blockhash'
      });
    }

    const isBlockhashValid = await connection.isBlockhashValid(
      transaction.recentBlockhash,
      { commitment: 'confirmed' }
    );

    if (!isBlockhashValid) {
      return res.status(400).json({
        error: 'Invalid transaction: blockhash is expired. Please create a new transaction.'
      });
    }

    // SECURITY: Verify fee payer is manager wallet
    if (!transaction.feePayer) {
      return res.status(400).json({
        error: 'Transaction missing fee payer'
      });
    }

    if (!transaction.feePayer.equals(managerWalletPubKey)) {
      return res.status(400).json({
        error: 'Transaction fee payer must be manager wallet'
      });
    }

    // SECURITY: Verify manager wallet has signed
    const managerSignature = transaction.signatures.find(sig =>
      sig.publicKey.equals(managerWalletPubKey)
    );

    if (!managerSignature || !managerSignature.signature) {
      return res.status(400).json({
        error: 'Transaction verification failed: Manager wallet has not signed'
      });
    }

    // Verify manager signature is valid
    const messageData = transaction.serializeMessage();
    const managerSigValid = nacl.sign.detached.verify(
      messageData,
      managerSignature.signature,
      managerSignature.publicKey.toBytes()
    );

    if (!managerSigValid) {
      return res.status(400).json({
        error: 'Transaction verification failed: Invalid manager wallet signature'
      });
    }

    // SECURITY: Verify transaction hasn't been tampered with
    const receivedTransactionHash = crypto.createHash('sha256')
      .update(transaction.serializeMessage())
      .digest('hex');

    if (receivedTransactionHash !== requestData.unsignedTransactionHash) {
      console.log(`  ⚠️  Transaction hash mismatch detected`);
      console.log(`    Expected: ${requestData.unsignedTransactionHash.substring(0, 16)}...`);
      console.log(`    Received: ${receivedTransactionHash.substring(0, 16)}...`);
      return res.status(400).json({
        error: 'Transaction verification failed: transaction has been modified',
        details: 'Transaction structure does not match the original unsigned transaction'
      });
    }
    console.log(`  ✓ Transaction integrity verified (cryptographic hash match)`);

    // Add LP owner signature
    transaction.partialSign(lpOwnerKeypair);

    // Send transaction
    console.log('  Sending transaction...');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });

    console.log('✓ DLMM deposit transaction sent');
    console.log(`  Signature: ${signature}`);
    console.log(`  Pool: ${requestData.poolAddress}`);
    console.log(`  Manager: ${requestData.managerAddress}`);
    console.log(`  LP Owner: ${requestData.lpOwnerAddress}`);
    console.log(`  Transferred: ${requestData.transferredTokenXAmount} X, ${requestData.transferredTokenYAmount} Y`);
    console.log(`  Deposited: ${requestData.depositedTokenXAmount} X, ${requestData.depositedTokenYAmount} Y`);
    console.log(`  Leftover: ${requestData.leftoverTokenXAmount} X, ${requestData.leftoverTokenYAmount} Y`);
    console.log(`  Solscan: https://solscan.io/tx/${signature}`);

    // Wait for confirmation
    try {
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      });
      console.log(`✓ Deposit confirmed: ${signature}`);
    } catch (error) {
      console.error(`⚠ Confirmation timeout for ${signature}:`, error);
    }

    // Clean up
    depositRequests.delete(requestId);

    const hasLeftover = requestData.leftoverTokenXAmount !== '0' || requestData.leftoverTokenYAmount !== '0';

    res.json({
      success: true,
      signature,
      poolAddress: requestData.poolAddress,
      tokenXMint: requestData.tokenXMint,
      tokenYMint: requestData.tokenYMint,
      tokenXDecimals: requestData.tokenXDecimals,
      tokenYDecimals: requestData.tokenYDecimals,
      activeBinPrice: requestData.activeBinPrice,
      transferred: {
        tokenX: requestData.transferredTokenXAmount,
        tokenY: requestData.transferredTokenYAmount,
      },
      deposited: {
        tokenX: requestData.depositedTokenXAmount,
        tokenY: requestData.depositedTokenYAmount,
      },
      leftover: {
        tokenX: requestData.leftoverTokenXAmount,
        tokenY: requestData.leftoverTokenYAmount,
      },
      cleanupRequired: hasLeftover,
      message: hasLeftover
        ? 'Deposit transaction submitted successfully. Leftover tokens in LP wallet require cleanup.'
        : 'Deposit transaction submitted successfully'
    });

  } catch (error) {
    console.error('DLMM deposit confirm error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to confirm deposit'
    });
  } finally {
    if (releaseLock) {
      releaseLock();
    }
  }
});

// ============================================================================
// POST /dlmm/cleanup/swap/build - Build swap transaction for leftover tokens
// ============================================================================
/**
 * Cleanup swap endpoint - Step 1 of cleanup process
 *
 * This endpoint:
 * 1. Reads LP owner's token balances
 * 2. Determines which token is in excess based on pool price
 * 3. Fetches Jupiter quote for swapping excess token
 * 4. Returns unsigned swap transaction for manager to sign
 */
router.post('/cleanup/swap/build', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  try {
    const { poolAddress: poolAddressInput } = req.body;

    console.log('DLMM cleanup swap build request received:', { poolAddress: poolAddressInput });

    // Validate poolAddress
    if (!poolAddressInput) {
      return res.status(400).json({
        error: 'Missing required field: poolAddress'
      });
    }

    let poolAddress: PublicKey;
    try {
      poolAddress = new PublicKey(poolAddressInput);
    } catch {
      return res.status(400).json({
        error: 'Invalid poolAddress: must be a valid Solana public key'
      });
    }

    // Validate pool is whitelisted
    if (!WHITELISTED_DLMM_POOLS.has(poolAddress.toBase58())) {
      return res.status(403).json({
        error: 'Pool not authorized for liquidity operations'
      });
    }

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    const JUP_API_KEY = process.env.JUP_API_KEY;
    if (!RPC_URL) {
      return res.status(500).json({
        error: 'Server configuration incomplete. Missing RPC_URL.'
      });
    }

    // Get pool-specific LP owner and manager wallet
    let LP_OWNER_PRIVATE_KEY: string;
    let MANAGER_WALLET: string;
    try {
      LP_OWNER_PRIVATE_KEY = getLpOwnerPrivateKeyForPool(poolAddress.toBase58());
      MANAGER_WALLET = getManagerWalletForPool(poolAddress.toBase58());
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Initialize connection and keypairs
    const connection = new Connection(RPC_URL, 'confirmed');
    const lpOwner = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const manager = new PublicKey(MANAGER_WALLET);

    // SAFETY CHECK: Prevent cleanup swap for restricted LP owner address
    if (lpOwner.publicKey.toBase58() === RESTRICTED_LP_OWNER) {
      return res.status(403).json({
        error: 'Cleanup swap operations are not permitted for this LP owner address'
      });
    }

    // Create DLMM instance
    console.log('Creating DLMM instance...');
    const dlmmPool = await DLMM.create(connection, poolAddress);

    const lbPair = dlmmPool.lbPair;
    const tokenXMint = lbPair.tokenXMint;
    const tokenYMint = lbPair.tokenYMint;

    // Get token mint info
    const tokenXMintInfo = await getMint(connection, tokenXMint);
    const tokenYMintInfo = await getMint(connection, tokenYMint);
    const isTokenYNativeSOL = tokenYMint.equals(NATIVE_MINT);

    console.log(`  Token X Mint: ${tokenXMint.toBase58()} (decimals: ${tokenXMintInfo.decimals})`);
    console.log(`  Token Y Mint: ${tokenYMint.toBase58()} (decimals: ${tokenYMintInfo.decimals})`);

    // Get LP owner token balances
    const lpOwnerTokenXAta = await getAssociatedTokenAddress(tokenXMint, lpOwner.publicKey);
    const lpOwnerTokenYAta = await getAssociatedTokenAddress(tokenYMint, lpOwner.publicKey);

    let tokenXBalance = new BN(0);
    let tokenYBalance = new BN(0);

    try {
      const tokenXAccount = await connection.getTokenAccountBalance(lpOwnerTokenXAta);
      tokenXBalance = new BN(tokenXAccount.value.amount);
    } catch {
      // Account doesn't exist or has 0 balance
    }

    try {
      if (isTokenYNativeSOL) {
        // For native SOL, check the account balance
        const solBalance = await connection.getBalance(lpOwner.publicKey);
        // Reserve some SOL for transaction fees (0.01 SOL)
        const reserveForFees = 10_000_000; // 0.01 SOL in lamports
        tokenYBalance = new BN(Math.max(0, solBalance - reserveForFees));
      } else {
        const tokenYAccount = await connection.getTokenAccountBalance(lpOwnerTokenYAta);
        tokenYBalance = new BN(tokenYAccount.value.amount);
      }
    } catch {
      // Account doesn't exist or has 0 balance
    }

    console.log(`  LP Owner X Balance: ${tokenXBalance.toString()}`);
    console.log(`  LP Owner Y Balance: ${tokenYBalance.toString()}`);

    // Check if there's anything to clean up
    if (tokenXBalance.isZero() && tokenYBalance.isZero()) {
      return res.status(400).json({
        error: 'No leftover tokens to clean up',
        balances: {
          tokenX: '0',
          tokenY: '0'
        }
      });
    }

    // Get user positions
    const { userPositions, activeBin } = await dlmmPool.getPositionsByUserAndLbPair(lpOwner.publicKey);

    if (userPositions.length === 0) {
      return res.status(404).json({
        error: 'No positions found for the LP owner in this pool.'
      });
    }

    const position = userPositions[0];
    const activeBinPrice = parseFloat(activeBin.pricePerToken);

    console.log(`  Position: ${position.publicKey.toBase58()}`);
    console.log(`  Active Bin Price: ${activeBinPrice}`);

    // Determine which token is in excess and needs to be swapped
    const tokenXDecimal = Number(tokenXBalance.toString()) / Math.pow(10, tokenXMintInfo.decimals);
    const tokenYDecimal = Number(tokenYBalance.toString()) / Math.pow(10, tokenYMintInfo.decimals);

    // Calculate what we'd need of each token for a balanced deposit
    // At price P (Y per X): Y = X * P
    const neededYForAllX = tokenXDecimal * activeBinPrice;
    const neededXForAllY = tokenYDecimal / activeBinPrice;

    let swapInputMint: PublicKey;
    let swapOutputMint: PublicKey;
    let swapInputAmount: BN;
    let swapDirection: 'XtoY' | 'YtoX';

    if (neededYForAllX > tokenYDecimal) {
      // We have excess X, need to swap some X for Y
      // Swap HALF the excess - heuristic to account for price impact moving toward our ratio
      const excessXDecimal = tokenXDecimal - neededXForAllY;
      const swapXDecimal = excessXDecimal / 2;
      swapInputAmount = new BN(Math.floor(swapXDecimal * Math.pow(10, tokenXMintInfo.decimals)));
      swapInputMint = tokenXMint;
      swapOutputMint = tokenYMint;
      swapDirection = 'XtoY';
      console.log(`  Swap direction: X → Y (excess: ${excessXDecimal}, swapping half: ${swapXDecimal} X)`);
    } else {
      // We have excess Y, need to swap some Y for X
      // Swap HALF the excess - heuristic to account for price impact moving toward our ratio
      const excessYDecimal = tokenYDecimal - neededYForAllX;
      const swapYDecimal = excessYDecimal / 2;
      swapInputAmount = new BN(Math.floor(swapYDecimal * Math.pow(10, tokenYMintInfo.decimals)));
      swapInputMint = tokenYMint;
      swapOutputMint = tokenXMint;
      swapDirection = 'YtoX';
      console.log(`  Swap direction: Y → X (excess: ${excessYDecimal}, swapping half: ${swapYDecimal} Y)`);
    }

    if (swapInputAmount.isZero()) {
      return res.status(400).json({
        error: 'Leftover amounts are too small to warrant cleanup',
        balances: {
          tokenX: tokenXBalance.toString(),
          tokenY: tokenYBalance.toString()
        }
      });
    }

    // Fetch Jupiter quote
    console.log('  Fetching Jupiter quote...');
    const jupiterHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (JUP_API_KEY) {
      jupiterHeaders['x-api-key'] = JUP_API_KEY;
    }

    const quoteResponse = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${swapInputMint.toBase58()}&outputMint=${swapOutputMint.toBase58()}&amount=${swapInputAmount.toString()}&slippageBps=100`,
      { headers: jupiterHeaders }
    );

    if (!quoteResponse.ok) {
      return res.status(500).json({
        error: 'Failed to fetch Jupiter quote',
        details: await quoteResponse.text()
      });
    }

    const quoteData = await quoteResponse.json();
    const expectedOutputAmount = quoteData.outAmount;

    console.log(`  Jupiter quote: ${swapInputAmount.toString()} → ${expectedOutputAmount}`);

    // Fetch Jupiter swap transaction
    const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: jupiterHeaders,
      body: JSON.stringify({
        quoteResponse: quoteData,
        userPublicKey: lpOwner.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto'
      })
    });

    if (!swapResponse.ok) {
      return res.status(500).json({
        error: 'Failed to fetch Jupiter swap transaction',
        details: await swapResponse.text()
      });
    }

    const swapData = await swapResponse.json();
    const swapTransactionBase64 = swapData.swapTransaction;

    // Decode the swap transaction
    const swapTransactionBuffer = Buffer.from(swapTransactionBase64, 'base64');
    const swapTransaction = Transaction.from(swapTransactionBuffer);

    // Set transaction properties
    const { blockhash } = await connection.getLatestBlockhash();

    // Update swap transaction with manager as fee payer
    swapTransaction.recentBlockhash = blockhash;
    swapTransaction.feePayer = manager;

    // Serialize transaction
    const unsignedSwapTx = bs58.encode(swapTransaction.serialize({ requireAllSignatures: false }));
    const swapTxHash = crypto.createHash('sha256').update(swapTransaction.serializeMessage()).digest('hex');

    // Generate request ID
    const requestId = crypto.randomBytes(16).toString('hex');

    console.log('✓ Cleanup swap transaction built successfully');
    console.log(`  Pool: ${poolAddress.toBase58()}`);
    console.log(`  Swap: ${swapInputAmount.toString()} ${swapDirection === 'XtoY' ? 'X→Y' : 'Y→X'}`);
    console.log(`  Expected output: ${expectedOutputAmount}`);
    console.log(`  Request ID: ${requestId}`);

    // Store request data
    cleanupSwapRequests.set(requestId, {
      unsignedTransaction: unsignedSwapTx,
      unsignedTransactionHash: swapTxHash,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      tokenXDecimals: tokenXMintInfo.decimals,
      tokenYDecimals: tokenYMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: manager.toBase58(),
      activeBinPrice,
      swapInputMint: swapInputMint.toBase58(),
      swapInputAmount: swapInputAmount.toString(),
      swapOutputMint: swapOutputMint.toBase58(),
      swapExpectedOutputAmount: expectedOutputAmount,
      swapDirection,
      timestamp: Date.now()
    });

    return res.json({
      success: true,
      transaction: unsignedSwapTx,
      requestId,
      poolAddress: poolAddress.toBase58(),
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      tokenXDecimals: tokenXMintInfo.decimals,
      tokenYDecimals: tokenYMintInfo.decimals,
      lpOwnerAddress: lpOwner.publicKey.toBase58(),
      managerAddress: manager.toBase58(),
      activeBinPrice,
      balances: {
        tokenX: tokenXBalance.toString(),
        tokenY: tokenYBalance.toString(),
      },
      swap: {
        inputMint: swapInputMint.toBase58(),
        inputAmount: swapInputAmount.toString(),
        outputMint: swapOutputMint.toBase58(),
        expectedOutputAmount,
        direction: swapDirection
      },
      message: 'Sign this transaction with the manager wallet and submit to /dlmm/cleanup/swap/confirm. After swap completes, call /dlmm/deposit/build with tokenXAmount=0 and tokenYAmount=0 to deposit LP owner wallet balances.'
    });

  } catch (error) {
    console.error('Error building DLMM cleanup swap transaction:', error);
    return res.status(500).json({
      error: 'Failed to build cleanup swap transaction',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// ============================================================================
// POST /dlmm/cleanup/swap/confirm - Confirm and submit swap transaction
// ============================================================================
/**
 * Cleanup swap confirm - Step 2 of cleanup process
 *
 * Security measures:
 * 1. Manager wallet signature verification
 * 2. Lock system - Prevents concurrent operations
 * 3. Request expiry - 10 minute timeout
 * 4. Transaction hash validation - Prevents tampering
 */
router.post('/cleanup/swap/confirm', dlmmLiquidityLimiter, async (req: Request, res: Response) => {
  let releaseLock: (() => void) | null = null;

  try {
    const { signedTransaction, requestId } = req.body;

    console.log('DLMM cleanup swap confirm request received:', { requestId });

    // Validate required fields
    if (!signedTransaction || !requestId) {
      return res.status(400).json({
        error: 'Missing required fields: signedTransaction and requestId'
      });
    }

    // Retrieve request data
    const requestData = cleanupSwapRequests.get(requestId);
    if (!requestData) {
      return res.status(400).json({
        error: 'Cleanup swap request not found or expired. Please call /dlmm/cleanup/swap/build first.'
      });
    }

    console.log('  Pool:', requestData.poolAddress);
    console.log('  Manager:', requestData.managerAddress);
    console.log('  LP Owner:', requestData.lpOwnerAddress);

    // Acquire lock
    releaseLock = await acquireLiquidityLock(requestData.poolAddress);
    console.log('  Lock acquired');

    // Check request age
    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - requestData.timestamp > TEN_MINUTES) {
      cleanupSwapRequests.delete(requestId);
      return res.status(400).json({
        error: 'Cleanup swap request expired. Please create a new request.'
      });
    }

    // Validate environment variables
    const RPC_URL = process.env.RPC_URL;
    let LP_OWNER_PRIVATE_KEY: string;

    try {
      LP_OWNER_PRIVATE_KEY = getLpOwnerPrivateKeyForPool(requestData.poolAddress);
    } catch (error) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Initialize connection
    const connection = new Connection(RPC_URL!, 'confirmed');
    const lpOwnerKeypair = Keypair.fromSecretKey(bs58.decode(LP_OWNER_PRIVATE_KEY));
    const managerWalletPubKey = new PublicKey(requestData.managerAddress);

    // Deserialize transaction
    let transaction: Transaction;
    try {
      const transactionBuffer = bs58.decode(signedTransaction);
      transaction = Transaction.from(transactionBuffer);
    } catch (error) {
      return res.status(400).json({
        error: `Failed to deserialize transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }

    // SECURITY: Verify manager wallet has signed
    const managerSignature = transaction.signatures.find(sig =>
      sig.publicKey.equals(managerWalletPubKey)
    );

    if (!managerSignature || !managerSignature.signature) {
      return res.status(400).json({
        error: 'Transaction verification failed: Manager wallet has not signed'
      });
    }

    // Verify manager signature is valid
    const messageData = transaction.serializeMessage();
    const managerSigValid = nacl.sign.detached.verify(
      messageData,
      managerSignature.signature,
      managerSignature.publicKey.toBytes()
    );

    if (!managerSigValid) {
      return res.status(400).json({
        error: 'Transaction verification failed: Invalid manager wallet signature'
      });
    }

    // SECURITY: Verify transaction hasn't been tampered with
    const receivedTransactionHash = crypto.createHash('sha256')
      .update(transaction.serializeMessage())
      .digest('hex');

    if (receivedTransactionHash !== requestData.unsignedTransactionHash) {
      console.log('  ⚠️  Transaction hash mismatch detected');
      return res.status(400).json({
        error: 'Transaction verification failed: transaction has been modified'
      });
    }
    console.log('  ✓ Transaction integrity verified');

    // Add LP owner signature
    transaction.partialSign(lpOwnerKeypair);

    // Send transaction
    console.log('  Sending swap transaction...');
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });

    console.log(`  ✓ Swap transaction sent: ${signature}`);

    // Wait for confirmation
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    try {
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      });
      console.log(`  ✓ Swap confirmed: ${signature}`);
    } catch (error) {
      console.error(`  ⚠ Swap confirmation timeout for ${signature}:`, error);
    }

    console.log('✓ DLMM cleanup swap completed');
    console.log(`  Signature: ${signature}`);
    console.log(`  Pool: ${requestData.poolAddress}`);

    // Clean up
    cleanupSwapRequests.delete(requestId);

    res.json({
      success: true,
      signature,
      poolAddress: requestData.poolAddress,
      tokenXMint: requestData.tokenXMint,
      tokenYMint: requestData.tokenYMint,
      swap: {
        inputMint: requestData.swapInputMint,
        inputAmount: requestData.swapInputAmount,
        outputMint: requestData.swapOutputMint,
        expectedOutputAmount: requestData.swapExpectedOutputAmount,
        direction: requestData.swapDirection
      },
      message: 'Swap transaction submitted successfully. Call /dlmm/deposit/build with tokenXAmount=0 and tokenYAmount=0 to deposit LP owner wallet balances.'
    });

  } catch (error) {
    console.error('DLMM cleanup swap confirm error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to confirm cleanup swap'
    });
  } finally {
    if (releaseLock) {
      releaseLock();
    }
  }
});

export default router;
