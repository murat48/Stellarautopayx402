/**
 * Direct RPC contract client — bypasses ContractClient's XDR parsing bugs.
 * Uses server.simulateTransaction + rpc.assembleTransaction directly.
 * This avoids the infamous ".switch() on undefined" error caused by
 * ContractClient's internal ScVal decoding in browser environments.
 */
import {
  Contract,
  rpc,
  TransactionBuilder,
  Networks,
  xdr,
  scValToNative,
  nativeToScVal,
  Address,
} from '@stellar/stellar-sdk';

export const CONTRACT_ID = 'CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS';
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = 'https://soroban-testnet.stellar.org';

const server = new rpc.Server(RPC_URL);
const contract = new Contract(CONTRACT_ID);

// ─── ScVal encoding helpers ────────────────────────────────────────────────
const addr  = (pubkey) => new Address(pubkey).toScVal();
const str   = (s)      => nativeToScVal(s, { type: 'string' });
const i128  = (n)      => nativeToScVal(BigInt(n), { type: 'i128' });
const u64   = (n)      => nativeToScVal(BigInt(n), { type: 'u64' });
const u32   = (n)      => nativeToScVal(Number(n),  { type: 'u32' });
// Soroban unit-enum variants encode as ScvVec([ScvSymbol("Tag")])
const enumV = (tag)    => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(tag)]);

// ─── Internal helpers ──────────────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function buildTx(publicKey, method, ...args) {
  const account = await server.getAccount(publicKey);
  return new TransactionBuilder(account, {
    // rpc.assembleTransaction ADDS simulation.minResourceFee on top of this base.
    // Keeping base at 1000 stroops keeps total fees minimal (≈ 0.01 XLM).
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
  const simResult = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }
  const retval = simResult.result?.retval;
  if (!retval) return null;
  return scValToNative(retval);
}

/**
 * Simulate → assemble → sign → submit → poll.
 * signFn: (xdrString) => Promise<xdrString>
 */
async function invokeContract(publicKey, signFn, method, ...args) {
  const tx = await buildTx(publicKey, method, ...args);

  // Simulate to get fee + auth entries
  const simResult = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Transaction simulation failed: ${simResult.error}`);
  }

  // Assemble: inject auth entries and fee from simulation
  const assembled = rpc.assembleTransaction(tx, simResult).build();

  // Sign
  const signedXdr = await signFn(assembled.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

  // Submit
  const sendResult = await server.sendTransaction(signed);
  if (sendResult.status === 'ERROR') {
    const detail = sendResult.errorResult
      ? JSON.stringify(sendResult.errorResult)
      : 'unknown error';
    throw new Error(`Transaction submit failed: ${detail}`);
  }

  // Poll until confirmed (max 40s)
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const result = await server.getTransaction(sendResult.hash);
    if (result.status === 'NOT_FOUND') continue;
    if (result.status === 'SUCCESS') {
      return result.returnValue ? scValToNative(result.returnValue) : null;
    }
    throw new Error(`Transaction failed with status: ${result.status}`);
  }
  throw new Error('Transaction confirmation timeout after 40s');
}

// ─── Sign function factories ───────────────────────────────────────────────

/**
 * Create a sign function from a wallet kit signTransaction callback.
 * Handles both {signedTxXdr} objects and plain string return values.
 */
export function makeWalletSignFn(walletKitSign, publicKey) {
  return async (xdrStr) => {
    const result = await walletKitSign(xdrStr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: publicKey,
    });
    if (result && typeof result === 'object' && result.signedTxXdr) {
      return result.signedTxXdr;
    }
    if (typeof result === 'string') return result;
    throw new Error('Wallet did not return a signed transaction XDR');
  };
}

/**
 * Create a sign function from an in-memory session Keypair.
 */
export function makeSessionSignFn(sessionKeypair) {
  return async (xdrStr) => {
    const tx = TransactionBuilder.fromXDR(xdrStr, NETWORK_PASSPHRASE);
    tx.sign(sessionKeypair);
    return tx.toXDR();
  };
}

// ─── Contract API ──────────────────────────────────────────────────────────

/** Read all bills for this wallet. Returns [] for new users, never panics. */
export async function getAllBills(publicKey) {
  const result = await queryContract(publicKey, 'get_all_bills', addr(publicKey));
  return Array.isArray(result) ? result : [];
}

/** Add a new bill. signFn from makeWalletSignFn. Returns decoded Bill. */
export async function addBill(publicKey, signFn, bill) {
  const p = frontendToContractParams(bill);
  return invokeContract(
    publicKey, signFn, 'add_bill',
    addr(publicKey),
    str(p.name),
    addr(p.recipient),
    i128(p.amount),
    str(p.asset),
    enumV(p.bill_type),
    enumV(p.frequency),
    u32(p.day_of_month),
    u64(p.next_due),
  );
}

/** Toggle pause/resume. signFn from makeWalletSignFn. */
export async function pauseBill(publicKey, signFn, contractBillId) {
  return invokeContract(
    publicKey, signFn, 'pause_bill',
    addr(publicKey),
    u64(contractBillId),
  );
}

/** Delete a bill. signFn from makeWalletSignFn. */
export async function deleteBill(publicKey, signFn, contractBillId) {
  return invokeContract(
    publicKey, signFn, 'delete_bill',
    addr(publicKey),
    u64(contractBillId),
  );
}

/** Update status. signFn from makeSessionSignFn (auto-pay engine). */
export async function updateStatus(publicKey, signFn, contractBillId, status) {
  const statusTagMap = {
    active:      'Active',
    paused:      'Paused',
    completed:   'Completed',
    low_balance: 'LowBalance',
    paid:        'Paid',
  };
  const tag = statusTagMap[status] || 'Active';
  return invokeContract(
    publicKey, signFn, 'update_status',
    addr(publicKey),
    u64(contractBillId),
    enumV(tag),
  );
}

/** Update next due date. signFn from makeSessionSignFn (auto-pay engine). */
export async function updateNextDue(publicKey, signFn, contractBillId, nextDueIso) {
  const ts = BigInt(Math.floor(new Date(nextDueIso).getTime() / 1000));
  return invokeContract(
    publicKey, signFn, 'update_next_due',
    addr(publicKey),
    u64(contractBillId),
    u64(ts),
  );
}

/** Mark one-time bill completed. signFn from makeSessionSignFn (auto-pay engine). */
export async function completeBill(publicKey, signFn, contractBillId) {
  return invokeContract(
    publicKey, signFn, 'complete_bill',
    addr(publicKey),
    u64(contractBillId),
  );
}

/** Mark a bill as paid (money was sent). signFn from makeSessionSignFn or makeWalletSignFn. */
export async function markPaid(publicKey, signFn, contractBillId) {
  return invokeContract(
    publicKey, signFn, 'mark_paid',
    addr(publicKey),
    u64(contractBillId),
  );
}

// ─── Data conversion ───────────────────────────────────────────────────────

/**
 * Convert a scValToNative-decoded contract Bill to frontend shape.
 * scValToNative decode format:
 *   bill.id          → string (was BigInt)
 *   bill.amount      → string (was BigInt i128)
 *   bill.bill_type   → ["OneTime"] or ["Recurring"]  (unit enum = vec of symbol)
 *   bill.frequency   → ["Weekly"] | ["Monthly"] | ["None"]
 *   bill.status      → ["Active"] | ["Paused"] | ["Completed"] | ["LowBalance"]
 *   bill.next_due    → string (was BigInt u64, unix seconds)
 *   bill.created_at  → string (was BigInt u64, unix seconds)
 *   bill.name        → string
 *   bill.recipient   → string (G... address)
 *   bill.asset       → string
 */
export function contractBillToFrontend(bill) {
  // Unit enums decode as an array: ["TagName"]
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
    // If day_of_month is set for monthly, use 'monthly_day' internally
    frequency:        freqTag === 'Monthly' && dayOfMonth > 0
                        ? 'monthly_day'
                        : (freqMap[freqTag] ?? null),
    dayOfMonth:       dayOfMonth,
    nextDueDate:      new Date(Number(bill.next_due) * 1000).toISOString(),
    status:           statusTag === 'LowBalance' ? 'low_balance' : statusTag.toLowerCase(),
    createdAt:        new Date(Number(bill.created_at) * 1000).toISOString(),
  };
}

/**
 * Record a payment attempt on-chain.
 * signFn from makeSessionSignFn (auto-pay) or makeWalletSignFn (manual).
 *
 * @param {string}  publicKey   - caller's G... address
 * @param {function} signFn     - (xdrStr) => Promise<xdrStr>
 * @param {object}  entry       - { billId, billName, recipientAddress, amount, asset, txHash, status, error }
 */
export async function recordPayment(publicKey, signFn, entry) {
  const statusTagMap = { success: 'Success', failed: 'Failed', skipped: 'Skipped' };
  const statusTag = statusTagMap[entry.status] ?? 'Failed';
  const amountStroops = BigInt(Math.round(parseFloat(entry.amount) * 10_000_000));

  return invokeContract(
    publicKey, signFn, 'record_payment',
    addr(publicKey),
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

/**
 * Fetch full payment history for this wallet from the contract.
 * Returns [] for wallets with no history.
 */
export async function getPaymentHistory(publicKey) {
  const result = await queryContract(publicKey, 'get_payment_history', addr(publicKey));
  if (!Array.isArray(result)) return [];
  // Convert on-chain PaymentRecord to frontend shape (newest first)
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

/**
 * Convert frontend form data to raw contract call parameter values.
 */
export function frontendToContractParams(bill) {
  // 'monthly_day' is a frontend-only concept; maps to 'Monthly' on-chain + day_of_month
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
