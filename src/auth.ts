import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Initial sign-in: persist tokens from the provider
      if (account) {
        token.access_token = account.access_token
        token.refresh_token = account.refresh_token
        token.expires_at = account.expires_at
        return token
      }

      // Subsequent calls: return cached token if still valid (60s buffer)
      const expiresAt = token.expires_at as number | undefined
      if (expiresAt && Date.now() < expiresAt * 1000 - 60_000) {
        return token
      }

      // Expired — try to refresh
      if (!token.refresh_token) {
        return { ...token, error: 'NoRefreshToken' }
      }

      try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: token.refresh_token as string,
          }),
        })
        const refreshed = await res.json()
        if (!res.ok) throw refreshed

        return {
          ...token,
          access_token: refreshed.access_token,
          expires_at: Math.floor(Date.now() / 1000) + refreshed.expires_in,
          refresh_token: refreshed.refresh_token ?? token.refresh_token,
          error: undefined,
        }
      } catch {
        return { ...token, error: 'RefreshAccessTokenError' }
      }
    },
    async session({ session, token }) {
      session.access_token = token.access_token as string
      ;(session as { error?: string }).error = token.error as string | undefined
      return session
    },
  },
})
