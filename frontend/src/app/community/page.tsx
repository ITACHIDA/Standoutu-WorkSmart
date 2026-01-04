'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import TopNav from '../../components/TopNav';
import { api, API_BASE } from '../../lib/api';
import { useAuth } from '../../lib/useAuth';

type CommunityThreadType = 'CHANNEL' | 'DM';

type CommunityChannel = {
  id: string;
  threadType: 'CHANNEL';
  name?: string | null;
  description?: string | null;
  isPrivate: boolean;
  createdAt: string;
  lastMessageAt?: string | null;
};

type CommunityDmThread = {
  id: string;
  threadType: 'DM';
  isPrivate: boolean;
  createdAt: string;
  lastMessageAt?: string | null;
  participants?: { id: string; name: string; email: string }[];
};

type CommunityMessage = {
  id: string;
  threadId: string;
  senderId: string;
  senderName?: string | null;
  body: string;
  createdAt: string;
};

type CommunityOverview = {
  channels: CommunityChannel[];
  dms: CommunityDmThread[];
};

type DirectoryUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export default function CommunityPage() {
  const router = useRouter();
  const { user, token, loading } = useAuth();
  const [channels, setChannels] = useState<CommunityChannel[]>([]);
  const [dms, setDms] = useState<CommunityDmThread[]>([]);
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>('');
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState('');
  const [creatingDmId, setCreatingDmId] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const activeThreadRef = useRef<string>('');
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      router.replace('/auth');
      return;
    }
    void loadOverview(token);
    void loadDirectory(token);
  }, [loading, user, token, router]);

  useEffect(() => {
    if (!activeThreadId || !token) {
      setMessages([]);
      return;
    }
    void loadMessages(activeThreadId, token);
  }, [activeThreadId, token]);

  useEffect(() => {
    activeThreadRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const base = API_BASE.startsWith('http') ? API_BASE : window.location.origin;
      const wsUrl = new URL('/ws/community', base);
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl.searchParams.set('token', token);
      const socket = new WebSocket(wsUrl.toString());
      wsRef.current = socket;

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as {
            type?: string;
            threadId?: string;
            threadType?: CommunityThreadType;
            message?: CommunityMessage;
          };
          if (payload.type !== 'community_message' || !payload.message || !payload.threadId) {
            return;
          }
          const incoming = payload.message;
          const threadId = payload.threadId;
          if (threadId === activeThreadRef.current) {
            setMessages((prev) => dedupeMessages([...prev, incoming]));
          }
          if (payload.threadType === 'CHANNEL') {
            setChannels((prev) =>
              prev.map((channel) =>
                channel.id === threadId
                  ? { ...channel, lastMessageAt: incoming.createdAt }
                  : channel,
              ),
            );
          }
          if (payload.threadType === 'DM') {
            setDms((prev) =>
              prev.map((dm) =>
                dm.id === threadId ? { ...dm, lastMessageAt: incoming.createdAt } : dm,
              ),
            );
          }
        } catch (err) {
          console.error('Failed to parse realtime message', err);
        }
      };

      socket.onclose = () => {
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        if (!cancelled) {
          reconnectTimerRef.current = setTimeout(connect, 2500);
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token]);

  useEffect(() => {
    if (!bottomRef.current) return;
    bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeThreadId),
    [channels, activeThreadId],
  );
  const activeDm = useMemo(
    () => dms.find((d) => d.id === activeThreadId),
    [dms, activeThreadId],
  );
  const activeType: CommunityThreadType | null = activeChannel
    ? 'CHANNEL'
    : activeDm
      ? 'DM'
      : null;
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

  async function loadOverview(authToken: string) {
    setOverviewLoading(true);
    setError('');
    try {
      const data = await api<CommunityOverview>('/community/overview', undefined, authToken);
      setChannels(data.channels ?? []);
      setDms(data.dms ?? []);
      setActiveThreadId((prev) => {
        const exists =
          (data.channels ?? []).some((c) => c.id === prev) ||
          (data.dms ?? []).some((d) => d.id === prev);
        if (exists) return prev;
        return data.channels?.[0]?.id ?? data.dms?.[0]?.id ?? '';
      });
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

  async function loadMessages(threadId: string, authToken: string) {
    setMessagesLoading(true);
    setError('');
    try {
      const list = await api<CommunityMessage[]>(
        `/community/threads/${threadId}/messages`,
        undefined,
        authToken,
      );
      setMessages(dedupeMessages(list ?? []));
    } catch (err) {
      console.error(err);
      setError('Failed to load messages.');
    } finally {
      setMessagesLoading(false);
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
    setSending(true);
    setError('');
    try {
      const sent = await api<CommunityMessage>(
        `/community/threads/${activeThreadId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ body: draftMessage.trim() }),
        },
        token,
      );
      setMessages((prev) => dedupeMessages([...prev, sent]));
      setDraftMessage('');
      if (activeType === 'CHANNEL') {
        setChannels((prev) =>
          sortChannels(
            prev.map((c) =>
              c.id === activeThreadId ? { ...c, lastMessageAt: sent.createdAt } : c,
            ),
          ),
        );
      } else if (activeType === 'DM') {
        setDms((prev) =>
          sortDms(
            prev.map((d) =>
              d.id === activeThreadId ? { ...d, lastMessageAt: sent.createdAt } : d,
            ),
          ),
        );
      }
    } catch (err) {
      console.error(err);
      setError('Unable to send message.');
    } finally {
      setSending(false);
    }
  }

  const inputDisabled = !activeThreadId || sending;
  const layoutStyle = {
    '--community-accent': '#4ade80',
    '--community-ink': '#0b1224',
    '--community-soft': '#f1f5f9',
    '--community-line': '#e2e8f0',
    backgroundImage:
      'radial-gradient(circle at 20% 20%, #ffffff 0%, #f1f5f9 45%, #e2e8f0 100%)',
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
          <aside
            className="w-[260px] shrink-0 space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
            style={{ animation: 'soft-rise 0.5s ease both' }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.26em] text-slate-500">
                  Community
                </p>
                <h1 className="text-lg font-semibold text-slate-900">Shared space</h1>
              </div>
              <span className="rounded-full bg-[var(--community-ink)] px-3 py-1 text-[10px] font-semibold text-[var(--community-accent)]">
                Live
              </span>
            </div>

            <div className="space-y-3">
              <SectionHeader title="Channels" count={channelList.length} />
              {overviewLoading && !channelList.length ? (
                <div className="border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
                  Loading channels...
                </div>
              ) : channelList.length === 0 ? (
                <div className="border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
                  No channels yet.
                </div>
              ) : (
                <div className="border border-slate-200 bg-white">
                  {channelList.map((channel) => {
                    const active = channel.id === activeThreadId;
                    return (
                      <button
                        key={channel.id}
                        onClick={() => setActiveThreadId(channel.id)}
                        className={`flex w-full items-center justify-between border-b border-slate-200 px-3 py-2 text-left text-sm transition last:border-b-0 ${
                          active
                            ? 'bg-[var(--community-ink)] text-white'
                            : 'text-slate-700 hover:bg-[var(--community-soft)]'
                        }`}
                      >
                        <div className="flex flex-col">
                          <span className="flex items-center gap-2 font-semibold">
                            <span
                              className={`text-xs font-semibold ${
                                active ? 'text-[var(--community-accent)]' : 'text-slate-400'
                              }`}
                            >
                              #
                            </span>
                            {channel.name ?? 'channel'}
                          </span>
                          {channel.description ? (
                            <span
                              className={`text-[11px] ${
                                active ? 'text-slate-200' : 'text-slate-500'
                              }`}
                            >
                              {channel.description}
                            </span>
                          ) : null}
                        </div>
                        <span
                          className={`text-[10px] ${
                            active ? 'text-slate-200' : 'text-slate-400'
                          }`}
                        >
                          {formatTime(channel.lastMessageAt ?? channel.createdAt)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-900">Direct Message</div>
              <div className="max-h-[340px] space-y-2 overflow-y-auto pr-1">
                {overviewLoading && memberList.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    Loading members...
                  </div>
                ) : memberList.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                    No members available.
                  </div>
                ) : (
                  memberList.map((member) => {
                    const isStarting = creatingDmId === member.id;
                    return (
                        <button
                          key={member.id}
                          onClick={() => void handleStartDm(member.id)}
                          disabled={Boolean(creatingDmId)}
                          className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:bg-[var(--community-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <AvatarBubble name={member.name} active={false} />
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              {member.name}
                            </div>
                            {isStarting ? (
                              <div className="mt-1 text-[10px] text-slate-500">Starting DM...</div>
                            ) : null}
                          </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </aside>

          <section
            className="flex min-h-[70vh] min-w-[520px] flex-1 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm"
            style={{ animation: 'soft-rise 0.5s ease both', animationDelay: '60ms' }}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Thread</div>
                <h2 className="text-xl font-semibold text-slate-900">{activeLabel}</h2>
                <p className="text-xs text-slate-600">{activeHint}</p>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600">
                {activeType ? `${activeType === 'CHANNEL' ? 'Channel' : 'DM'} view` : 'Idle'}
              </div>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
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
                  const sender = isSelf
                    ? 'You'
                    : message.senderName || 'Member';
                  return (
                    <div key={message.id} className="flex items-start gap-3">
                      <AvatarBubble name={sender} active={isSelf} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold text-slate-900">{sender}</div>
                          <div className="text-[11px] text-slate-500">
                            {formatFullTime(message.createdAt)}
                          </div>
                        </div>
                        <div
                          className={`mt-1 rounded-2xl px-4 py-3 text-sm ${
                            isSelf
                              ? 'bg-[var(--community-accent)] text-[var(--community-ink)]'
                              : 'bg-[var(--community-soft)] text-slate-800'
                          }`}
                        >
                          {message.body}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>
            <div className="border-t border-slate-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <input
                  value={draftMessage}
                  onChange={(e) => setDraftMessage(e.target.value)}
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
                  disabled={inputDisabled || !draftMessage.trim()}
                  className="rounded-2xl bg-[var(--community-accent)] px-4 py-3 text-xs font-semibold text-[var(--community-ink)] shadow-[0_10px_25px_-16px_rgba(74,222,128,0.8)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sending ? 'Sending...' : 'Send'}
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
                    <InfoRow
                      label="Topic"
                      value={activeChannel.description || 'Set a short description.'}
                    />
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
                  <div className="text-xs text-slate-500">
                    Select a thread to see details and metadata.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-sm">
              Keep messages focused. Channels keep topics on track, DMs handle quick decisions.
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function sortChannels(list: CommunityChannel[]) {
  return [...list].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

function sortDms(list: CommunityDmThread[]) {
  return [...list].sort((a, b) => {
    const aTime = new Date(a.lastMessageAt ?? a.createdAt).getTime();
    const bTime = new Date(b.lastMessageAt ?? b.createdAt).getTime();
    return bTime - aTime;
  });
}

function upsertThread<T extends { id: string }>(list: T[], thread: T) {
  const existing = list.find((item) => item.id === thread.id);
  if (!existing) return [thread, ...list];
  return list.map((item) => (item.id === thread.id ? thread : item));
}

function dedupeMessages(list: CommunityMessage[]) {
  const seen = new Set<string>();
  const unique: CommunityMessage[] = [];
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

function formatDmTitle(dm: CommunityDmThread) {
  const participants = dm.participants ?? [];
  if (participants.length === 0) return 'Direct message';
  return participants.map((p) => p.name || p.email).filter(Boolean).join(', ');
}

function formatTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatFullTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{title}</div>
      <span className="h-px flex-1 bg-[var(--community-line)]" />
      {typeof count === 'number' ? (
        <span className="rounded-full bg-[var(--community-soft)] px-2 py-0.5 text-[10px] text-slate-600">
          {count}
        </span>
      ) : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="text-sm text-slate-900">{value}</div>
    </div>
  );
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M4 4h16v10H7l-3 3V4zm2 2v7.17L6.83 12H18V6H6z" />
    </svg>
  );
}

function AvatarBubble({ name, active }: { name: string; active: boolean }) {
  const initials = name
    .split(' ')
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ${
        active ? 'bg-[var(--community-accent)] text-[var(--community-ink)]' : 'bg-slate-900 text-white'
      }`}
    >
      {initials || 'DM'}
    </span>
  );
}
