import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'

export const maxDuration = 60

const GSC_URL = 'https://searchconsole.googleapis.com/webmasters/v3/sites'

async function gscFetch(siteUrl: string, token: string, body: object, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${GSC_URL}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    return res
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

const COUNTRY_CODES: Record<string, string> = {
  US: 'usa', UK: 'gbr', CA: 'can', AU: 'aus', DE: 'deu', FR: 'fra', IN: 'ind',
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.access_token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { siteUrl, dateRange = 180, country = '' } = await req.json()
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
    startRow: 0,
    dataState: 'final',
    ...(dimensionFilterGroups.length > 0 ? { dimensionFilterGroups } : {}),
  }

  // Call 1: query+page → avg position + clicks
  let res1
  try {
    res1 = await gscFetch(siteUrl, session.access_token, {
      ...baseQuery,
      dimensions: ['query', 'page'],
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: `GSC request failed: ${e instanceof Error ? e.message : 'timeout'}` }, { status: 500 })
  }

  if (!res1.ok) {
    return NextResponse.json({ error: await res1.text() }, { status: res1.status })
  }

  const data1 = await res1.json()
  const aggRows: { keys: string[]; clicks: number; position: number }[] = data1.rows || []

  const aggMap: Record<string, { position: number; clicks: number }> = {}
  for (const row of aggRows) {
    const key = `${row.keys[0]}||${row.keys[1]}`
    aggMap[key] = { position: Math.round(row.position * 10) / 10, clicks: row.clicks }
  }

  // Call 2: query+page+date → days ranked (single call, best effort)
  let daysMap: Record<string, number> = {}
  try {
    const res2 = await gscFetch(siteUrl, session.access_token, {
      ...baseQuery,
      dimensions: ['query', 'page', 'date'],
    }, 20000)

    if (res2.ok) {
      const data2 = await res2.json()
      const dateSetMap: Record<string, Set<string>> = {}
      for (const row of (data2.rows || []) as { keys: string[] }[]) {
        const key = `${row.keys[0]}||${row.keys[1]}`
        if (!dateSetMap[key]) dateSetMap[key] = new Set()
        dateSetMap[key].add(row.keys[2])
      }
      for (const [key, dates] of Object.entries(dateSetMap)) {
        daysMap[key] = dates.size
      }
    }
  } catch {
    daysMap = {}
  }

  // Group by keyword, find cannibalization
  const keywordMap: Record<string, { url: string; position: number; clicks: number; daysRanked: number | null }[]> = {}

  for (const row of aggRows) {
    const [keyword, url] = row.keys
    const key = `${keyword}||${url}`
    if (!keywordMap[keyword]) keywordMap[keyword] = []
    keywordMap[keyword].push({
      url,
      position: aggMap[key]?.position ?? Math.round(row.position * 10) / 10,
      clicks: aggMap[key]?.clicks ?? row.clicks,
      daysRanked: daysMap[key] ?? null,
    })
  }

  const cannibalizing = Object.entries(keywordMap)
    .filter(([, positions]) => new Set(positions.map(p => p.url)).size > 1)
    .map(([keyword, positions]) => ({
      keyword,
      positions: positions.sort((a, b) => a.position - b.position),
    }))
    .sort((a, b) => b.positions.length - a.positions.length)

  return NextResponse.json({ keywords: cannibalizing, totalRows: aggRows.length, totalDays })
}
