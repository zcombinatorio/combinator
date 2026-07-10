/**
 * Isolated test for the staking vault addRewards() call used by
 * sendRewardsToVault() in fee-buyback-workrewards.ts.
 *
 * Sends a specific ZC amount from the fee wallet to the staking vault as
 * rewards, without doing any fee claiming or swapping first. Lets us verify
 * the vault plumbing works before wiring the step back into the real
 * buyback script.
 *
 * Usage: npx tsx test-add-rewards.ts <amount_in_zc>
 *   e.g. npx tsx test-add-rewards.ts 10000
 */

import 'dotenv/config';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getMint } from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import stakingVaultIdl from './staking-vault-idl.json';

const CONFIG = {
  RPC_URL: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
  WALLET_PRIVATE_KEY: process.env.FEE_WALLET_PRIVATE_KEY || '',
  ZC_MINT: 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC',
  STAKING_VAULT_PROGRAM_ID: '47rZ1jgK7zU6XAgffAfXkDX1JkiiRi4HRPBytossWR12',
};

interface VaultState {
  underlyingMint: PublicKey;
}

function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function main() {
  const amountArg = process.argv[2];
  if (!amountArg) {
    throw new Error('Usage: npx tsx test-add-rewards.ts <amount_in_zc>');
  }
  const amountZc = Number(amountArg);
  if (!Number.isFinite(amountZc) || amountZc <= 0) {
    throw new Error(`Invalid amount: ${amountArg}`);
  }

  if (!CONFIG.WALLET_PRIVATE_KEY) {
    throw new Error('FEE_WALLET_PRIVATE_KEY environment variable is required');
  }

  const connection = new Connection(CONFIG.RPC_URL, 'confirmed');
  const wallet = Keypair.fromSecretKey(bs58.decode(CONFIG.WALLET_PRIVATE_KEY));
  log(`Wallet address: ${wallet.publicKey.toBase58()}`);

  const zcMint = new PublicKey(CONFIG.ZC_MINT);
  const mintInfo = await getMint(connection, zcMint);
  const decimals = mintInfo.decimals;
  const amountBaseUnits = BigInt(Math.round(amountZc * 10 ** decimals));
  log(`ZC decimals: ${decimals}`);
  log(`Requested amount: ${amountZc} ZC = ${amountBaseUnits.toString()} base units`);

  const walletZcAta = await getAssociatedTokenAddress(zcMint, wallet.publicKey);
  const walletBalance = await connection.getTokenAccountBalance(walletZcAta);
  const walletBalanceRaw = BigInt(walletBalance.value.amount);
  log(`Fee wallet ZC balance: ${walletBalance.value.uiAmountString} ZC (${walletBalanceRaw.toString()} base units)`);

  if (walletBalanceRaw < amountBaseUnits) {
    throw new Error(
      `Insufficient ZC balance: have ${walletBalance.value.uiAmountString}, need ${amountZc}`
    );
  }

  const anchorWallet = new Wallet(wallet);
  const provider = new AnchorProvider(connection, anchorWallet, { commitment: 'confirmed' });
  const programId = new PublicKey(CONFIG.STAKING_VAULT_PROGRAM_ID);
  const program = new Program(stakingVaultIdl as anchor.Idl, provider);

  const [vaultState] = PublicKey.findProgramAddressSync([Buffer.from('vault_state')], programId);
  log(`Vault state PDA: ${vaultState.toBase58()}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vaultAccount = (await (program.account as any).vaultState.fetch(vaultState)) as VaultState;
  log(`Vault underlying mint: ${vaultAccount.underlyingMint.toBase58()}`);

  if (vaultAccount.underlyingMint.toBase58() !== CONFIG.ZC_MINT) {
    throw new Error(
      `Vault underlying mint (${vaultAccount.underlyingMint.toBase58()}) does not match ZC mint (${CONFIG.ZC_MINT})`
    );
  }

  const depositorTokenAccount = await getAssociatedTokenAddress(zcMint, wallet.publicKey);
  log(`Depositor token account: ${depositorTokenAccount.toBase58()}`);

  log(`Calling addRewards with ${amountBaseUnits.toString()} base units...`);
  const tx = await program.methods
    .addRewards(new BN(amountBaseUnits.toString()))
    .accounts({
      depositorTokenAccount,
      signer: wallet.publicKey,
    })
    .rpc();

  log(`addRewards signature: ${tx}`);

  const walletBalanceAfter = await connection.getTokenAccountBalance(walletZcAta);
  log(`Fee wallet ZC balance after: ${walletBalanceAfter.value.uiAmountString} ZC`);
}

main()
  .then(() => {
    log('Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
