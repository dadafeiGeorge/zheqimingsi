import React, { useEffect, useState } from 'react'
import {
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  Eye,
  EyeOff,
  Info,
  Languages,
  Loader2,
  Settings2,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react'
import type { AiSettings, TranslationEngineId, TranslationSettings } from '../types'
import {
  TRANSLATION_ENGINES,
  TRANSLATION_LANGUAGES,
  clearTranslationCache,
  getEngineMeta,
  translateText,
} from '../services/translateService'
import { notifyToast, registerBackHandler, triggerHaptic } from '../services/platform'

interface TranslationSettingsModalProps {
  settings: TranslationSettings
  aiSettings: AiSettings
  onUpdateSettings: (partial: Partial<TranslationSettings>) => void
  onOpenAiSettings: () => void
  onClose: () => void
}

export const TranslationSettingsModal: React.FC<TranslationSettingsModalProps> = ({
  settings,
  aiSettings,
  onUpdateSettings,
  onOpenAiSettings,
  onClose,
}) => {
  const [expandedEngine, setExpandedEngine] = useState<TranslationEngineId | null>(settings.activeEngine)
  const [showSecrets, setShowSecrets] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testOutput, setTestOutput] = useState<{ ok: boolean; text: string; ms: number } | null>(null)

  useEffect(() => {
    return registerBackHandler(110, () => {
      onClose()
      return true
    })
  }, [onClose])

  const currentEngineMeta = getEngineMeta(settings.activeEngine)

  const getEngineStatusBadge = (id: TranslationEngineId): { label: string; ready: boolean } => {
    switch (id) {
      case 'bing_web':
      case 'google_web':
        return { label: '在线免密钥', ready: true }
      case 'azure_api':
        return settings.azureKey.trim() ? { label: '已配置 Key', ready: true } : { label: '需配置 Key', ready: false }
      case 'google_api':
        return settings.googleApiKey.trim() ? { label: '已配置 Key', ready: true } : { label: '需配置 Key', ready: false }
      case 'deepl_api':
        return settings.deeplApiKey.trim() ? { label: '已配置 Key', ready: true } : { label: '需配置 Key', ready: false }
      case 'ai':
        return aiSettings.apiKey.trim() || aiSettings.preset === 'ollama'
          ? { label: aiSettings.model || '已配置 AI', ready: true }
          : { label: '需配置 AI API', ready: false }
      case 'offline':
        return { label: '断网可用', ready: true }
    }
  }

  const handleSelectEngine = (id: TranslationEngineId) => {
    triggerHaptic()
    onUpdateSettings({ activeEngine: id })
    setExpandedEngine((prev) => (prev === id ? id : id))
    setTestOutput(null)
  }

  const handleSwapLangs = () => {
    if (settings.sourceLang === 'auto') {
      onUpdateSettings({ sourceLang: settings.targetLang, targetLang: settings.targetLang === 'zh-CN' ? 'en' : 'zh-CN' })
      return
    }
    onUpdateSettings({ sourceLang: settings.targetLang, targetLang: settings.sourceLang })
  }

  const handleTestEngine = async () => {
    setTesting(true)
    setTestOutput(null)
    const t0 = performance.now()
    const sample =
      settings.targetLang.startsWith('zh')
        ? 'Reason and freedom constitute the core of philosophy.'
        : '理性与自由构成哲学思考的核心。'
    try {
      clearTranslationCache()
      const res = await translateText(sample, settings, aiSettings)
      setTestOutput({
        ok: true,
        text: `${res.translatedText}`,
        ms: Math.round(performance.now() - t0),
      })
    } catch (err: any) {
      setTestOutput({
        ok: false,
        text: err?.message || '翻译测试失败',
        ms: Math.round(performance.now() - t0),
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end md:items-center justify-center md:p-4 bg-black/50 backdrop-blur-[2px] animate-backdrop-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-lg max-h-[90vh] rounded-t-3xl md:rounded-2xl border shadow-2xl flex flex-col overflow-hidden font-sans animate-sheet-up safe-bottom"
        style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)' }}
      >
        {/* 顶栏 */}
        <div
          className="px-4 py-3.5 border-b flex items-center justify-between shrink-0"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="font-serif font-bold text-base">翻译与双语设置</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:opacity-75"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 主体内容 */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-5">
          {/* 区块一：全文翻译（对应图二上方卡片） */}
          <section className="space-y-2">
            <div className="text-xs font-semibold px-1" style={{ color: 'var(--accent)' }}>
              全文翻译
            </div>
            <div
              className="rounded-2xl border p-4 space-y-3.5 shadow-sm"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <div className="text-center space-y-1 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="text-base font-bold tracking-wide" style={{ color: 'var(--accent)' }}>
                  {currentEngineMeta.name}
                </div>
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  当前服务
                </div>
              </div>

              {/* 源语言 > 目标语言 */}
              <div className="flex items-center justify-between gap-2">
                <select
                  value={settings.sourceLang}
                  onChange={(e) => onUpdateSettings({ sourceLang: e.target.value })}
                  className="flex-1 px-3 py-2 rounded-xl border text-xs font-medium text-center outline-none"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  {TRANSLATION_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.nativeLabel}
                    </option>
                  ))}
                </select>

                <button
                  onClick={handleSwapLangs}
                  className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 active:scale-95 transition-transform"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--accent)' }}
                  title="互换源语言与目标语言"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                </button>

                <select
                  value={settings.targetLang}
                  onChange={(e) => onUpdateSettings({ targetLang: e.target.value })}
                  className="flex-1 px-3 py-2 rounded-xl border text-xs font-medium text-center outline-none"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  {TRANSLATION_LANGUAGES.filter((l) => l.code !== 'auto').map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.nativeLabel}
                    </option>
                  ))}
                </select>
              </div>

              {/* 双语平行翻译总开关 */}
              <div
                className="flex items-center justify-between gap-3 pt-2 border-t"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex items-start gap-2 min-w-0">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--gold)' }} />
                  <span className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    阅读页面的双语平行翻译功能，开启后自动在正文段落下方对照呈现译文。
                  </span>
                </div>
                <button
                  onClick={() => {
                    triggerHaptic()
                    onUpdateSettings({ fullTextEnabled: !settings.fullTextEnabled })
                    notifyToast(!settings.fullTextEnabled ? '已开启阅读页双语平行翻译' : '已关闭双语平行翻译')
                  }}
                  className="w-11 h-6 rounded-full p-0.5 transition-colors shrink-0"
                  style={{
                    backgroundColor: settings.fullTextEnabled ? 'var(--accent)' : 'var(--border-strong)',
                  }}
                  aria-label="切换全文双语平行翻译"
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      settings.fullTextEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>

          {/* 区块二：翻译服务配置（完整覆盖图二 6 大在线引擎 + 1 个离线翻译引擎） */}
          <section className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                翻译服务配置
              </span>
              <button
                onClick={() => setShowSecrets((v) => !v)}
                className="text-[11px] flex items-center gap-1 hover:opacity-80"
                style={{ color: 'var(--text-muted)' }}
              >
                {showSecrets ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showSecrets ? '隐藏密钥' : '显示密钥'}</span>
              </button>
            </div>

            <div
              className="rounded-2xl border overflow-hidden divide-y"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              {TRANSLATION_ENGINES.map((eng) => {
                const isActive = settings.activeEngine === eng.id
                const isExpanded = expandedEngine === eng.id
                const status = getEngineStatusBadge(eng.id)
                return (
                  <div key={eng.id} style={{ borderColor: 'var(--border)' }}>
                    <div
                      onClick={() => handleSelectEngine(eng.id)}
                      className="px-4 py-3.5 flex items-center justify-between gap-3 cursor-pointer transition-colors hover:opacity-90"
                      style={isActive ? { backgroundColor: 'var(--accent-soft)' } : undefined}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                          style={{
                            backgroundColor: isActive ? 'var(--accent)' : 'var(--bg-elevated)',
                            color: isActive ? '#fff' : 'var(--text-secondary)',
                          }}
                        >
                          {eng.isOffline ? (
                            <WifiOff className="w-4 h-4" />
                          ) : eng.id === 'ai' ? (
                            <Sparkles className="w-4 h-4" />
                          ) : (
                            <Languages className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{eng.name}</span>
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                              style={{
                                backgroundColor: status.ready ? 'rgba(16, 185, 129, 0.14)' : 'rgba(234, 179, 8, 0.16)',
                                color: status.ready ? '#059669' : '#b45309',
                              }}
                            >
                              {status.label}
                            </span>
                          </div>
                          <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            {eng.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isActive && (
                          <span
                            className="w-5 h-5 rounded-full flex items-center justify-center text-white"
                            style={{ backgroundColor: 'var(--accent)' }}
                          >
                            <Check className="w-3 h-3" strokeWidth={3} />
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedEngine(isExpanded ? null : eng.id)
                          }}
                          className="p-1 rounded-lg opacity-65 hover:opacity-100"
                          aria-label="展开配置"
                        >
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* 各服务专属配置抽屉 */}
                    {isExpanded && (
                      <div
                        className="px-4 py-3 text-xs space-y-2.5 border-t"
                        style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                      >
                        {eng.id === 'bing_web' && (
                          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            直连微软 Bing 网页翻译接口（自动维护会话与重定向），经本地原生代理转发免跨域，无需配置任何密钥即可使用。
                          </p>
                        )}

                        {eng.id === 'google_web' && (
                          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            采用 Google Translate 网页免费接口，自动走设备系统网络与代理（支持 VPN），免密钥即用。
                          </p>
                        )}

                        {eng.id === 'azure_api' && (
                          <div className="space-y-2">
                            <div>
                              <label className="block text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
                                Subscription Key (Ocp-Apim-Subscription-Key)
                              </label>
                              <input
                                type={showSecrets ? 'text' : 'password'}
                                value={settings.azureKey}
                                onChange={(e) => onUpdateSettings({ azureKey: e.target.value })}
                                placeholder="粘贴 Microsoft Azure Translator 密钥"
                                className="w-full px-3 py-2 rounded-xl border text-xs outline-none"
                                style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
                                  区域 Region
                                </label>
                                <input
                                  type="text"
                                  value={settings.azureRegion}
                                  onChange={(e) => onUpdateSettings({ azureRegion: e.target.value })}
                                  placeholder="eastasia / global"
                                  className="w-full px-3 py-2 rounded-xl border text-xs outline-none"
                                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text)' }}
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
                                  接口 Endpoint
                                </label>
                                <input
                                  type="text"
                                  value={settings.azureEndpoint}
                                  onChange={(e) => onUpdateSettings({ azureEndpoint: e.target.value })}
                                  placeholder="https://api.cognitive.microsofttranslator.com"
                                  className="w-full px-3 py-2 rounded-xl border text-xs outline-none"
                                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text)' }}
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {eng.id === 'google_api' && (
                          <div>
                            <label className="block text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
                              Google Cloud Translation API Key
                            </label>
                            <input
                              type={showSecrets ? 'text' : 'password'}
                              value={settings.googleApiKey}
                              onChange={(e) => onUpdateSettings({ googleApiKey: e.target.value })}
                              placeholder="AIzaSy..."
                              className="w-full px-3 py-2 rounded-xl border text-xs outline-none"
                              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
                            />
                          </div>
                        )}

                        {eng.id === 'deepl_api' && (
                          <div className="space-y-2">
                            <div>
                              <label className="block text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
                                DeepL Auth Key
                              </label>
                              <input
                                type={showSecrets ? 'text' : 'password'}
                                value={settings.deeplApiKey}
                                onChange={(e) => onUpdateSettings({ deeplApiKey: e.target.value })}
                                placeholder="例如 xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
                                className="w-full px-3 py-2 rounded-xl border text-xs outline-none"
                                style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                接口套餐：
                              </span>
                              {(['free', 'pro'] as const).map((plan) => (
                                <button
                                  key={plan}
                                  onClick={() => onUpdateSettings({ deeplPlan: plan })}
                                  className="px-3 py-1 rounded-lg border text-[11px] font-medium"
                                  style={
                                    settings.deeplPlan === plan
                                      ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                                      : { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }
                                  }
                                >
                                  {plan === 'free' ? 'Free 免费版 (:fx)' : 'Pro 专业版'}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {eng.id === 'ai' && (
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium truncate">
                                当前 AI 模型：{aiSettings.model || '未设置'}
                              </div>
                              <div className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                {aiSettings.baseUrl}
                              </div>
                            </div>
                            <button
                              onClick={onOpenAiSettings}
                              className="px-3 py-1.5 rounded-xl text-xs font-medium text-white flex items-center gap-1 shrink-0"
                              style={{ backgroundColor: 'var(--accent)' }}
                            >
                              <Settings2 className="w-3.5 h-3.5" />
                              <span>配置 AI API</span>
                            </button>
                          </div>
                        )}

                        {eng.id === 'offline' && (
                          <div className="space-y-2.5">
                            <div className="flex items-start gap-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                              <Cpu className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
                              <span>
                                彻底断网可用！内置英/法/德/拉丁/希腊高频词句形态引擎，并与本库 383+ 跨书哲学术语辞典深度联动。
                              </span>
                            </div>
                            <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                              <span className="text-[11px]">优先尝试本机离线翻译服务（如 LibreTranslate）</span>
                              <input
                                type="checkbox"
                                checked={settings.offlineUseLocalServer}
                                onChange={(e) => onUpdateSettings({ offlineUseLocalServer: e.target.checked })}
                                className="accent-[var(--accent)] w-4 h-4"
                              />
                            </div>
                            {settings.offlineUseLocalServer && (
                              <input
                                type="text"
                                value={settings.offlineLocalUrl}
                                onChange={(e) => onUpdateSettings({ offlineLocalUrl: e.target.value })}
                                placeholder="http://127.0.0.1:5000/translate"
                                className="w-full px-3 py-2 rounded-xl border text-xs outline-none"
                                style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text)' }}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* 实时测试区 */}
          <div
            className="rounded-2xl border p-3.5 space-y-2"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">测试「{currentEngineMeta.name}」连通性</span>
              <button
                onClick={handleTestEngine}
                disabled={testing}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 disabled:opacity-50 active:scale-95"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{testing ? '翻译测试中…' : '立即测试'}</span>
              </button>
            </div>
            {testOutput && (
              <div
                className="p-2.5 rounded-xl text-xs leading-relaxed border"
                style={{
                  backgroundColor: testOutput.ok ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                  borderColor: testOutput.ok ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)',
                  color: testOutput.ok ? 'var(--text)' : '#dc2626',
                }}
              >
                <div className="font-medium mb-0.5">
                  {testOutput.ok ? `✓ 测试成功（${testOutput.ms} ms）` : `✕ 测试失败（${testOutput.ms} ms）`}
                </div>
                <div>{testOutput.text}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
