import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';

const RPC_URL = process.env.RPC_URL!;
const TOKEN_MINT = process.env.VERIFY_MINT;
const CONFIG = process.env.VERIFY_CONFIG;
const RECIPIENT = process.env.VERIFY_RECIPIENT;

if (!TOKEN_MINT) throw new Error('VERIFY_MINT required');
if (!CONFIG) throw new Error('VERIFY_CONFIG required');

function bnToDecimal(v: any): string {
  if (v && typeof v === 'object' && v.toString) return v.toString(10);
  return String(v);
}

async function main() {
  const conn = new Connection(RPC_URL, 'confirmed');
  const mint = new PublicKey(TOKEN_MINT);
  let allPassed = true;

  // 1. Token Mint
  console.log('=== Token Mint ===');
  const mintInfo = await getMint(conn, mint);
  const supply = Number(mintInfo.supply) / 1e6;
  console.log('Address:', mint.toBase58());
  console.log('Decimals:', mintInfo.decimals);
  console.log('Supply:', supply.toLocaleString(), 'tokens');
  console.log('Mint Authority:', mintInfo.mintAuthority?.toBase58() || 'null');

  if (mintInfo.decimals !== 6) { console.log('FAIL: expected 6 decimals'); allPassed = false; }
  const expectedSupply = RECIPIENT ? 1_100_000_000 : 1_000_000_000;
  if (supply !== expectedSupply) {
    console.log(`FAIL: expected ${expectedSupply.toLocaleString()} tokens`);
    allPassed = false;
  } else {
    console.log(`Supply: PASS (${RECIPIENT ? '1B from DBC + 100M minted' : '1B from DBC'})`);
  }

  // 2. Config
  console.log('\n=== Config ===');
  const client = new DynamicBondingCurveClient(conn, 'confirmed');
  const configData = await client.state.getPoolConfig(CONFIG);

  const checks = [
    ['Quote Mint = SOL', configData.quoteMint?.toBase58?.() === 'So11111111111111111111111111111111111111112'],
    ['Token Decimal = 6', configData.tokenDecimal === 6],
    ['Token Type = SPL (0)', configData.tokenType === 0],
    ['Token Update Authority = PartnerUpdateAndMintAuth (4)', configData.tokenUpdateAuthority === 4],
    ['Migration Option = DAMM V2 (1)', configData.migrationOption === 1],
    ['Migration Fee = 0%', configData.migrationFeePercentage === 0],
    ['Partner Locked LP = 100%', configData.partnerLockedLpPercentage === 100],
    ['Migrated Pool Fee = 100 bps', configData.migratedPoolFeeBps === 100],
    ['Migration Quote Threshold', bnToDecimal(configData.migrationQuoteThreshold) === '170000000000'],
  ];

  for (const [label, pass] of checks) {
    const status = pass ? 'PASS' : 'FAIL';
    if (!pass) allPassed = false;
    console.log(`${status}: ${label}`);
  }
  console.log('Migration Quote Threshold:', Number(bnToDecimal(configData.migrationQuoteThreshold)) / 1e9, 'SOL');

  // 3. Recipient token balance (optional)
  if (RECIPIENT) {
    console.log('\n=== Recipient Token Balance ===');
    const recipient = new PublicKey(RECIPIENT);
    const ata = await getAssociatedTokenAddress(mint, recipient);
    try {
      const tokenAccount = await getAccount(conn, ata);
      const balance = Number(tokenAccount.amount) / 1e6;
      console.log('Recipient:', RECIPIENT);
      console.log('ATA:', ata.toBase58());
      console.log('Balance:', balance.toLocaleString(), 'tokens');
      if (balance === 100_000_000) {
        console.log('PASS: Recipient received 100M tokens');
      } else {
        console.log('FAIL: expected 100,000,000 tokens');
        allPassed = false;
      }
    } catch (e: any) {
      console.log('FAIL: Could not read recipient token account:', e.message);
      allPassed = false;
    }
  }

  // 4. Summary
  console.log('\n=== Result ===');
  console.log(allPassed ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
}

main().catch(console.error);
