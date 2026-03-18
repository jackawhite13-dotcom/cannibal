import { NextResponse } from 'next/server'
import { auth } from '@/auth'

export async function GET() {
  const session = await auth()
  if (!session?.access_token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const res = await fetch(
    'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200',
    { headers: { Authorization: `Bearer ${session.access_token}` } }
  )

  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: res.status })
  }

  const data = await res.json()
  const properties: { propertyId: string; displayName: string }[] = []

  for (const account of data.accountSummaries || []) {
    for (const prop of account.propertySummaries || []) {
      properties.push({
        propertyId: prop.property.replace('properties/', ''),
        displayName: prop.displayName,
      })
    }
  }

  return NextResponse.json({ properties })
}
