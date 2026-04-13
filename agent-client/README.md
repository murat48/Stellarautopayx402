# Stellar Autopay — Agent Client

Demo agent client that interacts with the Stellar Autopay Agent API using the x402 protocol for micropayments.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file:

```bash
cp .env.example .env
```

3. Add your agent's Stellar testnet secret key to `.env`:

```env
AGENT_SECRET_KEY=S...your_secret_key
SERVER_URL=http://localhost:3001
```

### Getting a Testnet Wallet

1. Create a new keypair: https://lab.stellar.org/account/create
2. Fund with testnet XLM: https://lab.stellar.org/account/fund
3. Create USDC trustline (button on the fund page), sign and submit
4. Get testnet USDC from Circle faucet: https://faucet.circle.com (select Stellar Testnet)

## Usage

Make sure the server is running first:

```bash
cd ../server
npm install
cp .env.example .env
# Edit .env with your keys
npm run dev
```

Then run the demo agent:

```bash
npm run demo
```

## x402 Flow

1. Agent calls `/agent/health` (free) — discovers endpoints and prices
2. Agent calls a paid endpoint (e.g., `POST /agent/bills`)
3. Server responds with `402 Payment Required` + payment requirements in headers
4. Agent creates a signed x402 payment payload (USDC on Stellar)
5. Agent retries with `X-PAYMENT` header containing the signed payload
6. Server's x402 middleware verifies payment via facilitator
7. If valid, the request proceeds to the route handler

## Endpoints

| Endpoint                 | Method | Price (USDC) | Description                      |
| ------------------------ | ------ | ------------ | -------------------------------- |
| `/agent/health`          | GET    | Free         | Health check, endpoint discovery |
| `/agent/bills`           | POST   | $0.01        | Create a new bill                |
| `/agent/bills`           | GET    | $0.001       | List all bills                   |
| `/agent/bills/:id`       | GET    | $0.001       | Get bill details                 |
| `/agent/bills/:id/pause` | POST   | $0.005       | Pause/resume a bill              |
| `/agent/bills/:id`       | DELETE | $0.005       | Delete a bill                    |
| `/agent/pay/:id`         | POST   | $0.005       | Trigger payment                  |
| `/agent/history`         | GET    | $0.001       | Payment history                  |
| `/agent/balance`         | GET    | $0.001       | Wallet balance                   |
