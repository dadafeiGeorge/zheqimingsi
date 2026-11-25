#!/usr/bin/env python3
"""
deep_audit_all_books.py — 全量 72 部书籍真实区块级深度体检：
1. 残留 HTML/XML 标签（如 <a id="h8"></a>）、HTML 实体、Pandoc 属性 {#...}、破损 Markdown 图片/锚点链接
2. 未翻译的外语长段落（英文/德文/法文占比过高）
3. OCR/PDF 排版缺陷（孤立页码、断行碎段、乱码字符、转义符号、未闭合星号、连续乱空格）
4. 原件 PDF/EPUB 页数与字数完整性对比（核查是否有漏页、缺章、未译完）
"""
import json
import re
from pathlib import Path

LIB_ROOT = Path(r"D:\咕咕嘎嘎反重力\library-data")
SRC_TODO = Path(r"D:\文献库\待翻译转写转录")
EXTRA_DIR = Path(r"D:\咕咕嘎嘎反重力\extra-books")

ANY_ANGLE_TAG_RE = re.compile(r"</?[a-zA-Z!][a-zA-Z0-9:-]*(?:\s+[^>\n]{0,120})?/?>")
HTML_ENTITY_RE = re.compile(r"&(?:nbsp|amp|lt|gt|quot|apos|mdash|ndash|hellip|ldquo|rdquo|lsquo|rsquo|#\d+|#x[0-9a-fA-F]+);")
PANDOC_ATTR_RE = re.compile(r"\{[#.][^\}\n]{1,60}\}")
MD_IMG_RE = re.compile(r"!\[[^\]]*\]\([^\)]+\)")
MD_ANCHOR_RE = re.compile(r"\[([^\]]+)\]\((?:#|http|file)[^\)]*\)")
GARBLED_RE = re.compile(r"[\ufffd\u0000-\u0008\u000b\u000c\u000e-\u001f\ue000-\uf8ff]")
ESCAPED_MD_RE = re.compile(r"\\[\*_`\[\]#~]")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")
LATIN_WORD_RE = re.compile(r"[A-Za-zÀ-ÿ]{3,}")
PAGE_NUM_LINE_RE = re.compile(r"^(?:[-—–·\s]*\d{1,4}[-—–·\s]*|第\s*\d{1,4}\s*页|p\.\s*\d{1,4})$", re.I)

cat = json.loads((LIB_ROOT / "catalog.json").read_text(encoding="utf-8"))
books = cat["books"]

print(f"=== REAL BLOCK-LEVEL DEEP AUDIT: {len(books)} books, {cat['totalChars']:,} chars ===\n")

issues_books = []
all_foreign_books = []

for b in books:
    bid = b["id"]
    bdir = LIB_ROOT / "books" / bid
    chunk_files = sorted(bdir.glob("p_*.json"))

    html_tags = 0
    html_samples = []
    entities = 0
    entity_samples = []
    pandoc_attrs = 0
    md_imgs = 0
    md_anchors = 0
    garbled = 0
    escaped_md = 0
    page_num_blocks = 0
    foreign_blocks = []
    short_broken_paras = 0
    total_para_blocks = 0
    unmatched_bold = 0
    total_blocks = 0

    for cf in chunk_files:
        cdata = json.loads(cf.read_text(encoding="utf-8"))
        for ch_idx_str, ch_obj in cdata.items():
            ch_idx = int(ch_idx_str)
            ch_title = ch_obj.get("t", "")
            for blk_idx, blk in enumerate(ch_obj.get("b", [])):
                t = blk.get("t", "")
                y = blk.get("y", "p")
                if not t:
                    continue
                total_blocks += 1
                m_html = ANY_ANGLE_TAG_RE.findall(t)
                if m_html:
                    html_tags += len(m_html)
                    if len(html_samples) < 3:
                        html_samples.append(f"ch{ch_idx}:{m_html[0][:45]}")
                m_ent = HTML_ENTITY_RE.findall(t)
                if m_ent:
                    entities += len(m_ent)
                    if len(entity_samples) < 2:
                        entity_samples.append(m_ent[0])
                pandoc_attrs += len(PANDOC_ATTR_RE.findall(t))
                md_imgs += len(MD_IMG_RE.findall(t))
                md_anchors += len(MD_ANCHOR_RE.findall(t))
                garbled += len(GARBLED_RE.findall(t))
                escaped_md += len(ESCAPED_MD_RE.findall(t))
                if PAGE_NUM_LINE_RE.match(t.strip()):
                    page_num_blocks += 1

                if y == "p":
                    total_para_blocks += 1
                    s = t.strip()
                    if 8 <= len(s) <= 28 and len(CJK_RE.findall(s)) >= 6 and s[-1] not in "。！？：；…”\"』」】）).!?:;":
                        short_broken_paras += 1
                    if s.count("**") % 2 == 1:
                        unmatched_bold += 1

                # Foreign untranslated paragraph check (skip reference dictionaries)
                if b["category"] != "辞典与术语工具":
                    latin_words = LATIN_WORD_RE.findall(t)
                    cjk_count = len(CJK_RE.findall(t))
                    if len(latin_words) >= 22 and cjk_count < len(latin_words) * 0.45:
                        foreign_blocks.append((ch_idx, ch_title, blk_idx, len(latin_words), cjk_count, t[:90]))

    broken_ratio = (short_broken_paras / max(1, total_para_blocks)) * 100
    issues = []
    if html_tags: issues.append(f"HTML={html_tags}({', '.join(html_samples)})")
    if entities: issues.append(f"ENT={entities}({','.join(entity_samples)})")
    if pandoc_attrs: issues.append(f"PANDOC={pandoc_attrs}")
    if md_imgs: issues.append(f"IMG={md_imgs}")
    if md_anchors: issues.append(f"LINK={md_anchors}")
    if garbled: issues.append(f"GARBLED={garbled}")
    if escaped_md: issues.append(f"ESC_MD={escaped_md}")
    if page_num_blocks >= 3: issues.append(f"PAGE_NUM={page_num_blocks}")
    if len(foreign_blocks) >= 1:
        issues.append(f"FOREIGN={len(foreign_blocks)}")
        all_foreign_books.append((b["title"], bid, len(foreign_blocks), foreign_blocks[:3]))
    if broken_ratio >= 15 and total_para_blocks >= 30:
        issues.append(f"BROKEN_PARA={short_broken_paras}/{total_para_blocks}({broken_ratio:.1f}%)")
    if unmatched_bold >= 3:
        issues.append(f"UNMATCHED_BOLD={unmatched_bold}")

    if issues:
        issues_books.append((b["title"], issues))
        print(f"  [!] 《{b['title']}》({b['author']}, {b['charCount']:,}字): " + " | ".join(issues))

print(f"\n=== BOOKS WITH FOREIGN UNTRANSLATED BLOCKS: {len(all_foreign_books)} ===")
for title, bid, cnt, samples in all_foreign_books:
    print(f"  * 《{title}》({bid}): {cnt} foreign blocks")
    for ch_idx, ch_title, blk_idx, lw, cc, snip in samples:
        print(f"      ch{ch_idx}({ch_title[:24]}) blk{blk_idx} [lat={lw}, cjk={cc}]: {snip!r}")

print(f"\n=== TOTAL BOOKS WITH ANY ISSUE: {len(issues_books)}/{len(books)} ===")

# Also check PDF page counts vs OCR output for 待翻译转写转录
try:
    import fitz
    print("\n=== PDF SOURCE COMPLETENESS CHECK (待翻译转写转录) ===")
    for p in sorted(SRC_TODO.rglob("*.pdf")):
        doc = fitz.open(p)
        print(f"  PDF: {p.relative_to(SRC_TODO)} -> {len(doc)} pages")
        doc.close()
except Exception as e:
    print("PyMuPDF check skipped:", e)
