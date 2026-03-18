import { NextRequest, NextResponse } from 'next/server'

const AHREFS_API_BASE = 'https://api.ahrefs.com/v3'

export async function POST(req: NextRequest) {
  const { domain } = await req.json()

  if (!domain) {
    return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
  }

  const apiKey = process.env.AHREFS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Ahrefs API key not configured' }, { status: 500 })
  }

  const today = new Date().toISOString().split('T')[0]

  const params = new URLSearchParams({
    target: domain,
    mode: 'subdomains',
    date: today,
    select: 'keyword,volume,sum_traffic,best_position,best_position_url,serp_target_main_positions_count,all_positions',
    where: JSON.stringify({ and: [{ field: 'serp_target_positions_count', is: ['gt', 1] }, { field: 'keyword_country', is: ['eq', 'US'] }] }),
    order_by: 'sum_traffic:desc',
    limit: '1000',
    output: 'json',
  })

  const response = await fetch(`${AHREFS_API_BASE}/site-explorer/organic-keywords?${params}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    return NextResponse.json({ error }, { status: response.status })
  }

  const data = await response.json()
  return NextResponse.json(data)
}
