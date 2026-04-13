/**
 * Worker Schedule Routes — On-Chain via Soroban
 *
 * All schedules and payment statuses are stored on the Soroban smart contract.
 * Contract: CCIJ3EL5DRPI2QPYQIWUECEEEBGZFJBDNNCMAPOC6RGL4DTJW4YCY7U7
 *
 * POST   /api/worker-schedule         — Create a schedule (on-chain)
 * GET    /api/worker-schedule         — List all schedules (from chain)
 * GET    /api/worker-schedule/:id     — Get one schedule + payments (from chain)
 * DELETE /api/worker-schedule/:id/payment/:paymentId — Cancel a single payment
 * DELETE /api/worker-schedule/:id     — Cancel a schedule (on-chain)
 *
 * Also mounted at /agent/worker-schedule (x402-gated) for external agent access.
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { StrKey } from '@stellar/stellar-sdk';
import {
  getAgentPublicKey,
  createWorkerSchedule,
  getAllWorkerSchedules,
  getWorkerSchedulePayments,
  cancelWorkerSchedule,
  setWorkerPaymentStatus,
} from '../services/sorobanService.js';

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build per-hour payments with sequential 1-based IDs for the on-chain contract.
 */
function buildPayments(workDays, workStartTime, hourlyRate) {
  const [startHH, startMM] = workStartTime.split(':').map(Number);
  const rate = parseFloat(hourlyRate);
  const payments = [];

  const sorted = [...workDays].sort((a, b) => a.date.localeCompare(b.date));
  const MIN_FUTURE_MS = 5 * 60 * 1000; // payments must be at least 5 min in the future
  const nowMs = Date.now();

  for (let di = 0; di < sorted.length; di++) {
    const { date: dateStr, hours } = sorted[di];
    const [y, m, d]   = dateStr.split('-').map(Number);
    const wholeHours  = Math.floor(hours);
    const remainder   = Math.round((hours - wholeHours) * 100) / 100;

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

function mergeSchedule(header, payments) {
  return {
    id:               header.id,
    contractScheduleId: header.contractScheduleId,
    workerName:       header.workerName,
    workerAddress:    header.workerAddress,
    hourlyRate:       header.hourlyRate,
    hourlyUsdBudget:  header.hourlyUsdBudget,
    asset:            header.asset,
    workStartTime:    header.workStartTime,
    status:           header.status,
    createdAt:        header.createdAt,
    payments,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/', async (_req, res) => {
  try {
    const agentKey = getAgentPublicKey();
    const headers  = await getAllWorkerSchedules(agentKey);
    const schedules = await Promise.all(
      headers.map(async (h) => {
        const payments = await getWorkerSchedulePayments(agentKey, h.contractScheduleId);
        return mergeSchedule(h, payments);
      }),
    );
    res.json({ success: true, schedules });
  } catch (err) {
    console.error('GET /worker-schedule error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const agentKey = getAgentPublicKey();
    const sid      = parseInt(req.params.id, 10);
    if (isNaN(sid)) return res.status(400).json({ success: false, error: 'Invalid schedule id' });
    const headers = await getAllWorkerSchedules(agentKey);
    const header  = headers.find(h => h.contractScheduleId === sid);
    if (!header) return res.status(404).json({ success: false, error: 'Schedule not found' });
    const payments = await getWorkerSchedulePayments(agentKey, sid);
    res.json({ success: true, schedule: mergeSchedule(header, payments) });
  } catch (err) {
    console.error('GET /worker-schedule/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { workerName, workerAddress, hourlyRate, asset, workStartTime, workDays } = req.body;

  const errors = [];
  if (!workerName?.trim()) errors.push('workerName is required');
  if (!workerAddress || !StrKey.isValidEd25519PublicKey(workerAddress))
    errors.push('workerAddress must be a valid Stellar address');
  const rate = parseFloat(hourlyRate);
  if (isNaN(rate) || rate <= 0) errors.push('hourlyRate must be a positive number');
  if (!['XLM', 'USDC'].includes(asset)) errors.push('asset must be XLM or USDC');
  if (!workStartTime || !/^\d{2}:\d{2}$/.test(workStartTime))
    errors.push('workStartTime must be HH:MM format');
  if (!Array.isArray(workDays) || workDays.length === 0)
    errors.push('workDays must be a non-empty array');
  if (Array.isArray(workDays)) {
    workDays.forEach((entry, idx) => {
      if (!entry || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date))
        errors.push(`workDays[${idx}].date must be YYYY-MM-DD`);
      const h = parseFloat(entry.hours);
      if (isNaN(h) || h <= 0)
        errors.push(`workDays[${idx}].hours must be a positive number`);
    });
  }
  if (errors.length > 0) return res.status(400).json({ success: false, errors });

  const payments = buildPayments(workDays, workStartTime, rate);

  try {
    const agentKey = getAgentPublicKey();
    const scheduleData = {
      workerName:      workerName.trim(),
      workerAddress,
      hourlyRate:      String(rate.toFixed(7)),
      hourlyUsdBudget: 0,
      asset,
      workStartTime,
    };
    const contractScheduleId = await createWorkerSchedule(agentKey, scheduleData, payments);

    const schedule = {
      id:              String(contractScheduleId),
      contractScheduleId,
      workerName:      scheduleData.workerName,
      workerAddress,
      hourlyRate:      scheduleData.hourlyRate,
      hourlyUsdBudget: null,
      asset,
      workStartTime,
      payments,
      createdAt:       new Date().toISOString(),
      status:          'active',
    };
    res.status(201).json({ success: true, schedule });
  } catch (err) {
    console.error('POST /worker-schedule error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Must be registered before /:id to avoid Express matching /:id first
router.delete('/:id/payment/:paymentId', async (req, res) => {
  const sid = parseInt(req.params.id, 10);
  const pid = req.params.paymentId;  // UUID string
  if (isNaN(sid) || !pid)
    return res.status(400).json({ success: false, error: 'Invalid id' });

  try {
    const agentKey = getAgentPublicKey();
    const payments = await getWorkerSchedulePayments(agentKey, sid);
    const payment  = payments.find(p => p.contractPaymentId === pid);
    if (!payment)
      return res.status(404).json({ success: false, error: 'Payment not found' });
    if (payment.status !== 'pending')
      return res.status(400).json({ success: false, error: `Cannot cancel payment with status "${payment.status}"` });

    await setWorkerPaymentStatus(agentKey, sid, pid, 'cancelled', '', '');

    const headers = await getAllWorkerSchedules(agentKey);
    const header  = headers.find(h => h.contractScheduleId === sid);
    const updated = await getWorkerSchedulePayments(agentKey, sid);
    res.json({ success: true, schedule: mergeSchedule(header, updated) });
  } catch (err) {
    console.error('DELETE /worker-schedule/:id/payment/:paymentId error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const sid = parseInt(req.params.id, 10);
  if (isNaN(sid))
    return res.status(400).json({ success: false, error: 'Invalid schedule id' });
  try {
    const agentKey = getAgentPublicKey();
    await cancelWorkerSchedule(agentKey, sid);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /worker-schedule/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
