import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'

export const maxDuration = 120

const GSC_URL = 'https://searchconsole.googleapis.com/webmasters/v3/sites'

const COUNTRY_CODES: Record<string, string> = {
  US: 'usa', UK: 'gbr', CA: 'can', AU: 'aus', DE: 'deu', FR: 'fra', IN: 'ind',
}

async function gscFetch(siteUrl: string, token: string, body: object) {
  const res = await fetch(`${GSC_URL}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res
}

function normalizeUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .toLowerCase()
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.access_token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { siteUrl, dateRange = 90, country = '' } = await req.json()
  if (!siteUrl) {
    return NextResponse.json({ error: 'siteUrl required' }, { status: 400 })
  }

  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const totalDays = dateRange

  const dimensionFilterGroups = country && COUNTRY_CODES[country] ? [{
    filters: [{ dimension: 'country', operator: 'equals', expression: COUNTRY_CODES[country] }]
  }] : []

  const baseQuery = {
    startDate, endDate,
    rowLimit: 25000,
    dimensions: ['query', 'page', 'date'],
    dataState: 'final',
    ...(dimensionFilterGroups.length > 0 ? { dimensionFilterGroups } : {}),
  }

  // Paginate through all results
  const allRows: { keys: string[] }[] = []
  let startRow = 0

  while (true) {
    let res
    try {
      res = await gscFetch(siteUrl, session.access_token, { ...baseQuery, startRow })
    } catch (e: unknown) {
      return NextResponse.json(
        { error: `GSC request failed: ${e instanceof Error ? e.message : 'unknown'}` },
        { status: 500 }
      )
    }

    if (!res.ok) {
      return NextResponse.json({ error: await res.text() }, { status: res.status })
    }

    const data = await res.json()
    const rows = data.rows || []
    allRows.push(...rows)

    // If we got fewer than 25k rows, we have all the data
    if (rows.length < 25000) break
    startRow += 25000
  }

  // Count unique dates per keyword-url pair
  const dateSetMap: Record<string, Set<string>> = {}
  for (const row of allRows) {
    const key = `${row.keys[0]}||${normalizeUrl(row.keys[1])}`
    if (!dateSetMap[key]) dateSetMap[key] = new Set()
    dateSetMap[key].add(row.keys[2])
  }

  const daysMap: Record<string, number> = {}
  for (const [key, dates] of Object.entries(dateSetMap)) {
    daysMap[key] = dates.size
  }

  return NextResponse.json({ daysMap, totalDays, totalRows: allRows.length })
}
