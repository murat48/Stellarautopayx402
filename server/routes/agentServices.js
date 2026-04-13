/**
 * Agent Services Marketplace Routes
 * Any agent can list purchasable services; other agents can discover & autobuy via x402.
 *
 * POST /agent/services         — Register a new service (x402 protected, $0.002)
 * GET  /agent/services         — List all registered services (x402 protected, $0.001)
 * GET  /agent/services/:id     — Get single service schema (x402 protected, $0.001)
 * POST /agent/services/:id/buy — Purchase / invoke a service (x402 protected, priced per service)
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';

const router = Router();

// ─── In-memory service registry (seeded with demos) ─────────────────────────
const serviceRegistry = new Map();

function seedServices() {
  const seeds = [
    {
      id: 'svc-autopay-bills-001',
      name: 'Recurring Bill Management',
      description: 'Create and manage on-chain recurring payments via Soroban. Supports USDC & XLM.',
      category: 'payments',
      provider: 'Stellar Autopay',
      providerAddress: 'GDYASMG4W3LFG5YQIUG7IHKVFTDO4SJPX2S2WJVJTQSUGRAULQ45GK7M',
      price: '0.010',
      priceUnit: 'USDC',
      priceLabel: '$0.01/call',
      schema: {
        input: { recipient: 'Stellar address', amount: 'number', asset: 'XLM|USDC', frequency: 'monthly|weekly|one-time' },
        output: { billId: 'u64', txHash: 'string', nextDueDate: 'ISO date' },
      },
      callCount: 0,
      createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'svc-search-001',
      name: 'Web Search API',
      description: 'Pay-per-query web search for AI agent workflows. Returns ranked results with snippets.',
      category: 'data',
      provider: 'SearchAgent',
      providerAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      price: '0.003',
      priceUnit: 'USDC',
      priceLabel: '$0.003/query',
      schema: {
        input: { query: 'string — search keywords' },
        output: { results: 'array of {title, url, snippet}', query: 'echoed', cached: 'boolean' },
      },
      callCount: 0,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'svc-sentiment-001',
      name: 'Sentiment Analysis',
      description: 'Real-time NLP sentiment scoring for text or market data. Returns score, label, and confidence.',
      category: 'ai',
      provider: 'SentimentAgent',
      providerAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      price: '0.002',
      priceUnit: 'USDC',
      priceLabel: '$0.002/call',
      schema: {
        input: { text: 'string to analyze' },
        output: { score: 'float -1..1', label: 'positive|neutral|negative', confidence: 'float 0..1' },
      },
      callCount: 0,
      createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'svc-price-001',
      name: 'XLM/USDC Price Feed',
      description: 'Live Stellar DEX price feed. Returns current price, 24h volume and pair data.',
      category: 'data',
      provider: 'PriceFeedAgent',
      providerAddress: 'GDYASMG4W3LFG5YQIUG7IHKVFTDO4SJPX2S2WJVJTQSUGRAULQ45GK7M',
      price: '0.001',
      priceUnit: 'USDC',
      priceLabel: '$0.001/call',
      schema: {
        input: { pair: 'string e.g. XLM/USDC' },
        output: { price: 'number', volume24h: 'number', pair: 'string', timestamp: 'ISO date' },
      },
      callCount: 0,
      createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
  for (const s of seeds) serviceRegistry.set(s.id, s);
}
seedServices();

// ─── Input validation helpers ────────────────────────────────────────────────
const ALLOWED_CATEGORIES = ['payments', 'ai', 'data', 'analytics', 'identity', 'other'];
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

function sanitizeString(v, maxLen = 200) {
  if (typeof v !== 'string') return '';
  return v.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

// ─── GET /agent/services — list all services ─────────────────────────────────
router.get('/services', (_req, res) => {
  const services = Array.from(serviceRegistry.values()).map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    provider: s.provider,
    providerAddress: s.providerAddress,
    priceLabel: s.priceLabel,
    price: s.price,
    priceUnit: s.priceUnit,
    callCount: s.callCount,
    createdAt: s.createdAt,
  }));
  res.json({ services, total: services.length, protocol: 'x402' });
});

// ─── GET /agent/services/:id — service schema ─────────────────────────────────
router.get('/services/:id', (req, res) => {
  const svc = serviceRegistry.get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  res.json({ service: svc });
});

// ─── POST /agent/services — register new service ──────────────────────────────
router.post('/services', (req, res) => {
  const { name, description, category, provider, providerAddress, price, priceUnit, schema } = req.body ?? {};

  // Validate required fields
  if (!name || !description || !provider || !providerAddress || !price) {
    return res.status(400).json({ error: 'Missing required fields: name, description, provider, providerAddress, price' });
  }

  // Validate Stellar address
  if (!STELLAR_ADDRESS_RE.test(providerAddress)) {
    return res.status(400).json({ error: 'Invalid providerAddress — must be a valid Stellar public key' });
  }

  // Validate price is a positive number
  const priceNum = parseFloat(price);
  if (isNaN(priceNum) || priceNum <= 0 || priceNum > 100) {
    return res.status(400).json({ error: 'price must be a positive number between 0 and 100' });
  }

  const cat = sanitizeString(category, 50);
  if (cat && !ALLOWED_CATEGORIES.includes(cat)) {
    return res.status(400).json({ error: `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}` });
  }

  const id = `svc-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const unit = priceUnit === 'XLM' ? 'XLM' : 'USDC';

  const service = {
    id,
    name: sanitizeString(name, 100),
    description: sanitizeString(description, 500),
    category: cat || 'other',
    provider: sanitizeString(provider, 100),
    providerAddress,
    price: priceNum.toFixed(3),
    priceUnit: unit,
    priceLabel: `$${priceNum.toFixed(3)}/${unit === 'XLM' ? 'call' : 'call'}`,
    schema: typeof schema === 'object' && schema !== null ? schema : {},
    callCount: 0,
    createdAt: now,
  };

  serviceRegistry.set(id, service);
  res.status(201).json({ success: true, service });
});

// ─── POST /agent/services/:id/buy — record a purchase (x402 already settled upstream) ──
router.post('/services/:id/buy', async (req, res) => {
  const svc = serviceRegistry.get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });

  // Increment call counter
  svc.callCount += 1;

  // Simulate service execution based on category
  let result = {};
  const input = req.body ?? {};

  switch (svc.category) {
    case 'data':
      if (svc.id === 'svc-search-001') {
        result = {
          results: [
            { title: 'Stellar Network Overview', url: 'https://stellar.org/learn', snippet: 'Stellar is an open network for storing and moving money.' },
            { title: 'x402 Protocol', url: 'https://x402.org', snippet: 'HTTP-native payments for AI agents.' },
          ],
          query: sanitizeString(String(input.query || ''), 200),
          cached: false,
        };
      } else {
        // Real XLM price from CoinGecko (free, no API key required)
        let fetched = false;
        try {
          const cgRes = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
            { signal: AbortSignal.timeout(5000) },
          );
          if (cgRes.ok) {
            const cgData = await cgRes.json();
            const price = cgData?.stellar?.usd;
            if (typeof price === 'number') {
              result = {
                price,
                pair: sanitizeString(String(input.pair || 'XLM/USD'), 20),
                source: 'CoinGecko',
                timestamp: new Date().toISOString(),
              };
              fetched = true;
            }
          }
        } catch (_) { /* network error — fall through to mock */ }
        if (!fetched) {
          result = { price: +(0.1123 + Math.random() * 0.002).toFixed(6), pair: sanitizeString(String(input.pair || 'XLM/USD'), 20), source: 'mock', timestamp: new Date().toISOString() };
        }
      }
      break;
    case 'ai':
      result = { score: (Math.random() * 2 - 1).toFixed(4), label: ['positive', 'neutral', 'negative'][Math.floor(Math.random() * 3)], confidence: (0.7 + Math.random() * 0.3).toFixed(4) };
      break;
    case 'payments':
      result = { billId: Math.floor(Math.random() * 9999), status: 'created', nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() };
      break;
    default:
      result = { status: 'executed', timestamp: new Date().toISOString() };
  }

  res.json({
    success: true,
    serviceId: svc.id,
    serviceName: svc.name,
    pricePaid: `${svc.price} ${svc.priceUnit}`,
    protocol: 'x402',
    result,
  });
});

export default router;
