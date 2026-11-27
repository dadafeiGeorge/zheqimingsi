import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  BookmarkPlus,
  Check,
  Copy,
  Languages,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import type { AiConversation, AiMessage, AiSettings } from '../types'
import { streamAiChat, type ChatTurn } from '../services/aiService'
import { notifyToast, registerBackHandler, triggerHaptic } from '../services/platform'

export interface AiReadingContext {
  bookId?: string
  bookTitle?: string
  author?: string
  chapterIndex?: number
  chapterTitle?: string
  selectedText?: string
}

interface AiAssistantPanelProps {
  variant: 'page' | 'drawer'
  aiSettings: AiSettings
  conversations: AiConversation[]
  onSaveConversations: (next: AiConversation[]) => void
  readingContext?: AiReadingContext | null
  onClearQuote?: () => void
  onOpenAiSettings: () => void
  onOpenTranslationSettings?: () => void
  onSaveAsNote?: (content: string, quoteText?: string) => void
  onClose?: () => void
}

const QUICK_PROMPTS_WITH_QUOTE = [
  { label: '深度解读', prompt: '请深度解读这段话的哲学含义、核心概念及其在哲学史中的意义。' },
  { label: '翻译并解析', prompt: '请将这段内容准确翻译为流畅中文，并逐一解析其中关键术语的原词与学术意涵。' },
  { label: '提炼论点', prompt: '请用清晰的结构化要点提炼这段话的核心论点、前提假设与论证逻辑。' },
  { label: '批判追问', prompt: '请对这段论述提出 2-3 个有深度的批判性思考问题，并指出可对照阅读的哲学家观点。' },
]

const QUICK_PROMPTS_GENERAL = [
  { label: '康德先验哲学', prompt: '请用通俗且严谨的方式梳理康德《纯粹理性批判》中“先验感性论”与“先验逻辑”的核心区别。' },
  { label: '黑格尔扬弃', prompt: '黑格尔哲学中的“扬弃（Aufhebung）”包含哪三重含义？请结合辩证法举例说明。' },
  { label: '海德格尔此在', prompt: '如何理解海德格尔《存在与时间》中的“此在（Dasein）”与“在世界之中存在”？' },
  { label: '马克思异化劳动', prompt: '请梳理马克思《1844年经济学哲学手稿》中异化劳动的四重规定。' },
]

/** 轻量安全的 Markdown 段落渲染（粗体、斜体、行内代码、标题、列表、引用、代码块） */
function renderSimpleMarkdown(md: string): string {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const codeBlocks: string[] = []
  let s = escaped.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    const idx = codeBlocks.length
    codeBlocks.push(
      `<pre class="my-2 p-2.5 rounded-xl overflow-x-auto text-[11px] font-mono leading-relaxed" style="background:var(--bg);border:1px solid var(--border)"><code>${code.trimEnd()}</code></pre>`
    )
    return `⟦CODE_${idx}⟧`
  })

  const lines = s.split('\n')
  const htmlLines: string[] = []
  let inList = false

  const formatInline = (line: string) =>
    line
      .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded text-[0.9em] font-mono" style="background:var(--bg)">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line.trim()) {
      if (inList) {
        htmlLines.push('</ul>')
        inList = false
      }
      htmlLines.push('<div class="h-1.5"></div>')
      continue
    }
    if (/^⟦CODE_\d+⟧$/.test(line.trim())) {
      if (inList) {
        htmlLines.push('</ul>')
        inList = false
      }
      htmlLines.push(line.trim())
      continue
    }
    const hMatch = line.match(/^(#{1,4})\s+(.+)$/)
    if (hMatch) {
      if (inList) {
        htmlLines.push('</ul>')
        inList = false
      }
      htmlLines.push(`<div class="font-bold mt-2 mb-1 text-[1.03em]" style="color:var(--accent)">${formatInline(hMatch[2])}</div>`)
      continue
    }
    if (line.startsWith('&gt; ')) {
      if (inList) {
        htmlLines.push('</ul>')
        inList = false
      }
      htmlLines.push(
        `<blockquote class="my-1.5 pl-2.5 border-l-2 opacity-90" style="border-color:var(--accent)">${formatInline(line.slice(5))}</blockquote>`
      )
      continue
    }
    const liMatch = line.match(/^(?:[-*•]|\d+\.)\s+(.+)$/)
    if (liMatch) {
      if (!inList) {
        htmlLines.push('<ul class="list-disc pl-4 my-1 space-y-1">')
        inList = true
      }
      htmlLines.push(`<li>${formatInline(liMatch[1])}</li>`)
      continue
    }
    if (inList) {
      htmlLines.push('</ul>')
      inList = false
    }
    htmlLines.push(`<p class="my-0.5 leading-relaxed">${formatInline(line)}</p>`)
  }
  if (inList) htmlLines.push('</ul>')

  let out = htmlLines.join('')
  codeBlocks.forEach((blk, idx) => {
    out = out.replace(`⟦CODE_${idx}⟧`, blk)
  })
  return out
}

export const AiAssistantPanel: React.FC<AiAssistantPanelProps> = ({
  variant,
  aiSettings,
  conversations,
  onSaveConversations,
  readingContext,
  onClearQuote,
  onOpenAiSettings,
  onOpenTranslationSettings,
  onSaveAsNote,
  onClose,
}) => {
  const [activeConvId, setActiveConvId] = useState<string>(() => conversations[0]?.id || '')
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showHistoryMobile, setShowHistoryMobile] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeConvId) || conversations[0] || null,
    [conversations, activeConvId]
  )

  const messages = activeConv?.messages || []
  const isConfigured = Boolean(aiSettings.apiKey.trim() || aiSettings.preset === 'ollama')

  useEffect(() => {
    if (!showHistoryMobile) return
    return registerBackHandler(75, () => {
      setShowHistoryMobile(false)
      return true
    })
  }, [showHistoryMobile])

  useEffect(() => {
    if (variant !== 'drawer' || !onClose) return
    return registerBackHandler(95, () => {
      onClose()
      return true
    })
  }, [variant, onClose])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, streaming])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const createNewConversation = (initialTitle = '新的哲思对话'): AiConversation => {
    const conv: AiConversation = {
      id: `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      title: initialTitle,
      bookId: readingContext?.bookId,
      bookTitle: readingContext?.bookTitle,
      chapterTitle: readingContext?.chapterTitle,
      messages: [],
      updatedAt: Date.now(),
    }
    const next = [conv, ...conversations]
    onSaveConversations(next)
    setActiveConvId(conv.id)
    setShowHistoryMobile(false)
    return conv
  }

  const deleteConversation = (id: string) => {
    const next = conversations.filter((c) => c.id !== id)
    onSaveConversations(next)
    if (activeConvId === id) {
      setActiveConvId(next[0]?.id || '')
    }
  }

  const handleSend = async (customPrompt?: string) => {
    const promptText = (customPrompt ?? input).trim()
    if (!promptText || streaming) return

    if (!isConfigured) {
      notifyToast('请先配置 AI API Key 与模型')
      onOpenAiSettings()
      return
    }

    triggerHaptic()
    const quote = readingContext?.selectedText?.trim() || undefined
    let conv = activeConv
    let workingConvs = [...conversations]

    if (!conv) {
      conv = {
        id: `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        title: (quote ? `问：${quote.slice(0, 14)}` : promptText.slice(0, 18)) || '新的哲思对话',
        bookId: readingContext?.bookId,
        bookTitle: readingContext?.bookTitle,
        chapterTitle: readingContext?.chapterTitle,
        messages: [],
        updatedAt: Date.now(),
      }
      workingConvs = [conv, ...workingConvs]
      setActiveConvId(conv.id)
    }

    const userMsg: AiMessage = {
      id: `m_u_${Date.now().toString(36)}`,
      role: 'user',
      content: promptText,
      quoteText: quote,
      bookTitle: readingContext?.bookTitle,
      chapterTitle: readingContext?.chapterTitle,
      createdAt: Date.now(),
    }

    const assistantMsgId = `m_a_${Date.now().toString(36)}_r`
    const assistantMsg: AiMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      quoteText: quote,
      createdAt: Date.now(),
    }

    const updatedMessages = [...conv.messages, userMsg, assistantMsg]
    const updatedTitle =
      conv.messages.length === 0
        ? (quote ? `解读：${quote.slice(0, 14)}` : promptText.slice(0, 18))
        : conv.title

    const commitConv = (msgs: AiMessage[]) => {
      const next = workingConvs.map((c) =>
        c.id === conv!.id ? { ...c, title: updatedTitle, messages: msgs, updatedAt: Date.now() } : c
      )
      workingConvs = next
      onSaveConversations(next)
    }

    commitConv(updatedMessages)
    if (!customPrompt) setInput('')
    setStreaming(true)

    // 构造上下文历史（最近 10 轮）
    const turns: ChatTurn[] = []
    const recentHistory = conv.messages.slice(-10)
    for (const m of recentHistory) {
      const contentWithQuote =
        m.role === 'user' && m.quoteText
          ? `【选中原文${m.bookTitle ? ` · 《${m.bookTitle}》` : ''}】\n${m.quoteText}\n\n【问题】\n${m.content}`
          : m.content
      turns.push({ role: m.role, content: contentWithQuote })
    }

    const currentContextParts: string[] = []
    if (readingContext?.bookTitle) {
      currentContextParts.push(
        `当前阅读典籍：《${readingContext.bookTitle}》${readingContext.author ? `（${readingContext.author}）` : ''}${
          readingContext.chapterTitle ? ` · ${readingContext.chapterTitle}` : ''
        }`
      )
    }
    if (quote) {
      currentContextParts.push(`用户选中的原文段落：\n「${quote}」`)
    }
    const finalUserContent =
      currentContextParts.length > 0
        ? `${currentContextParts.join('\n')}\n\n用户提问：${promptText}`
        : promptText
    turns.push({ role: 'user', content: finalUserContent })

    const ac = new AbortController()
    abortRef.current = ac

    try {
      const full = await streamAiChat(aiSettings, turns, {
        signal: ac.signal,
        onDelta: (_delta, soFar) => {
          const patched = updatedMessages.map((m) =>
            m.id === assistantMsgId ? { ...m, content: soFar } : m
          )
          commitConv(patched)
        },
      })
      if (!full && !ac.signal.aborted) {
        const patched = updatedMessages.map((m) =>
          m.id === assistantMsgId ? { ...m, content: '（AI 返回为空，请检查模型配置后重试）' } : m
        )
        commitConv(patched)
      }
    } catch (err: any) {
      if (!ac.signal.aborted) {
        const errText = `请求失败：${err?.message || '请检查网络与 API 配置'}`
        const patched = updatedMessages.map((m) =>
          m.id === assistantMsgId ? { ...m, content: m.content ? `${m.content}\n\n> ${errText}` : errText } : m
        )
        commitConv(patched)
      }
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
    setStreaming(false)
  }

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopiedId(id)
    notifyToast('已复制 AI 回复')
    window.setTimeout(() => setCopiedId(null), 1300)
  }

  const renderHistoryList = () => (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex items-center justify-between gap-2 shrink-0" style={{ borderColor: 'var(--border)' }}>
        <span className="text-xs font-bold font-serif">对话记录 ({conversations.length})</span>
        <button
          onClick={() => createNewConversation()}
          className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-white flex items-center gap-1"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <Plus className="w-3 h-3" />
          <span>新对话</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {conversations.length === 0 ? (
          <p className="text-[11px] text-center py-8" style={{ color: 'var(--text-muted)' }}>
            暂无历史对话
          </p>
        ) : (
          conversations.map((c) => {
            const active = c.id === activeConv?.id
            return (
              <div
                key={c.id}
                onClick={() => {
                  setActiveConvId(c.id)
                  setShowHistoryMobile(false)
                }}
                className="group flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-xl cursor-pointer transition-colors"
                style={
                  active
                    ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }
                    : { color: 'var(--text)' }
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{c.title}</div>
                  <div className="text-[10px] truncate opacity-65">
                    {c.bookTitle ? `《${c.bookTitle}》 · ` : ''}
                    {c.messages.length} 条消息
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteConversation(c.id)
                  }}
                  className="p-1 rounded-lg opacity-50 hover:opacity-100 text-red-500 shrink-0"
                  title="删除对话"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )

  const body = (
    <div className="flex h-full min-h-0 overflow-hidden" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}>
      {/* 桌面端全页模式：左侧对话历史栏 */}
      {variant === 'page' && (
        <aside
          className="hidden md:flex w-64 shrink-0 border-r flex-col"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          {renderHistoryList()}
        </aside>
      )}

      {/* 右侧对话主区域 */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0 relative">
        {/* 顶栏 */}
        <div
          className="px-3 md:px-4 py-2.5 md:py-3 border-b flex items-center justify-between gap-2 shrink-0"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-7 h-7 rounded-xl flex items-center justify-center text-white shrink-0"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-serif font-bold truncate">AI 哲思助手</div>
              <div className="text-[10px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                {isConfigured ? `${aiSettings.model} · 已就绪` : '请先配置 API Key'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {variant === 'page' && (
              <button
                onClick={() => {
                  triggerHaptic()
                  setShowHistoryMobile((v) => !v)
                }}
                className="md:hidden h-8 px-2 rounded-xl border text-[11px] flex items-center gap-1 active:scale-95"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                title="对话记录"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>记录</span>
              </button>
            )}

            <button
              onClick={() => {
                triggerHaptic()
                createNewConversation()
              }}
              className="h-8 px-2 sm:px-2.5 rounded-xl border text-[11px] font-medium flex items-center gap-1 hover:opacity-85 active:scale-95"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              title="开启新对话"
              aria-label="开启新对话"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">新对话</span>
            </button>

            {onOpenTranslationSettings && (
              <button
                onClick={() => {
                  triggerHaptic()
                  onOpenTranslationSettings()
                }}
                className="h-8 px-2 sm:px-2.5 rounded-xl border text-[11px] font-medium flex items-center gap-1 hover:opacity-85 active:scale-95"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                title="翻译引擎设置"
                aria-label="翻译引擎设置"
              >
                <Languages className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                <span className="hidden sm:inline">翻译引擎</span>
              </button>
            )}

            <button
              onClick={() => {
                triggerHaptic()
                onOpenAiSettings()
              }}
              className="h-8 px-2 sm:px-2.5 rounded-xl border text-[11px] font-medium flex items-center gap-1 hover:opacity-85 active:scale-95"
              style={
                !isConfigured
                  ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                  : { backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--accent)' }
              }
              title="配置 AI API 接口与模型"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">API 设置</span>
              <span className="sm:hidden">设置</span>
            </button>

            {variant === 'drawer' && onClose && (
              <button onClick={onClose} className="p-1.5 rounded-xl hover:opacity-75" aria-label="关闭 AI 助手">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* 移动端历史对话抽屉 */}
        {variant === 'page' && showHistoryMobile && (
          <div
            className="md:hidden absolute inset-0 z-20 flex bg-black/40"
            onClick={() => setShowHistoryMobile(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-72 max-w-[82vw] h-full border-r shadow-2xl"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              {renderHistoryList()}
            </div>
          </div>
        )}

        {/* 选中文本上下文卡片 */}
        {readingContext?.selectedText && (
          <div
            className="mx-3 mt-3 p-3 rounded-2xl border space-y-2 shrink-0"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--accent)' }}
          >
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold flex items-center gap-1.5 truncate" style={{ color: 'var(--accent)' }}>
                <BookOpen className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  已引用选中内容{readingContext.bookTitle ? ` · 《${readingContext.bookTitle}》` : ''}
                </span>
              </span>
              {onClearQuote && (
                <button
                  onClick={onClearQuote}
                  className="text-[11px] opacity-65 hover:opacity-100 shrink-0"
                  title="移除引用"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p
              className="font-serif text-xs leading-relaxed line-clamp-3 pl-2.5 border-l-2"
              style={{ borderColor: 'var(--accent)', color: 'var(--text-secondary)' }}
            >
              「{readingContext.selectedText}」
            </p>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
              {QUICK_PROMPTS_WITH_QUOTE.map((q) => (
                <button
                  key={q.label}
                  onClick={() => handleSend(q.prompt)}
                  disabled={streaming}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium shrink-0 transition-transform active:scale-95 disabled:opacity-45"
                  style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 消息流 */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4">
          {!isConfigured && (
            <div
              className="p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
            >
              <div className="space-y-1">
                <div className="text-xs font-bold">通过 API 接口启用 AI 哲思助手</div>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  支持 DeepSeek、OpenAI、硅基流动、Google Gemini、Anthropic Claude、OpenRouter 及本地 Ollama 等任意兼容 API。
                </p>
              </div>
              <button
                onClick={onOpenAiSettings}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white shrink-0"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                立即填写 API Key
              </button>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="py-8 flex flex-col items-center text-center space-y-4 max-w-md mx-auto">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Sparkles className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-serif font-bold text-base">
                  {readingContext?.selectedText ? '针对所选段落向 AI 提问' : '与 AI 探讨哲学原典'}
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {readingContext?.selectedText
                    ? '点击上方快捷指令一键深度解读，或在下方输入框自由追问。'
                    : '在阅读器划词点击「AI」即可带入原文提问，也可以直接在此探讨任意哲学命题。'}
                </p>
              </div>
              {!readingContext?.selectedText && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full text-left pt-2">
                  {QUICK_PROMPTS_GENERAL.map((q) => (
                    <button
                      key={q.label}
                      onClick={() => handleSend(q.prompt)}
                      className="p-3 rounded-xl border text-xs transition-all hover:opacity-90 active:scale-[0.99]"
                      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
                    >
                      <div className="font-semibold mb-0.5" style={{ color: 'var(--accent)' }}>
                        {q.label}
                      </div>
                      <div className="text-[11px] line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                        {q.prompt}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user'
              return (
                <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[92%] sm:max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed border select-text ${
                      isUser ? 'rounded-br-md' : 'rounded-bl-md'
                    }`}
                    style={
                      isUser
                        ? {
                            backgroundColor: 'var(--accent)',
                            color: '#ffffff',
                            borderColor: 'var(--accent)',
                          }
                        : {
                            backgroundColor: 'var(--bg-card)',
                            color: 'var(--text)',
                            borderColor: 'var(--border)',
                          }
                    }
                  >
                    {isUser && msg.quoteText && (
                      <div className="mb-2 pl-2 border-l-2 border-white/60 text-[11px] opacity-90 line-clamp-3 font-serif">
                        「{msg.quoteText}」
                      </div>
                    )}
                    {isUser ? (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    ) : msg.content ? (
                      <div
                        className="prose-ai"
                        dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(msg.content) }}
                      />
                    ) : (
                      <span className="inline-flex items-center gap-1.5 opacity-70">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>AI 思考中…</span>
                      </span>
                    )}
                  </div>

                  {!isUser && msg.content && (
                    <div className="flex items-center gap-2 mt-1 px-1">
                      <button
                        onClick={() => handleCopy(msg.id, msg.content)}
                        className="text-[11px] flex items-center gap-1 opacity-65 hover:opacity-100"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>复制</span>
                      </button>

                      {onSaveAsNote && (
                        <button
                          onClick={() => onSaveAsNote(msg.content, msg.quoteText || readingContext?.selectedText)}
                          className="text-[11px] flex items-center gap-1 opacity-80 hover:opacity-100 font-medium"
                          style={{ color: 'var(--accent)' }}
                        >
                          <BookmarkPlus className="w-3 h-3" />
                          <span>存入批注</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
          <div ref={listEndRef} />
        </div>

        {/* 底部输入栏 */}
        <div
          className={`p-3 border-t shrink-0 ${variant === 'drawer' ? 'safe-bottom' : 'pb-4'}`}
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div
            className="flex items-end gap-2 p-2 rounded-2xl border"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)' }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={
                readingContext?.selectedText
                  ? '针对选中内容继续追问…（Enter 发送）'
                  : '输入你的哲学问题或阅读疑惑…（Enter 发送，Shift+Enter 换行）'
              }
              className="flex-1 bg-transparent outline-none text-xs leading-relaxed resize-none max-h-28 px-1.5 py-1"
              style={{ color: 'var(--text)' }}
            />
            {streaming ? (
              <button
                onClick={handleStop}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 active:scale-95"
                style={{ backgroundColor: '#ef4444' }}
                title="停止生成"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 disabled:opacity-35 active:scale-95"
                style={{ backgroundColor: 'var(--accent)' }}
                title="发送"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  if (variant === 'page') {
    return <div className="h-full w-full overflow-hidden">{body}</div>
  }

  // Reader 侧边/底部抽屉模式
  return (
    <div
      className="fixed inset-0 z-[65] flex justify-end items-end md:items-stretch bg-black/45 backdrop-blur-[1px] animate-backdrop-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full md:w-[440px] lg:w-[480px] h-[84vh] md:h-full rounded-t-3xl md:rounded-none md:border-l border-t md:border-t-0 shadow-2xl overflow-hidden animate-sheet-up"
        style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg)' }}
      >
        {body}
      </div>
    </div>
  )
}
