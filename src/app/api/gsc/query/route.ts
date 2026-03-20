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

  const { siteUrl, dateRange = 30, country = '', keywords = [] } = await req.json()
  if (!siteUrl) {
    return NextResponse.json({ error: 'siteUrl required' }, { status: 400 })
  }

  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const totalDays = dateRange

  const dimensionFilterGroups = country && COUNTRY_CODES[country] ? [{
    filters: [{ dimension: 'country', operator: 'equals', expression: COUNTRY_CODES[country] }]
  }] : []

  const baseParams = {
    startDate, endDate,
    rowLimit: 25000,
    dataState: 'final',
    ...(dimensionFilterGroups.length > 0 ? { dimensionFilterGroups } : {}),
  }

  // Build keyword set for filtering (lowercase for matching)
  const keywordSet = new Set((keywords as string[]).map((k: string) => k.toLowerCase().trim()))

  // Call 1: query+page → all URLs + avg position + clicks (paginated)
  const keywordUrlData: Record<string, { clicks: number; position: number }> = {}
  {
    let startRow = 0
    for (let batch = 0; batch < 4; batch++) {
      try {
        const res = await gscFetch(siteUrl, session.access_token, {
          ...baseParams,
          dimensions: ['query', 'page'],
          startRow,
        })
        if (!res.ok) break
        const data = await res.json()
        const batchRows = (data.rows || []) as { keys: string[]; clicks: number; position: number }[]
        for (const row of batchRows) {
          const query = row.keys[0].toLowerCase().trim()
          if (keywordSet.size === 0 || keywordSet.has(query)) {
            const key = `${row.keys[0]}||${normalizeUrl(row.keys[1])}`
            keywordUrlData[key] = {
              clicks: row.clicks,
              position: Math.round(row.position * 10) / 10,
            }
          }
        }
        if (batchRows.length < 25000) break
        startRow += 25000
      } catch {
        break
      }
    }
  }

  // Call 2: query+page+date → days ranked (paginated)
  const allDateRows: { keys: string[] }[] = []
  let startRow = 0
  const maxBatches = 4

  for (let batch = 0; batch < maxBatches; batch++) {
    let res
    try {
      res = await gscFetch(siteUrl, session.access_token, {
        ...baseParams,
        dimensions: ['query', 'page', 'date'],
        startRow,
      })
    } catch (e: unknown) {
      // If the date call fails, we still return what we have from call 1
      break
    }

    if (!res.ok) break

    const data = await res.json()
    const rows = data.rows || []
    allDateRows.push(...rows)
    if (rows.length < 25000) break
    startRow += 25000
  }

  // Count unique dates per keyword-url pair (only for our keywords)
  const dateSetMap: Record<string, Set<string>> = {}
  for (const row of allDateRows) {
    const query = row.keys[0].toLowerCase().trim()
    if (keywordSet.size === 0 || keywordSet.has(query)) {
      const key = `${row.keys[0]}||${normalizeUrl(row.keys[1])}`
      if (!dateSetMap[key]) dateSetMap[key] = new Set()
      dateSetMap[key].add(row.keys[2])
    }
  }

  const daysMap: Record<string, number> = {}
  for (const [key, dates] of Object.entries(dateSetMap)) {
    daysMap[key] = dates.size
  }

  return NextResponse.json({ keywordUrlData, daysMap, totalDays })
}
