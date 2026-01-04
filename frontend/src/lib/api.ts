import { readAuth } from './auth';

const LOCAL_API_PORT = 4000;

function resolveApiBase(): string {
  const envBase = (process.env.NEXT_PUBLIC_API_BASE || '').trim();
  if (envBase) return envBase.replace(/\/$/, '');
  if (typeof window === 'undefined') return '';
  const { protocol, hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:${LOCAL_API_PORT}`;
  }
  return window.location.origin;
}

export const API_BASE = resolveApiBase();

function buildApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = API_BASE || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!base) return path;
  return new URL(path, base).toString();
}

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
  
  // Don't set Content-Type for FormData - browser will set it with boundary
  if (init?.body && !(init.body instanceof FormData) && !mergedHeaders['Content-Type']) {
    mergedHeaders['Content-Type'] = 'application/json';
  }

  const url = buildApiUrl(path);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: mergedHeaders,
      cache: 'no-store',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error contacting API (${url}): ${message}`);
  }

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
