/**
 * Transfer mint authority to a new address
 *
 * Usage:
 *   TOKEN_MINT="..." NEW_AUTHORITY="..." pnpm tsx scripts/transfer-mint-authority.ts
 *
 * Optional:
 *   OWNER_PRIVATE_KEY - If set, use this as the current authority (defaults to PROTOCOL_PRIVATE_KEY)
 */
import 'dotenv/config';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AuthorityType, setAuthority } from '@solana/spl-token';
import bs58 from 'bs58';

const RPC_URL = process.env.RPC_URL;
const TOKEN_MINT = process.env.TOKEN_MINT;
const NEW_AUTHORITY = process.env.NEW_AUTHORITY;
const OWNER_KEY = process.env.OWNER_PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;

if (!RPC_URL) throw new Error('RPC_URL is required');
if (!TOKEN_MINT) throw new Error('TOKEN_MINT is required');
if (!NEW_AUTHORITY) throw new Error('NEW_AUTHORITY is required');
if (!OWNER_KEY) throw new Error('OWNER_PRIVATE_KEY or PROTOCOL_PRIVATE_KEY is required');

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const keypair = Keypair.fromSecretKey(bs58.decode(OWNER_KEY));
  const tokenMint = new PublicKey(TOKEN_MINT);
  const newAuthority = new PublicKey(NEW_AUTHORITY);

  console.log('=== Transfer Mint Authority ===');
  console.log(`Token Mint: ${TOKEN_MINT}`);
  console.log(`Current Authority: ${keypair.publicKey.toBase58()}`);
  console.log(`New Authority: ${NEW_AUTHORITY}\n`);

  const signature = await setAuthority(
    connection,
    keypair,
    tokenMint,
    keypair,
    AuthorityType.MintTokens,
    newAuthority
  );

  console.log(`Signature: ${signature}`);
  console.log('Mint authority transferred successfully!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
