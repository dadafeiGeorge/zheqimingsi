import type { AmbientSoundId } from '../types'

/**
 * 程序化 Web Audio API 伴读白噪音与电台调频音效引擎
 * 零外部音频文件依赖，支持：深夜雨声 / 壁炉微火 / 书房棕噪 / 黑胶唱片底噪 + FM 切换提示音
 * 已内置 AudioBuffer 缓存与无卡顿软淡出暂停，彻底消除播放/暂停切换时的主线程卡顿
 */
class AmbientAudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private activeNodes: AudioNode[] = []
  private crackleTimer: number | null = null
  private currentType: AmbientSoundId = 'none'
  private currentVolume = 0.25
  private isPlayingAmbient = false
  private bufferCache = new Map<AmbientSoundId, AudioBuffer>()

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    const AC = window.AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    if (!this.ctx) {
      this.ctx = new AC()
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
    return this.ctx
  }

  public getAudioContext(): AudioContext | null {
    return this.ensureContext()
  }

  /** 确保 AudioContext 处于 running 状态（防止系统休眠或自动暂停策略导致无声） */
  public ensureRunning() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
  }

  public playTuningChime() {
    const ctx = this.ensureContext()
    if (!ctx) return
    try {
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc2.type = 'triangle'
      osc.frequency.setValueAtTime(528, now)
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.18)
      osc2.frequency.setValueAtTime(792, now + 0.08)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.055, now + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45)

      osc.connect(gain)
      osc2.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc2.start(now + 0.08)
      osc.stop(now + 0.46)
      osc2.stop(now + 0.46)
    } catch {}
  }

  /** 瞬时静音暂停（保留已合成的噪声管线，恢复时零延迟无卡顿） */
  public pauseAmbient() {
    this.isPlayingAmbient = false
    if (this.masterGain && this.ctx) {
      try {
        this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime)
        this.masterGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.04)
      } catch {}
    }
  }

  public stopAmbient() {
    this.isPlayingAmbient = false
    if (this.crackleTimer !== null) {
      window.clearInterval(this.crackleTimer)
      this.crackleTimer = null
    }
    for (const node of this.activeNodes) {
      try {
        if ('stop' in node && typeof (node as any).stop === 'function') {
          ;(node as any).stop()
        }
        node.disconnect()
      } catch {}
    }
    this.activeNodes = []
    if (this.masterGain) {
      try {
        this.masterGain.disconnect()
      } catch {}
      this.masterGain = null
    }
    this.currentType = 'none'
  }

  public setVolume(vol: number) {
    this.currentVolume = Math.max(0, Math.min(1, vol))
    if (this.masterGain && this.ctx && this.isPlayingAmbient) {
      this.masterGain.gain.setTargetAtTime(Math.max(0.0001, this.currentVolume * 0.35), this.ctx.currentTime, 0.08)
    }
  }

  private getOrCreateBuffer(ctx: AudioContext, type: AmbientSoundId): AudioBuffer {
    const cached = this.bufferCache.get(type)
    if (cached && cached.sampleRate === ctx.sampleRate) {
      return cached
    }

    const sampleRate = ctx.sampleRate
    const length = sampleRate * 4
    const buffer = ctx.createBuffer(2, length, sampleRate)

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch)
      if (type === 'brown' || type === 'fireplace') {
        let lastOut = 0
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1
          data[i] = (lastOut + 0.02 * white) / 1.02
          lastOut = data[i]
          data[i] *= 3.2
        }
      } else if (type === 'rain') {
        let b0 = 0, b1 = 0, b2 = 0
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1
          b0 = 0.997 * b0 + white * 0.029
          b1 = 0.985 * b1 + white * 0.032
          b2 = 0.95 * b2 + white * 0.048
          data[i] = (b0 + b1 + b2 + white * 0.12) * 0.55
        }
      } else {
        for (let i = 0; i < length; i++) {
          data[i] = (Math.random() * 2 - 1) * 0.08
        }
      }
    }

    this.bufferCache.set(type, buffer)
    return buffer
  }

  public startAmbient(type: AmbientSoundId, volume: number) {
    this.currentVolume = volume
    if (type === 'none') {
      this.stopAmbient()
      return
    }
    const ctx = this.ensureContext()
    if (!ctx) return

    // 同类型管线已就绪时直接平滑淡入恢复，零重建开销
    if (this.currentType === type && this.masterGain) {
      this.isPlayingAmbient = true
      this.masterGain.gain.cancelScheduledValues(ctx.currentTime)
      this.masterGain.gain.setTargetAtTime(Math.max(0.001, volume * 0.35), ctx.currentTime, 0.08)
      return
    }

    this.stopAmbient()
    this.currentType = type
    this.isPlayingAmbient = true

    const master = ctx.createGain()
    master.gain.setValueAtTime(0.0001, ctx.currentTime)
    master.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.35), ctx.currentTime + 0.45)
    master.connect(ctx.destination)
    this.masterGain = master

    const buffer = this.getOrCreateBuffer(ctx, type)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true

    const filter = ctx.createBiquadFilter()
    if (type === 'rain') {
      filter.type = 'bandpass'
      filter.frequency.value = 1150
      filter.Q.value = 0.55
    } else if (type === 'fireplace') {
      filter.type = 'lowpass'
      filter.frequency.value = 380
    } else if (type === 'brown') {
      filter.type = 'lowpass'
      filter.frequency.value = 260
    } else {
      filter.type = 'highpass'
      filter.frequency.value = 1800
    }

    src.connect(filter)
    filter.connect(master)
    src.start()
    this.activeNodes.push(src, filter)

    if (type === 'fireplace' || type === 'vinyl') {
      this.crackleTimer = window.setInterval(() => {
        if (!this.isPlayingAmbient || !this.ctx || !this.masterGain) return
        if (Math.random() > (type === 'fireplace' ? 0.45 : 0.3)) return
        const now = this.ctx.currentTime
        const clickBuf = this.ctx.createBuffer(1, 220, this.ctx.sampleRate)
        const d = clickBuf.getChannelData(0)
        for (let i = 0; i < d.length; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 35)
        }
        const s = this.ctx.createBufferSource()
        s.buffer = clickBuf
        const bp = this.ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = type === 'fireplace' ? 1400 + Math.random() * 1600 : 2800 + Math.random() * 2200
        const g = this.ctx.createGain()
        g.gain.value = type === 'fireplace' ? 0.35 + Math.random() * 0.4 : 0.16 + Math.random() * 0.2
        s.connect(bp)
        bp.connect(g)
        g.connect(this.masterGain)
        s.start(now)
      }, 280)
    }
  }
}

export const ambientAudio = new AmbientAudioEngine()
