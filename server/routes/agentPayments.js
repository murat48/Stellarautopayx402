import { Router } from 'express';
import {
  getPaymentHistory,
  getBill,
  sendPayment,
  markPaidForAgent,
  recordPaymentForAgent,
  updateNextDueForAgent,
  updateStatusForAgent,
  fetchBalances,
  getAgentPublicKey,
} from '../services/sorobanService.js';
import {
  getChatId,
  storeChatId,
  sendPaymentConfirmation,
  sendPaymentReminder,
} from '../services/telegramService.js';
import { buildPaymentUrl } from '../services/paymentLinkService.js';

// Month-aware next due date (mirrors server/services/reminderJob.js)
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

const router = Router();

/**
 * POST /agent/pay/:id — Trigger payment for a bill
 */
router.post('/pay/:id', async (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    if (isNaN(billId) || billId < 0) {
      return res.status(400).json({ success: false, error: 'Invalid bill ID' });
    }

    const agentPublicKey = getAgentPublicKey();
    const bill = await getBill(agentPublicKey, billId);

    if (!bill) {
      return res.status(404).json({ success: false, error: 'Bill not found' });
    }

    console.log(`💰 Processing payment for bill ${billId}: ${bill.amount} ${bill.asset} → ${bill.recipientAddress}`);

    let txHash = '';
    let paymentStatus = 'success';
    let errorMsg = '';

    try {
      const result = await sendPayment(
        agentPublicKey,
        bill.recipientAddress,
        bill.amount,
        bill.asset,
      );
      txHash = result.hash;
    } catch (payErr) {
      paymentStatus = 'failed';
      errorMsg = payErr.message;
      console.error('❌ Payment failed:', payErr.message);
    }

    // Record payment on-chain
    try {
      await recordPaymentForAgent(agentPublicKey, {
        billId: bill.contractId,
        billName: bill.name,
        recipientAddress: bill.recipientAddress,
        amount: bill.amount,
        asset: bill.asset,
        txHash,
        status: paymentStatus,
        error: errorMsg,
      });
    } catch (recErr) {
      console.error('❌ Failed to record payment:', recErr.message);
    }

    // Update contract state after successful payment
    if (paymentStatus === 'success') {
      if (bill.type !== 'one-time') {
        // Recurring: advance due date and reset to active
        const nextDueDate = calculateNextDueDate(bill.nextDueDate, bill.frequency, bill.dayOfMonth ?? 0);
        try {
          await updateNextDueForAgent(agentPublicKey, bill.contractId, nextDueDate);
          console.log(`📅 Bill "${bill.name}" rescheduled → ${nextDueDate}`);
        } catch (markErr) {
          console.error('❌ Failed to update next due:', markErr.message);
        }
        try {
          await updateStatusForAgent(agentPublicKey, bill.contractId, 'active');
        } catch (markErr) {
          console.error('❌ Failed to reset status to active:', markErr.message);
        }
      } else {
        // One-time: mark as paid (terminal state)
        try {
          await markPaidForAgent(agentPublicKey, bill.contractId);
        } catch (markErr) {
          console.error('❌ Failed to mark bill as paid:', markErr.message);
        }
      }
    }

    if (paymentStatus === 'failed') {
      return res.status(500).json({
        success: false,
        error: 'Payment failed',
        details: errorMsg,
        billId: String(billId),
      });
    }

    console.log(`✅ Payment successful for bill ${billId} | tx: ${txHash}`);

    // Send Telegram confirmation if a chatId is registered for this bill
    const chatId = getChatId(billId);
    if (chatId) {
      sendPaymentConfirmation(chatId, bill, txHash).catch(() => {});
    }

    res.json({
      success: true,
      payment: {
        billId: String(billId),
        billName: bill.name,
        recipientAddress: bill.recipientAddress,
        amount: bill.amount,
        asset: bill.asset,
        txHash,
        status: paymentStatus,
      },
    });
  } catch (err) {
    console.error('❌ Error processing payment:', err.message);
    res.status(500).json({ success: false, error: 'Failed to process payment' });
  }
});

/**
 * GET /agent/history — Payment history
 */
router.get('/history', async (_req, res) => {
  try {
    const agentPublicKey = getAgentPublicKey();
    const history = await getPaymentHistory(agentPublicKey);
    console.log(`✅ Retrieved ${history.length} payment records`);
    res.json({ success: true, history });
  } catch (err) {
    console.error('❌ Error getting payment history:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get payment history' });
  }
});

/**
 * GET /agent/balance — Agent wallet balance
 */
router.get('/balance', async (_req, res) => {
  try {
    const agentPublicKey = getAgentPublicKey();
    const balances = await fetchBalances(agentPublicKey);
    console.log(`✅ Balance: ${JSON.stringify(balances)}`);
    res.json({
      success: true,
      address: agentPublicKey,
      balances,
    });
  } catch (err) {
    console.error('❌ Error getting balance:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get balance' });
  }
});

/**
 * POST /agent/notify/:id — Send a Telegram payment reminder for a bill (x402 gated)
 * Body: { chatId? } — if omitted, uses the stored chatId from bill creation
 */
router.post('/notify/:id', async (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    if (isNaN(billId) || billId < 0) {
      return res.status(400).json({ success: false, error: 'Invalid bill ID' });
    }

    const agentPublicKey = getAgentPublicKey();
    const bill = await getBill(agentPublicKey, billId);
    if (!bill) {
      return res.status(404).json({ success: false, error: 'Bill not found' });
    }

    const targetChatId = req.body?.chatId || getChatId(billId);
    if (!targetChatId) {
      return res.status(400).json({
        success: false,
        error: 'No Telegram chat ID provided or registered for this bill',
      });
    }

    // Persist chatId if it was supplied in the request body
    if (req.body?.chatId) {
      storeChatId(billId, req.body.chatId);
    }

    // Build payment link first, then send reminder with it
    const paymentUrl = buildPaymentUrl(billId);
    const result = await sendPaymentReminder(targetChatId, bill, paymentUrl);
    console.log(`📨 Telegram reminder sent for bill ${billId} → chatId ${targetChatId} | link: ${paymentUrl}`);

    res.json({
      success: true,
      notified: { chatId: targetChatId, billName: bill.name, paymentUrl, telegramMessageId: result?.result?.message_id },
    });
  } catch (err) {
    console.error('❌ Error sending notification:', err.message);
    res.status(500).json({ success: false, error: 'Failed to send notification' });
  }
});

export default router;
