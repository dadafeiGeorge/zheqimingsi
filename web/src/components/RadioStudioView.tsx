import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  CloudDownload,
  CloudRain,
  Disc3,
  FileText,
  Flame,
  HardDrive,
  ListMusic,
  Loader2,
  Mic2,
  Moon,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  RotateCw,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  Waves,
  WifiOff,
  X,
} from 'lucide-react'
import type {
  AmbientSoundId,
  BookCatalogItem,
  BookMeta,
  ChapterContent,
  HighlightItem,
  RadioQueueItem,
  RadioSettings,
  RadioState,
  TtsCacheStats,
} from '../types'
import {
  CURATED_VOICES,
  RADIO_STATIONS,
  SYSTEM_TTS_VOICE_ID,
  getCuratedStationBooks,
  getStationBookGroups,
  radioEngine,
} from '../services/radioEngine'
import { fetchBookMeta, fetchChapter } from '../services/libraryApi'
import { getPlatform, notifyToast, registerBackHandler, triggerHaptic } from '../services/platform'
import { loadAllRadioBookProgress } from '../services/storage'
import { resolveChapterFootnotes } from '../utils/inlineHighlights'
import { QuoteCardModal } from './QuoteCardModal'

interface RadioStudioViewProps {
  books: BookCatalogItem[]
  radio: RadioState
  radioSettings: RadioSettings
  onUpdateRadioSettings: (partial: Partial<RadioSettings>) => void
  queue: RadioQueueItem[]
  onAddToQueue: (item: RadioQueueItem) => void
  onAddManyToQueue: (items: RadioQueueItem[]) => void
  onRemoveQueueItem: (id: string) => void
  onMoveQueueItem: (index: number, delta: -1 | 1) => void
  onClearQueue: () => void
  onOpenReader: (bookId: string, chapterIndex: number, blockIndex: number) => void
  onSaveHighlight: (item: HighlightItem) => void
  onCancelRadio: () => void
}

type ActiveSheet = 'books' | 'chapters' | 'voices' | 'mixer' | 'sleep' | 'queue' | null

const AMBIENT_OPTIONS: Array<{ id: AmbientSoundId; label: string; desc: string; icon: React.ReactNode }> = [
  { id: 'none', label: '纯粹人声', desc: '无背景环境音', icon: <Volume2 className="w-4 h-4" /> },
  { id: 'rain', label: '深夜雨声', desc: '书窗细雨伴读', icon: <CloudRain className="w-4 h-4" /> },
  { id: 'fireplace', label: '壁炉微火', desc: '暖炉木柴轻响', icon: <Flame className="w-4 h-4" /> },
  { id: 'brown', label: '书房棕噪', desc: '深度专注低频', icon: <Waves className="w-4 h-4" /> },
  { id: 'vinyl', label: '黑胶底噪', desc: '复古电台质感', icon: <Disc3 className="w-4 h-4" /> },
]

const SPEED_PRESETS = [0.75, 0.9, 1.0, 1.15, 1.3, 1.5]

const SLEEP_OPTIONS: Array<{ id: string; label: string; desc: string; mins: number | null; afterChapter: boolean }> = [
  { id: 'off', label: '关闭定时', desc: '持续连播不自动停止', mins: null, afterChapter: false },
  { id: '15', label: '15 分钟后淡出', desc: '小憩片刻，温柔收声', mins: 15, afterChapter: false },
  { id: '30', label: '30 分钟后淡出', desc: '睡前伴读黄金时长', mins: 30, afterChapter: false },
  { id: '45', label: '45 分钟后淡出', desc: '完整思辨单节体验', mins: 45, afterChapter: false },
  { id: '60', label: '60 分钟后淡出', desc: '深夜深度沉浸收听', mins: 60, afterChapter: false },
  { id: 'chapter', label: '播完本章自动关闭', desc: '读完当前章节后自然停播', mins: null, afterChapter: true },
]

export const RadioStudioView: React.FC<RadioStudioViewProps> = ({
  books,
  radio,
  radioSettings,
  onUpdateRadioSettings,
  queue,
  onAddToQueue,
  onAddManyToQueue,
  onRemoveQueueItem,
  onMoveQueueItem,
  onClearQueue,
  onOpenReader,
  onSaveHighlight,
  onCancelRadio,
}) => {
  // 桌面端右侧演播室标签
  const [studioTab, setStudioTab] = useState<'teleprompter' | 'voices' | 'mixer' | 'queue'>('teleprompter')
  // 手机端主舞台：黑胶封面 <-> 随声同步字幕 点击切换
  const [mobileStage, setMobileStage] = useState<'vinyl' | 'lyrics'>('vinyl')
  // 统一的主题化动画底部抽屉（彻底取代所有丑陋的原生 HTML <select>）
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null)

  const [bookPickerQuery, setBookPickerQuery] = useState('')
  const [chapterPickerQuery, setChapterPickerQuery] = useState('')
  const [programSubTab, setProgramSubTab] = useState<'collection' | 'personal'>('collection')
  const [collectionFilter, setCollectionFilter] = useState('')
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null)
  const [expandedChapterFilter, setExpandedChapterFilter] = useState('')
  const [hideFrontMatterInList, setHideFrontMatterInList] = useState(true)
  const [metaCache, setMetaCache] = useState<Record<string, BookMeta>>({})
  const [loadingMetaId, setLoadingMetaId] = useState<string | null>(null)
  const [roamSeed, setRoamSeed] = useState<number>(() => radioEngine.getRoamSeed())
  const [seedingStarter, setSeedingStarter] = useState(false)

  const [chapter, setChapter] = useState<ChapterContent | null>(null)
  const [bookMeta, setBookMeta] = useState<BookMeta | null>(null)
  const [auditioning, setAuditioning] = useState<string | null>(null)
  const [systemTtsEngineName, setSystemTtsEngineName] = useState<string>(() => {
    try {
      return window.AndroidBridge?.ttsGetSystemEngineName?.() || ''
    } catch {
      return ''
    }
  })
  const [showAzureAdvanced, setShowAzureAdvanced] = useState(false)
  const [quoteText, setQuoteText] = useState<string | null>(null)
  const [sleepCountdown, setSleepCountdown] = useState<string>('')
  const [lastNonZeroVol, setLastNonZeroVol] = useState<number>(radioSettings.volume > 0 ? radioSettings.volume : 0.85)
  const [cacheStats, setCacheStats] = useState<TtsCacheStats>({ fileCount: 0, totalBytes: 0 })
  const [prefetching, setPrefetching] = useState<{ active: boolean; done: number; total: number }>({
    active: false,
    done: 0,
    total: 0,
  })
  const prefetchAbortRef = useRef<AbortController | null>(null)

  const desktopCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const mobileCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const activeParaRef = useRef<HTMLDivElement | null>(null)
  const activeChapterItemRef = useRef<HTMLButtonElement | null>(null)
  const [scrubRatio, setScrubRatio] = useState<number | null>(null)
  const scrubbingRef = useRef(false)
  const scrubRatioRef = useRef<number | null>(null)

  const radioBookProgressMap = useMemo(
    () => loadAllRadioBookProgress(),
    [radio.bookId, radio.chapterIndex, radio.segmentIndex, activeSheet]
  )

  // 分层返回键支持：先关闭抽屉 -> 字幕退回黑胶 -> 离开电台页
  useEffect(() => {
    if (!activeSheet) return
    return registerBackHandler(70, () => {
      setActiveSheet(null)
      return true
    })
  }, [activeSheet])

  useEffect(() => {
    if (mobileStage !== 'lyrics') return
    return registerBackHandler(50, () => {
      setMobileStage('vinyl')
      return true
    })
  }, [mobileStage])

  // 打开章节选择抽屉时自动居中定位到当前播报章节；打开音色抽屉时刷新手机系统默认 TTS 引擎名称
  useEffect(() => {
    if (activeSheet === 'voices') {
      try {
        const name = window.AndroidBridge?.ttsGetSystemEngineName?.() || ''
        if (name) setSystemTtsEngineName(name)
      } catch {}
      return
    }
    if (activeSheet !== 'chapters') return
    const t = window.setTimeout(() => {
      activeChapterItemRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
    }, 60)
    return () => window.clearTimeout(t)
  }, [activeSheet, radio.chapterIndex])

  useEffect(() => {
    setProgramSubTab(radio.stationId === 'queue' ? 'personal' : 'collection')
    setCollectionFilter('')
  }, [radio.stationId])

  const stationGroups = useMemo(
    () => getStationBookGroups(books, radio.stationId === 'queue' ? 'current' : radio.stationId, radio.bookId, roamSeed),
    [books, radio.stationId, radio.bookId, roamSeed]
  )

  const stationBookCount = useMemo(
    () => stationGroups.reduce((sum, g) => sum + g.books.length, 0),
    [stationGroups]
  )

  const filteredStationGroups = useMemo(() => {
    const q = collectionFilter.trim().toLowerCase()
    if (!q) return stationGroups
    return stationGroups
      .map((g) => ({
        ...g,
        books: g.books.filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            b.author.toLowerCase().includes(q) ||
            g.label.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.books.length > 0)
  }, [stationGroups, collectionFilter])

  const filteredPickerBooks = useMemo(() => {
    const q = bookPickerQuery.trim().toLowerCase()
    if (!q) return books
    return books.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q)
    )
  }, [books, bookPickerQuery])

  const filteredPickerChapters = useMemo(() => {
    if (!bookMeta) return []
    const q = chapterPickerQuery.trim().toLowerCase()
    return bookMeta.chapters.filter((ch) => {
      if (hideFrontMatterInList && ch.isFrontMatter && ch.index !== radio.chapterIndex) return false
      if (q && !ch.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [bookMeta, chapterPickerQuery, hideFrontMatterInList, radio.chapterIndex])

  const queueKeySet = useMemo(
    () => new Set(queue.map((q) => `${q.bookId}#${q.chapterIndex}`)),
    [queue]
  )

  const handleToggleExpandBook = async (bookId: string) => {
    if (expandedBookId === bookId) {
      setExpandedBookId(null)
      setExpandedChapterFilter('')
      return
    }
    setExpandedBookId(bookId)
    setExpandedChapterFilter('')
    if (!metaCache[bookId]) {
      setLoadingMetaId(bookId)
      try {
        const m = await fetchBookMeta(bookId)
        setMetaCache((prev) => ({ ...prev, [bookId]: m }))
      } catch {
        notifyToast('章节目录加载失败')
      } finally {
        setLoadingMetaId((cur) => (cur === bookId ? null : cur))
      }
    }
  }

  const handleSeedStarterQueue = async () => {
    if (seedingStarter || books.length === 0) return
    setSeedingStarter(true)
    try {
      const picks: BookCatalogItem[] = []
      for (const st of ['classic', 'german', 'marxism', 'phenomenology', 'postmodern', 'chinese'] as const) {
        const pool = getCuratedStationBooks(books, st)
        if (pool[0]) picks.push(pool[0])
      }
      const items: RadioQueueItem[] = []
      for (const b of picks.slice(0, 6)) {
        try {
          const m = metaCache[b.id] || (await fetchBookMeta(b.id))
          setMetaCache((prev) => (prev[b.id] ? prev : { ...prev, [b.id]: m }))
          const ch = m.chapters[b.firstBodyChapter || 0] || m.chapters[0]
          if (ch) {
            items.push({
              id: `q_${b.id}_${ch.index}_${Date.now().toString(36)}`,
              bookId: b.id,
              bookTitle: b.title,
              author: b.author,
              chapterIndex: ch.index,
              chapterTitle: ch.title,
            })
          }
        } catch {}
      }
      if (items.length > 0) {
        onAddManyToQueue(items)
        notifyToast(`已一键载入 ${items.length} 节跨学派精选哲思播单`)
      }
    } finally {
      setSeedingStarter(false)
    }
  }

  const refreshCacheStats = () => {
    radioEngine.getCacheStats().then(setCacheStats).catch(() => {})
  }

  useEffect(() => {
    if (studioTab === 'mixer' || activeSheet === 'mixer') {
      refreshCacheStats()
    }
  }, [studioTab, activeSheet])

  const formatTime = (sec: number) => {
    if (!isFinite(sec) || sec <= 0) return '0:00'
    const total = Math.floor(sec)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const handleStartPrefetchChapter = async () => {
    if (!radio.bookId) {
      notifyToast('请先选择一本书或开始播报后再预缓存本章')
      return
    }
    if (prefetching.active) {
      prefetchAbortRef.current?.abort()
      setPrefetching({ active: false, done: 0, total: 0 })
      return
    }
    const ac = new AbortController()
    prefetchAbortRef.current = ac
    setPrefetching({ active: true, done: 0, total: 1 })
    try {
      const res = await radioEngine.prefetchCurrentChapter((done, total) => {
        setPrefetching({ active: true, done, total })
      }, ac.signal)
      if (!ac.signal.aborted) {
        notifyToast(`已完成本章离线语音预缓存 (${res.done}/${res.total} 段)`)
      }
    } finally {
      setPrefetching((prev) => ({ ...prev, active: false }))
      prefetchAbortRef.current = null
      refreshCacheStats()
    }
  }

  const handleClearCache = async () => {
    await radioEngine.clearCache()
    refreshCacheStats()
    notifyToast('已清理本地离线语音缓存')
  }

  const currentStation = RADIO_STATIONS.find((s) => s.id === radio.stationId) || RADIO_STATIONS[0]
  const stationIdx = RADIO_STATIONS.findIndex((s) => s.id === radio.stationId)
  const needlePct = ((Math.max(0, stationIdx) + 0.5) / RADIO_STATIONS.length) * 100

  // 加载当前正在播送的书籍目录与章节全文
  useEffect(() => {
    if (!radio.bookId) {
      setChapter(null)
      setBookMeta(null)
      return
    }
    let alive = true
    fetchBookMeta(radio.bookId)
      .then((m) => {
        if (alive) setBookMeta(m)
      })
      .catch(() => {})
    fetchChapter(radio.bookId, radio.chapterIndex)
      .then((ch) => {
        if (alive) setChapter(ch)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [radio.bookId, radio.chapterIndex])

  const handleVolumeChange = (vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol))
    if (clamped > 0.01) setLastNonZeroVol(clamped)
    onUpdateRadioSettings({ volume: clamped })
  }

  const handleToggleMute = () => {
    if (radioSettings.volume > 0.01) {
      setLastNonZeroVol(radioSettings.volume)
      onUpdateRadioSettings({ volume: 0 })
    } else {
      onUpdateRadioSettings({ volume: lastNonZeroVol || 0.85 })
    }
  }

  // 自动滚动字幕舞台到当前播报段落
  useEffect(() => {
    if ((studioTab === 'teleprompter' || mobileStage === 'lyrics') && activeParaRef.current) {
      activeParaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [radio.blockIndex, studioTab, mobileStage])

  // 定时关闭倒计时刷新
  useEffect(() => {
    if (!radio.sleepEndAt) {
      setSleepCountdown(radio.sleepAfterChapter ? '本章后' : '')
      return
    }
    const tick = () => {
      const left = Math.max(0, Math.floor((radio.sleepEndAt! - Date.now()) / 1000))
      const m = Math.floor(left / 60)
      const s = left % 60
      setSleepCountdown(`${m}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [radio.sleepEndAt, radio.sleepAfterChapter])

  // 实时 Canvas 音频频谱可视化（仅在播放中运行 60fps 动画，暂停/待机绘制单帧静息态，大幅降低手机耗电与触控卡顿）
  useEffect(() => {
    let raf = 0
    const drawOn = (canvas: HTMLCanvasElement | null, barCount: number) => {
      if (!canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const bars = radioEngine.getFrequencyBars(barCount)
      const gap = 3
      const barW = Math.max(2, (w - gap * (barCount - 1)) / barCount)
      const midY = h / 2

      for (let i = 0; i < barCount; i++) {
        const val = bars[i] / 255
        const bh = Math.max(3, val * (h * 0.86))
        const x = i * (barW + gap)
        const y = midY - bh / 2
        ctx.fillStyle = i % 2 === 0 ? currentStation.accent : '#d8a657'
        ctx.globalAlpha = radio.status === 'playing' ? 0.38 + val * 0.62 : 0.22
        ctx.beginPath()
        ctx.roundRect(x, y, barW, bh, 99)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    drawOn(desktopCanvasRef.current, 44)
    drawOn(mobileCanvasRef.current, 32)
    if (radio.status !== 'playing') return

    const tick = () => {
      drawOn(desktopCanvasRef.current, 44)
      drawOn(mobileCanvasRef.current, 32)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [currentStation.accent, radio.status])

  const handleAudition = async (shortName: string) => {
    setAuditioning(shortName)
    try {
      await radioEngine.auditionVoice(shortName)
    } catch (err: any) {
      notifyToast(err?.message || '试听失败，请检查网络连接')
    } finally {
      window.setTimeout(() => setAuditioning((cur) => (cur === shortName ? null : cur)), 1200)
    }
  }

  const handleCollectCurrentQuote = () => {
    if (!radio.bookId || !radio.currentText) return
    onSaveHighlight({
      id: `hl_radio_${Date.now().toString(36)}`,
      bookId: radio.bookId,
      bookTitle: radio.bookTitle,
      author: radio.author,
      chapterIndex: radio.chapterIndex,
      chapterTitle: radio.chapterTitle,
      blockIndex: radio.blockIndex,
      text: radio.currentText,
      note: '收听哲思电台时摘录',
      color: 'amber',
      createdAt: Date.now(),
    })
    notifyToast('已摘录当前播报金句至笔记库')
  }

  const isPlaying = radio.status === 'playing'
  const isLoading = radio.status === 'loading'
  const isActiveRadio = radio.status === 'playing' || radio.status === 'loading' || radio.status === 'paused'
  const voiceObj = CURATED_VOICES.find((v) => v.shortName === radioSettings.voice) || CURATED_VOICES[0]
  const voiceShortLabel =
    voiceObj.shortName === SYSTEM_TTS_VOICE_ID ? '系统TTS' : voiceObj.label.split('·')[0].trim()

  const activeSleepId = radio.sleepAfterChapter ? 'chapter' : radio.sleepEndAt ? 'active' : 'off'

  /* ---------------- 全章交互进度条（支持微软语音 / 系统 TTS / 暂停 / 断点续播全状态拖拽） ---------------- */

  const chapterTotalSec = radio.chapterDuration > 0 ? radio.chapterDuration : radio.duration > 0 ? radio.duration : 0
  const chapterElapsedSec =
    radio.chapterDuration > 0 ? radio.chapterCurrentTime : radio.duration > 0 ? radio.currentTime : 0
  const canScrubChapter = Boolean(radio.bookId && (chapterTotalSec > 0 || radio.totalSegments > 0))
  const effectiveRatio =
    scrubRatio !== null
      ? scrubRatio
      : chapterTotalSec > 0
      ? Math.max(0, Math.min(1, chapterElapsedSec / chapterTotalSec))
      : radio.totalSegments > 1
      ? Math.max(0, Math.min(1, radio.segmentIndex / (radio.totalSegments - 1)))
      : 0
  const displayElapsedSec = scrubRatio !== null ? scrubRatio * chapterTotalSec : chapterElapsedSec
  const displayPct = Math.round(effectiveRatio * 100)
  const displaySegNum =
    radio.totalSegments > 0
      ? scrubRatio !== null
        ? Math.min(radio.totalSegments, Math.max(1, Math.round(scrubRatio * (radio.totalSegments - 1)) + 1))
        : Math.min(radio.segmentIndex + 1, radio.totalSegments)
      : 0

  const renderChapterProgressBar = (compact = false) => {
    const computeRatioFromClientX = (el: HTMLDivElement, clientX: number) => {
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return 0
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    }

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!canScrubChapter) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      scrubbingRef.current = true
      const r = computeRatioFromClientX(e.currentTarget, e.clientX)
      scrubRatioRef.current = r
      setScrubRatio(r)
      triggerHaptic()
    }

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubbingRef.current) return
      const r = computeRatioFromClientX(e.currentTarget, e.clientX)
      scrubRatioRef.current = r
      setScrubRatio(r)
    }

    const finishScrub = (e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
      if (!scrubbingRef.current) return
      scrubbingRef.current = false
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      } catch {}
      const finalRatio = scrubRatioRef.current
      scrubRatioRef.current = null
      setScrubRatio(null)
      if (commit && finalRatio !== null && chapterTotalSec > 0) {
        radioEngine.seekChapterTo(finalRatio * chapterTotalSec)
      }
    }

    return (
      <div className={compact ? 'space-y-1' : 'w-full px-1 mb-2 space-y-1'}>
        {/* 拖拽实时预览悬浮胶囊 */}
        <div
          role="slider"
          tabIndex={canScrubChapter ? 0 : -1}
          aria-label="全章播报进度条"
          aria-valuemin={0}
          aria-valuemax={Math.round(chapterTotalSec)}
          aria-valuenow={Math.round(displayElapsedSec)}
          onKeyDown={(e) => {
            if (!canScrubChapter) return
            if (e.key === 'ArrowRight') {
              e.preventDefault()
              radioEngine.seekBy(15)
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault()
              radioEngine.seekBy(-15)
            }
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => finishScrub(e, true)}
          onPointerCancel={(e) => finishScrub(e, false)}
          className={`relative h-7 flex items-center touch-none select-none ${
            canScrubChapter ? 'cursor-pointer' : 'opacity-45 cursor-default'
          }`}
        >
          {scrubRatio !== null && chapterTotalSec > 0 && (
            <div
              className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold text-white shadow-md pointer-events-none whitespace-nowrap"
              style={{
                left: `${Math.max(10, Math.min(90, effectiveRatio * 100))}%`,
                backgroundColor: currentStation.accent,
              }}
            >
              {formatTime(displayElapsedSec)} · {displayPct}%
            </div>
          )}

          {/* 轨道底槽 */}
          <div
            className="w-full h-1.5 rounded-full overflow-hidden relative"
            style={{ backgroundColor: 'var(--border-strong)' }}
          >
            {/* 已播进度填充 */}
            <div
              className="h-full rounded-full"
              style={{
                width: `${effectiveRatio * 100}%`,
                background: `linear-gradient(90deg, ${currentStation.accent}, var(--gold))`,
                transition: scrubRatio !== null ? 'none' : 'width 180ms linear',
              }}
            />
          </div>

          {/* 触控圆点手柄 */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white shadow-md pointer-events-none ${
              scrubRatio !== null ? 'w-4 h-4 scale-110' : 'w-3.5 h-3.5'
            }`}
            style={{
              left: `${effectiveRatio * 100}%`,
              backgroundColor: currentStation.accent,
              boxShadow: `0 0 0 3px ${currentStation.accent}2e`,
              transition: scrubRatio !== null ? 'none' : 'left 180ms linear, transform 150ms ease',
            }}
          />
        </div>

        <div className="flex items-center justify-between text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          <span>{formatTime(displayElapsedSec)}</span>
          <span className="flex items-center gap-1.5 truncate px-2">
            {radio.hasSavedCheckpoint && radio.status === 'idle' && radio.bookId && (
              <span
                className="px-1.5 py-0.2 rounded-full text-[9px] font-sans font-semibold"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                断点续播
              </span>
            )}
            <span>
              {displaySegNum > 0
                ? `第 ${displaySegNum}/${radio.totalSegments} 句 · ${displayPct}%`
                : radio.totalBlocks > 0
                ? `第 ${Math.min(radio.blockIndex + 1, radio.totalBlocks)}/${radio.totalBlocks} 段`
                : `${voiceShortLabel} · ${radioSettings.rate.toFixed(1)}x`}
            </span>
          </span>
          <span>{formatTime(chapterTotalSec)}</span>
        </div>
      </div>
    )
  }

  /* ---------------- 可复用面板渲染器（手机 Bottom Sheet 与桌面演播室共享） ---------------- */

  const visibleTeleprompterBlocks = useMemo(() => {
    if (!chapter) return []
    const resolvedFn = resolveChapterFootnotes(chapter.blocks)
    return chapter.blocks.filter(
      (b) => !resolvedFn.hiddenBlockIndices.has(b.index) && b.speakText.trim().length > 0
    )
  }, [chapter])

  const renderTeleprompterContent = (mode: 'mobile' | 'desktop') => (
    <div
      onClick={
        mode === 'mobile'
          ? () => {
              triggerHaptic()
              setMobileStage('vinyl')
            }
          : undefined
      }
      className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-2.5"
    >
      {!chapter ? (
        <div
          className="h-full flex flex-col items-center justify-center text-center py-12 space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          <Moon className="w-10 h-10 opacity-30" style={{ color: 'var(--accent)' }} />
          <p className="font-serif text-base font-semibold">哲启明思电台待机中</p>
          <p className="text-xs max-w-xs" style={{ color: 'var(--text-muted)' }}>
            选择任意典籍或点击下方开启「深夜哲思盲盒」，畅听微软神经网络语音朗读全库 {books.length} 部经典。
          </p>
          <button
            onClick={() => {
              triggerHaptic()
              radioEngine.tuneStation('roam')
            }}
            className="mt-1 px-5 py-2.5 rounded-full text-xs font-semibold text-white active:scale-95 transition-transform"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            立即开启哲思盲盒广播
          </button>
        </div>
      ) : (
        visibleTeleprompterBlocks.map((blk) => {
          const active = blk.index === radio.blockIndex
          return (
            <div
              key={blk.id}
              ref={active ? activeParaRef : undefined}
              onClick={(e) => {
                if (mode === 'mobile') {
                  // 手机端：点击原文段落本身平滑返回黑胶唱片舞台，绝不暂停或打断播报！
                  e.stopPropagation()
                  triggerHaptic()
                  setMobileStage('vinyl')
                } else if (!active) {
                  // 桌面端：左侧唱片常驻，点击非当前段落直接跳播；点击当前段落不打断不重启
                  triggerHaptic()
                  radioEngine.jumpToBlock(blk.index)
                }
              }}
              className={`w-full text-left p-3.5 rounded-xl transition-all duration-300 font-serif cursor-pointer flex items-start gap-2.5 group ${
                active ? 'scale-[1.005]' : 'opacity-65 hover:opacity-95'
              }`}
              style={
                active
                  ? {
                      backgroundColor: 'var(--tts-active-bg)',
                      borderLeft: `3px solid ${currentStation.accent}`,
                      color: 'var(--text)',
                      fontSize: '16px',
                      lineHeight: 1.85,
                    }
                  : {
                      fontSize: '14px',
                      lineHeight: 1.75,
                      color: 'var(--text-secondary)',
                    }
              }
            >
              <span className="flex-1 min-w-0">{blk.speakText}</span>
              {active ? (
                <span
                  className="shrink-0 mt-1 px-2 py-0.5 rounded-full text-[10px] font-sans font-semibold flex items-center gap-1"
                  style={{ backgroundColor: 'var(--accent-soft)', color: currentStation.accent }}
                >
                  {isPlaying && (
                    <span className="flex items-end gap-[1.5px] h-2.5">
                      <span className="w-[2px] h-full rounded-full eq-bar" style={{ backgroundColor: currentStation.accent }} />
                      <span className="w-[2px] h-full rounded-full eq-bar" style={{ backgroundColor: currentStation.accent, animationDelay: '180ms' }} />
                    </span>
                  )}
                  <span>{isPlaying ? '播报中' : '当前'}</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    triggerHaptic()
                    radioEngine.jumpToBlock(blk.index)
                  }}
                  aria-label="从此段开始播报"
                  title="从此段开始播报"
                  className="shrink-0 mt-0.5 w-7 h-7 rounded-full border flex items-center justify-center transition-all active:scale-90 opacity-75 group-hover:opacity-100"
                  style={{
                    backgroundColor: 'var(--bg)',
                    borderColor: 'var(--border-strong)',
                    color: currentStation.accent,
                  }}
                >
                  <Play className="w-3 h-3 fill-current ml-0.5" />
                </button>
              )}
            </div>
          )
        })
      )}
    </div>
  )

  const renderVoicesContent = () => (
    <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3">
      <div className="text-xs px-1 flex items-center justify-between gap-2" style={{ color: 'var(--text-secondary)' }}>
        <span className="truncate">支持手机/本机系统默认 TTS 与微软神经网络语音</span>
        <button
          onClick={() => setShowAzureAdvanced((v) => !v)}
          className="underline text-[11px] shrink-0"
          style={{ color: 'var(--accent)' }}
        >
          {showAzureAdvanced ? '收起 Azure' : '自定义 Key'}
        </button>
      </div>

      {showAzureAdvanced && (
        <div
          className="p-3 rounded-xl border space-y-2 text-xs"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          <p style={{ color: 'var(--text-muted)' }}>
            可选：留空默认使用内置免密钥微软神经网络语音；如需个人商用配额可填 Azure Speech Key。
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="password"
              value={radioSettings.azureKey}
              onChange={(e) => onUpdateRadioSettings({ azureKey: e.target.value })}
              placeholder="Azure Speech Key（可选）"
              className="sm:col-span-2 px-2.5 py-2 rounded-xl border bg-transparent outline-none"
              style={{ borderColor: 'var(--border-strong)' }}
            />
            <input
              type="text"
              value={radioSettings.azureRegion}
              onChange={(e) => onUpdateRadioSettings({ azureRegion: e.target.value })}
              placeholder="如 eastasia"
              className="px-2.5 py-2 rounded-xl border bg-transparent outline-none"
              style={{ borderColor: 'var(--border-strong)' }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {CURATED_VOICES.map((v) => {
          const selected = radioSettings.voice === v.shortName
          const isSystem = v.shortName === SYSTEM_TTS_VOICE_ID
          const displayLabel = isSystem
            ? systemTtsEngineName
              ? `系统默认 TTS（${systemTtsEngineName}）`
              : v.label
            : v.label
          const displaySub = isSystem
            ? getPlatform() === 'android'
              ? `跟随手机「文字转语音」系统默认引擎${systemTtsEngineName ? ` · ${systemTtsEngineName}` : ''}`
              : '调用本机系统默认文字转语音引擎 · 离线免网'
            : v.shortName
          return (
            <div
              key={v.shortName}
              onClick={() => {
                triggerHaptic()
                onUpdateRadioSettings({ voice: v.shortName })
                notifyToast(`已切换主播：${displayLabel}`)
              }}
              className="p-3 rounded-xl border cursor-pointer flex items-center justify-between gap-2 transition-all active:scale-[0.99]"
              style={
                selected
                  ? { backgroundColor: 'var(--accent-soft)', borderColor: 'var(--accent)' }
                  : { backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }
              }
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-xs truncate">{displayLabel}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                    style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--accent)' }}
                  >
                    {v.tag}
                  </span>
                </div>
                <div className="text-[10px] font-mono mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                  {displaySub}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  triggerHaptic()
                  handleAudition(v.shortName)
                }}
                className="px-3 py-1.5 rounded-xl text-[11px] font-medium border shrink-0 hover:opacity-80 active:scale-95"
                style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
              >
                {auditioning === v.shortName ? '播放中…' : '试听'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )

  const renderMixerContent = () => (
    <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-5 text-xs">
      {/* 快捷倍速胶囊 */}
      <div>
        <div className="flex justify-between mb-2">
          <span className="font-semibold">播报语速</span>
          <span className="font-mono font-semibold" style={{ color: 'var(--accent)' }}>
            {radioSettings.rate.toFixed(2)}x
          </span>
        </div>
        <div className="grid grid-cols-6 gap-1.5 mb-2.5">
          {SPEED_PRESETS.map((sp) => {
            const active = Math.abs(radioSettings.rate - sp) < 0.02
            return (
              <button
                key={sp}
                onClick={() => {
                  triggerHaptic()
                  onUpdateRadioSettings({ rate: sp })
                }}
                className="py-1.5 rounded-xl text-[11px] font-mono font-medium border transition-colors active:scale-95"
                style={
                  active
                    ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                    : { backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                }
              >
                {sp}x
              </button>
            )
          })}
        </div>
        <input
          type="range"
          min={0.65}
          max={1.75}
          step={0.05}
          value={radioSettings.rate}
          onChange={(e) => onUpdateRadioSettings({ rate: Number(e.target.value) })}
          className="w-full accent-[var(--accent)]"
        />
      </div>

      {/* 音量 / 音调 / 段间停顿 */}
      <div className="space-y-3.5">
        <div>
          <div className="flex justify-between mb-1.5">
            <span className="font-semibold">人声朗读音量</span>
            <span className="font-mono" style={{ color: 'var(--accent)' }}>
              {Math.round(radioSettings.volume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={radioSettings.volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex justify-between mb-1">
              <span>音调微调</span>
              <span className="font-mono" style={{ color: 'var(--accent)' }}>
                {radioSettings.pitch >= 0 ? `+${radioSettings.pitch}` : radioSettings.pitch}Hz
              </span>
            </div>
            <input
              type="range"
              min={-14}
              max={14}
              step={2}
              value={radioSettings.pitch}
              onChange={(e) => onUpdateRadioSettings({ pitch: Number(e.target.value) })}
              className="w-full accent-[var(--accent)]"
            />
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <span>段间停顿</span>
              <span className="font-mono">{radioSettings.paraPauseMs}ms</span>
            </div>
            <input
              type="range"
              min={150}
              max={1400}
              step={50}
              value={radioSettings.paraPauseMs}
              onChange={(e) => onUpdateRadioSettings({ paraPauseMs: Number(e.target.value) })}
              className="w-full accent-[var(--accent)]"
            />
          </div>
        </div>

        <label className="flex items-center justify-between p-3 rounded-xl border cursor-pointer" style={{ borderColor: 'var(--border)' }}>
          <span>每章开篇播报书名与章节导语</span>
          <input
            type="checkbox"
            checked={radioSettings.announceChapter}
            onChange={(e) => onUpdateRadioSettings({ announceChapter: e.target.checked })}
            className="accent-[var(--accent)] w-4 h-4"
          />
        </label>
      </div>

      {/* 伴读白噪音混音台 */}
      <div className="pt-4 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between">
          <span className="font-bold">伴读环境声景（支持锁屏原生混音）</span>
          <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
            音量 {Math.round(radioSettings.ambientVolume * 100)}%
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {AMBIENT_OPTIONS.map((amb) => {
            const active = radioSettings.ambientSound === amb.id
            return (
              <button
                key={amb.id}
                onClick={() => {
                  triggerHaptic()
                  onUpdateRadioSettings({ ambientSound: amb.id })
                }}
                className="p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 active:scale-95"
                style={
                  active
                    ? { backgroundColor: 'var(--accent-soft)', borderColor: 'var(--accent)' }
                    : { backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }
                }
              >
                <div className="mt-0.5" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {amb.icon}
                </div>
                <div>
                  <div className="font-semibold">{amb.label}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {amb.desc}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {radioSettings.ambientSound !== 'none' && (
          <input
            type="range"
            min={0.05}
            max={0.85}
            step={0.05}
            value={radioSettings.ambientVolume}
            onChange={(e) => onUpdateRadioSettings({ ambientVolume: Number(e.target.value) })}
            className="w-full accent-[var(--accent)]"
          />
        )}
      </div>

      {/* 离线语音缓存管理 */}
      <div className="pt-4 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between">
          <span className="font-bold flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            <span>离线语音缓存管理</span>
          </span>
          <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {cacheStats.fileCount} 段 · {formatBytes(cacheStats.totalBytes)}
          </span>
        </div>

        {prefetching.active && prefetching.total > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-mono" style={{ color: 'var(--accent)' }}>
              <span>正在预缓存本章微软神经网络音频…</span>
              <span>
                {prefetching.done} / {prefetching.total}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)' }}>
              <div
                className="h-full transition-all"
                style={{
                  width: `${Math.round((prefetching.done / Math.max(1, prefetching.total)) * 100)}%`,
                  backgroundColor: 'var(--accent)',
                }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handleStartPrefetchChapter}
            disabled={!radio.bookId}
            className="flex-1 py-2.5 px-3 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40 transition-transform active:scale-95"
            style={{ backgroundColor: prefetching.active ? '#dc2626' : 'var(--accent)' }}
          >
            <CloudDownload className="w-3.5 h-3.5" />
            <span>{prefetching.active ? '停止预缓存' : '预缓存本章离线收听'}</span>
          </button>

          <button
            onClick={handleClearCache}
            disabled={cacheStats.fileCount === 0}
            className="py-2.5 px-3 rounded-xl border text-xs font-medium flex items-center gap-1 disabled:opacity-40 hover:text-red-500 active:scale-95"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>清理</span>
          </button>
        </div>
      </div>
    </div>
  )

  const renderQueueContent = (closeSheetOnPlay = false) => (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* 顶部子模式切换 + 本台检索栏 */}
      <div
        className="px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 shrink-0"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}
      >
        <div
          className="inline-flex p-0.5 rounded-xl border text-[11px]"
          style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
        >
          <button
            onClick={() => setProgramSubTab('collection')}
            className="px-3 py-1 rounded-lg font-medium transition-colors"
            style={
              programSubTab === 'collection'
                ? { backgroundColor: 'var(--bg-card)', color: 'var(--accent)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }
                : { color: 'var(--text-secondary)' }
            }
          >
            本台合集 ({stationBookCount})
          </button>
          <button
            onClick={() => setProgramSubTab('personal')}
            className="px-3 py-1 rounded-lg font-medium transition-colors"
            style={
              programSubTab === 'personal'
                ? { backgroundColor: 'var(--bg-card)', color: 'var(--accent)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }
                : { color: 'var(--text-secondary)' }
            }
          >
            私人播单 ({queue.length})
          </button>
        </div>

        {programSubTab === 'collection' ? (
          <div className="flex items-center gap-1.5 flex-1 justify-end min-w-[140px]">
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs flex-1 max-w-[210px]"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={collectionFilter}
                onChange={(e) => setCollectionFilter(e.target.value)}
                placeholder="筛选本台书目…"
                className="bg-transparent outline-none w-full text-xs"
                style={{ color: 'var(--text)' }}
              />
              {collectionFilter && (
                <button onClick={() => setCollectionFilter('')} className="hover:opacity-70">
                  <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>
            {radio.stationId === 'roam' && (
              <button
                onClick={() => {
                  const nextSeed = radioEngine.reshuffleRoam()
                  setRoamSeed(nextSeed)
                  notifyToast('已重新洗牌漫游待播序列')
                }}
                className="px-2.5 py-1.5 rounded-xl border text-[11px] flex items-center gap-1 hover:opacity-80 shrink-0"
                style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--accent)' }}
              >
                <Shuffle className="w-3 h-3" />
                <span>洗牌</span>
              </button>
            )}
          </div>
        ) : (
          queue.length > 0 && (
            <button
              onClick={() => {
                onClearQueue()
                notifyToast('已清空私人播单')
              }}
              className="text-[11px] px-2.5 py-1 rounded-xl border hover:text-red-500 transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              清空播单
            </button>
          )
        )}
      </div>

      {/* 主体滚动区 */}
      {programSubTab === 'collection' ? (
        <div className="flex-1 overflow-y-auto overscroll-contain p-3.5 space-y-4">
          {filteredStationGroups.length === 0 ? (
            <div className="py-12 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              当前频道内未找到匹配「{collectionFilter}」的书目
            </div>
          ) : (
            filteredStationGroups.map((group) => (
              <div key={group.label} className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold tracking-wider" style={{ color: currentStation.accent }}>
                    {group.label}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    {group.books.length} 册
                  </span>
                </div>

                <div className="space-y-1.5">
                  {group.books.map((book) => {
                    const isCurrentBook = radio.bookId === book.id
                    const isExpanded = expandedBookId === book.id
                    const cachedMeta = metaCache[book.id]
                    const isLoadingMeta = loadingMetaId === book.id
                    const visibleChapters = cachedMeta
                      ? cachedMeta.chapters.filter((ch) => {
                          if (hideFrontMatterInList && ch.isFrontMatter) return false
                          const cq = expandedChapterFilter.trim().toLowerCase()
                          if (cq && !ch.title.toLowerCase().includes(cq)) return false
                          return true
                        })
                      : []

                    return (
                      <div
                        key={book.id}
                        className="rounded-xl border overflow-hidden transition-all"
                        style={{
                          backgroundColor: isCurrentBook ? 'var(--tts-active-bg)' : 'var(--bg)',
                          borderColor: isCurrentBook ? currentStation.accent : 'var(--border)',
                        }}
                      >
                        <div
                          onClick={() => handleToggleExpandBook(book.id)}
                          className="px-3 py-2.5 flex items-center justify-between gap-2.5 cursor-pointer hover:opacity-95 select-none"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-serif font-bold text-xs truncate">{book.title}</span>
                                {isCurrentBook && (
                                  <span
                                    className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 text-white"
                                    style={{ backgroundColor: currentStation.accent }}
                                  >
                                    {isPlaying ? '播送中' : '当前'}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] truncate mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                                <span>{book.author}</span>
                                <span>·</span>
                                <span>{book.chapterCount} 章</span>
                              </div>
                            </div>
                          </div>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  triggerHaptic()
                                  const stTarget = radio.stationId === 'queue' ? 'current' : radio.stationId
                                  radioEngine.playBookWithResume(book.id, book.firstBodyChapter || 0, stTarget)
                                  if (closeSheetOnPlay) setActiveSheet(null)
                                }}
                                className="px-3 py-1.5 rounded-full text-[11px] font-medium flex items-center gap-1 shrink-0 active:scale-95"
                                style={
                                  isCurrentBook
                                    ? { backgroundColor: currentStation.accent, color: '#fff' }
                                    : {
                                        backgroundColor: 'var(--bg-card)',
                                        color: 'var(--accent)',
                                        border: '1px solid var(--border-strong)',
                                      }
                                }
                              >
                                <Play className="w-3 h-3 fill-current" />
                                <span>{radioBookProgressMap[book.id] ? '续播' : '播送'}</span>
                              </button>
                        </div>

                        {isExpanded && (
                          <div
                            className="border-t px-3 py-2.5 space-y-2"
                            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-card)' }}
                          >
                            {isLoadingMeta ? (
                              <div className="py-4 flex items-center justify-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>展开章节目录…</span>
                              </div>
                            ) : cachedMeta ? (
                              <>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  {cachedMeta.chapters.length > 10 ? (
                                    <div
                                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] flex-1 min-w-[140px]"
                                      style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                                    >
                                      <Search className="w-3 h-3 shrink-0" style={{ color: 'var(--text-muted)' }} />
                                      <input
                                        type="text"
                                        value={expandedChapterFilter}
                                        onChange={(e) => setExpandedChapterFilter(e.target.value)}
                                        placeholder={`筛选 ${cachedMeta.chapterCount} 章…`}
                                        className="bg-transparent outline-none w-full"
                                        style={{ color: 'var(--text)' }}
                                      />
                                    </div>
                                  ) : (
                                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                      点击章节立即播报，点 + 加入私人播单
                                    </span>
                                  )}

                                  <label className="flex items-center gap-1 text-[10px] cursor-pointer select-none shrink-0" style={{ color: 'var(--text-secondary)' }}>
                                    <input
                                      type="checkbox"
                                      checked={hideFrontMatterInList}
                                      onChange={(e) => setHideFrontMatterInList(e.target.checked)}
                                      className="accent-[var(--accent)]"
                                    />
                                    <span>隐藏扉页</span>
                                  </label>
                                </div>

                                <div className="max-h-56 overflow-y-auto overscroll-contain space-y-1 pr-0.5">
                                  {visibleChapters.map((ch) => {
                                    const activeCh = isCurrentBook && radio.chapterIndex === ch.index
                                    const inPersonal = queueKeySet.has(`${book.id}#${ch.index}`)
                                    return (
                                      <div
                                        key={ch.index}
                                        onClick={() => {
                                          triggerHaptic()
                                          const stTarget = radio.stationId === 'queue' ? 'current' : radio.stationId
                                          radioEngine.playChapter(book.id, ch.index, 0, stTarget, { allowFrontMatter: true })
                                          if (closeSheetOnPlay) setActiveSheet(null)
                                        }}
                                        className="px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 cursor-pointer transition-colors hover:opacity-90"
                                        style={
                                          activeCh
                                            ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600 }
                                            : { backgroundColor: 'var(--bg)', color: 'var(--text)' }
                                        }
                                      >
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                          <span className="text-[10px] font-mono w-5 text-right shrink-0 opacity-65">
                                            {ch.index + 1}.
                                          </span>
                                          <span className="text-xs truncate">{ch.title}</span>
                                        </div>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            if (inPersonal) {
                                              notifyToast('该章节已在私人播单中')
                                              return
                                            }
                                            onAddToQueue({
                                              id: `q_${book.id}_${ch.index}_${Date.now().toString(36)}`,
                                              bookId: book.id,
                                              bookTitle: book.title,
                                              author: book.author,
                                              chapterIndex: ch.index,
                                              chapterTitle: ch.title,
                                            })
                                            notifyToast(`已加入私人播单：${ch.title}`)
                                          }}
                                          className="w-7 h-7 rounded-lg flex items-center justify-center border shrink-0"
                                          style={
                                            inPersonal
                                              ? { backgroundColor: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' }
                                              : { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                                          }
                                        >
                                          {inPersonal ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                                        </button>
                                      </div>
                                    )
                                  })}
                                </div>
                              </>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-2.5">
          {queue.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-10 space-y-3" style={{ color: 'var(--text-muted)' }}>
              <ListMusic className="w-9 h-9 opacity-35" />
              <div>
                <p className="text-sm font-serif font-semibold" style={{ color: 'var(--text)' }}>
                  私人播单尚未编排
                </p>
                <p className="text-xs mt-1 max-w-xs">
                  在「本台合集」展开书籍点 + 收藏章节，或一键载入跨学派精选哲思播单。
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  onClick={() => setProgramSubTab('collection')}
                  className="px-3.5 py-2 rounded-full text-xs font-medium border"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
                >
                  去本台合集选章
                </button>
                <button
                  onClick={handleSeedStarterQueue}
                  disabled={seedingStarter}
                  className="px-3.5 py-2 rounded-full text-xs font-semibold text-white flex items-center gap-1.5 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  {seedingStarter ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>一键载入精选 6 章</span>
                </button>
              </div>
            </div>
          ) : (
            queue.map((item, idx) => {
              const isPlayingThis = radio.bookId === item.bookId && radio.chapterIndex === item.chapterIndex
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    triggerHaptic()
                    radioEngine.playChapter(item.bookId, item.chapterIndex, 0, 'queue', { allowFrontMatter: true })
                    if (closeSheetOnPlay) setActiveSheet(null)
                  }}
                  className="p-3 rounded-xl border flex items-center justify-between gap-2.5 cursor-pointer hover:opacity-95"
                  style={{
                    backgroundColor: isPlayingThis ? 'var(--tts-active-bg)' : 'var(--bg)',
                    borderColor: isPlayingThis ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="font-mono text-xs w-5 text-center shrink-0" style={{ color: isPlayingThis ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-serif font-bold text-xs truncate">{item.chapterTitle}</div>
                      <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                        《{item.bookTitle}》 · {item.author}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onMoveQueueItem(idx, -1)}
                      disabled={idx === 0}
                      className="p-1.5 rounded-lg disabled:opacity-25"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onMoveQueueItem(idx, 1)}
                      disabled={idx === queue.length - 1}
                      className="p-1.5 rounded-lg disabled:opacity-25"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onRemoveQueueItem(item.id)}
                      className="p-1.5 rounded-lg hover:text-red-500"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className="h-full w-full overflow-hidden relative">
      {/* ========================================================================
          一、移动端原生播客/音乐播放器架构（< 1024px）：单屏沉浸、零嵌套滚动、全动画抽屉
         ======================================================================== */}
      <div className="lg:hidden h-full flex flex-col overflow-hidden select-none relative">
        {/* 顶部环境光晕 */}
        <div
          className="absolute top-12 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full blur-3xl opacity-20 pointer-events-none transition-colors duration-700"
          style={{ backgroundColor: currentStation.accent }}
        />

        {/* 1. 顶部横滑 FM 主题频道胶囊条 */}
        <div className="shrink-0 px-3.5 pt-3 pb-2 flex items-center gap-2 z-10">
          <div className="flex-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {RADIO_STATIONS.map((st) => {
              const active = st.id === radio.stationId
              return (
                <button
                  key={st.id}
                  onClick={() => {
                    triggerHaptic()
                    radioEngine.tuneStation(st.id)
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all active:scale-95 shrink-0 flex items-center gap-1"
                  style={
                    active
                      ? {
                          backgroundColor: st.accent,
                          color: '#fff',
                          borderColor: st.accent,
                          boxShadow: `0 4px 12px ${st.accent}35`,
                        }
                      : {
                          backgroundColor: 'var(--bg-card)',
                          color: 'var(--text-secondary)',
                          borderColor: 'var(--border)',
                        }
                  }
                >
                  <span className="font-mono text-[10px] opacity-85">{st.freq.replace('FM ', '')}</span>
                  <span>{st.name}</span>
                </button>
              )
            })}
          </div>

          {isActiveRadio && (
            <button
              onClick={() => {
                triggerHaptic()
                onCancelRadio()
              }}
              className="w-8 h-8 rounded-full border flex items-center justify-center shrink-0 active:scale-90"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
              aria-label="停止并关闭电台"
              title="停止并关闭电台"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 2. 中央沉浸主舞台（黑胶唱片舞台 <-> 随声同步字幕舞台 一键丝滑切换） */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-5 z-10">
          {mobileStage === 'vinyl' ? (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-evenly py-1 text-center">
              {/* 旋转哲学黑胶唱片（轻点唱片进入随声字幕舞台） */}
              <button
                onClick={() => {
                  triggerHaptic()
                  setMobileStage('lyrics')
                }}
                className="relative group focus:outline-none active:scale-95 transition-transform"
                aria-label="切换随声字幕"
              >
                <div
                  className={`w-40 h-40 sm:w-48 sm:h-48 rounded-full flex items-center justify-center shadow-2xl border-4 ${
                    isPlaying ? 'vinyl-spin' : 'vinyl-spin vinyl-paused'
                  }`}
                  style={{
                    background:
                      'repeating-radial-gradient(circle at center, #1c1a18 0px, #1c1a18 3px, #11100f 4px, #25221e 6px)',
                    borderColor: `${currentStation.accent}70`,
                  }}
                >
                  <div
                    className="w-20 h-20 sm:w-24 sm:h-24 rounded-full flex flex-col items-center justify-center p-2 text-white shadow-inner"
                    style={{
                      background: `linear-gradient(145deg, ${currentStation.accent}, #221d1a)`,
                    }}
                  >
                    <span className="text-[9px] font-mono tracking-widest opacity-85">{currentStation.freq}</span>
                    <span className="font-serif font-bold text-xs line-clamp-2 leading-tight mt-0.5">
                      {radio.bookTitle.slice(0, 10)}
                    </span>
                    <div className="w-2.5 h-2.5 rounded-full bg-black/75 mt-1 border border-white/40" />
                  </div>
                </div>
                <span
                  className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-medium border shadow-sm whitespace-nowrap"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
                >
                  轻点查看随声字幕
                </span>
              </button>

              {/* 书名与可点击切换章节胶囊（点击直接平滑滑出精美底部抽屉，绝非丑陋原生下拉框！） */}
              <div className="w-full max-w-sm space-y-1.5 pt-2">
                <button
                  onClick={() => {
                    triggerHaptic()
                    setBookPickerQuery('')
                    setActiveSheet('books')
                  }}
                  className="mx-auto max-w-full inline-flex items-center justify-center gap-1 font-serif font-bold text-lg leading-snug active:opacity-75"
                >
                  <span className="truncate">{radio.bookTitle}</span>
                  <ChevronDown className="w-4 h-4 shrink-0 opacity-60" />
                </button>

                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      if (!bookMeta) {
                        setActiveSheet('books')
                        return
                      }
                      triggerHaptic()
                      setChapterPickerQuery('')
                      setActiveSheet('chapters')
                    }}
                    className="max-w-full inline-flex items-center gap-1 px-3 py-1 rounded-full border text-xs transition-colors active:scale-95"
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderColor: 'var(--border)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span className="truncate max-w-[220px]">
                      {bookMeta
                        ? `第 ${radio.chapterIndex + 1}/${bookMeta.chapterCount} 章 · ${radio.chapterTitle}`
                        : radio.chapterTitle}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                  </button>

                  {radio.isOfflineFallback && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={
                        radioSettings.voice === SYSTEM_TTS_VOICE_ID
                          ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }
                          : { backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#b45309' }
                      }
                    >
                      {radioSettings.voice === SYSTEM_TTS_VOICE_ID ? (
                        <>
                          <Mic2 className="w-3 h-3" /> {systemTtsEngineName || '系统默认 TTS'}
                        </>
                      ) : (
                        <>
                          <WifiOff className="w-3 h-3" /> 离线降级语音
                        </>
                      )}
                    </span>
                  )}
                </div>

                {radio.errorMessage && (
                  <p className="text-[11px] px-3 py-1 rounded-xl bg-red-500/10 text-red-500 truncate">
                    {radio.errorMessage}
                  </p>
                )}
              </div>

              {/* 纤细实时频谱 + 2 行当前朗读字幕预览 */}
              <div className="w-full max-w-sm space-y-2">
                <canvas ref={mobileCanvasRef} className="w-full h-9 block" />

                <div
                  onClick={() => {
                    triggerHaptic()
                    setMobileStage('lyrics')
                  }}
                  className="w-full px-3.5 py-2.5 rounded-2xl border text-left cursor-pointer active:scale-[0.99] transition-transform"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
                >
                  <p className="font-serif text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text)' }}>
                    {radio.currentText || '点击下方播放按钮，开启微软神经网络哲思广播…'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* 随声同步字幕沉浸舞台 */
            <div
              className="flex-1 min-h-0 my-1.5 rounded-2xl border flex flex-col overflow-hidden animate-backdrop-in"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <div
                className="px-3.5 py-2.5 border-b flex items-center justify-between gap-2 shrink-0"
                style={{ borderColor: 'var(--border)' }}
              >
                <button
                  onClick={() => {
                    triggerHaptic()
                    setMobileStage('vinyl')
                  }}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium border flex items-center gap-1 active:scale-95"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--accent)' }}
                >
                  <Disc3 className="w-3.5 h-3.5" />
                  <span>唱片</span>
                </button>
                <div className="flex-1 min-w-0 text-center">
                  <div className="font-serif font-bold text-xs truncate">{radio.chapterTitle}</div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                    轻点原文返回唱片 · 点右侧 ▶ 跳播
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={handleCollectCurrentQuote}
                    disabled={!radio.currentText}
                    className="px-2 py-1 rounded-lg text-[11px] border disabled:opacity-35"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  >
                    摘录
                  </button>
                  <button
                    onClick={() => radio.currentText && setQuoteText(radio.currentText)}
                    disabled={!radio.currentText}
                    className="px-2 py-1 rounded-lg text-[11px] border disabled:opacity-35"
                    style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
                  >
                    海报
                  </button>
                </div>
              </div>
              {renderTeleprompterContent('mobile')}
            </div>
          )}
        </div>

        {/* 3. 底部黄金拇指播控区（全章交互进度轴 + 5键主控 + 5个Bottom Sheet快捷入口） */}
        <div className="shrink-0 px-5 pt-1 pb-3 z-10 space-y-2.5">
          {renderChapterProgressBar(true)}

          {/* 5 键黄金拇指播控行 */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => {
                triggerHaptic()
                radioEngine.seekBy(-15)
              }}
              className="w-10 h-10 rounded-full flex flex-col items-center justify-center border active:scale-90 transition-transform"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              aria-label="快退15秒"
            >
              <RotateCcw className="w-4 h-4" />
              <span className="text-[8px] font-mono leading-none -mt-0.5">15</span>
            </button>

            <button
              onClick={() => {
                triggerHaptic()
                radioEngine.prevSegmentOrChapter()
              }}
              className="w-11 h-11 rounded-full flex items-center justify-center border active:scale-90 transition-transform"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text)' }}
              aria-label="上一段"
            >
              <SkipBack className="w-5 h-5" />
            </button>

            <button
              onClick={() => {
                triggerHaptic()
                radioEngine.togglePlayPause()
              }}
              className="w-[62px] h-[62px] rounded-full flex items-center justify-center text-white shadow-xl active:scale-90 transition-transform"
              style={{
                background: `linear-gradient(135deg, ${currentStation.accent}, var(--gold))`,
                boxShadow: `0 10px 26px ${currentStation.accent}45`,
              }}
              aria-label={isPlaying ? '暂停' : '播放'}
            >
              {isLoading ? (
                <Loader2 className="w-7 h-7 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-7 h-7 fill-current" />
              ) : (
                <Play className="w-7 h-7 fill-current ml-1" />
              )}
            </button>

            <button
              onClick={() => {
                triggerHaptic()
                radioEngine.nextSegment()
              }}
              className="w-11 h-11 rounded-full flex items-center justify-center border active:scale-90 transition-transform"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text)' }}
              aria-label="下一段"
            >
              <SkipForward className="w-5 h-5" />
            </button>

            <button
              onClick={() => {
                triggerHaptic()
                radioEngine.seekBy(15)
              }}
              className="w-10 h-10 rounded-full flex flex-col items-center justify-center border active:scale-90 transition-transform"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              aria-label="快进15秒"
            >
              <RotateCw className="w-4 h-4" />
              <span className="text-[8px] font-mono leading-none -mt-0.5">15</span>
            </button>
          </div>

          {/* 底部 5 项工具栏（全部呼出丝滑主题 Bottom Sheet，彻底告别原生弹窗） */}
          <div className="grid grid-cols-5 gap-1 pt-1">
            <button
              onClick={() => {
                triggerHaptic()
                setActiveSheet('queue')
              }}
              className="py-1.5 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium active:scale-95"
              style={{ color: activeSheet === 'queue' ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              <ListMusic className="w-[18px] h-[18px]" />
              <span>播单</span>
            </button>

            <button
              onClick={() => {
                triggerHaptic()
                setActiveSheet('voices')
              }}
              className="py-1.5 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium active:scale-95"
              style={{ color: activeSheet === 'voices' ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              <Mic2 className="w-[18px] h-[18px]" />
              <span className="truncate max-w-full">{voiceShortLabel}</span>
            </button>

            <button
              onClick={() => {
                triggerHaptic()
                setActiveSheet('mixer')
              }}
              className="py-1.5 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium active:scale-95"
              style={{ color: activeSheet === 'mixer' ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              <Sliders className="w-[18px] h-[18px]" />
              <span>{radioSettings.rate.toFixed(1)}x</span>
            </button>

            <button
              onClick={() => {
                triggerHaptic()
                setActiveSheet('sleep')
              }}
              className="py-1.5 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium active:scale-95"
              style={{ color: sleepCountdown ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              <Clock className="w-[18px] h-[18px]" />
              <span className="truncate max-w-full">{sleepCountdown || '定时'}</span>
            </button>

            <button
              onClick={() => {
                triggerHaptic()
                if (radio.bookId) {
                  onOpenReader(radio.bookId, radio.chapterIndex, radio.blockIndex)
                } else {
                  setActiveSheet('books')
                }
              }}
              className="py-1.5 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium active:scale-95"
              style={{ color: radio.bookId ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              <BookOpen className="w-[18px] h-[18px]" />
              <span>{radio.bookId ? '读正文' : '选书'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================
          二、桌面宽屏双栏 FM 演播室（>= 1024px）：大屏专业控制台，同样零原生 <select>
         ======================================================================== */}
      <div className="hidden lg:block h-full overflow-y-auto px-8 pt-5 pb-24">
        <div className="max-w-6xl mx-auto space-y-5">
          {/* 顶部模拟 FM 调频刻度尺 */}
          <section
            className="rounded-2xl border p-5 relative overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
              boxShadow: 'var(--shadow-soft)',
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    backgroundColor: isPlaying ? '#ef4444' : 'var(--text-muted)',
                    boxShadow: isPlaying ? '0 0 12px #ef4444' : 'none',
                  }}
                />
                <span className="text-[11px] font-mono font-bold tracking-[0.2em] uppercase" style={{ color: 'var(--accent)' }}>
                  ON AIR · MICROSOFT NEURAL TTS STUDIO
                </span>
                {radio.isOfflineFallback && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                    style={
                      radioSettings.voice === SYSTEM_TTS_VOICE_ID
                        ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }
                        : { backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#b45309' }
                    }
                  >
                    {radioSettings.voice === SYSTEM_TTS_VOICE_ID ? (
                      <>
                        <Mic2 className="w-3 h-3" />
                        {systemTtsEngineName || '系统默认 TTS'}
                      </>
                    ) : (
                      <>
                        <WifiOff className="w-3 h-3" />
                        离线降级语音
                      </>
                    )}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  主播：{voiceObj.label} · {radioSettings.rate.toFixed(2)}x
                </span>
                <button
                  onClick={onCancelRadio}
                  className="px-2.5 py-1 rounded-full border text-[11px] font-medium flex items-center gap-1 transition-colors hover:bg-red-500/15 hover:text-red-500 hover:border-red-500/40"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
                >
                  <X className="w-3.5 h-3.5" />
                  <span>关闭电台</span>
                </button>
              </div>
            </div>

            {/* 物理阻尼感 FM 频率刻度槽 */}
            <div
              className="relative rounded-xl border px-3 py-3 mb-3 overflow-hidden"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <div className="flex justify-between items-end h-5 opacity-35 pointer-events-none select-none">
                {Array.from({ length: 48 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="w-[1px] rounded-full"
                    style={{
                      height: idx % 8 === 0 ? '18px' : idx % 4 === 0 ? '12px' : '7px',
                      backgroundColor: 'var(--text)',
                    }}
                  />
                ))}
              </div>
              <div
                className="absolute top-0 bottom-0 w-0.5 transition-all duration-500 ease-out pointer-events-none"
                style={{
                  left: `${needlePct}%`,
                  backgroundColor: currentStation.accent,
                  boxShadow: `0 0 14px ${currentStation.accent}`,
                }}
              >
                <div className="w-2.5 h-2.5 rounded-full -ml-[4px] mt-1" style={{ backgroundColor: currentStation.accent }} />
              </div>
            </div>

            {/* 9 个互斥分类哲学主题调频频道 */}
            <div className="grid grid-cols-3 xl:grid-cols-9 gap-2">
              {RADIO_STATIONS.map((st) => {
                const active = st.id === radio.stationId
                return (
                  <button
                    key={st.id}
                    onClick={() => radioEngine.tuneStation(st.id)}
                    className="text-left p-2.5 rounded-xl border transition-all duration-200 hover:-translate-y-0.5"
                    style={
                      active
                        ? {
                            backgroundColor: `${st.accent}1a`,
                            borderColor: st.accent,
                            boxShadow: `0 4px 16px ${st.accent}24`,
                          }
                        : {
                            backgroundColor: 'var(--bg)',
                            borderColor: 'var(--border)',
                          }
                    }
                  >
                    <div className="font-mono text-[11px] font-bold" style={{ color: st.accent }}>
                      {st.freq}
                    </div>
                    <div className="font-serif font-bold text-xs mt-0.5 truncate">{st.name}</div>
                    <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {st.subtitle}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          {/* 主控制台双栏布局 */}
          <div className="grid grid-cols-12 gap-5 items-start">
            {/* 左侧：黑胶转盘 + 频谱 + 播控 */}
            <section
              className="col-span-5 rounded-2xl border p-5 flex flex-col items-center text-center relative overflow-hidden"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border)',
                boxShadow: 'var(--shadow-soft)',
              }}
            >
              <div
                className="absolute -top-16 w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none transition-colors duration-700"
                style={{ backgroundColor: currentStation.accent }}
              />

              <div className="relative my-3">
                <div
                  className={`w-52 h-52 rounded-full flex items-center justify-center shadow-2xl border-4 ${
                    isPlaying ? 'vinyl-spin' : 'vinyl-spin vinyl-paused'
                  }`}
                  style={{
                    background:
                      'repeating-radial-gradient(circle at center, #1c1a18 0px, #1c1a18 3px, #11100f 4px, #25221e 6px)',
                    borderColor: `${currentStation.accent}66`,
                  }}
                >
                  <div
                    className="w-24 h-24 rounded-full flex flex-col items-center justify-center p-2 text-white shadow-inner"
                    style={{ background: `linear-gradient(145deg, ${currentStation.accent}, #221d1a)` }}
                  >
                    <span className="text-[9px] font-mono tracking-widest opacity-85">{currentStation.freq}</span>
                    <span className="font-serif font-bold text-xs line-clamp-2 leading-tight mt-0.5">
                      {radio.bookTitle.slice(0, 10)}
                    </span>
                    <div className="w-2.5 h-2.5 rounded-full bg-black/75 mt-1 border border-white/40" />
                  </div>
                </div>
              </div>

              <div className="mt-2 w-full">
                <div className="text-[11px] font-medium" style={{ color: currentStation.accent }}>
                  {currentStation.name} · {radio.author}
                </div>
                <h2 className="font-serif font-bold text-xl mt-1 line-clamp-2">{radio.bookTitle}</h2>
                <p className="text-xs mt-1 line-clamp-1" style={{ color: 'var(--text-secondary)' }}>
                  {radio.chapterTitle}
                </p>
                {radio.errorMessage && (
                  <p className="text-xs mt-2 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500">{radio.errorMessage}</p>
                )}
              </div>

              <div className="w-full mt-4 mb-2">
                <canvas ref={desktopCanvasRef} className="w-full h-16 block" />
              </div>

              {renderChapterProgressBar(false)}

              {/* 播控按钮组 */}
              <div className="flex items-center justify-center gap-3 mt-1">
                <button
                  onClick={() => radioEngine.tuneStation('roam')}
                  className="w-9 h-9 rounded-full flex items-center justify-center border transition-transform active:scale-90"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  title="随机换一篇哲学经典"
                >
                  <Shuffle className="w-4 h-4" />
                </button>
                <button
                  onClick={() => radioEngine.prevSegmentOrChapter()}
                  className="w-9 h-9 rounded-full flex items-center justify-center border transition-transform active:scale-90"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                  title="上一段 / 上一章"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
                <button
                  onClick={() => radioEngine.seekBy(-15)}
                  className="w-9 h-9 rounded-full flex flex-col items-center justify-center border transition-transform active:scale-90"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  title="快退 15 秒"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="text-[8px] font-mono leading-none -mt-0.5">15</span>
                </button>
                <button
                  onClick={() => radioEngine.togglePlayPause()}
                  className="w-16 h-16 rounded-full flex items-center justify-center text-white shadow-xl transition-transform active:scale-90 hover:scale-105"
                  style={{ background: `linear-gradient(135deg, ${currentStation.accent}, var(--gold))` }}
                  title={isPlaying ? '暂停播报' : '开始微软神经网络电台播报'}
                >
                  {isLoading ? (
                    <Loader2 className="w-7 h-7 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="w-7 h-7 fill-current" />
                  ) : (
                    <Play className="w-7 h-7 fill-current ml-1" />
                  )}
                </button>
                <button
                  onClick={() => radioEngine.seekBy(15)}
                  className="w-9 h-9 rounded-full flex flex-col items-center justify-center border transition-transform active:scale-90"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  title="快进 15 秒"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span className="text-[8px] font-mono leading-none -mt-0.5">15</span>
                </button>
                <button
                  onClick={() => radioEngine.nextSegment()}
                  className="w-9 h-9 rounded-full flex items-center justify-center border transition-transform active:scale-90"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                  title="下一段"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
                <button
                  onClick={() => radio.bookId && onOpenReader(radio.bookId, radio.chapterIndex, radio.blockIndex)}
                  disabled={!radio.bookId}
                  className="w-9 h-9 rounded-full flex items-center justify-center border disabled:opacity-35 transition-transform active:scale-90"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--accent)' }}
                  title="跳转阅读当前正文"
                >
                  <BookOpen className="w-4 h-4" />
                </button>
              </div>

              {/* 桌面音量调节器 */}
              <div
                className="w-full mt-4 px-3.5 py-2.5 rounded-xl border flex items-center gap-3"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <button
                  onClick={handleToggleMute}
                  className="p-1 rounded-lg transition-colors hover:opacity-80 shrink-0"
                  style={{ color: radioSettings.volume <= 0.01 ? 'var(--text-muted)' : 'var(--accent)' }}
                >
                  {radioSettings.volume <= 0.01 ? (
                    <VolumeX className="w-4 h-4" />
                  ) : radioSettings.volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={radioSettings.volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  aria-label="电台朗读音量"
                  className="flex-1 accent-[var(--accent)] cursor-pointer"
                />
                <span className="text-[11px] font-mono w-9 text-right shrink-0" style={{ color: 'var(--text-secondary)' }}>
                  {Math.round(radioSettings.volume * 100)}%
                </span>
              </div>

              {/* 主题化选书与切章按钮（取代原生 <select>） */}
              <div className="w-full mt-3 grid grid-cols-2 gap-2 text-left">
                <button
                  onClick={() => {
                    setBookPickerQuery('')
                    setActiveSheet('books')
                  }}
                  className="w-full px-3 py-2 rounded-xl border text-xs flex items-center justify-between gap-1.5 hover:opacity-90"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  <span className="truncate">{radio.bookId ? `《${radio.bookTitle}》` : `选择典籍 (${books.length}册)`}</span>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
                </button>

                <button
                  onClick={() => {
                    if (!bookMeta) return
                    setChapterPickerQuery('')
                    setActiveSheet('chapters')
                  }}
                  disabled={!bookMeta}
                  className="w-full px-3 py-2 rounded-xl border text-xs flex items-center justify-between gap-1.5 disabled:opacity-45 hover:opacity-90"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  <span className="truncate">
                    {bookMeta ? `${radio.chapterIndex + 1}. ${radio.chapterTitle}` : '选择章节…'}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
                </button>
              </div>

              {/* 快捷动作条 */}
              <div className="w-full mt-4 pt-4 border-t flex flex-wrap items-center justify-center gap-2" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={handleCollectCurrentQuote}
                  disabled={!radio.currentText}
                  className="px-3 py-1.5 rounded-full text-xs border flex items-center gap-1 disabled:opacity-40 hover:opacity-85"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--gold)' }} />
                  <span>摘录此段</span>
                </button>
                <button
                  onClick={() => radio.currentText && setQuoteText(radio.currentText)}
                  disabled={!radio.currentText}
                  className="px-3 py-1.5 rounded-full text-xs border flex items-center gap-1 disabled:opacity-40 hover:opacity-85"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <Radio className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                  <span>金句海报</span>
                </button>
                <button
                  onClick={() => setActiveSheet('sleep')}
                  className="px-3 py-1.5 rounded-full text-xs border flex items-center gap-1 hover:opacity-85"
                  style={
                    sleepCountdown
                      ? { backgroundColor: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' }
                      : { backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }
                  }
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>{sleepCountdown ? `定时 ${sleepCountdown}` : '睡眠定时'}</span>
                </button>
              </div>
            </section>

            {/* 右侧：随声字幕舞台 / 微软音色 / 调音声景 / 节目单 */}
            <section
              className="col-span-7 rounded-2xl border flex flex-col overflow-hidden"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border)',
                boxShadow: 'var(--shadow-soft)',
                minHeight: '520px',
                maxHeight: '640px',
              }}
            >
              <div className="p-2 border-b grid grid-cols-4 gap-1 shrink-0" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}>
                {(
                  [
                    ['teleprompter', '随声字幕', <FileText className="w-3.5 h-3.5" />],
                    ['voices', '微软音色', <Mic2 className="w-3.5 h-3.5" />],
                    ['mixer', '调音·声景', <Sliders className="w-3.5 h-3.5" />],
                    ['queue', `节目单(${radio.stationId === 'queue' ? queue.length : stationBookCount})`, <ListMusic className="w-3.5 h-3.5" />],
                  ] as const
                ).map(([id, label, icon]) => (
                  <button
                    key={id}
                    onClick={() => setStudioTab(id)}
                    className="py-2 px-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
                    style={
                      studioTab === id
                        ? { backgroundColor: 'var(--bg-card)', color: 'var(--accent)', boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }
                        : { color: 'var(--text-secondary)' }
                    }
                  >
                    {icon}
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>

              {studioTab === 'teleprompter' && renderTeleprompterContent('desktop')}
              {studioTab === 'voices' && renderVoicesContent()}
              {studioTab === 'mixer' && renderMixerContent()}
              {studioTab === 'queue' && renderQueueContent(false)}
            </section>
          </div>
        </div>
      </div>

      {/* ========================================================================
          三、全局统一主题化动画 Bottom Sheet / Modal（彻底取代所有原生 <select>）
         ======================================================================== */}
      {activeSheet && (
        <div
          className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/45 backdrop-blur-[2px] animate-backdrop-in"
          onClick={() => setActiveSheet(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full lg:max-w-lg max-h-[82vh] rounded-t-3xl lg:rounded-2xl border-t lg:border shadow-2xl flex flex-col overflow-hidden safe-bottom animate-sheet-up"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
          >
            {/* 移动端拖拽指示横条 */}
            <div className="flex lg:hidden justify-center pt-2.5 pb-0.5 shrink-0">
              <span className="w-10 h-1 rounded-full opacity-30" style={{ backgroundColor: 'var(--text)' }} />
            </div>

            {/* 抽屉顶栏 */}
            <div className="px-4 py-3 border-b flex items-center justify-between gap-2 shrink-0" style={{ borderColor: 'var(--border)' }}>
              <span className="font-serif font-bold text-sm" style={{ color: 'var(--accent)' }}>
                {activeSheet === 'books' && `选择播送典籍（${books.length} 册）`}
                {activeSheet === 'chapters' && `切换章节 · 《${bookMeta?.title || radio.bookTitle}》`}
                {activeSheet === 'voices' && '主播音色与语音引擎'}
                {activeSheet === 'mixer' && '播报语速 · 伴读声景 · 离线缓存'}
                {activeSheet === 'sleep' && '睡眠定时关闭'}
                {activeSheet === 'queue' && `${currentStation.name} · 节目单`}
              </span>
              <button
                onClick={() => setActiveSheet(null)}
                className="p-1.5 rounded-xl hover:opacity-70"
                aria-label="关闭面板"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 抽屉内容：1) 选书 */}
            {activeSheet === 'books' && (
              <>
                <div className="p-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs"
                    style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                  >
                    <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      value={bookPickerQuery}
                      onChange={(e) => setBookPickerQuery(e.target.value)}
                      placeholder="搜索书名、哲学家或流派…"
                      className="flex-1 bg-transparent outline-none"
                      style={{ color: 'var(--text)' }}
                    />
                    {bookPickerQuery && (
                      <button onClick={() => setBookPickerQuery('')} className="p-0.5 opacity-60">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto overscroll-contain p-2.5 space-y-1">
                  {filteredPickerBooks.map((b) => {
                    const active = b.id === radio.bookId
                    const savedCp = radioBookProgressMap[b.id]
                    return (
                      <button
                        key={b.id}
                        onClick={() => {
                          triggerHaptic()
                          radioEngine.playBookWithResume(b.id, b.firstBodyChapter || 0, 'current')
                          setActiveSheet(null)
                        }}
                        className="w-full text-left px-3.5 py-3 rounded-xl flex items-center justify-between gap-2 transition-colors active:scale-[0.99]"
                        style={
                          active
                            ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }
                            : { backgroundColor: 'var(--bg)', color: 'var(--text)' }
                        }
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-serif font-bold text-xs truncate">《{b.title}》</span>
                            {savedCp && (
                              <span
                                className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0"
                                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                              >
                                续播 第{savedCp.chapterIndex + 1}章
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] truncate mt-0.5 opacity-70">
                            {b.author} · {b.chapterCount} 章 · {b.category}
                          </div>
                        </div>
                        {active && <Check className="w-4 h-4 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {/* 抽屉内容：2) 选章节（精美主题 UI，彻底替换图四原生丑弹窗！） */}
            {activeSheet === 'chapters' && bookMeta && (
              <>
                <div className="p-3 border-b flex items-center gap-2 shrink-0" style={{ borderColor: 'var(--border)' }}>
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs flex-1"
                    style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                  >
                    <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      value={chapterPickerQuery}
                      onChange={(e) => setChapterPickerQuery(e.target.value)}
                      placeholder={`检索全书 ${bookMeta.chapterCount} 个章节…`}
                      className="flex-1 bg-transparent outline-none"
                      style={{ color: 'var(--text)' }}
                    />
                    {chapterPickerQuery && (
                      <button onClick={() => setChapterPickerQuery('')} className="p-0.5 opacity-60">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => activeChapterItemRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                    className="px-2.5 py-2 rounded-xl border text-[11px] font-medium shrink-0"
                    style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--accent)' }}
                  >
                    定位
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto overscroll-contain p-2.5 space-y-1">
                  {filteredPickerChapters.map((ch) => {
                    const active = ch.index === radio.chapterIndex
                    return (
                      <button
                        key={ch.index}
                        ref={active ? activeChapterItemRef : undefined}
                        onClick={() => {
                          if (!radio.bookId) return
                          triggerHaptic()
                          radioEngine.playChapter(radio.bookId, ch.index, 0, radio.stationId, { allowFrontMatter: true })
                          setActiveSheet(null)
                        }}
                        className="w-full text-left px-3.5 py-3 rounded-xl flex items-center justify-between gap-2.5 transition-colors active:scale-[0.99]"
                        style={
                          active
                            ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 700 }
                            : { backgroundColor: 'var(--bg)', color: 'var(--text)' }
                        }
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <span className="text-[11px] font-mono w-6 text-right shrink-0 opacity-65">
                            {ch.index + 1}.
                          </span>
                          <span className="text-xs font-serif truncate">{ch.title}</span>
                        </div>
                        {active && <Check className="w-4 h-4 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {/* 抽屉内容：3) 微软音色 */}
            {activeSheet === 'voices' && renderVoicesContent()}

            {/* 抽屉内容：4) 调音与环境声景 */}
            {activeSheet === 'mixer' && renderMixerContent()}

            {/* 抽屉内容：5) 睡眠定时 */}
            {activeSheet === 'sleep' && (
              <div className="p-3.5 space-y-2 overflow-y-auto overscroll-contain">
                {sleepCountdown && (
                  <div
                    className="px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between"
                    style={{ backgroundColor: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' }}
                  >
                    <span className="font-medium">当前定时状态</span>
                    <span className="font-mono font-bold">{sleepCountdown}</span>
                  </div>
                )}
                {SLEEP_OPTIONS.map((opt) => {
                  const selected =
                    (opt.id === 'off' && activeSleepId === 'off') ||
                    (opt.id === 'chapter' && activeSleepId === 'chapter')
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        triggerHaptic()
                        radioEngine.setSleepTimer(opt.mins, opt.afterChapter)
                        notifyToast(opt.id === 'off' ? '已关闭睡眠定时' : `已设定：${opt.label}`)
                        setActiveSheet(null)
                      }}
                      className="w-full text-left px-4 py-3 rounded-xl border flex items-center justify-between gap-2 transition-colors active:scale-[0.99]"
                      style={
                        selected
                          ? { backgroundColor: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' }
                          : { backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }
                      }
                    >
                      <div>
                        <div className="text-xs font-semibold">{opt.label}</div>
                        <div className="text-[11px] opacity-65 mt-0.5">{opt.desc}</div>
                      </div>
                      {selected && <Check className="w-4 h-4 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )}

            {/* 抽屉内容：6) 频道合集与私人播单 */}
            {activeSheet === 'queue' && (
              <div className="h-[62vh] flex flex-col overflow-hidden">
                {renderQueueContent(true)}
              </div>
            )}
          </div>
        </div>
      )}

      {quoteText && (
        <QuoteCardModal
          text={quoteText}
          bookTitle={radio.bookTitle}
          author={radio.author}
          chapterTitle={radio.chapterTitle}
          onClose={() => setQuoteText(null)}
        />
      )}
    </div>
  )
}
