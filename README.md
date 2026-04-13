# 🚀 Stellar Autopay X402 — Agentic Payment Platform

> **An autonomous payment agent that speaks natural language, pays with x402 micropayments, and executes every transaction on Stellar's Soroban blockchain.**

---

## 🏆 Hackathon Summary

Stellar Autopay demonstrates two cutting-edge primitives working together on the Stellar blockchain:

| Primitive                 | Implementation                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **LLM → On-Chain Action** | Gemini AI parses a natural-language hiring prompt and autonomously creates a fully on-chain worker payment schedule — no forms, no clicks        |
| **x402 Agentic Payments** | Every REST API endpoint is protected by the x402 micropayment protocol — agents pay micro-USDC per call, settled on Stellar testnet in real time |

---

## 🔗 Quick Links

|                              |                                                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live Demo**                | https://stellarautopay.vercel.app                                                                                                                                       |
| **Autopay Contract**         | [`CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS`](https://stellar.expert/explorer/testnet/contract/CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS) |
| **Worker Schedule Contract** | [`CDRM3V5SVIZ3OWGZWDEUR6FQESPIVRB2VYPDIJ3XC4LS6BIBSRATPCFA`](https://stellar.expert/explorer/testnet/contract/CDRM3V5SVIZ3OWGZWDEUR6FQESPIVRB2VYPDIJ3XC4LS6BIBSRATPCFA) |
| **Agent Wallet**             | [`GDYASMG4W3LFG5YQIUG7IHKVFTDO4SJPX2S2WJVJTQSUGRAULQ45GK7M`](https://stellar.expert/explorer/testnet/account/GDYASMG4W3LFG5YQIUG7IHKVFTDO4SJPX2S2WJVJTQSUGRAULQ45GK7M)  |
| **Network**                  | Stellar Testnet                                                                                                                                                         |
| **GitHub**                   | https://github.com/murat48/stellarautopay                                                                                                                               |

---

## 🧠 LLM Integration — Natural Language → On-Chain Payments

### The Flow

```
User types: "Hire Alice for 3 days starting tomorrow,
             8h/day, $5/hr worth of XLM, address G..."
                    │
                    ▼
         ┌──────────────────────┐
         │  Google Gemini AI    │  ← gemini-2.5-flash-lite
         │  (agentWorkerReason) │
         └──────────┬───────────┘
                    │  Structured JSON:
                    │  { workerAddress, hourlyUsdBudget,
                    │    workDays: [{date, hours}], ... }
                    ▼
         ┌──────────────────────┐
         │   x402 Price Feed    │  ← buys live XLM/USD rate
         │   svc-price-001      │    via x402 micropayment
         └──────────┬───────────┘
                    │  xlmPrice = $0.2834
                    ▼
         ┌──────────────────────┐
         │  Payment Generator   │  ← $5/hr ÷ $0.2834 = 17.64 XLM/hr
         │  (buildPayments)     │    24 scheduled payments created
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │  Soroban Contract    │  ← create_schedule() invoked
         │  Worker Schedule     │    on-chain, UUID payment IDs
         └──────────────────────┘
```

### What Gemini Parses

The LLM receives a structured prompt with the user's local time, timezone offset, and free-text request. It returns a JSON object with:

- **Worker name & Stellar address** — extracts from natural language
- **Hourly rate vs. USD budget** — distinguishes `$5/hr USDC` (fixed) from `$5/hr worth of XLM` (live rate)
- **Work schedule** — maps relative dates like "tomorrow", "next Monday", "3 days starting today"
- **Work start time** — `"starts at 14:00"` → extracted as `"14:00"` (timezone-aware)
- **Reasoning chain** — multi-step think/search/decide/execute trace shown in UI

### Timezone-Aware Date Parsing

Frontend sends `clientLocalISO` (UTC) + `clientTzOffset` (minutes). Server computes the real local wall-clock time:

```js
const localWall = new Date(localNow.getTime() + tzOffsetMins * 60 * 1000);
```

This means "today" always resolves to the user's actual today, not UTC's.

### Live XLM Rate via x402

When the user requests payment in `$X/hr worth of XLM`, the agent:

1. Calls `POST /agent/services/svc-price-001/buy` — pays **$0.001 USDC** via x402
2. Gets live CoinGecko XLM/USD price
3. Computes `hourlyXlm = hourlyUsd / xlmPrice` at schedule creation time
4. The reasoning chain displays: `XLM price: $0.2834 → $5/hr = 17.64 XLM/hr`

---

## ⚡ x402 Agentic Payment Protocol

Every API endpoint on this platform is **pay-per-use**, enforced by the x402 protocol. No API keys, no subscriptions — agents pay micro-USDC and get access.

### How x402 Works Here

```
Agent/Browser                    Server (Express)
     │                                │
     │  GET /agent/services           │
     │ ─────────────────────────────► │
     │                                │ ← x402 middleware checks
     │  402 Payment Required          │   for X-PAYMENT header
     │ ◄───────────────────────────── │
     │  (WWW-Authenticate header      │
     │   with price + payTo addr)     │
     │                                │
     │  [agent signs Stellar tx]      │
     │  GET /agent/services           │
     │  X-PAYMENT: <signed XDR>       │
     │ ─────────────────────────────► │
     │                                │ ← facilitator verifies
     │  200 OK  +  X-PAYMENT-RESPONSE │   & settles on-chain
     │ ◄───────────────────────────── │
```

### Pricing Table

| Endpoint                       | Price           | Purpose                     |
| ------------------------------ | --------------- | --------------------------- |
| `POST /agent/bills`            | **$0.010 USDC** | Create a new recurring bill |
| `GET /agent/bills`             | **$0.001 USDC** | List all bills              |
| `POST /agent/bills/:id/pause`  | **$0.005 USDC** | Pause/resume a bill         |
| `DELETE /agent/bills/:id`      | **$0.005 USDC** | Delete a bill               |
| `POST /agent/pay/:id`          | **$0.005 USDC** | Trigger a payment           |
| `POST /agent/notify/:id`       | **$0.002 USDC** | Send Telegram reminder      |
| `GET /agent/history`           | **$0.001 USDC** | Payment history             |
| `GET /agent/balance`           | **$0.001 USDC** | Agent wallet balance        |
| `GET /agent/services`          | **$0.001 USDC** | List marketplace services   |
| `POST /agent/services/:id/buy` | **$0.005 USDC** | Purchase a service          |
| `POST /agent/worker-schedule`  | **$0.010 USDC** | Create worker schedule      |
| `GET /agent/worker-schedule`   | **$0.001 USDC** | List worker schedules       |

Every call generates a **real Stellar testnet transaction** — verifiable on Stellar Expert.

### x402 in Action — Agent Commerce

The agent marketplace lets agents sell compute/data services to other agents, paid per-call:

- **svc-price-001** — Live XLM/USD price feed (`$0.001/call` → CoinGecko real API; falls back to mock on network error)
- **svc-autopay-bills-001** — Bill management as a service (`$0.01/call`) — ⚠️ **demo stub**, returns random billId; does NOT call the Soroban contract
- **svc-search-001** — Web search (`$0.003/query`) — ⚠️ **demo stub**, returns hardcoded results
- **svc-sentiment-001** — Sentiment analysis (`$0.002/call`) — ⚠️ **demo stub**, returns random score

The `agentWorkerReason` route itself buys from `svc-price-001` using x402 to get the live XLM rate — **an agent paying another agent on-chain**.

---

## 🔗 Soroban Smart Contracts

### Contract 1: Autopay (Recurring Bills)

**ID:** `CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS`  
**Source:** `contracts/autopay/src/lib.rs`

Stores recurring and one-time payment schedules per user. The backend agent polls every 30 seconds and executes any overdue bill autonomously.

| Function              | Auth   | Description                      |
| --------------------- | ------ | -------------------------------- |
| `add_bill`            | Caller | Create a payment schedule        |
| `pause_bill`          | Caller | Toggle pause/resume              |
| `delete_bill`         | Caller | Remove permanently               |
| `mark_paid`           | Caller | Mark as paid after transfer      |
| `update_next_due`     | Caller | Advance recurring due date       |
| `record_payment`      | Caller | Write payment attempt to history |
| `get_all_bills`       | None   | Fetch all bills for a wallet     |
| `get_payment_history` | None   | Fetch all payment records        |

### Contract 2: Worker Schedule (Hourly Payments)

**ID:** `CDRM3V5SVIZ3OWGZWDEUR6FQESPIVRB2VYPDIJ3XC4LS6BIBSRATPCFA`  
**Source:** `contracts/worker-schedule/src/lib.rs`

Stores per-worker, per-hour payment schedules created by the LLM agent. Each payment slot has a UUID, a `pay_at` timestamp, and a status (`Pending` / `Done` / `Failed` / `Cancelled`).

| Function               | Auth   | Description                               |
| ---------------------- | ------ | ----------------------------------------- |
| `create_schedule`      | Caller | Create schedule + all payments atomically |
| `get_all_schedules`    | None   | List all schedules for a caller           |
| `get_payments`         | None   | Get all payments for a schedule           |
| `get_pending_payments` | None   | Get unpaid payments only                  |
| `set_payment_status`   | Caller | Mark payment done/failed with tx hash     |
| `cancel_schedule`      | Caller | Cancel a schedule                         |

**Key design:** Payment IDs are UUID strings (not integers) — set by the caller so the frontend's local state stays perfectly in sync with on-chain state.

```rust
pub struct PaymentInput {
    pub id: String,          // UUID assigned by caller
    pub day_index: u32,
    pub hour_index: u32,
    pub label: String,       // "Day 1 · Hr 3"
    pub date: String,        // "YYYY-MM-DD"
    pub pay_at: u64,         // Unix timestamp
    pub amount: i128,        // 7-decimal fixed point
}
```

### Auto-Pay Engine

Background job (`reminderJob.js`) runs every 30 seconds:

```
For each active worker schedule:
  → fetch pending payments from Soroban
  → if payment.payAt ≤ now:
      → if hourlyUsdBudget mode: fetch live XLM price
      → sendPayment() on Stellar Horizon
      → setWorkerPaymentStatus(..., 'done', txHash) on Soroban
      → send Telegram confirmation
```

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        React Frontend                        │
│   WorkerAgentChat  WorkerSchedules  AgentControlPanel        │
│         │                │                  │                │
│         └────────────────┴──────────────────┘                │
│                          │                                   │
│               POST /api/agent/worker-reason                  │
│               GET  /api/worker-schedule                      │
│               GET  /api/panel/bills                          │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼──────────────────────────────────┐
│               Node.js / Express Agent Server                  │
│                                                              │
│  ┌─────────────────┐   ┌──────────────────┐                 │
│  │ x402 Paywall    │   │ Reminder Job      │                 │
│  │ (per-endpoint   │   │ (30s auto-pay     │                 │
│  │  USDC charge)   │   │  engine)          │                 │
│  └────────┬────────┘   └────────┬─────────┘                 │
│           │                     │                            │
│  ┌────────▼─────────────────────▼─────────┐                 │
│  │           sorobanService.js             │                 │
│  │  invokeContract / invokeWsContract      │                 │
│  │  sendPayment / getAllBills / ...         │                 │
│  └────────────────────┬────────────────────┘                 │
│                       │                                      │
│  ┌────────────────────▼────────────────────┐                 │
│  │         Google Gemini AI                 │                 │
│  │  Natural language → JSON schedule        │                 │
│  │  (agentWorkerReason.js)                  │                 │
│  └──────────────────────────────────────────┘                │
└──────────────────────────┬──────────────────────────────────┘
                           │ Soroban RPC / Horizon
┌──────────────────────────▼──────────────────────────────────┐
│                   Stellar Testnet                             │
│                                                              │
│  ┌────────────────────┐  ┌────────────────────────────────┐  │
│  │  Autopay Contract  │  │  Worker Schedule Contract      │  │
│  │  (bills, history)  │  │  (schedules, hourly payments)  │  │
│  └────────────────────┘  └────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 🛠 Tech Stack

| Layer              | Technology                                        |
| ------------------ | ------------------------------------------------- |
| Frontend           | React 19 + Vite 8                                 |
| Backend Agent      | Node.js 22 + Express                              |
| Blockchain SDK     | `@stellar/stellar-sdk` v15                        |
| Wallet Integration | `@creit.tech/stellar-wallets-kit` v2              |
| Smart Contracts    | Rust + Soroban SDK v22 (×2)                       |
| LLM                | Google Gemini `gemini-2.5-flash-lite`             |
| Agentic Payments   | `@x402/express` + `@x402/fetch` + `@x402/stellar` |
| Facilitator        | https://x402.org/facilitator                      |
| Notifications      | Telegram Bot API                                  |
| Hosting            | Vercel (frontend) + server (backend agent)        |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- [Freighter Wallet](https://freighter.app/) browser extension
- Funded Stellar testnet account → [Friendbot](https://friendbot.stellar.org/?addr=YOUR_KEY)
- Google AI Studio API key → https://aistudio.google.com

### 1. Clone & Install

```bash
git clone https://github.com/murat48/stellarautopay.git
cd stellarautopay

# Frontend
npm install
npm run dev         # http://localhost:5173

# Backend agent (separate terminal)
cd server
npm install
node index.js       # http://localhost:3001
```

### 2. Configure Backend

Create `server/.env`:

```env
# Stellar agent keypair (holds funds for auto-pay)
AGENT_SECRET_KEY=S...

# Soroban contract IDs
CONTRACT_ID=CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS
WORKER_SCHEDULE_CONTRACT_ID=CDRM3V5SVIZ3OWGZWDEUR6FQESPIVRB2VYPDIJ3XC4LS6BIBSRATPCFA

# x402: wallet address that receives micropayments from API callers
RESOURCE_WALLET_ADDRESS=G...

# Google Gemini AI
GEMINI_API_KEY=your_key_from_aistudio.google.com
GEMINI_MODEL=gemini-2.5-flash-lite

# Optional: Telegram notifications
TELEGRAM_BOT_TOKEN=...
```

### 3. Fund the Agent Wallet

The agent wallet needs XLM to pay workers and USDC to pay x402 endpoint fees:

```bash
# Fund with XLM (testnet)
curl "https://friendbot.stellar.org/?addr=YOUR_AGENT_ADDRESS"

# Add USDC trustline + fund via DEX (testnet)
# USDC issuer on testnet: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
```

### 4. Build & Deploy Frontend

```bash
npm run build        # outputs to dist/
vercel deploy --prod
```

---

## 💡 Live Demo Walkthrough

### Demo 1: AI Worker Hiring (LLM + x402 + Soroban)

1. Open the app → **Workers** tab → **🤖 Hire via Agent**
2. Type: `Hire Alice for 2 days starting tomorrow, 4h/day, $5/hr worth of XLM, to GCEF3BTQVDJ473URMW4556VG67YAPS2J5OP77FBXT7T47M2DOIZ7TDAR`
3. Watch the reasoning chain:
   - 🔍 Extract worker address from prompt
   - 💰 **x402 pay** `svc-price-001` → get live XLM price ($0.2834)
   - ✅ Compute: `$5 ÷ $0.2834 = 17.64 XLM/hr`
   - ⚡ `POST /api/worker-schedule` → Soroban `create_schedule()` invoked
   - 📋 Schedule #N created with 8 payments on-chain

### Demo 2: x402 API Panel (Every button = real Stellar tx)

1. Open **Agent API Panel** (Control Panel tab)
2. Click **↻ Refresh** on Bills — `GET /agent/bills` → **$0.001 USDC** charged, tx hash shown
3. Click **⚡ Create Bill** — `POST /agent/bills` → **$0.010 USDC** charged
4. Click **⚡ Pay Now** — Stellar payment executed + `mark_paid` on Soroban

### Demo 3: Agent-to-Agent Commerce

The worker hiring flow automatically buys a live XLM price from the internal marketplace:

```
Worker Reason Agent
  └─► POST /agent/services/svc-price-001/buy
       └─► x402: $0.001 USDC paid on-chain
            └─► CoinGecko XLM/USD price returned
                 └─► Schedule computed at live rate
```

---

## 🔒 Security

| Risk               | Mitigation                                                 |
| ------------------ | ---------------------------------------------------------- |
| Agent key exposure | Lives in `server/.env`, never in frontend                  |
| Double payments    | Per-bill cooldown map (1hr window) + on-chain status check |
| Past-date payments | `buildPayments` filters out any `payAt < now + 5min`       |
| Prompt injection   | Gemini response parsed as strict JSON; no eval/exec        |
| x402 replay        | Stellar tx sequence numbers prevent replays                |
| Input validation   | Stellar address regex, price bounds, category allowlist    |
| Contract auth      | `caller.require_auth()` on every write function            |

---

## 📁 Project Structure

```
stellarautopay/
├── contracts/
│   ├── autopay/src/lib.rs              # Soroban: bills & payment history
│   └── worker-schedule/src/lib.rs      # Soroban: per-hour worker schedules
├── server/                             # Autonomous payment agent
│   ├── index.js                        # Express entry point
│   ├── config.js                       # Env config
│   ├── middleware/
│   │   └── x402Paywall.js              # x402 per-endpoint micropayment enforcement
│   ├── services/
│   │   ├── sorobanService.js           # All Soroban RPC interactions
│   │   ├── reminderJob.js              # 30s auto-pay background engine
│   │   ├── telegramService.js          # Telegram Bot notifications
│   │   └── paymentLinkService.js       # Payment link generation
│   └── routes/
│       ├── agentWorkerReason.js        # LLM → on-chain schedule (Gemini + x402)
│       ├── agentServices.js            # Agent services marketplace
│       ├── workerSchedules.js          # Worker schedule CRUD
│       ├── agentBills.js               # Bill CRUD (x402-gated)
│       ├── agentPayments.js            # Payment execution
│       └── apiPanel.js                 # Internal control panel
└── src/                                # React frontend
    ├── components/
    │   ├── WorkerAgentChat.jsx         # LLM hiring chat + reasoning display
    │   ├── WorkerSchedules.jsx         # Worker schedule dashboard
    │   ├── AgentControlPanel.jsx       # x402 API demo panel
    │   ├── AgentMarketplace.jsx        # Agent services marketplace UI
    │   └── AgentLiveDemo.jsx           # Live system state demo
    └── hooks/
        ├── useWallet.js                # Wallet connect + session signing
        ├── useBills.js                 # On-chain bill management
        ├── usePaymentEngine.js         # Auto-pay polling loop
        └── usePaymentHistory.js        # On-chain history
```

---

## 🔄 What Makes This Different

| Feature                 | Traditional Autopay | Stellar Autopay                         |
| ----------------------- | ------------------- | --------------------------------------- |
| Schedule creation       | Fill a form         | **Talk to an AI**                       |
| API access model        | API key / OAuth     | **x402 micropayments**                  |
| Payment data storage    | Database            | **Soroban on-chain**                    |
| Worker rate computation | Manual calculation  | **Live XLM rate via agent marketplace** |
| Payment execution       | Manual trigger      | **Autonomous agent every 30s**          |
| Agent-to-agent payments | Not possible        | **x402 agent buys from agent**          |

---

## 📜 License

MIT

---

## 🙏 Acknowledgements

- [Stellar Development Foundation](https://stellar.org) — Soroban smart contract platform
- [x402 Protocol](https://x402.org) — HTTP-native micropayment standard
- [Google AI Studio](https://aistudio.google.com) — Gemini API
- [Creit Tech](https://github.com/Creit-Tech/Stellar-Wallets-Kit) — Stellar Wallets Kit
- [Stellar Expert](https://stellar.expert) — Testnet transaction explorer

# Stellar Autopay X402

> Automated recurring & one-time payment system built on the Stellar blockchain, powered by **AI agents** and the **x402 agentic payment protocol**.

---

## 🔗 Quick Links

|     |     |
| --- | --- |

| **Autopay Contract** | [`CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS`](https://stellar.expert/explorer/testnet/contract/CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS) |
| **Worker Schedule Contract** | [`CDRM3V5SVIZ3OWGZWDEUR6FQESPIVRB2VYPDIJ3XC4LS6BIBSRATPCFA`](https://stellar.expert/explorer/testnet/contract/CDRM3V5SVIZ3OWGZWDEUR6FQESPIVRB2VYPDIJ3XC4LS6BIBSRATPCFA) |
| **GitHub** | [https://github.com/murat48/Stellarautopayx402](https://github.com/murat48/stellarautopay) |
| **Network** | Stellar Testnet |
| **Telegram Bot** | [@StellarAutopay_Bot](https://t.me/StellarAutopay_Bot) |

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Smart Contract](#smart-contract)
4. [Tech Stack](#tech-stack)
5. [Getting Started](#getting-started)
6. [Usage Guide](#usage-guide)
7. [Security Model](#security-model)
8. [Project Structure](#project-structure)
9. [User Feedback & Onboarding](#user-feedback--onboarding)
10. [Improvement Plan](#improvement-plan)

---

## Overview

**Stellar Autopay X402** is a full-stack agentic payment platform on Stellar. It combines:

- A **React frontend** for manual bill management and AI-driven worker scheduling
- A **Node.js/Express backend** that acts as an autonomous payment agent — it holds a dedicated agent keypair, executes Soroban contract calls, and exposes REST APIs protected by the **x402 micropayment protocol**
- **Two Soroban smart contracts**: one for recurring bills, one for per-hour worker payment schedules
- **Gemini AI** that parses natural-language hiring requests and creates on-chain payment schedules
- **x402 paywall** — every API endpoint charges micro-USDC, settled on Stellar testnet in real time

All bill data, worker schedules, and payment histories live **on-chain** in Soroban contracts.

---

## ✨ Features

### 💳 Non-Custodial Wallet Connect

- Supports Freighter, xBull, Lobstr, Albedo via Stellar Wallets Kit
- Secret key never touches the application
- Live XLM and USDC balance display

### 📅 On-Chain Bill Management

- Create recurring (weekly / biweekly / monthly / monthly on specific day / quarterly) and one-time payments
- Supported assets: **XLM** and **USDC**
- Pause, resume, and delete bills at any time
- Default dashboard view shows unpaid bills sorted by due date (soonest first)
- All data stored in the Soroban contract — persists across sessions and devices

### ⚡ Auto-Pay Engine

- One-time wallet signature adds a **session signing key** to the account
- Payment engine polls every 15 seconds; executes any bill that is due
- Checks balance before each payment; skips if insufficient
- Records every attempt on-chain: tx hash, amount, date, status
- Without Auto-Pay: Freighter signs each payment manually (one popup per payment)

### 📊 On-Chain Payment History

- Every payment attempt (success / failed / skipped) stored in the contract
- Direct links to [Stellar Expert](https://stellar.expert/explorer/testnet) for each tx hash

### 🔔 Telegram Notifications

- Scan QR or message [@StellarAutopay_Bot](https://t.me/StellarAutopay_Bot), enter only your Chat ID
- Alerts: 24 hours before payment due, payment success, payment failure

### 📉 Dashboard Metrics

- Paid this month · Active bills · Due now · Next payment · Completed total

### ⚠️ Low Balance Warning

- Banner shown when XLM balance is below upcoming due payments

---

## 📜 Smart Contracts

### 1. Autopay Contract (Recurring Bills)

**Contract ID:** `CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS`  
**Source:** `contracts/autopay/src/lib.rs`  
**Explorer:** [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS)

### 2. Worker Schedule Contract (Per-Hour Payments)

**Contract ID:** `CDRM3V5SVIZ3OWGZWDEUR6FQESPIVRB2VYPDIJ3XC4LS6BIBSRATPCFA`  
**Source:** `contracts/worker-schedule/src/lib.rs`  
**Explorer:** [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CDRM3V5SVIZ3OWGZWDEUR6FQESPIVRB2VYPDIJ3XC4LS6BIBSRATPCFA)

Both contracts are written in **Rust · Soroban SDK v22**, deployed on **Stellar Testnet**.

### Autopay Contract Functions

| Function              | Description                                   | Auth Required |
| --------------------- | --------------------------------------------- | ------------- |
| `add_bill`            | Create a new payment schedule                 | Caller        |
| `pause_bill`          | Toggle pause / resume                         | Caller        |
| `delete_bill`         | Remove a bill permanently                     | Caller        |
| `complete_bill`       | Mark one-time bill as completed               | Caller        |
| `mark_paid`           | Mark bill as paid after on-chain transfer     | Caller        |
| `update_status`       | Update bill status                            | Caller        |
| `update_next_due`     | Advance next due date after recurring payment | Caller        |
| `get_all_bills`       | Fetch all bills for a wallet                  | None          |
| `get_bill`            | Fetch single bill                             | None          |
| `get_active_bills`    | Fetch only active / low-balance bills         | None          |
| `record_payment`      | Write a payment attempt to on-chain history   | Caller        |
| `get_payment_history` | Fetch all payment records for a wallet        | None          |

### Storage Layout

Per-user namespace — no global owner, no initialization required:

```
DataKey::Bill(Address, u64)        → Bill struct
DataKey::BillIds(Address)          → Vec<u64>
DataKey::NextId(Address)           → u64
DataKey::Payment(Address, u64)     → PaymentRecord struct
DataKey::PaymentIds(Address)       → Vec<u64>
DataKey::PaymentNextId(Address)    → u64
```

### Wallets That Have Used This Contract

Verified on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet):

| #   | Wallet Address                                             | Actions                                   |
| --- | ---------------------------------------------------------- | ----------------------------------------- |
| 1   | `GC4COEPJQRXZFTRZJYOYEIHVX6OCSZD5GMOAI6JGRDM3Y33VKBLODYUE` | add_bill, mark_paid, pause_bill           |
| 2   | `GCNA5EMJNXZPO57ARVJYQ5SN2DYYPD6ZCCENQ5AQTMVNKN77RDIPMI3A` | add_bill, record_payment, update_next_due |
| 3   | `GALDPLQ62RAX3V7RJE73D3C2F4SKHGCJ3MIYJ4MLU2EAIUXBDSUVS7SA` | add_bill, record_payment, mark_paid       |
| 4   | `GDBOBVGP6HNLL66IOTSR6COGSZYRTSRDXBUD2CDDN3C5XGUT23TQ54J2` | add_bill, record_payment, mark_paid       |
| 5   | `GAJXYRRBECPQVCOCCLBCCZ2KGGNEHL32TLJRT2JWLNVE4HJ35OAKAPH2` | add_bill, record_payment, mark_paid       |
| 6   | `GD72JZQAJPGLSLND6GPTSZ64PWMVY3JP5QKQJ32RW2GJCSVOSBPNX2EF` | add_bill, record_payment, mark_paid       |
| 7   | `GDQJJRU6LA6R5KT6AZA6P2H7NGOC4EQCMZALQBTPKXFJLVT32QXWFXYW` | Contract deployer                         |

### Build & Deploy

```bash
cd contracts/autopay

# Build WASM
stellar contract build

# Run tests
cargo test

# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32v1-none/release/autopay_contract.wasm \
  --source <YOUR_STELLAR_CLI_ALIAS> \
  --network testnet
```

---

## 🛠 Tech Stack

| Layer              | Technology                                     |
| ------------------ | ---------------------------------------------- |
| Frontend           | React 19 + Vite 8                              |
| Backend / Agent    | Node.js 22 + Express (server/)                 |
| Blockchain SDK     | `@stellar/stellar-sdk` v15                     |
| Wallet Integration | `@creit.tech/stellar-wallets-kit` v2           |
| Smart Contracts    | Rust + Soroban SDK v22 (2 contracts)           |
| AI Agent           | Google Gemini (`gemini-2.5-flash-lite`)        |
| Agentic Payments   | x402 protocol (`@x402/express`, `@x402/fetch`) |
| Network            | Stellar Testnet (Horizon + Soroban RPC)        |
| Notifications      | Telegram Bot API                               |
| Hosting            | Vercel (frontend) + local/VPS (backend agent)  |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- [Freighter Wallet](https://freighter.app/) browser extension
- A funded Stellar **testnet** account → [Friendbot](https://friendbot.stellar.org/?addr=YOUR_KEY)

### Local Setup

```bash
git clone https://github.com/murat48/stellarautopay.git
cd stellarautopay
npm install
npm run dev          # frontend → http://localhost:5173
```

Start the backend agent server separately:

```bash
cd server
npm install
node index.js        # backend → http://localhost:3001
```

### Environment Variables

Create `server/.env`:

```
AGENT_SECRET_KEY=S...          # Stellar secret key for the agent wallet
CONTRACT_ID=CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS
WORKER_SCHEDULE_CONTRACT_ID=CDRM3V5SVIZ3OWGZWDEUR6FQESPIVRB2VYPDIJ3XC4LS6BIBSRATPCFA
RESOURCE_WALLET_ADDRESS=G...   # Wallet to receive x402 micropayments
GEMINI_API_KEY=...             # Google AI Studio API key
GEMINI_MODEL=gemini-2.5-flash-lite
TELEGRAM_BOT_TOKEN=...         # Optional: Telegram notifications
```

Create root `.env` for the frontend (optional):

```
VITE_SERVER_URL=http://localhost:3001
```

### Production Build

```bash
npm run build        # outputs to dist/
vercel deploy --prod # or push to GitHub for auto-deploy
```

---

## 📖 Usage Guide

1. **Connect Wallet** — Click Connect Wallet, choose Freighter (recommended for testnet), approve.
2. **Add a Payment** — Click `+ Add Payment`, fill in recipient address, amount (XLM or USDC), frequency, and scheduled date.
3. **Enable Auto-Pay** — Click ⚡ Enable Auto-Pay → sign one `setOptions` tx → all future payments are automatic.
4. **Monitor** — Dashboard shows unpaid bills sorted by due date. Metrics strip shows key numbers.
5. **Telegram Alerts** — Click 📨 Telegram, scan QR or search @StellarAutopay_Bot, paste your Chat ID, Test, Save.
6. **Disable Auto-Pay** — Click ⚡ Auto-Pay ON → Disable → removes session signer from your account.

---

## 🔒 Security Model

| Risk                  | Mitigation                                                          |
| --------------------- | ------------------------------------------------------------------- |
| Secret key exposure   | Never entered; wallet extensions hold all keys                      |
| Auto-pay abuse        | Session key has weight=1; removed immediately on disable/disconnect |
| Session key leakage   | Lives only in React `useRef` (RAM) — never written to localStorage  |
| Double payments       | In-memory `paidBillsRef` + localStorage paid-keys guard             |
| Contract manipulation | `caller.require_auth()` on every write function                     |

---

## 📁 Project Structure

```
stellarautopay/
├── contracts/
│   ├── autopay/src/lib.rs             # Soroban: recurring bill contract (Rust)
│   └── worker-schedule/src/lib.rs     # Soroban: per-hour worker payment contract (Rust)
├── server/                            # Node.js autonomous payment agent
│   ├── index.js                       # Express server entry point
│   ├── config.js                      # Env-based config
│   ├── services/
│   │   ├── sorobanService.js          # All Soroban contract interactions
│   │   ├── reminderJob.js             # Background auto-pay engine (30s interval)
│   │   ├── telegramService.js         # Telegram notifications
│   │   └── paymentLinkService.js      # Payment link generation
│   ├── middleware/
│   │   └── x402Paywall.js             # x402 per-endpoint USDC micropayments
│   └── routes/
│       ├── agentBills.js              # Bill CRUD (x402-gated)
│       ├── agentPayments.js           # Payment execution endpoints
│       ├── workerSchedules.js         # Worker schedule CRUD (on-chain)
│       ├── agentWorkerReason.js       # AI → on-chain schedule (Gemini + x402)
│       ├── agentServices.js           # Agent services marketplace (x402)
│       └── apiPanel.js                # Internal control panel API
├── src/                               # React frontend
│   ├── components/
│   │   ├── WorkerAgentChat.jsx        # AI hiring chat UI
│   │   ├── WorkerSchedules.jsx        # Worker schedule dashboard
│   │   ├── AgentControlPanel.jsx      # Bill management panel
│   │   ├── AgentLiveDemo.jsx          # Live demo panel
│   │   └── ...                        # Other UI components
│   └── hooks/                         # Wallet, bills, payment hooks
├── vercel.json
└── package.json
```

---

## 💬 User Feedback & Onboarding

### Google Form

Users submit feedback via the **💬 Feedback** button in the app or directly:

**→ [Open Feedback Form](https://docs.google.com/forms/d/e/1FAIpQLSfp4qWFnQUWYiruEyvELlv1RJkK7_Q7UtrEXu4Ze-QmYMtb8A/viewform)**

Fields collected:

- Full Name
- Email Address
- Stellar Testnet Wallet Address
- Product Rating (1–5 stars)
- Comments / Suggestions

### Exported Responses (Excel)

All form responses exported to Google Sheets:

**→ [View Feedback Responses & Analytics](https://docs.google.com/forms/d/e/1FAIpQLSfp4qWFnQUWYiruEyvELlv1RJkK7_Q7UtrEXu4Ze-QmYMtb8A/viewanalytics)**

To download as Excel: open in Google Sheets → **File → Download → Microsoft Excel (.xlsx)**

---

## 🔄 Improvement Plan

### Iteration 1 — Completed (based on early tester feedback)

| #   | Problem Reported                                               | Fix Applied                                                                          | Commit                                                              |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1   | `mark_paid` and `record_payment` not firing in manual mode     | Added `externalSignFn` parameter so contract writes work without auto-pay            | [55d36b7](https://github.com/murat48/stellarautopay/commit/55d36b7) |
| 2   | Auto-pay failing with HTTP 400 error                           | Improved error extraction from Horizon `result_codes`; added readable error messages | [fff4287](https://github.com/murat48/stellarautopay/commit/fff4287) |
| 3   | `op_too_many_signers` when enabling auto-pay                   | Orphaned session keys are now removed atomically in the same transaction             | [65e5c14](https://github.com/murat48/stellarautopay/commit/65e5c14) |
| 4   | Fees too high (1M stroops per contract call)                   | Reduced Soroban fee to 300K, classic tx fee to 1K stroops                            | [bc024a9](https://github.com/murat48/stellarautopay/commit/bc024a9) |
| 5   | Multiple Freighter popups for a single payment                 | Eliminated repeated popups in manual mode — one popup per payment                    | [bc024a9](https://github.com/murat48/stellarautopay/commit/bc024a9) |
| 6   | Telegram test button silently did nothing before saving        | `testConnection` now bypasses `enabled` check, sends directly with provided Chat ID  | [9d872e9](https://github.com/murat48/stellarautopay/commit/9d872e9) |
| 7   | Dashboard showed all bills by default, hard to find unpaid     | Default filter changed to "Unpaid", sorted soonest-due first                         | [414a760](https://github.com/murat48/stellarautopay/commit/414a760) |
| 8   | Completed count showed 0 despite paid bills existing           | Fixed metrics to count both `completed` and `paid` statuses                          | [31f2e21](https://github.com/murat48/stellarautopay/commit/31f2e21) |
| 9   | Telegram instructions in Turkish, hard for international users | Full English UI + QR code for @StellarAutopay_Bot added                              | [31f2e21](https://github.com/murat48/stellarautopay/commit/31f2e21) |
| 10  | Old contract had stale data from development                   | Redeployed fresh contract to testnet                                                 | [414a760](https://github.com/murat48/stellarautopay/commit/414a760) |

### Next Phase — Planned Improvements

Based on ongoing user feedback patterns:

1. **Mainnet support** — Add a testnet / mainnet toggle with appropriate risk warnings
2. **Offline notifications via Service Worker** — Send alerts even when the browser tab is closed
3. **Bill categories & tags** — Tag bills (rent, utilities, subscriptions) and filter by category
4. **CSV / Excel payment history export** — Let users download on-chain history for accounting
5. **Mobile layout** — Optimize for mobile browsers; Freighter mobile support

---

## 📄 License

MIT License

---

## 🙏 Acknowledgements

- [Stellar Development Foundation](https://stellar.org) — Horizon API & Soroban smart contracts
- [Creit Tech](https://github.com/Creit-Tech/Stellar-Wallets-Kit) — Stellar Wallets Kit
- [Stellar Expert](https://stellar.expert) — Testnet transaction explorer
