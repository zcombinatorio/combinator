/**
 * E2E Test: Transfer LP NFT to admin wallet
 *
 * This script lists the LP position in a DAMM pool and transfers it
 * to the admin wallet for the E2E DAO proposal test.
 */
import 'dotenv/config';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  unpackAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';

// Configuration from environment or defaults
const DAMM_POOL = process.env.DAMM_POOL || process.env.POOL_ADDRESS;
const ADMIN_WALLET = process.env.ADMIN_WALLET;

const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

async function findNftOwner(connection: Connection, nftMint: PublicKey): Promise<string> {
  try {
    const tokenAccounts = await connection.getTokenLargestAccounts(nftMint, 'confirmed');
    for (const account of tokenAccounts.value) {
      if (account.amount === '1') {
        const accountInfo = await connection.getAccountInfo(account.address);
        if (accountInfo) {
          try {
            const parsed = unpackAccount(account.address, accountInfo, TOKEN_2022_PROGRAM_ID);
            return parsed.owner.toBase58();
          } catch {
            try {
              const parsed = unpackAccount(account.address, accountInfo, TOKEN_PROGRAM_ID);
              return parsed.owner.toBase58();
            } catch {
              // Fall through
            }
          }
        }
      }
    }
  } catch {
    // Mint might not exist or have no holders
  }
  return 'unknown';
}

async function main() {
  const RPC_URL = process.env.RPC_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;

  if (!RPC_URL) throw new Error('RPC_URL required');
  if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY or PROTOCOL_PRIVATE_KEY required');
  if (!DAMM_POOL) throw new Error('DAMM_POOL or POOL_ADDRESS required');
  if (!ADMIN_WALLET) throw new Error('ADMIN_WALLET required');

  const connection = new Connection(RPC_URL, 'confirmed');
  const payer = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  const poolAddress = new PublicKey(DAMM_POOL);
  const newOwner = new PublicKey(ADMIN_WALLET);

  console.log('=== E2E LP Position Transfer ===');
  console.log(`DAMM Pool: ${DAMM_POOL}`);
  console.log(`Current Owner: ${payer.publicKey.toBase58()}`);
  console.log(`Target Admin Wallet: ${ADMIN_WALLET}`);
  console.log('');

  // Find LP positions in the pool
  console.log('Fetching DAMM pool positions...');
  const cpAmm = new CpAmm(connection);

  // Get all position accounts for this pool
  const positions = await connection.getProgramAccounts(
    new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'),
    {
      filters: [
        { memcmp: { offset: 8, bytes: poolAddress.toBase58() } },
      ],
    }
  );

  console.log(`Found ${positions.length} position(s):`);
  console.log('');

  let targetPosition: { address: PublicKey; nftMint: PublicKey; owner: string } | null = null;

  for (const pos of positions) {
    const data = pos.account.data;
    const nftMint = new PublicKey(data.slice(40, 72));
    const owner = await findNftOwner(connection, nftMint);

    console.log(`Position: ${pos.pubkey.toBase58()}`);
    console.log(`  NFT Mint: ${nftMint.toBase58()}`);
    console.log(`  Owner: ${owner}`);
    console.log('');

    // Check if this is owned by our payer (protocol wallet)
    if (owner === payer.publicKey.toBase58()) {
      targetPosition = { address: pos.pubkey, nftMint, owner };
    }
  }

  if (!targetPosition) {
    console.log('No position found owned by protocol wallet.');
    console.log('Checking if the position was already transferred to admin...');

    // Check if admin already has a position
    const adminPositions = await cpAmm.getUserPositionByPool(poolAddress, newOwner);
    if (adminPositions.length > 0) {
      console.log(`Admin wallet already has ${adminPositions.length} position(s) in this pool.`);
      console.log('LP transfer may have already been completed.');
      return;
    }

    console.error('Error: No transferable position found');
    process.exit(1);
  }

  console.log('=== Transferring Position ===');
  console.log(`Position: ${targetPosition.address.toBase58()}`);
  console.log(`NFT Mint: ${targetPosition.nftMint.toBase58()}`);
  console.log(`From: ${payer.publicKey.toBase58()}`);
  console.log(`To: ${newOwner.toBase58()}`);
  console.log('');

  // Get the user positions to find the token account
  const userPositions = await cpAmm.getUserPositionByPool(poolAddress, payer.publicKey);
  if (userPositions.length === 0) {
    throw new Error('Could not find user positions via SDK');
  }

  const { positionNftAccount } = userPositions[0];
  let tokenProgramId: PublicKey;
  let sourceTokenAccount: PublicKey;

  // Try Token-2022 first
  try {
    await getAccount(connection, positionNftAccount, 'confirmed', TOKEN_2022_PROGRAM_ID);
    tokenProgramId = TOKEN_2022_PROGRAM_ID;
    sourceTokenAccount = positionNftAccount;
    console.log('Position uses Token-2022 program');
  } catch {
    tokenProgramId = TOKEN_PROGRAM_ID;
    sourceTokenAccount = positionNftAccount;
    console.log('Position uses standard Token program');
  }

  // Get or create the new owner's ATA
  const newOwnerAta = await getAssociatedTokenAddress(
    targetPosition.nftMint,
    newOwner,
    false,
    tokenProgramId
  );

  console.log(`Source Token Account: ${sourceTokenAccount.toBase58()}`);
  console.log(`Destination ATA: ${newOwnerAta.toBase58()}`);

  const transaction = new Transaction();

  // Check if ATA exists
  const newOwnerAtaInfo = await connection.getAccountInfo(newOwnerAta);
  if (!newOwnerAtaInfo) {
    console.log('Creating ATA for admin wallet...');
    transaction.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        newOwnerAta,
        newOwner,
        targetPosition.nftMint,
        tokenProgramId
      )
    );
  }

  // Add transfer instruction
  transaction.add(
    createTransferInstruction(
      sourceTokenAccount,
      newOwnerAta,
      payer.publicKey,
      1,
      [],
      tokenProgramId
    )
  );

  // Set transaction properties
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = payer.publicKey;

  // Sign and send
  console.log('Sending transaction...');
  transaction.sign(payer);

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
  console.log(`Position: ${targetPosition.address.toBase58()}`);
  console.log(`  From: ${payer.publicKey.toBase58()}`);
  console.log(`  To:   ${newOwner.toBase58()}`);

  // Verify transfer
  console.log('');
  console.log('Verifying transfer...');
  await new Promise(r => setTimeout(r, 2000));

  const adminPositions = await cpAmm.getUserPositionByPool(poolAddress, newOwner);
  if (adminPositions.length > 0) {
    console.log(`✅ Admin wallet now has ${adminPositions.length} position(s) in the pool`);
  } else {
    console.log('⚠️ Could not verify admin position - may take time to propagate');
  }
}

main().catch(console.error);
