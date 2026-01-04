import { useRef, useEffect, CSSProperties } from "react";
import type {
  CommunityMessage,
  TypingIndicator,
  CommunityThreadType,
} from "./types";
import { AvatarBubble } from "./UIComponents";
import { formatFullTime, formatBytes, cn } from "./utils";

interface MessageListProps {
  messages: CommunityMessage[];
  currentTyping: TypingIndicator[];
  activeType: CommunityThreadType | null;
  userId?: string;
  messagesLoading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  hoveredMessageId: string | null;
  messageRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  pinnedMessageIds: Set<string>;
  onLoadMore: () => void;
  onScroll: () => void;
  onReaction: (messageId: string, emoji: string) => void;
  onContextMenu: (e: React.MouseEvent, message: CommunityMessage) => void;
  onReplyClick: (message: CommunityMessage) => void;
  onHoverChange: (messageId: string | null) => void;
}

export function MessageList({
  messages,
  currentTyping,
  activeType,
  userId,
  messagesLoading,
  hasMore,
  loadingMore,
  hoveredMessageId,
  messageRefs,
  pinnedMessageIds,
  onLoadMore,
  onScroll,
  onReaction,
  onContextMenu,
  onReplyClick,
  onHoverChange,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!bottomRef.current) return;
    bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  function handleScroll() {
    if (!messagesContainerRef.current) return;
    const { scrollTop } = messagesContainerRef.current;
    if (scrollTop === 0 && hasMore && !loadingMore) {
      onLoadMore();
    }
    onScroll();
  }

  return (
    <div
      ref={messagesContainerRef}
      onScroll={handleScroll}
      className="flex-1 space-y-4 overflow-y-auto px-6 py-4"
    >
      {hasMore && !messagesLoading && (
        <div className="text-center">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            {loadingMore ? "Loading..." : "Load more"}
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
          const isSelf = message.senderId === userId;
          const sender = message.senderName || "Member";
          const isDeleted = message.isDeleted;
          const isDm = activeType === "DM";
          const isPinned = pinnedMessageIds.has(message.id);

          return (
            <div
              key={message.id}
              ref={(el) => {
                if (el) {
                  messageRefs.current.set(message.id, el);
                } else {
                  messageRefs.current.delete(message.id);
                }
              }}
              className={`flex items-start gap-3 ${
                isDm ? (isSelf ? "flex-row-reverse" : "flex-row") : "flex-row"
              }`}
              onMouseEnter={() => onHoverChange(message.id)}
              onMouseLeave={() => onHoverChange(null)}
            >
              <AvatarBubble name={sender} active={isSelf} />
              <div className="max-w-sm">
                <div
                  className={`flex items-center gap-2 ${
                    isDm && isSelf ? "flex-row-reverse" : ""
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900">
                    {sender}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {formatFullTime(message.createdAt)}
                  </div>
                  {message.isEdited && (
                    <span className="text-[10px] text-slate-400">(edited)</span>
                  )}
                  {isPinned && (
                    <span className="text-amber-600" title="Pinned message">
                      📌
                    </span>
                  )}
                </div>
                {message.replyPreview && (
                  <div
                    onClick={() => onReplyClick(message)}
                    className={`mt-1 rounded-lg border-l-4 border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-200 transition ${
                      isDm && isSelf ? "border-r-4 border-l-0" : ""
                    }`}
                  >
                    <div className="font-semibold">
                      {message.replyPreview.senderName || "User"}
                    </div>
                    <div className="truncate">{message.replyPreview.body}</div>
                  </div>
                )}
                {message.body && (
                  <div
                    onContextMenu={(e) => onContextMenu(e, message)}
                    className={`mt-1 rounded-2xl px-4 py-3 text-sm transition ${
                      hoveredMessageId === message.id
                        ? "ring-2 ring-slate-200"
                        : ""
                    } ${
                      isDeleted
                        ? "bg-slate-200 italic text-slate-500"
                        : isSelf
                        ? "bg-[var(--community-accent)] text-[var(--community-ink)]"
                        : "bg-[var(--community-soft)] text-slate-800"
                    }`}
                  >
                    {isDeleted ? "[Message deleted]" : message.body}
                  </div>
                )}
                {message.attachments && message.attachments.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {message.attachments.map((att) => (
                      <div key={att.id}>
                        {att.mimeType.startsWith("image/") ? (
                          <img
                            src={att.fileUrl}
                            alt={att.fileName}
                            className="max-w-sm w-auto h-auto rounded"
                          />
                        ) : (
                          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
                            <div className="flex h-16 w-16 items-center justify-center rounded bg-slate-100 text-xs text-slate-600">
                              📄
                            </div>
                            <div className="flex-1 text-xs">
                              <div className="font-semibold text-slate-900">
                                {att.fileName}
                              </div>
                              <div className="text-slate-500">
                                {formatBytes(att.fileSize)}
                              </div>
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
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {message.reactions && message.reactions.length > 0 && (
                  <div
                    className={`mt-2 flex flex-wrap gap-1 ${
                      isDm && isSelf ? "justify-end" : ""
                    }`}
                  >
                    {message.reactions.map((reaction) => (
                      <button
                        key={reaction.emoji}
                        onClick={() => onReaction(message.id, reaction.emoji)}
                        className={`rounded-full border px-2 py-1 text-xs transition ${
                          reaction.userIds.includes(userId || "")
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {reaction.emoji} {reaction.count}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
      {currentTyping.length > 0 && (
        <div className="text-xs italic text-slate-500">
          {currentTyping.map((t) => t.userName).join(", ")}{" "}
          {currentTyping.length === 1 ? "is" : "are"} typing...
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
