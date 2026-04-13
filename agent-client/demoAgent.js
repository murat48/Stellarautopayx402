/**
 * Demo Agent Client — x402 Protocol
 *
 * Demonstrates how an AI agent or external service can interact
 * with the Stellar Autopay Agent API using x402 micropayments.
 *
 * Flow:
 * 1. Call /agent/health (free) to discover endpoints and prices
 * 2. POST /agent/bills → get 402 → sign x402 payment → retry with X-PAYMENT header
 * 3. GET /agent/bills → list created bills (same x402 flow)
 * 4. GET /agent/balance → check wallet balance
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { x402Client, x402HTTPClient } from '@x402/fetch';
import { createEd25519Signer, getNetworkPassphrase } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';

dotenv.config({
  path: fileURLToPath(new URL('./.env', import.meta.url)),
  quiet: true,
});

const AGENT_SECRET_KEY = process.env.AGENT_SECRET_KEY;
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const NETWORK = 'stellar:testnet';
const STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';

if (!AGENT_SECRET_KEY) {
  console.error('❌ AGENT_SECRET_KEY is required in .env');
  process.exit(1);
}

// ─── x402 Client Setup ────────────────────────────────────────────────────
const signer = createEd25519Signer(AGENT_SECRET_KEY, NETWORK);
const rpcConfig = { url: STELLAR_RPC_URL };
const client = new x402Client().register(
  'stellar:*',
  new ExactStellarScheme(signer, rpcConfig),
);
const httpClient = new x402HTTPClient(client);
const networkPassphrase = getNetworkPassphrase(NETWORK);

/**
 * Make an x402-authenticated request.
 * First tries without payment, if 402 is returned, creates a payment payload and retries.
 */
async function x402Fetch(url, options = {}) {
  // First try
  const firstTry = await fetch(url, options);

  if (firstTry.status !== 402) {
    return firstTry;
  }

  console.log(`💰 Payment required for ${options.method || 'GET'} ${url}`);

  // Parse 402 response for payment requirements
  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => firstTry.headers.get(name),
  );

  // Create payment payload
  let paymentPayload = await client.createPaymentPayload(paymentRequired);

  // Fix fee for testnet facilitator
  const tx = new Transaction(
    paymentPayload.payload.transaction,
    networkPassphrase,
  );
  const sorobanData = tx.toEnvelope()?.v1()?.tx()?.ext()?.sorobanData();
  if (sorobanData) {
    paymentPayload = {
      ...paymentPayload,
      payload: {
        ...paymentPayload.payload,
        transaction: TransactionBuilder.cloneFrom(tx, {
          fee: '1',
          sorobanData,
          networkPassphrase,
        })
          .build()
          .toXDR(),
      },
    };
  }

  // Encode payment headers
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  // Retry with payment
  const paidResponse = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...paymentHeaders,
    },
  });

  const paymentResponse = httpClient.getPaymentSettleResponse(
    (name) => paidResponse.headers.get(name),
  );
  if (paymentResponse) {
    console.log('✅ Payment settled:', paymentResponse);
  }

  return paidResponse;
}

// ─── Demo Flow ─────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('  Stellar Autopay — x402 Agent Demo');
  console.log('='.repeat(60));
  console.log(`Client address: ${signer.address}`);
  console.log(`Server: ${SERVER_URL}\n`);

  // 1. Health check (free)
  console.log('─── Step 1: Health Check (free) ───');
  const healthRes = await fetch(`${SERVER_URL}/agent/health`);
  const health = await healthRes.json();
  console.log('Status:', health.status);
  console.log('Network:', health.network);
  console.log('Endpoints:', health.endpoints.length, 'available\n');

  // 2. Check balance
  console.log('─── Step 2: Check Balance (x402: $0.001) ───');
  const balanceRes = await x402Fetch(`${SERVER_URL}/agent/balance`);
  const balanceData = await balanceRes.json();
  console.log('Balance:', JSON.stringify(balanceData.balances), '\n');

  // 3. Create a bill
  console.log('─── Step 3: Create Bill (x402: $0.01) ───');
  const billRes = await x402Fetch(`${SERVER_URL}/agent/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Demo Server Hosting',
      recipientAddress: signer.address, // pay to self for demo
      amount: '10',
      asset: 'USDC',
      type: 'recurring',
      frequency: 'monthly',
      dayOfMonth: 15,
      nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  });
  const billData = await billRes.json();
  console.log('Created bill:', JSON.stringify(billData.bill, null, 2), '\n');

  // 4. List all bills
  console.log('─── Step 4: List Bills (x402: $0.001) ───');
  const listRes = await x402Fetch(`${SERVER_URL}/agent/bills`);
  const listData = await listRes.json();
  console.log(`Found ${listData.bills?.length || 0} bills\n`);

  // 5. Get payment history
  console.log('─── Step 5: Payment History (x402: $0.001) ───');
  const historyRes = await x402Fetch(`${SERVER_URL}/agent/history`);
  const historyData = await historyRes.json();
  console.log(`Found ${historyData.history?.length || 0} payment records\n`);

  console.log('='.repeat(60));
  console.log('  Demo complete!');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('❌ Demo failed:', err.message);
  process.exit(1);
});
