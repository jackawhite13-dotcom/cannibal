'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession, signIn, signOut } from 'next-auth/react'
import { AuditRow, Recommendation, GscSite, TopPageRow } from '@/types/audit'
import { buildAuditRows, enrichWithTopPages, syncRecommendation } from '@/lib/buildAuditRows'
import { parseAhrefsCsv } from '@/lib/parseAhrefsCsv'
import { parseTopPagesCsv } from '@/lib/parseTopPages'
import { Download, Upload, AlertTriangle, ChevronDown, LogIn, LogOut, RefreshCw, Check, ChevronRight } from 'lucide-react'

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

const pctColor = (pct: number) => {
  if (pct >= 75) return 'text-green-700'
  if (pct >= 40) return 'text-amber-600'
  return 'text-red-400'
}

interface Ga4Property { propertyId: string; displayName: string }

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

  // Load GSC sites when authenticated and on step 2
  useEffect(() => {
    if (wizardStep === 2 && session?.access_token && sites.length === 0) {
      fetch('/api/gsc/sites')
        .then(r => r.json())
        .then(data => {
          const list: GscSite[] = data.siteEntry || []
          setSites(list)
          if (list.length > 0) setSelectedSite(list[0].siteUrl)
        })
        .catch(() => {})
    }
  }, [wizardStep, session])

  // Load GA4 properties when reaching step 3
  useEffect(() => {
    if (wizardStep === 3 && session?.access_token && ga4Properties.length === 0 && !ga4PropertiesLoading && !ga4Error) {
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

  // Step 1: Upload Ahrefs CSV
  function handleAhrefsCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const buf = ev.target?.result as ArrayBuffer
      // Try UTF-16 first, fall back to UTF-8
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

  // Step 1: Upload Top Pages CSV
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

  // Step 2: GSC pull
  async function handleGscPull() {
    if (!selectedSite || ahrefsKeywords.length === 0) return
    setGscLoading(true)
    setGscError(null)
    try {
      const controller = new AbortController()
      const timeoutMs = gscDateRange <= 30 ? 55000 : 110000
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch('/api/gsc/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteUrl: selectedSite,
          dateRange: gscDateRange,
          country: gscCountry,
          keywords: ahrefsKeywords,
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch GSC data')

      const built = buildAuditRows(
        data.keywordUrlData || {},
        data.daysMap || {},
        data.totalDays,
        ahrefsKeywords,
        csvUploaded ? topPages : undefined,
      )
      setRows(built)
      if (built.length === 0) {
        setGscError('No cannibalizing keywords found in GSC. The keywords from your Ahrefs export may not match this GSC property, or GSC may not have data for them in this time period.')
      } else {
        setWizardStep(3)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      if (msg.includes('abort')) {
        setGscError('Request timed out. Try a shorter time period (30 days) or skip this step.')
      } else {
        setGscError(msg)
      }
    } finally {
      setGscLoading(false)
    }
  }

  // Step 3: GA4 events
  async function handleAddEvents() {
    if (!selectedGa4Property || !selectedEvent) return
    setGa4Loading(true)
    try {
      const res = await fetch('/api/ga4/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: selectedGa4Property,
          eventName: selectedEvent,
          dateRange: ga4DateRange,
          country: ga4Country || undefined,
          channelGroup: ga4ChannelGroup || undefined,
        }),
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
    const headers = ['Keyword', 'URL', 'Avg Position', 'Clicks', 'Days Ranked', 'Days Ranked %', 'Cannibal Count',
      ...(csvUploaded ? ['Ref Domains', 'Total KWs'] : []),
      ...(activeEvent ? [eventHeader] : []),
      'Notes', 'Recommendation']
    const csvRows = rows.map(r => [
      r.keyword, r.url, r.position, r.clicks,
      r.daysRanked !== null ? `${r.daysRanked}/${r.totalDays}` : '',
      r.daysRankedPct !== null ? `${r.daysRankedPct}%` : '',
      r.cannibalizationCount,
      ...(csvUploaded ? [r.referringDomains ?? '', r.totalKeywords ?? ''] : []),
      ...(activeEvent ? [r.keyEvents?.[activeEvent] !== undefined ? r.keyEvents[activeEvent] : ''] : []),
      r.notes, r.recommendation,
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

  const uniqueKeywordCount = Object.keys(groupedByKeyword).length
  const uniqueUrlCount = new Set(rows.map(r => r.url)).size

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

  const stepSummary = (s: WizardStep) => {
    if (s === 1) return `${ahrefsKeywords.length} keywords loaded`
    if (s === 2) return rows.length > 0 ? `${uniqueKeywordCount} keywords · ${uniqueUrlCount} URLs · ${gscDateRange}d` : 'Not run'
    if (s === 3) return activeEvent ? `${activeEvent} · ${ga4MatchCount ?? 0} URLs matched` : 'Skipped'
    return ''
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

        <nav className="flex-1 p-3 space-y-1">
          {([1, 2, 3] as WizardStep[]).map(s => (
            <button
              key={s}
              onClick={() => (s === 1 || ahrefsKeywords.length > 0) ? setWizardStep(s) : null}
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
                  <div className="flex items-center gap-2">
                    <button onClick={() => setWizardStep(2)} className="flex items-center gap-1 px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-80" style={{ background: '#232323', color: '#fff' }}>
                      Next: Search Console <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Top Pages CSV (optional) */}
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

          {/* Step 1 summary */}
          {ahrefsKeywords.length > 0 && wizardStep > 1 && (
            <button onClick={() => setWizardStep(1)} className="card w-full flex items-center gap-3 text-left hover:opacity-80 transition-opacity">
              <span className="w-6 h-6 rounded-full bg-[#232323] text-white flex items-center justify-center flex-shrink-0"><Check className="w-3 h-3" /></span>
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Step 1 — Ahrefs</span>
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{stepSummary(1)}</span>
              <span className="ml-auto text-xs" style={{ color: 'var(--color-text-muted)' }}>Edit</span>
            </button>
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
                Finds all competing URLs for your {ahrefsKeywords.length} keywords, plus avg position, clicks, and days ranked.
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

                  <button onClick={handleGscPull} disabled={gscLoading || !selectedSite} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: '#232323', color: '#fff' }}>
                    <RefreshCw className={`w-4 h-4 ${gscLoading ? 'animate-spin' : ''}`} />
                    {gscLoading ? 'Pulling GSC data... this can take 15-30s' : 'Pull Data'}
                  </button>

                  {gscError && <div className="px-4 py-3 rounded-lg text-sm text-red-700 bg-red-50 border border-red-200">{gscError}</div>}
                </div>
              )}
            </div>
          )}

          {/* Step 2 summary */}
          {rows.length > 0 && wizardStep > 2 && (
            <button onClick={() => setWizardStep(2)} className="card w-full flex items-center gap-3 text-left hover:opacity-80 transition-opacity">
              <span className="w-6 h-6 rounded-full bg-[#232323] text-white flex items-center justify-center flex-shrink-0"><Check className="w-3 h-3" /></span>
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Step 2 — Search Console</span>
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{stepSummary(2)}</span>
              <span className="ml-auto text-xs" style={{ color: 'var(--color-text-muted)' }}>Edit</span>
            </button>
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

          {/* Step summaries on audit page */}
          {rows.length > 0 && wizardStep === 4 && (
            <>
              <button onClick={() => setWizardStep(2)} className="card w-full flex items-center gap-3 text-left hover:opacity-80 transition-opacity">
                <span className="w-6 h-6 rounded-full bg-[#232323] text-white flex items-center justify-center flex-shrink-0"><Check className="w-3 h-3" /></span>
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Step 2 — Search Console</span>
                <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{stepSummary(2)}</span>
                <span className="ml-auto text-xs" style={{ color: 'var(--color-text-muted)' }}>Edit</span>
              </button>
              <button onClick={() => setWizardStep(3)} className="card w-full flex items-center gap-3 text-left hover:opacity-80 transition-opacity">
                <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: activeEvent ? '#232323' : 'var(--color-border-strong)', color: activeEvent ? '#fff' : 'var(--color-text)' }}>
                  {activeEvent ? <Check className="w-3 h-3" /> : <span className="text-xs">3</span>}
                </span>
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Step 3 — GA4 Key Events</span>
                <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{stepSummary(3)}</span>
                <span className="ml-auto text-xs" style={{ color: 'var(--color-text-muted)' }}>Edit</span>
              </button>
            </>
          )}
        </div>

        {/* ── STEP 4: Audit table ── */}
        {rows.length > 0 && wizardStep === 4 && (
          <div className="px-8 pb-8 space-y-4">
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

            <div className="rounded-xl border overflow-auto" style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface-elevated)' }}>
              <table className="w-full text-sm" style={{ minWidth: '900px' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface)', borderBottom: '2px solid var(--color-border-strong)' }}>
                    {[
                      'Keyword', 'URL', 'Avg Pos', 'Clicks', 'Days Ranked', 'Cannibal Count',
                      ...(csvUploaded ? ['Ref Domains', 'Total KWs'] : []),
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
                          <span className="truncate block" title={row.url}>/{row.url.split('/').slice(1).join('/')}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-sm font-mono ${positionColor(row.position)}`}>{row.position}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>
                          {row.clicks.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                          {row.daysRankedPct !== null ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={`text-xs font-semibold ${pctColor(row.daysRankedPct)}`}>
                                {row.daysRankedPct}%
                              </span>
                              <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{row.daysRanked}/{row.totalDays}d</span>
                              <div className="w-12 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                                <div className="h-full rounded-full bg-[#232323]" style={{ width: `${Math.min(100, row.daysRankedPct)}%` }} />
                              </div>
                            </div>
                          ) : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs ${severityBadge(row.cannibalizationCount)}`}>{row.cannibalizationCount}</span>
                        </td>
                        {csvUploaded && (
                          <>
                            <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>{row.referringDomains !== null ? row.referringDomains.toLocaleString() : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}</td>
                            <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>{row.totalKeywords !== null ? row.totalKeywords.toLocaleString() : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}</td>
                          </>
                        )}
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
