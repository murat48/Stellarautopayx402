/**
 * /api/panel/* — Frontend-facing proxy routes.
 *
 * The browser calls these (no x402 needed from the browser).
 * Each route internally uses the CLIENT wallet to make a real x402-signed
 * request to the corresponding /agent/* endpoint, then returns:
 *   { success, data, x402: { amount, payer, receiver, txHash, explorerUrl } }
 *
 * This means every action in the UI panel produces a real on-chain Stellar tx.
 */
import { Router } from 'express';
import { Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { x402Client, x402HTTPClient } from '@x402/fetch';
import { createEd25519Signer, getNetworkPassphrase } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import config from '../config.js';
import {
  getAgentPublicKey, getBill, sendPayment,
  markPaidForAgent, recordPaymentForAgent,
} from '../services/sorobanService.js';
import { getChatId, sendPaymentConfirmation, setDefaultChatId, getDefaultChatId } from '../services/telegramService.js';
import { invalidateBillsCache } from './agentBills.js';

const router = Router();

const NETWORK = 'stellar:testnet';
const networkPassphrase = getNetworkPassphrase(NETWORK);

// ─── Build x402 client once ────────────────────────────────────────────────
function buildX402Client() {
  if (!config.clientSecretKey) throw new Error('CLIENT_SECRET_KEY not configured');
  const signer = createEd25519Signer(config.clientSecretKey, NETWORK);
  const client = new x402Client().register(
    'stellar:*',
    new ExactStellarScheme(signer, { url: config.rpcUrl }),
  );
  const httpClient = new x402HTTPClient(client);
  return { signer, client, httpClient };
}

/**
 * Make an x402-signed request to a local /agent/* endpoint.
 * Returns { data, x402 } where x402 contains settlement info + txHash.
 */
async function x402Request(method, path, body = null) {
  const { signer, client, httpClient } = buildX402Client();
  const agentAddress = getAgentPublicKey();
  const url = `http://localhost:${config.port}${path}`;

  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  // First request — expect 402
  const firstTry = await fetch(url, opts);

  // If not protected (health/demo), just return data directly
  if (firstTry.status !== 402) {
    const data = await firstTry.json();
    return { data, x402: null };
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => firstTry.headers.get(name),
  );

  // Extract price from 402 response
  let priceStr = '';
  try {
    const header = firstTry.headers.get('X-PAYMENT-REQUIRED') || firstTry.headers.get('www-authenticate') || '';
    const amountMatch = header.match(/"maxAmountRequired"\s*:\s*"?([0-9.]+)/);
    priceStr = amountMatch ? amountMatch[1] : '';
  } catch { /* ignore */ }

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

  // Retry with payment headers
  const paidOpts = {
    ...opts,
    headers: {
      ...opts.headers,
      ...httpClient.encodePaymentSignatureHeader(paymentPayload),
    },
  };
  const paidResponse = await fetch(url, paidOpts);

  let data;
  try { data = await paidResponse.json(); } catch { data = {}; }

  // Parse settlement — some facilitators omit the header; don't throw
  let txHash = null;
  try {
    const settlement = httpClient.getPaymentSettleResponse(
      (name) => paidResponse.headers.get(name),
    );
    txHash = settlement?.transaction ?? settlement?.txHash ?? settlement?.hash ?? null;
  } catch { /* settlement header absent — treat as txHash unknown */ }

  return {
    data,
    x402: {
      amount: priceStr || '~0.001',
      payer: signer.address,
      receiver: agentAddress,
      txHash,
      explorerUrl: txHash ? `https://stellar.expert/explorer/testnet/tx/${txHash}` : null,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/panel/telegram/chatid — Register global default Telegram chatId
// Body: { chatId: string }
// ────────────────────────────────────────────────────────────────────────────
router.post('/telegram/chatid', (req, res) => {
  const { chatId } = req.body ?? {};
  if (!chatId || typeof chatId !== 'string' || !chatId.trim()) {
    return res.status(400).json({ success: false, error: 'chatId is required' });
  }
  setDefaultChatId(chatId.trim());
  res.json({ success: true, chatId: chatId.trim() });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/panel/bills — List all bills (0.001 USDC via x402)
// ────────────────────────────────────────────────────────────────────────────
router.get('/bills', async (_req, res) => {
  try {
    const { data, x402 } = await x402Request('GET', '/agent/bills');
    res.json({ success: true, bills: data.bills ?? data, x402 });
  } catch (err) {
    console.error('Panel /bills error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/panel/bills — Create a bill (0.01 USDC via x402)
// ────────────────────────────────────────────────────────────────────────────
router.post('/bills', async (req, res) => {
  try {
    const { data, x402 } = await x402Request('POST', '/agent/bills', req.body);
    res.status(data.success ? 201 : 400).json({ ...data, x402 });
  } catch (err) {
    console.error('Panel POST /bills error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/panel/pay-direct/:id — Pay a bill directly (no x402 fee)
// Body: { chatId? }
// ────────────────────────────────────────────────────────────────────────────
router.post('/pay-direct/:id', async (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    if (isNaN(billId)) return res.status(400).json({ success: false, error: 'Invalid bill ID' });

    const agentKey = getAgentPublicKey();
    const bill = await getBill(agentKey, billId);
    if (!bill) return res.status(404).json({ success: false, error: 'Bill not found' });

    if (bill.status === 'paid' || bill.status === 'completed') {
      return res.json({ success: true, alreadyPaid: true });
    }

    console.log(`💰 Direct pay bill ${billId}: ${bill.amount} ${bill.asset} → ${bill.recipientAddress}`);

    // 1. Send on-chain payment (agent keypair auto-signs)
    let txHash = '';
    try {
      const result = await sendPayment(agentKey, bill.recipientAddress, bill.amount, bill.asset);
      txHash = result.hash;
    } catch (payErr) {
      console.error('❌ Payment failed:', payErr.message);
      return res.status(500).json({ success: false, error: payErr.message });
    }

    // 2. Mark bill as paid in contract
    try { await markPaidForAgent(agentKey, bill.contractId); } catch (e) {
      console.error('❌ markPaid error:', e.message);
    }

    // 3. Record payment history in contract
    try {
      await recordPaymentForAgent(agentKey, {
        billId: bill.contractId, billName: bill.name,
        recipientAddress: bill.recipientAddress, amount: bill.amount,
        asset: bill.asset, txHash, status: 'success', error: '',
      });
    } catch (e) {
      console.error('❌ recordPayment error:', e.message);
    }

    // 4. Telegram notification — use provided chatId, then bill-specific, then global default
    const chatId = req.body?.chatId || getChatId(billId) || getDefaultChatId();
    if (chatId) {
      sendPaymentConfirmation(String(chatId), bill, txHash).catch(() => {});
    }

    // 5. Bust bills list cache so next GET returns fresh data immediately
    invalidateBillsCache();

    console.log(`✅ Direct pay success | bill ${billId} | tx ${txHash}`);
    res.json({
      success: true,
      payment: { billId: String(billId), billName: bill.name, txHash, amount: bill.amount, asset: bill.asset },
    });
  } catch (err) {
    console.error('❌ pay-direct error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/panel/pay/:id — Pay a bill (0.005 USDC via x402)
// ────────────────────────────────────────────────────────────────────────────
router.post('/pay/:id', async (req, res) => {
  try {
    const { data, x402 } = await x402Request('POST', `/agent/pay/${req.params.id}`);
    // Surface payment-level errors clearly (e.g. no trustline, insufficient balance)
    if (!data.success) {
      return res.status(400).json({
        success: false,
        error: data.error || 'Payment failed',
        details: data.details || '',
        x402,
      });
    }
    res.json({ ...data, x402 });
  } catch (err) {
    console.error('Panel /pay error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/panel/bills/:id/pause — Pause/resume a bill (0.005 USDC via x402)
// ────────────────────────────────────────────────────────────────────────────
router.post('/bills/:id/pause', async (req, res) => {
  try {
    const { data, x402 } = await x402Request('POST', `/agent/bills/${req.params.id}/pause`);
    res.json({ ...data, x402 });
  } catch (err) {
    console.error('Panel /pause error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// DELETE /api/panel/bills/:id — Delete a bill (0.005 USDC via x402)
// ────────────────────────────────────────────────────────────────────────────
router.delete('/bills/:id', async (req, res) => {
  try {
    const { data, x402 } = await x402Request('DELETE', `/agent/bills/${req.params.id}`);
    res.json({ ...data, x402 });
  } catch (err) {
    console.error('Panel DELETE /bills error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/panel/history — Payment history (0.001 USDC via x402)
// ────────────────────────────────────────────────────────────────────────────
router.get('/history', async (_req, res) => {
  try {
    const { data, x402 } = await x402Request('GET', '/agent/history');
    res.json({ success: true, history: data.history ?? data, x402 });
  } catch (err) {
    console.error('Panel /history error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/panel/balance — Wallet balance (0.001 USDC via x402)
// ────────────────────────────────────────────────────────────────────────────
router.get('/balance', async (_req, res) => {
  try {
    const { data, x402 } = await x402Request('GET', '/agent/balance');
    res.json({ success: true, balances: data.balances ?? data, x402 });
  } catch (err) {
    console.error('Panel /balance error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/panel/notify/:id — Send Telegram payment reminder (0.002 USDC via x402)
// ────────────────────────────────────────────────────────────────────────────
router.post('/notify/:id', async (req, res) => {
  try {
    const { data, x402 } = await x402Request('POST', `/agent/notify/${req.params.id}`, req.body);
    res.json({ ...data, x402 });
  } catch (err) {
    console.error('Panel /notify error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/panel/services — List marketplace services (0.001 USDC via x402)
// ────────────────────────────────────────────────────────────────────────────
router.get('/services', async (_req, res) => {
  try {
    const { data, x402 } = await x402Request('GET', '/agent/services');
    res.json({ ...data, x402 });
  } catch (err) {
    console.error('Panel /services error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/panel/services — Register a service (0.002 USDC via x402)
// ────────────────────────────────────────────────────────────────────────────
router.post('/services', async (req, res) => {
  try {
    const { data, x402 } = await x402Request('POST', '/agent/services', req.body);
    res.status(data.success ? 201 : 400).json({ ...data, x402 });
  } catch (err) {
    console.error('Panel POST /services error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/panel/services/:id/buy — Buy a service (priced per service, via x402)
// ────────────────────────────────────────────────────────────────────────────
router.post('/services/:id/buy', async (req, res) => {
  try {
    const { data, x402 } = await x402Request('POST', `/agent/services/${req.params.id}/buy`, req.body);
    res.json({ ...data, x402 });
  } catch (err) {
    console.error('Panel /services/buy error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
