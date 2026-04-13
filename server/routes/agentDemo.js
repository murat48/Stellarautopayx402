import { Router } from 'express';
import { Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { x402Client, x402HTTPClient } from '@x402/fetch';
import { createEd25519Signer, getNetworkPassphrase } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import { getAgentPublicKey, fetchBalances, getAllBills, getPaymentHistory } from '../services/sorobanService.js';
import config from '../config.js';

const NETWORK = 'stellar:testnet';
const STELLAR_RPC_URL = config.rpcUrl;
const networkPassphrase = getNetworkPassphrase(NETWORK);

const router = Router();

/**
 * GET /agent/demo — Free demo endpoint (no x402) for hackathon presentation.
 * Shows the full system state: agent wallet, bills, payment history, API info.
 */
router.get('/demo', async (_req, res) => {
  const result = {
    project: {
      name: 'Stellar Autopay',
      tagline: 'Automated recurring payments on Stellar with x402 Agentic Payments',
      network: config.network,
      contractId: config.contractId,
    },
    agentApi: {
      status: 'online',
      facilitator: config.facilitatorUrl,
      protocol: 'x402',
      description: 'AI agents pay micro-USDC per API call using x402 protocol',
    },
    steps: [],
    timestamp: new Date().toISOString(),
  };

  // Step 1: Agent identity
  let agentPublicKey = null;
  try {
    agentPublicKey = getAgentPublicKey();
    result.steps.push({
      step: 1,
      label: '🔑 Agent Wallet Loaded',
      status: 'success',
      data: { address: agentPublicKey },
    });
  } catch (err) {
    result.steps.push({ step: 1, label: '🔑 Agent Wallet', status: 'error', error: err.message });
    return res.json(result);
  }

  // Step 2: Balance
  try {
    const balances = await fetchBalances(agentPublicKey);
    result.steps.push({
      step: 2,
      label: '💰 Agent Balance Fetched',
      status: 'success',
      data: { balances, address: agentPublicKey },
    });
  } catch (err) {
    result.steps.push({ step: 2, label: '💰 Agent Balance', status: 'error', error: err.message });
  }

  // Step 3: Bills
  try {
    const bills = await getAllBills(agentPublicKey);
    result.steps.push({
      step: 3,
      label: `📋 Bills Fetched (${bills.length} total)`,
      status: 'success',
      data: { count: bills.length, bills: bills.slice(0, 3) },
    });
  } catch (err) {
    result.steps.push({ step: 3, label: '📋 Bills', status: 'error', error: err.message });
  }

  // Step 4: Payment history
  try {
    const history = await getPaymentHistory(agentPublicKey);
    result.steps.push({
      step: 4,
      label: `📜 Payment History (${history.length} records)`,
      status: 'success',
      data: { count: history.length, recent: history.slice(0, 3) },
    });
  } catch (err) {
    result.steps.push({ step: 4, label: '📜 Payment History', status: 'error', error: err.message });
  }

  // Step 5: Real live x402 micropayment (client wallet → agent wallet → Stellar testnet)
  if (config.clientSecretKey) {
    try {
      const signer = createEd25519Signer(config.clientSecretKey, NETWORK);
      const client = new x402Client().register(
        'stellar:*',
        new ExactStellarScheme(signer, { url: STELLAR_RPC_URL }),
      );
      const httpClient = new x402HTTPClient(client);

      const url = `http://localhost:${config.port}/agent/bills`;

      // 1st request — expect 402
      const firstTry = await fetch(url);
      if (firstTry.status !== 402) throw new Error(`Expected 402, got ${firstTry.status}`);

      // Parse payment requirements
      const paymentRequired = httpClient.getPaymentRequiredResponse(
        (name) => firstTry.headers.get(name),
      );

      // Build payment payload
      let paymentPayload = await client.createPaymentPayload(paymentRequired);

      // Fix fee for testnet facilitator
      const tx = new Transaction(paymentPayload.payload.transaction, networkPassphrase);
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
            }).build().toXDR(),
          },
        };
      }

      // Retry with signed x402 payment header
      const paidResponse = await fetch(url, {
        headers: httpClient.encodePaymentSignatureHeader(paymentPayload),
      });

      if (!paidResponse.ok) throw new Error(`Paid request failed: ${paidResponse.status}`);

      // Parse settlement (tx hash)
      const settlement = httpClient.getPaymentSettleResponse(
        (name) => paidResponse.headers.get(name),
      );
      const rawHash = settlement?.transaction ?? settlement?.txHash ?? settlement?.hash ?? null;

      result.steps.push({
        step: 5,
        label: '⚡ Live x402 Payment Settled on Stellar Testnet',
        status: 'success',
        data: {
          endpoint: '/agent/bills',
          amount: '0.001 USDC',
          payer: signer.address,
          receiver: agentPublicKey,
          txHash: rawHash,
          explorerUrl: rawHash ? `https://stellar.expert/explorer/testnet/tx/${rawHash}` : null,
        },
      });

      result.livePayment = {
        txHash: rawHash,
        explorerUrl: rawHash ? `https://stellar.expert/explorer/testnet/tx/${rawHash}` : null,
        payer: signer.address,
        receiver: agentPublicKey,
        amount: '0.001 USDC',
      };
    } catch (err) {
      result.steps.push({ step: 5, label: '⚡ Live x402 Payment', status: 'error', error: err.message });
    }
  }

  result.agentApi.agentAddress = agentPublicKey;
  result.agentApi.explorerUrl = `https://stellar.expert/explorer/testnet/account/${agentPublicKey}`;

  res.json(result);
});

export default router;
