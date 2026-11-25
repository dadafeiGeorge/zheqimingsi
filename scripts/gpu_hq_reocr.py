#!/usr/bin/env python3
"""
gpu_hq_reocr.py — 使用 RTX 5070 Ti GPU (DirectML) 对已检出的低清/双栏/漏页 PDF 执行高精度 240~280 DPI 重扫：
1. 《西方哲学史 - 图文版.pdf》(147p)：自动检测双栏排版（左栏从上到下 -> 右栏从上到下），彻底根治双栏串行错乱，240 DPI。
2. 《黑格尔《精神现象学》述评.pdf》(117p) & 《黑格尔《小逻辑》译注.pdf》(597p)：260 DPI + 对比度增强，彻底消除 150 DPI 误识（如排斥->排尿、精神->情神、全集->企崇）。
3. 《张世英黑格尔哲学五讲.pdf》10 个低字数/空白页（含 page 268、270 等有文字漏识页）：280 DPI 补扫并补全回原书。
"""
import json
import re
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
HQ_CACHE = OUT_DIR / "_ocr_hq_cache"
HQ_CACHE.mkdir(parents=True, exist_ok=True)


def enhance_contrast(img: np.ndarray) -> np.ndarray:
    """轻度灰度对比度拉伸，让老旧发灰扫描件笔画更锐利清晰（保持 RGB 3 通道给 RapidOCR）。"""
    gray = (0.299 * img[:, :, 0] + 0.587 * img[:, :, 1] + 0.114 * img[:, :, 2]).astype(np.float32)
    p2, p98 = np.percentile(gray, (2, 98))
    if p98 - p2 > 20:
        scaled = np.clip((gray - p2) * (255.0 / (p98 - p2)), 0, 255).astype(np.uint8)
        return np.stack([scaled, scaled, scaled], axis=-1)
    return img


def merge_column_items(items: list, page_w: float, page_h: float) -> str:
    """将单栏内的 OCR 文本框按行排序并合并为自然段落。"""
    if not items:
        return ""
    # 过滤顶部/底部孤立页码与纯页眉数字
    filtered = [
        it for it in items
        if not ((it[1] < page_h * 0.065 or it[3] > page_h * 0.935) and re.fullmatch(r'[\d\s·\-—/ivxIVX第页]+', it[4]))
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

    mlines = []
    for ln in lines:
        ln["parts"].sort(key=lambda a: a[0])
        txt = "".join(p[4] for p in ln["parts"]).strip()
        if txt:
            mlines.append({"x0": ln["x0"], "x1": ln["x1"], "y0": ln["y0"], "y1": ln["y1"], "t": txt})
    if not mlines:
        return ""

    left_margin = statistics.median([l["x0"] for l in mlines])
    col_right = max(l["x1"] for l in mlines)
    col_width = max(1.0, col_right - left_margin)

    paras = []
    cur = mlines[0]
    buf = cur["t"]
    for nxt in mlines[1:]:
        gap = nxt["y0"] - cur["y1"]
        is_indented = (nxt["x0"] - left_margin) > med_h * 1.15
        is_big_gap = gap > med_h * 1.05
        is_heading = len(nxt["t"]) < 36 and bool(
            re.match(r'^(第[零一二三四五六七八九十百千万0-9]+[章节讲编篇部回]|[一二三四五六七八九十]+、|导\s*论|绪\s*论|前\s*言|序\s*言|后\s*记)', nxt["t"])
        )
        ends_sent = bool(re.search(r'[。！？.!?:;”"’\']$', buf))
        prev_short = ((cur["x1"] - left_margin) < col_width * 0.78) and ends_sent
        if is_indented or is_big_gap or is_heading or prev_short:
            paras.append(buf.strip())
            buf = nxt["t"]
        else:
            if re.match(r'[A-Za-z0-9]$', buf) and re.match(r'^[A-Za-z0-9]', nxt["t"]):
                buf = buf + " " + nxt["t"]
            else:
                buf = buf + nxt["t"]
        cur = nxt
    if buf.strip():
        paras.append(buf.strip())

    return "\n\n".join(paras)


def parse_page_boxes(res, img_w: int, img_h: int, detect_two_col: bool = False) -> str:
    if not res:
        return ""
    items = []
    for box, txt, sc in res:
        if sc is not None and sc < 0.30:
            continue
        t = str(txt).strip()
        if not t:
            continue
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        items.append((min(xs), min(ys), max(xs), max(ys), t))
    if not items:
        return ""

    if detect_two_col and len(items) >= 8:
        mid_x = img_w * 0.50
        # 检测是否存在清晰的中缝双栏（绝大多数文本框不跨越页面中心线）
        left_boxes = [it for it in items if it[2] <= mid_x + img_w * 0.04]
        right_boxes = [it for it in items if it[0] >= mid_x - img_w * 0.04]
        spanning = [it for it in items if it[0] < mid_x - img_w * 0.04 and it[2] > mid_x + img_w * 0.04]
        if len(left_boxes) >= 3 and len(right_boxes) >= 3 and len(spanning) <= max(3, len(items) * 0.25):
            # 跨栏顶部大标题先输出，再按「左栏全文 -> 右栏全文」严格顺序输出，彻底杜绝串行！
            top_span = [it for it in spanning if it[1] < img_h * 0.25]
            bot_span = [it for it in spanning if it[1] >= img_h * 0.25]
            parts = []
            if top_span:
                parts.append(merge_column_items(top_span, img_w, img_h))
            parts.append(merge_column_items(left_boxes, img_w * 0.5, img_h))
            parts.append(merge_column_items(right_boxes, img_w * 0.5, img_h))
            if bot_span:
                parts.append(merge_column_items(bot_span, img_w, img_h))
            return "\n\n".join(x for x in parts if x.strip())

    return merge_column_items(items, img_w, img_h)


def run_hq_pdf(eng: RapidOCR, task_id: str, rel_pdf: str, out_md_name: str, title: str, dpi: int, two_col: bool = False):
    pdf_path = SRC_DIR / rel_pdf
    doc = pymupdf.open(str(pdf_path))
    n_pages = len(doc)
    toc = doc.get_toc()

    cache_file = HQ_CACHE / f"{task_id}_{dpi}dpi.json"
    page_texts = {}
    if cache_file.exists():
        try:
            page_texts = {int(k): v for k, v in json.loads(cache_file.read_text(encoding="utf-8")).items()}
        except Exception:
            page_texts = {}

    todo = [i for i in range(n_pages) if i not in page_texts]
    if todo:
        print(f"\n[GPU HQ OCR] {title}: {len(todo)}/{n_pages} pages @ {dpi} DPI (two_col={two_col})...", flush=True)
        t0 = time.time()
        q: queue.Queue = queue.Queue(maxsize=12)

        def producer():
            for idx in todo:
                page = doc[idx]
                rect = page.rect
                target_dpi = dpi
                if rect.width * (target_dpi / 72.0) > 2200:
                    target_dpi = max(140, int(2200 * 72.0 / rect.width))
                pix = page.get_pixmap(dpi=target_dpi, colorspace=pymupdf.csRGB)
                img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()
                img = enhance_contrast(img)
                is_spread = (rect.width / max(1.0, rect.height)) > 1.08
                q.put((idx, img, is_spread))
            q.put(None)

        th = threading.Thread(target=producer, daemon=True)
        th.start()

        done_now = 0
        while True:
            item = q.get()
            if item is None:
                break
            idx, img, is_spread = item
            if is_spread:
                mid = img.shape[1] // 2
                l_img = np.ascontiguousarray(img[:, :mid, :])
                r_img = np.ascontiguousarray(img[:, mid:, :])
                rl, _ = eng(l_img)
                rr, _ = eng(r_img)
                tl = parse_page_boxes(rl, l_img.shape[1], l_img.shape[0], detect_two_col=two_col)
                tr = parse_page_boxes(rr, r_img.shape[1], r_img.shape[0], detect_two_col=two_col)
                page_texts[idx] = "\n\n".join(x for x in (tl, tr) if x)
            else:
                res, _ = eng(img)
                page_texts[idx] = parse_page_boxes(res, img.shape[1], img.shape[0], detect_two_col=two_col)

            done_now += 1
            if done_now % 40 == 0 or done_now == len(todo):
                cache_file.write_text(
                    json.dumps({str(k): v for k, v in page_texts.items()}, ensure_ascii=False),
                    encoding="utf-8",
                )
                spd = done_now / max(0.1, time.time() - t0)
                print(f"  -> {title}: {len(page_texts)}/{n_pages}p ({spd:.2f} p/s)", flush=True)
        th.join()

    doc.close()

    # 仅保留真实正文书签（严格过滤封面/版权/目录/封底/前言外广告）
    toc_by_page = {}
    for lvl, heading, pnum in toc:
        p0 = max(0, int(pnum) - 1)
        hc = heading.strip()
        if hc and not re.match(r'^(封面|书名|书名页|版权|版权页|目录|目次|封底|Contents|Copyright)$', hc, re.I):
            toc_by_page.setdefault(p0, []).append((min(3, max(1, lvl)), hc))

    parts = [f"# {title}"]
    for i in range(n_pages):
        pt = (page_texts.get(i) or "").strip()
        # 跳过 Anna's Archive / DuXiu 尾页元数据与超星 SS 号页
        if re.search(r'(Anna[\'\u2019]?s\s*Archive|losslessly\s*embedded|filename_decoded|pdg_main_pages|\[General\s*Information\])', pt, re.I):
            continue
        if i in toc_by_page:
            for lvl, htxt in toc_by_page[i]:
                parts.append(f"{'#' * min(3, lvl + 1)} {htxt}")
        if pt:
            parts.append(pt)

    out_md = "\n\n".join(parts) + "\n"
    (OUT_DIR / out_md_name).write_text(out_md, encoding="utf-8")
    print(f"[SAVED HQ] {out_md_name}: {len(out_md):,} chars", flush=True)


def patch_five_lectures_missing_pages(eng: RapidOCR):
    """对《张世英黑格尔哲学五讲》中原先返回 0 字的有墨迹页面做 280 DPI 补扫并重建原书。"""
    pdf_path = SRC_DIR / r"张世英系列\张世英黑格尔哲学五讲.pdf"
    cache_file = OUT_DIR / "_ocr_cache" / "zsy_five_lectures.json"
    if not cache_file.exists():
        return
    data = json.loads(cache_file.read_text(encoding="utf-8"))
    doc = pymupdf.open(str(pdf_path))
    n_pages = len(doc)
    toc = doc.get_toc()
    recovered = 0
    for idx in range(n_pages):
        cur = str(data.get(str(idx), "")).strip()
        if len(cur) >= 30:
            continue
        pix = doc[idx].get_pixmap(dpi=280, colorspace=pymupdf.csRGB)
        img = enhance_contrast(np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy())
        res, _ = eng(img)
        txt = parse_page_boxes(res, img.shape[1], img.shape[0], detect_two_col=False).strip()
        if len(txt) > len(cur):
            data[str(idx)] = txt
            recovered += 1
            print(f"  [RECOVERED] 五讲 page {idx}: {len(cur)} -> {len(txt)} chars ({txt[:45]!r})", flush=True)
    doc.close()
    cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    # 重新干净装配 张世英黑格尔哲学五讲.md（剔除封面/版权/SS号尾页/孤立页码）
    toc_by_page = {}
    for lvl, heading, pnum in toc:
        p0 = max(0, int(pnum) - 1)
        hc = heading.strip()
        if hc and not re.match(r'^(封面|书名|书名页|版权|版权页|目录|目次|封底|Contents|Copyright)$', hc, re.I):
            toc_by_page.setdefault(p0, []).append((min(3, max(1, lvl)), hc))
    parts = ["# 张世英黑格尔哲学五讲"]
    for i in range(n_pages):
        pt = str(data.get(str(i), "")).strip()
        if re.search(r'(General\s*Information|Gｅｎｅｒａｌ|SS号=|Anna.*Archive)', pt, re.I):
            continue
        if i in toc_by_page:
            for lvl, htxt in toc_by_page[i]:
                parts.append(f"{'#' * min(3, lvl + 1)} {htxt}")
        if pt:
            parts.append(pt)
    out = "\n\n".join(parts) + "\n"
    (OUT_DIR / "张世英黑格尔哲学五讲.md").write_text(out, encoding="utf-8")
    print(f"[PATCHED] 张世英黑格尔哲学五讲.md: recovered {recovered} pages, total {len(out):,} chars", flush=True)


def main():
    t0 = time.time()
    print("Initializing RapidOCR on RTX 5070 Ti (DirectML GPU)...", flush=True)
    eng = RapidOCR(det_use_dml=True, rec_use_dml=True, use_cls=False, rec_batch_num=32)

    # 1. 重扫《西方哲学史 - 图文版.pdf》（自动双栏切分 @ 240 DPI）
    run_hq_pdf(eng, "zsy_west_hist", r"张世英系列\西方哲学史 - 图文版.pdf", "西方哲学史（张世英）.md", "西方哲学史", dpi=240, two_col=True)
    # 2. 补扫《张世英黑格尔哲学五讲.pdf》漏识页 @ 280 DPI
    patch_five_lectures_missing_pages(eng)
    # 3. 高清重扫《黑格尔《精神现象学》述评.pdf》(117p @ 260 DPI)
    run_hq_pdf(eng, "zsy_phenom_review", r"张世英系列\黑格尔《精神现象学》述评.pdf", "黑格尔《精神现象学》述评.md", "黑格尔《精神现象学》述评", dpi=260, two_col=False)
    # 4. 高清重扫《黑格尔《小逻辑》译注.pdf》(597p @ 260 DPI)
    run_hq_pdf(eng, "zsy_small_logic", r"张世英系列\黑格尔《小逻辑》译注.pdf", "黑格尔《小逻辑》译注.md", "黑格尔《小逻辑》译注", dpi=260, two_col=False)

    print(f"\nALL GPU HQ RE-OCR TASKS FINISHED in {time.time()-t0:.1f}s!", flush=True)


if __name__ == "__main__":
    main()
