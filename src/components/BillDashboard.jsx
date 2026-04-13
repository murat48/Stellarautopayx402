import { useState } from 'react';
import AddBillForm from './AddBillForm';

function statusBadge(status) {
  const labels = {
    active: 'Active',
    paused: 'Paused',
    low_balance: 'Low Balance',
    completed: 'Completed',
    paid: '✅ Paid',
  };
  return <span className={`badge badge-${status}`}>{labels[status] || status}</span>;
}

function typeBadge(type) {
  if (type === 'one-time') {
    return <span className="badge badge-onetime">One-Time</span>;
  }
  return <span className="badge badge-recurring">Recurring</span>;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function BillDashboard({ bills, addBill, pauseBill, deleteBill, refreshBills, billsLoading }) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('unpaid');
  const [paymentLinks, setPaymentLinks] = useState({}); // billId → { loading, url, error }

  const getPaymentLink = async (billId) => {
    setPaymentLinks(p => ({ ...p, [billId]: { loading: true } }));
    try {
      const res = await fetch(`/api/panel/payment-link/${billId}`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setPaymentLinks(p => ({ ...p, [billId]: { loading: false, url: data.url } }));
    } catch (err) {
      setPaymentLinks(p => ({ ...p, [billId]: { loading: false, error: err.message } }));
    }
  };

  const isUnpaid = (bill) => bill.status !== 'completed' && bill.status !== 'paid';

  const filteredBills = bills
    .filter((bill) => {
      if (filter === 'unpaid')    return isUnpaid(bill);
      if (filter === 'recurring') return bill.type !== 'one-time' && isUnpaid(bill);
      if (filter === 'one-time')  return bill.type === 'one-time' && isUnpaid(bill);
      if (filter === 'completed') return bill.status === 'completed' || bill.status === 'paid';
      return true; // all
    })
    .sort((a, b) => {
      // unpaid views: sort by nextDueDate ascending (soonest first)
      if (filter !== 'completed' && filter !== 'all') {
        const aDate = a.nextDueDate ? new Date(a.nextDueDate).getTime() : Infinity;
        const bDate = b.nextDueDate ? new Date(b.nextDueDate).getTime() : Infinity;
        return aDate - bDate;
      }
      return 0;
    });

  return (
    <div className="bill-dashboard">
      <div className="section-header">
        <h2>Payments</h2>
        <div className="section-header-actions">
          <div className="filter-tabs">
            {['unpaid', 'recurring', 'one-time', 'completed', 'all'].map((f) => (
              <button
                key={f}
                className={`filter-tab ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'unpaid' ? 'Unpaid' : f === 'one-time' ? 'One-Time' : f === 'completed' ? 'Paid / Done' : f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <button
            className="btn-secondary btn-sm"
            onClick={refreshBills}
            disabled={billsLoading}
            title="Refresh from contract"
          >
            {billsLoading ? '⟳' : '↻'}
          </button>
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            + Add Payment
          </button>
        </div>
      </div>

      {filteredBills.length === 0 ? (
        <div className="empty-state">
          <p>{filter === 'unpaid' ? 'No unpaid payments.' : filter === 'all' ? 'No payments yet. Add your first payment to get started.' : `No ${filter} payments.`}</p>
        </div>
      ) : (
        <div className="bill-grid">
          {filteredBills.map((bill) => {
            const isOverdue =
              bill.nextDueDate &&
              new Date(bill.nextDueDate) < new Date() &&
              bill.status !== 'paid' &&
              bill.status !== 'completed';
            return (
            <div key={bill.id} className={`bill-card bill-card-${bill.status}${isOverdue ? ' bill-card-overdue' : ''}`}>
              <div className="bill-card-header">
                <h3>{bill.name}</h3>
                <div className="bill-badges">
                  {typeBadge(bill.type)}
                  {statusBadge(bill.status)}
                  {isOverdue && (
                    <span className="badge badge-overdue">⚠ OVERDUE</span>
                  )}
                </div>
              </div>
              <div className="bill-card-body">
                <div className="bill-detail">
                  <span className="label">Amount</span>
                  <span className="value">{bill.amount} {bill.asset}</span>
                </div>
                <div className="bill-detail">
                  <span className="label">{bill.type === 'one-time' ? 'Type' : 'Frequency'}</span>
                  <span className="value">{
                    bill.type === 'one-time' ? 'One-time' :
                    bill.frequency === 'weekly'      ? 'Weekly' :
                    bill.frequency === 'biweekly'    ? 'Biweekly' :
                    bill.frequency === 'monthly'     ? 'Monthly' :
                    bill.frequency === 'monthly_day' ? `Monthly — day ${bill.dayOfMonth ?? '?'}` :
                    bill.frequency === 'quarterly'   ? 'Quarterly' :
                    bill.frequency ?? '—'
                  }</span>
                </div>
                <div className="bill-detail">
                  <span className="label">{bill.status === 'completed' || bill.status === 'paid' ? 'Paid On' : 'Scheduled'}</span>
                  <span className="value">{formatDate(bill.nextDueDate)}</span>
                </div>
                <div className="bill-detail">
                  <span className="label">Recipient</span>
                  <span className="value mono">
                    {bill.recipientAddress.slice(0, 8)}...{bill.recipientAddress.slice(-4)}
                  </span>
                </div>
              </div>
              {bill.status !== 'completed' && bill.status !== 'paid' && (
                <div className="bill-card-actions">
                  <button onClick={() => pauseBill(bill.id)} className="btn-secondary">
                    {bill.status === 'active' || bill.status === 'low_balance' ? '⏸ Pause' : '▶ Resume'}
                  </button>
                  <button onClick={() => deleteBill(bill.id)} className="btn-danger">
                    🗑 Delete
                  </button>
                </div>
              )}
              {isOverdue && (() => {
                const ls = paymentLinks[bill.id] || {};
                return (
                  <div className="bill-api-only-notice" style={{ flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
                      <button
                        className="btn-sm btn-primary"
                        style={{ fontSize: '0.72rem' }}
                        disabled={ls.loading}
                        onClick={() => getPaymentLink(bill.id)}
                      >
                        {ls.loading ? '⇳' : '🔗 Get Payment Link'}
                      </button>
                    </div>
                    {ls.url && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%', flexWrap: 'wrap' }}>
                        <a
                          href={ls.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'var(--accent)', fontSize: '0.75rem', wordBreak: 'break-all' }}
                        >
                          {ls.url.slice(0, 52)}...
                        </a>
                        <button
                          className="btn-sm btn-secondary"
                          style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem' }}
                          onClick={() => navigator.clipboard.writeText(ls.url)}
                        >
                          📋 Copy
                        </button>
                      </div>
                    )}
                    {ls.error && <span style={{ color: 'var(--danger)', fontSize: '0.72rem' }}>❌ {ls.error}</span>}
                  </div>
                );
              })()}
            </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <AddBillForm onAdd={addBill} onClose={() => setShowForm(false)} />
      )}
    </div>
  );
}
