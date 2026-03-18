import { AuditRow, TopPageRow } from '@/types/audit'

interface GscKeyword {
  keyword: string
  positions: { url: string; position: number; clicks: number; daysRanked: number | null }[]
}

export function buildAuditRowsFromGsc(
  keywords: GscKeyword[],
  topPages: Record<string, TopPageRow>,
  totalDays = 180
): AuditRow[] {
  const flat: AuditRow[] = []

  for (const kw of keywords) {
    const totalClicks = kw.positions.reduce((sum, p) => sum + p.clicks, 0)
    for (const pos of kw.positions) {
      const topPage = topPages[pos.url.replace(/\/$/, '')]
      flat.push({
        keyword: kw.keyword,
        url: pos.url,
        position: pos.position,
        daysRanked: pos.daysRanked,
        totalDays,
        clicks6m: pos.clicks,
        avgMonthlyClicks: Math.round(pos.clicks / 6),
        traffic: totalClicks,
        volume: null,
        cannibalizationCount: 0,
        referringDomains: topPage?.referringDomains ?? null,
        totalKeywords: topPage?.totalKeywords ?? null,
        keyEvents: null,
        notes: '',
        recommendation: '',
      })
    }
  }

  const urlCounts: Record<string, number> = {}
  for (const row of flat) {
    urlCounts[row.url] = (urlCounts[row.url] || 0) + 1
  }
  for (const row of flat) {
    row.cannibalizationCount = urlCounts[row.url]
  }

  return flat
}

export function syncRecommendation(
  rows: AuditRow[],
  url: string,
  recommendation: AuditRow['recommendation']
): AuditRow[] {
  return rows.map(row => row.url === url ? { ...row, recommendation } : row)
}
