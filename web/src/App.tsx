import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookmarkCheck, Library, Radio, Sparkles } from 'lucide-react'
import type {
  AiConversation,
  AiSettings,
  AppTab,
  BookCatalogItem,
  BookmarkItem,
  HighlightItem,
  RadioQueueItem,
  RadioSettings,
  RadioState,
  ReaderSettings,
  ReadingProgress,
  StudyStats,
  TranslationSettings,
  UserCollection,
} from './types'
import { fetchCatalog, getInitialCatalogSync } from './services/libraryApi'
import { radioEngine } from './services/radioEngine'
import {
  dispatchRegisteredBackHandlers,
  getPlatform,
  notifyToast,
  subscribeToast,
  syncSystemChrome,
  triggerHaptic,
} from './services/platform'
import {
  DEFAULT_READER_SETTINGS,
  loadAiConversations,
  loadAiSettings,
  loadAllProgress,
  loadBookmarks,
  loadFavorites,
  loadHighlights,
  loadRadioQueue,
  loadRadioSettings,
  loadReaderSettings,
  loadStats,
  loadTranslationSettings,
  loadUserCollections,
  saveAiConversations,
  saveAiSettings,
  saveBookmarks,
  saveFavorites,
  saveHighlights,
  saveRadioQueue,
  saveReaderSettings,
  saveTranslationSettings,
  saveUserCollections,
} from './services/storage'
import { TitleBar } from './components/TitleBar'
import { LibraryView } from './components/LibraryView'
import { ReaderView } from './components/ReaderView'
import { RadioStudioView } from './components/RadioStudioView'
import { NotesHubView } from './components/NotesHubView'
import { MiniRadioDock } from './components/MiniRadioDock'
import { AiAssistantPanel } from './components/AiAssistantPanel'
import { AiSettingsModal } from './components/AiSettingsModal'
import { TranslationSettingsModal } from './components/TranslationSettingsModal'

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('library')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  )
  const [radioDockVisible, setRadioDockVisible] = useState(false)
  const [books, setBooks] = useState<BookCatalogItem[]>(() => getInitialCatalogSync())
  const [catalogReady, setCatalogReady] = useState<boolean>(() => books.length > 0)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [settings, setSettings] = useState<ReaderSettings>(() => loadReaderSettings())
  const [radioSettings, setRadioSettings] = useState<RadioSettings>(() => loadRadioSettings())
  const [radio, setRadio] = useState<RadioState>(() => radioEngine.getState())
  const [progressMap, setProgressMap] = useState<Record<string, ReadingProgress>>(() => loadAllProgress())
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites())
  const [userCollections, setUserCollections] = useState<UserCollection[]>(() => loadUserCollections())
  const [highlights, setHighlights] = useState<HighlightItem[]>(() => loadHighlights())
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() => loadBookmarks())
  const [radioQueue, setRadioQueue] = useState<RadioQueueItem[]>(() => loadRadioQueue())
  const [stats, setStats] = useState<StudyStats>(() => loadStats())
  const [translationSettings, setTranslationSettings] = useState<TranslationSettings>(() => loadTranslationSettings())
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => loadAiSettings())
  const [aiConversations, setAiConversations] = useState<AiConversation[]>(() => loadAiConversations())
  const [showTranslationSettings, setShowTranslationSettings] = useState(false)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  const [readerTarget, setReaderTarget] = useState<{
    bookId: string
    chapterIndex: number
    blockIndex: number
    scrollRatio?: number
  } | null>(null)
  // 移动端书架当前所在合集由 App 统一持有，且 LibraryView 保持挂载，确保「合集 → 阅读 → 返回」100% 精准回到原合集
  const [mobileShelfTarget, setMobileShelfTarget] = useState<string | null>(null)
  const lastTabExitAtRef = useRef<number>(0)

  // 导航历史栈：支持返回键按真实浏览路径逐级回退
  const tabHistoryRef = useRef<AppTab[]>([])
  const activeTabRef = useRef<AppTab>('library')
  const isRadioPlayingRef = useRef<boolean>(false)
  const lastBackExitPressRef = useRef<number>(0)
  const toastTimerRef = useRef<number | null>(null)

  const isRadioPlaying = radio.status === 'playing' || radio.status === 'loading'
  activeTabRef.current = activeTab
  isRadioPlayingRef.current = isRadioPlaying

  // 全局统一轻盈 Toast 订阅
  useEffect(() => {
    return subscribeToast((msg) => {
      setToastMsg(msg)
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = window.setTimeout(() => {
        setToastMsg(null)
        toastTimerRef.current = null
      }, msg.length > 24 ? 3200 : 2100)
    })
  }, [])

  const navigateToTab = useCallback((next: AppTab) => {
    setActiveTab((prev) => {
      if (prev === next) return prev
      if (next === 'library') {
        tabHistoryRef.current = []
      } else {
        const stack = tabHistoryRef.current
        if (stack[stack.length - 1] !== prev) {
          stack.push(prev)
          if (stack.length > 10) stack.shift()
        }
      }
      return next
    })
  }, [])

  const navigateBack = useCallback(() => {
    lastTabExitAtRef.current = Date.now()
    const prev = tabHistoryRef.current.pop()
    if (prev && prev !== activeTabRef.current) {
      setActiveTab(prev)
    } else {
      setActiveTab('library')
    }
  }, [])

  // 最近阅读的书（用于底部「阅读」标签一键直达续读）
  const mostRecentProgress = useMemo(() => {
    const entries = Object.values(progressMap).sort((a, b) => b.updatedAt - a.updatedAt)
    for (const p of entries) {
      if (books.some((b) => b.id === p.bookId)) return p
    }
    return null
  }, [progressMap, books])

  const refreshCatalog = useCallback(() => {
    fetchCatalog()
      .then((list) => {
        setBooks(list)
        setCatalogError(null)
        setCatalogReady(true)
      })
      .catch((err) => {
        setCatalogError(err?.message || '书库加载失败')
        setCatalogReady(true)
      })
  }, [])

  const bootNotifiedRef = useRef(false)

  useEffect(() => {
    if (bootNotifiedRef.current) return
    const isDesktopPreloaded = typeof window !== 'undefined' && Boolean(window.electronAPI?.initialCatalog?.books?.length)
    if (books.length === 0 && !catalogError && isDesktopPreloaded) return
    if (books.length === 0 && !catalogError && typeof window !== 'undefined' && !window.electronAPI) {
      // Android / Web：待目录到达后再撤下启屏（最多 600ms 兜底在 index.html）
      return
    }
    bootNotifiedRef.current = true
    let raf2 = 0
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        window.electronAPI?.notifyRendererReady?.()
      })
    })
    return () => {
      window.cancelAnimationFrame(raf1)
      if (raf2) window.cancelAnimationFrame(raf2)
    }
  }, [books.length, catalogError])

  useEffect(() => {
    refreshCatalog()
    const onResize = () => setIsCompactViewport(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [refreshCatalog])

  // 同步系统主题、状态栏、移动端常亮与桌面端最小化到托盘设置
  useEffect(() => {
    syncSystemChrome(settings.theme)
    try {
      window.AndroidBridge?.setKeepScreenOn(settings.keepScreenOn)
      window.AndroidBridge?.setVolumeKeyTurn(settings.volumeKeyTurn)
      window.electronAPI?.setMinimizeToTray?.(settings.minimizeToTray)
    } catch {}
  }, [settings.theme, settings.keepScreenOn, settings.volumeKeyTurn, settings.minimizeToTray])

  // 挂载 Android 系统返回键与手势侧滑返回处理入口
  useEffect(() => {
    window.__handleAndroidBack = () => {
      // 防连击抖动：刚从阅读页/子页面返回书馆 260ms 内，忽略重复触发的返回事件，防止连退两级直接跳回首页
      if (Date.now() - lastTabExitAtRef.current < 260) {
        return 'consumed'
      }
      // 1. 优先交由当前打开的弹窗、浮卡、抽屉、面板或阅读器分层处理
      if (dispatchRegisteredBackHandlers()) {
        return 'consumed'
      }
      // 2. 非书馆首页：按历史栈返回上一级页面（或回到书馆首页）
      if (activeTabRef.current !== 'library') {
        navigateBack()
        return 'consumed'
      }
      // 3. 书馆首页：2 秒内双击返回键确认退出，避免误触直接退出软件
      const now = Date.now()
      if (now - lastBackExitPressRef.current < 2000) {
        return isRadioPlayingRef.current ? 'exit_background' : 'exit'
      }
      lastBackExitPressRef.current = now
      notifyToast(
        isRadioPlayingRef.current
          ? '电台正在后台播报，再按一次返回桌面'
          : '再按一次返回键退出哲启明思'
      )
      return 'consumed'
    }
    return () => {
      window.__handleAndroidBack = undefined
    }
  }, [navigateBack])

  // 订阅电台引擎状态、桌面端媒体快捷键与全屏状态变更
  useEffect(() => {
    const unsub = radioEngine.subscribe((next) => {
      setRadio(next)
      if (next.status === 'playing' || next.status === 'loading' || next.status === 'paused') {
        setRadioDockVisible(true)
      }
    })
    const unsubMedia = window.electronAPI?.onMediaCommand((cmd) => {
      if (cmd === 'toggle') radioEngine.togglePlayPause()
      else if (cmd === 'next') radioEngine.nextSegment()
      else if (cmd === 'prev') radioEngine.prevSegmentOrChapter()
    })
    const unsubFs = window.electronAPI?.onFullScreenChange?.((fs) => {
      setIsFullscreen(fs)
    })
    const onDomFs = () => {
      if (!window.electronAPI && !window.AndroidBridge) {
        setIsFullscreen(Boolean(document.fullscreenElement))
      }
    }
    document.addEventListener('fullscreenchange', onDomFs)
    return () => {
      unsub()
      unsubMedia?.()
      unsubFs?.()
      document.removeEventListener('fullscreenchange', onDomFs)
    }
  }, [])

  const handleToggleFullscreen = useCallback(
    (force?: boolean) => {
      const next = typeof force === 'boolean' ? force : !isFullscreen
      setIsFullscreen(next)
      if (window.electronAPI?.setFullScreen) {
        window.electronAPI.setFullScreen(next)
      } else if (window.AndroidBridge?.setImmersiveFullscreen) {
        window.AndroidBridge.setImmersiveFullscreen(next)
      } else {
        if (next && !document.fullscreenElement) {
          document.documentElement.requestFullscreen?.().catch(() => {})
        } else if (!next && document.fullscreenElement) {
          document.exitFullscreen?.().catch(() => {})
        }
      }
    },
    [isFullscreen]
  )

  // 离开阅读页时自动退出沉浸全屏，避免导航栏被隐藏
  useEffect(() => {
    if (activeTab !== 'reader' && isFullscreen) {
      handleToggleFullscreen(false)
    }
  }, [activeTab, isFullscreen, handleToggleFullscreen])

  // 切换标签页时刷新本地进度与统计
  useEffect(() => {
    setProgressMap(loadAllProgress())
    setStats(loadStats())
  }, [activeTab])

  const handleUpdateSettings = (partial: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial }
      saveReaderSettings(next)
      return next
    })
  }

  const handleResetSettings = () => {
    const fresh = { ...DEFAULT_READER_SETTINGS }
    saveReaderSettings(fresh)
    setSettings(fresh)
  }

  const handleUpdateRadioSettings = (partial: Partial<RadioSettings>) => {
    radioEngine.updateSettings(partial)
    setRadioSettings(radioEngine.getSettings())
  }

  const handleUpdateTranslationSettings = (partial: Partial<TranslationSettings>) => {
    setTranslationSettings((prev) => {
      const next = { ...prev, ...partial }
      saveTranslationSettings(next)
      return next
    })
  }

  const handleUpdateAiSettings = (partial: Partial<AiSettings>) => {
    setAiSettings((prev) => {
      const next = { ...prev, ...partial }
      saveAiSettings(next)
      return next
    })
  }

  const handleSaveAiConversations = (next: AiConversation[]) => {
    setAiConversations(next)
    saveAiConversations(next)
  }

  const handleOpenBook = useCallback(
    (bookId: string, chapterIndex?: number, blockIndex = 0) => {
      const book = books.find((b) => b.id === bookId)
      const savedProg = loadAllProgress()[bookId]
      const targetChapter =
        typeof chapterIndex === 'number'
          ? chapterIndex
          : savedProg
          ? savedProg.chapterIndex
          : book?.firstBodyChapter || 0
      const scrollRatio =
        blockIndex === 0 && savedProg && savedProg.chapterIndex === targetChapter
          ? savedProg.scrollRatio || 0
          : 0
      setReaderTarget({ bookId, chapterIndex: targetChapter, blockIndex, scrollRatio })
      navigateToTab('reader')
    },
    [books, navigateToTab]
  )

  const handleSelectTab = useCallback(
    (tab: AppTab) => {
      if (tab === 'library' && activeTabRef.current === 'library' && mobileShelfTarget !== null) {
        // 已在书馆合集页时再次点击底部「书馆」图标，平滑回到书架首页
        setMobileShelfTarget(null)
        return
      }
      if (tab === 'reader') {
        if (readerTarget) {
          navigateToTab('reader')
          return
        }
        if (mostRecentProgress) {
          handleOpenBook(mostRecentProgress.bookId, mostRecentProgress.chapterIndex, mostRecentProgress.blockIndex)
          return
        }
        if (books.length > 0) {
          const first = books[0]
          handleOpenBook(first.id, first.firstBodyChapter || 0, 0)
          notifyToast(`已为您展开《${first.title}》`)
          return
        }
        notifyToast('请先在书馆中选择一本典籍')
        return
      }
      navigateToTab(tab)
    },
    [readerTarget, mostRecentProgress, books, handleOpenBook, navigateToTab, mobileShelfTarget]
  )

  const handleDataImported = () => {
    setProgressMap(loadAllProgress())
    setFavorites(loadFavorites())
    setUserCollections(loadUserCollections())
    setHighlights(loadHighlights())
    setBookmarks(loadBookmarks())
    setRadioQueue(loadRadioQueue())
    setStats(loadStats())
    setSettings(loadReaderSettings())
    setTranslationSettings(loadTranslationSettings())
    setAiSettings(loadAiSettings())
    const newRadio = loadRadioSettings()
    radioEngine.updateSettings(newRadio)
    setRadioSettings(radioEngine.getSettings())
    refreshCatalog()
  }

  const handleSaveUserCollections = (next: UserCollection[]) => {
    setUserCollections(next)
    saveUserCollections(next)
  }

  const handlePlayBookRadio = (bookId: string, chapterIndex?: number, blockIndex = 0) => {
    const book = books.find((b) => b.id === bookId)
    const savedRadio = radioEngine.getSavedBookCheckpoint(bookId)
    if (savedRadio && blockIndex === 0 && (typeof chapterIndex !== 'number' || savedRadio.chapterIndex === chapterIndex)) {
      radioEngine.playChapter(bookId, savedRadio.chapterIndex, savedRadio.blockIndex, 'current', {
        allowFrontMatter: true,
        startSegmentIndex: savedRadio.segmentIndex,
        startTimeSec: savedRadio.segmentTime,
      })
    } else {
      const targetChapter =
        typeof chapterIndex === 'number' ? chapterIndex : book?.firstBodyChapter || 0
      radioEngine.playChapter(bookId, targetChapter, blockIndex, 'current')
    }
    if (activeTab === 'library') {
      navigateToTab('radio')
    }
  }

  const handleToggleFavorite = (bookId: string) => {
    setFavorites((prev) => {
      const next = prev.includes(bookId) ? prev.filter((id) => id !== bookId) : [bookId, ...prev]
      saveFavorites(next)
      return next
    })
  }

  const handleAddHighlight = (input: HighlightItem | HighlightItem[]) => {
    const incoming = Array.isArray(input) ? input : [input]
    setHighlights((prev) => {
      const map = new Map(prev.map((h) => [h.id, h]))
      const newOnes: HighlightItem[] = []
      for (const item of incoming) {
        if (map.has(item.id)) {
          map.set(item.id, item)
        } else {
          newOnes.push(item)
        }
      }
      const next = [...newOnes, ...prev.map((h) => map.get(h.id) || h)]
      saveHighlights(next)
      return next
    })
  }

  const handleDeleteHighlight = (id: string) => {
    setHighlights((prev) => {
      const target = prev.find((h) => h.id === id)
      const gid = target?.groupId
      const next = gid ? prev.filter((h) => h.groupId !== gid && h.id !== id) : prev.filter((h) => h.id !== id)
      saveHighlights(next)
      return next
    })
  }

  const handleToggleBookmark = (item: Omit<BookmarkItem, 'id' | 'createdAt'>) => {
    setBookmarks((prev) => {
      const exists = prev.find((b) => b.bookId === item.bookId && b.chapterIndex === item.chapterIndex)
      let next: BookmarkItem[]
      if (exists) {
        next = prev.filter((b) => b.id !== exists.id)
        notifyToast('已移除本章书签')
      } else {
        next = [{ ...item, id: `bm_${Date.now().toString(36)}`, createdAt: Date.now() }, ...prev]
        notifyToast('已添加本章书签')
      }
      saveBookmarks(next)
      return next
    })
  }

  const handleDeleteBookmark = (id: string) => {
    setBookmarks((prev) => {
      const next = prev.filter((b) => b.id !== id)
      saveBookmarks(next)
      return next
    })
  }

  const handleAddToRadioQueue = (item: RadioQueueItem) => {
    setRadioQueue((prev) => {
      if (prev.some((q) => q.bookId === item.bookId && q.chapterIndex === item.chapterIndex)) {
        return prev
      }
      const next = [...prev, item]
      saveRadioQueue(next)
      return next
    })
  }

  const handleAddManyToRadioQueue = (items: RadioQueueItem[]) => {
    setRadioQueue((prev) => {
      const seen = new Set(prev.map((q) => `${q.bookId}#${q.chapterIndex}`))
      const toAppend = items.filter((it) => {
        const key = `${it.bookId}#${it.chapterIndex}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      if (toAppend.length === 0) return prev
      const next = [...prev, ...toAppend]
      saveRadioQueue(next)
      return next
    })
  }

  const handleRemoveQueueItem = (id: string) => {
    setRadioQueue((prev) => {
      const next = prev.filter((q) => q.id !== id)
      saveRadioQueue(next)
      return next
    })
  }

  const handleMoveQueueItem = (index: number, delta: -1 | 1) => {
    setRadioQueue((prev) => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const tmp = next[index]
      next[index] = next[target]
      next[target] = tmp
      saveRadioQueue(next)
      return next
    })
  }

  const handleClearRadioQueue = () => {
    setRadioQueue([])
    saveRadioQueue([])
  }

  // 手机端/APK 进入阅读页后交由阅读器原生沉浸模式接管全屏阅读区
  const isMobileImmersiveReader = activeTab === 'reader' && (getPlatform() === 'android' || isCompactViewport)
  const hideChrome = (activeTab === 'reader' && isFullscreen) || isMobileImmersiveReader
  const hasQuickReadableBook = Boolean(readerTarget || mostRecentProgress || books.length > 0)

  return (
    <div className="h-full w-full flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}>
      {!hideChrome && (
        <TitleBar
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          theme={settings.theme}
          onSelectTheme={(nextTheme) => handleUpdateSettings({ theme: nextTheme })}
          isRadioPlaying={isRadioPlaying}
          hasActiveBook={hasQuickReadableBook}
        />
      )}

      {/* 主视图舞台 */}
      <main className="flex-1 min-h-0 relative overflow-hidden">
        {!catalogReady && books.length === 0 && !catalogError ? (
          <div className="h-full w-full" style={{ backgroundColor: 'var(--bg)' }} />
        ) : catalogError && books.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center gap-3">
            <p className="font-serif text-base font-bold">典藏书库初始化失败</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {catalogError}
            </p>
            <button
              onClick={refreshCatalog}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              重新加载
            </button>
          </div>
        ) : (
          <>
            <div className={activeTab === 'library' ? 'h-full w-full' : 'hidden'}>
              <LibraryView
                isActive={activeTab === 'library'}
                mobileShelfTarget={mobileShelfTarget}
                onChangeMobileShelfTarget={setMobileShelfTarget}
                books={books}
                progressMap={progressMap}
                favorites={favorites}
                userCollections={userCollections}
                onToggleFavorite={handleToggleFavorite}
                onSaveUserCollections={handleSaveUserCollections}
                onOpenBook={handleOpenBook}
                onPlayBookRadio={(id, ch) => handlePlayBookRadio(id, ch, 0)}
                onLaunchRoamRadio={() => {
                  navigateToTab('radio')
                  radioEngine.tuneStation('roam')
                }}
                onLibraryChanged={refreshCatalog}
              />
            </div>

            {activeTab === 'reader' && readerTarget && (
              <ReaderView
                key={readerTarget.bookId}
                bookId={readerTarget.bookId}
                initialChapterIndex={readerTarget.chapterIndex}
                initialBlockIndex={readerTarget.blockIndex}
                initialScrollRatio={readerTarget.scrollRatio || 0}
                settings={settings}
                onUpdateSettings={handleUpdateSettings}
                onResetSettings={handleResetSettings}
                isFullscreen={isFullscreen}
                onToggleFullscreen={handleToggleFullscreen}
                radio={radio}
                highlights={highlights}
                bookmarks={bookmarks}
                onAddHighlight={handleAddHighlight}
                onDeleteHighlight={handleDeleteHighlight}
                onToggleBookmark={handleToggleBookmark}
                onAddToRadioQueue={handleAddToRadioQueue}
                onPlayRadioFrom={(id, ch, blk) => {
                  const saved = blk === 0 ? radioEngine.getSavedBookCheckpoint(id) : null
                  if (saved && saved.chapterIndex === ch && saved.segmentIndex > 0) {
                    radioEngine.playChapter(id, ch, saved.blockIndex, 'current', {
                      allowFrontMatter: true,
                      startSegmentIndex: saved.segmentIndex,
                      startTimeSec: saved.segmentTime,
                    })
                  } else {
                    radioEngine.playChapter(id, ch, blk, 'current', { allowFrontMatter: blk > 0 })
                  }
                }}
                onOpenRadioStudio={() => navigateToTab('radio')}
                onJumpToBook={(bid, ch, blk) => handleOpenBook(bid, ch, blk || 0)}
                onBackToLibrary={navigateBack}
                translationSettings={translationSettings}
                onUpdateTranslationSettings={handleUpdateTranslationSettings}
                onOpenTranslationSettings={() => setShowTranslationSettings(true)}
                aiSettings={aiSettings}
                aiConversations={aiConversations}
                onSaveAiConversations={handleSaveAiConversations}
                onOpenAiSettings={() => setShowAiSettings(true)}
              />
            )}

            {activeTab === 'radio' && (
              <RadioStudioView
                books={books}
                radio={radio}
                radioSettings={radioSettings}
                onUpdateRadioSettings={handleUpdateRadioSettings}
                queue={radioQueue}
                onAddToQueue={handleAddToRadioQueue}
                onAddManyToQueue={handleAddManyToRadioQueue}
                onRemoveQueueItem={handleRemoveQueueItem}
                onMoveQueueItem={handleMoveQueueItem}
                onClearQueue={handleClearRadioQueue}
                onOpenReader={handleOpenBook}
                onSaveHighlight={handleAddHighlight}
                onCancelRadio={() => {
                  radioEngine.stop()
                  setRadioDockVisible(false)
                  navigateBack()
                }}
              />
            )}

            {activeTab === 'ai' && (
              <AiAssistantPanel
                variant="page"
                aiSettings={aiSettings}
                conversations={aiConversations}
                onSaveConversations={handleSaveAiConversations}
                onOpenAiSettings={() => setShowAiSettings(true)}
                onOpenTranslationSettings={() => setShowTranslationSettings(true)}
              />
            )}

            {activeTab === 'notes' && (
              <NotesHubView
                highlights={highlights}
                bookmarks={bookmarks}
                stats={stats}
                onDeleteHighlight={handleDeleteHighlight}
                onDeleteBookmark={handleDeleteBookmark}
                onJumpTo={handleOpenBook}
                onDataImported={handleDataImported}
              />
            )}
          </>
        )}

        {/* 悬浮迷你电台条（仅在电台开启时显示，点击右侧 X 可随时停止并彻底收起） */}
        {activeTab !== 'radio' && !hideChrome && radioDockVisible && (
          <div className="absolute bottom-0 inset-x-0 pointer-events-none z-30">
            <MiniRadioDock
              radio={radio}
              onTogglePlay={() => radioEngine.togglePlayPause()}
              onNext={() => radioEngine.nextSegment()}
              onOpenStudio={() => navigateToTab('radio')}
              onClose={() => {
                radioEngine.stop()
                setRadioDockVisible(false)
              }}
            />
          </div>
        )}
      </main>

      {/* 移动端底部导航栏（4 入口：书馆 / 电台 / AI / 笔记） */}
      {!hideChrome && (
        <nav
          className="md:hidden shrink-0 border-t safe-bottom grid grid-cols-4 z-30 select-none"
          style={{ backgroundColor: 'var(--bg-glass)', borderColor: 'var(--border)', backdropFilter: 'blur(20px)' }}
        >
          {(
            [
              ['library', '书馆', <Library className="w-5 h-5" />],
              ['radio', '电台', <Radio className="w-5 h-5" />],
              ['ai', 'AI', <Sparkles className="w-5 h-5" />],
              ['notes', '笔记', <BookmarkCheck className="w-5 h-5" />],
            ] as const
          ).map(([id, label, icon]) => {
            const active = activeTab === id
            return (
              <button
                key={id}
                onClick={() => {
                  triggerHaptic()
                  handleSelectTab(id)
                }}
                className="h-[54px] flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium relative transition-transform active:scale-95"
                style={{ color: active ? 'var(--accent)' : 'var(--text-secondary)' }}
              >
                <span
                  className="px-3 py-1 rounded-full flex items-center justify-center transition-colors"
                  style={active ? { backgroundColor: 'var(--accent-soft)' } : undefined}
                >
                  {icon}
                </span>
                <span className={active ? 'font-semibold' : ''}>{label}</span>
                {id === 'radio' && isRadioPlaying && (
                  <span
                    className="absolute top-1.5 right-[27%] w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: 'var(--accent)' }}
                  />
                )}
              </button>
            )
          })}
        </nav>
      )}

      {/* 全局翻译服务与双语配置弹窗 */}
      {showTranslationSettings && (
        <TranslationSettingsModal
          settings={translationSettings}
          aiSettings={aiSettings}
          onUpdateSettings={handleUpdateTranslationSettings}
          onOpenAiSettings={() => setShowAiSettings(true)}
          onClose={() => setShowTranslationSettings(false)}
        />
      )}

      {/* 全局 AI API 接口设置弹窗 */}
      {showAiSettings && (
        <AiSettingsModal
          settings={aiSettings}
          onUpdateSettings={handleUpdateAiSettings}
          onClose={() => setShowAiSettings(false)}
        />
      )}

      {/* 全局统一轻盈提示胶囊（顶部居中悬浮，绝不遮挡底部菜单/进度条/软键盘） */}
      {toastMsg && (
        <div
          className="fixed left-1/2 -translate-x-1/2 top-16 md:top-14 z-[90] max-w-[84vw] px-4 py-2 rounded-full text-xs font-medium shadow-xl pointer-events-none select-none animate-float-in text-center"
          style={{
            backgroundColor: settings.theme === 'night' ? 'rgba(235, 229, 217, 0.95)' : 'rgba(35, 31, 27, 0.9)',
            color: settings.theme === 'night' ? '#16181d' : '#f7f3eb',
            backdropFilter: 'blur(10px)',
          }}
        >
          {toastMsg}
        </div>
      )}
    </div>
  )
}
