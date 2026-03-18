'use client'

import { useState, useRef, useEffect } from 'react'
import { useSession, signIn, signOut } from 'next-auth/react'
import { AuditRow, Recommendation, TopPageRow, GscSite } from '@/types/audit'
import { buildAuditRowsFromGsc, syncRecommendation } from '@/lib/buildAuditRows'
import { parseTopPagesCsv } from '@/lib/parseTopPages'
import { Upload, Download, AlertTriangle, ChevronDown, LogIn, LogOut, RefreshCw, Check, ChevronRight } from 'lucide-react'

type WizardStep = 1 | 2 | 3 | 4

const RECOMMENDATIONS: Recommendation[] = [
  '', '301 Redirect', 'De-optimize', 'Consolidate', 'Protect', 'Monitor', 'No Action',
]

const REC_STYLES: Record<string, string> = {
  '301 Redirect': 'bg-red-100 text-red-700',
  'De-optimize': 'bg-orange-100 text-orange-700',
  'Consolidate': 'bg-yellow-100 text-yellow-700',
  'Protect': 'bg-[#C3F2D0] text-green-800',
  'Monitor': 'bg-[#B7EBFF] text-sky-700',
  'No Action': 'bg-[#F7E8FD] text-purple-600',
  '': 'bg-[rgba(248,214,185,0.3)] text-[rgba(35,35,35,0.4)]',
}

const severityBadge = (count: number) => {
  if (count >= 10) return 'bg-red-100 text-red-700 font-bold'
  if (count >= 5) return 'bg-orange-100 text-orange-700 font-semibold'
  if (count >= 2) return 'bg-[#FFECDB] text-amber-700'
  return 'bg-[rgba(248,214,185,0.3)] text-[rgba(35,35,35,0.45)]'
}

const positionColor = (pos: number) => {
  if (pos <= 3) return 'text-green-700 font-bold'
  if (pos <= 10) return 'text-amber-600 font-semibold'
  if (pos <= 30) return 'text-orange-500'
  return 'text-red-400'
}

interface Ga4Property { propertyId: string; displayName: string }

const DATE_RANGES = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '6 months', value: 180 },
]

const COUNTRIES = [
  { label: 'All countries', value: '' },
  { label: 'United States', value: 'US' },
  { label: 'United Kingdom', value: 'UK' },
  { label: 'Canada', value: 'CA' },
  { label: 'Australia', value: 'AU' },
  { label: 'Germany', value: 'DE' },
  { label: 'France', value: 'FR' },
  { label: 'India', value: 'IN' },
]

export default function Home() {
  const { data: session, status } = useSession()
  const [wizardStep, setWizardStep] = useState<WizardStep>(1)

  // Step 1 — GSC
  const [sites, setSites] = useState<GscSite[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [dateRange, setDateRange] = useState(180)
  const [country, setCountry] = useState('')
  const [rows, setRows] = useState<AuditRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 2 — GA4
  const [ga4Properties, setGa4Properties] = useState<Ga4Property[]>([])
  const [selectedGa4Property, setSelectedGa4Property] = useState('')
  const [ga4EventNames, setGa4EventNames] = useState<string[]>([])
  const [selectedEvent, setSelectedEvent] = useState('')
  const [activeEvent, setActiveEvent] = useState('')
  const [ga4Loading, setGa4Loading] = useState(false)
  const [ga4PropertiesLoading, setGa4PropertiesLoading] = useState(false)
  const [ga4Error, setGa4Error] = useState<string | null>(null)
  const [ga4MatchCount, setGa4MatchCount] = useState<number | null>(null)

  // Step 3 — Ahrefs
  const [topPages, setTopPages] = useState<Record<string, TopPageRow>>({})
  const [csvUploaded, setCsvUploaded] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load GSC sites on auth
  useEffect(() => {
    if (session?.access_token) {
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

  // Load GA4 properties when reaching step 2
  useEffect(() => {
    if (wizardStep === 2 && session?.access_token && ga4Properties.length === 0 && !ga4PropertiesLoading && !ga4Error) {
      setGa4PropertiesLoading(true)
      fetch('/api/ga4/properties')
        .then(r => r.json())
        .then(data => {
          if (data.error) { setGa4Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error)); return }
          const props: Ga4Property[] = data.properties || []
          setGa4Properties(props)
          if (props.length > 0) setSelectedGa4Property(props[0].propertyId)
          else setGa4Error('No GA4 properties found for this account')
        })
        .catch(e => setGa4Error(e.message))
        .finally(() => setGa4PropertiesLoading(false))
    }
  }, [wizardStep, session])

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

  const groupedByKeyword = rows.reduce((acc, row) => {
    if (!acc[row.keyword]) acc[row.keyword] = []
    acc[row.keyword].push(row)
    return acc
  }, {} as Record<string, AuditRow[]>)

  async function handlePull() {
    if (!selectedSite) return
    setIsLoading(true)
    setError(null)
    setRows([])
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 90000)
      const res = await fetch('/api/gsc/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: selectedSite, dateRange, country }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch GSC data')
      const built = buildAuditRowsFromGsc(data.keywords || [], topPages, data.totalDays)
      setRows(built)
      setWizardStep(2)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleAddEvents() {
    if (!selectedGa4Property || !selectedEvent) return
    setGa4Loading(true)
    try {
      const res = await fetch('/api/ga4/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: selectedGa4Property, eventName: selectedEvent }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
      const pathMap: Record<string, number> = data.pathMap || {}
      setActiveEvent(selectedEvent)
      let matched = 0
      setRows(prev => prev.map(row => {
        const path = row.url.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/'
        const count = pathMap[path] ?? null
        if (count !== null) matched++
        return { ...row, keyEvents: count !== null ? { ...(row.keyEvents || {}), [selectedEvent]: count } : row.keyEvents }
      }))
      setGa4MatchCount(matched)
      setWizardStep(3)
    } catch (e: unknown) {
      setGa4Error(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setGa4Loading(false)
    }
  }

  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const { map: parsed } = parseTopPagesCsv(text)
      setTopPages(parsed)
      setCsvUploaded(true)
      if (rows.length > 0) {
        setRows(prev => prev.map(row => {
          const tp = parsed[row.url.replace(/\/$/, '')]
          return tp ? { ...row, referringDomains: tp.referringDomains, totalKeywords: tp.totalKeywords } : row
        }))
      }
    }
    reader.readAsText(file)
  }

  function handleRecChange(url: string, rec: Recommendation) {
    setRows(prev => syncRecommendation(prev, url, rec))
  }

  function handleNotesChange(keyword: string, url: string, notes: string) {
    setRows(prev => prev.map(row =>
      row.keyword === keyword && row.url === url ? { ...row, notes } : row
    ))
  }

  function handleExportCsv() {
    const eventHeader = activeEvent ? `Event: ${activeEvent}` : 'Key Events'
    const headers = ['Keyword', 'URL', 'Position', 'Days Ranked', 'Cannibalization Count',
      ...(csvUploaded ? ['Referring Domains', 'Total Keywords'] : []),
      'Clicks 6mo', 'Avg Monthly Clicks',
      ...(activeEvent ? [eventHeader] : []),
      'Notes', 'Recommendation']
    const csvRows = rows.map(r => [
      r.keyword, r.url, r.position,
      r.daysRanked !== null ? `${r.daysRanked}/${r.totalDays}` : '',
      r.cannibalizationCount,
      ...(csvUploaded ? [r.referringDomains ?? '', r.totalKeywords ?? ''] : []),
      r.clicks6m ?? '', r.avgMonthlyClicks ?? '',
      ...(activeEvent ? [r.keyEvents?.[activeEvent] !== undefined ? r.keyEvents[activeEvent] : ''] : []),
      r.notes, r.recommendation,
    ])
    const csv = [headers, ...csvRows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cannibal-audit-${selectedSite.replace(/https?:\/\//, '')}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const uniqueKeywordCount = Object.keys(groupedByKeyword).length
  const uniqueUrlCount = new Set(rows.map(r => r.url)).size

  const stepDone = (s: WizardStep) => {
    if (s === 1) return rows.length > 0
    if (s === 2) return !!activeEvent
    if (s === 3) return csvUploaded
    return false
  }

  const stepLabel = (s: WizardStep) => {
    if (s === 1) return 'Search Console'
    if (s === 2) return 'GA4 Key Events'
    if (s === 3) return 'Ahrefs Data'
    return 'Audit'
  }

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

        {/* Step nav */}
        <nav className="flex-1 p-3 space-y-1">
          {([1, 2, 3] as WizardStep[]).map(s => (
            <button
              key={s}
              onClick={() => (s === 1 || rows.length > 0) ? setWizardStep(s) : null}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${wizardStep === s ? 'font-semibold border-l-2 border-[#232323]' : 'hover:opacity-70'}`}
              style={{ background: wizardStep === s ? 'rgba(248,214,185,0.6)' : 'transparent', color: 'var(--color-text)' }}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${stepDone(s) ? 'bg-[#232323] text-white' : 'border border-current opacity-50'}`}>
                {stepDone(s) ? <Check className="w-3 h-3" /> : s}
              </span>
              <span className="flex-1">{stepLabel(s)}</span>
              {s !== 1 && <span className="text-[9px] opacity-40 uppercase tracking-wide">opt</span>}
            </button>
          ))}
          {rows.length > 0 && (
            <button
              onClick={() => setWizardStep(4)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${wizardStep === 4 ? 'font-semibold border-l-2 border-[#232323]' : 'hover:opacity-70'}`}
              style={{ background: wizardStep === 4 ? 'rgba(248,214,185,0.6)' : 'transparent', color: 'var(--color-text)' }}
            >
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 border border-current opacity-50">4</span>
              <span>Audit</span>
            </button>
          )}
        </nav>

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

          {/* Not signed in */}
          {status !== 'authenticated' && (
            <div className="card">
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Connect your Google account to get started</p>
              <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>Required for Google Search Console and GA4 access</p>
              <button onClick={() => signIn('google')} disabled={status === 'loading'} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium hover:opacity-80 disabled:opacity-50" style={{ background: '#232323', color: '#fff' }}>
                <LogIn className="w-4 h-4" /> Connect Google Account
              </button>
            </div>
          )}

          {/* ── STEP 1: GSC ── */}
          {status === 'authenticated' && wizardStep === 1 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-5">
                <span className="w-6 h-6 rounded-full bg-[#232323] text-white flex items-center justify-center text-xs font-bold">1</span>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Search Console</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: '#232323', color: '#fff' }}>Required</span>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>GSC Property</label>
                  <div className="relative max-w-sm">
                    <select value={selectedSite} onChange={e => setSelectedSite(e.target.value)} className="w-full appearance-none px-3 py-2 text-sm rounded-lg outline-none pr-8" style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                      {sites.map(s => <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>)}
                      {sites.length === 0 && <option>No properties found</option>}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Date Range</label>
                  <div className="flex gap-2">
                    {DATE_RANGES.map(d => (
                      <button key={d.value} onClick={() => setDateRange(d.value)} className="px-4 py-2 text-sm rounded-lg border transition-colors" style={dateRange === d.value ? { background: '#232323', color: '#fff', borderColor: '#232323' } : { background: 'var(--color-surface-elevated)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Country</label>
                  <div className="relative max-w-[220px]">
                    <select value={country} onChange={e => setCountry(e.target.value)} className="w-full appearance-none px-3 py-2 text-sm rounded-lg outline-none pr-8" style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                      {COUNTRIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
                  </div>
                </div>

                <button onClick={handlePull} disabled={isLoading || !selectedSite} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: '#232323', color: '#fff' }}>
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                  {isLoading ? 'Pulling data...' : 'Pull Data'}
                </button>

                {error && <div className="px-4 py-3 rounded-lg text-sm text-red-700 bg-red-50 border border-red-200">{error}</div>}
              </div>
            </div>
          )}

          {/* Step 1 summary (shown on steps 2/3/4) */}
          {status === 'authenticated' && rows.length > 0 && wizardStep > 1 && (
            <button onClick={() => setWizardStep(1)} className="card w-full flex items-center gap-3 text-left hover:opacity-80 transition-opacity">
              <span className="w-6 h-6 rounded-full bg-[#232323] text-white flex items-center justify-center flex-shrink-0"><Check className="w-3 h-3" /></span>
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Step 1 — Search Console</span>
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{selectedSite} · {rows.length.toLocaleString()} rows</span>
              <span className="ml-auto text-xs" style={{ color: 'var(--color-text-muted)' }}>Edit</span>
            </button>
          )}

          {/* ── STEP 2: GA4 ── */}
          {status === 'authenticated' && wizardStep === 2 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-5">
                <span className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold" style={{ borderColor: '#232323', color: '#232323' }}>2</span>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>GA4 Key Events</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium" style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-muted)' }}>Optional</span>
              </div>

              {ga4PropertiesLoading ? (
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
                  <button onClick={handleAddEvents} disabled={ga4Loading || !selectedEvent} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: '#232323', color: '#fff' }}>
                    <RefreshCw className={`w-4 h-4 ${ga4Loading ? 'animate-spin' : ''}`} />
                    {ga4Loading ? 'Loading events...' : 'Add Events'}
                  </button>
                </div>
              ) : null}

              <div className="mt-5 pt-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
                <button onClick={() => setWizardStep(3)} className="text-sm hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}>
                  Skip this step →
                </button>
                {activeEvent && (
                  <button onClick={() => setWizardStep(3)} className="flex items-center gap-1 text-sm font-medium" style={{ color: '#232323' }}>
                    Next: Ahrefs Data <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Step 2 summary */}
          {status === 'authenticated' && rows.length > 0 && wizardStep > 2 && (
            <button onClick={() => setWizardStep(2)} className="card w-full flex items-center gap-3 text-left hover:opacity-80 transition-opacity">
              <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: activeEvent ? '#232323' : 'var(--color-border-strong)', color: activeEvent ? '#fff' : 'var(--color-text)' }}>
                {activeEvent ? <Check className="w-3 h-3" /> : <span className="text-xs">2</span>}
              </span>
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Step 2 — GA4 Key Events</span>
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {activeEvent ? `${activeEvent} · ${ga4MatchCount ?? 0} URLs matched` : 'Skipped'}
              </span>
              <span className="ml-auto text-xs" style={{ color: 'var(--color-text-muted)' }}>Edit</span>
            </button>
          )}

          {/* ── STEP 3: Ahrefs ── */}
          {status === 'authenticated' && wizardStep === 3 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-5">
                <span className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold" style={{ borderColor: '#232323', color: '#232323' }}>3</span>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Ahrefs Data</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium" style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-muted)' }}>Optional</span>
              </div>

              <p className="text-sm mb-4" style={{ color: 'var(--color-text-muted)' }}>
                Upload an Ahrefs Top Pages CSV to add Referring Domains and Total Keywords to each URL.
                <br /><span className="text-xs mt-1 block">In Ahrefs: Site Explorer → Top Pages → Export CSV</span>
              </p>

              <div className="flex items-center gap-3">
                <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors" style={csvUploaded ? { background: '#C3F2D0', borderColor: '#86efac', color: '#166534' } : { background: 'var(--color-surface-elevated)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <Upload className="w-4 h-4" />
                  {csvUploaded ? 'CSV Loaded ✓' : 'Upload Ahrefs CSV'}
                </button>
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
                {csvUploaded && (
                  <button onClick={() => setWizardStep(4)} className="flex items-center gap-1 text-sm font-medium" style={{ color: '#232323' }}>
                    View Audit <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
                <button onClick={() => setWizardStep(4)} className="text-sm hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}>
                  Skip this step →
                </button>
              </div>
            </div>
          )}

          {/* Step 3 summary */}
          {status === 'authenticated' && rows.length > 0 && wizardStep === 4 && (
            <button onClick={() => setWizardStep(3)} className="card w-full flex items-center gap-3 text-left hover:opacity-80 transition-opacity">
              <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: csvUploaded ? '#232323' : 'var(--color-border-strong)', color: csvUploaded ? '#fff' : 'var(--color-text)' }}>
                {csvUploaded ? <Check className="w-3 h-3" /> : <span className="text-xs">3</span>}
              </span>
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Step 3 — Ahrefs Data</span>
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{csvUploaded ? 'CSV loaded' : 'Skipped'}</span>
              <span className="ml-auto text-xs" style={{ color: 'var(--color-text-muted)' }}>Edit</span>
            </button>
          )}
        </div>

        {/* ── STEP 4: Audit table (full width) ── */}
        {rows.length > 0 && wizardStep === 4 && (
          <div className="px-8 pb-8 space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 max-w-xl">
              {[
                { label: 'Cannibalizing Keywords', value: uniqueKeywordCount, color: '#FFECDB' },
                { label: 'Affected URLs', value: uniqueUrlCount, color: '#B7EBFF' },
                { label: 'Total Rows', value: rows.length, color: '#F7E8FD' },
              ].map(stat => (
                <div key={stat.label} className="rounded-xl p-4 border" style={{ background: stat.color, borderColor: 'var(--color-border-strong)' }}>
                  <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{stat.value.toLocaleString()}</div>
                  <div className="text-xs font-medium mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Table */}
            <div className="rounded-xl border overflow-auto" style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface-elevated)' }}>
              <table className="w-full text-sm" style={{ minWidth: '1000px' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface)', borderBottom: '2px solid var(--color-border-strong)' }}>
                    {[
                      'Keyword', 'URL', 'Pos', 'Days Ranked', 'Cannibal Count',
                      ...(csvUploaded ? ['Ref Domains', 'Total KWs'] : []),
                      'Clicks 6mo', 'Avg/mo',
                      ...(activeEvent ? [activeEvent] : []),
                      'Notes', 'Recommendation',
                    ].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(groupedByKeyword).map(([keyword, kwRows]) =>
                    kwRows.map((row, i) => (
                      <tr
                        key={`${keyword}-${row.url}-${i}`}
                        style={{ borderBottom: '1px solid var(--color-border)', borderTop: i === 0 ? '2px solid var(--color-border-strong)' : undefined }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-row-hover)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                      >
                        <td className="px-4 py-2.5 font-semibold max-w-[180px]" style={{ color: 'var(--color-text)' }}>
                          {i === 0 ? <span className="line-clamp-2 text-sm">{keyword}</span> : null}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs max-w-[220px]" style={{ color: 'var(--color-text-muted)' }}>
                          <span className="truncate block" title={row.url}>{row.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-sm font-mono ${positionColor(row.position)}`}>{row.position}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                          {row.daysRanked !== null ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                                {row.daysRanked}<span className="font-normal text-[10px]" style={{ color: 'var(--color-text-muted)' }}>/{row.totalDays}</span>
                              </span>
                              <div className="w-12 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                                <div className="h-full rounded-full bg-[#232323]" style={{ width: `${Math.min(100, (row.daysRanked / row.totalDays) * 100)}%` }} />
                              </div>
                            </div>
                          ) : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs ${severityBadge(row.cannibalizationCount)}`}>{row.cannibalizationCount}</span>
                        </td>
                        {csvUploaded && (
                          <>
                            <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>{row.referringDomains !== null ? row.referringDomains : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}</td>
                            <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>{row.totalKeywords !== null ? row.totalKeywords : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}</td>
                          </>
                        )}
                        <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>{row.clicks6m !== null ? row.clicks6m.toLocaleString() : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}</td>
                        <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>{row.avgMonthlyClicks !== null ? row.avgMonthlyClicks.toLocaleString() : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}</td>
                        {activeEvent && (
                          <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>
                            {row.keyEvents?.[activeEvent] !== undefined ? <span className="font-semibold">{row.keyEvents[activeEvent].toLocaleString()}</span> : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}
                          </td>
                        )}
                        <td className="px-4 py-2 min-w-[160px]">
                          <input type="text" value={row.notes} onChange={e => handleNotesChange(keyword, row.url, e.target.value)} placeholder="Add note..." className="w-full bg-transparent text-xs py-1 outline-none" style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }} onFocus={e => e.target.style.borderBottomColor = '#232323'} onBlur={e => e.target.style.borderBottomColor = 'rgba(248,214,185,0.5)'} />
                        </td>
                        <td className="px-4 py-2 min-w-[150px]">
                          <div className="relative">
                            <select value={row.recommendation} onChange={e => handleRecChange(row.url, e.target.value as Recommendation)} className={`w-full appearance-none rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer outline-none pr-7 ${REC_STYLES[row.recommendation]}`}>
                              {RECOMMENDATIONS.map(r => <option key={r} value={r}>{r || 'Set rec...'}</option>)}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none opacity-40" />
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
