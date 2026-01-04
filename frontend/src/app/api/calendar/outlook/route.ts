import type { Account } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '../../auth/[...nextauth]/route';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';
const tenantId = process.env.MS_TENANT_ID || 'common';
const clientId = process.env.MS_CLIENT_ID ?? '';
const clientSecret = process.env.MS_CLIENT_SECRET ?? '';
const includeSharedCalendars =
  process.env.MS_GRAPH_SHARED_CALENDARS === 'true' ||
  (tenantId !== 'common' && tenantId !== 'consumers');
const refreshScope = includeSharedCalendars
  ? 'offline_access Calendars.Read User.Read Calendars.Read.Shared'
  : 'offline_access Calendars.Read User.Read';

type GraphEvent = {
  id: string;
  subject?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  organizer?: { emailAddress?: { address?: string; name?: string } };
  location?: { displayName?: string };
};

type GraphProfile = {
  mail?: string;
  userPrincipalName?: string;
  displayName?: string;
};

type GraphEventsResponse = { value?: GraphEvent[]; error?: { message?: string } };
type GraphTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error_description?: string;
};

type StoredEvent = {
  id: string;
  title?: string | null;
  start?: string;
  end?: string;
  isAllDay?: boolean;
  organizer?: string | null;
  location?: string | null;
  mailbox?: string | null;
};

type StoredEventsResponse = {
  events?: StoredEvent[];
  message?: string;
};

type CalendarAccount = {
  email: string;
  name?: string | null;
  timezone?: string | null;
  accountId?: string;
  isPrimary?: boolean;
};

const normalizeMailbox = (mailbox: string) => mailbox.trim().toLowerCase();

function mapEvents(events: GraphEvent[], mailbox: string) {
  return events
    .map((ev) => ({
      id: `${mailbox}:${ev.id}`,
      title: ev.subject || 'Busy',
      start: ev.start?.dateTime || '',
      end: ev.end?.dateTime || '',
      isAllDay: Boolean(ev.isAllDay),
      organizer: ev.organizer?.emailAddress?.name || ev.organizer?.emailAddress?.address || undefined,
      location: ev.location?.displayName || undefined,
      mailbox,
    }))
    .filter((ev) => ev.start && ev.end);
}

function normalizeStoredEvents(events: StoredEvent[]) {
  return events
    .map((event) => ({
      id: event.id,
      title: event.title || 'Busy',
      start: event.start || '',
      end: event.end || '',
      isAllDay: Boolean(event.isAllDay),
      organizer: event.organizer ?? undefined,
      location: event.location ?? undefined,
      mailbox: event.mailbox ? normalizeMailbox(event.mailbox) : '',
    }))
    .filter((event) => event.start && event.end);
}

async function fetchStoredEvents(params: {
  authHeader: string | null;
  start: string;
  end: string;
  mailboxes: string[];
}) {
  const { authHeader, start, end, mailboxes } = params;
  if (!authHeader) {
    return { events: [] as ReturnType<typeof normalizeStoredEvents>, error: 'Missing auth token.' };
  }
  try {
    const storageUrl = new URL(`${API_BASE}/calendar/events/stored`);
    storageUrl.searchParams.set('start', start);
    storageUrl.searchParams.set('end', end);
    if (mailboxes.length) {
      storageUrl.searchParams.set('mailboxes', mailboxes.join(','));
    }
    const res = await fetch(storageUrl, {
      headers: {
        Authorization: authHeader,
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      return { events: [] as ReturnType<typeof normalizeStoredEvents>, error: 'Failed to load cached events.' };
    }
    const data = (await res.json()) as StoredEventsResponse;
    const events = normalizeStoredEvents(Array.isArray(data.events) ? data.events : []);
    return { events };
  } catch (err) {
    console.error('Stored events lookup failed', err);
    return { events: [] as ReturnType<typeof normalizeStoredEvents>, error: 'Failed to load cached events.' };
  }
}

async function ensureFreshToken(account: Account): Promise<Account> {
  const expiresAt = account.expires_at ? account.expires_at * 1000 : null;
  if (account.access_token && expiresAt && Date.now() < expiresAt - 60_000) {
    return account;
  }
  if (!account.refresh_token || !clientId || !clientSecret) {
    return account;
  }
  try {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: account.refresh_token,
      scope: refreshScope,
    });
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = (await res.json()) as GraphTokenResponse;
    if (!res.ok || !data.access_token) {
      return account;
    }
    const expiresAtSeconds = data.expires_in
      ? Math.floor(Date.now() / 1000) + data.expires_in
      : account.expires_at ?? undefined;
    return prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: data.access_token,
        refresh_token: data.refresh_token ?? account.refresh_token,
        expires_at: expiresAtSeconds,
      },
    });
  } catch (err) {
    console.error('Graph token refresh failed', err);
    return account;
  }
}

async function fetchProfile(accessToken: string) {
  try {
    const res = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      },
    );
    if (!res.ok) return null;
    const profile = (await res.json()) as GraphProfile;
    const email = profile.mail || profile.userPrincipalName;
    if (!email) return null;
    return {
      email: normalizeMailbox(email),
      name: profile.displayName || undefined,
    };
  } catch (err) {
    console.error('Graph profile lookup failed', err);
    return null;
  }
}

async function fetchCalendarView(params: {
  accessToken: string;
  start: string;
  end: string;
  tz: string;
  mailbox?: string;
  label: string;
}) {
  const { accessToken, start, end, tz, mailbox, label } = params;
  const graphUrl = new URL(
    mailbox
      ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/calendarView`
      : 'https://graph.microsoft.com/v1.0/me/calendarView',
  );
  graphUrl.searchParams.set('startDateTime', start);
  graphUrl.searchParams.set('endDateTime', end);
  graphUrl.searchParams.set('$select', 'subject,start,end,location,isAllDay,organizer');

  const res = await fetch(graphUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: `outlook.timezone="${tz}"`,
    },
    cache: 'no-store',
  });
  const data = (await res.json()) as GraphEventsResponse;
  if (!res.ok || !Array.isArray(data.value)) {
    const message = data?.error?.message || 'Failed to load calendar events from Microsoft Graph';
    return { events: [] as ReturnType<typeof mapEvents>, error: message };
  }
  return { events: mapEvents(data.value, label) };
}

async function loadConnectedAccounts(params: {
  accounts: Account[];
  sessionAccessToken?: string;
  primaryEmail?: string;
  primaryAccountId?: string;
  tz: string;
}) {
  const { accounts, sessionAccessToken, primaryEmail, primaryAccountId, tz } = params;
  const results = await Promise.all(
    accounts.map(async (account) => {
      const fresh = await ensureFreshToken(account);
      const token = fresh.access_token ?? undefined;
      if (!token) return null;
      const profile = await fetchProfile(token);
      const mailbox = profile?.email || normalizeMailbox(account.providerAccountId);
      if (!mailbox) return null;
      return {
        email: mailbox,
        name: profile?.name ?? undefined,
        timezone: tz,
        accountId: account.id,
        isPrimary: primaryAccountId ? account.providerAccountId === primaryAccountId : false,
      } satisfies CalendarAccount;
    }),
  );

  const connected = results.filter(Boolean) as CalendarAccount[];
  if (!connected.length && sessionAccessToken) {
    const profile = await fetchProfile(sessionAccessToken);
    const fallbackEmail = profile?.email || primaryEmail;
    if (fallbackEmail) {
      connected.push({
        email: normalizeMailbox(fallbackEmail),
        name: profile?.name ?? undefined,
        timezone: tz,
      });
    }
  }

  const unique = new Map<string, CalendarAccount>();
  connected.forEach((account) => {
    unique.set(account.email, account);
  });
  return Array.from(unique.values());
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');

  const url = new URL(request.url);
  const source = url.searchParams.get('source')?.toLowerCase();
  const preferStored = source !== 'graph';
  const start = url.searchParams.get('start') || new Date().toISOString();
  const end = url.searchParams.get('end') || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const tzParam = url.searchParams.get('timezone');
  const mailboxParams = [
    ...url.searchParams.getAll('mailbox'),
    ...(url.searchParams.get('mailboxes') || '').split(','),
  ]
    .map(normalizeMailbox)
    .filter(Boolean);

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const sessionAccessToken = (session as { accessToken?: string } | undefined)?.accessToken;
  const primaryAccountId = (session as { primaryAccountId?: string } | undefined)?.primaryAccountId;
  const tz = tzParam || session?.user?.timeZone || 'UTC';
  const primaryEmail = session?.user?.email?.toLowerCase();

  if (!session || !userId) {
    if (preferStored) {
      const { events: cachedEvents, error } = await fetchStoredEvents({
        authHeader,
        start,
        end,
        mailboxes: mailboxParams,
      });
      if (error) {
        return NextResponse.json({ message: error }, { status: 401 });
      }
      const accountMap = new Map<string, CalendarAccount>();
      cachedEvents.forEach((event) => {
        const mailbox = event.mailbox ? normalizeMailbox(event.mailbox) : '';
        if (!mailbox || accountMap.has(mailbox)) return;
        accountMap.set(mailbox, { email: mailbox, timezone: tz });
      });
      const accountsList = Array.from(accountMap.values());
      const sortedAccounts = accountsList.sort((a, b) => a.email.localeCompare(b.email));
      return NextResponse.json({
        accounts: sortedAccounts,
        events: cachedEvents,
        source: 'db',
        failedMailboxes: [],
      });
    }
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const extraMailboxes = Array.from(new Set(mailboxParams));

  const accounts = await prisma.account.findMany({
    where: { userId, provider: 'azure-ad' },
  });

  if (preferStored) {
    const { events: cachedEvents } = await fetchStoredEvents({
      authHeader,
      start,
      end,
      mailboxes: [],
    });
    if (cachedEvents.length) {
      const connectedAccounts = await loadConnectedAccounts({
        accounts,
        sessionAccessToken,
        primaryEmail,
        primaryAccountId,
        tz,
      });
      const accountMap = new Map<string, CalendarAccount>();
      connectedAccounts.forEach((account) => {
        accountMap.set(account.email, account);
      });
      cachedEvents.forEach((event) => {
        const mailbox = event.mailbox ? normalizeMailbox(event.mailbox) : '';
        if (!mailbox || accountMap.has(mailbox)) return;
        accountMap.set(mailbox, { email: mailbox, timezone: tz });
      });
      const accountsList = Array.from(accountMap.values());
      const sortedAccounts = accountsList.sort((a, b) => {
        if (primaryEmail && a.email === primaryEmail) return -1;
        if (primaryEmail && b.email === primaryEmail) return 1;
        return a.email.localeCompare(b.email);
      });
      return NextResponse.json({
        accounts: sortedAccounts,
        events: cachedEvents,
        source: 'db',
        failedMailboxes: [],
      });
    }
  }

  const accountResults = await Promise.all(
    accounts.map(async (account) => {
      const fresh = await ensureFreshToken(account);
      const token = fresh.access_token ?? undefined;
      const isPrimary = primaryAccountId ? account.providerAccountId === primaryAccountId : false;
      if (!token) {
        return {
          status: 'error' as const,
          mailbox: normalizeMailbox(account.providerAccountId),
          providerAccountId: account.providerAccountId,
          accountId: account.id,
          isPrimary,
          error: 'Missing access token.',
        };
      }
      const profile = await fetchProfile(token);
      const mailbox = profile?.email || normalizeMailbox(account.providerAccountId);
      const { events, error } = await fetchCalendarView({
        accessToken: token,
        start,
        end,
        tz,
        label: mailbox,
      });
      if (error) {
        return {
          status: 'error' as const,
          mailbox,
          providerAccountId: account.providerAccountId,
          accountId: account.id,
          isPrimary,
          error,
          name: profile?.name,
        };
      }
      return {
        status: 'success' as const,
        mailbox,
        providerAccountId: account.providerAccountId,
        accountId: account.id,
        isPrimary,
        name: profile?.name,
        events,
      };
    }),
  );

  if (!accountResults.length && sessionAccessToken) {
    const fallbackMailbox = primaryEmail || 'me';
    const { events, error } = await fetchCalendarView({
      accessToken: sessionAccessToken,
      start,
      end,
      tz,
      label: fallbackMailbox,
    });
    if (!error) {
      accountResults.push({
        status: 'success' as const,
        mailbox: fallbackMailbox,
        providerAccountId: primaryAccountId || fallbackMailbox,
        accountId: primaryAccountId || 'session',
        isPrimary: true,
        name: session.user?.name ?? undefined,
        events,
      });
    } else {
      accountResults.push({
        status: 'error' as const,
        mailbox: fallbackMailbox,
        providerAccountId: primaryAccountId || fallbackMailbox,
        accountId: primaryAccountId || 'session',
        isPrimary: true,
        error,
      });
    }
  }

  const successfulAccounts = accountResults.filter((result) => result.status === 'success') as Array<{
    status: 'success';
    mailbox: string;
    providerAccountId: string;
    accountId: string;
    isPrimary: boolean;
    name?: string;
    events: ReturnType<typeof mapEvents>;
  }>;

  const failedAccounts = accountResults.filter((result) => result.status === 'error') as Array<{
    status: 'error';
    mailbox: string;
    providerAccountId: string;
    accountId: string;
    isPrimary: boolean;
    error: string;
  }>;

  const connectedMailboxSet = new Set(successfulAccounts.map((result) => result.mailbox));
  const sharedMailboxes = extraMailboxes.filter((mailbox) => !connectedMailboxSet.has(mailbox));

  const sharedResults = await Promise.all(
    sharedMailboxes.map(async (mailbox) => {
      if (!sessionAccessToken) {
        return { mailbox, error: 'Missing access token.' };
      }
      const { events, error } = await fetchCalendarView({
        accessToken: sessionAccessToken,
        start,
        end,
        tz,
        mailbox,
        label: mailbox,
      });
      if (error) {
        return { mailbox, error };
      }
      return { mailbox, events };
    }),
  );

  const successfulShared = sharedResults.filter((result) => 'events' in result) as Array<{
    mailbox: string;
    events: ReturnType<typeof mapEvents>;
  }>;
  const failedShared = sharedResults.filter((result) => 'error' in result) as Array<{
    mailbox: string;
    error: string;
  }>;

  const accountsList: CalendarAccount[] = [
    ...successfulAccounts.map((result) => ({
      email: result.mailbox,
      name: result.name ?? undefined,
      timezone: tz,
      accountId: result.accountId,
      isPrimary: result.isPrimary,
    })),
    ...successfulShared.map((result) => ({
      email: result.mailbox,
      timezone: tz,
    })),
  ];

  if (!accountsList.length) {
    const firstError = failedAccounts[0] || failedShared[0];
    return NextResponse.json(
      { message: firstError?.error || 'Failed to load calendar events from Microsoft Graph' },
      { status: 500 },
    );
  }

  const events = [
    ...successfulAccounts.flatMap((result) => result.events),
    ...successfulShared.flatMap((result) => result.events),
  ];

  const failedMailboxes = Array.from(
    new Set([
      ...failedAccounts.map((result) => result.mailbox),
      ...failedShared.map((result) => result.mailbox),
    ]),
  );
  const warning = failedMailboxes.length
    ? `Failed to load calendars for: ${failedMailboxes.join(', ')}.`
    : undefined;

  let storedEvents = events;
  let storageWarning: string | undefined;
  const syncMailboxes = accountsList.map((account) => account.email);

  if (!authHeader) {
    storageWarning = 'Missing auth token; events not stored.';
  } else {
    try {
      const syncRes = await fetch(`${API_BASE}/calendar/events/sync`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mailboxes: syncMailboxes,
          timezone: tz,
          events,
        }),
      });
      if (syncRes.ok) {
        const syncData = (await syncRes.json()) as { events?: typeof events };
        if (Array.isArray(syncData.events)) {
          storedEvents = syncData.events as typeof events;
        }
      } else {
        storageWarning = 'Failed to store events; showing live data.';
      }
    } catch (err) {
      console.error(err);
      storageWarning = 'Failed to store events; showing live data.';
    }
  }

  const combinedWarning = [warning, storageWarning].filter(Boolean).join(' ') || undefined;

  const sortedAccounts = accountsList.sort((a, b) => {
    if (primaryEmail && a.email === primaryEmail) return -1;
    if (primaryEmail && b.email === primaryEmail) return 1;
    return a.email.localeCompare(b.email);
  });

  return NextResponse.json({
    accounts: sortedAccounts,
    events: storedEvents,
    source: 'graph',
    warning: combinedWarning,
    failedMailboxes,
  });
}
