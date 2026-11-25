#!/usr/bin/env python3
"""
run_translate_all.py — 极速高并发英文哲学著作 → 中文翻译流水线
使用 POST 批量分段翻译（原生保留 \n\n 段落边界，零串行回退）+ 24 路异步并发 + 哲学术语精校。
"""
import re
import time
import asyncio
import aiohttp
import pymupdf
from pathlib import Path

SRC_DIR = Path(r"D:\文献库\待翻译转写转录")
OUT_DIR = Path(r"D:\咕咕嘎嘎反重力\extra-books")
OCR_CACHE_DIR = OUT_DIR / "_ocr_cache"

GLOSSARY = [
    ("辩证法启蒙", "启蒙辩证法"),
    ("现象学的精神", "精神现象学"),
    ("精神的现象学", "精神现象学"),
    ("纯粹理性的批判", "纯粹理性批判"),
    ("实践理性的批判", "实践理性批判"),
    ("判断力的批判", "判断力批判"),
    ("意识形态国家设备", "意识形态国家机器"),
    ("意识形态的国家机器", "意识形态国家机器"),
    ("文化产业", "文化工业"),
    ("绝对的想法", "绝对理念"),
    ("否定辩证法", "否定的辩证法"),
]


def extract_english_pdf(pdf_path: Path, title: str) -> str:
    doc = pymupdf.open(str(pdf_path))
    toc = doc.get_toc()
    toc_by_page = {}
    for lvl, heading, pnum in toc:
        p0 = max(0, int(pnum) - 1)
        hc = heading.strip()
        if hc and not re.match(r'^(Cover|Title|Copyright|Contents|Table of Contents)$', hc, re.I):
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
            raw = txt.strip()
            if not raw:
                continue
            if (y0 < page_h * 0.065 or y1 > page_h * 0.935) and re.fullmatch(r'[\d\s·\-—ivxIVX]+', raw):
                continue
            cleaned = re.sub(r'-\s*\n\s*', '', raw)
            cleaned = re.sub(r'\s*\n\s*', ' ', cleaned)
            cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip()
            if not cleaned:
                continue
            if len(cleaned) <= 55 and re.match(
                r'^(CHAPTER\s+\w+.*|PART\s+\w+.*|CONSPECTUS\s+OF\s+.*|PREFACE.*|INTRODUCTION.*|APPENDIX.*|EXCURSUS.*)$',
                cleaned,
                re.I,
            ):
                parts.append(f"## {cleaned}")
            else:
                parts.append(cleaned)
    doc.close()
    return "\n\n".join(parts)


def polish_zh(zh: str) -> str:
    for bad, good in GLOSSARY:
        zh = zh.replace(bad, good)
    zh = re.sub(r'[ \t]+([，。！？；：、》）】])', r'\1', zh)
    zh = re.sub(r'([《（【])[ \t]+', r'\1', zh)
    return zh.strip()


async def post_translate(session: aiohttp.ClientSession, sem: asyncio.Semaphore, text: str) -> str:
    if not text.strip() or not re.search(r'[A-Za-z]{2,}', text):
        return text
    async with sem:
        for attempt in range(4):
            try:
                url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t"
                async with session.post(
                    url,
                    data={"q": text},
                    timeout=aiohttp.ClientTimeout(total=22),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json(content_type=None)
                        out = "".join(seg[0] for seg in (data[0] or []) if seg and seg[0])
                        if out.strip():
                            return out
                    elif resp.status in (429, 503):
                        await asyncio.sleep(1.5 * (attempt + 1))
            except Exception:
                await asyncio.sleep(0.8 * (attempt + 1))
        return text


async def translate_md_fast(en_md: str, title: str) -> str:
    paras = [p.strip() for p in re.split(r'\n{2,}', en_md) if p.strip()]
    # 将短段落合并为 ~3200 字符大块（标题块单独保持），用 \n\n 连接，翻译后自然保留所有段落与标题
    chunks = []
    cur_buf = []
    cur_len = 0

    def flush():
        nonlocal cur_buf, cur_len
        if cur_buf:
            chunks.append(("\n\n".join(cur_buf), ""))
            cur_buf = []
            cur_len = 0

    for idx, p in enumerate(paras):
        if idx == 0 and p.startswith("# "):
            chunks.append((title, "KEEP_TITLE"))
            continue
        m = re.match(r'^(#{1,4})\s+(.+)$', p)
        if m:
            flush()
            chunks.append((m.group(2).strip(), m.group(1) + " "))
            continue
        if len(p) > 3200:
            flush()
            # 切分超长段落
            for s in range(0, len(p), 2800):
                chunks.append((p[s : s + 2800], ""))
            continue
        if cur_buf and cur_len + len(p) + 2 > 3000:
            flush()
        cur_buf.append(p)
        cur_len += len(p) + 2
    flush()

    print(f"[TRANSLATE] {title}: {len(paras)} paras -> {len(chunks)} chunks", flush=True)
    t0 = time.time()
    sem = asyncio.Semaphore(20)
    results = [""] * len(chunks)

    async with aiohttp.ClientSession(headers={"User-Agent": "Mozilla/5.0"}) as session:
        async def work(i, txt, prefix):
            if prefix == "KEEP_TITLE":
                results[i] = f"# {txt}"
                return
            zh = await post_translate(session, sem, txt)
            zh = polish_zh(zh)
            if prefix:
                results[i] = prefix + zh.replace("\n", " ")
            else:
                results[i] = zh

        batch_w = 40
        for start in range(0, len(chunks), batch_w):
            end = min(len(chunks), start + batch_w)
            await asyncio.gather(*(work(i, chunks[i][0], chunks[i][1]) for i in range(start, end)))
            print(f"  -> {title}: {end}/{len(chunks)} chunks ({time.time()-t0:.1f}s)", flush=True)

    return "\n\n".join(r for r in results if r.strip())


async def main():
    # 1. 先翻译两个原生英文文本层 PDF
    direct_jobs = [
        ("enlightenment", SRC_DIR / "【英文】启蒙辩证法-霍克海默，阿多诺.pdf", OUT_DIR / "启蒙辩证法.md", "启蒙辩证法：哲学断片"),
        ("lenin38", SRC_DIR / "Lenin_Collected_Works_Volume_38_Philosophical_Notebooks_(Vladimir_Ilyich_Lenin)_(z-library.sk,_1lib.sk,_z-lib.sk).pdf", OUT_DIR / "列宁哲学笔记.md", "列宁哲学笔记（全集第38卷）"),
    ]
    for tid, pdf_p, out_p, title in direct_jobs:
        if out_p.exists() and out_p.stat().st_size > 2000:
            print(f"[SKIP TRANSLATE] {out_p.name}", flush=True)
            continue
        en_md = extract_english_pdf(pdf_p, title)
        zh_md = await translate_md_fast(en_md, title)
        out_p.write_text(zh_md, encoding="utf-8")
        print(f"[TRANSLATED SAVED] {out_p.name} ({len(zh_md):,} chars)", flush=True)

    # 2. 等待并翻译两个英文扫描 OCR 成果（美学与政治、黑格尔哲学）
    ocr_en_jobs = [
        ("aesthetics_politics", OCR_CACHE_DIR / "aesthetics_politics_en.md", OUT_DIR / "美学与政治.md", "美学与政治"),
        ("stace_hegel", OCR_CACHE_DIR / "stace_hegel_en.md", OUT_DIR / "黑格尔哲学（斯退士）.md", "黑格尔哲学（斯退士）"),
    ]
    pending = [j for j in ocr_en_jobs if not (j[2].exists() and j[2].stat().st_size > 2000)]
    while pending:
        progressed = False
        for job in list(pending):
            tid, en_path, out_p, title = job
            if en_path.exists() and en_path.stat().st_size > 2000:
                en_md = en_path.read_text(encoding="utf-8")
                zh_md = await translate_md_fast(en_md, title)
                out_p.write_text(zh_md, encoding="utf-8")
                print(f"[TRANSLATED SAVED] {out_p.name} ({len(zh_md):,} chars)", flush=True)
                pending.remove(job)
                progressed = True
        if pending and not progressed:
            await asyncio.sleep(5)

    print("\nALL 4 ENGLISH BOOKS TRANSLATED!", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
