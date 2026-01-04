'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, signOut, useSession } from 'next-auth/react';
import FullCalendar from '@fullcalendar/react';
import { DatesSetArg, EventContentArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import TopNav from '../../components/TopNav';
import { useAuth } from '../../lib/useAuth';

type CalendarAccount = {
  email: string;
  name?: string | null;
  timezone?: string | null;
  accountId?: string;
  isPrimary?: boolean;
};

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  isAllDay?: boolean;
  organizer?: string;
  location?: string;
  mailbox?: string;
};

type CalendarEventsResponse = {
  accounts?: CalendarAccount[];
  events: CalendarEvent[];
  source: 'graph' | 'sample' | 'db';
  warning?: string;
  failedMailboxes?: string[];
  message?: string;
};

const chipBase =
  'inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700';

const TIMEZONE_OPTIONS = [
  { id: 'ETC', label: 'ETC', graph: 'UTC', calendar: 'UTC' },
  { id: 'UTC', label: 'UTC', graph: 'UTC', calendar: 'UTC' },
  { id: 'PTC', label: 'PTC', graph: 'Pacific Standard Time', calendar: 'America/Los_Angeles' },
];
const MAILBOX_STORAGE_KEY = 'calendar.extraMailboxes';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeMailbox = (mailbox: string) => mailbox.trim().toLowerCase();

const uniqueMailboxes = (mailboxes: string[]) => {
  const seen = new Set<string>();
  return mailboxes
    .map(normalizeMailbox)
    .filter(Boolean)
    .filter((mailbox) => {
      if (seen.has(mailbox)) return false;
      seen.add(mailbox);
      return true;
    });
};

export default function CalendarPage() {
  const router = useRouter();
  const { user, token, loading } = useAuth();
  const { data: outlookSession, status: outlookStatus } = useSession();
  const canManageOutlook = user?.role === 'ADMIN';
  const [viewRange, setViewRange] = useState<{ start: string; end: string } | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | undefined>();
  const [connectedAccounts, setConnectedAccounts] = useState<CalendarAccount[]>([]);
  const [failedMailboxes, setFailedMailboxes] = useState<string[]>([]);
  const [extraMailboxes, setExtraMailboxes] = useState<string[]>([]);
  const [mailboxInput, setMailboxInput] = useState('');
  const [mailboxError, setMailboxError] = useState<string | null>(null);
  const [timezoneId, setTimezoneId] = useState<string>(TIMEZONE_OPTIONS[0].id);
  const [hiddenMailboxes, setHiddenMailboxes] = useState<string[]>([]);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      router.replace('/auth');
    }
  }, [loading, user, token, router]);

  const eventContent = (arg: EventContentArg) => {
    const location = arg.event.extendedProps.location as string | undefined;
    const organizer = arg.event.extendedProps.organizer as string | undefined;
    const mailbox = arg.event.extendedProps.mailbox as string | undefined;
    return (
      <div className="flex flex-col gap-0.5 text-[11px] leading-tight text-white">
        <div className="font-semibold">{arg.event.title}</div>
        {location ? <div className="text-white/90">{location}</div> : null}
        {organizer ? <div className="text-white/75">{organizer}</div> : null}
        {mailbox ? <div className="text-white/70">{mailbox}</div> : null}
      </div>
    );
  };

  const handleDatesSet = (info: DatesSetArg) => {
    setViewRange({ start: info.startStr, end: info.endStr });
  };

  const calendarEvents = useMemo(() => {
    const hiddenSet = new Set(hiddenMailboxes);
    return events
      .filter((ev) => {
        const mailbox = ev.mailbox ? normalizeMailbox(ev.mailbox) : '';
        return !mailbox || !hiddenSet.has(mailbox);
      })
      .map((ev) => ({
        ...ev,
        allDay: Boolean(ev.isAllDay),
      }));
  }, [events, hiddenMailboxes]);

  const selectedTimezone = useMemo(
    () => TIMEZONE_OPTIONS.find((tz) => tz.id === timezoneId) ?? TIMEZONE_OPTIONS[0],
    [timezoneId],
  );

  const mailboxCards = useMemo(() => {
    const connected = connectedAccounts.map((account) => ({
      email: normalizeMailbox(account.email),
      name: account.name,
      status: 'connected' as const,
      accountId: account.accountId,
      isPrimary: account.isPrimary,
    }));
    const connectedSet = new Set(connected.map((account) => account.email));
    const failed = failedMailboxes
      .map(normalizeMailbox)
      .filter(Boolean)
      .filter((mailbox) => !connectedSet.has(mailbox))
      .map((mailbox) => ({
        email: mailbox,
        status: 'needs-access' as const,
      }));
    const failedSet = new Set(failed.map((account) => account.email));
    const added = uniqueMailboxes(extraMailboxes)
      .filter((mailbox) => !connectedSet.has(mailbox) && !failedSet.has(mailbox))
      .map((mailbox) => ({
        email: mailbox,
        status: 'added' as const,
      }));
    return [...connected, ...failed, ...added];
  }, [connectedAccounts, failedMailboxes, extraMailboxes]);

  const visibleMailboxCards = useMemo(
    () =>
      canManageOutlook
        ? mailboxCards
        : mailboxCards.filter((account) => account.status === 'connected'),
    [canManageOutlook, mailboxCards],
  );

  const hiddenMailboxSet = useMemo(() => new Set(hiddenMailboxes), [hiddenMailboxes]);

  const primaryEmail = outlookSession?.user?.email?.toLowerCase();
  const outlookLoading = outlookStatus === 'loading';
  const canSyncNow = outlookStatus === 'authenticated' && Boolean(viewRange);
  const canShowMailboxes = outlookStatus === 'authenticated' || connectedAccounts.length > 0;

  useEffect(() => {
    if (!canManageOutlook || typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(MAILBOX_STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const cleaned = uniqueMailboxes(parsed.filter((mailbox) => typeof mailbox === 'string')).sort();
        if (cleaned.length) {
          setExtraMailboxes(cleaned);
        }
      }
    } catch (err) {
      console.warn('Failed to read saved mailboxes', err);
    }
  }, [canManageOutlook]);

  useEffect(() => {
    if (!canManageOutlook || typeof window === 'undefined') return;
    const cleaned = uniqueMailboxes(extraMailboxes).filter(
      (mailbox) => mailbox && mailbox !== primaryEmail,
    );
    if (!cleaned.length) {
      window.localStorage.removeItem(MAILBOX_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(MAILBOX_STORAGE_KEY, JSON.stringify(cleaned));
  }, [extraMailboxes, primaryEmail, canManageOutlook]);

  useEffect(() => {
    if (!primaryEmail) return;
    setExtraMailboxes((prev) => prev.filter((mailbox) => mailbox !== primaryEmail));
  }, [primaryEmail]);

  const handleAddMailbox = () => {
    if (!canManageOutlook) return;
    const candidates = mailboxInput
      .split(/[,;\n]+/)
      .map(normalizeMailbox)
      .filter(Boolean);
    if (!candidates.length) return;
    const invalid = candidates.filter((mailbox) => !emailPattern.test(mailbox));
    if (invalid.length) {
      setMailboxError('Enter valid email addresses separated by commas.');
      return;
    }
    const filtered = candidates.filter((mailbox) => mailbox !== primaryEmail);
    const next = uniqueMailboxes([...extraMailboxes, ...filtered]).sort();
    if (next.length === extraMailboxes.length) {
      setMailboxError(
        primaryEmail && candidates.includes(primaryEmail)
          ? 'This mailbox is already connected.'
          : 'Mailbox already added.',
      );
      return;
    }
    setExtraMailboxes(next);
    setMailboxInput('');
    setMailboxError(null);
  };

  const handleRemoveMailbox = (mailbox: string) => {
    setExtraMailboxes((prev) => prev.filter((entry) => entry !== mailbox));
  };

  const toggleMailboxVisibility = useCallback((mailbox: string) => {
    const normalized = normalizeMailbox(mailbox);
    if (!normalized) return;
    setHiddenMailboxes((prev) =>
      prev.includes(normalized) ? prev.filter((entry) => entry !== normalized) : [...prev, normalized],
    );
  }, []);

  const fetchEvents = useCallback(async (range: { start: string; end: string }, source: 'db' | 'graph' = 'db') => {
    setEventsLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ start: range.start, end: range.end, source });
      if (canManageOutlook) {
        const mailboxParam = uniqueMailboxes(extraMailboxes).filter(
          (mailbox) => mailbox && mailbox !== primaryEmail,
        );
        if (mailboxParam.length) {
          qs.set('mailboxes', mailboxParam.join(','));
        }
      }
      qs.set('timezone', selectedTimezone.graph);
      const res = await fetch(`/api/calendar/outlook?${qs.toString()}`, {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const raw = await res.text();
      let data: CalendarEventsResponse | null = null;
      if (raw) {
        try {
          data = JSON.parse(raw) as CalendarEventsResponse;
        } catch (err) {
          console.error(err);
          setError('Invalid response from server.');
          setEvents([]);
          return;
        }
      }
      if (!res.ok) {
        setError(data?.message || res.statusText || 'Unable to load events.');
        setEvents([]);
        return;
      }
      setEvents(data?.events || []);
      setWarning(data?.warning);
      setConnectedAccounts(data?.accounts ?? []);
      setFailedMailboxes(data?.failedMailboxes ?? []);
    } catch (err) {
      console.error(err);
      setError('Unable to load events right now.');
    } finally {
      setEventsLoading(false);
    }
  }, [canManageOutlook, extraMailboxes, primaryEmail, selectedTimezone.graph, token]);

  const handleDisconnectMailbox = useCallback(
    async (account: { accountId?: string; email: string; isPrimary?: boolean }) => {
      if (!account.accountId) return;
      setDisconnectingId(account.accountId);
      setError(null);
      try {
        const accountIdParam = encodeURIComponent(account.accountId);
        const res = await fetch(`/api/calendar/outlook/accounts/${accountIdParam}?accountId=${accountIdParam}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ mailbox: account.email, accountId: account.accountId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.message || 'Failed to disconnect mailbox.');
        }
        setHiddenMailboxes((prev) => prev.filter((entry) => entry !== normalizeMailbox(account.email)));
        if (account.isPrimary) {
          await signOut({ callbackUrl: '/calendar' });
          return;
        }
        if (viewRange) {
          await fetchEvents(viewRange, 'db');
        } else {
          setConnectedAccounts((prev) =>
            prev.filter((entry) => entry.accountId !== account.accountId),
          );
          setEvents((prev) =>
            prev.filter(
              (event) => normalizeMailbox(event.mailbox || '') !== normalizeMailbox(account.email),
            ),
          );
        }
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Failed to disconnect mailbox.');
      } finally {
        setDisconnectingId(null);
      }
    },
    [fetchEvents, token, viewRange],
  );

  const handleSyncMailboxes = useCallback(() => {
    if (!viewRange || outlookStatus !== 'authenticated') return;
    void fetchEvents(viewRange, 'graph');
  }, [fetchEvents, outlookStatus, viewRange]);

  useEffect(() => {
    if (!viewRange || !token) return;
    void fetchEvents(viewRange, 'db');
  }, [fetchEvents, token, viewRange]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#eaf2ff] via-[#f4f7ff] to-white text-slate-900">
      <TopNav />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        {/* <div className="overflow-hidden rounded-3xl border border-slate-200/60 bg-white/90 shadow-[0_20px_80px_-50px_rgba(15,23,42,0.6)]">
          <div className="bg-gradient-to-r from-sky-50 via-white to-indigo-50 px-8 py-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Unified scheduling</p>
                <h1 className="text-3xl font-semibold text-slate-900">
                  Outlook calendar, powered by Microsoft Graph.
                </h1>
                <p className="max-w-3xl text-sm text-slate-600">
                  Connect once and see live meeting data across your synced mailboxes. No ICS uploads, just
                  real events that refresh on focus.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className={`${chipBase} bg-sky-50 text-sky-700`}>Microsoft Graph</span>
                  <span className={`${chipBase} bg-indigo-50 text-indigo-700`}>Calendar.Read</span>
                  <span className={`${chipBase}`}>Polling refresh</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => (outlookStatus === 'authenticated' ? signOut({ callbackUrl: '/calendar' }) : signIn('azure-ad'))}
                  className="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_40px_-20px_rgba(14,165,233,0.8)] transition hover:brightness-110 disabled:opacity-60"
                >
                  {outlookStatus === 'authenticated' ? 'Disconnect Outlook' : 'Connect Outlook'}
                </button>
                <button
                  onClick={() => viewRange && outlookStatus === 'authenticated' && fetchEvents(viewRange)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                  disabled={outlookStatus !== 'authenticated' || !viewRange || eventsLoading}
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div> */}

        <div className="flex gap-6 items-stretch">
          <aside className="space-y-4 basis-[30%] md:sticky md:top-6 h-full">
            <div className="h-full rounded-3xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_18px_60px_-50px_rgba(15,23,42,0.4)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Meeting schedule</p>
                  <h2 className="text-xl font-semibold text-slate-900">Mailboxes</h2>
                </div>
                {canManageOutlook ? (
                  <button
                    onClick={() => {
                      if (outlookStatus === 'authenticated') {
                        signOut({ callbackUrl: '/calendar' });
                      } else {
                        signIn('azure-ad');
                      }
                    }}
                    className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    {outlookStatus === 'authenticated' ? 'Disconnect' : 'Sync'}
                  </button>
                ) : null}
              </div>
              <div className="mt-4 space-y-2">
                {outlookLoading ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    Checking connection...
                  </div>
                ) : !canShowMailboxes ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                    {canManageOutlook
                      ? 'Connect your Outlook account to see meetings in real time.'
                      : 'No cached events yet. Ask an admin to sync Outlook.'}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleMailboxCards.length ? (
                      visibleMailboxCards.map((account) => {
                        const mailboxKey = normalizeMailbox(account.email);
                        const isHidden = hiddenMailboxSet.has(mailboxKey);
                        if (account.status === 'connected') {
                          const isPrimary = account.isPrimary ?? (primaryEmail && mailboxKey === primaryEmail);
                          const statusLabel = isPrimary ? 'Primary' : 'Connected';
                          const statusText = isHidden ? `${statusLabel} (hidden)` : statusLabel;
                          return (
                            <div
                              key={account.email}
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleMailboxVisibility(mailboxKey)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  toggleMailboxVisibility(mailboxKey);
                                }
                              }}
                              aria-pressed={!isHidden}
                              title={isHidden ? 'Show events' : 'Hide events'}
                              className={`flex w-full flex-col items-start gap-1 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-3 text-left shadow-inner transition hover:shadow-md ${isHidden ? 'opacity-50' : ''}`}
                            >
                              <div className="flex w-full items-start justify-between gap-2">
                                <span className="text-[11px] uppercase tracking-[0.18em] text-sky-700">
                                  {statusText}
                                </span>
                                {canManageOutlook && account.accountId ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleDisconnectMailbox({
                                        accountId: account.accountId,
                                        email: account.email,
                                        isPrimary: Boolean(isPrimary),
                                      });
                                    }}
                                    disabled={disconnectingId === account.accountId}
                                    className="rounded-full border border-sky-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {disconnectingId === account.accountId ? 'Disconnecting...' : 'Disconnect'}
                                  </button>
                                ) : null}
                              </div>
                              <span className="text-sm font-semibold text-slate-900">
                                {account.name || account.email}
                              </span>
                              <span className="text-xs text-slate-600">{account.email}</span>
                              <span className="text-[11px] text-slate-500">
                                Timezone {selectedTimezone.label}
                              </span>
                            </div>
                          );
                        }
                        if (account.status === 'needs-access') {
                          return (
                            <div
                              key={account.email}
                              className="flex w-full flex-col items-start gap-1 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-left shadow-inner"
                            >
                              <span className="text-[11px] uppercase tracking-[0.18em] text-amber-700">
                                Needs access
                              </span>
                              <span className="text-sm font-semibold text-slate-900">{account.email}</span>
                              <span className="text-xs text-amber-700">
                                Shared calendar access required. Ask the mailbox owner to share with a connected account.
                              </span>
                            </div>
                          );
                        }
                        const addedLabel = isHidden ? 'Added (hidden)' : 'Added';
                        return (
                          <button
                            key={account.email}
                            type="button"
                            onClick={() => toggleMailboxVisibility(mailboxKey)}
                            aria-pressed={!isHidden}
                            title={isHidden ? 'Show events' : 'Hide events'}
                            className={`flex w-full flex-col items-start gap-1 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left shadow-inner transition hover:shadow-md ${isHidden ? 'opacity-50' : ''}`}
                          >
                            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                              {addedLabel}
                            </span>
                            <span className="text-sm font-semibold text-slate-900">{account.email}</span>
                            <span className="text-xs text-slate-500">
                              Will sync on the next refresh if shared with a connected account.
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                        {canManageOutlook ? 'No mailboxes added yet.' : 'No mailboxes synced yet.'}
                      </div>
                    )}
                    {canManageOutlook ? (
                      <>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Time zone</div>
                          <div className="mt-2">
                            <select
                              value={timezoneId}
                              onChange={(e) => setTimezoneId(e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-1 ring-transparent focus:ring-slate-300"
                            >
                              {TIMEZONE_OPTIONS.map((tz) => (
                                <option key={tz.id} value={tz.id}>
                                  {tz.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="mt-2 text-xs text-slate-500">
                            Calendar times show in {selectedTimezone.label}.
                          </div>
                        </div>
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                            Add mailbox
                          </div>
                          <div className="mt-2 flex gap-2">
                            <input
                              value={mailboxInput}
                              onChange={(e) => {
                                setMailboxInput(e.target.value);
                                if (mailboxError) setMailboxError(null);
                              }}
                              placeholder="name@company.com"
                              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-slate-300"
                            />
                            <button
                              type="button"
                              onClick={handleAddMailbox}
                              className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
                            >
                              Add
                            </button>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            Extra mailboxes must be shared with a connected Outlook account. You can paste multiple emails
                            separated by commas.
                          </p>
                          <p className="mt-2 text-xs text-slate-500">
                            To show multiple mailboxes at once, connect each Outlook account you want to include.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={handleSyncMailboxes}
                              disabled={!canSyncNow || eventsLoading}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Sync mailboxes
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                signIn('azure-ad', { callbackUrl: '/calendar' }, { prompt: 'select_account' })
                              }
                              disabled={outlookLoading}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                              title="Link another Outlook account."
                            >
                              Add Outlook account
                            </button>
                          </div>
                          {mailboxError ? (
                            <div className="mt-2 text-xs text-red-600">{mailboxError}</div>
                          ) : null}
                          {extraMailboxes.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {extraMailboxes.map((mailbox) => (
                                <span
                                  key={mailbox}
                                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700"
                                >
                                  {mailbox}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveMailbox(mailbox)}
                                    className="text-slate-500 hover:text-slate-800"
                                  >
                                    &times;
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </aside>

          <section className="space-y-4 basis-[70%]">
            <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_18px_60px_-50px_rgba(15,23,42,0.4)]">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Upcoming events</p>
                  <h2 className="text-2xl font-semibold text-slate-900">Calendar</h2>
                  <p className="text-sm text-slate-600">
                    We refresh on focus and every few minutes. Switch to webhooks when ready.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSyncMailboxes}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                    disabled={!canSyncNow || eventsLoading}
                  >
                    Refresh
                  </button>
                </div>
              </div>

              {connectedAccounts.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {connectedAccounts.map((account) => (
                    <span key={account.email} className={chipBase}>
                      {account.name ? `${account.name} (${account.email})` : account.email}
                    </span>
                  ))}
                </div>
              ) : null}

              {warning ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {warning}
                </div>
              ) : null}
              {error ? (
                <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <div className="relative mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {eventsLoading ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm">
                    <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500" />
                  </div>
                ) : null}
                {!canShowMailboxes && !eventsLoading ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 px-6 text-center text-sm text-slate-600 backdrop-blur-sm">
                    {canManageOutlook
                      ? 'Connect your Outlook account to view events.'
                      : 'No cached events yet. Ask an admin to sync Outlook.'}
                  </div>
                ) : null}
                <FullCalendar
                  plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                  initialView="timeGridWeek"
                  headerToolbar={false}
                  height="auto"
                  slotMinTime="06:00:00"
                  slotMaxTime="23:30:00"
                  allDaySlot
                  weekends
                  expandRows
                  nowIndicator
                  timeZone={selectedTimezone.calendar}
                  events={calendarEvents}
                  eventContent={eventContent}
                  eventBackgroundColor="#0284c7"
                  eventBorderColor="#0ea5e9"
                  eventTextColor="#fff"
                  dayHeaderFormat={{ weekday: 'short', month: 'short', day: 'numeric' }}
                  datesSet={handleDatesSet}
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

