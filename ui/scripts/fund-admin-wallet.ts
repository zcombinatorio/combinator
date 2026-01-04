/**
 * Fund a DAO admin wallet with SOL
 *
 * The admin wallet needs SOL to pay for transaction fees during proposal
 * creation and liquidity operations. This script transfers SOL from your
 * wallet to the admin wallet.
 *
 * Usage:
 *   ADMIN_WALLET="<admin-wallet-from-dao-creation>" pnpm tsx scripts/fund-admin-wallet.ts
 *
 * With custom amount:
 *   ADMIN_WALLET="..." SOL_AMOUNT=0.1 pnpm tsx scripts/fund-admin-wallet.ts
 *
 * Required ENV:
 *   - RPC_URL: Solana RPC endpoint
 *   - PRIVATE_KEY (or PROTOCOL_PRIVATE_KEY): Your wallet private key
 *   - ADMIN_WALLET: The admin wallet address from DAO creation
 *
 * Optional ENV:
 *   - SOL_AMOUNT: Amount of SOL to transfer (default: 0.1)
 */
import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';

const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;
const ADMIN_WALLET = process.env.ADMIN_WALLET;
const SOL_AMOUNT = parseFloat(process.env.SOL_AMOUNT || '0.2');

if (!RPC_URL) throw new Error('RPC_URL is required');
if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY or PROTOCOL_PRIVATE_KEY is required');
if (!ADMIN_WALLET) throw new Error('ADMIN_WALLET is required');

async function main() {
  const connection = new Connection(RPC_URL!, 'confirmed');
  const payer = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY!));
  const adminWallet = new PublicKey(ADMIN_WALLET!);

  console.log('=== Fund Admin Wallet ===\n');
  console.log(`From: ${payer.publicKey.toBase58()}`);
  console.log(`To:   ${adminWallet.toBase58()}`);
  console.log(`Amount: ${SOL_AMOUNT} SOL`);
  console.log('');

  // Check payer balance
  const payerBalance = await connection.getBalance(payer.publicKey);
  const payerBalanceSol = payerBalance / LAMPORTS_PER_SOL;
  console.log(`Payer balance: ${payerBalanceSol.toFixed(4)} SOL`);

  const requiredBalance = SOL_AMOUNT + 0.001; // Amount + fee buffer
  if (payerBalanceSol < requiredBalance) {
    throw new Error(`Insufficient balance. Need at least ${requiredBalance} SOL, have ${payerBalanceSol.toFixed(4)} SOL`);
  }

  // Check admin wallet current balance
  const adminBalance = await connection.getBalance(adminWallet);
  const adminBalanceSol = adminBalance / LAMPORTS_PER_SOL;
  console.log(`Admin wallet balance: ${adminBalanceSol.toFixed(4)} SOL`);

  // Create transfer transaction
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: adminWallet,
      lamports: Math.floor(SOL_AMOUNT * LAMPORTS_PER_SOL),
    })
  );

  console.log('\nSending transaction...');

  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [payer],
    { commitment: 'confirmed' }
  );

  // Check new balance
  const newAdminBalance = await connection.getBalance(adminWallet);
  const newAdminBalanceSol = newAdminBalance / LAMPORTS_PER_SOL;

  console.log(`\nTransaction: ${signature}`);
  console.log(`Solscan: https://solscan.io/tx/${signature}`);
  console.log(`\nAdmin wallet new balance: ${newAdminBalanceSol.toFixed(4)} SOL`);
  console.log('\n=== Funding Complete ===');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
