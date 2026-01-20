import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

interface DesignatedClaim {
  token_address: string;
  designated_twitter?: string;
  designated_github?: string;
}

interface PrivyUser {
  wallet_address: string;
  embedded_wallet?: string;
  external_wallet?: string;
  twitter_username?: string;
  github_username?: string;
}

async function backfillVerifiedWallets() {
  const pool = new Pool({
    connectionString: process.env.DB_URL,
  });

  try {
    console.log('Starting backfill of verified wallets...\n');

    // Step 1: Get all designated claims that don't have verified wallets yet
    const unverifiedClaimsQuery = `
      SELECT
        token_address,
        designated_twitter,
        designated_github
      FROM designated_claims
      WHERE verified_wallet IS NULL
        AND (designated_twitter IS NOT NULL OR designated_github IS NOT NULL)
    `;

    const unverifiedResult = await pool.query(unverifiedClaimsQuery);
    const unverifiedClaims: DesignatedClaim[] = unverifiedResult.rows;

    console.log(`Found ${unverifiedClaims.length} unverified designated claims\n`);

    if (unverifiedClaims.length === 0) {
      console.log('No claims to backfill');
      return;
    }

    // For each claim, we need to find matching Privy users
    // Since we don't have a direct Privy users table, we need to check from existing wallet connections
    // We'll look in the token_holders table or any other table that might have user social data

    // First, let's check if we have any tables that store Privy user data
    const tablesQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE '%user%' OR table_name LIKE '%privy%' OR table_name LIKE '%account%'
      ORDER BY table_name;
    `;

    const tablesResult = await pool.query(tablesQuery);
    console.log('Available user-related tables:', tablesResult.rows.map(r => r.table_name));

    // Check token_holders table for social connections
    const socialMatchQuery = `
      SELECT DISTINCT
        dc.token_address,
        dc.designated_twitter,
        dc.designated_github,
        th.wallet_address,
        th.x_username,
        th.telegram_username
      FROM designated_claims dc
      LEFT JOIN token_holders th ON
        (dc.designated_twitter IS NOT NULL AND (
          th.x_username = dc.designated_twitter OR
          th.x_username = REPLACE(dc.designated_twitter, 'https://twitter.com/', '') OR
          th.x_username = REPLACE(dc.designated_twitter, 'https://x.com/', '') OR
          th.x_username = REPLACE(dc.designated_twitter, 'twitter.com/', '') OR
          th.x_username = REPLACE(dc.designated_twitter, 'x.com/', '')
        ))
      WHERE dc.verified_wallet IS NULL
        AND th.wallet_address IS NOT NULL
      LIMIT 10;
    `;

    const matchResult = await pool.query(socialMatchQuery);

    if (matchResult.rows.length > 0) {
      console.log('\nFound potential matches from token_holders:');
      matchResult.rows.forEach(row => {
        console.log(`Token: ${row.token_address.slice(0, 10)}... Twitter: ${row.designated_twitter} -> Wallet: ${row.wallet_address?.slice(0, 10)}...`);
      });
    }

    // Since we don't have a direct Privy users table, we need to create a different approach
    // We'll create a manual mapping table or API endpoint to verify users

    console.log('\n⚠️  Note: To properly backfill verified wallets, we need one of the following:');
    console.log('1. A Privy users table that stores wallet-to-social mappings');
    console.log('2. Access to Privy API to fetch user data');
    console.log('3. Users to log in through the app to trigger verification');

    console.log('\nFor now, users with designated tokens need to:');
    console.log('1. Log in to Combinator with their social accounts');
    console.log('2. The system will automatically verify and link their wallets');
    console.log('3. They can then claim their designated tokens');

    // Create a report of all unverified claims
    const reportQuery = `
      SELECT
        tl.token_name,
        tl.token_symbol,
        dc.token_address,
        dc.original_launcher,
        dc.designated_twitter,
        dc.designated_github,
        dc.created_at
      FROM designated_claims dc
      JOIN token_launches tl ON dc.token_address = tl.token_address
      WHERE dc.verified_wallet IS NULL
      ORDER BY dc.created_at DESC
    `;

    const reportResult = await pool.query(reportQuery);

    console.log('\n=== Unverified Designated Claims Report ===\n');
    console.log(`Total: ${reportResult.rows.length} tokens waiting for verification\n`);

    reportResult.rows.slice(0, 10).forEach((row, index) => {
      console.log(`${index + 1}. ${row.token_name || 'Unknown'} (${row.token_symbol || 'N/A'})`);
      console.log(`   Token: ${row.token_address}`);
      console.log(`   Original Launcher: ${row.original_launcher}`);
      if (row.designated_twitter) {
        console.log(`   Designated Twitter: ${row.designated_twitter}`);
      }
      if (row.designated_github) {
        console.log(`   Designated GitHub: ${row.designated_github}`);
      }
      console.log(`   Designated on: ${new Date(row.created_at).toLocaleDateString()}\n`);
    });

    if (reportResult.rows.length > 10) {
      console.log(`... and ${reportResult.rows.length - 10} more tokens\n`);
    }

  } catch (error) {
    console.error('Error during backfill:', error);
  } finally {
    await pool.end();
  }
}

// Run the backfill
backfillVerifiedWallets()
  .then(() => {
    console.log('\nBackfill process completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });