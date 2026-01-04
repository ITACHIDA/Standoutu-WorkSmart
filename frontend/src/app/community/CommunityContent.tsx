'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import TopNav from '../../components/TopNav';
import { API_BASE } from '../../lib/api';
import { useAuth } from '../../lib/useAuth';
import { Sidebar } from '../../components/community/Sidebar';
import { useWebSocket } from '../../components/community/useWebSocket';
import { MessageList } from '../../components/community/MessageList';
import { MessageInput } from '../../components/community/MessageInput';
import { ContextMenu } from '../../components/community/ContextMenu';
import { PinnedMessages } from '../../components/community/PinnedMessages';
import { ThreadInfo } from '../../components/community/ThreadInfo';
import { useCommunityData } from '../../components/community/useCommunityData';
import { useMessageActions } from '../../components/community/useMessageActions';
import {
  sortChannels,
  formatDmTitle,
  dedupeMessages,
} from '../../components/community/utils';
import type {
  CommunityMessage,
  TypingIndicator,
  PinnedMessage,
} from '../../components/community/types';

export function CommunityContent() {
  const { user, token } = useAuth();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: CommunityMessage } | null>(null);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [showPinned, setShowPinned] = useState(false);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const communityData = useCommunityData({ token, userId: user?.id });
  const {
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
  } = communityData;

  const activeChannel = useMemo(() => channels.find((c) => c.id === activeThreadId), [channels, activeThreadId]);
  const activeDm = useMemo(() => dms.find((d) => d.id === activeThreadId), [dms, activeThreadId]);
  const activeType = activeChannel ? 'CHANNEL' : activeDm ? 'DM' : null;
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
  const memberList = useMemo(() => {
    const filtered = directory.filter((member) => member.id !== user?.id);
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [directory, user?.id]);

  const currentTyping = useMemo(() => {
    return typingUsers.get(activeThreadId) || [];
  }, [typingUsers, activeThreadId]);

  const messageActions = useMessageActions({
    token,
    activeThreadId,
    activeType,
    userId: user?.id,
  });

  const {
    draftMessage,
    setDraftMessage,
    sending,
    replyingTo,
    setReplyingTo,
    editingMessage,
    setEditingMessage,
    editDraft,
    setEditDraft,
    uploading,
    uploadProgress,
    selectedFiles,
    setSelectedFiles,
    previewUrls,
    setPreviewUrls,
    handleSendMessage,
    handleTyping,
    handleReaction,
    handleEditMessage,
    handleDeleteMessage,
    handlePinMessage,
    handleUnpinMessage,
    handleFileSelect,
  } = messageActions;

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

      if (payload.type === 'message_edited' && payload.edited) {        const { messageId, body } = payload.edited;
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
    [activeThreadId, user?.id, setMessages, setUnreadMap, setChannels, setDms, setTypingUsers, setPinnedMessages],
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
    if (scrollToMessageId) {
      const messageEl = messageRefs.current.get(scrollToMessageId);
      if (messageEl) {
        messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        messageEl.classList.add('highlight-message');
        setTimeout(() => {
          messageEl.classList.remove('highlight-message');
        }, 2000);
        setScrollToMessageId(null);
      }
    }
  }, [scrollToMessageId, messages]);

  useEffect(() => {
    if (selectedFiles.length > 0) {
      const urls = selectedFiles.map((file) => {
        if (file.type.startsWith('image/')) {
          return URL.createObjectURL(file);
        }
        return '';
      }).filter(Boolean);
      setPreviewUrls(urls);
      return () => {
        urls.forEach((url) => URL.revokeObjectURL(url));
      };
    } else {
      setPreviewUrls([]);
    }
  }, [selectedFiles, setPreviewUrls]);

  function handleReplyClick(message: CommunityMessage) {
    if (message.replyPreview) {
      setScrollToMessageId(message.replyPreview.id || '');
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
      <style jsx>{`
        @keyframes highlight {
          0%, 100% { background-color: transparent; }
          50% { background-color: rgba(74, 222, 128, 0.15); }
        }
        .highlight-message {
          animation: highlight 2s ease;
        }
      `}</style>
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
            className="flex min-h-[70vh] max-h-[80vh] w-full max-w-4xl min-w-[300px] flex-1 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm"
            style={{
              animation: 'soft-rise 0.5s ease both',
              animationDelay: '60ms',
            }}
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
                    className={`rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-600 ${
                      !showPinned ? 'bg-slate-50 hover:bg-slate-100' : 'bg-amber-100 hover:bg-amber-200'
                    }`}
                  >
                    📌 {pinnedMessages.length} pinned
                  </button>
                )}
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600">
                  {activeType ? `${activeType === 'CHANNEL' ? 'Channel' : 'DM'} view` : 'Idle'}
                </div>
              </div>
            </div>

            {showPinned && <PinnedMessages pinnedMessages={pinnedMessages} onUnpin={(msgId) => handleUnpinMessage(msgId, setPinnedMessages)} />}

            <MessageList
              messages={messages}
              currentTyping={currentTyping}
              activeType={activeType}
              userId={user?.id}
              messagesLoading={messagesLoading}
              hasMore={hasMore}
              loadingMore={loadingMore}
              hoveredMessageId={hoveredMessageId}
              messageRefs={messageRefs}
              onLoadMore={loadMoreMessages}
              onScroll={() => {}}
              onReaction={(msgId, emoji) => handleReaction(msgId, emoji, messages, setMessages)}
              onContextMenu={(e, msg) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, message: msg });
              }}
              onReplyClick={handleReplyClick}
              onHoverChange={setHoveredMessageId}
            />

            <MessageInput
              draftMessage={draftMessage}
              replyingTo={replyingTo}
              editingMessage={editingMessage}
              editDraft={editDraft}
              selectedFiles={selectedFiles}
              previewUrls={previewUrls}
              uploading={uploading}
              uploadProgress={uploadProgress}
              sending={sending}
              inputDisabled={inputDisabled}
              activeThreadId={activeThreadId}
              activeLabel={activeLabel}
              onDraftChange={setDraftMessage}
              onEditDraftChange={setEditDraft}
              onSend={() => handleSendMessage(messages, setMessages, setChannels, setDms, setError)}
              onEditSave={() => handleEditMessage(messages, setMessages)}
              onCancelReply={() => setReplyingTo(null)}
              onCancelEdit={() => {
                setEditingMessage(null);
                setEditDraft('');
              }}
              onFileSelect={handleFileSelect}
              onClearFiles={() => setSelectedFiles([])}
              onTyping={() => handleTyping(wsRef)}
            />
          </section>

          <ThreadInfo
            activeChannel={activeChannel}
            activeDm={activeDm}
            activeType={activeType}
            activeLabel={activeLabel}
          />
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          message={contextMenu.message}
          userId={user?.id}
          onEdit={(msg) => {
            setEditingMessage(msg);
            setEditDraft(msg.body);
          }}
          onReply={setReplyingTo}
          onPin={handlePinMessage}
          onDelete={(msgId) => handleDeleteMessage(msgId, messages, setMessages)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </main>
  );
}