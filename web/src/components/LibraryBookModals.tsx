import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRightLeft,
  BookOpen,
  Check,
  FileText,
  Folder,
  FolderMinus,
  FolderPlus,
  Headphones,
  Heart,
  RotateCcw,
  Search,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { BookCatalogItem, BookLang, UserCollection } from '../types'
import { triggerHaptic } from '../services/platform'
import { BookCover } from './BookCover'

export interface PublicCategoryDef {
  id: string
  shortLabel: string
}

export interface StagedUploadFile {
  name: string
  content: string
  size: number
}

/* ==================== 1. 右键图书菜单（桌面悬浮菜单 / 移动底栏抽屉） ==================== */
interface BookContextMenuProps {
  book: BookCatalogItem
  x: number
  y: number
  isFavorite: boolean
  hasProgress: boolean
  collectionCount?: number
  activeUserCollection: UserCollection | null
  onClose: () => void
  onOpenBook: () => void
  onPlayRadio: () => void
  onToggleFavorite: () => void
  onReclassify: () => void
  onAssignCollections: () => void
  onRemoveFromActiveCollection?: () => void
  onRequestDelete: () => void
}

export const BookContextMenu: React.FC<BookContextMenuProps> = ({
  book,
  x,
  y,
  isFavorite,
  hasProgress,
  collectionCount = 0,
  activeUserCollection,
  onClose,
  onOpenBook,
  onPlayRadio,
  onToggleFavorite,
  onReclassify,
  onAssignCollections,
  onRemoveFromActiveCollection,
  onRequestDelete,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const el = menuRef.current
    if (!el || typeof window === 'undefined') return
    const rect = el.getBoundingClientRect()
    const pad = 12
    const left = Math.max(pad, Math.min(x, window.innerWidth - rect.width - pad))
    const top = Math.max(pad, Math.min(y, window.innerHeight - rect.height - pad))
    setPos({ left, top })
  }, [x, y])

  const run = (fn: () => void) => {
    triggerHaptic()
    onClose()
    fn()
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 md:bg-transparent animate-backdrop-in"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        ref={menuRef}
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-x-0 bottom-0 rounded-t-3xl border-t px-4 pt-2.5 pb-6 safe-bottom shadow-2xl animate-sheet-up md:inset-auto md:w-60 md:rounded-2xl md:border md:p-1.5"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: 'var(--border-strong)',
          boxShadow: 'var(--shadow-float)',
          ...(typeof window !== 'undefined' && window.innerWidth >= 768
            ? { left: `${pos.left}px`, top: `${pos.top}px` }
            : {}),
        }}
      >
        {/* 移动端顶部拖动条 */}
        <div className="flex md:hidden justify-center pb-2.5">
          <span className="w-10 h-1 rounded-full opacity-25" style={{ backgroundColor: 'var(--text)' }} />
        </div>

        {/* 书名头部提示（移动端带迷你封面） */}
        <div className="flex items-center gap-3 px-1 pb-3 md:px-3 md:py-2 border-b mb-2.5 md:mb-1" style={{ borderColor: 'var(--border)' }}>
          <BookCover
            title={book.title}
            author={book.author}
            category={book.category}
            palette={book.coverPalette}
            monogram={book.monogram}
            lang={book.lang === 'en' ? 'en' : 'zh'}
            bilingual={book.bilingual}
            size="xxs"
            className="shrink-0 md:hidden"
          />
          <div className="min-w-0 flex-1">
            <div className="font-serif font-bold text-sm md:text-xs truncate">{book.title}</div>
            <div className="text-[11px] md:text-[10px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {book.author} · {book.category}
            </div>
          </div>
          <button
            onClick={onClose}
            className="md:hidden w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
            aria-label="关闭菜单"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 移动端双列主快捷操作：阅读 + 电台收听 */}
        <div className="grid grid-cols-2 gap-2 mb-2.5 md:hidden">
          <button
            onClick={() => run(onOpenBook)}
            className="px-3 py-2.5 rounded-2xl flex items-center justify-center gap-2 text-xs font-semibold text-white active:scale-[0.98] transition-transform shadow-sm"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <BookOpen className="w-4 h-4 shrink-0" />
            <span>{hasProgress ? '继续阅读' : '开始阅读'}</span>
          </button>
          <button
            onClick={() => run(onPlayRadio)}
            className="px-3 py-2.5 rounded-2xl border flex items-center justify-center gap-2 text-xs font-semibold active:scale-[0.98] transition-transform"
            style={{
              backgroundColor: 'var(--bg)',
              borderColor: 'var(--border-strong)',
              color: 'var(--text)',
            }}
          >
            <Headphones className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
            <span>电台收听</span>
          </button>
        </div>

        <div className="space-y-0.5 text-[13px] md:text-xs">
          <button
            onClick={() => run(onOpenBook)}
            className="hidden md:flex w-full px-3 py-2 rounded-xl items-center gap-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 text-left"
          >
            <BookOpen className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <span className="font-medium">{hasProgress ? '继续阅读' : '开始阅读'}</span>
          </button>

          <button
            onClick={() => run(onPlayRadio)}
            className="hidden md:flex w-full px-3 py-2 rounded-xl items-center gap-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 text-left"
          >
            <Headphones className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <span>电台收听本书</span>
          </button>

          <button
            onClick={() => run(onAssignCollections)}
            className="w-full px-3 py-3 md:py-2 rounded-xl flex items-center justify-between gap-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.99] text-left"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <FolderPlus className="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" style={{ color: 'var(--gold)' }} />
              <span className="font-medium md:font-normal">加入自建合集…</span>
            </span>
            {collectionCount > 0 && (
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                已入 {collectionCount} 个
              </span>
            )}
          </button>

          {activeUserCollection && onRemoveFromActiveCollection && (
            <button
              onClick={() => run(onRemoveFromActiveCollection)}
              className="w-full px-3 py-3 md:py-2 rounded-xl flex items-center gap-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.99] text-left"
            >
              <FolderMinus className="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
              <span className="truncate">移出「{activeUserCollection.name}」</span>
            </button>
          )}

          <button
            onClick={() => run(onToggleFavorite)}
            className="w-full px-3 py-3 md:py-2 rounded-xl flex items-center gap-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.99] text-left"
          >
            <Heart
              className={`w-4 h-4 md:w-3.5 md:h-3.5 shrink-0 ${isFavorite ? 'fill-rose-500 text-rose-500' : ''}`}
              style={!isFavorite ? { color: 'var(--text-secondary)' } : undefined}
            />
            <span>{isFavorite ? '取消收藏' : '加入收藏'}</span>
          </button>

          <button
            onClick={() => run(onReclassify)}
            className="w-full px-3 py-3 md:py-2 rounded-xl flex items-center gap-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.99] text-left"
          >
            <Tag className="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <span>自由归类 / 编辑信息…</span>
          </button>

          <div className="my-1.5 md:my-1 border-t" style={{ borderColor: 'var(--border)' }} />

          <button
            onClick={() => run(onRequestDelete)}
            className="w-full px-3 py-3 md:py-2 rounded-xl flex items-center gap-2.5 transition-colors hover:bg-red-500/10 active:scale-[0.99] text-left text-red-500"
          >
            <Trash2 className="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" />
            <span className="font-medium">{book.isCustom ? '删除本地导入图书…' : '从书架删除图书…'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/* ==================== 2. 自由上传并归类图书弹窗（支持多选/拖拽） ==================== */
interface UploadBookModalProps {
  initialZone: BookLang
  initialCategory: string
  initialCollectionIds: string[]
  zhCategories: PublicCategoryDef[]
  enCategories: PublicCategoryDef[]
  userCollections: UserCollection[]
  onClose: () => void
  onSubmit: (payload: {
    files: StagedUploadFile[]
    zone: BookLang
    category: string
    collectionIds: string[]
    customTitle?: string
    customAuthor?: string
  }) => Promise<void>
}

export const UploadBookModal: React.FC<UploadBookModalProps> = ({
  initialZone,
  initialCategory,
  initialCollectionIds,
  zhCategories,
  enCategories,
  userCollections,
  onClose,
  onSubmit,
}) => {
  const [zone, setZone] = useState<BookLang>(initialZone)
  const catList = zone === 'en' ? enCategories : zhCategories
  const [category, setCategory] = useState<string>(() => {
    const initialList = initialZone === 'en' ? enCategories : zhCategories
    return initialList.some((c) => c.id === initialCategory) ? initialCategory : initialList[0]?.id || '我的导入书架'
  })
  const [collectionIds, setCollectionIds] = useState<string[]>(initialCollectionIds)
  const [files, setFiles] = useState<StagedUploadFile[]>([])
  const [customTitle, setCustomTitle] = useState('')
  const [customAuthor, setCustomAuthor] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const pickerRef = useRef<HTMLInputElement | null>(null)

  const handleZoneChange = (next: BookLang) => {
    setZone(next)
    const nextList = next === 'en' ? enCategories : zhCategories
    if (!nextList.some((c) => c.id === category)) {
      setCategory(nextList[0]?.id || '我的导入书架')
    }
  }

  const readFileList = async (list: FileList | File[]) => {
    const arr = Array.from(list).filter((f) => /\.(md|markdown|txt)$/i.test(f.name))
    if (arr.length === 0) return
    const loaded: StagedUploadFile[] = []
    for (const f of arr) {
      const content = await f.text()
      loaded.push({ name: f.name, content, size: f.size })
    }
    setFiles((prev) => {
      const merged = [...prev, ...loaded]
      if (merged.length === 1 && !customTitle) {
        setCustomTitle(merged[0].name.replace(/\.(md|markdown|txt)$/i, '').trim())
      }
      return merged
    })
  }

  const toggleCol = (cid: string) => {
    setCollectionIds((prev) => (prev.includes(cid) ? prev.filter((id) => id !== cid) : [...prev, cid]))
  }

  const handleConfirm = async () => {
    if (files.length === 0 || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({
        files,
        zone,
        category,
        collectionIds,
        customTitle: files.length === 1 ? customTitle.trim() : undefined,
        customAuthor: customAuthor.trim() || undefined,
      })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-[2px] p-0 sm:p-4 animate-backdrop-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border p-5 pt-3 pb-7 sm:p-6 shadow-2xl space-y-4 animate-sheet-up safe-bottom"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
      >
        <div className="flex sm:hidden justify-center pb-1">
          <span className="w-10 h-1 rounded-full opacity-25" style={{ backgroundColor: 'var(--text)' }} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <div>
              <h3 className="font-serif font-bold text-base">上传图书并自由归类</h3>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                支持 .md / .txt 文本，可批量导入至任意公共分类与自建合集
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 文件拖拽与选择区 */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            if (e.dataTransfer.files?.length) readFileList(e.dataTransfer.files)
          }}
          onClick={() => pickerRef.current?.click()}
          className="rounded-2xl border-2 border-dashed p-5 text-center cursor-pointer transition-all"
          style={{
            borderColor: dragOver ? 'var(--accent)' : 'var(--border-strong)',
            backgroundColor: dragOver ? 'var(--accent-soft)' : 'var(--bg)',
          }}
        >
          <Upload className="w-6 h-6 mx-auto mb-1.5" style={{ color: 'var(--accent)' }} />
          <div className="text-xs font-semibold">点击选择文件，或将 .md / .txt 拖入此处</div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            支持一次多选批量上传，自动按标题切分目录
          </div>
          <input
            ref={pickerRef}
            type="file"
            multiple
            accept=".md,.markdown,.txt"
            onChange={(e) => {
              if (e.target.files?.length) readFileList(e.target.files)
              e.target.value = ''
            }}
            className="hidden"
          />
        </div>

        {/* 已选文件列表 */}
        {files.length > 0 && (
          <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
            {files.map((f, idx) => (
              <div
                key={`${f.name}_${idx}`}
                className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border text-xs"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                  <span className="truncate font-medium">{f.name}</span>
                  <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {f.size >= 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`}
                  </span>
                </div>
                <button
                  onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                  className="p-0.5 hover:text-red-500"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 单文件时支持自定义书名与作者；多文件时支持统一作者 */}
        {files.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {files.length === 1 && (
              <div className="space-y-1">
                <label className="text-[11px] font-medium block" style={{ color: 'var(--text-secondary)' }}>
                  书名（可编辑）
                </label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="默认取文件名"
                  className="w-full rounded-xl border px-3 py-2 text-xs outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
                />
              </div>
            )}
            <div className={`space-y-1 ${files.length > 1 ? 'sm:col-span-2' : ''}`}>
              <label className="text-[11px] font-medium block" style={{ color: 'var(--text-secondary)' }}>
                作者（选填）
              </label>
              <input
                type="text"
                value={customAuthor}
                onChange={(e) => setCustomAuthor(e.target.value)}
                placeholder="例如：阿多诺、黑格尔、齐泽克…"
                className="w-full rounded-xl border px-3 py-2 text-xs outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
              />
            </div>
          </div>
        )}

        {/* 语言分区选择 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium block" style={{ color: 'var(--text-secondary)' }}>
            1. 归属语言分区
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: 'zh' as const, label: '中文区', desc: '中文原典 / 中英对照' },
                { id: 'en' as const, label: '英文区', desc: 'English / 外文原著' },
              ] as const
            ).map((opt) => {
              const active = zone === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleZoneChange(opt.id)}
                  className="p-2.5 rounded-xl border text-left transition-all"
                  style={
                    active
                      ? { backgroundColor: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' }
                      : { backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }
                  }
                >
                  <div className="text-xs font-semibold">{opt.label}</div>
                  <div className="text-[10px] opacity-75 mt-0.5">{opt.desc}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* 公共学派分类选择 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium block" style={{ color: 'var(--text-secondary)' }}>
            2. 归属公共合集分类
          </label>
          <div className="flex flex-wrap gap-1.5">
            {catList.map((c) => {
              const active = category === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className="px-2.5 py-1.5 rounded-xl text-xs border transition-all active:scale-95"
                  style={
                    active
                      ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 600 }
                      : { backgroundColor: 'var(--bg)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }
                  }
                >
                  {c.shortLabel}
                </button>
              )
            })}
          </div>
        </div>

        {/* 可选同时加入自建合集 */}
        {userCollections.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium block" style={{ color: 'var(--text-secondary)' }}>
              3. 同时收入自建合集（可选）
            </label>
            <div className="flex flex-wrap gap-1.5">
              {userCollections.map((col) => {
                const checked = collectionIds.includes(col.id)
                return (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => toggleCol(col.id)}
                    className="px-2.5 py-1.5 rounded-full text-xs border flex items-center gap-1.5 transition-all active:scale-95"
                    style={
                      checked
                        ? { backgroundColor: 'var(--gold)', color: '#fff', borderColor: 'var(--gold)', fontWeight: 600 }
                        : { backgroundColor: 'var(--bg)', color: 'var(--text)', borderColor: 'var(--border-strong)' }
                    }
                  >
                    <Folder className="w-3 h-3 shrink-0" />
                    <span>{col.name}</span>
                    {checked && <Check className="w-3 h-3 shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium border"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
          >
            取消
          </button>
          <button
            disabled={files.length === 0 || submitting}
            onClick={handleConfirm}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-sm disabled:opacity-40 active:scale-95"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {submitting ? '正在导入…' : `确认上传并归类${files.length > 0 ? ` (${files.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ==================== 3. 单书自由归类与信息编辑弹窗 ==================== */
interface ReclassifyBookModalProps {
  book: BookCatalogItem
  hasOverride: boolean
  zhCategories: PublicCategoryDef[]
  enCategories: PublicCategoryDef[]
  onClose: () => void
  onSave: (patch: { lang: BookLang; category: string; title: string; author: string }) => Promise<void>
  onResetDefault?: () => void
}

export const ReclassifyBookModal: React.FC<ReclassifyBookModalProps> = ({
  book,
  hasOverride,
  zhCategories,
  enCategories,
  onClose,
  onSave,
  onResetDefault,
}) => {
  const [lang, setLang] = useState<BookLang>(book.lang === 'en' ? 'en' : 'zh')
  const [category, setCategory] = useState<string>(book.category)
  const [title, setTitle] = useState<string>(book.title)
  const [author, setAuthor] = useState<string>(book.author)
  const [saving, setSaving] = useState(false)

  const catList = lang === 'en' ? enCategories : zhCategories

  const handleZoneSwitch = (next: BookLang) => {
    setLang(next)
    const list = next === 'en' ? enCategories : zhCategories
    if (!list.some((c) => c.id === category)) {
      setCategory(list[0]?.id || '我的导入书架')
    }
  }

  const handleSubmit = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave({
        lang,
        category,
        title: title.trim() || book.title,
        author: author.trim() || book.author,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-[2px] p-0 sm:p-4 animate-backdrop-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border p-5 pt-3 pb-7 sm:p-6 shadow-2xl space-y-4 animate-sheet-up safe-bottom"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
      >
        <div className="flex sm:hidden justify-center pb-1">
          <span className="w-10 h-1 rounded-full opacity-25" style={{ backgroundColor: 'var(--text)' }} />
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Tag className="w-5 h-5 shrink-0" style={{ color: 'var(--gold)' }} />
            <div className="min-w-0">
              <h3 className="font-serif font-bold text-base">自由归类与图书信息</h3>
              <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                可将本书自由归入中文区或英文区任意公共合集
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2.5">
          <div className="space-y-1">
            <label className="text-[11px] font-medium block" style={{ color: 'var(--text-secondary)' }}>
              书名
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-xs outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium block" style={{ color: 'var(--text-secondary)' }}>
              作者
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-xs outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium block" style={{ color: 'var(--text-secondary)' }}>
            所属分区
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: 'zh' as const, label: '中文区' },
                { id: 'en' as const, label: '英文区' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleZoneSwitch(opt.id)}
                className="py-2 rounded-xl border text-xs font-semibold transition-all"
                style={
                  lang === opt.id
                    ? { backgroundColor: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' }
                    : { backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium block" style={{ color: 'var(--text-secondary)' }}>
            目标公共分类
          </label>
          <div className="flex flex-wrap gap-1.5">
            {catList.map((c) => {
              const active = category === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className="px-2.5 py-1.5 rounded-xl text-xs border transition-all active:scale-95"
                  style={
                    active
                      ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 600 }
                      : { backgroundColor: 'var(--bg)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }
                  }
                >
                  {c.shortLabel}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
          {!book.isCustom && hasOverride && onResetDefault ? (
            <button
              type="button"
              onClick={() => {
                onResetDefault()
                onClose()
              }}
              className="px-2.5 py-1.5 rounded-xl text-[11px] font-medium border flex items-center gap-1 hover:opacity-80"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
            >
              <RotateCcw className="w-3 h-3" />
              <span>恢复默认</span>
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium border"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
            >
              取消
            </button>
            <button
              disabled={saving}
              onClick={handleSubmit}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-sm active:scale-95"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              保存归类
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ==================== 4. 公共合集批量归类管理弹窗 ==================== */
interface PublicCategoryManagerModalProps {
  categoryId: string
  zone: BookLang
  books: BookCatalogItem[]
  onClose: () => void
  onMoveBookToCategory: (book: BookCatalogItem, targetZone: BookLang, targetCategory: string) => Promise<void>
  onOpenUploadHere: () => void
}

export const PublicCategoryManagerModal: React.FC<PublicCategoryManagerModalProps> = ({
  categoryId,
  zone,
  books,
  onClose,
  onMoveBookToCategory,
  onOpenUploadHere,
}) => {
  const [query, setQuery] = useState('')
  const [filterZone, setFilterZone] = useState<'all' | 'zh' | 'en'>(zone)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return books
      .filter((b) => {
        const bl: BookLang = b.lang === 'en' ? 'en' : 'zh'
        if (filterZone !== 'all' && bl !== filterZone) return false
        if (!q) return true
        return (
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const aIn = a.category === categoryId && (a.lang === 'en' ? 'en' : 'zh') === zone ? 0 : 1
        const bIn = b.category === categoryId && (b.lang === 'en' ? 'en' : 'zh') === zone ? 0 : 1
        return aIn - bIn
      })
  }, [books, query, filterZone, categoryId, zone])

  const currentCount = books.filter(
    (b) => b.category === categoryId && (b.lang === 'en' ? 'en' : 'zh') === zone
  ).length

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-[2px] p-0 sm:p-4 animate-backdrop-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl h-[84vh] sm:h-[78vh] rounded-t-3xl sm:rounded-2xl border p-4 pt-3 sm:p-5 shadow-2xl flex flex-col gap-3 animate-sheet-up safe-bottom"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
      >
        <div className="flex sm:hidden justify-center">
          <span className="w-10 h-1 rounded-full opacity-25" style={{ backgroundColor: 'var(--text)' }} />
        </div>
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <h3 className="font-serif font-bold text-base truncate flex items-center gap-1.5">
              <ArrowRightLeft className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
              <span>公共合集自由归类 · {categoryId}</span>
            </h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              点击任意书籍即可将其一键归入本分类（当前共 {currentCount} 部）
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => {
                onClose()
                onOpenUploadHere()
              }}
              className="px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1"
              style={{ borderColor: 'var(--accent)', color: 'var(--accent)', backgroundColor: 'var(--accent-soft)' }}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>上传新书</span>
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              完成
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            className="flex-1 min-w-[180px] flex items-center rounded-xl border px-3 py-1.5"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-strong)' }}
          >
            <Search className="w-3.5 h-3.5 mr-2 shrink-0" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索书名、作者或原分类…"
              className="w-full bg-transparent outline-none text-xs"
              style={{ color: 'var(--text)' }}
            />
            {query && (
              <button onClick={() => setQuery('')}>
                <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              </button>
            )}
          </div>
          <div
            className="inline-flex rounded-xl border p-0.5 text-[11px]"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            {(
              [
                ['all', '全部'],
                ['zh', '中文区'],
                ['en', '英文区'],
              ] as const
            ).map(([zid, lbl]) => (
              <button
                key={zid}
                onClick={() => setFilterZone(zid)}
                className="px-2.5 py-1 rounded-lg font-medium"
                style={
                  filterZone === zid
                    ? { backgroundColor: 'var(--accent)', color: '#fff' }
                    : { color: 'var(--text-secondary)' }
                }
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
          {list.map((b) => {
            const bLang: BookLang = b.lang === 'en' ? 'en' : 'zh'
            const inHere = b.category === categoryId && bLang === zone
            return (
              <div
                key={b.id}
                className="px-3 py-2.5 rounded-xl border flex items-center justify-between gap-3"
                style={
                  inHere
                    ? { backgroundColor: 'var(--accent-soft)', borderColor: 'var(--accent)' }
                    : { backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        backgroundColor: bLang === 'en' ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                        color: bLang === 'en' ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                    >
                      {bLang === 'en' ? 'EN' : '中'}
                    </span>
                    <span className="font-serif font-semibold text-xs sm:text-sm truncate">{b.title}</span>
                  </div>
                  <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                    {b.author} · 当前：{b.category}
                  </div>
                </div>
                {inHere ? (
                  <span
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-lg shrink-0 flex items-center gap-1"
                    style={{ color: 'var(--accent)' }}
                  >
                    <Check className="w-3.5 h-3.5" /> 已在此分类
                  </span>
                ) : (
                  <button
                    onClick={() => onMoveBookToCategory(b, zone, categoryId)}
                    className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border shrink-0 transition-all active:scale-95"
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderColor: 'var(--accent)',
                      color: 'var(--accent)',
                    }}
                  >
                    归入此分类
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ==================== 5. 删除图书确认弹窗 ==================== */
interface DeleteBookConfirmModalProps {
  book: BookCatalogItem
  onClose: () => void
  onConfirm: () => Promise<void>
}

export const DeleteBookConfirmModal: React.FC<DeleteBookConfirmModalProps> = ({
  book,
  onClose,
  onConfirm,
}) => {
  const [deleting, setDeleting] = useState(false)
  return (
    <div
      className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px] p-0 sm:p-4 animate-backdrop-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl border p-5 pt-3 pb-7 sm:p-6 shadow-2xl space-y-4 animate-sheet-up safe-bottom"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
      >
        <div className="flex sm:hidden justify-center">
          <span className="w-10 h-1 rounded-full opacity-25" style={{ backgroundColor: 'var(--text)' }} />
        </div>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/12 text-red-500 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-serif font-bold text-base">确认删除图书？</h3>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              即将{book.isCustom ? '彻底删除本地导入图书' : '从书架移除内置典籍'}
              <strong className="mx-1" style={{ color: 'var(--text)' }}>
                《{book.title}》
              </strong>
              。
              {book.isCustom
                ? '删除后本地文本数据将无法恢复。'
                : '移除后不再出现在书架与检索中，如需找回可随时在「已移除典籍」中一键恢复。'}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium border"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
          >
            取消
          </button>
          <button
            disabled={deleting}
            onClick={async () => {
              setDeleting(true)
              try {
                await onConfirm()
                onClose()
              } finally {
                setDeleting(false)
              }
            }}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 text-white active:scale-95 disabled:opacity-50"
          >
            {deleting ? '正在删除…' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ==================== 6. 已移除内置典籍回收站弹窗 ==================== */
interface RecycleBinModalProps {
  removedBooks: BookCatalogItem[]
  onClose: () => void
  onRestoreOne: (bookId: string) => void
  onRestoreAll: () => void
}

export const RecycleBinModal: React.FC<RecycleBinModalProps> = ({
  removedBooks,
  onClose,
  onRestoreOne,
  onRestoreAll,
}) => (
  <div
    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-[2px] p-0 sm:p-4 animate-backdrop-in"
    onClick={onClose}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      className="w-full sm:max-w-lg max-h-[82vh] rounded-t-3xl sm:rounded-2xl border p-5 pt-3 pb-7 sm:p-6 shadow-2xl flex flex-col gap-3 animate-sheet-up safe-bottom"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
    >
      <div className="flex sm:hidden justify-center">
        <span className="w-10 h-1 rounded-full opacity-25" style={{ backgroundColor: 'var(--text)' }} />
      </div>
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div>
          <h3 className="font-serif font-bold text-base">已移除的内置典籍 ({removedBooks.length})</h3>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            随时可将已删除的内置图书恢复至书架
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {removedBooks.length > 1 && (
            <button
              onClick={() => {
                onRestoreAll()
                onClose()
              }}
              className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              全部恢复
            </button>
          )}
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
        {removedBooks.map((b) => (
          <div
            key={b.id}
            className="px-3 py-2.5 rounded-xl border flex items-center justify-between gap-3"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <div className="min-w-0 flex-1">
              <div className="font-serif font-semibold text-xs sm:text-sm truncate">{b.title}</div>
              <div className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {b.author} · {b.category}
              </div>
            </div>
            <button
              onClick={() => onRestoreOne(b.id)}
              className="px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1 shrink-0 active:scale-95"
              style={{ borderColor: 'var(--accent)', color: 'var(--accent)', backgroundColor: 'var(--accent-soft)' }}
            >
              <RotateCcw className="w-3 h-3" />
              <span>恢复</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  </div>
)
