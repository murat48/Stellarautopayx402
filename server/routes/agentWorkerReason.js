/**
 * POST /api/agent/worker-reason
 *
 * Accepts a natural-language prompt, calls Gemini to understand a worker-hiring
 * request, then creates a worker schedule via the same logic as POST /api/worker-schedule.
 */
import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { StrKey, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import { x402Client, x402HTTPClient } from '@x402/fetch';
import { createEd25519Signer, getNetworkPassphrase } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import config from '../config.js';
import { createWorkerSchedule, getAgentPublicKey as getAgentKey } from '../services/sorobanService.js';

const X402_NETWORK = 'stellar:testnet';

// ─── x402 price feed: buy svc-price-001 for live XLM price ───────────────────
async function x402BuyPrice() {
  const url = `http://localhost:${config.port}/agent/services/svc-price-001/buy`;
  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pair: 'XLM/USD' }),
  };
  if (!config.resourceWalletAddress) {
    const res = await fetch(url, fetchOptions);
    const data = await res.json();
    return { response: data, x402TxHash: null, x402Paid: false };
  }
  const networkPassphrase = getNetworkPassphrase(X402_NETWORK);
  const signer = createEd25519Signer(config.agentSecretKey, X402_NETWORK);
  const client = new x402Client().register('stellar:*', new ExactStellarScheme(signer, { url: config.rpcUrl }));
  const httpClient = new x402HTTPClient(client);
  const firstTry = await fetch(url, fetchOptions);
  if (firstTry.status !== 402) {
    return { response: await firstTry.json(), x402TxHash: null, x402Paid: false };
  }
  const paymentRequired = httpClient.getPaymentRequiredResponse((n) => firstTry.headers.get(n));
  let paymentPayload = await client.createPaymentPayload(paymentRequired);
  const tx = new Transaction(paymentPayload.payload.transaction, networkPassphrase);
  const sorobanData = tx.toEnvelope()?.v1()?.tx()?.ext()?.sorobanData();
  if (sorobanData) {
    paymentPayload = { ...paymentPayload, payload: { ...paymentPayload.payload, transaction: TransactionBuilder.cloneFrom(tx, { fee: '1', sorobanData, networkPassphrase }).build().toXDR() } };
  }
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  const paidResponse = await fetch(url, { ...fetchOptions, headers: { ...fetchOptions.headers, ...paymentHeaders } });
  const settle = httpClient.getPaymentSettleResponse((n) => paidResponse.headers.get(n));
  return { response: await paidResponse.json(), x402TxHash: settle?.transaction ?? null, x402Paid: true };
}

const router = Router();

// ─── Gemini system prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an autonomous workforce payment agent for the Stellar blockchain.
Analyze the user's natural-language request and return ONLY a valid JSON object (no markdown fences, no explanations outside the JSON).

JSON schema:
{
  "intent": "hire_worker" | "unknown",
  "reasoning": [
    { "type": "think" | "search" | "compare" | "decide" | "pay" | "execute" | "result" | "error", "text": "...", "sub": "..." }
  ],
  "decision": "create_schedule" | "explain",
  "decisionReason": "short explanation",
  "params": {
    "workerName": "<worker's name or null>",
    "workerAddress": "<G... Stellar address from prompt, or null>",
    "hourlyRate": <number or null — use for direct XLM/USDC amounts like '10 XLM/hr' or '$5/hr in USDC'>,
    "hourlyUsdBudget": <number or null — set when user wants to pay a USD amount as XLM at the live rate each payment time; triggers on: '$X/hr worth of XLM', '$X/hr in XLM', '$X/hr XLM', '$X/hr as XLM', 'X dolar XLM', 'X USD XLM öde', custom USD+XLM combos; null otherwise>,
    "asset": "USDC" | "XLM",
    "workStartTime": "<HH:MM 24-hour format — when shift starts each day, default 09:00>",
    "workDays": [
      { "date": "YYYY-MM-DD", "hours": <number> }
    ]
  },
  "answer": "concise one-paragraph final answer to the user"
}

Date parsing rules (Current date is provided in the request):
- "tomorrow" → tomorrow's date
- "today" → today's date
- "next Monday" / "next week Mon" → nearest coming Monday
- "3 days starting tomorrow" → 3 consecutive dates starting from tomorrow
- "Mon-Wed" → next occurrence of Monday, Tuesday, Wednesday
- Specific date like "April 15" or "15th" → that date in the current/next month
- If user says "same hours each day N hours", use N for every day in workDays
- If user specifies different hours per day (e.g. "8h Mon, 6h Tue"), map them in order

Validation rules:
- If no Stellar address is given, set workerAddress to null and add an error reasoning step
- Default asset to USDC unless "xlm" or "lumen" is explicitly mentioned
- USD+XLM live-rate mode: if user says '$X/hr in XLM', '$X/hr worth of XLM', '$X/hr as XLM', 'X USD/hr XLM', 'X dolar XLM öde', 'anlık kur', 'live rate' or any phrasing that mixes a dollar amount with XLM payment: set hourlyUsdBudget=X, asset='XLM', hourlyRate=null. Each payment will compute XLM amount at the live USD/XLM rate at execution time.
- Default workStartTime to "09:00" if not specified. If user says "starts at 14:00" → "14:00"
- decision = "create_schedule" only when: workerAddress is valid, (hourlyRate > 0 OR hourlyUsdBudget > 0), workDays non-empty
- reasoning must have 4-7 steps covering: analyze → parse dates → parse pay → decide → x402 execute
- Keep each "sub" under 120 chars`;

// ─── Payment generation (same logic as workerSchedules.js POST handler) ──────
function buildPayments(workDays, workStartTime, hourlyRate) {
  const [startHH, startMM] = workStartTime.split(':').map(Number);
  const rate = parseFloat(hourlyRate);
  const payments = [];

  const sorted = [...workDays].sort((a, b) => a.date.localeCompare(b.date));
  const MIN_FUTURE_MS = 5 * 60 * 1000; // payments must be at least 5 min in the future
  const nowMs = Date.now();

  for (let di = 0; di < sorted.length; di++) {
    const { date: dateStr, hours } = sorted[di];
    const [y, m, d] = dateStr.split('-').map(Number);
    const wholeHours = Math.floor(hours);
    const remainder  = Math.round((hours - wholeHours) * 100) / 100;

    for (let h = 1; h <= wholeHours; h++) {
      const dt = new Date(y, m - 1, d, startHH, startMM, 0);
      dt.setMinutes(dt.getMinutes() + h * 60);
      // Skip payments whose scheduled time is in the past
      if (dt.getTime() <= nowMs + MIN_FUTURE_MS) continue;
      payments.push({
        id:        randomUUID(),
        dayIndex:  di + 1,
        hourIndex: h,
        label:     `Day ${di + 1} · Hr ${h}`,
        date:      dateStr,
        payAt:     dt.toISOString(),
        hours:     1,
        amount:    String(rate.toFixed(7)),
        status:    'pending',
        txHash:    null,
        error:     null,
      });
    }

    if (remainder >= 0.01) {
      const dt = new Date(y, m - 1, d, startHH, startMM, 0);
      dt.setMinutes(dt.getMinutes() + Math.round(hours * 60));
      // Skip payments whose scheduled time is in the past
      if (dt.getTime() > nowMs + MIN_FUTURE_MS) {
      const mins = Math.round(remainder * 60);
      payments.push({
        id:        randomUUID(),
        dayIndex:  di + 1,
        hourIndex: wholeHours + 1,
        label:     `Day ${di + 1} · Hr ${wholeHours + 1} (${mins}min)`,
        date:      dateStr,
        payAt:     dt.toISOString(),
        hours:     remainder,
        amount:    String((rate * remainder).toFixed(7)),
        status:    'pending',
        txHash:    null,
        error:     null,
      });
      }
    }
  }

  return payments;
}

// ─── Direct CoinGecko fallback (no x402) ────────────────────────────────────
async function fetchXlmPriceDirect() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data = await res.json();
      const price = data?.stellar?.usd;
      if (typeof price === 'number' && price > 0) return price;
    }
  } catch (e) {
    console.warn('⚠️  CoinGecko direct fetch failed:', e.message);
  }
  return null;
}

// ─── POST /api/agent/worker-reason ───────────────────────────────────────────
router.post('/worker-reason', async (req, res) => {
  const { prompt, clientLocalISO, clientTzOffset } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string' || prompt.length < 3) {
    return res.status(400).json({ success: false, error: 'prompt is required' });
  }
  if (prompt.length > 600) {
    return res.status(400).json({ success: false, error: 'prompt too long (max 600 chars)' });
  }
  if (!config.geminiApiKey) {
    return res.status(503).json({ success: false, error: 'GEMINI_API_KEY not configured' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

    let localNow;
    if (clientLocalISO && !isNaN(new Date(clientLocalISO).getTime())) {
      localNow = new Date(clientLocalISO);
    } else {
      localNow = new Date();
    }
    const tzOffsetMins = typeof clientTzOffset === 'number' ? clientTzOffset : 0;
    const tzSign = tzOffsetMins >= 0 ? '+' : '-';
    const tzHH = String(Math.floor(Math.abs(tzOffsetMins) / 60)).padStart(2, '0');
    const tzMM = String(Math.abs(tzOffsetMins) % 60).padStart(2, '0');
    const tzLabel = `UTC${tzSign}${tzHH}:${tzMM}`;
    // Shift UTC time by client's offset to get the actual local wall-clock date/time
    const localWall = new Date(localNow.getTime() + tzOffsetMins * 60 * 1000);
    const dayName = localWall.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const localDateStr = localWall.toISOString().slice(0, 16).replace('T', ' ');
    const promptWithDate = `Current local time: ${localDateStr} (${tzLabel}, ${dayName})\nWhen the user says a time like '19:50' or '19.50', interpret it as LOCAL time in ${tzLabel}.\n\nUser request: ${prompt}`;

    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: [{ role: 'user', parts: [{ text: promptWithDate }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 1024,
      },
    });

    let parsed;
    try {
      const raw     = response.text ?? '';
      const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ success: false, error: 'Gemini returned non-JSON response' });
    }

    // Add execute reasoning steps — only for direct-rate mode (USD budget adds its own ordered steps)
    if (parsed.decision === 'create_schedule' && !parsed.params?.hourlyUsdBudget) {
      parsed.reasoning.push({
        type: 'pay',
        text: 'Sending x402 micropayment to worker-schedule API…',
        sub: '$0.01 USDC → Stellar Autopay resource wallet',
      });
      const days   = Array.isArray(parsed.params?.workDays) ? parsed.params.workDays.length : 0;
      const pTotal = days > 0
        ? `${days} day(s), ${parsed.params?.workDays?.reduce((s, d) => s + (parseFloat(d.hours) || 0), 0)} total hours`
        : '';
      parsed.reasoning.push({
        type: 'execute',
        text: `POST /api/worker-schedule — ${parsed.params?.workerName ?? 'worker'} @ $${parsed.params?.hourlyRate}/hr${pTotal ? `, ${pTotal}` : ''}`,
      });
    }

    // Execute: create schedule
    let executionResult = null;
    if (parsed.decision === 'create_schedule' && parsed.params) {
      const p = parsed.params;
      const addr = p.workerAddress && StrKey.isValidEd25519PublicKey(p.workerAddress)
        ? p.workerAddress
        : null;

      if (!addr) {
        executionResult = { success: false, error: 'No valid Stellar recipient address in prompt' };
        parsed.reasoning.push({
          type: 'error',
          text: 'Cannot create schedule: missing or invalid Stellar address',
          sub: 'Include a full G... Stellar address (56 chars) in your request',
        });
      } else if (!Array.isArray(p.workDays) || p.workDays.length === 0) {
        executionResult = { success: false, error: 'Could not parse work days from prompt' };
        parsed.reasoning.push({ type: 'error', text: 'Could not determine work days', sub: 'Specify dates explicitly, e.g. "starting tomorrow for 3 days"' });
      } else {
        try {
      // ── USD-budget chain: fetch live XLM price, compute hourlyRate ──
      let resolvedHourlyRate = p.hourlyRate;
      let priceTxHash = null;
      if (p.hourlyUsdBudget && p.asset === 'XLM') {
        parsed.reasoning.push({
          type: 'pay',
          text: 'Step 1/2 — x402 payment to svc-price-001 for live XLM price…',
          sub: '$0.001 USDC → svc-price-001 (CoinGecko real-time)',
        });
        const { response: priceResp, x402TxHash: priceTx, x402Paid: pricePaid } = await x402BuyPrice();
        priceTxHash = priceTx ?? null;
        let xlmPrice = priceResp?.result?.price;
        // Fallback: call CoinGecko directly if marketplace returned no/bad price
        if (!xlmPrice || isNaN(xlmPrice)) {
          console.warn('⚠️  Marketplace price fetch returned no data — falling back to CoinGecko direct');
          xlmPrice = await fetchXlmPriceDirect();
        }
        if (!xlmPrice || isNaN(xlmPrice)) throw new Error('Could not fetch live XLM price from any source');
        parsed.reasoning.push({
          type: 'execute',
          text: `POST /agent/services/svc-price-001/buy${pricePaid ? ' [x402 ✓]' : ''}`,
          sub: priceTx ? `tx: ${priceTx.slice(0, 16)}…` : `XLM price: $${xlmPrice}`,
          txHash: priceTx ?? null,
        });
        resolvedHourlyRate = +(p.hourlyUsdBudget / xlmPrice).toFixed(7);
        parsed.reasoning.push({
          type: 'decide',
          text: `XLM price: $${Number(xlmPrice).toFixed(4)} → $${p.hourlyUsdBudget}/hr = ${resolvedHourlyRate} XLM/hr`,
          sub: 'real-time price via CoinGecko • computing exact XLM hourly rate',
        });
        parsed.reasoning.push({
          type: 'pay',
          text: 'Step 2/2 — creating worker schedule on Soroban…',
          sub: `${resolvedHourlyRate} XLM/hr × ${p.workDays?.reduce((s, d) => s + (parseFloat(d.hours) || 0), 0)}h total`,
        });
      }

      const payments = buildPayments(p.workDays, p.workStartTime || '09:00', resolvedHourlyRate);
          const schedData = {
            workerName:      (p.workerName || 'Worker').trim(),
            workerAddress:   addr,
            hourlyRate:      String(parseFloat(resolvedHourlyRate).toFixed(7)),
            hourlyUsdBudget: p.hourlyUsdBudget ? Number(p.hourlyUsdBudget) : 0,
            asset:           p.asset || 'USDC',
            workStartTime:   p.workStartTime || '09:00',
          };
          const agentKey = getAgentKey();
          const contractScheduleId = await createWorkerSchedule(agentKey, schedData, payments);

          const schedule = {
            id:              String(contractScheduleId),
            contractScheduleId,
            workerName:      schedData.workerName,
            workerAddress:   addr,
            hourlyRate:      schedData.hourlyRate,
            hourlyUsdBudget: p.hourlyUsdBudget ? Number(p.hourlyUsdBudget) : null,
            asset:           schedData.asset,
            workStartTime:   schedData.workStartTime,
            payments,
            createdAt:       new Date().toISOString(),
            status:          'active',
          };

          executionResult = {
            success: true,
            schedule,
            priceTxHash,  // x402 tx for live price lookup (null if direct USDC rate)
          };
          parsed.reasoning.push({
            type: 'result',
            text: `← 201 Created — Schedule #${schedule.id.slice(0, 8)} with ${payments.length} payment(s)`,
            sub: priceTxHash ? `price tx: ${priceTxHash.slice(0, 16)}…` : undefined,
            txHash: priceTxHash ?? undefined,
          });
        } catch (err) {
          executionResult = { success: false, error: err.message };
          parsed.reasoning.push({ type: 'error', text: `Execution failed: ${err.message}` });
        }
      }
    }

    return res.json({
      success:         true,
      intent:          parsed.intent,
      reasoning:       parsed.reasoning,
      decision:        parsed.decision,
      params:          parsed.params,
      answer:          parsed.answer,
      executionResult,
    });
  } catch (err) {
    console.error('agentWorkerReason error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
