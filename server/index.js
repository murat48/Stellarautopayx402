import express from 'express';
import cors from 'cors';
import config from './config.js';
import { createPaywallMiddleware } from './middleware/x402Paywall.js';
import agentBillsRouter from './routes/agentBills.js';
import agentPaymentsRouter from './routes/agentPayments.js';
import workerSchedulesRouter from './routes/workerSchedules.js';
import agentHealthRouter from './routes/agentHealth.js';
import agentDemoRouter from './routes/agentDemo.js';
import agentServicesRouter from './routes/agentServices.js';
import agentReasonRouter from './routes/agentReason.js';
import agentWorkerReasonRouter from './routes/agentWorkerReason.js';
import apiPanelRouter from './routes/apiPanel.js';
import { publicPayRouter, panelPayLinkRouter, publicBillApiRouter } from './routes/paymentPage.js';
import { getAgentPublicKey } from './services/sorobanService.js';
import { startReminderJob } from './services/reminderJob.js';

const app = express();

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Rate limiting (simple in-memory) ──────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30;

app.use('/agent', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress;
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Max 30 per minute.' });
  }
  next();
});

// Clean stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60_000).unref();

// ─── x402 Paywall ──────────────────────────────────────────────────────────
app.use(createPaywallMiddleware());

// ─── Routes ────────────────────────────────────────────────────────────────
app.use('/agent', agentHealthRouter);
app.use('/agent', agentDemoRouter);
app.use('/agent/bills', agentBillsRouter);
app.use('/agent', agentPaymentsRouter);
app.use('/agent', agentServicesRouter);

// ─── Worker Schedule — accessible from browser (no x402) and agent (x402) ──
app.use('/api/worker-schedule', workerSchedulesRouter);
app.use('/agent/worker-schedule', workerSchedulesRouter);

// ─── Frontend Panel Proxy (no x402 from browser — signed server-side) ──────
app.use('/api/panel', apiPanelRouter);
app.use('/api/panel', panelPayLinkRouter);
app.use('/api/agent', agentReasonRouter);
app.use('/api/agent', agentWorkerReasonRouter);

// ─── Public payment page (linked from Telegram) ────────────────────────────
app.use('/pay', publicPayRouter);
app.use('/api/pay/bill', publicBillApiRouter);

// ─── Error handler ─────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('❌ Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Startup ───────────────────────────────────────────────────────────────
function start() {
  // Validate agent keypair
  try {
    const pubKey = getAgentPublicKey();
    console.log(`🔒 Agent wallet loaded: ${pubKey}`);
  } catch (err) {
    console.error('❌ AGENT_SECRET_KEY is not set or invalid. Please configure .env');
    process.exit(1);
  }

  if (!config.resourceWalletAddress) {
    console.warn('⚠️  RESOURCE_WALLET_ADDRESS not set — x402 paywall will be disabled');
  }

  app.listen(config.port, () => {
    console.log(`✅ Stellar Autopay Agent API running on port ${config.port}`);
    console.log(`   Network:     ${config.network}`);
    console.log(`   Contract:    ${config.contractId}`);
    console.log(`   RPC:         ${config.rpcUrl}`);
    console.log(`   Facilitator: ${config.facilitatorUrl}`);
    console.log(`   Health:      http://localhost:${config.port}/agent/health`);
    startReminderJob();
  });
}

start();
