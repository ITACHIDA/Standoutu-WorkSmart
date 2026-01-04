import { readAuth } from './auth';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
  tokenOverride?: string | null,
): Promise<T> {
  const bearer =
    tokenOverride ??
    (typeof window !== 'undefined' ? readAuth()?.token ?? undefined : undefined);

  const mergedHeaders: Record<string, string> = {
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body && !mergedHeaders['Content-Type']) {
    mergedHeaders['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: mergedHeaders,
    cache: 'no-store',
  });

  if (!res.ok) {
    if (res.status === 401) {
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem('smartwork_user');
          localStorage.removeItem('smartwork_token');
          window.location.href = '/auth';
        } catch (err) {
          console.error('Failed clearing auth after 401', err);
        }
      }
      throw new Error('Unauthorized');
    }
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}
