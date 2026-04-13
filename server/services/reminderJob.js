/**
 * Background auto-pay + reminder job.
 *
 * Every CHECK_INTERVAL ms:
 *   1. Load all bills from the agent's Soroban contract
 *   2. For overdue active bills:
 *      a. Pay them directly using the agent keypair (no user interaction)
 *      b. Mark bill as paid in contract
 *      c. Record payment history
 *      d. Send Telegram payment confirmation
 *   3. Bills that fail payment get a Telegram reminder instead
 *
 * Throttle: each billId is only processed once per COOLDOWN window to avoid
 * double-payment on rapid restarts.
 */
import {
  getAllBills, getAgentPublicKey,
  sendPayment, markPaidForAgent, recordPaymentForAgent,
  updateNextDueForAgent, updateStatusForAgent,
  getAllWorkerSchedules, getPendingWorkerPayments, setWorkerPaymentStatus,
} from './sorobanService.js';
import { getChatId, getDefaultChatId, sendPaymentConfirmation, sendMessage } from './telegramService.js';
import { buildPaymentUrl } from './paymentLinkService.js';
import config from '../config.js';

// ─── Month-aware next due date calculation ─────────────────────────────────
function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
function calculateNextDueDate(currentDueIso, frequency, dayOfMonth = 0) {
  const current = new Date(currentDueIso);
  if (frequency === 'weekly')   { current.setDate(current.getDate() + 7);  return current.toISOString(); }
  if (frequency === 'biweekly') { current.setDate(current.getDate() + 14); return current.toISOString(); }
  if (frequency === 'quarterly') { current.setMonth(current.getMonth() + 3); return current.toISOString(); }
  if (frequency === 'monthly' || frequency === 'monthly_day') {
    if (frequency === 'monthly_day' && dayOfMonth > 0) {
      let nextYear = current.getFullYear();
      let nextMonth = current.getMonth() + 1;
      if (nextMonth > 11) { nextMonth = 0; nextYear++; }
      const day = Math.min(dayOfMonth, daysInMonth(nextYear, nextMonth));
      return new Date(nextYear, nextMonth, day, current.getHours(), current.getMinutes(), current.getSeconds()).toISOString();
    }
    current.setMonth(current.getMonth() + 1);
    return current.toISOString();
  }
  return current.toISOString();
}

// ─── Live XLM price from CoinGecko (free, no API key) ────────────────────────
let _priceCache = { price: null, fetchedAt: 0 };
async function getLiveXlmPrice() {
  // Cache for 60 seconds to avoid hammering CoinGecko on rapid retries
  if (_priceCache.price && Date.now() - _priceCache.fetchedAt < 60_000) {
    return _priceCache.price;
  }
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data = await res.json();
      const price = data?.stellar?.usd;
      if (typeof price === 'number' && price > 0) {
        _priceCache = { price, fetchedAt: Date.now() };
        return price;
      }
    }
  } catch (e) {
    console.warn('⚠️  CoinGecko price fetch failed:', e.message);
  }
  return _priceCache.price ?? null; // return stale cache or null
}

const CHECK_INTERVAL  = 30 * 1000;        // every 30 seconds
const PAY_COOLDOWN    = 60 * 60 * 1000;  // retry failed payment at most once/hour per bill

// billId → timestamp of last payment attempt (success or fail)
const lastAttempted = new Map();

async function runCheck() {
  // Process worker schedule payments (server-side, no contract needed)
  await runWorkerScheduleCheck().catch(err =>
    console.error('⏰ Worker schedule check failed:', err.message)
  );

  let bills;
  try {
    const agentKey = getAgentPublicKey();
    bills = await getAllBills(agentKey);
  } catch (err) {
    console.error('⏰ Auto-pay: failed to fetch bills:', err.message);
    return;
  }

  const now = Date.now();
  const agentKey = getAgentPublicKey();

  // ── Auto-recovery: fix recurring bills stuck in 'paid' state ──────────────
  // If a previous run paid the bill but crashed before updating nextDue/status,
  // the bill remains 'paid' forever. Detect and heal automatically.
  for (const bill of bills) {
    if (bill.type === 'one-time') continue;
    if (bill.status !== 'paid') continue;
    // nextDueDate is the date that was paid; advance it one period into the future
    const nextDueDate = calculateNextDueDate(bill.nextDueDate, bill.frequency, bill.dayOfMonth ?? 0);
    console.log(`🔧 Auto-recovery: rescheduling stuck recurring bill "${bill.name}" → ${nextDueDate}`);
    try {
      await updateNextDueForAgent(agentKey, bill.contractId, nextDueDate);
    } catch (e) {
      console.error(`❌ Auto-recovery updateNextDue failed for "${bill.name}":`, e.message);
    }
    try {
      await updateStatusForAgent(agentKey, bill.contractId, 'active');
    } catch (e) {
      console.error(`❌ Auto-recovery updateStatus failed for "${bill.name}":`, e.message);
    }
  }

  for (const bill of bills) {
    if (bill.status === 'paid' || bill.status === 'completed' || bill.status === 'paused') continue;

    const due = new Date(bill.nextDueDate).getTime();
    if (due > now) continue; // not yet due

    const billId = String(bill.id);
    const lastTs = lastAttempted.get(billId) || 0;
    if (now - lastTs < PAY_COOLDOWN) continue; // already attempted recently

    lastAttempted.set(billId, now);
    console.log(`⏰ Auto-pay: processing overdue bill "${bill.name}" (id=${bill.id})`);

    let txHash = '';
    let paymentOk = false;

    // ── 1. Execute payment ─────────────────────────────────────────────────
    try {
      const result = await sendPayment(agentKey, bill.recipientAddress, bill.amount, bill.asset);
      txHash = result.hash;
      paymentOk = true;
      console.log(`✅ Auto-pay success | bill ${bill.id} | tx ${txHash}`);
    } catch (payErr) {
      console.error(`❌ Auto-pay failed for bill "${bill.name}" (id=${bill.id}):`, payErr.message);
    }

    if (paymentOk) {
      // ── 2. Advance next_due (recurring) OR mark paid (one-time) ────────────
      if (bill.type !== 'one-time') {
        // Recurring: advance due date and reset to active — do NOT mark_paid
        const nextDueDate = calculateNextDueDate(bill.nextDueDate, bill.frequency, bill.dayOfMonth ?? 0);
        try {
          await updateNextDueForAgent(agentKey, bill.contractId, nextDueDate);
          console.log(`📅 Bill "${bill.name}" rescheduled → ${nextDueDate}`);
        } catch (e) {
          console.error('❌ updateNextDue error:', e.message);
        }
        try {
          await updateStatusForAgent(agentKey, bill.contractId, 'active');
        } catch (e) {
          console.error('❌ updateStatus(active) error:', e.message);
        }
      } else {
        // One-time: mark as paid (terminal state)
        try { await markPaidForAgent(agentKey, bill.contractId); } catch (e) {
          console.error('❌ markPaid error:', e.message);
        }
      }

      // ── 3. Record payment history ─────────────────────────────────────────
      try {
        await recordPaymentForAgent(agentKey, {
          billId:           bill.contractId,
          billName:         bill.name,
          recipientAddress: bill.recipientAddress,
          amount:           bill.amount,
          asset:            bill.asset,
          txHash,
          status:           'success',
          error:            '',
        });
      } catch (e) {
        console.error('❌ recordPayment error:', e.message);
      }

      // ── 4. Telegram payment confirmation ──────────────────────────────────
      const chatId = getChatId(bill.id) || getDefaultChatId();
      if (chatId) {
        sendPaymentConfirmation(String(chatId), bill, txHash)
          .then(() => console.log(`📨 Telegram payment confirmation sent for bill "${bill.name}" → chatId ${chatId}`))
          .catch((e) => console.error(`❌ Telegram send failed for bill "${bill.name}":`, e.message));
      } else {
        console.warn(`⚠️ No Telegram chatId for bill "${bill.name}" (id=${bill.id}) — skipping notification.`);
        console.warn('⚠️  Fix: open Agent API Panel → Telegram Settings → Save & Enable.');
      }
    } else {
      // ── Fallback: send Telegram reminder with manual payment link ─────────
      const chatId = getChatId(bill.id) || getDefaultChatId();
      if (chatId && config.telegramBotToken) {
        const overdueDays = Math.ceil((now - due) / (1000 * 60 * 60 * 24));
        const paymentUrl  = buildPaymentUrl(bill.id);
        const text =
          `⚠️ <b>Otomatik Ödeme Başarısız</b>\n\n` +
          `<b>Fatura:</b> ${bill.name}\n` +
          `<b>Tutar:</b> ${bill.amount} ${bill.asset}\n` +
          `<b>Gecikme:</b> ${overdueDays} gün\n\n` +
          `Ödeme gerçekleştirilemedi. Lütfen manuel olarak ödeyin:\n` +
          `💰 Ödeme Sayfasını Aç\n${paymentUrl}`;
        sendMessage(String(chatId), text)
          .then(() => console.log(`📨 Telegram reminder sent for bill "${bill.name}" → chatId ${chatId}`))
          .catch((e) => console.error(`❌ Telegram reminder failed for bill "${bill.name}":`, e.message));
      } else if (!chatId) {
        console.warn(`⚠️ No Telegram chatId for bill "${bill.name}" (id=${bill.id}) — auto-pay failed but cannot notify user.`);
        console.warn('⚠️  Fix: open Agent API Panel → Telegram Settings → Save & Enable.');
      }
    }
  }
}
// ─── Worker Schedule Auto-Pay (on-chain) ─────────────────────────────────────
async function runWorkerScheduleCheck() {
  const now      = Date.now();
  const agentKey = getAgentPublicKey();

  let schedules;
  try {
    schedules = await getAllWorkerSchedules(agentKey);
  } catch (err) {
    console.error('⏰ Worker schedule: failed to fetch schedules:', err.message);
    return;
  }

  for (const schedule of schedules) {
    if (schedule.status !== 'active') continue;

    let pendingPayments;
    try {
      pendingPayments = await getPendingWorkerPayments(agentKey, schedule.contractScheduleId);
    } catch (err) {
      console.error(`⏰ Worker schedule: failed to fetch payments for ${schedule.workerName}:`, err.message);
      continue;
    }

    for (const payment of pendingPayments) {
      const payAt = new Date(payment.payAt).getTime();
      if (payAt > now) continue;

      const cooldownKey = `ws:${schedule.contractScheduleId}:${payment.contractPaymentId}`;
      const lastTs = lastAttempted.get(cooldownKey) || 0;
      if (now - lastTs < PAY_COOLDOWN) continue;

      lastAttempted.set(cooldownKey, now);

      // ── Live-rate XLM: recompute amount at execution time ──
      let payAmount = payment.amount;
      let priceNote = '';
      if (schedule.hourlyUsdBudget && schedule.asset === 'XLM') {
        const xlmPrice = await getLiveXlmPrice();
        if (xlmPrice && parseFloat(schedule.hourlyRate) > 0) {
          // Derive the hours fraction from the stored amounts
          const hoursFraction = parseFloat(payment.amount) / parseFloat(schedule.hourlyRate);
          payAmount = String(+(schedule.hourlyUsdBudget * hoursFraction / xlmPrice).toFixed(7));
          priceNote = ` @ $${xlmPrice}/XLM`;
        } else {
          console.warn(`⚠️  Could not fetch live XLM price for worker ${schedule.workerName} — using stored amount`);
        }
      }

      console.log(`⏰ Worker pay: ${schedule.workerName} ${payment.label} (${payment.date}) — ${payAmount} ${schedule.asset}${priceNote}`);

      try {
        const result = await sendPayment(agentKey, schedule.workerAddress, payAmount, schedule.asset);

        // Update payment status on-chain
        await setWorkerPaymentStatus(
          agentKey,
          schedule.contractScheduleId,
          payment.contractPaymentId,
          'done',
          result.hash,
          '',
        ).catch(e => console.error('⚠️  setWorkerPaymentStatus(done) failed:', e.message));

        console.log(`✅ Worker pay success | ${schedule.workerName} ${payment.label} | tx ${result.hash}`);

        const chatId = getDefaultChatId();
        if (chatId) {
          const msg =
            `✅ <b>Worker Payment Sent</b>\n\n` +
            `<b>Worker:</b> ${schedule.workerName}\n` +
            `<b>Day:</b> ${payment.dayIndex} (${payment.date})\n` +
            `<b>Amount:</b> ${parseFloat(payAmount).toFixed(4)} ${schedule.asset}${priceNote ? ` (${priceNote.trim()})` : ''}\n` +
            `<b>Tx:</b> <code>${result.hash}</code>`;
          sendMessage(String(chatId), msg).catch(() => {});
        }
      } catch (err) {
        // Update payment status on-chain
        await setWorkerPaymentStatus(
          agentKey,
          schedule.contractScheduleId,
          payment.contractPaymentId,
          'failed',
          '',
          err.message.slice(0, 200),
        ).catch(e => console.error('⚠️  setWorkerPaymentStatus(failed) failed:', e.message));

        console.error(`❌ Worker pay failed: ${schedule.workerName} ${payment.label}: ${err.message}`);
      }
    }
  }
}
export function startReminderJob() {
  // Startup diagnostics
  const defaultChatId = getDefaultChatId();
  if (!config.telegramBotToken) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN not set — Telegram notifications are disabled.');
  } else if (!defaultChatId) {
    console.warn('⚠️  No default Telegram chatId saved. Open Agent API Panel → Telegram Settings → Save & Enable to register one.');
  } else {
    console.log(`📨 Telegram notifications enabled — default chatId: ${defaultChatId}`);
  }
  console.log(`⏰ Auto-pay engine started (interval: ${CHECK_INTERVAL / 1000}s)`);
  // Run once at startup after a short delay, then on interval
  setTimeout(runCheck, 10_000);
  setInterval(runCheck, CHECK_INTERVAL).unref();
}

