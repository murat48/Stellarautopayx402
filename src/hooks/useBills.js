import { useState, useEffect, useCallback } from 'react';
import {
  getAllBills,
  addBill,
  pauseBill,
  deleteBill,
  updateStatus,
  updateNextDue,
  completeBill as completeBillOnChain,
  markPaid as markPaidOnChain,
  contractBillToFrontend,
  makeWalletSignFn,
  makeSessionSignFn,
} from '../utils/contractClient';

const CACHE_KEY     = 'stellar_autopay_bills_cache';
// Paid-keys guard: prevents re-triggering already-paid bills after page reload
// even when contract write failed (e.g. wallet kit popup was closed).
// This does NOT trigger transactions — it only blocks them.
const PAID_KEYS_KEY = 'stellar_autopay_paid_keys';

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveCache(bills) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(bills)); } catch {}
}

export function loadPaidKeys() {
  try {
    const raw = localStorage.getItem(PAID_KEYS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
function savePaidKey(key) {
  try {
    const keys = loadPaidKeys();
    keys.add(key);
    localStorage.setItem(PAID_KEYS_KEY, JSON.stringify([...keys]));
  } catch {}
}

export default function useBills(publicKey, signTransaction, getSessionKeypair) {
  // Start empty — bills only come from the on-chain contract, never from localStorage
  const [bills, setBills]               = useState([]);
  const [contractReady, setContractReady] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);

  // Write-only: persist contract data to localStorage for display caching (never used as source of truth)
  useEffect(() => { if (contractReady) saveCache(bills); }, [bills, contractReady]);

  // Fetch all bills from contract when wallet connects
  const fetchBills = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const raw = await getAllBills(publicKey);
      // Cross-check against the paid-keys guard so bills that were paid but
      // whose contract write failed don't re-appear as "active" after reload.
      const paidKeys = loadPaidKeys();
      const paidKey  = (b) => `${b.id}:${b.nextDueDate}`;
      const frontend = raw.map(contractBillToFrontend).map((b) => {
        if ((b.status === 'active' || b.status === 'low_balance') && paidKeys.has(paidKey(b))) {
          return { ...b, status: 'paid' };
        }
        return b;
      });
      setBills(frontend);
      setContractReady(true);
      setError(null);
    } catch (e) {
      console.warn('Contract fetch failed:', e.message);
      // Do NOT fall back to localStorage — keep bills empty until contract responds
      setContractReady(false);
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (publicKey) fetchBills();
    else { setBills([]); setContractReady(false); saveCache([]); }
  }, [publicKey, fetchBills]);

  // Auto-refresh every 30s so externally-paid bills disappear without manual reload
  useEffect(() => {
    if (!publicKey) return;
    const id = setInterval(() => fetchBills(), 30_000);
    return () => clearInterval(id);
  }, [publicKey, fetchBills]);

  // ── Add bill (wallet kit signs) ──────────────────────────────────────────
  const addBillFn = useCallback(async (bill) => {
    if (!publicKey || !signTransaction) return;
    setError(null);
    const signFn = getWalletSignFn();
    if (!signFn) { setError('Wallet not connected'); return; }
    try {
      const rawBill = await addBill(publicKey, signFn, bill);
      if (!rawBill) throw new Error('Contract returned no result');
      const newBill = contractBillToFrontend(rawBill);
      setBills((prev) => [...prev, newBill]);
      return newBill;
    } catch (e) {
      const msg = e?.message || String(e);
      setError('Failed to add bill: ' + msg);
      throw e;
    }
  }, [publicKey, signTransaction]); // eslint-disable-line

  // ── Pause / resume (wallet kit signs) ───────────────────────────────────
  const pauseBillFn = useCallback(async (id) => {
    if (!publicKey || !signTransaction) return;
    const bill = bills.find((b) => b.id === id);
    if (!bill) return;
    setError(null);
    const signFn = getWalletSignFn();
    if (!signFn) { setError('Wallet not connected'); return; }
    try {
      await pauseBill(publicKey, signFn, bill.contractId);
      setBills((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                status:
                  b.status === 'active' || b.status === 'low_balance'
                    ? 'paused'
                    : 'active',
              }
            : b
        )
      );
    } catch (e) {
      setError('Failed to pause bill: ' + (e?.message || String(e)));
    }
  }, [publicKey, signTransaction, bills]);

  // ── Delete (wallet kit signs) ────────────────────────────────────────────
  const deleteBillFn = useCallback(async (id) => {
    if (!publicKey || !signTransaction) return;
    const bill = bills.find((b) => b.id === id);
    if (!bill) return;
    setError(null);
    const signFn = getWalletSignFn();
    if (!signFn) { setError('Wallet not connected'); return; }
    try {
      await deleteBill(publicKey, signFn, bill.contractId);
      setBills((prev) => prev.filter((b) => b.id !== id));
    } catch (e) {
      setError('Failed to delete bill: ' + (e?.message || String(e)));
    }
  }, [publicKey, signTransaction, bills]);

  // ── Sign function factories ───────────────────────────────────────────
  // walletSignFn  — used for user-initiated actions (add, pause, delete)
  // sessionSignFn — used ONLY for auto-pay engine writes (markBillPaid, updateBill)
  //                 NEVER falls back to wallet kit to avoid unexpected popups.
  function getWalletSignFn() {
    if (signTransaction) return makeWalletSignFn(signTransaction, publicKey);
    return null;
  }
  function getSessionOnlySignFn() {
    const sessionKp = getSessionKeypair?.();
    if (sessionKp) return makeSessionSignFn(sessionKp);
    return null; // no session key → skip contract write, rely on paid-keys guard
  }

  // ── Update bill (auto-pay engine) ────────────────────────────────────────
  const updateBill = useCallback(async (id, updates, externalSignFn = null) => {
    const bill = bills.find((b) => b.id === id);
    if (!bill || !publicKey) return;

    // Optimistic local update immediately
    setBills((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...updates } : b))
    );

    const signFn = externalSignFn ?? getSessionOnlySignFn();
    if (!signFn) return; // no sign fn available → skip contract write

    // Best-effort retry for contract write (3 attempts, 2s apart)
    const tryWrite = async (writeFn) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await writeFn();
          return;
        } catch (e) {
          console.warn(`Contract write attempt ${attempt}/3 failed:`, e.message);
          if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
        }
      }
      console.error('Contract write failed after 3 attempts. Local state preserved; may be stale on reload.');
    };

    if (updates.nextDueDate) {
      await tryWrite(() => updateNextDue(publicKey, signFn, bill.contractId, updates.nextDueDate));
    }
    if (updates.status) {
      await tryWrite(() => updateStatus(publicKey, signFn, bill.contractId, updates.status));
    }
  }, [publicKey, getSessionKeypair, signTransaction, bills]); // eslint-disable-line

  // ── Complete one-time bill ────────────────────────────────────────────────
  // Session key only — never opens wallet kit popup.
  const completeBill = useCallback(async (id, externalSignFn = null) => {
    const bill = bills.find((b) => b.id === id);
    if (!bill || !publicKey) return;

    // Save to paid-keys guard FIRST (persists across reloads)
    savePaidKey(`${bill.id}:${bill.nextDueDate}`);

    // Optimistic UI update
    setBills((prev) =>
      prev.map((b) => (b.id === id ? { ...b, status: 'completed' } : b))
    );

    const signFn = externalSignFn ?? getSessionOnlySignFn();
    if (!signFn) return; // guard saved, contract will catch up on next session with auto-pay

    try {
      await completeBillOnChain(publicKey, signFn, bill.contractId);
    } catch (e) {
      console.warn('Contract complete failed (paid-keys guard active):', e.message);
    }
  }, [publicKey, getSessionKeypair, bills]); // eslint-disable-line

  // ── Mark bill as paid (money was sent on-chain) ──────────────────────────
  // The Stellar payment has ALREADY been sent to Horizon before this is called.
  // NEVER throw, NEVER revert UI, NEVER open wallet-kit popup.
  // Uses session key only; saves to paid-keys guard as permanent fallback.
  const markBillPaid = useCallback(async (id, externalSignFn = null) => {
    const bill = bills.find((b) => b.id === id);
    if (!bill || !publicKey) return;

    // Save to paid-keys guard FIRST — survives page reload even if contract write fails
    savePaidKey(`${bill.id}:${bill.nextDueDate}`);

    // Optimistic UI update — always apply
    setBills((prev) =>
      prev.map((b) => (b.id === id ? { ...b, status: 'paid' } : b))
    );

    // Use provided sign fn (session or wallet) → ensures on-chain write in both modes
    const signFn = externalSignFn ?? getSessionOnlySignFn();
    if (!signFn) return; // paid-keys guard is active; safe without contract write

    // Best-effort retry (3 attempts, 2s apart)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await markPaidOnChain(publicKey, signFn, bill.contractId);
        return; // success — contract is now authoritative
      } catch (e) {
        console.warn(`mark_paid attempt ${attempt}/3 failed:`, e.message);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
      }
    }
    console.warn('mark_paid permanently failed — paid-keys guard prevents re-payment on reload.');
  }, [publicKey, getSessionKeypair, bills]); // eslint-disable-line

  return {
    bills,
    contractReady,
    loading,
    error,
    addBill:    addBillFn,
    pauseBill:  pauseBillFn,
    deleteBill: deleteBillFn,
    updateBill,
    completeBill,
    markBillPaid,
    refreshBills: fetchBills,
  };
}
