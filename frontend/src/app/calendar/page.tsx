'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, signOut, useSession } from 'next-auth/react';
import FullCalendar from '@fullcalendar/react';
import { DatesSetArg, EventContentArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import TopNav from '../../components/TopNav';
import { useAuth } from '../../lib/useAuth';

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  isAllDay?: boolean;
  organizer?: string;
  location?: string;
};

type CalendarEventsResponse = {
  account?: {
    email?: string | null;
    name?: string | null;
    timezone?: string | null;
  };
  events: CalendarEvent[];
  source: 'graph' | 'sample';
  warning?: string;
  message?: string;
};

const chipBase =
  'inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700';

const defaultTimezone =
  typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

export default function CalendarPage() {
  const router = useRouter();
  const { user, token, loading } = useAuth();
  const { data: outlookSession, status: outlookStatus } = useSession();
  const [viewRange, setViewRange] = useState<{ start: string; end: string } | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'graph' | 'sample'>('graph');
  const [warning, setWarning] = useState<string | undefined>();
  const [connectedEmail, setConnectedEmail] = useState<string | undefined>();
  const [connectedName, setConnectedName] = useState<string | undefined>();
  const [connectedTimezone, setConnectedTimezone] = useState<string | undefined>(defaultTimezone);

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      router.replace('/auth');
    }
  }, [loading, user, token, router]);

  useEffect(() => {
    if (outlookStatus !== 'authenticated' || !viewRange) return;
    void fetchEvents(viewRange);
  }, [outlookStatus, viewRange]);

  const eventContent = (arg: EventContentArg) => {
    const location = arg.event.extendedProps.location as string | undefined;
    const organizer = arg.event.extendedProps.organizer as string | undefined;
    return (
      <div className="flex flex-col gap-0.5 text-[11px] leading-tight text-white">
        <div className="font-semibold">{arg.event.title}</div>
        {location ? <div className="text-white/90">{location}</div> : null}
        {organizer ? <div className="text-white/75">{organizer}</div> : null}
      </div>
    );
  };

  const handleDatesSet = (info: DatesSetArg) => {
    setViewRange({ start: info.startStr, end: info.endStr });
  };

  const calendarEvents = useMemo(
    () =>
      events.map((ev) => ({
        ...ev,
        allDay: Boolean(ev.isAllDay),
      })),
    [events],
  );

  async function fetchEvents(range: { start: string; end: string }) {
    setEventsLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ start: range.start, end: range.end });
      const res = await fetch(`/api/calendar/outlook?${qs.toString()}`, { cache: 'no-store' });
      const data = (await res.json()) as CalendarEventsResponse;
      if (!res.ok) {
        setError(data.message || 'Unable to load events.');
        setEvents([]);
        return;
      }
      setEvents(data.events || []);
      setDataSource(data.source || 'graph');
      setWarning(data.warning);
      setConnectedEmail(data.account?.email ?? outlookSession?.user?.email ?? undefined);
      setConnectedName(data.account?.name ?? outlookSession?.user?.name ?? undefined);
      setConnectedTimezone(data.account?.timezone ?? defaultTimezone);
    } catch (err) {
      console.error(err);
      setError('Unable to load events right now.');
    } finally {
      setEventsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#eaf2ff] via-[#f4f7ff] to-white text-slate-900">
      <TopNav />
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 py-6">
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
          <aside className="space-y-4 md:sticky md:top-6 h-full">
            <div className="h-full rounded-3xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_18px_60px_-50px_rgba(15,23,42,0.4)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Meeting schedule</p>
                  <h2 className="text-xl font-semibold text-slate-900">Connected mailboxes</h2>
                </div>
                <button
                  onClick={() => (outlookStatus === 'authenticated' ? signOut({ callbackUrl: '/calendar' }) : signIn('azure-ad'))}
                  className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  {outlookStatus === 'authenticated' ? 'Disconnect' : 'Sync'}
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {outlookStatus === 'loading' ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    Checking connection...
                  </div>
                ) : outlookStatus !== 'authenticated' ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                    Connect your Outlook account to see meetings in real time.
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-1 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-3 text-left shadow-inner transition hover:border-sky-300"
                    onClick={() => viewRange && fetchEvents(viewRange)}
                  >
                    <span className="text-[11px] uppercase tracking-[0.18em] text-sky-700">Active</span>
                    <span className="text-sm font-semibold text-slate-900">{connectedName || connectedEmail}</span>
                    <span className="text-xs text-slate-600">{connectedEmail}</span>
                    {connectedTimezone ? (
                      <span className="text-[11px] text-slate-500">Timezone {connectedTimezone}</span>
                    ) : null}
                  </button>
                )}
              </div>
            </div>
          </aside>

          <section className="space-y-4 flex-1">
            <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_18px_60px_-50px_rgba(15,23,42,0.4)]">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Upcoming events</p>
                  <h2 className="text-2xl font-semibold text-slate-900">Live Microsoft Graph calendar</h2>
                  <p className="text-sm text-slate-600">
                    We refresh on focus and every few minutes. Switch to webhooks when ready.
                  </p>
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
                <div className="flex items-center gap-2">
                  <span
                    className={`${chipBase} ${
                      dataSource === 'sample'
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-sky-200 bg-sky-50 text-sky-700'
                    }`}
                  >
                    {dataSource === 'sample' ? 'Sample events' : 'Microsoft Graph'}
                  </span>
                  {connectedTimezone ? <span className={chipBase}>TZ {connectedTimezone}</span> : null}
                </div>
              </div>

              {connectedEmail ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={chipBase}>{connectedEmail}</span>
                  {connectedName ? <span className={chipBase}>{connectedName}</span> : null}
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
                {outlookStatus !== 'authenticated' ? (
                  <div className="flex h-[600px] items-center justify-center text-sm text-slate-600">
                    Connect your Outlook account to view events.
                  </div>
                ) : (
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
                    events={calendarEvents}
                    eventContent={eventContent}
                    eventBackgroundColor="#0284c7"
                    eventBorderColor="#0ea5e9"
                    eventTextColor="#fff"
                    dayHeaderFormat={{ weekday: 'short', month: 'short', day: 'numeric' }}
                    datesSet={handleDatesSet}
                  />
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
