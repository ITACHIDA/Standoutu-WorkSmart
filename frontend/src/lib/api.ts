import { readAuth } from './auth';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
  tokenOverride?: string | null,
): Promise<T> {
  const bearer =
    tokenOverride ??
    (typeof window !== 'undefined' ? readAuth()?.token ?? undefined : undefined);

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}
