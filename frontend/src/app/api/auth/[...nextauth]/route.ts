import NextAuth, { type NextAuthOptions } from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';

const tenantId = process.env.MS_TENANT_ID || 'common';

async function refreshAccessToken(token: any) {
  try {
    if (!token.refresh_token) return { ...token, error: 'RefreshTokenMissing' as const };
    const params = new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID || '',
      client_secret: process.env.MS_CLIENT_SECRET || '',
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token as string,
      scope: 'openid profile email offline_access Calendars.Read',
    });
    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
    const data = (await res.json()) as any;
    if (!res.ok) {
      return { ...token, error: 'RefreshAccessTokenError' as const, message: data?.error_description };
    }
    return {
      ...token,
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? token.refresh_token,
      expires_at: Date.now() + (data.expires_in ?? 3500) * 1000,
    };
  } catch (err) {
    return { ...token, error: 'RefreshAccessTokenError' as const };
  }
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  providers: [
    AzureADProvider({
      clientId: process.env.MS_CLIENT_ID ?? '',
      clientSecret: process.env.MS_CLIENT_SECRET ?? '',
      tenantId,
      authorization: {
        params: {
          scope: 'openid profile email offline_access Calendars.Read',
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        const expiresIn = typeof account.expires_in === 'number' ? account.expires_in : Number(account.expires_in ?? 0);
        token.access_token = account.access_token;
        token.refresh_token = account.refresh_token;
        token.expires_at = Date.now() + ((expiresIn || 3500) * 1000);
        token.id_token = account.id_token;
        token.email = profile && typeof profile.email === 'string' ? profile.email : token.email;
        return token;
      }
      if (token.expires_at && Date.now() < token.expires_at - 5 * 60 * 1000) {
        return token;
      }
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.access_token as string | undefined;
      session.refreshToken = token.refresh_token as string | undefined;
      session.expiresAt = token.expires_at as number | undefined;
      if (token.email && session.user) {
        session.user.email = token.email as string;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
