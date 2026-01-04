import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '../../../../auth/[...nextauth]/route';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!session || !userId) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { mailbox?: string; accountId?: string } | null;
  const url = new URL(request.url);
  const params = await context.params;
  const accountId = params?.id || body?.accountId || url.searchParams.get('accountId') || '';
  if (!accountId || accountId === 'undefined' || accountId === 'null') {
    return NextResponse.json({ message: 'Missing account id.' }, { status: 400 });
  }
  const mailbox = body?.mailbox || url.searchParams.get('mailbox') || '';
  const normalizedMailbox = mailbox.trim().toLowerCase();

  const result = await prisma.account.deleteMany({
    where: { id: accountId, userId, provider: 'azure-ad' },
  });

  if (!result.count) {
    return NextResponse.json({ message: 'Account not found.' }, { status: 404 });
  }

  const authHeader = request.headers.get('authorization');
  if (normalizedMailbox && authHeader) {
    try {
      await fetch(`${API_BASE}/calendar/events/sync`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mailboxes: [normalizedMailbox],
          events: [],
        }),
      });
    } catch (err) {
      console.error('Failed to clear cached events for mailbox', err);
    }
  }

  return NextResponse.json({ ok: true });
}
