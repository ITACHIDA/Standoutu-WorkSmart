import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

type GraphEvent = {
  id: string;
  subject?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  organizer?: { emailAddress?: { address?: string; name?: string } };
  location?: { displayName?: string };
};

function mapEvents(events: GraphEvent[]) {
  return events
    .map((ev) => ({
      id: ev.id,
      title: ev.subject || 'Busy',
      start: ev.start?.dateTime || '',
      end: ev.end?.dateTime || '',
      isAllDay: Boolean(ev.isAllDay),
      organizer: ev.organizer?.emailAddress?.name || ev.organizer?.emailAddress?.address || undefined,
      location: ev.location?.displayName || undefined,
    }))
    .filter((ev) => ev.start && ev.end);
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const start = url.searchParams.get('start') || new Date().toISOString();
  const end = url.searchParams.get('end') || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const tz = session.user?.timeZone || 'UTC';

  const graphUrl = new URL('https://graph.microsoft.com/v1.0/me/calendarView');
  graphUrl.searchParams.set('startDateTime', start);
  graphUrl.searchParams.set('endDateTime', end);
  graphUrl.searchParams.set('$select', 'subject,start,end,location,isAllDay,organizer');

  const res = await fetch(graphUrl, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      Prefer: `outlook.timezone="${tz}"`,
    },
  });
  const data = (await res.json()) as { value?: GraphEvent[]; error?: { message?: string } };

  if (!res.ok || !Array.isArray(data.value)) {
    const message = data?.error?.message || 'Failed to load calendar events from Microsoft Graph';
    return NextResponse.json({ message }, { status: res.status || 500 });
  }

  return NextResponse.json({
    account: {
      email: session.user?.email,
      name: session.user?.name,
      timezone: tz,
    },
    events: mapEvents(data.value),
    source: 'graph',
  });
}
