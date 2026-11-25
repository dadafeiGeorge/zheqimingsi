import React, { useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  BookmarkCheck,
  Check,
  Library,
  Maximize2,
  Minimize2,
  Minus,
  Radio,
  Sparkles,
  X,
} from 'lucide-react'
import type { AppTab, ThemeId } from '../types'
import { APP_THEMES, getPlatform, registerBackHandler, triggerHaptic } from '../services/platform'

interface TitleBarProps {
  activeTab: AppTab
  onSelectTab: (tab: AppTab) => void
  theme: ThemeId
  onSelectTheme: (theme: ThemeId) => void
  isRadioPlaying: boolean
  hasActiveBook: boolean
}

export const TitleBar: React.FC<TitleBarProps> = ({
  activeTab,
  onSelectTab,
  theme,
  onSelectTheme,
  isRadioPlaying,
  hasActiveBook,
}) => {
  const isElectron = getPlatform() === 'electron'
  const [maximized, setMaximized] = useState(false)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const themeMenuRef = useRef<HTMLDivElement | null>(null)

  const currentTheme = APP_THEMES.find((t) => t.id === theme) || APP_THEMES[0]

  useEffect(() => {
    if (!isElectron || !window.electronAPI) return
    window.electronAPI.isMaximized().then(setMaximized).catch(() => {})
    return window.electronAPI.onMaximizedChange(setMaximized)
  }, [isElectron])

  useEffect(() => {
    if (!themeMenuOpen) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null
      if (themeMenuRef.current && target && !themeMenuRef.current.contains(target)) {
        setThemeMenuOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setThemeMenuOpen(false)
    }
    const unregBack = registerBackHandler(70, () => {
      setThemeMenuOpen(false)
      return true
    })
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown, { passive: true })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      unregBack()
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [themeMenuOpen])

  const navItems: Array<{ id: AppTab; label: string; icon: React.ReactNode; badge?: boolean }> = [
    { id: 'library', label: '典藏书馆', icon: <Library className="w-4 h-4" /> },
    { id: 'reader', label: '沉浸阅读', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'radio', label: '哲思电台', icon: <Radio className="w-4 h-4" />, badge: isRadioPlaying },
    { id: 'ai', label: 'AI 助手', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'notes', label: '笔记足迹', icon: <BookmarkCheck className="w-4 h-4" /> },
  ]

  return (
    <header
      className="safe-top relative shrink-0 z-40 border-b titlebar-drag select-none"
      style={{
        backgroundColor: 'var(--bg-glass)',
        borderColor: 'var(--border)',
        backdropFilter: 'blur(16px)',
      }}
    >
      <div className="h-12 md:h-13 px-3 md:px-5 flex items-center justify-between gap-2">
        {/* 品牌徽标 */}
        <div className="flex items-center gap-2.5 titlebar-no-drag">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center font-serif font-bold text-sm shadow-sm border border-white/25"
            style={{
              background: 'linear-gradient(145deg, #26805E, #144B37)',
              color: '#FFFFFF',
            }}
          >
            哲
          </div>
          <div className="leading-tight">
            <div className="font-serif font-bold text-[15px] tracking-wider flex items-center gap-1.5">
              <span>哲启明思</span>
              <span
                className="hidden sm:inline text-[10px] font-mono tracking-[0.18em] px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                PHILO FM
              </span>
            </div>
          </div>
        </div>

        {/* 桌面端居中导航胶囊 */}
        <nav
          className="hidden md:flex items-center p-1 rounded-full border titlebar-no-drag"
          style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
        >
          {navItems.map((item) => {
            const active = activeTab === item.id
            const disabled = item.id === 'reader' && !hasActiveBook
            return (
              <button
                key={item.id}
                onClick={() => !disabled && onSelectTab(item.id)}
                disabled={disabled}
                className={`relative px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all duration-200 ${
                  disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                }`}
                style={
                  active
                    ? {
                        backgroundColor: 'var(--bg-card)',
                        color: 'var(--accent)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                      }
                    : { color: 'var(--text-secondary)' }
                }
              >
                {item.icon}
                <span>{item.label}</span>
                {item.badge && (
                  <span
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: 'var(--accent)' }}
                  />
                )}
              </button>
            )
          })}
        </nav>

        {/* 右侧控制区 */}
        <div className="flex items-center gap-1.5 titlebar-no-drag">
          <div className="relative" ref={themeMenuRef}>
            <button
              onClick={() => {
                triggerHaptic()
                setThemeMenuOpen((prev) => !prev)
              }}
              title={`切换阅读主题（当前：${currentTheme.name}）`}
              aria-label="切换主题"
              aria-expanded={themeMenuOpen}
              className="h-8 px-2.5 rounded-full border flex items-center gap-1.5 text-xs font-medium transition-all active:scale-95 hover:opacity-90"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderColor: themeMenuOpen ? 'var(--accent)' : 'var(--border)',
                color: 'var(--text-secondary)',
              }}
            >
              <span
                className="w-3.5 h-3.5 rounded-full border shrink-0 shadow-inner"
                style={{
                  backgroundColor: currentTheme.swatch,
                  borderColor: currentTheme.dark ? 'rgba(255,255,255,0.4)' : 'rgba(35,31,27,0.28)',
                }}
              />
              <span className="text-[11px]">{currentTheme.shortName}</span>
            </button>

            {themeMenuOpen && (
              <div
                className="absolute right-0 mt-2 w-60 p-2.5 rounded-2xl border shadow-2xl z-50 animate-float-in"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-strong)',
                  boxShadow: 'var(--shadow-float)',
                }}
              >
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    阅读纸张主题
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {currentTheme.name}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {APP_THEMES.map((t) => {
                    const active = theme === t.id
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          triggerHaptic()
                          onSelectTheme(t.id)
                          setThemeMenuOpen(false)
                        }}
                        className="relative flex flex-col items-center gap-1 py-2 px-1 rounded-xl border text-[11px] font-medium transition-transform active:scale-95"
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
                        <span className="font-serif text-[15px] font-bold leading-none">永</span>
                        <span className="text-[10px] leading-tight">{t.shortName}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {isElectron && (
            <div className="flex items-center ml-1 pl-2 border-l" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => window.electronAPI?.windowMinimize()}
                className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                title="最小化"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => window.electronAPI?.windowMaximize()}
                className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                title={maximized ? '还原窗口' : '最大化'}
              >
                {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => window.electronAPI?.windowClose()}
                className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
                title="关闭"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
