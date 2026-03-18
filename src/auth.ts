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
      if (account) {
        token.access_token = account.access_token
        token.refresh_token = account.refresh_token
        token.expires_at = account.expires_at
      }
      return token
    },
    async session({ session, token }) {
      session.access_token = token.access_token as string
      return session
    },
  },
})
