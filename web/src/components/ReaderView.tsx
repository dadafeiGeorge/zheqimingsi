import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookMarked,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  ExternalLink,
  Headphones,
  ListTree,
  Maximize,
  MessageSquarePlus,
  Minimize,
  Pencil,
  PlusCircle,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import type {
  BookFullTextHit,
  BookMeta,
  BookmarkItem,
  ChapterContent,
  ContentBlock,
  GlossaryEntry,
  HighlightColor,
  HighlightItem,
  RadioQueueItem,
  RadioState,
  ReaderSettings,
} from '../types'
import { fetchBookMeta, fetchChapter, lookupPhilosophyTerm, searchInsideBook } from '../services/libraryApi'
import { APP_THEMES, getPlatform, notifyToast, registerBackHandler, triggerHaptic } from '../services/platform'
import { DEFAULT_READER_SETTINGS, recordStudySeconds, saveBookProgress } from '../services/storage'
import {
  applyInlineHighlightsToHtml,
  enhanceBlockFootnotesHtml,
  getMultiBlockSelectionSpans,
  resolveChapterFootnotes,
  type BlockSelectionSpan,
} from '../utils/inlineHighlights'
import { QuoteCardModal } from './QuoteCardModal'

interface ReaderViewProps {
  bookId: string
  initialChapterIndex: number
  initialBlockIndex: number
  initialScrollRatio?: number
  settings: ReaderSettings
  onUpdateSettings: (partial: Partial<ReaderSettings>) => void
  onResetSettings: () => void
  isFullscreen: boolean
  onToggleFullscreen: (next?: boolean) => void
  radio: RadioState
  highlights: HighlightItem[]
  bookmarks: BookmarkItem[]
  onAddHighlight: (item: HighlightItem | HighlightItem[]) => void
  onDeleteHighlight: (id: string) => void
  onToggleBookmark: (item: Omit<BookmarkItem, 'id' | 'createdAt'>) => void
  onAddToRadioQueue: (item: RadioQueueItem) => void
  onPlayRadioFrom: (bookId: string, chapterIndex: number, blockIndex: number) => void
  onOpenRadioStudio?: () => void
  onJumpToBook?: (bookId: string, chapterIndex: number, blockIndex?: number) => void
  onBackToLibrary: () => void
}

interface PendingSelection {
  spans: BlockSelectionSpan[]
  blockIndex: number
  startOffset: number
  endOffset: number
  text: string
  x: number
  y: number
  placeBelow: boolean
}

const THEME_OPTIONS = APP_THEMES

const HIGHLIGHT_COLORS: Array<{ id: HighlightColor; label: string; dot: string }> = [
  { id: 'amber', label: '琥珀', dot: '#eab308' },
  { id: 'rose', label: '茱萸', dot: '#e11d48' },
  { id: 'emerald', label: '翠竹', dot: '#10b981' },
  { id: 'indigo', label: '靛青', dot: '#4f46e5' },
]

const COLUMN_PRESETS: Array<{ id: ReaderSettings['columnWidth']; label: string }> = [
  { id: 'narrow', label: '精读窄栏' },
  { id: 'medium', label: '经典书页' },
  { id: 'wide', label: '舒展宽栏' },
  { id: 'spread', label: '全屏双栏' },
]

export const ReaderView: React.FC<ReaderViewProps> = ({
  bookId,
  initialChapterIndex,
  initialBlockIndex,
  initialScrollRatio = 0,
  settings,
  onUpdateSettings,
  onResetSettings,
  isFullscreen,
  onToggleFullscreen,
  radio,
  highlights,
  bookmarks,
  onAddHighlight,
  onDeleteHighlight,
  onToggleBookmark,
  onAddToRadioQueue,
  onPlayRadioFrom,
  onOpenRadioStudio,
  onJumpToBook,
  onBackToLibrary,
}) => {
  const [meta, setMeta] = useState<BookMeta | null>(null)
  const [chapter, setChapter] = useState<ChapterContent | null>(null)
  const [chapterIndex, setChapterIndex] = useState(initialChapterIndex)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const loadSeqRef = useRef(0)
  const [showToc, setShowToc] = useState(false)
  const [tocFilter, setTocFilter] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  // 书内全文检索（Ctrl+F）
  const [showInBookSearch, setShowInBookSearch] = useState(false)
  const [inBookQuery, setInBookQuery] = useState('')
  const [inBookHits, setInBookHits] = useState<BookFullTextHit[]>([])
  const [inBookSearching, setInBookSearching] = useState(false)
  const [flashBlockIndex, setFlashBlockIndex] = useState<number | null>(null)
  const pendingJumpBlockRef = useRef<number | null>(null)
  const inBookSearchInputRef = useRef<HTMLInputElement | null>(null)

  // 手动文本选区划线 & 批注状态（支持单段与跨段落精准划线）
  const [selectionMenu, setSelectionMenu] = useState<PendingSelection | null>(null)
  const [selectionGlossary, setSelectionGlossary] = useState<GlossaryEntry[]>([])
  const [activeGlossaryModal, setActiveGlossaryModal] = useState<{
    query: string
    entries: GlossaryEntry[]
  } | null>(null)
  const [footnotePopup, setFootnotePopup] = useState<{
    key: string
    kind: 'footnote' | 'gloss'
    text: string
    x: number
    y: number
  } | null>(null)
  const [noteComposer, setNoteComposer] = useState<{
    mode: 'new' | 'edit'
    existingId?: string
    existingGroupId?: string
    spans?: BlockSelectionSpan[]
    blockIndex: number
    startOffset?: number
    endOffset?: number
    text: string
    color: HighlightColor
    note: string
  } | null>(null)
  const [inspectHighlight, setInspectHighlight] = useState<{
    item: HighlightItem
    x: number
    y: number
  } | null>(null)

  const [quoteText, setQuoteText] = useState<string | null>(null)
  const [copiedFlag, setCopiedFlag] = useState(false)
  const [fsHeaderVisible, setFsHeaderVisible] = useState(false)
  // 手机版 APK / 移动端阅读页：点一下弹出上下功能栏，再点一下收回
  const [mobileChromeOpen, setMobileChromeOpen] = useState(false)
  const [showMobileThemeStrip, setShowMobileThemeStrip] = useState(false)
  const currentThemeOption = useMemo(
    () => THEME_OPTIONS.find((t) => t.id === settings.theme) || THEME_OPTIONS[0],
    [settings.theme]
  )
  const [scrollPct, setScrollPct] = useState(0)
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  })

  const isMobileTapMode = getPlatform() === 'android' || viewportSize.width < 768

  const [pageIdx, setPageIdx] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const articleRef = useRef<HTMLElement | null>(null)
  const blockRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const activeTocItemRef = useRef<HTMLDivElement | null>(null)
  const saveProgressTimerRef = useRef<number | null>(null)
  const restoredInitialScrollRef = useRef<boolean>(false)
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const lastSwipeAtRef = useRef<number>(0)
  const lastScrollTopRef = useRef<number>(0)

  useEffect(() => {
    if (!isMobileTapMode) return
    try {
      const key = 'lumen_mobile_reader_hint_v2'
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, '1')
        notifyToast(
          settings.readMode === 'page'
            ? '轻点屏幕中央呼出菜单 · 左右轻点或滑动翻页'
            : '轻点屏幕中央可呼出或收起上下功能栏'
        )
      }
    } catch {}
  }, [isMobileTapMode, settings.readMode])

  // 打开目录时自动平滑定位至当前正在阅读的章节
  useEffect(() => {
    if (!showToc) return
    const t = window.setTimeout(() => {
      activeTocItemRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
    }, 50)
    return () => window.clearTimeout(t)
  }, [showToc, chapterIndex])

  // 注册分层 Android 系统返回键处理（优先关闭顶层弹窗 -> 浮卡 -> 抽屉/面板 -> 退出阅读回到上级页）
  useEffect(() => {
    return registerBackHandler(100, () => {
      if (activeGlossaryModal) {
        setActiveGlossaryModal(null)
        return true
      }
      if (noteComposer) {
        setNoteComposer(null)
        return true
      }
      return false
    })
  }, [activeGlossaryModal, noteComposer])

  useEffect(() => {
    return registerBackHandler(80, () => {
      if (footnotePopup) {
        setFootnotePopup(null)
        return true
      }
      if (inspectHighlight) {
        setInspectHighlight(null)
        return true
      }
      if (selectionMenu) {
        try {
          window.getSelection()?.removeAllRanges()
        } catch {}
        setSelectionMenu(null)
        setSelectionGlossary([])
        return true
      }
      return false
    })
  }, [footnotePopup, inspectHighlight, selectionMenu])

  useEffect(() => {
    if (!mobileChromeOpen) setShowMobileThemeStrip(false)
  }, [mobileChromeOpen])

  useEffect(() => {
    return registerBackHandler(60, () => {
      if (showToc) {
        setShowToc(false)
        return true
      }
      if (showSettings) {
        setShowSettings(false)
        return true
      }
      if (showMobileThemeStrip) {
        setShowMobileThemeStrip(false)
        return true
      }
      if (showInBookSearch) {
        setShowInBookSearch(false)
        return true
      }
      return false
    })
  }, [showToc, showSettings, showMobileThemeStrip, showInBookSearch])

  useEffect(() => {
    return registerBackHandler(20, () => {
      if (isFullscreen) {
        onToggleFullscreen(false)
        return true
      }
      onBackToLibrary()
      return true
    })
  }, [isFullscreen, onToggleFullscreen, onBackToLibrary])

  useEffect(() => {
    setChapterIndex(initialChapterIndex)
    restoredInitialScrollRef.current = false
  }, [bookId, initialChapterIndex])

  // 实时监听阅读器容器尺寸，供分页模式精准计算每页可容纳字数
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect
        if (cr.width > 100 && cr.height > 100) {
          setViewportSize({ width: Math.round(cr.width), height: Math.round(cr.height) })
        }
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 原子加载书籍目录与当前章节正文（彻底消除双 Effect setLoading 竞态死锁与静默空白）
  useEffect(() => {
    const seq = ++loadSeqRef.current
    let alive = true
    setLoading(true)
    setLoadError(null)

    Promise.all([fetchBookMeta(bookId), fetchChapter(bookId, chapterIndex)])
      .then(([m, ch]) => {
        if (!alive || seq !== loadSeqRef.current) return
        setMeta(m)
        setChapter(ch)
        setPageIdx(0)
        setScrollPct(0)
        setSelectionMenu(null)
        setInspectHighlight(null)
        setFootnotePopup(null)
        setNoteComposer(null)
        setLoading(false)

        const resolvedChapterIdx = ch.chapterIndex
        const jumpBlock = pendingJumpBlockRef.current
        pendingJumpBlockRef.current = null
        const targetBlock =
          jumpBlock !== null ? jumpBlock : resolvedChapterIdx === initialChapterIndex ? initialBlockIndex || 0 : 0
        const shouldRestoreScroll =
          !restoredInitialScrollRef.current &&
          jumpBlock === null &&
          targetBlock === 0 &&
          resolvedChapterIdx === initialChapterIndex &&
          initialScrollRatio > 0.01

        saveBookProgress({
          bookId,
          chapterIndex: resolvedChapterIdx,
          blockIndex: targetBlock,
          scrollRatio: shouldRestoreScroll ? initialScrollRatio : 0,
          updatedAt: Date.now(),
        })

        window.setTimeout(() => {
          if (!alive || seq !== loadSeqRef.current) return
          if (targetBlock > 0) {
            const el = blockRefs.current.get(targetBlock)
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            if (jumpBlock !== null) {
              setFlashBlockIndex(targetBlock)
              window.setTimeout(() => setFlashBlockIndex((cur) => (cur === targetBlock ? null : cur)), 2500)
            }
          } else if (shouldRestoreScroll && scrollRef.current) {
            restoredInitialScrollRef.current = true
            const max = Math.max(0, scrollRef.current.scrollHeight - scrollRef.current.clientHeight)
            scrollRef.current.scrollTo({ top: Math.round(max * initialScrollRatio), behavior: 'auto' })
            setScrollPct(Math.round(initialScrollRatio * 100))
          } else {
            scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
          }
        }, 70)
      })
      .catch((err) => {
        if (!alive || seq !== loadSeqRef.current) return
        setLoadError(err instanceof Error ? err.message : '典籍章节加载失败，请重试')
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [bookId, chapterIndex, retryNonce])

  // 记录阅读学习时长
  useEffect(() => {
    const timer = window.setInterval(() => {
      recordStudySeconds('read', 10, bookId)
    }, 10000)
    return () => window.clearInterval(timer)
  }, [bookId])

  const isRadioOnThisChapter =
    radio.bookId === bookId && radio.chapterIndex === chapterIndex && (radio.status === 'playing' || radio.status === 'loading')

  const isPaginated = settings.readMode === 'page' || settings.columnWidth === 'spread'
  const effectiveFontSize = isFullscreen ? Math.min(30, settings.fontSize + 1) : settings.fontSize

  // 仿真分页切换页码时回到页顶，避免翻页后停在页面中间
  useEffect(() => {
    if (isPaginated && scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [isPaginated, pageIdx])

  // 解析整章学术脚注与【译注】，并将已绑定至句中角标的冗余注释块从正文流与分页流中自动折叠隐藏
  const resolvedFootnotes = useMemo(() => resolveChapterFootnotes(chapter?.blocks || []), [chapter])

  const displayBlocks = useMemo(() => {
    if (!chapter) return []
    if (resolvedFootnotes.hiddenBlockIndices.size === 0) return chapter.blocks
    return chapter.blocks.filter((b) => !resolvedFootnotes.hiddenBlockIndices.has(b.index))
  }, [chapter, resolvedFootnotes])

  // 分页模式按实际测量容器尺寸（宽×高）精准计算每页字符预算，彻底杜绝溢出或留白过大
  const pages = useMemo(() => {
    if (!chapter) return []
    if (!isPaginated) return [displayBlocks]
    const isTwoCol = settings.columnWidth === 'spread' && viewportSize.width >= 1024
    const maxColPx =
      settings.columnWidth === 'narrow'
        ? 576
        : settings.columnWidth === 'wide'
        ? 896
        : settings.columnWidth === 'spread'
        ? 1140
        : isFullscreen
        ? 768
        : 672
    const padX = viewportSize.width < 640 ? 40 : 96
    const usableW = Math.max(240, Math.min(viewportSize.width - padX, maxColPx))
    const colW = isTwoCol ? (usableW - 72) / 2 : usableW
    const usableH = Math.max(260, viewportSize.height - (isMobileTapMode ? 135 : isFullscreen ? 150 : 210))
    const lineH = effectiveFontSize * settings.lineHeight
    const charsPerLine = Math.max(12, Math.floor(colW / (effectiveFontSize * 1.04)))
    const linesPerCol = Math.max(6, Math.floor(usableH / lineH))
    const totalLinesBudget = linesPerCol * (isTwoCol ? 2 : 1)
    const paraOverheadLines = Math.max(0.55, settings.paraSpacing / lineH)

    const res: ContentBlock[][] = []
    let cur: ContentBlock[] = []
    let usedLines = 0
    for (const blk of displayBlocks) {
      const estLines =
        blk.type === 'hr'
          ? 2
          : Math.max(1, Math.ceil((blk.text.length + (settings.textIndent ? 2 : 0)) / charsPerLine)) +
            paraOverheadLines +
            (blk.type === 'heading' ? 1.2 : 0)
      if (cur.length > 0 && usedLines + estLines > totalLinesBudget) {
        res.push(cur)
        cur = [blk]
        usedLines = estLines
      } else {
        cur.push(blk)
        usedLines += estLines
      }
    }
    if (cur.length > 0) res.push(cur)
    return res.length > 0 ? res : [[]]
  }, [
    chapter,
    displayBlocks,
    isPaginated,
    effectiveFontSize,
    settings.lineHeight,
    settings.paraSpacing,
    settings.columnWidth,
    settings.textIndent,
    isFullscreen,
    isMobileTapMode,
    viewportSize.width,
    viewportSize.height,
  ])

  // 当分页切分后跳转目标段落或搜索命中段落时，自动翻到所在页
  useEffect(() => {
    if (!isPaginated || flashBlockIndex === null) return
    const targetPage = pages.findIndex((pg) => pg.some((b) => b.index === flashBlockIndex))
    if (targetPage >= 0 && targetPage !== pageIdx) {
      setPageIdx(targetPage)
    }
  }, [isPaginated, flashBlockIndex, pages, pageIdx])

  // 书内全文搜索执行
  const handleRunInBookSearch = useCallback(
    async (q: string) => {
      setInBookQuery(q)
      const trimmed = q.trim()
      if (!trimmed) {
        setInBookHits([])
        return
      }
      setInBookSearching(true)
      try {
        const hits = await searchInsideBook(bookId, trimmed, 100)
        setInBookHits(hits)
      } finally {
        setInBookSearching(false)
      }
    },
    [bookId]
  )

  const handleJumpToSearchHit = (hit: BookFullTextHit) => {
    if (hit.chapterIndex === chapterIndex) {
      if (isPaginated) {
        const targetPage = pages.findIndex((pg) => pg.some((b) => b.index === hit.blockIndex))
        if (targetPage >= 0) setPageIdx(targetPage)
      }
      window.setTimeout(() => {
        const el = blockRefs.current.get(hit.blockIndex)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setFlashBlockIndex(hit.blockIndex)
        window.setTimeout(() => setFlashBlockIndex((cur) => (cur === hit.blockIndex ? null : cur)), 2500)
      }, 40)
    } else {
      pendingJumpBlockRef.current = hit.blockIndex
      setChapterIndex(hit.chapterIndex)
    }
    if (window.innerWidth < 1024 || isMobileTapMode) {
      setShowInBookSearch(false)
      setMobileChromeOpen(false)
    }
  }

  // 电台播报当前章节时自动跟随滚动与自动翻页
  useEffect(() => {
    if (!isRadioOnThisChapter) return
    if (isPaginated) {
      const targetPage = pages.findIndex((pg) => pg.some((b) => b.index === radio.blockIndex))
      if (targetPage >= 0 && targetPage !== pageIdx) {
        setPageIdx(targetPage)
        return
      }
    }
    const el = blockRefs.current.get(radio.blockIndex)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isRadioOnThisChapter, radio.blockIndex, isPaginated, pages, pageIdx])

  const goNextChapter = useCallback(() => {
    if (meta && chapterIndex + 1 < meta.chapterCount) {
      triggerHaptic()
      setChapterIndex((c) => c + 1)
    }
  }, [meta, chapterIndex])

  const goPrevChapter = useCallback(() => {
    if (chapterIndex > 0) {
      triggerHaptic()
      setChapterIndex((c) => c - 1)
    }
  }, [chapterIndex])

  const turnPage = useCallback(
    (dir: 'prev' | 'next') => {
      if (isPaginated) {
        if (dir === 'next') {
          if (pageIdx + 1 < pages.length) setPageIdx((p) => p + 1)
          else goNextChapter()
        } else {
          if (pageIdx > 0) setPageIdx((p) => p - 1)
          else goPrevChapter()
        }
      } else if (scrollRef.current) {
        const delta = scrollRef.current.clientHeight * 0.82
        scrollRef.current.scrollBy({ top: dir === 'next' ? delta : -delta, behavior: 'smooth' })
      }
    },
    [isPaginated, pageIdx, pages.length, goNextChapter, goPrevChapter]
  )

  // 键盘快捷键（含 Ctrl+F 书内搜）与 Android 音量键翻页
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setShowInBookSearch(true)
        setShowSettings(false)
        window.setTimeout(() => inBookSearchInputRef.current?.focus(), 40)
        return
      }
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') {
        if (e.key === 'Escape' && showInBookSearch) setShowInBookSearch(false)
        return
      }
      if (e.key === 'F11') {
        e.preventDefault()
        onToggleFullscreen()
      } else if (e.key === 'Escape') {
        if (activeGlossaryModal) setActiveGlossaryModal(null)
        else if (footnotePopup) setFootnotePopup(null)
        else if (showInBookSearch) setShowInBookSearch(false)
        else if (noteComposer) setNoteComposer(null)
        else if (inspectHighlight) setInspectHighlight(null)
        else if (selectionMenu) setSelectionMenu(null)
        else if (isFullscreen) {
          e.preventDefault()
          onToggleFullscreen(false)
        }
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        turnPage('next')
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        turnPage('prev')
      }
    }
    window.addEventListener('keydown', onKey)
    window.__onAndroidVolumeKey = (dir) => {
      if (settings.volumeKeyTurn) turnPage(dir === 'down' ? 'next' : 'prev')
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      window.__onAndroidVolumeKey = undefined
    }
  }, [
    turnPage,
    settings.volumeKeyTurn,
    isFullscreen,
    onToggleFullscreen,
    noteComposer,
    inspectHighlight,
    selectionMenu,
    showInBookSearch,
    footnotePopup,
    activeGlossaryModal,
  ])

  // 监听手动划词选区（支持单段与跨段落精准划线 + 自动联动哲学术语辞典）
  const isMouseSelectingRef = useRef<boolean>(false)

  const captureCurrentSelection = useCallback(() => {
    if (isMouseSelectingRef.current) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      return
    }
    const text = sel.toString().trim()
    if (!text) return

    const range = sel.getRangeAt(0)
    const containerEl = articleRef.current
    if (
      !containerEl ||
      !containerEl.contains(range.startContainer) ||
      !containerEl.contains(range.endContainer)
    ) {
      return
    }

    const spans = getMultiBlockSelectionSpans(containerEl, range)
    if (spans.length === 0) return

    const firstSpan = spans[0]
    const resolvedText = spans.length === 1 ? firstSpan.text : spans.map((s) => s.text).join('\n')

    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return

    const centerX = rect.left + rect.width / 2
    const clampedX = Math.max(160, Math.min(window.innerWidth - 160, centerX))
    // Android 原生选区菜单固定弹出在选区上方，因此在 Android 端默认将我们的划线批注栏置底避让，桌面端紧贴选区上方
    const isAndroid = getPlatform() === 'android'
    const placeBelow = isAndroid ? rect.bottom < window.innerHeight - 120 : rect.top < 110
    const posY = placeBelow ? rect.bottom + (isAndroid ? 18 : 10) : rect.top - 10

    setInspectHighlight(null)
    setFootnotePopup(null)
    setSelectionMenu({
      spans,
      blockIndex: firstSpan.blockIndex,
      startOffset: firstSpan.startOffset,
      endOffset: firstSpan.endOffset,
      text: resolvedText,
      x: clampedX,
      y: posY,
      placeBelow,
    })

    // 若选区为词组或哲学概念（<= 20字），异步检索跨书哲学术语辞典
    const cleanQuery = resolvedText.replace(/\s+/g, '')
    if (cleanQuery.length >= 2 && cleanQuery.length <= 20) {
      lookupPhilosophyTerm(cleanQuery)
        .then((matches) => setSelectionGlossary(matches))
        .catch(() => setSelectionGlossary([]))
    } else {
      setSelectionGlossary([])
    }
  }, [])

  useEffect(() => {
    let timer: number | null = null
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      // 点击悬浮批注栏内部按钮时保持当前选区，不干扰按钮点击
      if (target?.closest('[data-selection-toolbar="true"]')) return
      isMouseSelectingRef.current = true
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      // 拖动开始时立刻隐藏旧批注栏，彻底杜绝拖选过程中鼠标碰到批注栏导致意外全选整篇文本
      setSelectionMenu(null)
    }
    const onMouseUp = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-selection-toolbar="true"]')) {
        isMouseSelectingRef.current = false
        return
      }
      isMouseSelectingRef.current = false
      window.setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed) {
          setSelectionMenu(null)
        } else {
          captureCurrentSelection()
        }
      }, 24)
    }
    const onWindowBlur = () => {
      isMouseSelectingRef.current = false
    }
    const onSelectionChange = () => {
      // 鼠标按住拖拽期间绝不弹出批注栏，仅在触屏手柄微调或松开鼠标后触发
      if (isMouseSelectingRef.current) return
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (isMouseSelectingRef.current) return
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed) {
          setSelectionMenu(null)
        } else {
          captureCurrentSelection()
        }
      }, 200)
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('mouseup', onMouseUp, true)
    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('mouseup', onMouseUp, true)
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [captureCurrentSelection])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const curTop = el.scrollTop
    const max = Math.max(1, el.scrollHeight - el.clientHeight)
    const ratio = Math.max(0, Math.min(1, curTop / max))
    setScrollPct(Math.round(ratio * 100))

    // 手机滚动阅读模式下，主动上下滑动正文时自动优雅收起展开的上下栏
    if (isMobileTapMode && !isPaginated && mobileChromeOpen && !showSettings && !showToc && !showInBookSearch) {
      if (Math.abs(curTop - lastScrollTopRef.current) > 28) {
        setMobileChromeOpen(false)
      }
    }
    lastScrollTopRef.current = curTop

    if (!isMobileTapMode && selectionMenu) setSelectionMenu(null)
    if (!isMobileTapMode && footnotePopup) setFootnotePopup(null)

    if (saveProgressTimerRef.current !== null) {
      window.clearTimeout(saveProgressTimerRef.current)
    }
    saveProgressTimerRef.current = window.setTimeout(() => {
      saveBookProgress({
        bookId,
        chapterIndex,
        blockIndex: 0,
        scrollRatio: ratio,
        updatedAt: Date.now(),
      })
    }, 450)
  }

  useEffect(() => {
    return () => {
      if (saveProgressTimerRef.current !== null) {
        window.clearTimeout(saveProgressTimerRef.current)
      }
    }
  }, [])

  // 触摸左右滑动翻页手势（仅分页模式且无划词选区时生效）
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isPaginated || e.touches.length !== 1) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isPaginated || !touchStartRef.current || e.changedTouches.length !== 1) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) {
      touchStartRef.current = null
      return
    }
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y
    const dt = Date.now() - touchStartRef.current.time
    touchStartRef.current = null
    if (dt < 600 && Math.abs(dx) > 58 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      lastSwipeAtRef.current = Date.now()
      triggerHaptic()
      turnPage(dx < 0 ? 'next' : 'prev')
    }
  }

  // 按段落分组该章节的全部高亮/批注（同一段落支持多条独立划线与批注）
  const chapterHighlightsByBlock = useMemo(() => {
    const map = new Map<number, HighlightItem[]>()
    for (const h of highlights) {
      if (h.bookId === bookId && h.chapterIndex === chapterIndex) {
        const arr = map.get(h.blockIndex) || []
        arr.push(h)
        map.set(h.blockIndex, arr)
      }
    }
    return map
  }, [highlights, bookId, chapterIndex])

  const highlightById = useMemo(() => {
    const m = new Map<string, HighlightItem>()
    for (const h of highlights) m.set(h.id, h)
    return m
  }, [highlights])

  const isBookmarked = useMemo(
    () => bookmarks.some((b) => b.bookId === bookId && b.chapterIndex === chapterIndex),
    [bookmarks, bookId, chapterIndex]
  )

  const fontClass =
    settings.fontFamily === 'serif' ? 'font-serif' : settings.fontFamily === 'kai' ? 'font-kai' : 'font-sans'

  const isSpread = settings.columnWidth === 'spread'
  const colMaxWidth =
    settings.columnWidth === 'narrow'
      ? 'max-w-xl'
      : settings.columnWidth === 'wide'
      ? 'max-w-4xl'
      : isSpread
      ? 'max-w-[1260px]'
      : isFullscreen
      ? 'max-w-3xl'
      : 'max-w-2xl'

  const clearNativeSelection = () => {
    try {
      window.getSelection()?.removeAllRanges()
    } catch {}
    setSelectionMenu(null)
    setSelectionGlossary([])
  }

  const buildHighlightItemsFromSpans = (
    spans: BlockSelectionSpan[],
    color: HighlightColor,
    noteText: string
  ): HighlightItem[] => {
    if (!meta || !chapter || spans.length === 0) return []
    const now = Date.now()
    const groupId = spans.length > 1 ? `grp_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}` : undefined
    return spans.map((sp, idx) => ({
      id: `hl_${now.toString(36)}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
      groupId,
      bookId,
      bookTitle: meta.title,
      author: meta.author,
      chapterIndex,
      chapterTitle: chapter.title,
      blockIndex: sp.blockIndex,
      startOffset: sp.startOffset,
      endOffset: sp.endOffset,
      text: sp.text,
      // 跨段落合并批注时将「注」圆点附着在末段高亮末尾，视觉最自然
      note: idx === spans.length - 1 ? noteText : '',
      color,
      createdAt: now,
    }))
  }

  const handleQuickUnderline = (color: HighlightColor) => {
    if (!selectionMenu || !meta || !chapter) return
    const items = buildHighlightItemsFromSpans(selectionMenu.spans, color, '')
    if (items.length > 0) {
      onAddHighlight(items.length === 1 ? items[0] : items)
    }
    clearNativeSelection()
    notifyToast(items.length > 1 ? `已为跨 ${items.length} 段选中内容添加划线` : '已为所选内容添加划线')
  }

  const handleOpenNewNoteComposer = (color: HighlightColor = 'amber') => {
    if (!selectionMenu) return
    setNoteComposer({
      mode: 'new',
      spans: selectionMenu.spans,
      blockIndex: selectionMenu.blockIndex,
      startOffset: selectionMenu.startOffset,
      endOffset: selectionMenu.endOffset,
      text: selectionMenu.text,
      color,
      note: '',
    })
    clearNativeSelection()
  }

  const handleSaveComposer = () => {
    if (!noteComposer || !meta || !chapter) return
    const trimmedNote = noteComposer.note.trim()

    // 编辑已有跨段落组时，同步更新该组内所有段落的颜色与批注
    if (noteComposer.mode === 'edit' && noteComposer.existingGroupId) {
      const groupItems = highlights
        .filter((h) => h.groupId === noteComposer.existingGroupId)
        .sort((a, b) => a.blockIndex - b.blockIndex)
      if (groupItems.length > 0) {
        const updated = groupItems.map((it, idx) => ({
          ...it,
          color: noteComposer.color,
          note: idx === groupItems.length - 1 ? trimmedNote : '',
        }))
        onAddHighlight(updated)
      }
    } else if (noteComposer.mode === 'new' && noteComposer.spans && noteComposer.spans.length > 1) {
      const items = buildHighlightItemsFromSpans(noteComposer.spans, noteComposer.color, trimmedNote)
      onAddHighlight(items)
    } else {
      const existing = noteComposer.existingId ? highlightById.get(noteComposer.existingId) : undefined
      onAddHighlight({
        id: existing ? existing.id : `hl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        bookId,
        bookTitle: meta.title,
        author: meta.author,
        chapterIndex,
        chapterTitle: chapter.title,
        blockIndex: noteComposer.blockIndex,
        startOffset: noteComposer.startOffset,
        endOffset: noteComposer.endOffset,
        text: noteComposer.text,
        note: trimmedNote,
        color: noteComposer.color,
        createdAt: existing ? existing.createdAt : Date.now(),
      })
    }

    setNoteComposer(null)
    setInspectHighlight(null)
    notifyToast(trimmedNote ? '已保存划线与批注' : '已保存划线高亮')
  }

  const handleCopyCitation = (text: string) => {
    if (!meta || !chapter) return
    const citation = `「${text}」\n—— ${meta.author}《${meta.title}》· ${chapter.title}`
    navigator.clipboard?.writeText(citation).catch(() => {})
    setCopiedFlag(true)
    notifyToast('已复制带出处引用')
    window.setTimeout(() => setCopiedFlag(false), 1400)
    clearNativeSelection()
  }

  // 点击正文中的学术脚注角标、或已有的划线 <mark> /「注」角标
  const handleArticleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null

    // 1) 学术脚注与外文译注角标弹窗
    const fnEl = target?.closest('[data-fn-key]') as HTMLElement | null
    if (fnEl) {
      const fnKey = fnEl.getAttribute('data-fn-key')
      const entry = fnKey ? resolvedFootnotes.entries.get(fnKey) : undefined
      if (entry) {
        e.stopPropagation()
        const rect = fnEl.getBoundingClientRect()
        setSelectionMenu(null)
        setInspectHighlight(null)
        setFootnotePopup({
          key: entry.label,
          kind: entry.kind,
          text: entry.text,
          x: Math.max(160, Math.min(window.innerWidth - 160, rect.left + rect.width / 2)),
          y: rect.top > 180 ? rect.top - 10 : rect.bottom + 10,
        })
        return
      }
    }

    // 2) 划线/批注查看与编辑卡（跨段落组自动聚合展示完整摘录）
    const hlEl = target?.closest('[data-hl-id]') as HTMLElement | null
    if (hlEl) {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) return
      const id = hlEl.getAttribute('data-hl-id')
      if (id) {
        const rawItem = highlightById.get(id)
        if (rawItem) {
          e.stopPropagation()
          let displayItem = rawItem
          if (rawItem.groupId) {
            const parts = highlights
              .filter((h) => h.groupId === rawItem.groupId)
              .sort((a, b) => a.blockIndex - b.blockIndex)
            if (parts.length > 1) {
              displayItem = {
                ...parts[0],
                text: parts.map((p) => p.text).join('\n'),
                note: parts.find((p) => p.note)?.note || '',
              }
            }
          }
          const rect = hlEl.getBoundingClientRect()
          setSelectionMenu(null)
          setFootnotePopup(null)
          setInspectHighlight({
            item: displayItem,
            x: Math.max(165, Math.min(window.innerWidth - 165, rect.left + rect.width / 2)),
            y: rect.bottom + 10 > window.innerHeight - 180 ? Math.max(80, rect.top - 165) : rect.bottom + 10,
          })
          return
        }
      }
    }
    if (inspectHighlight) setInspectHighlight(null)
    if (footnotePopup) setFootnotePopup(null)
  }

  const handleResetTypography = () => {
    onResetSettings()
    notifyToast('已恢复默认阅读排版与主题')
  }

  const isDefaultSettings =
    settings.theme === DEFAULT_READER_SETTINGS.theme &&
    settings.fontFamily === DEFAULT_READER_SETTINGS.fontFamily &&
    settings.fontSize === DEFAULT_READER_SETTINGS.fontSize &&
    settings.lineHeight === DEFAULT_READER_SETTINGS.lineHeight &&
    settings.paraSpacing === DEFAULT_READER_SETTINGS.paraSpacing &&
    settings.columnWidth === DEFAULT_READER_SETTINGS.columnWidth &&
    settings.textIndent === DEFAULT_READER_SETTINGS.textIndent &&
    settings.justify === DEFAULT_READER_SETTINGS.justify &&
    settings.readMode === DEFAULT_READER_SETTINGS.readMode

  const visibleBlocks = isPaginated ? pages[pageIdx] || [] : displayBlocks

  const filteredChapters = useMemo(() => {
    if (!meta) return []
    const q = tocFilter.trim().toLowerCase()
    if (!q) return meta.chapters
    return meta.chapters.filter((c) => c.title.toLowerCase().includes(q))
  }, [meta, tocFilter])

  const renderTocBody = () => (
    <>
      <div className="p-4 border-b flex items-center justify-between gap-2 shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="min-w-0">
          <h3 className="font-serif font-bold text-sm truncate">{meta?.title}</h3>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            当前第 {chapterIndex + 1} / {meta?.chapterCount || 1} 章 · {meta?.author}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(meta?.chapterCount || 0) > 12 && !tocFilter.trim() && (
            <button
              onClick={() => activeTocItemRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
              className="px-2 py-1 rounded-lg text-[11px] font-medium border"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--accent)' }}
            >
              定位
            </button>
          )}
          <button onClick={() => setShowToc(false)} className="p-1.5 rounded-lg hover:opacity-70" title="收起目录">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={tocFilter}
            onChange={(e) => setTocFilter(e.target.value)}
            placeholder="筛选章节标题…"
            className="bg-transparent outline-none flex-1"
            style={{ color: 'var(--text)' }}
          />
          {tocFilter && (
            <button onClick={() => setTocFilter('')} className="p-0.5 opacity-65">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-0.5">
        {filteredChapters.map((ch) => {
          const active = ch.index === chapterIndex
          return (
            <div
              key={ch.index}
              ref={active ? activeTocItemRef : undefined}
              className="group flex items-center gap-1 rounded-xl transition-colors"
              style={active ? { backgroundColor: 'var(--accent-soft)' } : undefined}
            >
              <button
                onClick={() => {
                  triggerHaptic()
                  setChapterIndex(ch.index)
                  if (window.innerWidth < 1180 || isMobileTapMode) {
                    setShowToc(false)
                    setMobileChromeOpen(false)
                  }
                }}
                className="flex-1 text-left px-3 py-3 md:py-2.5 text-[13px] md:text-xs leading-snug truncate"
                style={{
                  paddingLeft: `${10 + Math.min(ch.level - 1, 2) * 12}px`,
                  color: active ? 'var(--accent)' : 'var(--text)',
                  fontWeight: active ? 700 : 400,
                }}
              >
                {ch.title}
              </button>
              <button
                onClick={() => {
                  if (!meta) return
                  onAddToRadioQueue({
                    id: `q_${meta.id}_${ch.index}_${Date.now()}`,
                    bookId: meta.id,
                    bookTitle: meta.title,
                    author: meta.author,
                    chapterIndex: ch.index,
                    chapterTitle: ch.title,
                  })
                  notifyToast(`已加入电台节目单：${ch.title}`)
                }}
                title="加入电台节目单"
                className="p-2.5 md:p-2 opacity-60 hover:opacity-100 shrink-0"
                style={{ color: 'var(--accent)' }}
              >
                <PlusCircle className="w-4 h-4 md:w-3.5 md:h-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </>
  )

  return (
    <div
      className="h-full flex flex-col relative overflow-hidden select-none"
      style={{ backgroundColor: isFullscreen ? 'var(--bg-elevated)' : 'var(--bg)' }}
    >
      {/* 全屏模式下顶部鼠标热区 */}
      {isFullscreen && (
        <div
          className="fixed top-0 inset-x-0 h-5 z-30"
          onMouseEnter={() => setFsHeaderVisible(true)}
        />
      )}

      {/* 阅读顶部沉浸工具条（上框）：桌面常规常驻；全屏或手机版 APK 轻点屏幕平滑弹出/收回 */}
      <div
        onMouseLeave={() => isFullscreen && !isMobileTapMode && setFsHeaderVisible(false)}
        onClick={(e) => e.stopPropagation()}
        className={`shrink-0 min-h-[52px] px-3 md:px-6 border-b flex items-center justify-between gap-2 z-30 transition-all duration-300 safe-top ${
          isMobileTapMode
            ? mobileChromeOpen && !showToc && !showInBookSearch && !showSettings
              ? 'fixed top-0 inset-x-0 translate-y-0 opacity-100 shadow-lg'
              : 'fixed top-0 inset-x-0 -translate-y-full opacity-0 pointer-events-none'
            : isFullscreen
            ? fsHeaderVisible || showSettings || showToc || showInBookSearch
              ? 'fixed top-0 inset-x-0 translate-y-0 opacity-100 shadow-lg'
              : 'fixed top-0 inset-x-0 -translate-y-full opacity-0 pointer-events-none'
            : ''
        }`}
        style={{ backgroundColor: 'var(--bg-glass)', borderColor: 'var(--border)', backdropFilter: 'blur(18px)' }}
      >
        <div className="flex items-center gap-1.5 md:gap-2 min-w-0 flex-1">
          <button
            onClick={() => {
              triggerHaptic()
              if (isFullscreen) onToggleFullscreen(false)
              onBackToLibrary()
            }}
            className="w-9 h-9 md:w-8 md:h-8 rounded-xl flex items-center justify-center hover:opacity-75 active:scale-95 transition-all shrink-0"
            style={{ color: 'var(--text)' }}
            title="返回上一页"
            aria-label="返回"
          >
            <ArrowLeft className="w-5 h-5 md:w-4 md:h-4" />
          </button>

          {!isMobileTapMode && (
            <button
              onClick={() => {
                setShowToc((v) => !v)
                setShowSettings(false)
              }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors shrink-0"
              style={
                showToc
                  ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }
                  : { backgroundColor: 'var(--bg-card)', color: 'var(--text)', borderColor: 'var(--border)' }
              }
              title="打开书籍目录"
            >
              <ListTree className="w-3.5 h-3.5" />
              <span>目录</span>
            </button>
          )}

          <div className="min-w-0 flex-1 pl-0.5">
            <div className="text-[13px] md:text-xs font-serif font-bold truncate">{meta?.title || '载入典籍…'}</div>
            <div className="text-[11px] md:text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
              {chapter?.title || ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => {
              triggerHaptic()
              setShowInBookSearch((v) => !v)
              setShowSettings(false)
              setShowToc(false)
              window.setTimeout(() => inBookSearchInputRef.current?.focus(), 60)
            }}
            className="w-9 h-9 md:w-8 md:h-8 rounded-xl flex items-center justify-center transition-colors hover:opacity-80 active:scale-95"
            style={{ color: showInBookSearch ? 'var(--accent)' : 'var(--text-secondary)' }}
            title="本书全文检索 (Ctrl+F)"
            aria-label="书内搜索"
          >
            <Search className="w-[18px] h-[18px] md:w-4 md:h-4" />
          </button>

          {!isMobileTapMode && (
            <button
              onClick={() => onPlayRadioFrom(bookId, chapterIndex, 0)}
              className="px-2.5 py-1.5 rounded-full text-[11px] font-medium flex items-center gap-1 transition-all"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              title="从本章开启哲启明思电台朗读"
            >
              <Headphones className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">电台朗读</span>
            </button>
          )}

          <button
            onClick={() => {
              triggerHaptic()
              if (!meta || !chapter) return
              const excerpt = displayBlocks.find((b) => b.type === 'paragraph')?.speakText.slice(0, 80) || chapter.title
              onToggleBookmark({
                bookId,
                bookTitle: meta.title,
                chapterIndex,
                chapterTitle: chapter.title,
                blockIndex: 0,
                excerpt,
              })
            }}
            className="w-9 h-9 md:w-8 md:h-8 rounded-xl flex items-center justify-center transition-colors hover:opacity-80 active:scale-95"
            style={{ color: isBookmarked ? 'var(--accent)' : 'var(--text-secondary)' }}
            title={isBookmarked ? '取消本章书签' : '添加本章书签'}
            aria-label={isBookmarked ? '取消书签' : '添加书签'}
          >
            {isBookmarked ? (
              <BookmarkCheck className="w-[18px] h-[18px] md:w-4 md:h-4" />
            ) : (
              <Bookmark className="w-[18px] h-[18px] md:w-4 md:h-4" />
            )}
          </button>

          {!isMobileTapMode && (
            <>
              <button
                onClick={() => {
                  setShowSettings((v) => !v)
                  setShowInBookSearch(false)
                  if (window.innerWidth < 1180) setShowToc(false)
                }}
                className="px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 transition-colors hover:opacity-80"
                style={{ color: showSettings ? 'var(--accent)' : 'var(--text-secondary)' }}
                title="排版与纸张设置"
              >
                <Type className="w-4 h-4" />
                <span className="hidden md:inline">排版</span>
              </button>

              <button
                onClick={() => onToggleFullscreen()}
                className="p-2 rounded-lg transition-colors hover:opacity-80"
                style={{ color: isFullscreen ? 'var(--accent)' : 'var(--text-secondary)' }}
                title={isFullscreen ? '退出全屏沉浸 (Esc / F11)' : '进入全屏沉浸阅读 (F11)'}
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 主体容器 */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {showToc && meta && settings.dockTocOnWide && (
          <aside
            className="hidden xl:flex w-72 shrink-0 h-full border-r flex-col z-20"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            {renderTocBody()}
          </aside>
        )}

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className={`flex-1 overflow-y-auto relative transition-all duration-300 ${
            isMobileTapMode
              ? 'px-5 pt-6 pb-20 safe-top'
              : isFullscreen
              ? 'px-4 md:px-12 lg:px-16 py-8 md:py-12 pb-28'
              : 'px-4 md:px-10 pt-6 md:pt-8 pb-36'
          }`}
          onClick={(e) => {
            const target = e.target as HTMLElement | null
            if (target?.closest('button, a, input, select, [data-hl-id], [data-fn-key]')) return
            if (Date.now() - lastSwipeAtRef.current < 260) return

            // 若当前打开了排版/搜索/批注/脚注/划词工具栏，首次点击仅收起弹窗，绝不误触发翻页或菜单切换
            if (showSettings || showInBookSearch || inspectHighlight || footnotePopup || selectionMenu) {
              setShowSettings(false)
              setShowInBookSearch(false)
              setInspectHighlight(null)
              setFootnotePopup(null)
              if (selectionMenu) clearNativeSelection()
              return
            }

            const sel = window.getSelection()
            if (sel && !sel.isCollapsed) return
            if (noteComposer || activeGlossaryModal) return

            if (isMobileTapMode) {
              // 手机端：若上下功能栏已打开，轻点任意阅读区立即收回（绝不误翻页）
              if (mobileChromeOpen) {
                setMobileChromeOpen(false)
                return
              }
              // 仿真分页模式下支持旗舰级三区点击：左 27% 上一页 / 右 27% 下一页 / 中间 46% 呼出上下菜单
              if (isPaginated) {
                const ratioX = e.clientX / Math.max(1, window.innerWidth)
                if (ratioX < 0.27) {
                  triggerHaptic()
                  turnPage('prev')
                  return
                }
                if (ratioX > 0.73) {
                  triggerHaptic()
                  turnPage('next')
                  return
                }
              }
              setMobileChromeOpen(true)
            } else if (isFullscreen) {
              setFsHeaderVisible((v) => !v)
            }
          }}
        >
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3" style={{ color: 'var(--text-muted)' }}>
              <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent)' }} />
              <span className="text-xs font-serif">正在展开典籍…</span>
            </div>
          ) : loadError ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 text-center px-6">
              <p className="font-serif text-sm font-bold">典籍章节加载受阻</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {loadError}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setRetryNonce((n) => n + 1)
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  重新加载
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onBackToLibrary()
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-medium border"
                  style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
                >
                  返回书馆
                </button>
              </div>
            </div>
          ) : chapter ? (
            <article
              ref={articleRef}
              onClick={handleArticleClick}
              className={`mx-auto ${colMaxWidth} ${fontClass} reader-prose select-text animate-float-in transition-all duration-300 ${
                isFullscreen || isSpread
                  ? 'reader-book-sheet px-6 sm:px-10 md:px-14 lg:px-16 py-8 md:py-12'
                  : ''
              }`}
            >
              {/* 章节眉题 */}
              <div className="mb-8 pb-5 border-b flex items-end justify-between gap-4 select-none" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <div className="text-[11px] font-mono tracking-widest uppercase" style={{ color: 'var(--accent)' }}>
                    CHAPTER {chapterIndex + 1} / {meta?.chapterCount || 1}
                    {isSpread ? ' · FULLSCREEN SPREAD' : ''}
                  </div>
                  <h1 className="text-xl md:text-2xl font-bold mt-2 leading-snug">{chapter.title}</h1>
                </div>
                {isFullscreen && (
                  <span className="hidden md:inline text-xs font-serif shrink-0" style={{ color: 'var(--text-muted)' }}>
                    《{meta?.title}》
                  </span>
                )}
              </div>

              {/* 纯净正文内容块：取消整段点击选中、取消左侧朗读键，原生支持任意手动划词划线与批注 */}
              <div
                className={isSpread ? 'reader-spread-columns' : ''}
                style={{ fontSize: `${effectiveFontSize}px`, lineHeight: settings.lineHeight }}
              >
                {visibleBlocks.map((blk) => {
                  // 避免与章节顶部 <h1> 眉题重复显示相同的首行标题（若首行标题自带可点击脚注则保留显示）
                  if (
                    blk.index === 0 &&
                    blk.type === 'heading' &&
                    !resolvedFootnotes.blockRefMap.has(0) &&
                    !resolvedFootnotes.blockTrailingIds.has(0) &&
                    blk.speakText.replace(/\s+/g, '') === chapter.title.replace(/\s+/g, '')
                  ) {
                    return null
                  }

                  const isSpeaking = isRadioOnThisChapter && radio.blockIndex === blk.index
                  const isFlashed = flashBlockIndex === blk.index
                  const blockHls = chapterHighlightsByBlock.get(blk.index)
                  const withFootnotes =
                    blk.type !== 'table' && resolvedFootnotes.entries.size > 0
                      ? enhanceBlockFootnotesHtml(blk.html, blk.index, resolvedFootnotes)
                      : blk.html
                  const renderedHtml =
                    blockHls && blockHls.length > 0 && blk.type !== 'table'
                      ? applyInlineHighlightsToHtml(withFootnotes, blockHls)
                      : withFootnotes

                  const isFootnotePara =
                    blk.type === 'paragraph' &&
                    /^(?:\[\^?(?:注|译注)?\d{1,3}\]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|(?:注释|译注|校注|注)\s*\d{1,3}[：:.、\s])/.test(
                      blk.text.trim()
                    )
                  const isShortLine = blk.text.trim().length < 26

                  if (blk.type === 'hr') {
                    return <hr key={blk.id} className="my-7 border-t" style={{ borderColor: 'var(--border-strong)' }} />
                  }

                  return (
                    <div
                      key={blk.id}
                      data-block-index={blk.index}
                      ref={(el) => {
                        if (el) blockRefs.current.set(blk.index, el)
                      }}
                      className={`reader-block-unit relative px-2 -mx-2 py-1 rounded-lg transition-colors ${
                        isSpeaking ? 'tts-speaking-block' : ''
                      } ${isFlashed ? 'search-flash-block' : ''}`}
                      style={{ marginBottom: `${isFootnotePara ? Math.max(8, settings.paraSpacing - 4) : settings.paraSpacing}px` }}
                    >
                      {blk.type === 'heading' ? (
                        /^(?:\[(?:附释|说明|补充|按语|译者按|编者按)\]|(?:附释|说明)\s*(?:[一二三四五六七八九十\d]+)?)$/.test(
                          blk.text.trim()
                        ) ? (
                          <div className="mt-4 mb-1.5 flex items-center gap-2 select-none">
                            <span
                              className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[0.84em] font-semibold tracking-wider border"
                              style={{
                                backgroundColor: 'var(--accent-soft)',
                                borderColor: 'var(--border-strong)',
                                color: 'var(--accent)',
                              }}
                              dangerouslySetInnerHTML={{ __html: renderedHtml }}
                            />
                            <span className="flex-1 h-px opacity-50" style={{ backgroundColor: 'var(--border)' }} />
                          </div>
                        ) : /^(?:§\s*\d+|第\s*\d+\s*节)/.test(blk.text.trim()) ? (
                          <div
                            className="font-bold text-[1.06em] mt-5 mb-1.5 pl-2.5 border-l-2 tracking-wide"
                            style={{ borderColor: 'var(--accent)', color: 'var(--text)' }}
                            dangerouslySetInnerHTML={{ __html: renderedHtml }}
                          />
                        ) : (
                          <div
                            className={`font-bold ${
                              (blk.level || 2) <= 2 ? 'text-[1.22em] mt-5 mb-1.5' : 'text-[1.08em] mt-3.5 mb-1'
                            }`}
                            dangerouslySetInnerHTML={{ __html: renderedHtml }}
                          />
                        )
                      ) : blk.type === 'quote' ? (
                        <blockquote dangerouslySetInnerHTML={{ __html: renderedHtml }} />
                      ) : blk.type === 'table' ? (
                        <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
                      ) : blk.type === 'list' ? (
                        <div className="flex items-start gap-2.5 pl-1">
                          <span className="mt-2.5 w-1.5 h-1.5 rounded-full shrink-0 select-none" style={{ backgroundColor: 'var(--accent)' }} />
                          <span dangerouslySetInnerHTML={{ __html: renderedHtml }} />
                        </div>
                      ) : isFootnotePara ? (
                        <p
                          className="text-[0.88em] leading-relaxed pl-3 border-l-2 text-left"
                          style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
                          dangerouslySetInnerHTML={{ __html: renderedHtml }}
                        />
                      ) : (
                        <p
                          className={`${settings.justify && !isShortLine ? 'text-justify' : 'text-left'} ${
                            settings.textIndent && !isShortLine ? 'indent-[2em]' : ''
                          }`}
                          dangerouslySetInnerHTML={{ __html: renderedHtml }}
                        />
                      )}
                    </div>
                  )
                })}
              </div>

              {/* 章节底部导航 / 分页控制 */}
              <div
                className="mt-12 pt-6 border-t flex items-center justify-between gap-3 font-sans select-none"
                style={{ borderColor: 'var(--border)' }}
              >
                {isPaginated ? (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        turnPage('prev')
                      }}
                      disabled={pageIdx === 0 && chapterIndex === 0}
                      className="px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center gap-1 disabled:opacity-35"
                      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
                    >
                      <ChevronLeft className="w-4 h-4" /> 上一页
                    </button>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                      第 {pageIdx + 1} / {pages.length} 页
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        turnPage('next')
                      }}
                      disabled={pageIdx + 1 >= pages.length && chapterIndex + 1 >= (meta?.chapterCount || 1)}
                      className="px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center gap-1 disabled:opacity-35"
                      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
                    >
                      下一页 <ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        goPrevChapter()
                      }}
                      disabled={chapterIndex === 0}
                      className="px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center gap-1 disabled:opacity-35 transition-colors hover:opacity-80"
                      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
                    >
                      <ChevronLeft className="w-4 h-4" /> 上一章
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowToc(true)
                      }}
                      className="text-xs hover:underline"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {chapterIndex + 1} / {meta?.chapterCount || 1} 章
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        goNextChapter()
                      }}
                      disabled={!meta || chapterIndex + 1 >= meta.chapterCount}
                      className="px-4 py-2.5 rounded-xl text-xs font-medium text-white flex items-center gap-1 disabled:opacity-35 transition-transform active:scale-95"
                      style={{ backgroundColor: 'var(--accent)' }}
                    >
                      下一章 <ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </article>
          ) : null}

          {/* 底部轻量阅读进度拖动条（桌面端展示；手机版由点按呼出的下框功能栏接管） */}
          {!loading && chapter && !isMobileTapMode && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="mx-auto mt-6 max-w-2xl px-3 py-2 rounded-xl border flex items-center gap-3 text-[11px] font-mono select-none opacity-80 hover:opacity-100 transition-opacity"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                {isPaginated ? `第 ${pageIdx + 1}/${pages.length} 页` : `本章 ${scrollPct}%`}
              </span>
              {isPaginated ? (
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, pages.length - 1)}
                  step={1}
                  value={pageIdx}
                  onChange={(e) => setPageIdx(Number(e.target.value))}
                  aria-label="拖动切换页码"
                  className="flex-1 accent-[var(--accent)] cursor-pointer"
                />
              ) : (
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={scrollPct}
                  onChange={(e) => {
                    const pct = Number(e.target.value)
                    setScrollPct(pct)
                    const el = scrollRef.current
                    if (el) {
                      const max = Math.max(0, el.scrollHeight - el.clientHeight)
                      el.scrollTo({ top: Math.round((pct / 100) * max), behavior: 'auto' })
                    }
                  }}
                  aria-label="拖动跳转本章进度"
                  className="flex-1 accent-[var(--accent)] cursor-pointer"
                />
              )}
              <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                {chapterIndex + 1}/{meta?.chapterCount || 1} 章
              </span>
            </div>
          )}

          {/* 手机版沉浸阅读微弱底部状态条（上下功能栏收回时静谧提示进度，不遮挡阅读） */}
          {isMobileTapMode && !mobileChromeOpen && !loading && chapter && (
            <div
              className="fixed bottom-0 inset-x-0 px-4 py-1.5 flex items-center justify-between text-[10px] font-mono pointer-events-none select-none z-20 safe-bottom"
              style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg)' }}
            >
              <span className="truncate max-w-[60%] font-serif">
                {chapter.title}
              </span>
              <span className="shrink-0">
                {isPaginated
                  ? `${pageIdx + 1}/${pages.length} 页 · ${chapterIndex + 1}/${meta?.chapterCount || 1} 章`
                  : `${scrollPct}% · ${chapterIndex + 1}/${meta?.chapterCount || 1} 章`}
              </span>
            </div>
          )}

          {/* 手机版 APK 阅读页底部弹出功能栏（下框）：点一下弹出，打开面板/划词时自动退场零遮挡 */}
          {isMobileTapMode && (
            <div
              onClick={(e) => e.stopPropagation()}
              className={`fixed bottom-0 inset-x-0 z-30 border-t px-4 pt-3 pb-3 safe-bottom shadow-2xl transition-all duration-300 select-none ${
                mobileChromeOpen && !showToc && !showSettings && !showInBookSearch && !selectionMenu
                  ? 'translate-y-0 opacity-100'
                  : 'translate-y-full opacity-0 pointer-events-none'
              }`}
              style={{
                backgroundColor: 'var(--bg-glass)',
                borderColor: 'var(--border-strong)',
                backdropFilter: 'blur(20px)',
              }}
            >
              {/* 若电台正在播报/暂停，轻盈展示直达电台小胶囊 */}
              {(radio.status === 'playing' || radio.status === 'loading' || radio.status === 'paused') &&
                onOpenRadioStudio && (
                  <button
                    onClick={() => {
                      triggerHaptic()
                      setMobileChromeOpen(false)
                      onOpenRadioStudio()
                    }}
                    className="w-full mb-2.5 px-3 py-1.5 rounded-xl border flex items-center justify-between gap-2 text-[11px] active:scale-[0.99] transition-transform"
                    style={{
                      backgroundColor: 'var(--accent-soft)',
                      borderColor: 'var(--accent)',
                      color: 'var(--accent)',
                    }}
                  >
                    <span className="flex items-center gap-1.5 truncate font-medium">
                      <Headphones className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">
                        {radio.status === 'playing' ? '电台播报中：' : '电台已暂停：'}
                        {radio.bookTitle}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold">控制台 →</span>
                  </button>
                )}

              {/* 进度提示微标 */}
              <div className="flex items-center justify-between text-[11px] mb-1.5 px-1" style={{ color: 'var(--text-muted)' }}>
                <span className="truncate max-w-[65%] font-serif">{chapter?.title || ''}</span>
                <span className="font-mono shrink-0">
                  {isPaginated
                    ? `第 ${pageIdx + 1}/${pages.length} 页`
                    : `${scrollPct}%`}
                  {' · '}
                  {chapterIndex + 1}/{meta?.chapterCount || 1} 章
                </span>
              </div>

              {/* 第一行：上一章 / 拖动进度条 / 下一章 */}
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => goPrevChapter()}
                  disabled={chapterIndex === 0}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-xl border disabled:opacity-30 shrink-0 active:scale-95"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  上一章
                </button>
                {isPaginated ? (
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, pages.length - 1)}
                    step={1}
                    value={pageIdx}
                    onChange={(e) => setPageIdx(Number(e.target.value))}
                    aria-label="拖动切换页码"
                    className="flex-1 accent-[var(--accent)]"
                  />
                ) : (
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={scrollPct}
                    onChange={(e) => {
                      const pct = Number(e.target.value)
                      setScrollPct(pct)
                      const el = scrollRef.current
                      if (el) {
                        const max = Math.max(0, el.scrollHeight - el.clientHeight)
                        el.scrollTo({ top: Math.round((pct / 100) * max), behavior: 'auto' })
                      }
                    }}
                    aria-label="拖动跳转本章进度"
                    className="flex-1 accent-[var(--accent)]"
                  />
                )}
                <button
                  onClick={() => goNextChapter()}
                  disabled={!meta || chapterIndex + 1 >= meta.chapterCount}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-xl border disabled:opacity-30 shrink-0 active:scale-95"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  下一章
                </button>
              </div>

              {/* 展开的 4 主题快捷色盘（与排版抽屉完全一致，一键切换） */}
              {showMobileThemeStrip && (
                <div
                  className="grid grid-cols-4 gap-2 mb-3 p-2 rounded-2xl border animate-float-in"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
                >
                  {THEME_OPTIONS.map((t) => {
                    const active = settings.theme === t.id
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          triggerHaptic()
                          onUpdateSettings({ theme: t.id })
                        }}
                        className="relative flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl border text-[11px] font-medium transition-transform active:scale-95"
                        style={{
                          backgroundColor: t.swatch,
                          color: t.ink,
                          borderColor: active ? t.accent : 'var(--border-strong)',
                          boxShadow: active ? `0 0 0 2px ${t.accent}` : 'none',
                        }}
                      >
                        {active && (
                          <span
                            className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-white shadow-sm"
                            style={{ backgroundColor: t.accent }}
                          >
                            <Check className="w-2.5 h-2.5" strokeWidth={3} />
                          </span>
                        )}
                        <span className="font-serif text-sm font-bold leading-none">永</span>
                        <span className="text-[10px] leading-tight">{t.shortName}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* 第二行：四大核心快捷功能键（清爽四等分，与顶栏返回零重复） */}
              <div className="grid grid-cols-4 gap-1">
                <button
                  onClick={() => {
                    triggerHaptic()
                    setShowToc(true)
                    setShowSettings(false)
                    setShowMobileThemeStrip(false)
                  }}
                  className="py-2 flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium active:scale-95"
                  style={{ color: showToc ? 'var(--accent)' : 'var(--text-secondary)' }}
                >
                  <ListTree className="w-[18px] h-[18px]" />
                  <span>目录</span>
                </button>

                <button
                  onClick={() => {
                    triggerHaptic()
                    if (isRadioOnThisChapter && onOpenRadioStudio) {
                      setMobileChromeOpen(false)
                      onOpenRadioStudio()
                      return
                    }
                    onPlayRadioFrom(bookId, chapterIndex, 0)
                    setMobileChromeOpen(false)
                    notifyToast('已开启本章微软电台朗读')
                  }}
                  className="py-2 flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium active:scale-95"
                  style={{ color: isRadioOnThisChapter ? 'var(--accent)' : 'var(--text-secondary)' }}
                >
                  <Headphones className="w-[18px] h-[18px]" />
                  <span>{isRadioOnThisChapter ? '播报中' : '听书'}</span>
                </button>

                <button
                  onClick={() => {
                    triggerHaptic()
                    setShowMobileThemeStrip((prev) => !prev)
                  }}
                  className="py-2 flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium active:scale-95"
                  style={{ color: showMobileThemeStrip ? 'var(--accent)' : 'var(--text-secondary)' }}
                >
                  <span
                    className="w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shadow-inner"
                    style={{
                      backgroundColor: currentThemeOption.swatch,
                      borderColor: showMobileThemeStrip
                        ? 'var(--accent)'
                        : currentThemeOption.dark
                        ? 'rgba(255,255,255,0.45)'
                        : 'rgba(35,31,27,0.32)',
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: currentThemeOption.accent }}
                    />
                  </span>
                  <span>{currentThemeOption.shortName}</span>
                </button>

                <button
                  onClick={() => {
                    triggerHaptic()
                    setShowSettings(true)
                    setShowToc(false)
                    setShowMobileThemeStrip(false)
                  }}
                  className="py-2 flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium active:scale-95"
                  style={{ color: showSettings ? 'var(--accent)' : 'var(--text-secondary)' }}
                >
                  <Type className="w-[18px] h-[18px]" />
                  <span>排版</span>
                </button>
              </div>
            </div>
          )}

          {/* 全屏沉浸模式右下角悬浮进度与退出全屏胶囊（桌面端专属） */}
          {isFullscreen && !isMobileTapMode && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="fixed bottom-4 right-5 z-30 px-3 py-1.5 rounded-full border flex items-center gap-2.5 text-[11px] font-mono shadow-lg transition-opacity opacity-70 hover:opacity-100 select-none"
              style={{
                backgroundColor: 'var(--bg-glass)',
                borderColor: 'var(--border-strong)',
                backdropFilter: 'blur(12px)',
              }}
            >
              <span>
                {chapterIndex + 1}/{meta?.chapterCount || 1} 章 · {scrollPct}%
              </span>
              <button
                onClick={() => onToggleFullscreen(false)}
                className="font-sans font-medium flex items-center gap-1 hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                <Minimize className="w-3 h-3" /> 退出全屏
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 手动划词工具栏：手机端智能底部停靠彻底避让 Android 原生选择手柄；桌面端紧贴选区上方 */}
      {selectionMenu && (
        isMobileTapMode ? (
          <div
            data-selection-toolbar="true"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border-strong)',
              boxShadow: 'var(--shadow-float)',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
            className="fixed inset-x-3 bottom-4 z-50 rounded-2xl border p-3 space-y-2.5 font-sans select-none safe-bottom animate-sheet-up"
          >
            {/* 第一行：4色大圆点划线 + 写批注 + 关闭 */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      triggerHaptic()
                      handleQuickUnderline(c.id)
                    }}
                    title={`${c.label}划线`}
                    className="w-7 h-7 rounded-full border-2 border-white/85 shadow-sm transition-transform active:scale-90"
                    style={{ backgroundColor: c.dot }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    triggerHaptic()
                    handleOpenNewNoteComposer('amber')
                  }}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 text-white transition-transform active:scale-95"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  <span>写批注</span>
                </button>
                <button
                  onClick={() => clearNativeSelection()}
                  className="w-8 h-8 rounded-xl flex items-center justify-center border active:scale-90"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  aria-label="取消选中"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 第二行：带清晰中文标签的功能胶囊 */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {selectionGlossary.length > 0 && (
                <button
                  onClick={() => {
                    const q = selectionMenu.text
                    const entries = selectionGlossary
                    clearNativeSelection()
                    setActiveGlossaryModal({ query: q, entries })
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 shrink-0 active:scale-95"
                  style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <BookMarked className="w-3.5 h-3.5" />
                  <span>查术语</span>
                </button>
              )}

              <button
                onClick={() => {
                  setQuoteText(selectionMenu.text)
                  clearNativeSelection()
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 shrink-0 active:scale-95"
                style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text)' }}
              >
                <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--gold)' }} />
                <span>金句卡</span>
              </button>

              <button
                onClick={() => handleCopyCitation(selectionMenu.text)}
                className="px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 shrink-0 active:scale-95"
                style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text)' }}
              >
                {copiedFlag ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>复制引用</span>
              </button>

              <button
                onClick={() => {
                  const blkIdx = selectionMenu.blockIndex
                  clearNativeSelection()
                  onPlayRadioFrom(bookId, chapterIndex, blkIdx)
                  notifyToast('已从此段开启微软电台朗读')
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 shrink-0 active:scale-95"
                style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--accent)' }}
              >
                <Headphones className="w-3.5 h-3.5" />
                <span>从此朗读</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            data-selection-toolbar="true"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              left: `${selectionMenu.x}px`,
              top: `${selectionMenu.y}px`,
              transform: selectionMenu.placeBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border-strong)',
              boxShadow: 'var(--shadow-float)',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
            className="z-50 px-2.5 py-1.5 rounded-2xl border flex items-center gap-1.5 font-sans select-none animate-float-in"
          >
            {/* 四色精准划线 */}
            <div className="flex items-center gap-1.5 pr-1.5 border-r" style={{ borderColor: 'var(--border)' }}>
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleQuickUnderline(c.id)}
                  title={`${c.label}划线`}
                  className="w-5 h-5 rounded-full border-2 border-white/80 transition-transform hover:scale-115 active:scale-95"
                  style={{ backgroundColor: c.dot }}
                />
              ))}
            </div>

            <button
              onClick={() => handleOpenNewNoteComposer('amber')}
              className="px-2.5 py-1 rounded-xl text-xs font-medium flex items-center gap-1 text-white transition-transform active:scale-95"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>批注</span>
            </button>

            {selectionGlossary.length > 0 && (
              <button
                onClick={() => {
                  const q = selectionMenu.text
                  const entries = selectionGlossary
                  clearNativeSelection()
                  setActiveGlossaryModal({ query: q, entries })
                }}
                className="px-2 py-1 rounded-xl text-xs font-medium flex items-center gap-1 hover:opacity-85"
                style={{ backgroundColor: 'rgba(180, 81, 42, 0.14)', color: 'var(--accent)' }}
                title="查看哲学辞典术语释义"
              >
                <BookMarked className="w-3.5 h-3.5" />
                <span>术语</span>
              </button>
            )}

            <button
              onClick={() => {
                setQuoteText(selectionMenu.text)
                clearNativeSelection()
              }}
              className="px-2 py-1 rounded-xl text-xs flex items-center gap-1 hover:opacity-80"
              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text)' }}
            >
              <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--gold)' }} />
              <span className="hidden sm:inline">金句卡</span>
            </button>

            <button
              onClick={() => handleCopyCitation(selectionMenu.text)}
              className="px-2 py-1 rounded-xl text-xs flex items-center gap-1 hover:opacity-80"
              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text)' }}
            >
              {copiedFlag ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">引用</span>
            </button>

            <button
              onClick={() => {
                const blkIdx = selectionMenu.blockIndex
                clearNativeSelection()
                onPlayRadioFrom(bookId, chapterIndex, blkIdx)
              }}
              title="从此处开启电台朗读"
              className="p-1.5 rounded-xl hover:opacity-80"
              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--accent)' }}
            >
              <Headphones className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      )}

      {/* 点击已有划线/「注」角标弹出的查看与编辑卡（手机端底部锚定阅读卡，绝不截断） */}
      {inspectHighlight && (
        <>
          {isMobileTapMode && (
            <div
              className="fixed inset-0 z-40 bg-black/30 animate-backdrop-in"
              onClick={() => setInspectHighlight(null)}
            />
          )}
          <div
            onClick={(e) => e.stopPropagation()}
            style={
              isMobileTapMode
                ? {
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border-strong)',
                    boxShadow: 'var(--shadow-float)',
                  }
                : {
                    position: 'fixed',
                    left: `${inspectHighlight.x}px`,
                    top: `${inspectHighlight.y}px`,
                    transform: 'translate(-50%, 0)',
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border-strong)',
                    boxShadow: 'var(--shadow-float)',
                  }
            }
            className={
              isMobileTapMode
                ? 'fixed inset-x-3 bottom-4 z-50 rounded-2xl border p-4 space-y-3 font-sans safe-bottom animate-sheet-up'
                : 'z-50 w-80 max-w-[92vw] rounded-2xl border p-3.5 space-y-2.5 font-sans animate-float-in'
            }
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-serif text-xs line-clamp-3 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                「{inspectHighlight.item.text}」
              </p>
              <button onClick={() => setInspectHighlight(null)} className="p-1 hover:opacity-70 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {inspectHighlight.item.note ? (
              <div
                className="p-3 rounded-xl text-xs leading-relaxed max-h-36 overflow-y-auto overscroll-contain"
                style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text)' }}
              >
                {inspectHighlight.item.note}
              </div>
            ) : (
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                暂无批注，点击下方「写批注」补充思考
              </div>
            )}

            {/* 快捷换色 + 操作 */}
            <div className="flex items-center justify-between pt-2.5 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      triggerHaptic()
                      const it = inspectHighlight.item
                      if (it.groupId) {
                        const groupItems = highlights
                          .filter((h) => h.groupId === it.groupId)
                          .map((h) => ({ ...h, color: c.id }))
                        if (groupItems.length > 0) onAddHighlight(groupItems)
                      } else {
                        onAddHighlight({ ...it, color: c.id })
                      }
                      setInspectHighlight({ ...inspectHighlight, item: { ...it, color: c.id } })
                    }}
                    className={`w-5 h-5 md:w-4 md:h-4 rounded-full ${
                      inspectHighlight.item.color === c.id ? 'ring-2 ring-offset-1 ring-[var(--accent)]' : ''
                    }`}
                    style={{ backgroundColor: c.dot }}
                    title={`切换为${c.label}划线`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    const it = inspectHighlight.item
                    setInspectHighlight(null)
                    setNoteComposer({
                      mode: 'edit',
                      existingId: it.id,
                      existingGroupId: it.groupId,
                      blockIndex: it.blockIndex,
                      startOffset: it.startOffset,
                      endOffset: it.endOffset,
                      text: it.text,
                      color: it.color,
                      note: it.note,
                    })
                  }}
                  className="px-2.5 py-1.5 rounded-xl text-xs md:text-[11px] font-medium flex items-center gap-1"
                  style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <Pencil className="w-3 h-3" />
                  <span>{inspectHighlight.item.note ? '编辑' : '写批注'}</span>
                </button>
                <button
                  onClick={() => {
                    setQuoteText(inspectHighlight.item.text)
                    setInspectHighlight(null)
                  }}
                  className="px-2.5 py-1.5 rounded-xl text-xs md:text-[11px] border"
                  style={{ borderColor: 'var(--border)' }}
                >
                  金句卡
                </button>
                <button
                  onClick={() => {
                    onDeleteHighlight(inspectHighlight.item.id)
                    setInspectHighlight(null)
                    notifyToast('已删除划线与批注')
                  }}
                  className="p-2 md:p-1.5 rounded-xl text-red-500 hover:bg-red-500/10"
                  title="删除此条划线"
                >
                  <Trash2 className="w-4 h-4 md:w-3.5 md:h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 划线批注编辑弹窗（针对手动选中的精准文本，兼容手机软键盘弹出不遮挡保存按钮） */}
      {noteComposer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] animate-backdrop-in"
          onClick={() => setNoteComposer(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md max-h-[88vh] overflow-y-auto overscroll-contain rounded-2xl border p-4 space-y-3 shadow-2xl font-sans animate-sheet-up"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-serif font-bold">
                {noteComposer.mode === 'edit' ? '编辑划线批注' : '添加划线批注'}
              </span>
              <button onClick={() => setNoteComposer(null)} className="p-1 hover:opacity-70">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div
              className="p-3 rounded-xl border-l-4 font-serif text-xs leading-relaxed max-h-28 overflow-y-auto"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderColor: HIGHLIGHT_COLORS.find((c) => c.id === noteComposer.color)?.dot || 'var(--accent)',
                color: 'var(--text-secondary)',
              }}
            >
              {noteComposer.text}
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: 'var(--text-muted)' }}>划线墨色：</span>
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setNoteComposer({ ...noteComposer, color: c.id })}
                  className={`px-2 py-1 rounded-full border text-[11px] flex items-center gap-1 ${
                    noteComposer.color === c.id ? 'font-bold' : 'opacity-70'
                  }`}
                  style={{
                    borderColor: noteComposer.color === c.id ? c.dot : 'var(--border)',
                    backgroundColor: noteComposer.color === c.id ? `${c.dot}22` : 'transparent',
                  }}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.dot }} />
                  <span>{c.label}</span>
                </button>
              ))}
            </div>

            <textarea
              autoFocus
              value={noteComposer.note}
              onChange={(e) => setNoteComposer({ ...noteComposer, note: e.target.value })}
              placeholder="写下你对选中语句的哲学思考、概念辨析或评注…"
              rows={4}
              className="w-full rounded-xl border p-3 text-xs leading-relaxed outline-none resize-none"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setNoteComposer(null)}
                className="px-3.5 py-2 rounded-xl text-xs border"
                style={{ borderColor: 'var(--border)' }}
              >
                取消
              </button>
              <button
                onClick={handleSaveComposer}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                保存划线批注
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 左侧目录抽屉 */}
      {showToc && meta && (
        <div
          className={`${settings.dockTocOnWide ? 'xl:hidden' : ''} fixed inset-0 z-40 flex bg-black/45 backdrop-blur-[2px]`}
          onClick={() => setShowToc(false)}
        >
          <aside
            className="w-80 max-w-[85vw] h-full border-r flex flex-col shadow-2xl animate-float-in"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderTocBody()}
          </aside>
        </div>
      )}

      {/* 排版与主题设置：手机端原生底部抽屉 Bottom Sheet；桌面端右侧浮层卡片 */}
      {showSettings && (
        <>
          {isMobileTapMode && (
            <div
              className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] animate-backdrop-in"
              onClick={() => setShowSettings(false)}
            />
          )}
          <div
            className={
              isMobileTapMode
                ? 'fixed inset-x-0 bottom-0 z-50 max-h-[82vh] overflow-y-auto overscroll-contain rounded-t-3xl border-t px-5 pt-2.5 pb-6 safe-bottom shadow-2xl space-y-4 animate-sheet-up'
                : `fixed right-3 md:right-6 ${isFullscreen ? 'top-16' : 'top-[108px]'} z-40 w-80 max-w-[92vw] max-h-[78vh] overflow-y-auto overscroll-contain rounded-2xl border p-4 shadow-2xl space-y-4 animate-float-in`
            }
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {isMobileTapMode && (
              <div className="flex justify-center pb-1">
                <span className="w-10 h-1 rounded-full opacity-30" style={{ backgroundColor: 'var(--text)' }} />
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold tracking-wider uppercase" style={{ color: 'var(--accent)' }}>
                阅读排版与纸张
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleResetTypography}
                  disabled={isDefaultSettings}
                  className="px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 disabled:opacity-35 hover:opacity-85 transition-opacity"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
                  title="一键恢复默认字号、行距、版心与主题"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>重置默认</span>
                </button>
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-1.5 rounded-lg hover:opacity-70"
                  aria-label="关闭排版设置"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 4 款护眼纸张主题 */}
            <div className="grid grid-cols-4 gap-2">
              {THEME_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    triggerHaptic()
                    onUpdateSettings({ theme: t.id })
                  }}
                  className="flex flex-col items-center gap-1 py-2.5 px-2 rounded-xl border text-[11px] font-medium transition-transform active:scale-95"
                  style={{
                    backgroundColor: t.swatch,
                    color: t.ink,
                    borderColor: settings.theme === t.id ? 'var(--accent)' : 'var(--border-strong)',
                    boxShadow: settings.theme === t.id ? '0 0 0 2px var(--accent)' : 'none',
                  }}
                >
                  <span className="font-serif text-base font-bold">永</span>
                  <span>{t.name.slice(0, 2)}</span>
                </button>
              ))}
            </div>

            {/* 字体族（使用各自真实离线字形即时预览） */}
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['serif', '典雅宋体', 'font-serif'],
                  ['sans', '现代黑体', 'font-sans'],
                  ['kai', '楷书古韵', 'font-kai'],
                ] as const
              ).map(([id, label, previewCls]) => (
                <button
                  key={id}
                  onClick={() => {
                    triggerHaptic()
                    if (settings.fontFamily !== id) {
                      onUpdateSettings({ fontFamily: id })
                      notifyToast(`已切换字体：${label}`)
                    }
                  }}
                  className={`py-2 px-1.5 rounded-xl text-xs font-medium border transition-colors active:scale-95 flex flex-col items-center gap-0.5 ${previewCls}`}
                  style={
                    settings.fontFamily === id
                      ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                      : { backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)' }
                  }
                >
                  <span className="text-[15px] leading-tight">哲思</span>
                  <span className="text-[11px] opacity-90">{label}</span>
                </button>
              ))}
            </div>

            {/* 字号 / 行距 / 段距 */}
            <div className="space-y-3.5 text-xs">
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="font-medium">字号大小</span>
                  <span className="font-mono">{settings.fontSize}px</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => {
                      triggerHaptic()
                      onUpdateSettings({ fontSize: Math.max(14, settings.fontSize - 1) })
                    }}
                    disabled={settings.fontSize <= 14}
                    className="w-10 h-8 rounded-xl border font-serif font-bold text-xs disabled:opacity-35 active:scale-95 shrink-0"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-strong)' }}
                  >
                    A-
                  </button>
                  <input
                    type="range"
                    min={14}
                    max={28}
                    step={1}
                    value={settings.fontSize}
                    onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
                    className="flex-1 accent-[var(--accent)]"
                  />
                  <button
                    onClick={() => {
                      triggerHaptic()
                      onUpdateSettings({ fontSize: Math.min(28, settings.fontSize + 1) })
                    }}
                    disabled={settings.fontSize >= 28}
                    className="w-10 h-8 rounded-xl border font-serif font-bold text-xs disabled:opacity-35 active:scale-95 shrink-0"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-strong)' }}
                  >
                    A+
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between mb-1">
                    <span>行间距</span>
                    <span className="font-mono">{settings.lineHeight.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={1.4}
                    max={2.4}
                    step={0.1}
                    value={settings.lineHeight}
                    onChange={(e) => onUpdateSettings({ lineHeight: Number(e.target.value) })}
                    className="w-full accent-[var(--accent)]"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span>段落间距</span>
                    <span className="font-mono">{settings.paraSpacing}px</span>
                  </div>
                  <input
                    type="range"
                    min={8}
                    max={32}
                    step={2}
                    value={settings.paraSpacing}
                    onChange={(e) => onUpdateSettings({ paraSpacing: Number(e.target.value) })}
                    className="w-full accent-[var(--accent)]"
                  />
                </div>
              </div>
            </div>

            {/* 桌面端专属：版心与双栏排版 */}
            {!isMobileTapMode && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span>版心与全屏排版</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    宽屏推荐双栏/经典
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {COLUMN_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() =>
                        onUpdateSettings(
                          p.id === 'spread'
                            ? { columnWidth: 'spread', readMode: 'page' }
                            : { columnWidth: p.id }
                        )
                      }
                      className="py-1.5 px-2 rounded-lg text-xs border flex items-center justify-center gap-1 transition-colors"
                      style={
                        settings.columnWidth === p.id
                          ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                          : { backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)' }
                      }
                    >
                      {p.id === 'spread' && <Columns2 className="w-3.5 h-3.5" />}
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 翻页方式选择（手机端大卡片直选；桌面端保留全屏沉浸开关） */}
            {isMobileTapMode ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => {
                    triggerHaptic()
                    onUpdateSettings({ readMode: 'scroll', columnWidth: 'medium' })
                  }}
                  className="p-2.5 rounded-xl border text-left transition-all active:scale-95"
                  style={
                    settings.readMode === 'scroll'
                      ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }
                      : { backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text)' }
                  }
                >
                  <div className="font-semibold">平滑滚动</div>
                  <div className="text-[10px] mt-0.5 opacity-75">上下流畅滑动阅读</div>
                </button>
                <button
                  onClick={() => {
                    triggerHaptic()
                    onUpdateSettings({ readMode: 'page', columnWidth: 'medium' })
                  }}
                  className="p-2.5 rounded-xl border text-left transition-all active:scale-95"
                  style={
                    settings.readMode === 'page'
                      ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }
                      : { backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text)' }
                  }
                >
                  <div className="font-semibold">仿真分页</div>
                  <div className="text-[10px] mt-0.5 opacity-75">左右滑动/点边缘翻页</div>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => onUpdateSettings({ readMode: settings.readMode === 'scroll' ? 'page' : 'scroll' })}
                  className="py-2 px-3 rounded-xl border font-medium"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
                >
                  翻页：{settings.readMode === 'scroll' ? '平滑滚动' : '仿真分页'}
                </button>
                <button
                  onClick={() => onToggleFullscreen()}
                  className="py-2 px-3 rounded-xl border font-medium flex items-center justify-center gap-1"
                  style={
                    isFullscreen
                      ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }
                      : { backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)' }
                  }
                >
                  {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
                  <span>{isFullscreen ? '退出全屏' : '全屏沉浸'}</span>
                </button>
              </div>
            )}

            {/* 细节开关 */}
            <div className="flex flex-wrap gap-2 text-xs md:text-[11px]">
              <button
                onClick={() => onUpdateSettings({ textIndent: !settings.textIndent })}
                className="px-3 py-1.5 rounded-full border transition-colors"
                style={
                  settings.textIndent
                    ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }
                    : { borderColor: 'var(--border)' }
                }
              >
                首行缩进
              </button>
              <button
                onClick={() => onUpdateSettings({ justify: !settings.justify })}
                className="px-3 py-1.5 rounded-full border transition-colors"
                style={
                  settings.justify
                    ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }
                    : { borderColor: 'var(--border)' }
                }
              >
                两端对齐
              </button>
              {isMobileTapMode && (
                <button
                  onClick={() => onUpdateSettings({ keepScreenOn: !settings.keepScreenOn })}
                  className="px-3 py-1.5 rounded-full border transition-colors"
                  style={
                    settings.keepScreenOn
                      ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }
                      : { borderColor: 'var(--border)' }
                  }
                >
                  阅读屏幕常亮
                </button>
              )}
              {!isMobileTapMode && (
                <button
                  onClick={() => onUpdateSettings({ dockTocOnWide: !settings.dockTocOnWide })}
                  className="px-3 py-1.5 rounded-full border transition-colors"
                  style={
                    settings.dockTocOnWide
                      ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }
                      : { borderColor: 'var(--border)' }
                  }
                >
                  宽屏常驻目录
                </button>
              )}
              {(getPlatform() === 'android' || isMobileTapMode) && (
                <button
                  onClick={() => onUpdateSettings({ volumeKeyTurn: !settings.volumeKeyTurn })}
                  className="px-3 py-1.5 rounded-full border transition-colors"
                  style={
                    settings.volumeKeyTurn
                      ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }
                      : { borderColor: 'var(--border)' }
                  }
                >
                  音量键翻页
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* 书内全文搜索：手机端顶部贴合全宽抽屉（软键盘弹出不遮挡输入框）；桌面端右上角浮层 */}
      {showInBookSearch && (
        <>
          {isMobileTapMode && (
            <div
              className="fixed inset-0 z-40 bg-black/45 animate-backdrop-in"
              onClick={() => setShowInBookSearch(false)}
            />
          )}
          <div
            onClick={(e) => e.stopPropagation()}
            className={
              isMobileTapMode
                ? 'fixed inset-x-0 top-0 z-50 max-h-[82vh] rounded-b-3xl border-b shadow-2xl flex flex-col overflow-hidden font-sans safe-top animate-float-in'
                : `fixed right-3 md:right-6 ${isFullscreen ? 'top-16' : 'top-[108px]'} z-40 w-96 max-w-[94vw] max-h-[74vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden animate-float-in font-sans`
            }
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
          >
            <div className="p-3.5 md:p-3 border-b flex items-center gap-2 shrink-0" style={{ borderColor: 'var(--border)' }}>
              <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
              <input
                ref={inBookSearchInputRef}
                type="text"
                value={inBookQuery}
                onChange={(e) => handleRunInBookSearch(e.target.value)}
                placeholder={`在《${meta?.title || '本书'}》全文中检索…`}
                className="flex-1 bg-transparent outline-none text-sm md:text-xs"
                style={{ color: 'var(--text)' }}
              />
              {inBookQuery && (
                <button
                  onClick={() => {
                    setInBookQuery('')
                    setInBookHits([])
                  }}
                  className="p-1.5 hover:opacity-70"
                >
                  <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
              <button
                onClick={() => setShowInBookSearch(false)}
                className="px-2 py-1 rounded-lg text-xs font-medium hover:opacity-75"
                style={{ color: 'var(--accent)' }}
                title="关闭书内搜索 (Esc)"
              >
                {isMobileTapMode ? '取消' : <X className="w-4 h-4" />}
              </button>
            </div>

            <div className="px-3.5 py-2 text-[11px] border-b flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
              <span>
                {inBookSearching
                  ? '正在检索全书所有章节正文…'
                  : inBookQuery.trim()
                  ? `共命中 ${inBookHits.length} 处正文段落`
                  : isMobileTapMode
                  ? '支持跨本书全部章节快速定位'
                  : '支持跨全部章节瞬间定位（快捷键 Ctrl+F）'}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-2.5 space-y-2">
              {inBookHits.length === 0 && inBookQuery.trim() && !inBookSearching ? (
                <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>
                  本书正文中未找到「{inBookQuery}」
                </p>
              ) : (
                inBookHits.map((hit, i) => (
                  <button
                    key={`${hit.chapterIndex}_${hit.blockIndex}_${i}`}
                    onClick={() => handleJumpToSearchHit(hit)}
                    className="w-full text-left p-3 md:p-2.5 rounded-xl border transition-colors hover:opacity-90 active:scale-[0.99]"
                    style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                  >
                    <div className="text-[11px] font-semibold truncate" style={{ color: 'var(--accent)' }}>
                      第 {hit.chapterIndex + 1} 章 · {hit.chapterTitle}
                    </div>
                    <p className="text-xs mt-1 line-clamp-2 leading-relaxed font-serif" style={{ color: 'var(--text-secondary)' }}>
                      {hit.snippet}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* 学术脚注与外文译注卡片：手机端底部锚定阅读卡（长脚注清晰可读不截断）；桌面端气泡浮卡 */}
      {footnotePopup && (
        <>
          {isMobileTapMode && (
            <div
              className="fixed inset-0 z-40 bg-black/30 animate-backdrop-in"
              onClick={() => setFootnotePopup(null)}
            />
          )}
          <div
            onClick={(e) => e.stopPropagation()}
            style={
              isMobileTapMode
                ? {
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--accent)',
                    boxShadow: 'var(--shadow-float)',
                  }
                : {
                    position: 'fixed',
                    left: `${footnotePopup.x}px`,
                    top: `${footnotePopup.y}px`,
                    transform: footnotePopup.y > 180 ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--accent)',
                    boxShadow: 'var(--shadow-float)',
                  }
            }
            className={
              isMobileTapMode
                ? 'fixed inset-x-3 bottom-4 z-50 rounded-2xl border p-4 font-sans safe-bottom animate-sheet-up'
                : 'z-50 w-80 max-w-[92vw] rounded-2xl border p-3.5 font-sans animate-float-in'
            }
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs md:text-[11px] font-bold tracking-wider" style={{ color: 'var(--accent)' }}>
                {footnotePopup.kind === 'gloss' ? '外文译注' : `学术脚注 [${footnotePopup.key}]`}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(footnotePopup.text).catch(() => {})
                    notifyToast('已复制注释内容')
                  }}
                  className="px-2 py-0.5 rounded-lg text-[11px] border hover:opacity-80"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  复制
                </button>
                <button onClick={() => setFootnotePopup(null)} className="p-1 hover:opacity-70">
                  <X className="w-4 h-4 md:w-3.5 md:h-3.5" />
                </button>
              </div>
            </div>
            <p className="font-serif text-[13px] md:text-xs leading-relaxed max-h-[42vh] md:max-h-48 overflow-y-auto overscroll-contain select-text" style={{ color: 'var(--text)' }}>
              {footnotePopup.text}
            </p>
          </div>
        </>
      )}

      {/* 跨书哲学术语联动弹窗（《康德辞典》《拉康术语译名表》+ 核心哲学术语库） */}
      {activeGlossaryModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px] animate-float-in"
          onClick={() => setActiveGlossaryModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[80vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden font-sans"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
          >
            <div className="p-4 border-b flex items-center justify-between gap-2" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 min-w-0">
                <BookMarked className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                <span className="font-serif font-bold text-sm truncate">
                  哲学术语辞典 · 「{activeGlossaryModal.query}」
                </span>
              </div>
              <button onClick={() => setActiveGlossaryModal(null)} className="p-1 hover:opacity-70">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {activeGlossaryModal.entries.map((entry, idx) => (
                <div
                  key={`${entry.t}_${idx}`}
                  className="p-3.5 rounded-xl border space-y-2"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-serif font-bold text-sm" style={{ color: 'var(--accent)' }}>
                        {entry.t}
                      </span>
                      {entry.o && (
                        <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                          {entry.o}
                        </span>
                      )}
                    </div>
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                    >
                      {entry.s}
                    </span>
                  </div>
                  <p className="font-serif text-xs leading-relaxed" style={{ color: 'var(--text)' }}>
                    {entry.d}
                  </p>
                  {entry.b && onJumpToBook && (
                    <div className="pt-1 flex justify-end">
                      <button
                        onClick={() => {
                          setActiveGlossaryModal(null)
                          onJumpToBook(entry.b!, entry.c || 0, 0)
                        }}
                        className="text-[11px] font-medium flex items-center gap-1 hover:underline"
                        style={{ color: 'var(--accent)' }}
                      >
                        <span>跳转原辞典词条</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 金句藏书票弹窗 */}
      {quoteText && meta && chapter && (
        <QuoteCardModal
          text={quoteText}
          bookTitle={meta.title}
          author={meta.author}
          chapterTitle={chapter.title}
          onClose={() => setQuoteText(null)}
        />
      )}
    </div>
  )
}
