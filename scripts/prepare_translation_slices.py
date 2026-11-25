#!/usr/bin/env python3
"""
prepare_translation_slices.py — 为 4 部英文哲学原著提取干净、完整、零乱码的英文原文，
并按自然段落切分为 ~2,600–3,000 词的高质量翻译分片，供 AI 逐段精译（绝不删节、绝不省略）。
"""
import os
import re
import json
import unicodedata
from pathlib import Path
import pymupdf

SRC_DIR = Path(r"D:\文献库\待翻译转写转录")
OCR_CACHE_DIR = Path(r"D:\咕咕嘎嘎反重力\extra-books\_ocr_cache")
WORK_DIR = Path(r"D:\咕咕嘎嘎反重力\translation-work")

BOOKS = [
    {
        "id": "aesthetics_politics",
        "title": "美学与政治",
        "out_name": "美学与政治.md",
        "author": "阿多诺 / 本雅明 / 布洛赫 / 布莱希特 / 卢卡奇",
        "kind": "md",
        "src": OCR_CACHE_DIR / "aesthetics_politics_en.md",
    },
    {
        "id": "enlightenment",
        "title": "启蒙辩证法：哲学断片",
        "out_name": "启蒙辩证法.md",
        "author": "霍克海默 / 阿多诺",
        "kind": "pdf",
        "src": SRC_DIR / "【英文】启蒙辩证法-霍克海默，阿多诺.pdf",
    },
    {
        "id": "stace_hegel",
        "title": "黑格尔哲学（斯退士）",
        "out_name": "黑格尔哲学（斯退士）.md",
        "author": "W. T. 斯退士",
        "kind": "md",
        "src": OCR_CACHE_DIR / "stace_hegel_en.md",
    },
    {
        "id": "lenin38",
        "title": "列宁哲学笔记（全集第38卷）",
        "out_name": "列宁哲学笔记.md",
        "author": "弗拉基米尔·列宁",
        "kind": "pdf",
        "src": SRC_DIR / "Lenin_Collected_Works_Volume_38_Philosophical_Notebooks_(Vladimir_Ilyich_Lenin)_(z-library.sk,_1lib.sk,_z-lib.sk).pdf",
    },
]

# Adobe Small Caps & 常见 PDF 连字/私用区字符还原
LIGATURES = {
    "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl",
    "\ufb03": "ffi", "\ufb04": "ffl", "\ufb05": "ft", "\ufb06": "st",
}


def clean_english_garbled(text: str) -> str:
    out = []
    for ch in text:
        cp = ord(ch)
        # Adobe Small Caps PUA: U+F761..U+F77A -> 'a'..'z', U+F730..U+F739 -> '0'..'9'
        if 0xF761 <= cp <= 0xF77A:
            out.append(chr(cp - 0xF761 + ord("a")))
        elif 0xF730 <= cp <= 0xF739:
            out.append(chr(cp - 0xF730 + ord("0")))
        elif ch in LIGATURES:
            out.append(LIGATURES[ch])
        elif 0xE000 <= cp <= 0xF8FF or cp == 0xFFFD or (cp < 32 and ch not in ("\n", "\r", "\t")):
            # 清除不可渲染的 PDF 私用区乱码与替换符
            continue
        else:
            out.append(ch)
    s = "".join(out)
    s = unicodedata.normalize("NFC", s)
    return s


def extract_clean_pdf(pdf_path: Path, title: str) -> str:
    doc = pymupdf.open(str(pdf_path))
    toc = doc.get_toc()
    toc_by_page = {}
    for lvl, heading, pnum in toc:
        p0 = max(0, int(pnum) - 1)
        hc = clean_english_garbled(heading).strip()
        if hc and not re.match(r"^(Cover|Title|Copyright|Contents|Table of Contents)$", hc, re.I):
            toc_by_page.setdefault(p0, []).append((min(3, max(1, lvl)), hc))

    parts = [f"# {title}"]
    for i in range(len(doc)):
        if i in toc_by_page:
            for lvl, htxt in toc_by_page[i]:
                parts.append(f"{'#' * min(3, lvl + 1)} {htxt}")
        blocks = doc[i].get_text("blocks")
        blocks.sort(key=lambda b: (round(b[1], 1), round(b[0], 1)))
        page_h = doc[i].rect.height
        for x0, y0, x1, y1, txt, *_ in blocks:
            raw = clean_english_garbled(txt).strip()
            if not raw:
                continue
            if (y0 < page_h * 0.065 or y1 > page_h * 0.935) and re.fullmatch(r"[\d\s·\-—ivxIVX]+", raw):
                continue
            cleaned = re.sub(r"-\s*\n\s*", "", raw)
            cleaned = re.sub(r"\s*\n\s*", " ", cleaned)
            cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
            if not cleaned:
                continue
            if len(cleaned) <= 60 and re.match(
                r"^(CHAPTER\s+\w+.*|PART\s+\w+.*|CONSPECTUS\s+OF\s+.*|PREFACE.*|INTRODUCTION.*|APPENDIX.*|EXCURSUS.*)$",
                cleaned,
                re.I,
            ):
                parts.append(f"## {cleaned}")
            else:
                parts.append(cleaned)
    doc.close()
    return "\n\n".join(parts)


def slice_paragraphs(md_text: str, target_words: int = 2400) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n{2,}", md_text) if p.strip()]
    slices = []
    cur = []
    cur_words = 0
    for p in paras:
        w = len(p.split())
        is_heading = p.startswith("#")
        if cur and ((cur_words >= target_words) or (is_heading and cur_words >= target_words * 0.65)):
            slices.append("\n\n".join(cur))
            cur = []
            cur_words = 0
        cur.append(p)
        cur_words += w
    if cur:
        slices.append("\n\n".join(cur))
    return slices


def main():
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []

    for b in BOOKS:
        src_path: Path = b["src"]
        if not src_path.exists():
            print(f"[MISSING] {src_path}")
            continue
        if b["kind"] == "pdf":
            en_md = extract_clean_pdf(src_path, b["title"])
        else:
            en_md = clean_english_garbled(src_path.read_text(encoding="utf-8", errors="replace"))

        bdir = WORK_DIR / b["id"]
        src_dir = bdir / "src"
        zh_dir = bdir / "zh"
        src_dir.mkdir(parents=True, exist_ok=True)
        zh_dir.mkdir(parents=True, exist_ok=True)

        # 清理旧分片以防数量变化
        for old in src_dir.glob("part_*.md"):
            old.unlink()

        slices = slice_paragraphs(en_md, target_words=2400)
        part_entries = []
        for idx, sl in enumerate(slices, 1):
            sp = src_dir / f"part_{idx:03d}.md"
            zp = zh_dir / f"part_{idx:03d}.md"
            sp.write_text(sl, encoding="utf-8")
            part_entries.append({
                "index": idx,
                "src": str(sp),
                "zh": str(zp),
                "words": len(sl.split()),
                "chars": len(sl),
            })

        total_w = sum(p["words"] for p in part_entries)
        manifest.append({
            "id": b["id"],
            "title": b["title"],
            "author": b["author"],
            "out_name": b["out_name"],
            "part_count": len(part_entries),
            "total_words": total_w,
            "parts": part_entries,
        })
        print(f"[PREPARED] {b['title']:18s} | {total_w:7,d} words -> {len(part_entries):3d} clean slices (zero PUA/garbled)")

    (WORK_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nTotal slices across 4 books: {sum(m['part_count'] for m in manifest)}")


if __name__ == "__main__":
    main()
