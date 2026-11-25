import type { AiProtocol, AiProviderPresetId, AiSettings } from '../types'
import { nativeHttpRequest, nativeHttpStream } from './platform'

export interface AiProviderPreset {
  id: AiProviderPresetId
  name: string
  protocol: AiProtocol
  baseUrl: string
  defaultModel: string
  suggestedModels: string[]
  hint: string
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
    hint: '高性价比中文与学术哲学理解模型，兼容 OpenAI 接口',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o3-mini'],
    hint: 'OpenAI 官方接口（也支持各类中转代理 Base URL）',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    suggestedModels: [
      'Qwen/Qwen2.5-72B-Instruct',
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'THUDM/glm-4-9b-chat',
    ],
    hint: '国内直连稳定，支持 Qwen / DeepSeek / GLM 等开源大模型',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    hint: 'Google AI Studio 官方 Gemini API（填入 AIza... 密钥）',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-7-sonnet-latest',
    suggestedModels: ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
    hint: '深度长文本与人文哲学思辨能力出色',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-chat',
    suggestedModels: [
      'deepseek/deepseek-chat',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-2.5-flash',
      'openai/gpt-4o-mini',
    ],
    hint: '一站式聚合全球主流大模型 API',
  },
  {
    id: 'ollama',
    name: '本地 Ollama (离线)',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5:7b',
    suggestedModels: ['qwen2.5:7b', 'deepseek-r1:8b', 'llama3.1:8b', 'gemma2:9b'],
    hint: '完全本地离线运行，无需 API Key（需本机或局域网运行 Ollama）',
  },
  {
    id: 'custom',
    name: '自定义 API 接口',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: [],
    hint: '支持任何 OpenAI 兼容 / OneAPI / NewAPI / 阿里云百炼 / 智谱 / Kimi 等接口',
  },
]

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function trimTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function buildOpenAiChatUrl(baseUrl: string): string {
  const clean = trimTrailingSlash(baseUrl)
  if (!clean) return 'https://api.openai.com/v1/chat/completions'
  if (/\/chat\/completions$/i.test(clean)) return clean
  return `${clean}/chat/completions`
}

function buildOpenAiModelsUrl(baseUrl: string): string {
  const clean = trimTrailingSlash(baseUrl)
  if (/\/chat\/completions$/i.test(clean)) {
    return clean.replace(/\/chat\/completions$/i, '/models')
  }
  return `${clean}/models`
}

function buildAnthropicUrl(baseUrl: string): string {
  const clean = trimTrailingSlash(baseUrl || 'https://api.anthropic.com/v1')
  if (/\/messages$/i.test(clean)) return clean
  return `${clean}/messages`
}

function buildGeminiUrl(baseUrl: string, model: string, apiKey: string, stream: boolean): string {
  const clean = trimTrailingSlash(baseUrl || 'https://generativelanguage.googleapis.com/v1beta')
  const action = stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?'
  return `${clean}/models/${encodeURIComponent(model)}:${action}key=${encodeURIComponent(apiKey)}`
}

function requireAiConfig(settings: AiSettings) {
  if (!settings.baseUrl.trim()) {
    throw new Error('请先在 AI 设置中填写 API 接口地址（Base URL）')
  }
  if (!settings.model.trim()) {
    throw new Error('请先在 AI 设置中填写模型名称（Model）')
  }
  if (settings.preset !== 'ollama' && !settings.apiKey.trim()) {
    throw new Error('请先在 AI 设置中填写 API Key')
  }
}

function resolveEffectiveMaxTokens(settings: AiSettings): number | undefined {
  // 默认或显式开启无上限时，不限制输出 Token
  if (settings.unlimitedOutput !== false) return undefined
  const n = Number(settings.maxTokens)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

function buildRequestSpec(settings: AiSettings, messages: ChatTurn[], stream: boolean) {
  requireAiConfig(settings)
  const systemMsg = messages.find((m) => m.role === 'system')?.content || settings.systemPrompt || ''
  const nonSystem = messages.filter((m) => m.role !== 'system')
  const explicitMaxTokens = resolveEffectiveMaxTokens(settings)

  if (settings.protocol === 'anthropic') {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey.trim(),
      'anthropic-version': '2023-06-01',
    }
    // Anthropic Messages API 协议必填 max_tokens：无上限模式下按模型代际自动给足最大原生上限
    const modelLower = settings.model.trim().toLowerCase()
    const anthropicMax =
      explicitMaxTokens ??
      (modelLower.includes('3-7') || modelLower.includes('3.7') || modelLower.includes('4') ? 64000 : 8192)
    const body = JSON.stringify({
      model: settings.model.trim(),
      max_tokens: anthropicMax,
      temperature: settings.temperature ?? 0.7,
      system: systemMsg || undefined,
      stream,
      messages: nonSystem.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    })
    return { url: buildAnthropicUrl(settings.baseUrl), headers, body }
  }

  if (settings.protocol === 'gemini') {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const generationConfig: Record<string, unknown> = {
      temperature: settings.temperature ?? 0.7,
    }
    if (explicitMaxTokens !== undefined) {
      generationConfig.maxOutputTokens = explicitMaxTokens
    }
    const body = JSON.stringify({
      systemInstruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
      contents: nonSystem.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig,
    })
    return {
      url: buildGeminiUrl(settings.baseUrl, settings.model.trim(), settings.apiKey.trim(), stream),
      headers,
      body,
    }
  }

  // OpenAI 兼容协议（默认）：无上限时不传 max_tokens，完全由模型自由输出
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`
  }
  const fullMsgs: ChatTurn[] = []
  if (systemMsg) fullMsgs.push({ role: 'system', content: systemMsg })
  fullMsgs.push(...nonSystem)

  const payload: Record<string, unknown> = {
    model: settings.model.trim(),
    messages: fullMsgs,
    temperature: settings.temperature ?? 0.7,
    stream,
  }
  if (explicitMaxTokens !== undefined) {
    payload.max_tokens = explicitMaxTokens
  }
  const body = JSON.stringify(payload)
  return { url: buildOpenAiChatUrl(settings.baseUrl), headers, body }
}

function extractDeltaFromSseJson(protocol: AiProtocol, json: any): string {
  if (!json) return ''
  if (protocol === 'anthropic') {
    if (json.type === 'content_block_delta' && json.delta?.text) {
      return String(json.delta.text)
    }
    return ''
  }
  if (protocol === 'gemini') {
    const parts = json.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) {
      return parts.map((p: any) => p?.text || '').join('')
    }
    return ''
  }
  // OpenAI & DeepSeek（兼容 reasoning_content 深度思考与 content）
  const delta = json.choices?.[0]?.delta
  if (!delta) return ''
  if (typeof delta.content === 'string' && delta.content.length > 0) {
    return delta.content
  }
  return ''
}

function extractFullTextFromJson(protocol: AiProtocol, json: any): string {
  if (!json) return ''
  if (protocol === 'anthropic') {
    const arr = json.content
    if (Array.isArray(arr)) {
      return arr.map((c: any) => c?.text || '').join('').trim()
    }
    return ''
  }
  if (protocol === 'gemini') {
    const parts = json.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) {
      return parts.map((p: any) => p?.text || '').join('').trim()
    }
    return ''
  }
  const msg = json.choices?.[0]?.message
  if (typeof msg?.content === 'string') return msg.content.trim()
  if (Array.isArray(msg?.content)) {
    return msg.content.map((c: any) => c?.text || '').join('').trim()
  }
  return ''
}

/**
 * 流式对话接口：实时推送增量文本，支持取消（AbortSignal）
 */
export async function streamAiChat(
  settings: AiSettings,
  messages: ChatTurn[],
  callbacks: {
    onDelta: (delta: string, fullText: string) => void
    signal?: AbortSignal
  }
): Promise<string> {
  const spec = buildRequestSpec(settings, messages, true)
  let buffer = ''
  let fullText = ''
  let rawCollected = ''

  await nativeHttpStream(
    {
      url: spec.url,
      method: 'POST',
      headers: spec.headers,
      body: spec.body,
    },
    {
      signal: callbacks.signal,
      onChunk: (chunk) => {
        rawCollected += chunk
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith(':')) continue
          if (trimmed.startsWith('data:')) {
            const payload = trimmed.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            try {
              const parsed = JSON.parse(payload)
              const delta = extractDeltaFromSseJson(settings.protocol, parsed)
              if (delta) {
                fullText += delta
                callbacks.onDelta(delta, fullText)
              }
            } catch {}
          }
        }
      },
    }
  )

  // 若服务端未按 SSE 返回而是直接返回完整 JSON，则兜底解析
  if (!fullText && rawCollected.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawCollected.trim())
      if (parsed.error?.message) {
        throw new Error(parsed.error.message)
      }
      const extracted = extractFullTextFromJson(settings.protocol, parsed)
      if (extracted) {
        fullText = extracted
        callbacks.onDelta(extracted, fullText)
      }
    } catch (e) {
      if (e instanceof Error && !e.message.includes('JSON')) throw e
    }
  }

  return fullText
}

/**
 * 单次非流式问答（供 AI 翻译、AI 辅助批注、连通性测试使用）
 */
export async function askAiOnce(
  settings: AiSettings,
  messages: ChatTurn[],
  timeoutMs = 45000
): Promise<string> {
  const spec = buildRequestSpec(settings, messages, false)
  const resp = await nativeHttpRequest({
    url: spec.url,
    method: 'POST',
    headers: spec.headers,
    body: spec.body,
    timeoutMs,
  })
  if (!resp.ok) {
    let detail = resp.error || `HTTP ${resp.status}`
    try {
      const errJson = JSON.parse(resp.body)
      detail = errJson?.error?.message || errJson?.message || detail
    } catch {
      if (resp.body) detail = `${detail}: ${resp.body.slice(0, 180)}`
    }
    throw new Error(detail)
  }
  const json = JSON.parse(resp.body)
  const text = extractFullTextFromJson(settings.protocol, json)
  if (!text) throw new Error('AI 接口返回为空，请检查模型名称与配额')
  return text
}

/**
 * 测试 AI API 连接并返回延迟
 */
export async function testAiConnection(settings: AiSettings): Promise<{ ok: boolean; latencyMs: number; reply: string }> {
  const t0 = performance.now()
  const reply = await askAiOnce(
    { ...settings, unlimitedOutput: false, maxTokens: 32, temperature: 0 },
    [
      { role: 'system', content: '请只回复“连接正常”四个字。' },
      { role: 'user', content: '测试连接' },
    ],
    20000
  )
  return {
    ok: true,
    latencyMs: Math.round(performance.now() - t0),
    reply,
  }
}

/**
 * 自动从远程 API 拉取可用模型列表（支持 OpenAI 兼容 / Gemini）
 */
export async function fetchAvailableModels(settings: AiSettings): Promise<string[]> {
  if (!settings.baseUrl.trim()) throw new Error('请先填写 API 接口地址')

  if (settings.protocol === 'gemini') {
    if (!settings.apiKey.trim()) throw new Error('请先填写 Gemini API Key')
    const url = `${trimTrailingSlash(settings.baseUrl)}/models?key=${encodeURIComponent(settings.apiKey.trim())}`
    const resp = await nativeHttpRequest({ url, method: 'GET', timeoutMs: 15000 })
    if (!resp.ok) throw new Error(resp.error || `拉取模型失败 (HTTP ${resp.status})`)
    const data = JSON.parse(resp.body)
    return (data.models || [])
      .map((m: any) => String(m.name || '').replace(/^models\//, ''))
      .filter((n: string) => n.includes('gemini'))
      .slice(0, 40)
  }

  if (settings.protocol === 'anthropic') {
    return AI_PROVIDER_PRESETS.find((p) => p.id === 'anthropic')?.suggestedModels || []
  }

  const headers: Record<string, string> = {}
  if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`
  }
  const resp = await nativeHttpRequest({
    url: buildOpenAiModelsUrl(settings.baseUrl),
    method: 'GET',
    headers,
    timeoutMs: 15000,
  })
  if (!resp.ok) {
    throw new Error(resp.error || `拉取模型列表失败 (HTTP ${resp.status})`)
  }
  const data = JSON.parse(resp.body)
  const list: string[] = Array.isArray(data?.data)
    ? data.data.map((m: any) => String(m.id || '')).filter(Boolean)
    : Array.isArray(data?.models)
    ? data.models.map((m: any) => String(m.name || m.id || '')).filter(Boolean)
    : []
  return Array.from(new Set(list)).sort().slice(0, 80)
}
