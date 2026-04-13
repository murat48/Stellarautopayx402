/**
 * Soroban contract interaction service for Node.js backend.
 * Adapted from src/utils/contractClient.js — browser-specific code removed.
 */
import {
  Contract,
  rpc,
  Horizon,
  TransactionBuilder,
  Networks,
  Keypair,
  xdr,
  scValToNative,
  nativeToScVal,
  Address,
  Asset,
  Operation,
} from '@stellar/stellar-sdk';
import config from '../config.js';

const CONTRACT_ID = config.contractId;
const NETWORK_PASSPHRASE = Networks.TESTNET;
const RPC_URL = config.rpcUrl;
const HORIZON_URL = config.horizonUrl;

const sorobanServer = new rpc.Server(RPC_URL);
const horizonServer = new Horizon.Server(HORIZON_URL);
const contract = new Contract(CONTRACT_ID);

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC_ASSET = new Asset('USDC', USDC_ISSUER);

// ─── ScVal encoding helpers ────────────────────────────────────────────────
const addr  = (pubkey) => new Address(pubkey).toScVal();
const str   = (s)      => nativeToScVal(s, { type: 'string' });
const i128  = (n)      => nativeToScVal(BigInt(n), { type: 'i128' });
const u64   = (n)      => nativeToScVal(BigInt(n), { type: 'u64' });
const u32   = (n)      => nativeToScVal(Number(n),  { type: 'u32' });
const enumV = (tag)    => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(tag)]);

// ─── Internal helpers ──────────────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function getAgentKeypair() {
  if (!config.agentSecretKey) {
    throw new Error('AGENT_SECRET_KEY is not set');
  }
  return Keypair.fromSecret(config.agentSecretKey);
}

async function buildTx(publicKey, method, ...args) {
  const account = await sorobanServer.getAccount(publicKey);
  return new TransactionBuilder(account, {
    fee: '1000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(120)
    .build();
}

/**
 * Simulate (read-only). Returns scValToNative result or null.
 */
async function queryContract(publicKey, method, ...args) {
  const tx = await buildTx(publicKey, method, ...args);
  const simResult = await sorobanServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }
  const retval = simResult.result?.retval;
  if (!retval) return null;
  return scValToNative(retval);
}

/**
 * Simulate → assemble → sign with agent keypair → submit → poll.
 */
async function invokeContract(publicKey, method, ...args) {
  const keypair = getAgentKeypair();
  const tx = await buildTx(publicKey, method, ...args);

  const simResult = await sorobanServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Transaction simulation failed: ${simResult.error}`);
  }

  const assembled = rpc.assembleTransaction(tx, simResult).build();
  assembled.sign(keypair);

  const sendResult = await sorobanServer.sendTransaction(assembled);
  if (sendResult.status === 'ERROR') {
    const detail = sendResult.errorResult
      ? JSON.stringify(sendResult.errorResult)
      : 'unknown error';
    throw new Error(`Transaction submit failed: ${detail}`);
  }

  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const result = await sorobanServer.getTransaction(sendResult.hash);
    if (result.status === 'NOT_FOUND') continue;
    if (result.status === 'SUCCESS') {
      return result.returnValue ? scValToNative(result.returnValue) : null;
    }
    throw new Error(`Transaction failed with status: ${result.status}`);
  }
  throw new Error('Transaction confirmation timeout after 30s');
}

// ─── Data conversion ───────────────────────────────────────────────────────

function contractBillToFrontend(bill) {
  const billTypeTag = Array.isArray(bill.bill_type) ? bill.bill_type[0] : bill.bill_type;
  const freqTag     = Array.isArray(bill.frequency)  ? bill.frequency[0]  : bill.frequency;
  const statusTag   = Array.isArray(bill.status)     ? bill.status[0]     : bill.status;

  const freqMap = {
    Weekly:    'weekly',
    Biweekly:  'biweekly',
    Monthly:   'monthly',
    Quarterly: 'quarterly',
  };

  const dayOfMonth = Number(bill.day_of_month ?? 0);

  return {
    id:               String(bill.id),
    contractId:       Number(bill.id),
    name:             bill.name,
    recipientAddress: bill.recipient,
    amount:           (Number(bill.amount) / 10_000_000).toString(),
    asset:            bill.asset,
    type:             billTypeTag === 'OneTime' ? 'one-time' : 'recurring',
    frequency:        freqTag === 'Monthly' && dayOfMonth > 0
                        ? 'monthly_day'
                        : (freqMap[freqTag] ?? null),
    dayOfMonth:       dayOfMonth,
    nextDueDate:      new Date(Number(bill.next_due) * 1000).toISOString(),
    status:           statusTag === 'LowBalance' ? 'low_balance' : statusTag.toLowerCase(),
    createdAt:        new Date(Number(bill.created_at) * 1000).toISOString(),
  };
}

function frontendToContractParams(bill) {
  const freqMap = {
    weekly:      'Weekly',
    biweekly:    'Biweekly',
    monthly:     'Monthly',
    monthly_day: 'Monthly',
    quarterly:   'Quarterly',
  };
  const frequency = bill.type === 'one-time' ? 'None' : (freqMap[bill.frequency] ?? 'Monthly');
  const dayOfMonth = bill.frequency === 'monthly_day' ? (bill.dayOfMonth ?? 0) : 0;

  return {
    name:         bill.name,
    recipient:    bill.recipientAddress,
    amount:       BigInt(Math.round(parseFloat(bill.amount) * 10_000_000)),
    asset:        bill.asset,
    bill_type:    bill.type === 'one-time' ? 'OneTime' : 'Recurring',
    frequency,
    day_of_month: dayOfMonth,
    next_due:     BigInt(Math.floor(new Date(bill.nextDueDate).getTime() / 1000)),
  };
}

// ─── Read-only functions ───────────────────────────────────────────────────

export async function getAllBills(walletAddress) {
  const result = await queryContract(walletAddress, 'get_all_bills', addr(walletAddress));
  return Array.isArray(result) ? result.map(contractBillToFrontend) : [];
}

export async function getBill(walletAddress, billId) {
  const result = await queryContract(walletAddress, 'get_bill', addr(walletAddress), u64(billId));
  return result ? contractBillToFrontend(result) : null;
}

export async function getActiveBills(walletAddress) {
  const result = await queryContract(walletAddress, 'get_active_bills', addr(walletAddress));
  return Array.isArray(result) ? result.map(contractBillToFrontend) : [];
}

export async function getPaymentHistory(walletAddress) {
  const result = await queryContract(walletAddress, 'get_payment_history', addr(walletAddress));
  if (!Array.isArray(result)) return [];
  return result.reverse().map((rec) => {
    const statusTag = Array.isArray(rec.status) ? rec.status[0] : rec.status;
    return {
      id:               String(rec.id),
      billId:           String(rec.bill_id),
      billName:         rec.bill_name,
      recipientAddress: rec.recipient,
      amount:           (Number(rec.amount) / 10_000_000).toString(),
      asset:            rec.asset,
      txHash:           rec.tx_hash || null,
      status:           statusTag.toLowerCase(),
      error:            rec.error_msg || null,
      date:             new Date(Number(rec.executed_at) * 1000).toISOString(),
    };
  });
}

// ─── Write functions (agent keypair signs) ─────────────────────────────────

export async function addBillForAgent(agentPublicKey, billData) {
  const p = frontendToContractParams(billData);
  const result = await invokeContract(
    agentPublicKey, 'add_bill',
    addr(agentPublicKey),
    str(p.name),
    addr(p.recipient),
    i128(p.amount),
    str(p.asset),
    enumV(p.bill_type),
    enumV(p.frequency),
    u32(p.day_of_month),
    u64(p.next_due),
  );
  return result ? contractBillToFrontend(result) : null;
}

export async function pauseBillForAgent(agentPublicKey, billId) {
  return invokeContract(
    agentPublicKey, 'pause_bill',
    addr(agentPublicKey),
    u64(billId),
  );
}

export async function deleteBillForAgent(agentPublicKey, billId) {
  return invokeContract(
    agentPublicKey, 'delete_bill',
    addr(agentPublicKey),
    u64(billId),
  );
}

export async function markPaidForAgent(agentPublicKey, billId) {
  return invokeContract(
    agentPublicKey, 'mark_paid',
    addr(agentPublicKey),
    u64(billId),
  );
}

export async function recordPaymentForAgent(agentPublicKey, entry) {
  const statusTagMap = { success: 'Success', failed: 'Failed', skipped: 'Skipped' };
  const statusTag = statusTagMap[entry.status] ?? 'Failed';
  const amountStroops = BigInt(Math.round(parseFloat(entry.amount) * 10_000_000));

  return invokeContract(
    agentPublicKey, 'record_payment',
    addr(agentPublicKey),
    u64(entry.billId ?? 0),
    str(entry.billName ?? ''),
    addr(entry.recipientAddress),
    i128(amountStroops),
    str(entry.asset ?? 'XLM'),
    str(entry.txHash ?? ''),
    enumV(statusTag),
    str(entry.error ?? ''),
  );
}

// ─── Horizon payment ───────────────────────────────────────────────────────

export async function sendPayment(sourcePublicKey, destination, amount, assetCode) {
  const keypair = getAgentKeypair();
  const account = await horizonServer.loadAccount(sourcePublicKey);
  const asset = assetCode === 'XLM' ? Asset.native() : USDC_ASSET;

  const feeWallet = config.feeWalletAddress;
  const feeAmount = config.agentPaymentFee;
  const includeFee = feeWallet &&
                     feeWallet !== sourcePublicKey &&
                     parseFloat(feeAmount) > 0;

  const builder = new TransactionBuilder(account, {
    fee: String(1000 * (includeFee ? 2 : 1)),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.payment({ destination, asset, amount: String(amount) }));

  if (includeFee) {
    builder.addOperation(Operation.payment({
      destination: feeWallet,
      asset: Asset.native(),
      amount: String(feeAmount),
    }));
  }

  const tx = builder.setTimeout(60).build();
  tx.sign(keypair);
  const result = await horizonServer.submitTransaction(tx);

  if (!result.successful) {
    throw new Error(`Transaction included but marked unsuccessful (hash: ${result.hash})`);
  }

  console.log(`💰 Payment sent | hash: ${result.hash} | amount: ${amount} ${assetCode}${includeFee ? ` | fee: ${feeAmount} XLM` : ''}`);
  return result;
}

export async function fetchBalances(publicKey) {
  const account = await horizonServer.loadAccount(publicKey);
  const balances = {};
  for (const b of account.balances) {
    if (b.asset_type === 'native') {
      balances.XLM = parseFloat(b.balance);
    } else if (b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER) {
      balances.USDC = parseFloat(b.balance);
    }
  }
  return balances;
}

export function getAgentPublicKey() {
  return getAgentKeypair().publicKey();
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker Schedule Contract (on-chain temp worker scheduling)
// Contract: CCIJ3EL5DRPI2QPYQIWUECEEEBGZFJBDNNCMAPOC6RGL4DTJW4YCY7U7
// ═══════════════════════════════════════════════════════════════════════════

const WS_CONTRACT_ID = config.workerScheduleContractId;
const wsContract = new Contract(WS_CONTRACT_ID);

async function buildWsTx(publicKey, method, ...args) {
  const account = await sorobanServer.getAccount(publicKey);
  return new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(wsContract.call(method, ...args))
    .setTimeout(120)
    .build();
}

async function queryWsContract(publicKey, method, ...args) {
  const tx = await buildWsTx(publicKey, method, ...args);
  const simResult = await sorobanServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`WS simulation failed: ${simResult.error}`);
  }
  const retval = simResult.result?.retval;
  if (!retval) return null;
  return scValToNative(retval);
}

async function invokeWsContract(publicKey, method, ...args) {
  const keypair = getAgentKeypair();
  const tx = await buildWsTx(publicKey, method, ...args);

  const simResult = await sorobanServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`WS transaction simulation failed: ${simResult.error}`);
  }

  const assembled = rpc.assembleTransaction(tx, simResult).build();
  assembled.sign(keypair);

  const sendResult = await sorobanServer.sendTransaction(assembled);
  if (sendResult.status === 'ERROR') {
    const detail = sendResult.errorResult
      ? JSON.stringify(sendResult.errorResult)
      : 'unknown error';
    throw new Error(`WS transaction submit failed: ${detail}`);
  }

  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const result = await sorobanServer.getTransaction(sendResult.hash);
    if (result.status === 'NOT_FOUND') continue;
    if (result.status === 'SUCCESS') {
      return result.returnValue ? scValToNative(result.returnValue) : null;
    }
    throw new Error(`WS transaction failed with status: ${result.status}`);
  }
  throw new Error('WS transaction confirmation timeout after 30s');
}

// ─── PaymentInput XDR encoder ─────────────────────────────────────────────
// Fields must be sorted lexicographically: amount, date, day_index, hour_index, id, label, pay_at

function encodePaymentInput(p) {
  const amountRaw = BigInt(Math.round(parseFloat(p.amount) * 10_000_000));
  const payAtUnix = BigInt(Math.floor(new Date(p.payAt).getTime() / 1000));
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('amount'),     val: i128(amountRaw) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('date'),       val: str(p.date) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('day_index'),  val: u32(p.dayIndex) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('hour_index'), val: u32(p.hourIndex) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('id'),         val: str(String(p.id)) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('label'),      val: str(p.label) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('pay_at'),     val: u64(payAtUnix) }),
  ]);
}

// ─── Data converters ──────────────────────────────────────────────────────

function wsScheduleToJs(s) {
  const statusTag = Array.isArray(s.status) ? s.status[0] : String(s.status);
  const statusMap = { Active: 'active', Cancelled: 'cancelled', Completed: 'completed' };
  const hourlyRate     = Number(s.hourly_rate);
  const hourlyUsdBudget = Number(s.hourly_usd_budget);
  return {
    id:               String(s.id),
    contractScheduleId: Number(s.id),
    workerName:       s.worker_name,
    workerAddress:    s.worker_address,
    hourlyRate:       (hourlyRate / 10_000_000).toFixed(7),
    hourlyUsdBudget:  hourlyUsdBudget > 0 ? hourlyUsdBudget / 10_000_000 : null,
    asset:            s.asset,
    workStartTime:    s.work_start_time,
    status:           statusMap[statusTag] ?? statusTag.toLowerCase(),
    createdAt:        new Date(Number(s.created_at) * 1000).toISOString(),
    paymentCount:     Number(s.payment_count),
  };
}

function wsPaymentToJs(p) {
  const statusTag = Array.isArray(p.status) ? p.status[0] : String(p.status);
  const statusMap = { Pending: 'pending', Done: 'paid', Failed: 'failed', Cancelled: 'cancelled' };
  return {
    id:               String(p.id),
    contractPaymentId: String(p.id),
    scheduleId:       Number(p.schedule_id),
    dayIndex:         Number(p.day_index),
    hourIndex:        Number(p.hour_index),
    label:            p.label,
    date:             p.date,
    payAt:            new Date(Number(p.pay_at) * 1000).toISOString(),
    amount:           (Number(p.amount) / 10_000_000).toFixed(7),
    status:           statusMap[statusTag] ?? statusTag.toLowerCase(),
    txHash:           p.tx_hash || null,
    error:            p.error || null,
    executedAt:       p.executed_at > 0
                        ? new Date(Number(p.executed_at) * 1000).toISOString()
                        : null,
  };
}

// ─── Exported worker-schedule functions ───────────────────────────────────

/**
 * Create a schedule + all payments in one Soroban transaction.
 * payments: [{ id, dayIndex, hourIndex, label, date, payAt (ISO), amount (string with 7dp) }]
 * Returns the on-chain schedule ID (number).
 */
export async function createWorkerSchedule(agentKey, scheduleData, payments) {
  const hourlyRateRaw = BigInt(Math.round(parseFloat(scheduleData.hourlyRate   || '0') * 10_000_000));
  const hourlyUsdRaw  = BigInt(Math.round((scheduleData.hourlyUsdBudget || 0)  * 10_000_000));

  const scheduleId = await invokeWsContract(
    agentKey,
    'create_schedule',
    addr(agentKey),
    str(scheduleData.workerName),
    addr(scheduleData.workerAddress),
    i128(hourlyRateRaw),
    i128(hourlyUsdRaw),
    str(scheduleData.asset),
    str(scheduleData.workStartTime),
    xdr.ScVal.scvVec(payments.map(encodePaymentInput)),
  );
  return Number(scheduleId);
}

export async function getAllWorkerSchedules(agentKey) {
  const result = await queryWsContract(agentKey, 'get_all_schedules', addr(agentKey));
  return Array.isArray(result) ? result.map(wsScheduleToJs) : [];
}

export async function getWorkerSchedulePayments(agentKey, scheduleId) {
  const result = await queryWsContract(
    agentKey, 'get_payments',
    addr(agentKey), u64(scheduleId),
  );
  return Array.isArray(result) ? result.map(wsPaymentToJs) : [];
}

export async function getPendingWorkerPayments(agentKey, scheduleId) {
  const result = await queryWsContract(
    agentKey, 'get_pending_payments',
    addr(agentKey), u64(scheduleId),
  );
  return Array.isArray(result) ? result.map(wsPaymentToJs) : [];
}

export async function cancelWorkerSchedule(agentKey, scheduleId) {
  return invokeWsContract(
    agentKey, 'cancel_schedule',
    addr(agentKey), u64(scheduleId),
  );
}

/**
 * Update a payment's execution result on-chain.
 * status: 'done' | 'failed' | 'cancelled'
 */
export async function setWorkerPaymentStatus(agentKey, scheduleId, paymentId, status, txHash, error) {
  const statusTagMap = { done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
  const statusTag = statusTagMap[status] ?? 'Failed';
  return invokeWsContract(
    agentKey, 'set_payment_status',
    addr(agentKey),
    u64(scheduleId),
    str(String(paymentId)),
    enumV(statusTag),
    str(txHash || ''),
    str(error   || ''),
  );
}
