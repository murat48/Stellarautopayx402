export default function LowBalanceWarning({ balances, bills }) {
  const now = new Date();
  const upcoming = bills.filter(
    (b) => b.status === 'active' || b.status === 'low_balance'
  );

  const totalXLM = upcoming
    .filter((b) => b.asset === 'XLM')
    .reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);

  const totalUSDC = upcoming
    .filter((b) => b.asset === 'USDC')
    .reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);

  const warnings = [];

  // Reserve 1 XLM for base reserve
  if (totalXLM > 0 && (balances.XLM || 0) < totalXLM + 1) {
    warnings.push(
      `XLM balance (${(balances.XLM || 0).toFixed(2)}) is below pending bills total (${totalXLM.toFixed(2)} + 1 XLM reserve)`
    );
  }

  if (totalUSDC > 0 && (balances.USDC || 0) < totalUSDC) {
    warnings.push(
      `USDC balance (${(balances.USDC || 0).toFixed(2)}) is below pending bills total (${totalUSDC.toFixed(2)})`
    );
  }

  if (warnings.length === 0) return null;

  return (
    <div className="low-balance-warning">
      <span className="warning-icon">⚠️</span>
      <div>
        <strong>Low Balance Warning</strong>
        {warnings.map((w, i) => (
          <p key={i}>{w}</p>
        ))}
      </div>
    </div>
  );
}
