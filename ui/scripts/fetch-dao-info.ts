/**
 * Fetch DAO information from the API
 *
 * Retrieves DAO details including admin_wallet, mint_auth_multisig, and other
 * configuration needed for subsequent operations.
 *
 * Usage:
 *   API_URL=https://api.zcombinator.io DAO_PDA="<dao-pda>" pnpm tsx scripts/fetch-dao-info.ts
 *
 * Required ENV:
 *   - API_URL: API base URL (https://api.zcombinator.io)
 *   - DAO_PDA: The DAO PDA address
 */
import 'dotenv/config';

const API_URL = process.env.API_URL;
const DAO_PDA = process.env.DAO_PDA;

if (!API_URL) throw new Error('API_URL is required');
if (!DAO_PDA) throw new Error('DAO_PDA is required');

interface DaoInfo {
  dao_pda: string;
  dao_name: string;
  dao_type: 'parent' | 'child';
  moderator_pda: string;
  owner_wallet: string;
  admin_wallet: string;
  token_mint: string;
  pool_address: string;
  pool_type: 'damm' | 'dlmm';
  quote_mint: string;
  treasury_multisig: string;
  mint_auth_multisig: string;
  treasury_cosigner: string;
  parent_dao_id?: number;
  proposer_token_threshold?: string;
  withdrawal_percentage: number;
  created_at: string;
  stats: {
    proposal_count: number;
    child_dao_count: number;
  };
  proposers: Array<{
    proposer_wallet: string;
    added_by: string;
  }>;
  children?: Array<{
    dao_pda: string;
    dao_name: string;
  }>;
}

async function main() {
  console.log('=== Fetch DAO Info ===\n');
  console.log(`API URL: ${API_URL}`);
  console.log(`DAO PDA: ${DAO_PDA}`);
  console.log('');

  const response = await fetch(`${API_URL}/dao/${DAO_PDA}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`API error: ${response.status} - ${JSON.stringify(error)}`);
  }

  const dao: DaoInfo = await response.json();

  console.log('DAO Details:');
  console.log('─'.repeat(50));
  console.log(`  Name:              ${dao.dao_name}`);
  console.log(`  Type:              ${dao.dao_type}`);
  console.log(`  DAO PDA:           ${dao.dao_pda}`);
  console.log(`  Moderator PDA:     ${dao.moderator_pda}`);
  console.log('');
  console.log('Wallets & Multisigs:');
  console.log('─'.repeat(50));
  console.log(`  Admin Wallet:      ${dao.admin_wallet}`);
  console.log(`  Mint Auth Multisig: ${dao.mint_auth_multisig}`);
  console.log(`  Treasury Multisig: ${dao.treasury_multisig}`);
  console.log(`  Treasury Cosigner: ${dao.treasury_cosigner}`);
  console.log('');
  console.log('Token & Pool:');
  console.log('─'.repeat(50));
  console.log(`  Token Mint:        ${dao.token_mint}`);
  console.log(`  Pool Address:      ${dao.pool_address}`);
  console.log(`  Pool Type:         ${dao.pool_type}`);
  console.log(`  Quote Mint:        ${dao.quote_mint}`);
  console.log('');
  console.log('Configuration:');
  console.log('─'.repeat(50));
  console.log(`  Withdrawal %:      ${dao.withdrawal_percentage}%`);
  console.log(`  Proposer Threshold: ${dao.proposer_token_threshold || 'None'}`);
  console.log('');
  console.log('Stats:');
  console.log('─'.repeat(50));
  console.log(`  Proposals:         ${dao.stats.proposal_count}`);
  console.log(`  Child DAOs:        ${dao.stats.child_dao_count}`);
  console.log('');

  if (dao.proposers.length > 0) {
    console.log(`Proposers (${dao.proposers.length}):`);
    console.log('─'.repeat(50));
    for (const p of dao.proposers) {
      console.log(`  - ${p.proposer_wallet}`);
    }
    console.log('');
  }

  if (dao.children && dao.children.length > 0) {
    console.log(`Child DAOs (${dao.children.length}):`);
    console.log('─'.repeat(50));
    for (const child of dao.children) {
      console.log(`  - ${child.dao_name}: ${child.dao_pda}`);
    }
    console.log('');
  }

  // Output key values for scripting
  console.log('For use in other scripts:');
  console.log('─'.repeat(50));
  console.log(`  ADMIN_WALLET="${dao.admin_wallet}"`);
  console.log(`  MINT_AUTH_MULTISIG="${dao.mint_auth_multisig}"`);
  console.log(`  MODERATOR_PDA="${dao.moderator_pda}"`);
  console.log(`  POOL_ADDRESS="${dao.pool_address}"`);
  console.log(`  TOKEN_MINT="${dao.token_mint}"`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
