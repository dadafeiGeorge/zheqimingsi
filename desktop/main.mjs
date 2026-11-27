import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerSaveBlocker, shell, Tray } from 'electron'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { synthesizeWithCache } from './tts-engine.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function logDesktopError(tag, err) {
  try {
    const dir = app.getPath('userData')
    fs.mkdirSync(dir, { recursive: true })
    const fp = path.join(dir, 'desktop-error.log')
    const line = `[${new Date().toISOString()}] [${tag}] ${err?.stack || err?.message || String(err)}\n`
    fs.appendFileSync(fp, line, 'utf8')
  } catch {}
}

process.on('uncaughtException', (err) => {
  logDesktopError('uncaughtException', err)
})
process.on('unhandledRejection', (reason) => {
  logDesktopError('unhandledRejection', reason)
})

function cleanupOldRuntimeCachesAsync() {
  try {
    const exeDir = path.dirname(process.execPath)
    const runtimeRoot = path.dirname(exeDir)
    if (path.basename(runtimeRoot).toLowerCase() !== 'runtime') return
    const currentName = path.basename(exeDir)
    fs.promises
      .readdir(runtimeRoot, { withFileTypes: true })
      .then((entries) => {
        for (const ent of entries) {
          if (!ent.isDirectory() || ent.name === currentName) continue
          fs.promises.rm(path.join(runtimeRoot, ent.name), { recursive: true, force: true }).catch(() => {})
        }
      })
      .catch(() => {})
  } catch {}
}

// 修复 Windows 11 + Electron 32 无边框窗口隐藏到托盘后再恢复时 GPU 合成器休眠导致白屏的已知问题
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
if (process.platform === 'win32') {
  app.setAppUserModelId('com.zheqimingsi.reader')
}

const PREFERRED_PORTS = [47821, 47822, 47823, 47824, 47825, 47826, 47827, 47828, 47829, 47830, 0]

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function getInstanceStateFile() {
  return path.join(app.getPath('userData'), 'running-instance.json')
}

function writeInstancePort(port) {
  try {
    const fp = getInstanceStateFile()
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    fs.writeFileSync(fp, JSON.stringify({ pid: process.pid, port, updatedAt: Date.now() }), 'utf8')
  } catch {}
}

function clearInstancePort() {
  try {
    const fp = getInstanceStateFile()
    if (!fs.existsSync(fp)) return
    const info = JSON.parse(fs.readFileSync(fp, 'utf8'))
    if (info?.pid === process.pid) fs.unlinkSync(fp)
  } catch {}
}

/** 第二实例向已运行实例发送显式 HTTP 唤醒请求（双保险，确保快捷方式双击必弹回前台） */
function notifyExistingInstanceToReveal() {
  return new Promise((resolve) => {
    try {
      const fp = getInstanceStateFile()
      if (!fs.existsSync(fp)) return resolve(false)
      const info = JSON.parse(fs.readFileSync(fp, 'utf8'))
      const port = Number(info?.port)
      if (!port || port <= 0) return resolve(false)
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/window/reveal',
          method: 'POST',
          timeout: 1500,
        },
        (res) => {
          res.resume()
          resolve(res.statusCode === 200)
        }
      )
      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        try {
          req.destroy()
        } catch {}
        resolve(false)
      })
      req.end()
    } catch {
      resolve(false)
    }
  })
}

function resolveResourceDirs() {
  if (app.isPackaged) {
    return {
      webDir: path.join(process.resourcesPath, 'web'),
      libraryDir: path.join(process.resourcesPath, 'library'),
      iconPath: path.join(process.resourcesPath, 'assets', 'icon.ico'),
    }
  }
  const root = path.resolve(__dirname, '..')
  return {
    webDir: path.join(root, 'web', 'dist'),
    libraryDir: path.join(root, 'library-data'),
    iconPath: path.join(__dirname, 'assets', 'icon.ico'),
  }
}

function listenOnPreferredPort(server) {
  return new Promise((resolve, reject) => {
    let idx = 0
    const tryNext = () => {
      if (idx >= PREFERRED_PORTS.length) {
        return reject(new Error('无法绑定本地服务端口'))
      }
      const port = PREFERRED_PORTS[idx++]
      const onError = (err) => {
        server.removeListener('listening', onListening)
        if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES') && idx < PREFERRED_PORTS.length) {
          tryNext()
        } else {
          reject(err)
        }
      }
      const onListening = () => {
        server.removeListener('error', onError)
        const addr = server.address()
        resolve({ server, port: addr.port })
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    }
    tryNext()
  })
}

function startLocalServer(webDir, libraryDir, cacheDir, onRevealWindow) {
  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || '/', 'http://127.0.0.1')
      const pathname = decodeURIComponent(urlObj.pathname)

      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      // 通用外部 HTTP 代理（彻底规避翻译引擎与 AI API 的 CORS 跨域限制）
      if (pathname === '/api/proxy/http' && req.method === 'POST') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        const targetUrl = String(payload.url || '')
        if (!/^https?:\/\//i.test(targetUrl)) {
          const errBody = Buffer.from(JSON.stringify({ ok: false, status: 400, error: '无效的目标 URL' }), 'utf8')
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': errBody.length })
          res.end(errBody)
          return
        }
        const method = String(payload.method || 'GET').toUpperCase()
        const reqHeaders = payload.headers && typeof payload.headers === 'object' ? { ...payload.headers } : {}
        const timeoutMs = Math.min(120000, Math.max(3000, Number(payload.timeoutMs) || 30000))
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), timeoutMs)
        try {
          const upstream = await fetch(targetUrl, {
            method,
            headers: reqHeaders,
            body: method === 'GET' || method === 'HEAD' ? undefined : payload.body ?? undefined,
            signal: ac.signal,
          })
          const text = await upstream.text()
          const respHeaders = {}
          upstream.headers.forEach((v, k) => {
            respHeaders[k] = v
          })
          const setCookies =
            typeof upstream.headers.getSetCookie === 'function'
              ? upstream.headers.getSetCookie()
              : respHeaders['set-cookie']
              ? [respHeaders['set-cookie']]
              : []
          const cookies = setCookies
            .map((c) => String(c).split(';')[0].trim())
            .filter(Boolean)
            .join('; ')
          const out = Buffer.from(
            JSON.stringify({
              ok: upstream.ok,
              status: upstream.status,
              statusText: upstream.statusText,
              finalUrl: upstream.url || targetUrl,
              cookies,
              headers: respHeaders,
              body: text,
            }),
            'utf8'
          )
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': out.length })
          res.end(out)
        } catch (err) {
          const out = Buffer.from(
            JSON.stringify({
              ok: false,
              status: 0,
              error: err?.name === 'AbortError' ? '请求超时，请检查网络或代理设置' : String(err?.message || err),
            }),
            'utf8'
          )
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': out.length })
          res.end(out)
        } finally {
          clearTimeout(timer)
        }
        return
      }

      // 通用流式代理（专供 AI API 实时 SSE 流式回复）
      if (pathname === '/api/proxy/stream' && req.method === 'POST') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        const targetUrl = String(payload.url || '')
        if (!/^https?:\/\//i.test(targetUrl)) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('无效的目标 URL')
          return
        }
        const method = String(payload.method || 'POST').toUpperCase()
        const reqHeaders = payload.headers && typeof payload.headers === 'object' ? { ...payload.headers } : {}
        const ac = new AbortController()
        req.on('close', () => {
          try {
            ac.abort()
          } catch {}
        })
        try {
          const upstream = await fetch(targetUrl, {
            method,
            headers: reqHeaders,
            body: method === 'GET' || method === 'HEAD' ? undefined : payload.body ?? undefined,
            signal: ac.signal,
          })
          const ct = upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8'
          res.writeHead(upstream.status, {
            'Content-Type': ct,
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          })
          if (!upstream.body) {
            res.end()
            return
          }
          const reader = upstream.body.getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value && value.length > 0) {
              res.write(Buffer.from(value))
            }
          }
          res.end()
        } catch (err) {
          if (!res.headersSent) {
            const msg = Buffer.from(String(err?.message || err), 'utf8')
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': msg.length })
            res.end(msg)
          } else {
            try {
              res.end()
            } catch {}
          }
        }
        return
      }

      // 内部单实例窗口唤醒端点
      if (pathname === '/api/window/reveal' && req.method === 'POST') {
        try {
          onRevealWindow?.()
        } catch {}
        const body = Buffer.from(JSON.stringify({ ok: true }), 'utf8')
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length })
        res.end(body)
        return
      }

      // 内置微软 TTS 合成接口
      if (pathname === '/api/tts') {
        let opts = {}
        if (req.method === 'POST') {
          const chunks = []
          for await (const c of req) chunks.push(c)
          opts = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        } else {
          opts = {
            text: urlObj.searchParams.get('text') || '',
            voice: urlObj.searchParams.get('voice') || undefined,
            rate: urlObj.searchParams.get('rate') || undefined,
            pitch: urlObj.searchParams.get('pitch') || undefined,
          }
        }
        const mp3 = await synthesizeWithCache(opts, cacheDir)
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Content-Length': mp3.length,
          'Cache-Control': 'public, max-age=86400',
        })
        res.end(mp3)
        return
      }

      if (pathname === '/api/tts/cache/stats') {
        let fileCount = 0
        let totalBytes = 0
        if (fs.existsSync(cacheDir)) {
          for (const f of fs.readdirSync(cacheDir)) {
            if (!f.endsWith('.mp3')) continue
            try {
              const st = fs.statSync(path.join(cacheDir, f))
              if (st.isFile()) {
                fileCount++
                totalBytes += st.size
              }
            } catch {}
          }
        }
        const body = Buffer.from(JSON.stringify({ fileCount, totalBytes }), 'utf8')
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length })
        res.end(body)
        return
      }

      if (pathname === '/api/tts/cache/clear' && req.method === 'POST') {
        let cleared = 0
        if (fs.existsSync(cacheDir)) {
          for (const f of fs.readdirSync(cacheDir)) {
            try {
              fs.unlinkSync(path.join(cacheDir, f))
              cleared++
            } catch {}
          }
        }
        const body = Buffer.from(JSON.stringify({ ok: true, cleared }), 'utf8')
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length })
        res.end(body)
        return
      }

      if (pathname === '/api/health') {
        const body = Buffer.from(
          JSON.stringify({ ok: true, app: '哲启明思', version: '1.2.0', buildDate: '2026.11.27' }),
          'utf8'
        )
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length })
        res.end(body)
        return
      }

      // 典藏书库静态文件服务 (/library/*)：原子读取 + 精确 Content-Length，避免休眠后管道半开卡死
      if (pathname.startsWith('/library/')) {
        const rel = pathname.slice('/library/'.length)
        const safePath = path.normalize(path.join(libraryDir, rel))
        if (!safePath.startsWith(libraryDir) || !fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('Not found')
          return
        }
        const data = await fs.promises.readFile(safePath)
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': data.length,
          'Cache-Control': 'public, max-age=3600',
        })
        res.end(data)
        return
      }

      // 前端 SPA 静态资源服务
      let filePath = path.normalize(path.join(webDir, pathname === '/' ? 'index.html' : pathname))
      if (!filePath.startsWith(webDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(webDir, 'index.html')
      }
      const ext = path.extname(filePath).toLowerCase()
      const data = await fs.promises.readFile(filePath)
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': data.length,
      })
      res.end(data)
    } catch (err) {
      if (!res.headersSent) {
        const msg = Buffer.from(String(err?.message || err), 'utf8')
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': msg.length })
        res.end(msg)
      } else {
        try {
          res.end()
        } catch {}
      }
    }
  })

  // 防止长时间隐藏托盘后产生过期 keep-alive 僵尸连接
  server.keepAliveTimeout = 15000
  server.headersTimeout = 20000
  return listenOnPreferredPort(server)
}

let mainWindow = null
let tray = null
let apiBase = ''
let localServer = null
let minimizeToTray = false
let isQuitting = false
let revealResetTimer = null
let initialCatalogData = null
let radioPowerBlockerId = null

function updateRadioPowerSaveBlocker(active) {
  try {
    if (active) {
      if (radioPowerBlockerId === null || !powerSaveBlocker.isStarted(radioPowerBlockerId)) {
        radioPowerBlockerId = powerSaveBlocker.start('prevent-app-suspension')
      }
    } else if (radioPowerBlockerId !== null) {
      if (powerSaveBlocker.isStarted(radioPowerBlockerId)) {
        powerSaveBlocker.stop(radioPowerBlockerId)
      }
      radioPowerBlockerId = null
    }
  } catch {}
}

const THEME_BG_MAP = {
  paper: '#F7F3EB',
  sepia: '#ECE1CB',
  night: '#121418',
  sage: '#CDDCD1',
}

function getThemeStateFile() {
  return path.join(app.getPath('userData'), 'ui-theme.json')
}

function readSavedThemeBg() {
  try {
    const fp = getThemeStateFile()
    if (!fs.existsSync(fp)) return THEME_BG_MAP.paper
    const info = JSON.parse(fs.readFileSync(fp, 'utf8'))
    return THEME_BG_MAP[info?.theme] || THEME_BG_MAP.paper
  } catch {
    return THEME_BG_MAP.paper
  }
}

function writeSavedTheme(theme) {
  try {
    const t = THEME_BG_MAP[theme] ? theme : 'paper'
    const fp = getThemeStateFile()
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    fs.writeFileSync(fp, JSON.stringify({ theme: t }), 'utf8')
    return THEME_BG_MAP[t]
  } catch {
    return THEME_BG_MAP.paper
  }
}

// 强制单实例锁：若后台托盘已有实例在运行，再次双击桌面快捷方式时直接唤醒已有窗口，绝不重复新开进程
const gotSingleInstanceLock = app.requestSingleInstanceLock()

function forceWindowRepaint(win) {
  if (!win || win.isDestroyed()) return
  try {
    win.webContents.invalidate()
  } catch {}
  try {
    // 强制触发一次极轻量布局刷新，确保 Windows 11 DWM 合成器立即提交新帧、杜绝托盘恢复白屏
    win.webContents
      .executeJavaScript(
        'requestAnimationFrame(()=>{document.documentElement.style.transform="translateZ(0)";requestAnimationFrame(()=>{document.documentElement.style.transform="";window.dispatchEvent(new Event("resize"));});});',
        true
      )
      .catch(() => {})
  } catch {}
}

function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (apiBase && !isQuitting) {
      createMainWindow()
    }
    return
  }
  try {
    mainWindow.setSkipTaskbar(false)
    try {
      mainWindow.setOpacity(1)
    } catch {}
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.moveTop()
    // Windows 11 前台焦点穿透：短暂置顶再平滑复位，确保从隐藏托盘或快捷方式双击必弹出到最前台
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu')
    mainWindow.focus()
    if (revealResetTimer) clearTimeout(revealResetTimer)
    revealResetTimer = setTimeout(() => {
      revealResetTimer = null
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.setAlwaysOnTop(false)
        } catch {}
        forceWindowRepaint(mainWindow)
      }
    }, 120)
    forceWindowRepaint(mainWindow)
  } catch {}
}

if (!gotSingleInstanceLock) {
  // 双保险唤醒已有实例后立即彻底退出，绝不滞留后台进程
  notifyExistingInstanceToReveal().finally(() => {
    app.exit(0)
  })
} else {
  app.on('second-instance', () => {
    revealMainWindow()
  })
}

let cachedIconPath = ''

function destroyTray() {
  if (tray) {
    try {
      tray.destroy()
    } catch {}
    tray = null
  }
}

function setupSystemTray(iconPath) {
  if (tray) return
  try {
    const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
    tray = new Tray(icon)
    tray.setToolTip('哲启明思 v1.2.0 (2026.11.27) · 哲学典藏阅读与微软电台')
    const showMainWindow = () => revealMainWindow()
    const menu = Menu.buildFromTemplate([
      { label: '显示哲启明思窗口', click: showMainWindow },
      { type: 'separator' },
      {
        label: '电台播放 / 暂停',
        click: () => mainWindow?.webContents.send('media-command', 'toggle'),
      },
      {
        label: '电台下一段',
        click: () => mainWindow?.webContents.send('media-command', 'next'),
      },
      {
        label: '电台上一段',
        click: () => mainWindow?.webContents.send('media-command', 'prev'),
      },
      { type: 'separator' },
      {
        label: '彻底退出哲启明思',
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ])
    tray.setContextMenu(menu)
    tray.on('click', showMainWindow)
    tray.on('double-click', showMainWindow)
  } catch {}
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    revealMainWindow()
    return mainWindow
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 600,
    frame: false,
    show: false,
    title: '哲启明思 v1.2.0 (2026.11.27) · 哲学典藏阅读与电台',
    icon: cachedIconPath && fs.existsSync(cachedIconPath) ? cachedIconPath : undefined,
    backgroundColor: readSavedThemeBg(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  // 双重就绪门控：必须同时满足 ready-to-show 与渲染进程首帧绘制完成（renderer-ready），再平滑淡入显现，彻底消除空白帧
  let winReadyToShow = false
  let rendererFrameReady = false
  let hasPresentedOnce = false
  let fallbackShowTimer = null

  const presentWindowSmoothly = () => {
    if (hasPresentedOnce || !mainWindow || mainWindow.isDestroyed()) return
    hasPresentedOnce = true
    if (fallbackShowTimer) {
      clearTimeout(fallbackShowTimer)
      fallbackShowTimer = null
    }
    try {
      mainWindow.setOpacity(0)
    } catch {}
    mainWindow.show()
    mainWindow.focus()
    let step = 0
    const totalSteps = 4
    const fadeTimer = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        clearInterval(fadeTimer)
        return
      }
      step += 1
      const alpha = Math.min(1, step / totalSteps)
      try {
        mainWindow.setOpacity(alpha)
      } catch {
        clearInterval(fadeTimer)
        return
      }
      if (step >= totalSteps) {
        clearInterval(fadeTimer)
        forceWindowRepaint(mainWindow)
      }
    }, 12)
  }

  const tryPresentWindow = () => {
    if (winReadyToShow && rendererFrameReady) {
      presentWindowSmoothly()
    }
  }

  const onRendererReady = () => {
    rendererFrameReady = true
    tryPresentWindow()
  }
  ipcMain.once('renderer-ready', onRendererReady)

  mainWindow.once('ready-to-show', () => {
    winReadyToShow = true
    tryPresentWindow()
  })

  // 800ms 兜底定时器：防止极端异常下窗口迟迟不显现
  fallbackShowTimer = setTimeout(() => {
    fallbackShowTimer = null
    presentWindowSmoothly()
  }, 800)

  mainWindow.on('show', () => {
    forceWindowRepaint(mainWindow)
  })
  mainWindow.on('restore', () => {
    forceWindowRepaint(mainWindow)
  })
  mainWindow.on('maximize', () => mainWindow?.webContents.send('win-maximized-changed', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('win-maximized-changed', false))
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('win-fullscreen-changed', true))
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('win-fullscreen-changed', false))

  // 防止外链意外弹出空白 Electron 子窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 若渲染进程在后台休眠或 GPU 重置后意外崩溃，自动重载恢复，彻底杜绝永久白屏
  mainWindow.webContents.on('render-process-gone', (_ev, details) => {
    if (!isQuitting && details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed() && apiBase) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(apiBase).catch(() => {})
        }
      }, 300)
    }
  })

  mainWindow.webContents.on('did-fail-load', () => {
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed() && apiBase) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(apiBase).catch(() => {})
        }
      }, 600)
    }
  })

  // 点击窗口右上角 × 关闭界面时，彻底退出整个程序并同步销毁后台托盘图标，绝不残留后台进程
  mainWindow.on('close', () => {
    isQuitting = true
    try {
      if (mainWindow?.isFullScreen()) mainWindow.setFullScreen(false)
    } catch {}
    updateRadioPowerSaveBlocker(false)
    destroyTray()
    clearInstancePort()
  })

  mainWindow.on('closed', () => {
    ipcMain.removeListener('renderer-ready', onRendererReady)
    if (fallbackShowTimer) {
      clearTimeout(fallbackShowTimer)
      fallbackShowTimer = null
    }
    mainWindow = null
  })

  mainWindow.loadURL(apiBase).catch(() => {})
  return mainWindow
}

let ipcRegistered = false

async function createApp() {
  const { webDir, libraryDir, iconPath } = resolveResourceDirs()
  cachedIconPath = iconPath
  try {
    const catPath = path.join(libraryDir, 'catalog.json')
    if (fs.existsSync(catPath)) {
      initialCatalogData = JSON.parse(fs.readFileSync(catPath, 'utf8'))
    }
  } catch {
    initialCatalogData = null
  }
  const cacheDir = path.join(app.getPath('userData'), 'tts-cache')
  const started = await startLocalServer(webDir, libraryDir, cacheDir, () => {
    revealMainWindow()
  })
  localServer = started.server
  apiBase = `http://127.0.0.1:${started.port}`
  writeInstancePort(started.port)

  if (!ipcRegistered) {
    ipcRegistered = true
    ipcMain.on('get-api-base', (event) => {
      event.returnValue = apiBase
    })
    ipcMain.on('get-initial-catalog', (event) => {
      event.returnValue = initialCatalogData
    })
    ipcMain.on('set-ui-theme', (_ev, theme) => {
      const hex = writeSavedTheme(theme)
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.setBackgroundColor(hex)
        } catch {}
      }
    })

    ipcMain.on('win-minimize', () => mainWindow?.minimize())
    ipcMain.on('win-maximize', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      else mainWindow.maximize()
    })
    ipcMain.on('win-close', () => mainWindow?.close())
    ipcMain.handle('win-is-maximized', () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false))
    ipcMain.on('win-set-fullscreen', (_ev, flag) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setFullScreen(Boolean(flag))
      }
    })
    ipcMain.on('set-minimize-to-tray', () => {
      // 统一为关闭窗口即彻底退出程序与托盘，忽略旧版残留的最小化托盘偏好
      minimizeToTray = false
    })
    ipcMain.on('set-radio-active', (_ev, active) => {
      updateRadioPowerSaveBlocker(Boolean(active))
    })

    ipcMain.handle('save-image-data-url', async (_ev, { dataUrl, defaultName }) => {
      if (!mainWindow || mainWindow.isDestroyed()) return { ok: false }
      const res = await dialog.showSaveDialog(mainWindow, {
        title: '保存哲学金句藏书票',
        defaultPath: path.join(app.getPath('pictures'), defaultName || 'zheqimingsi-quote.png'),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      })
      if (res.canceled || !res.filePath) return { ok: false }
      const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, '')
      fs.writeFileSync(res.filePath, Buffer.from(b64, 'base64'))
      return { ok: true, path: res.filePath }
    })

    ipcMain.handle('import-local-file', async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return null
      const res = await dialog.showOpenDialog(mainWindow, {
        title: '导入本地哲学文本 (.md / .txt)',
        properties: ['openFile'],
        filters: [{ name: '文本与 Markdown 文档', extensions: ['md', 'markdown', 'txt'] }],
      })
      if (res.canceled || !res.filePaths?.[0]) return null
      const fp = res.filePaths[0]
      return {
        name: path.basename(fp),
        content: fs.readFileSync(fp, 'utf8'),
      }
    })

    ipcMain.on('open-external', (_ev, url) => {
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url)
    })
  }

  createMainWindow()

  // 延迟初始化托盘与旧版本缓存清理，完全不阻塞首帧显现
  setTimeout(() => {
    if (!isQuitting) setupSystemTray(iconPath)
  }, 250)
  setTimeout(() => {
    if (!isQuitting) cleanupOldRuntimeCachesAsync()
  }, 4000)

  // 注册系统级硬件媒体键，后台切歌/暂停电台
  try {
    globalShortcut.register('MediaPlayPause', () => mainWindow?.webContents.send('media-command', 'toggle'))
    globalShortcut.register('MediaNextTrack', () => mainWindow?.webContents.send('media-command', 'next'))
    globalShortcut.register('MediaPreviousTrack', () => mainWindow?.webContents.send('media-command', 'prev'))
  } catch {}
}

if (gotSingleInstanceLock) {
  app
    .whenReady()
    .then(createApp)
    .catch((err) => {
      logDesktopError('createApp', err)
    })
}

app.on('activate', () => {
  revealMainWindow()
})

app.on('before-quit', () => {
  isQuitting = true
  updateRadioPowerSaveBlocker(false)
  destroyTray()
  clearInstancePort()
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  updateRadioPowerSaveBlocker(false)
  clearInstancePort()
  destroyTray()
  if (localServer) {
    try {
      localServer.close()
    } catch {}
    localServer = null
  }
  app.quit()
})
