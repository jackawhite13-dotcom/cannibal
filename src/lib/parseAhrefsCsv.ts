/**
 * Parses an Ahrefs Organic Keywords CSV export (with "Multiple URLs only" toggle on).
 * Extracts just the keyword list — everything else comes from GSC.
 * Handles UTF-16 encoded TSV exports from Ahrefs.
 */
export function parseAhrefsCsv(text: string): string[] {
  // Normalize: remove BOM, normalize line endings
  const cleaned = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const lines = cleaned.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  // Detect delimiter (tab or comma)
  const headerLine = lines[0]
  const delimiter = headerLine.includes('\t') ? '\t' : ','

  const headers = headerLine.split(delimiter).map(h => h.replace(/^"|"$/g, '').trim().toLowerCase())

  const keywordIdx = headers.findIndex(h => h === 'keyword')
  if (keywordIdx === -1) return []

  const keywords: string[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map(c => c.replace(/^"|"$/g, '').trim())
    const kw = cols[keywordIdx]
    if (kw) keywords.push(kw)
  }

  return [...new Set(keywords)] // deduplicate
}
