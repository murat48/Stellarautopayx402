import { useState, useCallback, useRef, useEffect } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import { Networks as KitNetworks } from '@creit.tech/stellar-wallets-kit/types';
import { FreighterModule, FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr';
import { xBullModule } from '@creit.tech/stellar-wallets-kit/modules/xbull';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
import {
  fetchBalances,
  buildAddSignerTx,
  buildRemoveSignerTx,
  submitTx,
  NETWORK_PASSPHRASE,
} from '../utils/stellar';

const KIT_NETWORK = KitNetworks.TESTNET;

let kitInitialized = false;
function ensureKit() {
  if (kitInitialized) return;
  StellarWalletsKit.init({
    modules: [
      new FreighterModule(),
      new xBullModule(),
      new LobstrModule(),
      new AlbedoModule(),
    ],
    selectedWalletId: FREIGHTER_ID,
    network: KIT_NETWORK,
  });
  kitInitialized = true;
}

export default function useWallet() {
  const [publicKey, setPublicKey] = useState(null);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoPayEnabled, setAutoPayEnabled] = useState(false);
  const [autoPayLoading, setAutoPayLoading] = useState(false);
  const sessionKeypairRef = useRef(null);

  useEffect(() => {
    ensureKit();
  }, []);

  // Step 1: Connect wallet via modal, then immediately enable auto-pay
  const connect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      ensureKit();
      const { address } = await StellarWalletsKit.authModal();
      const bal = await fetchBalances(address);
      setPublicKey(address);
      setBalances(bal);

      // Auto-enable auto-pay right after wallet connection
      setAutoPayLoading(true);
      try {
        const sessionKp = Keypair.random();
        const sessionPub = sessionKp.publicKey();

        const tryEnable = async () => {
          const xdr = await buildAddSignerTx(address, sessionPub);
          const signResult = await StellarWalletsKit.signTransaction(xdr, {
            networkPassphrase: NETWORK_PASSPHRASE,
            address,
          });
          const signedTxXdr = typeof signResult === 'string' ? signResult : signResult?.signedTxXdr;
          if (!signedTxXdr) throw new Error('Wallet did not return a signed transaction.');
          return submitTx(signedTxXdr);
        };

        try {
          await tryEnable();
        } catch (firstErr) {
          const codes = firstErr?.stellarResultCodes;
          if (codes?.transaction === 'tx_bad_seq') {
            console.warn('Auto-pay: tx_bad_seq — rebuilding and retrying...');
            await tryEnable();
          } else {
            throw firstErr;
          }
        }

        sessionKeypairRef.current = sessionKp;
        setAutoPayEnabled(true);
      } catch (apErr) {
        const msg = apErr?.message || String(apErr);
        if (!msg.includes('cancel') && !msg.includes('dismiss') && !msg.includes('User declined') && !msg.includes('rejected')) {
          setError('Auto-pay setup failed: ' + msg);
        }
        // If user cancelled auto-pay setup, stay connected but auto-pay stays off
      } finally {
        setAutoPayLoading(false);
      }
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('cancel') || msg.includes('dismiss')) {
        setError(null); // user cancelled
      } else if (msg.includes('404') || msg.includes('Not Found')) {
        setError('Account not found on testnet. Fund it first via friendbot.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Step 2: Enable auto-pay by creating a session signer
  const enableAutoPay = useCallback(async () => {
    if (!publicKey) return;
    setAutoPayLoading(true);
    setError(null);
    try {
      // Generate a temporary keypair in memory
      const sessionKp = Keypair.random();
      const sessionPub = sessionKp.publicKey();

      // Build setOptions tx — rebuild and retry once on tx_bad_seq
      const tryEnable = async () => {
        const xdr = await buildAddSignerTx(publicKey, sessionPub);

        // User signs via wallet kit (Freighter popup etc.) — ONE time
        const signResult = await StellarWalletsKit.signTransaction(xdr, {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: publicKey,
        });
        const signedTxXdr = typeof signResult === 'string' ? signResult : signResult?.signedTxXdr;
        if (!signedTxXdr) throw new Error('Wallet did not return a signed transaction.');
        return submitTx(signedTxXdr);
      };

      try {
        await tryEnable();
      } catch (firstErr) {
        // tx_bad_seq means the account sequence changed between build and submit
        // (e.g. another tx was sent in the meantime). Rebuild and retry once.
        const codes = firstErr?.stellarResultCodes;
        if (codes?.transaction === 'tx_bad_seq') {
          console.warn('Auto-pay: tx_bad_seq — rebuilding and retrying...');
          await tryEnable();
        } else {
          throw firstErr;
        }
      }

      // Store session keypair in memory only — never in localStorage
      sessionKeypairRef.current = sessionKp;
      setAutoPayEnabled(true);
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('cancel') || msg.includes('dismiss') || msg.includes('User declined') || msg.includes('rejected')) {
        setError(null);
      } else {
        setError('Failed to enable auto-pay: ' + msg);
      }
    } finally {
      setAutoPayLoading(false);
    }
  }, [publicKey]);

  // Disable auto-pay by removing session signer
  const disableAutoPay = useCallback(async () => {
    if (!publicKey || !sessionKeypairRef.current) return;
    setAutoPayLoading(true);
    setError(null);
    try {
      const sessionPub = sessionKeypairRef.current.publicKey();
      const xdr = await buildRemoveSignerTx(publicKey, sessionPub);

      const signResult = await StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: publicKey,
      });
      const signedTxXdr = typeof signResult === 'string' ? signResult : signResult?.signedTxXdr;
      if (!signedTxXdr) throw new Error('Wallet did not return a signed transaction.');

      await submitTx(signedTxXdr);
      sessionKeypairRef.current = null;
      setAutoPayEnabled(false);
    } catch (e) {
      const msg = e?.message || String(e);
      if (!msg.includes('cancel') && !msg.includes('dismiss')) {
        setError('Failed to disable auto-pay: ' + msg);
      }
    } finally {
      setAutoPayLoading(false);
    }
  }, [publicKey]);

  const getSessionKeypair = useCallback(() => sessionKeypairRef.current, []);

  // Wallet kit sign wrapper — used by contract client for bill operations
  const signTransaction = useCallback(async (xdr, opts) => {
    return StellarWalletsKit.signTransaction(xdr, opts);
  }, []);

  // Sign an XDR tx via wallet kit then submit — used for manual payments when auto-pay is OFF
  const walletSignAndSubmit = useCallback(async (xdr) => {
    if (!publicKey) throw new Error('Wallet not connected');
    const signResult = await StellarWalletsKit.signTransaction(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: publicKey,
    });
    const signedTxXdr = typeof signResult === 'string' ? signResult : signResult?.signedTxXdr;
    if (!signedTxXdr) throw new Error('Wallet did not return a signed transaction.');
    return submitTx(signedTxXdr);
  }, [publicKey]);

  const refreshBalance = useCallback(async () => {
    if (!publicKey) return;
    try {
      const bal = await fetchBalances(publicKey);
      setBalances(bal);
    } catch {
      // silent refresh failure
    }
  }, [publicKey]);

  const disconnect = useCallback(async () => {
    // If auto-pay is on, try to remove the session signer first
    if (sessionKeypairRef.current && publicKey) {
      try {
        const sessionPub = sessionKeypairRef.current.publicKey();
        const xdr = await buildRemoveSignerTx(publicKey, sessionPub);
        const sr = await StellarWalletsKit.signTransaction(xdr, {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: publicKey,
        });
        const sXdr = typeof sr === 'string' ? sr : sr?.signedTxXdr;
        if (sXdr) await submitTx(sXdr);
      } catch {
        // Best effort — session key will remain as signer but has no funds
      }
    }
    sessionKeypairRef.current = null;
    try {
      await StellarWalletsKit.disconnect();
    } catch {
      // ignore
    }
    setPublicKey(null);
    setBalances({});
    setError(null);
    setAutoPayEnabled(false);
  }, [publicKey]);

  return {
    publicKey,
    balances,
    loading,
    error,
    autoPayEnabled,
    autoPayLoading,
    connect,
    disconnect,
    enableAutoPay,
    disableAutoPay,
    refreshBalance,
    getSessionKeypair,
    signTransaction,
    walletSignAndSubmit,
  };
}
