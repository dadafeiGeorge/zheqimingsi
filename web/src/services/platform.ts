import type { ThemeId } from '../types'

declare global {
  interface Window {
    electronAPI?: {
      platform: string
      apiBase: string
      initialCatalog?: { books?: unknown[] } | null
      notifyRendererReady?: () => void
      syncTheme?: (theme: ThemeId) => void
      windowMinimize: () => void
      windowMaximize: () => void
      windowClose: () => void
      isMaximized: () => Promise<boolean>
      onMaximizedChange: (cb: (max: boolean) => void) => () => void
      setFullScreen: (flag: boolean) => void
      onFullScreenChange: (cb: (fs: boolean) => void) => () => void
      setMinimizeToTray: (flag: boolean) => void
      setRadioActive?: (active: boolean) => void
      onMediaCommand: (cb: (cmd: 'toggle' | 'next' | 'prev') => void) => () => void
      saveImageDataUrl: (dataUrl: string, defaultName: string) => Promise<{ ok: boolean; path?: string }>
      importLocalFile: () => Promise<{ name: string; content: string } | null>
      openExternal: (url: string) => void
    }
    AndroidBridge?: {
      getAppVersion: () => string
      setStatusBarTheme: (isDark: boolean, bgColorHex: string) => void
      setImmersiveFullscreen: (on: boolean) => void
      setKeepScreenOn: (on: boolean) => void
      setVolumeKeyTurn: (on: boolean) => void
      hapticTick: () => void
      // Native Microsoft TTS & Foreground Radio Service
      radioPlayTrack: (payloadJson: string) => void
      radioPause: () => void
      radioResume: () => void
      radioStop: () => void
      radioJumpBlock: (segmentIndex: number) => void
      radioJumpToSegmentWithTime?: (segmentIndex: number, startTimeSec: number) => void
      radioSeekBy: (deltaSec: number) => void
      radioSeekTo: (positionSec: number) => void
      radioSetSleepTimer?: (sleepEndAtMs: number, sleepAfterChapter: boolean) => void
      radioUpdateConfig: (configJson: string) => void
      radioGetState: () => string
      ttsAudition: (text: string, voice: string, rate: number, pitch: number, azureKey: string, azureRegion: string) => void
      ttsPrefetchSegment: (text: string, voice: string, rate: number, pitch: number, azureKey: string, azureRegion: string) => boolean
      ttsGetCacheStats: () => string
      ttsClearCache: () => boolean
      ttsFetchVoices: () => void
      ttsGetSystemEngineName?: () => string
      saveImageBase64: (base64Png: string, fileName: string) => boolean
      showToast: (msg: string) => void
    }
    __onAndroidRadioEvent?: (event: any) => void
    __onAndroidVoicesResult?: (voicesJson: string) => void
    __onAndroidVolumeKey?: (dir: 'up' | 'down') => void
    __handleAndroidBack?: () => 'consumed' | 'exit_background' | 'exit'
  }
}

export type PlatformKind = 'electron' | 'android' | 'web'

export function getPlatform(): PlatformKind {
  if (typeof window !== 'undefined') {
    if (window.electronAPI) return 'electron'
    if (window.AndroidBridge) return 'android'
  }
  return 'web'
}

export function getApiBase(): string {
  if (typeof window !== 'undefined' && window.electronAPI?.apiBase) {
    return window.electronAPI.apiBase
  }
  return ''
}

export function getLibraryBase(): string {
  const p = getPlatform()
  if (p === 'electron' && window.electronAPI?.apiBase) {
    return `${window.electronAPI.apiBase}/library`
  }
  // Android WebViewAssetLoader & Vite dev/prod serve relative ./library
  return './library'
}

export interface AppThemeOption {
  id: ThemeId
  name: string
  shortName: string
  swatch: string
  ink: string
  accent: string
  dark: boolean
}

export const APP_THEMES: AppThemeOption[] = [
  { id: 'paper', name: '宣纸暖白', shortName: '宣纸', swatch: '#F7F3EB', ink: '#231F1B', accent: '#B4512A', dark: false },
  { id: 'sepia', name: '羊皮古卷', shortName: '羊皮', swatch: '#ECE1CB', ink: '#2C2319', accent: '#9E4321', dark: false },
  { id: 'sage', name: '青苔护眼', shortName: '青苔', swatch: '#CDDCD1', ink: '#15241C', accent: '#1D634A', dark: false },
  { id: 'night', name: '松烟深墨', shortName: '松烟', swatch: '#121418', ink: '#E5DFD3', accent: '#DF9B48', dark: true },
]

const THEME_BG_HEX: Record<ThemeId, { dark: boolean; hex: string }> = {
  paper: { dark: false, hex: '#F7F3EB' },
  sepia: { dark: false, hex: '#ECE1CB' },
  night: { dark: true, hex: '#121418' },
  sage: { dark: false, hex: '#CDDCD1' },
}

export function syncSystemChrome(theme: ThemeId) {
  document.documentElement.setAttribute('data-theme', theme)
  const info = THEME_BG_HEX[theme] || THEME_BG_HEX.paper
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', info.hex)
  try {
    window.electronAPI?.syncTheme?.(theme)
    window.AndroidBridge?.setStatusBarTheme(info.dark, info.hex)
  } catch {}
}

export function triggerHaptic() {
  try {
    window.AndroidBridge?.hapticTick()
  } catch {}
}

// ---------- 全局统一悬浮 Toast 系统 ----------
type ToastListener = (msg: string) => void
const toastListeners = new Set<ToastListener>()

export function subscribeToast(listener: ToastListener): () => void {
  toastListeners.add(listener)
  return () => {
    toastListeners.delete(listener)
  }
}

export function notifyToast(msg: string) {
  if (!msg) return
  if (toastListeners.size > 0) {
    toastListeners.forEach((fn) => {
      try {
        fn(msg)
      } catch {}
    })
    return
  }
  try {
    window.AndroidBridge?.showToast(msg)
  } catch {}
}

// ---------- 全局分层返回栈系统（彻底修复 Android 返回键直接退出软件） ----------
export type BackHandlerFn = () => boolean

interface BackEntry {
  id: number
  priority: number
  order: number
  handler: BackHandlerFn
}

let backSeq = 0
const backStack: BackEntry[] = []

/**
 * 注册分层返回拦截器：
 * - priority 越高越优先响应（弹窗 100 > 浮卡 80 > 抽屉/面板 60 > 页内搜索 40 > 阅读器返回 20）
 * - 同优先级后注册者优先响应
 */
export function registerBackHandler(priority: number, handler: BackHandlerFn): () => void {
  const id = ++backSeq
  const entry: BackEntry = { id, priority, order: id, handler }
  backStack.push(entry)
  return () => {
    const idx = backStack.findIndex((e) => e.id === id)
    if (idx >= 0) backStack.splice(idx, 1)
  }
}

export function dispatchRegisteredBackHandlers(): boolean {
  const ordered = [...backStack].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return b.order - a.order
  })
  for (const entry of ordered) {
    try {
      if (entry.handler()) return true
    } catch {}
  }
  return false
}
