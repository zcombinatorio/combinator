import 'dotenv/config';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

const WALLET = process.argv[2] || 'FtV94i2JvmaqsE1rBT72C9YR58wYJXt1ZjRmPb4tDvMK';
const TOKEN = process.argv[3] || 'Fairr196TRbroavk2QhRb3RRDH1ZpdWC3yJDTDDestar';
const API_KEY = process.env.HELIUS_API_KEY!;

async function main() {
  const ata = getAssociatedTokenAddressSync(
    new PublicKey(TOKEN),
    new PublicKey(WALLET),
    true
  );

  console.log('ATA:', ata.toBase58());
  console.log('Fetching ALL signatures...\n');

  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      method: 'getSignaturesForAddress',
      params: [ata.toBase58(), { limit: 1000 }],
    }),
  });

  const data = await response.json();
  const results = data.result || [];
  console.log(`Total signatures found: ${results.length}`);

  console.log('\nAll transactions (oldest first):');
  for (const sig of results.reverse()) {
    const date = sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'unknown';
    console.log(`  ${date} | ${sig.signature.slice(0, 40)}...`);
  }

  // Now fetch the first (oldest) transaction details to see what happened
  if (results.length > 0) {
    const oldest = results[0];
    console.log('\n\nOldest transaction details:');
    console.log(`Signature: ${oldest.signature}`);

    const txResponse = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: [oldest.signature] }),
    });

    const txData = await txResponse.json();
    if (txData[0]?.tokenTransfers) {
      console.log('\nToken transfers in oldest tx:');
      for (const transfer of txData[0].tokenTransfers) {
        const direction = transfer.toUserAccount === WALLET ? 'IN' : 'OUT';
        console.log(`  ${direction}: ${transfer.tokenAmount} tokens`);
        console.log(`    from: ${transfer.fromUserAccount}`);
        console.log(`    to: ${transfer.toUserAccount}`);
      }
    }
  }
}

main().catch(console.error);
