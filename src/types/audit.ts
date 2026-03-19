export type Recommendation =
  | '301 Redirect'
  | 'De-optimize'
  | 'Consolidate'
  | 'Optimize'
  | 'No Action'
  | ''

export interface AuditRow {
  keyword: string
  url: string
  position: number
  daysRanked: number | null
  daysRankedPct: number | null
  totalDays: number
  clicks: number
  cannibalizationCount: number
  referringDomains: number | null
  totalKeywords: number | null
  keyEvents: Record<string, number> | null
  notes: string
  recommendation: Recommendation
}

export interface TopPageRow {
  url: string
  referringDomains: number
  totalKeywords: number
}

export interface GscSite {
  siteUrl: string
  permissionLevel: string
}
