# Stellar Autopay — x402 Agent API Implementation Prompt

> Bu dosyayı GitHub Copilot'a (Agent mode) vererek projeye x402-Gated "Payment-as-a-Service" Agent API katmanını ekletin.

---

## PROMPT — Kopyala ve GitHub Copilot Agent'a yapıştır:

---

### Görev

Mevcut **Stellar Autopay** projesine bir **x402-Gated Agent API backend** katmanı ekle. Bu katman, AI agentların ve harici servislerin HTTP üzerinden fatura oluşturma, ödeme tetikleme ve ödeme geçmişi sorgulama işlemlerini yapabilmesini sağlayacak. Her API çağrısı **x402 protokolü** ile USDC mikro-ödeme gerektirecek.

---

### Mevcut Proje Yapısı

```
stellarautopayv2/
├── contracts/autopay/src/lib.rs          # Soroban smart contract (Rust, değiştirilmeyecek)
├── src/
│   ├── utils/
│   │   ├── stellar.js                    # Horizon payment builder / signer
│   │   └── contractClient.js             # Direct Soroban RPC client (queryContract, invokeContract, helpers)
│   ├── hooks/                            # React hooks (useWallet, useBills, usePaymentEngine, etc.)
│   ├── components/                       # React components (WalletConnect, BillDashboard, etc.)
│   ├── App.jsx / App.css
│   └── main.jsx
├── vercel.json
└── package.json
```

**Proje Detayları:**
- **Contract ID:** `CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS`
- **Network:** Stellar Testnet
- **Mevcut SDK:** `@stellar/stellar-sdk` v15
- **RPC URL:** `https://soroban-testnet.stellar.org`
- **Horizon URL:** `https://horizon-testnet.stellar.org`
- **USDC Issuer:** `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
- **Frontend:** React 19 + Vite 8 (değiştirilmeyecek)

**Kontrat Fonksiyonları (Rust, değiştirilmeyecek):**
- `add_bill(caller, name, recipient, amount, asset, bill_type, frequency, day_of_month, next_due) → Bill`
- `get_all_bills(caller) → Vec<Bill>`
- `get_bill(caller, bill_id) → Bill`
- `get_active_bills(caller) → Vec<Bill>`
- `pause_bill(caller, bill_id)`
- `delete_bill(caller, bill_id)`
- `mark_paid(caller, bill_id)`
- `complete_bill(caller, bill_id)`
- `update_status(caller, bill_id, status)`
- `update_next_due(caller, bill_id, new_next_due)`
- `record_payment(caller, bill_id, bill_name, recipient, amount, asset, tx_hash, status, error_msg)`
- `get_payment_history(caller) → Vec<PaymentRecord>`

**`contractClient.js` içindeki mevcut yardımcı fonksiyonlar** (bunları backend'den de kullanabilirsin):
- `getAllBills(publicKey)` — tüm faturaları oku (read-only)
- `addBill(publicKey, signFn, bill)` — fatura ekle
- `pauseBill(publicKey, signFn, contractBillId)` — duraklat/devam
- `deleteBill(publicKey, signFn, contractBillId)` — sil
- `updateStatus(publicKey, signFn, contractBillId, status)` — durum güncelle
- `updateNextDue(publicKey, signFn, contractBillId, nextDueIso)` — sonraki vade güncelle
- `completeBill(publicKey, signFn, contractBillId)` — tamamla
- `markPaid(publicKey, signFn, contractBillId)` — ödendi işaretle
- `recordPayment(publicKey, signFn, entry)` — ödeme kaydı yaz
- `getPaymentHistory(publicKey)` — ödeme geçmişi oku
- `makeSessionSignFn(keypair)` — session key ile imza fonksiyonu oluştur
- `makeWalletSignFn(walletKitSign, publicKey)` — wallet ile imza fonksiyonu oluştur
- `contractBillToFrontend(bill)` — kontrat verisini frontend formatına çevir
- `frontendToContractParams(bill)` — frontend verisini kontrat formatına çevir

---

### Oluşturulacak Dosyalar ve Yapı

```
stellarautopayv2/
├── server/                               # YENİ — Express.js x402 backend
│   ├── package.json
│   ├── index.js                          # Express server entry point
│   ├── middleware/
│   │   └── x402Paywall.js                # x402 paywall middleware
│   ├── routes/
│   │   ├── agentBills.js                 # /agent/bills endpoints
│   │   ├── agentPayments.js              # /agent/pay, /agent/history endpoints
│   │   └── agentHealth.js                # /agent/health (free, no x402)
│   ├── services/
│   │   └── sorobanService.js             # Soroban contract interaction (Node.js uyumlu)
│   ├── config.js                         # Environment config
│   └── .env.example                      # Gerekli env değişkenleri
├── agent-client/                         # YENİ — Demo agent client
│   ├── package.json
│   ├── demoAgent.js                      # x402 ile API çağrısı yapan demo agent
│   └── README.md                         # Agent kullanım kılavuzu
```

---

### 1. `server/package.json`

```json
{
  "name": "stellar-autopay-agent-api",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "@stellar/stellar-sdk": "^15.0.1",
    "x402-stellar": "latest"
  }
}
```

---

### 2. `server/config.js`

Environment değişkenleri:
- `PORT` — API port (default 3001)
- `AGENT_SECRET_KEY` — Agent servis cüzdanının secret key'i (fatura kontrat çağrıları için imza)
- `RESOURCE_WALLET_ADDRESS` — x402 ödemelerinin gideceği cüzdan adresi (servis geliri)
- `FACILITATOR_URL` — x402 facilitator URL (testnet: `https://x402.org/facilitator` veya Stellar'ın kendi facilitator'ı)
- `CONTRACT_ID` — `CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS`
- `NETWORK` — `testnet`
- `RPC_URL` — `https://soroban-testnet.stellar.org`
- `HORIZON_URL` — `https://horizon-testnet.stellar.org`

---

### 3. `server/middleware/x402Paywall.js`

x402 paywall middleware implementasyonu:

- `x402-stellar` npm paketinden `paymentMiddleware` veya `verifyPayment` kullan.
- Her korunan endpoint için USDC mikro-ödeme fiyatı belirle.
- x402 protokol akışı:
  1. Client bir endpoint'e istek atar
  2. Ödeme yoksa HTTP `402 Payment Required` döner, response header'da ödeme detayları (amount, recipient, facilitator URL)
  3. Client x402 ödeme imzasını oluşturur ve `X-PAYMENT` veya `X-PAYMENT-RESPONSE` header'ı ile tekrar istek atar
  4. Middleware facilitator'dan ödemeyi doğrular/settle eder
  5. Başarılıysa isteği route handler'a iletir
- Referans: https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide
- Referans repo: https://github.com/stellar/x402-stellar

**Fiyatlandırma:**
| Endpoint | Fiyat (USDC) |
|---|---|
| `POST /agent/bills` | 0.01 |
| `GET /agent/bills` | 0.001 |
| `GET /agent/bills/:id` | 0.001 |
| `POST /agent/pay/:id` | 0.005 |
| `GET /agent/history` | 0.001 |
| `GET /agent/balance` | 0.001 |
| `POST /agent/bills/:id/pause` | 0.005 |
| `DELETE /agent/bills/:id` | 0.005 |

---

### 4. `server/services/sorobanService.js`

`src/utils/contractClient.js` dosyasındaki mantığı Node.js backend ortamına uyarla:

- Browser-specific kodları kaldır
- `@stellar/stellar-sdk` v15 kullan (zaten projede var)
- Aynı `CONTRACT_ID`, `RPC_URL`, `NETWORK_PASSPHRASE` kullan
- Agent'ın kendi Keypair'i ile imza yapılacak (env'deki `AGENT_SECRET_KEY`)
- Keypair, `Keypair.fromSecret(process.env.AGENT_SECRET_KEY)` ile oluşturulacak

**Fonksiyonlar:**
```javascript
// Read-only (imza gerektirmez)
getAllBills(walletAddress)
getBill(walletAddress, billId)
getActiveBills(walletAddress)
getPaymentHistory(walletAddress)

// Write (agent keypair ile imzalanır — agent cüzdanı adına fatura yönetimi)
addBillForAgent(agentPublicKey, billData)
pauseBillForAgent(agentPublicKey, billId)
deleteBillForAgent(agentPublicKey, billId)
markPaidForAgent(agentPublicKey, billId)
recordPaymentForAgent(agentPublicKey, paymentEntry)
```

**NOT:** Agent cüzdanı kendi namespace'inde (kendi adresi altında) fatura oluşturur. Kontrat per-user namespace kullanıyor, bu güvenli çünkü her agent kendi cüzdanı altında işlem yapar.

---

### 5. `server/routes/agentBills.js`

```
POST   /agent/bills              → Yeni fatura oluştur (x402: 0.01 USDC)
GET    /agent/bills              → Tüm faturaları listele (x402: 0.001 USDC)
GET    /agent/bills/:id          → Tek fatura detayı (x402: 0.001 USDC)
POST   /agent/bills/:id/pause    → Duraklat/devam (x402: 0.005 USDC)
DELETE /agent/bills/:id          → Fatura sil (x402: 0.005 USDC)
```

**POST /agent/bills** request body:
```json
{
  "name": "Monthly server hosting",
  "recipientAddress": "GABC...XYZ",
  "amount": "50",
  "asset": "USDC",
  "type": "recurring",
  "frequency": "monthly",
  "dayOfMonth": 15,
  "nextDueDate": "2026-05-15T00:00:00Z"
}
```

**Response formatı:**
```json
{
  "success": true,
  "bill": {
    "id": "1",
    "name": "Monthly server hosting",
    "recipientAddress": "GABC...XYZ",
    "amount": "50",
    "asset": "USDC",
    "type": "recurring",
    "frequency": "monthly",
    "dayOfMonth": 15,
    "nextDueDate": "2026-05-15T00:00:00Z",
    "status": "active",
    "createdAt": "2026-04-11T..."
  }
}
```

---

### 6. `server/routes/agentPayments.js`

```
POST   /agent/pay/:id            → Fatura ödemesini tetikle (x402: 0.005 USDC)
GET    /agent/history             → Ödeme geçmişi (x402: 0.001 USDC)
GET    /agent/balance             → Cüzdan bakiyesi (x402: 0.001 USDC)
```

**POST /agent/pay/:id** → Agent'ın session keypair'i ile ödeme gönderir (Horizon üzerinden `Operation.payment`), sonra kontrata `record_payment` ve `mark_paid`/`update_next_due` yazar.

**GET /agent/balance** → Agent cüzdanının XLM ve USDC bakiyesini döner.

---

### 7. `server/routes/agentHealth.js`

```
GET    /agent/health              → Ücretsiz health check (x402 yok)
```

Response: `{ "status": "ok", "network": "testnet", "contractId": "CCGU...", "endpoints": [...] }`

Mevcut endpoint listesini ve fiyatlarını dönsün, böylece agentlar keşfedebilsin.

---

### 8. `server/index.js`

- Express app oluştur
- CORS middleware ekle (tüm originler)
- JSON body parser
- Route'ları mount et: `/agent/*`
- Hata yakalama middleware'i
- `PORT` env değişkeni veya 3001'de başla
- Başlangıçta agent keypair'in yüklü olduğunu doğrula

---

### 9. `agent-client/demoAgent.js`

x402 protokolü ile API çağrısı yapan örnek bir agent scripti:

```javascript
// Akış:
// 1. Agent /agent/health çağırır (ücretsiz) — endpoint ve fiyat bilgisi alır
// 2. Agent POST /agent/bills çağırır → 402 alır
// 3. x402 client SDK ile ödeme imzası oluşturur
// 4. İsteği X-PAYMENT header'ı ile tekrar atar
// 5. Fatura oluşturulur, response alır
// 6. GET /agent/bills ile faturaları listeler (aynı x402 akışı)
```

- `x402-stellar` veya `@stellar/stellar-sdk` kullanarak x402 client flow implementasyonu
- Agent'ın kendi cüzdanı ve secret key'i gerekli (env'den okunacak)
- Referans: https://github.com/stellar/x402-stellar (client örnekleri)

---

### 10. Güvenlik Gereksinimleri

- **AGENT_SECRET_KEY** sadece `.env`'de olacak, asla koda gömülmeyecek
- Input validasyonu: `recipientAddress` valid Stellar adresi mi kontrol et (`StrKey.isValidEd25519PublicKey`)
- `amount` pozitif sayı mı kontrol et
- `asset` sadece `"XLM"` veya `"USDC"` kabul et
- Rate limiting (basit in-memory): IP başına dakikada max 30 istek
- CORS ayarları
- Tüm hata mesajları kullanıcıya güvenli bilgi dönsün (secret key, stack trace sızmasın)

---

### 11. `.env.example`

```env
# Server
PORT=3001

# Agent wallet (Stellar testnet)
AGENT_SECRET_KEY=S...your_agent_secret_key
RESOURCE_WALLET_ADDRESS=G...your_resource_wallet_address

# x402 Facilitator
FACILITATOR_URL=https://x402.org/facilitator

# Stellar Network
CONTRACT_ID=CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS
NETWORK=testnet
RPC_URL=https://soroban-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org
```

---

### Teknik Kurallar

1. **Mevcut frontend (src/) ve kontrat (contracts/) dosyalarına DOKUNMA** — sadece `server/` ve `agent-client/` klasörlerini oluştur.
2. `"type": "module"` kullan — tüm dosyalar ESM import/export olacak.
3. `@stellar/stellar-sdk` v15 API'sini kullan (v14 değil). Import: `import { Keypair, Networks, ... } from '@stellar/stellar-sdk';`
4. Soroban RPC client: `import { rpc } from '@stellar/stellar-sdk';` → `new rpc.Server(RPC_URL)`
5. Horizon client: `import { Horizon } from '@stellar/stellar-sdk';` → `new Horizon.Server(HORIZON_URL)`
6. x402 implementasyonu için `x402-stellar` npm paketini kullan. Eğer API'si uygun değilse, x402 protokolünü manuel implemente et (402 response + header parsing + facilitator verify/settle).
7. Her endpoint'te try-catch ile hata yakalama, uygun HTTP status code döndürme.
8. Console.log ile anlamlı log mesajları (emoji prefix: ✅ başarı, ❌ hata, 💰 ödeme, 🔒 auth).

---

### Beklenen Çıktı

Yukarıdaki dosya yapısını oluştur, her dosyanın tam kodunu yaz. Sonrasında:

1. `cd server && npm install` ile bağımlılıkları yükle
2. `.env` dosyasını `.env.example`'dan kopyalayıp agent secret key'i ekle
3. `npm run dev` ile sunucuyu başlat
4. Demo agent ile test et: `cd agent-client && node demoAgent.js`

Tüm dosyaların çalışır, hatasız olmasını sağla. x402 akışını uçtan uca çalışır hale getir.

---

### Referans Kaynaklar

- x402 Stellar Quickstart: https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide
- x402 Stellar Repo (server + client örnekleri): https://github.com/stellar/x402-stellar
- x402 Protocol: https://www.x402.org/
- Coinbase x402 Docs: https://docs.cdp.coinbase.com/x402/docs/welcome
- x402 Facilitator Supported Networks: https://www.x402.org/facilitator/supported
- Demo MCP Server: https://github.com/jamesbachini/x402-mcp-stellar
- Stellar Observatory (x402 örneği): https://github.com/elliotfriend/stellar-observatory
- x402 npm: https://www.npmjs.com/package/x402-stellar
