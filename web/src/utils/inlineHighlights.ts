import type { ContentBlock, HighlightItem } from '../types'

export interface BlockSelectionSpan {
  blockIndex: number
  startOffset: number
  endOffset: number
  text: string
}

/**
 * 解析任意单段或跨段落手动选区，返回每个涉及段落内的精确字符区间
 */
export function getMultiBlockSelectionSpans(
  articleEl: HTMLElement,
  range: Range
): BlockSelectionSpan[] {
  const blockNodes = Array.from(articleEl.querySelectorAll<HTMLElement>('[data-block-index]'))
  const spans: BlockSelectionSpan[] = []

  for (const blockEl of blockNodes) {
    let intersects = false
    try {
      intersects = range.intersectsNode(blockEl)
    } catch {
      intersects = false
    }
    if (!intersects) continue

    const blockIndex = Number(blockEl.getAttribute('data-block-index'))
    if (!Number.isFinite(blockIndex)) continue

    const subRange = document.createRange()
    subRange.selectNodeContents(blockEl)

    // 如果选区起点在当前段落内部，使用精确起点
    if (blockEl.contains(range.startContainer)) {
      subRange.setStart(range.startContainer, range.startOffset)
    }
    // 如果选区终点在当前段落内部，使用精确终点
    if (blockEl.contains(range.endContainer)) {
      subRange.setEnd(range.endContainer, range.endOffset)
    }

    const calc = getSelectionOffsetsInBlock(blockEl, subRange)
    if (calc && calc.text.trim().length > 0 && calc.endOffset > calc.startOffset) {
      spans.push({
        blockIndex,
        startOffset: calc.startOffset,
        endOffset: calc.endOffset,
        text: calc.text,
      })
    }
  }

  return spans
}

const CIRCLED_NUM_MAP: Record<string, string> = {
  '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5',
  '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9', '⑩': '10',
  '⑪': '11', '⑫': '12', '⑬': '13', '⑭': '14', '⑮': '15',
  '⑯': '16', '⑰': '17', '⑱': '18', '⑲': '19', '⑳': '20',
  '㉑': '21', '㉒': '22', '㉓': '23', '㉔': '24', '㉕': '25',
  '㉖': '26', '㉗': '27', '㉘': '28', '㉙': '29', '㉚': '30',
}

const SUP_DIGIT_MAP: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
}

function decodeSupDigits(supStr: string): string {
  let out = ''
  for (const ch of supStr) {
    out += SUP_DIGIT_MAP[ch] ?? ''
  }
  return out
}

export interface FootnoteEntry {
  id: string
  label: string
  kind: 'footnote' | 'gloss'
  text: string
}

export interface ResolvedChapterFootnotes {
  entries: Map<string, FootnoteEntry>
  /** blockIndex -> Map<tokenKey (e.g. 'circle:1'|'bracket:1'|'tortoise:1'|'sup:1'), entryId> */
  blockRefMap: Map<number, Map<string, string>>
  /** blockIndex -> 需要附加在段落末尾的注脚角标 ID 列表（如【译注】或无行内标号的临近注脚） */
  blockTrailingIds: Map<number, string[]>
  /** 已被收纳为句中注脚、无需在正文流中重复渲染的块索引集合 */
  hiddenBlockIndices: Set<number>
}

type DefKind = 'circle' | 'sup' | 'tortoise' | 'bracket' | 'explicit' | 'numspace'

interface CandidateDef {
  blockIndex: number
  kind: DefKind
  nums: string[]
  text: string
  continuationIndices: number[]
}

const CITATION_HINT_RE =
  /(《|》|第\s*\d+\s*页|年版|同上|参阅|参见|参看|引自|引者|译者|编者|原注|边码|全集|选集|p\.\s*\d|pp\.\s*\d|vol\.|Verlag|Press|University|出版社)/i

const NOTE_SECTION_HEADER_RE = /^(?:注释|注|脚注|尾注|译注|校注|说明)[：:。\s]*$/

function parseCandidateDef(blk: ContentBlock): Omit<CandidateDef, 'continuationIndices'> | null {
  if (blk.type !== 'paragraph' && blk.type !== 'list' && blk.type !== 'quote') return null
  const raw = (blk.text || '').trim()
  if (!raw || raw.length > 2600) return null
  if (raw.startsWith('【译注】')) return null

  // 1) 圆圈编号 ① / ①② / ①②③④ ...
  let m = raw.match(/^([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚]+)[、.．:：\s]*(.{2,})$/s)
  if (m) {
    const nums = Array.from(m[1])
      .map((c) => CIRCLED_NUM_MAP[c])
      .filter(Boolean)
    if (nums.length > 0) {
      return { blockIndex: blk.index, kind: 'circle', nums, text: m[2].trim() }
    }
  }

  // 2) Unicode 上标编号 ¹ ² ³ ...（如《伦理学体系》）
  m = raw.match(/^([¹²³⁴⁵⁶⁷⁸⁹][⁰¹²³⁴⁵⁶⁷⁸⁹]*)[\s\u3000]+(.{2,})$/s)
  if (m) {
    const num = decodeSupDigits(m[1])
    if (num) return { blockIndex: blk.index, kind: 'sup', nums: [num], text: m[2].trim() }
  }

  // 3) 六角括号 〔1〕（如《历史与阶级意识》）
  m = raw.match(/^〔(\d{1,3})〕[\s\u3000:：]*(.{2,})$/s)
  if (m) {
    const num = Number(m[1])
    const txt = m[2].trim()
    // 三位数且正文较长、无引文特征者多为原书页码边码（如〔208〕），不是脚注
    if (num >= 100 && txt.length > 120 && !CITATION_HINT_RE.test(txt)) return null
    return { blockIndex: blk.index, kind: 'tortoise', nums: [m[1]], text: txt }
  }

  // 4) 方括号 [1] / [^1] / [注1]（如《哲学史讲演录》《法哲学原理》）
  m = raw.match(/^\[\^?(?:注|译注)?(\d{1,3})\][：:\s\u3000]*(.{2,})$/s)
  if (m) {
    return { blockIndex: blk.index, kind: 'bracket', nums: [m[1]], text: m[2].trim() }
  }

  // 5) 显式“注1：/注释1：/译注1：/原注1：/编者注1：/译者注1：/脚注1：”
  m = raw.match(/^(?:注释|译者注|译注|校注|原注|编者注|脚注|注)\s*(\d{1,3})[：:.、\s\u3000]+(.{2,})$/s)
  if (m) {
    return { blockIndex: blk.index, kind: 'explicit', nums: [m[1]], text: m[2].trim() }
  }

  // 6) 纯数字 + 空白/全角空格（如《策略与伦理》`1　《列宁》...`、`12 康德...`）
  // 仅当正文存在对应上标/括号引用时才会被绑定，绝不误伤普通编号段落
  m = raw.match(/^(\d{1,3})[\s\u3000]+([^\d\s].{3,})$/s)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 300) {
    return { blockIndex: blk.index, kind: 'numspace', nums: [m[1]], text: m[2].trim() }
  }

  return null
}

function isDedicatedNotesChapter(blocks: ContentBlock[]): boolean {
  if (blocks.length === 0) return false
  const firstH = blocks.find((b) => b.type === 'heading')
  if (firstH && /^(?:注释|译者注|译注|尾注|脚注|编者注|注)(?:（续\s*\d+）)?$/.test(firstH.text.trim())) {
    return true
  }
  const nonEmpty = blocks.filter((b) => b.type !== 'hr' && b.type !== 'heading')
  if (nonEmpty.length === 0) return false
  const defLike = nonEmpty.filter((b) => parseCandidateDef(b) !== null).length
  return defLike / nonEmpty.length >= 0.72
}

/**
 * 精准解析整章的句内注脚与【译注】：
 * - 支持同一章多页重复的 ①②③ 按就近原则精确配对，不再互相覆盖；
 * - 支持 ①..㉚、[1]/[^1]、〔1〕、¹²³、注1：、1　及【译注】全部 7 种格式；
 * - 将已绑定到句子的脚注定义块、断行续接块与孤立“注释”分隔标题全部收纳进 hiddenBlockIndices，
 *   消除“句中已有注脚、下文又以正文重复显现一遍”的冗余体验。
 */
export function resolveChapterFootnotes(blocks: ContentBlock[]): ResolvedChapterFootnotes {
  const entries = new Map<string, FootnoteEntry>()
  const blockRefMap = new Map<number, Map<string, string>>()
  const blockTrailingIds = new Map<number, string[]>()
  const hiddenBlockIndices = new Set<number>()

  if (!blocks || blocks.length === 0) {
    return { entries, blockRefMap, blockTrailingIds, hiddenBlockIndices }
  }

  // 优先加载构建期已结构化绑定在段落上的注脚与译注（零冗余正文重复）
  for (const blk of blocks) {
    if (blk.footnotes && blk.footnotes.length > 0) {
      for (const fn of blk.footnotes) {
        entries.set(fn.id, {
          id: fn.id,
          label: fn.label,
          kind: fn.kind,
          text: fn.text,
        })
      }
    }
  }

  const dedicatedNotes = isDedicatedNotesChapter(blocks)

  // Step 1: 收集全部候选脚注定义块与【译注】块
  const candidateDefs: CandidateDef[] = []
  const defByBlockIndex = new Map<number, CandidateDef>()
  const glossBlockIndices: number[] = []

  for (let idx = 0; idx < blocks.length; idx++) {
    const blk = blocks[idx]
    const raw = (blk.text || '').trim()
    if (!raw) continue
    if (raw.startsWith('【译注】')) {
      glossBlockIndices.push(idx)
      continue
    }
    const parsed = parseCandidateDef(blk)
    if (parsed) {
      const cand: CandidateDef = { ...parsed, continuationIndices: [] }
      candidateDefs.push(cand)
      defByBlockIndex.set(blk.index, cand)
    }
  }

  // 合并被 OCR 意外断行的脚注续接段（例如“① ...（译” + 紧邻下一行“文有改动）...”且再下一行是“② ...”）
  const continuationBlockSet = new Set<number>()
  for (let ci = 0; ci < candidateDefs.length; ci++) {
    const def = candidateDefs[ci]
    const arrIdx = blocks.findIndex((b) => b.index === def.blockIndex)
    if (arrIdx < 0) continue
    const nextBlk = blocks[arrIdx + 1]
    const nextNextBlk = blocks[arrIdx + 2]
    if (
      nextBlk &&
      nextBlk.type === 'paragraph' &&
      !defByBlockIndex.has(nextBlk.index) &&
      !nextBlk.text.trim().startsWith('【译注】') &&
      nextBlk.text.trim().length <= 220 &&
      !/[。！？.!?…”』」】）)]$/.test(def.text.trim()) &&
      nextNextBlk &&
      defByBlockIndex.has(nextNextBlk.index)
    ) {
      def.text = `${def.text}${nextBlk.text.trim()}`
      def.continuationIndices.push(nextBlk.index)
      continuationBlockSet.add(nextBlk.index)
    }
  }

  // Step 2: 将所有【译注】块转化为紧邻前一段句末的点击式「译注」注脚，并隐藏冗余块
  for (const arrIdx of glossBlockIndices) {
    const glossBlk = blocks[arrIdx]
    const glossText = glossBlk.text.trim().replace(/^【译注】\s*/, '').trim()
    if (!glossText) {
      hiddenBlockIndices.add(glossBlk.index)
      continue
    }
    // 找到前一个非隐藏、非译注的正文/引文/列表/标题块
    let targetBlk: ContentBlock | null = null
    for (let p = arrIdx - 1; p >= 0; p--) {
      const cand = blocks[p]
      if (cand.type === 'hr') continue
      if (hiddenBlockIndices.has(cand.index)) continue
      if (cand.text.trim().startsWith('【译注】')) continue
      targetBlk = cand
      break
    }
    if (targetBlk) {
      const entryId = `gloss_${glossBlk.index}`
      entries.set(entryId, {
        id: entryId,
        label: '译注',
        kind: 'gloss',
        text: glossText,
      })
      const list = blockTrailingIds.get(targetBlk.index) || []
      list.push(entryId)
      blockTrailingIds.set(targetBlk.index, list)
      hiddenBlockIndices.add(glossBlk.index)
    }
  }

  // 如果是专门的“注释”章节，正文全都是注释条文，不做隐藏折叠（仍允许译注折叠）
  if (dedicatedNotes) {
    return { entries, blockRefMap, blockTrailingIds, hiddenBlockIndices }
  }

  // Step 3: 扫描所有正文块中的行内注脚引用，并按“就近下文优先”精确绑定到对应脚注定义块
  const boundDefBlocks = new Set<number>()

  const isCompatibleKind = (refKind: 'circle' | 'sup' | 'tortoise' | 'bracket', defKind: DefKind): boolean => {
    if (refKind === defKind) return true
    if (defKind === 'explicit') return true
    if (refKind === 'sup' && (defKind === 'numspace' || defKind === 'bracket' || defKind === 'circle')) return true
    if (refKind === 'bracket' && (defKind === 'numspace' || defKind === 'sup')) return true
    if (refKind === 'circle' && defKind === 'numspace') return true
    return false
  }

  const findMatchingDef = (
    bodyBlockIndex: number,
    refKind: 'circle' | 'sup' | 'tortoise' | 'bracket',
    num: string
  ): CandidateDef | null => {
    // 优先向后寻找最近的匹配定义块（完美解决每页重置 ①②③ 的书！）
    let bestForward: CandidateDef | null = null
    let bestForwardSameKind: CandidateDef | null = null
    for (const def of candidateDefs) {
      if (def.blockIndex <= bodyBlockIndex) continue
      if (!def.nums.includes(num)) continue
      if (!isCompatibleKind(refKind, def.kind)) continue
      if (!bestForward) bestForward = def
      if (def.kind === refKind && !bestForwardSameKind) {
        bestForwardSameKind = def
        break
      }
    }
    if (bestForwardSameKind) return bestForwardSameKind
    if (bestForward) return bestForward

    // 极少数 OCR 排版把页底注提前了 1~3 段，允许极近回溯匹配
    for (let ci = candidateDefs.length - 1; ci >= 0; ci--) {
      const def = candidateDefs[ci]
      if (def.blockIndex >= bodyBlockIndex) continue
      if (bodyBlockIndex - def.blockIndex > 4) break
      if (!def.nums.includes(num)) continue
      if (!isCompatibleKind(refKind, def.kind)) continue
      return def
    }
    return null
  }

  for (const blk of blocks) {
    if (blk.type === 'hr' || blk.type === 'table') continue
    if (defByBlockIndex.has(blk.index)) continue
    if (continuationBlockSet.has(blk.index)) continue
    if (hiddenBlockIndices.has(blk.index)) continue

    const raw = blk.text || ''
    if (!raw) continue

    const refHits: Array<{ refKind: 'circle' | 'sup' | 'tortoise' | 'bracket'; num: string }> = []

    // ①..㉚
    for (const m of raw.matchAll(/([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚])/g)) {
      const num = CIRCLED_NUM_MAP[m[1]]
      if (num) refHits.push({ refKind: 'circle', num })
    }
    // 〔1〕
    for (const m of raw.matchAll(/〔(\d{1,3})〕/g)) {
      refHits.push({ refKind: 'tortoise', num: m[1] })
    }
    // [1] / [^1]（跳过加粗页码 **[13]**）
    for (const m of raw.matchAll(/\[\^?(\d{1,3})\]/g)) {
      const pos = m.index ?? 0
      const before = raw.slice(Math.max(0, pos - 2), pos)
      const after = raw.slice(pos + m[0].length, pos + m[0].length + 2)
      if (before === '**' && after === '**') continue
      refHits.push({ refKind: 'bracket', num: m[1] })
    }
    // Unicode 上标 ¹²³（仅排除孤立数学变量平方如 " x²" / " y³"，不误拦 "1972⁸" / "Lacan¹" / "reason³"）
    for (const m of raw.matchAll(/([¹²³⁴⁵⁶⁷⁸⁹][⁰¹²³⁴⁵⁶⁷⁸⁹]*)/g)) {
      const pos = m.index ?? 0
      const prevCh = pos > 0 ? raw[pos - 1] : ''
      const prev2 = pos > 1 ? raw[pos - 2] : ''
      if ((m[1] === '²' || m[1] === '³') && /[xyzXYZ]/.test(prevCh) && !/[A-Za-z]/.test(prev2)) continue
      const num = decodeSupDigits(m[1])
      if (num) refHits.push({ refKind: 'sup', num })
    }

    if (refHits.length === 0) continue

    const refsForBlock = new Map<string, string>()
    for (const { refKind, num } of refHits) {
      const tokenKey = `${refKind}:${num}`
      if (refsForBlock.has(tokenKey)) continue
      const matched = findMatchingDef(blk.index, refKind, num)
      if (!matched) continue

      const entryId = `fn_${matched.blockIndex}_${num}`
      if (!entries.has(entryId)) {
        entries.set(entryId, {
          id: entryId,
          label: num,
          kind: 'footnote',
          text: matched.text,
        })
      }
      refsForBlock.set(tokenKey, entryId)
      boundDefBlocks.add(matched.blockIndex)
      hiddenBlockIndices.add(matched.blockIndex)
      for (const cIdx of matched.continuationIndices) {
        hiddenBlockIndices.add(cIdx)
      }
    }

    if (refsForBlock.size > 0) {
      blockRefMap.set(blk.index, refsForBlock)
    }
  }

  // Step 4: 兜底收纳明显的“页底未匹配引用型脚注”（例如 OCR 把行内 ① 误识为 ®，导致下行 ①《形而上学》孤立）
  for (const def of candidateDefs) {
    if (boundDefBlocks.has(def.blockIndex)) continue
    if (def.kind !== 'circle' && def.kind !== 'sup' && def.kind !== 'explicit') continue
    if (!CITATION_HINT_RE.test(def.text)) continue

    const arrIdx = blocks.findIndex((b) => b.index === def.blockIndex)
    if (arrIdx <= 0) continue
    // 找紧邻的前一个可见正文段
    let prevBody: ContentBlock | null = null
    for (let p = arrIdx - 1; p >= 0; p--) {
      const cand = blocks[p]
      if (cand.type === 'hr' || cand.type === 'heading') break
      if (hiddenBlockIndices.has(cand.index) || defByBlockIndex.has(cand.index) || continuationBlockSet.has(cand.index)) {
        continue
      }
      if (cand.text.trim().length >= 20) {
        prevBody = cand
        break
      }
    }
    if (!prevBody) continue

    const label = def.nums.join('/')
    const entryId = `fn_${def.blockIndex}_${label}`
    entries.set(entryId, {
      id: entryId,
      label,
      kind: 'footnote',
      text: def.text,
    })
    const list = blockTrailingIds.get(prevBody.index) || []
    list.push(entryId)
    blockTrailingIds.set(prevBody.index, list)
    boundDefBlocks.add(def.blockIndex)
    hiddenBlockIndices.add(def.blockIndex)
    for (const cIdx of def.continuationIndices) {
      hiddenBlockIndices.add(cIdx)
    }
  }

  // Step 5: 若存在孤立的“注释 / 注释：”分隔块，且其下方紧跟的所有脚注块均已折叠隐藏，则一并隐藏该空标题
  for (let idx = 0; idx < blocks.length; idx++) {
    const blk = blocks[idx]
    if (hiddenBlockIndices.has(blk.index)) continue
    if (!NOTE_SECTION_HEADER_RE.test((blk.text || '').trim())) continue
    let sawHiddenNote = false
    let sawVisibleBody = false
    for (let j = idx + 1; j < blocks.length; j++) {
      const nb = blocks[j]
      if (nb.type === 'heading' && !NOTE_SECTION_HEADER_RE.test((nb.text || '').trim())) break
      if (nb.type === 'hr') continue
      if (hiddenBlockIndices.has(nb.index)) {
        sawHiddenNote = true
      } else {
        sawVisibleBody = true
        break
      }
    }
    if (sawHiddenNote && !sawVisibleBody) {
      hiddenBlockIndices.add(blk.index)
    }
  }

  return { entries, blockRefMap, blockTrailingIds, hiddenBlockIndices }
}

/**
 * 为指定正文块的 HTML 注入可点击学术注脚角标（含行内 ①/[1]/〔1〕/¹ 与段末附加的「译注」/注脚徽标）
 */
export function enhanceBlockFootnotesHtml(
  rawHtml: string,
  blockIndex: number,
  resolved: ResolvedChapterFootnotes
): string {
  if (!rawHtml) return rawHtml
  const refsForBlock = resolved.blockRefMap.get(blockIndex)
  const trailingIds = resolved.blockTrailingIds.get(blockIndex)
  if ((!refsForBlock || refsForBlock.size === 0) && (!trailingIds || trailingIds.length === 0)) {
    return rawHtml
  }

  let html = rawHtml

  if (refsForBlock && refsForBlock.size > 0) {
    // 1) 增强已有的 <sup class="fn-ref">[1]</sup>
    html = html.replace(
      /<sup([^>]*)>(\s*\[?\^?(\d{1,3})\]?\s*)<\/sup>/g,
      (full, attrs: string, inner: string, num: string) => {
        const entryId = refsForBlock.get(`bracket:${num}`)
        if (!entryId || attrs.includes('data-fn-key')) return full
        return `<sup${attrs} data-fn-key="${entryId}" class="fn-ref fn-clickable" title="点击查看脚注 [${num}]">${inner}</sup>`
      }
    )

    // 2) 仅对非 HTML 标签的纯文本片段替换 ①、〔1〕、[1]、¹²³
    const parts = html.split(/(<[^>]+>)/g)
    let inSup = false
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (part.startsWith('<')) {
        if (/^<sup\b/i.test(part)) inSup = true
        else if (/^<\/sup>/i.test(part)) inSup = false
        continue
      }
      if (inSup || !part) continue

      let updated = part.replace(/\[\^?(\d{1,3})\]/g, (m, num: string) => {
        const entryId = refsForBlock.get(`bracket:${num}`)
        if (!entryId) return m
        return `<sup class="fn-ref fn-clickable" data-fn-key="${entryId}" title="点击查看脚注 [${num}]">[${num}]</sup>`
      })
      updated = updated.replace(/〔(\d{1,3})〕/g, (m, num: string) => {
        const entryId = refsForBlock.get(`tortoise:${num}`)
        if (!entryId) return m
        return `<sup class="fn-ref fn-clickable" data-fn-key="${entryId}" title="点击查看脚注 [${num}]">[${num}]</sup>`
      })
      updated = updated.replace(/([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚])/g, (m, sym: string) => {
        const num = CIRCLED_NUM_MAP[sym]
        const entryId = num ? refsForBlock.get(`circle:${num}`) : undefined
        if (!entryId) return m
        return `<sup class="fn-ref fn-clickable" data-fn-key="${entryId}" title="点击查看脚注 ${sym}">${sym}</sup>`
      })
      updated = updated.replace(/([¹²³⁴⁵⁶⁷⁸⁹][⁰¹²³⁴⁵⁶⁷⁸⁹]*)/g, (m, supStr: string) => {
        const num = decodeSupDigits(supStr)
        const entryId = num ? refsForBlock.get(`sup:${num}`) : undefined
        if (!entryId) return m
        return `<sup class="fn-ref fn-clickable" data-fn-key="${entryId}" title="点击查看脚注 [${num}]">[${num}]</sup>`
      })
      parts[i] = updated
    }
    html = parts.join('')
  }

  // 3) 附加段末【译注】或兜底注脚角标
  if (trailingIds && trailingIds.length > 0) {
    const badges = trailingIds
      .map((entryId) => {
        const entry = resolved.entries.get(entryId)
        if (!entry) return ''
        if (entry.kind === 'gloss') {
          return `<sup class="fn-ref fn-clickable fn-gloss" data-fn-key="${entryId}" title="点击查看中文译注">译注</sup>`
        }
        return `<sup class="fn-ref fn-clickable" data-fn-key="${entryId}" title="点击查看脚注 [${entry.label}]">[${entry.label}]</sup>`
      })
      .join('')
    html += badges
  }

  return html
}

/** 兼容旧导出 */
export function extractChapterFootnotes(blocks: ContentBlock[]): Map<string, string> {
  const resolved = resolveChapterFootnotes(blocks)
  const out = new Map<string, string>()
  resolved.entries.forEach((v, k) => out.set(k, v.text))
  return out
}

export function enhanceFootnotesHtml(rawHtml: string, _footnoteMap: Map<string, string>): string {
  return rawHtml
}

/**
 * 计算选区在指定段落元素内的精确纯文本字符偏移量（自动排除 .user-hl-note-dot 批注圆点字符）
 */
export function getSelectionOffsetsInBlock(
  blockEl: HTMLElement,
  range: Range
): { startOffset: number; endOffset: number; text: string } | null {
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (parent && parent.closest('.user-hl-note-dot')) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let offset = 0
  let startOffset = -1
  let endOffset = -1
  let collected = ''

  let current = walker.nextNode()
  while (current) {
    const textVal = current.nodeValue || ''
    const len = textVal.length

    if (current === range.startContainer) {
      startOffset = offset + Math.min(range.startOffset, len)
    }
    if (current === range.endContainer) {
      endOffset = offset + Math.min(range.endOffset, len)
    }

    if (startOffset >= 0 && endOffset < 0) {
      const localStart = current === range.startContainer ? Math.min(range.startOffset, len) : 0
      collected += textVal.slice(localStart)
    } else if (startOffset >= 0 && endOffset >= 0 && current === range.endContainer) {
      const localStart = current === range.startContainer ? Math.min(range.startOffset, len) : 0
      const localEnd = Math.min(range.endOffset, len)
      collected += textVal.slice(localStart, localEnd)
      break
    }

    offset += len
    current = walker.nextNode()
  }

  // 处理选区端点落在元素节点上的兜底情况
  if (startOffset < 0 || endOffset <= startOffset) {
    const raw = range.toString().trim()
    if (!raw) return null
    const fullText = getCleanBlockText(blockEl)
    const idx = fullText.indexOf(raw)
    if (idx < 0) return null
    return { startOffset: idx, endOffset: idx + raw.length, text: raw }
  }

  const trimmed = collected.trim()
  if (!trimmed) return null
  const leadTrim = collected.indexOf(trimmed)
  const finalStart = startOffset + Math.max(0, leadTrim)
  const finalEnd = finalStart + trimmed.length
  return { startOffset: finalStart, endOffset: finalEnd, text: trimmed }
}

function getCleanBlockText(el: HTMLElement): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (parent && parent.closest('.user-hl-note-dot')) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let out = ''
  let n = walker.nextNode()
  while (n) {
    out += n.nodeValue || ''
    n = walker.nextNode()
  }
  return out
}

/**
 * 在保留原有内联 HTML（粗体、斜体、脚注角标）的前提下，
 * 精确地为指定字符区间注入 <mark class="user-hl hl-xxx"> 划线与行内「注」角标。
 */
export function applyInlineHighlightsToHtml(
  rawHtml: string,
  highlights: HighlightItem[]
): string {
  if (!highlights || highlights.length === 0 || typeof document === 'undefined') {
    return rawHtml
  }

  const container = document.createElement('div')
  container.innerHTML = rawHtml

  const fullText = container.textContent || ''
  if (!fullText) return rawHtml

  // 解析并规范化所有高亮区间，避免重叠冲突
  const resolved: Array<{ start: number; end: number; item: HighlightItem }> = []
  for (const h of highlights) {
    let s = typeof h.startOffset === 'number' ? h.startOffset : -1
    let e = typeof h.endOffset === 'number' ? h.endOffset : -1
    if (s < 0 || e <= s || e > fullText.length) {
      const idx = h.text ? fullText.indexOf(h.text.slice(0, 60)) : -1
      if (idx >= 0) {
        s = idx
        e = Math.min(fullText.length, idx + h.text.length)
      }
    }
    if (s >= 0 && e > s) {
      resolved.push({ start: s, end: e, item: h })
    }
  }

  if (resolved.length === 0) return rawHtml

  // 按起始位置升序、非重叠过滤
  resolved.sort((a, b) => a.start - b.start || b.end - a.end)
  const nonOverlapping: typeof resolved = []
  let lastEnd = 0
  for (const r of resolved) {
    if (r.start >= lastEnd) {
      nonOverlapping.push(r)
      lastEnd = r.end
    }
  }

  // 收集全部文本节点及其在 fullText 中的全局偏移
  const textNodes: Array<{ node: Text; start: number; end: number }> = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let pos = 0
  let cur = walker.nextNode() as Text | null
  while (cur) {
    const len = (cur.nodeValue || '').length
    textNodes.push({ node: cur, start: pos, end: pos + len })
    pos += len
    cur = walker.nextNode() as Text | null
  }

  // 从后往前包裹文本节点，避免 DOM 变更影响前面的节点偏移
  for (let hi = nonOverlapping.length - 1; hi >= 0; hi--) {
    const { start, end, item } = nonOverlapping[hi]
    let placedNoteDot = false

    for (let ti = textNodes.length - 1; ti >= 0; ti--) {
      const tn = textNodes[ti]
      if (tn.end <= start || tn.start >= end) continue

      const localStart = Math.max(0, start - tn.start)
      const localEnd = Math.min(tn.end - tn.start, end - tn.start)
      if (localEnd <= localStart) continue

      const origText = tn.node.nodeValue || ''
      const before = origText.slice(0, localStart)
      const mid = origText.slice(localStart, localEnd)
      const after = origText.slice(localEnd)

      const frag = document.createDocumentFragment()
      if (before) frag.appendChild(document.createTextNode(before))

      const mark = document.createElement('mark')
      const styleClass = item.style === 'underline' ? 'hl-style-underline' : 'hl-style-highlight'
      mark.className = `user-hl hl-${item.color} ${styleClass}`
      mark.setAttribute('data-hl-id', item.id)
      mark.textContent = mid
      frag.appendChild(mark)

      if (item.note && !placedNoteDot) {
        const dot = document.createElement('span')
        dot.className = 'user-hl-note-dot'
        dot.setAttribute('data-hl-id', item.id)
        dot.setAttribute('title', `批注：${item.note}`)
        dot.textContent = '注'
        frag.appendChild(dot)
        placedNoteDot = true
      }

      if (after) frag.appendChild(document.createTextNode(after))
      tn.node.parentNode?.replaceChild(frag, tn.node)
    }
  }

  return container.innerHTML
}
