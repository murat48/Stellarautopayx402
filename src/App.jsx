import './App.css';
import { useState, useEffect } from 'react';
import useWallet from './hooks/useWallet';
import useBills from './hooks/useBills';
import usePaymentHistory from './hooks/usePaymentHistory';
import useTelegram from './hooks/useTelegram';
import WalletConnect from './components/WalletConnect';
import BillDashboard from './components/BillDashboard';
import PaymentHistory from './components/PaymentHistory';
import MetricsStrip from './components/MetricsStrip';
import LowBalanceWarning from './components/LowBalanceWarning';
import TelegramSettings from './components/TelegramSettings';
import FeedbackForm from './components/FeedbackForm';
import AgentLiveDemo from './components/AgentLiveDemo';
import AgentControlPanel from './components/AgentControlPanel';
import AgentMarketplace from './components/AgentMarketplace';
import WorkerSchedules from './components/WorkerSchedules';

function App() {
  const wallet = useWallet();
  const { bills, addBill, updateBill, completeBill, markBillPaid, pauseBill, deleteBill, rescheduleBill, fetchBills, contractReady, loading: billsLoading, error: billsError } = useBills(
    wallet.publicKey,
    wallet.signTransaction,
    wallet.getSessionKeypair
  );
  const { history, addEntry, loadHistory, clearHistory } = usePaymentHistory();
  // Load on-chain history when wallet connects; clear it on disconnect
  useEffect(() => {
    if (wallet.publicKey) {
      loadHistory(wallet.publicKey);
    } else {
      clearHistory();
    }
  }, [wallet.publicKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    telegramConfig,
    updateTelegramConfig,
    testTelegramConnection,
    testStatus,
  } = useTelegram();
  const [showTelegramSettings, setShowTelegramSettings] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [mainTab, setMainTab] = useState('dashboard'); // 'dashboard' | 'history' | 'workers' | 'agent-hub'

  if (!wallet.publicKey) {
    return (
      <WalletConnect
        onConnect={wallet.connect}
        loading={wallet.loading}
        error={wallet.error}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="logo-icon">✦</span>
          <h1>Stellar Autopay</h1>
        </div>
        <div className="header-right">
          <div className="wallet-info">
            <div className="wallet-balances">
              <div className="balance-chip balance-xlm">
                <span className="balance-icon">✦</span>
                <span className="balance-amount">{(wallet.balances.XLM || 0).toFixed(2)}</span>
                <span className="balance-ticker">XLM</span>
              </div>
              {wallet.balances.USDC !== undefined && (
                <div className="balance-chip balance-usdc">
                  <span className="balance-icon">$</span>
                  <span className="balance-amount">{wallet.balances.USDC.toFixed(2)}</span>
                  <span className="balance-ticker">USDC</span>
                </div>
              )}
            </div>
            <div className="wallet-meta">
              <span className="wallet-address">
                {wallet.publicKey.slice(0, 6)}...{wallet.publicKey.slice(-4)}
              </span>
              {contractReady ? (
                <span className="autopay-badge autopay-on">📜 Contract ON</span>
              ) : (
                <span className="autopay-badge autopay-off">📜 Contract...</span>
              )}
            </div>
          </div>
          <button className="btn-secondary btn-sm" onClick={wallet.refreshBalance}>
            ↻
          </button>
          <button
            className={`btn-sm ${telegramConfig.enabled ? 'btn-telegram-on' : 'btn-secondary'}`}
            onClick={() => setShowTelegramSettings(true)}
          >
            {telegramConfig.enabled ? '📨 Telegram ON' : '📨 Telegram'}
          </button>
          <button className="btn-feedback btn-sm" onClick={() => setShowFeedback(true)}>
            💬 Feedback
          </button>
          <button className="btn-danger btn-sm" onClick={wallet.disconnect}>
            Disconnect
          </button>
        </div>
      </header>

      {wallet.error && (
        <div className="error-msg" style={{ margin: '0 0 1rem' }}>{wallet.error}</div>
      )}
      {billsError && (
        <div className="error-msg" style={{ margin: '0 0 1rem' }}>{billsError}</div>
      )}

      <div className="app-main-tabs">
        <button className={`app-main-tab ${mainTab === 'dashboard' ? 'active' : ''}`} onClick={() => setMainTab('dashboard')}>
          📋 Dashboard
        </button>
        <button className={`app-main-tab ${mainTab === 'history' ? 'active' : ''}`} onClick={() => setMainTab('history')}>
          🕑 Payment History
        </button>
        <button className={`app-main-tab ${mainTab === 'workers' ? 'active' : ''}`} onClick={() => setMainTab('workers')}>
          👷 Workers
        </button>
        <button className={`app-main-tab ${mainTab === 'agent-hub' ? 'active' : ''}`} onClick={() => setMainTab('agent-hub')}>
          🤖 Agent Commerce Hub
        </button>
      </div>

      <main className="app-main">
        {mainTab === 'dashboard' && (
          <>
            <LowBalanceWarning balances={wallet.balances} bills={bills} />
            <MetricsStrip bills={bills} history={history} />
            <BillDashboard
              bills={bills}
              addBill={addBill}
              pauseBill={pauseBill}
              deleteBill={deleteBill}
              rescheduleBill={rescheduleBill}
              refreshBills={fetchBills}
              billsLoading={billsLoading}
            />
            <AgentControlPanel />
            <AgentLiveDemo />
          </>
        )}
        {mainTab === 'history' && (
          <PaymentHistory history={history} clearHistory={clearHistory} />
        )}
        {mainTab === 'workers' && <WorkerSchedules />}
        {mainTab === 'agent-hub' && <AgentMarketplace />}
      </main>

      {showFeedback && (
        <FeedbackForm onClose={() => setShowFeedback(false)} />
      )}

      {showTelegramSettings && (
        <TelegramSettings
          config={telegramConfig}
          onUpdate={updateTelegramConfig}
          onTest={testTelegramConnection}
          testStatus={testStatus}
          onClose={() => setShowTelegramSettings(false)}
        />
      )}
    </div>
  );
}

export default App;
