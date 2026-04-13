import { useState, useCallback, useRef } from 'react';
import { recordPayment, getPaymentHistory } from '../utils/contractClient';

/**
 * Payment history backed by the Soroban contract.
 *
 * - On wallet connect, call `loadHistory(publicKey)` to fetch on-chain records.
 * - `addEntry(entry, publicKey, signFn)` writes to the contract then updates local state.
 * - Local state mirrors on-chain data for instant UI updates without re-fetching.
 */
export default function usePaymentHistory() {
  const [history, setHistory] = useState([]);
  const loadedRef = useRef(false);

  /** Fetch full history from contract. Call once on wallet connect. */
  const loadHistory = useCallback(async (publicKey) => {
    if (!publicKey || loadedRef.current) return;
    try {
      const records = await getPaymentHistory(publicKey);
      setHistory(records);
      loadedRef.current = true;
    } catch (err) {
      console.warn('Could not load payment history from contract:', err.message);
    }
  }, []);

  /**
   * Record a payment on-chain and update local state immediately.
   *
   * @param {object}   entry      - { billId, billName, recipientAddress, amount, asset, txHash, status, error }
   * @param {string}   publicKey  - caller's G... address
   * @param {function} signFn     - (xdrStr) => Promise<xdrStr>  — session key or wallet kit
   */
  const addEntry = useCallback(async (entry, publicKey, signFn) => {
    // Optimistic local update — instant UI feedback
    const localEntry = {
      ...entry,
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
    };
    setHistory((prev) => [localEntry, ...prev]);

    // Write to contract — retry up to 3x with backoff to handle
    // sequence-number races that occur right after a payment tx.
    if (publicKey && signFn) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await recordPayment(publicKey, signFn, entry);
          break;
        } catch (err) {
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
            continue;
          }
          console.warn('Could not record payment on contract:', err.message);
        }
      }
    }
  }, []);

  /** Reset on disconnect */
  const clearHistory = useCallback(() => {
    setHistory([]);
    loadedRef.current = false;
  }, []);

  return { history, addEntry, loadHistory, clearHistory };
}
