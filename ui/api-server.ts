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

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Connection, Keypair, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  prepareTokenLaunch,
  confirmAndRecordLaunch,
} from './lib/launchService';
import claimsRouter from './routes/claims';
import presaleRouter from './routes/presale';
import feeClaimRouter from './routes/fee-claim';
import dammLiquidityRouter from './routes/damm-liquidity';
import icoRouter from './routes/ico';

dotenv.config();

const app = express();
const PORT = process.env.API_PORT || 3001;

// In-memory storage for base mint keypairs
// Maps baseMint public key -> private key
const baseMintKeypairs = new Map<string, string>();


const limiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 16, // 16 requests per IP per window
  keyGenerator: (req) => {
    // Cloudflare sends the real client IP in the CF-Connecting-IP header
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string') return ipKeyGenerator(cfIp);
    if (Array.isArray(cfIp)) return ipKeyGenerator(cfIp[0]);
    return ipKeyGenerator(req.ip || 'unknown');
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
});

// Separate rate limiter for presale claim endpoints (more lenient)
const presaleClaimLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute (more lenient for claim operations)
  keyGenerator: (req) => {
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string') return ipKeyGenerator(cfIp);
    if (Array.isArray(cfIp)) return ipKeyGenerator(cfIp[0]);
    return ipKeyGenerator(req.ip || 'unknown');
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many claim requests, please wait a moment.'
});

// Apply CORS first (before rate limiting) to ensure headers are always sent
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Apply general rate limiter
app.use(limiter);

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: {
      hasRPC: !!process.env.RPC_URL,
      hasConfig: !!process.env.CONFIG_ADDRESS,
      hasStorage: !!process.env.DB_URL
    }
  });
});

// Mount claims routes
app.use('/claims', claimsRouter);

// Mount presale routes
app.use('/presale', presaleRouter);

// Mount fee claim routes
app.use('/fee-claim', feeClaimRouter);

// Mount DAMM liquidity routes
app.use('/damm', dammLiquidityRouter);

// Mount ICO routes
app.use('/ico', icoRouter);

// Launch token endpoint - returns unsigned transaction
app.post('/launch', async (req: Request, res: Response) => {
  try {
    const {
      name,
      symbol,
      description,
      image,
      website,
      twitter,
      caEnding,
      payerPublicKey,
      quoteToken
    } = req.body;

    // Validate required fields
    if (!name || !symbol || !payerPublicKey) {
      return res.status(400).json({
        error: 'Missing required fields: name, symbol, and payerPublicKey are required'
      });
    }

    // Validate optional fields
    if (caEnding && caEnding.length > 3) {
      return res.status(400).json({
        error: 'CA ending must be 3 characters or less'
      });
    }

    if (caEnding && /[0OIl]/.test(caEnding)) {
      return res.status(400).json({
        error: 'CA ending contains invalid Base58 characters (0, O, I, l)'
      });
    }

    // Prepare token launch (without recording to database)
    const result = await prepareTokenLaunch({
      name,
      symbol,
      description,
      image,
      website,
      twitter,
      caEnding,
      payerPublicKey,
      quoteToken: quoteToken || 'SOL'
    });

    // Store the token keypair in memory (not sent to client)
    baseMintKeypairs.set(result.baseMint, result.tokenKeypair);

    res.json({
      success: true,
      transaction: result.transaction,
      baseMint: result.baseMint,
      metadataUrl: result.metadataUrl,
      message: 'Sign this transaction and submit to /confirm-launch'
    });

  } catch (error) {
    console.error('Launch error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create launch transaction'
    });
  }
});

// Confirm launch endpoint - receives partially signed tx, adds base mint signature, sends on-chain
app.post('/confirm-launch', async (req: Request, res: Response) => {
  try {
    const {
      signedTransaction,
      baseMint,
      metadataUrl,
      name,
      symbol,
      payerPublicKey
    } = req.body;

    // Validate required fields
    if (!signedTransaction || !baseMint || !name || !symbol || !payerPublicKey) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    // Retrieve the token keypair from memory
    const tokenKeypair = baseMintKeypairs.get(baseMint);
    if (!tokenKeypair) {
      return res.status(400).json({
        error: 'Token keypair not found. Please call /launch first.'
      });
    }

    // Deserialize the partially signed transaction
    const connection = new Connection(process.env.RPC_URL!, 'confirmed');
    const transactionBuffer = bs58.decode(signedTransaction);
    const transaction = Transaction.from(transactionBuffer);

    // Add base mint keypair signature (after user has already signed)
    const baseMintKeypair = Keypair.fromSecretKey(bs58.decode(tokenKeypair));
    transaction.partialSign(baseMintKeypair);

    // Send the fully signed transaction
    const signature = await connection.sendRawTransaction(transaction.serialize());

    // Wait for confirmation and record in database
    const confirmResult = await confirmAndRecordLaunch(
      signature,
      baseMint,
      name,
      symbol,
      metadataUrl || '',
      payerPublicKey
    );

    // Clean up the keypair from memory after successful launch
    baseMintKeypairs.delete(baseMint);

    res.json({
      success: true,
      transactionSignature: signature,
      baseMint,
      metadataUrl,
      confirmation: confirmResult
    });

  } catch (error) {
    console.error('Confirm launch error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to confirm launch'
    });
  }
});

// Claims routes have been moved to routes/claims.ts

// Presale routes have been moved to routes/presale.ts

// Cache for token verification - since token existence doesn't change, cache forever
const tokenVerificationCache = new Map<string, unknown>();

// Verify token exists using Helius getAsset
app.get('/verify-token/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!address) {
      return res.status(400).json({
        error: 'Token address is required'
      });
    }

    // Check cache first
    if (tokenVerificationCache.has(address)) {
      console.log(`Token verification cache hit for ${address}`);
      return res.json(tokenVerificationCache.get(address));
    }

    const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
    if (!HELIUS_API_KEY) {
      return res.status(500).json({
        error: 'Helius API key not configured'
      });
    }

    // Call Helius getAsset API
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'getAsset',
        params: {
          id: address
        }
      })
    });

    const data = await response.json();

    let cacheEntry;

    if (data.error) {
      // Check if it's specifically a "RecordNotFound" error (asset doesn't exist)
      if (data.error.code === -32000 && data.error.message?.includes('RecordNotFound')) {
        // Asset definitively doesn't exist - cache this
        cacheEntry = {
          exists: false,
          address
        };
        tokenVerificationCache.set(address, cacheEntry);
        return res.json(cacheEntry);
      }

      // Other API error - don't cache, just return error response
      console.error('Helius API error (not caching):', data.error);
      return res.json({
        exists: false,
        address,
        error: 'API error occurred'
      });
    }

    if (data.result && data.result.id) {
      // Asset exists - cache this
      cacheEntry = {
        exists: true,
        address,
        asset: data.result
      };
      tokenVerificationCache.set(address, cacheEntry);
      return res.json(cacheEntry);
    }

    // Unexpected response format - don't cache
    console.error('Unexpected Helius response format (not caching):', data);
    return res.json({
      exists: false,
      address,
      error: 'Unexpected response format'
    });

  } catch (error) {
    console.error('Token verification error:', error);
    // Don't expose internal errors - just return not found
    res.json({
      exists: false,
      address: req.params.address
    });
  }
});

async function startServer() {
  try {
    // await initializeDatabase();
    console.log('Database initialized');

    app.listen(PORT, () => {
      console.log(`\n🚀 Token Launch API Server`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Server:  http://localhost:${PORT}`);
      console.log(`Health:  http://localhost:${PORT}/health`);
      console.log(`\nEndpoints:`);
      console.log(`  POST /launch                                - Create unsigned transaction`);
      console.log(`  POST /confirm-launch                        - Confirm partially signed transaction`);
      console.log(`  POST /fee-claim/claim                       - Build fee claim transaction for Meteora DAMM v2`);
      console.log(`  POST /fee-claim/confirm                     - Confirm fee claim transaction`);
      console.log(`  POST /damm/withdraw/build                   - Build DAMM liquidity withdrawal transaction`);
      console.log(`  POST /damm/withdraw/confirm                 - Confirm DAMM withdrawal (manager only)`);
      console.log(`  POST /damm/deposit/build                    - Build DAMM liquidity deposit transaction`);
      console.log(`  POST /damm/deposit/confirm                  - Confirm DAMM deposit (manager only)`);
      console.log(`  GET  /claims/:tokenAddress                  - Get claim eligibility info`);
      console.log(`  POST /claims/mint                           - Create unsigned mint transaction`);
      console.log(`  POST /claims/confirm                        - Confirm claim transaction`);
      console.log(`  POST /ico/create                            - Create new ICO sale`);
      console.log(`  GET  /ico/:tokenAddress                     - Get ICO sale information`);
      console.log(`  GET  /ico/:tokenAddress/purchase            - Get user purchase history`);
      console.log(`  POST /ico/:tokenAddress/purchase/prepare    - Prepare ICO purchase transaction`);
      console.log(`  POST /ico/:tokenAddress/purchase/confirm    - Confirm ICO purchase`);
      console.log(`  GET  /ico/:tokenAddress/claim               - Get user claimable balance`);
      console.log(`  POST /ico/:tokenAddress/claim/prepare       - Prepare ICO claim transaction`);
      console.log(`  POST /ico/:tokenAddress/claim/confirm       - Confirm ICO claim`);
      console.log(`  GET  /verify-token/:address                 - Verify token exists on-chain`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Only start if this file is run directly
if (require.main === module) {
  startServer();
}

export default app;
