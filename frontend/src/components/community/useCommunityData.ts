import { useState, useEffect, useRef, useMemo } from 'react';
import { api, API_BASE } from '../../lib/api';
import type {
  CommunityChannel,
  CommunityDmThread,
  CommunityMessage,
  CommunityOverview,
  DirectoryUser,
  UnreadInfo,
  TypingIndicator,
  PinnedMessage,
} from './types';
import {
  sortChannels,
  sortDms,
  upsertThread,
  dedupeMessages,
} from './utils';

interface UseCommunityDataProps {
  token: string | null;
  userId?: string;
}

export function useCommunityData({ token, userId }: UseCommunityDataProps) {
  const [channels, setChannels] = useState<CommunityChannel[]>([]);
  const [dms, setDms] = useState<CommunityDmThread[]>([]);
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>('');
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [unreadMap, setUnreadMap] = useState<Map<string, number>>(new Map());
  const [typingUsers, setTypingUsers] = useState<Map<string, TypingIndicator[]>>(new Map());
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState('');
  const [creatingDmId, setCreatingDmId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const dmLookup = useMemo(() => {
    const map = new Map<string, CommunityDmThread>();
    dms.forEach((dm) => {
      (dm.participants ?? []).forEach((participant) => {
        map.set(participant.id, dm);
      });
    });
    return map;
  }, [dms]);

  async function loadOverview(authToken: string) {
    setOverviewLoading(true);
    setError('');
    try {
      const data = await api<CommunityOverview>('/community/overview', undefined, authToken);
      setChannels(data.channels ?? []);
      setDms(data.dms ?? []);
      setActiveThreadId((prev) => {
        const exists =
          (data.channels ?? []).some((c) => c.id === prev) || (data.dms ?? []).some((d) => d.id === prev);
        if (exists) return prev;
        return data.channels?.[0]?.id ?? data.dms?.[0]?.id ?? '';
      });
      await loadUnreadCounts(authToken);
    } catch (err) {
      console.error(err);
      setError('Failed to load community overview.');
    } finally {
      setOverviewLoading(false);
    }
  }

  async function loadDirectory(authToken: string) {
    try {
      const list = await api<DirectoryUser[]>('/users', undefined, authToken);
      setDirectory(list ?? []);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadUnreadCounts(authToken: string) {
    try {
      const data = await api<{ unreads: UnreadInfo[] }>('/community/unread-summary', undefined, authToken);
      const newMap = new Map<string, number>();
      const unreads = data?.unreads || [];
      (Array.isArray(unreads) ? unreads : []).forEach((info) => newMap.set(info.threadId, info.unreadCount));
      setUnreadMap(newMap);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadMessages(threadId: string, authToken: string) {
    setMessagesLoading(true);
    setError('');
    try {
      const list = await api<CommunityMessage[]>(
        `/community/threads/${threadId}/messages?limit=50`,
        undefined,
        authToken,
      );
      setMessages(dedupeMessages(list ?? []));
      setHasMore((list || []).length === 50);
    } catch (err) {
      console.error(err);
      setError('Failed to load messages.');
    } finally {
      setMessagesLoading(false);
    }
  }

  async function loadMoreMessages() {
    if (!activeThreadId || !token || !hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const oldestId = messages[0]?.id;
      const list = await api<CommunityMessage[]>(
        `/community/threads/${activeThreadId}/messages?before=${oldestId}&limit=50`,
        undefined,
        token,
      );
      setMessages((prev) => dedupeMessages([...(list ?? []), ...prev]));
      setHasMore((list || []).length === 50);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadPinnedMessages(threadId: string, authToken: string) {
    try {
      const list = await api<PinnedMessage[]>(`/community/threads/${threadId}/pins`, undefined, authToken);
      setPinnedMessages(list ?? []);
    } catch (err) {
      console.error(err);
    }
  }

  async function markAsRead(threadId: string, authToken: string) {
    try {
      await api(`/community/threads/${threadId}/mark-read`, { method: 'POST' }, authToken);
      setUnreadMap((prev) => {
        const newMap = new Map(prev);
        newMap.delete(threadId);
        return newMap;
      });
    } catch (err) {
      console.error(err);
    }
  }

  async function handleStartDm(targetId: string) {
    if (!targetId || !token) return;
    const existing = dmLookup.get(targetId);
    if (existing) {
      setActiveThreadId(existing.id);
      return;
    }
    setCreatingDmId(targetId);
    setError('');
    try {
      const created = await api<CommunityDmThread>(
        '/community/dms',
        {
          method: 'POST',
          body: JSON.stringify({ userId: targetId }),
        },
        token,
      );
      setDms((prev) => sortDms(upsertThread(prev, created)));
      setActiveThreadId(created.id);
    } catch (err) {
      console.error(err);
      setError('Unable to start the DM.');
    } finally {
      setCreatingDmId(null);
    }
  }

  return {
    channels,
    setChannels,
    dms,
    setDms,
    messages,
    setMessages,
    activeThreadId,
    setActiveThreadId,
    directory,
    unreadMap,
    setUnreadMap,
    typingUsers,
    setTypingUsers,
    pinnedMessages,
    setPinnedMessages,
    overviewLoading,
    messagesLoading,
    error,
    setError,
    creatingDmId,
    hasMore,
    loadingMore,
    dmLookup,
    loadOverview,
    loadDirectory,
    loadMessages,
    loadMoreMessages,
    loadPinnedMessages,
    markAsRead,
    handleStartDm,
  };
}