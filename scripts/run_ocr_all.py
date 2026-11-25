#!/usr/bin/env python3
"""
run_ocr_all.py — RTX 5070 Ti GPU (DirectML) 极速 OCR 引擎
采用「后台线程预渲染 PDF 页面 + 双路 DirectML GPU 并发识别 (rec_batch_num=32)」流水线，
自动切分双页横屏扫描件，支持断点续传与 PDF 书签目录注入。
"""
import os
import re
import json
import time
import queue
import threading
import statistics
from pathlib import Path

import pymupdf
import numpy as np
from rapidocr_onnxruntime import RapidOCR

SRC_DIR = Path(r"D:\文献库\待翻译转写转录")
OUT_DIR = Path(r"D:\咕咕嘎嘎反重力\extra-books")
OCR_CACHE_DIR = OUT_DIR / "_ocr_cache"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OCR_CACHE_DIR.mkdir(parents=True, exist_ok=True)

OCR_TASKS = [
    # 先跑 2 部英文扫描原著，方便后台翻译进程无缝接力
    ("aesthetics_politics", "美学与政治学（英文）-阿多诺，本雅明，布洛赫，布莱希特，卢卡奇.pdf", None, "en", "美学与政治"),
    ("stace_hegel", "The_Philosophy_of_Hegel_(W.T._Stace)_(z-library.sk,_1lib.sk,_z-lib.sk).pdf", None, "en", "黑格尔哲学（斯退士）"),
    # 9 部张世英中文扫描典籍
    ("zsy_phenom_review", r"张世英系列\黑格尔《精神现象学》述评.pdf", "黑格尔《精神现象学》述评.md", "zh", "黑格尔《精神现象学》述评"),
    ("zsy_west_hist", r"张世英系列\西方哲学史 - 图文版.pdf", "西方哲学史（张世英）.md", "zh", "西方哲学史"),
    ("zsy_kant", r"张世英系列\康德的《纯粹理性批判》.pdf", "康德的《纯粹理性批判》.md", "zh", "康德的《纯粹理性批判》"),
    ("zsy_five_lectures", r"张世英系列\张世英黑格尔哲学五讲.pdf", "张世英黑格尔哲学五讲.md", "zh", "张世英黑格尔哲学五讲"),
    ("zsy_self_realize", r"张世英系列\自我实现的历程  解读黑格尔《精神现象学».pdf", "自我实现的历程：解读黑格尔《精神现象学》.md", "zh", "自我实现的历程：解读黑格尔《精神现象学》"),
    ("zsy_german_essays", r"张世英系列\德国哲学论丛.pdf", "德国哲学论丛.md", "zh", "德国哲学论丛"),
    ("zsy_logic", r"张世英系列\论黑格尔的逻辑学  第3版 -- 张世英编著.pdf", "论黑格尔的逻辑学.md", "zh", "论黑格尔的逻辑学"),
    ("zsy_hegel_intro", r"张世英系列\黑格尔哲学概论 张世英著.pdf", "黑格尔哲学概论.md", "zh", "黑格尔哲学概论"),
    ("zsy_small_logic", r"张世英系列\黑格尔《小逻辑》译注.pdf", "黑格尔《小逻辑》译注.md", "zh", "黑格尔《小逻辑》译注"),
]


def merge_boxes(res, lang: str) -> str:
    if not res:
        return ""
    items = []
    for box, txt, sc in res:
        if sc is not None and sc < 0.36:
            continue
        t = str(txt).strip()
        if not t:
            continue
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        items.append((min(xs), min(ys), max(xs), max(ys), t))
    if not items:
        return ""

    page_h = max(it[3] for it in items)
    page_w = max(it[2] for it in items)
    filtered = [
        it for it in items
        if not ((it[1] < page_h * 0.06 or it[3] > page_h * 0.94) and re.fullmatch(r'[\d\s·\-—ivxIVX]+', it[4]))
    ]
    items = filtered or items
    items.sort(key=lambda a: (a[1], a[0]))
    med_h = statistics.median([a[3] - a[1] for a in items]) if items else 20.0

    lines = []
    for it in items:
        if lines and abs(it[1] - lines[-1]["y0"]) < med_h * 0.55:
            lines[-1]["parts"].append(it)
            lines[-1]["y1"] = max(lines[-1]["y1"], it[3])
            lines[-1]["x0"] = min(lines[-1]["x0"], it[0])
            lines[-1]["x1"] = max(lines[-1]["x1"], it[2])
        else:
            lines.append({"x0": it[0], "y0": it[1], "x1": it[2], "y1": it[3], "parts": [it]})

    sep = " " if lang == "en" else ""
    mlines = []
    for ln in lines:
        ln["parts"].sort(key=lambda a: a[0])
        txt = sep.join(p[4] for p in ln["parts"]).strip()
        if txt:
            mlines.append({"x0": ln["x0"], "x1": ln["x1"], "y0": ln["y0"], "y1": ln["y1"], "t": txt})
    if not mlines:
        return ""

    left_margin = statistics.median([l["x0"] for l in mlines])
    paras = []
    cur = mlines[0]
    buf = cur["t"]
    for nxt in mlines[1:]:
        gap = nxt["y0"] - cur["y1"]
        is_indented = (nxt["x0"] - left_margin) > med_h * 1.1
        is_big_gap = gap > med_h * 0.95
        is_heading = len(nxt["t"]) < 42 and bool(
            re.match(r'^(第[零一二三四五六七八九十百千万0-9]+[章节讲编篇部回]|CHAPTER\s+\w+|PART\s+\w+|[一二三四五六七八九十]+、)', nxt["t"], re.I)
        )
        ends_sent = bool(re.search(r'[。！？.!?:;”"’\']$', buf))
        prev_short = (cur["x1"] < page_w * 0.72) and ends_sent
        if is_indented or is_big_gap or is_heading or prev_short:
            paras.append(buf.strip())
            buf = nxt["t"]
        else:
            if lang == "en":
                buf = (buf[:-1] + nxt["t"]) if (buf.endswith("-") and not buf.endswith("--")) else (buf + " " + nxt["t"])
            else:
                buf = buf + nxt["t"]
        cur = nxt
    if buf.strip():
        paras.append(buf.strip())

    out = []
    for p in paras:
        if len(p) <= 44 and re.match(
            r'^(第[零一二三四五六七八九十百千万0-9]+[章节讲编篇部回][\s　：:]*.*|导\s*论|绪\s*论|引\s*言|序\s*言|前\s*言|后\s*记|结\s*语|CHAPTER\s+.*|PART\s+.*)$',
            p,
            re.I,
        ):
            out.append(f"## {p}")
        else:
            out.append(p)
    return "\n\n".join(out)


def ocr_book_gpu(eng: RapidOCR, pdf_path: Path, task_id: str, lang: str, title: str, dpi: int = 150) -> str:
    doc = pymupdf.open(str(pdf_path))
    n_pages = len(doc)
    toc = doc.get_toc()

    cache_file = OCR_CACHE_DIR / f"{task_id}.json"
    page_texts = {}
    if cache_file.exists():
        try:
            page_texts = {int(k): v for k, v in json.loads(cache_file.read_text(encoding="utf-8")).items()}
        except Exception:
            page_texts = {}

    todo = [i for i in range(n_pages) if i not in page_texts]
    if todo:
        print(f"\n[GPU OCR] {title}: {len(todo)}/{n_pages} pages on RTX 5070 Ti...", flush=True)
        t0 = time.time()
        q: queue.Queue = queue.Queue(maxsize=16)

        def producer():
            for idx in todo:
                page = doc[idx]
                rect = page.rect
                target_dpi = dpi
                if rect.width * (target_dpi / 72.0) > 1650:
                    target_dpi = max(90, int(1650 * 72.0 / rect.width))
                pix = page.get_pixmap(dpi=target_dpi, colorspace=pymupdf.csRGB)
                img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()
                is_spread = (rect.width / max(1.0, rect.height)) > 1.05
                q.put((idx, img, is_spread))
            q.put(None)

        prod_thread = threading.Thread(target=producer, daemon=True)
        prod_thread.start()

        done_now = 0
        while True:
            item = q.get()
            if item is None:
                break
            idx, img, is_spread = item
            if is_spread:
                mid = img.shape[1] // 2
                res_l, _ = eng(np.ascontiguousarray(img[:, :mid, :]))
                res_r, _ = eng(np.ascontiguousarray(img[:, mid:, :]))
                tl = merge_boxes(res_l, lang)
                tr = merge_boxes(res_r, lang)
                page_texts[idx] = "\n\n".join(x for x in (tl, tr) if x)
            else:
                res, _ = eng(img)
                page_texts[idx] = merge_boxes(res, lang)

            done_now += 1
            if done_now % 50 == 0 or done_now == len(todo):
                cache_file.write_text(
                    json.dumps({str(k): v for k, v in page_texts.items()}, ensure_ascii=False),
                    encoding="utf-8",
                )
                spd = done_now / max(0.1, time.time() - t0)
                print(f"  -> {title}: {len(page_texts)}/{n_pages}p ({spd:.2f} p/s)", flush=True)

        prod_thread.join()

    doc.close()

    toc_by_page = {}
    for lvl, heading, pnum in toc:
        p0 = max(0, int(pnum) - 1)
        hc = heading.strip()
        if hc and not re.match(r'^(封面|书名页|版权页|目录|目次|Contents)$', hc, re.I):
            toc_by_page.setdefault(p0, []).append((min(3, max(1, lvl)), hc))

    parts = [f"# {title}"]
    for i in range(n_pages):
        if i in toc_by_page:
            for lvl, htxt in toc_by_page[i]:
                parts.append(f"{'#' * min(3, lvl + 1)} {htxt}")
        pt = (page_texts.get(i) or "").strip()
        if pt:
            parts.append(pt)
    return "\n\n".join(parts)


def main():
    print("Initializing RapidOCR on RTX 5070 Ti (DirectML GPU)...", flush=True)
    eng = RapidOCR(det_use_dml=True, rec_use_dml=True, use_cls=False, rec_batch_num=32)

    t_all = time.time()
    for task_id, rel_path, zh_out_name, lang, title in OCR_TASKS:
        final_md_path = (OUT_DIR / zh_out_name) if zh_out_name else (OCR_CACHE_DIR / f"{task_id}_en.md")
        if final_md_path.exists() and final_md_path.stat().st_size > 2000:
            print(f"[SKIP GPU OCR DONE] {title}", flush=True)
            continue

        pdf_path = SRC_DIR / rel_path
        if not pdf_path.exists():
            print(f"[MISSING] {pdf_path}", flush=True)
            continue

        md = ocr_book_gpu(eng, pdf_path, task_id, lang, title, dpi=150)
        final_md_path.write_text(md, encoding="utf-8")
        print(f"[GPU OCR SAVED] {final_md_path.name} ({len(md):,} chars)", flush=True)

    print(f"\nALL 11 GPU OCR TASKS COMPLETE in {time.time()-t_all:.1f}s!", flush=True)


if __name__ == "__main__":
    main()
