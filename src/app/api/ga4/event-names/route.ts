import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.access_token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { propertyId } = await req.json()
  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
  }

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dateRanges: [{ startDate: '180daysAgo', endDate: 'today' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 100,
      }),
    }
  )

  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: res.status })
  }

  const data = await res.json()
  const eventNames: string[] = (data.rows || []).map(
    (row: { dimensionValues: { value: string }[] }) => row.dimensionValues[0].value
  )

  return NextResponse.json({ eventNames })
}
