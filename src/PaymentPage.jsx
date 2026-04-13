import { useState, useEffect } from 'react';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import { Networks as KitNetworks } from '@creit.tech/stellar-wallets-kit/types';
import { FreighterModule, FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr';
import { xBullModule } from '@creit.tech/stellar-wallets-kit/modules/xbull';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
import { buildPaymentTxXdr, submitTx, NETWORK_PASSPHRASE } from './utils/stellar.js';

let kitReady = false;
function ensureKit() {
  if (kitReady) return;
  StellarWalletsKit.init({
    modules: [
      new FreighterModule(),
      new LobstrModule(),
      new xBullModule(),
      new AlbedoModule(),
    ],
    selectedWalletId: FREIGHTER_ID,
    network: KitNetworks.TESTNET,
  });
  kitReady = true;
}

export default function PaymentPage() {
  // Parse /pay/:id/:token from URL
  const parts = window.location.pathname.split('/').filter(Boolean);
  const billId = parts[1];
  const token = parts[2];

  const [bill, setBill] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [walletPubKey, setWalletPubKey] = useState(null);
  const [status, setStatus] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [errMsg, setErrMsg] = useState(null);

  useEffect(() => {
    ensureKit();
    if (!billId || !token) { setFetchError('Invalid payment link.'); return; }
    fetch(`/api/pay/bill/${billId}/${token}`)
      .then(r => r.json())
      .then(data => {
        if (!data.success) throw new Error(data.error || 'Bill not found');
        setBill(data.bill);
        if (data.bill.status === 'paid' || data.bill.status === 'completed') {
          setStatus('already_paid');
        }
      })
      .catch(e => setFetchError(e.message));
  }, []);

  async function connectAndPay() {
    setStatus('connecting');
    setErrMsg(null);
    try {
      ensureKit();
      const { address } = await StellarWalletsKit.authModal();
      setWalletPubKey(address);
      setStatus('signing');

      // Build payment tx for the bill amount
      const xdr = await buildPaymentTxXdr(
        address, bill.recipientAddress, bill.amount, bill.asset,
      );

      // Sign with wallet
      const signResult = await StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address,
      });
      const signedXdr = typeof signResult === 'string' ? signResult : signResult?.signedTxXdr;
      if (!signedXdr) throw new Error('Wallet rejected the signing.');

      setStatus('submitting');
      const result = await submitTx(signedXdr);
      setTxHash(result.hash);

      // Notify server to mark bill as paid on-chain + send Telegram confirmation
      try {
        await fetch(`/api/pay/bill/confirm/${billId}/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash: result.hash, payerAddress: address }),
        });
      } catch (_) {
        // Non-fatal: UI shows success regardless
      }

      setStatus('paid');
    } catch (e) {
      setErrMsg(e.message || String(e));
      setStatus('error');
    }
  }

  // ── Styles (inline, dark theme matching payment page) ──────────────────────
  const s = {
    body: {
      background: '#0d1117', color: '#e6edf3',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '1.5rem',
    },
    card: {
      background: '#161b22', border: '1px solid #30363d',
      borderRadius: '12px', padding: '2rem', maxWidth: '460px',
      width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    },
    logo: { fontSize: '1.1rem', fontWeight: 700, color: '#58a6ff', marginBottom: '1.5rem' },
    h1: { fontSize: '1.35rem', marginBottom: '0.6rem' },
    row: { display: 'flex', justifyContent: 'space-between', padding: '.45rem 0', fontSize: '.9rem' },
    label: { color: '#7d8590' },
    value: { fontWeight: 500 },
    divider: { border: 'none', borderTop: '1px solid #30363d', margin: '1.2rem 0' },
    btn: {
      display: 'block', width: '100%', marginTop: '1.6rem',
      padding: '.85rem 1.5rem', background: '#58a6ff', color: '#0d1117',
      border: 'none', borderRadius: '8px', fontSize: '1rem',
      fontWeight: 700, cursor: 'pointer', transition: 'opacity .15s',
    },
    btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
    success: {
      marginTop: '1.2rem', background: 'rgba(63,185,80,.12)',
      border: '1px solid rgba(63,185,80,.3)', borderRadius: '8px',
      padding: '.9rem 1rem', fontSize: '.85rem', color: '#3fb950',
    },
    error: {
      marginTop: '1.2rem', background: 'rgba(248,81,73,.1)',
      border: '1px solid rgba(248,81,73,.25)', borderRadius: '8px',
      padding: '.9rem 1rem', fontSize: '.85rem', color: '#f85149',
    },
    badge: (overdue) => ({
      display: 'inline-block', padding: '.2rem .7rem', borderRadius: '20px',
      fontSize: '.75rem', fontWeight: 600, marginBottom: '1.5rem',
      background: overdue ? 'rgba(248,81,73,.18)' : 'rgba(63,185,80,.15)',
      color: overdue ? '#f85149' : '#3fb950',
    }),
    info: {
      marginTop: '1.2rem', background: 'rgba(88,166,255,.06)',
      border: '1px solid rgba(88,166,255,.18)', borderRadius: '8px',
      padding: '.9rem 1rem', fontSize: '.78rem', color: '#7d8590', lineHeight: 1.6,
    },
    footer: { marginTop: '1.5rem', fontSize: '.72rem', color: '#7d8590', textAlign: 'center' },
  };

  const busy = status === 'connecting' || status === 'signing' || status === 'submitting';

  const statusLabel = {
    connecting: '🔗 Connecting wallet...',
    signing: '✍️ Signing...',
    submitting: '📡 Submitting to network...',
  };

  if (fetchError) {
    return (
      <div style={s.body}>
        <div style={s.card}>
          <div style={s.logo}>✦ Stellar Autopay</div>
          <div style={{ ...s.error, marginTop: 0 }}>❌ {fetchError}</div>
        </div>
      </div>
    );
  }

  if (!bill) {
    return (
      <div style={s.body}>
        <div style={s.card}>
          <div style={s.logo}>✦ Stellar Autopay</div>
          <div style={{ color: '#7d8590' }}>Loading bill...</div>
        </div>
      </div>
    );
  }

  if (status === 'already_paid' || bill.status === 'paid' || bill.status === 'completed') {
    return (
      <div style={s.body}>
        <div style={{ ...s.card, textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <h1 style={{ color: '#3fb950', marginBottom: '.5rem' }}>Payment Complete</h1>
          <p style={{ color: '#7d8590' }}><strong>{bill.name}</strong> bill has been paid.</p>
        </div>
      </div>
    );
  }

  const isOverdue = new Date(bill.nextDueDate) < new Date();
  const dueDateStr = new Date(bill.nextDueDate).toLocaleDateString('en-US', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div style={s.body}>
      <div style={s.card}>
        <div style={s.logo}>✦ Stellar Autopay</div>
        <h1 style={s.h1}>{bill.name}</h1>
        <div style={s.badge(isOverdue)}>
          {isOverdue ? '⚠ OVERDUE' : '✓ Awaiting Payment'}
        </div>

        <hr style={s.divider} />

        <div style={{ ...s.row, fontSize: '1.1rem' }}>
          <span style={s.label}>Amount</span>
          <span style={{ ...s.value, fontSize: '1.4rem', fontWeight: 700 }}>{bill.amount} {bill.asset}</span>
        </div>
        <div style={s.row}>
          <span style={s.label}>Recipient</span>
          <span style={{ ...s.value, fontFamily: 'monospace', fontSize: '.82rem' }}>
            {bill.recipientAddress.slice(0, 12)}...{bill.recipientAddress.slice(-6)}
          </span>
        </div>
        <div style={s.row}>
          <span style={s.label}>Due Date</span>
          <span style={{ ...s.value, color: isOverdue ? '#f85149' : '#e6edf3' }}>{dueDateStr}</span>
        </div>

        <hr style={s.divider} />

        {status === 'paid' ? (
          <div style={s.success}>
            ✅ <strong>Payment successful!</strong><br />
            {txHash && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank" rel="noreferrer"
                style={{ color: '#58a6ff', fontSize: '.8rem' }}
              >
                🔗 View on Stellar Explorer ↗
              </a>
            )}
          </div>
        ) : (
          <>
            <button
              style={{ ...s.btn, ...(busy ? s.btnDisabled : {}) }}
              disabled={busy}
              onClick={connectAndPay}
            >
              {busy ? statusLabel[status] : '❆ Pay with My Stellar Wallet'}
            </button>

            {status === 'error' && (
              <div style={s.error}>❌ {errMsg}</div>
            )}

            <div style={s.info}>
              <strong style={{ color: '#e6edf3' }}>How it works?</strong><br />
              Click the button to open the wallet selector for Freighter, Lobstr, xBull, or Albedo.
              Payment details are pre-filled — just confirm.
              The bill amount is sent directly to the recipient. No service fee.
            </div>
          </>
        )}

        <div style={s.footer}>
          Stellar Testnet ·{' '}
          <a href="https://stellar.expert/explorer/testnet" target="_blank" rel="noreferrer"
            style={{ color: '#58a6ff', textDecoration: 'none' }}>
            Explorer ↗
          </a>
          &nbsp;·&nbsp; Powered by x402 protocol
        </div>
      </div>
    </div>
  );
}
