import { useState, useCallback, useEffect } from 'react';
const SERVER = import.meta.env.VITE_SERVER_URL || '';
// ─── Helpers ──────────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function X402Badge({ x402, loading }) {
  if (loading) return <span className="x402-badge x402-pending">💰 x402 paying...</span>;
  if (!x402) return null;
  if (x402.txHash) {
    return (
      <span className="x402-badge x402-settled">
        ⚡ {x402.amount} USDC paid →{' '}
        <a
          href={x402.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="x402-tx-link"
        >
          {x402.txHash.slice(0, 8)}...{x402.txHash.slice(-6)} ↗
        </a>
      </span>
    );
  }
  return <span className="x402-badge x402-ok">✅ settled</span>;
}

const DEFAULT_DUE = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
};

// ─── Add Bill Form ────────────────────────────────────────────────────────
function AddBillPanel({ onSuccess }) {
  const [form, setForm] = useState({
    name: '', recipientAddress: '', amount: '', asset: 'USDC',
    type: 'recurring', frequency: 'monthly', nextDueDate: DEFAULT_DUE(), telegramChatId: '',
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleChange = (e) => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setResult(null); setLoading(true);
    try {
      const res = await fetch(`${SERVER}/api/panel/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, nextDueDate: new Date(form.nextDueDate).toISOString() }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || (data.errors?.join(', ')));
      setResult(data);
      onSuccess?.();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="panel-section">
      <h3 className="panel-section-title">
        + New Bill (POST /agent/bills · <span className="price-tag">0.01 USDC</span>)
      </h3>
      <form className="panel-form" onSubmit={submit}>
        <div className="panel-form-row">
          <div className="panel-field">
            <label>Bill Name</label>
            <input name="name" value={form.name} onChange={handleChange} placeholder="Server rent" required />
          </div>
          <div className="panel-field">
            <label>Recipient Address (Stellar)</label>
            <input name="recipientAddress" value={form.recipientAddress} onChange={handleChange} placeholder="G..." required />
          </div>
        </div>
        <div className="panel-form-row">
          <div className="panel-field panel-field-sm">
            <label>Amount</label>
            <input name="amount" type="number" step="0.01" min="0.01" value={form.amount} onChange={handleChange} placeholder="10" required />
          </div>
          <div className="panel-field panel-field-sm">
            <label>Asset</label>
            <select name="asset" value={form.asset} onChange={handleChange}>
              <option>USDC</option>
              <option>XLM</option>
            </select>
          </div>
          <div className="panel-field panel-field-sm">
            <label>Type</label>
            <select name="type" value={form.type} onChange={handleChange}>
              <option value="recurring">Recurring</option>
              <option value="one-time">One-Time</option>
            </select>
          </div>
          {form.type === 'recurring' && (
            <div className="panel-field panel-field-sm">
              <label>Frequency</label>
              <select name="frequency" value={form.frequency} onChange={handleChange}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>
          )}
          <div className="panel-field panel-field-md">
            <label>First Due Date</label>
            <input name="nextDueDate" type="datetime-local" value={form.nextDueDate} onChange={handleChange} required />
          </div>
        </div>
        <div className="panel-form-row">
          <div className="panel-field">
            <label>Telegram Chat ID <span style={{fontWeight:400,opacity:0.6}}>(optional — for payment notifications)</span></label>
            <input name="telegramChatId" value={form.telegramChatId} onChange={handleChange} placeholder="1234567890" />
          </div>
        </div>
        <div className="panel-form-footer">
          <button type="submit" className="btn-primary panel-submit" disabled={loading}>
            {loading ? '⟳ Submitting...' : '⚡ Create Bill via API'}
          </button>
          {error && <span className="panel-error">{error}</span>}
          {result && <X402Badge x402={result.x402} />}
        </div>
      </form>
      {result?.bill && (
        <div className="panel-result-card">
          ✅ Bill created: <strong>{result.bill.name}</strong> — {result.bill.amount} {result.bill.asset}
        </div>
      )}
    </div>
  );
}

// ─── Bills List ───────────────────────────────────────────────────────────
function BillsPanel() {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchX402, setFetchX402] = useState(null);
  const [actionState, setActionState] = useState({}); // billId → { loading, x402, error, paymentTx }
  const [error, setError] = useState('');
  const [paymentLinks, setPaymentLinks] = useState({}); // billId → { loading, url, error }
  const [chatIdInputs, setChatIdInputs] = useState({}); // billId → string (local override)
  const [billTab, setBillTab] = useState('unpaid'); // 'unpaid' | 'paid'

  // Read Telegram chatId saved in frontend settings
  const getStoredChatId = () => {
    try {
      const raw = localStorage.getItem('stellar_autopay_telegram');
      if (!raw) return '';
      const p = JSON.parse(raw);
      return (p.enabled && p.chatId) ? p.chatId : '';
    } catch { return ''; }
  };

  const fetchBills = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${SERVER}/api/panel/bills`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setBills(Array.isArray(data.bills) ? data.bills : []);
      setFetchX402(data.x402);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  const doAction = async (billId, method, path, label, body = null) => {
    setActionState(p => ({ ...p, [billId]: { loading: true, label } }));
    try {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(`${SERVER}/api/panel${path}`, opts);
      const data = await res.json();
      const isPayAction = path.includes('/pay/');
      const paymentTx = isPayAction ? data.payment?.txHash : null;
      const errMsg = !data.success ? (data.details || data.error || 'Transaction failed') : null;
      setActionState(p => ({
        ...p,
        [billId]: { loading: false, x402: data.x402, label, error: errMsg, paymentTx },
      }));
      if (data.success) fetchBills();
    } catch (err) {
      setActionState(p => ({ ...p, [billId]: { loading: false, error: err.message, label } }));
    }
  };

  const doPayDirect = async (bill) => {
    const chatId = chatIdInputs[bill.id] || getStoredChatId();
    const billId = bill.id;
    setActionState(p => ({ ...p, [billId]: { loading: true, label: 'Paying' } }));
    try {
      const res = await fetch(`${SERVER}/api/panel/pay-direct/${billId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatId ? { chatId } : {}),
      });
      const data = await res.json();
      const paymentTx = data.payment?.txHash ?? null;
      const errMsg = !data.success ? (data.error || 'Payment failed') : null;
      setActionState(p => ({ ...p, [billId]: { loading: false, label: 'Paying', error: errMsg, paymentTx } }));
      if (data.success) {
        // Immediately mark bill as paid in local state (no flash while waiting for re-fetch)
        setBills(prev => prev.map(b =>
          b.id === billId ? { ...b, status: 'paid' } : b
        ));
        fetchBills(); // also refresh from server in background
      }
    } catch (err) {
      setActionState(p => ({ ...p, [billId]: { loading: false, error: err.message, label: 'Paying' } }));
    }
  };

  const doNotify = (billId) => {
    const chatId = chatIdInputs[billId] || getStoredChatId();
    doAction(billId, 'POST', `/notify/${billId}`, 'Notifying', chatId ? { chatId } : {});
  };

  const getPaymentLink = async (billId) => {
    setPaymentLinks(p => ({ ...p, [billId]: { loading: true } }));
    try {
      const res = await fetch(`${SERVER}/api/panel/payment-link/${billId}`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setPaymentLinks(p => ({ ...p, [billId]: { loading: false, url: data.url } }));
    } catch (err) {
      setPaymentLinks(p => ({ ...p, [billId]: { loading: false, error: err.message } }));
    }
  };

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <h3 className="panel-section-title">
          Bills (GET /agent/bills · <span className="price-tag">0.001 USDC</span>)
        </h3>
        <button className="btn-secondary btn-sm" onClick={fetchBills} disabled={loading}>
          {loading ? '⟳' : '↻ Refresh'}
        </button>
      </div>
      {fetchX402 && <X402Badge x402={fetchX402} />}
      {error && <div className="panel-error">{error}</div>}

      {/* ── Tabs ── */}
      {bills.length > 0 && (
        <div className="filter-tabs" style={{ marginBottom: '0.75rem' }}>
          <button
            className={`filter-tab ${billTab === 'unpaid' ? 'active' : ''}`}
            onClick={() => setBillTab('unpaid')}
          >
            Unpaid
            {(() => { const n = bills.filter(b => b.status !== 'paid' && b.status !== 'completed').length; return n > 0 ? <span className="pbc-tab-count">{n}</span> : null; })()}
          </button>
          <button
            className={`filter-tab ${billTab === 'paid' ? 'active' : ''}`}
            onClick={() => setBillTab('paid')}
          >
            Paid / Done
            {(() => { const n = bills.filter(b => b.status === 'paid' || b.status === 'completed').length; return n > 0 ? <span className="pbc-tab-count">{n}</span> : null; })()}
          </button>
        </div>
      )}

      {bills.length === 0 && !loading && (
        <div className="panel-empty">No bills yet. Add one above.</div>
      )}

      <div className="panel-bill-list">
        {bills
          .filter(bill => {
            const isPaid = bill.status === 'paid' || bill.status === 'completed';
            return billTab === 'paid' ? isPaid : !isPaid;
          })
          .map((bill) => {
          const state = actionState[bill.id] || {};
          const linkState = paymentLinks[bill.id] || {};
          const now = new Date();
          const dueDate = new Date(bill.nextDueDate);
          const isOverdue = dueDate < now && bill.status === 'active';
          const isPaid = bill.status === 'paid' || bill.status === 'completed';
          const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
          const storedChatId = getStoredChatId();
          const chatIdVal = chatIdInputs[bill.id] !== undefined ? chatIdInputs[bill.id] : storedChatId;
          return (
            <div key={bill.id} className={`panel-bill-card ${bill.status} ${isOverdue ? 'overdue' : ''}`}>
              <div className="pbc-info">
                <div className="pbc-name">{bill.name}</div>
                <div className="pbc-meta">
                  <span className={`badge badge-${bill.status}`}>
                    {bill.status === 'active' ? 'Active'
                      : bill.status === 'paused' ? 'Paused'
                      : bill.status === 'paid' ? '✅ Paid'
                      : bill.status === 'completed' ? '✅ Completed'
                      : bill.status}
                  </span>
                  {isOverdue && <span className="badge badge-overdue">⚠ OVERDUE</span>}
                  <span className="pbc-amount">{bill.amount} {bill.asset}</span>
                  <span className="pbc-freq">{bill.frequency || bill.type}</span>
                  <span className={`pbc-due ${isOverdue ? 'due-overdue' : ''}`}>
                    {isOverdue
                      ? `⚠ ${Math.abs(daysUntilDue)} day(s) overdue`
                      : isPaid
                      ? `Paid: ${formatDate(bill.nextDueDate)}`
                      : daysUntilDue === 0
                      ? '🔔 Due today'
                      : daysUntilDue === 1
                      ? '🔔 Due tomorrow'
                      : `Due: ${formatDate(bill.nextDueDate)}`}
                  </span>
                </div>
                <div className="pbc-addr">{bill.recipientAddress?.slice(0, 8)}...{bill.recipientAddress?.slice(-6)}</div>
              </div>
              {isOverdue && (
                <div className="pbc-chatid-row">
                  <span>📨 Telegram:</span>
                  <input
                    className="pbc-chatid-input"
                    placeholder={storedChatId ? `${storedChatId.slice(0, 6)}... (saved)` : 'Enter Chat ID...'}
                    value={chatIdInputs[bill.id] ?? ''}
                    onChange={(e) => setChatIdInputs(p => ({ ...p, [bill.id]: e.target.value }))}
                  />
                  {chatIdVal && <span className="pbc-chatid-ok">✓</span>}
                </div>
              )}
              {!isPaid && (
                <div className="pbc-actions">
                  <button
                    className={`btn-sm ${isOverdue ? 'btn-warning' : 'btn-success'}`}
                    disabled={state.loading}
                    onClick={() => doPayDirect(bill)}
                    title="Paying bill — includes 0.49 XLM service fee"
                  >
                    ⚡ {isOverdue ? 'Pay Now' : 'Pay'} <span style={{ fontWeight: 400, opacity: 0.75, fontSize: '0.7rem' }}>+0.49 XLM</span>
                  </button>
                  {isOverdue && (
                    <button
                      className="btn-sm btn-secondary"
                      disabled={state.loading}
                      onClick={() => doNotify(bill.id)}
                      title="POST /agent/notify/:id · 0.002 USDC — remind via Telegram"
                    >
                      📨 Notify
                    </button>
                  )}
                  {isOverdue && (
                    <button
                      className="btn-sm btn-secondary"
                      disabled={linkState.loading}
                      onClick={() => getPaymentLink(bill.id)}
                      title="Generate payment link"
                    >
                      {linkState.loading ? '⇳' : '🔗 Link'}
                    </button>
                  )}
                  <button
                    className="btn-secondary btn-sm"
                    disabled={state.loading}
                    onClick={() => doAction(bill.id, 'POST', `/bills/${bill.id}/pause`, bill.status === 'paused' ? 'Resuming' : 'Pausing')}
                    title="POST /agent/bills/:id/pause · 0.005 USDC"
                  >
                    {bill.status === 'paused' ? '▶ Resume' : '⏸ Pause'}
                  </button>
                  <button
                    className="btn-danger btn-sm"
                    disabled={state.loading}
                    onClick={() => doAction(bill.id, 'DELETE', `/bills/${bill.id}`, 'Deleting')}
                    title="DELETE /agent/bills/:id · 0.005 USDC"
                  >
                    🗑
                  </button>
                </div>
              )}
              {state.loading && (
                <div className="pbc-x402"><X402Badge loading /></div>
              )}
              {!state.loading && state.x402 && (
                <div className="pbc-x402">
                  <X402Badge x402={state.x402} />
                  {state.paymentTx && (
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${state.paymentTx}`}
                      target="_blank" rel="noreferrer"
                      className="x402-tx-link" style={{ marginLeft: '0.5rem', fontSize: '0.74rem' }}
                    >
                      💸 Payment tx: {state.paymentTx.slice(0, 8)}...↗
                    </a>
                  )}
                </div>
              )}
              {state.error && (
                <div className="panel-error pbc-x402" style={{ fontSize: '0.76rem' }}>
                  ❌ {state.error}
                  {state.error.includes('trustline') || state.error.includes('no trust') ?
                    ' — Recipient has no USDC trustline' : ''}
                </div>
              )}
              {linkState.url && (
                <div className="pbc-payment-link">
                  <span>🔗 Payment Link:</span>
                  <a href={linkState.url} target="_blank" rel="noreferrer" className="x402-tx-link">
                    {linkState.url.slice(0, 48)}...
                  </a>
                  <button
                    className="btn-sm btn-secondary"
                    style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}
                    onClick={() => { navigator.clipboard.writeText(linkState.url); }}
                  >
                    📋 Copy
                  </button>
                </div>
              )}
              {linkState.error && (
                <div className="panel-error pbc-x402" style={{ fontSize: '0.74rem' }}>❌ Link: {linkState.error}</div>
              )}
            </div>
          );
        })}
        {bills.length > 0 && bills.filter(bill => {
          const isPaid = bill.status === 'paid' || bill.status === 'completed';
          return billTab === 'paid' ? isPaid : !isPaid;
        }).length === 0 && (
          <div className="panel-empty">
            {billTab === 'paid' ? 'No paid bills yet.' : 'No unpaid bills — all done! ✅'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── History & Balance ────────────────────────────────────────────────────
function HistoryPanel() {
  const [history, setHistory] = useState([]);
  const [balances, setBalances] = useState(null);
  const [loading, setLoading] = useState(false);
  const [x402s, setX402s] = useState({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [hRes, bRes] = await Promise.all([
        fetch(`${SERVER}/api/panel/history`),
        fetch(`${SERVER}/api/panel/balance`),
      ]);
      const hData = await hRes.json();
      const bData = await bRes.json();
      setHistory(Array.isArray(hData.history) ? hData.history : []);
      setBalances(bData.balances);
      setX402s({ history: hData.x402, balance: bData.x402 });
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <h3 className="panel-section-title">
          Balance &amp; History
        </h3>
        <button className="btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? '⟳' : '↻ Refresh'}
        </button>
      </div>
      {error && <div className="panel-error">{error}</div>}

      {balances && (
        <div className="panel-balance-row">
          <div className="balance-card">
            <span className="bc-val">{(balances.XLM ?? 0).toFixed(2)}</span>
            <span className="bc-label">XLM</span>
          </div>
          <div className="balance-card">
            <span className="bc-val">{(balances.USDC ?? 0).toFixed(4)}</span>
            <span className="bc-label">USDC</span>
            <span className="bc-note">(for x402 payments)</span>
          </div>
          <div className="x402-call-badge">
            GET /agent/balance · <span className="price-tag">0.001 USDC</span>
            {x402s.balance && <X402Badge x402={x402s.balance} />}
          </div>
        </div>
      )}

      <div className="panel-history-header">
        <span className="panel-section-title" style={{ fontSize: '0.82rem' }}>
          Payment History (GET /agent/history · <span className="price-tag">0.001 USDC</span>)
        </span>
        {x402s.history && <X402Badge x402={x402s.history} />}
      </div>

      {history.length === 0 && !loading ? (
        <div className="panel-empty">No payment records yet.</div>
      ) : (
        <div className="panel-history-table-wrap">
          <table className="panel-history-table">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Amount</th>
                <th>Date</th>
                <th>TX Hash</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td>{h.billName || h.name || '—'}</td>
                  <td>{h.amount} {h.asset}</td>
                  <td>{formatDate(h.date || h.createdAt)}</td>
                  <td>
                    {h.txHash ? (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${h.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="x402-tx-link"
                      >
                        {h.txHash.slice(0, 8)}...{h.txHash.slice(-6)} ↗
                      </a>
                    ) : '—'}
                  </td>
                  <td>
                    <span className={`badge badge-${h.status === 'success' ? 'active' : 'paused'}`}>
                      {h.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────
export default function AgentControlPanel() {
  const [tab, setTab] = useState('bills');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="agent-control-panel">
      <div className="acp-header">
        <div className="acp-title">
          <span className="acp-icon">🛠</span>
          <div>
            <h2>Agent Control Panel</h2>
            <p className="acp-subtitle">
              Manage your bills via <strong>x402 Agent API</strong> —
              every action generates a real Stellar testnet tx
            </p>
          </div>
        </div>
        <div className="acp-api-info">
          <span className="acp-endpoint">localhost:3001</span>
          <span className="acp-dot green" />
          <span className="acp-status">online</span>
        </div>
      </div>

      <div className="acp-tabs">
        <button className={`acp-tab ${tab === 'bills' ? 'active' : ''}`} onClick={() => setTab('bills')}>
          📋 Bills
        </button>
        <button className={`acp-tab ${tab === 'add' ? 'active' : ''}`} onClick={() => setTab('add')}>
          + Add Bill
        </button>
        <button className={`acp-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          💰 History &amp; Balance
        </button>
      </div>

      <div className="acp-body">
        <div className="acp-x402-note">
          💡 Every API call → <strong>x402 micro-USDC payment</strong> → settled on Stellar testnet.
          Each button below generates a real on-chain tx.
        </div>

        {tab === 'bills'   && <BillsPanel key={refreshKey} />}
        {tab === 'add'     && <AddBillPanel onSuccess={() => { setRefreshKey(k => k + 1); setTab('bills'); }} />}
        {tab === 'history' && <HistoryPanel />}
      </div>
    </div>
  );
}
