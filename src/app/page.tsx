'use client'

import { useState, useRef, useEffect } from 'react'
import { useSession, signIn, signOut } from 'next-auth/react'
import { AuditRow, Recommendation, TopPageRow, GscSite } from '@/types/audit'
import { buildAuditRowsFromGsc, syncRecommendation } from '@/lib/buildAuditRows'
import { parseTopPagesCsv } from '@/lib/parseTopPages'
import { Upload, Download, AlertTriangle, ChevronDown, LogIn, LogOut, RefreshCw } from 'lucide-react'

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

interface Ga4Property {
  propertyId: string
  displayName: string
}

export default function Home() {
  const { data: session, status } = useSession()
  const [sites, setSites] = useState<GscSite[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [rows, setRows] = useState<AuditRow[]>([])
  const [topPages, setTopPages] = useState<Record<string, TopPageRow>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [csvUploaded, setCsvUploaded] = useState(false)
  const [csvDebug, setCsvDebug] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // GA4
  const [ga4Properties, setGa4Properties] = useState<Ga4Property[]>([])
  const [selectedGa4Property, setSelectedGa4Property] = useState('')
  const [ga4EventNames, setGa4EventNames] = useState<string[]>([])
  const [selectedEvent, setSelectedEvent] = useState('')
  const [activeEvent, setActiveEvent] = useState('')
  const [ga4Loading, setGa4Loading] = useState(false)
  const [ga4Error, setGa4Error] = useState<string | null>(null)

  // Fetch GSC sites + GA4 properties once authenticated
  useEffect(() => {
    if (session?.access_token) {
      fetch('/api/gsc/sites')
        .then(r => r.json())
        .then(data => {
          const siteList: GscSite[] = data.siteEntry || []
          setSites(siteList)
          if (siteList.length > 0) setSelectedSite(siteList[0].siteUrl)
        })
        .catch(() => {})

      fetch('/api/ga4/properties')
        .then(r => r.json())
        .then(data => {
          if (data.error) {
            setGa4Error(`GA4: ${data.error}`)
            return
          }
          const props: Ga4Property[] = data.properties || []
          setGa4Properties(props)
          if (props.length > 0) setSelectedGa4Property(props[0].propertyId)
          else setGa4Error('GA4: No properties found for this Google account')
        })
        .catch(e => setGa4Error(`GA4: ${e.message}`))
    }
  }, [session])

  // Fetch event names when GA4 property changes
  useEffect(() => {
    if (!selectedGa4Property) return
    fetch('/api/ga4/event-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: selectedGa4Property }),
    })
      .then(r => r.json())
      .then(data => {
        setGa4EventNames(data.eventNames || [])
        setSelectedEvent(data.eventNames?.[0] || '')
      })
      .catch(() => {})
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
    setLoadingMsg('Fetching Search Console data (this may take a moment)...')

    try {
      const res = await fetch('/api/gsc/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: selectedSite }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch GSC data')
      const built = buildAuditRowsFromGsc(data.keywords || [], topPages)
      setRows(built)
      setLoadingMsg('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const { map: parsed, debug } = parseTopPagesCsv(text)
      setTopPages(parsed)
      setCsvUploaded(true)
      setCsvDebug(debug)
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

  async function handleAddEvents() {
    if (!selectedGa4Property || !selectedEvent) return
    setGa4Loading(true)
    setGa4Error(null)
    try {
      const res = await fetch('/api/ga4/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: selectedGa4Property, eventName: selectedEvent }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch GA4 data')
      const pathMap: Record<string, number> = data.pathMap || {}
      setActiveEvent(selectedEvent)
      setRows(prev => prev.map(row => {
        const path = row.url.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/'
        const count = pathMap[path] ?? null
        return {
          ...row,
          keyEvents: count !== null ? { ...(row.keyEvents || {}), [selectedEvent]: count } : row.keyEvents,
        }
      }))
    } catch (e: unknown) {
      setGa4Error(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setGa4Loading(false)
    }
  }

  function handleExportCsv() {
    const eventHeader = activeEvent ? `Event: ${activeEvent}` : 'Key Events'
    const headers = ['Keyword', 'URL', 'Position', 'Days Ranked', 'Clicks (6mo)', 'Avg Monthly Clicks', 'Cannibalization Count', 'Referring Domains', 'Total Keywords', eventHeader, 'Notes', 'Recommendation']
    const csvRows = rows.map(r => [
      r.keyword, r.url, r.position,
      r.daysRanked !== null ? `${r.daysRanked}/${r.totalDays}` : '',
      r.clicks6m ?? '', r.avgMonthlyClicks ?? '',
      r.cannibalizationCount,
      r.referringDomains ?? '', r.totalKeywords ?? '',
      activeEvent && r.keyEvents?.[activeEvent] !== undefined ? r.keyEvents[activeEvent] : '',
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
          <div className="px-3 py-2 rounded-lg text-sm font-semibold border-l-2 border-[#232323]"
            style={{ background: 'rgba(248,214,185,0.6)', color: 'var(--color-text)' }}>
            Audit Builder
          </div>
        </nav>
        {/* Auth status */}
        <div className="p-4 border-t" style={{ borderColor: 'var(--color-sidebar-hover)' }}>
          {status === 'authenticated' ? (
            <div>
              <div className="text-xs font-medium truncate mb-2" style={{ color: 'var(--color-text)' }}>
                {session.user?.email}
              </div>
              <button
                onClick={() => signOut()}
                className="flex items-center gap-1.5 text-xs w-full transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <LogOut className="w-3 h-3" /> Sign out
              </button>
            </div>
          ) : (
            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Keyword Cannibalization Audit
            </div>
          )}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-x-hidden flex flex-col">
        {/* Top bar */}
        <div className="px-8 py-5 flex items-center justify-between border-b" style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface-elevated)' }}>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Cannibal Audit Builder</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              Identify and resolve keyword cannibalization across any domain
            </p>
          </div>
          {rows.length > 0 && (
            <button onClick={handleExportCsv}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
              style={{ background: '#232323', color: '#fff' }}>
              <Download className="w-4 h-4" /> Export CSV
            </button>
          )}
        </div>

        <div className="px-8 py-6 space-y-6">
          {/* Auth / Data Sources card */}
          <div className="card">
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--color-text-muted)' }}>Data Sources</h2>

            {status !== 'authenticated' ? (
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Connect Google Search Console</p>
                  <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>Required to pull keyword + URL cannibalization data</p>
                  <button
                    onClick={() => signIn('google')}
                    disabled={status === 'loading'}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80 disabled:opacity-50"
                    style={{ background: '#232323', color: '#fff' }}
                  >
                    <LogIn className="w-4 h-4" />
                    Connect Google Account
                  </button>
                </div>
              </div>
            ) : (
              <>
              <div className="flex items-end gap-4 flex-wrap">
                {/* Site selector */}
                <div className="flex-1 min-w-64">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    GSC Property
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <select
                        value={selectedSite}
                        onChange={e => setSelectedSite(e.target.value)}
                        className="w-full appearance-none px-3 py-2 text-sm rounded-lg outline-none pr-8"
                        style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                      >
                        {sites.map(s => (
                          <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>
                        ))}
                        {sites.length === 0 && <option value="">No properties found</option>}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
                    </div>
                    <button
                      onClick={handlePull}
                      disabled={isLoading || !selectedSite}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: '#232323', color: '#fff' }}
                    >
                      <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                      {isLoading ? 'Pulling...' : 'Pull Data'}
                    </button>
                  </div>
                </div>

                {/* Top Pages CSV */}
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    Ahrefs Top Pages CSV <span className="normal-case font-normal">(ref domains + keywords)</span>
                  </label>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
                    style={csvUploaded
                      ? { background: '#C3F2D0', borderColor: '#86efac', color: '#166534' }
                      : { background: 'var(--color-surface-elevated)', borderColor: 'rgba(248,214,185,0.5)', color: 'var(--color-text)' }}
                  >
                    <Upload className="w-4 h-4" />
                    {csvUploaded ? 'CSV Loaded ✓' : 'Upload CSV'}
                  </button>
                  <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
                  {csvDebug && <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{csvDebug}</p>}
                </div>

                {/* GA4 Key Events */}
                {ga4Properties.length > 0 && (
                  <div className="flex items-end gap-2 flex-wrap">
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                        GA4 Property
                      </label>
                      <div className="relative">
                        <select
                          value={selectedGa4Property}
                          onChange={e => setSelectedGa4Property(e.target.value)}
                          className="appearance-none px-3 py-2 text-sm rounded-lg outline-none pr-8 max-w-[200px]"
                          style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                        >
                          {ga4Properties.map(p => (
                            <option key={p.propertyId} value={p.propertyId}>{p.displayName}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                        Key Event
                      </label>
                      <div className="relative">
                        <select
                          value={selectedEvent}
                          onChange={e => setSelectedEvent(e.target.value)}
                          className="appearance-none px-3 py-2 text-sm rounded-lg outline-none pr-8 max-w-[200px]"
                          style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                        >
                          {ga4EventNames.map(e => (
                            <option key={e} value={e}>{e}</option>
                          ))}
                          {ga4EventNames.length === 0 && <option value="">Loading...</option>}
                        </select>
                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
                      </div>
                    </div>

                    <button
                      onClick={handleAddEvents}
                      disabled={ga4Loading || !selectedEvent || rows.length === 0}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={activeEvent === selectedEvent
                        ? { background: '#B7EBFF', borderColor: '#7dd3fc', color: '#0369a1' }
                        : { background: 'var(--color-surface-elevated)', borderColor: 'rgba(183,235,255,0.6)', color: 'var(--color-text)' }}
                    >
                      <RefreshCw className={`w-4 h-4 ${ga4Loading ? 'animate-spin' : ''}`} />
                      {ga4Loading ? 'Loading...' : activeEvent === selectedEvent ? 'Events Added ✓' : 'Add Events'}
                    </button>
                  </div>
                )}
              </div>

              {ga4Error && (
                <div className="mt-3 px-4 py-3 rounded-lg text-sm text-red-700 bg-red-50 border border-red-200">
                  {ga4Error}
                </div>
              )}
              </>
            )}

            {error && (
              <div className="mt-4 px-4 py-3 rounded-lg text-sm text-red-700 bg-red-50 border border-red-200">
                {error}
              </div>
            )}
          </div>

          {/* Stats */}
          {rows.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
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
          )}

          {/* Table */}
          {rows.length > 0 && (
            <div className="rounded-xl border overflow-auto" style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface-elevated)' }}>
              <table className="w-full text-sm min-w-[1200px]">
                <thead>
                  <tr style={{ background: 'var(--color-surface)', borderBottom: '2px solid var(--color-border-strong)' }}>
                    {['Keyword', 'URL', 'Pos', 'Days Ranked', 'Cannibal Count', 'Ref Domains', 'Total KWs', 'Clicks 6mo', 'Avg/mo', activeEvent || 'Key Events', 'Notes', 'Recommendation'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                        style={{ color: 'var(--color-text-muted)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(groupedByKeyword).map(([keyword, kwRows]) =>
                    kwRows.map((row, i) => (
                      <tr
                        key={`${keyword}-${row.url}-${i}`}
                        style={{
                          borderBottom: '1px solid var(--color-border)',
                          borderTop: i === 0 ? '2px solid var(--color-border-strong)' : undefined,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-row-hover)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                      >
                        <td className="px-4 py-2.5 font-semibold max-w-[180px]" style={{ color: 'var(--color-text)' }}>
                          {i === 0 ? <span className="line-clamp-2 text-sm">{keyword}</span> : null}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs max-w-[220px]" style={{ color: 'var(--color-text-muted)' }}>
                          <span className="truncate block" title={row.url}>
                            {row.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                          </span>
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
                          ) : (
                            <span style={{ color: 'var(--color-border-strong)' }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs ${severityBadge(row.cannibalizationCount)}`}>
                            {row.cannibalizationCount}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>
                          {row.referringDomains !== null ? row.referringDomains : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>
                          {row.totalKeywords !== null ? row.totalKeywords : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>
                          {row.clicks6m !== null ? row.clicks6m.toLocaleString() : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>
                          {row.avgMonthlyClicks !== null ? row.avgMonthlyClicks.toLocaleString() : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-sm" style={{ color: 'var(--color-text)' }}>
                          {activeEvent && row.keyEvents?.[activeEvent] !== undefined
                            ? <span className="font-semibold">{row.keyEvents[activeEvent].toLocaleString()}</span>
                            : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}
                        </td>
                        <td className="px-4 py-2 min-w-[160px]">
                          <input
                            type="text"
                            value={row.notes}
                            onChange={e => handleNotesChange(keyword, row.url, e.target.value)}
                            placeholder="Add note..."
                            className="w-full bg-transparent text-xs py-1 outline-none"
                            style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                            onFocus={e => e.target.style.borderBottomColor = '#232323'}
                            onBlur={e => e.target.style.borderBottomColor = 'rgba(248,214,185,0.5)'}
                          />
                        </td>
                        <td className="px-4 py-2 min-w-[150px]">
                          <div className="relative">
                            <select
                              value={row.recommendation}
                              onChange={e => handleRecChange(row.url, e.target.value as Recommendation)}
                              className={`w-full appearance-none rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer outline-none pr-7 ${REC_STYLES[row.recommendation]}`}
                            >
                              {RECOMMENDATIONS.map(r => (
                                <option key={r} value={r}>{r || 'Set rec...'}</option>
                              ))}
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
          )}

          {/* Empty state */}
          {rows.length === 0 && !isLoading && status === 'authenticated' && (
            <div className="card text-center py-20">
              <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'var(--color-sidebar)' }}>
                <AlertTriangle className="w-5 h-5" style={{ color: 'var(--color-text-muted)' }} />
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Select a property and pull data to begin</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>Pulls last 6 months of Search Console data</p>
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="card text-center py-20">
              <div className="w-6 h-6 border-2 border-[#232323] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{loadingMsg}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
