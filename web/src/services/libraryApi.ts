import type {
  BookCatalogItem,
  BookFullTextHit,
  BookMeta,
  ChapterContent,
  ContentBlock,
  GlossaryEntry,
  RawBlock,
  SearchIndexItem,
} from '../types'
import { getLibraryBase } from './platform'
import { loadCustomBook, loadCustomBooksCatalog, saveCustomBook, type StoredCustomBook } from './storage'

let catalogCache: BookCatalogItem[] | null = null
let searchIndexCache: SearchIndexItem[] | null = null
let glossaryCache: GlossaryEntry[] | null = null
const bookMetaCache = new Map<string, BookMeta>()
const chunkCache = new Map<string, Record<string, { i: number; t: string; l: number; b: RawBlock[] }>>()

/** 带超时与自动重试的 JSON 拉取，杜绝桌面休眠或瞬时连接抖动导致书籍永久卡加载 */
async function fetchJsonWithRetry<T>(url: string, errMsg: string, timeoutMs = 12000): Promise<T> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: ac.signal })
      if (!res.ok) throw new Error(`${errMsg} (HTTP ${res.status})`)
      return (await res.json()) as T
    } catch (err) {
      lastErr = err
      if (attempt === 0) {
        await new Promise((r) => window.setTimeout(r, 180))
      }
    } finally {
      window.clearTimeout(timer)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(errMsg)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function cleanSpeakText(raw: string): string {
  return raw
    .replace(/⟦fn:\d+⟧/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\^?\d+\]/g, '')
    .replace(/[*_`~#>]/g, '')
    .replace(/\|+/g, '，')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[—\-_=]{3,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function renderInlineMarkdown(text: string, blockIndex?: number, rawFns?: RawBlock['f']): string {
  const cleaned = text
    .replace(/<a\b[^>]*>\s*<\/a>/gi, '')
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1')
    .replace(/<sup\b[^>]*>\s*\[?(\d{1,3})\]?\s*<\/sup>/gi, '[$1]')
    .replace(/<\/?(?:span|div|font|center|u|sub|br)\b[^>]*>/gi, '')
    .replace(/\/b>/gi, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[((?:[^[\]]|\[[^\]]*\])+)\]\(#[^)]*\)/g, '$1')
  let s = escapeHtml(cleaned)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*\*/g, '')
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
  s = s.replace(/\[\^?(\d+)\]/g, '<sup class="fn-ref">[$1]</sup>')
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<span class="underline decoration-dotted">$1</span>')
  if (rawFns && rawFns.length > 0 && typeof blockIndex === 'number') {
    s = s.replace(/⟦fn:(\d+)⟧/g, (_, idxStr: string) => {
      const i = Number(idxStr)
      const fn = rawFns[i]
      if (!fn) return ''
      const key = `b_${blockIndex}_f_${i}`
      if (fn.k === 'gloss') {
        return `<sup class="fn-ref fn-clickable fn-gloss" data-fn-key="${key}" title="点击查看中文译注">译注</sup>`
      }
      const safeLabel = escapeHtml(fn.l || String(i + 1))
      return `<sup class="fn-ref fn-clickable" data-fn-key="${key}" title="点击查看脚注 [${safeLabel}]">[${safeLabel}]</sup>`
    })
  } else {
    s = s.replace(/⟦fn:\d+⟧/g, '')
  }
  return s
}

function renderTableMarkdown(raw: string): string {
  const lines = raw.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return `<p>${renderInlineMarkdown(raw)}</p>`
  const headers = lines[0].replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  const rows = lines.slice(2).map((rl) => rl.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
  const th = headers.map((h) => `<th>${renderInlineMarkdown(h)}</th>`).join('')
  const tr = rows
    .map((r) => `<tr>${r.map((c) => `<td>${renderInlineMarkdown(c)}</td>`).join('')}</tr>`)
    .join('')
  return `<div class="md-table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`
}

const TYPE_MAP: Record<RawBlock['y'], ContentBlock['type']> = {
  h: 'heading',
  p: 'paragraph',
  q: 'quote',
  l: 'list',
  t: 'table',
  r: 'hr',
}

function hydrateBlocks(rawBlocks: RawBlock[], chapterIndex: number): ContentBlock[] {
  return rawBlocks.map((rb, idx) => {
    const type = TYPE_MAP[rb.y] || 'paragraph'
    let html = ''
    if (type === 'hr') {
      html = '<hr />'
    } else if (type === 'table') {
      html = renderTableMarkdown(rb.t)
    } else if (type === 'quote') {
      html = rb.t
        .split('\n')
        .map((line) => renderInlineMarkdown(line, idx, rb.f))
        .join('<br />')
    } else {
      html = renderInlineMarkdown(rb.t, idx, rb.f)
    }
    const footnotes =
      rb.f && rb.f.length > 0
        ? rb.f.map((fn, fi) => ({
            id: `b_${idx}_f_${fi}`,
            label: fn.l,
            kind: (fn.k === 'gloss' ? 'gloss' : 'footnote') as 'footnote' | 'gloss',
            text: fn.t,
          }))
        : undefined
    return {
      id: `b_${chapterIndex}_${idx}`,
      index: idx,
      type,
      level: rb.l,
      text: rb.t.replace(/⟦fn:\d+⟧/g, ''),
      html,
      speakText: type === 'hr' ? '' : cleanSpeakText(rb.t),
      footnotes,
    }
  })
}

export function getInitialCatalogSync(): BookCatalogItem[] {
  try {
    if (!catalogCache && typeof window !== 'undefined') {
      const preloaded = window.electronAPI?.initialCatalog?.books
      if (Array.isArray(preloaded) && preloaded.length > 0) {
        catalogCache = preloaded as BookCatalogItem[]
      }
    }
  } catch {}
  if (!catalogCache) return []
  return [...loadCustomBooksCatalog(), ...catalogCache]
}

export async function fetchCatalog(): Promise<BookCatalogItem[]> {
  if (!catalogCache) {
    const data = await fetchJsonWithRetry<{ books?: BookCatalogItem[] }>(
      `${getLibraryBase()}/catalog.json`,
      '无法加载典藏书目索引'
    )
    catalogCache = data.books || []
  }
  const custom = loadCustomBooksCatalog()
  return [...custom, ...catalogCache!]
}

export async function fetchBookMeta(bookId: string): Promise<BookMeta> {
  const cached = bookMetaCache.get(bookId)
  if (cached) return cached

  if (bookId.startsWith('custom_')) {
    const cb = await loadCustomBook(bookId)
    if (!cb) throw new Error('本地导入书籍不存在')
    bookMetaCache.set(bookId, cb.meta)
    return cb.meta
  }

  const meta = await fetchJsonWithRetry<BookMeta>(
    `${getLibraryBase()}/books/${bookId}/meta.json`,
    '无法加载书籍目录'
  )
  bookMetaCache.set(bookId, meta)
  return meta
}

export async function fetchChapter(bookId: string, chapterIndex: number): Promise<ChapterContent> {
  if (bookId.startsWith('custom_')) {
    const cb = await loadCustomBook(bookId)
    if (!cb) throw new Error('本地书籍章节读取失败')
    const ch = cb.chapters[chapterIndex] || cb.chapters[0]
    if (!ch) throw new Error('本地书籍暂无章节内容')
    return ch
  }

  const meta = await fetchBookMeta(bookId)
  if (!meta.chapters || meta.chapters.length === 0) {
    throw new Error('该典籍暂无章节目录')
  }
  const safeIdx = chapterIndex >= 0 && chapterIndex < meta.chapters.length ? chapterIndex : 0
  const chMeta = meta.chapters[safeIdx] || meta.chapters[0]
  const chunkKey = `${bookId}_p_${chMeta.chunk}`

  let chunkObj = chunkCache.get(chunkKey)
  if (!chunkObj) {
    chunkObj = await fetchJsonWithRetry<Record<string, { i: number; t: string; l: number; b: RawBlock[] }>>(
      `${getLibraryBase()}/books/${bookId}/p_${chMeta.chunk}.json`,
      '无法加载章节正文'
    )
    // 维持最多 24 个 chunk 的轻量化内存缓存
    if (chunkCache.size > 24) {
      const firstKey = chunkCache.keys().next().value
      if (firstKey) chunkCache.delete(firstKey)
    }
    chunkCache.set(chunkKey, chunkObj)
  }

  const rawCh = chunkObj[String(chMeta.index)] || Object.values(chunkObj)[0]
  if (!rawCh) {
    throw new Error('章节数据缺失')
  }
  return {
    bookId,
    chapterIndex: chMeta.index,
    title: rawCh.t || chMeta.title,
    level: rawCh.l ?? chMeta.level ?? 1,
    blocks: hydrateBlocks(Array.isArray(rawCh.b) ? rawCh.b : [], chMeta.index),
  }
}

export async function searchLibrary(query: string): Promise<
  Array<{
    bookId: string
    bookTitle: string
    author: string
    chapterIndex: number
    chapterTitle: string
    snippet: string
  }>
> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const books = await fetchCatalog()
  const bookMap = new Map(books.map((b) => [b.id, b]))

  if (!searchIndexCache) {
    const res = await fetch(`${getLibraryBase()}/search-index.json`)
    if (res.ok) {
      searchIndexCache = await res.json()
    } else {
      searchIndexCache = []
    }
  }

  const results: Array<{
    bookId: string
    bookTitle: string
    author: string
    chapterIndex: number
    chapterTitle: string
    snippet: string
    score: number
  }> = []

  // 1. 书名/作者匹配
  for (const b of books) {
    if (b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)) {
      results.push({
        bookId: b.id,
        bookTitle: b.title,
        author: b.author,
        chapterIndex: 0,
        chapterTitle: '全书概览',
        snippet: b.excerpt,
        score: 100,
      })
    }
  }

  // 2. 章节标题/摘要匹配
  for (const item of searchIndexCache!) {
    const inTitle = item.t.toLowerCase().includes(q)
    const inKey = item.k.toLowerCase().includes(q)
    const inPrev = item.p.toLowerCase().includes(q)
    if (inTitle || inKey || inPrev) {
      const b = bookMap.get(item.b)
      if (!b) continue
      results.push({
        bookId: item.b,
        bookTitle: b.title,
        author: b.author,
        chapterIndex: item.c,
        chapterTitle: item.t,
        snippet: item.p || item.k,
        score: inTitle ? 80 : inKey ? 60 : 40,
      })
      if (results.length >= 60) break
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, 40)
}

/** 书内真·全文检索（扫描本书全部章节段落，返回精确段落定位与上下文摘要） */
export async function searchInsideBook(
  bookId: string,
  query: string,
  maxHits = 80
): Promise<BookFullTextHit[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const meta = await fetchBookMeta(bookId)
  const hits: BookFullTextHit[] = []

  if (bookId.startsWith('custom_')) {
    const cb = await loadCustomBook(bookId)
    if (!cb) return []
    for (const ch of cb.chapters) {
      for (const blk of ch.blocks) {
        const plain = blk.speakText || blk.text
        const idx = plain.toLowerCase().indexOf(q)
        if (idx >= 0) {
          const s = Math.max(0, idx - 26)
          const e = Math.min(plain.length, idx + q.length + 54)
          hits.push({
            bookId,
            bookTitle: meta.title,
            author: meta.author,
            chapterIndex: ch.chapterIndex,
            chapterTitle: ch.title,
            blockIndex: blk.index,
            snippet: (s > 0 ? '…' : '') + plain.slice(s, e) + (e < plain.length ? '…' : ''),
          })
          if (hits.length >= maxHits) return hits
        }
      }
    }
    return hits
  }

  for (let ci = 0; ci < meta.chunkCount; ci++) {
    const chunkKey = `${bookId}_p_${ci}`
    let chunkObj = chunkCache.get(chunkKey)
    if (!chunkObj) {
      const res = await fetch(`${getLibraryBase()}/books/${bookId}/p_${ci}.json`)
      if (!res.ok) continue
      chunkObj = await res.json()
      if (chunkCache.size > 24) {
        const firstKey = chunkCache.keys().next().value
        if (firstKey) chunkCache.delete(firstKey)
      }
      chunkCache.set(chunkKey, chunkObj!)
    }
    for (const rawCh of Object.values(chunkObj!)) {
      for (let bi = 0; bi < rawCh.b.length; bi++) {
        const raw = rawCh.b[bi].t
        const idx = raw.toLowerCase().indexOf(q)
        if (idx >= 0) {
          const plain = cleanSpeakText(raw)
          const pIdx = plain.toLowerCase().indexOf(q)
          const pos = pIdx >= 0 ? pIdx : 0
          const s = Math.max(0, pos - 24)
          const e = Math.min(plain.length, pos + q.length + 56)
          hits.push({
            bookId,
            bookTitle: meta.title,
            author: meta.author,
            chapterIndex: rawCh.i,
            chapterTitle: rawCh.t,
            blockIndex: bi,
            snippet: (s > 0 ? '…' : '') + plain.slice(s, e) + (e < plain.length ? '…' : ''),
          })
          if (hits.length >= maxHits) return hits
        }
      }
    }
  }
  return hits
}

/** 跨书全文深度检索（流式扫描全库 72 部书籍正文，实时回调进度） */
export async function deepSearchAllBooks(
  query: string,
  onProgress?: (scanned: number, total: number, hits: BookFullTextHit[]) => void,
  signal?: AbortSignal,
  maxHits = 60
): Promise<BookFullTextHit[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const books = await fetchCatalog()
  const allHits: BookFullTextHit[] = []

  for (let i = 0; i < books.length; i++) {
    if (signal?.aborted) break
    const b = books[i]
    const perBookCap = Math.min(4, maxHits - allHits.length)
    if (perBookCap <= 0) break
    try {
      const hits = await searchInsideBook(b.id, q, perBookCap)
      if (hits.length > 0) allHits.push(...hits)
    } catch {}
    onProgress?.(i + 1, books.length, [...allHits])
    if (allHits.length >= maxHits) break
  }
  return allHits
}

/** 跨书哲学术语联动查询（内置康德辞典、拉康术语表与核心德古/西马术语库） */
export async function lookupPhilosophyTerm(rawQuery: string): Promise<GlossaryEntry[]> {
  const q = rawQuery.trim().replace(/[《》「」『』“”‘’（）()\[\]【】\s.,，。！？；：]/g, '')
  if (!q || q.length > 18) return []
  if (!glossaryCache) {
    try {
      const res = await fetch(`${getLibraryBase()}/glossary-index.json`)
      glossaryCache = res.ok ? await res.json() : []
    } catch {
      glossaryCache = []
    }
  }
  const ql = q.toLowerCase()
  const exact: GlossaryEntry[] = []
  const partial: GlossaryEntry[] = []

  for (const entry of glossaryCache!) {
    const tl = entry.t.toLowerCase()
    const ol = (entry.o || '').toLowerCase()
    if (tl === ql || (ol && ol === ql)) {
      exact.push(entry)
    } else if (
      (ql.length >= 2 && (tl.includes(ql) || ql.includes(tl))) ||
      (ol && ql.length >= 3 && ol.includes(ql))
    ) {
      partial.push(entry)
    }
  }
  return [...exact, ...partial].slice(0, 4)
}

/** 导入本地 Markdown / TXT 文档到私人书架 */
export async function importLocalTextBook(fileName: string, content: string): Promise<BookCatalogItem> {
  const cleanTitle = fileName.replace(/\.(md|markdown|txt)$/i, '').trim() || '未命名导入书籍'
  const id = `custom_${Date.now().toString(36)}`
  const lines = content.replace(/\r\n/g, '\n').split('\n')

  const chaptersRaw: Array<{ title: string; blocks: RawBlock[] }> = []
  let curTitle = '序言与正文'
  let curBlocks: RawBlock[] = []
  let curChars = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const hm = trimmed.match(/^(#{1,4})\s+(.+)$/)
    const isZhChapter = /^第[零一二三四五六七八九十百千万0-9]+[章节卷回讲篇]/.test(trimmed) && trimmed.length < 48
    if (hm || isZhChapter) {
      if (curBlocks.length > 0) {
        chaptersRaw.push({ title: curTitle, blocks: curBlocks })
      }
      curTitle = hm ? hm[2].trim() : trimmed
      curBlocks = [{ y: 'h', l: hm ? hm[1].length : 2, t: curTitle }]
      curChars = curTitle.length
    } else if (trimmed.startsWith('>')) {
      curBlocks.push({ y: 'q', t: trimmed.replace(/^>\s?/, '') })
      curChars += trimmed.length
    } else {
      curBlocks.push({ y: 'p', t: trimmed })
      curChars += trimmed.length
      if (curChars > 14000) {
        chaptersRaw.push({ title: curTitle, blocks: curBlocks })
        curTitle = `${cleanTitle} · 第 ${chaptersRaw.length + 1} 节`
        curBlocks = []
        curChars = 0
      }
    }
  }
  if (curBlocks.length > 0) {
    chaptersRaw.push({ title: curTitle, blocks: curBlocks })
  }
  if (chaptersRaw.length === 0) {
    chaptersRaw.push({ title: '正文', blocks: [{ y: 'p', t: content.slice(0, 2000) || '空白文档' }] })
  }

  let totalChars = 0
  const chapters: ChapterContent[] = chaptersRaw.map((ch, idx) => {
    const blocks = hydrateBlocks(ch.blocks, idx)
    totalChars += blocks.reduce((acc, b) => acc + b.text.length, 0)
    return {
      bookId: id,
      chapterIndex: idx,
      title: ch.title,
      level: 1,
      blocks,
    }
  })

  const firstPara = chapters[0]?.blocks.find((b) => b.type === 'paragraph')?.speakText || '用户导入的私人藏书。'

  const meta: BookMeta = {
    id,
    title: cleanTitle,
    author: '本地导入',
    category: '我的导入书架',
    station: 'german',
    sourceFormat: fileName.endsWith('.txt') ? 'txt' : 'md',
    charCount: totalChars,
    chapterCount: chapters.length,
    chunkCount: 1,
    estReadMin: Math.max(1, Math.round(totalChars / 420)),
    estListenMin: Math.max(1, Math.round(totalChars / 230)),
    coverPalette: 'celadon-ink',
    monogram: cleanTitle[0] || '书',
    excerpt: firstPara.slice(0, 140),
    isCustom: true,
    chapters: chapters.map((c, idx) => ({
      index: idx,
      chunk: 0,
      title: c.title,
      level: 1,
      charCount: c.blocks.reduce((a, b) => a + b.text.length, 0),
      blockCount: c.blocks.length,
      preview: c.blocks.find((b) => b.type === 'paragraph')?.speakText.slice(0, 90) || '',
    })),
  }

  const stored: StoredCustomBook = { id, meta, chapters }
  await saveCustomBook(stored)
  bookMetaCache.set(id, meta)
  const { chapters: _omit, ...catItem } = meta
  return catItem
}
