'use client';

import { useSyncExternalStore } from 'react';
import { clearAuth, getAuthSnapshot, notifyAuthChange, subscribeAuth } from './auth';

export function useAuth() {
  const auth = useSyncExternalStore(subscribeAuth, getAuthSnapshot, () => null);

  const user = auth?.user ?? null;
  const token = auth?.token ?? null;
  const loading = typeof window === 'undefined';

  const refresh = () => {
    notifyAuthChange();
  };

  const signOut = () => {
    clearAuth();
    if (typeof window !== 'undefined') {
      window.location.href = '/auth';
    }
  };

  return { user, token, loading, refresh, signOut };
}
