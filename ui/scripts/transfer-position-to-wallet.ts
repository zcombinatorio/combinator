/**
 * Transfer a Meteora DAMM v2 (CP-AMM) position to another wallet.
 *
 * In CP-AMM a position is "owned" by whoever holds its position NFT (a Token-2022
 * NFT, amount = 1). There is no dedicated transfer-position instruction — you simply
 * transfer the NFT. The NFT currently lives in the CP-AMM `position_nft_account` PDA
 * (derivePositionNftAccount(mint)), whose SPL authority is the source wallet, so the
 * source wallet can sign a normal transferChecked out of it. We land it in the
 * destination wallet's Token-2022 ATA; the SDK's getPositionsByUser() then finds it
 * (it scans the owner's Token-2022 accounts for any amount==1 NFT).
 *
 * Usage:
 *   SOURCE_KEYPAIR=/path/to/source-wallet.json bun scripts/transfer-position-to-wallet.ts          # simulate only
 *   SOURCE_KEYPAIR=/path/to/source-wallet.json bun scripts/transfer-position-to-wallet.ts --send    # broadcast
 *
 * SOURCE_KEYPAIR must be a Solana keypair JSON (byte array) for the CURRENT owner
 * (Hq7Xh37tT4sesD6wA4DphYfxeMJRhhFWS3KVUSSGjqzc). RPC_URL is read from the environment.
 */
import 'dotenv/config';
import fs from 'fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { CpAmm, derivePositionNftAccount } from '@meteora-ag/cp-amm-sdk';

// --- Target of this transfer -------------------------------------------------
const POOL = new PublicKey('BTYhoRPEUXs8ESYFjKDXRYf5qjH4chzZoBokMEApKEfJ');
const POSITION_NFT_MINT = new PublicKey('FJpQ2qkiZUvhx5cZpC4DVBY1xxrv8eYxXwtDF4Pi3oP7');
const SOURCE_OWNER = new PublicKey('Hq7Xh37tT4sesD6wA4DphYfxeMJRhhFWS3KVUSSGjqzc');
const DEST_OWNER = new PublicKey('BPCTTyzHPQaVeJdTLpQSqANTh8pYRsMm6qNUvWUY8snb');
// ----------------------------------------------------------------------------

const SEND = process.argv.includes('--send');

/**
 * Accepts SOURCE_KEYPAIR as any of:
 *   - a path to a keypair JSON file (byte array)
 *   - a raw JSON byte array
 *   - a base58-encoded secret key
 */
function loadKeypair(value: string): Keypair {
  const v = value.trim();
  let contents = v;
  if (fs.existsSync(v)) contents = fs.readFileSync(v, 'utf8').trim();

  if (contents.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(contents)));
  }
  return Keypair.fromSecretKey(bs58.decode(contents));
}

async function main() {
  const RPC_URL = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
  if (!RPC_URL) throw new Error('RPC_URL (or NEXT_PUBLIC_RPC_URL) required');

  const keypairPath = process.env.SOURCE_KEYPAIR;
  if (!keypairPath) throw new Error('SOURCE_KEYPAIR (path to source wallet keypair json) required');

  const connection = new Connection(RPC_URL, 'confirmed');
  const signer = loadKeypair(keypairPath);

  if (!signer.publicKey.equals(SOURCE_OWNER)) {
    throw new Error(
      `SOURCE_KEYPAIR is ${signer.publicKey.toBase58()} but the position owner is ${SOURCE_OWNER.toBase58()}`,
    );
  }

  console.log('=== Transfer CP-AMM Position ===');
  console.log('Pool         :', POOL.toBase58());
  console.log('Position NFT :', POSITION_NFT_MINT.toBase58());
  console.log('From         :', SOURCE_OWNER.toBase58());
  console.log('To           :', DEST_OWNER.toBase58());

  // Source: the CP-AMM position_nft_account PDA that currently holds the NFT.
  const sourceNftAccount = derivePositionNftAccount(POSITION_NFT_MINT);
  // Destination: the recipient's standard Token-2022 ATA.
  const destNftAccount = getAssociatedTokenAddressSync(
    POSITION_NFT_MINT,
    DEST_OWNER,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  console.log('Source NFT account (PDA):', sourceNftAccount.toBase58());
  console.log('Dest   NFT account (ATA):', destNftAccount.toBase58());

  // Sanity: verify the source actually holds exactly 1 of the NFT.
  const srcInfo = await connection.getTokenAccountBalance(sourceNftAccount);
  if (srcInfo.value.amount !== '1') {
    throw new Error(`Source account holds ${srcInfo.value.amount}, expected 1 — nothing to transfer`);
  }

  const tx = new Transaction();
  // Idempotent create of the destination ATA (payer = source wallet).
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      SOURCE_OWNER,
      destNftAccount,
      DEST_OWNER,
      POSITION_NFT_MINT,
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  // Transfer the single NFT (decimals = 0).
  tx.add(
    createTransferCheckedInstruction(
      sourceNftAccount,
      POSITION_NFT_MINT,
      destNftAccount,
      SOURCE_OWNER,
      1,
      0,
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = SOURCE_OWNER;
  tx.sign(signer);

  if (!SEND) {
    const sim = await connection.simulateTransaction(tx);
    console.log('\n--- SIMULATION (dry run, no --send) ---');
    console.log('err  :', sim.value.err);
    console.log('units:', sim.value.unitsConsumed);
    for (const l of sim.value.logs ?? []) console.log('  ', l);
    if (sim.value.err) throw new Error('Simulation failed — see logs above');
    console.log('\nSimulation OK. Re-run with --send to broadcast.');
    return;
  }

  const sig = await connection.sendRawTransaction(tx.serialize());
  console.log('\nSent:', sig);
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  console.log('Confirmed.');

  // Verify the destination now owns the position in this pool.
  const cpAmm = new CpAmm(connection);
  const destPositions = await cpAmm.getUserPositionByPool(POOL, DEST_OWNER);
  console.log(
    `\nDestination now holds ${destPositions.length} position(s) in this pool:`,
    destPositions.map((p) => p.positionState.nftMint.toBase58()),
  );
  console.log('=== Done ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
