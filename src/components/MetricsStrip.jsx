export default function MetricsStrip({ bills, history }) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const totalPaidThisMonth = history
    .filter((e) => e.status === 'success' && new Date(e.date) >= startOfMonth)
    .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

  const activeBills = bills.filter((b) => b.status === 'active');
  const recurringBills = activeBills.filter((b) => b.type !== 'one-time');
  const oneTimeBills = activeBills.filter((b) => b.type === 'one-time');
  const completedBills = bills.filter((b) => b.status === 'completed' || b.status === 'paid').length;

  const pendingBills = activeBills.filter(
    (b) => new Date(b.nextDueDate) > now
  ).length;

  const dueBills = activeBills.filter(
    (b) => new Date(b.nextDueDate) <= now
  ).length;

  const nextPayment = activeBills
    .map((b) => new Date(b.nextDueDate))
    .filter((d) => d > now)
    .sort((a, b) => a - b)[0];

  const nextPaymentStr = nextPayment
    ? nextPayment.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <div className="metrics-strip">
      <div className="metric-card">
        <span className="metric-value">{totalPaidThisMonth.toFixed(2)}</span>
        <span className="metric-label">Paid This Month</span>
      </div>
      <div className="metric-card">
        <span className="metric-value">{recurringBills.length}</span>
        <span className="metric-label">Recurring Active</span>
      </div>
      <div className="metric-card">
        <span className="metric-value">{oneTimeBills.length}</span>
        <span className="metric-label">Scheduled One-Time</span>
      </div>
      <div className="metric-card">
        <span className="metric-value">{dueBills}</span>
        <span className="metric-label">Due Now</span>
      </div>
      <div className="metric-card">
        <span className="metric-value">{nextPaymentStr}</span>
        <span className="metric-label">Next Payment</span>
      </div>
      <div className="metric-card">
        <span className="metric-value">{completedBills}</span>
        <span className="metric-label">Completed</span>
      </div>
    </div>
  );
}
