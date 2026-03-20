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

  // Call 2: one targeted call per matched keyword → days ranked
  // Fetching all-site query+page+date would require millions of rows for large sites.
  // Instead, filter by each keyword individually — guaranteed complete regardless of site size.
  const matchedKeywords = [...new Set(Object.keys(keywordUrlData).map(k => k.split('||')[0]))]
  const countryCode = country && COUNTRY_CODES[country] ? COUNTRY_CODES[country] : null

  const dateSetMap: Record<string, Set<string>> = {}

  const BATCH_SIZE = 10
  for (let i = 0; i < matchedKeywords.length; i += BATCH_SIZE) {
    const batch = matchedKeywords.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async (keyword) => {
      const filters: { dimension: string; operator: string; expression: string }[] = [
        { dimension: 'query', operator: 'equals', expression: keyword },
        ...(countryCode ? [{ dimension: 'country', operator: 'equals', expression: countryCode }] : []),
      ]
      try {
        const res = await gscFetch(siteUrl, session.access_token as string, {
          startDate, endDate,
          rowLimit: 25000,
          dataState: 'final',
          dimensions: ['query', 'page', 'date'],
          dimensionFilterGroups: [{ filters }],
          startRow: 0,
        })
        if (!res.ok) return
        const data = await res.json()
        for (const row of (data.rows || []) as { keys: string[] }[]) {
          const key = `${row.keys[0]}||${normalizeUrl(row.keys[1])}`
          if (!dateSetMap[key]) dateSetMap[key] = new Set()
          dateSetMap[key].add(row.keys[2])
        }
      } catch {
        // non-fatal per keyword
      }
    }))
  }

  const daysMap: Record<string, number> = {}
  for (const [key, dates] of Object.entries(dateSetMap)) {
    daysMap[key] = dates.size
  }

  return NextResponse.json({ keywordUrlData, daysMap, totalDays })
}
