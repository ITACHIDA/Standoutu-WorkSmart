'use client';

import { useEffect, useState } from 'react';
import { clearAuth, ClientUser, readAuth } from './auth';

export function useAuth() {
  const [user, setUser] = useState<ClientUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = readAuth();
    setUser(stored?.user ?? null);
    setToken(stored?.token ?? null);
    setLoading(false);
  }, []);

  const refresh = () => {
    const stored = readAuth();
    setUser(stored?.user ?? null);
    setToken(stored?.token ?? null);
  };

  const signOut = () => {
    clearAuth();
    if (typeof window !== 'undefined') {
      window.location.href = '/auth';
    }
  };

  return { user, token, loading, refresh, signOut };
}
