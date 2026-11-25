import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpDown,
  BookOpen,
  Check,
  Clock,
  Headphones,
  Heart,
  LayoutGrid,
  List,
  Radio,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { BookCatalogItem, BookFullTextHit, ReadingProgress } from '../types'
import { BookCover } from './BookCover'
import { deepSearchAllBooks, importLocalTextBook, searchLibrary } from '../services/libraryApi'
import { getPlatform, notifyToast, registerBackHandler } from '../services/platform'
import { deleteCustomBook } from '../services/storage'

interface LibraryViewProps {
  books: BookCatalogItem[]
  progressMap: Record<string, ReadingProgress>
  favorites: string[]
  onToggleFavorite: (bookId: string) => void
  onOpenBook: (bookId: string, chapterIndex?: number, blockIndex?: number) => void
  onPlayBookRadio: (bookId: string, chapterIndex?: number) => void
  onLaunchRoamRadio: () => void
  onLibraryChanged: () => void
}

const CATEGORIES: Array<{ id: string; shortLabel: string }> = [
  { id: '我的收藏', shortLabel: '我的收藏' },
  { id: '全部典藏', shortLabel: '全部典藏' },
  { id: '古希腊与近代哲思', shortLabel: '古希腊近代' },
  { id: '德国古典原典', shortLabel: '德国古典' },
  { id: '马克思与批判理论', shortLabel: '马哲批判' },
  { id: '现象学与存在哲学', shortLabel: '现象学存在' },
  { id: '精神分析与后现代', shortLabel: '精神后现代' },
  { id: '张世英哲学全书', shortLabel: '张世英全书' },
  { id: '辞典与术语工具', shortLabel: '辞典术语' },
  { id: '我的导入书架', shortLabel: '本地导入' },
]

const CATEGORY_SHORT_MAP: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.shortLabel])
)

export const LibraryView: React.FC<LibraryViewProps> = ({
  books,
  progressMap,
  favorites,
  onToggleFavorite,
  onOpenBook,
  onPlayBookRadio,
  onLaunchRoamRadio,
  onLibraryChanged,
}) => {
  // 默认打开及返回主页时，首屏优先展示「我的收藏」
  const [category, setCategory] = useState('我的收藏')
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

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {
      全部典藏: books.length,
      我的收藏: books.filter((b) => favorites.includes(b.id)).length,
    }
    for (const b of books) {
      map[b.category] = (map[b.category] || 0) + 1
    }
    return map
  }, [books, favorites])

  useEffect(() => {
    if (!showSortMenu) return
    return registerBackHandler(60, () => {
      setShowSortMenu(false)
      return true
    })
  }, [showSortMenu])
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

  // 书馆搜索结果打开时，按 Android 返回键优先清空并关闭搜索面板
  useEffect(() => {
    if (!searchQuery.trim()) return
    return registerBackHandler(40, () => {
      deepAbortRef.current?.abort()
      setSearchQuery('')
      setSearchResults([])
      setSearching(false)
      return true
    })
  }, [searchQuery])

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
    let list = [...books]
    if (category === '我的收藏') {
      list = list.filter((b) => favorites.includes(b.id))
    } else if (category !== '全部典藏') {
      list = list.filter((b) => b.category === category)
    }

    if (sortBy === 'recent') {
      list.sort((a, b) => (progressMap[b.id]?.updatedAt || 0) - (progressMap[a.id]?.updatedAt || 0))
    } else if (sortBy === 'short') {
      list.sort((a, b) => a.charCount - b.charCount)
    } else if (sortBy === 'long') {
      list.sort((a, b) => b.charCount - a.charCount)
    }
    return list
  }, [books, category, favorites, sortBy, progressMap])

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

    // 深度全文检索：流式扫描全部 72 部典籍正文
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

  const handleImportClick = async () => {
    if (getPlatform() === 'electron' && window.electronAPI) {
      const file = await window.electronAPI.importLocalFile()
      if (file) {
        const added = await importLocalTextBook(file.name, file.content)
        onLibraryChanged()
        onOpenBook(added.id, 0, 0)
      }
      return
    }
    fileInputRef.current?.click()
  }

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const added = await importLocalTextBook(file.name, text)
    onLibraryChanged()
    notifyToast(`已导入《${added.title}》`)
    onOpenBook(added.id, 0, 0)
    e.target.value = ''
  }

  const handleDeleteCustom = async (e: React.MouseEvent, bookId: string) => {
    e.stopPropagation()
    await deleteCustomBook(bookId)
    onLibraryChanged()
  }

  const formatChars = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)} 万字` : `${n} 字`)

  return (
    <div className="h-full overflow-y-auto px-4 md:px-8 pt-4 md:pt-5 pb-36">
      <div className="max-w-6xl mx-auto space-y-5 md:space-y-6">
        {/* 顶部欢迎横幅与检索栏 */}
        <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 md:gap-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="hidden sm:block text-[11px] font-mono tracking-[0.22em] uppercase" style={{ color: 'var(--accent)' }}>
                PHILOSOPHY ARCHIVE & NEURAL RADIO
              </p>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-serif font-bold mt-0.5 sm:mt-1 tracking-wide">
                典藏哲学书馆
              </h1>
              <p className="text-xs md:text-sm mt-0.5 sm:mt-1" style={{ color: 'var(--text-secondary)' }}>
                收录 {books.length} 部经典译本 · 微软神经网络电台
              </p>
            </div>
            {/* 手机端右上角紧凑功能胶囊，节省首屏垂直空间 */}
            <div className="flex sm:hidden items-center gap-1.5 pt-1 shrink-0">
              <button
                onClick={onLaunchRoamRadio}
                className="px-2.5 py-1.5 rounded-xl text-[11px] font-medium text-white flex items-center gap-1 shadow-sm active:scale-95"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--gold))' }}
              >
                <Radio className="w-3.5 h-3.5" />
                <span>漫游</span>
              </button>
              <button
                onClick={handleImportClick}
                className="p-1.5 rounded-xl border active:scale-95"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-strong)',
                  color: 'var(--text-secondary)',
                }}
                title="导入本地 .md 或 .txt 书籍"
                aria-label="导入书籍"
              >
                <Upload className="w-4 h-4" />
              </button>
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
                placeholder={searchMode === 'deep' ? '输入正文关键词按回车全库深搜…' : '检索书名、哲学家或章节概念…'}
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
              className="hidden sm:flex px-3.5 py-2 rounded-xl text-xs font-medium text-white items-center gap-1.5 shadow-sm transition-transform active:scale-95"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--gold))' }}
              title="随机漫游至一部经典的首篇开始收听"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>深夜漫游台</span>
            </button>

            <button
              onClick={handleImportClick}
              className="hidden sm:flex px-3 py-2 rounded-xl text-xs font-medium border items-center gap-1.5 transition-colors hover:opacity-85"
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
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt"
              onChange={handleFileInput}
              className="hidden"
            />
          </div>
        </section>

        {/* 全局搜索结果面板（支持目录速搜 + 全库 72 部正文深度检索） */}
        {searchQuery.trim() && (
          <section
            className="rounded-2xl border p-4 animate-float-in"
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto pr-1">
                {searchResults.map((r, i) => (
                  <button
                    key={`${r.bookId}_${r.chapterIndex}_${r.blockIndex ?? 0}_${i}`}
                    onClick={() => onOpenBook(r.bookId, r.chapterIndex, r.blockIndex ?? 0)}
                    className="text-left p-3 rounded-xl border transition-all hover:translate-y-[-1px]"
                    style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-serif font-bold text-sm truncate">{r.bookTitle}</span>
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
                ))}
              </div>
            )}
          </section>
        )}

        {/* 继续阅读 Hero 卡片（清爽简洁布局，无冗余缩略方块） */}
        {latestBook && !searchQuery.trim() && (
          <section
            className="rounded-2xl border p-4 md:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-3.5 md:gap-6 relative overflow-hidden"
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
              className="flex-1 min-w-0 w-full cursor-pointer"
              onClick={() =>
                onOpenBook(latestBook.book.id, latestBook.progress.chapterIndex, latestBook.progress.blockIndex)
              }
            >
              <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--accent)' }}>
                <Sparkles className="w-3.5 h-3.5" />
                <span className="font-semibold tracking-wider uppercase">最近阅读</span>
                <span style={{ color: 'var(--text-muted)' }}>·</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  第 {latestBook.progress.chapterIndex + 1} / {latestBook.book.chapterCount} 章
                </span>
              </div>
              <h2 className="font-serif font-bold text-base sm:text-lg md:text-xl mt-1 truncate">
                {latestBook.book.title}
              </h2>
              <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--text-secondary)' }}>
                {latestBook.book.author} · {latestBook.book.excerpt}
              </p>

              {/* 进度条 */}
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

            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
              <button
                onClick={() =>
                  onOpenBook(latestBook.book.id, latestBook.progress.chapterIndex, latestBook.progress.blockIndex)
                }
                className="flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-1.5 shadow-sm transition-transform active:scale-95"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>继续阅读</span>
              </button>
              <button
                onClick={() => onPlayBookRadio(latestBook.book.id, latestBook.progress.chapterIndex)}
                className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors hover:opacity-85"
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

        {/* 分类筛选与视图切换栏：自适应优雅折行，无需横向滑动即可一眼看全所有书系 */}
        <section className="flex flex-col md:flex-row md:items-start justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {CATEGORIES.map((cat) => {
              if (cat.id === '我的导入书架' && !books.some((b) => b.isCustom)) return null
              const active = category === cat.id
              const count = categoryCounts[cat.id] || 0
              return (
                <button
                  key={cat.id}
                  onClick={() => setCategory(cat.id)}
                  className="px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all active:scale-95 flex items-center gap-1"
                  style={
                    active
                      ? {
                          backgroundColor: 'var(--accent)',
                          color: '#fff',
                          borderColor: 'var(--accent)',
                        }
                      : {
                          backgroundColor: 'var(--bg-card)',
                          color: 'var(--text-secondary)',
                          borderColor: 'var(--border)',
                        }
                  }
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

          <div className="flex items-center justify-between md:justify-end gap-2 shrink-0 relative">
            <button
              onClick={() => setShowSortMenu((v) => !v)}
              className="text-xs px-3 py-1.5 rounded-xl border flex items-center gap-1.5 transition-colors active:scale-95"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: showSortMenu ? 'var(--accent)' : 'var(--border)',
                color: showSortMenu ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>{currentSortLabel}</span>
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
              className="flex items-center p-0.5 rounded-lg border"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <button
                onClick={() => handleChangeViewMode('grid')}
                className="p-1.5 rounded-md transition-colors"
                style={viewMode === 'grid' ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' } : {}}
                title="封面网格视图"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleChangeViewMode('list')}
                className="p-1.5 rounded-md transition-colors"
                style={viewMode === 'list' ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' } : {}}
                title="典籍列表视图"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </section>

        {/* 书架主体 */}
        {filteredBooks.length === 0 ? (
          <div className="py-14 text-center space-y-3" style={{ color: 'var(--text-muted)' }}>
            <Heart className="w-8 h-8 mx-auto opacity-30" />
            <p className="text-sm font-serif" style={{ color: 'var(--text-secondary)' }}>
              {category === '我的收藏'
                ? '尚未收藏哲学典籍，点击任意书籍右上角「❤」即可收入私人收藏架'
                : '当前书架暂无典籍'}
            </p>
            {category !== '全部典藏' && (
              <button
                onClick={() => setCategory('全部典藏')}
                className="px-4 py-2 rounded-full text-xs font-semibold text-white shadow-sm active:scale-95 transition-transform"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                浏览全部 {books.length} 部典藏
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
            {filteredBooks.map((book) => {
              const prog = progressMap[book.id]
              const isFav = favorites.includes(book.id)
              const pct = prog ? Math.round(((prog.chapterIndex + 1) / Math.max(1, book.chapterCount)) * 100) : 0

              return (
                <div
                  key={book.id}
                  onClick={() => onOpenBook(book.id, prog?.chapterIndex, prog?.blockIndex || 0)}
                  className="group cursor-pointer flex flex-col"
                >
                  <div className="relative">
                    <BookCover
                      title={book.title}
                      author={book.author}
                      category={book.category}
                      palette={book.coverPalette}
                      monogram={book.monogram}
                      className="group-hover:-translate-y-1.5 group-hover:shadow-xl"
                    />

                    {/* 收藏按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleFavorite(book.id)
                      }}
                      className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full flex items-center justify-center bg-black/35 backdrop-blur-sm text-white/90 opacity-85 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      title={isFav ? '取消收藏' : '加入收藏'}
                    >
                      <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-red-400 text-red-400' : ''}`} />
                    </button>

                    {/* 快捷电台收听悬浮按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onPlayBookRadio(book.id, prog?.chapterIndex)
                      }}
                      className="absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center text-white shadow-lg opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-all hover:scale-110"
                      style={{ backgroundColor: 'var(--accent)' }}
                      title="微软电台收听本书"
                    >
                      <Headphones className="w-3.5 h-3.5" />
                    </button>

                    {book.isCustom && (
                      <button
                        onClick={(e) => handleDeleteCustom(e, book.id)}
                        className="absolute bottom-2.5 left-3.5 w-7 h-7 rounded-full flex items-center justify-center bg-black/45 text-white/80 hover:text-red-300"
                        title="删除导入书籍"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* 阅读进度角标 */}
                    {pct > 0 && (
                      <div className="absolute bottom-0 inset-x-0 h-1 bg-black/30 rounded-b-xl overflow-hidden">
                        <div className="h-full" style={{ width: `${pct}%`, backgroundColor: 'var(--gold)' }} />
                      </div>
                    )}
                  </div>

                  <div className="mt-2.5 px-0.5">
                    <h3 className="font-serif font-semibold text-[13px] leading-snug line-clamp-2 group-hover:underline">
                      {book.title}
                    </h3>
                    <div className="flex items-center justify-between text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                      <span className="truncate max-w-[60%]">{book.author}</span>
                      <span>{formatChars(book.charCount)}</span>
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
              const pct = prog
                ? Math.min(100, Math.max(1, Math.round(((prog.chapterIndex + 1) / Math.max(1, book.chapterCount)) * 100)))
                : 0
              const estHours =
                book.estReadMin >= 60 ? `约${(book.estReadMin / 60).toFixed(1)}小时` : `约${book.estReadMin}分钟`
              const shortCat = CATEGORY_SHORT_MAP[book.category] || book.category
              return (
                <div
                  key={book.id}
                  onClick={() => onOpenBook(book.id, prog?.chapterIndex, prog?.blockIndex || 0)}
                  className="p-3 sm:p-3.5 rounded-2xl border flex items-center gap-3 sm:gap-4 cursor-pointer transition-all hover:translate-y-[-1px] active:scale-[0.99]"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
                >
                  <BookCover
                    title={book.title}
                    author={book.author}
                    category={book.category}
                    palette={book.coverPalette}
                    monogram={book.monogram}
                    size="xs"
                    className="shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    {/* 书名独占顶部整行，完整清晰显示，绝不被分类标签遮挡 */}
                    <h3 className="font-serif font-bold text-[14px] sm:text-[15px] leading-snug line-clamp-2">
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
                    </div>
                    <div
                      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5 text-[11px]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <span className="shrink-0">{formatChars(book.charCount).replace(/\s+/g, '')}</span>
                      <span>·</span>
                      <span className="shrink-0">{book.chapterCount}章</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-0.5 shrink-0">
                        <Clock className="w-3 h-3" /> {estHours}
                      </span>
                    </div>
                    {/* 一目了然的阅读进度条与章节进度 */}
                    <div className="mt-2 flex items-center gap-2">
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
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleFavorite(book.id)
                      }}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl border flex items-center justify-center active:scale-90"
                      style={{ borderColor: 'var(--border)' }}
                      aria-label={isFav ? '取消收藏' : '加入收藏'}
                    >
                      <Heart className={`w-4 h-4 ${isFav ? 'fill-red-500 text-red-500' : ''}`} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onPlayBookRadio(book.id, prog?.chapterIndex)
                      }}
                      className="w-8 h-8 sm:w-auto sm:px-3 sm:h-9 rounded-xl text-xs font-medium text-white flex items-center justify-center gap-1 active:scale-90"
                      style={{ backgroundColor: 'var(--accent)' }}
                      aria-label="电台收听"
                    >
                      <Headphones className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">收听</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
