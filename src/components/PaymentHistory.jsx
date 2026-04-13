function statusBadge(status) {
  const colors = {
    success: 'badge-success',
    failed: 'badge-failed',
    skipped: 'badge-skipped',
  };
  return <span className={`badge ${colors[status] || ''}`}>{status}</span>;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PaymentHistory({ history, clearHistory }) {
  if (history.length === 0) {
    return (
      <div className="payment-history">
        <div className="section-header">
          <h2>Payment History</h2>
        </div>
        <div className="empty-state">
          <p>No payments processed yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="payment-history">
      <div className="section-header">
        <h2>Payment History</h2>
        <button className="btn-secondary" onClick={clearHistory}>
          Clear History
        </button>
      </div>

      <div className="table-wrapper">
        <table>
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
            {history.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.billName}</td>
                <td>{entry.amount} {entry.asset}</td>
                <td>{formatDate(entry.date)}</td>
                <td>
                  {entry.txHash ? (
                    <span className="tx-links">
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${entry.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="tx-link"
                        title="View on Stellar Expert"
                      >
                        {entry.txHash.slice(0, 8)}...{entry.txHash.slice(-4)}
                      </a>
                      <a
                        href={`https://horizon-testnet.stellar.org/transactions/${entry.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="tx-link-horizon"
                        title="Verify on Horizon API (shows successful:true for confirmed payments)"
                      >
                        [H]
                      </a>
                    </span>
                  ) : (
                    <span className="no-hash">—</span>
                  )}
                </td>
                <td>{statusBadge(entry.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
