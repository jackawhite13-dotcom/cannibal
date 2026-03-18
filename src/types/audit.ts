export type Recommendation =
  | '301 Redirect'
  | 'De-optimize'
  | 'Consolidate'
  | 'Protect'
  | 'Monitor'
  | 'No Action'
  | ''

export interface AuditRow {
  keyword: string
  url: string
  position: number
  daysRanked: number | null
  totalDays: number
  volume: number | null
  traffic: number
  cannibalizationCount: number
  referringDomains: number | null
  totalKeywords: number | null
  clicks6m: number | null
  avgMonthlyClicks: number | null
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
