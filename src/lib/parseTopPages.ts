import Papa from 'papaparse'
import { TopPageRow } from '@/types/audit'

export function parseTopPagesCsv(csvText: string): { map: Record<string, TopPageRow>; debug: string } {
  const result = Papa.parse(csvText, { header: true, skipEmptyLines: true })
  const map: Record<string, TopPageRow> = {}
  const columns = result.meta.fields || []

  for (const row of result.data as Record<string, string>[]) {
    // Try every possible column name variation
    const urlVal = Object.entries(row).find(([k]) => k.trim().replace(/\s+/g, ' ').toLowerCase() === 'url')?.[1] || ''
    const refVal = Object.entries(row).find(([k]) => k.trim().replace(/\s+/g, ' ').toLowerCase().includes('referring'))?.[1] || '0'
    const kwVal = Object.entries(row).find(([k]) => { const n = k.trim().replace(/\s+/g, ' ').toLowerCase(); return n === 'keywords' || n === 'organic keywords' })?.[1] || '0'

    const url = urlVal.trim().replace(/"/g, '')
    const refDomains = parseInt(refVal.trim().replace(/[",]/g, ''), 10)
    const keywords = parseInt(kwVal.trim().replace(/[",]/g, ''), 10)

    if (url) {
      const normalized = url.replace(/\/$/, '')
      map[normalized] = { url: normalized, referringDomains: refDomains || 0, totalKeywords: keywords || 0 }
    }
  }

  return { map, debug: `Parsed ${Object.keys(map).length} URLs. Columns: ${columns.slice(0, 6).join(' | ')}` }
}
