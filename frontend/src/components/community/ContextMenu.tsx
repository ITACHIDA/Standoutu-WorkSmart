import type { CommunityMessage, PinnedMessage } from './types';

interface ContextMenuProps {
  x: number;
  y: number;
  message: CommunityMessage;
  userId?: string;
  pinnedMessages: PinnedMessage[];
  onEdit: (message: CommunityMessage) => void;
  onReply: (message: CommunityMessage) => void;
  onPin: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onClose: () => void;
}

export function ContextMenu({
  x,
  y,
  message,
  userId,
  pinnedMessages,
  onEdit,
  onReply,
  onPin,
  onUnpin,
  onDelete,
  onClose,
}: ContextMenuProps) {
  const isPinned = pinnedMessages.some(pin => pin.messageId === message.id);

  return (
    <div
      className="fixed z-50 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
      style={{ top: y, left: x }}
    >
      {message.senderId === userId && !message.isDeleted && (
        <button
          onClick={() => {
            onEdit(message);
            onClose();
          }}
          className="w-full rounded px-3 py-2 text-left text-xs hover:bg-slate-100"
        >
          Edit
        </button>
      )}
      <button
        onClick={() => {
          onReply(message);
          onClose();
        }}
        className="w-full rounded px-3 py-2 text-left text-xs hover:bg-slate-100"
      >
        Reply
      </button>
      {isPinned ? (
        <button
          onClick={() => {
            onUnpin(message.id);
            onClose();
          }}
          className="w-full rounded px-3 py-2 text-left text-xs hover:bg-slate-100"
        >
          Unpin
        </button>
      ) : (
        <button
          onClick={() => {
            onPin(message.id);
            onClose();
          }}
          className="w-full rounded px-3 py-2 text-left text-xs hover:bg-slate-100"
        >
          Pin
        </button>
      )}
      {message.senderId === userId && !message.isDeleted && (
        <button
          onClick={() => {
            onDelete(message.id);
            onClose();
          }}
          className="w-full rounded px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
      )}
    </div>
  );
}