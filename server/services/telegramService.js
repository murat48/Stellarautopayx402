/**
 * Telegram notification service.
 *
 * - Persistent store: billId → chatId saved to chat-ids.json
 * - Sends messages via Telegram Bot API using TELEGRAM_BOT_TOKEN from .env
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dir, '..', 'chat-ids.json');

// Load from disk on startup
function loadStore() {
  try {
    if (existsSync(STORE_PATH)) {
      return new Map(Object.entries(JSON.parse(readFileSync(STORE_PATH, 'utf8'))));
    }
  } catch { /* ignore */ }
  return new Map();
}

function saveStore(map) {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(Object.fromEntries(map)), 'utf8');
  } catch (err) {
    console.error('❌ Failed to save chat-ids.json:', err.message);
  }
}

// billId (string) → Telegram chatId (string)
// Special key "__default__" stores the global fallback chatId.
const billChatStore = loadStore();

export function storeChatId(billId, chatId) {
  if (chatId && String(chatId).trim()) {
    billChatStore.set(String(billId), String(chatId).trim());
    saveStore(billChatStore);
  }
}

export function getChatId(billId) {
  return billChatStore.get(String(billId)) || null;
}

/** Get the global/default Telegram chatId (used when a bill has no specific chatId). */
export function getDefaultChatId() {
  return billChatStore.get('__default__') || null;
}

/** Set the global/default Telegram chatId. Called when user saves Telegram settings. */
export function setDefaultChatId(chatId) {
  if (chatId && String(chatId).trim()) {
    billChatStore.set('__default__', String(chatId).trim());
    saveStore(billChatStore);
    console.log(`📨 Default Telegram chatId updated: ${chatId}`);
  }
}

/**
 * Send a raw Telegram message to a chatId.
 * Returns null and logs warning if bot token is not configured.
 */
export async function sendMessage(chatId, text) {
  const token = config.telegramBotToken;
  if (!token) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN not set — skipping Telegram notification');
    return null;
  }
  try {
    const payload = { 
      chat_id: chatId, 
      text, 
      parse_mode: 'HTML'
    };
    console.log(`📤 Sending Telegram message to ${chatId}:`);
    console.log(`    Full text: ${text}`);
    
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('❌ Telegram send failed:', data.description || `HTTP ${res.status}`);
      return null;
    }
    return res.json();
  } catch (err) {
    console.error('❌ Telegram error:', err.message);
    return null;
  }
}

/**
 * After a successful API-triggered payment, notify the bill owner.
 */
export async function sendPaymentConfirmation(chatId, bill, txHash) {
  const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${txHash}`;
  const text =
    `✅ <b>Your Payment Successful</b>\n\n` +
    `<b>Invoice:</b> ${bill.name}\n` +
    `<b>Amount:</b> ${bill.amount} ${bill.asset}\n` +
    `💳 <b>Recipient:</b> <code>${bill.recipientAddress.slice(0, 8)}...${bill.recipientAddress.slice(-4)}</code>\n\n` +
    `🔗 ${explorerUrl}`;
  return sendMessage(chatId, text);
}

/**
 * Payment reminder — API consumer calls this to notify the bill owner.
 * Includes a payment link so the user can pay directly.
 */
export async function sendPaymentReminder(chatId, bill, paymentUrl) {
  const overdueDays = bill.nextDueDate
    ? Math.ceil((Date.now() - new Date(bill.nextDueDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const text =
    `⚠️ <b>Payment Reminder</b>\n\n` +
    `<b>Invoice:</b> ${bill.name}\n` +
    `<b>Amount:</b> ${bill.amount} ${bill.asset}\n` +
    `💳 <b>Recipient:</b> <code>${bill.recipientAddress.slice(0, 8)}...${bill.recipientAddress.slice(-4)}</code>\n` +
    (overdueDays > 0 ? `<b>Overdue:</b> ${overdueDays} days\n` : '') +
    `\n<b>Please pay before late fees apply:</b>\n\n` +
    `💰 ${paymentUrl}`;
  return sendMessage(chatId, text);
}
