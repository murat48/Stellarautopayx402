import { useState, useEffect, useCallback } from 'react';
import TempWorkerForm from './TempWorkerForm';
import WorkerAgentChat from './WorkerAgentChat';

const STATUS_LABEL = {
  pending:   { text: 'Pending',   cls: 'badge-recurring' },
  paid:      { text: '✅ Paid',    cls: 'badge-onetime'   },
  failed:    { text: '❌ Failed',  cls: 'badge-overdue'   },
  cancelled: { text: 'Cancelled', cls: 'badge-paused'    },
};

const SCHED_STATUS_LABEL = {
  active:    { text: 'Active',    cls: 'badge-recurring' },
  completed: { text: 'Completed', cls: 'badge-onetime'   },
  cancelled: { text: 'Cancelled', cls: 'badge-paused'    },
};

function fmtDate(isoStr) {
  return new Date(isoStr).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function fmtTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function fmtAddr(addr) {
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

async function safeJson(res) {
  const text = await res.text();
  if (!text.trim()) throw new Error('Empty response — is the server running?');
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON from server'); }
}

export default function WorkerSchedules() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [showForm, setShowForm]   = useState(false);
  const [expanded, setExpanded]   = useState(new Set());
  const [cancelling, setCancelling] = useState(new Set()); // payment IDs being cancelled
  const [workerTab, setWorkerTab] = useState('schedules'); // 'schedules' | 'cancelled' | 'agent'

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/worker-schedule');
      const data = await safeJson(res);
      if (!data.success) throw new Error(data.error || 'Failed to load');
      setSchedules(data.schedules.slice().reverse()); // newest first
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cancel = async (id) => {
    if (!confirm('Cancel this worker schedule? Pending payments will not be sent.')) return;
    try {
      const res  = await fetch(`/api/worker-schedule/${id}`, { method: 'DELETE' });
      const data = await safeJson(res);
      if (!data.success) throw new Error(data.error || 'Failed to cancel');
      load();
    } catch (err) {
      alert('Cancel failed: ' + err.message);
    }
  };

  const cancelPayment = async (scheduleId, paymentId) => {
    setCancelling(prev => new Set(prev).add(paymentId));
    try {
      const res  = await fetch(`/api/worker-schedule/${scheduleId}/payment/${paymentId}`, {
        method: 'DELETE',
        headers: { 'Accept': 'application/json' },
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
      if (!data.success) throw new Error(data.error || 'Failed to cancel payment');
      // Optimistic update from server response
      setSchedules(prev => prev.map(s =>
        s.id === scheduleId ? { ...data.schedule } : s
      ));
    } catch (err) {
      alert('Could not cancel payment: ' + err.message);
    } finally {
      setCancelling(prev => { const n = new Set(prev); n.delete(paymentId); return n; });
    }
  };

  const toggle = (id) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleScheduleAdded = () => {
    setShowForm(false);
    load();
  };

  const activeSchedules    = schedules.filter(s => s.status !== 'cancelled');
  const cancelledSchedules = schedules.filter(s => s.status === 'cancelled');

  return (
    <div className="workers-section">
      <div className="section-header">
        <h2>👷 Worker Schedules</h2>
        <div className="filter-tabs" style={{ marginLeft: 'auto' }}>
          <button
            className={`filter-tab ${workerTab === 'schedules' ? 'active' : ''}`}
            onClick={() => setWorkerTab('schedules')}
          >
            📋 Active
            {activeSchedules.length > 0 && (
              <span className="pbc-tab-count">{activeSchedules.length}</span>
            )}
          </button>
          <button
            className={`filter-tab ${workerTab === 'cancelled' ? 'active' : ''}`}
            onClick={() => setWorkerTab('cancelled')}
          >
            🚫 Cancelled
            {cancelledSchedules.length > 0 && (
              <span className="pbc-tab-count pbc-count-cancelled">{cancelledSchedules.length}</span>
            )}
          </button>
          <button
            className={`filter-tab ${workerTab === 'agent' ? 'active' : ''}`}
            onClick={() => setWorkerTab('agent')}
          >
            🤖 Hire via Agent
          </button>
        </div>
      </div>

      {workerTab === 'agent' && (
        <WorkerAgentChat onScheduleCreated={() => { load(); }} />
      )}

      {(workerTab === 'schedules' || workerTab === 'cancelled') && (
        <>
          {workerTab === 'schedules' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
              <button className="btn-primary" onClick={() => setShowForm(true)}>
                + New Worker Schedule
              </button>
            </div>
          )}

          {error && <div className="error-msg">{error}</div>}

          {loading && <p className="muted-hint">Loading schedules…</p>}

          {!loading && workerTab === 'schedules' && activeSchedules.length === 0 && (
            <div className="empty-state">
              <p>No active worker schedules yet. Create one manually or use the 🤖 Hire via Agent tab.</p>
            </div>
          )}

          {!loading && workerTab === 'cancelled' && cancelledSchedules.length === 0 && (
            <div className="empty-state">
              <p>No cancelled schedules.</p>
            </div>
          )}

          <div className="workers-grid">
            {(workerTab === 'schedules' ? activeSchedules : cancelledSchedules).map(s => {
              const isOpen    = expanded.has(s.id);
              const pending   = s.payments.filter(p => p.status === 'pending').length;
              const paid      = s.payments.filter(p => p.status === 'paid').length;
              const failed    = s.payments.filter(p => p.status === 'failed').length;
              const total     = s.payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
              const sl        = SCHED_STATUS_LABEL[s.status] || SCHED_STATUS_LABEL.active;
              const nextPay   = s.payments.find(p => p.status === 'pending');

              return (
                <div key={s.id} className={`workers-card workers-card-${s.status}`}>
                  <div className="workers-card-header" onClick={() => toggle(s.id)}>
                    <div className="workers-card-title">
                      <span className="workers-name">{s.workerName}</span>
                      <span className={`badge ${sl.cls}`}>{sl.text}</span>
                    </div>
                    <span className="workers-toggle">{isOpen ? '▲' : '▼'}</span>
                  </div>

                  <div className="workers-card-meta">
                    <span>📍 {fmtAddr(s.workerAddress)}</span>
                    <span>💰 {s.hourlyUsdBudget
                      ? `$${s.hourlyUsdBudget}/hr (live XLM rate)`
                      : `${parseFloat(s.hourlyRate)} ${s.asset}/hr`
                    }</span>
                    <span>📅 {s.payments.length} payment{s.payments.length !== 1 ? 's' : ''}</span>
                    <span>💰 Total: {s.hourlyUsdBudget
                      ? `~$${(s.hourlyUsdBudget * s.payments.reduce((acc, p) => acc + parseFloat(p.hours ?? 1), 0)).toFixed(2)} USD`
                      : `${total.toFixed(2)} ${s.asset}`
                    }</span>
                  </div>

                  <div className="workers-card-stats">
                    {paid > 0      && <span className="ws-stat ws-paid">✅ {paid} paid</span>}
                    {pending > 0   && <span className="ws-stat ws-pending">⏳ {pending} pending</span>}
                    {failed > 0    && <span className="ws-stat ws-failed">❌ {failed} failed</span>}
                    {nextPay && (
                      <span className="ws-stat ws-next">
                        Next: {fmtDate(nextPay.payAt)} at {fmtTime(nextPay.payAt)}
                      </span>
                    )}
                  </div>

                  {isOpen && (
                    <div className="workers-payment-list">
                      {s.payments.map(p => {
                        const st = STATUS_LABEL[p.status] || STATUS_LABEL.pending;
                        return (
                          <div key={p.id} className={`workers-payment-row ws-row-${p.status}`}>
                            <span className="ws-day">{p.label || `Day ${p.dayIndex}`}</span>
                            <span className="ws-date">{fmtDate(p.payAt)}</span>
                            <span className="ws-time">at {fmtTime(p.payAt)}</span>
                            <span className="ws-amt">
                              {s.hourlyUsdBudget
                                ? (p.paidAmount
                                    ? `${parseFloat(p.paidAmount).toFixed(4)} XLM`
                                    : `~$${(s.hourlyUsdBudget * parseFloat(p.hours ?? 1)).toFixed(2)} USD`)
                                : `${parseFloat(p.amount).toFixed(2)} ${s.asset}`
                              }
                            </span>
                            <span className={`badge ${st.cls}`}>{st.text}</span>
                            {p.txHash && (
                              <a
                                className="ws-tx"
                                href={`https://stellar.expert/explorer/testnet/tx/${p.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                title="View on Stellar Expert"
                              >
                                🔗
                              </a>
                            )}
                            {p.error && <span className="ws-err" title={p.error}>⚠</span>}
                            {p.status === 'pending' && s.status === 'active' && (
                              <button
                                className="ws-cancel-payment"
                                title="Cancel this payment"
                                disabled={cancelling.has(p.id)}
                                onClick={() => cancelPayment(s.id, p.id)}
                              >
                                {cancelling.has(p.id) ? '⟳' : '✕'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {s.status === 'active' && (
                    <div className="workers-card-actions">
                      <button className="btn-danger btn-sm" onClick={() => cancel(s.id)}>
                        🗑 Cancel Schedule
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {showForm && (
            <TempWorkerForm
              onClose={handleScheduleAdded}
            />
          )}
        </>
      )}
    </div>
  );
}
