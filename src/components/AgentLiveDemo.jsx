import { useState, useCallback } from 'react';

const SERVER = import.meta.env.VITE_SERVER_URL || '';

const ENDPOINT_DOCS = [
  { method: 'POST', path: '/agent/bills',           price: '$0.01',  desc: 'Create a new bill' },
  { method: 'GET',  path: '/agent/bills',           price: '$0.001', desc: 'List all bills' },
  { method: 'GET',  path: '/agent/bills/:id',       price: '$0.001', desc: 'Bill details' },
  { method: 'POST', path: '/agent/pay/:id',         price: '$0.005', desc: 'Trigger bill payment' },
  { method: 'POST', path: '/agent/bills/:id/pause', price: '$0.005', desc: 'Pause/resume bill' },
  { method: 'DELETE', path: '/agent/bills/:id',     price: '$0.005', desc: 'Delete bill' },
  { method: 'GET',  path: '/agent/history',         price: '$0.001', desc: 'Payment history' },
  { method: 'GET',  path: '/agent/balance',         price: '$0.001', desc: 'Wallet balance' },
];

function Line({ line }) {
  if (line.type === 'blank') return <div className="term-blank" />;
  if (line.type === 'comment') return <div className="term-line term-comment">{line.text}</div>;
  if (line.type === 'prompt')  return <div className="term-line term-prompt"><span className="term-ps1">$</span> {line.text}</div>;
  if (line.type === 'request') return (
    <div className="term-line term-request">
      <span className="term-arrow">→</span>
      <span className="term-method">{line.method}</span>
      <span className="term-url">{line.url}</span>
    </div>
  );
  if (line.type === 'payment') return (
    <div className="term-line term-payment">
      <span className="term-tag tag-pay">💰 x402</span>
      <span>{line.text}</span>
    </div>
  );
  if (line.type === 'success') return (
    <div className="term-line term-success">
      <span className="term-tag tag-ok">✅</span>
      <span>{line.text}</span>
    </div>
  );
  if (line.type === 'info') return (
    <div className="term-line term-info">
      <span className="term-tag tag-info">ℹ</span>
      <span>{line.text}</span>
    </div>
  );
  if (line.type === 'error') return (
    <div className="term-line term-error">
      <span className="term-tag tag-err">❌</span>
      <span>{line.text}</span>
    </div>
  );
  if (line.type === 'data') return (
    <div className="term-line term-data">
      <span className="term-indent" />
      <span className="term-key">{line.key}:</span>
      <span className="term-val">{line.value}</span>
    </div>
  );
  if (line.type === 'tx') return (
    <div className="term-line term-tx">
      <span className="term-indent" />
      <span className="term-key">tx:</span>
      <a
        href={`https://stellar.expert/explorer/testnet/tx/${line.hash}`}
        target="_blank"
        rel="noreferrer"
        className="term-tx-link"
      >
        {line.hash.slice(0, 12)}...{line.hash.slice(-8)} ↗
      </a>
    </div>
  );
  if (line.type === 'separator') return <div className="term-separator">{line.text}</div>;
  return <div className="term-line">{line.text}</div>;
}

function Terminal({ lines, running, onRun, done }) {
  return (
    <div className="terminal">
      <div className="terminal-bar">
        <span className="dot dot-red"/>
        <span className="dot dot-yellow"/>
        <span className="dot dot-green"/>
        <span className="terminal-title">stellar-autopay — demo</span>
        <button className="run-btn" onClick={onRun} disabled={running}>
          {running ? '⟳ Running...' : done ? '↺ Run Again' : '▶ Start Demo'}
        </button>
      </div>
      <div className="terminal-body">
        {lines.map((line, i) => <Line key={i} line={line} />)}
        {running && <div className="term-cursor">▋</div>}
      </div>
    </div>
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Tab 1: API Marketplace ────────────────────────────────────────────────
function MarketplaceDemo() {
  const [lines, setLines] = useState([
    { type: 'comment', text: "# Scenario: Fintech company connecting to your billing API" },
    { type: 'comment', text: '# Automatically pays micro-USDC via x402 for each API call' },
    { type: 'blank' },
    { type: 'prompt', text: 'Click "\u25b6 Start Demo"...' },
  ]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setDone(false);
    setLines([
      { type: 'comment', text: '# Fintech Company → Stellar Autopay API' },
      { type: 'comment', text: '# Pays USDC via x402 and receives data for each request' },
      { type: 'blank' },
    ]);

    await sleep(300);

    // 1. API Discovery
    setLines(p => [...p,
      { type: 'separator', text: '── 1. API Discovery (free) ──' },
      { type: 'prompt', text: 'GET /agent/health' },
    ]);
    await sleep(500);

    try {
      const health = await fetch(`${SERVER}/agent/health`).then(r => r.json());
      setLines(p => [...p,
        { type: 'success', text: `Connected — on ${health.network} network` },
        { type: 'data', key: 'contract', value: `${health.contractId?.slice(0, 8)}... (Soroban)` },
        { type: 'data', key: 'x402 endpoints', value: `${health.endpoints?.filter(e => e.price !== 'free').length} endpoints` },
        { type: 'data', key: 'price range', value: '$0.001 – $0.01 USDC / call' },
        { type: 'blank' },
      ]);
    } catch {
      setLines(p => [...p, { type: 'error', text: 'Server offline — cd server && npm run dev' }]);
      setRunning(false);
      return;
    }

    await sleep(500);

    // 2. x402 Gated API Call
    setLines(p => [...p,
      { type: 'separator', text: '── 2. Request to x402-Gated Endpoint ──' },
      { type: 'prompt', text: 'GET /agent/bills  # list bills' },
    ]);
    await sleep(600);

    setLines(p => [...p,
      { type: 'payment', text: '← Server: 402 Payment Required' },
      { type: 'data', key: 'required payment', value: '0.001 USDC (Stellar USDC SAC)' },
    ]);
    await sleep(500);
    setLines(p => [...p,
      { type: 'payment', text: '→ Client: building x402 payload with Ed25519 signature' },
    ]);
    await sleep(400);
    setLines(p => [...p,
      { type: 'payment', text: '→ Facilitator: x402.org verifying signature + settling on Stellar' },
    ]);
    await sleep(800);

    // 3. Real demo data
    const demo = await fetch(`${SERVER}/agent/demo`).then(r => r.json()).catch(() => null);

    if (demo) {
      const bills = demo.steps?.find(s => s.step === 3)?.data;
      setLines(p => [...p,
        { type: 'success', text: '← Server: 200 OK — payment confirmed, sending data' },
        { type: 'data', key: 'bill count', value: String(bills?.count ?? 0) },
      ]);
      if (bills?.bills?.[0]) {
        const b = bills.bills[0];
        setLines(p => [...p,
          { type: 'data', key: 'bill name', value: b.name },
          { type: 'data', key: 'amount', value: `${b.amount} ${b.asset}` },
          { type: 'data', key: 'frequency', value: b.frequency },
        ]);
      }

      setLines(p => [...p, { type: 'blank' }]);
      await sleep(400);

      // Real tx
      if (demo.livePayment) {
        const lp = demo.livePayment;
        setLines(p => [...p,
          { type: 'separator', text: '── 3. Real On-Chain Proof ──' },
          { type: 'success', text: `${lp.amount} USDC API fee settled on Stellar testnet` },
          { type: 'data', key: 'payer (client)', value: `${lp.payer.slice(0, 10)}...${lp.payer.slice(-6)}` },
          { type: 'data', key: 'receiver (API)', value: `${lp.receiver.slice(0, 10)}...${lp.receiver.slice(-6)}` },
        ]);
        if (lp.txHash) setLines(p => [...p, { type: 'tx', hash: lp.txHash }]);
        setLines(p => [...p,
          { type: 'blank' },
          { type: 'success', text: 'API Marketplace demo complete ✓' },
        ]);
      } else {
        setLines(p => [...p, { type: 'success', text: 'API Marketplace demo complete ✓' }]);
      }
    }

    setRunning(false);
    setDone(true);
  }, []);

  return (
    <div>
      <div className="tab-scenario-box">
        <div className="scenario-row">
          <div className="scenario-actor">
            <span>🏢</span>
              <div><strong>Fintech Company / AI Agent</strong><p>Has its own payment app and wants to manage users' bills</p></div>
          </div>
          <div className="scenario-flow-arrow">→ x402 →</div>
          <div className="scenario-actor">
            <span>🛠</span>
              <div><strong>Stellar Autopay API</strong><p>Price set per endpoint. No payment, no data.</p></div>
          </div>
          <div className="scenario-flow-arrow">→</div>
          <div className="scenario-actor">
            <span>🏦</span>
              <div><strong>Soroban Contract</strong><p>On-chain bill and payment records</p></div>
          </div>
        </div>
      </div>
      <Terminal lines={lines} running={running} onRun={run} done={done} />
    </div>
  );
}

// ─── Tab 2: Auto-Pay Demo ──────────────────────────────────────────────────
function AutoPayDemo() {
  const [lines, setLines] = useState([
    { type: 'comment', text: '# Scenario: User entered a bill, system auto-pays' },
    { type: 'comment', text: '# Payment triggered on each due date via session key' },
    { type: 'blank' },
    { type: 'prompt', text: 'Click "\u25b6 Start Demo"...' },
  ]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setDone(false);
    setLines([
      { type: 'comment', text: '# Auto-Pay Engine — Stellar Autopay' },
      { type: 'comment', text: '# Processing due bills automatically' },
      { type: 'blank' },
    ]);

    await sleep(300);

    // Setup phase
    setLines(p => [...p,
      { type: 'separator', text: '── 1. Session Key Setup ──' },
      { type: 'success', text: 'Session key active (one-time wallet approval)' },
      { type: 'data', key: 'authorization', value: 'NO popup per payment' },
      { type: 'data', key: 'limit', value: 'Max 100 USDC / transaction' },
      { type: 'blank' },
    ]);
    await sleep(600);

    // Fetch bills
    setLines(p => [...p,
      { type: 'separator', text: '── 2. Bill Scan ──' },
      { type: 'prompt', text: 'GET /api/panel/bills  # check for due bills' },
    ]);
    await sleep(500);

    let bills = [];
    try {
      const res = await fetch(`${SERVER}/api/panel/bills`);
      const data = await res.json();
      bills = Array.isArray(data.bills) ? data.bills : [];
    } catch {
      setLines(p => [...p, { type: 'error', text: 'Server offline — cd server && npm run dev' }]);
      setRunning(false);
      return;
    }

    const now = new Date();
    const activeBills  = bills.filter(b => b.status !== 'paid' && b.status !== 'completed' && b.status !== 'paused');
    const overdueBills = activeBills.filter(b => new Date(b.nextDueDate) <= now);
    const paidBills    = bills.filter(b => b.status === 'paid' || b.status === 'completed');

    setLines(p => [...p,
      { type: 'success', text: `← 200 OK — ${bills.length} bill(s) found` },
      { type: 'data', key: 'active', value: String(activeBills.length) },
      { type: 'data', key: 'overdue', value: String(overdueBills.length) },
      { type: 'data', key: 'paid', value: String(paidBills.length) },
    ]);
    await sleep(400);

    if (bills.length === 0) {
      setLines(p => [...p,
        { type: 'info', text: 'No active bills — please add a bill' },
      ]);
    } else {
      let paidCount = 0;

      // Show skipped paid bills briefly
      for (const b of paidBills) {
        setLines(p => [...p,
          { type: 'info', text: `${b.name} — already paid, skipping` },
        ]);
        await sleep(150);
      }

      if (activeBills.length === 0) {
        setLines(p => [...p,
          { type: 'info', text: 'All bills paid — nothing to process' },
        ]);
      } else if (overdueBills.length === 0) {
        setLines(p => [...p, { type: 'blank' }]);
        for (const b of activeBills) {
          const due      = new Date(b.nextDueDate);
          const daysLeft = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
          setLines(p => [...p,
            { type: 'separator', text: `── Bill: ${b.name} ──` },
            { type: 'data', key: 'amount',   value: `${b.amount} ${b.asset}` },
            { type: 'data', key: 'due date', value: due.toLocaleDateString('en-US') },
            { type: 'info',  text: `${daysLeft > 0 ? daysLeft + ' day(s)' : 'Today'} until due — system waiting` },
          ]);
          await sleep(300);
        }
      } else {
        // Process overdue bills — call real payment API
        setLines(p => [...p, { type: 'blank' }]);
        for (const b of overdueBills) {
          const due = new Date(b.nextDueDate);
          setLines(p => [...p,
            { type: 'separator', text: `── Bill: ${b.name} ──` },
            { type: 'data', key: 'amount',    value: `${b.amount} ${b.asset}` },
            { type: 'data', key: 'recipient', value: `${b.recipientAddress.slice(0, 8)}...${b.recipientAddress.slice(-6)}` },
            { type: 'data', key: 'due date',  value: due.toLocaleDateString('en-US') },
            { type: 'payment', text: '⚡ OVERDUE → Triggering payment...' },
            { type: 'prompt', text: `POST /api/panel/pay-direct/${b.id}  # pay via agent wallet` },
          ]);
          await sleep(500);

          let payResult = null;
          let payError  = null;
          try {
            const pr = await fetch(`${SERVER}/api/panel/pay-direct/${b.id}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            });
            payResult = await pr.json();
            if (!payResult.success) payError = payResult.error || 'Payment failed';
          } catch (e) {
            payError = e.message;
          }

          if (payError) {
            setLines(p => [...p,
              { type: 'error', text: `Payment error: ${payError}` },
            ]);
          } else if (payResult?.alreadyPaid) {
            setLines(p => [...p,
              { type: 'info', text: `${b.amount} ${b.asset} — already paid` },
            ]);
          } else {
            const txHash = payResult?.payment?.txHash;
            setLines(p => [...p,
              { type: 'success', text: `${b.amount} ${b.asset} → ${b.recipientAddress.slice(0, 8)}... paid` },
            ]);
            if (txHash) setLines(p => [...p, { type: 'tx', hash: txHash }]);
            paidCount++;
          }
          await sleep(300);
        }

        // Show pending (not yet due) active bills
        const pendingBills = activeBills.filter(b => new Date(b.nextDueDate) > now);
        for (const b of pendingBills) {
          const due      = new Date(b.nextDueDate);
          const daysLeft = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
          setLines(p => [...p,
            { type: 'separator', text: `── Bill: ${b.name} ──` },
            { type: 'data', key: 'amount', value: `${b.amount} ${b.asset}` },
            { type: 'data', key: 'due date',  value: due.toLocaleDateString('en-US') },
            { type: 'info',  text: `${daysLeft > 0 ? daysLeft + ' day(s)' : 'Today'} until due — system waiting` },
          ]);
          await sleep(200);
        }
      }

      if (paidCount > 0) {
        setLines(p => [...p,
          { type: 'blank' },
          { type: 'separator', text: '── 3. Result ──' },
          { type: 'success', text: `${paidCount} bill(s) paid — contract updated, Telegram notification sent` },
        ]);
      }
    }

    await sleep(300);
    setLines(p => [...p,
      { type: 'blank' },
      { type: 'success', text: 'Auto-Pay Engine demo complete ✓' },
    ]);

    setRunning(false);
    setDone(true);
  }, []);

  return (
    <div>
      <div className="tab-scenario-box">
        <div className="scenario-row">
          <div className="scenario-actor">
            <span>👤</span>
              <div><strong>User</strong><p>Enters a bill, approves wallet once</p></div>
          </div>
          <div className="scenario-flow-arrow">→ session key →</div>
          <div className="scenario-actor">
            <span>⚙️</span>
              <div><strong>Auto-Pay Engine</strong><p>Runs on each due date, no popups</p></div>
          </div>
          <div className="scenario-flow-arrow">→ x402 →</div>
          <div className="scenario-actor">
            <span>⚡</span>
              <div><strong>USDC Payment</strong><p>On-chain proof on Stellar testnet</p></div>
          </div>
        </div>
      </div>
      <Terminal lines={lines} running={running} onRun={run} done={done} />
    </div>
  );
}

// ─── Tab 3: Endpoints ──────────────────────────────────────────────────────
function EndpointDocs() {
  return (
    <div className="api-docs">
      <p className="api-docs-intro">
        Each endpoint (except <code>/agent/health</code> and <code>/agent/demo</code>)
        requires an <strong>x402 payment</strong>. The payment is sent as a signed
        Stellar SAC transfer in the request header. The facilitator settles on-chain
        and the server responds with 200 OK and data.
      </p>
      <div className="api-table-wrap">
        <table className="endpoint-table">
          <thead>
            <tr><th>Method</th><th>Endpoint</th><th>Price</th><th>Description</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="method-badge method-get">GET</span></td>
              <td><code className="endpoint-path">/agent/health</code></td>
              <td><span className="price-badge price-free">Free</span></td>
              <td>Status check + endpoint discovery</td>
            </tr>
            <tr>
              <td><span className="method-badge method-get">GET</span></td>
              <td><code className="endpoint-path">/agent/demo</code></td>
              <td><span className="price-badge price-free">Free</span></td>
              <td>Full system status (this demo)</td>
            </tr>
            {ENDPOINT_DOCS.map((ep) => (
              <tr key={ep.path + ep.method}>
                <td><span className={`method-badge method-${ep.method.toLowerCase()}`}>{ep.method}</span></td>
                <td><code className="endpoint-path">{ep.path}</code></td>
                <td><span className="price-badge price-paid">{ep.price}</span></td>
                <td>{ep.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="x402-flow-box">
        <p className="flow-title">x402 Protocol Flow:</p>
        <ol className="flow-list">
          <li>Agent sends request → Server returns <code>402 Payment Required</code></li>
          <li>Agent signs a Stellar SAC (USDC) payment with Ed25519</li>
          <li>Resends request with <code>X-PAYMENT</code> header</li>
          <li>Facilitator (<code>x402.org</code>) verifies + settles on Stellar testnet</li>
          <li>Server responds with <code>200 OK</code> + data</li>
        </ol>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────
export default function AgentLiveDemo() {
  const [tab, setTab] = useState('marketplace');

  return (
    <div className="agent-live-demo">
      <div className="demo-header">
        <div className="demo-title">
          <span className="demo-icon">⚡</span>
          <h2>Stellar Autopay — Bill Payment API</h2>
          <span className="demo-subtitle">API Sat · Auto-Pay · x402 · Soroban</span>
        </div>
        <div className="demo-tabs">
          <button className={`demo-tab ${tab === 'marketplace' ? 'active' : ''}`} onClick={() => setTab('marketplace')}>
            🏪 API Marketplace
          </button>
          <button className={`demo-tab ${tab === 'autopay' ? 'active' : ''}`} onClick={() => setTab('autopay')}>
            ⚡ Auto-Pay
          </button>
          <button className={`demo-tab ${tab === 'endpoints' ? 'active' : ''}`} onClick={() => setTab('endpoints')}>
            📋 Endpoints
          </button>
        </div>
      </div>

      {tab === 'marketplace' && <MarketplaceDemo />}
      {tab === 'autopay'     && <AutoPayDemo />}
      {tab === 'endpoints'   && <EndpointDocs />}
    </div>
  );
}
