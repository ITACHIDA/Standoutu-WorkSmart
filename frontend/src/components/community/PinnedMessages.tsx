import type { PinnedMessage } from './types';
import { cn } from './utils';

interface PinnedMessagesProps {
  pinnedMessages: PinnedMessage[];
  onUnpin: (messageId: string) => void;
}

export function PinnedMessages({ pinnedMessages, onUnpin }: PinnedMessagesProps) {
  if (pinnedMessages.length === 0) return null;

  return (
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
              onClick={() => onUnpin(pin.messageId)}
              className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-700 hover:bg-amber-200"
            >
              Unpin
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}