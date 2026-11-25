import React from 'react'

interface BookCoverProps {
  title: string
  author: string
  category: string
  palette: string
  monogram?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const PALETTE_STYLES: Record<string, { bg: string; accent: string; text: string; spine: string }> = {
  'obsidian-gold': {
    bg: 'linear-gradient(155deg, #1f232b 0%, #111419 100%)',
    accent: '#d8a657',
    text: '#f2ece1',
    spine: '#0a0c10',
  },
  'prussian-navy': {
    bg: 'linear-gradient(155deg, #1b2c42 0%, #101b2a 100%)',
    accent: '#d4b47c',
    text: '#eef1f5',
    spine: '#0b121d',
  },
  'forest-brass': {
    bg: 'linear-gradient(155deg, #1f372e 0%, #12231d 100%)',
    accent: '#cfb074',
    text: '#eef2ec',
    spine: '#0c1814',
  },
  'burgundy-ivory': {
    bg: 'linear-gradient(155deg, #56212a 0%, #341118 100%)',
    accent: '#e2c48d',
    text: '#f7f1e8',
    spine: '#240a0f',
  },
  'slate-ochre': {
    bg: 'linear-gradient(155deg, #323942 0%, #1e232a 100%)',
    accent: '#df9b48',
    text: '#f1ede6',
    spine: '#15181d',
  },
  'crimson-ink': {
    bg: 'linear-gradient(155deg, #6d2323 0%, #431313 100%)',
    accent: '#ebd1a0',
    text: '#faf3ea',
    spine: '#2e0b0b',
  },
  'terracotta-charcoal': {
    bg: 'linear-gradient(155deg, #7c3b28 0%, #4d2216 100%)',
    accent: '#f0cfa0',
    text: '#faf3eb',
    spine: '#35160e',
  },
  'rust-parchment': {
    bg: 'linear-gradient(155deg, #5c3222 0%, #371c12 100%)',
    accent: '#e6c186',
    text: '#f8f2e8',
    spine: '#25110a',
  },
  'iron-amber': {
    bg: 'linear-gradient(155deg, #2d2a29 0%, #191716 100%)',
    accent: '#e09d49',
    text: '#f0ebe2',
    spine: '#100e0d',
  },
  'indigo-silver': {
    bg: 'linear-gradient(155deg, #27274d 0%, #171731 100%)',
    accent: '#c8c4e8',
    text: '#f2f1f9',
    spine: '#0f0f22',
  },
  'plum-sand': {
    bg: 'linear-gradient(155deg, #43243f 0%, #271325 100%)',
    accent: '#e4c3a4',
    text: '#f7f1f4',
    spine: '#1b0c19',
  },
  'teal-obsidian': {
    bg: 'linear-gradient(155deg, #1b3d44 0%, #10252a 100%)',
    accent: '#c8d9cf',
    text: '#eef5f4',
    spine: '#09181b',
  },
  'cobalt-cream': {
    bg: 'linear-gradient(155deg, #203759 0%, #122138 100%)',
    accent: '#e5d1a9',
    text: '#f2f4f8',
    spine: '#0b1525',
  },
  'emerald-gold': {
    bg: 'linear-gradient(155deg, #1a4138 0%, #0f2923 100%)',
    accent: '#e2bd72',
    text: '#eef5f1',
    spine: '#091a16',
  },
  'bronze-ivory': {
    bg: 'linear-gradient(155deg, #4b3a28 0%, #2d2216 100%)',
    accent: '#e4c794',
    text: '#f7f2e8',
    spine: '#1e160d',
  },
  'celadon-ink': {
    bg: 'linear-gradient(155deg, #2f4d47 0%, #1b302c 100%)',
    accent: '#d8cfb2',
    text: '#f2f5f2',
    spine: '#11201d',
  },
  'vermilion-paper': {
    bg: 'linear-gradient(155deg, #8b3626 0%, #592016 100%)',
    accent: '#f0d8a8',
    text: '#fbf5ec',
    spine: '#3c140d',
  },
}

export const BookCover: React.FC<BookCoverProps> = ({
  title,
  author,
  category,
  palette,
  monogram,
  size = 'md',
  className = '',
}) => {
  const style = PALETTE_STYLES[palette] || PALETTE_STYLES['obsidian-gold']
  const sizeCls =
    size === 'xs'
      ? 'w-[70px] h-[98px] sm:w-[78px] sm:h-[108px] rounded-lg'
      : size === 'sm'
      ? 'w-16 h-[88px] rounded-lg'
      : size === 'lg'
      ? 'w-44 h-60 rounded-xl'
      : 'w-full aspect-[3/4.2] rounded-xl'

  const compact = size === 'xs' || size === 'sm'

  return (
    <div
      className={`relative overflow-hidden select-none shadow-md transition-transform duration-300 ${sizeCls} ${className}`}
      style={{ background: style.bg, color: style.text }}
    >
      {/* 书脊阴影凹槽 */}
      <div
        className="absolute inset-y-0 left-0"
        style={{
          width: compact ? '6px' : '10px',
          background: `linear-gradient(90deg, ${style.spine} 0%, rgba(255,255,255,0.14) 72%, rgba(0,0,0,0.28) 100%)`,
        }}
      />

      {/* 精致鎏金内框 */}
      <div
        className={`absolute rounded-sm pointer-events-none ${
          compact ? 'inset-1.5 left-2.5' : 'inset-2.5 left-4'
        }`}
        style={{ border: `1px solid ${style.accent}${compact ? '33' : '44'}` }}
      />

      {/* 背景水印徽记 */}
      <div
        className="absolute -right-2 -bottom-3 font-serif font-bold pointer-events-none leading-none"
        style={{
          fontSize: compact ? '2.5rem' : size === 'lg' ? '6.2rem' : '4.8rem',
          color: `${style.accent}18`,
        }}
      >
        {monogram || title[0] || '哲'}
      </div>

      {/* 书封内容 */}
      {compact ? (
        <div className="relative h-full flex flex-col justify-between py-2 pl-3 pr-1.5 text-left">
          <div className="flex items-center justify-between gap-1">
            <span
              className="w-3.5 h-[1.5px] opacity-75 shrink-0"
              style={{ backgroundColor: style.accent }}
            />
            <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: style.accent }} />
          </div>
          <span
            className={`font-serif font-bold leading-[1.28] tracking-tight break-words ${
              size === 'xs' ? 'text-[10.5px] sm:text-[11px] line-clamp-4' : 'text-[10px] line-clamp-3'
            }`}
            style={{ color: style.text }}
          >
            {title}
          </span>
          <span
            className="text-[8.5px] opacity-75 truncate font-serif"
            style={{ color: style.accent }}
          >
            {author}
          </span>
        </div>
      ) : (
        <div className="relative h-full flex flex-col justify-between p-4 pl-6">
          <div className="flex items-center justify-between gap-1">
            <span
              className="text-[9px] tracking-[0.16em] uppercase opacity-80 truncate"
              style={{ color: style.accent }}
            >
              {category.slice(0, 6)}
            </span>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: style.accent }} />
          </div>

          <div className="my-auto py-1">
            <div
              className="w-6 h-[1.5px] mb-2.5 opacity-80"
              style={{ backgroundColor: style.accent }}
            />
            <h3
              className={`font-serif font-bold leading-snug tracking-wide line-clamp-3 ${
                size === 'lg' ? 'text-lg' : 'text-[15px]'
              }`}
              style={{ color: style.text }}
            >
              {title}
            </h3>
          </div>

          <div className="pt-2 border-t" style={{ borderColor: `${style.accent}33` }}>
            <p className="text-[11px] opacity-85 truncate font-serif" style={{ color: style.accent }}>
              {author}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
