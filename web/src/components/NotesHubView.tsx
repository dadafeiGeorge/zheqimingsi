import React, { useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Bookmark,
  Clock,
  Download,
  HardDriveDownload,
  HardDriveUpload,
  Headphones,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { BookmarkItem, HighlightItem, StudyStats } from '../types'
import { QuoteCardModal } from './QuoteCardModal'
import { exportTextFile, notifyToast, triggerHaptic } from '../services/platform'
import { exportFullBackupJson, importFullBackupJson } from '../services/storage'

interface NotesHubViewProps {
  highlights: HighlightItem[]
  bookmarks: BookmarkItem[]
  stats: StudyStats
  onDeleteHighlight: (id: string) => void
  onDeleteBookmark: (id: string) => void
  onJumpTo: (bookId: string, chapterIndex: number, blockIndex: number) => void
  onDataImported: () => void
}

export const NotesHubView: React.FC<NotesHubViewProps> = ({
  highlights,
  bookmarks,
  stats,
  onDeleteHighlight,
  onDeleteBookmark,
  onJumpTo,
  onDataImported,
}) => {
  const [subTab, setSubTab] = useState<'highlights' | 'bookmarks'>('highlights')
  const [quoteItem, setQuoteItem] = useState<HighlightItem | null>(null)
  const backupInputRef = useRef<HTMLInputElement | null>(null)

  // 将同 groupId 的跨段落划线合并展示为一条完整摘录
  const displayHighlights = useMemo(() => {
    const seen = new Set<string>()
    const out: HighlightItem[] = []
    for (const h of highlights) {
      if (h.groupId) {
        if (seen.has(h.groupId)) continue
        seen.add(h.groupId)
        const groupParts = highlights
          .filter((x) => x.groupId === h.groupId)
          .sort((a, b) => a.blockIndex - b.blockIndex)
        const head = groupParts[0]
        const noteText = groupParts.find((x) => x.note)?.note || head.note
        out.push({
          ...head,
          text: groupParts.map((x) => x.text).join('\n'),
          note: noteText,
        })
      } else {
        out.push(h)
      }
    }
    return out
  }, [highlights])

  const formatDuration = (secs: number) => {
    const mins = Math.round(secs / 60)
    if (mins < 60) return `${mins} 分钟`
    return `${(mins / 60).toFixed(1)} 小时`
  }

  // 最近 7 日阅读与听书趋势
  const last7Days = useMemo(() => {
    const days: Array<{ label: string; readMin: number; listenMin: number }> = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      const key = d.toISOString().slice(0, 10)
      const rec = stats.dailyMap[key] || { read: 0, listen: 0 }
      days.push({
        label: key.slice(5),
        readMin: Math.round(rec.read / 60),
        listenMin: Math.round(rec.listen / 60),
      })
    }
    return days
  }, [stats])

  const maxDayMin = Math.max(10, ...last7Days.map((d) => d.readMin + d.listenMin))

  const handleExportMarkdown = async () => {
    const lines: string[] = [
      '# 哲启明思阅读笔记与金句摘录',
      '',
      `> 导出时间：${new Date().toLocaleString()} · 共 ${displayHighlights.length} 条摘录，${bookmarks.length} 个书签`,
      '',
    ]
    for (const h of displayHighlights) {
      lines.push(`## 《${h.bookTitle}》· ${h.chapterTitle}`)
      lines.push(`> ${h.text.replace(/\n/g, '\n> ')}`)
      if (h.note) lines.push(`- **批注**：${h.note}`)
      lines.push('')
    }
    const md = lines.join('\n')
    const fileName = `哲启明思哲学笔记_${new Date().toISOString().slice(0, 10)}.md`
    const res = await exportTextFile(md, fileName, 'text/markdown;charset=utf-8')
    if (res.ok) {
      notifyToast(res.path ? `已保存笔记至 ${res.path}` : '已导出 Markdown 笔记文件')
    } else if (!res.cancelled) {
      notifyToast(`导出笔记失败：${res.error || '请检查存储空间'}`)
    }
  }

  const handleExportJsonBackup = async () => {
    const json = exportFullBackupJson()
    const fileName = `哲启明思学习档案备份_${new Date().toISOString().slice(0, 10)}.json`
    const res = await exportTextFile(json, fileName, 'application/json;charset=utf-8')
    if (res.ok) {
      notifyToast(
        res.path
          ? `已保存全量备份至 ${res.path}`
          : '已导出全量学习档案（进度·划线·批注·书签·设置）'
      )
    } else if (!res.cancelled) {
      notifyToast(`导出备份失败：${res.error || '请检查存储空间'}`)
    }
  }

  const handleImportJsonBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const raw = await file.text()
      const res = importFullBackupJson(raw)
      onDataImported()
      notifyToast(
        `已智能合并恢复档案：共 ${res.highlights} 条批注、${res.bookmarks} 个书签、${res.booksProgress} 册阅读进度`
      )
    } catch (err: any) {
      notifyToast(err?.message || '导入失败：备份文件格式无效')
    }
  }

  return (
    <div className="h-full overflow-y-auto overscroll-contain px-3.5 md:px-8 pt-3 md:pt-5 pb-28 md:pb-36">
      <div className="max-w-5xl mx-auto space-y-4 md:space-y-6">
        {/* 标题与导出/跨端备份恢复 */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2.5 sm:gap-3">
          <div>
            <p className="hidden sm:block text-[11px] font-mono tracking-[0.2em] uppercase" style={{ color: 'var(--accent)' }}>
              MARGINALIA & STUDY ANALYTICS
            </p>
            <h1 className="text-lg sm:text-2xl font-serif font-bold mt-0.5 sm:mt-1">思想笔记与书房足迹</h1>
          </div>

          <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-2">
            <button
              onClick={handleExportMarkdown}
              disabled={displayHighlights.length === 0}
              className="px-2.5 sm:px-3 py-2 rounded-xl border text-[11px] sm:text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-40 hover:opacity-85 active:scale-95"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">导出 MD</span>
            </button>

            <button
              onClick={handleExportJsonBackup}
              className="px-2.5 sm:px-3 py-2 rounded-xl border text-[11px] sm:text-xs font-medium flex items-center justify-center gap-1 hover:opacity-85 active:scale-95"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)', color: 'var(--accent)' }}
              title="将全部阅读进度、划线批注、书签、收藏与电台配置导出为 JSON，供 PC 与手机间同步恢复"
            >
              <HardDriveDownload className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">导出备份</span>
            </button>

            <button
              onClick={() => backupInputRef.current?.click()}
              className="px-2.5 sm:px-3 py-2 rounded-xl border text-[11px] sm:text-xs font-medium flex items-center justify-center gap-1 hover:opacity-85 active:scale-95"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
              title="从备份 JSON 文件智能合并恢复学习档案（不覆盖更新的进度）"
            >
              <HardDriveUpload className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">导入恢复</span>
            </button>
            <input
              ref={backupInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportJsonBackup}
              className="hidden"
            />
          </div>
        </div>

        {/* 统计卡片 */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3">
          {[
            { icon: <Clock className="w-3.5 h-3.5 md:w-4 md:h-4" />, label: '累计阅读', value: formatDuration(stats.totalReadSeconds) },
            { icon: <Headphones className="w-3.5 h-3.5 md:w-4 md:h-4" />, label: '电台收听', value: formatDuration(stats.totalListenSeconds) },
            { icon: <BookOpen className="w-3.5 h-3.5 md:w-4 md:h-4" />, label: '涉猎典籍', value: `${stats.booksOpened.length} 部` },
            { icon: <Sparkles className="w-3.5 h-3.5 md:w-4 md:h-4" />, label: '金句批注', value: `${displayHighlights.length} 条` },
          ].map((item, idx) => (
            <div
              key={idx}
              className="p-3 md:p-4 rounded-2xl border"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-1.5 text-[11px] md:text-xs" style={{ color: 'var(--accent)' }}>
                {item.icon}
                <span>{item.label}</span>
              </div>
              <div className="text-lg md:text-xl font-serif font-bold mt-1.5 md:mt-2">{item.value}</div>
            </div>
          ))}
        </section>

        {/* 近7日书房学习趋势图 */}
        <section
          className="p-4 rounded-2xl border"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between mb-3 text-xs">
            <span className="font-semibold">近 7 日阅读与电台听书分布</span>
            <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <span className="flex items-center gap-1">
                <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: 'var(--accent)' }} /> 阅读
              </span>
              <span className="flex items-center gap-1">
                <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: 'var(--gold)' }} /> 电台
              </span>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-2 h-24 items-end">
            {last7Days.map((d) => {
              const total = d.readMin + d.listenMin
              const rH = Math.round((d.readMin / maxDayMin) * 100)
              const lH = Math.round((d.listenMin / maxDayMin) * 100)
              return (
                <div key={d.label} className="flex flex-col items-center gap-1.5 h-full justify-end">
                  <div className="w-full max-w-[28px] flex-1 flex flex-col justify-end gap-0.5">
                    {lH > 0 && (
                      <div className="w-full rounded-t" style={{ height: `${Math.max(6, lH)}%`, backgroundColor: 'var(--gold)' }} />
                    )}
                    {rH > 0 && (
                      <div className="w-full rounded-b" style={{ height: `${Math.max(6, rH)}%`, backgroundColor: 'var(--accent)' }} />
                    )}
                    {total === 0 && (
                      <div className="w-full h-1 rounded-full opacity-25" style={{ backgroundColor: 'var(--text-muted)' }} />
                    )}
                  </div>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    {d.label}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        {/* 摘录 / 书签切换 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              triggerHaptic()
              setSubTab('highlights')
            }}
            className="px-3.5 md:px-4 py-1.5 md:py-2 rounded-full text-xs font-semibold border transition-colors active:scale-95"
            style={
              subTab === 'highlights'
                ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                : { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }
            }
          >
            划线与批注 ({displayHighlights.length})
          </button>
          <button
            onClick={() => {
              triggerHaptic()
              setSubTab('bookmarks')
            }}
            className="px-3.5 md:px-4 py-1.5 md:py-2 rounded-full text-xs font-semibold border transition-colors active:scale-95"
            style={
              subTab === 'bookmarks'
                ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                : { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }
            }
          >
            章节书签 ({bookmarks.length})
          </button>
        </div>

        {/* 列表内容 */}
        {subTab === 'highlights' ? (
          displayHighlights.length === 0 ? (
            <div className="py-16 text-center" style={{ color: 'var(--text-muted)' }}>
              <p className="font-serif text-sm">尚无哲学摘录，在阅读器手动划词选中任意语句进行划线或批注，或在电台点击「摘录此段」即可收藏。</p>
            </div>
          ) : (
            <div className="space-y-3">
              {displayHighlights.map((h) => (
                <div
                  key={h.id}
                  className="p-4 rounded-2xl border space-y-2.5"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
                >
                  <p className={`font-serif text-sm leading-relaxed hl-${h.color} ${h.style === 'underline' ? 'hl-style-underline' : 'hl-style-highlight'} inline whitespace-pre-line`}>{h.text}</p>
                  {h.note && (
                    <div
                      className="text-xs px-3 py-2 rounded-lg"
                      style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                    >
                      📝 {h.note}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border)' }}>
                    <button
                      onClick={() => onJumpTo(h.bookId, h.chapterIndex, h.blockIndex)}
                      className="font-serif hover:underline text-left"
                      style={{ color: 'var(--accent)' }}
                    >
                      《{h.bookTitle}》 · {h.chapterTitle}
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setQuoteItem(h)}
                        className="px-2.5 py-1 rounded-lg border text-[11px] hover:opacity-80"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        生成卡片
                      </button>
                      <button
                        onClick={() => onDeleteHighlight(h.id)}
                        className="p-1.5 rounded-lg hover:text-red-500"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : bookmarks.length === 0 ? (
          <div className="py-16 text-center" style={{ color: 'var(--text-muted)' }}>
            <Bookmark className="w-8 h-8 mx-auto opacity-30 mb-2" />
            <p className="font-serif text-sm">尚无书签，阅读时点击右上角书签图标即可标记。</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {bookmarks.map((bm) => (
              <div
                key={bm.id}
                onClick={() => onJumpTo(bm.bookId, bm.chapterIndex, bm.blockIndex)}
                className="p-4 rounded-2xl border flex items-center justify-between gap-3 cursor-pointer hover:opacity-90"
                style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
              >
                <div className="min-w-0">
                  <div className="font-serif font-bold text-sm truncate">
                    《{bm.bookTitle}》 · {bm.chapterTitle}
                  </div>
                  <p className="text-xs line-clamp-1 mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {bm.excerpt}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteBookmark(bm.id)
                  }}
                  className="p-2 rounded-lg hover:text-red-500 shrink-0"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <footer
          className="pt-4 pb-2 text-center text-[11px] font-mono tracking-wider opacity-60"
          style={{ color: 'var(--text-muted)' }}
        >
          哲启明思 · PHILO FM · v1.2.0 (2026.11.27)
        </footer>
      </div>

      {quoteItem && (
        <QuoteCardModal
          text={quoteItem.text}
          bookTitle={quoteItem.bookTitle}
          author={quoteItem.author}
          chapterTitle={quoteItem.chapterTitle}
          onClose={() => setQuoteItem(null)}
        />
      )}
    </div>
  )
}
