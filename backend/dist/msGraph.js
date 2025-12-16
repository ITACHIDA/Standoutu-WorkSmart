"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadOutlookEvents = loadOutlookEvents;
const graphConfig = {
    tenantId: process.env.MS_TENANT_ID,
    clientId: process.env.MS_CLIENT_ID,
    clientSecret: process.env.MS_CLIENT_SECRET,
};
let tokenCache = null;
async function getGraphToken(logger) {
    if (!graphConfig.clientId || !graphConfig.clientSecret || !graphConfig.tenantId) {
        throw new Error('Microsoft Graph credentials are missing');
    }
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt > now + 60000) {
        return tokenCache.accessToken;
    }
    const params = new URLSearchParams({
        client_id: graphConfig.clientId,
        client_secret: graphConfig.clientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
    });
    const res = await fetch(`https://login.microsoftonline.com/${graphConfig.tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
    });
    const data = (await res.json());
    if (!res.ok || !data.access_token) {
        logger?.error({ data }, 'graph-token-failed');
        throw new Error(`Failed to fetch Microsoft Graph token: ${data.error ?? res.statusText}`);
    }
    tokenCache = {
        accessToken: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 3500) * 1000,
    };
    return tokenCache.accessToken;
}
function ensureDate(input) {
    const dt = new Date(input);
    if (Number.isNaN(dt.getTime())) {
        throw new Error('Invalid date range');
    }
    return dt;
}
function startOfWeekUtc(date) {
    const copy = new Date(date);
    const day = copy.getUTCDay();
    const diff = copy.getUTCDate() - day;
    copy.setUTCDate(diff);
    copy.setUTCHours(0, 0, 0, 0);
    return copy;
}
function toIso(date, dayOffset, hour, minute, durationMinutes) {
    const start = new Date(date);
    start.setUTCDate(start.getUTCDate() + dayOffset);
    start.setUTCHours(hour, minute, 0, 0);
    const end = new Date(start);
    end.setUTCMinutes(end.getUTCMinutes() + durationMinutes);
    return { start: start.toISOString(), end: end.toISOString() };
}
function buildSampleEvents(rangeStart) {
    const base = startOfWeekUtc(ensureDate(rangeStart));
    const template = [
        { day: 1, hour: 15, minute: 0, duration: 60, title: 'Interview - CRM - Senior', location: 'Boardroom A' },
        { day: 1, hour: 19, minute: 0, duration: 30, title: 'Interview', location: 'Teams call' },
        { day: 2, hour: 14, minute: 0, duration: 45, title: 'Interview with Data', location: 'Virtual room' },
        { day: 3, hour: 10, minute: 30, duration: 60, title: 'Interview - QA & Senior', location: 'HQ - Blue' },
        { day: 3, hour: 15, minute: 0, duration: 60, title: 'Interview', location: 'Teams call' },
        { day: 4, hour: 12, minute: 0, duration: 60, title: 'Interview with Product', location: 'Zoom' },
        { day: 4, hour: 15, minute: 30, duration: 60, title: 'Interview with Data', location: 'Zoom' },
        { day: 4, hour: 17, minute: 30, duration: 60, title: 'Interview with Executive', location: 'Office' },
        { day: 5, hour: 14, minute: 30, duration: 30, title: 'Interview', location: 'Office' },
        { day: 6, hour: 16, minute: 0, duration: 45, title: 'Interview with Brandon', location: 'Virtual' },
    ];
    return template.map((item, idx) => {
        const times = toIso(base, item.day, item.hour, item.minute, item.duration);
        return {
            id: `sample-${idx}`,
            title: item.title,
            start: times.start,
            end: times.end,
            location: item.location,
            organizer: 'Scheduling bot',
        };
    });
}
async function loadOutlookEvents(params) {
    const { email, rangeStart, rangeEnd, timezone, logger } = params;
    const tz = timezone || 'UTC';
    try {
        const token = await getGraphToken(logger);
        const url = new URL(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/calendarView`);
        url.searchParams.set('startDateTime', rangeStart);
        url.searchParams.set('endDateTime', rangeEnd);
        url.searchParams.set('$select', 'subject,start,end,location,isAllDay,organizer');
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Prefer: `outlook.timezone="${tz}"`,
            },
        });
        const data = (await res.json());
        if (!res.ok) {
            logger?.error({ status: res.status, data }, 'graph-events-failed');
            throw new Error(data?.error?.message || 'Failed to fetch events from Graph');
        }
        const events = Array.isArray(data?.value)
            ? data.value
                .map((ev) => ({
                id: ev.id,
                title: ev.subject || 'Busy',
                start: ev.start?.dateTime,
                end: ev.end?.dateTime,
                isAllDay: Boolean(ev.isAllDay),
                organizer: ev.organizer?.emailAddress?.name ||
                    ev.organizer?.emailAddress?.address ||
                    undefined,
                location: ev.location?.displayName,
            }))
                .filter((ev) => Boolean(ev.start) && Boolean(ev.end))
            : [];
        return { events, source: 'graph' };
    }
    catch (err) {
        logger?.warn({ err }, 'graph-events-fallback');
        return {
            events: buildSampleEvents(rangeStart),
            source: 'sample',
            warning: err instanceof Error ? err.message : 'Falling back to sample events due to an unknown error',
        };
    }
}
