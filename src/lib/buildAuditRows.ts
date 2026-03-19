import { AuditRow, TopPageRow } from '@/types/audit'

function normalizeUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .toLowerCase()
}

/**
 * Build audit rows from GSC data, filtered to Ahrefs keyword list.
 * Shows ALL keywords from Ahrefs CSV — even if GSC only found 1 URL or 0.
 */
export function buildAuditRows(
  keywordUrlData: Record<string, { clicks: number; position: number }>,
  daysMap: Record<string, number>,
  totalDays: number,
  ahrefsKeywords: string[],
  topPages?: Record<string, TopPageRow>,
): AuditRow[] {
  const keywordSet = new Set(ahrefsKeywords.map(k => k.toLowerCase().trim()))

  // Group GSC data by keyword
  const keywordUrls: Record<string, { url: string; clicks: number; position: number; daysRanked: number | null }[]> = {}

  for (const [key, data] of Object.entries(keywordUrlData)) {
    const [keyword, normUrl] = key.split('||')
    const kwLower = keyword.toLowerCase().trim()

    if (!keywordSet.has(kwLower)) continue

    if (!keywordUrls[keyword]) keywordUrls[keyword] = []
    keywordUrls[keyword].push({
      url: normUrl,
      clicks: data.clicks,
      position: data.position,
      daysRanked: daysMap[key] ?? null,
    })
  }

  // Also add keywords from Ahrefs that GSC had no data for
  for (const kw of ahrefsKeywords) {
    const kwLower = kw.toLowerCase().trim()
    // Check if we already have this keyword (case-insensitive)
    const found = Object.keys(keywordUrls).some(k => k.toLowerCase().trim() === kwLower)
    if (!found) {
      keywordUrls[kw] = [] // empty — no GSC data
    }
  }

  const rows: AuditRow[] = []
  for (const [keyword, urls] of Object.entries(keywordUrls)) {
    if (urls.length === 0) {
      // Keyword from Ahrefs but no GSC data at all
      rows.push({
        keyword,
        url: '—',
        position: 0,
        daysRanked: null,
        daysRankedPct: null,
        totalDays,
        clicks: 0,
        cannibalizationCount: 0,
        referringDomains: null,
        totalKeywords: null,
        keyEvents: null,
        notes: '',
        recommendation: '',
      })
      continue
    }

    // Sort by position ascending
    urls.sort((a, b) => a.position - b.position)

    for (const u of urls) {
      const tp = topPages?.[u.url]
      rows.push({
        keyword,
        url: u.url,
        position: u.position,
        daysRanked: u.daysRanked,
        daysRankedPct: u.daysRanked != null ? Math.round((u.daysRanked / totalDays) * 100) : null,
        totalDays,
        clicks: u.clicks,
        cannibalizationCount: urls.length,
        referringDomains: tp?.referringDomains ?? null,
        totalKeywords: tp?.totalKeywords ?? null,
        keyEvents: null,
        notes: '',
        recommendation: '',
      })
    }
  }

  // Sort: keywords with 2+ URLs first (real cannibalization), then by total clicks desc
  const kwOrder: Record<string, { totalClicks: number; urlCount: number }> = {}
  for (const row of rows) {
    if (!kwOrder[row.keyword]) kwOrder[row.keyword] = { totalClicks: 0, urlCount: 0 }
    kwOrder[row.keyword].totalClicks += row.clicks
    kwOrder[row.keyword].urlCount = Math.max(kwOrder[row.keyword].urlCount, row.cannibalizationCount)
  }
  rows.sort((a, b) => {
    const aOrder = kwOrder[a.keyword]
    const bOrder = kwOrder[b.keyword]
    // 2+ URLs first
    const aMulti = aOrder.urlCount >= 2 ? 1 : 0
    const bMulti = bOrder.urlCount >= 2 ? 1 : 0
    if (bMulti !== aMulti) return bMulti - aMulti
    // Then by total clicks
    if (bOrder.totalClicks !== aOrder.totalClicks) return bOrder.totalClicks - aOrder.totalClicks
    return a.position - b.position
  })

  return rows
}

export function enrichWithTopPages(
  rows: AuditRow[],
  topPages: Record<string, TopPageRow>,
): AuditRow[] {
  return rows.map(row => {
    const tp = topPages[row.url]
    return tp ? { ...row, referringDomains: tp.referringDomains, totalKeywords: tp.totalKeywords } : row
  })
}

export function syncRecommendation(
  rows: AuditRow[],
  url: string,
  recommendation: AuditRow['recommendation']
): AuditRow[] {
  return rows.map(row => row.url === url ? { ...row, recommendation } : row)
}
