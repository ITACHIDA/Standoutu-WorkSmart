'use client';

export type ClientRole = 'ADMIN' | 'MANAGER' | 'BIDDER' | 'OBSERVER';

export type ClientUser = {
  id: string;
  email: string;
  name: string;
  role: ClientRole;
};

type StoredAuth = {
  user: ClientUser;
  token: string;
};

export function readAuth(): StoredAuth | null {
  if (typeof window === 'undefined') return null;
  try {
    const rawUser = window.localStorage.getItem('smartwork_user');
    const token = window.localStorage.getItem('smartwork_token');
    if (!rawUser || !token) return null;
    const user = JSON.parse(rawUser) as ClientUser;
    return { user, token };
  } catch {
    return null;
  }
}

export function saveAuth(user: ClientUser, token: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('smartwork_user', JSON.stringify(user));
  window.localStorage.setItem('smartwork_token', token);
}

export function clearAuth() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('smartwork_user');
  window.localStorage.removeItem('smartwork_token');
}
