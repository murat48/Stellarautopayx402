import { Router } from 'express';
import { StrKey } from '@stellar/stellar-sdk';
import {
  getAllBills,
  getBill,
  addBillForAgent,
  pauseBillForAgent,
  deleteBillForAgent,
  getAgentPublicKey,
} from '../services/sorobanService.js';
import { storeChatId } from '../services/telegramService.js';

const router = Router();

// ── In-memory cache for bill list (avoids hammering Soroban RPC) ──────────────
const CACHE_TTL = 5_000; // 5 seconds
let billsCache = null;
let billsCacheAt = 0;

function invalidateBillsCache() {
  billsCache = null;
  billsCacheAt = 0;
}
export { invalidateBillsCache };

// Input validation
function validateBillInput(body) {
  const errors = [];
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    errors.push('name is required');
  }
  if (!body.recipientAddress || !StrKey.isValidEd25519PublicKey(body.recipientAddress)) {
    errors.push('recipientAddress must be a valid Stellar address');
  }
  const amount = parseFloat(body.amount);
  if (isNaN(amount) || amount <= 0) {
    errors.push('amount must be a positive number');
  }
  const validAssets = ['XLM', 'USDC'];
  if (!body.asset || !validAssets.includes(body.asset)) {
    errors.push('asset must be XLM or USDC');
  }
  const validTypes = ['one-time', 'recurring'];
  if (!body.type || !validTypes.includes(body.type)) {
    errors.push('type must be one-time or recurring');
  }
  if (body.type === 'recurring') {
    const validFreqs = ['weekly', 'biweekly', 'monthly', 'monthly_day', 'quarterly'];
    if (!body.frequency || !validFreqs.includes(body.frequency)) {
      errors.push('frequency is required for recurring bills');
    }
  }
  if (!body.nextDueDate || isNaN(new Date(body.nextDueDate).getTime())) {
    errors.push('nextDueDate must be a valid ISO date');
  }
  return errors;
}

/**
 * POST /agent/bills — Create a new bill
 */
router.post('/', async (req, res) => {
  try {
    const errors = validateBillInput(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const agentPublicKey = getAgentPublicKey();
    const billData = {
      name: req.body.name.trim(),
      recipientAddress: req.body.recipientAddress,
      amount: req.body.amount,
      asset: req.body.asset,
      type: req.body.type,
      frequency: req.body.frequency || null,
      dayOfMonth: req.body.dayOfMonth || 0,
      nextDueDate: req.body.nextDueDate,
    };

    console.log(`✅ Creating bill: ${billData.name} for ${billData.amount} ${billData.asset}`);
    const bill = await addBillForAgent(agentPublicKey, billData);
    invalidateBillsCache(); // new bill → stale cache

    // Store Telegram chat ID if provided (for API payment notifications)
    if (bill && req.body.telegramChatId) {
      storeChatId(bill.id, req.body.telegramChatId);
      console.log(`📨 Telegram chatId registered for bill ${bill.id}`);
    }

    res.status(201).json({ success: true, bill });
  } catch (err) {
    console.error('❌ Error creating bill:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create bill' });
  }
});

/**
 * GET /agent/bills — List all bills (cached 5 s)
 */
router.get('/', async (_req, res) => {
  try {
    const now = Date.now();
    if (billsCache && now - billsCacheAt < CACHE_TTL) {
      return res.json({ success: true, bills: billsCache, cached: true });
    }
    const agentPublicKey = getAgentPublicKey();
    const bills = await getAllBills(agentPublicKey);
    billsCache = bills;
    billsCacheAt = now;
    console.log(`✅ Listed ${bills.length} bills`);
    res.json({ success: true, bills });
  } catch (err) {
    console.error('❌ Error listing bills:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list bills' });
  }
});

/**
 * GET /agent/bills/:id — Get a single bill
 */
router.get('/:id', async (req, res) => {
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

    res.json({ success: true, bill });
  } catch (err) {
    console.error('❌ Error getting bill:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get bill' });
  }
});

/**
 * POST /agent/bills/:id/pause — Pause/resume a bill
 */
router.post('/:id/pause', async (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    if (isNaN(billId) || billId < 0) {
      return res.status(400).json({ success: false, error: 'Invalid bill ID' });
    }

    const agentPublicKey = getAgentPublicKey();
    console.log(`✅ Toggling pause for bill ${billId}`);
    await pauseBillForAgent(agentPublicKey, billId);
    invalidateBillsCache(); // status changed → stale cache

    res.json({ success: true, message: `Bill ${billId} pause toggled` });
  } catch (err) {
    console.error('❌ Error pausing bill:', err.message);
    res.status(500).json({ success: false, error: 'Failed to pause bill' });
  }
});

/**
 * DELETE /agent/bills/:id — Delete a bill
 */
router.delete('/:id', async (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    if (isNaN(billId) || billId < 0) {
      return res.status(400).json({ success: false, error: 'Invalid bill ID' });
    }

    const agentPublicKey = getAgentPublicKey();
    console.log(`✅ Deleting bill ${billId}`);
    await deleteBillForAgent(agentPublicKey, billId);
    invalidateBillsCache(); // bill removed → stale cache

    res.json({ success: true, message: `Bill ${billId} deleted` });
  } catch (err) {
    console.error('❌ Error deleting bill:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete bill' });
  }
});

export default router;
