import { NextResponse } from 'next/server'
import { auth } from '@/auth'

export async function GET() {
  const session = await auth()
  if (!session?.access_token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const res = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: err }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json(data)
}
