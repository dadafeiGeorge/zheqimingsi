import type {
  BookCatalogItem,
  ChapterContent,
  RadioCheckpoint,
  RadioQueueItem,
  RadioSettings,
  RadioState,
  RadioStation,
  TtsCacheStats,
  TtsVoice,
} from '../types'
import { ambientAudio } from './ambientAudio'
import { fetchBookMeta, fetchChapter, fetchCatalog } from './libraryApi'
import { getApiBase, getPlatform } from './platform'
import {
  getRadioBookProgress,
  loadRadioCheckpoint,
  loadRadioQueue,
  loadRadioSettings,
  recordStudySeconds,
  saveRadioCheckpoint,
  saveRadioSettings,
} from './storage'
import { resolveChapterFootnotes } from '../utils/inlineHighlights'

export const RADIO_STATIONS: RadioStation[] = [
  {
    id: 'current',
    freq: 'FM 88.5',
    name: '随书跟读台',
    subtitle: 'SYNCED READING',
    description: '与当前阅读章节实时同步，展开目录可随时点选任意章播报',
    accent: '#b4512a',
  },
  {
    id: 'classic',
    freq: 'FM 90.4',
    name: '古希腊与近代',
    subtitle: 'ANCIENT & EARLY MODERN',
    description: '斯退士希腊哲学与宗教三部曲、笛卡尔、莱布尼茨、洛克与哲学通史',
    accent: '#9a6b32',
  },
  {
    id: 'german',
    freq: 'FM 92.8',
    name: '德国古典原典',
    subtitle: 'GERMAN IDEALISM',
    description: '康德、费希特、谢林、黑格尔全系原著（含自然哲学）与逻辑学评注',
    accent: '#c68a30',
  },
  {
    id: 'marxism',
    freq: 'FM 95.2',
    name: '马克思与批判',
    subtitle: 'MARX & CRITICAL THEORY',
    description: '马克思、列宁、卢卡奇、法兰克福学派、阿尔都塞与解放心理学',
    accent: '#a63838',
  },
  {
    id: 'phenomenology',
    freq: 'FM 97.6',
    name: '现象学与存在',
    subtitle: 'HEIDEGGER & PHENOMENOLOGY',
    description: '海德格尔《德国观念论》、张汝伦《存在与时间》释义与现代西方哲学',
    accent: '#1d6b7a',
  },
  {
    id: 'postmodern',
    freq: 'FM 100.0',
    name: '精神分析后现代',
    subtitle: 'LACAN & POSTMODERN',
    description: '拉康、鲍德里亚、巴迪欧与齐泽克的精神分析与消费社会批判',
    accent: '#5b4b9e',
  },
  {
    id: 'chinese',
    freq: 'FM 102.4',
    name: '张世英全书台',
    subtitle: 'ZHANG SHIYING WORKS',
    description: '张世英先生文集全十卷精粹、哲学导论、天人之际与康德黑格尔精讲',
    accent: '#1f7a68',
  },
  {
    id: 'roam',
    freq: 'FM 104.8',
    name: '深夜哲思盲盒',
    subtitle: 'MIDNIGHT SERENDIPITY',
    description: '跨越全库全部非工具书典藏，不重复随机洗牌漫游播送',
    accent: '#276e54',
  },
  {
    id: 'queue',
    freq: 'FM 106.8',
    name: '私人节目单',
    subtitle: 'MY PLAYLIST',
    description: '按照你收藏编排的专属哲学章节播单顺序连播（自动去重）',
    accent: '#3b6d8c',
  },
]

export interface StationBookGroup {
  label: string
  books: BookCatalogItem[]
}

function isReferenceBook(b: BookCatalogItem): boolean {
  return b.category === '辞典与术语工具' || b.station === 'reference'
}

/** 严格去重并按专题电台精准分类，确保各专题电台合集互斥、零重复、不混入辞典工具书 */
export function getStationBookGroups(
  catalog: BookCatalogItem[],
  stationId: RadioStation['id'],
  activeBookId?: string | null,
  roamSeed = 0
): StationBookGroup[] {
  const uniqueMap = new Map<string, BookCatalogItem>()
  for (const b of catalog) {
    if (!uniqueMap.has(b.id)) uniqueMap.set(b.id, b)
  }
  const allUnique = Array.from(uniqueMap.values())
  const readable = allUnique.filter((b) => !isReferenceBook(b))

  if (stationId === 'classic') {
    const pool = readable.filter((b) => b.station === 'classic')
    const stace = pool.filter((b) => /斯退士/.test(b.author))
    const earlyModern = pool.filter((b) => /笛卡尔|莱布尼茨|洛克/.test(b.author))
    const used = new Set([...stace, ...earlyModern].map((b) => b.id))
    const intro = pool.filter((b) => !used.has(b.id))
    return [
      { label: '斯退士希腊哲学与现代心灵三部曲', books: stace },
      { label: '近代欧陆理性主义与经验主义', books: earlyModern },
      { label: '哲学通史与入门导览', books: intro },
    ].filter((g) => g.books.length > 0)
  }

  if (stationId === 'german') {
    const pool = readable.filter((b) => b.station === 'german')
    const kant = pool.filter((b) => /康德/.test(b.author))
    const hegel = pool.filter((b) => /黑格尔|斯退士|努佐|迪乔瓦尼|庄振华/.test(b.author) || /黑格尔|小逻辑/.test(b.title))
    const schelling = pool.filter((b) => /谢林|马修斯/.test(b.author) && !hegel.includes(b))
    const fichte = pool.filter(
      (b) => (/费希特|诺瓦利斯/.test(b.author) || /费希特/.test(b.title)) && !schelling.includes(b) && !hegel.includes(b)
    )
    const used = new Set([...kant, ...hegel, ...schelling, ...fichte].map((b) => b.id))
    const others = pool.filter((b) => !used.has(b.id))
    return [
      { label: '康德批判哲学', books: kant },
      { label: '黑格尔体系原典与研究评注', books: hegel },
      { label: '谢林哲学著作集', books: schelling },
      { label: '费希特与早期浪漫派', books: fichte },
      { label: '德国哲学研究论丛', books: others },
    ].filter((g) => g.books.length > 0)
  }

  if (stationId === 'marxism') {
    const pool = readable.filter((b) => b.station === 'marxism')
    const marxLenin = pool.filter((b) => /马克思|列宁/.test(b.author))
    const lukacs = pool.filter((b) => /卢卡奇/.test(b.author) && !/阿多诺/.test(b.author))
    const althusser = pool.filter((b) => /阿尔都塞/.test(b.author))
    const frankfurt = pool.filter((b) => /马尔库塞|阿多诺|霍克海默/.test(b.author))
    const used = new Set([...marxLenin, ...lukacs, ...althusser, ...frankfurt].map((b) => b.id))
    const liberation = pool.filter((b) => !used.has(b.id))
    return [
      { label: '马克思与列宁哲学原典', books: marxLenin },
      { label: '卢卡奇辩证法与本体论', books: lukacs },
      { label: '法兰克福学派与批判理论', books: frankfurt },
      { label: '阿尔都塞结构马克思主义', books: althusser },
      { label: '解放心理学与意识形态批判', books: liberation },
    ].filter((g) => g.books.length > 0)
  }

  if (stationId === 'phenomenology') {
    const pool = readable.filter((b) => b.station === 'phenomenology')
    const heidegger = pool.filter((b) => /海德格尔/.test(b.author) || /存在与时间/.test(b.title))
    const used = new Set(heidegger.map((b) => b.id))
    const rest = pool.filter((b) => !used.has(b.id))
    return [
      { label: '海德格尔原典与《存在与时间》释义', books: heidegger },
      { label: '张汝伦现代西方哲学与思辨文集', books: rest },
    ].filter((g) => g.books.length > 0)
  }

  if (stationId === 'postmodern') {
    const pool = readable.filter((b) => b.station === 'postmodern')
    const lacan = pool.filter((b) => /拉康|芬克|蒙卡约|托姆希奇/.test(b.author))
    const baudrillard = pool.filter((b) => /鲍德里亚|霍罗克斯/.test(b.author))
    const used = new Set([...lacan, ...baudrillard].map((b) => b.id))
    const zizekBadiou = pool.filter((b) => !used.has(b.id))
    return [
      { label: '拉康与精神分析研讨班', books: lacan },
      { label: '鲍德里亚拟像与消费社会', books: baudrillard },
      { label: '齐泽克与巴迪欧当代思辨', books: zizekBadiou },
    ].filter((g) => g.books.length > 0)
  }

  if (stationId === 'chinese') {
    const pool = readable.filter((b) => b.station === 'chinese' || b.category === '张世英哲学全书')
    const volumes = pool.filter((b) => /文集/.test(b.title))
    const used = new Set(volumes.map((b) => b.id))
    const intro = pool.filter((b) => !used.has(b.id) && /导论|哲学史/.test(b.title))
    intro.forEach((b) => used.add(b.id))
    const studies = pool.filter((b) => !used.has(b.id))
    return [
      { label: '《张世英文集》分卷精华', books: volumes },
      { label: '哲学导论与西方哲学通史', books: intro },
      { label: '康德·黑格尔精讲与译注', books: studies },
    ].filter((g) => g.books.length > 0)
  }

  if (stationId === 'roam') {
    const list = [...readable]
    let seed = (roamSeed + 1) * 2654435761
    for (let i = list.length - 1; i > 0; i--) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      const j = seed % (i + 1)
      const tmp = list[i]
      list[i] = list[j]
      list[j] = tmp
    }
    return [{ label: '全库经典不重复漫游队列', books: list }]
  }

  const groups: StationBookGroup[] = []
  const activeBook = activeBookId ? allUnique.find((b) => b.id === activeBookId) : undefined
  if (activeBook) {
    groups.push({ label: '当前随书播送', books: [activeBook] })
  }
  const rest = readable.filter((b) => b.id !== activeBook?.id)
  const buckets: Array<[string, BookCatalogItem[]]> = [
    ['古希腊与近代哲思', rest.filter((b) => b.station === 'classic')],
    ['德国古典原典', rest.filter((b) => b.station === 'german')],
    ['马克思与批判理论', rest.filter((b) => b.station === 'marxism')],
    ['现象学与存在哲学', rest.filter((b) => b.station === 'phenomenology')],
    ['精神分析与后现代', rest.filter((b) => b.station === 'postmodern')],
    ['张世英哲学全书', rest.filter((b) => b.station === 'chinese' || b.category === '张世英哲学全书')],
  ]
  for (const [label, list] of buckets) {
    if (list.length > 0) groups.push({ label, books: list })
  }
  return groups
}

export function getCuratedStationBooks(
  catalog: BookCatalogItem[],
  stationId: RadioStation['id'],
  activeBookId?: string | null,
  roamSeed = 0
): BookCatalogItem[] {
  const seen = new Set<string>()
  const out: BookCatalogItem[] = []
  for (const grp of getStationBookGroups(catalog, stationId, activeBookId, roamSeed)) {
    for (const b of grp.books) {
      if (!seen.has(b.id)) {
        seen.add(b.id)
        out.push(b)
      }
    }
  }
  return out
}

export const SYSTEM_TTS_VOICE_ID = 'system-tts'

export const CURATED_VOICES: TtsVoice[] = [
  { shortName: SYSTEM_TTS_VOICE_ID, label: '系统默认 TTS · 离线直读', gender: 'Female', locale: 'zh-CN', tag: '系统默认' },
  { shortName: 'zh-CN-YunyangNeural', label: '云扬 · 沉稳播音男声', gender: 'Male', locale: 'zh-CN', tag: '电台推荐' },
  { shortName: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 温润知性女声', gender: 'Female', locale: 'zh-CN', tag: '深夜伴读' },
  { shortName: 'zh-CN-YunjianNeural', label: '云健 · 浑厚磁性男声', gender: 'Male', locale: 'zh-CN', tag: '史诗哲思' },
  { shortName: 'zh-CN-YunxiNeural', label: '云希 · 清朗学者男声', gender: 'Male', locale: 'zh-CN', tag: '清晰自然' },
  { shortName: 'zh-CN-XiaoyiNeural', label: '晓伊 · 灵动叙事女声', gender: 'Female', locale: 'zh-CN', tag: '轻快细腻' },
  { shortName: 'zh-CN-YunxiaNeural', label: '云夏 · 清澈青年音', gender: 'Male', locale: 'zh-CN', tag: '清爽' },
  { shortName: 'zh-TW-HsiaoChenNeural', label: '晓臻 · 台湾知性女声', gender: 'Female', locale: 'zh-TW', tag: '温和' },
  { shortName: 'zh-TW-YunJheNeural', label: '云哲 · 台湾温润男声', gender: 'Male', locale: 'zh-TW', tag: '书卷气' },
  { shortName: 'zh-HK-HiuMaanNeural', label: '晓曼 · 粤语知性女声', gender: 'Female', locale: 'zh-HK', tag: '粤语' },
  { shortName: 'zh-HK-WanLungNeural', label: '云龙 · 粤语沉稳男声', gender: 'Male', locale: 'zh-HK', tag: '粤语' },
  { shortName: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北 · 东北风味女声', gender: 'Female', locale: 'zh-CN', tag: '方言' },
  { shortName: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮 · 陕西风味女声', gender: 'Female', locale: 'zh-CN', tag: '方言' },
]

interface SpeakSegment {
  blockIndex: number
  text: string
  isIntro?: boolean
}

type StateListener = (state: RadioState) => void

/**
 * 哲学电台总控引擎 v2：
 * - 全章连续进度轴 + 毫秒级断点续播（跨重启/跨书籍/跨锁屏自动保存与恢复）
 * - 零卡顿播放/暂停切换（状态机防竞态 + 缓存命中零闪烁 + 背景声景无重建暂停）
 * - 自动容错恢复（音频异常自动清缓存重试/降级，杜绝播一段突然停播）
 * - Android APK：委托原生 RadioForegroundService（WakeLock + WifiLock + 复用 AudioFocus + 原生离线切章）
 */
class PhilosophyRadioEngine {
  private listeners = new Set<StateListener>()
  private settings: RadioSettings = loadRadioSettings()
  private state: RadioState = {
    status: 'idle',
    errorMessage: null,
    stationId: 'current',
    bookId: null,
    bookTitle: '哲启明思电台',
    author: '微软神经网络语音',
    chapterIndex: 0,
    chapterTitle: '选择一本书或调频频道开始收听',
    blockIndex: 0,
    totalBlocks: 0,
    segmentIndex: 0,
    totalSegments: 0,
    currentText: '',
    currentTime: 0,
    duration: 0,
    chapterCurrentTime: 0,
    chapterDuration: 0,
    hasSavedCheckpoint: false,
    sleepEndAt: null,
    sleepAfterChapter: false,
    isNativeEngine: getPlatform() === 'android',
    isOfflineFallback: false,
  }

  private currentChapter: ChapterContent | null = null
  private segments: SpeakSegment[] = []
  private segmentDurations: number[] = []
  private segmentCursor = 0
  private playSessionId = 0
  private desiredPlaying = false
  private pendingAdvanceToNext = false
  private consecutiveErrors = 0
  private lastCheckpointSaveAt = 0

  // Desktop/Web audio & prefetch + offline speechSynthesis fallback
  private audioEl: HTMLAudioElement | null = null
  private analyser: AnalyserNode | null = null
  private mediaSourceConnected = false
  private blobCache = new Map<string, string>()
  private inflightFetch = new Map<string, Promise<string>>()
  private pauseTimeout: number | null = null
  private loadingDelayTimer: number | null = null
  private offlineProgressTimer: number | null = null
  private offlineWatchdogTimer: number | null = null
  private offlineSegStartedAt = 0
  private sleepCheckInterval: number | null = null
  private listenStatInterval: number | null = null
  private nativeFakeLevel = 0
  private offlineFallbackActive = false
  private speechUtterance: SpeechSynthesisUtterance | null = null
  private playedBooksByStation = new Map<string, Set<string>>()
  private roamSeed = Math.floor(Date.now() / 1000) % 99991
  private androidServiceRunning = false
  private androidPendingSeek: { segIdx: number; startTimeSec: number } | null = null

  public getRoamSeed(): number {
    return this.roamSeed
  }

  public reshuffleRoam(): number {
    this.roamSeed = (this.roamSeed + 17 + Math.floor(Math.random() * 997)) % 99991
    this.playedBooksByStation.delete('roam')
    return this.roamSeed
  }

  private markBookPlayed(stationId: string, bookId: string) {
    let set = this.playedBooksByStation.get(stationId)
    if (!set) {
      set = new Set<string>()
      this.playedBooksByStation.set(stationId, set)
    }
    set.add(bookId)
  }

  constructor() {
    this.setupAndroidBridgeListener()
    this.restoreCheckpointOnBoot()
    this.startBackgroundTimers()
    this.setupLifecycleHooks()
  }

  /* ---------- 断点续播恢复与持久化 ---------- */

  private restoreCheckpointOnBoot() {
    if (typeof window === 'undefined') return
    const localCp = loadRadioCheckpoint()

    if (getPlatform() === 'android' && window.AndroidBridge?.radioGetState) {
      try {
        const raw = window.AndroidBridge.radioGetState()
        if (raw) {
          const nativeState = JSON.parse(raw)
          if (nativeState && nativeState.bookId) {
            const nativeRunning = Boolean(nativeState.isRunning)
            const nativeUpdatedAt = Number(nativeState.updatedAt || 0)
            this.androidServiceRunning = nativeRunning
            if (nativeRunning || !localCp || nativeUpdatedAt >= (localCp.updatedAt || 0)) {
              const restoredStatus: RadioState['status'] = nativeRunning
                ? (nativeState.status || 'paused')
                : 'idle'
              this.applyRestoredMetadata({
                stationId: (nativeState.stationId as RadioStation['id']) || localCp?.stationId || 'current',
                bookId: nativeState.bookId,
                bookTitle: nativeState.bookTitle || localCp?.bookTitle || '哲启明思电台',
                author: nativeState.author || localCp?.author || '',
                chapterIndex: Number(nativeState.chapterIndex ?? 0),
                chapterTitle: nativeState.chapterTitle || localCp?.chapterTitle || '',
                blockIndex: Number(nativeState.blockIndex ?? 0),
                totalBlocks: Number(nativeState.totalBlocks ?? localCp?.totalBlocks ?? 0),
                segmentIndex: Number(nativeState.segmentIndex ?? 0),
                totalSegments: Number(nativeState.totalSegments ?? localCp?.totalSegments ?? 0),
                segmentTime: Number(nativeState.currentTime ?? 0),
                segmentDuration: Number(nativeState.duration ?? 0),
                chapterCurrentTime: Number(localCp?.chapterCurrentTime ?? 0),
                chapterDuration: Number(localCp?.chapterDuration ?? 0),
                currentText: nativeState.text || localCp?.currentText || '',
                updatedAt: nativeUpdatedAt || Date.now(),
              }, restoredStatus, Boolean(nativeState.isOfflineFallback))
              this.hydrateChapterSegmentsInBackground(nativeState.bookId, Number(nativeState.chapterIndex ?? 0))
              return
            }
          }
        }
      } catch {}
    }

    if (localCp) {
      this.applyRestoredMetadata(localCp, 'idle', false)
      this.hydrateChapterSegmentsInBackground(localCp.bookId, localCp.chapterIndex)
    }
  }

  private applyRestoredMetadata(cp: RadioCheckpoint, status: RadioState['status'], isOffline: boolean) {
    this.segmentCursor = Math.max(0, cp.segmentIndex || 0)
    this.desiredPlaying = status === 'playing' || status === 'loading'
    this.nativeFakeLevel = status === 'playing' ? 0.72 : 0
    this.state = {
      ...this.state,
      status,
      errorMessage: null,
      stationId: cp.stationId || 'current',
      bookId: cp.bookId,
      bookTitle: cp.bookTitle || '哲启明思电台',
      author: cp.author || '',
      chapterIndex: cp.chapterIndex || 0,
      chapterTitle: cp.chapterTitle || '',
      blockIndex: cp.blockIndex || 0,
      totalBlocks: cp.totalBlocks || 0,
      segmentIndex: Math.max(0, cp.segmentIndex || 0),
      totalSegments: cp.totalSegments || 0,
      currentText: cp.currentText || '',
      currentTime: Math.max(0, cp.segmentTime || 0),
      duration: Math.max(0, cp.segmentDuration || 0),
      chapterCurrentTime: Math.max(0, cp.chapterCurrentTime || 0),
      chapterDuration: Math.max(0, cp.chapterDuration || 0),
      hasSavedCheckpoint: true,
      isOfflineFallback: isOffline,
    }
  }

  /** 启动恢复或后台切章后，静默补全章节段落数据，确保进度条与字幕立刻可用 */
  private async hydrateChapterSegmentsInBackground(bookId: string, chapterIndex: number) {
    try {
      const [meta, chapter] = await Promise.all([fetchBookMeta(bookId), fetchChapter(bookId, chapterIndex)])
      if (this.state.bookId !== bookId || this.state.chapterIndex !== chapterIndex) return
      this.currentChapter = chapter
      const segs = this.buildSegments(chapter, this.settings.announceChapter, meta.title)
      if (segs.length === 0) return
      this.segments = segs
      this.initSegmentDurations(segs)
      this.segmentCursor = Math.max(0, Math.min(this.segmentCursor, segs.length - 1))
      const curSeg = segs[this.segmentCursor]
      this.state.totalBlocks = chapter.blocks.length
      this.state.totalSegments = segs.length
      this.state.segmentIndex = this.segmentCursor
      if (curSeg) {
        this.state.blockIndex = curSeg.blockIndex
        if (!this.state.currentText) this.state.currentText = curSeg.text
      }
      if (this.state.duration > 0 && this.segmentDurations[this.segmentCursor]) {
        this.segmentDurations[this.segmentCursor] = this.state.duration + this.settings.paraPauseMs / 1000
      }
      this.recomputeChapterProgress(this.state.currentTime)
      this.emit()
    } catch {}
  }

  private persistCheckpoint(force = false) {
    if (!this.state.bookId) return
    const now = Date.now()
    if (!force && now - this.lastCheckpointSaveAt < 2500) return
    this.lastCheckpointSaveAt = now
    saveRadioCheckpoint({
      stationId: this.state.stationId,
      bookId: this.state.bookId,
      bookTitle: this.state.bookTitle,
      author: this.state.author,
      chapterIndex: this.state.chapterIndex,
      chapterTitle: this.state.chapterTitle,
      blockIndex: this.state.blockIndex,
      totalBlocks: this.state.totalBlocks,
      segmentIndex: this.segmentCursor,
      totalSegments: this.segments.length || this.state.totalSegments,
      segmentTime: this.state.currentTime || 0,
      segmentDuration: this.state.duration || 0,
      chapterCurrentTime: this.state.chapterCurrentTime || 0,
      chapterDuration: this.state.chapterDuration || 0,
      currentText: this.state.currentText || '',
      updatedAt: now,
    })
  }

  public getSavedBookCheckpoint(bookId: string): RadioCheckpoint | null {
    return getRadioBookProgress(bookId)
  }

  private setupLifecycleHooks() {
    if (typeof window === 'undefined') return
    const flush = () => this.persistCheckpoint(true)
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.persistCheckpoint(true)
      } else if (document.visibilityState === 'visible' && getPlatform() === 'android') {
        this.syncFromAndroidService()
      }
    })
  }

  /** Android 从后台/息屏切回前台时，实时拉取原生服务最新章节与段落进度 */
  public syncFromAndroidService() {
    if (getPlatform() !== 'android' || !window.AndroidBridge?.radioGetState) return
    try {
      const raw = window.AndroidBridge.radioGetState()
      if (!raw) return
      const ns = JSON.parse(raw)
      if (!ns || !ns.bookId) return
      this.androidServiceRunning = Boolean(ns.isRunning)
      const chapterChanged = ns.bookId !== this.state.bookId || Number(ns.chapterIndex) !== this.state.chapterIndex
      const segIdx = typeof ns.segmentIndex === 'number' ? ns.segmentIndex : this.segmentCursor
      this.segmentCursor = Math.max(0, segIdx)
      const curTime = typeof ns.currentTime === 'number' ? ns.currentTime : this.state.currentTime
      const dur = typeof ns.duration === 'number' ? ns.duration : this.state.duration
      if (dur > 0 && this.segmentDurations[this.segmentCursor]) {
        this.segmentDurations[this.segmentCursor] = dur + this.settings.paraPauseMs / 1000
      }

      const nextStatus: RadioState['status'] = ns.isRunning
        ? (ns.status || this.state.status)
        : (this.state.status === 'playing' || this.state.status === 'loading' ? 'paused' : this.state.status)

      this.desiredPlaying = nextStatus === 'playing' || nextStatus === 'loading'
      this.nativeFakeLevel = nextStatus === 'playing' ? 0.72 : 0
      this.state = {
        ...this.state,
        status: nextStatus,
        bookId: ns.bookId,
        bookTitle: ns.bookTitle || this.state.bookTitle,
        author: ns.author || this.state.author,
        chapterIndex: Number(ns.chapterIndex ?? this.state.chapterIndex),
        chapterTitle: ns.chapterTitle || this.state.chapterTitle,
        blockIndex: typeof ns.blockIndex === 'number' ? ns.blockIndex : this.state.blockIndex,
        totalBlocks: Number(ns.totalBlocks || this.state.totalBlocks),
        segmentIndex: this.segmentCursor,
        totalSegments: Number(ns.totalSegments || this.segments.length || this.state.totalSegments),
        currentText: ns.text || this.state.currentText,
        currentTime: curTime,
        duration: dur,
        isOfflineFallback: Boolean(ns.isOfflineFallback),
        hasSavedCheckpoint: true,
      }
      if (chapterChanged) {
        this.hydrateChapterSegmentsInBackground(ns.bookId, Number(ns.chapterIndex ?? 0))
      } else {
        this.recomputeChapterProgress(curTime)
      }
      this.persistCheckpoint(true)
      this.emit()
    } catch {}
  }

  /* ---------- 全章进度轴计算（微软语音 & 系统本地 TTS 通用） ---------- */

  private estimateSegmentSec(text: string): number {
    const rate = Math.max(0.5, Math.min(2.0, this.settings.rate || 1.0))
    const chars = Math.max(1, text.replace(/\s+/g, '').length)
    return Math.max(1.2, chars / (4.35 * rate))
  }

  private initSegmentDurations(segs: SpeakSegment[]) {
    const pauseSec = (this.settings.paraPauseMs || 520) / 1000
    this.segmentDurations = segs.map((s) => this.estimateSegmentSec(s.text) + pauseSec)
  }

  private recomputeChapterProgress(currentSegTimeSec = 0) {
    if (this.segmentDurations.length === 0) {
      this.state.chapterDuration = Math.max(this.state.chapterDuration || 0, this.state.duration || 0)
      this.state.chapterCurrentTime = Math.min(
        this.state.chapterDuration,
        Math.max(0, currentSegTimeSec || this.state.currentTime || 0)
      )
      return
    }
    let total = 0
    let before = 0
    for (let i = 0; i < this.segmentDurations.length; i++) {
      const d = this.segmentDurations[i]
      if (i < this.segmentCursor) before += d
      total += d
    }
    const curSlot = this.segmentDurations[this.segmentCursor] || 1
    const clampedSegTime = Math.max(0, Math.min(curSlot, currentSegTimeSec))
    this.state.chapterDuration = total
    this.state.chapterCurrentTime = Math.min(total, before + clampedSegTime)
    this.state.segmentIndex = this.segmentCursor
    this.state.totalSegments = this.segments.length
  }

  private setupAndroidBridgeListener() {
    if (typeof window === 'undefined') return
    ;(window as any).__syncAndroidRadioState = () => {
      this.syncFromAndroidService()
    }
    window.__onAndroidRadioEvent = (ev: any) => {
      if (!ev || typeof ev !== 'object') return
      if (ev.type === 'state') {
        const prevStatus = this.state.status
        const segIdx = typeof ev.segmentIndex === 'number' ? ev.segmentIndex : this.segmentCursor
        const segChanged = segIdx !== this.segmentCursor
        this.segmentCursor = Math.max(0, segIdx)
        this.androidServiceRunning = ev.status !== 'idle'

        const nextStatus: RadioState['status'] = ev.status || this.state.status
        this.desiredPlaying = nextStatus === 'playing' || nextStatus === 'loading'

        const curTime = typeof ev.currentTime === 'number' ? ev.currentTime : this.state.currentTime
        const dur = typeof ev.duration === 'number' ? ev.duration : this.state.duration
        if (dur > 0 && this.segmentCursor < this.segmentDurations.length) {
          this.segmentDurations[this.segmentCursor] = dur + (this.settings.paraPauseMs || 520) / 1000
        }

        this.state = {
          ...this.state,
          status: nextStatus,
          errorMessage: ev.error || null,
          blockIndex: typeof ev.blockIndex === 'number' ? ev.blockIndex : this.state.blockIndex,
          segmentIndex: this.segmentCursor,
          totalSegments: typeof ev.totalSegments === 'number' && ev.totalSegments > 0
            ? ev.totalSegments
            : this.segments.length || this.state.totalSegments,
          currentText: typeof ev.text === 'string' && ev.text ? ev.text : this.state.currentText,
          currentTime: curTime,
          duration: dur,
          isOfflineFallback: Boolean(ev.isOfflineFallback),
          hasSavedCheckpoint: Boolean(this.state.bookId),
        }

        // 若系统 TTS 正在播报（duration === 0），前端估算当前段内进度以保持进度条顺滑推进
        if (nextStatus === 'playing' && this.state.isOfflineFallback && dur <= 0) {
          if (segChanged || prevStatus !== 'playing') {
            this.startOfflineProgressTicker(this.segmentCursor, curTime)
          }
        } else {
          this.stopOfflineProgressTicker()
        }

        this.recomputeChapterProgress(curTime)
        this.nativeFakeLevel = nextStatus === 'playing' ? 0.72 : 0
        if (prevStatus !== this.state.status) {
          this.syncAmbientWithPlayback()
        }
        this.persistCheckpoint(segChanged || nextStatus === 'paused' || nextStatus === 'idle')
        this.emit()
      } else if (ev.type === 'chapterChanged') {
        // Android 原生服务在息屏/后台自动切入下一章后，实时同步回前端状态与字幕
        const bookId = ev.bookId || this.state.bookId
        const chapterIndex = Number(ev.chapterIndex ?? this.state.chapterIndex)
        this.segmentCursor = Number(ev.segmentIndex ?? 0)
        this.state = {
          ...this.state,
          bookId,
          bookTitle: ev.bookTitle || this.state.bookTitle,
          author: ev.author || this.state.author,
          chapterIndex,
          chapterTitle: ev.chapterTitle || this.state.chapterTitle,
          blockIndex: Number(ev.blockIndex ?? 0),
          totalBlocks: Number(ev.totalBlocks ?? 0),
          segmentIndex: this.segmentCursor,
          totalSegments: Number(ev.totalSegments ?? 0),
          currentText: ev.text || '',
          currentTime: 0,
          duration: 0,
          chapterCurrentTime: 0,
          chapterDuration: 0,
          hasSavedCheckpoint: true,
        }
        if (bookId) {
          this.hydrateChapterSegmentsInBackground(bookId, chapterIndex)
        }
        this.persistCheckpoint(true)
        this.emit()
      } else if (ev.type === 'chapterComplete') {
        if (this.state.sleepAfterChapter) {
          this.stop()
          return
        }
        this.nextChapterOrStationTrack()
      } else if (ev.type === 'command') {
        if (ev.action === 'next') this.nextChapterOrStationTrack()
        else if (ev.action === 'prev') this.prevSegmentOrChapter()
      } else if (ev.type === 'sleepTriggered') {
        this.state.sleepEndAt = null
        this.state.sleepAfterChapter = false
        this.emit()
      }
    }
  }

  private startBackgroundTimers() {
    if (typeof window === 'undefined') return
    this.sleepCheckInterval = window.setInterval(() => {
      if (this.state.sleepEndAt && Date.now() >= this.state.sleepEndAt && this.state.status === 'playing') {
        this.fadeOutAndPause()
      }
    }, 1000)

    this.listenStatInterval = window.setInterval(() => {
      if (this.state.status === 'playing') {
        recordStudySeconds('listen', 5, this.state.bookId || undefined)
        this.persistCheckpoint(false)
      }
    }, 5000)
  }

  public subscribe(fn: StateListener): () => void {
    this.listeners.add(fn)
    fn({ ...this.state })
    return () => this.listeners.delete(fn)
  }

  private emit() {
    const snap = { ...this.state }
    this.listeners.forEach((fn) => fn(snap))
  }

  public getState(): RadioState {
    return { ...this.state }
  }

  public getSettings(): RadioSettings {
    return { ...this.settings }
  }

  public updateSettings(partial: Partial<RadioSettings>) {
    const prevVoice = this.settings.voice
    const prevRate = this.settings.rate
    const prevPitch = this.settings.pitch
    this.settings = { ...this.settings, ...partial }
    saveRadioSettings(this.settings)

    if (this.audioEl) {
      this.audioEl.volume = this.settings.volume
    }
    if (prevRate !== this.settings.rate && this.segments.length > 0) {
      this.initSegmentDurations(this.segments)
      this.recomputeChapterProgress(this.state.currentTime)
      this.emit()
    }
    this.syncAmbientWithPlayback()

    if (getPlatform() === 'android' && window.AndroidBridge) {
      window.AndroidBridge.radioUpdateConfig(JSON.stringify(this.settings))
    }

    if (
      (prevVoice !== this.settings.voice || prevRate !== this.settings.rate || prevPitch !== this.settings.pitch) &&
      this.state.status === 'playing' &&
      getPlatform() !== 'android'
    ) {
      this.clearBlobCache()
      this.playSessionId++
      this.playSegmentAt(this.segmentCursor, this.playSessionId, 0)
    }
  }

  private syncAmbientWithPlayback() {
    // 桌面端同步系统电源防休眠锁，避免锁屏或最小化后 JS 定时器休眠导致停播
    try {
      window.electronAPI?.setRadioActive?.(this.state.status === 'playing' || this.state.status === 'loading')
    } catch {}

    // Android 端由原生 RadioForegroundService 的 NativeAmbientPlayer 混音（息屏锁屏不中断）
    if (getPlatform() === 'android') {
      ambientAudio.stopAmbient()
      return
    }
    if (this.settings.ambientSound === 'none') {
      ambientAudio.stopAmbient()
      return
    }
    if (this.state.status === 'playing' || (this.state.status === 'loading' && this.desiredPlaying)) {
      ambientAudio.startAmbient(this.settings.ambientSound, this.settings.ambientVolume)
    } else if (this.state.status === 'paused') {
      // 暂停时仅静音保留噪声管线，恢复零延迟无卡顿
      ambientAudio.pauseAmbient()
    } else {
      ambientAudio.stopAmbient()
    }
  }

  private cancelSpeechFallback() {
    this.offlineFallbackActive = false
    this.stopOfflineProgressTicker()
    if (this.offlineWatchdogTimer !== null) {
      window.clearTimeout(this.offlineWatchdogTimer)
      this.offlineWatchdogTimer = null
    }
    if (this.speechUtterance) {
      this.speechUtterance.onend = null
      this.speechUtterance.onerror = null
      this.speechUtterance = null
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
      } catch {}
    }
  }

  private startOfflineProgressTicker(segIdx: number, initialOffsetSec = 0) {
    this.stopOfflineProgressTicker()
    const seg = this.segments[segIdx]
    const estDur = seg ? this.estimateSegmentSec(seg.text) : Math.max(4, this.state.duration || 8)
    this.offlineSegStartedAt = Date.now() - initialOffsetSec * 1000
    this.state.duration = estDur
    this.offlineProgressTimer = window.setInterval(() => {
      if (this.state.status !== 'playing') return
      const elapsed = Math.min(estDur * 0.96, (Date.now() - this.offlineSegStartedAt) / 1000)
      this.state.currentTime = elapsed
      this.state.duration = estDur
      this.recomputeChapterProgress(elapsed)
      this.emit()
    }, 250)
  }

  private stopOfflineProgressTicker() {
    if (this.offlineProgressTimer !== null) {
      window.clearInterval(this.offlineProgressTimer)
      this.offlineProgressTimer = null
    }
  }

  public setSleepTimer(minutes: number | null, afterChapter = false) {
    this.state.sleepAfterChapter = afterChapter
    this.state.sleepEndAt = minutes ? Date.now() + minutes * 60 * 1000 : null
    if (getPlatform() === 'android' && window.AndroidBridge?.radioSetSleepTimer) {
      window.AndroidBridge.radioSetSleepTimer(this.state.sleepEndAt || 0, afterChapter)
    }
    this.emit()
  }

  private fadeOutAndPause() {
    this.state.sleepEndAt = null
    this.state.sleepAfterChapter = false
    if (getPlatform() === 'android' && window.AndroidBridge?.radioSetSleepTimer) {
      window.AndroidBridge.radioSetSleepTimer(0, false)
    }
    if (this.audioEl && this.state.status === 'playing' && getPlatform() !== 'android') {
      const startVol = this.audioEl.volume
      let step = 0
      const timer = window.setInterval(() => {
        step++
        if (!this.audioEl || step >= 10) {
          window.clearInterval(timer)
          this.pause()
          if (this.audioEl) this.audioEl.volume = startVol
        } else {
          this.audioEl.volume = Math.max(0, startVol * (1 - step / 10))
        }
      }, 250)
    } else {
      this.pause()
    }
  }

  private isFrontMatterTitle(title: string): boolean {
    const t = title.replace(/[\s　·\-—:：()（）\[\]【】]/g, '').toLowerCase()
    return (
      /^(目录|目次|总目录|凡例|版权|版权页|版权信息|出版说明|缩写|缩写索引|索引|致谢|鸣谢|封面|书名|书名页|扉页|contents|tableofcontents|index|abbreviations|acknowledgements?|copyright)$/.test(
        t
      ) ||
      t.startsWith('目录') ||
      t.startsWith('目次') ||
      t.startsWith('总目录')
    )
  }

  private pickPlayableChapterIndex(
    meta: { chapters: Array<{ index: number; title: string; charCount: number; isFrontMatter?: boolean }>; firstBodyChapter?: number },
    requestedIndex: number,
    allowFrontMatter: boolean
  ): number {
    if (allowFrontMatter) return requestedIndex
    const cur = meta.chapters[requestedIndex]
    const isFront = !cur || cur.isFrontMatter || this.isFrontMatterTitle(cur.title) || cur.charCount < 80
    if (!isFront) return requestedIndex

    for (let i = requestedIndex; i < meta.chapters.length; i++) {
      const ch = meta.chapters[i]
      if (!ch.isFrontMatter && !this.isFrontMatterTitle(ch.title) && ch.charCount >= 80) {
        return ch.index
      }
    }
    if (typeof meta.firstBodyChapter === 'number' && meta.chapters[meta.firstBodyChapter]) {
      return meta.firstBodyChapter
    }
    return requestedIndex
  }

  private isTocLine(raw: string): boolean {
    const s = raw.trim()
    if (!s) return true
    if (/[·…\.]{4,}\s*\d+$/.test(s)) return true
    if (/^\d+(\.\d+)*\s*$/.test(s)) return true
    return false
  }

  /** 将长段落智能切分为自然短句（<= 160 字），确保全章段索引确定一致（断点续播零偏移） */
  private buildSegments(chapter: ChapterContent, includeIntro: boolean, bookTitle: string): SpeakSegment[] {
    const segs: SpeakSegment[] = []
    if (includeIntro) {
      segs.push({
        blockIndex: 0,
        text: `欢迎收听哲启明思电台。接下来为您播送《${bookTitle}》，${chapter.title}。`,
        isIntro: true,
      })
    }

    const resolvedFn = resolveChapterFootnotes(chapter.blocks)

    for (let i = 0; i < chapter.blocks.length; i++) {
      const b = chapter.blocks[i]
      if (resolvedFn.hiddenBlockIndices.has(b.index)) continue
      const raw = (b.speakText || '').trim()
      if (!raw || raw.length < 2 || this.isTocLine(raw)) continue
      if (raw.length <= 160) {
        segs.push({ blockIndex: b.index, text: raw })
      } else {
        const pieces = raw.match(/[^。！？；.!?;]+[。！？；.!?;]?/g) || [raw]
        let buf = ''
        for (const p of pieces) {
          if (p.length > 160) {
            if (buf.trim()) {
              segs.push({ blockIndex: b.index, text: buf.trim() })
              buf = ''
            }
            const subPieces = p.match(/[^，,、：:]+[，,、：:]?/g) || [p]
            for (const sp of subPieces) {
              if ((buf + sp).length > 150 && buf.length > 0) {
                segs.push({ blockIndex: b.index, text: buf.trim() })
                buf = sp
              } else {
                buf += sp
              }
            }
          } else if ((buf + p).length > 150 && buf.length > 0) {
            segs.push({ blockIndex: b.index, text: buf.trim() })
            buf = p
          } else {
            buf += p
          }
        }
        if (buf.trim()) segs.push({ blockIndex: b.index, text: buf.trim() })
      }
    }
    return segs
  }

  /** 按书籍智能续播（若该书存在电台断点则无缝续播，否则从正文首章开始） */
  public async playBookWithResume(
    bookId: string,
    fallbackChapterIndex = 0,
    stationId: RadioStation['id'] = 'current'
  ) {
    const saved = getRadioBookProgress(bookId)
    if (saved) {
      await this.playChapter(bookId, saved.chapterIndex, saved.blockIndex, stationId, {
        allowFrontMatter: true,
        startSegmentIndex: saved.segmentIndex,
        startTimeSec: saved.segmentTime,
      })
      return
    }
    await this.playChapter(bookId, fallbackChapterIndex, 0, stationId)
  }

  /** 从指定书籍/章节/段落启动电台播报（支持精确 segmentIndex + startTimeSec 断点续播） */
  public async playChapter(
    bookId: string,
    chapterIndex: number,
    startBlockIndex = 0,
    stationId: RadioStation['id'] = 'current',
    opts?: { allowFrontMatter?: boolean; startSegmentIndex?: number; startTimeSec?: number }
  ) {
    this.playSessionId++
    const sessionId = this.playSessionId
    this.desiredPlaying = true
    this.pendingAdvanceToNext = false
    this.androidPendingSeek = null
    this.consecutiveErrors = 0
    this.clearPauseTimer()
    this.clearLoadingDelayTimer()
    this.cancelSpeechFallback()
    if (this.audioEl) {
      try {
        this.audioEl.pause()
      } catch {}
    }

    this.state = {
      ...this.state,
      status: 'loading',
      errorMessage: null,
      stationId,
      bookId,
      chapterIndex,
      blockIndex: startBlockIndex,
    }
    this.emit()

    try {
      const meta = await fetchBookMeta(bookId)
      if (sessionId !== this.playSessionId || !this.desiredPlaying) return

      const effectiveChapterIndex = this.pickPlayableChapterIndex(
        meta,
        chapterIndex,
        Boolean(opts?.allowFrontMatter || startBlockIndex > 0 || (opts?.startSegmentIndex ?? 0) > 0)
      )
      const effectiveBlockIndex = effectiveChapterIndex === chapterIndex ? startBlockIndex : 0

      const chapter = await fetchChapter(bookId, effectiveChapterIndex)
      if (sessionId !== this.playSessionId || !this.desiredPlaying) return

      this.currentChapter = chapter
      const segs = this.buildSegments(chapter, this.settings.announceChapter, meta.title)
      if (segs.length === 0) {
        this.state.chapterIndex = effectiveChapterIndex
        this.nextChapterOrStationTrack()
        return
      }

      let startSegIdx: number
      if (typeof opts?.startSegmentIndex === 'number' && opts.startSegmentIndex >= 0 && opts.startSegmentIndex < segs.length) {
        startSegIdx = opts.startSegmentIndex
      } else {
        startSegIdx = segs.findIndex((s) => !s.isIntro && s.blockIndex >= effectiveBlockIndex)
        if (effectiveBlockIndex === 0 && segs[0]?.isIntro) startSegIdx = 0
        if (startSegIdx < 0) startSegIdx = 0
      }

      const startTimeSec = Math.max(0, Number(opts?.startTimeSec || 0))
      this.segments = segs
      this.initSegmentDurations(segs)
      this.segmentCursor = startSegIdx

      this.state = {
        ...this.state,
        bookId,
        bookTitle: meta.title,
        author: meta.author,
        chapterIndex: effectiveChapterIndex,
        chapterTitle: chapter.title,
        blockIndex: segs[startSegIdx].blockIndex,
        totalBlocks: chapter.blocks.length,
        segmentIndex: startSegIdx,
        totalSegments: segs.length,
        currentText: segs[startSegIdx].text,
        currentTime: startTimeSec,
        duration: this.estimateSegmentSec(segs[startSegIdx].text),
        errorMessage: null,
        hasSavedCheckpoint: true,
      }
      this.recomputeChapterProgress(startTimeSec)
      this.persistCheckpoint(true)
      this.emit()

      if (getPlatform() === 'android' && window.AndroidBridge) {
        this.androidServiceRunning = true
        const queue = stationId === 'queue' ? loadRadioQueue() : []
        const payload = {
          stationId,
          bookId,
          bookTitle: meta.title,
          author: meta.author,
          chapterIndex: effectiveChapterIndex,
          chapterCount: meta.chapterCount,
          chapterTitle: chapter.title,
          totalBlocks: chapter.blocks.length,
          startIndex: startSegIdx,
          startTimeSec,
          sleepEndAt: this.state.sleepEndAt || 0,
          sleepAfterChapter: this.state.sleepAfterChapter,
          announceChapter: this.settings.announceChapter,
          queue,
          segments: segs,
          config: this.settings,
        }
        window.AndroidBridge.radioPlayTrack(JSON.stringify(payload))
        return
      }

      await this.playSegmentAt(startSegIdx, sessionId, startTimeSec)
    } catch (err: any) {
      if (sessionId !== this.playSessionId) return
      this.desiredPlaying = false
      this.state.status = 'error'
      this.state.errorMessage = err?.message || '章节加载失败'
      this.syncAmbientWithPlayback()
      this.emit()
    }
  }

  /** 切换电台频道并自动选播节目 */
  public async tuneStation(stationId: RadioStation['id']) {
    ambientAudio.playTuningChime()
    this.state.stationId = stationId
    this.emit()

    if (stationId === 'current') {
      if (this.state.bookId) {
        this.playChapter(this.state.bookId, this.state.chapterIndex, this.state.blockIndex, 'current', {
          allowFrontMatter: true,
          startSegmentIndex: this.segmentCursor,
          startTimeSec: this.state.currentTime,
        })
        return
      }
    }

    if (stationId === 'queue') {
      const queue = loadRadioQueue()
      if (queue.length > 0) {
        const first = queue[0]
        await this.playChapter(first.bookId, first.chapterIndex, 0, 'queue', { allowFrontMatter: true })
        return
      }
    }

    const catalog = await fetchCatalog()
    const pool = getCuratedStationBooks(catalog, stationId, this.state.bookId, this.roamSeed)
    if (pool.length === 0) return

    const played = this.playedBooksByStation.get(stationId) || new Set<string>()
    let unplayed = pool.filter((b) => !played.has(b.id) && b.id !== this.state.bookId)
    if (unplayed.length === 0) {
      this.playedBooksByStation.delete(stationId)
      unplayed = pool.filter((b) => b.id !== this.state.bookId)
      if (unplayed.length === 0) unplayed = pool
    }

    const chosen = unplayed[Math.floor(Math.random() * unplayed.length)]
    if (!chosen) return
    this.markBookPlayed(stationId, chosen.id)

    const meta = await fetchBookMeta(chosen.id)
    const bodyChapters = meta.chapters.filter(
      (c) => !c.isFrontMatter && !this.isFrontMatterTitle(c.title) && c.charCount >= 80
    )
    const fallbackBody = meta.chapters.filter((c) => !c.isFrontMatter && !this.isFrontMatterTitle(c.title))
    const candidates = bodyChapters.length > 0 ? bodyChapters : fallbackBody.length > 0 ? fallbackBody : meta.chapters
    const pickedCh = candidates[0]

    await this.playChapter(chosen.id, pickedCh ? pickedCh.index : 0, 0, stationId)
  }

  public jumpToBlock(blockIndex: number) {
    if (!this.state.bookId) return
    if (!this.currentChapter || !this.segments.length) {
      this.playChapter(this.state.bookId, this.state.chapterIndex, blockIndex, this.state.stationId, {
        allowFrontMatter: true,
      })
      return
    }
    const segIdx = this.segments.findIndex((s) => !s.isIntro && s.blockIndex >= blockIndex)
    if (segIdx < 0) return
    // 若用户点击的正是当前正在播报的段落，绝不打断/暂停当前播放
    if (segIdx === this.segmentCursor && this.state.status === 'playing') {
      return
    }
    this.jumpToSegment(segIdx, 0, true)
  }

  private jumpToSegment(segIdx: number, startTimeSec = 0, forcePlay = false) {
    if (!this.segments.length) return
    const clampedIdx = Math.max(0, Math.min(this.segments.length - 1, segIdx))
    const seg = this.segments[clampedIdx]
    const shouldPlay = forcePlay || this.state.status === 'playing' || this.state.status === 'loading'

    this.segmentCursor = clampedIdx
    this.pendingAdvanceToNext = false
    this.state.blockIndex = seg.blockIndex
    this.state.segmentIndex = clampedIdx
    this.state.currentText = seg.text
    this.state.currentTime = startTimeSec
    this.recomputeChapterProgress(startTimeSec)
    this.persistCheckpoint(true)

    if (!shouldPlay) {
      // 暂停或待机状态下拖动进度条：静默定位断点，点播放即从新位置续播
      if (getPlatform() === 'android') {
        this.androidPendingSeek = { segIdx: clampedIdx, startTimeSec }
      }
      if (this.audioEl) {
        try {
          this.audioEl.pause()
          this.audioEl.removeAttribute('src')
        } catch {}
      }
      this.emit()
      return
    }

    this.desiredPlaying = true
    this.androidPendingSeek = null
    if (getPlatform() === 'android' && window.AndroidBridge) {
      if (!this.androidServiceRunning && this.state.bookId) {
        this.playChapter(this.state.bookId, this.state.chapterIndex, seg.blockIndex, this.state.stationId, {
          allowFrontMatter: true,
          startSegmentIndex: clampedIdx,
          startTimeSec,
        })
        return
      }
      if (startTimeSec > 0.1 && window.AndroidBridge.radioJumpToSegmentWithTime) {
        window.AndroidBridge.radioJumpToSegmentWithTime(clampedIdx, startTimeSec)
      } else {
        window.AndroidBridge.radioJumpBlock(clampedIdx)
      }
      this.emit()
      return
    }

    this.playSessionId++
    this.playSegmentAt(clampedIdx, this.playSessionId, startTimeSec)
  }

  public togglePlayPause() {
    if (this.state.status === 'playing' || this.state.status === 'loading') {
      this.pause()
    } else if (this.state.status === 'paused') {
      this.resume()
    } else if (this.state.bookId) {
      this.playChapter(this.state.bookId, this.state.chapterIndex, this.state.blockIndex, this.state.stationId, {
        allowFrontMatter: true,
        startSegmentIndex: this.segmentCursor,
        startTimeSec: this.state.currentTime,
      })
    } else {
      this.tuneStation('roam')
    }
  }

  public pause() {
    this.desiredPlaying = false
    const wasLoading = this.state.status === 'loading'
    if (wasLoading) {
      // 立即废止在途拉取/prepare，杜绝“刚点暂停却突然自动开播”
      this.playSessionId++
    }
    const hadPendingPauseGap = this.pauseTimeout !== null
    this.clearPauseTimer()
    this.clearLoadingDelayTimer()
    this.stopOfflineProgressTicker()

    if (hadPendingPauseGap) {
      this.pendingAdvanceToNext = true
    }

    if (getPlatform() === 'android' && window.AndroidBridge) {
      window.AndroidBridge.radioPause()
    } else if (this.offlineFallbackActive) {
      this.cancelSpeechFallback()
    } else if (this.audioEl) {
      try {
        if (this.audioEl.ended) {
          this.pendingAdvanceToNext = true
        }
        this.audioEl.pause()
      } catch {}
    }

    this.state.status = 'paused'
    this.nativeFakeLevel = 0
    this.syncAmbientWithPlayback()
    this.persistCheckpoint(true)
    this.emit()
  }

  public resume() {
    this.desiredPlaying = true
    ambientAudio.ensureRunning()

    if (getPlatform() === 'android' && window.AndroidBridge) {
      if (!this.androidServiceRunning && this.state.bookId) {
        this.androidPendingSeek = null
        this.playChapter(this.state.bookId, this.state.chapterIndex, this.state.blockIndex, this.state.stationId, {
          allowFrontMatter: true,
          startSegmentIndex: this.segmentCursor,
          startTimeSec: this.state.currentTime,
        })
        return
      }
      const pending = this.androidPendingSeek
      this.androidPendingSeek = null
      this.state.status = 'playing'
      this.nativeFakeLevel = 0.72
      this.syncAmbientWithPlayback()
      this.emit()
      if (pending) {
        if (pending.startTimeSec > 0.1 && window.AndroidBridge.radioJumpToSegmentWithTime) {
          window.AndroidBridge.radioJumpToSegmentWithTime(pending.segIdx, pending.startTimeSec)
        } else {
          window.AndroidBridge.radioJumpBlock(pending.segIdx)
        }
      } else {
        window.AndroidBridge.radioResume()
      }
      return
    }

    if (this.pendingAdvanceToNext && this.segments.length > 0) {
      this.pendingAdvanceToNext = false
      this.playSessionId++
      this.playSegmentAt(this.segmentCursor + 1, this.playSessionId, 0)
      return
    }

    if (this.state.isOfflineFallback && this.segments.length > 0) {
      this.playSessionId++
      this.playSegmentAt(this.segmentCursor, this.playSessionId, 0)
      return
    }

    if (this.audioEl && this.audioEl.src && !this.audioEl.ended && this.audioEl.readyState >= 2) {
      // 热音频瞬时恢复，零延迟无卡顿
      this.state.status = 'playing'
      this.syncAmbientWithPlayback()
      this.emit()
      this.audioEl
        .play()
        .catch(() => {
          if (!this.desiredPlaying) return
          this.playSessionId++
          this.playSegmentAt(this.segmentCursor, this.playSessionId, this.state.currentTime)
        })
      return
    }

    if (this.segments.length > 0) {
      this.playSessionId++
      this.playSegmentAt(this.segmentCursor, this.playSessionId, this.state.currentTime)
    } else if (this.state.bookId) {
      this.playChapter(this.state.bookId, this.state.chapterIndex, this.state.blockIndex, this.state.stationId, {
        allowFrontMatter: true,
        startSegmentIndex: this.segmentCursor,
        startTimeSec: this.state.currentTime,
      })
    }
  }

  public stop() {
    this.persistCheckpoint(true)
    this.desiredPlaying = false
    this.pendingAdvanceToNext = false
    this.androidPendingSeek = null
    this.playSessionId++
    this.clearPauseTimer()
    this.clearLoadingDelayTimer()
    this.cancelSpeechFallback()
    this.androidServiceRunning = false

    if (getPlatform() === 'android' && window.AndroidBridge) {
      window.AndroidBridge.radioStop()
    } else if (this.audioEl) {
      try {
        this.audioEl.pause()
        this.audioEl.removeAttribute('src')
      } catch {}
    }

    this.state.status = 'idle'
    this.state.isOfflineFallback = false
    this.state.sleepEndAt = null
    this.state.sleepAfterChapter = false
    this.nativeFakeLevel = 0
    this.syncAmbientWithPlayback()
    this.emit()
  }

  /** 全章进度条精准拖动（跨段落、跨系统 TTS 与微软神经网络语音通用） */
  public seekChapterTo(targetChapterSec: number) {
    if (!this.segments.length || !this.segmentDurations.length) {
      this.seekTo(targetChapterSec)
      return
    }
    const total = this.state.chapterDuration || this.segmentDurations.reduce((a, b) => a + b, 0)
    const clamped = Math.max(0, Math.min(Math.max(0, total - 0.2), targetChapterSec))

    let acc = 0
    let targetIdx = this.segments.length - 1
    let offsetInSeg = 0
    for (let i = 0; i < this.segmentDurations.length; i++) {
      const d = this.segmentDurations[i]
      if (clamped < acc + d || i === this.segmentDurations.length - 1) {
        targetIdx = i
        offsetInSeg = Math.max(0, clamped - acc)
        break
      }
      acc += d
    }

    // 落在同一段且音频已加载（非离线系统语音）时直接毫秒级 seek，零重加载
    if (
      targetIdx === this.segmentCursor &&
      !this.state.isOfflineFallback &&
      (this.state.status === 'playing' || this.state.status === 'paused') &&
      this.state.duration > 0
    ) {
      const segTarget = Math.min(Math.max(0, this.state.duration - 0.1), offsetInSeg)
      this.seekTo(segTarget)
      return
    }

    // 系统 TTS 不支持段内精确 seek，但可平滑跳到任意目标段落
    const effectiveOffset = this.settings.voice === SYSTEM_TTS_VOICE_ID ? 0 : offsetInSeg
    this.jumpToSegment(targetIdx, effectiveOffset, false)
  }

  /** 章内快进/快退（默认 ±15 秒）；支持无缝跨越任意多个短段落 */
  public seekBy(deltaSec: number) {
    if (this.segments.length > 0 && this.segmentDurations.length > 0) {
      const target = this.state.chapterCurrentTime + deltaSec
      if (target < 0 && this.state.chapterCurrentTime < 2.5) {
        this.prevSegmentOrChapter()
        return
      }
      if (target >= this.state.chapterDuration - 0.25 && deltaSec > 0) {
        this.nextChapterOrStationTrack()
        return
      }
      this.seekChapterTo(target)
      return
    }

    if (getPlatform() === 'android' && window.AndroidBridge?.radioSeekBy) {
      window.AndroidBridge.radioSeekBy(deltaSec)
      return
    }
    if (this.audioEl && isFinite(this.audioEl.duration) && this.audioEl.duration > 0) {
      const next = this.audioEl.currentTime + deltaSec
      if (next < 0) {
        if (this.audioEl.currentTime > 2.5) {
          this.audioEl.currentTime = 0
        } else {
          this.prevSegmentOrChapter()
        }
      } else if (next >= this.audioEl.duration - 0.15) {
        this.nextSegment()
      } else {
        this.audioEl.currentTime = next
        this.state.currentTime = next
        this.recomputeChapterProgress(next)
        this.persistCheckpoint(true)
        this.emit()
      }
    } else if (deltaSec > 0) {
      this.nextSegment()
    } else if (deltaSec < 0) {
      this.prevSegmentOrChapter()
    }
  }

  /** 精准拖动当前播报段内时间轴 */
  public seekTo(targetSec: number) {
    const safeTarget = Math.max(0, targetSec)
    if (getPlatform() === 'android' && window.AndroidBridge?.radioSeekTo) {
      window.AndroidBridge.radioSeekTo(safeTarget)
      this.state.currentTime = safeTarget
      this.recomputeChapterProgress(safeTarget)
      this.persistCheckpoint(true)
      this.emit()
      return
    }
    if (this.audioEl && isFinite(this.audioEl.duration) && this.audioEl.duration > 0) {
      const clamped = Math.max(0, Math.min(this.audioEl.duration - 0.05, safeTarget))
      this.audioEl.currentTime = clamped
      this.state.currentTime = clamped
      this.recomputeChapterProgress(clamped)
      this.persistCheckpoint(true)
      this.emit()
    }
  }

  /** 获取当前设备已缓存的微软语音 MP3 文件统计 */
  public async getCacheStats(): Promise<TtsCacheStats> {
    try {
      if (getPlatform() === 'android' && window.AndroidBridge?.ttsGetCacheStats) {
        const raw = window.AndroidBridge.ttsGetCacheStats()
        const parsed = JSON.parse(raw)
        return {
          fileCount: Number(parsed?.fileCount || 0),
          totalBytes: Number(parsed?.totalBytes || 0),
        }
      }
      const res = await fetch(`${getApiBase()}/api/tts/cache/stats`)
      if (res.ok) {
        const data = await res.json()
        return {
          fileCount: Number(data?.fileCount || 0),
          totalBytes: Number(data?.totalBytes || 0),
        }
      }
    } catch {}
    return { fileCount: this.blobCache.size, totalBytes: 0 }
  }

  /** 清理本地离线 TTS 语音缓存 */
  public async clearCache(): Promise<void> {
    this.clearBlobCache()
    try {
      if (getPlatform() === 'android' && window.AndroidBridge?.ttsClearCache) {
        window.AndroidBridge.ttsClearCache()
        return
      }
      await fetch(`${getApiBase()}/api/tts/cache/clear`, { method: 'POST' })
    } catch {}
  }

  /** 一键预缓存当前整章微软语音音频，供地铁/飞行离线收听 */
  public async prefetchCurrentChapter(
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<{ done: number; total: number }> {
    if (this.settings.voice === SYSTEM_TTS_VOICE_ID) {
      return { done: 0, total: 0 }
    }
    let segs = this.segments
    if ((!segs || segs.length === 0) && this.state.bookId) {
      const meta = await fetchBookMeta(this.state.bookId)
      const ch = await fetchChapter(this.state.bookId, this.state.chapterIndex)
      segs = this.buildSegments(ch, this.settings.announceChapter, meta.title)
    }
    const total = segs.length
    if (total === 0) return { done: 0, total: 0 }

    let done = 0
    onProgress?.(0, total)

    const isAndroid = getPlatform() === 'android' && Boolean(window.AndroidBridge?.ttsPrefetchSegment)
    const pitchStr = `${this.settings.pitch >= 0 ? '+' : ''}${this.settings.pitch}Hz`

    for (let i = 0; i < segs.length; i++) {
      if (signal?.aborted) break
      const seg = segs[i]
      try {
        if (isAndroid && window.AndroidBridge?.ttsPrefetchSegment) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 60))
          window.AndroidBridge.ttsPrefetchSegment(
            seg.text,
            this.settings.voice,
            this.settings.rate,
            this.settings.pitch,
            this.settings.azureKey || '',
            this.settings.azureRegion || 'eastasia'
          )
        } else {
          await fetch(`${getApiBase()}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
              text: seg.text,
              voice: this.settings.voice,
              rate: this.settings.rate,
              pitch: pitchStr,
              volume: 1.0,
              azureKey: this.settings.azureKey || undefined,
              azureRegion: this.settings.azureRegion || undefined,
            }),
          })
        }
        done++
      } catch {
        if (signal?.aborted) break
      }
      onProgress?.(done, total)
    }

    return { done, total }
  }

  public nextSegment() {
    if (this.segmentCursor + 1 < this.segments.length) {
      this.jumpToSegment(this.segmentCursor + 1, 0, true)
    } else {
      this.nextChapterOrStationTrack()
    }
  }

  public prevSegmentOrChapter() {
    if (this.segmentCursor > 0) {
      this.jumpToSegment(this.segmentCursor - 1, 0, true)
    } else if (this.state.bookId && this.state.chapterIndex > 0) {
      this.playChapter(this.state.bookId, this.state.chapterIndex - 1, 0, this.state.stationId, {
        allowFrontMatter: true,
      })
    }
  }

  public async nextChapterOrStationTrack() {
    const st = this.state.stationId
    if (st === 'roam') {
      await this.tuneStation('roam')
      return
    }
    if (st === 'queue') {
      const queue: RadioQueueItem[] = loadRadioQueue()
      const idx = queue.findIndex((q) => q.bookId === this.state.bookId && q.chapterIndex === this.state.chapterIndex)
      if (idx >= 0 && idx + 1 < queue.length) {
        const nxt = queue[idx + 1]
        await this.playChapter(nxt.bookId, nxt.chapterIndex, 0, 'queue', { allowFrontMatter: true })
        return
      }
    }
    if (this.state.bookId) {
      const meta = await fetchBookMeta(this.state.bookId)
      if (this.state.chapterIndex + 1 < meta.chapterCount) {
        await this.playChapter(this.state.bookId, this.state.chapterIndex + 1, 0, st)
        return
      }
    }
    if (st === 'classic' || st === 'german' || st === 'marxism' || st === 'phenomenology' || st === 'postmodern' || st === 'chinese') {
      await this.tuneStation(st)
    } else {
      this.stop()
    }
  }

  /** 试听指定音色（支持系统本地 TTS 与微软神经网络语音） */
  public async auditionVoice(voiceShortName: string) {
    const isSystem = voiceShortName === SYSTEM_TTS_VOICE_ID
    const sampleText = isSystem
      ? '哲学是时代精神的精华。欢迎收听哲启明思电台，当前正在使用系统本地离线语音引擎。'
      : '哲学是时代精神的精华。欢迎收听哲启明思电台，我是您的微软神经网络播音员。'
    if (getPlatform() === 'android' && window.AndroidBridge) {
      window.AndroidBridge.ttsAudition(
        sampleText,
        voiceShortName,
        this.settings.rate,
        this.settings.pitch,
        this.settings.azureKey || '',
        this.settings.azureRegion || 'eastasia'
      )
      return
    }
    if (isSystem) {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        throw new Error('当前环境不支持系统本地语音引擎')
      }
      window.speechSynthesis.cancel()
      const utt = new SpeechSynthesisUtterance(sampleText)
      utt.lang = 'zh-CN'
      utt.rate = Math.max(0.5, Math.min(2.0, this.settings.rate))
      utt.pitch = Math.max(0.5, Math.min(1.6, 1 + this.settings.pitch / 35))
      utt.volume = Math.max(0, Math.min(1, this.settings.volume))
      const voices = window.speechSynthesis.getVoices() || []
      const zhVoice =
        voices.find((v) => /zh[-_]CN/i.test(v.lang) && /Microsoft|Yun|Xiao|Natural/i.test(v.name)) ||
        voices.find((v) => /zh/i.test(v.lang))
      if (zhVoice) utt.voice = zhVoice
      window.speechSynthesis.speak(utt)
      return
    }
    const url = await this.synthesizeSegmentUrl(sampleText, voiceShortName)
    const audio = new Audio(url)
    audio.volume = this.settings.volume
    await audio.play()
  }

  /** 获取实时音频频谱数组（0..255），用于 RadioStudioView 的 Canvas 可视化 */
  public getFrequencyBars(barCount = 40): number[] {
    const out = new Array<number>(barCount).fill(6)
    if (this.state.status !== 'playing') return out

    if (this.analyser && getPlatform() !== 'android' && !this.state.isOfflineFallback) {
      const data = new Uint8Array(this.analyser.frequencyBinCount)
      this.analyser.getByteFrequencyData(data)
      const step = Math.max(1, Math.floor((data.length * 0.65) / barCount))
      for (let i = 0; i < barCount; i++) {
        let sum = 0
        for (let j = 0; j < step; j++) sum += data[i * step + j] || 0
        out[i] = Math.max(8, Math.round(sum / step))
      }
      return out
    }

    const t = performance.now() / 240
    for (let i = 0; i < barCount; i++) {
      const norm = i / barCount
      const bell = Math.sin(norm * Math.PI)
      const wave =
        Math.sin(t * 2.1 + i * 0.45) * 0.45 +
        Math.cos(t * 3.4 - i * 0.28) * 0.35 +
        Math.sin(t * 1.2 + i * 0.8) * 0.2
      out[i] = Math.max(10, Math.round((70 + wave * 110) * (0.35 + 0.65 * bell) * (this.nativeFakeLevel || 0.7)))
    }
    return out
  }

  /* ---------- Desktop/Web Audio Playback + Prefetch ---------- */

  private ensureAudioEl(): HTMLAudioElement {
    if (!this.audioEl) {
      this.audioEl = new Audio()
      this.audioEl.crossOrigin = 'anonymous'
      this.audioEl.volume = this.settings.volume

      this.audioEl.addEventListener('timeupdate', () => {
        if (!this.audioEl || this.state.status !== 'playing') return
        const cur = this.audioEl.currentTime || 0
        const dur = isFinite(this.audioEl.duration) ? this.audioEl.duration : 0
        if (dur > 0 && this.segmentCursor < this.segmentDurations.length) {
          this.segmentDurations[this.segmentCursor] = dur + (this.settings.paraPauseMs || 520) / 1000
        }
        this.state.currentTime = cur
        this.state.duration = dur
        this.recomputeChapterProgress(cur)
        this.emit()
      })
    }

    if (!this.mediaSourceConnected && this.audioEl) {
      const ctx = ambientAudio.getAudioContext()
      if (ctx) {
        try {
          const src = ctx.createMediaElementSource(this.audioEl)
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 256
          analyser.smoothingTimeConstant = 0.78
          src.connect(analyser)
          analyser.connect(ctx.destination)
          this.analyser = analyser
          this.mediaSourceConnected = true
        } catch {}
      }
    }
    return this.audioEl
  }

  private cacheKey(text: string, voice: string): string {
    return `${voice}|${this.settings.rate}|${this.settings.pitch}|${text}`
  }

  private evictBlobKey(key: string) {
    const oldUrl = this.blobCache.get(key)
    if (oldUrl) {
      try {
        URL.revokeObjectURL(oldUrl)
      } catch {}
      this.blobCache.delete(key)
    }
  }

  private clearBlobCache() {
    this.blobCache.forEach((url) => {
      try {
        URL.revokeObjectURL(url)
      } catch {}
    })
    this.blobCache.clear()
    this.inflightFetch.clear()
  }

  private clearPauseTimer() {
    if (this.pauseTimeout !== null) {
      window.clearTimeout(this.pauseTimeout)
      this.pauseTimeout = null
    }
  }

  private clearLoadingDelayTimer() {
    if (this.loadingDelayTimer !== null) {
      window.clearTimeout(this.loadingDelayTimer)
      this.loadingDelayTimer = null
    }
  }

  private async synthesizeSegmentUrl(text: string, voiceOverride?: string, forceRefresh = false): Promise<string> {
    const voice = voiceOverride || this.settings.voice
    const key = this.cacheKey(text, voice)
    if (forceRefresh) {
      this.evictBlobKey(key)
    } else {
      const cached = this.blobCache.get(key)
      if (cached) return cached
      const inflight = this.inflightFetch.get(key)
      if (inflight) return inflight
    }

    const task = (async () => {
      const pitchStr = `${this.settings.pitch >= 0 ? '+' : ''}${this.settings.pitch}Hz`
      const res = await fetch(`${getApiBase()}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice,
          rate: this.settings.rate,
          pitch: pitchStr,
          volume: 1.0,
          forceRefresh,
          azureKey: this.settings.azureKey || undefined,
          azureRegion: this.settings.azureRegion || undefined,
        }),
      })
      if (!res.ok) {
        const msg = await res.text().catch(() => '')
        throw new Error(msg || `微软语音合成失败 (${res.status})`)
      }
      const blob = await res.blob()
      if (blob.size < 256) {
        throw new Error('语音数据不完整')
      }
      const url = URL.createObjectURL(blob)
      if (this.blobCache.size > 36) {
        const oldest = this.blobCache.keys().next().value
        if (oldest) {
          this.evictBlobKey(oldest)
        }
      }
      this.blobCache.set(key, url)
      return url
    })().finally(() => {
      this.inflightFetch.delete(key)
    })

    this.inflightFetch.set(key, task)
    return task
  }

  private prefetchAhead(fromCursor: number) {
    // 串行预取后 2 段，既保证无缝连播又避免并发抢占微软 WebSocket 限流
    const seg1 = this.segments[fromCursor + 1]
    const seg2 = this.segments[fromCursor + 2]
    if (seg1) {
      this.synthesizeSegmentUrl(seg1.text)
        .then(() => {
          if (seg2) return this.synthesizeSegmentUrl(seg2.text)
        })
        .catch(() => {})
    }
  }

  private playWithSpeechSynthesisFallback(seg: SpeakSegment, segIdx: number, sessionId: number): boolean {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false
    try {
      this.cancelSpeechFallback()
      const utt = new SpeechSynthesisUtterance(seg.text)
      utt.lang = 'zh-CN'
      utt.rate = Math.max(0.5, Math.min(2.0, this.settings.rate))
      utt.pitch = Math.max(0.5, Math.min(1.6, 1 + this.settings.pitch / 35))
      utt.volume = Math.max(0, Math.min(1, this.settings.volume))
      const voices = window.speechSynthesis.getVoices() || []
      const zhVoice =
        voices.find((v) => /zh[-_]CN/i.test(v.lang) && /Microsoft|Yun|Xiao|Natural/i.test(v.name)) ||
        voices.find((v) => /zh/i.test(v.lang))
      if (zhVoice) utt.voice = zhVoice

      this.offlineFallbackActive = true
      this.speechUtterance = utt

      const estSec = this.estimateSegmentSec(seg.text)
      const advance = () => {
        if (sessionId !== this.playSessionId || !this.desiredPlaying) return
        this.offlineFallbackActive = false
        this.stopOfflineProgressTicker()
        if (this.offlineWatchdogTimer !== null) {
          window.clearTimeout(this.offlineWatchdogTimer)
          this.offlineWatchdogTimer = null
        }
        this.consecutiveErrors = 0
        this.pauseTimeout = window.setTimeout(() => {
          this.pauseTimeout = null
          if (sessionId !== this.playSessionId || !this.desiredPlaying) return
          this.playSegmentAt(segIdx + 1, sessionId, 0)
        }, this.settings.paraPauseMs)
      }

      utt.onend = advance
      utt.onerror = (ev: any) => {
        if (sessionId !== this.playSessionId || !this.desiredPlaying) return
        if (ev?.error === 'canceled' || ev?.error === 'interrupted') return
        this.offlineFallbackActive = false
        this.stopOfflineProgressTicker()
        this.consecutiveErrors++
        if (this.consecutiveErrors <= 2 && segIdx + 1 < this.segments.length) {
          this.playSegmentAt(segIdx + 1, sessionId, 0)
          return
        }
        this.desiredPlaying = false
        this.state.status = 'error'
        this.state.errorMessage = '离线本地语音播报失败，请检查系统语音包'
        this.syncAmbientWithPlayback()
        this.emit()
      }

      // Chromium speechSynthesis 看门狗：防止长句偶发卡死不触发 onend 导致停播
      this.offlineWatchdogTimer = window.setTimeout(() => {
        if (sessionId === this.playSessionId && this.desiredPlaying && this.offlineFallbackActive) {
          try {
            window.speechSynthesis.cancel()
          } catch {}
          advance()
        }
      }, Math.round((estSec * 2.4 + 14) * 1000))

      window.speechSynthesis.speak(utt)
      this.state.status = 'playing'
      this.state.isOfflineFallback = true
      this.state.errorMessage = null
      this.startOfflineProgressTicker(segIdx, 0)
      this.syncAmbientWithPlayback()
      this.emit()
      return true
    } catch {
      return false
    }
  }

  private async playSegmentAt(segIdx: number, sessionId: number, startTimeSec = 0, retryCount = 0) {
    if (sessionId !== this.playSessionId || !this.desiredPlaying) return
    this.clearPauseTimer()
    this.clearLoadingDelayTimer()
    this.cancelSpeechFallback()
    const seg = this.segments[segIdx]
    if (!seg) {
      if (this.state.sleepAfterChapter) {
        this.stop()
      } else {
        this.nextChapterOrStationTrack()
      }
      return
    }

    this.segmentCursor = segIdx
    const estDur = this.estimateSegmentSec(seg.text)
    const key = this.cacheKey(seg.text, this.settings.voice)
    const isCachedHit = this.settings.voice !== SYSTEM_TTS_VOICE_ID && this.blobCache.has(key) && retryCount === 0
    const keepPlayingUi = this.state.status === 'playing' && isCachedHit

    this.state = {
      ...this.state,
      status: keepPlayingUi ? 'playing' : this.state.status === 'playing' ? 'playing' : 'loading',
      errorMessage: null,
      blockIndex: seg.blockIndex,
      segmentIndex: segIdx,
      totalSegments: this.segments.length,
      currentText: seg.text,
      currentTime: startTimeSec,
      duration: estDur,
    }
    this.recomputeChapterProgress(startTimeSec)
    this.persistCheckpoint(true)
    this.emit()

    // 若用户主动选择「系统本地 TTS」，直接启用本机离线语音
    if (this.settings.voice === SYSTEM_TTS_VOICE_ID) {
      if (this.playWithSpeechSynthesisFallback(seg, segIdx, sessionId)) {
        return
      }
      this.desiredPlaying = false
      this.state.status = 'error'
      this.state.isOfflineFallback = false
      this.state.errorMessage = '当前设备未检测到可用的系统本地语音包'
      this.syncAmbientWithPlayback()
      this.emit()
      return
    }

    // 仅当合成耗时超过 320ms 时才切到 loading 指示，避免缓存命中或快网下按钮与唱片频繁闪烁
    if (!isCachedHit) {
      this.loadingDelayTimer = window.setTimeout(() => {
        if (sessionId === this.playSessionId && this.desiredPlaying && this.state.status !== 'paused') {
          this.state.status = 'loading'
          this.emit()
        }
      }, 320)
    }

    this.prefetchAhead(segIdx)

    try {
      const audioUrl = await this.synthesizeSegmentUrl(seg.text, undefined, retryCount > 0)
      this.clearLoadingDelayTimer()
      if (sessionId !== this.playSessionId || !this.desiredPlaying) return

      ambientAudio.ensureRunning()
      const audio = this.ensureAudioEl()
      audio.volume = this.settings.volume
      audio.src = audioUrl

      if (startTimeSec > 0.1) {
        const applyStartOffset = () => {
          if (sessionId !== this.playSessionId) return
          if (isFinite(audio.duration) && audio.duration > 0.2) {
            audio.currentTime = Math.min(audio.duration - 0.1, startTimeSec)
          }
        }
        audio.addEventListener('loadedmetadata', applyStartOffset, { once: true })
      }

      audio.onended = () => {
        if (sessionId !== this.playSessionId || !this.desiredPlaying) return
        this.consecutiveErrors = 0
        this.pauseTimeout = window.setTimeout(() => {
          this.pauseTimeout = null
          if (sessionId !== this.playSessionId || !this.desiredPlaying) return
          this.playSegmentAt(segIdx + 1, sessionId, 0)
        }, this.settings.paraPauseMs)
      }

      audio.onerror = () => {
        if (sessionId !== this.playSessionId || !this.desiredPlaying) return
        // 真正执行自动清坏缓存重试 -> 系统语音降级 -> 跳段恢复，绝不卡死停播
        this.evictBlobKey(key)
        if (retryCount < 1) {
          this.playSegmentAt(segIdx, sessionId, startTimeSec, retryCount + 1)
          return
        }
        if (this.playWithSpeechSynthesisFallback(seg, segIdx, sessionId)) {
          return
        }
        this.consecutiveErrors++
        if (this.consecutiveErrors <= 2 && segIdx + 1 < this.segments.length) {
          this.playSegmentAt(segIdx + 1, sessionId, 0)
          return
        }
        this.desiredPlaying = false
        this.state.status = 'error'
        this.state.errorMessage = '音频解码异常，请点击重试或切换主播音色'
        this.syncAmbientWithPlayback()
        this.emit()
      }

      await audio.play()
      if (sessionId !== this.playSessionId || !this.desiredPlaying) {
        try {
          audio.pause()
        } catch {}
        return
      }
      this.consecutiveErrors = 0
      this.state.status = 'playing'
      this.state.isOfflineFallback = false
      if (isFinite(audio.duration) && audio.duration > 0) {
        this.state.duration = audio.duration
        if (segIdx < this.segmentDurations.length) {
          this.segmentDurations[segIdx] = audio.duration + (this.settings.paraPauseMs || 520) / 1000
        }
        this.recomputeChapterProgress(audio.currentTime || startTimeSec)
      }
      this.syncAmbientWithPlayback()
      this.emit()
    } catch (err: any) {
      this.clearLoadingDelayTimer()
      if (sessionId !== this.playSessionId || !this.desiredPlaying) return
      if (this.playWithSpeechSynthesisFallback(seg, segIdx, sessionId)) {
        return
      }
      this.consecutiveErrors++
      if (this.consecutiveErrors <= 2 && segIdx + 1 < this.segments.length) {
        this.playSegmentAt(segIdx + 1, sessionId, 0)
        return
      }
      this.desiredPlaying = false
      this.state.status = 'error'
      this.state.isOfflineFallback = false
      this.state.errorMessage = err?.message || '无法连接微软语音服务，请检查网络'
      this.syncAmbientWithPlayback()
      this.emit()
    }
  }
}

export const radioEngine = new PhilosophyRadioEngine()
