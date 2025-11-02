import {
  Connection,
  PublicKey,
  Transaction,
  LAMPORTS_PER_SOL,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import BN from 'bn.js';
import { Token, WindowWithWallets } from '../types';
import { getTokenDecimals, getTokenMint } from '../utils/tokenUtils';
import { getSwapRoute, findMultiHopRoute } from '../utils/routingUtils';
import { getPoolInfo, getPoolsForRoute } from '../utils/poolUtils';
import {
  SOL_RENT_BUFFER,
  MAX_TRANSACTION_SIZE,
  TRANSACTION_SPLIT_DELAY,
  CONFIRMATION_TIMEOUT_ATTEMPTS,
  CONFIRMATION_DELAY_MS,
  ALT_ADDRESS,
} from '../constants';

export interface SwapParams {
  connection: Connection;
  wallet: PublicKey;
  fromToken: Token;
  toToken: Token;
  amount: string;
  slippage: number;
  isMaxAmount: boolean;
  walletProvider?: any; // Privy wallet provider
}

export interface SwapResult {
  signature: string;
  outputAmount?: string;
}

/**
 * Execute a swap between any two tokens
 * This works generically for any token pair with configured pools
 */
export async function executeSwap(params: SwapParams): Promise<SwapResult> {
  const { connection, wallet, fromToken, toToken, amount, slippage, isMaxAmount, walletProvider } = params;

  const route = getSwapRoute(fromToken, toToken);
  if (route === 'invalid') {
    throw new Error(`No route available for ${fromToken} -> ${toToken}`);
  }

  // Get the full token path
  const maxHops = route === 'direct-cp' || route === 'direct-dbc' ? 1 :
                  route === 'double' ? 2 : 3;
  const tokenPath = findMultiHopRoute(fromToken, toToken, maxHops);

  if (!tokenPath) {
    throw new Error(`No route found for ${fromToken} -> ${toToken}`);
  }

  // Calculate input amount
  const fromDecimals = getTokenDecimals(fromToken);
  let amountIn: BN;

  if (isMaxAmount && fromToken !== 'SOL') {
    const tokenMint = getTokenMint(fromToken);
    const ata = await getAssociatedTokenAddress(tokenMint, wallet, true);
    const account = await getAccount(connection, ata);
    amountIn = new BN(account.amount.toString());
  } else if (isMaxAmount && fromToken === 'SOL') {
    const solBalance = await connection.getBalance(wallet);
    const rentBuffer = SOL_RENT_BUFFER * LAMPORTS_PER_SOL;
    amountIn = new BN(Math.max(0, solBalance - rentBuffer));
  } else {
    const amountFloat = parseFloat(amount);
    const multiplier = Math.pow(10, fromDecimals);
    const amountRaw = Math.floor(amountFloat * multiplier);
    amountIn = new BN(amountRaw.toString());
  }

  const pools = await getPoolsForRoute(tokenPath, connection);

  // Determine execution strategy based on number of hops
  if (pools.length === 1) {
    // Direct swap
    return await executeDirectSwap(connection, wallet, tokenPath, pools, amountIn, slippage, walletProvider);
  } else if (pools.length === 2) {
    // Double hop
    return await executeDoubleHopSwap(connection, wallet, tokenPath, pools, amountIn, slippage, walletProvider);
  } else {
    // Triple hop (use versioned transaction with ALT)
    return await executeTripleHopSwap(connection, wallet, tokenPath, pools, amountIn, slippage, walletProvider);
  }
}

/**
 * Execute a direct (single-hop) swap
 */
async function executeDirectSwap(
  connection: Connection,
  wallet: PublicKey,
  tokenPath: Token[],
  pools: Array<{ address: string; type: 'cp-amm' | 'dbc'; swapBaseForQuote: boolean }>,
  amountIn: BN,
  slippage: number,
  walletProvider: any
): Promise<SwapResult> {
  const pool = pools[0];
  const fromToken = tokenPath[0];
  const toToken = tokenPath[1];

  let transaction: Transaction;

  if (pool.type === 'cp-amm') {
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm._program.account.pool.fetch(new PublicKey(pool.address));
    const currentTime = Math.floor(Date.now() / 1000);
    const currentSlot = await connection.getSlot();

    const fromDec = getTokenDecimals(fromToken);
    const toDec = getTokenDecimals(toToken);

    const quote = cpAmm.getQuote({
      inAmount: amountIn,
      inputTokenMint: getTokenMint(fromToken),
      slippage: slippage,
      poolState: poolState,
      currentTime,
      currentSlot,
      tokenADecimal: fromDec,
      tokenBDecimal: toDec,
    });

    transaction = await cpAmm.swap({
      payer: wallet,
      pool: new PublicKey(pool.address),
      inputTokenMint: getTokenMint(fromToken),
      outputTokenMint: getTokenMint(toToken),
      amountIn: amountIn,
      minimumAmountOut: quote.minSwapOutAmount,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount: null,
    });
  } else {
    // DBC swap
    const dbcClient = new DynamicBondingCurveClient(connection, 'confirmed');

    // Get quote to calculate minimum output
    const poolState = await dbcClient.state.getPool(pool.address);
    const config = await dbcClient.state.getPoolConfig(poolState.config);
    const quote = dbcClient.pool.swapQuote({
      virtualPool: poolState,
      config: config,
      swapBaseForQuote: pool.swapBaseForQuote,
      amountIn: amountIn,
      hasReferral: false,
      currentPoint: poolState.activationPoint,
    });

    // Calculate minimum output with slippage
    const slippageBps = slippage * 100; // Convert to basis points
    const minOutput = quote.outputAmount.mul(new BN(10000 - slippageBps)).div(new BN(10000));

    transaction = await dbcClient.pool.swap({
      owner: wallet,
      pool: new PublicKey(pool.address),
      amountIn: amountIn,
      minimumAmountOut: minOutput,
      swapBaseForQuote: pool.swapBaseForQuote,
      referralTokenAccount: null,
    });
  }

  const signature = await signAndSendTransaction(transaction, walletProvider, connection);
  await waitForConfirmation(connection, signature);

  return { signature };
}

/**
 * Execute a double-hop swap
 */
async function executeDoubleHopSwap(
  connection: Connection,
  wallet: PublicKey,
  tokenPath: Token[],
  pools: Array<{ address: string; type: 'cp-amm' | 'dbc'; swapBaseForQuote: boolean }>,
  amountIn: BN,
  slippage: number,
  walletProvider: any
): Promise<SwapResult> {
  const cpAmm = new CpAmm(connection);
  const dbcClient = new DynamicBondingCurveClient(connection, 'confirmed');

  // Build both swap transactions
  const transactions: Transaction[] = [];

  let currentAmount = amountIn;

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    const fromToken = tokenPath[i];
    const toToken = tokenPath[i + 1];

    let tx: Transaction;

    if (pool.type === 'cp-amm') {
      const poolState = await cpAmm._program.account.pool.fetch(new PublicKey(pool.address));
      const currentTime = Math.floor(Date.now() / 1000);
      const currentSlot = await connection.getSlot();

      const fromDec = getTokenDecimals(fromToken);
      const toDec = getTokenDecimals(toToken);

      const quote = cpAmm.getQuote({
        inAmount: currentAmount,
        inputTokenMint: getTokenMint(fromToken),
        slippage: slippage,
        poolState: poolState,
        currentTime,
        currentSlot,
        tokenADecimal: fromDec,
        tokenBDecimal: toDec,
      });

      tx = await cpAmm.swap({
        payer: wallet,
        pool: new PublicKey(pool.address),
        inputTokenMint: getTokenMint(fromToken),
        outputTokenMint: getTokenMint(toToken),
        amountIn: currentAmount,
        minimumAmountOut: quote.minSwapOutAmount,
        tokenAMint: poolState.tokenAMint,
        tokenBMint: poolState.tokenBMint,
        tokenAVault: poolState.tokenAVault,
        tokenBVault: poolState.tokenBVault,
        tokenAProgram: TOKEN_PROGRAM_ID,
        tokenBProgram: TOKEN_PROGRAM_ID,
        referralTokenAccount: null,
      });

      currentAmount = quote.swapOutAmount;
    } else {
      const poolState = await dbcClient.state.getPool(pool.address);
      const config = await dbcClient.state.getPoolConfig(poolState.config);

      const quote = dbcClient.pool.swapQuote({
        virtualPool: poolState,
        config: config,
        swapBaseForQuote: pool.swapBaseForQuote,
        amountIn: currentAmount,
        hasReferral: false,
        currentPoint: poolState.activationPoint,
      });

      // Calculate minimum output with slippage
      const slippageBps = slippage * 100; // Convert to basis points
      const minOutput = quote.outputAmount.mul(new BN(10000 - slippageBps)).div(new BN(10000));

      tx = await dbcClient.pool.swap({
        owner: wallet,
        pool: new PublicKey(pool.address),
        amountIn: currentAmount,
        minimumAmountOut: minOutput,
        swapBaseForQuote: pool.swapBaseForQuote,
        referralTokenAccount: null,
      });

      currentAmount = quote.outputAmount;
    }

    transactions.push(tx);
  }

  // Try to combine into single transaction
  const combinedTx = new Transaction();
  for (const tx of transactions) {
    combinedTx.add(...tx.instructions);
  }

  // Set blockhash and fee payer before checking size
  const { blockhash: testBlockhash } = await connection.getLatestBlockhash('confirmed');
  combinedTx.recentBlockhash = testBlockhash;
  combinedTx.feePayer = wallet;

  const serialized = combinedTx.serialize({ requireAllSignatures: false, verifySignatures: false });

  if (serialized.length > MAX_TRANSACTION_SIZE) {
    // Use versioned transaction with ALT to compress size
    console.log('Transaction too large, using versioned transaction with ALT');

    try {
      const altAccount = await connection.getAddressLookupTable(new PublicKey(ALT_ADDRESS));
      if (!altAccount.value) {
        throw new Error('ALT not found');
      }

      const allInstructions = transactions.flatMap(tx => tx.instructions);
      const { blockhash } = await connection.getLatestBlockhash('confirmed');

      const messageV0 = new TransactionMessage({
        payerKey: wallet,
        recentBlockhash: blockhash,
        instructions: allInstructions,
      }).compileToV0Message([altAccount.value]);

      const versionedTx = new VersionedTransaction(messageV0);

      // Sign and send versioned transaction
      if (walletProvider?.signAndSendTransaction) {
        const result = await walletProvider.signAndSendTransaction(versionedTx);
        const signature = result.signature;
        await waitForConfirmation(connection, signature);
        return { signature };
      } else {
        throw new Error('Wallet does not support versioned transactions');
      }
    } catch (error) {
      console.error('Failed to use versioned transaction with ALT:', error);
      throw new Error('Transaction too large and ALT compression failed. Cannot execute swap.');
    }
  } else {
    // Execute as single transaction
    const signature = await signAndSendTransaction(combinedTx, walletProvider, connection);
    await waitForConfirmation(connection, signature);
    return { signature };
  }
}

/**
 * Execute a triple-hop swap using versioned transaction with ALT
 */
async function executeTripleHopSwap(
  connection: Connection,
  wallet: PublicKey,
  tokenPath: Token[],
  pools: Array<{ address: string; type: 'cp-amm' | 'dbc'; swapBaseForQuote: boolean }>,
  amountIn: BN,
  slippage: number,
  walletProvider: any
): Promise<SwapResult> {
  const cpAmm = new CpAmm(connection);
  const dbcClient = new DynamicBondingCurveClient(connection, 'confirmed');

  // Build all swap transactions
  const transactions: Transaction[] = [];
  let currentAmount = amountIn;

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    const fromToken = tokenPath[i];
    const toToken = tokenPath[i + 1];

    let tx: Transaction;

    if (pool.type === 'cp-amm') {
      const poolState = await cpAmm._program.account.pool.fetch(new PublicKey(pool.address));
      const currentTime = Math.floor(Date.now() / 1000);
      const currentSlot = await connection.getSlot();

      const fromDec = getTokenDecimals(fromToken);
      const toDec = getTokenDecimals(toToken);

      const quote = cpAmm.getQuote({
        inAmount: currentAmount,
        inputTokenMint: getTokenMint(fromToken),
        slippage: slippage,
        poolState: poolState,
        currentTime,
        currentSlot,
        tokenADecimal: fromDec,
        tokenBDecimal: toDec,
      });

      tx = await cpAmm.swap({
        payer: wallet,
        pool: new PublicKey(pool.address),
        inputTokenMint: getTokenMint(fromToken),
        outputTokenMint: getTokenMint(toToken),
        amountIn: currentAmount,
        minimumAmountOut: quote.minSwapOutAmount,
        tokenAMint: poolState.tokenAMint,
        tokenBMint: poolState.tokenBMint,
        tokenAVault: poolState.tokenAVault,
        tokenBVault: poolState.tokenBVault,
        tokenAProgram: TOKEN_PROGRAM_ID,
        tokenBProgram: TOKEN_PROGRAM_ID,
        referralTokenAccount: null,
      });

      currentAmount = quote.swapOutAmount;
    } else {
      const poolState = await dbcClient.state.getPool(pool.address);
      const config = await dbcClient.state.getPoolConfig(poolState.config);

      const quote = dbcClient.pool.swapQuote({
        virtualPool: poolState,
        config: config,
        swapBaseForQuote: pool.swapBaseForQuote,
        amountIn: currentAmount,
        hasReferral: false,
        currentPoint: poolState.activationPoint,
      });

      // Calculate minimum output with slippage
      const slippageBps = slippage * 100; // Convert to basis points
      const minOutput = quote.outputAmount.mul(new BN(10000 - slippageBps)).div(new BN(10000));

      tx = await dbcClient.pool.swap({
        owner: wallet,
        pool: new PublicKey(pool.address),
        amountIn: currentAmount,
        minimumAmountOut: minOutput,
        swapBaseForQuote: pool.swapBaseForQuote,
        referralTokenAccount: null,
      });

      currentAmount = quote.outputAmount;
    }

    transactions.push(tx);
  }

  // Try to use versioned transaction with ALT
  const altAccount = await connection.getAddressLookupTable(new PublicKey(ALT_ADDRESS));
  if (!altAccount.value) {
    throw new Error('ALT not found');
  }

  const allInstructions = transactions.flatMap(tx => tx.instructions);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const messageV0 = new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: blockhash,
    instructions: allInstructions,
  }).compileToV0Message([altAccount.value]);

  const versionedTx = new VersionedTransaction(messageV0);

  // Sign and send versioned transaction
  const result = await walletProvider.signAndSendTransaction(versionedTx);
  const signature = result.signature;
  await waitForConfirmation(connection, signature);
  return { signature };
}

/**
 * Sign and send a transaction
 */
async function signAndSendTransaction(
  transaction: Transaction,
  walletProvider: any,
  connection: Connection
): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = walletProvider.publicKey || walletProvider.wallet?.address;

  if (walletProvider?.sendTransaction) {
    // Privy wallet
    const signature = await walletProvider.sendTransaction(transaction, connection);
    return signature;
  } else {
    // Browser wallet
    const windowWithWallets = window as WindowWithWallets;
    const browserWallet = windowWithWallets.solana || windowWithWallets.solflare;

    if (!browserWallet) {
      throw new Error('No wallet found');
    }

    const result = await browserWallet.signAndSendTransaction(transaction);
    return result.signature;
  }
}

/**
 * Wait for transaction confirmation
 */
async function waitForConfirmation(connection: Connection, signature: string): Promise<void> {
  let attempts = 0;

  while (attempts < CONFIRMATION_TIMEOUT_ATTEMPTS) {
    const result = await connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });

    if (result?.value) {
      if (result.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
      }

      if (
        result.value.confirmationStatus === 'confirmed' ||
        result.value.confirmationStatus === 'finalized'
      ) {
        return;
      }
    }

    attempts++;
    await new Promise(resolve => setTimeout(resolve, CONFIRMATION_DELAY_MS));
  }

  throw new Error('Transaction confirmation timeout');
}
