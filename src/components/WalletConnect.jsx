export default function WalletConnect({ onConnect, loading, error }) {
  return (
    <div className="wallet-connect">
      <div className="wallet-connect-card landing-wide">
        {/* Header */}
        <div className="landing-header">
          <div className="logo">
            <span className="logo-icon">✦</span>
            <h1>Stellar Autopay</h1>
          </div>
          <div className="hackathon-badge">🏆 Stellar Hacks: Agents</div>
        </div>
        <p className="subtitle landing-subtitle">
          LLM-powered autonomous agents · x402 pay-per-call API · Soroban on-chain execution
        </p>

        {/* Two core innovations */}
        <div className="landing-innovations">
          <div className="innovation-card innovation-llm">
            <div className="innovation-header">
              <span className="innovation-icon">🧠</span>
              <div>
                <strong>LLM → On-Chain Action</strong>
                <span className="innovation-tag">Gemini 2.5 Flash</span>
              </div>
            </div>
            <p className="innovation-desc">
              Type a natural-language request — Gemini AI parses intent, fetches live XLM/USD price
              via x402, computes payment schedules and invokes <code>create_schedule()</code> on Soroban.
              Zero forms, zero clicks.
            </p>
            <div className="mini-flow">
              <span className="mf-node">"Hire Alice 3 days $5/hr worth of XLM"</span>
              <span className="mf-arrow">→</span>
              <span className="mf-node mf-ai">Gemini AI</span>
              <span className="mf-arrow">→</span>
              <span className="mf-node mf-chain">Soroban ✓</span>
            </div>
          </div>

          <div className="innovation-card innovation-x402">
            <div className="innovation-header">
              <span className="innovation-icon">⚡</span>
              <div>
                <strong>x402 Agentic Payments</strong>
                <span className="innovation-tag">HTTP 402</span>
              </div>
            </div>
            <p className="innovation-desc">
              Every REST endpoint is pay-per-use. Agents pay <strong>micro-USDC per API call</strong>,
              settled instantly on Stellar testnet. No API keys, no subscriptions —
              machine-native monetisation.
            </p>
            <div className="mini-flow">
              <span className="mf-node">Agent request</span>
              <span className="mf-arrow">→</span>
              <span className="mf-node mf-pay">402 + USDC</span>
              <span className="mf-arrow">→</span>
              <span className="mf-node mf-chain">Response ✓</span>
            </div>
          </div>
        </div>

        {/* Full pipeline */}
        <div className="landing-pipeline">
          <div className="pipeline-label">Full stack flow</div>
          <div className="pipeline-nodes">
            <div className="pipe-node">🗣️ Natural Language</div>
            <div className="pipe-arrow">→</div>
            <div className="pipe-node pipe-ai">🧠 Gemini AI</div>
            <div className="pipe-arrow">→</div>
            <div className="pipe-node pipe-x402">⚡ x402 Pay</div>
            <div className="pipe-arrow">→</div>
            <div className="pipe-node pipe-chain">📜 Soroban</div>
            <div className="pipe-arrow">→</div>
            <div className="pipe-node pipe-done">✦ XLM Sent</div>
          </div>
        </div>

        {/* Feature grid */}
        <div className="landing-feature-grid-new">
          <div className="lf-new">
            <span className="lf-icon">🤖</span>
            <div>
              <strong>AI Worker Hiring</strong>
              <p>LLM creates on-chain payment schedules from one sentence.</p>
            </div>
          </div>
          <div className="lf-new">
            <span className="lf-icon">💸</span>
            <div>
              <strong>x402 Micropayments</strong>
              <p>Pay-per-call API — agents pay micro-USDC, no auth needed.</p>
            </div>
          </div>
          <div className="lf-new">
            <span className="lf-icon">📜</span>
            <div>
              <strong>Soroban Smart Contracts</strong>
              <p>All bills &amp; schedules stored fully on-chain.</p>
            </div>
          </div>
          
        </div>

        {/* CTA */}
        <button
          className="connect-wallet-btn"
          onClick={onConnect}
          disabled={loading}
        >
          {loading ? 'Connecting...' : '🔗 Connect Wallet → Launch App'}
        </button>

        {error && <div className="error-msg">{error}</div>}

        <div className="supported-wallets">
          <span className="sw-label">Wallets:</span>
          {['Freighter', 'xBull', 'Lobstr', 'Albedo'].map((w) => (
            <span key={w} className="sw-chip">{w}</span>
          ))}
        </div>

        <p className="hint">
          No testnet account?{' '}
          <a href="https://laboratory.stellar.org/#account-creator?network=test" target="_blank" rel="noreferrer">
            Create one here
          </a>
          {' · '}
          <a href="https://github.com/murat48/Stellarautopayx402" target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
          {' · '}
          <a href="https://github.com/stellar/x402-stellar" target="_blank" rel="noreferrer">
            x402 protocol ↗
          </a>
        </p>
      </div>
    </div>
  );
}
