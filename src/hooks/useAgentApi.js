import { useState, useEffect, useCallback } from 'react';

const AGENT_API_URL = `${import.meta.env.VITE_SERVER_URL || ''}/agent`;

export default function useAgentApi() {
  const [status, setStatus] = useState('unknown'); // 'online' | 'offline' | 'unknown'
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);

  const checkHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${AGENT_API_URL}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHealth(data);
      setStatus('online');
      setLastChecked(new Date());
    } catch {
      setStatus('offline');
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-check on mount
  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  return { status, health, loading, lastChecked, checkHealth };
}
