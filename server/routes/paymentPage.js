/**
 * Public payment page routes.
 *
 * GET  /pay/:id/:token   — Renders a payment page (no auth needed, token validates)
 * POST /api/panel/payment-link/:id — Generates a payment link URL (panel proxy)
 */
import { Router } from 'express';
import {
  getBill, getAgentPublicKey,
  markPaidForAgent, recordPaymentForAgent,
} from '../services/sorobanService.js';
import { verifyToken, buildPaymentUrl } from '../services/paymentLinkService.js';
import { getChatId, sendPaymentConfirmation } from '../services/telegramService.js';
import config from '../config.js';

// Classic USDC issuer for SEP-7 URI (testnet)
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function sep7Uri(bill) {
  const params = new URLSearchParams();
  params.set('destination', bill.recipientAddress);
  params.set('amount', bill.amount);
  if (bill.asset === 'USDC') {
    params.set('asset_code', 'USDC');
    params.set('asset_issuer', USDC_ISSUER);
  } else {
    params.set('asset_code', 'XLM');
  }
  params.set('memo', `AUTOPAY_${bill.id}`);
  params.set('memo_type', 'text');
  return `web+stellar:pay?${params.toString()}`;
}

function renderPage(bill) {
  const sep7 = sep7Uri(bill);
  const isOverdue = new Date(bill.nextDueDate) < new Date();
  const dueDateStr = new Date(bill.nextDueDate).toLocaleDateString('tr-TR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Stellar Autopay — ${bill.name}</title>
  <script src="https://cdn.jsdelivr.net/npm/@stellar/freighter-api@latest/build/index.min.js"></script>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --border: #30363d;
      --text: #e6edf3;
      --muted: #7d8590;
      --accent: #58a6ff;
      --success: #3fb950;
      --warning: #d29922;
      --danger: #f85149;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2rem;
      max-width: 460px;
      width: 100%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    .logo {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--accent);
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      gap: .5rem;
    }
    h1 { font-size: 1.35rem; margin-bottom: 0.6rem; }
    .status-bar {
      display: flex;
      gap: .5rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }
    .badge {
      padding: .2rem .7rem;
      border-radius: 20px;
      font-size: .75rem;
      font-weight: 600;
    }
    .badge-overdue { background: rgba(248,81,73,.18); color: var(--danger); }
    .badge-ok      { background: rgba(63,185,80,.15); color: var(--success); }
    .divider { border: none; border-top: 1px solid var(--border); margin: 1.2rem 0; }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: .45rem 0;
      font-size: .9rem;
    }
    .row .label { color: var(--muted); }
    .row .value { font-weight: 500; }
    .amount-row .value { font-size: 1.4rem; font-weight: 700; color: var(--text); }
    .pay-btn {
      display: block;
      width: 100%;
      margin-top: 1.6rem;
      padding: .85rem 1.5rem;
      background: var(--accent);
      color: #0d1117;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      text-align: center;
      text-decoration: none;
      transition: opacity .15s;
    }
    .pay-btn:hover { opacity: .88; }
    .how-it-works {
      margin-top: 1.2rem;
      background: rgba(88,166,255,.06);
      border: 1px solid rgba(88,166,255,.18);
      border-radius: 8px;
      padding: .9rem 1rem;
      font-size: .78rem;
      color: var(--muted);
      line-height: 1.6;
    }
    .how-it-works strong { color: var(--text); }
    .footer { margin-top: 1.5rem; font-size: .72rem; color: var(--muted); text-align: center; }
    .footer a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">✦ Stellar Autopay</div>
    <h1>${bill.name}</h1>
    <div class="status-bar">
      ${isOverdue
        ? `<span class="badge badge-overdue">⚠ VADESİ GEÇTİ</span>`
        : `<span class="badge badge-ok">✓ Ödeme Bekleniyor</span>`}
    </div>

    <hr class="divider" />

    <div class="row amount-row">
      <span class="label">Tutar</span>
      <span class="value">${bill.amount} ${bill.asset}</span>
    </div>
    <div class="row">
      <span class="label">Alıcı</span>
      <span class="value" style="font-family:monospace;font-size:.82rem">
        ${bill.recipientAddress.slice(0, 12)}...${bill.recipientAddress.slice(-6)}
      </span>
    </div>
    <div class="row">
      <span class="label">Vade</span>
      <span class="value" style="color:${isOverdue ? 'var(--danger)' : 'var(--text)'}">
        ${dueDateStr}
      </span>
    </div>

    <hr class="divider" />

    <a class="pay-btn" href="${sep7}" id="payBtn">
      ✦ Stellar Cüzdanımla Öde
    </a>

    <script>
      (async function() {
        const btn = document.getElementById('payBtn');
        const sep7Uri = btn.getAttribute('href');
        
        // Check if Freighter is available
        if (typeof window.freighter !== 'undefined') {
          console.log('✓ Freighter detected');
          btn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
              // Try to open Freighter wallet directly
              const publicKey = await window.freighter.getPublicKey();
              console.log('Connected to Freighter:', publicKey);
              // Fall back to SEP-7 URI
              window.location.href = sep7Uri;
            } catch (err) {
              console.error('Freighter error:', err);
              window.location.href = sep7Uri;
            }
          });
        } else {
          console.warn('Freighter extension not detected - using SEP-7 direct link');
          // Keep default link behavior 
        }
      })();
    </script>

    <div class="how-it-works">
      <strong>Nasıl çalışır?</strong><br/>
      Butona tıklayınca Freighter veya SEP-7 uyumlu Stellar cüzdanınız açılır.
      Ödeme bilgileri otomatik doldurulur — sadece onaylamanız yeterli.
      Ödeme doğruca alıcıya ${bill.asset} olarak gönderilir.
    </div>

    <div class="footer">
      Stellar Testnet · 
      <a href="https://stellar.expert/explorer/testnet" target="_blank">Explorer ↗</a>
      &nbsp;·&nbsp; Powered by x402 protocol
    </div>
  </div>
</body>
</html>`;
}

function renderPaidPage(bill) {
  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Ödendi — ${bill.name}</title>
<style>
  body{background:#0d1117;color:#e6edf3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1.5rem}
  .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:2.5rem;max-width:420px;width:100%;text-align:center}
  .icon{font-size:3rem;margin-bottom:1rem}
  h1{color:#3fb950;margin-bottom:.5rem}
  p{color:#7d8590;font-size:.9rem}
</style>
</head>
<body>
<div class="card">
  <div class="icon">✅</div>
  <h1>Ödeme Tamamlandı</h1>
  <p><strong>${bill.name}</strong> faturası ödenmiş.</p>
  <p style="margin-top:1rem">Bu link artık geçerli değil.</p>
</div>
</body>
</html>`;
}

export const publicPayRouter = Router();
export const panelPayLinkRouter = Router();
export const publicBillApiRouter = Router();

// ── GET /api/pay/bill/:id/:token — public bill fetch for React payment page ──
publicBillApiRouter.get('/:id/:token', async (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    if (isNaN(billId)) return res.status(400).json({ success: false, error: 'Invalid bill ID' });

    if (!verifyToken(billId, req.params.token)) {
      return res.status(403).json({ success: false, error: 'Invalid or expired payment link.' });
    }

    const agentKey = getAgentPublicKey();
    const bill = await getBill(agentKey, billId);
    if (!bill) return res.status(404).json({ success: false, error: 'Bill not found.' });

    res.json({
      success: true,
      bill,
    });
  } catch (err) {
    console.error('❌ Public bill API error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/pay/bill/confirm/:id/:token — record manual wallet payment ───
publicBillApiRouter.post('/confirm/:id/:token', async (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    if (isNaN(billId)) return res.status(400).json({ success: false, error: 'Invalid bill ID' });

    if (!verifyToken(billId, req.params.token)) {
      return res.status(403).json({ success: false, error: 'Invalid or expired payment link.' });
    }

    const { txHash, payerAddress } = req.body;
    if (!txHash || typeof txHash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(txHash)) {
      return res.status(400).json({ success: false, error: 'Invalid txHash.' });
    }

    const agentKey = getAgentPublicKey();
    const bill = await getBill(agentKey, billId);
    if (!bill) return res.status(404).json({ success: false, error: 'Bill not found.' });

    if (bill.status === 'paid' || bill.status === 'completed') {
      return res.json({ success: true, alreadyPaid: true });
    }

    // Mark bill as paid in contract
    try {
      await markPaidForAgent(agentKey, bill.contractId);
    } catch (err) {
      console.error('❌ markPaid error:', err.message);
      // Continue — record payment even if mark_paid fails
    }

    // Record payment history in contract
    try {
      await recordPaymentForAgent(agentKey, {
        billId:           bill.contractId,
        billName:         bill.name,
        recipientAddress: bill.recipientAddress,
        amount:           bill.amount,
        asset:            bill.asset,
        txHash,
        status:           'success',
        error:            '',
      });
    } catch (err) {
      console.error('❌ recordPayment error:', err.message);
    }

    // Send Telegram confirmation
    const chatId = getChatId(billId);
    if (chatId) {
      sendPaymentConfirmation(chatId, bill, txHash).catch(() => {});
    }

    console.log(`✅ Manual payment confirmed | bill ${billId} | tx ${txHash}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Confirm payment error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /pay/:id/:token ─────────────────────────────────────────────────────
publicPayRouter.get('/:id/:token', async (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    if (isNaN(billId)) return res.status(400).send('<h1>Geçersiz fatura ID</h1>');

    if (!verifyToken(billId, req.params.token)) {
      return res.status(403).send('<h1>Geçersiz veya süresi dolmuş ödeme linki.</h1>');
    }

    const agentKey = getAgentPublicKey();
    const bill = await getBill(agentKey, billId);
    if (!bill) return res.status(404).send('<h1>Fatura bulunamadı.</h1>');

    if (bill.status === 'paid' || bill.status === 'completed') {
      return res.send(renderPaidPage(bill));
    }

    res.send(renderPage(bill));
  } catch (err) {
    console.error('❌ Payment page error:', err.message);
    res.status(500).send(`<h1>Hata: ${err.message}</h1>`);
  }
});

// ── POST /api/panel/payment-link/:id ────────────────────────────────────────
panelPayLinkRouter.post('/payment-link/:id', async (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    if (isNaN(billId)) return res.status(400).json({ success: false, error: 'Invalid bill ID' });

    const agentKey = getAgentPublicKey();
    const bill = await getBill(agentKey, billId);
    if (!bill) return res.status(404).json({ success: false, error: 'Bill not found' });

    const url = buildPaymentUrl(billId);
    res.json({ success: true, url, bill: { name: bill.name, amount: bill.amount, asset: bill.asset } });
  } catch (err) {
    console.error('❌ payment-link error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
