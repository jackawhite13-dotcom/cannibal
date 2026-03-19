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
 * keywordUrlData: Record<"keyword||normalizedUrl", { clicks, position }>
 * daysMap: Record<"keyword||normalizedUrl", daysCount>
 * ahrefsKeywords: list of keywords from Ahrefs CSV
 */
export function buildAuditRows(
  keywordUrlData: Record<string, { clicks: number; position: number }>,
  daysMap: Record<string, number>,
  totalDays: number,
  ahrefsKeywords: string[],
  topPages?: Record<string, TopPageRow>,
): AuditRow[] {
  const keywordSet = new Set(ahrefsKeywords.map(k => k.toLowerCase().trim()))

  // Group by keyword to find cannibalization
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

  // Only keep keywords with 2+ URLs (real cannibalization)
  const rows: AuditRow[] = []
  for (const [keyword, urls] of Object.entries(keywordUrls)) {
    if (urls.length < 2) continue

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

  // Sort keyword groups by total clicks descending
  const kwOrder: Record<string, number> = {}
  for (const row of rows) {
    kwOrder[row.keyword] = (kwOrder[row.keyword] || 0) + row.clicks
  }
  rows.sort((a, b) => (kwOrder[b.keyword] || 0) - (kwOrder[a.keyword] || 0) || a.position - b.position)

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
