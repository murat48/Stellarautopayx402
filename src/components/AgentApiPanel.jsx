import useAgentApi from '../hooks/useAgentApi';

function methodBadge(route) {
  const method = route.split(' ')[0];
  const colors = { GET: 'method-get', POST: 'method-post', DELETE: 'method-delete' };
  return <span className={`method-badge ${colors[method] || ''}`}>{method}</span>;
}

function priceBadge(price) {
  if (price === 'free') return <span className="price-badge price-free">Free</span>;
  return <span className="price-badge price-paid">{price} USDC</span>;
}

export default function AgentApiPanel() {
  const { status, health, loading, lastChecked, checkHealth } = useAgentApi();

  const isOnline = status === 'online';
  const isOffline = status === 'offline';

  const agentShort = health?.agentAddress
    ? `${health.agentAddress.slice(0, 6)}...${health.agentAddress.slice(-4)}`
    : null;

  return (
    <div className="agent-api-panel">
      <div className="agent-api-header">
        <div className="agent-api-title">
          <span className="agent-api-icon">🤖</span>
          <h2>Agent API</h2>
          <span className={`status-dot ${isOnline ? 'dot-online' : isOffline ? 'dot-offline' : 'dot-unknown'}`} />
          <span className={`status-label ${isOnline ? 'label-online' : isOffline ? 'label-offline' : ''}`}>
            {isOnline ? 'Online' : isOffline ? 'Offline' : '...'}
          </span>
        </div>
        <div className="agent-api-actions">
          {agentShort && (
            <a
              href={`https://stellar.expert/explorer/testnet/account/${health.agentAddress}`}
              target="_blank"
              rel="noreferrer"
              className="agent-wallet-link"
              title={health.agentAddress}
            >
              Agent: {agentShort} ↗
            </a>
          )}
          <button
            className="btn-secondary btn-sm"
            onClick={checkHealth}
            disabled={loading}
          >
            {loading ? '...' : '↻ Ping'}
          </button>
        </div>
      </div>

      {isOffline && (
        <div className="agent-offline-msg">
          ⚠️ Agent API server is offline.{' '}
          <code>cd server && npm run dev</code>
        </div>
      )}

      {isOnline && health && (
        <>
          <p className="agent-api-desc">
            x402-gated HTTP API — AI agents pay micro-USDC per request.
            Network: <strong>{health.network}</strong> · Facilitator:{' '}
            <a href={health.facilitatorUrl} target="_blank" rel="noreferrer">
              {health.facilitatorUrl}
            </a>
          </p>

          <div className="endpoint-table-wrapper">
            <table className="endpoint-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Endpoint</th>
                  <th>Price</th>
                  <th>Protocol</th>
                </tr>
              </thead>
              <tbody>
                {health.endpoints.map((ep) => {
                  const parts = ep.route.split(' ');
                  const path = parts.slice(1).join(' ');
                  return (
                    <tr key={ep.route}>
                      <td>{methodBadge(ep.route)}</td>
                      <td><code className="endpoint-path">{path}</code></td>
                      <td>{priceBadge(ep.price)}</td>
                      <td><span className="proto-badge">{ep.protocol}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {lastChecked && (
            <p className="agent-api-footer">
              Last checked: {lastChecked.toLocaleTimeString()} ·{' '}
              Contract:{' '}
              <a
                href={`https://stellar.expert/explorer/testnet/contract/${health.contractId}`}
                target="_blank"
                rel="noreferrer"
              >
                {health.contractId.slice(0, 8)}...
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
