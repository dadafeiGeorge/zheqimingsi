#!/usr/bin/env python3
"""
gpu_ocr_ontology_gaps.py —
1. Patch the 2 missing header lemmas in `康德辞典（第 1 卷）.md` & notes 10-16, 51-54, 125-130 in `理性的毁灭.md`.
2. Use RTX 5070 Ti GPU (RapidOCR DML, 220 DPI) to OCR ONLY the English PDF pages around the 20 omissions in
   `社会存在本体论·卷一：黑格尔.md` and 58 omissions in `社会存在本体论·卷二：马克思.md`,
   and export compact 2-item/batch JSONs ready for parallel DSH restoration.
"""
import json
import re
from pathlib import Path
import numpy as np
import pymupdf
from rapidocr_onnxruntime import RapidOCR

ROOT = Path(r"D:\咕咕嘎嘎反重力")
SRC_ZH = Path(r"D:\文献库\中文译本")
WORK = ROOT / "audit-work" / "gap_repair" / "ontologie"
WORK.mkdir(parents=True, exist_ok=True)


def patch_direct_known_gaps():
    # 1. Lukacs 理性的毁灭 notes 10-16, 51-54, 125-130 verified from EN pp.769-773
    luk_p = SRC_ZH / "西马" / "理性的毁灭" / "理性的毁灭.md"
    txt = luk_p.read_text(encoding="utf-8")
    r1 = (
        "9 同上。\n\n"
        "〔10–16 条原书缺失〕\n\n"
        "17 同上。"
    )
    n1 = (
        "9 同上。\n\n"
        "10 同上。\n\n"
        "11 张伯伦：《防御与反击》（*Wehr und Gegenwehr*），慕尼黑，1912 年，第 14 页。\n\n"
        "12 戈比诺：前引书。\n\n"
        "13 同上。\n\n"
        "14 同上。\n\n"
        "15 同上。\n\n"
        "16 同上。\n\n"
        "17 同上。"
    )
    r2 = "50 沃尔特曼：同上书，第 294 页。\n\n〔51–54 条原书缺失〕\n\n55 张伯伦《政治理想》"
    n2 = (
        "50 沃尔特曼：同上书，第 294 页。\n\n"
        "51 我未能找到拉加德夫人的回忆录。这一事实引自梅林载于《新时代》第 13 年卷第 1 册第 225 页及以下的一篇文章。\n\n"
        "52 张伯伦：《书信集》，Munich 1920，第 2 卷，第 143 页。\n\n"
        "53 同上，第 142 页。\n\n"
        "54 同上，第 126 页。\n\n"
        "55 张伯伦《政治理想》"
    )
    r3 = "124 张伯伦《书信集》，第 2 卷，第 265 页。\n\n〔125–130 条原书缺失〕\n\n131 希特勒"
    n3 = (
        "124 张伯伦《书信集》，第 2 卷，第 265 页。\n\n"
        "125 罗森贝格《二十世纪的神话》。\n\n"
        "126 同上。\n\n"
        "127 同上。\n\n"
        "128 同上。\n\n"
        "129 劳施宁：前引书，第 49 页及以下。\n\n"
        "130 马克思—恩格斯《德意志意识形态》。\n\n"
        "131 希特勒"
    )
    changed = 0
    for old, new in [(r1, n1), (r2, n2), (r3, n3)]:
        if old in txt:
            txt = txt.replace(old, new, 1)
            changed += 1
        else:
            print(f"[WARN] Lukacs block not exact match: {old[:40]!r}")
    if changed:
        luk_p.write_text(txt, encoding="utf-8")
    print(f"[Lukacs notes] Patched {changed}/3 missing note blocks; remaining 缺失={len(re.findall(r'缺失', txt))}")

    # 2. 康德辞典（第 1 卷）.md: restore exact 2 missing headers + openings from Willaschek Kant-Lexikon
    kd_p = SRC_ZH / "德国古典哲学" / "康德辞典（第 1 卷）" / "康德辞典（第 1 卷）.md"
    kt = kd_p.read_text(encoding="utf-8")
    kr1 = "**Von den Ursachen der Erdbeben**（《论地震的原因》）　〔说明：原文词头在扫描中缺失，标题据内容拟补。〕"
    kn1 = (
        "**Von den Ursachen der Erderschütterungen bei Gelegenheit des Unglücks, welches die westliche Länder von Europa gegen das Ende des vorigen Jahres betroffen hat**"
        "（《论值去年年底西欧诸国遭遇灾祸之际所发生地震的原因》）　该文分两部分发表于 1756 年《柯尼斯堡每周新闻与公告》，"
        "载第 4 期（1756 年 1 月 24 日）与第 5 期（1 月 31 日）；手稿已佚（参 Stark, *Nachforschungen*, pp. 281–291；标准校勘本见 AA 1:419–427）。"
        "这是康德针对 1755 年 11 月 1 日里斯本大地震所撰三篇短论中的第一篇（→《自然史与地震记》*Geschichte und Naturbeschreibung...*；→《续论》*Fortgesetzte Betrachtungen...*）。"
    )
    kr2 = "**Vorrede**（前言）　〔说明：原文词头在扫描中缺失。〕"
    kn2 = (
        "**Vorrede zu Reinhold Bernhard Jachmann: Prüfung der kantischen Religionsphilosophie**"
        "（《为莱因霍尔德·伯恩哈德·雅赫曼〈康德宗教哲学考察〉所作前言》）　雅赫曼此书连同康德这篇简短前言于 1800 年在柯尼斯堡由 →尼科洛维乌斯（Nicolovius）初版；"
        "至今仍具权威性与校勘可靠性的版本，是海因里希·迈尔在科学院版全集中所编订的文本"
    )
    kc = 0
    for old, new in [(kr1, kn1), (kr2, kn2)]:
        if old in kt:
            kt = kt.replace(old, new, 1)
            kc += 1
    if kc:
        kd_p.write_text(kt, encoding="utf-8")
    print(f"[康德辞典] Patched {kc}/2 missing lemma headers; remaining 说明={len(re.findall(r'在扫描中缺失', kt))}")


def ocr_pdf_pages_subset(pdf_path: str, page_nums: set, ocr_engine) -> dict:
    doc = pymupdf.open(pdf_path)
    n_tot = len(doc)
    valid = sorted(p for p in page_nums if 1 <= p <= n_tot)
    print(f"[GPU OCR] {Path(pdf_path).name}: OCRing {len(valid)}/{n_tot} candidate pages...")
    out = {}
    for idx, pn in enumerate(valid, 1):
        pix = doc[pn - 1].get_pixmap(dpi=210, colorspace=pymupdf.csRGB)
        res, _ = ocr_engine(np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3))
        out[str(pn)] = "\n".join(str(x[1]).strip() for x in (res or []) if x and len(x) >= 2)
        if idx % 25 == 0 or idx == len(valid):
            print(f"  progress {idx}/{len(valid)}")
    doc.close()
    return out


def build_bundles_for_book(md_path: Path, pdf_path: str, cache_name: str, prefix: str, ocr_engine):
    txt = md_path.read_text(encoding="utf-8")
    matches = list(re.finditer(r"〔[^〕\n]{0,20}(?:脱漏|残缺)[^〕\n]{0,20}〕", txt))
    doc = pymupdf.open(pdf_path)
    tot_pages = len(doc)
    doc.close()

    # Notice: MD files start with ~6% TOC/frontmatter or match body ~linearly. Gather +/-8 pages per unique omission cluster!
    cand_pages = set()
    est_list = []
    # Cluster nearby matches within 250 chars so multi-gap sentences aren't processed redundantly!
    clusters = []
    for m in matches:
        if clusters and m.start() - clusters[-1]["end"] <= 260:
            clusters[-1]["end"] = m.end()
            clusters[-1]["count"] += 1
        else:
            clusters.append({"start": m.start(), "end": m.end(), "count": 1})

    for cl in clusters:
        ratio = cl["start"] / len(txt)
        est_p = max(1, min(tot_pages, int(ratio * tot_pages)))
        est_list.append(est_p)
        for dp in range(-8, 9):
            p = est_p + dp
            if 1 <= p <= tot_pages:
                cand_pages.add(p)

    cache_file = WORK / f"{cache_name}_ocr.json"
    pages_dict = {}
    if cache_file.exists():
        pages_dict = json.loads(cache_file.read_text(encoding="utf-8"))
    missing_pages = {p for p in cand_pages if str(p) not in pages_dict}
    if missing_pages:
        pages_dict.update(ocr_pdf_pages_subset(pdf_path, missing_pages, ocr_engine))
        cache_file.write_text(json.dumps(pages_dict, ensure_ascii=False, indent=2), encoding="utf-8")

    # Build English context for each cluster via keyword scoring over OCR pages
    proper_hints = {
        "黑格尔": "Hegel", "马克思": "Marx", "卢梭": "Rousseau", "康德": "Kant",
        "亚里士多德": "Aristotle", "伊壁鸠鲁": "Epicurus", "贝拉明": "Bellarmine",
        "海德格尔": "Heidegger", "柏格森": "Bergson", "卡西尔": "Cassirer",
        "萨特": "Sartre", "本体论": "ontology", "自然": "nature", "劳动": "labour",
        "价值": "value", "使用价值": "use-value", "交换价值": "exchange-value",
        "抽象": "abstraction", "具体": "concrete", "规律": "law", "异化": "alienation",
        "异质": "heterogeneous", "同质": "homogeneous", "目的论": "teleology",
        "时间": "time", "历史": "history", "实证主义": "positivism",
        "新康德主义": "Neo-Kantian", "逻辑": "logic", "辩证": "dialectic",
        "社会存在": "social being", "个人": "individual", "资本论": "Capital",
        "手稿": "Manuscripts", "李嘉图": "Ricardo", "斯密": "Smith",
    }

    items = []
    for idx, cl in enumerate(clusters):
        p_lo = max(0, txt.rfind("\n", 0, cl["start"]) + 1)
        p_hi = txt.find("\n", cl["end"])
        if p_hi < 0:
            p_hi = len(txt)
        old_seg = txt[max(p_lo, cl["start"] - 90) : min(p_hi, cl["end"] + 90)]
        zh_ctx = txt[max(p_lo, cl["start"] - 220) : min(p_hi, cl["end"] + 220)]
        hints = [v for k, v in proper_hints.items() if k in zh_ctx]
        est_p = max(1, min(tot_pages, int((cl["start"] / len(txt)) * tot_pages)))

        best_sc = -1e9
        best_pn = est_p
        for p_str, pt in pages_dict.items():
            pn = int(p_str)
            pt_l = pt.lower()
            sc = sum(4 for h in hints if h.lower() in pt_l) - abs(pn - est_p) * 0.25
            if sc > best_sc:
                best_sc = sc
                best_pn = pn
        win = []
        for pn in (best_pn - 1, best_pn, best_pn + 1):
            if str(pn) in pages_dict:
                win.append(f"[p.{pn}]\n{pages_dict[str(pn)]}")
        items.append({
            "idx": idx,
            "file": str(md_path),
            "old": old_seg,
            "zh_context": zh_ctx,
            "en_excerpt": "\n".join(win)[:3200],
        })

    # Write 2 items/batch JSON
    batches = [items[i : i + 2] for i in range(0, len(items), 2)]
    meta = []
    for bi, b in enumerate(batches):
        sp = WORK / f"{prefix}_src_{bi:02d}.json"
        op = WORK / f"{prefix}_out_{bi:02d}.json"
        sp.write_text(json.dumps(b, ensure_ascii=False, indent=2), encoding="utf-8")
        meta.append({"id": f"{prefix}_{bi:02d}", "src": str(sp), "out": str(op), "file": str(md_path)})
    print(f"[{prefix}] {len(matches)} raw gaps -> {len(clusters)} clusters -> {len(batches)} tiny batches")
    return meta


if __name__ == "__main__":
    patch_direct_known_gaps()
    ocr = RapidOCR(det_use_dml=True, cls_use_dml=True, rec_use_dml=True)
    m1 = build_bundles_for_book(
        SRC_ZH / "西马" / "社会存在本体论·卷一：黑格尔" / "社会存在本体论·卷一：黑格尔.md",
        r"D:\文献库\西马\卢卡奇\社会存在之本体论，卷一：黑格尔-卢卡奇（英文版）.pdf",
        "ont_v1", "ont1", ocr,
    )
    m2 = build_bundles_for_book(
        SRC_ZH / "西马" / "社会存在本体论·卷二：马克思" / "社会存在本体论·卷二：马克思.md",
        r"D:\文献库\西马\卢卡奇\社会存在之本体论，卷二：马克思-卢卡奇（英文版）.pdf",
        "ont_v2", "ont2", ocr,
    )
    (WORK / "dispatch_manifest.json").write_text(json.dumps(m1 + m2, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Manifest written:", len(m1) + len(m2), "batches.")
