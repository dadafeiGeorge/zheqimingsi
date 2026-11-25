import type {
  AiConversation,
  AiSettings,
  BookCatalogItem,
  BookMeta,
  BookmarkItem,
  ChapterContent,
  HighlightItem,
  HighlightStyle,
  RadioCheckpoint,
  RadioQueueItem,
  RadioSettings,
  ReaderSettings,
  ReadingProgress,
  StudyStats,
  TranslationSettings,
} from '../types'

const KEYS = {
  settings: 'lumen_reader_settings_v1',
  radioSettings: 'lumen_radio_settings_v1',
  radioCheckpoint: 'lumen_radio_checkpoint_v1',
  radioBookProgress: 'lumen_radio_book_progress_v1',
  progress: 'lumen_reading_progress_v1',
  highlights: 'lumen_highlights_v1',
  bookmarks: 'lumen_bookmarks_v1',
  radioQueue: 'lumen_radio_queue_v1',
  stats: 'lumen_study_stats_v1',
  favorites: 'lumen_favorite_books_v1',
  customBooksMeta: 'lumen_custom_books_meta_v1',
  translationSettings: 'lumen_translation_settings_v1',
  aiSettings: 'lumen_ai_settings_v1',
  aiConversations: 'lumen_ai_conversations_v1',
  highlightStylePref: 'lumen_highlight_style_pref_v1',
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  activeEngine: 'bing_web',
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  fullTextEnabled: false,
  azureKey: '',
  azureRegion: 'eastasia',
  azureEndpoint: 'https://api.cognitive.microsofttranslator.com',
  googleApiKey: '',
  deeplApiKey: '',
  deeplPlan: 'free',
  offlineLocalUrl: 'http://127.0.0.1:5000/translate',
  offlineUseLocalServer: false,
}

export const DEFAULT_AI_SYSTEM_PROMPT =
  '你是「哲启明思」内置的哲学与学术精读导师。请结合文本上下文，以严谨、清晰、富有启发性的中文（或按用户要求的其他语言）解答用户关于选中段落、哲学术语、论证结构与思想史脉络的问题。'

export const DEFAULT_AI_SETTINGS: AiSettings = {
  preset: 'deepseek',
  protocol: 'openai',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
  temperature: 0.7,
  maxTokens: 0,
  unlimitedOutput: true,
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: 'paper',
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.9,
  paraSpacing: 16,
  columnWidth: 'medium',
  textIndent: true,
  justify: true,
  readMode: 'scroll',
  keepScreenOn: true,
  volumeKeyTurn: false,
  dockTocOnWide: true,
  minimizeToTray: false,
}

export const DEFAULT_RADIO_SETTINGS: RadioSettings = {
  voice: 'zh-CN-YunyangNeural',
  rate: 1.0,
  pitch: 0,
  volume: 1.0,
  paraPauseMs: 520,
  announceChapter: true,
  ambientSound: 'none',
  ambientVolume: 0.25,
  azureKey: '',
  azureRegion: 'eastasia',
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return { ...fallback, ...JSON.parse(raw) }
  } catch {
    return fallback
  }
}

function safeParseRaw<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function loadReaderSettings(): ReaderSettings {
  return safeParse(localStorage.getItem(KEYS.settings), DEFAULT_READER_SETTINGS)
}

export function saveReaderSettings(s: ReaderSettings) {
  localStorage.setItem(KEYS.settings, JSON.stringify(s))
}

export function loadRadioSettings(): RadioSettings {
  return safeParse(localStorage.getItem(KEYS.radioSettings), DEFAULT_RADIO_SETTINGS)
}

export function saveRadioSettings(s: RadioSettings) {
  localStorage.setItem(KEYS.radioSettings, JSON.stringify(s))
}

export function loadTranslationSettings(): TranslationSettings {
  return safeParse(localStorage.getItem(KEYS.translationSettings), DEFAULT_TRANSLATION_SETTINGS)
}

export function saveTranslationSettings(s: TranslationSettings) {
  localStorage.setItem(KEYS.translationSettings, JSON.stringify(s))
}

export function loadAiSettings(): AiSettings {
  return safeParse(localStorage.getItem(KEYS.aiSettings), DEFAULT_AI_SETTINGS)
}

export function saveAiSettings(s: AiSettings) {
  localStorage.setItem(KEYS.aiSettings, JSON.stringify(s))
}

export function loadAiConversations(): AiConversation[] {
  return safeParseRaw<AiConversation[]>(localStorage.getItem(KEYS.aiConversations), [])
}

export function saveAiConversations(list: AiConversation[]) {
  try {
    localStorage.setItem(KEYS.aiConversations, JSON.stringify(list.slice(0, 40)))
  } catch {}
}

export function loadHighlightStylePref(): HighlightStyle {
  const raw = localStorage.getItem(KEYS.highlightStylePref)
  return raw === 'underline' ? 'underline' : 'highlight'
}

export function saveHighlightStylePref(style: HighlightStyle) {
  localStorage.setItem(KEYS.highlightStylePref, style)
}

export function loadRadioCheckpoint(): RadioCheckpoint | null {
  const cp = safeParseRaw<RadioCheckpoint | null>(localStorage.getItem(KEYS.radioCheckpoint), null)
  if (!cp || !cp.bookId || typeof cp.chapterIndex !== 'number') return null
  return cp
}

export function saveRadioCheckpoint(cp: RadioCheckpoint) {
  try {
    localStorage.setItem(KEYS.radioCheckpoint, JSON.stringify(cp))
    const map = loadAllRadioBookProgress()
    map[cp.bookId] = cp
    const entries = Object.entries(map)
    if (entries.length > 120) {
      entries.sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0))
      const trimmed: Record<string, RadioCheckpoint> = {}
      for (const [k, v] of entries.slice(0, 120)) trimmed[k] = v
      localStorage.setItem(KEYS.radioBookProgress, JSON.stringify(trimmed))
    } else {
      localStorage.setItem(KEYS.radioBookProgress, JSON.stringify(map))
    }
  } catch {}
}

export function loadAllRadioBookProgress(): Record<string, RadioCheckpoint> {
  return safeParseRaw<Record<string, RadioCheckpoint>>(localStorage.getItem(KEYS.radioBookProgress), {})
}

export function getRadioBookProgress(bookId: string): RadioCheckpoint | null {
  if (!bookId) return null
  const map = loadAllRadioBookProgress()
  const cp = map[bookId]
  return cp && typeof cp.chapterIndex === 'number' ? cp : null
}

export function loadAllProgress(): Record<string, ReadingProgress> {
  return safeParseRaw(localStorage.getItem(KEYS.progress), {})
}

export function saveBookProgress(p: ReadingProgress) {
  const all = loadAllProgress()
  all[p.bookId] = p
  localStorage.setItem(KEYS.progress, JSON.stringify(all))
}

export function loadHighlights(): HighlightItem[] {
  return safeParseRaw(localStorage.getItem(KEYS.highlights), [])
}

export function saveHighlights(list: HighlightItem[]) {
  localStorage.setItem(KEYS.highlights, JSON.stringify(list))
}

export function loadBookmarks(): BookmarkItem[] {
  return safeParseRaw(localStorage.getItem(KEYS.bookmarks), [])
}

export function saveBookmarks(list: BookmarkItem[]) {
  localStorage.setItem(KEYS.bookmarks, JSON.stringify(list))
}

export function loadRadioQueue(): RadioQueueItem[] {
  return safeParseRaw(localStorage.getItem(KEYS.radioQueue), [])
}

export function saveRadioQueue(list: RadioQueueItem[]) {
  localStorage.setItem(KEYS.radioQueue, JSON.stringify(list))
}

export function loadFavorites(): string[] {
  return safeParseRaw(localStorage.getItem(KEYS.favorites), [])
}

export function saveFavorites(ids: string[]) {
  localStorage.setItem(KEYS.favorites, JSON.stringify(ids))
}

export function loadStats(): StudyStats {
  return safeParse(localStorage.getItem(KEYS.stats), {
    totalReadSeconds: 0,
    totalListenSeconds: 0,
    dailyMap: {},
    booksOpened: [],
  })
}

export function recordStudySeconds(kind: 'read' | 'listen', seconds: number, bookId?: string) {
  const stats = loadStats()
  const today = new Date().toISOString().slice(0, 10)
  if (!stats.dailyMap[today]) stats.dailyMap[today] = { read: 0, listen: 0 }
  if (kind === 'read') {
    stats.totalReadSeconds += seconds
    stats.dailyMap[today].read += seconds
  } else {
    stats.totalListenSeconds += seconds
    stats.dailyMap[today].listen += seconds
  }
  if (bookId && !stats.booksOpened.includes(bookId)) {
    stats.booksOpened.push(bookId)
  }
  localStorage.setItem(KEYS.stats, JSON.stringify(stats))
}

/* ---------- IndexedDB 存储用户导入的本地书籍 ---------- */
const DB_NAME = 'lumen_custom_library'
const STORE_NAME = 'books'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export interface StoredCustomBook {
  id: string
  meta: BookMeta
  chapters: ChapterContent[]
}

export async function saveCustomBook(book: StoredCustomBook): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(book)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  const list = loadCustomBooksCatalog().filter((b) => b.id !== book.id)
  const { chapters: _omit, ...catItem } = book.meta
  list.unshift(catItem)
  localStorage.setItem(KEYS.customBooksMeta, JSON.stringify(list))
}

export function loadCustomBooksCatalog(): BookCatalogItem[] {
  return safeParseRaw(localStorage.getItem(KEYS.customBooksMeta), [])
}

export async function loadCustomBook(id: string): Promise<StoredCustomBook | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(id)
    req.onsuccess = () => resolve((req.result as StoredCustomBook) || null)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteCustomBook(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  const list = loadCustomBooksCatalog().filter((b) => b.id !== id)
  localStorage.setItem(KEYS.customBooksMeta, JSON.stringify(list))
}

/* ---------- 跨端全量学习档案备份与恢复（Windows <-> Android 同步） ---------- */
export function exportFullBackupJson(): string {
  const payload = {
    app: '哲启明思',
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    readerSettings: loadReaderSettings(),
    radioSettings: loadRadioSettings(),
    translationSettings: loadTranslationSettings(),
    aiSettings: loadAiSettings(),
    radioCheckpoint: loadRadioCheckpoint(),
    radioBookProgress: loadAllRadioBookProgress(),
    progress: loadAllProgress(),
    highlights: loadHighlights(),
    bookmarks: loadBookmarks(),
    favorites: loadFavorites(),
    radioQueue: loadRadioQueue(),
    stats: loadStats(),
  }
  return JSON.stringify(payload, null, 2)
}

export function importFullBackupJson(rawText: string): {
  highlights: number
  bookmarks: number
  booksProgress: number
} {
  const data = JSON.parse(rawText)
  if (!data || typeof data !== 'object') {
    throw new Error('无效的备份文件格式')
  }

  // 智能合并进度（保留最新时间戳）
  if (data.progress && typeof data.progress === 'object') {
    const cur = loadAllProgress()
    for (const [bid, p] of Object.entries<any>(data.progress)) {
      if (!cur[bid] || (p?.updatedAt || 0) >= (cur[bid].updatedAt || 0)) {
        cur[bid] = p
      }
    }
    localStorage.setItem(KEYS.progress, JSON.stringify(cur))
  }

  // 智能合并划线与批注（按 id 去重）
  let hlCount = 0
  if (Array.isArray(data.highlights)) {
    const cur = loadHighlights()
    const map = new Map<string, HighlightItem>(cur.map((h) => [h.id, h]))
    for (const h of data.highlights) {
      if (h?.id && h?.bookId) map.set(h.id, h)
    }
    const merged = Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    saveHighlights(merged)
    hlCount = merged.length
  }

  // 智能合并书签
  let bmCount = 0
  if (Array.isArray(data.bookmarks)) {
    const cur = loadBookmarks()
    const map = new Map<string, BookmarkItem>(cur.map((b) => [b.id, b]))
    for (const b of data.bookmarks) {
      if (b?.id && b?.bookId) map.set(b.id, b)
    }
    const merged = Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    saveBookmarks(merged)
    bmCount = merged.length
  }

  if (Array.isArray(data.favorites)) {
    const mergedFav = Array.from(new Set([...loadFavorites(), ...data.favorites]))
    saveFavorites(mergedFav)
  }

  if (Array.isArray(data.radioQueue)) {
    const cur = loadRadioQueue()
    const seen = new Set(cur.map((q) => `${q.bookId}_${q.chapterIndex}`))
    const merged = [...cur]
    for (const q of data.radioQueue) {
      const k = `${q.bookId}_${q.chapterIndex}`
      if (!seen.has(k)) {
        seen.add(k)
        merged.push(q)
      }
    }
    saveRadioQueue(merged)
  }

  if (data.readerSettings && typeof data.readerSettings === 'object') {
    saveReaderSettings({ ...loadReaderSettings(), ...data.readerSettings })
  }
  if (data.radioSettings && typeof data.radioSettings === 'object') {
    saveRadioSettings({ ...loadRadioSettings(), ...data.radioSettings })
  }
  if (data.translationSettings && typeof data.translationSettings === 'object') {
    saveTranslationSettings({ ...loadTranslationSettings(), ...data.translationSettings })
  }
  if (data.aiSettings && typeof data.aiSettings === 'object') {
    saveAiSettings({ ...loadAiSettings(), ...data.aiSettings })
  }
  if (data.radioBookProgress && typeof data.radioBookProgress === 'object') {
    const cur = loadAllRadioBookProgress()
    for (const [bid, cp] of Object.entries<any>(data.radioBookProgress)) {
      if (cp?.bookId && (!cur[bid] || (cp?.updatedAt || 0) >= (cur[bid].updatedAt || 0))) {
        cur[bid] = cp
      }
    }
    localStorage.setItem(KEYS.radioBookProgress, JSON.stringify(cur))
  }
  if (data.radioCheckpoint && typeof data.radioCheckpoint === 'object' && data.radioCheckpoint.bookId) {
    const cur = loadRadioCheckpoint()
    if (!cur || (data.radioCheckpoint.updatedAt || 0) >= (cur.updatedAt || 0)) {
      saveRadioCheckpoint(data.radioCheckpoint)
    }
  }
  if (data.stats && typeof data.stats === 'object') {
    const cur = loadStats()
    const mergedDaily = { ...cur.dailyMap }
    for (const [day, val] of Object.entries<any>(data.stats.dailyMap || {})) {
      const prev = mergedDaily[day] || { read: 0, listen: 0 }
      mergedDaily[day] = {
        read: Math.max(prev.read, val?.read || 0),
        listen: Math.max(prev.listen, val?.listen || 0),
      }
    }
    const mergedStats: StudyStats = {
      totalReadSeconds: Math.max(cur.totalReadSeconds, data.stats.totalReadSeconds || 0),
      totalListenSeconds: Math.max(cur.totalListenSeconds, data.stats.totalListenSeconds || 0),
      dailyMap: mergedDaily,
      booksOpened: Array.from(new Set([...cur.booksOpened, ...(data.stats.booksOpened || [])])),
    }
    localStorage.setItem(KEYS.stats, JSON.stringify(mergedStats))
  }

  return {
    highlights: hlCount,
    bookmarks: bmCount,
    booksProgress: Object.keys(loadAllProgress()).length,
  }
}
