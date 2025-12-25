/**
 * Transfer a Meteora DAMM LP position NFT to a new owner
 *
 * IMPORTANT: This script ONLY works for DAMM (CP-AMM) positions!
 * DLMM positions CANNOT be transferred - they are tied to the wallet that created them.
 * For DLMM, you must: withdraw liquidity → close position → create new position with new owner.
 *
 * Usage:
 *   1. Update the configuration below (POOL_ADDRESS, NEW_OWNER)
 *   2. Set CURRENT_LP_OWNER_PRIVATE_KEY env var (base58 encoded)
 *   3. Run: pnpm tsx scripts/transfer-lp-position.ts
 *
 * Note: DAMM positions are represented as NFTs using Token-2022.
 * Transferring the NFT transfers ownership of the position.
 */
import 'dotenv/config';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  TokenAccountNotFoundError,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';

// ============================================================================
// CONFIGURATION - Update these values before running
// ============================================================================

// DAMM pool address to find the position in
const POOL_ADDRESS = 'PS3rPSb49GnAkmh3tec1RQizgNSb1hUwPsYHGGuAy5r'; // SURFTEST DAMM

// The new owner's public key
const NEW_OWNER = 'ESMiG5ppoVMtYq3EG8aKx3XzEtKPfiGQuAx2S4jhw3zf';

// Skip confirmation delay (set to true for testing)
const SKIP_DELAY = true;

// ============================================================================

// Token-2022 program ID (DAMM v2 uses this for position NFTs)
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

/**
 * Find token account for a mint owned by a specific wallet.
 * Checks ATA first, then searches all token accounts.
 * Works with both Token and Token-2022 programs.
 */
async function findTokenAccount(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgramId: PublicKey
): Promise<PublicKey> {
  // Try ATA first
  const ata = await getAssociatedTokenAddress(mint, owner, false, tokenProgramId);
  try {
    const ataAccount = await getAccount(connection, ata, 'confirmed', tokenProgramId);
    if (ataAccount.amount > BigInt(0)) {
      return ata;
    }
  } catch (e) {
    if (!(e instanceof TokenAccountNotFoundError)) {
      throw e;
    }
  }

  // Search all token accounts for owner under this program
  const accounts = await connection.getParsedTokenAccountsByOwner(
    owner,
    { programId: tokenProgramId },
    'confirmed'
  );

  for (const { pubkey, account } of accounts.value) {
    const data = account.data.parsed.info;
    if (data.mint === mint.toBase58() && BigInt(data.tokenAmount.amount) > BigInt(0)) {
      return pubkey;
    }
  }

  throw new Error(`No token account found for mint ${mint.toBase58()} owned by ${owner.toBase58()}`);
}

async function transferPosition() {
  const poolAddressStr = POOL_ADDRESS;
  const newOwnerAddress = NEW_OWNER;

  // Validate environment
  const RPC_URL = process.env.RPC_URL;
  const CURRENT_LP_OWNER_PRIVATE_KEY = process.env.CURRENT_LP_OWNER_PRIVATE_KEY;

  if (!RPC_URL) {
    console.error('RPC_URL environment variable is required');
    process.exit(1);
  }

  if (!CURRENT_LP_OWNER_PRIVATE_KEY) {
    console.error('CURRENT_LP_OWNER_PRIVATE_KEY environment variable is required');
    process.exit(1);
  }

  // Parse keys
  let poolAddress: PublicKey;
  let newOwner: PublicKey;
  let currentOwner: Keypair;

  try {
    poolAddress = new PublicKey(poolAddressStr);
  } catch {
    console.error('Invalid pool address:', poolAddressStr);
    process.exit(1);
  }

  try {
    newOwner = new PublicKey(newOwnerAddress);
  } catch {
    console.error('Invalid new owner address:', newOwnerAddress);
    process.exit(1);
  }

  try {
    currentOwner = Keypair.fromSecretKey(bs58.decode(CURRENT_LP_OWNER_PRIVATE_KEY));
  } catch {
    console.error('Invalid CURRENT_LP_OWNER_PRIVATE_KEY');
    process.exit(1);
  }

  console.log('=== Meteora DAMM LP Position Transfer ===');
  console.log(`Pool: ${poolAddress.toBase58()}`);
  console.log(`Current Owner: ${currentOwner.publicKey.toBase58()}`);
  console.log(`New Owner: ${newOwner.toBase58()}`);
  console.log('');

  // Prevent accidental self-transfer
  if (currentOwner.publicKey.equals(newOwner)) {
    console.error('Error: Current owner and new owner are the same');
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');

  try {
    // Use CpAmm SDK to get position info
    console.log('Fetching DAMM position...');
    const cpAmm = new CpAmm(connection);
    const userPositions = await cpAmm.getUserPositionByPool(poolAddress, currentOwner.publicKey);

    if (userPositions.length === 0) {
      console.error('Error: No DAMM positions found for current owner in this pool');
      process.exit(1);
    }

    const { position, positionNftAccount } = userPositions[0];

    // Get the NFT mint from the position's token account
    // Try Token-2022 first (DAMM v2 uses this), fallback to standard Token
    let positionNftMint: PublicKey;
    let tokenProgramId: PublicKey;
    let sourceTokenAccount: PublicKey;

    try {
      // Try Token-2022 first
      const tokenAccountInfo = await getAccount(connection, positionNftAccount, 'confirmed', TOKEN_2022_PROGRAM_ID);
      positionNftMint = tokenAccountInfo.mint;
      tokenProgramId = TOKEN_2022_PROGRAM_ID;
      sourceTokenAccount = positionNftAccount;
      console.log('Position uses Token-2022 program');
    } catch {
      // Fallback: try to find the token account manually
      console.log('Searching for position NFT token account...');

      // Get position account to find the NFT mint
      const positionAccountInfo = await connection.getAccountInfo(position);
      if (!positionAccountInfo) {
        throw new Error('Could not fetch position account');
      }

      // Position structure: discriminator(8) + pool(32) + positionNftMint(32) + ...
      // The NFT mint should be at offset 40 (after pool address)
      positionNftMint = new PublicKey(positionAccountInfo.data.slice(40, 72));

      // Try Token-2022 first, then standard Token
      try {
        sourceTokenAccount = await findTokenAccount(connection, positionNftMint, currentOwner.publicKey, TOKEN_2022_PROGRAM_ID);
        tokenProgramId = TOKEN_2022_PROGRAM_ID;
      } catch {
        const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
        sourceTokenAccount = await findTokenAccount(connection, positionNftMint, currentOwner.publicKey, TOKEN_PROGRAM_ID);
        tokenProgramId = TOKEN_PROGRAM_ID;
      }
    }

    console.log(`Position Address: ${position.toBase58()}`);
    console.log(`Position NFT Mint: ${positionNftMint.toBase58()}`);
    console.log(`Source Token Account: ${sourceTokenAccount.toBase58()}`);
    console.log(`Token Program: ${tokenProgramId.toBase58()}`);

    // Verify the current owner has the NFT
    const tokenAccount = await getAccount(connection, sourceTokenAccount, 'confirmed', tokenProgramId);
    if (tokenAccount.amount !== BigInt(1)) {
      console.error('Error: Token account does not contain exactly 1 NFT');
      console.error('Amount:', tokenAccount.amount.toString());
      process.exit(1);
    }

    console.log('');
    console.log('Position NFT verified in current owner wallet ✓');

    // Safety warning
    if (!SKIP_DELAY) {
      console.log('');
      console.log('⚠️  WARNING: This will permanently transfer the position NFT.');
      console.log('Press Ctrl+C to abort, or wait 5 seconds to continue...');
      console.log('');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Get or create the new owner's token account (use ATA)
    const newOwnerAta = await getAssociatedTokenAddress(
      positionNftMint,
      newOwner,
      false,
      tokenProgramId
    );

    console.log('New owner ATA:', newOwnerAta.toBase58());

    // Build transaction
    const transaction = new Transaction();

    // Check if new owner ATA exists
    const newOwnerAtaInfo = await connection.getAccountInfo(newOwnerAta);
    if (!newOwnerAtaInfo) {
      console.log('Creating ATA for new owner...');
      transaction.add(
        createAssociatedTokenAccountInstruction(
          currentOwner.publicKey, // payer
          newOwnerAta,
          newOwner,
          positionNftMint,
          tokenProgramId
        )
      );
    }

    // Add transfer instruction
    transaction.add(
      createTransferInstruction(
        sourceTokenAccount,
        newOwnerAta,
        currentOwner.publicKey,
        1, // NFT amount is always 1
        [],
        tokenProgramId
      )
    );

    // Set transaction properties
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = currentOwner.publicKey;

    // Sign and send
    console.log('Sending transaction...');
    transaction.sign(currentOwner);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log('Transaction sent:', signature);
    console.log('Waiting for confirmation...');

    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    });

    console.log('');
    console.log('=== Transfer Complete ===');
    console.log(`Signature: ${signature}`);
    console.log(`Solscan: https://solscan.io/tx/${signature}`);
    console.log('');
    console.log(`Position: ${position.toBase58()}`);
    console.log(`  From: ${currentOwner.publicKey.toBase58()}`);
    console.log(`  To:   ${newOwner.toBase58()}`);

  } catch (error) {
    console.error('Error transferring position:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  transferPosition();
}

export { transferPosition };
