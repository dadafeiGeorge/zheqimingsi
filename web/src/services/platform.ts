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
      getInitialCatalogJson?: () => string
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
      httpRequest?: (reqId: string, payloadJson: string) => void
      httpStreamStart?: (reqId: string, payloadJson: string) => void
      httpStreamAbort?: (reqId: string) => void
    }
    __onAndroidRadioEvent?: (event: any) => void
    __onAndroidVoicesResult?: (voicesJson: string) => void
    __onAndroidVolumeKey?: (dir: 'up' | 'down') => void
    __handleAndroidBack?: () => 'consumed' | 'exit_background' | 'exit'
    __onAndroidHttpResponse?: (reqId: string, result: NativeHttpResponse) => void
    __onAndroidHttpStream?: (reqId: string, eventType: 'chunk' | 'done' | 'error', data: string) => void
  }
}

export interface NativeHttpRequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export interface NativeHttpResponse {
  ok: boolean
  status: number
  statusText?: string
  finalUrl?: string
  cookies?: string
  headers?: Record<string, string>
  body: string
  error?: string
}

const androidHttpPending = new Map<string, (res: NativeHttpResponse) => void>()
const androidStreamHandlers = new Map<
  string,
  { onChunk: (text: string) => void; onDone: () => void; onError: (msg: string) => void }
>()

let httpSeq = 0

function ensureAndroidHttpCallbacks() {
  if (typeof window === 'undefined') return
  if (!window.__onAndroidHttpResponse) {
    window.__onAndroidHttpResponse = (reqId, result) => {
      const resolver = androidHttpPending.get(reqId)
      if (resolver) {
        androidHttpPending.delete(reqId)
        resolver(result)
      }
    }
  }
  if (!window.__onAndroidHttpStream) {
    window.__onAndroidHttpStream = (reqId, eventType, data) => {
      const handler = androidStreamHandlers.get(reqId)
      if (!handler) return
      if (eventType === 'chunk') {
        handler.onChunk(data)
      } else if (eventType === 'done') {
        androidStreamHandlers.delete(reqId)
        handler.onDone()
      } else if (eventType === 'error') {
        androidStreamHandlers.delete(reqId)
        handler.onError(data || '流式请求失败')
      }
    }
  }
}

/**
 * 跨端免 CORS 网络请求：
 * - Windows 桌面端自动经 Electron 本地代理转发
 * - Android APK 自动经原生 OkHttp3 转发（兼容系统代理/VPN）
 * - 浏览器端直接 fetch 兜底
 */
export async function nativeHttpRequest(opts: NativeHttpRequestOptions): Promise<NativeHttpResponse> {
  const platform = getPlatform()

  if (platform === 'electron' && window.electronAPI?.apiBase) {
    try {
      const res = await fetch(`${window.electronAPI.apiBase}/api/proxy/http`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      const data = await res.json()
      return {
        ok: Boolean(data.ok),
        status: Number(data.status) || 0,
        statusText: data.statusText || '',
        finalUrl: typeof data.finalUrl === 'string' ? data.finalUrl : undefined,
        cookies: typeof data.cookies === 'string' ? data.cookies : undefined,
        headers: data.headers || {},
        body: typeof data.body === 'string' ? data.body : '',
        error: data.error,
      }
    } catch (err: any) {
      return { ok: false, status: 0, body: '', error: err?.message || '桌面代理请求失败' }
    }
  }

  if (platform === 'android' && window.AndroidBridge?.httpRequest) {
    ensureAndroidHttpCallbacks()
    const reqId = `http_${Date.now().toString(36)}_${++httpSeq}`
    const timeoutMs = opts.timeoutMs || 30000
    return new Promise<NativeHttpResponse>((resolve) => {
      const timer = window.setTimeout(() => {
        if (androidHttpPending.has(reqId)) {
          androidHttpPending.delete(reqId)
          resolve({ ok: false, status: 0, body: '', error: '请求超时，请检查网络连接' })
        }
      }, timeoutMs + 3000)
      androidHttpPending.set(reqId, (res) => {
        window.clearTimeout(timer)
        resolve(res)
      })
      try {
        window.AndroidBridge!.httpRequest!(reqId, JSON.stringify(opts))
      } catch (err: any) {
        window.clearTimeout(timer)
        androidHttpPending.delete(reqId)
        resolve({ ok: false, status: 0, body: '', error: err?.message || 'Android 原生请求桥调用失败' })
      }
    })
  }

  const ac = new AbortController()
  const timer = window.setTimeout(() => ac.abort(), opts.timeoutMs || 30000)
  try {
    const res = await fetch(opts.url, {
      method: opts.method || 'GET',
      headers: opts.headers,
      body: opts.method === 'GET' ? undefined : opts.body,
      signal: ac.signal,
    })
    const body = await res.text()
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      headers[k] = v
    })
    return { ok: res.ok, status: res.status, statusText: res.statusText, headers, body }
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      body: '',
      error: err?.name === 'AbortError' ? '请求超时' : err?.message || '网络请求失败',
    }
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * 跨端免 CORS 流式网络请求（专供 AI 实时流式生成）
 */
export async function nativeHttpStream(
  opts: NativeHttpRequestOptions,
  callbacks: {
    onChunk: (text: string) => void
    signal?: AbortSignal
  }
): Promise<void> {
  const platform = getPlatform()

  if (platform === 'android' && window.AndroidBridge?.httpStreamStart) {
    ensureAndroidHttpCallbacks()
    const reqId = `stream_${Date.now().toString(36)}_${++httpSeq}`
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        androidStreamHandlers.delete(reqId)
        try {
          window.AndroidBridge?.httpStreamAbort?.(reqId)
        } catch {}
        resolve()
      }
      if (callbacks.signal?.aborted) {
        resolve()
        return
      }
      callbacks.signal?.addEventListener('abort', onAbort, { once: true })
      androidStreamHandlers.set(reqId, {
        onChunk: callbacks.onChunk,
        onDone: () => {
          callbacks.signal?.removeEventListener('abort', onAbort)
          resolve()
        },
        onError: (msg) => {
          callbacks.signal?.removeEventListener('abort', onAbort)
          reject(new Error(msg))
        },
      })
      try {
        window.AndroidBridge!.httpStreamStart!(reqId, JSON.stringify(opts))
      } catch (err: any) {
        androidStreamHandlers.delete(reqId)
        callbacks.signal?.removeEventListener('abort', onAbort)
        reject(new Error(err?.message || 'Android 流式通道启动失败'))
      }
    })
  }

  const targetUrl =
    platform === 'electron' && window.electronAPI?.apiBase
      ? `${window.electronAPI.apiBase}/api/proxy/stream`
      : opts.url
  const fetchInit: RequestInit =
    platform === 'electron' && window.electronAPI?.apiBase
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts),
          signal: callbacks.signal,
        }
      : {
          method: opts.method || 'POST',
          headers: opts.headers,
          body: opts.body,
          signal: callbacks.signal,
        }

  const res = await fetch(targetUrl, fetchInit)
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${errText ? `: ${errText.slice(0, 260)}` : ''}`)
  }
  if (!res.body) {
    const text = await res.text()
    if (text) callbacks.onChunk(text)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const str = decoder.decode(value, { stream: true })
      if (str) callbacks.onChunk(str)
    }
    const rest = decoder.decode()
    if (rest) callbacks.onChunk(rest)
  } catch (err: any) {
    if (err?.name === 'AbortError') return
    throw err
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
