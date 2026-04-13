import { useState, useCallback, useRef } from 'react';

const SERVER = import.meta.env.VITE_SERVER_URL || '';

async function safeJson(res) {
  const text = await res.text();
  if (!text.trim()) throw new Error('Empty response — is the server running?');
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON from server'); }
}

const EXAMPLE_PROMPTS = [
  'Hire Eric for 3 days starting today 22.50, $5/hour worth of XLM, 8h/day to ericwalletaddress',
  
];

const EXPLORER = 'https://stellar.expert/explorer/testnet/tx/';

function ThinkLine({ step }) {
  const icons = {
    think:   '🧠',
    search:  '🔍',
    compare: '⚖️',
    decide:  '✅',
    execute: '⚡',
    result:  '📋',
    error:   '❌',
    pay:     '💰',
  };
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
            : step.sub
          }
        </span>
      )}
    </div>
  );
}

export default function WorkerAgentChat({ onScheduleCreated }) {
  const [prompt, setPrompt]     = useState('');
  const [steps, setSteps]       = useState([]);
  const [thinking, setThinking] = useState(false);
  const [answer, setAnswer]     = useState('');
  const [result, setResult]     = useState(null);
  const logsRef = useRef(null);

  const scrollLogs = () =>
    setTimeout(() => logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: 'smooth' }), 50);

  const addStep = (step) => {
    setSteps(s => [...s, step]);
    scrollLogs();
  };

  const runAgent = useCallback(async (userPrompt) => {
    if (!userPrompt.trim() || thinking) return;
    setThinking(true);
    setSteps([]);
    setAnswer('');
    setResult(null);

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await sleep(120);

    try {
      const res = await fetch(`${SERVER}/api/agent/worker-reason`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userPrompt,
          clientLocalISO: new Date().toISOString(),
          clientTzOffset: -new Date().getTimezoneOffset(),
        }),
      });

      const data = await safeJson(res);

      if (!res.ok || !data.success) {
        addStep({ type: 'error', text: data.error || 'Agent request failed' });
        setAnswer(data.error || 'Something went wrong. Please try again.');
        setThinking(false);
        return;
      }

      // Animate reasoning steps
      for (const step of (data.reasoning || [])) {
        addStep(step);
        await sleep(280);
      }

      setAnswer(data.answer || '');

      const exec = data.executionResult;
      if (exec?.success && exec.schedule) {
        setResult({ schedule: exec.schedule, priceTxHash: exec.priceTxHash ?? null });
        onScheduleCreated?.();
      } else if (exec && !exec.success) {
        setAnswer(prev => prev || exec.error || 'Could not create schedule.');
      }
    } catch (err) {
      addStep({ type: 'error', text: `Network error: ${err.message}` });
      setAnswer('Could not reach the server. Make sure the server is running.');
    }

    setThinking(false);
  }, [thinking, onScheduleCreated]);

  const handleSubmit = (e) => {
    e.preventDefault();
    runAgent(prompt);
  };

  return (
    <div className="wac-container">
      <div className="wac-header">
        <span className="wac-icon">🤖</span>
        <div>
          <h3 className="wac-title">Worker Hiring Agent</h3>
          <p className="wac-subtitle">
            Describe who you want to hire — the AI parses the request and schedules hourly payments automatically.
          </p>
        </div>
      </div>

      {/* Example prompts */}
      <div className="wac-examples">
        <span className="wac-examples-label">Try:</span>
        {EXAMPLE_PROMPTS.map((ex, i) => (
          <button
            key={i}
            className="wac-example-chip"
            onClick={() => { setPrompt(ex); }}
            disabled={thinking}
          >
            {ex.length > 60 ? ex.slice(0, 60) + '…' : ex}
          </button>
        ))}
      </div>

      {/* Input */}
      <form className="wac-form" onSubmit={handleSubmit}>
        <textarea
          className="wac-textarea"
          rows={3}
          placeholder="e.g. Hire Ahmed for 3 days starting tomorrow, 8 hours/day, $10/hr USDC, work starts at 09:00, paying to G..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={thinking}
        />
        <button
          type="submit"
          className="btn-primary wac-submit"
          disabled={thinking || !prompt.trim()}
        >
          {thinking ? '⟳ Agent thinking…' : '▶ Run Agent'}
        </button>
      </form>

      {/* Reasoning log */}
      {steps.length > 0 && (
        <div className="wac-logs" ref={logsRef}>
          <div className="wac-logs-title">Agent Reasoning</div>
          {steps.map((s, i) => <ThinkLine key={i} step={s} />)}
          {thinking && <div className="llm-cursor">▋</div>}
        </div>
      )}

      {/* Answer */}
      {answer && !thinking && (
        <div className="wac-answer">
          <span className="wac-answer-icon">💬</span>
          <p>{answer}</p>
        </div>
      )}

      {/* Success card — stays visible until user sends a new prompt */}
      {result && (
        <div className="wac-result-card">
          <div className="wac-result-title">✅ Schedule Created</div>
          <div className="wac-result-rows">
            <div className="wac-result-row">
              <span className="wac-result-key">Worker</span>
              <span className="wac-result-val">{result.schedule.workerName}</span>
            </div>
            <div className="wac-result-row">
              <span className="wac-result-key">Address</span>
              <span className="wac-result-val wac-addr">
                {result.schedule.workerAddress.slice(0, 10)}…{result.schedule.workerAddress.slice(-6)}
              </span>
            </div>
            <div className="wac-result-row">
              <span className="wac-result-key">Rate</span>
              <span className="wac-result-val">
                {result.schedule.hourlyUsdBudget
                  ? `$${result.schedule.hourlyUsdBudget}/hr in XLM (live rate at payment time)`
                  : `${parseFloat(result.schedule.hourlyRate).toFixed(4)} ${result.schedule.asset}/hr`
                }
              </span>
            </div>
            <div className="wac-result-row">
              <span className="wac-result-key">Asset</span>
              <span className="wac-result-val">{result.schedule.asset}</span>
            </div>
            <div className="wac-result-row">
              <span className="wac-result-key">Shift starts</span>
              <span className="wac-result-val">{result.schedule.workStartTime}</span>
            </div>
            <div className="wac-result-row">
              <span className="wac-result-key">Payments</span>
              <span className="wac-result-val">{result.schedule.payments.length} scheduled hourly</span>
            </div>
            <div className="wac-result-row">
              <span className="wac-result-key">Schedule ID</span>
              <span className="wac-result-val">
                <code style={{fontSize:'0.8rem'}}>{result.schedule.id}</code>
              </span>
            </div>
            {result.priceTxHash && (
              <div className="wac-result-row">
                <span className="wac-result-key">Price feed TX</span>
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${result.priceTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mkt-tx-link"
                  style={{fontSize:'0.85rem'}}
                >
                  {result.priceTxHash.slice(0, 12)}…{result.priceTxHash.slice(-8)} ↗
                </a>
              </div>
            )}
          </div>
          {result.schedule.hourlyUsdBudget && (
            <p className="wac-result-note" style={{color:'#60a5fa'}}>
              ⓘ Each hourly payment will query the live XLM/USD rate at execution time — the worker always receives the correct USD equivalent.
            </p>
          )}
          <p className="wac-result-note">
            Schedule is live. Hourly payments are sent automatically by the server.
          </p>
        </div>
      )}
    </div>
  );
}
