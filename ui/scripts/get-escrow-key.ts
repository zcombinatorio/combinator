import { getPool } from '../lib/db';
import { decryptEscrowKeypair } from '../lib/presale-escrow';
import bs58 from 'bs58';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const tokenAddress = process.env.TOKEN_ADDRESS;

  if (!tokenAddress) {
    console.error('Error: TOKEN_ADDRESS not set in .env');
    process.exit(1);
  }

  const pool = getPool();

  try {
    const query = `
      SELECT escrow_pub_key, escrow_priv_key
      FROM ico_sales
      WHERE token_address = $1
    `;

    const result = await pool.query(query, [tokenAddress]);

    if (result.rows.length === 0) {
      console.error('Error: ICO sale not found');
      process.exit(1);
    }

    const sale = result.rows[0];
    const keypair = decryptEscrowKeypair(sale.escrow_priv_key);

    if (sale.escrow_pub_key !== keypair.publicKey.toBase58()) {
      console.error('Error: Public key mismatch');
      process.exit(1);
    }

    console.log('Public Key:', keypair.publicKey.toBase58());
    console.log('Private Key (Base58):', bs58.encode(keypair.secretKey));
    console.log('Private Key (JSON):', JSON.stringify(Array.from(keypair.secretKey)));

  } catch (error: any) {
    console.error('Error:', error.message || error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
