import React, { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import type { AiProtocol, AiSettings } from '../types'
import {
  AI_PROVIDER_PRESETS,
  fetchAvailableModels,
  testAiConnection,
} from '../services/aiService'
import { DEFAULT_AI_SYSTEM_PROMPT } from '../services/storage'
import { notifyToast, registerBackHandler } from '../services/platform'

interface AiSettingsModalProps {
  settings: AiSettings
  onUpdateSettings: (partial: Partial<AiSettings>) => void
  onClose: () => void
}

export const AiSettingsModal: React.FC<AiSettingsModalProps> = ({
  settings,
  onUpdateSettings,
  onClose,
}) => {
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [remoteModels, setRemoteModels] = useState<string[]>([])

  useEffect(() => {
    return registerBackHandler(120, () => {
      onClose()
      return true
    })
  }, [onClose])

  const activePreset = AI_PROVIDER_PRESETS.find((p) => p.id === settings.preset) || AI_PROVIDER_PRESETS[0]

  const handleChoosePreset = (presetId: AiSettings['preset']) => {
    const preset = AI_PROVIDER_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    onUpdateSettings({
      preset: preset.id,
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      model: preset.defaultModel,
    })
    setRemoteModels([])
    setTestMsg(null)
  }

  const handleFetchModels = async () => {
    setLoadingModels(true)
    try {
      const list = await fetchAvailableModels(settings)
      setRemoteModels(list)
      notifyToast(`已获取 ${list.length} 个可用模型`)
    } catch (err: any) {
      notifyToast(err?.message || '拉取模型列表失败')
    } finally {
      setLoadingModels(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestMsg(null)
    try {
      const res = await testAiConnection(settings)
      setTestMsg({ ok: true, text: `连接成功（${res.latencyMs} ms）：${res.reply.slice(0, 60)}` })
    } catch (err: any) {
      setTestMsg({ ok: false, text: err?.message || '连接失败，请核对 Base URL、API Key 与模型名称' })
    } finally {
      setTesting(false)
    }
  }

  const allQuickModels = Array.from(new Set([...remoteModels, ...activePreset.suggestedModels]))

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end md:items-center justify-center md:p-4 bg-black/55 backdrop-blur-[2px] animate-backdrop-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-xl max-h-[90vh] rounded-t-3xl md:rounded-2xl border shadow-2xl flex flex-col overflow-hidden font-sans animate-sheet-up safe-bottom"
        style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)' }}
      >
        <div
          className="px-4 py-3.5 border-b flex items-center justify-between shrink-0"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="font-serif font-bold text-base">AI API 接口配置</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4 text-xs">
          {/* 服务商预设 */}
          <div className="space-y-2">
            <div className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
              快捷服务商预设（支持任意兼容接口）
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {AI_PROVIDER_PRESETS.map((p) => {
                const active = settings.preset === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => handleChoosePreset(p.id)}
                    className="px-2.5 py-2 rounded-xl border text-[11px] font-medium text-center transition-all active:scale-95 truncate"
                    style={
                      active
                        ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                        : { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text)' }
                    }
                  >
                    {p.name}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {activePreset.hint}
            </p>
          </div>

          {/* 协议类型 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
              接口协议：
            </span>
            {(
              [
                ['openai', 'OpenAI 兼容'],
                ['gemini', 'Google Gemini'],
                ['anthropic', 'Anthropic Claude'],
              ] as Array<[AiProtocol, string]>
            ).map(([proto, label]) => (
              <button
                key={proto}
                onClick={() => onUpdateSettings({ protocol: proto })}
                className="px-3 py-1 rounded-full border text-[11px] font-medium"
                style={
                  settings.protocol === proto
                    ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }
                    : { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }
                }
              >
                {label}
              </button>
            ))}
          </div>

          {/* Base URL */}
          <div className="space-y-1">
            <label className="block font-medium" style={{ color: 'var(--text-secondary)' }}>
              API Base URL（接口地址）
            </label>
            <input
              type="text"
              value={settings.baseUrl}
              onChange={(e) => onUpdateSettings({ baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com/v1"
              className="w-full px-3 py-2.5 rounded-xl border text-xs outline-none font-mono"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
            />
          </div>

          {/* API Key */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="font-medium flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                <KeyRound className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                <span>API Key</span>
              </label>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                仅保存于本机，不上传第三方
              </span>
            </div>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={settings.apiKey}
                onChange={(e) => onUpdateSettings({ apiKey: e.target.value })}
                placeholder={settings.preset === 'ollama' ? '本地 Ollama 可留空' : '粘贴你的 API Key (sk-... / AIza...)'}
                className="w-full pl-3 pr-10 py-2.5 rounded-xl border text-xs outline-none font-mono"
                style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 opacity-70 hover:opacity-100"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Model 名称 + 拉取模型 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                模型名称（Model）
              </label>
              <button
                onClick={handleFetchModels}
                disabled={loadingModels}
                className="text-[11px] font-medium flex items-center gap-1 hover:underline disabled:opacity-50"
                style={{ color: 'var(--accent)' }}
              >
                <RefreshCw className={`w-3 h-3 ${loadingModels ? 'animate-spin' : ''}`} />
                <span>{loadingModels ? '拉取中…' : '自动拉取模型列表'}</span>
              </button>
            </div>
            <input
              type="text"
              value={settings.model}
              onChange={(e) => onUpdateSettings({ model: e.target.value })}
              placeholder="例如 deepseek-chat / gpt-4o-mini / gemini-2.5-flash"
              className="w-full px-3 py-2.5 rounded-xl border text-xs outline-none font-mono"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
            />
            {allQuickModels.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1 max-h-24 overflow-y-auto">
                {allQuickModels.map((m) => (
                  <button
                    key={m}
                    onClick={() => onUpdateSettings({ model: m })}
                    className="px-2 py-0.5 rounded-lg border text-[11px] font-mono transition-colors"
                    style={
                      settings.model === m
                        ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }
                        : { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                    }
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 温度与输出上限（默认无上限，可选手动填写任意数值） */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between mb-1">
                <span>思维发散度 (Temperature)</span>
                <span className="font-mono">{settings.temperature.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.1}
                value={settings.temperature}
                onChange={(e) => onUpdateSettings({ temperature: Number(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span>最大输出 Tokens</span>
                <button
                  type="button"
                  onClick={() => {
                    const currentlyUnlimited = settings.unlimitedOutput !== false
                    onUpdateSettings({
                      unlimitedOutput: !currentlyUnlimited,
                      maxTokens: !currentlyUnlimited ? 0 : settings.maxTokens > 0 ? settings.maxTokens : 8192,
                    })
                  }}
                  className="px-2 py-0.5 rounded-full border text-[10px] font-semibold transition-colors"
                  style={
                    settings.unlimitedOutput !== false
                      ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                      : { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                  }
                >
                  {settings.unlimitedOutput !== false ? '无上限（已开启）' : '切回无上限'}
                </button>
              </div>

              {settings.unlimitedOutput !== false ? (
                <div
                  className="px-3 py-1.5 rounded-xl border text-[11px]"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                >
                  不限制输出长度，完全跟随模型原生最大输出
                </div>
              ) : (
                <input
                  type="number"
                  min={1}
                  step={256}
                  value={settings.maxTokens || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10)
                    onUpdateSettings({ maxTokens: Number.isFinite(val) && val > 0 ? val : 0 })
                  }}
                  placeholder="输入任意正整数（留空或 0 表示无上限）"
                  className="w-full px-3 py-1.5 rounded-xl border text-xs outline-none font-mono"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
                />
              )}
            </div>
          </div>

          {/* 系统提示词 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                AI 角色设定（System Prompt）
              </label>
              <button
                onClick={() => onUpdateSettings({ systemPrompt: DEFAULT_AI_SYSTEM_PROMPT })}
                className="text-[11px] hover:underline"
                style={{ color: 'var(--text-muted)' }}
              >
                恢复默认
              </button>
            </div>
            <textarea
              rows={3}
              value={settings.systemPrompt}
              onChange={(e) => onUpdateSettings({ systemPrompt: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border text-xs leading-relaxed outline-none resize-none"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>

          {/* 测试结果 */}
          {testMsg && (
            <div
              className="p-3 rounded-xl border text-xs leading-relaxed"
              style={{
                backgroundColor: testMsg.ok ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                borderColor: testMsg.ok ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)',
                color: testMsg.ok ? 'var(--text)' : '#dc2626',
              }}
            >
              {testMsg.text}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div
          className="px-4 py-3 border-t flex items-center justify-between gap-2 shrink-0"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-3.5 py-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)' }}
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />}
            <span>{testing ? '测试连接中…' : '测试 API 连接'}</span>
          </button>

          <button
            onClick={() => {
              notifyToast('AI 接口配置已保存')
              onClose()
            }}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-white"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            完成保存
          </button>
        </div>
      </div>
    </div>
  )
}
