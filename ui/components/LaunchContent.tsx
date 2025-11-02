'use client';

import { WalletButton } from '@/components/WalletButton';
import { ImageUpload } from '@/components/ImageUpload';
import { useWallet } from '@/components/WalletProvider';
import { useState, useMemo, useRef, useEffect } from 'react';
import { Keypair, Transaction, Connection } from '@solana/web3.js';
import { useSignTransaction } from '@privy-io/react-auth/solana';
import { useRouter } from 'next/navigation';
import bs58 from 'bs58';
import { GoInfo, GoPlus } from 'react-icons/go';

export function LaunchContent() {
  const { activeWallet, externalWallet } = useWallet();
  const { signTransaction } = useSignTransaction();
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
    <div style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
      <h1 className="text-7xl font-bold">Launch</h1>

      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Launch a ZC token for your project here.</p>

      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Main token info</p>

      <div className="mt-1">
          {/* Token Image */}
          <div className="text-[14px]" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="text-gray-300">Icon Image*: </span>
            <span className="text-gray-500">{'{'}</span>
            <ImageUpload
              onImageUpload={(url, filename) => setFormData(prev => ({ ...prev, image: url, imageFilename: filename || '' }))}
              currentImage={formData.image}
              name={formData.name || 'token'}
            />
            <span className="text-gray-500">{'}'}</span>
          </div>

          <div className="text-[14px] mt-0.5" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="text-gray-300">Name*: </span>
            <span className="text-gray-500">{'{'}</span>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              placeholder={isMobile ? "Enter here" : "Enter token name here"}
              maxLength={32}
              autoComplete="off"
              className={`bg-transparent border-0 focus:outline-none placeholder:text-gray-500 ${
                formData.name && !fieldValidity.name
                  ? 'text-red-400'
                  : 'text-[#b2e9fe]'
              }`}
              style={{
                fontFamily: 'Monaco, Menlo, "Courier New", monospace',
                width: formData.name ? `${formData.name.length}ch` : (isMobile ? '10ch' : '21ch')
              }}
            />
            <span className="text-gray-500">{'}'}</span>
          </div>

          <div className="text-[14px] mt-0.5" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="text-gray-300">Ticker*: </span>
            <span className="text-gray-500">{'{'}</span>
            <input
              type="text"
              name="ticker"
              value={formData.ticker}
              onChange={handleInputChange}
              placeholder={isMobile ? "Enter here" : "Enter ticker here"}
              maxLength={10}
              autoComplete="off"
              className={`bg-transparent border-0 focus:outline-none placeholder:text-gray-500 ${
                formData.ticker && !fieldValidity.ticker
                  ? 'text-red-400'
                  : 'text-[#b2e9fe]'
              }`}
              style={{
                fontFamily: 'Monaco, Menlo, "Courier New", monospace',
                width: formData.ticker ? `${formData.ticker.length}ch` : (isMobile ? '10ch' : '17ch')
              }}
            />
            <span className="text-gray-500">{'}'}</span>
          </div>

          {/* Website and Twitter */}
          <div className="text-[14px] mt-1" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="text-gray-300">Website: </span>
            <span className="text-gray-500">{'{'}</span>
            <input
              type="url"
              name="website"
              value={formData.website}
              onChange={handleInputChange}
              placeholder={isMobile ? "Enter here" : "Enter project website URL here"}
              autoComplete="off"
              className={`bg-transparent border-0 focus:outline-none placeholder:text-gray-500 ${
                formData.website && !fieldValidity.website
                  ? 'text-red-400'
                  : 'text-[#b2e9fe]'
              }`}
              style={{
                fontFamily: 'Monaco, Menlo, "Courier New", monospace',
                width: formData.website ? `${formData.website.length}ch` : (isMobile ? '10ch' : '30ch')
              }}
            />
            <span className="text-gray-500">{'}'}</span>
          </div>

          <div className="text-[14px] mt-0.5" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="text-gray-300">X URL: </span>
            <span className="text-gray-500">{'{'}</span>
            <input
              type="text"
              name="twitter"
              value={formData.twitter}
              onChange={handleInputChange}
              placeholder={isMobile ? "Enter here" : "Enter X profile URL here"}
              autoComplete="off"
              className={`bg-transparent border-0 focus:outline-none placeholder:text-gray-500 ${
                formData.twitter && !fieldValidity.twitter
                  ? 'text-red-400'
                  : 'text-[#b2e9fe]'
              }`}
              style={{
                fontFamily: 'Monaco, Menlo, "Courier New", monospace',
                width: formData.twitter ? `${formData.twitter.length}ch` : (isMobile ? '10ch' : '24ch')
              }}
            />
            <span className="text-gray-500">{'}'}</span>
          </div>

          {/* Description */}
          <div className="text-[14px] mt-0.5" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="text-gray-300">Description: </span>
            <span className="text-gray-500">{'{'}</span>
            <input
              type="text"
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              placeholder={isMobile ? "Enter here" : "Enter project description here"}
              maxLength={280}
              autoComplete="off"
              className={`bg-transparent border-0 focus:outline-none placeholder:text-gray-500 ${
                formData.description && !fieldValidity.description
                  ? 'text-red-400'
                  : 'text-[#b2e9fe]'
              }`}
              style={{
                fontFamily: 'Monaco, Menlo, "Courier New", monospace',
                width: formData.description ? `${formData.description.length}ch` : (isMobile ? '10ch' : '30ch')
              }}
            />
            <span className="text-gray-500">{'}'}</span>
          </div>

          <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Advanced token settings</p>

          {/* CA Ending */}
          <div className="text-[14px] mt-1" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="text-gray-300">CA Ending: </span>
            <span className="text-gray-500">{'{'}</span>
            <input
              type="text"
              name="caEnding"
              value={formData.caEnding}
              onChange={handleInputChange}
              placeholder={isMobile ? "Enter here" : "Enter desired CA ending here"}
              maxLength={3}
              autoComplete="off"
              className={`bg-transparent border-0 focus:outline-none placeholder:text-gray-500 ${
                formData.caEnding && !fieldValidity.caEnding
                  ? 'text-red-400'
                  : 'text-[#b2e9fe]'
              }`}
              style={{
                fontFamily: 'Monaco, Menlo, "Courier New", monospace',
                width: formData.caEnding ? `${formData.caEnding.length}ch` : (isMobile ? '10ch' : '28ch')
              }}
            />
            <span className="text-gray-500">{'}'}</span>
          </div>

          {/* Token Pairing */}
          <div className="text-[14px] mt-0.5 flex items-center gap-2" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <div>
              <span className="text-gray-300">Token Pairing: </span>
              <span className="text-gray-500">{'{'}</span>
              <span
                onClick={() => setFormData(prev => ({ ...prev, quoteToken: prev.quoteToken === 'SOL' ? 'ZC' : 'SOL' }))}
                className="text-[#b2e9fe] cursor-pointer hover:underline"
                style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
              >
                {formData.quoteToken}
              </span>
              <span className="text-gray-500">{'}'}</span>
            </div>
            <div className="relative group">
              <GoInfo className="w-4 h-4 text-gray-500 cursor-help pt-[1px]" />
              <div className="absolute left-6 top-0 w-80 p-3 bg-[#181818] text-sm text-gray-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10 pointer-events-none" style={{ border: '1px solid #2B2B2B' }}>
                Click to change your token pairing to either ZC or SOL.
              </div>
            </div>
          </div>

          {/* Presale */}
          <div className="text-[14px] mt-1 flex items-center gap-2" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <div>
              <span className="text-gray-300">Presale: </span>
              <span className="text-gray-500">{'{'}</span>
              <span
                onClick={() => setFormData(prev => ({ ...prev, presale: !prev.presale }))}
                className="text-[#b2e9fe] cursor-pointer hover:underline"
                style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
              >
                {formData.presale ? 'Enabled' : 'Disabled'}
              </span>
              <span className="text-gray-500">{'}'}</span>
            </div>
            <div className="relative group">
              <GoInfo className="w-4 h-4 text-gray-500 cursor-help pt-[1px]" />
              <div className="absolute left-6 top-0 w-80 p-3 bg-[#181818] text-sm text-gray-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10 pointer-events-none" style={{ border: '1px solid #2B2B2B' }}>
                Click to make the launch a presale. Only buyers holding the specified tokens will be allowed to buy in the pre-sale round. The size of their buys will be proportional to holdings.
              </div>
            </div>
          </div>

          {/* Presale Whitelist */}
          {formData.presale && (
            <div className="mt-0.5">
              {formData.presaleTokens.map((token, index) => (
                <div key={index} className={`text-[14px] ${index === 0 ? 'mt-0' : 'mt-0.5'} flex items-center gap-2`} style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                  <div>
                    <span className="text-gray-300">{index === 0 ? 'Presale Whitelist CAs: ' : '                '}</span>
                    <span className="text-gray-500">{'{'}</span>
                    <input
                      type="text"
                      value={token}
                      onChange={(e) => handlePresaleTokenChange(index, e.target.value)}
                      placeholder={isMobile ? "Enter here" : "Enter token CA here"}
                      autoComplete="off"
                      className={`bg-transparent border-0 focus:outline-none placeholder:text-gray-500 ${
                        token && !validateSolanaAddress(token)
                          ? 'text-red-400'
                          : 'text-[#b2e9fe]'
                      }`}
                      style={{
                        fontFamily: 'Monaco, Menlo, "Courier New", monospace',
                        width: token ? `${token.length}ch` : (isMobile ? '10ch' : '19ch')
                      }}
                    />
                    <span className="text-gray-500">{'}'}</span>
                  </div>
                  {(formData.presaleTokens.length > 1 || (formData.presaleTokens.length === 1 && token.trim())) && (
                    <button
                      onClick={() => handleRemovePresaleToken(index)}
                      className="text-gray-500 hover:text-red-400 transition-colors text-sm"
                    >
                      ×
                    </button>
                  )}
                  {index === formData.presaleTokens.length - 1 && formData.presaleTokens.length < 5 && (
                    <button
                      onClick={handleAddPresaleToken}
                      style={{ paddingTop: '1px' }}
                    >
                      <GoPlus className="w-4 h-4 text-gray-500 hover:text-[#b2e9fe] transition-colors cursor-pointer" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Creator Designation */}
          <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Launching for someone else?</p>

          <div className="text-[14px] mt-0.5" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="text-gray-300">Dev X Profile: </span>
            <span className="text-gray-500">{'{'}</span>
            <input
              type="text"
              name="creatorTwitter"
              value={formData.creatorTwitter}
              onChange={handleInputChange}
              placeholder={isMobile ? "Enter here" : "Enter the other person's X profile URL"}
              autoComplete="off"
              className={`bg-transparent border-0 focus:outline-none placeholder:text-gray-500 ${
                formData.creatorTwitter && !fieldValidity.creatorTwitter
                  ? 'text-red-400'
                  : 'text-[#b2e9fe]'
              }`}
              style={{
                fontFamily: 'Monaco, Menlo, "Courier New", monospace',
                width: formData.creatorTwitter ? `${formData.creatorTwitter.length}ch` : (isMobile ? '10ch' : '38ch')
              }}
            />
            <span className="text-gray-500">{'}'}</span>
          </div>

          <div className="text-[14px] mt-1" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            <span className="text-gray-300">Dev GitHub: </span>
            <span className="text-gray-500">{'{'}</span>
            <input
              type="text"
              name="creatorGithub"
              value={formData.creatorGithub}
              onChange={handleInputChange}
              placeholder={isMobile ? "Enter here" : "Enter the other person's Github profile URL"}
              autoComplete="off"
              className={`bg-transparent border-0 focus:outline-none placeholder:text-gray-500 ${
                formData.creatorGithub && !fieldValidity.creatorGithub
                  ? 'text-red-400'
                  : 'text-[#b2e9fe]'
              }`}
              style={{
                fontFamily: 'Monaco, Menlo, "Courier New", monospace',
                width: formData.creatorGithub ? `${formData.creatorGithub.length}ch` : (isMobile ? '10ch' : '43ch')
              }}
            />
            <span className="text-gray-500">{'}'}</span>
          </div>
      </div>

      <div className="flex items-center gap-4 mt-6.5">
        <WalletButton onLaunch={handleLaunch} disabled={externalWallet ? (!isFormValid || isLaunching || isGeneratingCA) : false} isLaunching={isLaunching} isGeneratingCA={isGeneratingCA} isPresale={formData.presale} />

        {isGeneratingCA && (
          <button
            onClick={handleCancel}
            className="text-xl text-gray-300 hover:text-white transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>

      {transactionSignature && (
        <div className="mt-6">
          <p className="text-lg text-green-400">
            Success!{' '}
            <a
              href={`https://solscan.io/tx/${transactionSignature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-green-300 underline"
            >
              Transaction
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
