import React, { useEffect, useRef, useState } from 'react'
import { Download, Sparkles, X } from 'lucide-react'
import { getPlatform, notifyToast, registerBackHandler } from '../services/platform'

interface QuoteCardModalProps {
  text: string
  bookTitle: string
  author: string
  chapterTitle: string
  onClose: () => void
}

type CardStyle = 'paper' | 'obsidian' | 'museum'

export const QuoteCardModal: React.FC<QuoteCardModalProps> = ({
  text,
  bookTitle,
  author,
  chapterTitle,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [style, setStyle] = useState<CardStyle>('paper')
  const [savedMsg, setSavedMsg] = useState('')

  useEffect(() => {
    return registerBackHandler(100, () => {
      onClose()
      return true
    })
  }, [onClose])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = 900
    const H = 1200
    canvas.width = W
    canvas.height = H

    const themes: Record<
      CardStyle,
      { bg1: string; bg2: string; frame: string; text: string; muted: string; accent: string }
    > = {
      paper: {
        bg1: '#FBF7EF',
        bg2: '#EFE6D5',
        frame: '#C7B69B',
        text: '#241F1A',
        muted: '#74685A',
        accent: '#B4512A',
      },
      obsidian: {
        bg1: '#181B22',
        bg2: '#0E1014',
        frame: '#4D4231',
        text: '#EFE9DC',
        muted: '#999287',
        accent: '#DF9B48',
      },
      museum: {
        bg1: '#1D332B',
        bg2: '#11201B',
        frame: '#5C7263',
        text: '#F2F0E6',
        muted: '#A8B7AC',
        accent: '#D9B66F',
      },
    }

    const t = themes[style]
    const grad = ctx.createLinearGradient(0, 0, W, H)
    grad.addColorStop(0, t.bg1)
    grad.addColorStop(1, t.bg2)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)

    // 边框装饰
    ctx.strokeStyle = t.frame
    ctx.lineWidth = 2
    ctx.strokeRect(48, 48, W - 96, H - 96)
    ctx.lineWidth = 1
    ctx.strokeRect(58, 58, W - 116, H - 116)

    // 顶部角标
    ctx.fillStyle = t.accent
    ctx.font = '600 22px Georgia, serif'
    ctx.fillText('哲启明思 · 典藏哲学摘录', 96, 126)

    // 引号装饰
    ctx.fillStyle = `${t.accent}33`
    ctx.font = 'bold 140px Georgia, serif'
    ctx.fillText('“', 84, 278)

    // 自动换行排版正文
    const clean = text.trim().slice(0, 260)
    const fontSize = clean.length > 140 ? 32 : clean.length > 70 ? 38 : 44
    const lineHeight = Math.round(fontSize * 1.72)
    ctx.fillStyle = t.text
    ctx.font = `500 ${fontSize}px "Noto Serif SC", "Songti SC", "SimSun", Georgia, serif`

    const maxWidth = W - 192
    const lines: string[] = []
    let cur = ''
    for (const ch of clean) {
      if (ch === '\n') {
        lines.push(cur)
        cur = ''
        continue
      }
      const test = cur + ch
      if (ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur)
        cur = ch
      } else {
        cur = test
      }
    }
    if (cur) lines.push(cur)

    const startY = 300
    lines.slice(0, 12).forEach((ln, idx) => {
      ctx.fillText(ln, 96, startY + idx * lineHeight)
    })

    // 底部分割线与出处
    const footerY = H - 220
    ctx.strokeStyle = t.frame
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(96, footerY)
    ctx.lineTo(W - 96, footerY)
    ctx.stroke()

    ctx.fillStyle = t.text
    ctx.font = '700 30px "Noto Serif SC", "Songti SC", serif'
    ctx.fillText(`《${bookTitle}》`, 96, footerY + 58)

    ctx.fillStyle = t.muted
    ctx.font = '400 24px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(`${author} · ${chapterTitle.slice(0, 24)}`, 96, footerY + 102)

    // 朱红印章
    ctx.strokeStyle = t.accent
    ctx.lineWidth = 3
    ctx.strokeRect(W - 178, footerY + 26, 82, 82)
    ctx.fillStyle = t.accent
    ctx.font = 'bold 28px "Noto Serif SC", serif'
    ctx.fillText('哲启', W - 165, footerY + 62)
    ctx.fillText('明思', W - 165, footerY + 96)
  }, [text, bookTitle, author, chapterTitle, style])

  const handleSave = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')
    const fileName = `哲启明思金句_${bookTitle.slice(0, 12)}_${Date.now().toString().slice(-4)}.png`

    if (getPlatform() === 'electron' && window.electronAPI) {
      const res = await window.electronAPI.saveImageDataUrl(dataUrl, fileName)
      if (res.ok) setSavedMsg('已保存到本地')
      return
    }
    if (getPlatform() === 'android' && window.AndroidBridge) {
      const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
      const ok = window.AndroidBridge.saveImageBase64(b64, fileName)
      setSavedMsg(ok ? '已保存至手机相册' : '保存失败')
      notifyToast(ok ? '金句卡片已保存至相册' : '保存失败')
      return
    }
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = fileName
    a.click()
    setSavedMsg('已开始下载')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-backdrop-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] flex flex-col rounded-2xl border overflow-hidden shadow-2xl animate-sheet-up"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 shrink-0 flex items-center justify-between border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 font-serif font-bold text-sm">
            <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span>哲学金句藏书票</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto overscroll-contain flex flex-col items-center gap-4">
          <canvas
            ref={canvasRef}
            className="w-full max-w-[290px] aspect-[3/4] rounded-xl shadow-lg border"
            style={{ borderColor: 'var(--border)' }}
          />

          <div className="flex items-center gap-2">
            {(
              [
                ['paper', '宣纸朱印'],
                ['obsidian', '松烟鎏金'],
                ['museum', '博物深翠'],
              ] as Array<[CardStyle, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setStyle(id)}
                className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
                style={
                  style === id
                    ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                    : { backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }
                }
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={handleSave}
            className="w-full py-2.5 rounded-xl font-medium text-sm text-white flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <Download className="w-4 h-4" />
            <span>{savedMsg || '保存高清卡片图片 (PNG)'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
