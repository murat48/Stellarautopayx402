import { useState, useCallback, useRef, useEffect } from 'react';

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

/** Parse temporal expressions from a natural-language prompt and return an ISO date string.
 * Handles: 'today', 'today at 11:58 AM', 'tomorrow at 3pm', 'next week', 'in X days', etc.
 */
function parseDateFromPrompt(promptText) {
  const p = (promptText || '').toLowerCase();
  const now = new Date();

  // Helper: apply 'at HH:MM / HH.MM / HH:MMpm' to a Date object
  function applyTime(d, src) {
    // Support both colon and dot separators (e.g. 15:17 or 15.17)
    const timeMatch = src.match(/at\s+(\d{1,2})[.:]?(\d{2})?\s*(am|pm)?/i);
    if (!timeMatch) return d;
    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2] ?? '0', 10);
    const ampm = (timeMatch[3] ?? '').toLowerCase();
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    const result = new Date(d);
    result.setHours(hours, minutes, 0, 0);
    // If the resolved time is in the past, return ASAP (1 min from now)
    // so 'today at X' where X has passed means 'immediately', not 'tomorrow'.
    if (result.getTime() < Date.now()) {
      return new Date(Date.now() + 60_000);
    }
    return result;
  }

  if (/\btoday\b/.test(p)) {
    return applyTime(now, p).toISOString();
  }
  if (/\btomorrow\b/.test(p)) {
    const d = new Date(now); d.setDate(d.getDate() + 1);
    return applyTime(d, p).toISOString();
  }
  if (/next week/.test(p)) {
    const d = new Date(now); d.setDate(d.getDate() + 7);
    return applyTime(d, p).toISOString();
  }
  if (/next month/.test(p)) {
    const d = new Date(now); d.setDate(d.getDate() + 30);
    return applyTime(d, p).toISOString();
  }
  const inDaysMatch = p.match(/in\s+(\d+)\s+days?/);
  if (inDaysMatch) {
    const d = new Date(now); d.setDate(d.getDate() + parseInt(inDaysMatch[1], 10));
    return applyTime(d, p).toISOString();
  }
  // Default: now (ASAP), but still apply time if given
  return applyTime(now, p).toISOString();
}

// ─── Demo services shown even when server is offline ──────────────────────────
const DEMO_SERVICES = [
  {
    id: 'svc-autopay-bills-001',
    name: 'Recurring Bill Management',
    description: 'Create and manage on-chain recurring payments via Soroban. Supports USDC & XLM.',
    category: 'payments',
    provider: 'Stellar Autopay',
    providerAddress: 'GDQJJRU6LA6R5KT6AZA6P2H7NGOC4EQCMZALQBTPKXFJLVT32QXWFXYW',
    price: '0.010', priceUnit: 'USDC', priceLabel: '$0.01/bill',
    schema: {
      input: { recipient: 'Stellar address', amount: 'number', asset: 'XLM|USDC', frequency: 'monthly|weekly|one-time' },
      output: { billId: 'u64', txHash: 'string', nextDueDate: 'ISO date' },
    },
    callCount: 311,
    createdAt: new Date(Date.now() - 14 * 86400_000).toISOString(),
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const CATEGORY_ICONS = { payments: '💳', ai: '🤖', data: '📡', analytics: '📊', identity: '🔐', other: '⚙️' };
const CATEGORY_COLORS = { payments: '#58a6ff', ai: '#da75f5', data: '#56d364', analytics: '#d29922', identity: '#f78166', other: '#8b949e' };

function categoryIcon(cat) { return CATEGORY_ICONS[cat] || '⚙️'; }

function PriceBadge({ label }) {
  return <span className="mkt-price-badge">{label}</span>;
}

function CategoryPill({ cat }) {
  const color = CATEGORY_COLORS[cat] || '#8b949e';
  return (
    <span className="mkt-category-pill" style={{ borderColor: color, color }}>
      {categoryIcon(cat)} {cat}
    </span>
  );
}

// ─── Inline Bill Creation Form (calls real /api/panel/bills via x402) ────────
function BillCreateForm({ serverOnline, onClose }) {
  const [form, setForm] = useState({
    name: '',
    recipientAddress: '',
    amount: '',
    asset: 'USDC',
    frequency: 'monthly',
    nextDueDate: new Date(Date.now() + 86400_000).toISOString().slice(0, 10),
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    const isOneTime = form.frequency === 'one-time';
    const payload = {
      ...form,
      amount: parseFloat(form.amount),
      type: isOneTime ? 'one-time' : 'recurring',
      frequency: isOneTime ? null : form.frequency,
      nextDueDate: new Date(form.nextDueDate).toISOString(),
    };

    if (!serverOnline) {
      // Simulate when server is offline
      await new Promise(r => setTimeout(r, 600));
      setResult({
        simulated: true,
        bill: { id: Math.floor(Math.random() * 9999), ...payload, status: 'active' },
        x402: { amount: '0.01', payer: 'CLIENT_WALLET', receiver: 'RESOURCE_WALLET' },
      });
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${SERVER}/api/panel/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || `HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    const bill = result.bill ?? result;
    const x402 = result.x402;
    return (
      <div className="bill-form-result">
        <div className="bill-form-result-header">
          ✅ Bill created via x402{result.simulated ? ' (simulated)' : ''}
        </div>
        <div className="bill-form-result-row"><span>Bill ID:</span><strong>#{bill.id ?? bill.billId ?? '—'}</strong></div>
        <div className="bill-form-result-row"><span>Name:</span><strong>{bill.name}</strong></div>
        <div className="bill-form-result-row"><span>Amount:</span><strong>{bill.amount} {bill.asset}</strong></div>
        <div className="bill-form-result-row"><span>Frequency:</span><strong>{bill.frequency}</strong></div>
        {x402 && !result.simulated && (
          <>
            <div className="bill-form-result-row"><span>x402 fee paid:</span><strong>{x402.amount} USDC</strong></div>
            {x402.txHash && (
              <div className="bill-form-result-row">
                <span>Settlement:</span>
                <a href={`https://stellar.expert/explorer/testnet/tx/${x402.txHash}`} target="_blank" rel="noreferrer" className="mkt-tx-link">
                  {x402.txHash.slice(0, 12)}...{x402.txHash.slice(-8)} ↗
                </a>
              </div>
            )}
          </>
        )}
        {result.simulated && <p className="bill-form-sim-note">ℹ Simulated — <code>cd server &amp;&amp; npm run dev</code> for real x402 settlement.</p>}
        <button className="btn-secondary btn-sm" style={{ marginTop: '0.65rem' }} onClick={onClose}>Close</button>
      </div>
    );
  }

  return (
    <form className="bill-create-form" onSubmit={handleSubmit}>
      <div className="bill-form-title">
        💳 Create Bill <span className="bill-form-x402-tag">x402 · $0.01 USDC</span>
      </div>
      <div className="panel-form-row">
        <div className="panel-field">
          <label>Bill Name</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Monthly Subscription" required maxLength={80} />
        </div>
        <div className="panel-field panel-field-sm">
          <label>Asset</label>
          <select value={form.asset} onChange={e => set('asset', e.target.value)}>
            <option value="USDC">USDC</option>
            <option value="XLM">XLM</option>
          </select>
        </div>
        <div className="panel-field panel-field-sm">
          <label>Amount</label>
          <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="10" min="0.001" step="any" required />
        </div>
      </div>
      <div className="panel-field">
        <label>Recipient Stellar Address</label>
        <input value={form.recipientAddress} onChange={e => set('recipientAddress', e.target.value)} placeholder="G..." required maxLength={56} />
      </div>
      <div className="panel-form-row">
        <div className="panel-field panel-field-sm">
          <label>Frequency</label>
          <select value={form.frequency} onChange={e => set('frequency', e.target.value)}>
            <option value="one-time">One-time</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </div>
        <div className="panel-field panel-field-sm">
          <label>First Due Date</label>
          <input type="date" value={form.nextDueDate} onChange={e => set('nextDueDate', e.target.value)} required />
        </div>
      </div>
      {error && <div className="panel-error">{error}</div>}
      <div className="panel-form-footer">
        <button type="submit" className="btn-primary panel-submit" disabled={loading}>
          {loading ? '⟳ Creating...' : '▶ Create Bill via x402'}
        </button>
        <span className="bill-form-fee-note">Fee: 0.01 USDC settled on Stellar testnet via x402</span>
      </div>
    </form>
  );
}

// ─── Service Buy Panel ────────────────────────────────────────────────────────
function BuyServicePanel({ svc, onClose }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const inputKey = svc.schema?.input
    ? Object.keys(svc.schema.input)[0]
    : 'query';
  const inputDesc = svc.schema?.input
    ? Object.values(svc.schema.input)[0]
    : 'input';

  const handleBuy = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const body = { [inputKey]: input };
      const res = await fetch(`${SERVER}/api/panel/services/${svc.id}/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Service call failed');
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className="bill-form-result">
        <div className="bill-form-result-header">
          ✅ {result.serviceName} — executed via x402
        </div>
        <div className="bill-form-result-row">
          <span>Paid:</span><strong>{result.pricePaid}</strong>
        </div>
        {result.x402?.txHash && (
          <div className="bill-form-result-row">
            <span>Settlement tx:</span>
            <a
              href={result.x402.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mkt-tx-link"
            >
              {result.x402.txHash.slice(0, 12)}…{result.x402.txHash.slice(-8)} ↗
            </a>
          </div>
        )}
        {result.result && (
          <pre className="mkt-result-json">
            {JSON.stringify(result.result, null, 2)}
          </pre>
        )}
        <button className="btn-secondary btn-sm" style={{ marginTop: '0.65rem' }} onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  return (
    <form className="bill-create-form" onSubmit={handleBuy}>
      <div className="bill-form-title">
        ▶ {svc.name}
        <span className="bill-form-x402-tag">x402 · {svc.priceLabel}</span>
      </div>
      <div className="panel-field">
        <label>{inputKey} <span className="muted-hint">({inputDesc})</span></label>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={`Enter ${inputKey}…`}
          required
          maxLength={200}
        />
      </div>
      {error && <div className="panel-error">{error}</div>}
      <div className="panel-form-footer">
        <button type="submit" className="btn-primary panel-submit" disabled={loading}>
          {loading ? '⟳ Paying & calling…' : `▶ Buy via x402 (${svc.priceLabel})`}
        </button>
        <span className="bill-form-fee-note">
          {svc.price} {svc.priceUnit} settled on Stellar testnet · protocol: x402
        </span>
      </div>
    </form>
  );
}

// ─── Service Card ─────────────────────────────────────────────────────────────
function ServiceCard({ svc }) {
  const [expanded, setExpanded] = useState(false);
  const [showBuy, setShowBuy] = useState(false);

  return (
    <div className="mkt-service-card">
      <div className="mkt-card-top">
        <div className="mkt-card-icon">{categoryIcon(svc.category)}</div>
        <div className="mkt-card-info">
          <div className="mkt-card-name">{svc.name}</div>
          <div className="mkt-card-desc">{svc.description}</div>
          <div className="mkt-card-meta">
            <CategoryPill cat={svc.category} />
            <span className="mkt-provider">by {svc.provider}</span>
            <span className="mkt-calls">↗ {svc.callCount.toLocaleString()} calls</span>
          </div>
        </div>
        <div className="mkt-card-right">
          <PriceBadge label={svc.priceLabel} />
          <button className="mkt-buy-btn" onClick={() => setShowBuy(f => !f)}>
            {showBuy ? '✕ Cancel' : '▶ Buy via x402'}
          </button>
          <button className="mkt-schema-btn" onClick={() => setExpanded(e => !e)}>
            {expanded ? '▲ Schema' : '▼ Schema'}
          </button>
        </div>
      </div>

      {expanded && svc.schema && Object.keys(svc.schema).length > 0 && (
        <div className="mkt-schema-box">
          {Object.entries(svc.schema).map(([key, val]) => (
            <div key={key} className="mkt-schema-row">
              <span className="mkt-schema-key">{key}:</span>
              <span className="mkt-schema-val">
                {typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)}
              </span>
            </div>
          ))}
        </div>
      )}

      {showBuy && (
        <BuyServicePanel svc={svc} onClose={() => setShowBuy(false)} />
      )}
    </div>
  );
}

// ─── Tab 1: Service Marketplace ───────────────────────────────────────────────
function MarketplaceTab() {
  const [services, setServices] = useState(DEMO_SERVICES);
  const [loading, setLoading] = useState(false);
  const [serverOnline, setServerOnline] = useState(null); // null=unknown true false
  const [filter, setFilter] = useState('all');
  const [showRegister, setShowRegister] = useState(false);

  const loadServices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SERVER}/api/panel/services`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setServices(data.services?.length ? data.services : DEMO_SERVICES);
      setServerOnline(true);
    } catch {
      setServerOnline(false);
      setServices(DEMO_SERVICES);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load on mount
  useEffect(() => { loadServices(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cats = ['all', ...new Set(services.map(s => s.category))];
  const filtered = filter === 'all' ? services : services.filter(s => s.category === filter);

  return (
    <div className="mkt-tab">
      <div className="mkt-top-bar">
        <div className="mkt-top-info">
          <span className="mkt-top-icon">🏪</span>
          <div>
            <div className="mkt-top-title">Agent Services Marketplace</div>
            <div className="mkt-top-sub">Agents POST their services · Other agents discover &amp; autobuy via x402 · Any agent can trade with any agent</div>
          </div>
        </div>
        <div className="mkt-top-actions">
          {serverOnline === false && (
            <span className="mkt-offline-badge">⚠ demo mode — <code>cd server &amp;&amp; npm run dev</code> for live</span>
          )}
          {serverOnline === true && (
            <span className="mkt-online-badge">● live</span>
          )}
          <button className="btn-primary btn-sm" onClick={loadServices} disabled={loading}>
            {loading ? '⟳ Loading...' : '↺ Refresh'}
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setShowRegister(r => !r)}>
            {showRegister ? '✕ Cancel' : '+ Register Service'}
          </button>
        </div>
      </div>

      {showRegister && <RegisterServiceForm onSuccess={(svc) => { setServices(s => [svc, ...s]); setShowRegister(false); }} />}

      <div className="mkt-filter-row">
        {cats.map(c => (
          <button key={c} className={`mkt-filter-btn ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>
            {c === 'all' ? '🌐 All' : `${categoryIcon(c)} ${c}`}
          </button>
        ))}
      </div>
      <div className="mkt-services-list">
        {filtered.map(svc => (
          <ServiceCard key={svc.id} svc={svc} />
        ))}
      </div>

    </div>
  );
}

// ─── Register Service Form ────────────────────────────────────────────────────
function RegisterServiceForm({ onSuccess }) {
  const [form, setForm] = useState({ name: '', description: '', category: 'other', provider: '', providerAddress: '', price: '0.005', priceUnit: 'USDC' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${SERVER}/api/panel/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          setError('x402 Payment Required — need USDC to register a service on the marketplace');
        } else {
          setError(data.error || `HTTP ${res.status}`);
        }
      } else {
        onSuccess(data.service);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="mkt-register-form" onSubmit={handleSubmit}>
      <div className="mkt-register-title">📝 Register New Service</div>
      <div className="panel-form-row">
        <div className="panel-field">
          <label>Service Name</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Weather API" required maxLength={100} />
        </div>
        <div className="panel-field panel-field-sm">
          <label>Category</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}>
            {['payments', 'ai', 'data', 'analytics', 'identity', 'other'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="panel-field">
        <label>Description</label>
        <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="What does this service do?" required maxLength={500} />
      </div>
      <div className="panel-form-row">
        <div className="panel-field">
          <label>Provider Name</label>
          <input value={form.provider} onChange={e => set('provider', e.target.value)} placeholder="Agent-XYZ" required maxLength={100} />
        </div>
        <div className="panel-field">
          <label>Provider Stellar Address</label>
          <input value={form.providerAddress} onChange={e => set('providerAddress', e.target.value)} placeholder="G..." required maxLength={56} />
        </div>
      </div>
      <div className="panel-form-row">
        <div className="panel-field panel-field-sm">
          <label>Price per call</label>
          <input type="number" value={form.price} onChange={e => set('price', e.target.value)} step="0.001" min="0.001" max="100" required />
        </div>
        <div className="panel-field panel-field-sm">
          <label>Unit</label>
          <select value={form.priceUnit} onChange={e => set('priceUnit', e.target.value)}>
            <option value="USDC">USDC</option>
            <option value="XLM">XLM</option>
          </select>
        </div>
      </div>
      {error && <div className="panel-error">{error}</div>}
      <div className="panel-form-footer">
        <button type="submit" className="btn-primary panel-submit" disabled={loading}>
          {loading ? '⟳ Registering...' : '✓ Register Service'}
        </button>
        <span className="mkt-register-note">Cost: $0.002 USDC via x402 to list on marketplace</span>
      </div>
    </form>
  );
}

// ─── LLM Agent Reasoning Log ─────────────────────────────────────────────────
const EXPLORER = 'https://stellar.expert/explorer/testnet/tx/';

/** Render a sub-line, turning any "tx: <hex16>…" token into a clickable link */
function SubWithTxLink({ text }) {
  // Match pattern: "tx: <16 hex chars>…" — full hash lives in the server result cards
  const parts = text.split(/(tx:\s*[0-9a-f]{16}[…\.]+)/i);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/tx:\s*([0-9a-f]{16})[…\.]+/i);
        if (m) {
          // We only have 16 chars here; link to search page so explorer can find the tx
          const partial = m[1];
          return (
            <a
              key={i}
              href={`${EXPLORER}${partial}`}
              target="_blank"
              rel="noopener noreferrer"
              className="llm-tx-link"
            >
              {part.trim()}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function ThinkLine({ step }) {
  const icons = { think: '🧠', search: '🔍', compare: '⚖️', decide: '✅', execute: '⚡', result: '📋', error: '❌', pay: '💰' };
  return (
    <div className={`llm-step llm-step-${step.type}`}>
      <span className="llm-step-icon">{icons[step.type] || '·'}</span>
      <span className="llm-step-text">{step.text}</span>
      {step.sub && (
        <span className="llm-step-sub">
          {step.txHash
            ? (
              <>
                {step.sub.replace(/tx:\s*[0-9a-f]+[…\.]+\s*/i, '')}
                <a
                  href={`${EXPLORER}${step.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="llm-tx-link"
                >
                  tx: {step.txHash.slice(0, 12)}…{step.txHash.slice(-8)} ↗
                </a>
              </>
            )
            : <SubWithTxLink text={step.sub} />
          }
        </span>
      )}
    </div>
  );
}

const EXAMPLE_PROMPTS = [
  'I need to send $10/month to walletaddress',
  'Send $10 worth of XLM to yourwalletaddress',
];

// ─── Tab 2: LLM Agent ─────────────────────────────────────────────────────────
function LLMAgentTab() {
  const [prompt, setPrompt] = useState('');
  const [steps, setSteps] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [answer, setAnswer] = useState('');
  const [txResult, setTxResult] = useState(null);
  const logsRef = useRef(null);

  const addStep = (step) => {
    setSteps(s => [...s, step]);
    setTimeout(() => logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: 'smooth' }), 50);
  };

  const runAgent = useCallback(async (userPrompt) => {
    if (!userPrompt.trim() || thinking) return;
    setThinking(true);
    setSteps([]);
    setAnswer('');
    setTxResult(null);

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await sleep(150);

    // ── Try Gemini endpoint first ──────────────────────────────────────────
    let usedGemini = false;
    try {
      const res = await fetch(`${SERVER}/api/agent/reason`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userPrompt,
          clientLocalISO: new Date().toISOString(),
          clientTzOffset: -new Date().getTimezoneOffset(), // minutes east of UTC
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.reasoning)) {
          usedGemini = true;

          // Animate each reasoning step
          for (const step of data.reasoning) {
            addStep(step);
            await sleep(320);
          }

          // Show execution result
          const exec = data.executionResult;
          if (exec?.success && exec.billId != null) {
            setTxResult({
              billId: exec.billId,
              amount: exec.amount ?? data.params?.amount,
              asset: exec.asset ?? data.params?.asset ?? 'USDC',
              frequency: exec.frequency ?? data.params?.frequency ?? 'monthly',
              recipient: exec.recipientAddress ?? data.params?.recipientAddress ?? '',
              paidImmediately: exec.paidImmediately ?? false,
              payTxHash: exec.payTxHash ?? null,
              x402TxHash: exec.x402TxHash ?? null,
              explorerUrl: exec.payTxHash
                ? `https://stellar.expert/explorer/testnet/tx/${exec.payTxHash}`
                : `https://stellar.expert/explorer/testnet/contract/${
                    import.meta.env.VITE_CONTRACT_ID || 'CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS'
                  }`,
            });
          } else if (exec?.success && exec.services) {
            // service discovery result
            setTxResult({ services: exec.services, bestMatch: exec.bestMatch });
          } else if (exec?.success && exec.serviceId) {
            // service buy result
            setTxResult({
              serviceId: exec.serviceId,
              serviceName: exec.serviceName,
              pricePaid: exec.pricePaid,
              buyTxHash: exec.buyTxHash,
              result: exec.result,
              explorerUrl: exec.buyTxHash
                ? `https://stellar.expert/explorer/testnet/tx/${exec.buyTxHash}`
                : null,
            });
          }

          setAnswer(data.answer || '');
        }
      }
      // 503 = GEMINI_API_KEY not set → fall through silently to scripted logic
    } catch { /* server offline → fall through */ }

    if (usedGemini) {
      setThinking(false);
      return;
    }

    // ── Scripted fallback (offline / no Gemini key) ────────────────────────
    const p = userPrompt.toLowerCase();
    addStep({ type: 'think', text: `Analyzing intent: "${userPrompt}"` });
    await sleep(500);

    const recurringMatch = p.match(/send\s+\$?(\d+(?:\.\d+)?)\s*(?:\/month|per month|monthly)?.*?(to\s+(\w+)|[A-Z]{56})?/i);
    const isRecurring = /month|week|recurring|every/i.test(p) && /send|pay|transfer/i.test(p);
    const isOneTimeSend = /send|pay|transfer/i.test(p) && !/month|week|recurring|every/i.test(p);
    const isSearch = /find|search|cheapest|available|what service/i.test(p);
    const isBuy = /pay for|buy|purchase|use/i.test(p) && !isOneTimeSend;

    if (isOneTimeSend && !isRecurring) {
      addStep({ type: 'think', text: 'Intent detected: One-time payment', sub: 'Scheduling for soonest possible execution (ASAP)...' });
      await sleep(400);
      addStep({ type: 'decide', text: 'Decision: Use Stellar Autopay contract (one-time bill)', sub: 'On-chain record + x402 $0.01 access fee' });
      await sleep(400);

      const amtMatch = userPrompt.match(/\$?(\d+(?:\.\d+)?)/);
      const amount = amtMatch ? amtMatch[1] : '10';
      const assetMatch = /\bxlm\b/i.test(userPrompt) ? 'XLM' : 'USDC';
      const stellarAddrMatch = userPrompt.match(/G[A-Z0-9]{55}/);
      const recipientAddress = stellarAddrMatch ? stellarAddrMatch[0] : null;

      if (!recipientAddress) {
        addStep({ type: 'error', text: 'Missing recipient Stellar address', sub: 'Provide a full G... address (56 chars) to proceed' });
        setAnswer('Please include the recipient\'s Stellar address (starts with G, 56 characters) in your request.');
        setThinking(false);
        return;
      }

      addStep({ type: 'pay', text: 'Sending x402 micropayment to bill API...', sub: '$0.01 USDC → Stellar Autopay resource wallet' });
      await sleep(700);
      addStep({ type: 'execute', text: `POST /api/panel/bills { amount: ${amount}, asset: ${assetMatch}, frequency: one-time }` });
      await sleep(500);

      let billData = null;
      let x402Data = null;
      let serverOffline = false;
      try {
        const res = await fetch(`${SERVER}/api/panel/bills`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Agent one-time payment ${amount} ${assetMatch}`,
            recipientAddress,
            amount: parseFloat(amount),
            asset: assetMatch,
            type: 'one-time',
            frequency: 'one-time',
            nextDueDate: parseDateFromPrompt(userPrompt),
          }),
        });
        const json = await res.json();
        if (res.ok && json.success) {
          billData = json.bill ?? json.data ?? json;
          x402Data = json.x402 ?? null;
          const billId = billData?.id ?? billData?.billId ?? '?';
          addStep({ type: 'result', text: `← 201 Created — Bill #${billId} scheduled for immediate execution` });
          if (x402Data?.txHash) {
            addStep({ type: 'pay', text: `x402 tx: ${x402Data.txHash.slice(0, 12)}...${x402Data.txHash.slice(-8)}` });
          }
        } else {
          addStep({ type: 'error', text: `Server error: ${json.error || res.status}` });
        }
      } catch {
        serverOffline = true;
        addStep({ type: 'think', text: 'Server offline — showing simulated result' });
      }

      await sleep(300);
      if (billData) {
        const billId = billData?.id ?? billData?.billId;
        setAnswer(`✅ One-time payment scheduled (ASAP):\n${amount} ${assetMatch} → ${recipientAddress}\nBill ID: #${billId}`);
      } else {
        setAnswer(`${serverOffline ? '⚠ Server offline — start with: cd server && npm run dev\n\n' : ''}One-time payment: ${amount} ${assetMatch} → ${recipientAddress || 'recipient'}\nUse GEMINI_API_KEY in server/.env for full agent execution.`);
      }

    } else if (isRecurring || recurringMatch) {
      addStep({ type: 'think', text: 'Intent detected: Recurring payment setup', sub: 'Analyzing options...' });
      await sleep(400);
      addStep({ type: 'search', text: 'Option A: Direct Stellar transfer (Horizon)', sub: 'Cost: network fee ~0.0001 XLM, but requires manual signing each time' });
      await sleep(400);
      addStep({ type: 'search', text: 'Option B: Stellar Autopay on-chain contract', sub: 'Cost: ~0.01 USDC/bill via x402 + auto-execution' });
      await sleep(400);
      addStep({ type: 'compare', text: 'Comparing paths...', sub: 'Direct: cheapest per-tx but no automation  |  Autopay contract: best for recurring' });
      await sleep(600);
      addStep({ type: 'decide', text: 'Decision: Use Stellar Autopay contract', sub: 'Reason: automated recurring, on-chain audit trail, x402 priced at $0.01' });
      await sleep(400);

      const amtMatch = userPrompt.match(/\$?(\d+(?:\.\d+)?)/);
      const amount = amtMatch ? amtMatch[1] : '10';
      const stellarAddrMatch = userPrompt.match(/G[A-Z0-9]{55}/);
      const recipientAddress = stellarAddrMatch
        ? stellarAddrMatch[0]
        : 'GCNA5EMJNXZPO57ARVJYQ5SN2DYYPD6ZCCENQ5AQTMVNKN77RDIPMI3A';

      addStep({ type: 'pay', text: 'Sending x402 micropayment to bill API...', sub: '$0.01 USDC → Stellar Autopay resource wallet' });
      await sleep(700);
      addStep({ type: 'execute', text: `POST /api/panel/bills { amount: ${amount}, asset: USDC, frequency: monthly }` });
      await sleep(500);

      let billData = null;
      let x402Data = null;
      let serverOffline = false;
      try {
        const res = await fetch(`${SERVER}/api/panel/bills`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Agent recurring payment $${amount}/month`,
            recipientAddress,
            amount: parseFloat(amount),
            asset: 'USDC',
            frequency: 'monthly',
            nextDueDate: parseDateFromPrompt(userPrompt),
          }),
        });
        const json = await res.json();
        if (res.ok && json.success) {
          billData = json.bill ?? json.data ?? json;
          x402Data = json.x402 ?? null;
          const billId = billData?.id ?? billData?.billId ?? '?';
          addStep({ type: 'result', text: `← 201 Created — Bill #${billId} registered on Soroban contract` });
          if (x402Data?.txHash) {
            addStep({ type: 'pay', text: `x402 settlement tx: ${x402Data.txHash.slice(0, 12)}...${x402Data.txHash.slice(-8)}`, sub: `${x402Data.amount} USDC settled on Stellar testnet` });
          }
        } else {
          addStep({ type: 'error', text: `Server error: ${json.error || res.status}` });
        }
      } catch {
        serverOffline = true;
        addStep({ type: 'think', text: 'Server offline — showing simulated result' });
      }

      await sleep(300);
      if (billData) {
        const billId = billData?.id ?? billData?.billId;
        const txHash = x402Data?.txHash;
        if (txHash) {
          setTxResult({ billId, txHash, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txHash}`, amount, recipient: recipientAddress, x402Amount: x402Data?.amount, payer: x402Data?.payer });
        }
        setAnswer(`✅ Recurring payment created: $${amount}/month via Stellar Autopay contract.\n\nBill ID: #${billId}\nRecipient: ${recipientAddress}\nAsset: USDC · Frequency: monthly`);
      } else {
        setAnswer(`${serverOffline ? '⚠ Server offline — start with: cd server && npm run dev\n\n' : ''}Recurring payment: $${amount}/month via Stellar Autopay.\nProtocol: x402 $0.01 USDC gated API.`);
      }

    } else if (isSearch) {
      addStep({ type: 'think', text: 'Intent detected: Service discovery' });
      await sleep(400);
      addStep({ type: 'search', text: 'Querying Agent Services Marketplace...', sub: 'GET /agent/services' });
      await sleep(600);
      let services = [];
      try {
        const res = await fetch(`${SERVER}/api/panel/services`);
        if (res.ok) { const data = await res.json(); services = data.services || []; }
      } catch { /* offline */ }
      if (!services.length) {
        addStep({ type: 'think', text: 'Using fallback service registry' });
        services = [{ name: 'Recurring Bill Management', provider: 'Stellar Autopay', priceLabel: '$0.01/bill', category: 'payments' }];
      }
      for (const s of services.slice(0, 3)) { addStep({ type: 'result', text: s.name, sub: `${s.provider} — ${s.priceLabel}` }); await sleep(200); }
      setAnswer(`Found ${services.length} service(s).\n\nTop: ${services[0]?.name} (${services[0]?.priceLabel}) by ${services[0]?.provider}\nAll purchasable via x402 USDC micropayment.`);

    } else if (isBuy) {
      addStep({ type: 'think', text: 'Intent detected: Service purchase' });
      await sleep(400);
      addStep({ type: 'search', text: 'Looking up service on marketplace...' });
      await sleep(600);
      addStep({ type: 'decide', text: 'Selected: Recurring Bill Management ($0.01/bill)' });
      await sleep(400);
      addStep({ type: 'pay', text: 'Sending x402 payment: $0.01 USDC', sub: 'Attaching signed X-PAYMENT header...' });
      await sleep(500);
      setAnswer(`Service located. In live mode: agent attaches X-PAYMENT header → x402 settles → service executes.`);

    } else {
      addStep({ type: 'think', text: 'Analyzing request...' });
      await sleep(400);
      addStep({ type: 'think', text: 'Could not match a specific intent. Showing help.' });
      await sleep(300);
      setAnswer(`I can help with:\n• "Send $10/month to alice" → recurring payment\n• "Find cheapest sentiment analysis" → search marketplace\n• "Pay for web search about Stellar" → buy & execute\n\nTip: Add GEMINI_API_KEY to server/.env for real LLM reasoning.`);
    }

    setThinking(false);
  }, [thinking]);

  return (
    <div className="llm-tab">
      <div className="llm-intro">
        <div className="llm-intro-icon">🤖</div>
        <div>
          <div className="llm-intro-title">LLM-Powered Payment Agent</div>
          <div className="llm-intro-sub">Natural language → reasoning → cheapest path → x402 execution</div>
        </div>
      </div>

      <div className="llm-input-row">
        <input
          className="llm-input"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && runAgent(prompt)}
          placeholder='e.g. "Set up $50/month USDC recurring payment to G..."'
          disabled={thinking}
        />
        <button className="btn-primary" onClick={() => runAgent(prompt)} disabled={thinking || !prompt.trim()}>
          {thinking ? '⟳ Thinking...' : '▶ Run Agent'}
        </button>
      </div>

      <div className="llm-examples">
        {EXAMPLE_PROMPTS.map(p => (
          <button key={p} className="llm-example-chip" onClick={() => { setPrompt(p); runAgent(p); }} disabled={thinking}>
            {p}
          </button>
        ))}
      </div>

      {(steps.length > 0 || thinking) && (
        <div className="llm-log" ref={logsRef}>
          <div className="llm-log-header">🧠 Agent Reasoning Trace</div>
          {steps.map((s, i) => <ThinkLine key={i} step={s} />)}
          {thinking && <div className="llm-thinking-cursor">▋</div>}
        </div>
      )}

      {answer && (
        <div className="llm-answer">
          <div className="llm-answer-header">📋 Agent Response</div>
          <pre className="llm-answer-text">{answer}</pre>
        </div>
      )}

      {txResult && txResult.billId != null && (
        <div className="llm-tx-card">
          <div className="llm-tx-card-header">
            {txResult.paidImmediately ? '✅ Payment Sent Immediately' : '⛓ On-Chain Bill Created'}
          </div>
          <div className="llm-tx-row"><span>Bill ID</span><strong>#{txResult.billId}</strong></div>
          <div className="llm-tx-row"><span>Amount</span><strong>{txResult.amount} {txResult.asset ?? 'USDC'} / {txResult.frequency ?? 'month'}</strong></div>
          {txResult.recipient && (
            <div className="llm-tx-row">
              <span>Recipient</span>
              <code className="llm-addr">{txResult.recipient.slice(0, 10)}...{txResult.recipient.slice(-6)}</code>
            </div>
          )}
          {txResult.x402Amount && (
            <div className="llm-tx-row"><span>x402 fee paid</span><strong>{txResult.x402Amount} USDC</strong></div>
          )}
          {txResult.x402TxHash && (
            <div className="llm-tx-row">
              <span>x402 fee tx</span>
              <a href={`https://stellar.expert/explorer/testnet/tx/${txResult.x402TxHash}`} target="_blank" rel="noreferrer" className="mkt-tx-link">
                {txResult.x402TxHash.slice(0, 12)}...{txResult.x402TxHash.slice(-8)} ↗
              </a>
            </div>
          )}
          {txResult.payer && (
            <div className="llm-tx-row"><span>Payer wallet</span><code className="llm-addr">{txResult.payer.slice(0, 8)}...{txResult.payer.slice(-6)}</code></div>
          )}
          <div className="llm-tx-row">
            <span>{txResult.paidImmediately ? 'Payment TX' : (txResult.txHash ? 'Settlement TX' : 'Contract')}</span>
            <a href={txResult.explorerUrl} target="_blank" rel="noreferrer" className="mkt-tx-link">
              {(txResult.payTxHash || txResult.txHash)
                ? `${(txResult.payTxHash || txResult.txHash).slice(0, 12)}...${(txResult.payTxHash || txResult.txHash).slice(-8)} ↗`
                : 'View on Stellar Expert ↗'}
            </a>
          </div>
        </div>
      )}

      {txResult && txResult.serviceId && (
        <div className="llm-tx-card">
          <div className="llm-tx-card-header">✅ Service Purchased via x402</div>
          <div className="llm-tx-row"><span>Service</span><strong>{txResult.serviceName}</strong></div>
          <div className="llm-tx-row"><span>Paid</span><strong>{txResult.pricePaid}</strong></div>
          {txResult.discoverTxHash && (
            <div className="llm-tx-row">
              <span>Discovery TX</span>
              <a href={`https://stellar.expert/explorer/testnet/tx/${txResult.discoverTxHash}`} target="_blank" rel="noreferrer" className="mkt-tx-link">
                {txResult.discoverTxHash.slice(0, 12)}...{txResult.discoverTxHash.slice(-8)} ↗
              </a>
            </div>
          )}
          {txResult.buyTxHash && (
            <div className="llm-tx-row">
              <span>Purchase TX</span>
              <a href={txResult.explorerUrl} target="_blank" rel="noreferrer" className="mkt-tx-link">
                {txResult.buyTxHash.slice(0, 12)}...{txResult.buyTxHash.slice(-8)} ↗
              </a>
            </div>
          )}
          {txResult.result && (
            <pre className="mkt-result-json">{JSON.stringify(txResult.result, null, 2)}</pre>
          )}
        </div>
      )}

      {txResult && txResult.services && (
        <div className="llm-tx-card">
          <div className="llm-tx-card-header">🏪 {txResult.services.length} Services Found</div>
          {txResult.bestMatch && (
            <div className="llm-tx-row"><span>Best match</span><strong>{txResult.bestMatch.name} — {txResult.bestMatch.priceLabel}</strong></div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab 3: Privacy Pool ───────────────────────────────────────────────────────
function PrivacyPoolTab() {
  const [batching, setBatching] = useState(false);
  const [batched, setBatched] = useState([]);
  const [status, setStatus] = useState('');

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const simulateBatch = async () => {
    setBatching(true);
    setStatus('');
    setBatched([]);

    const agents = [
      { id: 'Agent-1', amount: '0.01', service: 'Web Search' },
      { id: 'Agent-2', amount: '0.005', service: 'Sentiment Analysis' },
      { id: 'Agent-3', amount: '0.001', service: 'Price Feed' },
      { id: 'Agent-4', amount: '0.002', service: 'Bill Management' },
    ];

    for (const a of agents) {
      await sleep(350);
      setBatched(b => [...b, { ...a, status: 'pooled' }]);
    }

    await sleep(600);
    setStatus('Encrypting batch with ChaCha20-Poly1305...');
    await sleep(800);
    setStatus('Operator settling batch to Stellar testnet...');
    await sleep(900);
    setStatus('✅ Batch settled. 4 agents paid, identities unlinkable.');
    setBatched(b => b.map(a => ({ ...a, status: 'settled' })));
    setBatching(false);
  };

  return (
    <div className="privacy-tab">
      <div className="privacy-header">
        <span className="privacy-icon">🔒</span>
        <div>
          <div className="privacy-title">Privacy Pool</div>
          <div className="privacy-sub">Batch x402 payments through an encrypted relay — agents stay unlinkable on-chain</div>
        </div>
      </div>

      <div className="privacy-how">
        <div className="privacy-step"><span>1</span><div>Agents submit x402 payments to the encrypted relay instead of directly to providers</div></div>
        <div className="privacy-step"><span>2</span><div>Operator collects N payments into a batch within a time window</div></div>
        <div className="privacy-step"><span>3</span><div>Batch settled as a single Stellar transaction — individual agents are unlinkable</div></div>
        <div className="privacy-step"><span>4</span><div>Service results returned to each agent via encrypted channel</div></div>
      </div>

      <button className="btn-primary" onClick={simulateBatch} disabled={batching}>
        {batching ? '⟳ Batching...' : '▶ Simulate Privacy Pool'}
      </button>

      {batched.length > 0 && (
        <div className="privacy-batch-list">
          {batched.map((a, i) => (
            <div key={i} className={`privacy-batch-item ${a.status}`}>
              <span className="privacy-agent">{a.id}</span>
              <span className="privacy-service">{a.service}</span>
              <span className="privacy-amount">{a.amount} USDC</span>
              <span className={`privacy-status-badge ${a.status}`}>{a.status === 'settled' ? '✅ settled' : '⟳ pooling'}</span>
            </div>
          ))}
        </div>
      )}

      {status && <div className="privacy-status">{status}</div>}

      <div className="privacy-note">
        🚧 <strong>Proof of concept</strong> — full implementation would use a trusted relay with ZK proofs or threshold encryption. This demo shows the user flow.
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────
export default function AgentMarketplace() {
  const [tab, setTab] = useState('marketplace');

  return (
    <div className="agent-marketplace">
      <div className="mkt-header">
        <div className="mkt-header-left">
          <span className="mkt-header-icon">🤖</span>
          <div>
            <h2 className="mkt-header-title">Agent Commerce Hub</h2>
            <p className="mkt-header-sub">Service discovery · Agent-to-agent x402 payments · LLM reasoning · Privacy pool</p>
          </div>
        </div>
        <div className="mkt-header-tabs">
          <button className={`mkt-tab-btn ${tab === 'marketplace' ? 'active' : ''}`} onClick={() => setTab('marketplace')}>
            🏪 Marketplace
          </button>
          <button className={`mkt-tab-btn ${tab === 'agent' ? 'active' : ''}`} onClick={() => setTab('agent')}>
            🤖 LLM Agent
          </button>
          <button className={`mkt-tab-btn ${tab === 'privacy' ? 'active' : ''}`} onClick={() => setTab('privacy')}>
            🔒 Privacy Pool
          </button>
        </div>
      </div>

      <div className="mkt-body">
        {tab === 'marketplace' && <MarketplaceTab />}
        {tab === 'agent'       && <LLMAgentTab />}
        {tab === 'privacy'     && <PrivacyPoolTab />}
      </div>
    </div>
  );
}
