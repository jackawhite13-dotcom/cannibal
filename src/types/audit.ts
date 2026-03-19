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
  daysRankedPct: number | null
  totalDays: number
  volume: number | null
  traffic: number | null
  clicks: number | null
  cannibalizationCount: number
  referringDomains: number | null
  totalKeywords: number | null
  keyEvents: Record<string, number> | null
  notes: string
  recommendation: Recommendation
}

export interface AhrefsPosition {
  url: string
  position: number
  kind?: string
}

export interface AhrefsKeywordRow {
  keyword: string
  volume: number | null
  sum_traffic: number | null
  best_position: number | null
  best_position_url: string | null
  serp_target_positions_count: number
  all_positions: AhrefsPosition[]
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
