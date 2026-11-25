export type ThemeId = 'paper' | 'sepia' | 'night' | 'sage'
export type FontFamilyId = 'serif' | 'sans' | 'kai'
export type ReadMode = 'scroll' | 'page'
export type HighlightColor = 'sky' | 'rose' | 'emerald' | 'indigo' | 'amber'
export type HighlightStyle = 'highlight' | 'underline'
export type AmbientSoundId = 'none' | 'rain' | 'fireplace' | 'brown' | 'vinyl'
export type AppTab = 'library' | 'reader' | 'radio' | 'ai' | 'notes'

export type TranslationEngineId =
  | 'bing_web'
  | 'google_web'
  | 'azure_api'
  | 'google_api'
  | 'deepl_api'
  | 'ai'
  | 'offline'

export interface TranslationSettings {
  activeEngine: TranslationEngineId
  sourceLang: string
  targetLang: string
  fullTextEnabled: boolean
  azureKey: string
  azureRegion: string
  azureEndpoint: string
  googleApiKey: string
  deeplApiKey: string
  deeplPlan: 'free' | 'pro'
  offlineLocalUrl: string
  offlineUseLocalServer: boolean
}

export type AiProtocol = 'openai' | 'anthropic' | 'gemini'

export type AiProviderPresetId =
  | 'deepseek'
  | 'openai'
  | 'siliconflow'
  | 'gemini'
  | 'anthropic'
  | 'openrouter'
  | 'ollama'
  | 'custom'

export interface AiSettings {
  preset: AiProviderPresetId
  protocol: AiProtocol
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  temperature: number
  /** 0 或未开启自定义上限时表示无上限（不传 max_tokens，完全跟随模型原生最大输出） */
  maxTokens: number
  /** 默认 true：不限制 AI 输出 Token 上限 */
  unlimitedOutput?: boolean
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  quoteText?: string
  bookTitle?: string
  chapterTitle?: string
  createdAt: number
}

export interface AiConversation {
  id: string
  title: string
  bookId?: string
  bookTitle?: string
  chapterTitle?: string
  messages: AiMessage[]
  updatedAt: number
}

export interface BookCatalogItem {
  id: string
  title: string
  author: string
  category: string
  station: 'classic' | 'german' | 'marxism' | 'phenomenology' | 'postmodern' | 'chinese' | 'reference'
  sourceFormat: string
  charCount: number
  chapterCount: number
  chunkCount: number
  estReadMin: number
  estListenMin: number
  coverPalette: string
  monogram: string
  excerpt: string
  firstBodyChapter?: number
  isCustom?: boolean
}

export interface ChapterMeta {
  index: number
  chunk: number
  title: string
  level: number
  charCount: number
  blockCount: number
  preview: string
  isFrontMatter?: boolean
}

export interface BookMeta extends BookCatalogItem {
  chapters: ChapterMeta[]
}

export interface RawFootnote {
  l: string
  k: 'fn' | 'gloss'
  t: string
}

export interface RawBlock {
  y: 'h' | 'p' | 'q' | 'l' | 't' | 'r'
  l?: number
  t: string
  f?: RawFootnote[]
}

export interface ContentFootnote {
  id: string
  label: string
  kind: 'footnote' | 'gloss'
  text: string
}

export interface ContentBlock {
  id: string
  index: number
  type: 'heading' | 'paragraph' | 'quote' | 'list' | 'table' | 'hr'
  level?: number
  text: string
  html: string
  speakText: string
  footnotes?: ContentFootnote[]
}

export interface ChapterContent {
  bookId: string
  chapterIndex: number
  title: string
  level: number
  blocks: ContentBlock[]
}

export interface SearchIndexItem {
  b: string
  c: number
  t: string
  k: string
  p: string
}

export interface ReadingProgress {
  bookId: string
  chapterIndex: number
  blockIndex: number
  scrollRatio: number
  updatedAt: number
}

export interface HighlightItem {
  id: string
  groupId?: string
  bookId: string
  bookTitle: string
  author: string
  chapterIndex: number
  chapterTitle: string
  blockIndex: number
  startOffset?: number
  endOffset?: number
  text: string
  note: string
  color: HighlightColor
  style?: HighlightStyle
  createdAt: number
}

export interface GlossaryEntry {
  t: string
  o: string
  d: string
  s: string
  b?: string
  c?: number
}

export interface BookFullTextHit {
  bookId: string
  bookTitle: string
  author: string
  chapterIndex: number
  chapterTitle: string
  blockIndex: number
  snippet: string
}

export interface TtsCacheStats {
  fileCount: number
  totalBytes: number
}

export interface BookmarkItem {
  id: string
  bookId: string
  bookTitle: string
  chapterIndex: number
  chapterTitle: string
  blockIndex: number
  excerpt: string
  createdAt: number
}

export interface ReaderSettings {
  theme: ThemeId
  fontFamily: FontFamilyId
  fontSize: number
  lineHeight: number
  paraSpacing: number
  columnWidth: 'narrow' | 'medium' | 'wide' | 'spread'
  textIndent: boolean
  justify: boolean
  readMode: ReadMode
  keepScreenOn: boolean
  volumeKeyTurn: boolean
  dockTocOnWide: boolean
  minimizeToTray: boolean
}

export interface TtsVoice {
  shortName: string
  label: string
  gender: 'Female' | 'Male'
  locale: string
  tag: string
}

export interface RadioStation {
  id: 'current' | 'classic' | 'german' | 'marxism' | 'phenomenology' | 'postmodern' | 'chinese' | 'roam' | 'queue'
  freq: string
  name: string
  subtitle: string
  description: string
  accent: string
}

export interface RadioSettings {
  voice: string
  rate: number
  pitch: number
  volume: number
  paraPauseMs: number
  announceChapter: boolean
  ambientSound: AmbientSoundId
  ambientVolume: number
  azureKey: string
  azureRegion: string
}

export interface RadioQueueItem {
  id: string
  bookId: string
  bookTitle: string
  author: string
  chapterIndex: number
  chapterTitle: string
}

export interface RadioCheckpoint {
  stationId: RadioStation['id']
  bookId: string
  bookTitle: string
  author: string
  chapterIndex: number
  chapterTitle: string
  blockIndex: number
  totalBlocks: number
  segmentIndex: number
  totalSegments: number
  segmentTime: number
  segmentDuration: number
  chapterCurrentTime: number
  chapterDuration: number
  currentText: string
  updatedAt: number
}

export interface RadioState {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error'
  errorMessage: string | null
  stationId: RadioStation['id']
  bookId: string | null
  bookTitle: string
  author: string
  chapterIndex: number
  chapterTitle: string
  blockIndex: number
  totalBlocks: number
  segmentIndex: number
  totalSegments: number
  currentText: string
  currentTime: number
  duration: number
  chapterCurrentTime: number
  chapterDuration: number
  hasSavedCheckpoint: boolean
  sleepEndAt: number | null
  sleepAfterChapter: boolean
  isNativeEngine: boolean
  isOfflineFallback: boolean
}

export interface StudyStats {
  totalReadSeconds: number
  totalListenSeconds: number
  dailyMap: Record<string, { read: number; listen: number }>
  booksOpened: string[]
}
