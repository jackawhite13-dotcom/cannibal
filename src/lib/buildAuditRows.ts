import { AuditRow, AhrefsKeywordRow } from '@/types/audit'

function normalizeUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .toLowerCase()
}

export function buildAuditRowsFromAhrefs(
  ahrefsRows: AhrefsKeywordRow[],
  daysMap?: Record<string, number>,
  totalDays = 90,
): AuditRow[] {
  const flat: AuditRow[] = []
  const seen = new Set<string>()

  for (const kw of ahrefsRows) {
    const positions = kw.all_positions || []

    // Deduplicate: get unique URLs from all_positions
    const uniqueUrls = new Map<string, { url: string; position: number }>()
    for (const pos of positions) {
      const norm = normalizeUrl(pos.url)
      if (!uniqueUrls.has(norm)) {
        uniqueUrls.set(norm, { url: pos.url, position: pos.position })
      }
    }

    // Only include if 2+ unique URLs (real cannibalization)
    if (uniqueUrls.size < 2) continue

    for (const { url, position } of uniqueUrls.values()) {
      const dedupeKey = `${kw.keyword}||${normalizeUrl(url)}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      const daysKey = `${kw.keyword}||${normalizeUrl(url)}`
      const daysRanked = daysMap?.[daysKey] ?? null

      flat.push({
        keyword: kw.keyword,
        url,
        position,
        daysRanked,
        daysRankedPct: daysRanked != null ? Math.round((daysRanked / totalDays) * 100) : null,
        totalDays,
        volume: kw.volume ?? null,
        traffic: kw.sum_traffic ?? null,
        cannibalizationCount: uniqueUrls.size,
        referringDomains: null,
        totalKeywords: null,
        keyEvents: null,
        notes: '',
        recommendation: '',
      })
    }
  }

  return flat
}

export function enrichWithGscDays(
  rows: AuditRow[],
  daysMap: Record<string, number>,
  totalDays: number,
): AuditRow[] {
  return rows.map(row => {
    const key = `${row.keyword}||${normalizeUrl(row.url)}`
    const daysRanked = daysMap[key] ?? null
    return {
      ...row,
      daysRanked,
      daysRankedPct: daysRanked != null ? Math.round((daysRanked / totalDays) * 100) : null,
      totalDays,
    }
  })
}

export function syncRecommendation(
  rows: AuditRow[],
  url: string,
  recommendation: AuditRow['recommendation']
): AuditRow[] {
  return rows.map(row => row.url === url ? { ...row, recommendation } : row)
}
