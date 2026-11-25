#!/usr/bin/env python3
"""Comprehensive Step 2 verification across all 73 books in library-data."""
import json
import pathlib
import re

LIB = pathlib.Path(r"d:\咕咕嘎嘎反重力\library-data")
cat = json.loads((LIB / "catalog.json").read_text("utf-8"))["books"]

NOTES_TITLE_CHECK = re.compile(
    r"^(?!各种注释|.*意译与注释)(?:.*注释|译者注|译注|尾注|脚注|注|编者注|原注|编辑说明)(?:（(?:续\s*[0-9一二三四五六七八九十]+|[一二三四五六七八九十]+)）)*$"
)

def load_book_chapters(bdir: pathlib.Path) -> list:
    chs = {}
    for p in sorted(bdir.glob("p_*.json")):
        data = json.loads(p.read_text("utf-8"))
        for k, v in data.items():
            chs[int(k)] = v
    return [chs[k] for k in sorted(chs.keys())]

stacked = []
unfolded_notes = []
toc_anomalies = []
broken_stats = []
fn_summary = {}

for b in cat:
    bdir = LIB / "books" / b["id"]
    chs = load_book_chapters(bdir)
    book_fn_cnt = 0
    seen_titles = {}
    tot_p = 0
    broken_p = 0

    for ci, ch in enumerate(chs):
        title = ch["t"]
        blks = ch["b"]
        ch_chars = sum(len(x.get("t") or "") for x in blks)

        # Duplicate / bad suffixes in TOC
        if re.search(r"（续[一二三四五六七八九十]+）（[一二三四五六七八九十]+）", title):
            toc_anomalies.append((b["title"], ci, title, "double_suffix"))
        if re.search(r"[①-⑳]", title):
            toc_anomalies.append((b["title"], ci, title, "circled_in_title"))
        if re.search(r"\s\d{2,3}$", title) and not re.search(r"(?:1[6-9]\d{2}|20\d{2}|第\s*\d+|§)", title):
            toc_anomalies.append((b["title"], ci, title, "trailing_page_num"))
        seen_titles[title] = seen_titles.get(title, 0) + 1
        if ch_chars < 60:
            toc_anomalies.append((b["title"], ci, title, f"tiny_ch({ch_chars}c)"))

        if NOTES_TITLE_CHECK.match(title.strip()):
            unfolded_notes.append((b["title"], ci, title, len(blks), ch_chars))

        for bi, blk in enumerate(blks):
            t = blk.get("t") or ""
            fns = blk.get("f") or []
            book_fn_cnt += len(fns)
            # Check trailing stacked ⟦fn:X⟧ (>=3 consecutive at block end or total >=3 consecutive anywhere)
            if re.search(r"(?:⟦fn:\d+⟧\s*){3,}$", t.strip()):
                stacked.append((b["title"], ci, title, bi, len(fns), t[:80]))
            if blk.get("y") == "p":
                tot_p += 1
                s_clean = re.sub(r"(?:⟦fn:\d+⟧|\s|[①-⑳⁰¹²³⁴⁵⁶⁷⁸⁹])+$", "", t.strip()).strip()
                # Colon ending before a quote/list or short date/signature (<20c) is normal formatting, not a mid-sentence break
                if (
                    len(s_clean) >= 16
                    and not re.search(r"[。！？!?…”’」』）】\.：:—\-]$", s_clean)
                ):
                    broken_p += 1

    for t, c in seen_titles.items():
        if c > 1:
            toc_anomalies.append((b["title"], -1, t, f"dup_title x{c}"))

    ratio = (broken_p / tot_p * 100) if tot_p else 0.0
    broken_stats.append((ratio, broken_p, tot_p, b["title"]))
    fn_summary[b["title"]] = book_fn_cnt

print(f"Books checked: {len(cat)}")
print(f"Stacked trailing >=3 footnote blocks: {len(stacked)}")
for s in stacked[:20]:
    print("  STACKED:", s)

print(f"\nUnfolded note chapters: {len(unfolded_notes)}")
for u in unfolded_notes[:25]:
    print("  NOTE_CH:", u)

print(f"\nTOC anomalies: {len(toc_anomalies)}")
for ta in toc_anomalies[:30]:
    print("  TOC:", ta)

print("\nTop 15 Broken-Paragraph Ratios:")
for ratio, bp, tp, name in sorted(broken_stats, reverse=True)[:15]:
    print(f"  {ratio:5.2f}% ({bp:3d}/{tp:4d}) | {name}")

spots = [
    "哲学史讲演录", "大逻辑（逻辑学）", "民主化的进程", "理性的毁灭",
    "历史与阶级意识", "判断力批判", "洛克全集", "艺术哲学",
    "费希特与谢林之间的哲学断裂", "克拉拉，或论自然与精神世界的联系",
    "巴迪欧与卡桑《性关系不存在》", "神话哲学历史批判导论",
    "黑格尔论宗教与政治", "启蒙辩证法", "哲学导论",
]
print("\nSpot-check bound footnotes:")
for sp in spots:
    for k, v in fn_summary.items():
        if sp in k:
            print(f"  {k}: {v} footnotes bound")
