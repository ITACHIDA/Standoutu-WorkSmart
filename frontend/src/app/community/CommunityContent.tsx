'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
import TopNav from '../../components/TopNav';
import { api, API_BASE } from '../../lib/api';
import { useAuth } from '../../lib/useAuth';
import { Sidebar } from '../../components/community/Sidebar';
import { AvatarBubble, InfoRow } from '../../components/community/UIComponents';
import { useWebSocket } from '../../components/community/useWebSocket';
import {
  sortChannels,
  sortDms,
  upsertThread,
  dedupeMessages,
  formatDmTitle,
  formatTime,
  formatFullTime,
  formatDate,
  formatBytes,
} from '../../components/community/utils';
import type {
  CommunityChannel,
  CommunityDmThread,
  CommunityMessage,
  CommunityOverview,
  DirectoryUser,
  UnreadInfo,
  TypingIndicator,
  PinnedMessage,
  CommunityThreadType,
} from '../../components/community/types';

export function CommunityContent() {
  const { user, token } = useAuth();
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
  const [draftMessage, setDraftMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<CommunityMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<CommunityMessage | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showPinned, setShowPinned] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: CommunityMessage } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleWebSocketMessage = useMemo(
    () => (payload: any) => {
      if (payload.type === 'community_message' && payload.message && payload.threadId) {
        const incoming = payload.message;
        const threadId = payload.threadId;
        if (threadId === activeThreadId) {
          setMessages((prev) => dedupeMessages([...prev, incoming]));
        } else {
          setUnreadMap((prev) => {
            const newMap = new Map(prev);
            newMap.set(threadId, (newMap.get(threadId) || 0) + 1);
            return newMap;
          });
        }
        if (payload.threadType === 'CHANNEL') {
          setChannels((prev) =>
            prev.map((channel) =>
              channel.id === threadId ? { ...channel, lastMessageAt: incoming.createdAt } : channel,
            ),
          );
        }
        if (payload.threadType === 'DM') {
          setDms((prev) =>
            prev.map((dm) => (dm.id === threadId ? { ...dm, lastMessageAt: incoming.createdAt } : dm)),
          );
        }
      }

      if (payload.type === 'reaction_add' && payload.reaction) {
        const { messageId, emoji, userId } = payload.reaction;
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId) return msg;
            const reactions = msg.reactions || [];
            const existing = reactions.find((r) => r.emoji === emoji);
            if (existing) {
              return {
                ...msg,
                reactions: reactions.map((r) =>
                  r.emoji === emoji ? { ...r, count: r.count + 1, userIds: [...r.userIds, userId] } : r,
                ),
              };
            }
            return {
              ...msg,
              reactions: [...reactions, { emoji, count: 1, userIds: [userId] }],
            };
          }),
        );
      }

      if (payload.type === 'reaction_remove' && payload.reaction) {
        const { messageId, emoji, userId } = payload.reaction;
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId) return msg;
            const reactions = msg.reactions || [];
            return {
              ...msg,
              reactions: reactions
                .map((r) =>
                  r.emoji === emoji
                    ? { ...r, count: r.count - 1, userIds: r.userIds.filter((id) => id !== userId) }
                    : r,
                )
                .filter((r) => r.count > 0),
            };
          }),
        );
      }

      if (payload.type === 'typing' && payload.typing) {
        const { threadId, userId, userName, action } = payload.typing;
        if (userId === user?.id) return;
        setTypingUsers((prev) => {
          const newMap = new Map(prev);
          const current = newMap.get(threadId) || [];
          if (action === 'start') {
            if (!current.find((t) => t.userId === userId)) {
              newMap.set(threadId, [...current, { userId, userName }]);
            }
          } else {
            newMap.set(threadId, current.filter((t) => t.userId !== userId));
          }
          return newMap;
        });
      }

      if (payload.type === 'message_edited' && payload.edited) {
        const { messageId, body } = payload.edited;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId ? { ...msg, body, isEdited: true, editedAt: new Date().toISOString() } : msg,
          ),
        );
      }

      if (payload.type === 'message_deleted' && payload.deleted) {
        const { messageId } = payload.deleted;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId ? { ...msg, isDeleted: true, deletedAt: new Date().toISOString() } : msg,
          ),
        );
      }

      if (payload.type === 'message_pinned' && payload.pinned) {
        const { threadId, message } = payload.pinned;
        if (threadId === activeThreadId) {
          setPinnedMessages((prev) => {
            const newPin: PinnedMessage = {
              id: message.id,
              threadId,
              messageId: message.id,
              pinnedBy: user?.id || '',
              pinnedAt: new Date().toISOString(),
              message,
            };
            return [...prev, newPin];
          });
        }
      }

      if (payload.type === 'message_unpinned' && payload.unpinned) {
        const { messageId } = payload.unpinned;
        setPinnedMessages((prev) => prev.filter((pin) => pin.messageId !== messageId));
      }
    },
    [activeThreadId, user?.id],
  );

  const { wsRef } = useWebSocket({
    token,
    apiBase: API_BASE,
    user,
    activeThreadId,
    onMessage: handleWebSocketMessage,
  });

  useEffect(() => {
    if (!user || !token) return;
    void loadOverview(token);
    void loadDirectory(token);
  }, [user, token]);

  useEffect(() => {
    if (!activeThreadId || !token) {
      setMessages([]);
      setPinnedMessages([]);
      setHasMore(true);
      return;
    }
    void loadMessages(activeThreadId, token);
    void loadPinnedMessages(activeThreadId, token);
    void markAsRead(activeThreadId, token);
  }, [activeThreadId, token]);

  useEffect(() => {
    function handleClickOutside() {
      setContextMenu(null);
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!bottomRef.current) return;
    bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const activeChannel = useMemo(() => channels.find((c) => c.id === activeThreadId), [channels, activeThreadId]);
  const activeDm = useMemo(() => dms.find((d) => d.id === activeThreadId), [dms, activeThreadId]);
  const activeType: CommunityThreadType | null = activeChannel ? 'CHANNEL' : activeDm ? 'DM' : null;
  const activeLabel = activeChannel
    ? `# ${activeChannel.name ?? 'channel'}`
    : activeDm
      ? `@ ${formatDmTitle(activeDm)}`
      : 'Select a thread';
  const activeHint = activeChannel
    ? activeChannel.description || 'Stay aligned with the team.'
    : activeDm
      ? 'Direct message thread'
      : 'Choose a channel or DM to begin.';

  const channelList = useMemo(() => sortChannels(channels), [channels]);
  const dmLookup = useMemo(() => {
    const map = new Map<string, CommunityDmThread>();
    dms.forEach((dm) => {
      (dm.participants ?? []).forEach((participant) => {
        map.set(participant.id, dm);
      });
    });
    return map;
  }, [dms]);
  const memberList = useMemo(() => {
    const filtered = directory.filter((member) => member.id !== user?.id);
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [directory, user?.id]);

  const currentTyping = useMemo(() => {
    return typingUsers.get(activeThreadId) || [];
  }, [typingUsers, activeThreadId]);

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
      const data = await api<UnreadInfo[]>('/community/unread-summary', undefined, authToken);
      const newMap = new Map<string, number>();
      (data || []).forEach((info) => newMap.set(info.threadId, info.unreadCount));
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

  async function handleSendMessage() {
    if (!activeThreadId || !draftMessage.trim() || !token) return;
    if (selectedFiles.length > 0) {
      await handleUploadAndSend();
      return;
    }
    setSending(true);
    setError('');
    try {
      const payload: { body: string; replyToMessageId?: string } = { body: draftMessage.trim() };
      if (replyingTo) {
        payload.replyToMessageId = replyingTo.id;
      }
      const sent = await api<CommunityMessage>(
        `/community/threads/${activeThreadId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
        token,
      );
      setMessages((prev) => dedupeMessages([...prev, sent]));
      setDraftMessage('');
      setReplyingTo(null);
      if (activeType === 'CHANNEL') {
        setChannels((prev) =>
          sortChannels(prev.map((c) => (c.id === activeThreadId ? { ...c, lastMessageAt: sent.createdAt } : c))),
        );
      } else if (activeType === 'DM') {
        setDms((prev) =>
          sortDms(prev.map((d) => (d.id === activeThreadId ? { ...d, lastMessageAt: sent.createdAt } : d))),
        );
      }
    } catch (err) {
      console.error(err);
      setError('Unable to send message.');
    } finally {
      setSending(false);
    }
  }

  async function handleUploadAndSend() {
    if (!activeThreadId || !token || selectedFiles.length === 0) return;
    setUploading(true);
    setError('');
    try {
      const attachmentIds: string[] = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const formData = new FormData();
        formData.append('file', file);
        setUploadProgress(((i + 1) / selectedFiles.length) * 100);
        const uploaded = await api<{ id: string; url: string }>(
          '/community/upload',
          { method: 'POST', body: formData },
          token,
        );
        attachmentIds.push(uploaded.id);
      }
      const payload: { body: string; replyToMessageId?: string; attachmentIds?: string[] } = {
        body: draftMessage.trim() || 'Attachment',
        attachmentIds,
      };
      if (replyingTo) {
        payload.replyToMessageId = replyingTo.id;
      }
      const sent = await api<CommunityMessage>(
        `/community/threads/${activeThreadId}/messages`,
        { method: 'POST', body: JSON.stringify(payload) },
        token,
      );
      setMessages((prev) => dedupeMessages([...prev, sent]));
      setDraftMessage('');
      setReplyingTo(null);
      setSelectedFiles([]);
      setUploadProgress(0);
    } catch (err) {
      console.error(err);
      setError('Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function handleTyping() {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'typing:start', threadId: activeThreadId }));
    }
    typingTimeoutRef.current = setTimeout(() => {
      if (wsRef.current && wsRef.current.readyState === 1) {
        wsRef.current.send(JSON.stringify({ type: 'typing:stop', threadId: activeThreadId }));
      }
    }, 3000);
  }

  async function handleReaction(messageId: string, emoji: string) {
    if (!token) return;
    try {
      const msg = messages.find((m) => m.id === messageId);
      const hasReacted = msg?.reactions?.some(
        (r) => r.emoji === emoji && r.userIds.includes(user?.id || ''),
      );
      if (hasReacted) {
        await api(`/community/messages/${messageId}/reactions/${emoji}`, { method: 'DELETE' }, token);
      } else {
        await api(
          `/community/messages/${messageId}/reactions`,
          {
            method: 'POST',
            body: JSON.stringify({ emoji }),
          },
          token,
        );
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleEditMessage() {
    if (!editingMessage || !editDraft.trim() || !token) return;
    try {
      await api(
        `/community/messages/${editingMessage.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ body: editDraft.trim() }),
        },
        token,
      );
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === editingMessage.id
            ? { ...msg, body: editDraft.trim(), isEdited: true, editedAt: new Date().toISOString() }
            : msg,
        ),
      );
      setEditingMessage(null);
      setEditDraft('');
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDeleteMessage(messageId: string) {
    if (!token || !confirm('Delete this message?')) return;
    try {
      await api(`/community/messages/${messageId}`, { method: 'DELETE' }, token);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, isDeleted: true, deletedAt: new Date().toISOString() } : msg,
        ),
      );
    } catch (err) {
      console.error(err);
    }
  }

  async function handlePinMessage(messageId: string) {
    if (!token) return;
    try {
      await api(`/community/messages/${messageId}/pin`, { method: 'POST' }, token);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleUnpinMessage(messageId: string) {
    if (!token) return;
    try {
      await api(`/community/messages/${messageId}/pin`, { method: 'DELETE' }, token);
      setPinnedMessages((prev) => prev.filter((pin) => pin.messageId !== messageId));
    } catch (err) {
      console.error(err);
    }
  }

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
  }

  function handleScroll() {
    if (!messagesContainerRef.current) return;
    const { scrollTop } = messagesContainerRef.current;
    if (scrollTop === 0 && hasMore && !loadingMore) {
      void loadMoreMessages();
    }
  }

  const inputDisabled = !activeThreadId || sending || uploading;

  const layoutStyle = {
    '--community-accent': '#4ade80',
    '--community-ink': '#0b1224',
    '--community-soft': '#f1f5f9',
    '--community-line': '#e2e8f0',
    backgroundImage: 'radial-gradient(circle at 20% 20%, #ffffff 0%, #f1f5f9 45%, #e2e8f0 100%)',
    backgroundColor: '#f8fafc',
  } as CSSProperties;

  return (
    <main className="min-h-screen text-slate-900" style={layoutStyle}>
      <TopNav />
      <div className="mx-auto w-full max-w-screen-2xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="flex gap-4 overflow-x-auto pb-2">
          <Sidebar
            channels={channelList}
            dms={dms}
            memberList={memberList}
            activeThreadId={activeThreadId}
            unreadMap={unreadMap}
            overviewLoading={overviewLoading}
            creatingDmId={creatingDmId}
            dmLookup={dmLookup}
            onThreadSelect={setActiveThreadId}
            onStartDm={handleStartDm}
          />

          <section
            className="flex min-h-[70vh] min-w-[520px] flex-1 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm"
            style={{ animation: 'soft-rise 0.5s ease both', animationDelay: '60ms' }}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex-1">
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Thread</div>
                <h2 className="text-xl font-semibold text-slate-900">{activeLabel}</h2>
                <p className="text-xs text-slate-600">{activeHint}</p>
              </div>
              <div className="flex items-center gap-2">
                {pinnedMessages.length > 0 && (
                  <button
                    onClick={() => setShowPinned(!showPinned)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                  >
                    📌 {pinnedMessages.length} pinned
                  </button>
                )}
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600">
                  {activeType ? `${activeType === 'CHANNEL' ? 'Channel' : 'DM'} view` : 'Idle'}
                </div>
              </div>
            </div>

            {showPinned && pinnedMessages.length > 0 && (
              <div className="border-b border-slate-100 bg-amber-50 px-6 py-3">
                <div className="mb-2 text-xs font-semibold text-amber-900">Pinned Messages</div>
                <div className="space-y-2">
                  {pinnedMessages.map((pin) => (
                    <div key={pin.id} className="flex items-start gap-2 rounded-lg bg-white p-2 text-sm">
                      <div className="flex-1">
                        <div className="font-semibold text-slate-900">
                          {pin.message?.senderName || 'User'}
                        </div>
                        <div className="text-slate-700">{pin.message?.body || '[Message]'}</div>
                      </div>
                      <button
                        onClick={() => handleUnpinMessage(pin.messageId)}
                        className="text-xs text-slate-500 hover:text-red-600"
                      >
                        Unpin
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              ref={messagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 space-y-4 overflow-y-auto px-6 py-4"
            >
              {hasMore && !messagesLoading && (
                <div className="text-center">
                  <button
                    onClick={loadMoreMessages}
                    disabled={loadingMore}
                    className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
                  >
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              )}
              {messagesLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  Loading messages...
                </div>
              ) : messages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-600">
                  No messages yet. Say hello to get things moving.
                </div>
              ) : (
                messages.map((message) => {
                  const isSelf = message.senderId === user?.id;
                  const sender = isSelf ? 'You' : message.senderName || 'Member';
                  const isDeleted = message.isDeleted;
                  return (
                    <div key={message.id} className="flex items-start gap-3">
                      <AvatarBubble name={sender} active={isSelf} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold text-slate-900">{sender}</div>
                          <div className="text-[11px] text-slate-500">{formatFullTime(message.createdAt)}</div>
                          {message.isEdited && <span className="text-[10px] text-slate-400">(edited)</span>}
                        </div>
                        {message.replyPreview && (
                          <div className="mt-1 rounded-lg border-l-4 border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-600">
                            <div className="font-semibold">
                              {message.replyPreview.senderName || 'User'}
                            </div>
                            <div className="truncate">{message.replyPreview.body}</div>
                          </div>
                        )}
                        <div
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setContextMenu({ x: e.clientX, y: e.clientY, message });
                          }}
                          className={`mt-1 rounded-2xl px-4 py-3 text-sm ${
                            isDeleted
                              ? 'bg-slate-200 italic text-slate-500'
                              : isSelf
                                ? 'bg-[var(--community-accent)] text-[var(--community-ink)]'
                                : 'bg-[var(--community-soft)] text-slate-800'
                          }`}
                        >
                          {isDeleted ? '[Message deleted]' : message.body}
                        </div>
                        {message.attachments && message.attachments.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {message.attachments.map((att) => (
                              <div
                                key={att.id}
                                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2"
                              >
                                {att.mimeType.startsWith('image/') ? (
                                  <img
                                    src={att.fileUrl}
                                    alt={att.fileName}
                                    className="h-16 w-16 rounded object-cover"
                                  />
                                ) : (
                                  <div className="flex h-16 w-16 items-center justify-center rounded bg-slate-100 text-xs text-slate-600">
                                    📄
                                  </div>
                                )}
                                <div className="flex-1 text-xs">
                                  <div className="font-semibold text-slate-900">{att.fileName}</div>
                                  <div className="text-slate-500">{formatBytes(att.fileSize)}</div>
                                </div>
                                <a
                                  href={att.fileUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Download
                                </a>
                              </div>
                            ))}
                          </div>
                        )}
                        {message.reactions && message.reactions.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {message.reactions.map((reaction) => (
                              <button
                                key={reaction.emoji}
                                onClick={() => handleReaction(message.id, reaction.emoji)}
                                className={`rounded-full border px-2 py-1 text-xs transition ${
                                  reaction.userIds.includes(user?.id || '')
                                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                {reaction.emoji} {reaction.count}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="mt-1 flex items-center gap-2">
                          <button
                            onClick={() => handleReaction(message.id, '👍')}
                            className="text-xs text-slate-500 hover:text-slate-700"
                          >
                            👍
                          </button>
                          <button
                            onClick={() => setReplyingTo(message)}
                            className="text-xs text-slate-500 hover:text-slate-700"
                          >
                            Reply
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              {currentTyping.length > 0 && (
                <div className="text-xs italic text-slate-500">
                  {currentTyping.map((t) => t.userName).join(', ')}{' '}
                  {currentTyping.length === 1 ? 'is' : 'are'} typing...
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-slate-100 px-6 py-4">
              {replyingTo && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                  <div className="flex-1">
                    <div className="font-semibold">Replying to {replyingTo.senderName || 'User'}</div>
                    <div className="truncate text-slate-600">{replyingTo.body}</div>
                  </div>
                  <button onClick={() => setReplyingTo(null)} className="text-slate-500 hover:text-slate-700">
                    ✕
                  </button>
                </div>
              )}
              {editingMessage && (
                <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                  <div className="mb-1 text-xs font-semibold text-blue-900">Editing message</div>
                  <input
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleEditMessage();
                      }
                      if (e.key === 'Escape') {
                        setEditingMessage(null);
                        setEditDraft('');
                      }
                    }}
                    className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
                  />
                  <div className="mt-1 flex gap-2">
                    <button onClick={handleEditMessage} className="text-xs text-blue-600 hover:underline">
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingMessage(null);
                        setEditDraft('');
                      }}
                      className="text-xs text-slate-600 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {selectedFiles.length > 0 && (
                <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="mb-1 text-xs font-semibold text-slate-700">
                    {selectedFiles.length} file(s) selected
                  </div>
                  {uploading && (
                    <div className="h-2 rounded-full bg-slate-200">
                      <div
                        className="h-2 rounded-full bg-blue-500 transition-all"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  )}
                  <button
                    onClick={() => setSelectedFiles([])}
                    className="mt-1 text-xs text-slate-600 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              )}
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={inputDisabled}
                  className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  📎
                </button>
                <input
                  value={draftMessage}
                  onChange={(e) => {
                    setDraftMessage(e.target.value);
                    handleTyping();
                  }}
                  placeholder={activeThreadId ? `Message ${activeLabel}` : 'Select a thread to message'}
                  disabled={inputDisabled}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendMessage();
                    }
                  }}
                  className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-1 ring-transparent focus:ring-slate-300 disabled:bg-slate-100"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={inputDisabled || (!draftMessage.trim() && selectedFiles.length === 0)}
                  className="rounded-2xl bg-[var(--community-accent)] px-4 py-3 text-xs font-semibold text-[var(--community-ink)] shadow-[0_10px_25px_-16px_rgba(74,222,128,0.8)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sending || uploading ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
          </section>

          <aside
            className="w-[300px] shrink-0 space-y-4"
            style={{ animation: 'soft-rise 0.5s ease both', animationDelay: '120ms' }}
          >
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <p className="text-[11px] uppercase tracking-[0.26em] text-slate-500">Room info</p>
                <h3 className="text-lg font-semibold text-slate-900">
                  {activeType ? activeLabel : 'Community'}
                </h3>
              </div>
              <div className="mt-3 space-y-3 rounded-2xl border border-[var(--community-line)] bg-[var(--community-soft)] p-3 text-sm">
                {activeChannel ? (
                  <>
                    <InfoRow label="Name" value={activeChannel.name ?? 'channel'} />
                    <InfoRow label="Topic" value={activeChannel.description || 'Set a short description.'} />
                    <InfoRow label="Visibility" value={activeChannel.isPrivate ? 'Private' : 'Public'} />
                    <InfoRow label="Created" value={formatDate(activeChannel.createdAt)} />
                  </>
                ) : activeDm ? (
                  <>
                    <InfoRow label="Participants" value={formatDmTitle(activeDm)} />
                    <InfoRow label="Visibility" value={activeDm.isPrivate ? 'Private' : 'Public'} />
                    <InfoRow label="Created" value={formatDate(activeDm.createdAt)} />
                  </>
                ) : (
                  <div className="text-xs text-slate-500">Select a thread to see details and metadata.</div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-sm">
              Features: Reactions, replies, editing, file uploads, pinned messages, typing indicators, unread
              badges
            </div>
          </aside>
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.message.senderId === user?.id && !contextMenu.message.isDeleted && (
            <button
              onClick={() => {
                setEditingMessage(contextMenu.message);
                setEditDraft(contextMenu.message.body);
                setContextMenu(null);
              }}
              className="w-full rounded px-3 py-2 text-left text-xs hover:bg-slate-100"
            >
              Edit
            </button>
          )}
          <button
            onClick={() => {
              setReplyingTo(contextMenu.message);
              setContextMenu(null);
            }}
            className="w-full rounded px-3 py-2 text-left text-xs hover:bg-slate-100"
          >
            Reply
          </button>
          <button
            onClick={() => {
              void handlePinMessage(contextMenu.message.id);
              setContextMenu(null);
            }}
            className="w-full rounded px-3 py-2 text-left text-xs hover:bg-slate-100"
          >
            Pin
          </button>
          {(contextMenu.message.senderId === user?.id || user?.role === 'ADMIN') &&
            !contextMenu.message.isDeleted && (
              <button
                onClick={() => {
                  void handleDeleteMessage(contextMenu.message.id);
                  setContextMenu(null);
                }}
                className="w-full rounded px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            )}
        </div>
      )}
    </main>
  );
}