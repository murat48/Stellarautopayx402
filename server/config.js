import dotenv from 'dotenv';
dotenv.config();

const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  agentSecretKey: process.env.AGENT_SECRET_KEY,
  clientSecretKey: process.env.CLIENT_SECRET_KEY,
  resourceWalletAddress: process.env.RESOURCE_WALLET_ADDRESS,
  facilitatorUrl: process.env.FACILITATOR_URL || 'https://x402.org/facilitator',
  contractId: process.env.CONTRACT_ID || 'CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS',
  workerScheduleContractId: process.env.WORKER_SCHEDULE_CONTRACT_ID || 'CDRM3V5SVIZ3OWGZWDEUR6FQESPIVRB2VYPDIJ3XC4LS6BIBSRATPCFA',
  network: process.env.NETWORK || 'testnet',
  rpcUrl: process.env.RPC_URL || 'https://soroban-testnet.stellar.org',
  horizonUrl: process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  paymentLinkSecret: process.env.PAYMENT_LINK_SECRET || 'stellar-autopay-secret-change-me',
  paymentLinkBaseUrl: process.env.PAYMENT_LINK_BASE_URL || 'http://localhost:3001',
  // Service fees
  feeWalletAddress: process.env.FEE_WALLET_ADDRESS || '',
  agentPaymentFee:  process.env.AGENT_PAYMENT_FEE  || '0.49',  // XLM charged per auto-pay
  // Gemini AI
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel:  process.env.GEMINI_MODEL  || 'gemini-2.5-flash-lite-preview-06-17',
};

export default config;
