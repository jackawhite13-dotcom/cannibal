import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.access_token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { propertyId, eventName } = await req.json()
  if (!propertyId || !eventName) {
    return NextResponse.json({ error: 'propertyId and eventName required' }, { status: 400 })
  }

  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            stringFilter: { value: eventName, matchType: 'EXACT' },
          },
        },
        dateRanges: [{ startDate, endDate }],
        limit: 10000,
      }),
    }
  )

  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: res.status })
  }

  const data = await res.json()
  const pathMap: Record<string, number> = {}

  for (const row of data.rows || []) {
    const path = (row.dimensionValues[0].value as string).replace(/\/$/, '') || '/'
    const count = parseInt(row.metricValues[0].value, 10) || 0
    pathMap[path] = (pathMap[path] || 0) + count
  }

  return NextResponse.json({ pathMap, eventName })
}
