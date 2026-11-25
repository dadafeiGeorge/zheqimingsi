/**
 * tts-engine.mjs — 内置微软神经网络语音合成引擎
 * 1. 默认免密钥直连微软 Edge Read Aloud Neural TTS（Sec-MS-GEC v2 + 原生 WebSocket）
 * 2. 可选支持用户自定义 Azure Speech Subscription Key（高并发直连 Azure 语音终结点）
 * 3. 内置本地磁盘 LRU MP3 音频缓存，重播零延迟
 */
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const DEFAULT_VOICE = 'zh-CN-YunyangNeural'

const TRUSTED = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const GEC_VERSION = '2-143.0.3650.96'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0'
const COPY = 'Copyright (C) Microsoft Corporation. All rights reserved.'
const HOST = 'speech.platform.bing.com'
const BASE = '/consumer/speech/synthesize/readaloud'

/* ---------------- Sec-MS-GEC v2 令牌 ---------------- */
const SW1 = [0xef0569fb, 0x76f50f34, 0xc3efea97]
const SW2 = [0xc31713db, 0x1881ce3c, 0x35bd1ec9]
const MIX1 = [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83]
const MIX2 = [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69]
const imul = Math.imul
const swap16 = (v) => ((v << 16) | (v >>> 16)) >>> 0

function swapTerm(word, key, m) {
  const sum = (imul(word, key) + imul(swap16(word), m[0])) >>> 0
  const product = imul(swap16(sum), m[1]) >>> 0
  return (imul(swap16(product), m[2]) + product) >>> 0
}
function mixStep(value, list) {
  for (const k of list) value = imul(swap16(value), k) >>> 0
  return value
}
function cs64(msg, digest) {
  const k1 = (digest.readUInt32LE(0) | 1) >>> 0
  const k2 = (digest.readUInt32LE(4) | 1) >>> 0
  const padded = Buffer.alloc(Math.ceil(msg.length / 8) * 8)
  msg.copy(padded)
  let swapSum = 0
  let lastSwap = 0
  let mix = 0
  let mixSum = 0
  for (let o = 0; o < padded.length; o += 8) {
    const w1 = padded.readUInt32LE(o)
    const w2 = padded.readUInt32LE(o + 4)
    const first = swapTerm(w1, k1, SW1)
    lastSwap = swapTerm(w2, k2, SW2)
    swapSum = (swapSum + first + lastSwap) >>> 0
    mix = mixStep(imul(mix + w1, k1) >>> 0, MIX1)
    mixSum = (mixSum + mix) >>> 0
    mix = mixStep(imul(mix + w2, k2) >>> 0, MIX2)
    mixSum = (mixSum + mix) >>> 0
  }
  const out = Buffer.alloc(8)
  out.writeUInt32LE((lastSwap ^ mix) >>> 0, 0)
  out.writeUInt32LE((swapSum ^ mixSum) >>> 0, 4)
  return out
}

function secMsGec(ts = Date.now() / 1000) {
  let ticks = Math.floor(ts) + 11644473600
  ticks -= ticks % 300
  const msg = Buffer.from(COPY + String(ticks * 10000000) + TRUSTED, 'utf8')
  const digest = crypto.createHash('sha256').update(msg).digest()
  return cs64(msg, digest).toString('hex').toUpperCase() + '-' + digest.toString('hex').toUpperCase()
}

function wsFrame(opcode, payload) {
  const len = payload.length
  let head
  if (len < 126) {
    head = Buffer.alloc(6)
    head[1] = 0x80 | len
  } else if (len < 65536) {
    head = Buffer.alloc(8)
    head[1] = 0x80 | 126
    head.writeUInt16BE(len, 2)
  } else {
    head = Buffer.alloc(14)
    head[1] = 0x80 | 127
    head.writeBigUInt64BE(BigInt(len), 2)
  }
  head[0] = 0x80 | opcode
  const mask = crypto.randomBytes(4)
  mask.copy(head, head.length - 4)
  const body = Buffer.from(payload)
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4]
  return Buffer.concat([head, body])
}

function connectEdgeWs(timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const qs =
      'TrustedClientToken=' +
      TRUSTED +
      '&Sec-MS-GEC=' +
      encodeURIComponent(secMsGec()) +
      '&Sec-MS-GEC-Version=' +
      GEC_VERSION +
      '&ConnectionId=' +
      crypto.randomUUID().replace(/-/g, '')
    const req = https.request({
      host: HOST,
      port: 443,
      path: BASE + '/edge/v1?' + qs,
      method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': UA,
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Cookie: 'muid=' + crypto.randomBytes(16).toString('hex').toUpperCase() + ';',
      },
    })
    const timer = setTimeout(() => {
      try {
        req.destroy()
      } catch {}
      reject(new Error('微软语音服务器连接超时'))
    }, timeoutMs)
    req.on('upgrade', (_res, socket) => {
      clearTimeout(timer)
      if (typeof socket.setNoDelay === 'function') socket.setNoDelay(true)
      resolve(socket)
    })
    req.on('response', (res) => {
      clearTimeout(timer)
      let body = ''
      res.on('data', (d) => (body += d))
      res.on('end', () => reject(new Error(`微软语音服务响应 ${res.statusCode}`)))
    })
    req.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    req.end()
  })
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatRate(v) {
  if (v === undefined || v === null || v === '') return '+0%'
  if (typeof v === 'string' && /^[+-]?\d+(\.\d+)?%$/.test(v.trim())) {
    const s = v.trim()
    return s.startsWith('+') || s.startsWith('-') ? s : '+' + s
  }
  const n = Number(v)
  if (!isFinite(n)) return '+0%'
  const pct = Math.max(-50, Math.min(100, Math.round((n - 1) * 100)))
  return (pct >= 0 ? '+' : '') + pct + '%'
}

function formatPitch(v) {
  if (!v) return '+0Hz'
  const s = String(v).trim()
  if (/^[+-]?\d+(\.\d+)?(Hz|%)$/i.test(s)) {
    return s.startsWith('+') || s.startsWith('-') ? s : '+' + s
  }
  const n = Number(s)
  if (!isFinite(n)) return '+0Hz'
  return (n >= 0 ? '+' : '') + Math.round(n) + 'Hz'
}

/** 可选：使用用户提供的 Azure Speech 密钥直接合成 */
function synthesizeAzureKey({ text, voice, rate, pitch, azureKey, azureRegion }) {
  return new Promise((resolve, reject) => {
    const region = (azureRegion || 'eastasia').trim()
    const ssml =
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
      `<voice name='${voice}'><prosody rate='${rate}' pitch='${pitch}'>${xmlEscape(text)}</prosody></voice></speak>`
    const body = Buffer.from(ssml, 'utf8')
    const req = https.request(
      {
        host: `${region}.tts.speech.microsoft.com`,
        port: 443,
        path: '/cognitiveservices/v1',
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'User-Agent': 'LumenPhilosophyReader/1.0',
          'Content-Length': body.length,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (d) => chunks.push(d))
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Azure TTS HTTP ${res.statusCode}`))
          } else {
            resolve(Buffer.concat(chunks))
          }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(25000, () => {
      req.destroy()
      reject(new Error('Azure TTS 超时'))
    })
    req.write(body)
    req.end()
  })
}

async function synthesizeEdge({ text, voice, rate, pitch }) {
  const socket = await connectEdgeWs(12000)
  const reqId = crypto.randomUUID().replace(/-/g, '')
  const stamp = new Date().toUTCString()
  const ssml =
    `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp}\r\nPath:ssml\r\n\r\n` +
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
    `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${xmlEscape(text)}</prosody></voice></speak>`

  const config =
    `X-Timestamp:${stamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
    `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`

  return new Promise((resolve, reject) => {
    const chunks = []
    let pending = Buffer.alloc(0)
    let settled = false
    const timeout = setTimeout(() => finish(new Error('微软语音合成超时')), 28000)

    function finish(err) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try {
        socket.destroy()
      } catch {}
      if (err) reject(err)
      else resolve(Buffer.concat(chunks))
    }

    socket.on('error', (e) => finish(e))
    socket.on('close', () => {
      if (!settled) finish(chunks.length ? null : new Error('语音连接提前关闭'))
    })

    socket.write(wsFrame(0x1, Buffer.from(config, 'utf8')))
    socket.write(wsFrame(0x1, Buffer.from(ssml, 'utf8')))

    socket.on('data', (chunk) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
      while (pending.length >= 2) {
        const op = pending[0] & 0x0f
        let len = pending[1] & 0x7f
        let off = 2
        if (len === 126) {
          if (pending.length < 4) return
          len = pending.readUInt16BE(2)
          off = 4
        } else if (len === 127) {
          if (pending.length < 10) return
          len = Number(pending.readBigUInt64BE(2))
          off = 10
        }
        if (pending.length < off + len) return
        const payload = pending.subarray(off, off + len)
        pending = pending.subarray(off + len)
        if (op === 0x8) {
          finish(chunks.length ? null : new Error('语音流结束无数据'))
          return
        }
        if (op === 0x9) {
          try {
            socket.write(wsFrame(0xa, payload))
          } catch {}
          continue
        }
        if (op !== 0x1 && op !== 0x2) continue
        const head = payload.toString('latin1', 0, Math.min(payload.length, 256))
        if (head.includes('Path:turn.end')) {
          finish(chunks.length ? null : new Error('未收到语音音频'))
          return
        }
        if (head.includes('Path:audio')) {
          const idx = payload.indexOf('Path:audio\r\n')
          if (idx >= 0) chunks.push(payload.subarray(idx + 12))
        }
      }
    })
  })
}

const inflightSynthesize = new Map()

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function trimDiskCacheIfNeeded(cacheDir) {
  try {
    const files = fs
      .readdirSync(cacheDir)
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => {
        const fp = path.join(cacheDir, f)
        const st = fs.statSync(fp)
        return { fp, size: st.size, mtime: st.mtimeMs }
      })
    const total = files.reduce((acc, f) => acc + f.size, 0)
    if (total < 150 * 1024 * 1024) return
    files.sort((a, b) => a.mtime - b.mtime)
    let cur = total
    for (const f of files) {
      if (cur < 100 * 1024 * 1024) break
      try {
        fs.unlinkSync(f.fp)
        cur -= f.size
      } catch {}
    }
  } catch {}
}

export async function synthesizeWithCache(opts, cacheDir) {
  const text = String(opts.text || '').trim()
  if (!text) throw new Error('文本为空')
  const voice = opts.voice || DEFAULT_VOICE
  const rate = formatRate(opts.rate)
  const pitch = formatPitch(opts.pitch)
  const forceRefresh = Boolean(opts.forceRefresh)

  const hash = crypto
    .createHash('sha256')
    .update(`${voice}|${rate}|${pitch}|${text}`)
    .digest('hex')
    .slice(0, 32)

  let cacheFile = null
  if (cacheDir) {
    fs.mkdirSync(cacheDir, { recursive: true })
    cacheFile = path.join(cacheDir, `${hash}.mp3`)
    if (!forceRefresh && fs.existsSync(cacheFile)) {
      try {
        const stat = fs.statSync(cacheFile)
        if (stat.size > 256) {
          return fs.readFileSync(cacheFile)
        }
        fs.unlinkSync(cacheFile)
      } catch {}
    } else if (forceRefresh && fs.existsSync(cacheFile)) {
      try {
        fs.unlinkSync(cacheFile)
      } catch {}
    }
  }

  // 同文本并发合成去重：防止预取与当前播放同时向微软发起重复请求或并发写坏缓存文件
  const inflightKey = `${hash}|${opts.azureKey ? 'az' : 'edge'}`
  if (!forceRefresh && inflightSynthesize.has(inflightKey)) {
    return inflightSynthesize.get(inflightKey)
  }

  const task = (async () => {
    let audioBuf
    if (opts.azureKey) {
      let lastErr
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          audioBuf = await synthesizeAzureKey({
            text,
            voice,
            rate,
            pitch,
            azureKey: opts.azureKey,
            azureRegion: opts.azureRegion,
          })
          if (audioBuf && audioBuf.length > 256) break
        } catch (e) {
          lastErr = e
          if (attempt === 0) await sleepMs(350)
        }
      }
      if (!audioBuf || audioBuf.length <= 256) {
        throw lastErr || new Error('Azure TTS 返回空音频')
      }
    } else {
      // 最多自动重试 3 次（含退避），彻底抵御微软 Edge WebSocket 瞬时抖动与断流
      let lastErr
      const backoffs = [320, 850]
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          audioBuf = await synthesizeEdge({ text, voice, rate, pitch })
          if (audioBuf && audioBuf.length > 256) break
          lastErr = new Error('微软语音返回空音频')
        } catch (e) {
          lastErr = e
        }
        if (attempt < backoffs.length) {
          await sleepMs(backoffs[attempt])
        }
      }
      if (!audioBuf || audioBuf.length <= 256) {
        throw lastErr || new Error('微软语音合成失败')
      }
    }

    if (cacheFile && audioBuf && audioBuf.length > 256) {
      const tmpFile = path.join(cacheDir, `${hash}.${crypto.randomBytes(4).toString('hex')}.tmp`)
      try {
        fs.writeFileSync(tmpFile, audioBuf)
        fs.renameSync(tmpFile, cacheFile)
        trimDiskCacheIfNeeded(cacheDir)
      } catch {
        try {
          if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
        } catch {}
      }
    }
    return audioBuf
  })().finally(() => {
    inflightSynthesize.delete(inflightKey)
  })

  inflightSynthesize.set(inflightKey, task)
  return task
}
