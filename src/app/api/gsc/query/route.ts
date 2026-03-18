import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'

const GSC_URL = 'https://searchconsole.googleapis.com/webmasters/v3/sites'

async function gscFetch(siteUrl: string, token: string, body: object, timeoutMs = 45000) {
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

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.access_token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { siteUrl } = await req.json()
  if (!siteUrl) {
    return NextResponse.json({ error: 'siteUrl required' }, { status: 400 })
  }

  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const totalDays = 180

  // Call 1: aggregated query+page → avg position + clicks
  let res1
  try {
    res1 = await gscFetch(siteUrl, session.access_token, {
      startDate, endDate,
      dimensions: ['query', 'page'],
      rowLimit: 25000,
      startRow: 0,
      dataState: 'final',
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: `GSC request failed: ${e instanceof Error ? e.message : 'timeout'}` }, { status: 500 })
  }

  if (!res1.ok) {
    return NextResponse.json({ error: await res1.text() }, { status: res1.status })
  }

  const data1 = await res1.json()
  const aggRows: { keys: string[]; clicks: number; position: number }[] = data1.rows || []

  // Build aggregated map: "keyword||url" -> { position, clicks }
  const aggMap: Record<string, { position: number; clicks: number }> = {}
  for (const row of aggRows) {
    const key = `${row.keys[0]}||${row.keys[1]}`
    aggMap[key] = { position: Math.round(row.position * 10) / 10, clicks: row.clicks }
  }

  // Call 2: query+page+date → count distinct days ranked per keyword+url (paginated)
  let daysMap: Record<string, number> = {}
  try {
    const dateSetMap: Record<string, Set<string>> = {}
    let startRow = 0
    const pageSize = 25000
    const maxPages = 10 // up to 250k rows

    for (let page = 0; page < maxPages; page++) {
      const res2 = await gscFetch(siteUrl, session.access_token, {
        startDate, endDate,
        dimensions: ['query', 'page', 'date'],
        rowLimit: pageSize,
        startRow,
        dataState: 'final',
      }, 45000)

      if (!res2.ok) break
      const data2 = await res2.json()
      const dateRows: { keys: string[] }[] = data2.rows || []
      if (dateRows.length === 0) break

      for (const row of dateRows) {
        const key = `${row.keys[0]}||${row.keys[1]}`
        if (!dateSetMap[key]) dateSetMap[key] = new Set()
        dateSetMap[key].add(row.keys[2])
      }

      if (dateRows.length < pageSize) break
      startRow += pageSize
    }

    for (const [key, dates] of Object.entries(dateSetMap)) {
      daysMap[key] = dates.size
    }
  } catch {
    // Days data is optional — don't fail the whole request
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
