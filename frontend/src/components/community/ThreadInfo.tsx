import type {
  CommunityChannel,
  CommunityDmThread,
  CommunityThreadType,
} from './types';
import { InfoRow } from './UIComponents';
import { formatDmTitle, formatDate } from './utils';

interface ThreadInfoProps {
  activeChannel?: CommunityChannel;
  activeDm?: CommunityDmThread;
  activeType: CommunityThreadType | null;
  activeLabel: string;
}

export function ThreadInfo({ activeChannel, activeDm, activeType, activeLabel }: ThreadInfoProps) {
  return (
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
  );
}