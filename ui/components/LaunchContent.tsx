'use client';

import { WalletButton } from '@/components/WalletButton';
import { ImageUpload } from '@/components/ImageUpload';
import { useWallet } from '@/components/WalletProvider';
import { Container } from '@/components/ui/Container';
import { useState, useMemo, useRef, useEffect } from 'react';
import { Keypair, Transaction, Connection } from '@solana/web3.js';
import { useSignTransaction } from '@privy-io/react-auth/solana';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import bs58 from 'bs58';
import { GoInfo, GoPlus } from 'react-icons/go';

export function LaunchContent() {
  const { activeWallet, externalWallet } = useWallet();
  const { signTransaction } = useSignTransaction();
  const { login } = usePrivy();
  const router = useRouter();

  // Detect mobile screen size for placeholder text
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const [formData, setFormData] = useState({
    name: '',
    ticker: '',
    caEnding: '',
    image: '',
    imageFilename: '',
    website: '',
    twitter: '',
    description: '',
    creatorTwitter: '',
    creatorGithub: '',
    presale: false,
    presaleTokens: [''],
    quoteToken: 'ZC' as 'SOL' | 'ZC'
  });

  const [isLaunching, setIsLaunching] = useState(false);
  const [isGeneratingCA, setIsGeneratingCA] = useState(false);
  const [transactionSignature, setTransactionSignature] = useState<string | null>(null);
  const cancelGenerationRef = useRef(false);

  // Validation functions
  const validateName = (name: string) => {
    // Required field, max 32 characters
    return name.length > 0 && name.length <= 32;
  };

  const validateTicker = (ticker: string) => {
    // Required field, max 10 characters
    return ticker.length > 0 && ticker.length <= 10;
  };

  const validateCAEnding = (caEnding: string) => {
    // Optional field - valid if empty or up to 3 characters
    if (caEnding.length > 3) return false;

    // Check for invalid Base58 characters: 0, O, I, l
    const invalidChars = /[0OIl]/;
    return !invalidChars.test(caEnding);
  };

  const validateWebsite = (website: string) => {
    // Optional field - valid if empty or valid URL
    if (!website) return true;
    try {
      // If no protocol, try adding https://
      const urlToTest = website.match(/^https?:\/\//) ? website : `https://${website}`;
      new URL(urlToTest);
      return true;
    } catch {
      return false;
    }
  };

  const validateTwitter = (twitter: string) => {
    // Optional field - valid if empty or Twitter/X URL (profile or tweet)
    if (!twitter) return true;
    // Accept with or without protocol
    const urlToTest = twitter.match(/^https?:\/\//) ? twitter : `https://${twitter}`;
    return /^https?:\/\/(www\.)?(twitter|x)\.com\/[A-Za-z0-9_]+(\/status\/\d+)?\/?(\?.*)?$/.test(urlToTest);
  };

  const validateCreatorTwitter = (twitter: string) => {
    // Optional field - valid if empty or Twitter/X profile URL
    if (!twitter) return true;
    // Accept with or without protocol
    const urlToTest = twitter.match(/^https?:\/\//) ? twitter : `https://${twitter}`;
    return /^https?:\/\/(www\.)?(twitter|x)\.com\/[A-Za-z0-9_]+\/?(\?.*)?$/.test(urlToTest);
  };

  const validateCreatorGithub = (github: string) => {
    // Optional field - valid if empty or GitHub profile URL
    if (!github) return true;
    // Accept with or without protocol
    const urlToTest = github.match(/^https?:\/\//) ? github : `https://${github}`;
    return /^https?:\/\/(www\.)?github\.com\/[A-Za-z0-9-]+\/?$/.test(urlToTest);
  };

  const validateDescription = (description: string) => {
    // Optional field - valid if empty or under 280 characters
    return description.length <= 280;
  };

  const validateSolanaAddress = (address: string) => {
    // Optional field - valid if empty
    if (!address) return true;
    // Check if it's a valid base58 address (typically 32-44 characters)
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(address);
  };

  // Track field validity
  const fieldValidity = useMemo(() => ({
    name: validateName(formData.name),
    ticker: validateTicker(formData.ticker),
    caEnding: validateCAEnding(formData.caEnding),
    website: validateWebsite(formData.website),
    twitter: validateTwitter(formData.twitter),
    description: validateDescription(formData.description),
    image: !!formData.image,
    creatorTwitter: validateCreatorTwitter(formData.creatorTwitter),
    creatorGithub: validateCreatorGithub(formData.creatorGithub),
    presaleTokens: !formData.presale || formData.presaleTokens.every(t => validateSolanaAddress(t))
  }), [formData]);

  // Check if form is valid (only name, ticker, image are required)
  const isFormValid = useMemo(() => {
    return fieldValidity.name &&
           fieldValidity.ticker &&
           fieldValidity.caEnding &&
           fieldValidity.website &&
           fieldValidity.twitter &&
           fieldValidity.description &&
           fieldValidity.image &&
           fieldValidity.creatorTwitter &&
           fieldValidity.creatorGithub &&
           fieldValidity.presaleTokens;
  }, [fieldValidity]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleAddPresaleToken = () => {
    if (formData.presaleTokens.length < 5) {
      setFormData(prev => ({
        ...prev,
        presaleTokens: [...prev.presaleTokens, '']
      }));
    }
  };

  const handleRemovePresaleToken = (index: number) => {
    setFormData(prev => {
      const newTokens = prev.presaleTokens.filter((_, i) => i !== index);
      return {
        ...prev,
        presaleTokens: newTokens.length === 0 ? [''] : newTokens
      };
    });
  };

  const handlePresaleTokenChange = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      presaleTokens: prev.presaleTokens.map((token, i) => i === index ? value : token)
    }));
  };


  const generateTokenKeypair = async (caEnding?: string) => {
    // Generate keypair with optional custom ending

    if (!caEnding) {
      // Generate a simple keypair if no CA ending specified
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toString();
      // Simple keypair generated successfully
      return { keypair, address };
    }

    // Searching for keypair with custom ending

    // Generate keypairs until we find one ending with the specified CA ending
    let keypair: Keypair;
    let attempts = 0;
    const maxAttempts = 10000000; // Limit attempts to prevent infinite loop

    do {
      // Check for cancellation
      if (cancelGenerationRef.current) {
        // Generation cancelled by user
        throw new Error('Generation cancelled');
      }

      keypair = Keypair.generate();
      attempts++;

      // Update progress every 10000 attempts
      if (attempts % 10000 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    } while (!keypair.publicKey.toString().endsWith(caEnding) && attempts < maxAttempts && !cancelGenerationRef.current);

    // Check if cancelled after the loop
    if (cancelGenerationRef.current) {
      // Generation cancelled by user after loop
      throw new Error('Generation cancelled');
    }

    const finalAddress = keypair.publicKey.toString();
    // Found matching keypair successfully

    return { keypair, address: finalAddress };
  };

  const handleCancel = () => {
    // Cancel button clicked
    cancelGenerationRef.current = true;
  };

  const handleLaunch = async () => {
    if (!isFormValid || isLaunching || isGeneratingCA || !externalWallet || !activeWallet) return;

    cancelGenerationRef.current = false; // Reset cancel flag

    try {
      // For presales, we don't generate the keypair here
      let keypair: Keypair | null = null;

      if (!formData.presale) {
        // Only generate keypair for non-presale launches
        const hasCAEnding = formData.caEnding && formData.caEnding.length > 0;

        if (hasCAEnding) {
          setIsGeneratingCA(true);
        }

        const result = await generateTokenKeypair(hasCAEnding ? formData.caEnding : undefined);
        keypair = result.keypair;

        if (hasCAEnding) {
          setIsGeneratingCA(false);
        }
      }

      setIsLaunching(true);

      // Step 1: Upload metadata
      const metadata = {
        name: formData.name,
        symbol: formData.ticker,
        description: formData.description || undefined,
        image: formData.image || undefined,
        website: formData.website ? (formData.website.match(/^https?:\/\//) ? formData.website : `https://${formData.website}`) : undefined,
        twitter: formData.twitter ? (formData.twitter.match(/^https?:\/\//) ? formData.twitter : `https://${formData.twitter}`) : undefined,
        caEnding: formData.caEnding || undefined,
        creatorTwitter: formData.creatorTwitter ? (formData.creatorTwitter.match(/^https?:\/\//) ? formData.creatorTwitter : `https://${formData.creatorTwitter}`) : undefined,
        creatorGithub: formData.creatorGithub ? (formData.creatorGithub.match(/^https?:\/\//) ? formData.creatorGithub : `https://${formData.creatorGithub}`) : undefined,
      };

      const metadataResponse = await fetch('/api/upload-metadata', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
      });

      const metadataData = await metadataResponse.json();

      if (!metadataResponse.ok) {
        throw new Error(metadataData.error || 'Metadata upload failed');
      }

      // Step 2: Check if presale - if so, create presale record and redirect
      if (formData.presale) {
        const presaleResponse = await fetch('/api/presale', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: formData.name,
            symbol: formData.ticker,
            uri: metadataData.url,
            creatorWallet: externalWallet.toString(),
            presaleTokens: formData.presaleTokens.filter(t => t.trim()),
            caEnding: formData.caEnding || undefined,
            creatorTwitter: formData.creatorTwitter ? (formData.creatorTwitter.match(/^https?:\/\//) ? formData.creatorTwitter : `https://${formData.creatorTwitter}`) : undefined,
            creatorGithub: formData.creatorGithub ? (formData.creatorGithub.match(/^https?:\/\//) ? formData.creatorGithub : `https://${formData.creatorGithub}`) : undefined,
          }),
        });

        const presaleData = await presaleResponse.json();

        if (!presaleResponse.ok) {
          throw new Error(presaleData.error || 'Presale creation failed');
        }

        // Redirect to presale page
        router.push(`/presale/${presaleData.tokenAddress}`);
        return;
      }

      // Step 2: Create launch transaction (for normal launches)
      if (!keypair) {
        throw new Error('Keypair not generated for normal launch');
      }

      const launchResponse = await fetch('/api/launch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          baseMintPublicKey: keypair.publicKey.toString(),
          name: formData.name,
          symbol: formData.ticker,
          uri: metadataData.url,
          payerPublicKey: externalWallet.toString(),
          quoteToken: formData.quoteToken,
        }),
      });

      const launchData = await launchResponse.json();

      if (!launchResponse.ok) {
        throw new Error(launchData.error || 'Transaction creation failed');
      }

      // Step 3: Sign transaction following Phantom's recommended order
      // Per Phantom docs: wallet signs first, then additional signers
      const transactionBuffer = bs58.decode(launchData.transaction);
      const transaction = Transaction.from(transactionBuffer);

      // 1. Phantom wallet signs first (user is fee payer)
      const serializedTransaction = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });

      const { signedTransaction: signedTxBytes } = await signTransaction({
        transaction: serializedTransaction,
        wallet: activeWallet!
      });

      const walletSignedTx = Transaction.from(signedTxBytes);

      // 2. Additional signer (base mint keypair) signs after
      walletSignedTx.partialSign(keypair);

      // 3. Send the fully signed transaction
      const connection = new Connection(process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com');
      const signature = await connection.sendRawTransaction(
        walletSignedTx.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        }
      );

      const signedTransaction = { signature };

      setTransactionSignature(signedTransaction.signature);
      // Transaction sent successfully

      // Step 4: Confirm transaction and record in database
      const confirmResponse = await fetch('/api/launch/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionSignature: signedTransaction.signature,
          baseMint: launchData.baseMint,
          name: formData.name,
          symbol: formData.ticker,
          uri: metadataData.url,
          creatorWallet: externalWallet.toString(),
          creatorTwitter: formData.creatorTwitter || undefined,
          creatorGithub: formData.creatorGithub || undefined,
        }),
      });

      await confirmResponse.json();

      if (!confirmResponse.ok) {
        // Failed to confirm launch
      } else {
        // Launch confirmed and recorded in database
      }

    } catch (error) {
      // Launch error occurred
      if (error instanceof Error && error.message === 'Generation cancelled') {
        // Launch cancelled - no metadata will be uploaded
      } else {
        alert(`Failed to launch token: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } finally {
      setIsLaunching(false);
      setIsGeneratingCA(false);
      cancelGenerationRef.current = false;
    }
  };

  return (
    <Container>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 style={{ color: 'var(--foreground)' }}>Launch Token</h1>
          <p className="text-lg mt-2" style={{ color: 'var(--foreground-secondary)' }}>
            Launch a ZC token for your project here.
          </p>
        </div>

        {/* Main token info */}
        <div className="mb-6">
          <h3 style={{ color: 'var(--foreground)' }}>Main Token Info</h3>
        </div>

      <div className="space-y-6">
          {/* Token Image */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              Icon Image *
            </label>
            <ImageUpload
              onImageUpload={(url, filename) => setFormData(prev => ({ ...prev, image: url, imageFilename: filename || '' }))}
              currentImage={formData.image}
              name={formData.name || 'token'}
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              Token Name *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              placeholder="Enter token name"
              maxLength={32}
              autoComplete="off"
              className="w-full px-4 py-2 rounded-lg border transition-colors"
              style={{
                backgroundColor: 'var(--background)',
                borderColor: formData.name && !fieldValidity.name ? '#ef4444' : 'var(--border)',
                color: 'var(--foreground)'
              }}
            />
            {formData.name && !fieldValidity.name && (
              <p className="text-sm mt-1" style={{ color: '#ef4444' }}>Maximum 32 characters</p>
            )}
          </div>

          {/* Ticker */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              Ticker Symbol *
            </label>
            <input
              type="text"
              name="ticker"
              value={formData.ticker}
              onChange={handleInputChange}
              placeholder="Enter ticker symbol"
              maxLength={10}
              autoComplete="off"
              className="w-full px-4 py-2 rounded-lg border transition-colors"
              style={{
                backgroundColor: 'var(--background)',
                borderColor: formData.ticker && !fieldValidity.ticker ? '#ef4444' : 'var(--border)',
                color: 'var(--foreground)'
              }}
            />
            {formData.ticker && !fieldValidity.ticker && (
              <p className="text-sm mt-1" style={{ color: '#ef4444' }}>Maximum 10 characters</p>
            )}
          </div>

          {/* Website */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              Website
            </label>
            <input
              type="url"
              name="website"
              value={formData.website}
              onChange={handleInputChange}
              placeholder="https://yourproject.com"
              autoComplete="off"
              className="w-full px-4 py-2 rounded-lg border transition-colors"
              style={{
                backgroundColor: 'var(--background)',
                borderColor: formData.website && !fieldValidity.website ? '#ef4444' : 'var(--border)',
                color: 'var(--foreground)'
              }}
            />
            {formData.website && !fieldValidity.website && (
              <p className="text-sm mt-1" style={{ color: '#ef4444' }}>Please enter a valid URL</p>
            )}
          </div>

          {/* Twitter/X */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              X/Twitter Profile
            </label>
            <input
              type="text"
              name="twitter"
              value={formData.twitter}
              onChange={handleInputChange}
              placeholder="https://x.com/yourproject"
              autoComplete="off"
              className="w-full px-4 py-2 rounded-lg border transition-colors"
              style={{
                backgroundColor: 'var(--background)',
                borderColor: formData.twitter && !fieldValidity.twitter ? '#ef4444' : 'var(--border)',
                color: 'var(--foreground)'
              }}
            />
            {formData.twitter && !fieldValidity.twitter && (
              <p className="text-sm mt-1" style={{ color: '#ef4444' }}>Please enter a valid X/Twitter profile URL</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              Description
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              placeholder="Enter project description (max 280 characters)"
              maxLength={280}
              autoComplete="off"
              rows={3}
              className="w-full px-4 py-2 rounded-lg border transition-colors resize-none"
              style={{
                backgroundColor: 'var(--background)',
                borderColor: formData.description && !fieldValidity.description ? '#ef4444' : 'var(--border)',
                color: 'var(--foreground)'
              }}
            />
            <p className="text-sm mt-1" style={{ color: 'var(--foreground-secondary)' }}>
              {formData.description.length}/280 characters
            </p>
          </div>
        </div>

        {/* Advanced token settings */}
        <div className="mt-8 mb-6">
          <h3 style={{ color: 'var(--foreground)' }}>Advanced Token Settings</h3>
        </div>

        <div className="space-y-6">

          {/* CA Ending */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              Custom CA Ending (Optional)
            </label>
            <input
              type="text"
              name="caEnding"
              value={formData.caEnding}
              onChange={handleInputChange}
              placeholder="Enter desired CA ending (max 3 characters)"
              maxLength={3}
              autoComplete="off"
              className="w-full px-4 py-2 rounded-lg border transition-colors"
              style={{
                backgroundColor: 'var(--background)',
                borderColor: formData.caEnding && !fieldValidity.caEnding ? '#ef4444' : 'var(--border)',
                color: 'var(--foreground)'
              }}
            />
            {formData.caEnding && !fieldValidity.caEnding && (
              <p className="text-sm mt-1" style={{ color: '#ef4444' }}>Invalid characters. Avoid 0, O, I, l</p>
            )}
          </div>

          {/* Token Pairing */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                Token Pairing
              </label>
              <div className="relative group">
                <GoInfo className="w-4 h-4 cursor-help" style={{ color: 'var(--foreground-secondary)' }} />
                <div className="absolute left-6 top-0 w-80 p-3 text-sm opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10 pointer-events-none rounded-lg" style={{ backgroundColor: 'var(--background-secondary)', color: 'var(--foreground)', border: '1px solid var(--border)' }}>
                  Choose the quote token for your trading pair. Your token will be paired with either ZC or SOL.
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, quoteToken: 'ZC' }))}
                className="flex-1 px-4 py-2 rounded-lg border transition-colors"
                style={{
                  backgroundColor: formData.quoteToken === 'ZC' ? 'var(--accent)' : 'var(--background)',
                  borderColor: formData.quoteToken === 'ZC' ? 'var(--accent)' : 'var(--border)',
                  color: formData.quoteToken === 'ZC' ? '#FFFFFF' : 'var(--foreground)'
                }}
              >
                ZC
              </button>
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, quoteToken: 'SOL' }))}
                className="flex-1 px-4 py-2 rounded-lg border transition-colors"
                style={{
                  backgroundColor: formData.quoteToken === 'SOL' ? 'var(--accent)' : 'var(--background)',
                  borderColor: formData.quoteToken === 'SOL' ? 'var(--accent)' : 'var(--border)',
                  color: formData.quoteToken === 'SOL' ? '#FFFFFF' : 'var(--foreground)'
                }}
              >
                SOL
              </button>
            </div>
          </div>

          {/* Presale */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                Presale
              </label>
              <div className="relative group">
                <GoInfo className="w-4 h-4 cursor-help" style={{ color: 'var(--foreground-secondary)' }} />
                <div className="absolute left-6 top-0 w-80 p-3 text-sm opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10 pointer-events-none rounded-lg" style={{ backgroundColor: 'var(--background-secondary)', color: 'var(--foreground)', border: '1px solid var(--border)' }}>
                  Enable presale mode. Only buyers holding the specified tokens will be allowed to buy in the presale round. The size of their buys will be proportional to holdings.
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, presale: false }))}
                className="flex-1 px-4 py-2 rounded-lg border transition-colors"
                style={{
                  backgroundColor: !formData.presale ? 'var(--accent)' : 'var(--background)',
                  borderColor: !formData.presale ? 'var(--accent)' : 'var(--border)',
                  color: !formData.presale ? '#FFFFFF' : 'var(--foreground)'
                }}
              >
                Disabled
              </button>
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, presale: true }))}
                className="flex-1 px-4 py-2 rounded-lg border transition-colors"
                style={{
                  backgroundColor: formData.presale ? 'var(--accent)' : 'var(--background)',
                  borderColor: formData.presale ? 'var(--accent)' : 'var(--border)',
                  color: formData.presale ? '#FFFFFF' : 'var(--foreground)'
                }}
              >
                Enabled
              </button>
            </div>
          </div>

          {/* Presale Whitelist */}
          {formData.presale && (
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                Presale Whitelist Token Addresses
              </label>
              <div className="space-y-3">
                {formData.presaleTokens.map((token, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={token}
                      onChange={(e) => handlePresaleTokenChange(index, e.target.value)}
                      placeholder="Enter token contract address"
                      autoComplete="off"
                      className="flex-1 px-4 py-2 rounded-lg border transition-colors"
                      style={{
                        backgroundColor: 'var(--background)',
                        borderColor: token && !validateSolanaAddress(token) ? '#ef4444' : 'var(--border)',
                        color: 'var(--foreground)'
                      }}
                    />
                    {(formData.presaleTokens.length > 1 || (formData.presaleTokens.length === 1 && token.trim())) && (
                      <button
                        type="button"
                        onClick={() => handleRemovePresaleToken(index)}
                        className="px-3 py-2 rounded-lg border transition-colors"
                        style={{
                          borderColor: 'var(--border)',
                          color: 'var(--foreground-secondary)'
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {formData.presaleTokens.length < 5 && (
                  <button
                    type="button"
                    onClick={handleAddPresaleToken}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors"
                    style={{
                      borderColor: 'var(--border)',
                      color: 'var(--foreground)'
                    }}
                  >
                    <GoPlus className="w-4 h-4" />
                    Add Token
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Creator Designation */}
        <div className="mt-8 mb-6">
          <h3 style={{ color: 'var(--foreground)' }}>Launching for Someone Else?</h3>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              Developer X/Twitter Profile
            </label>
            <input
              type="text"
              name="creatorTwitter"
              value={formData.creatorTwitter}
              onChange={handleInputChange}
              placeholder="https://x.com/developer"
              autoComplete="off"
              className="w-full px-4 py-2 rounded-lg border transition-colors"
              style={{
                backgroundColor: 'var(--background)',
                borderColor: formData.creatorTwitter && !fieldValidity.creatorTwitter ? '#ef4444' : 'var(--border)',
                color: 'var(--foreground)'
              }}
            />
            {formData.creatorTwitter && !fieldValidity.creatorTwitter && (
              <p className="text-sm mt-1" style={{ color: '#ef4444' }}>Please enter a valid X/Twitter profile URL</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              Developer GitHub Profile
            </label>
            <input
              type="text"
              name="creatorGithub"
              value={formData.creatorGithub}
              onChange={handleInputChange}
              placeholder="https://github.com/developer"
              autoComplete="off"
              className="w-full px-4 py-2 rounded-lg border transition-colors"
              style={{
                backgroundColor: 'var(--background)',
                borderColor: formData.creatorGithub && !fieldValidity.creatorGithub ? '#ef4444' : 'var(--border)',
                color: 'var(--foreground)'
              }}
            />
            {formData.creatorGithub && !fieldValidity.creatorGithub && (
              <p className="text-sm mt-1" style={{ color: '#ef4444' }}>Please enter a valid GitHub profile URL</p>
            )}
          </div>
        </div>

        {/* Launch Button */}
        <div className="flex items-center gap-4 mt-8">
          {externalWallet ? (
            <>
              <button
                onClick={handleLaunch}
                disabled={!isFormValid || isLaunching || isGeneratingCA}
                className="px-6 py-3 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: '#FFFFFF'
                }}
              >
                {isGeneratingCA
                  ? 'Generating CA...'
                  : isLaunching
                  ? 'Launching...'
                  : isPresale ? 'Launch Presale' : 'Launch Token'}
              </button>
              {isGeneratingCA && (
                <button
                  onClick={handleCancel}
                  className="px-6 py-3 rounded-lg font-medium border transition-colors"
                  style={{
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)'
                  }}
                >
                  Cancel
                </button>
              )}
            </>
          ) : (
            <button
              onClick={login}
              className="px-6 py-3 rounded-lg font-medium transition-all"
              style={{
                backgroundColor: 'var(--accent)',
                color: '#FFFFFF'
              }}
            >
              Connect Wallet to Launch
            </button>
          )}
        </div>

        {/* Success Message */}
        {transactionSignature && (
          <div className="mt-6">
            <p className="text-lg" style={{ color: '#10b981' }}>
              Success!{' '}
              <a
                href={`https://solscan.io/tx/${transactionSignature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:opacity-80"
              >
                Transaction
              </a>
            </p>
          </div>
        )}
      </div>
    </Container>
  );
}
