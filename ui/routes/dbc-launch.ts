import { Router, Request, Response } from 'express';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from '@solana/spl-token';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { getProtocolKeypair } from '../lib/keyService';
import { uploadMetadataToPinata } from '../lib/launchService';
import { isValidSolanaAddress } from '../lib/validation';

const router = Router();

const DEFAULT_DBC_CONFIG = '5qQDkwGzMAeiAeX8SR7kj6BTyGQRSuZcWva591CrydDj';
const TOKEN_DECIMALS = 6;
const DEFAULT_MINT_AMOUNT = 100_000_000; // 100M tokens

const dbcLaunchLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => {
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string') return ipKeyGenerator(cfIp);
    if (Array.isArray(cfIp)) return ipKeyGenerator(cfIp[0]);
    return ipKeyGenerator(req.ip || 'unknown');
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many launch requests, please try again later.',
});

function validateApiKey(req: Request, res: Response): boolean {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.DBC_LAUNCH_API_KEY;

  if (!expectedKey) {
    res.status(500).json({ error: 'DBC_LAUNCH_API_KEY not configured' });
    return false;
  }

  if (!apiKey || apiKey !== expectedKey) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return false;
  }

  return true;
}

router.post('/', dbcLaunchLimiter, async (req: Request, res: Response) => {
  if (!validateApiKey(req, res)) return;

  try {
    const { name, symbol, uri, image, description, recipientWallet } = req.body;

    if (!name || !symbol) {
      return res.status(400).json({ error: 'name and symbol are required' });
    }

    if (!uri && !image) {
      return res.status(400).json({ error: 'uri or image is required' });
    }

    if (recipientWallet && !isValidSolanaAddress(recipientWallet)) {
      return res.status(400).json({ error: 'Invalid recipientWallet address' });
    }

    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) {
      return res.status(500).json({ error: 'RPC_URL not configured' });
    }

    const configAddress = process.env.DBC_CONFIG || DEFAULT_DBC_CONFIG;

    // Resolve metadata URI
    let metadataUrl: string;
    if (uri) {
      metadataUrl = uri;
    } else {
      metadataUrl = await uploadMetadataToPinata({
        name,
        symbol,
        description: description || '',
        image,
      });
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const protocolKeypair = getProtocolKeypair();
    const client = new DynamicBondingCurveClient(connection, 'confirmed');
    const baseMintKeypair = Keypair.generate();

    const tx = await client.pool.createPool({
      baseMint: baseMintKeypair.publicKey,
      config: new PublicKey(configAddress),
      name,
      symbol,
      uri: metadataUrl,
      payer: protocolKeypair.publicKey,
      poolCreator: protocolKeypair.publicKey,
    });

    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [protocolKeypair, baseMintKeypair],
      { commitment: 'confirmed' },
    );

    console.log(`[DBC Launch] Token: ${baseMintKeypair.publicKey.toBase58()}, Tx: ${signature}`);

    // Mint tokens to recipient if specified
    let mintSignature: string | undefined;
    if (recipientWallet) {
      const recipient = new PublicKey(recipientWallet);
      const mintAmount = BigInt(DEFAULT_MINT_AMOUNT) * BigInt(10 ** TOKEN_DECIMALS);

      const ata = await getAssociatedTokenAddress(
        baseMintKeypair.publicKey,
        recipient,
      );

      const mintTx = new Transaction();

      // Create ATA if it doesn't exist
      const ataInfo = await connection.getAccountInfo(ata);
      if (!ataInfo) {
        mintTx.add(
          createAssociatedTokenAccountInstruction(
            protocolKeypair.publicKey,
            ata,
            recipient,
            baseMintKeypair.publicKey,
          ),
        );
      }

      mintTx.add(
        createMintToInstruction(
          baseMintKeypair.publicKey,
          ata,
          protocolKeypair.publicKey, // mint authority
          mintAmount,
        ),
      );

      mintSignature = await sendAndConfirmTransaction(
        connection,
        mintTx,
        [protocolKeypair],
        { commitment: 'confirmed' },
      );

      console.log(`[DBC Launch] Minted ${DEFAULT_MINT_AMOUNT.toLocaleString()} to ${recipientWallet}, Tx: ${mintSignature}`);
    }

    res.json({
      success: true,
      tokenMint: baseMintKeypair.publicKey.toBase58(),
      config: configAddress,
      signature,
      mintSignature,
      metadataUrl,
    });
  } catch (error) {
    console.error('[DBC Launch] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to launch token',
    });
  }
});

export default router;
