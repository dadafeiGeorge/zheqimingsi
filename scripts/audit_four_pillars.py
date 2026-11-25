#!/usr/bin/env python3
"""
audit_four_pillars.py — 针对用户指出的四大核心问题，对全部 72 部书籍做精确量化定位：
1. 无关正文内容（封面/版权/CIP/广告/目录页/扫描声明/空白页等）
2. 缺文少字（翻译切片字数比偏低、DSH回退未精校切片、OCR低密度/漏页检测）
3. 单独外语未翻译/未注释段落（非参考文献中的 >=8 词外语块）
4. 目录混乱（正文被吞进“目录（第N节）”、句子碎片当标题、无章节或异常拆分）
"""
import json
import re
from pathlib import Path
from collections import Counter

LIB_ROOT = Path(r"D:\咕咕嘎嘎反重力\library-data")
EXTRA_DIR = Path(r"D:\咕咕嘎嘎反重力\extra-books")

cat = json.loads((LIB_ROOT / "catalog.json").read_text(encoding="utf-8"))
books = cat["books"]

CJK_RE = re.compile(r"[\u4e00-\u9fff]")
LATIN_WORD_RE = re.compile(r"[A-Za-zÀ-ÿα-ωΑ-Ω]{3,}")
BIB_CHAPTER_RE = re.compile(r"(参考书目|参考文献|引用文献|书目|索引|进一步阅读|拉康著作|缩写|bibliography|references|index|further reading|works cited)", re.I)
NON_BODY_TITLE_RE = re.compile(
    r"^(目录|目次|总目录|封面|书名页|扉页|版权|版权页|版权信息|图书在版编目|CIP|出版说明|出版者说明|丛书|广告|封底|鸣谢|致谢|缩写|缩写表|译名表|内容提要|作者简介|编辑说明|contents|table of contents|copyright|title page|cover|acknowledgements?|abbreviations|about the author)$",
    re.I,
)

print("=" * 72)
print("PILLAR 1 & 4: TOC CHAOS & NON-BODY CHAPTERS ACROSS ALL 72 BOOKS")
print("=" * 72)

toc_problems = []
non_body_chapters_total = 0

for b in books:
    bid = b["id"]
    meta = json.loads((LIB_ROOT / "books" / bid / "meta.json").read_text(encoding="utf-8"))
    chs = meta["chapters"]
    bad_titles = []
    non_body = []
    art_splits = 0
    for c in chs:
        t = c["title"].strip()
        t_norm = re.sub(r"[\s　·\-—:：()（）\[\]【】]", "", t)
        if c.get("isFrontMatter") or NON_BODY_TITLE_RE.match(t_norm) or t_norm.startswith(("目录", "目次", "总目录", "版权", "图书在版编目")):
            non_body.append((c["index"], t, c["charCount"]))
            # 如果一个“目录”章字数 > 5000，说明正文被错误吞进了目录章！
            if c["charCount"] > 5000 and ("目录" in t or "目次" in t):
                bad_titles.append(f"SWALLOWED_INTO_TOC ch{c['index']}:'{t}'({c['charCount']}字)")
        if re.search(r"（第 \d+ 节）|（续 \d+）", t):
            art_splits += 1
        # 句子碎片误当章节标题
        if len(t) > 38 or t.endswith(("。", "，", "；", "、")) or t.startswith(("）", ")", "，", "。", "、", "》")):
            bad_titles.append(f"FRAG ch{c['index']}:'{t[:36]}'")
        if re.search(r"(ISBN|CIP|印刷|开本|定价|出版发行|著作权|All rights reserved|z-library|Anna)", t, re.I):
            non_body.append((c["index"], t, c["charCount"]))

    non_body_chapters_total += len(non_body)
    if bad_titles or len(non_body) >= 1 or len(chs) <= 3 or art_splits >= 10:
        toc_problems.append((b["title"], bid, len(chs), len(non_body), art_splits, bad_titles[:4], [x[1] for x in non_body[:4]]))

print(f"Total non-body chapters flagged: {non_body_chapters_total} across {sum(1 for x in toc_problems if x[3]>0)} books")
print("\n[A] SEVERE TOC CHAOS (swallowed body / fragment titles / heavy artificial splits / <=3 chapters):")
for title, bid, nch, nnb, nsplit, bads, nb_names in toc_problems:
    if bads or nch <= 3 or nsplit >= 10:
        print(f"  * 《{title}》({bid}): {nch}章, non_body={nnb}, art_splits={nsplit}")
        if bads:
            print(f"      BAD: {bads}")

print("\n[B] BOOKS WITH NON-BODY FRONT/BACK CHAPTERS TO PRUNE:")
for title, bid, nch, nnb, nsplit, bads, nb_names in toc_problems:
    if nnb > 0:
        print(f"  - 《{title}》: {nnb} non-body chs -> {nb_names}")

print("\n" + "=" * 72)
print("PILLAR 3: STANDALONE UNTRANSLATED FOREIGN PASSAGES IN BODY TEXT")
print("=" * 72)
foreign_body_by_book = []
total_foreign_blocks = 0
for b in books:
    if b["category"] == "辞典与术语工具":
        continue
    bid = b["id"]
    bdir = LIB_ROOT / "books" / bid
    hits = []
    for pf in sorted(bdir.glob("p_*.json")):
        cdata = json.loads(pf.read_text(encoding="utf-8"))
        for ch_idx_s, ch_obj in cdata.items():
            ch_title = ch_obj.get("t", "")
            if BIB_CHAPTER_RE.search(ch_title):
                continue
            for blk_idx, blk in enumerate(ch_obj.get("b", [])):
                t = blk.get("t", "").strip()
                if not t or blk.get("y") == "r":
                    continue
                lat_words = LATIN_WORD_RE.findall(t)
                cjk_cnt = len(CJK_RE.findall(t))
                # 正文内独立外语句子/段落：>= 10 个外语词且中文字数极少（不是中英对照/不是纯书目引用）
                if len(lat_words) >= 10 and cjk_cnt < len(lat_words) * 0.45:
                    # 排除明显纯书目格式（含出版社/页码/年份/ed./trans./pp./Press）
                    if re.search(r"\b(Press|University|Verlag|ed\.|eds\.|trans\.|pp\.|vol\.|ISBN|Routledge|Cambridge|Oxford|Princeton|Chicago|Stuttgart|Frankfurt|Paris|Seuil|Suhrkamp)\b", t) and cjk_cnt < 15:
                        continue
                    hits.append((int(ch_idx_s), ch_title, blk_idx, len(lat_words), cjk_cnt, t[:100]))
    if hits:
        total_foreign_blocks += len(hits)
        foreign_body_by_book.append((b["title"], bid, len(hits), hits[:3]))

print(f"Total standalone untranslated body foreign blocks (excl. bibliographies): {total_foreign_blocks} across {len(foreign_body_by_book)} books")
for title, bid, cnt, samples in sorted(foreign_body_by_book, key=lambda x: -x[2]):
    print(f"  * 《{title}》({bid}): {cnt} blocks")
    for ch_i, ch_t, bi, lw, cc, snip in samples:
        print(f"      ch{ch_i}({ch_t[:22]}) blk{bi} [lat={lw},cjk={cc}]: {snip!r}")

print("\n" + "=" * 72)
print("PILLAR 2: MISSING TEXT / SHORT TRANSLATION SLICES / FAILED POLISH SLICES")
print("=" * 72)
# Check all translation-work* directories for low ratio or missing slices
for work_dir in sorted(Path(r"D:\咕咕嘎嘎反重力").glob("translation-work*")):
    for sub in sorted(work_dir.iterdir()):
        if not sub.is_dir():
            continue
        src_d = sub / "src"
        zh_d = sub / "zh"
        if not (src_d.exists() and zh_d.exists()):
            continue
        srcs = sorted(src_d.glob("*.md"))
        low = []
        missing = []
        for sp in srcs:
            zp = zh_d / sp.name
            st = sp.read_text(encoding="utf-8", errors="replace")
            en_w = len(re.findall(r"[A-Za-z]+", st))
            if not zp.exists():
                missing.append(sp.name)
                continue
            zt = zp.read_text(encoding="utf-8", errors="replace")
            cjk = len(CJK_RE.findall(zt))
            ratio = cjk / max(1, en_w)
            if en_w >= 400 and ratio < 1.15:
                low.append((sp.name, en_w, cjk, round(ratio, 2)))
        print(f"  [TRANS] {work_dir.name}/{sub.name}: total={len(srcs)}, missing={len(missing)}, low_ratio(<1.15)={len(low)}")
        if missing:
            print(f"      MISSING: {missing}")
        if low:
            print(f"      LOW: {low[:10]}")

# Check polish-work-dsh failed/warned slices
pwork = Path(r"D:\咕咕嘎嘎反重力\polish-work-dsh")
if pwork.exists():
    for sub in sorted(pwork.iterdir()):
        src_d = sub / "src"
        out_d = sub / "out"
        if not (src_d.exists() and out_d.exists()):
            continue
        srcs = sorted(src_d.glob("*.md"))
        bad = []
        for sp in srcs:
            op = out_d / sp.name
            sl = len(sp.read_text(encoding="utf-8"))
            if not op.exists():
                bad.append((sp.name, sl, 0))
            else:
                ol = len(op.read_text(encoding="utf-8"))
                if ol < sl * 0.80:
                    bad.append((sp.name, sl, ol))
        print(f"  [POLISH] {sub.name}: total={len(srcs)}, missing_or_short={len(bad)} -> {bad[:10]}")
