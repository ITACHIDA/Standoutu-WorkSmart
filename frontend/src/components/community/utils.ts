import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sortChannels<T extends { name?: string | null }>(list: T[]) {
  return [...list].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

export function sortDms<T extends { lastMessageAt?: string | null; createdAt: string }>(list: T[]) {
  return [...list].sort((a, b) => {
    const aTime = new Date(a.lastMessageAt ?? a.createdAt).getTime();
    const bTime = new Date(b.lastMessageAt ?? b.createdAt).getTime();
    return bTime - aTime;
  });
}

export function upsertThread<T extends { id: string }>(list: T[], thread: T) {
  const existing = list.find((item) => item.id === thread.id);
  if (!existing) return [thread, ...list];
  return list.map((item) => (item.id === thread.id ? thread : item));
}

export function dedupeMessages<T extends { id?: string }>(list: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const message of list) {
    if (!message.id || !seen.has(message.id)) {
      if (message.id) {
        seen.add(message.id);
      }
      unique.push(message);
    }
  }
  return unique;
}

export function formatDmTitle(dm: { participants?: { name: string; email: string }[] }) {
  const participants = dm.participants ?? [];
  if (participants.length === 0) return 'Direct message';
  return participants.map((p) => p.name || p.email).filter(Boolean).join(', ');
}

export function formatTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatFullTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
