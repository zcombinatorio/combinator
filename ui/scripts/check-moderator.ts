/**
 * Check moderator state
 */
import 'dotenv/config';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const MODERATOR_PDA = process.env.MODERATOR_PDA || '7Cywqa4iE9B2E4DVBuWPUS5gjwtzefX3UPjP4zY44CUx';
const FUTARCHY_PROGRAM_ID = new PublicKey('FUTKPrt66uGGCTpk6f9tmRX2325cWgXzGCwvWhyyzjea');

async function main() {
  const RPC_URL = process.env.RPC_URL;
  const PROTOCOL_PRIVATE_KEY = process.env.PROTOCOL_PRIVATE_KEY;
  if (!RPC_URL || !PROTOCOL_PRIVATE_KEY) throw new Error('RPC_URL and PROTOCOL_PRIVATE_KEY required');

  const connection = new Connection(RPC_URL, 'confirmed');

  // Check moderator account
  const moderatorInfo = await connection.getAccountInfo(new PublicKey(MODERATOR_PDA));
  if (!moderatorInfo) {
    console.log('Moderator account does not exist');
    return;
  }

  console.log('Moderator PDA:', MODERATOR_PDA);
  console.log('Account owner:', moderatorInfo.owner.toBase58());
  console.log('Data size:', moderatorInfo.data.length, 'bytes');

  // Read proposalIdCounter from the account data
  // Moderator struct layout (approximate):
  // 8 bytes: discriminator
  // 32 bytes: admin
  // 32 bytes: base_mint
  // 32 bytes: quote_mint
  // 2 bytes: proposal_id_counter (u16)
  // ... rest
  const data = moderatorInfo.data;
  const proposalIdCounter = data.readUInt16LE(8 + 32 + 32 + 32);
  console.log('Proposal ID Counter:', proposalIdCounter);

  // Check if proposal 0 exists
  const proposalIdBuffer = Buffer.alloc(2);
  proposalIdBuffer.writeUInt16LE(0);
  const [proposalPda0] = PublicKey.findProgramAddressSync(
    [Buffer.from('proposal'), new PublicKey(MODERATOR_PDA).toBuffer(), proposalIdBuffer],
    FUTARCHY_PROGRAM_ID
  );
  console.log('');
  console.log('Proposal 0 PDA:', proposalPda0.toBase58());
  const proposal0Info = await connection.getAccountInfo(proposalPda0);
  console.log('Proposal 0 exists:', proposal0Info !== null);

  // Check if proposal 1 exists
  proposalIdBuffer.writeUInt16LE(1);
  const [proposalPda1] = PublicKey.findProgramAddressSync(
    [Buffer.from('proposal'), new PublicKey(MODERATOR_PDA).toBuffer(), proposalIdBuffer],
    FUTARCHY_PROGRAM_ID
  );
  console.log('Proposal 1 PDA:', proposalPda1.toBase58());
  const proposal1Info = await connection.getAccountInfo(proposalPda1);
  console.log('Proposal 1 exists:', proposal1Info !== null);
}

main().catch(console.error);
