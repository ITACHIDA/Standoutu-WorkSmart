import type { PinnedMessage } from './types';
import { formatFullTime } from './utils';

interface PinnedMessagesProps {
  pinnedMessages: PinnedMessage[];
  onUnpin: (messageId: string) => void;
}

export function PinnedMessages({ pinnedMessages, onUnpin }: PinnedMessagesProps) {
  if (pinnedMessages.length === 0) return null;

  return (
    <div className="absolute top-0 left-0 right-0 bottom-0 bg-white z-10 flex flex-col">
      <div className="border-b border-slate-200 bg-amber-50 px-6 py-3 flex-shrink-0">
        <div className="text-xs font-semibold text-amber-900">📌 Pinned Messages</div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-3">
        <div className="space-y-2">
          {pinnedMessages.map((pin) => (
            <div key={pin.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className="font-semibold text-slate-900">
                    {pin.message?.senderName || 'User'}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {formatFullTime(pin.message?.createdAt || pin.pinnedAt)}
                  </div>
                </div>
                <div className="text-slate-700">{pin.message?.body || '[Message]'}</div>
              </div>
              <button
                onClick={() => onUnpin(pin.messageId)}
                className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-700 hover:bg-amber-200 flex-shrink-0"
              >
                Unpin
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}