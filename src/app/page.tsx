'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession, signIn, signOut } from 'next-auth/react'
import { AuditRow, Recommendation, GscSite, TopPageRow } from '@/types/audit'
import { buildAuditRows, enrichWithTopPages } from '@/lib/buildAuditRows'
import { parseAhrefsCsv } from '@/lib/parseAhrefsCsv'
import { parseTopPagesCsv } from '@/lib/parseTopPages'
import { supabase } from '@/lib/supabase'
import { Download, Upload, AlertTriangle, ChevronDown, LogIn, LogOut, RefreshCw, Check, ChevronRight, X, Save } from 'lucide-react'

type WizardStep = 1 | 2 | 3 | 4 | 'methodology'

const RECOMMENDATIONS: Recommendation[] = [
  '', '301 Redirect', 'De-optimize', 'Consolidate', 'Optimize', 'No Action', 'Custom',
]

const REC_STYLES: Record<string, string> = {
  '301 Redirect': 'bg-red-100 text-red-700',
  'De-optimize': 'bg-orange-100 text-orange-700',
  'Consolidate': 'bg-yellow-100 text-yellow-700',
  'Optimize': 'bg-[#C3F2D0] text-green-800',
  'No Action': 'bg-[#F7E8FD] text-purple-600',
  'Custom': 'bg-[#B7EBFF] text-sky-700',
  '': 'bg-[rgba(248,214,185,0.3)] text-[rgba(35,35,35,0.4)]',
}

// URL-level recs propagate to all rows with the same URL
const URL_LEVEL_RECS: Recommendation[] = ['301 Redirect', 'Consolidate']

function generateActionText(rec: Recommendation, keyword: string, targetUrl: string): string {
  switch (rec) {
    case 'No Action': return 'No action needed.'
    case 'De-optimize': return `Remove ranking signals for "${keyword}" from this page.`
    case 'Optimize': return `Strengthen this page for "${keyword}".`
    case '301 Redirect': return targetUrl ? `Redirect to ${targetUrl}` : 'Select a target URL.'
    case 'Consolidate': return targetUrl ? `Merge content into ${targetUrl}` : 'Select a target URL.'
    case 'Custom': return ''
    default: return ''
  }
}

const ALL_COLUMNS = [
  { key: 'keyword', label: 'Keyword' },
  { key: 'url', label: 'URL' },
  { key: 'avgPos', label: 'Avg Pos' },
  { key: 'clicks', label: 'Clicks' },
  { key: 'daysRanked', label: 'Days Ranked' },
  { key: 'auditAppearances', label: 'Audit Appearances' },
  { key: 'refDomains', label: 'Ref Domains' },
  { key: 'totalKws', label: 'Total KWs' },
  { key: 'keyEvents', label: 'Key Events' },
  { key: 'notes', label: 'Notes' },
  { key: 'rec', label: 'Rec' },
  { key: 'action', label: 'Action' },
  { key: 'remove', label: '' },
] as const


interface Ga4Property { propertyId: string; displayName: string }
interface SavedAudit { id: string; name: string; created_at: string; row_count: number }

const DATE_RANGES = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '6 months', value: 180 },
]

const GSC_COUNTRIES = [
  { label: 'All countries', value: '' },
  { label: 'United States', value: 'US' },
  { label: 'United Kingdom', value: 'UK' },
  { label: 'Canada', value: 'CA' },
  { label: 'Australia', value: 'AU' },
  { label: 'Germany', value: 'DE' },
  { label: 'France', value: 'FR' },
  { label: 'India', value: 'IN' },
]

const GA4_CHANNELS = [
  { label: 'All channels', value: '' },
  { label: 'Organic Search', value: 'Organic Search' },
  { label: 'Paid Search', value: 'Paid Search' },
  { label: 'Direct', value: 'Direct' },
  { label: 'Referral', value: 'Referral' },
  { label: 'Organic Social', value: 'Organic Social' },
  { label: 'Paid Social', value: 'Paid Social' },
  { label: 'Email', value: 'Email' },
  { label: 'Display', value: 'Display' },
]

export default function Home() {
  const { data: session, status } = useSession()
  const [wizardStep, setWizardStep] = useState<WizardStep>(1)

  // Step 1 — Ahrefs CSV
  const [ahrefsKeywords, setAhrefsKeywords] = useState<string[]>([])
  const ahrefsCsvRef = useRef<HTMLInputElement>(null)

  // Step 1 — Top Pages CSV (optional)
  const [topPages, setTopPages] = useState<Record<string, TopPageRow>>({})
  const [csvUploaded, setCsvUploaded] = useState(false)
  const topPagesCsvRef = useRef<HTMLInputElement>(null)

  // Step 2 — GSC
  const [sites, setSites] = useState<GscSite[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [gscDateRange, setGscDateRange] = useState(30)
  const [gscCountry, setGscCountry] = useState('')
  const [gscLoading, setGscLoading] = useState(false)
  const [gscError, setGscError] = useState<string | null>(null)
  const [rows, setRows] = useState<AuditRow[]>([])

  // Step 3 — GA4
  const [ga4Properties, setGa4Properties] = useState<Ga4Property[]>([])
  const [selectedGa4Property, setSelectedGa4Property] = useState('')
  const [ga4EventNames, setGa4EventNames] = useState<string[]>([])
  const [selectedEvent, setSelectedEvent] = useState('')
  const [activeEvent, setActiveEvent] = useState('')
  const [ga4Loading, setGa4Loading] = useState(false)
  const [ga4PropertiesLoading, setGa4PropertiesLoading] = useState(false)
  const [ga4Error, setGa4Error] = useState<string | null>(null)
  const [ga4MatchCount, setGa4MatchCount] = useState<number | null>(null)
  const [ga4DateRange, setGa4DateRange] = useState(90)
  const [ga4Country, setGa4Country] = useState('')
  const [ga4ChannelGroup, setGa4ChannelGroup] = useState('')

  // Column visibility
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
  const [showColPicker, setShowColPicker] = useState(false)
  const toggleCol = (key: string) => setHiddenCols(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
  const isColVisible = (key: string) => !hiddenCols.has(key)

  // Supabase saved audits
  const [savedAudits, setSavedAudits] = useState<SavedAudit[]>([])
  const [auditName, setAuditName] = useState('')
  const [saving, setSaving] = useState(false)

  // Restore data after Google sign-in redirect
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('cannibal-state')
      if (saved) {
        const { keywords, tp, tpDone, step } = JSON.parse(saved)
        if (keywords?.length > 0) {
          setAhrefsKeywords(keywords)
          if (tp) { setTopPages(tp); setCsvUploaded(tpDone || false) }
          setWizardStep(step || 2)
        }
        sessionStorage.removeItem('cannibal-state')
      }
    } catch {}
  }, [])

  // Load GSC sites when authenticated (not gated to step 2 — #3 free nav)
  useEffect(() => {
    if (session?.access_token && sites.length === 0) {
      fetch('/api/gsc/sites')
        .then(r => r.json())
        .then(data => {
          const list: GscSite[] = data.siteEntry || []
          setSites(list)
          if (list.length > 0) setSelectedSite(list[0].siteUrl)
        })
        .catch(() => {})
    }
  }, [session])

  // Load GA4 properties when authenticated (not gated to step 3 — #3 free nav)
  useEffect(() => {
    if (session?.access_token && ga4Properties.length === 0 && !ga4PropertiesLoading && !ga4Error) {
      setGa4PropertiesLoading(true)
      fetch('/api/ga4/properties')
        .then(r => r.json())
        .then(data => {
          if (data.error) { setGa4Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error)); return }
          const props: Ga4Property[] = data.properties || []
          setGa4Properties(props)
          if (props.length > 0) setSelectedGa4Property(props[0].propertyId)
        })
        .catch(e => setGa4Error(e.message))
        .finally(() => setGa4PropertiesLoading(false))
    }
  }, [session])

  // Load GA4 event names when property changes
  useEffect(() => {
    if (!selectedGa4Property) return
    setGa4EventNames([])
    setSelectedEvent('')
    fetch('/api/ga4/event-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: selectedGa4Property }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setGa4Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error)); return }
        setGa4EventNames(data.eventNames || [])
        setSelectedEvent(data.eventNames?.[0] || '')
      })
      .catch(e => setGa4Error(e.message))
  }, [selectedGa4Property])

  // #10: Load saved audits from Supabase
  const loadSavedAudits = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase
      .from('cannibal_audits')
      .select('id, name, created_at, row_count')
      .order('created_at', { ascending: false })
    if (data) setSavedAudits(data)
  }, [])

  useEffect(() => { loadSavedAudits() }, [loadSavedAudits])

  // #1: Filter grouped keywords to only 2+ URL groups
  const groupedByKeyword = rows.reduce((acc, row) => {
    if (!acc[row.keyword]) acc[row.keyword] = []
    acc[row.keyword].push(row)
    return acc
  }, {} as Record<string, AuditRow[]>)

  const cannibalGroups = Object.entries(groupedByKeyword).filter(([, g]) => g.length >= 2)

  // URLs competing = how many keyword groups this URL appears in across the entire audit
  const urlCompetingCount: Record<string, number> = {}
  for (const [, g] of cannibalGroups) {
    for (const row of g) {
      urlCompetingCount[row.url] = (urlCompetingCount[row.url] || 0) + 1
    }
  }

  function handleAhrefsCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const buf = ev.target?.result as ArrayBuffer
      let text: string
      const bytes = new Uint8Array(buf)
      if ((bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xFE && bytes[1] === 0xFF)) {
        text = new TextDecoder('utf-16').decode(buf)
      } else {
        text = new TextDecoder('utf-8').decode(buf)
      }
      const keywords = parseAhrefsCsv(text)
      setAhrefsKeywords(keywords)
    }
    reader.readAsArrayBuffer(file)
  }

  function handleTopPagesCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const { map: parsed } = parseTopPagesCsv(text)
      setTopPages(parsed)
      setCsvUploaded(true)
      if (rows.length > 0) {
        setRows(prev => enrichWithTopPages(prev, parsed))
      }
    }
    reader.readAsText(file)
  }

  function handleSignIn(returnToStep: WizardStep) {
    if (ahrefsKeywords.length > 0) {
      sessionStorage.setItem('cannibal-state', JSON.stringify({
        keywords: ahrefsKeywords,
        tp: csvUploaded ? topPages : null,
        tpDone: csvUploaded,
        step: returnToStep,
      }))
    }
    signIn('google')
  }

  async function handleGscPull() {
    if (!selectedSite || ahrefsKeywords.length === 0) return
    setGscLoading(true)
    setGscError(null)
    try {
      const controller = new AbortController()
      const timeoutMs = gscDateRange <= 30 ? 90000 : 115000
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch('/api/gsc/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: selectedSite, dateRange: gscDateRange, country: gscCountry, keywords: ahrefsKeywords }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch GSC data')
      const built = buildAuditRows(data.keywordUrlData || {}, data.daysMap || {}, data.totalDays, ahrefsKeywords, csvUploaded ? topPages : undefined)
      setRows(built)
      setWizardStep(4)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setGscError(msg.includes('abort') ? 'Request timed out. Try 30 days or a smaller keyword list.' : msg)
    } finally {
      setGscLoading(false)
    }
  }

  async function handleAddEvents() {
    if (!selectedGa4Property || !selectedEvent) return
    setGa4Loading(true)
    try {
      const res = await fetch('/api/ga4/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: selectedGa4Property, eventName: selectedEvent, dateRange: ga4DateRange, country: ga4Country || undefined, channelGroup: ga4ChannelGroup || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
      const pathMap: Record<string, number> = data.pathMap || {}
      setActiveEvent(selectedEvent)
      let matched = 0
      setRows(prev => prev.map(row => {
        const path = '/' + row.url.replace(/^[^/]+/, '').replace(/^\//, '')
        const pathNorm = path.replace(/\/$/, '') || '/'
        const count = pathMap[pathNorm] ?? null
        if (count !== null) matched++
        return { ...row, keyEvents: count !== null ? { ...(row.keyEvents || {}), [selectedEvent]: count } : row.keyEvents }
      }))
      setGa4MatchCount(matched)
      setWizardStep(4)
    } catch (e: unknown) {
      setGa4Error(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setGa4Loading(false)
    }
  }

  function handleRecChange(keyword: string, url: string, rec: Recommendation) {
    setRows(prev => {
      const actionText = generateActionText(rec, keyword, '')

      if (URL_LEVEL_RECS.includes(rec)) {
        // Propagate to all rows with same URL (unless overridden)
        return prev.map(r => {
          if (r.url === url && !r.overridden) {
            return { ...r, recommendation: rec, action: generateActionText(rec, r.keyword, ''), targetUrl: '' }
          }
          return r
        })
      }
      // Row-level: only this keyword+url pair
      return prev.map(r =>
        r.keyword === keyword && r.url === url ? { ...r, recommendation: rec, action: actionText, targetUrl: '' } : r
      )
    })
  }

  function handleTargetUrlChange(keyword: string, sourceUrl: string, targetUrl: string) {
    setRows(prev => {
      return prev.map(r => {
        // Update all rows with the source URL that have a URL-level rec (unless overridden)
        if (r.url === sourceUrl && URL_LEVEL_RECS.includes(r.recommendation) && !r.overridden) {
          return { ...r, targetUrl, action: generateActionText(r.recommendation, r.keyword, targetUrl) }
        }
        // Auto-set the target URL's row for this keyword to Optimize
        if (r.keyword === keyword && r.url === targetUrl && !r.recommendation) {
          return { ...r, recommendation: 'Optimize', action: `Target page — receives traffic from ${sourceUrl}` }
        }
        return r
      })
    })
  }

  function handleActionChange(keyword: string, url: string, action: string) {
    setRows(prev => prev.map(r =>
      r.keyword === keyword && r.url === url ? { ...r, action } : r
    ))
  }

  function handleOverrideToggle(keyword: string, url: string) {
    setRows(prev => prev.map(r =>
      r.keyword === keyword && r.url === url ? { ...r, overridden: !r.overridden } : r
    ))
  }

  function handleNotesChange(keyword: string, url: string, notes: string) {
    setRows(prev => prev.map(row => row.keyword === keyword && row.url === url ? { ...row, notes } : row))
  }

  function handleDeleteKeywordGroup(keyword: string) {
    setRows(prev => prev.filter(r => r.keyword !== keyword))
  }

  function handleExportCsv() {
    const eventHeader = activeEvent ? `Event: ${activeEvent}` : 'Key Events'
    const headers = ['Keyword', 'URL', 'Avg Position', 'Clicks', 'Days Ranked', 'Days Ranked %', 'Audit Appearances',
      ...(csvUploaded ? ['Ref Domains', 'Total KWs'] : []),
      ...(activeEvent ? [eventHeader] : []),
      'Notes', 'Recommendation', 'Action', 'Target URL']
    const exportRows = rows.filter(r => r.cannibalizationCount >= 2)
    const csvRows = exportRows.map(r => [
      r.keyword, r.url, Math.round(r.position), r.clicks,
      r.daysRanked !== null ? `${r.daysRanked}/${r.totalDays}` : '',
      r.daysRankedPct !== null ? `${r.daysRankedPct}%` : '',
      urlCompetingCount[r.url] || 1,
      ...(csvUploaded ? [r.referringDomains ?? 0, r.totalKeywords ?? 0] : []),
      ...(activeEvent ? [r.keyEvents?.[activeEvent] !== undefined ? r.keyEvents[activeEvent] : 0] : []),
      r.notes, r.recommendation, r.action, r.targetUrl,
    ])
    const csv = [headers, ...csvRows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const siteName = selectedSite.replace(/^https?:\/\//, '').replace(/\/$/, '')
    a.download = `cannibal-audit-${siteName}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  // #10: Save audit to Supabase
  async function handleSaveAudit() {
    if (!supabase || !auditName.trim()) return
    setSaving(true)
    const cannibalRows = rows.filter(r => r.cannibalizationCount >= 2)
    const { error } = await supabase.from('cannibal_audits').insert({
      name: auditName.trim(),
      rows: cannibalRows,
      keywords: ahrefsKeywords,
      row_count: cannibalRows.length,
      site: selectedSite,
      active_event: activeEvent || null,
    })
    if (!error) {
      setAuditName('')
      loadSavedAudits()
    }
    setSaving(false)
  }

  // #10: Load a saved audit
  async function handleLoadAudit(id: string) {
    if (!supabase) return
    const { data } = await supabase.from('cannibal_audits').select('*').eq('id', id).single()
    if (data) {
      setRows(data.rows || [])
      setAhrefsKeywords(data.keywords || [])
      setActiveEvent(data.active_event || '')
      if (data.site) setSelectedSite(data.site)
      setWizardStep(4)
    }
  }

  const stepDone = (s: WizardStep) => {
    if (s === 1) return ahrefsKeywords.length > 0
    if (s === 2) return rows.length > 0
    if (s === 3) return !!activeEvent
    return false
  }

  const stepLabel = (s: WizardStep) => {
    if (s === 1) return 'Ahrefs Keywords'
    if (s === 2) return 'Search Console'
    if (s === 3) return 'GA4 Key Events'
    return 'Audit'
  }

  const SelectField = ({ label, value, onChange, options, maxW = 'max-w-[220px]' }: {
    label: string; value: string; onChange: (v: string) => void;
    options: { label: string; value: string }[]; maxW?: string
  }) => (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{label}</label>
      <div className={`relative ${maxW}`}>
        <select value={value} onChange={e => onChange(e.target.value)} className="w-full appearance-none px-3 py-2 text-sm rounded-lg outline-none pr-8" style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--color-bg)' }}>
      {/* Sidebar */}
      <div className="w-56 flex-shrink-0 flex flex-col min-h-screen" style={{ background: 'var(--color-sidebar)', borderRight: '1px solid var(--color-sidebar-hover)' }}>
        <div className="h-[3px] bg-gradient-to-r from-[#C3F2D0] via-[#B7EBFF] to-[#FFCADF]" />
        <div className="p-4 border-b" style={{ borderColor: 'var(--color-sidebar-hover)' }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#232323] flex items-center justify-center">
              <AlertTriangle className="w-3.5 h-3.5 text-[#FFCADF]" />
            </div>
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Cannibal</div>
              <div className="text-[10px] italic" style={{ color: 'var(--color-text-muted)' }}>by daydream</div>
            </div>
          </div>
        </div>

        {/* #3: All steps always clickable */}
        <nav className="flex-1 p-3 space-y-1">
          {([1, 2, 3, 4] as const).map(s => (
            <button
              key={s}
              onClick={() => setWizardStep(s)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${wizardStep === s ? 'font-semibold border-l-2 border-[#232323]' : 'hover:opacity-70'}`}
              style={{ background: wizardStep === s ? 'rgba(248,214,185,0.6)' : 'transparent', color: 'var(--color-text)' }}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${stepDone(s) ? 'bg-[#232323] text-white' : 'border border-current opacity-50'}`}>
                {stepDone(s) ? <Check className="w-3 h-3" /> : s}
              </span>
              <span className="flex-1">{stepLabel(s)}</span>
              {s <= 2 && <span className="text-[9px] opacity-40 uppercase tracking-wide">req</span>}
              {s === 3 && <span className="text-[9px] opacity-40 uppercase tracking-wide">opt</span>}
            </button>
          ))}
          <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--color-sidebar-hover)' }}>
            <button
              onClick={() => setWizardStep('methodology')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${wizardStep === 'methodology' ? 'font-semibold border-l-2 border-[#232323]' : 'hover:opacity-70'}`}
              style={{ background: wizardStep === 'methodology' ? 'rgba(248,214,185,0.6)' : 'transparent', color: 'var(--color-text)' }}
            >
              <span className="flex-1">Methodology</span>
            </button>
          </div>
        </nav>

        {/* #10: Saved audits list */}
        {savedAudits.length > 0 && (
          <div className="px-3 pb-2">
            <div className="text-[10px] uppercase tracking-wide font-semibold mb-2 px-1" style={{ color: 'var(--color-text-muted)' }}>Saved Audits</div>
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {savedAudits.map(a => (
                <button key={a.id} onClick={() => handleLoadAudit(a.id)} className="w-full text-left px-2 py-1.5 rounded text-xs hover:opacity-70 truncate" style={{ color: 'var(--color-text)' }}>
                  {a.name} <span style={{ color: 'var(--color-text-muted)' }}>({a.row_count})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="p-4 border-t" style={{ borderColor: 'var(--color-sidebar-hover)' }}>
          {status === 'authenticated' ? (
            <div>
              <div className="text-xs font-medium truncate mb-2" style={{ color: 'var(--color-text)' }}>{session.user?.email}</div>
              <button onClick={() => signOut()} className="flex items-center gap-1.5 text-xs hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}>
                <LogOut className="w-3 h-3" /> Sign out
              </button>
            </div>
          ) : (
            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Keyword Cannibalization Audit</div>
          )}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-x-hidden flex flex-col">
        <div className="px-8 py-5 flex items-center justify-between border-b" style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface-elevated)' }}>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Cannibal Audit Builder</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Identify and resolve keyword cannibalization across any domain</p>
          </div>
          {rows.length > 0 && wizardStep === 4 && (
            <button onClick={handleExportCsv} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium hover:opacity-80" style={{ background: '#232323', color: '#fff' }}>
              <Download className="w-4 h-4" /> Export CSV
            </button>
          )}
        </div>

        <div className="px-8 py-6 space-y-4 max-w-3xl">

          {/* ── STEP 1: Ahrefs CSV ── */}
          {wizardStep === 1 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-5">
                <span className="w-6 h-6 rounded-full bg-[#232323] text-white flex items-center justify-center text-xs font-bold">1</span>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Ahrefs Keywords</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: '#232323', color: '#fff' }}>Required</span>
              </div>
              <p className="text-sm mb-4" style={{ color: 'var(--color-text-muted)' }}>
                Export your cannibalizing keywords from Ahrefs (with &quot;Multiple URLs only&quot; toggled on) and upload the CSV here.
              </p>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => ahrefsCsvRef.current?.click()} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors" style={ahrefsKeywords.length > 0 ? { background: '#C3F2D0', borderColor: '#86efac', color: '#166534' } : { background: 'var(--color-surface-elevated)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <Upload className="w-4 h-4" />
                    {ahrefsKeywords.length > 0 ? `${ahrefsKeywords.length} keywords loaded` : 'Upload Ahrefs Organic Keywords CSV'}
                  </button>
                  <input ref={ahrefsCsvRef} type="file" accept=".csv" className="hidden" onChange={handleAhrefsCsv} />
                </div>
                {ahrefsKeywords.length > 0 && (
                  <button onClick={() => setWizardStep(2)} className="flex items-center gap-1 px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-80" style={{ background: '#232323', color: '#fff' }}>
                    Next: Search Console <ChevronRight className="w-4 h-4" />
                  </button>
                )}
                <div className="pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    Ahrefs Top Pages CSV <span className="font-normal">(optional — adds Referring Domains &amp; Total Keywords)</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <button onClick={() => topPagesCsvRef.current?.click()} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors" style={csvUploaded ? { background: '#C3F2D0', borderColor: '#86efac', color: '#166534' } : { background: 'var(--color-surface-elevated)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                      <Upload className="w-4 h-4" />
                      {csvUploaded ? 'Top Pages loaded' : 'Upload Top Pages CSV'}
                    </button>
                    <input ref={topPagesCsvRef} type="file" accept=".csv" className="hidden" onChange={handleTopPagesCsv} />
                  </div>
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>In Ahrefs: Site Explorer → Top Pages → Export CSV</p>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: GSC ── */}
          {wizardStep === 2 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-5">
                <span className="w-6 h-6 rounded-full bg-[#232323] text-white flex items-center justify-center text-xs font-bold">2</span>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Search Console</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: '#232323', color: '#fff' }}>Required</span>
              </div>
              <p className="text-sm mb-4" style={{ color: 'var(--color-text-muted)' }}>
                Finds all competing URLs for your {ahrefsKeywords.length || '—'} keywords, plus avg position, clicks, and days ranked.
              </p>
              {status !== 'authenticated' ? (
                <div>
                  <p className="text-sm mb-3" style={{ color: 'var(--color-text-muted)' }}>Sign in with Google to access Search Console data.</p>
                  <button onClick={() => handleSignIn(2)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium hover:opacity-80" style={{ background: '#232323', color: '#fff' }}>
                    <LogIn className="w-4 h-4" /> Connect Google Account
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>GSC Property</label>
                    <div className="relative max-w-sm">
                      <select value={selectedSite} onChange={e => setSelectedSite(e.target.value)} className="w-full appearance-none px-3 py-2 text-sm rounded-lg outline-none pr-8" style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                        {sites.map(s => <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>)}
                        {sites.length === 0 && <option>Loading properties...</option>}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Time Period</label>
                    <div className="flex gap-2">
                      {DATE_RANGES.map(d => (
                        <button key={d.value} onClick={() => setGscDateRange(d.value)} className="px-4 py-2 text-sm rounded-lg border transition-colors" style={gscDateRange === d.value ? { background: '#232323', color: '#fff', borderColor: '#232323' } : { background: 'var(--color-surface-elevated)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <SelectField label="Country" value={gscCountry} onChange={setGscCountry} options={GSC_COUNTRIES} />
                  <button onClick={handleGscPull} disabled={gscLoading || !selectedSite || ahrefsKeywords.length === 0} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: '#232323', color: '#fff' }}>
                    <RefreshCw className={`w-4 h-4 ${gscLoading ? 'animate-spin' : ''}`} />
                    {gscLoading ? 'Pulling GSC data... this can take 15-30s' : 'Pull Data'}
                  </button>
                  {ahrefsKeywords.length === 0 && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Upload Ahrefs keywords in Step 1 first.</p>}
                  {gscError && <div className="px-4 py-3 rounded-lg text-sm text-red-700 bg-red-50 border border-red-200">{gscError}</div>}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: GA4 ── */}
          {wizardStep === 3 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-5">
                <span className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold" style={{ borderColor: '#232323', color: '#232323' }}>3</span>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>GA4 Key Events</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium" style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-muted)' }}>Optional</span>
              </div>
              {status !== 'authenticated' ? (
                <div>
                  <p className="text-sm mb-3" style={{ color: 'var(--color-text-muted)' }}>Sign in with Google to access GA4 data.</p>
                  <button onClick={() => handleSignIn(3)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium hover:opacity-80" style={{ background: '#232323', color: '#fff' }}>
                    <LogIn className="w-4 h-4" /> Connect Google Account
                  </button>
                </div>
              ) : ga4PropertiesLoading ? (
                <div className="flex items-center gap-2 text-sm mb-4" style={{ color: 'var(--color-text-muted)' }}>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Loading GA4 properties...
                </div>
              ) : ga4Error ? (
                <div className="mb-4 px-4 py-3 rounded-lg text-sm text-red-700 bg-red-50 border border-red-200">{ga4Error}</div>
              ) : ga4Properties.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex gap-3 flex-wrap">
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>GA4 Property</label>
                      <div className="relative">
                        <select value={selectedGa4Property} onChange={e => setSelectedGa4Property(e.target.value)} className="appearance-none px-3 py-2 text-sm rounded-lg outline-none pr-8 max-w-[240px]" style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                          {ga4Properties.map(p => <option key={p.propertyId} value={p.propertyId}>{p.displayName}</option>)}
                        </select>
                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Key Event</label>
                      <div className="relative">
                        <select value={selectedEvent} onChange={e => setSelectedEvent(e.target.value)} className="appearance-none px-3 py-2 text-sm rounded-lg outline-none pr-8 max-w-[240px]" style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                          {ga4EventNames.map(e => <option key={e} value={e}>{e}</option>)}
                          {ga4EventNames.length === 0 && <option>Loading events...</option>}
                        </select>
                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Time Period</label>
                      <div className="flex gap-2">
                        {DATE_RANGES.map(d => (
                          <button key={d.value} onClick={() => setGa4DateRange(d.value)} className="px-3 py-1.5 text-xs rounded-lg border transition-colors" style={ga4DateRange === d.value ? { background: '#232323', color: '#fff', borderColor: '#232323' } : { background: 'var(--color-surface-elevated)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <SelectField label="Country" value={ga4Country} onChange={setGa4Country} options={[{ label: 'All countries', value: '' }, { label: 'United States', value: 'United States' }, { label: 'United Kingdom', value: 'United Kingdom' }, { label: 'Canada', value: 'Canada' }, { label: 'Australia', value: 'Australia' }, { label: 'Germany', value: 'Germany' }, { label: 'France', value: 'France' }, { label: 'India', value: 'India' }]} />
                    <SelectField label="Channel" value={ga4ChannelGroup} onChange={setGa4ChannelGroup} options={GA4_CHANNELS} />
                  </div>
                  <button onClick={handleAddEvents} disabled={ga4Loading || !selectedEvent} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: '#232323', color: '#fff' }}>
                    <RefreshCw className={`w-4 h-4 ${ga4Loading ? 'animate-spin' : ''}`} />
                    {ga4Loading ? 'Loading events...' : 'Add Events'}
                  </button>
                </div>
              ) : null}
              <div className="mt-5 pt-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
                <button onClick={() => setWizardStep(4)} className="text-sm hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}>
                  Skip this step →
                </button>
                {activeEvent && (
                  <button onClick={() => setWizardStep(4)} className="flex items-center gap-1 text-sm font-medium" style={{ color: '#232323' }}>
                    View Audit <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── STEP 4: Audit table ── */}
        {wizardStep === 4 && (
          <div className="px-8 pb-8 space-y-4">
            {cannibalGroups.length === 0 ? (
              <div className="text-center py-12" style={{ color: 'var(--color-text-muted)' }}>
                <p className="text-sm">No cannibalizing keywords found yet. Complete Steps 1 and 2 to see results.</p>
              </div>
            ) : (
              <>
                {/* Column visibility picker */}
                <div className="relative">
                  <button onClick={() => setShowColPicker(!showColPicker)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border hover:opacity-80" style={{ background: 'var(--color-surface-elevated)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <ChevronDown className="w-3 h-3" /> Columns ({ALL_COLUMNS.filter(c => isColVisible(c.key) && (c.key !== 'refDomains' && c.key !== 'totalKws' || csvUploaded) && (c.key !== 'keyEvents' || activeEvent)).length})
                  </button>
                  {showColPicker && (
                    <div className="absolute top-full left-0 mt-1 p-2 rounded-lg border shadow-lg z-20 space-y-1 min-w-[180px]" style={{ background: 'var(--color-surface-elevated)', borderColor: 'var(--color-border)' }}>
                      {ALL_COLUMNS.filter(c => c.label && (c.key !== 'refDomains' && c.key !== 'totalKws' || csvUploaded) && (c.key !== 'keyEvents' || activeEvent)).map(c => (
                        <label key={c.key} className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:opacity-70" style={{ color: 'var(--color-text)' }}>
                          <input type="checkbox" checked={isColVisible(c.key)} onChange={() => toggleCol(c.key)} className="rounded" />
                          {c.key === 'keyEvents' ? activeEvent : c.label}
                        </label>
                      ))}
                      <button onClick={() => setShowColPicker(false)} className="w-full text-center text-[10px] pt-1 border-t mt-1 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>Close</button>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border overflow-auto" style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface-elevated)', maxHeight: 'calc(100vh - 180px)' }}>
                  <table className="text-sm w-max min-w-full">
                    <thead className="sticky top-0 z-10">
                      <tr style={{ background: 'var(--color-surface)', borderBottom: '2px solid var(--color-border-strong)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                        {isColVisible('keyword') && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>Keyword</th>}
                        {isColVisible('url') && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>URL</th>}
                        {isColVisible('avgPos') && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>Avg Pos</th>}
                        {isColVisible('clicks') && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>Clicks</th>}
                        {isColVisible('daysRanked') && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>Days Ranked</th>}
                        {isColVisible('auditAppearances') && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>Audit Appearances</th>}
                        {csvUploaded && isColVisible('refDomains') && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>Ref Domains</th>}
                        {csvUploaded && isColVisible('totalKws') && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>Total KWs</th>}
                        {activeEvent && isColVisible('keyEvents') && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>{activeEvent}</th>}
                        {isColVisible('notes') && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>Notes</th>}
                        {isColVisible('rec') && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>Rec</th>}
                        {isColVisible('action') && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>Action</th>}
                        {isColVisible('remove') && <th className="w-6"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {cannibalGroups.map(([keyword, kwRows]) =>
                        kwRows.map((row, i) => {
                          const otherUrls = kwRows.filter(r => r.url !== row.url).map(r => r.url)
                          const showTargetPicker = URL_LEVEL_RECS.includes(row.recommendation)
                          return (
                          <tr
                            key={`${keyword}-${row.url}-${i}`}
                            style={{ borderBottom: '1px solid var(--color-border)', borderTop: i === 0 ? '3px solid #232323' : undefined }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-row-hover)')}
                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                          >
                            {isColVisible('keyword') && <td className="px-4 py-2.5 font-semibold max-w-[180px]" style={{ color: 'var(--color-text)' }}>
                              <span className="line-clamp-2 text-sm">{keyword}</span>
                            </td>}
                            {isColVisible('url') && <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                              /{row.url.split('/').slice(1).join('/')}
                            </td>}
                            {isColVisible('avgPos') && <td className="px-4 py-2.5 text-center text-sm font-mono" style={{ color: 'var(--color-text)' }}>
                              {Math.round(row.position)}
                            </td>}
                            {isColVisible('clicks') && <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>
                              {row.clicks.toLocaleString()}
                            </td>}
                            {isColVisible('daysRanked') && <td className="px-4 py-2.5 text-center whitespace-nowrap">
                              {row.daysRankedPct !== null ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{row.daysRankedPct}%</span>
                                  <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{row.daysRanked}/{row.totalDays}d</span>
                                  <div className="w-12 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                                    <div className="h-full rounded-full bg-[#232323]" style={{ width: `${Math.min(100, row.daysRankedPct)}%` }} />
                                  </div>
                                </div>
                              ) : <span style={{ color: 'var(--color-text)' }}>0%</span>}
                            </td>}
                            {isColVisible('auditAppearances') && <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>
                              {urlCompetingCount[row.url] || 1}
                            </td>}
                            {csvUploaded && isColVisible('refDomains') && <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>{row.referringDomains !== null ? row.referringDomains.toLocaleString() : '0'}</td>}
                            {csvUploaded && isColVisible('totalKws') && <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>{row.totalKeywords !== null ? row.totalKeywords.toLocaleString() : '0'}</td>}
                            {activeEvent && isColVisible('keyEvents') && <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>
                              {row.keyEvents?.[activeEvent] !== undefined ? row.keyEvents[activeEvent].toLocaleString() : '0'}
                            </td>}
                            {isColVisible('notes') && <td className="px-4 py-2 min-w-[140px]">
                              <input type="text" value={row.notes} onChange={e => handleNotesChange(keyword, row.url, e.target.value)} placeholder="Add note..." className="w-full bg-transparent text-xs py-1 outline-none" style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }} onFocus={e => e.target.style.borderBottomColor = '#232323'} onBlur={e => e.target.style.borderBottomColor = 'rgba(248,214,185,0.5)'} />
                            </td>}
                            {isColVisible('rec') && <td className="px-4 py-2 min-w-[130px]">
                              <div className="space-y-1">
                                <select value={row.recommendation} onChange={e => handleRecChange(keyword, row.url, e.target.value as Recommendation)} className={`w-full rounded-lg px-2 py-1.5 text-xs font-medium cursor-pointer outline-none ${REC_STYLES[row.recommendation]}`}>
                                  {RECOMMENDATIONS.map(r => <option key={r} value={r}>{r || 'Set rec...'}</option>)}
                                </select>
                                {showTargetPicker && (
                                  <select value={row.targetUrl} onChange={e => handleTargetUrlChange(keyword, row.url, e.target.value)} className="w-full rounded px-1.5 py-1 text-[10px] outline-none" style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                                    <option value="">Target URL...</option>
                                    {otherUrls.map(u => <option key={u} value={u}>/{u.split('/').slice(1).join('/')}</option>)}
                                  </select>
                                )}
                                {row.overridden && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">overridden</span>}
                                {URL_LEVEL_RECS.includes(row.recommendation) && !row.overridden && (
                                  <button onClick={() => handleOverrideToggle(keyword, row.url)} className="text-[9px] hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}>override</button>
                                )}
                                {row.overridden && (
                                  <button onClick={() => handleOverrideToggle(keyword, row.url)} className="text-[9px] hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}>remove override</button>
                                )}
                              </div>
                            </td>}
                            {isColVisible('action') && <td className="px-4 py-2 min-w-[200px]">
                              <input type="text" value={row.action} onChange={e => handleActionChange(keyword, row.url, e.target.value)} placeholder="Action will auto-fill..." className="w-full bg-transparent text-xs py-1 outline-none" style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }} onFocus={e => e.target.style.borderBottomColor = '#232323'} onBlur={e => e.target.style.borderBottomColor = 'rgba(248,214,185,0.5)'} />
                            </td>}
                            {isColVisible('remove') && <td className="px-1 py-2 w-6">
                              {i === 0 && (
                                <button onClick={() => handleDeleteKeywordGroup(keyword)} className="opacity-20 hover:opacity-80 transition-opacity" title="Remove this keyword from the audit">
                                  <X className="w-3 h-3" style={{ color: 'var(--color-text)' }} />
                                </button>
                              )}
                            </td>}
                          </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Save audit */}
                {supabase && (
                  <div className="flex items-center gap-3 pt-4">
                    <input type="text" value={auditName} onChange={e => setAuditName(e.target.value)} placeholder="Audit name (e.g. Rho Q1 2026)" className="px-3 py-2 text-sm rounded-lg outline-none max-w-[260px] w-full" style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                    <button onClick={handleSaveAudit} disabled={saving || !auditName.trim()} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium hover:opacity-80 disabled:opacity-50" style={{ background: '#232323', color: '#fff' }}>
                      <Save className="w-4 h-4" />
                      {saving ? 'Saving...' : 'Save Audit'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {/* ── STEP 5: Methodology ── */}
        {wizardStep === 'methodology' && (
          <div className="px-8 py-6 max-w-2xl">
            <div className="card">
              <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Why You Can Trust This Audit</h2>
              <div className="space-y-4 text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
                <p>
                  This cannibalization audit combines data from two authoritative, first-party sources to identify where multiple pages on a site compete for the same keywords in ways that limit rankings and traffic.
                </p>
                <p>
                  <strong>Ahrefs</strong> identifies which keywords have multiple URLs ranking simultaneously by crawling Google search results directly. When you export with the &quot;Multiple URLs only&quot; filter enabled, you get a list of keywords where Google is showing two or more of your pages — a clear signal of internal competition. This list is the foundation of the audit.
                </p>
                <p>
                  <strong>Google Search Console</strong> then provides the ground-truth performance data for those keywords. Unlike third-party estimates, GSC data comes directly from Google and reflects actual searcher behavior — real clicks, real impressions, and the actual average position Google assigned over the selected time period. The &quot;Days Ranked&quot; metric counts how many days each URL appeared in real search results, which separates genuine, persistent rankings from one-off appearances.
                </p>
                <p>
                  The combination of these two sources means the audit is neither speculative nor estimated. Ahrefs confirms the cannibalization exists in Google&apos;s index. GSC confirms it&apos;s affecting real search performance. Keywords that appear in both sources with 2+ competing URLs represent verified cannibalization that warrants action.
                </p>
                <p>
                  <strong>Optional enrichment</strong> from GA4 (key events like form submissions or purchases) and Ahrefs Top Pages (referring domains and total keyword counts per URL) adds business context — helping you decide which URL to protect and which to consolidate, redirect, or de-optimize.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
