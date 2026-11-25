#!/usr/bin/env python3
"""
prepare_phase2_gpu_and_anchors.py —
1. 用 RTX 5070 Ti GPU (RapidOCR 280 DPI) 扫描《先验唯心论体系 by 谢林 (z-lib.org).pdf》第 115-150 页，定位 3 处脱漏的完整中文句。
2. 在《理性的毁灭（英文版）-卢卡奇.pdf》中为 44 处 〔原文脱漏〕 自动匹配英文上下文段落；若英文也找不到或需核实，用 GPU 扫《理性的毁灭（中文版）-卢卡奇.pdf》。
3. 在《【英文】莱布尼茨单子论新译&导读.pdf》中匹配 47 处 〔原文脱漏〕 的完整英文注释/书目条目。
导出全部工作包到 audit-work/gap_repair/phase2_bundles.json 供 8 路并行 DSH 补全。
"""
import json
import re
from pathlib import Path
import pymupdf
import numpy as np
from rapidocr_onnxruntime import RapidOCR

WORK = Path(r"D:\咕咕嘎嘎反重力\audit-work\gap_repair")
WORK.mkdir(parents=True, exist_ok=True)
SRC_ZH = Path(r"D:\文献库\中文译本")


def gpu_scan_schelling():
    pdf_path = Path(r"D:\文献库\德国古典哲学\谢林\先验唯心论体系 by 谢林 (z-lib.org).pdf")
    doc = pymupdf.open(pdf_path)
    ocr = RapidOCR(det_use_dml=True, cls_use_dml=True, rec_use_dml=True)
    # 310p total, omissions at 39.4%, 41.6%, 44.2% -> pages ~115-155
    pages = {}
    hits = {}
    anchors = {
        "om1": ["三段论", "加于感觉", "对象的效果"],
        "om2": ["两倍", "双倍", "相反的方向", "两个相等的力"],
        "om3": ["相互平衡", "共同界限", "否定的力", "线正因此"],
    }
    print(f"[Schelling ZH PDF] Scanning p.115-152 of {len(doc)}p on GPU...")
    for pn in range(115, 153):
        pix = doc[pn - 1].get_pixmap(dpi=250, colorspace=pymupdf.csRGB)
        res, _ = ocr(np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3))
        txt = "\n".join(str(x[1]).strip() for x in (res or []) if x and len(x) >= 2)
        pages[pn] = txt
        for k, kws in anchors.items():
            if any(w in txt for w in kws):
                hits.setdefault(k, []).append(pn)
                print(f"  {k} candidate p.{pn}: {txt[:120].replace(chr(10),' ')}")
    doc.close()
    (WORK / "schelling_zh_ocr.json").write_text(json.dumps({"hits": hits, "pages": pages}, ensure_ascii=False, indent=2), encoding="utf-8")


def match_lukacs_44():
    md_txt = (SRC_ZH / "西马" / "理性的毁灭" / "理性的毁灭.md").read_text(encoding="utf-8")
    en_doc = pymupdf.open(r"D:\文献库\西马\卢卡奇\理性的毁灭（英文版）-卢卡奇.pdf")
    en_pages = [pg.get_text("text") for pg in en_doc]
    en_doc.close()

    # Also keep Chinese scanned PDF ready for direct OCR verification when needed
    cn_doc = pymupdf.open(r"D:\文献库\西马\卢卡奇\理性的毁灭（中文版）-卢卡奇.pdf")
    cn_total = len(cn_doc)
    cn_doc.close()

    matches = list(re.finditer(r"[〔\[（(][^〕\]）)]{0,16}脱漏[^〕\]）)]{0,16}[〕\]）)]", md_txt))
    items = []
    # For each omission, estimate position in EN PDF & CN PDF (plus search key proper nouns/phrases around it!)
    # Better: find nearby proper names or unique quoted phrases in English PDF!
    proper_hints = {
        "谢林": "Schelling", "黑格尔": "Hegel", "克尔凯郭尔": "Kierkegaard", "叔本华": "Schopenhauer",
        "尼采": "Nietzsche", "狄尔泰": "Dilthey", "齐美尔": "Simmel", "施宾格勒": "Spengler",
        "韦伯": "Weber", "海德格尔": "Heidegger", "雅斯贝尔斯": "Jaspers", "胡塞尔": "Husserl",
        "施米特": "Schmitt", "张伯伦": "Chamberlain", "罗森贝格": "Rosenberg", "希特勒": "Hitler",
        "法西斯": "fascis", "新康德主义": "Neo-Kantian", "活力论": "vitalis", "马克思": "Marx",
        "共产党宣言": "Communist Manifesto", "斯德哥尔摩": "Stockholm", "选帝侯大街": "Kurfürstendamm",
        "赫利奥波利斯": "Heliopolis", "恶之花": "Fleurs du Mal", "鲍威尔": "Bauer", "自由": "freedom",
        "间接辩护": "indirect apologetics", "帝国主义": "imperialism", "和平运动": "peace movement",
        "存在主义": "existentialism", "贵族主义": "aristocratism", "悲观主义": "pessimism",
        "萨维尼": "Savigny", "因果性": "causality", "自在之物": "thing-in-itself",
        "私人财产": "private means", "形式平等": "formal equality", "混合": "mongrel",
    }
    for idx, m in enumerate(matches):
        ratio = m.start() / len(md_txt)
        est_en_p = max(1, min(len(en_pages), int(ratio * len(en_pages))))
        ctx_before = md_txt[max(0, m.start() - 320):m.start()]
        ctx_after = md_txt[m.end():min(len(md_txt), m.end() + 320)]
        full_ctx = ctx_before + "【<<GAP>>】" + ctx_after

        # Score candidate EN pages in window [est_en_p - 80, est_en_p + 80]
        hints = [en_k for zh_k, en_k in proper_hints.items() if zh_k in full_ctx]
        # Extract any Latin words directly in ctx
        lat_in_ctx = [w for w in re.findall(r"[A-Za-zÀ-ÿ]{4,}", full_ctx) if w not in ("GAP",)]
        cand_scores = []
        w_start = max(0, est_en_p - 90)
        w_end = min(len(en_pages), est_en_p + 90)
        for pi in range(w_start, w_end):
            pt = en_pages[pi]
            pt_l = pt.lower()
            sc = sum(2 for h in hints if h.lower() in pt_l) + sum(3 for lw in lat_in_ctx if lw.lower() in pt_l)
            # bonus for proximity to estimated page
            sc -= abs(pi - est_en_p) * 0.02
            if sc > 0:
                cand_scores.append((sc, pi + 1))
        cand_scores.sort(reverse=True)
        top_pages = [(p, en_pages[p - 1]) for _, p in cand_scores[:4]]
        if not top_pages:
            top_pages = [(p, en_pages[p - 1]) for p in range(max(1, est_en_p - 2), min(len(en_pages), est_en_p + 3))]
        items.append({
            "idx": idx,
            "pos": m.start(),
            "marker": m.group(0),
            "est_en_page": est_en_p,
            "est_cn_page": max(1, min(cn_total, int(ratio * cn_total))),
            "ctx_before": ctx_before,
            "ctx_after": ctx_after,
            "en_candidates": [{"page": p, "text": t} for p, t in top_pages],
        })
    (WORK / "lukacs_44_bundles.json").write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Lukacs 44] Exported bundles with EN candidates (avg top score hits checked).")


def match_leibniz_notes():
    md_txt = (SRC_ZH / "德国古典哲学" / "莱布尼茨单子论：新译与导读" / "单子论：新译与导读.md").read_text(encoding="utf-8")
    en_doc = pymupdf.open(r"D:\文献库\德国古典哲学\莱布尼茨\【英文】莱布尼茨单子论新译&导读.pdf")
    en_pages = [(i + 1, pg.get_text("text")) for i, pg in enumerate(en_doc)]
    en_doc.close()

    # Extract all lines containing 脱漏 along with surrounding lines (previous/next note numbers)
    lines = md_txt.splitlines()
    # Parse all note-like footnotes in en_pages (lines starting with spaces + number)
    en_notes_by_page = []
    for pno, pt in en_pages:
        en_notes_by_page.append((pno, pt))

    items = []
    for li, line in enumerate(lines):
        if "脱漏" not in line:
            continue
        prev_lines = [lines[j] for j in range(max(0, li - 4), li) if lines[j].strip()]
        next_lines = [lines[j] for j in range(li + 1, min(len(lines), li + 4)) if lines[j].strip()]
        # Determine note number and Latin/English keywords
        m_num = re.match(r"^\s*(\d{1,3})\s+", line)
        note_num = m_num.group(1) if m_num else ""
        # Estimate page ratio
        ratio = li / len(lines)
        est_p = max(1, min(len(en_pages), int(ratio * len(en_pages))))
        # Look for exact note number near est_p (or match Latin/surname tokens from prev/cur/next lines)
        toks = set(re.findall(r"[A-Za-zÀ-ÿ]{4,}|\d{4}", " ".join(prev_lines + [line] + next_lines)))
        cands = []
        for pno, pt in en_pages[max(0, est_p - 30):min(len(en_pages), est_p + 30)]:
            sc = sum(2 for tk in toks if tk in pt)
            if note_num and re.search(rf"(?m)^\s*{note_num}\s+", pt):
                sc += 5
            if sc > 0:
                cands.append((sc, pno, pt))
        cands.sort(reverse=True)
        items.append({
            "line_no": li + 1,
            "note_num": note_num,
            "line": line,
            "prev_lines": prev_lines[-2:],
            "next_lines": next_lines[:2],
            "en_candidates": [{"page": p, "text": t} for _, p, t in cands[:3]],
        })
    (WORK / "leibniz_47_bundles.json").write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Leibniz 47] Exported {len(items)} bundles.")


if __name__ == "__main__":
    gpu_scan_schelling()
    match_lukacs_44()
    match_leibniz_notes()
