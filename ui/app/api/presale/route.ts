import { NextRequest, NextResponse } from 'next/server';
import { createPresale, getPresalesByCreatorWallet } from '@/lib/db';
import { generateEscrowKeypair } from '@/lib/presale-escrow';
import { isInMockMode, MOCK_PRESALES } from '@/lib/mock';
import {
  isValidSolanaAddress,
  isValidTokenMintAddress,
  validateTokenMetadata,
  validateSocialHandle,
  sanitizeString
} from '@/lib/validation';
import { generateTokenKeypair } from '@/lib/launchService';
import { encrypt } from '@/lib/crypto';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';

interface PresaleRequest {
  tokenAddress: string;
  name: string;
  symbol: string;
  uri: string;
  creatorWallet: string;
  presaleTokens?: string[];
  caEnding?: string;
  creatorTwitter?: string;
  creatorGithub?: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const creatorWallet = searchParams.get('creator');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    if (!creatorWallet) {
      return NextResponse.json(
        { error: 'Creator wallet parameter is required' },
        { status: 400 }
      );
    }

    let presales = await getPresalesByCreatorWallet(creatorWallet, limit);

    // In mock mode, if no presales found for this wallet, return all mock presales for demo purposes
    if (isInMockMode() && presales.length === 0 && creatorWallet) {
      console.log('📦 Mock Mode: Showing all sample presales for demo purposes');
      presales = MOCK_PRESALES.map(presale => ({
        ...presale,
        isDemoData: true,
      } as any));
    }

    // Remove sensitive fields before sending to client
    const sanitizedPresales = presales.map(presale => {
      const { escrow_priv_key, base_mint_priv_key, ...publicPresale } = presale;
      return publicPresale;
    });

    return NextResponse.json({
      presales: sanitizedPresales,
      count: sanitizedPresales.length,
      isDemoMode: isInMockMode() && presales.some((p: any) => p.isDemoData)
    });

  } catch (error) {
    console.error('Error fetching presales:', error);
    return NextResponse.json(
      { error: 'Failed to fetch presales' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const {
      name,
      symbol,
      uri,
      creatorWallet,
      presaleTokens,
      caEnding,
      creatorTwitter,
      creatorGithub
    }: PresaleRequest = await request.json();

    // Validate required parameters
    if (!name || !symbol || !uri || !creatorWallet) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    if (!isValidSolanaAddress(creatorWallet)) {
      return NextResponse.json(
        { error: 'Invalid creator wallet address format' },
        { status: 400 }
      );
    }

    // Validate token metadata
    const metadataValidation = validateTokenMetadata({ name, symbol, uri });
    if (!metadataValidation.valid) {
      return NextResponse.json(
        { error: metadataValidation.errors.join(', ') },
        { status: 400 }
      );
    }

    // Validate and sanitize social handles
    if (creatorTwitter && !validateSocialHandle(creatorTwitter, 'twitter')) {
      return NextResponse.json(
        { error: 'Invalid Twitter handle format' },
        { status: 400 }
      );
    }

    if (creatorGithub && !validateSocialHandle(creatorGithub, 'github')) {
      return NextResponse.json(
        { error: 'Invalid GitHub username format' },
        { status: 400 }
      );
    }

    // Validate presale tokens if provided
    if (presaleTokens && Array.isArray(presaleTokens)) {
      for (const token of presaleTokens) {
        if (token && !isValidTokenMintAddress(token)) {
          return NextResponse.json(
            { error: `Invalid presale token address: ${token}` },
            { status: 400 }
          );
        }
      }
    }

    // Validate CA ending if provided
    if (caEnding) {
      if (caEnding.length > 3) {
        return NextResponse.json(
          { error: 'CA ending must be 1-3 characters' },
          { status: 400 }
        );
      }
      // Check for invalid Base58 characters: 0, O, I, l
      const invalidChars = /[0OIl]/;
      if (invalidChars.test(caEnding)) {
        return NextResponse.json(
          { error: 'CA ending contains invalid characters (0, O, I, l are not allowed in Base58)' },
          { status: 400 }
        );
      }
    }

    // Sanitize strings before database insertion
    const sanitizedName = sanitizeString(name, 32);
    const sanitizedSymbol = sanitizeString(symbol, 10);

    // Generate escrow keypair for the presale
    const { publicKey, encryptedPrivateKey } = generateEscrowKeypair();
    const baseMintKeypair = await generateTokenKeypair(caEnding);

    const presale = await createPresale({
      token_address: baseMintKeypair.publicKey.toString(),
      base_mint_priv_key: encrypt(bs58.encode(baseMintKeypair.secretKey)),
      creator_wallet: creatorWallet,
      token_name: sanitizedName,
      token_symbol: sanitizedSymbol,
      token_metadata_url: uri,
      presale_tokens: presaleTokens?.filter(t => t.trim()) || [],
      ca_ending: caEnding || undefined,
      creator_twitter: creatorTwitter ? sanitizeString(creatorTwitter, 15) : undefined,
      creator_github: creatorGithub ? sanitizeString(creatorGithub, 39) : undefined,
      escrow_pub_key: publicKey,
      escrow_priv_key: encryptedPrivateKey
    });

    return NextResponse.json({
      success: true,
      tokenAddress: presale.token_address,
      escrowPublicKey: publicKey
    });

  } catch (error) {
    console.error('Presale creation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create presale' },
      { status: 500 }
    );
  }
}
