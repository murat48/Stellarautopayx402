/**
 * x402 Paywall Middleware
 * Uses @x402/express paymentMiddlewareFromConfig for x402 protocol support.
 * Falls back to manual 402 implementation if the package API differs.
 */
import { paymentMiddlewareFromConfig } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import config from '../config.js';

const NETWORK = 'stellar:testnet';

// Endpoint pricing in USDC
const PRICING = {
  'POST /agent/bills':                '$0.01',
  'GET /agent/bills':                 '$0.001',
  'GET /agent/bills/:id':             '$0.001',
  'POST /agent/bills/:id/pause':      '$0.005',
  'DELETE /agent/bills/:id':          '$0.005',
  'POST /agent/pay/:id':              '$0.005',
  'POST /agent/notify/:id':           '$0.002',
  'GET /agent/history':               '$0.001',
  'GET /agent/balance':               '$0.001',
  // Agent Services Marketplace
  'POST /agent/services':             '$0.002',
  'GET /agent/services':              '$0.001',
  'GET /agent/services/:id':          '$0.001',
  'POST /agent/services/:id/buy':     '$0.005',
  // Temp Worker Schedules
  'POST /agent/worker-schedule':      '$0.01',
  'GET /agent/worker-schedule':       '$0.001',
  'GET /agent/worker-schedule/:id':   '$0.001',
  'DELETE /agent/worker-schedule/:id':'$0.005',
};

export { PRICING };

/**
 * Build the x402 paywall middleware config and return the middleware array.
 */
export function createPaywallMiddleware() {
  const payTo = config.resourceWalletAddress;
  if (!payTo) {
    console.warn('⚠️  RESOURCE_WALLET_ADDRESS not set — x402 paywall disabled');
    return (_req, _res, next) => next();
  }

  const routeConfig = {};
  for (const [routeKey, price] of Object.entries(PRICING)) {
    routeConfig[routeKey] = {
      accepts: {
        scheme: 'exact',
        price,
        network: NETWORK,
        payTo,
      },
    };
  }

  const facilitator = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
  });

  const schemes = [
    { network: NETWORK, server: new ExactStellarScheme() },
  ];

  return paymentMiddlewareFromConfig(routeConfig, facilitator, schemes);
}
