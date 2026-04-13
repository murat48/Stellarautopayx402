/**
 * POST /api/agent/reason
 *
 * Accepts a natural-language prompt, calls Gemini to classify intent
 * and produce structured reasoning steps, then executes the resulting
 * action (e.g. create bill via x402) and returns everything to the UI.
 */
import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { StrKey, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { x402Client, x402HTTPClient } from '@x402/fetch';
import { createEd25519Signer, getNetworkPassphrase } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import config from '../config.js';
import { sendPayment, markPaidForAgent, recordPaymentForAgent, getAgentPublicKey } from '../services/sorobanService.js';

const router = Router();

// ─── Gemini system prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an autonomous Stellar blockchain payment agent.
Analyze the user's natural-language request and return ONLY a valid JSON object (no markdown fences, no explanations outside the JSON).

JSON schema:
{
  "intent": "recurring_payment" | "one_time_payment" | "search_services" | "buy_service" | "unknown",
  "reasoning": [
    { "type": "think" | "search" | "compare" | "decide" | "pay" | "execute" | "result" | "error", "text": "...", "sub": "..." }
  ],
  "decision": "create_bill" | "list_services" | "buy_service" | "explain",
  "decisionReason": "short explanation",
  "params": {
    "amount": <number or null>,
    "usdBudget": <number or null — set ONLY when user says '$X worth of XLM'; null for direct amounts>,
    "asset": "USDC" | "XLM" | null,
    "frequency": "monthly" | "weekly" | "one-time" | null,
    "recipientAddress": "<G... Stellar address extracted from prompt, or null>",
    "recipientName": "<human name if given, e.g. alice, or null>",
    "name": "<descriptive bill name or service description>",
    "nextDueDate": "<ISO-8601 datetime. Parse temporal expressions: 'today'→current datetime (ASAP/now), 'tomorrow'→tomorrow 00:00, 'next week'→+7d, 'next month'→+30d, explicit date like 'May 5'→that date, specific time like '11:45 am today'→today at 11:45. No date mentioned → use current datetime (now). NEVER default to +30 days unless explicitly 'next month'. Use format: YYYY-MM-DDTHH:MM:SS.000Z",
    "keywords": ["..."],
    "serviceQuery": "<what capability the user needs, e.g. 'web search', 'sentiment analysis', 'price feed'>",
    "serviceId": "<known service id if user mentions it explicitly, else null>",
    "serviceInput": { "<key>": "<value>" }
  },
  "answer": "concise one-paragraph final answer to the user"
}

Available marketplace services (agent-to-agent, all x402 protected):
- svc-search-001: Web Search API — $0.003/query — input: {query: string}
- svc-sentiment-001: Sentiment Analysis — $0.002/call — input: {text: string}
- svc-price-001: XLM/USDC Price Feed — $0.001/call — input: {pair: string}
- svc-autopay-bills-001: Recurring Bill Management — $0.01/call — input: {recipient, amount, asset, frequency}

Rules:
- If the prompt mentions a Stellar address (starts with G, 56 chars), put it in recipientAddress.
- If the prompt mentions a name like "alice" as recipient, put it in recipientName and set recipientAddress to null.
- Default asset to "USDC" unless "xlm" or "lumen" is explicitly mentioned.
- For recurring_payment intent, always include amount and frequency.
- For one_time_payment intent ('send X to Y now/today/at time'), set intent='one_time_payment', decision='create_bill', frequency='one-time'.
- If user says 'send $X worth of XLM' or 'X USD of XLM/lumens': set usdBudget=X, asset='XLM', amount=null, intent='one_time_payment'. The agent will auto-fetch live price and compute XLM amount.
- 'send', 'transfer', 'pay', 'gönder', 'aktar', 'öde', 'yolla' WITHOUT 'month'/'week'/'recurring'/'monthly'/'weekly'/'aylık'/'haftalık'/'tekrar' → one_time_payment intent, decision='create_bill', frequency='one-time'.
- Turkish immediate-payment words: 'şimdi', 'hemen', 'bugün', 'şu an', 'anında' → treat as 'now', set nextDueDate to current ISO datetime.
- 'gönder $X XLM', 'X XLM gönder', 'X USDC yolla/öde/aktar' → extract amount and asset, set intent=one_time_payment.
- 'X dolar değerinde XLM', '$X worth of XLM', 'X USD XLM' → set usdBudget=X, asset='XLM', amount=null, intent=one_time_payment.
- Always populate nextDueDate: 'today'/'bugün'/'şimdi'/'hemen'/no date → current ISO datetime (ASAP). Specific time like '11:45' or '11.45' today → today's date at that time.
- For 'search for services', 'what services are available', 'list services' → intent='search_services', decision='list_services'. Populate serviceQuery.
- For 'buy X service', 'get sentiment analysis', 'search the web for X', 'get price of XLM' → intent='buy_service', decision='buy_service'. Set serviceId if you can match it from the list above. Populate serviceInput with relevant data extracted from the prompt.
- reasoning array must have 4–8 steps covering: analyze → options → compare → decide → x402 execute.
- Make reasoning steps sound like a real autonomous agent thinking step by step.
- Keep each "sub" under 120 chars.`;

// ─── Parse time from prompt (server-side guard) ───────────────────────────────
/**
 * Extract specific time from a prompt string and apply it to a base Date.
 * Handles patterns like "at 11:58 AM", "at 3pm", "at 15:30".
 * If prompt contains 'immediately', 'şimdi', 'hemen', 'anında' → return current time (ignore any time spec).
 * Returns ISO string.
 */
function applyTimeFromPrompt(baseDate, promptText) {
  // Immediate-execution keywords override any time specification
  if (/\b(immediately|şimdi|hemen|anında|right now|şu an)\b/i.test(promptText)) {
    return new Date().toISOString();
  }
  
  // Support both HH:MM and HH.MM separators (European/Turkish style)
  const timeMatch = promptText.match(/at\s+(\d{1,2})[.:]?(\d{2})?\s*(am|pm)?/i);
  if (!timeMatch) return baseDate.toISOString();
  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2] ?? '0', 10);
  const ampm = (timeMatch[3] ?? '').toLowerCase();
  if (ampm === 'pm' && hours < 12) hours += 12;
  if (ampm === 'am' && hours === 12) hours = 0;
  const result = new Date(baseDate);
  result.setHours(hours, minutes, 0, 0);
  // If the resolved time is already in the past, schedule ASAP (1 min from now)
  // rather than pushing to tomorrow — for 'today at X' the user means 'now' if X passed.
  if (result.getTime() < Date.now()) {
    return new Date(Date.now() + 60_000).toISOString();
  }
  return result.toISOString();
}

// ─── Real x402 bill creation (server calls its own /agent/bills endpoint) ─────
const X402_NETWORK = 'stellar:testnet';

async function x402PostBill(billPayload) {
  if (!config.agentSecretKey) throw new Error('AGENT_SECRET_KEY not configured');
  if (!config.resourceWalletAddress) {
    // Paywall disabled — fall through to plain POST, bill API still processes it
    const url = `http://localhost:${config.port}/agent/bills`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(billPayload),
    });
    const data = await res.json();
    return { response: data, x402TxHash: null, x402Paid: false };
  }

  const networkPassphrase = getNetworkPassphrase(X402_NETWORK);
  const signer = createEd25519Signer(config.agentSecretKey, X402_NETWORK);
  const rpcConfig = { url: config.rpcUrl };

  const client = new x402Client().register(
    'stellar:*',
    new ExactStellarScheme(signer, rpcConfig),
  );
  const httpClient = new x402HTTPClient(client);

  const url = `http://localhost:${config.port}/agent/bills`;
  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(billPayload),
  };

  // First attempt — middleware returns 402
  const firstTry = await fetch(url, fetchOptions);
  if (firstTry.status !== 402) {
    const data = await firstTry.json();
    return { response: data, x402TxHash: null, x402Paid: false };
  }

  // Parse 402 payment requirements
  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => firstTry.headers.get(name),
  );

  // Build & sign payment payload
  let paymentPayload = await client.createPaymentPayload(paymentRequired);

  // Fix fee for testnet facilitator (same as demoAgent.js)
  const tx = new Transaction(paymentPayload.payload.transaction, networkPassphrase);
  const sorobanData = tx.toEnvelope()?.v1()?.tx()?.ext()?.sorobanData();
  if (sorobanData) {
    paymentPayload = {
      ...paymentPayload,
      payload: {
        ...paymentPayload.payload,
        transaction: TransactionBuilder.cloneFrom(tx, {
          fee: '1',
          sorobanData,
          networkPassphrase,
        }).build().toXDR(),
      },
    };
  }

  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  // Retry with payment header
  const paidResponse = await fetch(url, {
    ...fetchOptions,
    headers: { ...fetchOptions.headers, ...paymentHeaders },
  });

  // Capture settlement tx hash from response header
  const settle = httpClient.getPaymentSettleResponse(
    (name) => paidResponse.headers.get(name),
  );
  const x402TxHash = settle?.transaction ?? null;

  const data = await paidResponse.json();
  return { response: data, x402TxHash, x402Paid: true };
}

// ─── Real x402 service discovery (GET /agent/services) ────────────────────────
async function x402GetServices() {
  if (!config.agentSecretKey) throw new Error('AGENT_SECRET_KEY not configured');
  const url = `http://localhost:${config.port}/agent/services`;

  if (!config.resourceWalletAddress) {
    const res = await fetch(url);
    const data = await res.json();
    return { response: data, x402TxHash: null, x402Paid: false };
  }

  const networkPassphrase = getNetworkPassphrase(X402_NETWORK);
  const signer = createEd25519Signer(config.agentSecretKey, X402_NETWORK);
  const rpcConfig = { url: config.rpcUrl };
  const client = new x402Client().register('stellar:*', new ExactStellarScheme(signer, rpcConfig));
  const httpClient = new x402HTTPClient(client);

  const firstTry = await fetch(url);
  if (firstTry.status !== 402) {
    const data = await firstTry.json();
    return { response: data, x402TxHash: null, x402Paid: false };
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse((name) => firstTry.headers.get(name));
  let paymentPayload = await client.createPaymentPayload(paymentRequired);
  const tx = new Transaction(paymentPayload.payload.transaction, networkPassphrase);
  const sorobanData = tx.toEnvelope()?.v1()?.tx()?.ext()?.sorobanData();
  if (sorobanData) {
    paymentPayload = {
      ...paymentPayload,
      payload: {
        ...paymentPayload.payload,
        transaction: TransactionBuilder.cloneFrom(tx, { fee: '1', sorobanData, networkPassphrase }).build().toXDR(),
      },
    };
  }
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  const paidResponse = await fetch(url, { headers: { ...paymentHeaders } });
  const settle = httpClient.getPaymentSettleResponse((name) => paidResponse.headers.get(name));
  const x402TxHash = settle?.transaction ?? null;
  const data = await paidResponse.json();
  return { response: data, x402TxHash, x402Paid: true };
}

// ─── Real x402 service purchase (POST /agent/services/:id/buy) ───────────────
async function x402BuyService(serviceId, input = {}) {
  if (!config.agentSecretKey) throw new Error('AGENT_SECRET_KEY not configured');
  const url = `http://localhost:${config.port}/agent/services/${serviceId}/buy`;
  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  };

  if (!config.resourceWalletAddress) {
    const res = await fetch(url, fetchOptions);
    const data = await res.json();
    return { response: data, x402TxHash: null, x402Paid: false };
  }

  const networkPassphrase = getNetworkPassphrase(X402_NETWORK);
  const signer = createEd25519Signer(config.agentSecretKey, X402_NETWORK);
  const rpcConfig = { url: config.rpcUrl };
  const client = new x402Client().register('stellar:*', new ExactStellarScheme(signer, rpcConfig));
  const httpClient = new x402HTTPClient(client);

  const firstTry = await fetch(url, fetchOptions);
  if (firstTry.status !== 402) {
    const data = await firstTry.json();
    return { response: data, x402TxHash: null, x402Paid: false };
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse((name) => firstTry.headers.get(name));
  let paymentPayload = await client.createPaymentPayload(paymentRequired);
  const tx = new Transaction(paymentPayload.payload.transaction, networkPassphrase);
  const sorobanData = tx.toEnvelope()?.v1()?.tx()?.ext()?.sorobanData();
  if (sorobanData) {
    paymentPayload = {
      ...paymentPayload,
      payload: {
        ...paymentPayload.payload,
        transaction: TransactionBuilder.cloneFrom(tx, { fee: '1', sorobanData, networkPassphrase }).build().toXDR(),
      },
    };
  }
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  const paidResponse = await fetch(url, { ...fetchOptions, headers: { ...fetchOptions.headers, ...paymentHeaders } });
  const settle = httpClient.getPaymentSettleResponse((name) => paidResponse.headers.get(name));
  const x402TxHash = settle?.transaction ?? null;
  const data = await paidResponse.json();
  return { response: data, x402TxHash, x402Paid: true };
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

// ─── Build Gemini client ───────────────────────────────────────────────────────
function buildGemini() {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY not configured');
  return new GoogleGenAI({ apiKey: config.geminiApiKey });
}

// ─── POST /api/agent/reason ───────────────────────────────────────────────────
router.post('/reason', async (req, res) => {
  const { prompt, clientLocalISO, clientTzOffset } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string' || prompt.length < 3) {
    return res.status(400).json({ success: false, error: 'prompt is required' });
  }
  if (prompt.length > 500) {
    return res.status(400).json({ success: false, error: 'prompt too long (max 500 chars)' });
  }

  if (!config.geminiApiKey) {
    return res.status(503).json({ success: false, error: 'GEMINI_API_KEY not configured' });
  }

  try {
    const ai = buildGemini();

    // Use client's local time if provided (avoids UTC offset errors for time-specific prompts)
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
    // Shift UTC instant by client's offset to get the actual local wall-clock date/time
    const localWall = new Date(localNow.getTime() + tzOffsetMins * 60 * 1000);
    const dayName = localWall.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const localDateStr = localWall.toISOString().slice(0, 16).replace('T', ' '); // YYYY-MM-DD HH:MM
    const promptWithDate = `Current local time: ${localDateStr} (${tzLabel}, ${dayName})\nWhen the user says a time like '19:50' or '19.50', interpret it as LOCAL time in ${tzLabel}.\n\nUser request: ${prompt}`;

    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: [{ role: 'user', parts: [{ text: promptWithDate }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        temperature: 0.3,
        maxOutputTokens: 1024,
      },
    });

    let parsed;
    try {
      const raw = response.text ?? '';
      // Strip markdown fences if model added them anyway
      const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ success: false, error: 'Gemini returned non-JSON response' });
    }

    // Add x402 pay step if we're going to create a bill (usdBudget chain adds its own ordered steps)
    if (parsed.decision === 'create_bill' && !parsed.params?.usdBudget) {
      parsed.reasoning.push({
        type: 'pay',
        text: 'Sending x402 micropayment to /agent/bills…',
        sub: `$0.01 USDC → ${config.resourceWalletAddress ? config.resourceWalletAddress.slice(0, 8) + '…' : 'resource wallet'}`,
      });
    }

    // Execute action: create bill directly via Soroban (no x402 — agent acts on its own contract)
    let executionResult = null;
    const isPaymentIntent = parsed.decision === 'create_bill'
      || parsed.intent === 'one_time_payment'
      || parsed.intent === 'recurring_payment';
    if (isPaymentIntent && (parsed.params?.amount || parsed.params?.usdBudget)) {
      // Normalize decision so downstream code is consistent
      if (parsed.intent === 'one_time_payment' && parsed.decision !== 'create_bill') {
        parsed.decision = 'create_bill';
      }
      // Validate recipient address — never fall back to a hardcoded placeholder
      const recipientAddress = parsed.params.recipientAddress
        && StrKey.isValidEd25519PublicKey(parsed.params.recipientAddress)
        ? parsed.params.recipientAddress
        : null;

      if (!recipientAddress) {
        executionResult = { success: false, error: 'No valid Stellar recipient address in prompt. Provide a G... address (56 chars) to auto-create a bill.' };
        parsed.reasoning.push({
          type: 'error',
          text: 'Cannot create bill: missing or invalid recipient Stellar address',
          sub: 'Include a full G... Stellar address in your request to proceed',
        });
      } else {
        try {
          // ── USD-budget chain: buy live XLM price via x402, then compute amount ──
          let resolvedAmount = parsed.params.amount;
          if (parsed.params.usdBudget && parsed.params.asset === 'XLM') {
            parsed.reasoning.push({
              type: 'pay',
              text: 'Step 1/2 — x402 payment to svc-price-001 for live XLM price…',
              sub: `$0.001 USDC → svc-price-001 (CoinGecko real-time)`,
            });
            const { response: priceResp, x402TxHash: priceTx, x402Paid: pricePaid } = await x402BuyService('svc-price-001', { pair: 'XLM/USD' });
            let xlmPrice = priceResp?.result?.price;
            if (!xlmPrice || isNaN(xlmPrice)) {
              // x402 service failed — fall back to direct CoinGecko
              xlmPrice = await fetchXlmPriceDirect();
            }
            if (!xlmPrice || isNaN(xlmPrice)) throw new Error('Could not fetch live XLM price from any source');
            parsed.reasoning.push({
              type: 'execute',
              text: `POST /agent/services/svc-price-001/buy${pricePaid ? ' [x402 ✓]' : ''}`,
              sub: priceTx ? `tx: ${priceTx.slice(0, 16)}…` : `XLM price: $${xlmPrice}`,
              txHash: priceTx ?? null,
            });
            resolvedAmount = +(parsed.params.usdBudget / xlmPrice).toFixed(7);
            parsed.reasoning.push({
              type: 'decide',
              text: `XLM price: $${Number(xlmPrice).toFixed(4)} → $${parsed.params.usdBudget} USD = ${resolvedAmount} XLM`,
              sub: `real-time price via CoinGecko • computing exact XLM amount`,
            });
            parsed.reasoning.push({
              type: 'pay',
              text: 'Step 2/2 — x402 micropayment to create bill on Soroban…',
              sub: `$0.01 USDC → /agent/bills · ${resolvedAmount} XLM`,
            });
          }
          // Resolve nextDueDate
          let nextDueDate;
          if (parsed.params.nextDueDate) {
            const candidate = new Date(parsed.params.nextDueDate);
            if (!isNaN(candidate.getTime())) {
              nextDueDate = applyTimeFromPrompt(candidate, prompt);
            }
          }
          if (!nextDueDate) {
            nextDueDate = applyTimeFromPrompt(localWall, prompt);
          }
          if (new Date(nextDueDate).getTime() < Date.now()) {
            nextDueDate = new Date(Date.now() + 60_000).toISOString();
          }

          const billPayload = {
            name: parsed.params.name || `Agent bill – ${parsed.params.recipientName ?? 'recipient'}`,
            recipientAddress,
            amount: resolvedAmount,
            asset: parsed.params.asset || 'USDC',
            type: (parsed.params.frequency && parsed.params.frequency !== 'one-time') ? 'recurring' : 'one-time',
            frequency: parsed.params.frequency || 'monthly',
            dayOfMonth: 0,
            nextDueDate,
          };

          // Real x402 payment: server POSTs to its own /agent/bills, pays 402, retries
          const { response: billResp, x402TxHash, x402Paid } = await x402PostBill(billPayload);

          if (!billResp.success) throw new Error(billResp.error || 'Bill API returned failure');
          const bill = billResp.bill;

          executionResult = {
            success: true,
            billId: bill?.id ?? bill?.billId,
            ...billPayload,
            bill,
            x402TxHash,
          };

          // Real execute step with actual tx hash
          parsed.reasoning.push({
            type: 'execute',
            text: `POST /agent/bills { amount: ${billPayload.amount}, asset: ${billPayload.asset}, frequency: ${billPayload.frequency} }${x402Paid ? ' [x402 ✓]' : ''}`,
            sub: x402TxHash ? `tx: ${x402TxHash.slice(0, 16)}…` : 'POST /agent/bills → Soroban',
            txHash: x402TxHash ?? null,
          });

          parsed.reasoning.push({
            type: 'result',
            text: `← Bill #${executionResult.billId} created on Soroban contract`,
            sub: `${billPayload.amount} ${billPayload.asset}/${billPayload.frequency} → ${recipientAddress.slice(0, 10)}...`,
          });

          // ── Immediate execution: only if due within the next 2 minutes ──────
          // Bills already past-due are handled by reminderJob (runs every 30s)
          // to avoid accidental double-payment on scheduled bills.
          const dueMs = new Date(nextDueDate).getTime();
          const secsUntilDue = (dueMs - Date.now()) / 1000;
          if (secsUntilDue >= 0 && secsUntilDue <= 120 && executionResult.billId) {
            try {
              parsed.reasoning.push({
                type: 'execute',
                text: `Due in ${Math.ceil(secsUntilDue)}s — executing payment immediately…`,
                sub: `${billPayload.amount} ${billPayload.asset} → ${recipientAddress.slice(0, 10)}…`,
              });
              const agentKey = getAgentPublicKey();
              const payResult = await sendPayment(agentKey, recipientAddress, billPayload.amount, billPayload.asset);
              await markPaidForAgent(agentKey, Number(executionResult.billId));
              await recordPaymentForAgent(agentKey, {
                billId: Number(executionResult.billId),
                billName: billPayload.name,
                recipientAddress,
                amount: billPayload.amount,
                asset: billPayload.asset,
                txHash: payResult.hash,
                status: 'success',
                errorMsg: '',
              });
              executionResult.payTxHash = payResult.hash;
              executionResult.paidImmediately = true;
              parsed.reasoning.push({
                type: 'result',
                text: `✅ Payment sent immediately`,
                sub: `tx: ${payResult.hash.slice(0, 16)}… · ${billPayload.amount} ${billPayload.asset} transferred`,
                txHash: payResult.hash,
              });
            } catch (payErr) {
              parsed.reasoning.push({
                type: 'error',
                text: `Immediate payment failed: ${payErr.message}`,
                sub: 'Bill remains scheduled — auto-pay engine will retry',
              });
            }
          }
        } catch (execErr) {
          executionResult = { success: false, error: execErr.message };
          parsed.reasoning.push({
            type: 'error',
            text: `Bill creation failed: ${execErr.message}`,
          });
        }
      }
    }

    // ─── list_services: agent discovers marketplace via x402 ($0.001) ───────
    else if (parsed.decision === 'list_services' || parsed.intent === 'search_services') {
      try {
        parsed.reasoning.push({
          type: 'pay',
          text: 'Sending x402 micropayment to discover marketplace services…',
          sub: `$0.001 USDC → ${config.resourceWalletAddress ? config.resourceWalletAddress.slice(0, 8) + '…' : 'GET /agent/services'}`,
        });

        const { response: svcResp, x402TxHash: listTx, x402Paid: listPaid } = await x402GetServices();
        const services = svcResp.services || [];

        parsed.reasoning.push({
          type: 'execute',
          text: `GET /agent/services → ${services.length} services found${listPaid ? ' [x402 ✓]' : ''}`,
          sub: listTx ? `tx: ${listTx.slice(0, 16)}…` : 'marketplace queried',
          txHash: listTx ?? null,
        });

        // Match best service for the keywords
        const keywords = (parsed.params?.keywords || []).map(k => k.toLowerCase());
        const query = (parsed.params?.serviceQuery || '').toLowerCase();
        const search = [...keywords, ...query.split(' ')].filter(Boolean);
        let best = services[0];
        if (search.length > 0) {
          let bestScore = -1;
          for (const svc of services) {
            const text = `${svc.name} ${svc.description} ${svc.category}`.toLowerCase();
            const score = search.filter(kw => text.includes(kw)).length;
            if (score > bestScore) { bestScore = score; best = svc; }
          }
        }

        executionResult = { success: true, services, bestMatch: best, x402TxHash: listTx };
        parsed.reasoning.push({
          type: 'result',
          text: `Found ${services.length} available services. Best match: "${best?.name}"`,
          sub: best ? `${best.priceLabel} · ${best.provider}` : '',
        });
      } catch (svcErr) {
        executionResult = { success: false, error: svcErr.message };
        parsed.reasoning.push({ type: 'error', text: `Service discovery failed: ${svcErr.message}` });
      }
    }

    // ─── buy_service: agent discovers then buys — two real x402 payments ────
    else if (parsed.decision === 'buy_service' || parsed.intent === 'buy_service') {
      try {
        // Step 1: discover services (x402 $0.001)
        parsed.reasoning.push({
          type: 'pay',
          text: 'Step 1/2 — x402 micropayment to discover available services…',
          sub: `$0.001 USDC → GET /agent/services`,
        });

        const { response: svcResp, x402TxHash: discoverTx, x402Paid: discoverPaid } = await x402GetServices();
        const services = svcResp.services || [];

        parsed.reasoning.push({
          type: 'execute',
          text: `GET /agent/services → ${services.length} available${discoverPaid ? ' [x402 ✓]' : ''}`,
          sub: discoverTx ? `tx: ${discoverTx.slice(0, 16)}…` : 'marketplace queried',
          txHash: discoverTx ?? null,
        });

        // Match best service
        const keywords = (parsed.params?.keywords || []).map(k => k.toLowerCase());
        const query = (parsed.params?.serviceQuery || parsed.params?.name || '').toLowerCase();
        const explicitId = parsed.params?.serviceId;
        let target = explicitId ? services.find(s => s.id === explicitId) : null;
        if (!target) {
          const search = [...keywords, ...query.split(' ')].filter(Boolean);
          let bestScore = -1;
          for (const svc of services) {
            const text = `${svc.name} ${svc.description} ${svc.category}`.toLowerCase();
            const score = search.length > 0 ? search.filter(kw => text.includes(kw)).length : 1;
            if (score > bestScore) { bestScore = score; target = svc; }
          }
        }

        if (!target) throw new Error('No matching service found in marketplace');

        parsed.reasoning.push({
          type: 'decide',
          text: `Selected: "${target.name}" from ${target.provider}`,
          sub: `${target.priceLabel} · agent-to-agent x402 purchase`,
        });

        // Step 2: buy the service (x402 per-service price)
        parsed.reasoning.push({
          type: 'pay',
          text: `Step 2/2 — x402 payment to buy "${target.name}"…`,
          sub: `$${target.price} ${target.priceUnit} → ${target.providerAddress?.slice(0, 8)}…`,
        });

        const buyInput = parsed.params?.serviceInput
          || (query ? { query, text: query, pair: 'XLM/USDC' } : { query: 'stellar blockchain' });
        const { response: buyResp, x402TxHash: buyTx, x402Paid: buyPaid } = await x402BuyService(target.id, buyInput);

        parsed.reasoning.push({
          type: 'execute',
          text: `POST /agent/services/${target.id}/buy${buyPaid ? ' [x402 ✓]' : ''}`,
          sub: buyTx ? `tx: ${buyTx.slice(0, 16)}…` : `${target.name} executed`,
          txHash: buyTx ?? null,
        });

        executionResult = {
          success: !!buyResp.success,
          serviceId: target.id,
          serviceName: target.name,
          pricePaid: buyResp.pricePaid,
          discoverTxHash: discoverTx,
          buyTxHash: buyTx,
          result: buyResp.result,
        };

        parsed.reasoning.push({
          type: 'result',
          text: `← "${target.name}" response received`,
          sub: buyResp.pricePaid ? `paid ${buyResp.pricePaid} via x402` : 'service executed',
        });
      } catch (buyErr) {
        executionResult = { success: false, error: buyErr.message };
        parsed.reasoning.push({ type: 'error', text: `Service purchase failed: ${buyErr.message}` });
      }
    }

    res.json({
      success: true,
      intent: parsed.intent,
      reasoning: parsed.reasoning,
      decision: parsed.decision,
      decisionReason: parsed.decisionReason,
      params: parsed.params,
      answer: parsed.answer,
      executionResult,
    });

  } catch (err) {
    console.error('Gemini /reason error:', err.message);
    const status = err.message?.includes('not configured') ? 503 : 502;
    res.status(status).json({ success: false, error: err.message });
  }
});

export default router;
