#!/usr/bin/env python3
"""
audit_release_gate.py —
Step 5 Final Release-Gate Verification across all 73 books in `library-data`:
1. 0 omission markers (`脱漏`, `原文缺失`, fullwidth `[…缺失…]`)
2. 0 fallback-stacked `>=3` consecutive trailing footnote blocks
3. 0 unfolded dedicated note chapters
4. 0 floating body footnotes (`* ... ——编者注`, `*缩小*`, `哲学导论（第三版）|`, `（至此为原有的注。——译者）`)
5. 0 TOC anomalies (duplicate titles, double suffixes, circled digits, trailing page numbers, tiny stub chapters)
6. < 2.0% genuine mid-sentence broken-paragraph ratio on every prose book
7. 0 stray page-number blocks, 0 unpaired `**`, 0 raw HTML tags, 0 narrative `p` blocks > 2500 chars
"""
import json
import pathlib
import re
import sys

LIB = pathlib.Path(r"d:\咕咕嘎嘎反重力\library-data")
cat = json.loads((LIB / "catalog.json").read_text("utf-8"))["books"]

NOTES_TITLE_CHECK = re.compile(
    r"^(?!各种注释|.*意译与注释)(?:.*注释|译者注|译注|尾注|脚注|注|编者注|原注|编辑说明)(?:（(?:续\s*[0-9一二三四五六七八九十]+|[一二三四五六七八九十]+)）)*$"
)
OMISSION_RE = re.compile(
    r"[〔【［\[][^〕】］\]]{0,25}(?:脱漏|原文缺失|文字缺失|内容缺失|此处缺失|段落缺失|首句有缺失|缺漏|待补|遗漏)[^〕】］\]]{0,25}[〕】］\]]|\[缺失\]|〔缺失〕|【缺失】|［缺失］"
)
RAW_HTML_RE = re.compile(r"<(?:a|div|span|p|br|hr|img|table|tr|td|h[1-6])\b[^>]*>|&nbsp;", re.I)
PAGE_BLOCK_RE = re.compile(r"^(?:-\s*\d{1,4}\s*-|第\s*\d{1,4}\s*页|\d{1,4})$")
SUBHEAD_LIKE_RE = re.compile(
    r"^(?:第[一二三四五六七八九十百千万0-9]+[章节篇部卷讲条]|"
    r"[一二三四五六七八九十]+(?:[、．\.\s]|[\u4e00-\u9fff])|"
    r"（[一二三四五六七八九十0-9]+）|\([一二三四五六七八九十0-9]+\)|"
    r"[0-9]+[、．\.\)]|[IVXLCDM]+[\.\s、]|\[.+\]|\*.+\*|\*\*.+\*\*)$"
)

def load_book_chapters(bdir: pathlib.Path) -> list:
    chs = {}
    for p in sorted(bdir.glob("p_*.json")):
        data = json.loads(p.read_text("utf-8"))
        for k, v in data.items():
            chs[int(k)] = v
    return [chs[k] for k in sorted(chs.keys())]

omissions = []
stacked = []
unfolded_notes = []
floating_fns = []
toc_anomalies = []
stray_pages = []
unpaired_bold = []
raw_html_hits = []
prose_walls_2500 = []
broken_stats = []
total_fns = 0

for b in cat:
    btitle = b["title"]
    bdir = LIB / "books" / b["id"]
    chs = load_book_chapters(bdir)
    is_ref = "辞典" in btitle or "费希特研究" in btitle
    seen_titles = {}
    tot_p = 0
    broken_p = 0

    for ci, ch in enumerate(chs):
        title = ch["t"]
        blks = ch["b"]
        ch_chars = sum(len(x.get("t") or "") for x in blks)
        is_idx_ch = any(k in title for k in ("索引", "目录", "术语表", "词汇表", "文献", "年表"))

        # TOC checks
        if re.search(r"（续[一二三四五六七八九十]+）（[一二三四五六七八九十]+）", title):
            toc_anomalies.append((btitle, ci, title, "double_suffix"))
        if re.search(r"[①-⑳]", title):
            toc_anomalies.append((btitle, ci, title, "circled_in_title"))
        if re.search(r"(?:\s|）)\d{2,3}$", title) and not re.search(r"(?:1[6-9]\d{2}|20\d{2}|第\s*\d+|§)", title):
            toc_anomalies.append((btitle, ci, title, "trailing_page_num"))
        seen_titles[title] = seen_titles.get(title, 0) + 1
        if ch_chars < 60:
            toc_anomalies.append((btitle, ci, title, f"tiny_ch({ch_chars}c)"))

        if NOTES_TITLE_CHECK.match(title.strip()):
            unfolded_notes.append((btitle, ci, title, len(blks), ch_chars))

        for bi, blk in enumerate(blks):
            t = blk.get("t") or ""
            ts = t.strip()
            fns = blk.get("f") or []
            total_fns += len(fns)

            # Check omissions in body and footnotes
            for m in OMISSION_RE.finditer(t):
                if "注码脱漏" not in m.group(0):
                    omissions.append((btitle, ci, title, bi, m.group(0)))
            for fn in fns:
                ft = fn.get("t") or ""
                for m in OMISSION_RE.finditer(ft):
                    if "注码脱漏" not in m.group(0):
                        omissions.append((btitle, ci, title, bi, "FN:" + m.group(0)))

            if re.search(r"(?:⟦fn:\d+⟧\s*){3,}$", ts):
                stacked.append((btitle, ci, title, bi, len(fns), ts[-80:]))

            if (
                re.search(r"(?:^|\n)\s*[*＊]{1,6}\s*.*——\s*(?:编者注|译者注|原注)", ts)
                or "*缩小*" in ts
                or re.search(r"哲学导论[（(]\s*第三版[^|\n]{0,12}[|｜]", ts)
                or "（至此为原有的注。——译者）" in ts
            ):
                floating_fns.append((btitle, ci, title, bi, ts[:90]))

            if PAGE_BLOCK_RE.match(ts):
                stray_pages.append((btitle, ci, title, bi, ts))
            if t.count("**") % 2 != 0:
                unpaired_bold.append((btitle, ci, title, bi, ts[:80]))
            if RAW_HTML_RE.search(t):
                raw_html_hits.append((btitle, ci, title, bi, ts[:80]))

            if blk.get("y") == "p":
                if not is_ref and not is_idx_ch and len(ts) > 2500:
                    prose_walls_2500.append((btitle, ci, title, bi, len(ts), ts[:70]))
                if not is_ref and not is_idx_ch:
                    tot_p += 1
                    s_clean = re.sub(r"(?:⟦fn:\d+⟧|\s|[①-⑳⁰¹²³⁴⁵⁶⁷⁸⁹\*＊†‡¶§]|\[\d{1,4}\]|(?<=[。！？!?…”’）\)])\d{1,3})+$", "", ts).strip()
                    nxt_blk = blks[bi + 1] if bi + 1 < len(blks) else None
                    # Exclude sub-heading paragraphs, embedded front-matter TOC lines (`/108`, `  28`), markdown table rows (`| ... |`), and notebook callouts (`NB`, `按手稿刊印`, `第Ⅻ卷`)
                    is_subhead = (
                        (nxt_blk is not None and nxt_blk.get("y") in ("h", "r", "q", "l") and len(s_clean) <= 60)
                        or (len(s_clean) <= 45 and not re.search(r"[，。；：、,]", s_clean))
                        or bool(SUBHEAD_LIKE_RE.match(s_clean))
                        or bool(re.search(r"(?:/\d{1,3}\b|\s{2,}\d{1,3}\s*$|^\|.+\|\s*$|\[\d{1,4}\]\s*[A-Z]\.|(?:NB|按手稿刊印|第[IVXⅫ0-9]+卷)$)", s_clean))
                        or (ci == 0 and "导言" in title and bool(re.search(r"\s\d{2,3}$", s_clean)))
                    )
                    if (
                        len(s_clean) >= 16
                        and not is_subhead
                        and not re.search(r"[。！？!?…”’」』）】\]\.．；;：:—\-~\"'°＝=]$", s_clean)
                    ):
                        broken_p += 1

    for t_name, c_cnt in seen_titles.items():
        if c_cnt > 1:
            toc_anomalies.append((btitle, -1, t_name, f"dup_title x{c_cnt}"))

    if not is_ref:
        ratio = (broken_p / tot_p * 100) if tot_p else 0.0
        broken_stats.append((ratio, broken_p, tot_p, btitle))

max_broken_ratio = max((r for r, _, _, _ in broken_stats), default=0.0)
books_over_2pct = [(r, bp, tp, bt) for r, bp, tp, bt in broken_stats if r >= 2.0]

print(f"=== RELEASE GATE AUDIT ({len(cat)} books, {total_fns:,} bound footnotes) ===")
print(f"1. Omission markers           : {len(omissions)}")
for x in omissions[:10]: print("   OMISSION:", x)
print(f"2. Stacked >=3 trailing fns   : {len(stacked)}")
for x in stacked[:10]: print("   STACKED:", x)
print(f"3. Unfolded note chapters     : {len(unfolded_notes)}")
for x in unfolded_notes[:10]: print("   UNFOLDED:", x)
print(f"4. Floating body footnotes    : {len(floating_fns)}")
for x in floating_fns[:10]: print("   FLOATING:", x)
print(f"5. TOC anomalies              : {len(toc_anomalies)}")
for x in toc_anomalies[:15]: print("   TOC:", x)
print(f"6. Prose books >= 2.0% broken : {len(books_over_2pct)} (max={max_broken_ratio:.2f}%)")
for r, bp, tp, name in sorted(broken_stats, reverse=True)[:10]:
    print(f"   {r:5.2f}% ({bp:3d}/{tp:4d}) | {name}")
print(f"7. Stray page-num blocks      : {len(stray_pages)}")
print(f"8. Unpaired '**' blocks       : {len(unpaired_bold)}")
for x in unpaired_bold[:10]: print("   BOLD:", x)
print(f"9. Raw HTML tag blocks        : {len(raw_html_hits)}")
for x in raw_html_hits[:10]: print("   HTML:", x)
print(f"10. Narrative walls > 2500c   : {len(prose_walls_2500)}")
for x in prose_walls_2500[:10]: print("   WALL:", x)
