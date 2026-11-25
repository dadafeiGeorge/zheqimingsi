#!/usr/bin/env python3
"""
process_extra_books.py — 将 d:\文献库\待翻译转写转录 中的全部外语/中文书籍
进行高质量 PDF 文本抽取、多进程并行 RapidOCR 转录（自动切分双页扫描）、
嵌入式目录注入与异步英文→中文哲学学术翻译，输出规范 Markdown 至 extra-books/。
"""
import os
import re
import sys
import json
import time
import shutil
import asyncio
import statistics
import urllib.parse
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor

# 限制单进程内 ONNX/OpenMP 线程数，避免多进程抢核导致吞吐下降
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"

import pymupdf
import numpy as np
import aiohttp

SRC_DIR = Path(r"D:\文献库\待翻译转写转录")
OUT_DIR = Path(r"D:\咕咕嘎嘎反重力\extra-books")
OCR_CACHE_DIR = OUT_DIR / "_ocr_cache"
EXISTING_READING_CAPITAL = Path(r"D:\文献库\读《资本论》-阿尔都塞\读《资本论》.md")

OUT_DIR.mkdir(parents=True, exist_ok=True)
OCR_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# 任务清单: (id, source_rel_path, out_filename, mode, lang, title)
# mode: 'text_pdf' | 'ocr_pdf'
# lang: 'zh' | 'en'
TASKS = [
    # 1. 直接抽取中文文本层 PDF
    ("reproduction", "论再生产.pdf", "论再生产.md", "text_pdf", "zh", "论再生产"),
    ("zsy_intro", r"张世英系列\哲学导论.pdf", "哲学导论.md", "text_pdf", "zh", "哲学导论"),
    # 2. 直接抽取英文文本层 PDF -> 翻译成中文
    ("enlightenment", "【英文】启蒙辩证法-霍克海默，阿多诺.pdf", "启蒙辩证法.md", "text_pdf", "en", "启蒙辩证法：哲学断片"),
    ("lenin38", "Lenin_Collected_Works_Volume_38_Philosophical_Notebooks_(Vladimir_Ilyich_Lenin)_(z-library.sk,_1lib.sk,_z-lib.sk).pdf", "列宁哲学笔记.md", "text_pdf", "en", "列宁哲学笔记（全集第38卷）"),
    # 3. 扫描版英文 PDF -> 并行 OCR -> 翻译成中文
    ("aesthetics_politics", "美学与政治学（英文）-阿多诺，本雅明，布洛赫，布莱希特，卢卡奇.pdf", "美学与政治.md", "ocr_pdf", "en", "美学与政治"),
    ("stace_hegel", "The_Philosophy_of_Hegel_(W.T._Stace)_(z-library.sk,_1lib.sk,_z-lib.sk).pdf", "黑格尔哲学（斯退士）.md", "ocr_pdf", "en", "黑格尔哲学（斯退士）"),
    # 4. 张世英系列中文扫描版 PDF -> 并行 OCR 转录
    ("zsy_phenom_review", r"张世英系列\黑格尔《精神现象学》述评.pdf", "黑格尔《精神现象学》述评.md", "ocr_pdf", "zh", "黑格尔《精神现象学》述评"),
    ("zsy_west_hist", r"张世英系列\西方哲学史 - 图文版.pdf", "西方哲学史（张世英）.md", "ocr_pdf", "zh", "西方哲学史"),
    ("zsy_kant", r"张世英系列\康德的《纯粹理性批判》.pdf", "康德的《纯粹理性批判》.md", "ocr_pdf", "zh", "康德的《纯粹理性批判》"),
    ("zsy_five_lectures", r"张世英系列\张世英黑格尔哲学五讲.pdf", "张世英黑格尔哲学五讲.md", "ocr_pdf", "zh", "张世英黑格尔哲学五讲"),
    ("zsy_self_realize", r"张世英系列\自我实现的历程  解读黑格尔《精神现象学».pdf", "自我实现的历程：解读黑格尔《精神现象学》.md", "ocr_pdf", "zh", "自我实现的历程：解读黑格尔《精神现象学》"),
    ("zsy_german_essays", r"张世英系列\德国哲学论丛.pdf", "德国哲学论丛.md", "ocr_pdf", "zh", "德国哲学论丛"),
    ("zsy_logic", r"张世英系列\论黑格尔的逻辑学  第3版 -- 张世英编著.pdf", "论黑格尔的逻辑学.md", "ocr_pdf", "zh", "论黑格尔的逻辑学"),
    ("zsy_hegel_intro", r"张世英系列\黑格尔哲学概论 张世英著.pdf", "黑格尔哲学概论.md", "ocr_pdf", "zh", "黑格尔哲学概论"),
    ("zsy_small_logic", r"张世英系列\黑格尔《小逻辑》译注.pdf", "黑格尔《小逻辑》译注.md", "ocr_pdf", "zh", "黑格尔《小逻辑》译注"),
]

# 哲学核心术语后处理校对表（提升英译中专业学术一致性）
PHILOSOPHY_GLOSSARY = [
    ("辩证法启蒙", "启蒙辩证法"),
    ("现象学的精神", "精神现象学"),
    ("精神的现象学", "精神现象学"),
    ("纯粹理性的批判", "纯粹理性批判"),
    ("实践理性的批判", "实践理性批判"),
    ("判断力的批判", "判断力批判"),
    ("逻辑科学", "逻辑学"),
    ("逻辑的科学", "逻辑学"),
    ("意识形态国家设备", "意识形态国家机器"),
    ("意识形态的国家机器", "意识形态国家机器"),
    ("镇压性国家设备", "镇压性国家机器"),
    ("再生物化", "物化"),
    ("文化产业", "文化工业"),
    ("工具理性", "工具理性"),
    ("否定辩证法", "否定的辩证法"),
    ("绝对的想法", "绝对理念"),
    ("绝对思想", "绝对理念"),
    ("自在自为", "自在自为"),
]

# -------- 多进程 RapidOCR Worker --------
_worker_ocr = None


def _init_ocr_worker():
    global _worker_ocr
    os.environ["OMP_NUM_THREADS"] = "1"
    os.environ["OPENBLAS_NUM_THREADS"] = "1"
    os.environ["MKL_NUM_THREADS"] = "1"
    from rapidocr_onnxruntime import RapidOCR
    _worker_ocr = RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)


def _merge_ocr_boxes(res, lang: str) -> str:
    if not res:
        return ""
    items = []
    for box, txt, sc in res:
        if sc is not None and sc < 0.38:
            continue
        t = str(txt).strip()
        if not t:
            continue
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        items.append((min(xs), min(ys), max(xs), max(ys), t))
    if not items:
        return ""

    # 过滤页眉页脚纯页码
    page_h = max(it[3] for it in items)
    page_w = max(it[2] for it in items)
    filtered = []
    for x0, y0, x1, y1, t in items:
        if (y0 < page_h * 0.06 or y1 > page_h * 0.94) and re.fullmatch(r'[\d\s·\-—ivxIVX]+', t):
            continue
        filtered.append((x0, y0, x1, y1, t))
    items = filtered or items

    # 先按 y 排序，再合并同一行水平邻近块
    items.sort(key=lambda a: (a[1], a[0]))
    heights = [a[3] - a[1] for a in items]
    med_h = statistics.median(heights) if heights else 20.0

    lines = []
    for it in items:
        if lines and abs(it[1] - lines[-1]["y0"]) < med_h * 0.55:
            lines[-1]["parts"].append(it)
            lines[-1]["y1"] = max(lines[-1]["y1"], it[3])
            lines[-1]["x0"] = min(lines[-1]["x0"], it[0])
            lines[-1]["x1"] = max(lines[-1]["x1"], it[2])
        else:
            lines.append({"x0": it[0], "y0": it[1], "x1": it[2], "y1": it[3], "parts": [it]})

    merged_lines = []
    sep = " " if lang == "en" else ""
    for ln in lines:
        ln["parts"].sort(key=lambda a: a[0])
        txt = sep.join(p[4] for p in ln["parts"]).strip()
        if txt:
            merged_lines.append({
                "x0": ln["x0"],
                "x1": ln["x1"],
                "y0": ln["y0"],
                "y1": ln["y1"],
                "h": ln["y1"] - ln["y0"],
                "t": txt,
            })

    if not merged_lines:
        return ""

    # 段落拼接：根据行距、首行缩进和句末标点判断分段
    left_margin = statistics.median([l["x0"] for l in merged_lines])
    paras = []
    cur = merged_lines[0]
    buf = cur["t"]

    for nxt in merged_lines[1:]:
        gap = nxt["y0"] - cur["y1"]
        is_indented = (nxt["x0"] - left_margin) > med_h * 1.15
        is_big_gap = gap > med_h * 0.95
        is_heading_like = (
            re.match(r'^(第[零一二三四五六七八九十百千万0-9]+[章节讲编篇部回]|CHAPTER\s+\w+|PART\s+\w+|[一二三四五六七八九十]+、)', nxt["t"], re.I)
            and len(nxt["t"]) < 42
        )
        ends_sent = bool(re.search(r'[。！？.!?:;”"’\']$', buf))
        prev_short = (cur["x1"] < page_w * 0.72) and ends_sent

        if is_indented or is_big_gap or is_heading_like or prev_short:
            paras.append(buf.strip())
            buf = nxt["t"]
        else:
            if lang == "en":
                if buf.endswith("-") and not buf.endswith("--"):
                    buf = buf[:-1] + nxt["t"]
                else:
                    buf = buf + " " + nxt["t"]
            else:
                buf = buf + nxt["t"]
        cur = nxt

    if buf.strip():
        paras.append(buf.strip())

    # 识别明显章节标题加 Markdown 标题标记
    out_blocks = []
    for p in paras:
        if len(p) <= 44 and re.match(
            r'^(第[零一二三四五六七八九十百千万0-9]+[章节讲编篇部回][\s　：:]*.*|导\s*论|绪\s*论|引\s*言|序\s*言|前\s*言|后\s*记|结\s*语|CHAPTER\s+.*|PART\s+.*)$',
            p,
            re.I,
        ):
            out_blocks.append(f"## {p}")
        else:
            out_blocks.append(p)
    return "\n\n".join(out_blocks)


def _ocr_page_batch(args):
    pdf_path, page_indices, dpi, lang = args
    doc = pymupdf.open(pdf_path)
    results = {}
    for idx in page_indices:
        page = doc[idx]
        rect = page.rect
        pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)

        # 如果是双页横屏扫描（如 w/h > 1.05），自动切分为左右两页分别识别
        if rect.width / max(1.0, rect.height) > 1.05:
            mid = img.shape[1] // 2
            left_img = np.ascontiguousarray(img[:, :mid, :])
            right_img = np.ascontiguousarray(img[:, mid:, :])
            res_l, _ = _worker_ocr(left_img)
            res_r, _ = _worker_ocr(right_img)
            t_l = _merge_ocr_boxes(res_l, lang)
            t_r = _merge_ocr_boxes(res_r, lang)
            text = "\n\n".join(x for x in (t_l, t_r) if x)
        else:
            res, _ = _worker_ocr(img)
            text = _merge_ocr_boxes(res, lang)

        results[idx] = text
    doc.close()
    return results


def ocr_pdf_parallel(pdf_path: Path, task_id: str, lang: str, title: str, dpi: int = 160) -> str:
    cache_file = OCR_CACHE_DIR / f"{task_id}.json"
    doc = pymupdf.open(str(pdf_path))
    n_pages = len(doc)
    toc = doc.get_toc()
    doc.close()

    # 读取已有断点缓存
    page_texts = {}
    if cache_file.exists():
        try:
            page_texts = {int(k): v for k, v in json.loads(cache_file.read_text(encoding="utf-8")).items()}
        except Exception:
            page_texts = {}

    todo = [i for i in range(n_pages) if i not in page_texts]
    if todo:
        workers = min(14, max(4, (os.cpu_count() or 8) - 4))
        batch_size = 6
        batches = [
            (str(pdf_path), todo[i : i + batch_size], dpi, lang)
            for i in range(0, len(todo), batch_size)
        ]
        print(f"  [OCR] {title}: {len(todo)}/{n_pages} pages across {workers} workers @ {dpi}dpi...", flush=True)
        t0 = time.time()
        done_pages = len(page_texts)
        with ProcessPoolExecutor(max_workers=workers, initializer=_init_ocr_worker) as pool:
            for batch_res in pool.map(_ocr_page_batch, batches):
                page_texts.update(batch_res)
                done_pages += len(batch_res)
                if done_pages % 48 < batch_size or done_pages >= n_pages:
                    cache_file.write_text(
                        json.dumps({str(k): v for k, v in page_texts.items()}, ensure_ascii=False),
                        encoding="utf-8",
                    )
                    elapsed = time.time() - t0
                    speed = (done_pages - (n_pages - len(todo))) / max(0.1, elapsed)
                    print(f"    -> {title}: {done_pages}/{n_pages} pages ({speed:.2f} p/s)", flush=True)

        cache_file.write_text(
            json.dumps({str(k): v for k, v in page_texts.items()}, ensure_ascii=False),
            encoding="utf-8",
        )

    # 拼装全书并注入嵌入式 PDF 目录标题
    toc_by_page = {}
    for lvl, heading, pnum in toc:
        p0 = max(0, int(pnum) - 1)
        h_clean = heading.strip()
        if h_clean and not re.match(r'^(封面|书名页|版权页|目录|目次|Contents)$', h_clean, re.I):
            toc_by_page.setdefault(p0, []).append((min(3, max(1, lvl)), h_clean))

    out_parts = [f"# {title}"]
    for i in range(n_pages):
        if i in toc_by_page:
            for lvl, htxt in toc_by_page[i]:
                hashes = "#" * min(3, lvl + 1)
                out_parts.append(f"{hashes} {htxt}")
        pt = (page_texts.get(i) or "").strip()
        if pt:
            out_parts.append(pt)
    return "\n\n".join(out_parts)


def extract_text_pdf(pdf_path: Path, lang: str, title: str) -> str:
    """高质量抽取含原生文本层的 PDF，修复硬换行并注入 PDF 书签目录。"""
    doc = pymupdf.open(str(pdf_path))
    n_pages = len(doc)
    toc = doc.get_toc()
    toc_by_page = {}
    for lvl, heading, pnum in toc:
        p0 = max(0, int(pnum) - 1)
        h_clean = heading.strip()
        if h_clean and not re.match(r'^(封面|书名页|版权页|目录|目次|Contents)$', h_clean, re.I):
            toc_by_page.setdefault(p0, []).append((min(3, max(1, lvl)), h_clean))

    out_parts = [f"# {title}"]
    for i in range(n_pages):
        if i in toc_by_page:
            for lvl, htxt in toc_by_page[i]:
                out_parts.append(f"{'#' * min(3, lvl + 1)} {htxt}")

        blocks = doc[i].get_text("blocks")
        blocks.sort(key=lambda b: (round(b[1], 1), round(b[0], 1)))
        page_h = doc[i].rect.height
        page_paras = []
        for x0, y0, x1, y1, txt, *_ in blocks:
            raw = txt.strip()
            if not raw:
                continue
            # 跳过页眉页脚页码
            if (y0 < page_h * 0.065 or y1 > page_h * 0.935) and re.fullmatch(r'[\d\s·\-—ivxIVX]+', raw):
                continue
            if lang == "en":
                # 修复英文连字符断词与换行
                cleaned = re.sub(r'-\s*\n\s*', '', raw)
                cleaned = re.sub(r'\s*\n\s*', ' ', cleaned)
                cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip()
            else:
                # 修复中文 PDF 换行碎片
                cleaned = re.sub(r'(?<=[一-龥，、；：（）《》“”])\s*\n\s*(?=[一-龥，、；：（）《》“”])', '', raw)
                cleaned = re.sub(r'\s*\n\s*', ' ', cleaned).strip()
            if not cleaned:
                continue
            # 检测无书签时的章节标题
            if len(cleaned) <= 50 and re.match(
                r'^(第[零一二三四五六七八九十百千万0-9]+[章节讲编篇部回][\s　：:]*.*|CHAPTER\s+\w+.*|PART\s+\w+.*|CONSPECTUS\s+OF\s+.*|PREFACE.*|INTRODUCTION.*|附录.*|序言.*|导论.*)$',
                cleaned,
                re.I,
            ):
                page_paras.append(f"## {cleaned}")
            else:
                page_paras.append(cleaned)
        if page_paras:
            out_parts.append("\n\n".join(page_paras))
    doc.close()
    return "\n\n".join(out_parts)


# -------- 高并发异步英文 -> 中文翻译引擎 --------
async def translate_chunk(session: aiohttp.ClientSession, sem: asyncio.Semaphore, text: str) -> str:
    if not text.strip():
        return text
    # 跳过纯数字/符号行
    if not re.search(r'[A-Za-z]{2,}', text):
        return text

    async with sem:
        for attempt in range(4):
            try:
                params = {
                    "client": "gtx",
                    "sl": "en",
                    "tl": "zh-CN",
                    "dt": "t",
                    "q": text,
                }
                url = "https://translate.googleapis.com/translate_a/single?" + urllib.parse.urlencode(params)
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                    if resp.status == 200:
                        data = await resp.json(content_type=None)
                        translated = "".join(seg[0] for seg in (data[0] or []) if seg and seg[0])
                        if translated.strip():
                            return translated
                    elif resp.status in (429, 503):
                        await asyncio.sleep(1.5 * (attempt + 1))
                        continue
            except Exception:
                await asyncio.sleep(0.8 * (attempt + 1))
        return text


def apply_glossary(zh: str) -> str:
    for bad, good in PHILOSOPHY_GLOSSARY:
        zh = zh.replace(bad, good)
    # 规范中文标点间距
    zh = re.sub(r'[ \t]+([，。！？；：、》）】])', r'\1', zh)
    zh = re.sub(r'([《（【])[ \t]+', r'\1', zh)
    return zh


async def translate_markdown_en_to_zh(en_md: str, title: str) -> str:
    """按段落分批高并发翻译整部英文哲学 Markdown，完整保留所有 # 标题层级与段落结构。"""
    raw_paras = [p.strip() for p in re.split(r'\n{2,}', en_md) if p.strip()]

    # 记录每段的标题前缀（如 "## "）并分批打包（每批 <= 2200 字符，用唯一分隔符隔开）
    META = []
    for p in raw_paras:
        m = re.match(r'^(#{1,4})\s+(.+)$', p)
        if m:
            META.append((m.group(1) + " ", m.group(2).strip()))
        else:
            META.append(("", p))

    # 把短段落打包成批以大幅提升翻译速度与语境连贯性
    SEP = "\n¶¶¶\n"
    batches = []
    cur_indices = []
    cur_texts = []
    cur_len = 0

    for idx, (_prefix, body) in enumerate(META):
        if idx == 0 and _prefix == "# ":
            # 保留我们已定好的规范中文书名
            continue
        if len(body) > 2000:
            if cur_indices:
                batches.append((cur_indices, cur_texts))
                cur_indices, cur_texts, cur_len = [], [], 0
            # 超长段落单独按句切分
            batches.append(([idx], [body[:3200]]))
            continue
        if cur_indices and cur_len + len(body) + len(SEP) > 1900:
            batches.append((cur_indices, cur_texts))
            cur_indices, cur_texts, cur_len = [], [], 0
        cur_indices.append(idx)
        cur_texts.append(body)
        cur_len += len(body) + len(SEP)

    if cur_indices:
        batches.append((cur_indices, cur_texts))

    print(f"  [TRANSLATE] {title}: {len(META)} paragraphs in {len(batches)} batches...", flush=True)
    t0 = time.time()
    translated_map = {0: f"# {title}"}
    sem = asyncio.Semaphore(10)
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

    async with aiohttp.ClientSession(headers=headers) as session:
        async def run_batch(b_idx, idxs, txts):
            joined = SEP.join(txts)
            res = await translate_chunk(session, sem, joined)
            parts = [x.strip() for x in re.split(r'\s*¶\s*¶\s*¶\s*', res)]
            if len(parts) == len(idxs):
                for pi, t_zh in zip(idxs, parts):
                    prefix = META[pi][0]
                    translated_map[pi] = prefix + apply_glossary(t_zh)
            else:
                # 若分隔符数量被译文改动，降级逐段精确翻译保证零错位
                for pi, orig in zip(idxs, txts):
                    single = await translate_chunk(session, sem, orig)
                    prefix = META[pi][0]
                    translated_map[pi] = prefix + apply_glossary(single)

        chunk_size = 30
        for start in range(0, len(batches), chunk_size):
            sub = batches[start : start + chunk_size]
            await asyncio.gather(*(run_batch(start + k, idxs, txts) for k, (idxs, txts) in enumerate(sub)))
            done = min(len(batches), start + chunk_size)
            print(f"    -> {title}: translated {done}/{len(batches)} batches ({time.time()-t0:.1f}s)", flush=True)

    ordered = [translated_map.get(i, META[i][0] + META[i][1]) for i in range(len(META))]
    return "\n\n".join(ordered)


def main():
    # 0. 直接纳入同目录已有完整中文译本《读〈资本论〉》
    rc_out = OUT_DIR / "读《资本论》.md"
    if EXISTING_READING_CAPITAL.exists() and not rc_out.exists():
        shutil.copy2(EXISTING_READING_CAPITAL, rc_out)
        print(f"[COPIED] 读《资本论》.md ({rc_out.stat().st_size // 1024} KB)", flush=True)

    for task_id, rel_path, out_name, mode, lang, title in TASKS:
        out_path = OUT_DIR / out_name
        if out_path.exists() and out_path.stat().st_size > 2000:
            print(f"[SKIP DONE] {out_name} ({out_path.stat().st_size // 1024} KB)", flush=True)
            continue

        src_path = SRC_DIR / rel_path
        if not src_path.exists():
            print(f"[MISSING] {src_path}", flush=True)
            continue

        print(f"\n=== Processing: {title} ({mode}, {lang}) ===", flush=True)
        if mode == "text_pdf":
            raw_md = extract_text_pdf(src_path, lang, title)
        else:
            raw_md = ocr_pdf_parallel(src_path, task_id, lang, title, dpi=160)

        if lang == "en":
            en_cache = OCR_CACHE_DIR / f"{task_id}_en.md"
            en_cache.write_text(raw_md, encoding="utf-8")
            final_md = asyncio.run(translate_markdown_en_to_zh(raw_md, title))
        else:
            final_md = raw_md

        out_path.write_text(final_md, encoding="utf-8")
        print(f"[SAVED] {out_name} ({len(final_md):,} chars)", flush=True)

    print("\nALL EXTRA BOOKS PROCESSED SUCCESSFULLY!", flush=True)


if __name__ == "__main__":
    main()
