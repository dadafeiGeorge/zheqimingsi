import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRightLeft,
  ArrowUpDown,
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Headphones,
  Heart,
  Languages,
  LayoutGrid,
  List,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type {
  BookCatalogItem,
  BookFullTextHit,
  BookLang,
  CollectionZone,
  ReadingProgress,
  UserCollection,
} from '../types'
import { BookCover, ShelfFolderCover, type ShelfFolderPreviewBook } from './BookCover'
import {
  BookContextMenu,
  DeleteBookConfirmModal,
  PublicCategoryManagerModal,
  ReclassifyBookModal,
  RecycleBinModal,
  UploadBookModal,
  type StagedUploadFile,
} from './LibraryBookModals'
import {
  deepSearchAllBooks,
  deleteAnyBook,
  getDeletedBuiltInBooks,
  importLocalTextBook,
  reclassifyBook,
  resetBookClassification,
  restoreAllRemovedBuiltInBooks,
  restoreRemovedBuiltInBook,
  searchLibrary,
} from '../services/libraryApi'
import { notifyToast, registerBackHandler, triggerHaptic } from '../services/platform'
import { loadBookOverrides } from '../services/storage'

interface LibraryViewProps {
  isActive?: boolean
  mobileShelfTarget: string | null
  onChangeMobileShelfTarget: (target: string | null) => void
  books: BookCatalogItem[]
  progressMap: Record<string, ReadingProgress>
  favorites: string[]
  userCollections: UserCollection[]
  onToggleFavorite: (bookId: string) => void
  onSaveUserCollections: (next: UserCollection[]) => void
  onOpenBook: (bookId: string, chapterIndex?: number, blockIndex?: number) => void
  onPlayBookRadio: (bookId: string, chapterIndex?: number) => void
  onLaunchRoamRadio: () => void
  onLibraryChanged: () => void
}

interface CategoryDef {
  id: string
  shortLabel: string
}

const ZH_CATEGORIES: CategoryDef[] = [
  { id: '古希腊与近代哲思', shortLabel: '古希腊近代' },
  { id: '德国古典原典', shortLabel: '德国古典' },
  { id: '马克思与批判理论', shortLabel: '马哲批判' },
  { id: '现象学与存在哲学', shortLabel: '现象学存在' },
  { id: '精神分析与后现代', shortLabel: '精神后现代' },
  { id: '张世英哲学全书', shortLabel: '张世英全书' },
  { id: '辞典与术语工具', shortLabel: '辞典术语' },
  { id: '我的导入书架', shortLabel: '本地导入' },
]

const EN_CATEGORIES: CategoryDef[] = [
  { id: '古希腊与近代原典', shortLabel: '古希腊近代' },
  { id: '康德·费希特与谢林', shortLabel: '康德·费希特·谢林' },
  { id: '黑格尔原典与研究', shortLabel: '黑格尔全系' },
  { id: '马克思与批判理论', shortLabel: '马哲批判' },
  { id: '现象学与存在哲学', shortLabel: '现象学存在' },
  { id: '精神分析与后现代', shortLabel: '精神后现代' },
  { id: '辞典与通识百科', shortLabel: '辞典百科' },
  { id: '我的导入书架', shortLabel: '本地导入' },
]

const CATEGORY_SHORT_MAP: Record<string, string> = Object.fromEntries(
  [...ZH_CATEGORIES, ...EN_CATEGORIES].map((c) => [c.id, c.shortLabel])
)

const QUICK_COLLECTION_NAMES: Record<BookLang, string[]> = {
  zh: ['精读计划', '德古核心', '马哲专题', '论文参考'],
  en: ['Bilingual Study', 'German Idealism', 'Critical Theory', 'Lacan & Seminar'],
}

const CUSTOM_PREFIX = 'custom_col:'

function getBookLang(book: BookCatalogItem): BookLang {
  return book.lang === 'en' ? 'en' : 'zh'
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  isActive = true,
  mobileShelfTarget,
  onChangeMobileShelfTarget,
  books,
  progressMap,
  favorites,
  userCollections,
  onToggleFavorite,
  onSaveUserCollections,
  onOpenBook,
  onPlayBookRadio,
  onLaunchRoamRadio,
  onLibraryChanged,
}) => {
  // 顶级语言大分区：中文区 / 英文区
  const [activeZone, setActiveZone] = useState<BookLang>(() => {
    try {
      const saved = localStorage.getItem('lumen_library_zone_v1')
      if (saved === 'zh' || saved === 'en') return saved
    } catch {}
    return 'zh'
  })

  // 当前选中的合集：'全部' | '我的收藏' | 内置分类名 | 'custom_col:<id>'
  const [selectedCollection, setSelectedCollection] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('lumen_library_collection_v1')
      if (saved) return saved
    } catch {}
    return '全部'
  })

  // 双端默认按「最近阅读」排序，并记住用户主动切换过的排序偏好
  const [sortBy, setSortBy] = useState<'default' | 'recent' | 'short' | 'long'>(() => {
    try {
      const saved = localStorage.getItem('lumen_library_sort_v2')
      if (saved === 'default' || saved === 'recent' || saved === 'short' || saved === 'long') return saved
    } catch {}
    return 'recent'
  })
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    try {
      const saved = localStorage.getItem('lumen_library_view_v1')
      if (saved === 'grid' || saved === 'list') return saved
    } catch {}
    return 'grid'
  })

  // 自建合集弹窗状态
  const [editorModal, setEditorModal] = useState<{
    mode: 'create' | 'rename'
    collectionId?: string
    name: string
    zone: CollectionZone
  } | null>(null)
  const [bookAssignTarget, setBookAssignTarget] = useState<BookCatalogItem | null>(null)
  const [quickNewName, setQuickNewName] = useState('')
  const [managingCollectionId, setManagingCollectionId] = useState<string | null>(null)
  const [managePickerQuery, setManagePickerQuery] = useState('')
  const [managePickerZone, setManagePickerZone] = useState<'all' | 'zh' | 'en'>('all')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [bookContextMenu, setBookContextMenu] = useState<{ book: BookCatalogItem; x: number; y: number } | null>(null)
  const [uploadModal, setUploadModal] = useState<{
    zone: BookLang
    category: string
    collectionIds: string[]
  } | null>(null)
  const [reclassifyTarget, setReclassifyTarget] = useState<BookCatalogItem | null>(null)
  const [managingPublicCat, setManagingPublicCat] = useState<{ id: string; zone: BookLang } | null>(null)
  const [deleteConfirmBook, setDeleteConfirmBook] = useState<BookCatalogItem | null>(null)
  const [showRecycleBin, setShowRecycleBin] = useState(false)
  const setMobileShelfTarget = onChangeMobileShelfTarget
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [showMobileShelfMenu, setShowMobileShelfMenu] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null)
  const homeScrollTopRef = useRef<number>(0)
  const shelfScrollTopRef = useRef<number>(0)

  // 从阅读页或其他标签切回书馆时，同步恢复上次所在页面的滚动位置
  useLayoutEffect(() => {
    if (!isActive) return
    const el = scrollContainerRef.current
    if (!el) return
    el.scrollTop = mobileShelfTarget !== null ? shelfScrollTopRef.current : homeScrollTopRef.current
  }, [isActive, mobileShelfTarget])

  const handleSelectZone = (nextZone: BookLang) => {
    if (nextZone === activeZone) return
    setActiveZone(nextZone)
    try {
      localStorage.setItem('lumen_library_zone_v1', nextZone)
    } catch {}
    // 切换大分区时：若当前选中的是跨区自建合集则保留，否则切回新分区的「全部」
    if (selectedCollection.startsWith(CUSTOM_PREFIX)) {
      const cid = selectedCollection.slice(CUSTOM_PREFIX.length)
      const col = userCollections.find((c) => c.id === cid)
      if (col && col.zone === 'all') return
    }
    setSelectedCollection('全部')
    try {
      localStorage.setItem('lumen_library_collection_v1', '全部')
    } catch {}
  }

  const handleSelectCollection = (next: string) => {
    setSelectedCollection(next)
    setConfirmDeleteId(null)
    try {
      localStorage.setItem('lumen_library_collection_v1', next)
    } catch {}
  }

  const openMobileShelf = (target: string) => {
    triggerHaptic()
    homeScrollTopRef.current = scrollContainerRef.current?.scrollTop || 0
    shelfScrollTopRef.current = 0
    handleSelectCollection(target)
    setMobileShelfTarget(target)
    setShowMobileShelfMenu(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }

  const closeMobileShelf = () => {
    triggerHaptic()
    shelfScrollTopRef.current = 0
    setMobileShelfTarget(null)
    setShowMobileShelfMenu(false)
    setConfirmDeleteId(null)
  }

  const handleChangeSort = (next: 'default' | 'recent' | 'short' | 'long') => {
    setSortBy(next)
    try {
      localStorage.setItem('lumen_library_sort_v2', next)
    } catch {}
  }

  const handleChangeViewMode = (next: 'grid' | 'list') => {
    setViewMode(next)
    try {
      localStorage.setItem('lumen_library_view_v1', next)
    } catch {}
  }

  const SORT_OPTIONS: Array<{ id: 'default' | 'recent' | 'short' | 'long'; label: string; desc: string }> = [
    { id: 'recent', label: '按最近阅读', desc: '最近打开过的典籍置顶' },
    { id: 'default', label: '经典书系排序', desc: '按原典学派与体系排列' },
    { id: 'short', label: '篇幅由短到长', desc: '先易后难，轻快入门' },
    { id: 'long', label: '篇幅由长到短', desc: '鸿篇巨制深度精读' },
  ]
  const currentSortLabel = SORT_OPTIONS.find((s) => s.id === sortBy)?.label || '按最近阅读'

  // 分区书籍统计
  const zhBooks = useMemo(() => books.filter((b) => getBookLang(b) === 'zh'), [books])
  const enBooks = useMemo(() => books.filter((b) => getBookLang(b) === 'en'), [books])
  const zoneBooks = activeZone === 'en' ? enBooks : zhBooks
  const zoneCategoryDefs = activeZone === 'en' ? EN_CATEGORIES : ZH_CATEGORIES

  const zoneCategoryCounts = useMemo(() => {
    const map: Record<string, number> = {
      全部: zoneBooks.length,
      我的收藏: zoneBooks.filter((b) => favorites.includes(b.id)).length,
    }
    for (const b of zoneBooks) {
      map[b.category] = (map[b.category] || 0) + 1
    }
    return map
  }, [zoneBooks, favorites])

  // 当前分区可见的自建合集（本分区 + 跨区合集）
  const visibleUserCollections = useMemo(
    () => userCollections.filter((c) => c.zone === activeZone || c.zone === 'all'),
    [userCollections, activeZone]
  )

  const bookIdSet = useMemo(() => new Set(books.map((b) => b.id)), [books])

  const activeUserCollection = useMemo(() => {
    if (!selectedCollection.startsWith(CUSTOM_PREFIX)) return null
    const cid = selectedCollection.slice(CUSTOM_PREFIX.length)
    return userCollections.find((c) => c.id === cid) || null
  }, [selectedCollection, userCollections])

  const activePublicCategory = useMemo(() => {
    if (
      selectedCollection === '全部' ||
      selectedCollection === '我的收藏' ||
      selectedCollection.startsWith(CUSTOM_PREFIX)
    ) {
      return null
    }
    const def = zoneCategoryDefs.find((d) => d.id === selectedCollection)
    return def ? { ...def, zone: activeZone } : null
  }, [selectedCollection, zoneCategoryDefs, activeZone])

  const removedBuiltInBooks = useMemo(() => getDeletedBuiltInBooks(), [books])
  const bookOverridesMap = useMemo(() => loadBookOverrides(), [books])

  // 若选中的自建合集已被删除或当前分区不存在该分类，优雅回退至「全部」
  useEffect(() => {
    if (selectedCollection.startsWith(CUSTOM_PREFIX)) {
      if (!activeUserCollection) {
        handleSelectCollection('全部')
      }
      return
    }
    if (selectedCollection === '全部' || selectedCollection === '我的收藏') return
    if (!zoneCategoryDefs.some((d) => d.id === selectedCollection)) {
      handleSelectCollection('全部')
    }
  }, [selectedCollection, activeUserCollection, zoneCategoryDefs])

  // 每本书所属的自建合集映射（用于卡片角标提示）
  const bookToCollectionIds = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const col of userCollections) {
      for (const bid of col.bookIds) {
        const arr = map.get(bid)
        if (arr) arr.push(col.id)
        else map.set(bid, [col.id])
      }
    }
    return map
  }, [userCollections])

  // Android 返回键分层关闭弹窗（仅在书馆页激活时注册，绝不与阅读页/电台页互相干扰）
  useEffect(() => {
    if (!isActive || !showSortMenu) return
    return registerBackHandler(60, () => {
      setShowSortMenu(false)
      return true
    })
  }, [isActive, showSortMenu])

  useEffect(() => {
    if (
      !isActive ||
      (!editorModal &&
        !bookAssignTarget &&
        !managingCollectionId &&
        !bookContextMenu &&
        !uploadModal &&
        !reclassifyTarget &&
        !managingPublicCat &&
        !deleteConfirmBook &&
        !showRecycleBin &&
        !showMobileShelfMenu)
    ) {
      return
    }
    return registerBackHandler(65, () => {
      if (deleteConfirmBook) setDeleteConfirmBook(null)
      else if (bookContextMenu) setBookContextMenu(null)
      else if (uploadModal) setUploadModal(null)
      else if (reclassifyTarget) setReclassifyTarget(null)
      else if (managingPublicCat) setManagingPublicCat(null)
      else if (showRecycleBin) setShowRecycleBin(false)
      else if (editorModal) setEditorModal(null)
      else if (bookAssignTarget) setBookAssignTarget(null)
      else if (managingCollectionId) setManagingCollectionId(null)
      else if (showMobileShelfMenu) setShowMobileShelfMenu(false)
      return true
    })
  }, [
    isActive,
    editorModal,
    bookAssignTarget,
    managingCollectionId,
    bookContextMenu,
    uploadModal,
    reclassifyTarget,
    managingPublicCat,
    deleteConfirmBook,
    showRecycleBin,
    showMobileShelfMenu,
  ])

  useEffect(() => {
    if (!isActive || !mobileSearchOpen) return
    const t = window.setTimeout(() => mobileSearchInputRef.current?.focus(), 60)
    const unreg = registerBackHandler(45, () => {
      deepAbortRef.current?.abort()
      setSearchQuery('')
      setSearchResults([])
      setSearching(false)
      setMobileSearchOpen(false)
      return true
    })
    return () => {
      window.clearTimeout(t)
      unreg()
    }
  }, [isActive, mobileSearchOpen])

  useEffect(() => {
    if (!isActive || mobileShelfTarget === null) return
    return registerBackHandler(35, () => {
      shelfScrollTopRef.current = 0
      setMobileShelfTarget(null)
      setShowMobileShelfMenu(false)
      setConfirmDeleteId(null)
      return true
    })
  }, [isActive, mobileShelfTarget])

  const [searchQuery, setSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useState<'fast' | 'deep'>('fast')
  const [searchResults, setSearchResults] = useState<
    Array<{
      bookId: string
      bookTitle: string
      author: string
      chapterIndex: number
      chapterTitle: string
      blockIndex?: number
      snippet: string
    }>
  >([])
  const [searching, setSearching] = useState(false)
  const [deepProgress, setDeepProgress] = useState<{ scanned: number; total: number }>({ scanned: 0, total: 0 })
  const deepAbortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const bookMap = useMemo(() => new Map(books.map((b) => [b.id, b])), [books])

  // 书馆搜索结果打开时，按 Android 返回键优先清空并关闭搜索面板
  useEffect(() => {
    if (!isActive || !searchQuery.trim()) return
    return registerBackHandler(40, () => {
      deepAbortRef.current?.abort()
      setSearchQuery('')
      setSearchResults([])
      setSearching(false)
      return true
    })
  }, [isActive, searchQuery])

  // 最近阅读的一本书（用于顶部 Hero 续读卡）
  const latestBook = useMemo(() => {
    const entries = Object.values(progressMap).sort((a, b) => b.updatedAt - a.updatedAt)
    for (const p of entries) {
      const b = books.find((x) => x.id === p.bookId)
      if (b) return { book: b, progress: p }
    }
    return null
  }, [books, progressMap])

  const filteredBooks = useMemo(() => {
    let list: BookCatalogItem[]
    if (activeUserCollection) {
      const idSet = new Set(activeUserCollection.bookIds)
      list = books.filter((b) => idSet.has(b.id))
    } else if (selectedCollection === '我的收藏') {
      list = zoneBooks.filter((b) => favorites.includes(b.id))
    } else if (selectedCollection === '全部') {
      list = [...zoneBooks]
    } else {
      list = zoneBooks.filter((b) => b.category === selectedCollection)
    }

    if (sortBy === 'recent') {
      list.sort((a, b) => (progressMap[b.id]?.updatedAt || 0) - (progressMap[a.id]?.updatedAt || 0))
    } else if (sortBy === 'short') {
      list.sort((a, b) => (a.wordCount || a.charCount) - (b.wordCount || b.charCount))
    } else if (sortBy === 'long') {
      list.sort((a, b) => (b.wordCount || b.charCount) - (a.wordCount || a.charCount))
    }
    return list
  }, [books, zoneBooks, activeUserCollection, selectedCollection, favorites, sortBy, progressMap])

  /* ---------- 自建合集 CRUD 操作 ---------- */
  const handleSubmitEditor = (openBookPickerAfter = false) => {
    if (!editorModal) return
    const trimmed = editorModal.name.trim()
    if (!trimmed) {
      notifyToast('请输入合集名称')
      return
    }
    if (trimmed.length > 24) {
      notifyToast('合集名称请控制在 24 字以内')
      return
    }
    const now = Date.now()
    if (editorModal.mode === 'create') {
      if (userCollections.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
        notifyToast('已存在同名合集，请换一个名称')
        return
      }
      const newCol: UserCollection = {
        id: `col_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name: trimmed,
        zone: editorModal.zone,
        bookIds: [],
        createdAt: now,
        updatedAt: now,
      }
      onSaveUserCollections([...userCollections, newCol])
      if (newCol.zone !== 'all' && newCol.zone !== activeZone) {
        setActiveZone(newCol.zone)
        try {
          localStorage.setItem('lumen_library_zone_v1', newCol.zone)
        } catch {}
      }
      handleSelectCollection(`${CUSTOM_PREFIX}${newCol.id}`)
      setMobileShelfTarget(`${CUSTOM_PREFIX}${newCol.id}`)
      setEditorModal(null)
      notifyToast(`已创建合集「${trimmed}」`)
      if (openBookPickerAfter) {
        setManagePickerZone(newCol.zone === 'all' ? 'all' : newCol.zone)
        setManagePickerQuery('')
        setManagingCollectionId(newCol.id)
      }
    } else if (editorModal.collectionId) {
      if (
        userCollections.some(
          (c) => c.id !== editorModal.collectionId && c.name.toLowerCase() === trimmed.toLowerCase()
        )
      ) {
        notifyToast('已存在同名合集，请换一个名称')
        return
      }
      const next = userCollections.map((c) =>
        c.id === editorModal.collectionId
          ? { ...c, name: trimmed, zone: editorModal.zone, updatedAt: now }
          : c
      )
      onSaveUserCollections(next)
      if (editorModal.zone !== 'all' && editorModal.zone !== activeZone) {
        setActiveZone(editorModal.zone)
        try {
          localStorage.setItem('lumen_library_zone_v1', editorModal.zone)
        } catch {}
      }
      setEditorModal(null)
      notifyToast(`已更新合集「${trimmed}」`)
    }
  }

  const handleDeleteCollection = (colId: string) => {
    const target = userCollections.find((c) => c.id === colId)
    const next = userCollections.filter((c) => c.id !== colId)
    onSaveUserCollections(next)
    setConfirmDeleteId(null)
    if (selectedCollection === `${CUSTOM_PREFIX}${colId}`) {
      handleSelectCollection('全部')
    }
    if (mobileShelfTarget === `${CUSTOM_PREFIX}${colId}`) {
      setMobileShelfTarget(null)
      setShowMobileShelfMenu(false)
    }
    if (target) notifyToast(`已删除合集「${target.name}」`)
  }

  const handleToggleBookInCollection = (colId: string, bookId: string) => {
    const now = Date.now()
    const next = userCollections.map((c) => {
      if (c.id !== colId) return c
      const exists = c.bookIds.includes(bookId)
      return {
        ...c,
        bookIds: exists ? c.bookIds.filter((id) => id !== bookId) : [bookId, ...c.bookIds],
        updatedAt: now,
      }
    })
    onSaveUserCollections(next)
  }

  const handleQuickCreateAndAssign = () => {
    if (!bookAssignTarget) return
    const trimmed = quickNewName.trim()
    if (!trimmed) {
      notifyToast('请输入新合集名称')
      return
    }
    if (trimmed.length > 24) {
      notifyToast('合集名称请控制在 24 字以内')
      return
    }
    if (userCollections.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      notifyToast('已存在同名合集，可直接勾选')
      return
    }
    const now = Date.now()
    const bLang = getBookLang(bookAssignTarget)
    const newCol: UserCollection = {
      id: `col_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      zone: bLang,
      bookIds: [bookAssignTarget.id],
      createdAt: now,
      updatedAt: now,
    }
    onSaveUserCollections([...userCollections, newCol])
    setQuickNewName('')
    notifyToast(`已新建「${trimmed}」并收入本书`)
  }

  /* ---------- 搜索与本地导入 ---------- */
  const runSearch = async (val: string, mode: 'fast' | 'deep') => {
    if (deepAbortRef.current) {
      deepAbortRef.current.abort()
      deepAbortRef.current = null
    }
    const q = val.trim()
    if (!q) {
      setSearchResults([])
      setSearching(false)
      setDeepProgress({ scanned: 0, total: 0 })
      return
    }
    setSearching(true)
    if (mode === 'fast') {
      try {
        const res = await searchLibrary(q)
        setSearchResults(res)
      } finally {
        setSearching(false)
      }
      return
    }

    const ac = new AbortController()
    deepAbortRef.current = ac
    setSearchResults([])
    setDeepProgress({ scanned: 0, total: books.length })
    try {
      const hits: BookFullTextHit[] = await deepSearchAllBooks(
        q,
        (scanned, total, partialHits) => {
          if (ac.signal.aborted) return
          setDeepProgress({ scanned, total })
          setSearchResults([...partialHits])
        },
        ac.signal,
        120
      )
      if (!ac.signal.aborted) {
        setSearchResults(hits)
      }
    } finally {
      if (deepAbortRef.current === ac) deepAbortRef.current = null
      if (!ac.signal.aborted) setSearching(false)
    }
  }

  const handleSearchChange = async (val: string) => {
    setSearchQuery(val)
    if (searchMode === 'fast' || !val.trim()) {
      await runSearch(val, 'fast')
    }
  }

  const handleToggleSearchMode = (mode: 'fast' | 'deep') => {
    setSearchMode(mode)
    if (searchQuery.trim()) {
      runSearch(searchQuery, mode)
    }
  }

  const openUploadModal = (zoneOverride?: BookLang, catOverride?: string, colIdsOverride?: string[]) => {
    const targetZone = zoneOverride || activeZone
    const fallbackCats = targetZone === 'en' ? EN_CATEGORIES : ZH_CATEGORIES
    const defaultCat =
      catOverride ||
      (activePublicCategory && activePublicCategory.zone === targetZone
        ? activePublicCategory.id
        : fallbackCats[0]?.id || '我的导入书架')
    const defaultCols =
      colIdsOverride !== undefined
        ? colIdsOverride
        : activeUserCollection
        ? [activeUserCollection.id]
        : []
    setUploadModal({ zone: targetZone, category: defaultCat, collectionIds: defaultCols })
  }

  const handleImportClick = () => {
    openUploadModal()
  }

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const added = await importLocalTextBook(file.name, text, {
      lang: activeZone,
      category: activePublicCategory?.id || '我的导入书架',
    })
    onLibraryChanged()
    notifyToast(`已导入《${added.title}》`)
    e.target.value = ''
  }

  const handleUploadSubmit = async (payload: {
    files: StagedUploadFile[]
    zone: BookLang
    category: string
    collectionIds: string[]
    customTitle?: string
    customAuthor?: string
  }) => {
    const addedBooks: BookCatalogItem[] = []
    for (const f of payload.files) {
      const added = await importLocalTextBook(f.name, f.content, {
        title: payload.files.length === 1 ? payload.customTitle : undefined,
        author: payload.customAuthor,
        category: payload.category,
        lang: payload.zone,
      })
      addedBooks.push(added)
    }
    if (payload.collectionIds.length > 0 && addedBooks.length > 0) {
      const now = Date.now()
      const newIds = addedBooks.map((b) => b.id)
      const nextCols = userCollections.map((c) =>
        payload.collectionIds.includes(c.id)
          ? { ...c, bookIds: Array.from(new Set([...newIds, ...c.bookIds])), updatedAt: now }
          : c
      )
      onSaveUserCollections(nextCols)
    }
    onLibraryChanged()
    if (payload.zone !== activeZone && payload.collectionIds.length === 0) {
      setActiveZone(payload.zone)
      try {
        localStorage.setItem('lumen_library_zone_v1', payload.zone)
      } catch {}
    }
    const shortCat = CATEGORY_SHORT_MAP[payload.category] || payload.category
    if (addedBooks.length === 1) {
      notifyToast(`已上传《${addedBooks[0].title}》至「${shortCat}」`)
    } else {
      notifyToast(`已批量上传 ${addedBooks.length} 部图书至「${shortCat}」`)
    }
  }

  const openBookContextMenu = (e: React.MouseEvent, book: BookCatalogItem) => {
    e.preventDefault()
    e.stopPropagation()
    setBookContextMenu({ book, x: e.clientX, y: e.clientY })
  }

  const handleReclassifySave = async (
    book: BookCatalogItem,
    patch: { lang: BookLang; category: string; title: string; author: string }
  ) => {
    await reclassifyBook(book.id, patch)
    onLibraryChanged()
    const shortCat = CATEGORY_SHORT_MAP[patch.category] || patch.category
    notifyToast(`已将《${patch.title}》归类至「${shortCat}」`)
  }

  const handleMoveBookToPublicCategory = async (
    book: BookCatalogItem,
    targetZone: BookLang,
    targetCategory: string
  ) => {
    await reclassifyBook(book.id, { lang: targetZone, category: targetCategory })
    onLibraryChanged()
    const shortCat = CATEGORY_SHORT_MAP[targetCategory] || targetCategory
    notifyToast(`已将《${book.title}》归入「${shortCat}」`)
  }

  const handleConfirmDeleteBook = async (book: BookCatalogItem) => {
    await deleteAnyBook(book.id)
    if (favorites.includes(book.id)) {
      onToggleFavorite(book.id)
    }
    const affected = userCollections.some((c) => c.bookIds.includes(book.id))
    if (affected) {
      const now = Date.now()
      onSaveUserCollections(
        userCollections.map((c) =>
          c.bookIds.includes(book.id)
            ? { ...c, bookIds: c.bookIds.filter((id) => id !== book.id), updatedAt: now }
            : c
        )
      )
    }
    onLibraryChanged()
    notifyToast(book.isCustom ? `已删除《${book.title}》` : `已从书架移除《${book.title}》`)
  }

  const formatBookLength = (book: BookCatalogItem) => {
    if (getBookLang(book) === 'en') {
      const w = book.wordCount || Math.round(book.charCount / 6)
      return w >= 10000 ? `${(w / 10000).toFixed(1)} 万词` : `${w} 词`
    }
    if (book.bilingual) {
      const zh = book.wordCount || Math.round(book.charCount * 0.25)
      return zh >= 10000 ? `中英 ${(zh / 10000).toFixed(1)} 万字` : `中英 ${zh} 字`
    }
    return book.charCount >= 10000 ? `${(book.charCount / 10000).toFixed(1)} 万字` : `${book.charCount} 字`
  }

  const zoneLabel = (z: CollectionZone) => (z === 'en' ? '英文区' : z === 'all' ? '中英跨区' : '中文区')

  // 批量管理书目弹窗中使用的列表
  const managingCollection = useMemo(
    () => (managingCollectionId ? userCollections.find((c) => c.id === managingCollectionId) || null : null),
    [managingCollectionId, userCollections]
  )

  const managePickerBooks = useMemo(() => {
    const q = managePickerQuery.trim().toLowerCase()
    return books.filter((b) => {
      if (managePickerZone !== 'all' && getBookLang(b) !== managePickerZone) return false
      if (!q) return true
      return (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q)
      )
    })
  }, [books, managePickerQuery, managePickerZone])

  // 为移动端「合集实体书架」预先计算每个合集的 2×2 真实迷你书封预览
  const toPreview = (list: BookCatalogItem[]): ShelfFolderPreviewBook[] =>
    list.slice(0, 4).map((b) => ({
      id: b.id,
      title: b.title,
      palette: b.coverPalette,
      monogram: b.monogram,
    }))

  const favoritePreviewBooks = useMemo(() => {
    const favSet = new Set(favorites)
    return toPreview(zoneBooks.filter((b) => favSet.has(b.id)))
  }, [zoneBooks, favorites])

  const categoryPreviewMap = useMemo(() => {
    const map: Record<string, ShelfFolderPreviewBook[]> = {}
    for (const b of zoneBooks) {
      const arr = map[b.category] || (map[b.category] = [])
      if (arr.length < 4) {
        arr.push({ id: b.id, title: b.title, palette: b.coverPalette, monogram: b.monogram })
      }
    }
    return map
  }, [zoneBooks])

  const userCollectionPreviewMap = useMemo(() => {
    const map: Record<string, ShelfFolderPreviewBook[]> = {}
    for (const col of userCollections) {
      const arr: ShelfFolderPreviewBook[] = []
      for (const bid of col.bookIds) {
        const b = bookMap.get(bid)
        if (b) {
          arr.push({ id: b.id, title: b.title, palette: b.coverPalette, monogram: b.monogram })
          if (arr.length >= 4) break
        }
      }
      map[col.id] = arr
    }
    return map
  }, [userCollections, bookMap])

  const mobileShelfTitle = useMemo(() => {
    if (activeUserCollection) return activeUserCollection.name
    if (activePublicCategory) return activePublicCategory.shortLabel
    if (selectedCollection === '我的收藏') return '我的收藏'
    return activeZone === 'en' ? '全部英文原典' : '全部中文典藏'
  }, [activeUserCollection, activePublicCategory, selectedCollection, activeZone])

  const QUICK_SEARCH_TAGS =
    activeZone === 'en'
      ? ['Kant', 'Hegel', 'Heidegger', 'Marx', 'Lacan', 'Phenomenology']
      : ['黑格尔', '康德', '谢林', '现象学', '资本论', '存在与时间', '海德格尔', '拉康']

  const renderSearchResultsPanel = () => (
    <section
      className="rounded-2xl border p-3.5 md:p-4 animate-float-in"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)', boxShadow: 'var(--shadow-soft)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="inline-flex rounded-lg border p-0.5 text-[11px]"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <button
              onClick={() => handleToggleSearchMode('fast')}
              className="px-2.5 py-1 rounded-md font-medium transition-colors"
              style={
                searchMode === 'fast'
                  ? { backgroundColor: 'var(--accent)', color: '#fff' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              标题与章节速搜
            </button>
            <button
              onClick={() => handleToggleSearchMode('deep')}
              className="px-2.5 py-1 rounded-md font-medium transition-colors"
              style={
                searchMode === 'deep'
                  ? { backgroundColor: 'var(--accent)', color: '#fff' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              全库正文深搜 ({books.length}部)
            </button>
          </div>

          <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
            {searching
              ? searchMode === 'deep'
                ? `正在深度扫描正文 ${deepProgress.scanned}/${deepProgress.total} 部（已命中 ${searchResults.length} 处）…`
                : '正在全库检索…'
              : `找到 ${searchResults.length} 条${searchMode === 'deep' ? '正文深度命中' : '相关典籍与章节'}`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {searchMode === 'deep' && searching && (
            <button
              onClick={() => {
                deepAbortRef.current?.abort()
                setSearching(false)
              }}
              className="text-xs px-2 py-0.5 rounded border hover:opacity-80"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--accent)' }}
            >
              停止扫描
            </button>
          )}
          {searchMode === 'fast' && (
            <button
              onClick={() => handleToggleSearchMode('deep')}
              className="text-xs font-medium hover:underline"
              style={{ color: 'var(--accent)' }}
            >
              深度搜全书正文 →
            </button>
          )}
          <button
            onClick={() => {
              deepAbortRef.current?.abort()
              setSearchQuery('')
              setSearchResults([])
              setSearching(false)
            }}
            className="text-xs hover:underline"
            style={{ color: 'var(--text-muted)' }}
          >
            清除检索
          </button>
        </div>
      </div>

      {searchMode === 'deep' && searching && deepProgress.total > 0 && (
        <div className="w-full h-1 rounded-full overflow-hidden mb-3" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <div
            className="h-full transition-all duration-200"
            style={{
              width: `${Math.round((deepProgress.scanned / Math.max(1, deepProgress.total)) * 100)}%`,
              backgroundColor: 'var(--accent)',
            }}
          />
        </div>
      )}

      {searchResults.length === 0 && !searching ? (
        <div className="text-sm py-6 text-center space-y-2" style={{ color: 'var(--text-muted)' }}>
          <p>
            未在{searchMode === 'deep' ? '全库正文' : '书目与章节标题'}中找到包含「{searchQuery}」的内容
          </p>
          {searchMode === 'fast' && (
            <button
              onClick={() => handleToggleSearchMode('deep')}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              改为全库 {books.length} 部正文深度检索
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[64vh] md:max-h-80 overflow-y-auto pr-1">
          {searchResults.map((r, i) => {
            const matchedBook = bookMap.get(r.bookId)
            const isEn = matchedBook && getBookLang(matchedBook) === 'en'
            return (
              <button
                key={`${r.bookId}_${r.chapterIndex}_${r.blockIndex ?? 0}_${i}`}
                onClick={() => onOpenBook(r.bookId, r.chapterIndex, r.blockIndex ?? 0)}
                className="text-left p-3 rounded-xl border transition-all hover:translate-y-[-1px] active:scale-[0.99]"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        backgroundColor: isEn ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                        color: isEn ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                    >
                      {isEn ? 'EN' : '中'}
                    </span>
                    <span className="font-serif font-bold text-sm truncate">{r.bookTitle}</span>
                  </div>
                  <span className="text-[11px] shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {r.author}
                  </span>
                </div>
                <div className="text-xs font-medium mt-1 truncate" style={{ color: 'var(--accent)' }}>
                  {r.chapterTitle}
                </div>
                {r.snippet && (
                  <p className="text-[11px] line-clamp-2 mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {r.snippet}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )

  const renderBooksBody = () =>
    filteredBooks.length === 0 ? (
      <div className="py-16 text-center space-y-3" style={{ color: 'var(--text-muted)' }}>
        {activeUserCollection ? (
          <FolderOpen className="w-9 h-9 mx-auto opacity-30" />
        ) : (
          <Heart className="w-8 h-8 mx-auto opacity-30" />
        )}
        <p className="text-sm font-serif px-6" style={{ color: 'var(--text-secondary)' }}>
          {activeUserCollection
            ? `合集「${activeUserCollection.name}」还没有收入典籍，点击下方自由挑书加入`
            : selectedCollection === '我的收藏'
            ? `${activeZone === 'en' ? '英文区' : '中文区'}尚未收藏典籍，点击任意书籍旁的「❤」即可收藏`
            : '当前合集暂无典籍'}
        </p>
        <div className="flex items-center justify-center gap-2">
          {activeUserCollection ? (
            <button
              onClick={() => {
                setManagePickerZone(activeUserCollection.zone === 'all' ? 'all' : activeUserCollection.zone)
                setManagePickerQuery('')
                setManagingCollectionId(activeUserCollection.id)
              }}
              className="px-4 py-2 rounded-full text-xs font-semibold text-white shadow-sm active:scale-95 transition-transform flex items-center gap-1.5"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>挑选典籍加入合集</span>
            </button>
          ) : (
            selectedCollection !== '全部' && (
              <button
                onClick={() => {
                  handleSelectCollection('全部')
                  if (mobileShelfTarget !== null) setMobileShelfTarget('全部')
                }}
                className="px-4 py-2 rounded-full text-xs font-semibold text-white shadow-sm active:scale-95 transition-transform"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                浏览{activeZone === 'en' ? '英文区' : '中文区'}全部 {zoneBooks.length} 部典籍
              </button>
            )
          )}
        </div>
      </div>
    ) : viewMode === 'grid' ? (
      <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-3 gap-y-4 md:gap-5">
        {filteredBooks.map((book) => {
          const prog = progressMap[book.id]
          const isFav = favorites.includes(book.id)
          const inColCount = bookToCollectionIds.get(book.id)?.length || 0
          const pct = prog ? Math.round(((prog.chapterIndex + 1) / Math.max(1, book.chapterCount)) * 100) : 0
          const bLang = getBookLang(book)

          return (
            <div
              key={book.id}
              onClick={() => onOpenBook(book.id, prog?.chapterIndex, prog?.blockIndex || 0)}
              onContextMenu={(e) => openBookContextMenu(e, book)}
              className="group cursor-pointer flex flex-col"
            >
              <div className="relative">
                <BookCover
                  title={book.title}
                  author={book.author}
                  category={book.category}
                  palette={book.coverPalette}
                  monogram={book.monogram}
                  lang={bLang}
                  bilingual={book.bilingual}
                  className="group-hover:-translate-y-1.5 group-hover:shadow-xl"
                />

                {/* 右上角：移动端仅留轻盈收藏心形，封面清爽无遮挡；桌面端悬浮显示合集按钮 */}
                <div className="absolute top-1.5 right-1.5 md:top-2.5 md:right-2.5 flex flex-col gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      triggerHaptic()
                      onToggleFavorite(book.id)
                    }}
                    className="w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center bg-black/30 md:bg-black/35 backdrop-blur-sm text-white/90 opacity-75 md:opacity-0 md:group-hover:opacity-100 transition-opacity active:scale-90"
                    style={isFav ? { opacity: 1 } : undefined}
                    title={isFav ? '取消收藏' : '加入收藏'}
                  >
                    <Heart className={`w-3 h-3 md:w-3.5 md:h-3.5 ${isFav ? 'fill-red-400 text-red-400' : ''}`} />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setQuickNewName('')
                      setBookAssignTarget(book)
                    }}
                    className="hidden md:flex w-7 h-7 rounded-full items-center justify-center bg-black/35 backdrop-blur-sm text-white/90 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={inColCount > 0 ? { opacity: 1, backgroundColor: 'rgba(198,138,48,0.82)' } : undefined}
                    title={inColCount > 0 ? `已收入 ${inColCount} 个自建合集` : '收入自建合集'}
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 桌面端快捷电台收听悬浮按钮（移动端已集成至底部「…」菜单） */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onPlayBookRadio(book.id, prog?.chapterIndex)
                  }}
                  className="hidden md:flex absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full items-center justify-center text-white shadow-lg opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                  style={{ backgroundColor: 'var(--accent)' }}
                  title="微软电台收听本书"
                >
                  <Headphones className="w-3.5 h-3.5" />
                </button>

                {/* 桌面端封面左下角更多菜单（移动端放在下方书名旁，不遮挡封面） */}
                <button
                  onClick={(e) => openBookContextMenu(e, book)}
                  className="hidden md:flex absolute bottom-2.5 left-3.5 w-7 h-7 rounded-full items-center justify-center bg-black/40 backdrop-blur-sm text-white/90 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                  title="更多操作（右键图书亦可呼出）"
                  aria-label="更多操作"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>

                {/* 阅读进度角标 */}
                {pct > 0 && (
                  <div className="absolute bottom-0 inset-x-0 h-1 bg-black/30 rounded-b-xl overflow-hidden">
                    <div className="h-full" style={{ width: `${pct}%`, backgroundColor: 'var(--gold)' }} />
                  </div>
                )}
              </div>

              <div className="mt-1.5 md:mt-2.5 px-0.5">
                <div className="flex items-start justify-between gap-0.5">
                  <h3 className="font-serif font-semibold text-[12px] md:text-[13px] leading-snug line-clamp-2 group-hover:underline flex-1 min-w-0">
                    {book.title}
                  </h3>
                  <button
                    onClick={(e) => {
                      triggerHaptic()
                      openBookContextMenu(e, book)
                    }}
                    className="md:hidden -mr-1.5 -mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 active:scale-90"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label="更多操作"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between text-[10px] md:text-[11px] mt-0.5 gap-1" style={{ color: 'var(--text-muted)' }}>
                  <span className="truncate">{book.author}</span>
                  <span className="hidden md:inline shrink-0">{formatBookLength(book)}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    ) : (
      <div className="space-y-2.5">
        {filteredBooks.map((book) => {
          const prog = progressMap[book.id]
          const isFav = favorites.includes(book.id)
          const inColCount = bookToCollectionIds.get(book.id)?.length || 0
          const pct = prog
            ? Math.min(100, Math.max(1, Math.round(((prog.chapterIndex + 1) / Math.max(1, book.chapterCount)) * 100)))
            : 0
          const estHours =
            book.estReadMin >= 60 ? `约${(book.estReadMin / 60).toFixed(1)}小时` : `约${book.estReadMin}分钟`
          const shortCat = CATEGORY_SHORT_MAP[book.category] || book.category
          const bLang = getBookLang(book)

          return (
            <div
              key={book.id}
              onClick={() => onOpenBook(book.id, prog?.chapterIndex, prog?.blockIndex || 0)}
              onContextMenu={(e) => openBookContextMenu(e, book)}
              className="p-2.5 md:p-3.5 rounded-2xl border flex items-center gap-2.5 md:gap-4 cursor-pointer transition-all hover:translate-y-[-1px] active:scale-[0.99]"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <BookCover
                title={book.title}
                author={book.author}
                category={book.category}
                palette={book.coverPalette}
                monogram={book.monogram}
                lang={bLang}
                bilingual={book.bilingual}
                size="xs"
                className="shrink-0"
              />
              <div className="flex-1 min-w-0">
                <h3 className="font-serif font-bold text-[14.5px] md:text-[15px] leading-snug line-clamp-2">
                  {book.title}
                </h3>
                <div className="flex items-center gap-1.5 mt-1 min-w-0">
                  <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                    {book.author}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap"
                    style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  >
                    {shortCat}
                  </span>
                  {bLang === 'en' && (
                    <span
                      className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      EN
                    </span>
                  )}
                  {book.bilingual && (
                    <span
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      {book.bilingual === 'sentence' ? '逐句对照' : '逐段对照'}
                    </span>
                  )}
                  {inColCount > 0 && (
                    <span
                      className="md:hidden inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--gold)' }}
                    >
                      <Folder className="w-2.5 h-2.5" />
                      {inColCount}
                    </span>
                  )}
                </div>
                <div
                  className="flex items-center gap-x-1 md:gap-x-1.5 mt-1 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <span className="shrink-0">{formatBookLength(book).replace(/\s+/g, '')}</span>
                  <span>·</span>
                  <span className="shrink-0">{book.chapterCount}章</span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-0.5 shrink-0">
                    <Clock className="hidden md:inline w-3 h-3" /> {estHours}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div
                    className="flex-1 h-1.5 rounded-full overflow-hidden"
                    style={{ backgroundColor: 'var(--bg-elevated)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: pct > 0 ? 'var(--accent)' : 'transparent',
                      }}
                    />
                  </div>
                  <span
                    className="text-[10px] font-mono shrink-0 whitespace-nowrap"
                    style={{ color: pct > 0 ? 'var(--accent)' : 'var(--text-muted)' }}
                  >
                    {pct > 0 && prog ? `${pct}% · ${prog.chapterIndex + 1}/${book.chapterCount}章` : '未开始'}
                  </span>
                </div>
              </div>
              {/* 右侧操作：移动端仅保留「收藏 + 更多(…)」，紧凑排布避免挤压正文 */}
              <div className="flex items-center gap-0.5 md:gap-1.5 -mr-1 md:mr-0 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setQuickNewName('')
                    setBookAssignTarget(book)
                  }}
                  className="hidden md:flex w-9 h-9 rounded-xl border items-center justify-center active:scale-90"
                  style={
                    inColCount > 0
                      ? { borderColor: 'var(--gold)', backgroundColor: 'var(--accent-soft)', color: 'var(--gold)' }
                      : { borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                  }
                  title={inColCount > 0 ? `已收入 ${inColCount} 个自建合集` : '收入自建合集'}
                  aria-label="收入自建合集"
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    triggerHaptic()
                    onToggleFavorite(book.id)
                  }}
                  className="w-7 h-7 md:w-9 md:h-9 rounded-xl md:border flex items-center justify-center active:scale-90 transition-colors"
                  style={{
                    borderColor: 'var(--border)',
                    color: isFav ? undefined : 'var(--text-muted)',
                  }}
                  aria-label={isFav ? '取消收藏' : '加入收藏'}
                >
                  <Heart className={`w-4 h-4 ${isFav ? 'fill-red-500 text-red-500' : ''}`} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onPlayBookRadio(book.id, prog?.chapterIndex)
                  }}
                  className="hidden md:flex px-3 h-9 rounded-xl text-xs font-medium text-white items-center justify-center gap-1 active:scale-90"
                  style={{ backgroundColor: 'var(--accent)' }}
                  aria-label="电台收听"
                >
                  <Headphones className="w-3.5 h-3.5" />
                  <span>收听</span>
                </button>
                <button
                  onClick={(e) => {
                    triggerHaptic()
                    openBookContextMenu(e, book)
                  }}
                  className="w-7 h-7 md:w-9 md:h-9 rounded-xl md:border flex items-center justify-center active:scale-90 transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  title="更多操作（电台收听 / 加入合集 / 自由归类 / 删除）"
                  aria-label="更多操作"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    )

  return (
    <div
      ref={scrollContainerRef}
      onScroll={(e) => {
        if (!isActive) return
        const top = e.currentTarget.scrollTop
        if (mobileShelfTarget === null) homeScrollTopRef.current = top
        else shelfScrollTopRef.current = top
      }}
      className="h-full overflow-y-auto overscroll-contain px-4 md:px-8 pt-2.5 md:pt-5 pb-28 md:pb-36"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt"
        onChange={handleFileInput}
        className="hidden"
      />

      {/* ========================================================================
          一、移动端双层原生书架架构（< 768px）：
          - Level 1：实体合集书架首页（我的书架 + 凸显新建合集 + 典藏学派书架）
          - Level 2：沉浸式合集书架详情页（清爽书架列表/三列封面网格 + 顶部返回）
          - 专注检索视图（点击顶部搜索图标展开，默认不占屏）
         ======================================================================== */}
      <div className="md:hidden max-w-6xl mx-auto">
        {mobileSearchOpen ? (
          /* -------------------- 移动端专注搜索视图 -------------------- */
          <div className="space-y-4 animate-backdrop-in">
            <div className="flex items-center gap-2">
              <div
                className="flex-1 min-w-0 flex items-center rounded-2xl border px-3.5 h-10 transition-all focus-within:ring-2"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--accent)',
                }}
              >
                <Search className="w-4 h-4 shrink-0 mr-2" style={{ color: 'var(--accent)' }} />
                <input
                  ref={mobileSearchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchQuery.trim()) {
                      runSearch(searchQuery, searchMode)
                    }
                  }}
                  placeholder={searchMode === 'deep' ? '输入正文关键词按回车深搜…' : '搜索书名、哲学家或章节…'}
                  className="w-full bg-transparent outline-none text-sm"
                  style={{ color: 'var(--text)' }}
                />
                {searchQuery && (
                  <button onClick={() => handleSearchChange('')} className="p-1 hover:opacity-70">
                    <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  </button>
                )}
              </div>
              <button
                onClick={() => {
                  triggerHaptic()
                  deepAbortRef.current?.abort()
                  setSearchQuery('')
                  setSearchResults([])
                  setSearching(false)
                  setMobileSearchOpen(false)
                }}
                className="px-2 py-2 text-xs font-medium shrink-0"
                style={{ color: 'var(--text-secondary)' }}
              >
                取消
              </button>
            </div>

            {searchQuery.trim() ? (
              renderSearchResultsPanel()
            ) : (
              <div className="space-y-3 pt-2">
                <div className="text-xs font-semibold px-0.5" style={{ color: 'var(--text-muted)' }}>
                  热门哲思检索
                </div>
                <div className="flex flex-wrap gap-2">
                  {QUICK_SEARCH_TAGS.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        triggerHaptic()
                        handleSearchChange(tag)
                      }}
                      className="px-3.5 py-1.5 rounded-full text-xs border active:scale-95 transition-transform"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : mobileShelfTarget === null ? (
          /* -------------------- Level 1：移动端实体合集书架首页 -------------------- */
          <div className="space-y-5">
            {/* 极简顶栏：中英文书架下划线页签 + 搜索 / 漫游 / 导入三个轻盈图标 */}
            <header className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-5" role="tablist" aria-label="书架语言分区">
                {(
                  [
                    { id: 'zh' as const, label: '中文书架', count: zhBooks.length },
                    { id: 'en' as const, label: '英文原典', count: enBooks.length },
                  ] as const
                ).map((z) => {
                  const active = activeZone === z.id
                  return (
                    <button
                      key={z.id}
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        triggerHaptic()
                        handleSelectZone(z.id)
                      }}
                      className="relative pb-2 flex items-baseline gap-1 transition-colors active:opacity-75"
                      style={{ color: active ? 'var(--text)' : 'var(--text-muted)' }}
                    >
                      <span
                        className={`font-serif tracking-wide ${
                          active ? 'text-[17px] font-bold' : 'text-[15px] font-medium'
                        }`}
                      >
                        {z.label}
                      </span>
                      <span className="text-[11px] font-mono opacity-75">{z.count}</span>
                      {active && (
                        <span
                          className="absolute left-0 right-0 bottom-0 h-[2.5px] rounded-full"
                          style={{ backgroundColor: 'var(--accent)' }}
                        />
                      )}
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center gap-1.5 shrink-0 pb-1">
                <button
                  onClick={() => {
                    triggerHaptic()
                    setMobileSearchOpen(true)
                  }}
                  className="w-9 h-9 rounded-full border flex items-center justify-center active:scale-90 transition-transform"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-secondary)',
                  }}
                  aria-label="搜索书库"
                  title="搜索书名、哲学家或章节"
                >
                  <Search className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    triggerHaptic()
                    onLaunchRoamRadio()
                  }}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white shadow-sm active:scale-90 transition-transform"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--gold))' }}
                  aria-label="深夜漫游电台"
                  title="深夜漫游电台"
                >
                  <Radio className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    triggerHaptic()
                    handleImportClick()
                  }}
                  className="w-9 h-9 rounded-full border flex items-center justify-center active:scale-90 transition-transform"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-secondary)',
                  }}
                  aria-label="导入本地图书"
                  title="导入本地 .md 或 .txt 图书"
                >
                  <Upload className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* 最近阅读：舒展雅致的单行续读卡 */}
            {latestBook && (
              <section
                onClick={() =>
                  onOpenBook(latestBook.book.id, latestBook.progress.chapterIndex, latestBook.progress.blockIndex)
                }
                className="rounded-2xl border p-3 flex items-center gap-3 cursor-pointer active:scale-[0.99] transition-transform"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border)',
                  boxShadow: 'var(--shadow-soft)',
                }}
              >
                <BookCover
                  title={latestBook.book.title}
                  author={latestBook.book.author}
                  category={latestBook.book.category}
                  palette={latestBook.book.coverPalette}
                  monogram={latestBook.book.monogram}
                  lang={getBookLang(latestBook.book)}
                  bilingual={latestBook.book.bilingual}
                  size="xxs"
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--accent)' }}>
                    <Sparkles className="w-3 h-3 shrink-0" />
                    <span className="font-semibold">最近阅读</span>
                    <span style={{ color: 'var(--text-muted)' }}>·</span>
                    <span className="truncate" style={{ color: 'var(--text-muted)' }}>
                      第 {latestBook.progress.chapterIndex + 1}/{latestBook.book.chapterCount} 章
                    </span>
                  </div>
                  <h2 className="font-serif font-bold text-[14.5px] leading-snug mt-0.5 truncate">
                    {latestBook.book.title}
                  </h2>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div
                      className="flex-1 h-1 rounded-full overflow-hidden"
                      style={{ backgroundColor: 'var(--bg-elevated)' }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(
                            3,
                            Math.round(
                              ((latestBook.progress.chapterIndex + 1) / Math.max(1, latestBook.book.chapterCount)) * 100
                            )
                          )}%`,
                          backgroundColor: 'var(--accent)',
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {Math.round(
                        ((latestBook.progress.chapterIndex + 1) / Math.max(1, latestBook.book.chapterCount)) * 100
                      )}
                      %
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => {
                      triggerHaptic()
                      onOpenBook(latestBook.book.id, latestBook.progress.chapterIndex, latestBook.progress.blockIndex)
                    }}
                    className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-white shadow-sm active:scale-95 transition-transform"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    继续
                  </button>
                  <button
                    onClick={() => {
                      triggerHaptic()
                      onPlayBookRadio(latestBook.book.id, latestBook.progress.chapterIndex)
                    }}
                    className="w-8 h-8 rounded-full border flex items-center justify-center active:scale-95 transition-transform"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border-strong)',
                      color: 'var(--accent)',
                    }}
                    aria-label="电台续听"
                  >
                    <Headphones className="w-3.5 h-3.5" />
                  </button>
                </div>
              </section>
            )}

            {/* 区块一：我的书架（凸显「+ 新建合集」与我的收藏、个人专属合集） */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <h2 className="font-serif font-bold text-[16px] tracking-wide">我的书架</h2>
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    收藏与自建合集
                  </span>
                </div>
                <button
                  onClick={() => {
                    triggerHaptic()
                    setEditorModal({ mode: 'create', name: '', zone: activeZone })
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold text-white flex items-center gap-1 shadow-sm active:scale-95 transition-transform"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>新建合集</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-x-3.5 gap-y-4">
                {/* 1. 我的收藏 书架格 */}
                <button
                  type="button"
                  onClick={() => openMobileShelf('我的收藏')}
                  className="text-left group focus:outline-none"
                >
                  <ShelfFolderCover
                    books={favoritePreviewBooks}
                    emptyIcon={<Heart className="w-5 h-5 opacity-45 text-rose-400" />}
                    badge={
                      <span className="w-5 h-5 rounded-full bg-rose-500/90 text-white flex items-center justify-center shadow-sm">
                        <Heart className="w-2.5 h-2.5 fill-white" />
                      </span>
                    }
                  />
                  <div className="mt-2 px-0.5">
                    <div className="font-serif font-semibold text-[12.5px] leading-snug truncate">我的收藏</div>
                    <div className="text-[10.5px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {zoneCategoryCounts['我的收藏'] || 0} 本
                    </div>
                  </div>
                </button>

                {/* 2. 用户自建合集 书架格 */}
                {visibleUserCollections.map((col) => {
                  const key = `${CUSTOM_PREFIX}${col.id}`
                  const validCount = col.bookIds.filter((id) => bookIdSet.has(id)).length
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => openMobileShelf(key)}
                      className="text-left group focus:outline-none"
                    >
                      <ShelfFolderCover
                        books={userCollectionPreviewMap[col.id] || []}
                        emptyIcon={<FolderOpen className="w-5 h-5 opacity-55" style={{ color: 'var(--gold)' }} />}
                        badge={
                          <span
                            className="w-5 h-5 rounded-full text-white flex items-center justify-center shadow-sm"
                            style={{ backgroundColor: 'var(--gold)' }}
                          >
                            <Folder className="w-2.5 h-2.5" />
                          </span>
                        }
                      />
                      <div className="mt-2 px-0.5">
                        <div className="font-serif font-semibold text-[12.5px] leading-snug truncate">{col.name}</div>
                        <div className="text-[10.5px] font-mono mt-0.5 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                          <span>{validCount} 本</span>
                          {col.zone === 'all' && <span className="text-[9px] opacity-80">· 跨区</span>}
                        </div>
                      </div>
                    </button>
                  )
                })}

                {/* 3. 新建合集 实体书架格（淡雅虚化，自然融入书架不抢戏） */}
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic()
                    setEditorModal({ mode: 'create', name: '', zone: activeZone })
                  }}
                  className="text-left group focus:outline-none opacity-75 hover:opacity-100 active:opacity-100 transition-opacity"
                >
                  <div
                    className="w-full aspect-[3/3.55] rounded-2xl border border-dashed flex flex-col items-center justify-center gap-1.5 transition-transform active:scale-[0.97]"
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderColor: 'var(--border-strong)',
                    }}
                  >
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center"
                      style={{
                        backgroundColor: 'var(--bg-elevated)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <Plus className="w-4 h-4" />
                    </span>
                    <span className="text-[10.5px] font-normal" style={{ color: 'var(--text-muted)' }}>
                      新建合集
                    </span>
                  </div>
                  <div className="mt-2 px-0.5">
                    <div
                      className="font-serif font-medium text-[12.5px] leading-snug truncate"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      创建专属书单
                    </div>
                    <div className="text-[10.5px] mt-0.5 opacity-75" style={{ color: 'var(--text-muted)' }}>
                      自由整理典籍
                    </div>
                  </div>
                </button>
              </div>
            </section>

            {/* 区块二：典藏学派书架（所有公共分类做成实体书架文件夹！） */}
            <section className="space-y-3 pt-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-serif font-bold text-[16px] tracking-wide">典藏学派书架</h2>
                <button
                  onClick={() => openMobileShelf('全部')}
                  className="text-xs font-medium flex items-center gap-0.5 active:opacity-70"
                  style={{ color: 'var(--accent)' }}
                >
                  <span>全部 {zoneBooks.length} 本</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-x-3.5 gap-y-4">
                {zoneCategoryDefs.map((cat) => {
                  const count = zoneCategoryCounts[cat.id] || 0
                  if (cat.id === '我的导入书架' && count === 0) return null
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => openMobileShelf(cat.id)}
                      className="text-left group focus:outline-none"
                    >
                      <ShelfFolderCover
                        books={categoryPreviewMap[cat.id] || []}
                        emptyIcon={<BookOpen className="w-5 h-5 opacity-40" />}
                      />
                      <div className="mt-2 px-0.5">
                        <div className="font-serif font-semibold text-[12.5px] leading-snug truncate">
                          {cat.shortLabel}
                        </div>
                        <div className="text-[10.5px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {count} 本
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>

            {/* 底部静谧回收站入口（仅存在已移除内置书时出现） */}
            {removedBuiltInBooks.length > 0 && (
              <div className="pt-2 flex justify-center">
                <button
                  onClick={() => {
                    triggerHaptic()
                    setShowRecycleBin(true)
                  }}
                  className="px-3.5 py-1.5 rounded-full border text-[11px] flex items-center gap-1.5 active:scale-95"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-muted)',
                  }}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>已移除 {removedBuiltInBooks.length} 部内置典籍 · 点击恢复</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          /* -------------------- Level 2：移动端沉浸式合集书架详情页 -------------------- */
          <div className="space-y-3.5 animate-backdrop-in">
            {/* 粘性清爽返回栏 */}
            <header
              className="sticky top-0 z-20 -mx-4 px-4 py-2 border-b flex items-center justify-between gap-2"
              style={{
                backgroundColor: 'var(--bg-glass)',
                borderColor: 'var(--border)',
                backdropFilter: 'blur(16px)',
              }}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <button
                  onClick={closeMobileShelf}
                  className="w-8 h-8 -ml-1 rounded-full flex items-center justify-center active:scale-90 shrink-0"
                  style={{ color: 'var(--text)' }}
                  aria-label="返回书架"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="min-w-0 flex items-baseline gap-1.5">
                  <h2 className="font-serif font-bold text-[16px] truncate">{mobileShelfTitle}</h2>
                  <span className="text-[11px] font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {filteredBooks.length} 本
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => {
                    triggerHaptic()
                    setMobileSearchOpen(true)
                  }}
                  className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90"
                  style={{ color: 'var(--text-secondary)' }}
                  aria-label="搜索"
                >
                  <Search className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    triggerHaptic()
                    setShowSortMenu((v) => !v)
                  }}
                  className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90"
                  style={{ color: showSortMenu ? 'var(--accent)' : 'var(--text-secondary)' }}
                  aria-label="排序"
                >
                  <ArrowUpDown className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    triggerHaptic()
                    handleChangeViewMode(viewMode === 'grid' ? 'list' : 'grid')
                  }}
                  className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90"
                  style={{ color: 'var(--text-secondary)' }}
                  aria-label={viewMode === 'grid' ? '切换列表视图' : '切换书架封面视图'}
                >
                  {viewMode === 'grid' ? <List className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
                </button>
                {(activePublicCategory || activeUserCollection) && (
                  <button
                    onClick={() => {
                      triggerHaptic()
                      setShowMobileShelfMenu(true)
                    }}
                    className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90"
                    style={{ color: 'var(--text-secondary)' }}
                    aria-label="合集管理"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                )}
              </div>
            </header>

            {/* 书架主体（三列清爽书封网格 或 舒展无截断列表） */}
            {renderBooksBody()}
          </div>
        )}
      </div>

      {/* ========================================================================
          二、桌面端完整书馆架构（>= 768px，保留全部宽屏高效能力）
         ======================================================================== */}
      <div className="hidden md:block max-w-6xl mx-auto space-y-5">
        {/* 桌面端顶部欢迎横幅与检索栏 */}
        <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-mono tracking-[0.22em] uppercase" style={{ color: 'var(--accent)' }}>
                BILINGUAL PHILOSOPHY ARCHIVE & NEURAL RADIO
              </p>
              <h1 className="text-2xl md:text-3xl font-serif font-bold mt-1 tracking-wide">
                典藏哲学书馆
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                中文典藏 {zhBooks.length} 部 · 英文原典 {enBooks.length} 部 · 微软神经网络电台
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* 全局检索框 */}
            <div
              className="relative flex-1 min-w-[210px] sm:w-72 flex items-center rounded-xl border px-3 py-2 transition-all focus-within:ring-2"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border-strong)',
              }}
            >
              <Search className="w-4 h-4 shrink-0 mr-2" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchQuery.trim()) {
                    runSearch(searchQuery, searchMode)
                  }
                }}
                placeholder={searchMode === 'deep' ? '输入正文关键词按回车全库深搜…' : '检索中英文书名、哲学家或章节…'}
                className="w-full bg-transparent outline-none text-sm"
                style={{ color: 'var(--text)' }}
              />
              {searchQuery && (
                <button onClick={() => handleSearchChange('')} className="p-0.5 hover:opacity-70">
                  <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>

            <button
              onClick={onLaunchRoamRadio}
              className="flex px-3.5 py-2 rounded-xl text-xs font-medium text-white items-center gap-1.5 shadow-sm transition-transform active:scale-95"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--gold))' }}
              title="随机漫游至一部经典的首篇开始收听"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>深夜漫游台</span>
            </button>

            <button
              onClick={handleImportClick}
              className="flex px-3 py-2 rounded-xl text-xs font-medium border items-center gap-1.5 transition-colors hover:opacity-85"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border-strong)',
                color: 'var(--text-secondary)',
              }}
              title="导入本地 .md 或 .txt 书籍"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>导入</span>
            </button>
          </div>
        </section>

        {/* 桌面端全局搜索结果面板 */}
        {searchQuery.trim() && renderSearchResultsPanel()}

        {/* 桌面端继续阅读 Hero 卡片 */}
        {latestBook && !searchQuery.trim() && (
          <section
            className="flex rounded-2xl border p-5 flex-row items-center gap-6 relative overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
              boxShadow: 'var(--shadow-soft)',
            }}
          >
            <div
              className="absolute -right-12 -top-12 w-48 h-48 rounded-full opacity-15 pointer-events-none blur-2xl"
              style={{ background: 'radial-gradient(circle, var(--accent), transparent)' }}
            />

            <div
              className="flex-1 min-w-0 cursor-pointer"
              onClick={() =>
                onOpenBook(latestBook.book.id, latestBook.progress.chapterIndex, latestBook.progress.blockIndex)
              }
            >
              <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--accent)' }}>
                <Sparkles className="w-3.5 h-3.5" />
                <span className="font-semibold tracking-wider uppercase">最近阅读</span>
                {getBookLang(latestBook.book) === 'en' && (
                  <span
                    className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    英文区
                  </span>
                )}
                <span style={{ color: 'var(--text-muted)' }}>·</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  第 {latestBook.progress.chapterIndex + 1} / {latestBook.book.chapterCount} 章
                </span>
              </div>
              <h2 className="font-serif font-bold text-xl mt-1 truncate">
                {latestBook.book.title}
              </h2>
              <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--text-secondary)' }}>
                {latestBook.book.author} · {latestBook.book.excerpt}
              </p>

              <div className="mt-2.5 flex items-center gap-3">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(
                        3,
                        Math.round(((latestBook.progress.chapterIndex + 1) / Math.max(1, latestBook.book.chapterCount)) * 100)
                      )}%`,
                      backgroundColor: 'var(--accent)',
                    }}
                  />
                </div>
                <span className="text-[11px] font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {Math.round(((latestBook.progress.chapterIndex + 1) / Math.max(1, latestBook.book.chapterCount)) * 100)}%
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() =>
                  onOpenBook(latestBook.book.id, latestBook.progress.chapterIndex, latestBook.progress.blockIndex)
                }
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-1.5 shadow-sm transition-transform active:scale-95"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>继续阅读</span>
              </button>
              <button
                onClick={() => onPlayBookRadio(latestBook.book.id, latestBook.progress.chapterIndex)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors hover:opacity-85"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-strong)',
                  color: 'var(--text)',
                }}
              >
                <Headphones className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                <span>电台续听</span>
              </button>
            </div>
          </section>
        )}

        {/* 桌面端完整三层图书合集栏 */}
        <section
          className="rounded-2xl border p-4 space-y-3"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--shadow-soft)',
          }}
        >
          {/* 第一层：中文区 / 英文区 顶级大分区切换 + 新建合集 + 排序与视图 */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* 大分区切换胶囊 */}
            <div
              className="inline-flex items-center p-1 rounded-xl border"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)' }}
              role="tablist"
              aria-label="书库语言分区"
            >
              {(
                [
                  { id: 'zh' as const, label: '中文区', sub: '典藏译著', count: zhBooks.length },
                  { id: 'en' as const, label: '英文区', sub: 'English', count: enBooks.length },
                ] as const
              ).map((z) => {
                const active = activeZone === z.id
                return (
                  <button
                    key={z.id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => handleSelectZone(z.id)}
                    className="px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-[13px] font-semibold transition-all flex items-center gap-1.5 active:scale-[0.98]"
                    style={
                      active
                        ? {
                            backgroundColor: 'var(--accent)',
                            color: '#fff',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                          }
                        : {
                            color: 'var(--text-secondary)',
                          }
                    }
                  >
                    {z.id === 'zh' ? (
                      <Languages className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <Globe className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>{z.label}</span>
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.2 rounded-full"
                      style={
                        active
                          ? { backgroundColor: 'rgba(255,255,255,0.22)', color: '#fff' }
                          : { backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }
                      }
                    >
                      {z.count}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* 右侧快捷操作：已移除恢复 + 新建合集 + 排序 + 视图切换 */}
            <div className="flex items-center gap-1.5 sm:gap-2 relative ml-auto">
              {removedBuiltInBooks.length > 0 && (
                <button
                  onClick={() => setShowRecycleBin(true)}
                  className="text-xs px-2.5 py-1.5 rounded-xl border font-medium flex items-center gap-1 transition-all active:scale-95 hover:opacity-90"
                  style={{
                    backgroundColor: 'var(--bg)',
                    borderColor: 'var(--border-strong)',
                    color: 'var(--text-secondary)',
                  }}
                  title="查看或恢复已移除的内置典籍"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">已移除</span>
                  <span className="text-[10px] font-mono">{removedBuiltInBooks.length}</span>
                </button>
              )}
              <button
                onClick={() =>
                  setEditorModal({
                    mode: 'create',
                    name: '',
                    zone: activeZone,
                  })
                }
                className="text-xs px-2.5 sm:px-3 py-1.5 rounded-xl border font-medium flex items-center gap-1.5 transition-all active:scale-95 hover:opacity-90"
                style={{
                  backgroundColor: 'var(--accent-soft)',
                  borderColor: 'var(--accent)',
                  color: 'var(--accent)',
                }}
                title="自主新建并命名图书合集"
              >
                <FolderPlus className="w-3.5 h-3.5 shrink-0" />
                <span>新建合集</span>
              </button>

              <button
                onClick={() => setShowSortMenu((v) => !v)}
                className="text-xs px-2.5 sm:px-3 py-1.5 rounded-xl border flex items-center gap-1.5 transition-colors active:scale-95"
                style={{
                  backgroundColor: 'var(--bg)',
                  borderColor: showSortMenu ? 'var(--accent)' : 'var(--border)',
                  color: showSortMenu ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{currentSortLabel}</span>
              </button>

              {showSortMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40 bg-black/35 md:bg-transparent animate-backdrop-in"
                    onClick={() => setShowSortMenu(false)}
                  />
                  <div
                    className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t p-4 pb-6 safe-bottom shadow-2xl space-y-1.5 animate-sheet-up md:absolute md:inset-auto md:right-0 md:top-10 md:w-56 md:rounded-2xl md:border md:p-2"
                    style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
                  >
                    <div className="flex md:hidden justify-center pb-1.5">
                      <span className="w-10 h-1 rounded-full opacity-30" style={{ backgroundColor: 'var(--text)' }} />
                    </div>
                    <div className="px-2 pb-1 text-xs font-bold md:hidden" style={{ color: 'var(--accent)' }}>
                      书架排序方式
                    </div>
                    {SORT_OPTIONS.map((opt) => {
                      const active = sortBy === opt.id
                      return (
                        <button
                          key={opt.id}
                          onClick={() => {
                            handleChangeSort(opt.id)
                            setShowSortMenu(false)
                          }}
                          className="w-full text-left px-3 py-2.5 md:py-2 rounded-xl flex items-center justify-between gap-2 transition-colors active:scale-[0.99]"
                          style={
                            active
                              ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }
                              : { color: 'var(--text)' }
                          }
                        >
                          <div>
                            <div className="text-xs font-semibold">{opt.label}</div>
                            <div className="text-[10px] md:hidden mt-0.5 opacity-70">{opt.desc}</div>
                          </div>
                          {active && <Check className="w-4 h-4 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              <div
                className="flex items-center p-0.5 rounded-xl border"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <button
                  onClick={() => handleChangeViewMode('grid')}
                  className="p-1.5 rounded-lg transition-colors"
                  style={viewMode === 'grid' ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' } : {}}
                  title="封面网格视图"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleChangeViewMode('list')}
                  className="p-1.5 rounded-lg transition-colors"
                  style={viewMode === 'list' ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' } : {}}
                  title="典籍列表视图"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* 第二层：当前分区内置学派合集栏 */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            {/* 全部 + 我的收藏 */}
            <button
              onClick={() => handleSelectCollection('全部')}
              className="px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all active:scale-95 flex items-center gap-1.5"
              style={
                selectedCollection === '全部'
                  ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                  : { backgroundColor: 'var(--bg)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }
              }
            >
              <span>{activeZone === 'en' ? '全部英文' : '全部中文'}</span>
              <span
                className="text-[10px] font-mono opacity-80"
                style={selectedCollection === '全部' ? { color: '#fff' } : { color: 'var(--text-muted)' }}
              >
                {zoneCategoryCounts['全部'] || 0}
              </span>
            </button>

            <button
              onClick={() => handleSelectCollection('我的收藏')}
              className="px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all active:scale-95 flex items-center gap-1"
              style={
                selectedCollection === '我的收藏'
                  ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                  : { backgroundColor: 'var(--bg)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }
              }
            >
              <Heart
                className={`w-3 h-3 ${selectedCollection === '我的收藏' ? 'fill-white text-white' : 'text-rose-400'}`}
              />
              <span>收藏</span>
              <span
                className="text-[10px] font-mono opacity-80"
                style={selectedCollection === '我的收藏' ? { color: '#fff' } : { color: 'var(--text-muted)' }}
              >
                {zoneCategoryCounts['我的收藏'] || 0}
              </span>
            </button>

            <span className="h-4 w-px mx-0.5 hidden sm:inline-block" style={{ backgroundColor: 'var(--border-strong)' }} />

            {/* 公共学派合集（开放自由上传与自由归类） */}
            {zoneCategoryDefs.map((cat) => {
              const count = zoneCategoryCounts[cat.id] || 0
              if (cat.id === '我的导入书架' && count === 0) return null
              const active = selectedCollection === cat.id
              return (
                <button
                  key={cat.id}
                  onClick={() => handleSelectCollection(cat.id)}
                  className="px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all active:scale-95 flex items-center gap-1"
                  style={
                    active
                      ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                      : { backgroundColor: 'var(--bg)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }
                  }
                  title={`${cat.id}（点击进入可自由上传与归类）`}
                >
                  <span>{cat.shortLabel}</span>
                  <span
                    className="text-[10px] font-mono opacity-75"
                    style={active ? { color: '#fff' } : { color: 'var(--text-muted)' }}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* 第三层：我的自建合集栏（有自建合集时高亮分组，无合集时展示轻量引导） */}
          <div
            className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-dashed"
            style={{ borderColor: 'var(--border)' }}
          >
            <span
              className="text-[11px] font-medium flex items-center gap-1 mr-1 shrink-0"
              style={{ color: 'var(--text-muted)' }}
            >
              <Folder className="w-3.5 h-3.5" style={{ color: 'var(--gold)' }} />
              <span>自建合集</span>
            </span>

            {visibleUserCollections.length === 0 ? (
              <button
                onClick={() =>
                  setEditorModal({
                    mode: 'create',
                    name: '',
                    zone: activeZone,
                  })
                }
                className="px-2.5 py-1 rounded-full text-[11px] border border-dashed flex items-center gap-1 transition-colors hover:opacity-85"
                style={{
                  borderColor: 'var(--border-strong)',
                  color: 'var(--text-muted)',
                  backgroundColor: 'var(--bg)',
                }}
              >
                <Plus className="w-3 h-3" />
                <span>点击新建专属书单（如「黑格尔精读」「双语对照」）</span>
              </button>
            ) : (
              <>
                {visibleUserCollections.map((col) => {
                  const key = `${CUSTOM_PREFIX}${col.id}`
                  const active = selectedCollection === key
                  const validCount = col.bookIds.filter((id) => bookIdSet.has(id)).length
                  return (
                    <button
                      key={col.id}
                      onClick={() => handleSelectCollection(key)}
                      className="px-2.5 sm:px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-all active:scale-95 flex items-center gap-1.5"
                      style={
                        active
                          ? {
                              backgroundColor: 'var(--gold)',
                              color: '#fff',
                              borderColor: 'var(--gold)',
                            }
                          : {
                              backgroundColor: 'var(--bg)',
                              color: 'var(--text)',
                              borderColor: 'var(--border-strong)',
                            }
                      }
                    >
                      {active ? (
                        <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <Folder className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--gold)' }} />
                      )}
                      <span>{col.name}</span>
                      {col.zone === 'all' && (
                        <span
                          className="text-[9px] px-1 rounded"
                          style={
                            active
                              ? { backgroundColor: 'rgba(255,255,255,0.22)', color: '#fff' }
                              : { backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }
                          }
                        >
                          跨区
                        </span>
                      )}
                      <span
                        className="text-[10px] font-mono opacity-80"
                        style={active ? { color: '#fff' } : { color: 'var(--text-muted)' }}
                      >
                        {validCount}
                      </span>
                    </button>
                  )
                })}
                <button
                  onClick={() =>
                    setEditorModal({
                      mode: 'create',
                      name: '',
                      zone: activeZone,
                    })
                  }
                  className="px-2 py-1 rounded-full text-[11px] border border-dashed flex items-center gap-0.5 transition-colors hover:opacity-85 active:scale-95"
                  style={{
                    borderColor: 'var(--border-strong)',
                    color: 'var(--text-secondary)',
                    backgroundColor: 'var(--bg)',
                  }}
                  title="新建图书合集"
                >
                  <Plus className="w-3 h-3" />
                  <span>新建</span>
                </button>
              </>
            )}
          </div>
        </section>

        {/* 桌面端当前激活的公共合集管理条 */}
        {activePublicCategory && (
          <section
            className="flex rounded-2xl border px-4 py-3 flex-wrap items-center justify-between gap-2.5 animate-float-in"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              borderColor: 'var(--border-strong)',
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Tag className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-serif font-bold text-base truncate">{activePublicCategory.id}</h2>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                    style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)' }}
                  >
                    公共合集
                  </span>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  已收录 {filteredBooks.length} 部典籍 · 支持自由上传、自由归类与右键管理图书
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => openUploadModal(activePublicCategory.zone, activePublicCategory.id, [])}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 shadow-sm active:scale-95"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>上传到此分类</span>
              </button>
              <button
                onClick={() => setManagingPublicCat({ id: activePublicCategory.id, zone: activePublicCategory.zone })}
                className="px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1 active:scale-95"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-strong)',
                  color: 'var(--text-secondary)',
                }}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>归类书目</span>
              </button>
            </div>
          </section>
        )}

        {/* 桌面端当前激活的自建合集管理条 */}
        {activeUserCollection && (
          <section
            className="flex rounded-2xl border px-4 py-3 flex-wrap items-center justify-between gap-2.5 animate-float-in"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              borderColor: 'var(--border-strong)',
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <FolderOpen className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-serif font-bold text-base truncate">{activeUserCollection.name}</h2>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                    style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)' }}
                  >
                    {zoneLabel(activeUserCollection.zone)}
                  </span>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  自建合集 · 已收录 {filteredBooks.length} 部典籍
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() =>
                  openUploadModal(
                    activeUserCollection.zone === 'en' ? 'en' : 'zh',
                    undefined,
                    [activeUserCollection.id]
                  )
                }
                className="px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 active:scale-95"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--accent)',
                  color: 'var(--accent)',
                }}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>上传到此合集</span>
              </button>
              <button
                onClick={() => {
                  setManagePickerZone(activeUserCollection.zone === 'all' ? 'all' : activeUserCollection.zone)
                  setManagePickerQuery('')
                  setManagingCollectionId(activeUserCollection.id)
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 shadow-sm active:scale-95"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>管理书目</span>
              </button>
              <button
                onClick={() =>
                  setEditorModal({
                    mode: 'rename',
                    collectionId: activeUserCollection.id,
                    name: activeUserCollection.name,
                    zone: activeUserCollection.zone,
                  })
                }
                className="px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1 active:scale-95"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-strong)',
                  color: 'var(--text-secondary)',
                }}
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>重命名</span>
              </button>

              {confirmDeleteId === activeUserCollection.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleDeleteCollection(activeUserCollection.id)}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-red-600 text-white active:scale-95"
                  >
                    确认删除
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="px-2 py-1.5 rounded-xl text-xs border"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(activeUserCollection.id)}
                  className="px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1 active:scale-95 hover:text-red-500"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border-strong)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>删除</span>
                </button>
              )}
            </div>
          </section>
        )}

        {/* 桌面端书架主体 */}
        {renderBooksBody()}
      </div>

      {/* ==================== 移动端原生抽屉：排序方式 ==================== */}
      {showSortMenu && (
        <div className="md:hidden">
          <div
            className="fixed inset-0 z-50 bg-black/40 animate-backdrop-in"
            onClick={() => setShowSortMenu(false)}
          />
          <div
            className="fixed inset-x-0 bottom-0 z-[55] rounded-t-3xl border-t px-4 pt-3 pb-6 safe-bottom shadow-2xl space-y-1.5 animate-sheet-up"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
          >
            <div className="flex justify-center pb-1.5">
              <span className="w-10 h-1 rounded-full opacity-25" style={{ backgroundColor: 'var(--text)' }} />
            </div>
            <div className="px-2 pb-1 text-xs font-bold" style={{ color: 'var(--accent)' }}>
              书架排序方式
            </div>
            {SORT_OPTIONS.map((opt) => {
              const active = sortBy === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => {
                    triggerHaptic()
                    handleChangeSort(opt.id)
                    setShowSortMenu(false)
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 transition-colors active:scale-[0.99]"
                  style={
                    active
                      ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }
                      : { color: 'var(--text)' }
                  }
                >
                  <div>
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div className="text-[10px] mt-0.5 opacity-70">{opt.desc}</div>
                  </div>
                  {active && <Check className="w-4 h-4 shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ==================== 移动端原生抽屉：当前合集管理菜单 ==================== */}
      {showMobileShelfMenu && (activePublicCategory || activeUserCollection) && (
        <div
          className="md:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-backdrop-in"
          onClick={() => setShowMobileShelfMenu(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-3xl border-t px-4 pt-3 pb-6 shadow-2xl space-y-2 animate-sheet-up safe-bottom"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
          >
            <div className="flex justify-center pb-1">
              <span className="w-10 h-1 rounded-full opacity-25" style={{ backgroundColor: 'var(--text)' }} />
            </div>
            <div className="px-2 pb-2 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <div className="min-w-0">
                <div className="font-serif font-bold text-sm truncate">{mobileShelfTitle}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {activeUserCollection ? '自建合集管理' : '公共学派分类管理'} · 共 {filteredBooks.length} 本
                </div>
              </div>
              <button
                onClick={() => setShowMobileShelfMenu(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeUserCollection ? (
              <div className="space-y-1 text-[13px]">
                <button
                  onClick={() => {
                    triggerHaptic()
                    setShowMobileShelfMenu(false)
                    setManagePickerZone(activeUserCollection.zone === 'all' ? 'all' : activeUserCollection.zone)
                    setManagePickerQuery('')
                    setManagingCollectionId(activeUserCollection.id)
                  }}
                  className="w-full px-3 py-3 rounded-xl flex items-center gap-3 active:scale-[0.99] text-left"
                >
                  <Plus className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                  <span className="font-medium">挑书加入 / 移出此合集</span>
                </button>
                <button
                  onClick={() => {
                    triggerHaptic()
                    setShowMobileShelfMenu(false)
                    openUploadModal(
                      activeUserCollection.zone === 'en' ? 'en' : 'zh',
                      undefined,
                      [activeUserCollection.id]
                    )
                  }}
                  className="w-full px-3 py-3 rounded-xl flex items-center gap-3 active:scale-[0.99] text-left"
                >
                  <Upload className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                  <span>导入本地图书到此合集</span>
                </button>
                <button
                  onClick={() => {
                    triggerHaptic()
                    setShowMobileShelfMenu(false)
                    setEditorModal({
                      mode: 'rename',
                      collectionId: activeUserCollection.id,
                      name: activeUserCollection.name,
                      zone: activeUserCollection.zone,
                    })
                  }}
                  className="w-full px-3 py-3 rounded-xl flex items-center gap-3 active:scale-[0.99] text-left"
                >
                  <Pencil className="w-4 h-4 shrink-0" style={{ color: 'var(--text-secondary)' }} />
                  <span>重命名 / 调整所属分区</span>
                </button>
                <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
                {confirmDeleteId === activeUserCollection.id ? (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="flex-1 py-2.5 rounded-xl text-xs font-medium border"
                      style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
                    >
                      取消
                    </button>
                    <button
                      onClick={() => handleDeleteCollection(activeUserCollection.id)}
                      className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-red-600 text-white active:scale-95"
                    >
                      确认删除合集
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(activeUserCollection.id)}
                    className="w-full px-3 py-3 rounded-xl flex items-center gap-3 active:scale-[0.99] text-left text-red-500"
                  >
                    <Trash2 className="w-4 h-4 shrink-0" />
                    <span className="font-medium">删除此合集</span>
                  </button>
                )}
              </div>
            ) : activePublicCategory ? (
              <div className="space-y-1 text-[13px]">
                <button
                  onClick={() => {
                    triggerHaptic()
                    setShowMobileShelfMenu(false)
                    setManagingPublicCat({ id: activePublicCategory.id, zone: activePublicCategory.zone })
                  }}
                  className="w-full px-3 py-3 rounded-xl flex items-center gap-3 active:scale-[0.99] text-left"
                >
                  <ArrowRightLeft className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                  <span className="font-medium">自由归类书目到此分类</span>
                </button>
                <button
                  onClick={() => {
                    triggerHaptic()
                    setShowMobileShelfMenu(false)
                    openUploadModal(activePublicCategory.zone, activePublicCategory.id, [])
                  }}
                  className="w-full px-3 py-3 rounded-xl flex items-center gap-3 active:scale-[0.99] text-left"
                >
                  <Upload className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                  <span>导入本地图书到此分类</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ==================== 弹窗 1：新建 / 重命名图书合集 ==================== */}
      {editorModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-[2px] p-0 sm:p-4 animate-backdrop-in"
          onClick={() => setEditorModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border p-5 pt-3 pb-7 sm:p-6 shadow-2xl space-y-4 animate-sheet-up safe-bottom"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
          >
            <div className="flex sm:hidden justify-center">
              <span className="w-10 h-1 rounded-full opacity-25" style={{ backgroundColor: 'var(--text)' }} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderPlus className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                <h3 className="font-serif font-bold text-base">
                  {editorModal.mode === 'create' ? '新建图书合集' : '编辑图书合集'}
                </h3>
              </div>
              <button
                onClick={() => setEditorModal(null)}
                className="p-1 rounded-lg hover:opacity-70"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium block" style={{ color: 'var(--text-secondary)' }}>
                合集名称
              </label>
              <input
                type="text"
                autoFocus
                maxLength={24}
                value={editorModal.name}
                onChange={(e) => setEditorModal({ ...editorModal, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmitEditor(editorModal.mode === 'create')
                }}
                placeholder="例如：黑格尔逻辑学精读、康德双语对照…"
                className="w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg)',
                  borderColor: 'var(--border-strong)',
                  color: 'var(--text)',
                }}
              />
              {editorModal.mode === 'create' && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    快速命名：
                  </span>
                  {QUICK_COLLECTION_NAMES[activeZone].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setEditorModal({ ...editorModal, name: preset })}
                      className="text-[11px] px-2 py-0.5 rounded-full border transition-colors hover:opacity-80"
                      style={{
                        backgroundColor: 'var(--bg)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium block" style={{ color: 'var(--text-secondary)' }}>
                归属分区
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'zh' as const, label: '中文区', desc: '仅在中文区显示' },
                    { id: 'en' as const, label: '英文区', desc: '仅在英文区显示' },
                    { id: 'all' as const, label: '中英跨区', desc: '双区共用对照' },
                  ] as const
                ).map((opt) => {
                  const active = editorModal.zone === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setEditorModal({ ...editorModal, zone: opt.id })}
                      className="p-2.5 rounded-xl border text-left transition-all"
                      style={
                        active
                          ? {
                              backgroundColor: 'var(--accent-soft)',
                              borderColor: 'var(--accent)',
                              color: 'var(--accent)',
                            }
                          : {
                              backgroundColor: 'var(--bg)',
                              borderColor: 'var(--border)',
                              color: 'var(--text)',
                            }
                      }
                    >
                      <div className="text-xs font-semibold">{opt.label}</div>
                      <div className="text-[10px] opacity-70 mt-0.5">{opt.desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setEditorModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium border"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
              >
                取消
              </button>
              {editorModal.mode === 'create' ? (
                <>
                  <button
                    onClick={() => handleSubmitEditor(false)}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold border"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border-strong)',
                      color: 'var(--text)',
                    }}
                  >
                    仅创建
                  </button>
                  <button
                    onClick={() => handleSubmitEditor(true)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-sm active:scale-95"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    创建并挑书
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleSubmitEditor(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-sm active:scale-95"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  保存修改
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 弹窗 2：单本书快捷收入/移出自建合集 ==================== */}
      {bookAssignTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-[2px] p-0 sm:p-4 animate-backdrop-in"
          onClick={() => setBookAssignTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border p-5 pt-3 pb-7 sm:p-6 shadow-2xl space-y-4 animate-sheet-up safe-bottom"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
          >
            <div className="flex sm:hidden justify-center">
              <span className="w-10 h-1 rounded-full opacity-25" style={{ backgroundColor: 'var(--text)' }} />
            </div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
                  收入图书合集
                </div>
                <h3 className="font-serif font-bold text-sm sm:text-base mt-0.5 line-clamp-2">
                  {bookAssignTarget.title}
                </h3>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {bookAssignTarget.author}
                </p>
              </div>
              <button
                onClick={() => setBookAssignTarget(null)}
                className="p-1 rounded-lg hover:opacity-70 shrink-0"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {userCollections.length === 0 ? (
              <div
                className="rounded-xl border border-dashed p-4 text-center text-xs"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
              >
                还没有自建合集，在下方输入名称即可一键新建并收入本书
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                {userCollections.map((col) => {
                  const checked = col.bookIds.includes(bookAssignTarget.id)
                  return (
                    <button
                      key={col.id}
                      onClick={() => handleToggleBookInCollection(col.id, bookAssignTarget.id)}
                      className="w-full px-3 py-2.5 rounded-xl border flex items-center justify-between gap-2 transition-all active:scale-[0.99]"
                      style={
                        checked
                          ? {
                              backgroundColor: 'var(--accent-soft)',
                              borderColor: 'var(--accent)',
                              color: 'var(--text)',
                            }
                          : {
                              backgroundColor: 'var(--bg)',
                              borderColor: 'var(--border)',
                              color: 'var(--text)',
                            }
                      }
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Folder className="w-4 h-4 shrink-0" style={{ color: checked ? 'var(--accent)' : 'var(--gold)' }} />
                        <span className="text-xs font-semibold truncate">{col.name}</span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                          style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
                        >
                          {zoneLabel(col.zone)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                          {col.bookIds.filter((id) => bookIdSet.has(id)).length} 部
                        </span>
                        <span
                          className="w-5 h-5 rounded-md border flex items-center justify-center"
                          style={
                            checked
                              ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
                              : { borderColor: 'var(--border-strong)' }
                          }
                        >
                          {checked && <Check className="w-3.5 h-3.5" />}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* 快捷一行新建合集并直接收入 */}
            <div className="pt-2 border-t space-y-2" style={{ borderColor: 'var(--border)' }}>
              <div className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                或新建合集并立即收入：
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={24}
                  value={quickNewName}
                  onChange={(e) => setQuickNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleQuickCreateAndAssign()
                  }}
                  placeholder="输入新合集名称…"
                  className="flex-1 rounded-xl border px-3 py-2 text-xs outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg)',
                    borderColor: 'var(--border-strong)',
                    color: 'var(--text)',
                  }}
                />
                <button
                  onClick={handleQuickCreateAndAssign}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-white shrink-0 active:scale-95"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  新建并收入
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 弹窗 3：批量管理合集书目 ==================== */}
      {managingCollection && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-[2px] p-0 sm:p-4 animate-backdrop-in"
          onClick={() => setManagingCollectionId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-2xl h-[84vh] sm:h-[78vh] rounded-t-3xl sm:rounded-2xl border p-4 pt-3 sm:p-5 shadow-2xl flex flex-col gap-3 animate-sheet-up safe-bottom"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
          >
            <div className="flex sm:hidden justify-center">
              <span className="w-10 h-1 rounded-full opacity-25" style={{ backgroundColor: 'var(--text)' }} />
            </div>
            <div className="flex items-center justify-between gap-2 shrink-0">
              <div className="min-w-0">
                <h3 className="font-serif font-bold text-base truncate">
                  管理合集书目 · {managingCollection.name}
                </h3>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  勾选典籍即可加入或移出本合集（当前已选{' '}
                  {managingCollection.bookIds.filter((id) => bookIdSet.has(id)).length} 部）
                </p>
              </div>
              <button
                onClick={() => setManagingCollectionId(null)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white shrink-0"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                完成
              </button>
            </div>

            {/* 筛选行：搜索 + 中文/英文/全部切换 */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div
                className="flex-1 min-w-[180px] flex items-center rounded-xl border px-3 py-1.5"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)' }}
              >
                <Search className="w-3.5 h-3.5 mr-2 shrink-0" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={managePickerQuery}
                  onChange={(e) => setManagePickerQuery(e.target.value)}
                  placeholder="筛选书名、作者或学派…"
                  className="w-full bg-transparent outline-none text-xs"
                  style={{ color: 'var(--text)' }}
                />
                {managePickerQuery && (
                  <button onClick={() => setManagePickerQuery('')}>
                    <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                  </button>
                )}
              </div>

              <div
                className="inline-flex rounded-xl border p-0.5 text-[11px]"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                {(
                  [
                    ['all', `全部 ${books.length}`],
                    ['zh', `中文区 ${zhBooks.length}`],
                    ['en', `英文区 ${enBooks.length}`],
                  ] as const
                ).map(([zid, lbl]) => (
                  <button
                    key={zid}
                    onClick={() => setManagePickerZone(zid)}
                    className="px-2.5 py-1 rounded-lg font-medium transition-colors"
                    style={
                      managePickerZone === zid
                        ? { backgroundColor: 'var(--accent)', color: '#fff' }
                        : { color: 'var(--text-secondary)' }
                    }
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* 书籍勾选列表 */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
              {managePickerBooks.map((b) => {
                const checked = managingCollection.bookIds.includes(b.id)
                const isEn = getBookLang(b) === 'en'
                return (
                  <button
                    key={b.id}
                    onClick={() => handleToggleBookInCollection(managingCollection.id, b.id)}
                    className="w-full text-left px-3 py-2.5 rounded-xl border flex items-center justify-between gap-3 transition-colors"
                    style={
                      checked
                        ? { backgroundColor: 'var(--accent-soft)', borderColor: 'var(--accent)' }
                        : { backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0"
                          style={{
                            backgroundColor: isEn ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                            color: isEn ? 'var(--accent)' : 'var(--text-secondary)',
                          }}
                        >
                          {isEn ? 'EN' : '中'}
                        </span>
                        <span className="font-serif font-semibold text-xs sm:text-sm truncate">{b.title}</span>
                      </div>
                      <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                        {b.author} · {b.category}
                      </div>
                    </div>
                    <span
                      className="w-5 h-5 rounded-md border flex items-center justify-center shrink-0"
                      style={
                        checked
                          ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
                          : { borderColor: 'var(--border-strong)' }
                      }
                    >
                      {checked && <Check className="w-3.5 h-3.5" />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 4. 图书右键菜单（桌面悬浮 / 移动抽屉） ==================== */}
      {bookContextMenu && (
        <BookContextMenu
          book={bookContextMenu.book}
          x={bookContextMenu.x}
          y={bookContextMenu.y}
          isFavorite={favorites.includes(bookContextMenu.book.id)}
          hasProgress={Boolean(progressMap[bookContextMenu.book.id])}
          collectionCount={bookToCollectionIds.get(bookContextMenu.book.id)?.length || 0}
          activeUserCollection={activeUserCollection}
          onClose={() => setBookContextMenu(null)}
          onOpenBook={() => {
            const prog = progressMap[bookContextMenu.book.id]
            onOpenBook(bookContextMenu.book.id, prog?.chapterIndex, prog?.blockIndex || 0)
          }}
          onPlayRadio={() => {
            const prog = progressMap[bookContextMenu.book.id]
            onPlayBookRadio(bookContextMenu.book.id, prog?.chapterIndex)
          }}
          onToggleFavorite={() => onToggleFavorite(bookContextMenu.book.id)}
          onReclassify={() => setReclassifyTarget(bookContextMenu.book)}
          onAssignCollections={() => {
            setQuickNewName('')
            setBookAssignTarget(bookContextMenu.book)
          }}
          onRemoveFromActiveCollection={
            activeUserCollection
              ? () => {
                  handleToggleBookInCollection(activeUserCollection.id, bookContextMenu.book.id)
                  notifyToast(`已从「${activeUserCollection.name}」移出`)
                }
              : undefined
          }
          onRequestDelete={() => setDeleteConfirmBook(bookContextMenu.book)}
        />
      )}

      {/* ==================== 5. 自由上传并归类弹窗 ==================== */}
      {uploadModal && (
        <UploadBookModal
          initialZone={uploadModal.zone}
          initialCategory={uploadModal.category}
          initialCollectionIds={uploadModal.collectionIds}
          zhCategories={ZH_CATEGORIES}
          enCategories={EN_CATEGORIES}
          userCollections={userCollections}
          onClose={() => setUploadModal(null)}
          onSubmit={handleUploadSubmit}
        />
      )}

      {/* ==================== 6. 单书自由归类与编辑弹窗 ==================== */}
      {reclassifyTarget && (
        <ReclassifyBookModal
          book={reclassifyTarget}
          hasOverride={Boolean(bookOverridesMap[reclassifyTarget.id])}
          zhCategories={ZH_CATEGORIES}
          enCategories={EN_CATEGORIES}
          onClose={() => setReclassifyTarget(null)}
          onSave={(patch) => handleReclassifySave(reclassifyTarget, patch)}
          onResetDefault={() => {
            resetBookClassification(reclassifyTarget.id)
            onLibraryChanged()
            notifyToast(`已恢复《${reclassifyTarget.title}》默认分类`)
          }}
        />
      )}

      {/* ==================== 7. 公共合集批量归类管理弹窗 ==================== */}
      {managingPublicCat && (
        <PublicCategoryManagerModal
          categoryId={managingPublicCat.id}
          zone={managingPublicCat.zone}
          books={books}
          onClose={() => setManagingPublicCat(null)}
          onMoveBookToCategory={handleMoveBookToPublicCategory}
          onOpenUploadHere={() => openUploadModal(managingPublicCat.zone, managingPublicCat.id, [])}
        />
      )}

      {/* ==================== 8. 删除图书确认弹窗 ==================== */}
      {deleteConfirmBook && (
        <DeleteBookConfirmModal
          book={deleteConfirmBook}
          onClose={() => setDeleteConfirmBook(null)}
          onConfirm={() => handleConfirmDeleteBook(deleteConfirmBook)}
        />
      )}

      {/* ==================== 9. 已移除内置典籍回收站 ==================== */}
      {showRecycleBin && (
        <RecycleBinModal
          removedBooks={removedBuiltInBooks}
          onClose={() => setShowRecycleBin(false)}
          onRestoreOne={(bid) => {
            restoreRemovedBuiltInBook(bid)
            onLibraryChanged()
            notifyToast('已恢复典籍至书架')
          }}
          onRestoreAll={() => {
            restoreAllRemovedBuiltInBooks()
            onLibraryChanged()
            notifyToast('已恢复全部已移除典籍')
          }}
        />
      )}
    </div>
  )
}
