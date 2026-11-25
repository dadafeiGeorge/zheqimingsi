import type { AiSettings, TranslationEngineId, TranslationSettings } from '../types'
import { askAiOnce } from './aiService'
import { offlineTranslate } from './offlineTranslator'
import { nativeHttpRequest } from './platform'

export interface LanguageOption {
  code: string
  label: string
  nativeLabel: string
  bingCode: string
  googleCode: string
  deeplCode: string
}

export const TRANSLATION_LANGUAGES: LanguageOption[] = [
  { code: 'auto', label: '自动检测', nativeLabel: '自动', bingCode: '', googleCode: 'auto', deeplCode: '' },
  { code: 'zh-CN', label: '简体中文', nativeLabel: '简体中文', bingCode: 'zh-Hans', googleCode: 'zh-CN', deeplCode: 'ZH' },
  { code: 'zh-TW', label: '繁體中文', nativeLabel: '繁體中文', bingCode: 'zh-Hant', googleCode: 'zh-TW', deeplCode: 'ZH' },
  { code: 'en', label: 'English', nativeLabel: 'English', bingCode: 'en', googleCode: 'en', deeplCode: 'EN' },
  { code: 'fr', label: '法语', nativeLabel: 'Français', bingCode: 'fr', googleCode: 'fr', deeplCode: 'FR' },
  { code: 'de', label: '德语', nativeLabel: 'Deutsch', bingCode: 'de', googleCode: 'de', deeplCode: 'DE' },
  { code: 'ja', label: '日语', nativeLabel: '日本語', bingCode: 'ja', googleCode: 'ja', deeplCode: 'JA' },
  { code: 'ko', label: '韩语', nativeLabel: '한국어', bingCode: 'ko', googleCode: 'ko', deeplCode: 'KO' },
  { code: 'ru', label: '俄语', nativeLabel: 'Русский', bingCode: 'ru', googleCode: 'ru', deeplCode: 'RU' },
  { code: 'es', label: '西班牙语', nativeLabel: 'Español', bingCode: 'es', googleCode: 'es', deeplCode: 'ES' },
  { code: 'it', label: '意大利语', nativeLabel: 'Italiano', bingCode: 'it', googleCode: 'it', deeplCode: 'IT' },
  { code: 'el', label: '希腊语', nativeLabel: 'Ελληνικά', bingCode: 'el', googleCode: 'el', deeplCode: 'EL' },
]

export interface TranslationEngineMeta {
  id: TranslationEngineId
  name: string
  shortName: string
  description: string
  needsConfig: boolean
  isOffline?: boolean
}

export const TRANSLATION_ENGINES: TranslationEngineMeta[] = [
  {
    id: 'bing_web',
    name: 'Bing 网页翻译',
    shortName: 'Bing',
    description: '微软 Edge 免费在线神经翻译，国内通常可直连，免密钥即开即用',
    needsConfig: false,
  },
  {
    id: 'google_web',
    name: 'Google 网页翻译',
    shortName: 'Google',
    description: 'Google 网页端神经翻译引擎，多语种覆盖全面，免密钥使用',
    needsConfig: false,
  },
  {
    id: 'azure_api',
    name: 'Microsoft Azure API',
    shortName: 'Azure',
    description: '微软 Azure 认知服务官方翻译接口，需配置 Subscription Key 与区域',
    needsConfig: true,
  },
  {
    id: 'google_api',
    name: 'Google Cloud API',
    shortName: 'GCloud',
    description: 'Google Cloud Translation v2 官方接口，需配置 API Key',
    needsConfig: true,
  },
  {
    id: 'deepl_api',
    name: 'DeepL API',
    shortName: 'DeepL',
    description: '欧洲语言（德/法/英）学术与文学翻译品质出众，支持 Free / Pro Key',
    needsConfig: true,
  },
  {
    id: 'ai',
    name: 'AI',
    shortName: 'AI 翻译',
    description: '调用已配置的 AI 大模型 API 进行上下文感知哲学学术翻译',
    needsConfig: true,
  },
  {
    id: 'offline',
    name: '离线翻译引擎',
    shortName: '离线引擎',
    description: '内置零依赖多语种词句与哲学术语离线引擎（支持断网即译与可选本地服务）',
    needsConfig: false,
    isOffline: true,
  },
]

export interface TranslationResult {
  translatedText: string
  detectedSourceLang?: string
  engine: TranslationEngineId
  engineName: string
  termNotes?: Array<{ source: string; target: string; origin?: string }>
  fromCache?: boolean
}

const translationCache = new Map<string, TranslationResult>()
const MAX_CACHE_ENTRIES = 600

interface BingWebSession {
  origin: string
  referer: string
  ig: string
  iid: string
  key: string
  token: string
  cookies: string
  callCount: number
  expiresAt: number
}

let bingSessionCache: BingWebSession | null = null

const BING_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'

export function getLanguageMeta(code: string): LanguageOption {
  return TRANSLATION_LANGUAGES.find((l) => l.code === code) || TRANSLATION_LANGUAGES[1]
}

export function getEngineMeta(id: TranslationEngineId): TranslationEngineMeta {
  return TRANSLATION_ENGINES.find((e) => e.id === id) || TRANSLATION_ENGINES[0]
}

function setCache(key: string, val: TranslationResult) {
  if (translationCache.size >= MAX_CACHE_ENTRIES) {
    const first = translationCache.keys().next().value
    if (first) translationCache.delete(first)
  }
  translationCache.set(key, val)
}

async function fetchBingWebSession(forceRefresh = false): Promise<BingWebSession> {
  if (!forceRefresh && bingSessionCache && Date.now() < bingSessionCache.expiresAt) {
    return bingSessionCache
  }

  const hosts = ['https://www.bing.com/translator', 'https://cn.bing.com/translator']
  let lastError = '无法连接 Bing 网页翻译页面'

  for (const url of hosts) {
    try {
      const resp = await nativeHttpRequest({
        url,
        method: 'GET',
        headers: {
          'User-Agent': BING_BROWSER_UA,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        timeoutMs: 14000,
      })
      if (!resp.ok || !resp.body) {
        lastError = resp.error || `访问 ${url} 失败 (HTTP ${resp.status})`
        continue
      }
      const html = resp.body
      const igMatch = html.match(/IG:"([^"]+)"/)
      const iidMatch = html.match(/data-iid="([^"]+)"/)
      const paramsMatch = html.match(/params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)"/)
      if (!igMatch?.[1] || !paramsMatch?.[1] || !paramsMatch?.[2]) {
        lastError = '未能解析 Bing 网页翻译会话参数'
        continue
      }
      const finalUrl = resp.finalUrl || url
      let origin = 'https://www.bing.com'
      try {
        origin = new URL(finalUrl).origin
      } catch {}
      const session: BingWebSession = {
        origin,
        referer: finalUrl,
        ig: igMatch[1],
        iid: iidMatch?.[1] || 'translator.5025',
        key: paramsMatch[1],
        token: paramsMatch[2],
        cookies: resp.cookies || '',
        callCount: 0,
        expiresAt: Date.now() + 9 * 60 * 1000,
      }
      bingSessionCache = session
      return session
    } catch (err: any) {
      lastError = err?.message || lastError
    }
  }

  throw new Error(lastError)
}

async function translateViaBingWeb(text: string, sourceLang: string, targetLang: string): Promise<TranslationResult> {
  const toCode = getLanguageMeta(targetLang).bingCode || 'zh-Hans'
  const fromCode = sourceLang && sourceLang !== 'auto' ? getLanguageMeta(sourceLang).bingCode || 'auto-detect' : 'auto-detect'

  let lastErr = 'Bing 网页翻译失败'
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = await fetchBingWebSession(attempt > 0)
    session.callCount += 1
    const form = new URLSearchParams({
      fromLang: fromCode,
      to: toCode,
      text,
      token: session.token,
      key: session.key,
    })
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': BING_BROWSER_UA,
      Referer: session.referer,
      Origin: session.origin,
    }
    if (session.cookies) {
      headers.Cookie = session.cookies
    }

    const endpoint = `${session.origin}/ttranslatev3?isVertical=1&IG=${encodeURIComponent(session.ig)}&IID=${encodeURIComponent(
      `${session.iid}.${session.callCount}`
    )}`
    const resp = await nativeHttpRequest({
      url: endpoint,
      method: 'POST',
      headers,
      body: form.toString(),
      timeoutMs: 18000,
    })

    if (!resp.ok || !resp.body.trim()) {
      bingSessionCache = null
      lastErr = resp.error || `Bing 网页翻译返回异常 (HTTP ${resp.status})`
      continue
    }

    try {
      const json = JSON.parse(resp.body)
      if (json?.statusCode && json.statusCode !== 200) {
        bingSessionCache = null
        lastErr = `Bing 网页翻译受限 (${json.statusCode})`
        continue
      }
      const first = Array.isArray(json) ? json[0] : null
      const translated = first?.translations?.[0]?.text
      if (translated) {
        return {
          translatedText: translated,
          detectedSourceLang: first?.detectedLanguage?.language,
          engine: 'bing_web',
          engineName: 'Bing 网页翻译',
        }
      }
      bingSessionCache = null
      lastErr = 'Bing 网页翻译返回结果为空'
    } catch {
      bingSessionCache = null
      lastErr = 'Bing 网页翻译响应解析失败'
    }
  }

  throw new Error(lastErr)
}

async function translateViaGoogleWeb(text: string, sourceLang: string, targetLang: string): Promise<TranslationResult> {
  const sl = sourceLang && sourceLang !== 'auto' ? getLanguageMeta(sourceLang).googleCode : 'auto'
  const tl = getLanguageMeta(targetLang).googleCode || 'zh-CN'
  const qs = new URLSearchParams({
    client: 'gtx',
    sl,
    tl,
    dt: 't',
    q: text,
  })

  const resp = await nativeHttpRequest({
    url: `https://translate.googleapis.com/translate_a/single?${qs.toString()}`,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    timeoutMs: 18000,
  })
  if (!resp.ok) {
    throw new Error(resp.error || `Google 网页翻译失败 (HTTP ${resp.status}，如无法直连请检查网络代理或切换 Bing/离线引擎)`)
  }
  const json = JSON.parse(resp.body)
  const segs = Array.isArray(json?.[0]) ? json[0] : []
  const translated = segs.map((s: any) => (Array.isArray(s) ? s[0] || '' : '')).join('')
  if (!translated) throw new Error('Google 网页翻译返回为空')
  return {
    translatedText: translated,
    detectedSourceLang: typeof json?.[2] === 'string' ? json[2] : undefined,
    engine: 'google_web',
    engineName: 'Google 网页翻译',
  }
}

async function translateViaAzureApi(
  text: string,
  settings: TranslationSettings
): Promise<TranslationResult> {
  const key = settings.azureKey.trim()
  if (!key) throw new Error('请先在翻译服务配置中填写 Microsoft Azure API Key')
  const region = settings.azureRegion.trim() || 'eastasia'
  const endpoint = (settings.azureEndpoint.trim() || 'https://api.cognitive.microsofttranslator.com').replace(/\/+$/, '')
  const toCode = getLanguageMeta(settings.targetLang).bingCode || 'zh-Hans'
  const fromCode = settings.sourceLang !== 'auto' ? getLanguageMeta(settings.sourceLang).bingCode : ''

  const qs = new URLSearchParams({ 'api-version': '3.0', to: toCode })
  if (fromCode) qs.set('from', fromCode)

  const resp = await nativeHttpRequest({
    url: `${endpoint}/translate?${qs.toString()}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': key,
      'Ocp-Apim-Subscription-Region': region,
    },
    body: JSON.stringify([{ Text: text }]),
    timeoutMs: 20000,
  })
  if (!resp.ok) {
    let msg = resp.error || `Azure API 请求失败 (HTTP ${resp.status})`
    try {
      const ej = JSON.parse(resp.body)
      if (ej?.error?.message) msg = `Azure API: ${ej.error.message}`
    } catch {}
    throw new Error(msg)
  }
  const json = JSON.parse(resp.body)
  const first = Array.isArray(json) ? json[0] : null
  const translated = first?.translations?.[0]?.text
  if (!translated) throw new Error('Microsoft Azure API 返回为空')
  return {
    translatedText: translated,
    detectedSourceLang: first?.detectedLanguage?.language,
    engine: 'azure_api',
    engineName: 'Microsoft Azure API',
  }
}

async function translateViaGoogleCloudApi(
  text: string,
  settings: TranslationSettings
): Promise<TranslationResult> {
  const key = settings.googleApiKey.trim()
  if (!key) throw new Error('请先在翻译服务配置中填写 Google Cloud API Key')
  const target = getLanguageMeta(settings.targetLang).googleCode || 'zh-CN'
  const source = settings.sourceLang !== 'auto' ? getLanguageMeta(settings.sourceLang).googleCode : undefined

  const resp = await nativeHttpRequest({
    url: `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      target,
      ...(source ? { source } : {}),
      format: 'text',
    }),
    timeoutMs: 20000,
  })
  if (!resp.ok) {
    let msg = resp.error || `Google Cloud API 失败 (HTTP ${resp.status})`
    try {
      const ej = JSON.parse(resp.body)
      if (ej?.error?.message) msg = `Google Cloud API: ${ej.error.message}`
    } catch {}
    throw new Error(msg)
  }
  const json = JSON.parse(resp.body)
  const item = json?.data?.translations?.[0]
  const translated = item?.translatedText
  if (!translated) throw new Error('Google Cloud API 返回为空')
  return {
    translatedText: translated,
    detectedSourceLang: item?.detectedSourceLanguage,
    engine: 'google_api',
    engineName: 'Google Cloud API',
  }
}

async function translateViaDeepLApi(
  text: string,
  settings: TranslationSettings
): Promise<TranslationResult> {
  const key = settings.deeplApiKey.trim()
  if (!key) throw new Error('请先在翻译服务配置中填写 DeepL API Key')
  const isFree = settings.deeplPlan === 'free' || key.endsWith(':fx')
  const host = isFree ? 'https://api-free.deepl.com' : 'https://api.deepl.com'
  const targetLang = getLanguageMeta(settings.targetLang).deeplCode || 'ZH'
  const sourceLang = settings.sourceLang !== 'auto' ? getLanguageMeta(settings.sourceLang).deeplCode : undefined

  const resp = await nativeHttpRequest({
    url: `${host}/v2/translate`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `DeepL-Auth-Key ${key}`,
    },
    body: JSON.stringify({
      text: [text],
      target_lang: targetLang,
      ...(sourceLang ? { source_lang: sourceLang } : {}),
    }),
    timeoutMs: 20000,
  })
  if (!resp.ok) {
    let msg = resp.error || `DeepL API 请求失败 (HTTP ${resp.status})`
    try {
      const ej = JSON.parse(resp.body)
      if (ej?.message) msg = `DeepL API: ${ej.message}`
    } catch {}
    throw new Error(msg)
  }
  const json = JSON.parse(resp.body)
  const item = json?.translations?.[0]
  if (!item?.text) throw new Error('DeepL API 返回为空')
  return {
    translatedText: item.text,
    detectedSourceLang: item.detected_source_language,
    engine: 'deepl_api',
    engineName: 'DeepL API',
  }
}

async function translateViaAi(
  text: string,
  settings: TranslationSettings,
  aiSettings: AiSettings
): Promise<TranslationResult> {
  const targetMeta = getLanguageMeta(settings.targetLang)
  const sourceMeta = settings.sourceLang !== 'auto' ? getLanguageMeta(settings.sourceLang) : null
  const prompt = sourceMeta
    ? `请将以下${sourceMeta.label}文本准确、流畅地翻译为${targetMeta.label}。保留学术与哲学概念的精确性，只输出译文，不要附加解释或前后缀：\n\n${text}`
    : `请将以下文本准确、流畅地翻译为${targetMeta.label}。保留学术与哲学概念的精确性，只输出译文，不要附加解释或前后缀：\n\n${text}`

  const translated = await askAiOnce(
    { ...aiSettings, temperature: 0.2 },
    [
      {
        role: 'system',
        content: '你是专业的人文哲学与多语种翻译引擎，只输出忠实、通顺的译文，不输出多余解释。',
      },
      { role: 'user', content: prompt },
    ],
    45000
  )
  return {
    translatedText: translated.trim(),
    engine: 'ai',
    engineName: `AI (${aiSettings.model || 'API'})`,
  }
}

/**
 * 统一翻译入口：支持 6 大在线引擎 + 1 个内置离线引擎，自带缓存
 */
export async function translateText(
  rawText: string,
  settings: TranslationSettings,
  aiSettings: AiSettings,
  overrideEngine?: TranslationEngineId
): Promise<TranslationResult> {
  const text = rawText.trim()
  if (!text) {
    return {
      translatedText: '',
      engine: overrideEngine || settings.activeEngine,
      engineName: getEngineMeta(overrideEngine || settings.activeEngine).name,
    }
  }

  const engine = overrideEngine || settings.activeEngine
  const cacheKey = `${engine}|${settings.sourceLang}|${settings.targetLang}|${text}`
  const cached = translationCache.get(cacheKey)
  if (cached) {
    return { ...cached, fromCache: true }
  }

  let result: TranslationResult
  switch (engine) {
    case 'bing_web':
      result = await translateViaBingWeb(text, settings.sourceLang, settings.targetLang)
      break
    case 'google_web':
      result = await translateViaGoogleWeb(text, settings.sourceLang, settings.targetLang)
      break
    case 'azure_api':
      result = await translateViaAzureApi(text, settings)
      break
    case 'google_api':
      result = await translateViaGoogleCloudApi(text, settings)
      break
    case 'deepl_api':
      result = await translateViaDeepLApi(text, settings)
      break
    case 'ai':
      result = await translateViaAi(text, settings, aiSettings)
      break
    case 'offline':
    default:
      result = await offlineTranslate(text, settings)
      break
  }

  setCache(cacheKey, result)
  return result
}

export function clearTranslationCache() {
  translationCache.clear()
}
