import React from 'react'
import { Loader2, Pause, Play, Radio, SkipForward, X } from 'lucide-react'
import type { RadioState } from '../types'
import { RADIO_STATIONS } from '../services/radioEngine'

interface MiniRadioDockProps {
  radio: RadioState
  onTogglePlay: () => void
  onNext: () => void
  onOpenStudio: () => void
  onClose: () => void
}

export const MiniRadioDock: React.FC<MiniRadioDockProps> = ({
  radio,
  onTogglePlay,
  onNext,
  onOpenStudio,
  onClose,
}) => {
  const station = RADIO_STATIONS.find((s) => s.id === radio.stationId) || RADIO_STATIONS[0]
  const isPlaying = radio.status === 'playing'
  const isLoading = radio.status === 'loading'
  const chapterPct =
    radio.chapterDuration > 0
      ? Math.max(0, Math.min(100, (radio.chapterCurrentTime / radio.chapterDuration) * 100))
      : radio.totalSegments > 0
      ? Math.max(0, Math.min(100, ((radio.segmentIndex + 1) / radio.totalSegments) * 100))
      : 0

  return (
    <div className="px-3 pb-2 md:px-6 md:pb-4 pointer-events-none z-30">
      <div
        onClick={onOpenStudio}
        className="pointer-events-auto max-w-3xl mx-auto rounded-2xl border px-3 py-2 flex items-center gap-3 cursor-pointer transition-all duration-300 hover:scale-[1.005] active:scale-[0.99] animate-sheet-up relative overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: isPlaying ? 'var(--accent)' : 'var(--border-strong)',
          boxShadow: 'var(--shadow-float)',
        }}
      >
        {/* 底部全章播放进度细线 */}
        {chapterPct > 0 && (
          <div
            className="absolute bottom-0 left-0 right-0 h-[2.5px] pointer-events-none"
            style={{ backgroundColor: 'var(--border)' }}
          >
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${chapterPct}%`,
                background: `linear-gradient(90deg, ${station.accent}, var(--gold))`,
              }}
            />
          </div>
        )}
        {/* 迷你黑胶电台盘 */}
        <div
          className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center relative border-2 ${
            isPlaying ? 'vinyl-spin' : 'vinyl-spin vinyl-paused'
          }`}
          style={{
            background: 'radial-gradient(circle at center, #2b2723 0%, #141210 62%, #2c2620 100%)',
            borderColor: station.accent,
          }}
        >
          <div
            className="w-3.5 h-3.5 rounded-full flex items-center justify-center"
            style={{ backgroundColor: station.accent }}
          >
            <div className="w-1 h-1 rounded-full bg-white/90" />
          </div>
        </div>

        {/* 节目信息与声波 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              {station.freq}
            </span>
            <span className="text-xs font-semibold truncate font-serif">{radio.bookTitle}</span>
            {radio.isOfflineFallback && (
              <span
                className="text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0"
                style={{ backgroundColor: 'rgba(234, 179, 8, 0.18)', color: '#b45309' }}
              >
                离线语音
              </span>
            )}
            {isPlaying && (
              <span className="flex items-end gap-[2px] h-3 ml-1 shrink-0">
                <span className="w-[2px] h-full rounded-full eq-bar" style={{ backgroundColor: 'var(--accent)', animationDelay: '0ms' }} />
                <span className="w-[2px] h-full rounded-full eq-bar" style={{ backgroundColor: 'var(--accent)', animationDelay: '180ms' }} />
                <span className="w-[2px] h-full rounded-full eq-bar" style={{ backgroundColor: 'var(--accent)', animationDelay: '340ms' }} />
              </span>
            )}
          </div>
          <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {radio.errorMessage
              ? `⚠ ${radio.errorMessage}`
              : radio.currentText || radio.chapterTitle}
          </p>
        </div>

        {/* 快捷播控 + X 取消关闭键 */}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onTogglePlay}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white transition-transform active:scale-90 shadow-sm"
            style={{ backgroundColor: 'var(--accent)' }}
            title={isPlaying ? '暂停电台' : '开始电台播报'}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>
          <button
            onClick={onNext}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:opacity-80"
            style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            title="下一段 / 换台"
          >
            <SkipForward className="w-4 h-4" />
          </button>
          <button
            onClick={onOpenStudio}
            className="hidden sm:flex w-8 h-8 rounded-full items-center justify-center transition-colors hover:opacity-80"
            style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--accent)' }}
            title="展开哲启明思电台控制台"
          >
            <Radio className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-red-500/15 hover:text-red-500"
            style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
            title="停止并关闭电台"
            aria-label="停止并关闭电台"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
