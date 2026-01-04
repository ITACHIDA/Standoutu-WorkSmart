import type { CommunityChannel, DirectoryUser, CommunityDmThread } from './types';
import { SectionHeader, AvatarBubble } from './UIComponents';
import { formatTime } from './utils';

type SidebarProps = {
  channels: CommunityChannel[];
  dms: CommunityDmThread[];
  memberList: DirectoryUser[];
  activeThreadId: string;
  unreadMap: Map<string, number>;
  overviewLoading: boolean;
  creatingDmId: string | null;
  dmLookup: Map<string, CommunityDmThread>;
  onThreadSelect: (id: string) => void;
  onStartDm: (targetId: string) => void;
};

export function Sidebar({
  channels,
  memberList,
  activeThreadId,
  unreadMap,
  overviewLoading,
  creatingDmId,
  dmLookup,
  onThreadSelect,
  onStartDm,
}: SidebarProps) {
  return (
    <aside
      className="w-[260px] shrink-0 space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
      style={{ animation: 'soft-rise 0.5s ease both' }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.26em] text-slate-500">Community</p>
          <h1 className="text-lg font-semibold text-slate-900">Shared space</h1>
        </div>
        <span className="rounded-full bg-[var(--community-ink)] px-3 py-1 text-[10px] font-semibold text-[var(--community-accent)]">
          Live
        </span>
      </div>

      <div className="space-y-3">
        <SectionHeader title="Channels" count={channels.length} />
        {overviewLoading && !channels.length ? (
          <div className="border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
            Loading channels...
          </div>
        ) : channels.length === 0 ? (
          <div className="border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
            No channels yet.
          </div>
        ) : (
          <div className="border border-slate-200 bg-white">
            {channels.map((channel) => {
              const active = channel.id === activeThreadId;
              const unread = unreadMap.get(channel.id) || 0;
              return (
                <button
                  key={channel.id}
                  onClick={() => onThreadSelect(channel.id)}
                  className={`flex w-full items-center justify-between border-b border-slate-200 px-3 py-2 text-left text-sm transition last:border-b-0 ${
                    active
                      ? 'bg-[var(--community-ink)] text-white'
                      : 'text-slate-700 hover:bg-[var(--community-soft)]'
                  }`}
                >
                  <div className="flex flex-col flex-1">
                    <span className="flex items-center gap-2 font-semibold">
                      <span className={`text-xs font-semibold ${active ? 'text-[var(--community-accent)]' : 'text-slate-400'}`}>#</span>
                      {channel.name ?? 'channel'}
                    </span>
                    {channel.description && (
                      <span className={`text-[11px] ${active ? 'text-slate-200' : 'text-slate-500'}`}>
                        {channel.description}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {unread > 0 && (
                      <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] text-white">
                        {unread}
                      </span>
                    )}
                    <span className={`text-[10px] ${active ? 'text-slate-200' : 'text-slate-400'}`}>
                      {formatTime(channel.lastMessageAt ?? channel.createdAt)}
                    </span>
                  </div>
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
              const dm = dmLookup.get(member.id);
              const unread = dm ? unreadMap.get(dm.id) || 0 : 0;
              return (
                <button
                  key={member.id}
                  onClick={() => onStartDm(member.id)}
                  disabled={Boolean(creatingDmId)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:bg-[var(--community-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <AvatarBubble name={member.name} active={false} />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-slate-900">{member.name}</div>
                    {isStarting && <div className="mt-1 text-[10px] text-slate-500">Starting DM...</div>}
                  </div>
                  {unread > 0 && (
                    <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] text-white">
                      {unread}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
