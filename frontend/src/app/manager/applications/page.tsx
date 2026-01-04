'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/useAuth';
import ManagerShell from '../../../components/ManagerShell';

type ApplicationSummary = {
  id: string;
  sessionId: string;
  bidderUserId?: string | null;
  bidderName?: string | null;
  bidderEmail?: string | null;
  profileId?: string | null;
  profileDisplayName?: string | null;
  resumeId?: string | null;
  resumeLabel?: string | null;
  url?: string | null;
  domain?: string | null;
  createdAt: string;
};

type DateRangeKey = 'all' | '1d' | '1w' | '1m' | 'custom';

type DateRange = {
  start: Date | null;
  end: Date | null;
};

type BidderOption = {
  id: string;
  label: string;
  email?: string | null;
  count: number;
};

type ProfileOption = {
  id: string;
  label: string;
  count: number;
};

const UNKNOWN_BIDDER_ID = 'unknown';
const UNKNOWN_PROFILE_ID = 'unknown-profile';

export default function ManagerApplicationsPage() {
  const router = useRouter();
  const { user, token, loading } = useAuth();
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeRange, setActiveRange] = useState<DateRangeKey>('all');
  const [customRange, setCustomRange] = useState<DateRange>({ start: null, end: null });
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [bidderFilterOpen, setBidderFilterOpen] = useState(false);
  const [selectedBidderIds, setSelectedBidderIds] = useState<Set<string> | null>(null);
  const [profileFilterOpen, setProfileFilterOpen] = useState(false);
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string> | null>(null);
  const bidderFilterRef = useRef<HTMLDivElement | null>(null);
  const profileFilterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      router.replace('/auth');
      return;
    }
    if (user.role !== 'MANAGER' && user.role !== 'ADMIN') {
      router.replace('/workspace');
      return;
    }
    void loadData(token);
  }, [loading, user, token, router]);

  useEffect(() => {
    if (!bidderFilterOpen && !profileFilterOpen) return;
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (bidderFilterRef.current?.contains(target)) return;
      if (profileFilterRef.current?.contains(target)) return;
      setBidderFilterOpen(false);
      setProfileFilterOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    return () => document.removeEventListener('mousedown', handlePointer);
  }, [bidderFilterOpen, profileFilterOpen]);

  const bidderOptions = useMemo(() => {
    const map = new Map<string, BidderOption>();
    for (const row of applications) {
      const id = row.bidderUserId ?? UNKNOWN_BIDDER_ID;
      const label = row.bidderName || row.bidderEmail || 'Unknown';
      const email = row.bidderName ? row.bidderEmail : null;
      const existing = map.get(id);
      if (existing) {
        existing.count += 1;
        if (!existing.email && email) existing.email = email;
      } else {
        map.set(id, { id, label, email, count: 1 });
      }
    }
    const list = Array.from(map.values());
    list.sort((a, b) => {
      if (a.id === UNKNOWN_BIDDER_ID) return 1;
      if (b.id === UNKNOWN_BIDDER_ID) return -1;
      return a.label.localeCompare(b.label);
    });
    return list;
  }, [applications]);

  const profileOptions = useMemo(() => {
    const map = new Map<string, ProfileOption>();
    for (const row of applications) {
      const id = row.profileId ?? UNKNOWN_PROFILE_ID;
      const label = row.profileDisplayName || 'Unknown';
      const existing = map.get(id);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(id, { id, label, count: 1 });
      }
    }
    const list = Array.from(map.values());
    list.sort((a, b) => {
      if (a.id === UNKNOWN_PROFILE_ID) return 1;
      if (b.id === UNKNOWN_PROFILE_ID) return -1;
      return a.label.localeCompare(b.label);
    });
    return list;
  }, [applications]);

  const activeDateRange = useMemo(() => {
    if (activeRange === 'all') return { start: null, end: null };
    if (activeRange === 'custom') {
      return {
        start: customRange.start ? startOfDay(customRange.start) : null,
        end: customRange.end ? endOfDay(customRange.end) : null,
      };
    }
    const now = new Date();
    const end = endOfDay(now);
    if (activeRange === '1d') {
      return { start: startOfDay(now), end };
    }
    if (activeRange === '1w') {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return { start: startOfDay(start), end };
    }
    if (activeRange === '1m') {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return { start: startOfDay(start), end };
    }
    return { start: null, end: null };
  }, [activeRange, customRange]);

  const rangeLabel = useMemo(() => {
    if (activeRange === 'all') return 'All time';
    if (activeRange === '1d') return 'Today';
    if (activeRange === '1w') return 'Last 7 days';
    if (activeRange === '1m') return 'Last 30 days';
    if (activeRange === 'custom' && customRange.start && customRange.end) {
      return `${formatShortDate(customRange.start)} - ${formatShortDate(customRange.end)}`;
    }
    return 'Custom range';
  }, [activeRange, customRange]);

  const bidderFilterLabel = useMemo(() => {
    if (bidderOptions.length === 0) return 'No bidders';
    if (!selectedBidderIds) return 'All';
    if (selectedBidderIds.size === 0) return 'None';
    return `${selectedBidderIds.size} selected`;
  }, [bidderOptions.length, selectedBidderIds]);

  const profileFilterLabel = useMemo(() => {
    if (profileOptions.length === 0) return 'No profiles';
    if (!selectedProfileIds) return 'All';
    if (selectedProfileIds.size === 0) return 'None';
    return `${selectedProfileIds.size} selected`;
  }, [profileOptions.length, selectedProfileIds]);

  const rows = useMemo(() => {
    const query = normalizeSearch(searchQuery);
    const filterByBidder = Boolean(selectedBidderIds);
    const filterByProfile = Boolean(selectedProfileIds);
    const { start, end } = activeDateRange;
    return applications.filter((row) => {
      if (filterByBidder) {
        const bidderId = row.bidderUserId ?? UNKNOWN_BIDDER_ID;
        if (!selectedBidderIds?.has(bidderId)) return false;
      }
      if (filterByProfile) {
        const profileId = row.profileId ?? UNKNOWN_PROFILE_ID;
        if (!selectedProfileIds?.has(profileId)) return false;
      }
      if (start || end) {
        const createdAt = new Date(row.createdAt);
        if (Number.isNaN(createdAt.getTime())) return false;
        if (start && createdAt < start) return false;
        if (end && createdAt > end) return false;
      }
      if (query) {
        const target = buildSearchTarget(row);
        if (!target.includes(query)) return false;
      }
      return true;
    });
  }, [applications, activeDateRange, searchQuery, selectedBidderIds]);

  async function loadData(authToken: string) {
    try {
      const data = await api<ApplicationSummary[]>('/manager/applications', undefined, authToken);
      setApplications(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load applications.');
    }
  }

  const rangeButtonClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition ${
      active
        ? 'border-slate-900 bg-slate-900 text-white'
        : 'border-slate-200 text-slate-700 hover:bg-slate-100'
    }`;

  const openCustomModal = () => {
    setDraftStart(customRange.start ? toDateInputValue(customRange.start) : '');
    setDraftEnd(customRange.end ? toDateInputValue(customRange.end) : '');
    setDateModalOpen(true);
  };

  const applyCustomRange = () => {
    if (!draftStart || !draftEnd) {
      window.alert('Select both a start and end date.');
      return;
    }
    const start = new Date(`${draftStart}T00:00:00`);
    const end = new Date(`${draftEnd}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      window.alert('Invalid date range.');
      return;
    }
    if (end < start) {
      window.alert('End date must be after the start date.');
      return;
    }
    setCustomRange({ start, end });
    setActiveRange('custom');
    setDateModalOpen(false);
  };

  const clearCustomRange = () => {
    setCustomRange({ start: null, end: null });
    setActiveRange('all');
    setDateModalOpen(false);
  };

  const toggleBidder = (bidderId: string) => {
    setSelectedBidderIds((prev) => {
      const allIds = bidderOptions.map((bidder) => bidder.id);
      if (allIds.length === 0) return prev ?? null;
      const next = new Set(prev ?? allIds);
      if (next.has(bidderId)) {
        next.delete(bidderId);
      } else {
        next.add(bidderId);
      }
      if (next.size === allIds.length) return null;
      return new Set(next);
    });
  };

  const toggleProfile = (profileId: string) => {
    setSelectedProfileIds((prev) => {
      const allIds = profileOptions.map((profile) => profile.id);
      if (allIds.length === 0) return prev ?? null;
      const next = new Set(prev ?? allIds);
      if (next.has(profileId)) {
        next.delete(profileId);
      } else {
        next.add(profileId);
      }
      if (next.size === allIds.length) return null;
      return new Set(next);
    });
  };

  return (
    <ManagerShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Manager</p>
          <h1 className="text-3xl font-semibold text-slate-900">Application management</h1>
          <p className="text-sm text-slate-600">
            Review submitted applications and the resume used for each submission.
          </p>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <label className="flex-1 space-y-1">
              <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Search</span>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by bidder, profile, resume, URL, or date..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-transparent focus:ring-slate-300"
              />
            </label>
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Date range</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveRange((prev) => (prev === '1d' ? 'all' : '1d'))}
                  className={rangeButtonClass(activeRange === '1d')}
                >
                  1D
                </button>
                <button
                  type="button"
                  onClick={() => setActiveRange((prev) => (prev === '1w' ? 'all' : '1w'))}
                  className={rangeButtonClass(activeRange === '1w')}
                >
                  1W
                </button>
                <button
                  type="button"
                  onClick={() => setActiveRange((prev) => (prev === '1m' ? 'all' : '1m'))}
                  className={rangeButtonClass(activeRange === '1m')}
                >
                  1M
                </button>
                <button
                  type="button"
                  onClick={openCustomModal}
                  className={rangeButtonClass(activeRange === 'custom')}
                >
                  Other
                </button>
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <div>
              {rows.length} result{rows.length === 1 ? '' : 's'}
              {rows.length !== applications.length ? ` of ${applications.length}` : ''}
            </div>
            <div>Range: {rangeLabel}</div>
          </div>
        </section>

        <section className="relative rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[150px_1.1fr_1fr_1fr_2fr] items-center bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.14em] text-slate-600">
            <div>Submitted</div>
            <div ref={bidderFilterRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setBidderFilterOpen((prev) => !prev);
                  setProfileFilterOpen(false);
                }}
                className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-600"
              >
                <span>Bidder</span>
                <span className="text-[10px] font-semibold text-slate-400">{bidderFilterLabel}</span>
                <svg
                  viewBox="0 0 24 24"
                  className={`h-3 w-3 fill-current transition ${bidderFilterOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M7 10l5 5 5-5z" />
                </svg>
              </button>
              {bidderFilterOpen ? (
                <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.14em] text-slate-500">
                    <span>Bidders</span>
                    {selectedBidderIds ? (
                      <button
                        type="button"
                        onClick={() => setSelectedBidderIds(null)}
                        className="text-[10px] font-semibold text-slate-500 hover:text-slate-700"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 max-h-52 space-y-2 overflow-auto pr-1">
                    {bidderOptions.length === 0 ? (
                      <div className="text-xs text-slate-500">No bidders yet.</div>
                    ) : (
                      bidderOptions.map((bidder) => {
                        const checked = selectedBidderIds
                          ? selectedBidderIds.has(bidder.id)
                          : true;
                        return (
                          <label key={bidder.id} className="flex items-start gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleBidder(bidder.id)}
                              className="mt-1 h-4 w-4 rounded border-slate-300 accent-slate-900"
                            />
                            <span className="flex-1">
                              <span className="font-semibold text-slate-900">{bidder.label}</span>
                              {bidder.email ? (
                                <span className="block text-xs text-slate-500">{bidder.email}</span>
                              ) : null}
                            </span>
                            <span className="text-xs text-slate-400">{bidder.count}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <div ref={profileFilterRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setProfileFilterOpen((prev) => !prev);
                  setBidderFilterOpen(false);
                }}
                className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-600"
              >
                <span>Profile</span>
                <span className="text-[10px] font-semibold text-slate-400">{profileFilterLabel}</span>
                <svg
                  viewBox="0 0 24 24"
                  className={`h-3 w-3 fill-current transition ${profileFilterOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M7 10l5 5 5-5z" />
                </svg>
              </button>
              {profileFilterOpen ? (
                <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.14em] text-slate-500">
                    <span>Profiles</span>
                    {selectedProfileIds ? (
                      <button
                        type="button"
                        onClick={() => setSelectedProfileIds(null)}
                        className="text-[10px] font-semibold text-slate-500 hover:text-slate-700"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 max-h-52 space-y-2 overflow-auto pr-1">
                    {profileOptions.length === 0 ? (
                      <div className="text-xs text-slate-500">No profiles yet.</div>
                    ) : (
                      profileOptions.map((profile) => {
                        const checked = selectedProfileIds
                          ? selectedProfileIds.has(profile.id)
                          : true;
                        return (
                          <label key={profile.id} className="flex items-start gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleProfile(profile.id)}
                              className="mt-1 h-4 w-4 rounded border-slate-300 accent-slate-900"
                            />
                            <span className="flex-1">
                              <span className="font-semibold text-slate-900">{profile.label}</span>
                            </span>
                            <span className="text-xs text-slate-400">{profile.count}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <div>Resume</div>
            <div>URL</div>
          </div>
          <div className="divide-y divide-slate-200">
            {rows.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-600">No applications found.</div>
            ) : (
              rows.map((row) => {
                const bidderLabel = row.bidderName || row.bidderEmail || 'Unknown';
                const profileLabel = row.profileDisplayName || 'Unknown';
                const resumeLabel = row.resumeLabel || 'None';
                const urlLabel = row.domain || row.url || '';
                return (
                  <div
                    key={row.id}
                    className="grid grid-cols-[150px_1.1fr_1fr_1fr_2fr] items-start gap-3 px-4 py-3 text-sm text-slate-800"
                  >
                    <div className="text-xs text-slate-600">{formatDate(row.createdAt)}</div>
                    <div className="space-y-1">
                      <div className="font-semibold text-slate-900">{bidderLabel}</div>
                      {row.bidderEmail ? (
                        <div className="text-xs text-slate-500">{row.bidderEmail}</div>
                      ) : null}
                    </div>
                    <div className="text-slate-700">{profileLabel}</div>
                    <div className="text-slate-700">{resumeLabel}</div>
                    <div className="text-slate-700">
                      {row.url ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-slate-800 underline decoration-slate-300 hover:text-slate-900"
                          title={row.url}
                        >
                          {urlLabel}
                        </a>
                      ) : (
                        <span className="text-xs text-slate-500">No URL</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {dateModalOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            onClick={() => setDateModalOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Custom range</p>
                  <h2 className="text-lg font-semibold text-slate-900">Select dates</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setDateModalOpen(false)}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Start</span>
                  <input
                    type="date"
                    value={draftStart}
                    onChange={(event) => setDraftStart(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-transparent focus:ring-slate-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-500">End</span>
                  <input
                    type="date"
                    value={draftEnd}
                    onChange={(event) => setDraftEnd(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-transparent focus:ring-slate-300"
                  />
                </label>
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={clearCustomRange}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setDateModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyCustomRange}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ManagerShell>
  );
}

function formatDate(value?: string | null) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatShortDate(value: Date) {
  return value.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function buildSearchTarget(row: ApplicationSummary) {
  const parts = [
    row.id,
    row.sessionId,
    row.bidderUserId,
    row.bidderName,
    row.bidderEmail,
    row.profileId,
    row.profileDisplayName,
    row.resumeId,
    row.resumeLabel,
    row.url,
    row.domain,
    row.createdAt,
    formatDate(row.createdAt),
  ];
  return normalizeSearch(parts.filter(Boolean).join(' '));
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

function toDateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
