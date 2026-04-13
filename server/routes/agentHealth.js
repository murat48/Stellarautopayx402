import { Router } from 'express';
import config from '../config.js';
import { PRICING } from '../middleware/x402Paywall.js';
import { getAgentPublicKey } from '../services/sorobanService.js';

const router = Router();

/**
 * GET /agent/health — Free health check (no x402)
 */
router.get('/health', (_req, res) => {
  const endpoints = Object.entries(PRICING).map(([route, price]) => ({
    route,
    price,
    protocol: 'x402',
  }));

  let agentAddress = null;
  try { agentAddress = getAgentPublicKey(); } catch (_) { /* not configured */ }

  res.json({
    status: 'ok',
    network: config.network,
    contractId: config.contractId,
    rpcUrl: config.rpcUrl,
    facilitatorUrl: config.facilitatorUrl,
    agentAddress,
    endpoints: [
      { route: 'GET /agent/health', price: 'free', protocol: 'none' },
      ...endpoints,
    ],
  });
});

export default router;
