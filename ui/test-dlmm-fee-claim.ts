import axios from 'axios';
import { Connection, Keypair, Transaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import 'dotenv/config';

/**
 * Test script for the DLMM fee claim API endpoints
 *
 * Tests claiming fees from a Meteora DLMM pool and distributing
 * them to configured recipients.
 *
 * Required ENV variables:
 * - PAYER_PRIVATE_KEY: Private key of wallet to pay transaction fees (Base58)
 * - RPC_URL: Solana RPC endpoint (required for simulation mode)
 *
 * Optional ENV variables:
 * - API_URL: Base URL for API (defaults to http://localhost:6770)
 */

// Pool address to claim fees from (ZC DLMM pool)
const POOL_ADDRESS = '7jbhVZcYqCRmciBcZzK8L5B96Pyw7i1SpXQFKBkzD3G2';

// Set to true to simulate the transaction instead of submitting to /confirm
const SIMULATE_ONLY = true;

async function testDlmmFeeClaim() {
  // Configuration
  const API_URL = process.env.API_URL || 'https://api.zcombinator.io/' || 'http://localhost:6770';
  const PAYER_PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY;
  const RPC_URL = process.env.RPC_URL;

  // Validate private key is provided
  if (!PAYER_PRIVATE_KEY) {
    console.error('✗ Error: PAYER_PRIVATE_KEY environment variable is required');
    console.error('Usage: PAYER_PRIVATE_KEY=<base58-private-key> tsx test-dlmm-fee-claim.ts');
    process.exit(1);
  }

  if (SIMULATE_ONLY && !RPC_URL) {
    console.error('✗ Error: RPC_URL environment variable is required for simulation mode');
    process.exit(1);
  }

  // Create keypair from private key and derive the public key from it
  const payerKeypair = Keypair.fromSecretKey(bs58.decode(PAYER_PRIVATE_KEY));
  const PAYER_PUBLIC_KEY = payerKeypair.publicKey.toBase58();

  console.log('Testing DLMM Fee Claim Endpoint');
  console.log('===============================');
  console.log(`Mode: ${SIMULATE_ONLY ? 'SIMULATION' : 'LIVE'}`);
  console.log(`API URL: ${API_URL}`);
  console.log(`Pool Address: ${POOL_ADDRESS}`);
  console.log(`Payer Public Key: ${PAYER_PUBLIC_KEY}`);
  console.log();

  try {
    // Step 1: Call the /dlmm-fee-claim/claim endpoint
    console.log('Step 1: Calling /dlmm-fee-claim/claim...');
    const claimResponse = await axios.post(`${API_URL}/dlmm-fee-claim/claim`, {
      payerPublicKey: PAYER_PUBLIC_KEY,
      poolAddress: POOL_ADDRESS
    });

    console.log('\nClaim response received:');
    console.log(JSON.stringify(claimResponse.data, null, 2));

    if (!claimResponse.data.success) {
      console.error('\n✗ Claim failed');
      return;
    }

    console.log('\n✓ Claim successful!');
    console.log(`Request ID: ${claimResponse.data.requestId}`);
    console.log(`Pool Address: ${claimResponse.data.poolAddress}`);
    console.log(`Token X Mint: ${claimResponse.data.tokenXMint}`);
    console.log(`Token Y Mint: ${claimResponse.data.tokenYMint}`);
    console.log(`Token X is native SOL: ${claimResponse.data.isTokenXNativeSOL}`);
    console.log(`Token Y is native SOL: ${claimResponse.data.isTokenYNativeSOL}`);
    console.log(`Position: ${claimResponse.data.positionAddress}`);
    console.log(`Total Positions: ${claimResponse.data.totalPositions}`);
    console.log(`Transaction Count: ${claimResponse.data.transactionCount}`);
    console.log(`Total Instructions: ${claimResponse.data.instructionsCount}`);
    console.log(`Estimated Fees:`);
    console.log(`  Token X: ${claimResponse.data.estimatedFees.tokenX}`);
    console.log(`  Token Y: ${claimResponse.data.estimatedFees.tokenY}`);
    console.log(`Fee Recipients:`);
    for (const recipient of claimResponse.data.feeRecipients) {
      console.log(`  ${recipient.address}: ${recipient.percent}%`);
    }

    // Step 2: Sign all transactions
    console.log(`\nStep 2: Signing ${claimResponse.data.transactionCount} transactions...`);
    const unsignedTransactions = claimResponse.data.transactions as string[];
    const requestId = claimResponse.data.requestId;

    const signedTransactions: string[] = [];
    const transactions: Transaction[] = [];

    for (let i = 0; i < unsignedTransactions.length; i++) {
      // Deserialize the transaction
      const transactionBuffer = bs58.decode(unsignedTransactions[i]);
      const transaction = Transaction.from(transactionBuffer);
      transactions.push(transaction);

      // Sign with the payer keypair
      transaction.partialSign(payerKeypair);

      // Serialize the signed transaction (requireAllSignatures: false because LP owner hasn't signed yet)
      signedTransactions.push(bs58.encode(transaction.serialize({ requireAllSignatures: false })));
      console.log(`  ✓ Transaction ${i + 1}/${unsignedTransactions.length} signed`);
    }

    console.log('✓ All transactions signed');

    if (SIMULATE_ONLY) {
      // Step 3: Simulate each transaction
      console.log('\nStep 3: Simulating transactions...');

      const connection = new Connection(RPC_URL!, 'confirmed');

      // Get fee recipients to check their balance changes
      const feeRecipients = claimResponse.data.feeRecipients as { address: string; percent: number }[];
      const recipientAddresses = feeRecipients.map(r => new PublicKey(r.address));

      // Get pre-simulation balances
      const preBalances: Record<string, number> = {};
      for (const addr of recipientAddresses) {
        preBalances[addr.toBase58()] = await connection.getBalance(addr);
      }

      for (let i = 0; i < transactions.length; i++) {
        const transaction = transactions[i];
        console.log(`\nSimulating transaction ${i + 1}/${transactions.length}...`);

        // Get a fresh blockhash and set it before simulation
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;

        // Re-sign after changing blockhash (signature covers blockhash)
        transaction.signatures = [];
        transaction.partialSign(payerKeypair);

        // Simulate
        const simulation = await connection.simulateTransaction(transaction);

        if (simulation.value.err) {
          console.log(`  ✗ Simulation failed:`);
          console.log(`    Error: ${JSON.stringify(simulation.value.err)}`);
        } else {
          console.log(`  ✓ Simulation successful`);
          console.log(`    Compute units: ${simulation.value.unitsConsumed}`);
        }

        if (simulation.value.logs) {
          console.log(`  Logs (first 5):`);
          for (const log of simulation.value.logs.slice(0, 5)) {
            console.log(`    ${log}`);
          }
          if (simulation.value.logs.length > 5) {
            console.log(`    ... and ${simulation.value.logs.length - 5} more`);
          }
        }
      }

      // Show balance changes after all simulations
      console.log('\nFinal balance changes would be:');
      for (const addr of recipientAddresses) {
        const currentBal = await connection.getBalance(addr);
        console.log(`  ${addr.toBase58()}: ${(currentBal / 1e9).toFixed(4)} SOL`);
      }

    } else {
      // Step 3: Submit to confirm endpoint
      console.log('\nStep 3: Calling /dlmm-fee-claim/confirm...');
      const confirmResponse = await axios.post(`${API_URL}/dlmm-fee-claim/confirm`, {
        signedTransactions,
        requestId
      });

      console.log('\nConfirm response received:');
      console.log(JSON.stringify(confirmResponse.data, null, 2));

      if (confirmResponse.data.success) {
        console.log('\n✓ Fee claim confirmed!');
        console.log(`Signatures: ${confirmResponse.data.signatures.join(', ')}`);
        console.log(`Transaction Count: ${confirmResponse.data.transactionCount}`);
        console.log(`Pool: ${confirmResponse.data.poolAddress}`);
        console.log(`Position: ${confirmResponse.data.positionAddress}`);
        console.log(`Claimed Fees:`);
        console.log(`  Token X: ${confirmResponse.data.estimatedFees.tokenX}`);
        console.log(`  Token Y: ${confirmResponse.data.estimatedFees.tokenY}`);
        console.log(`Fee Recipients:`);
        for (const recipient of confirmResponse.data.feeRecipients) {
          console.log(`  ${recipient.address}: ${recipient.percent}%`);
        }
        console.log(`\nSolscan links:`);
        for (const sig of confirmResponse.data.signatures) {
          console.log(`  https://solscan.io/tx/${sig}`);
        }
      }
    }

  } catch (error: any) {
    console.error('\n✗ Error occurred:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Error: ${JSON.stringify(error.response.data, null, 2)}`);
    } else if (error.request) {
      console.error('No response received from server');
      console.error(error.message);
    } else {
      console.error(error.message);
    }
  }
}

// Run the test
testDlmmFeeClaim();
