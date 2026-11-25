#!/usr/bin/env python3
"""
fix_phase4_toc_and_typography.py —
Step 4:
1. Fix cut/duplicate/false TOC headings in:
   - `康德的《纯粹理性批判》.md`
   - `德国哲学论丛.md`
   - `论再生产.md`
   - `单子论：新译与导读.md`
2. Fix OCR-corrupted Chinese periods (`°`, `º`, ` O`) in `【完整全本】黑格尔《大逻辑》汉译精注本.md`.
3. Repair `列宁哲学笔记.md` `## 人名索引` & `## 主题索引` (strip `613 人名索引` / `628 主题索引` running headers and unscramble 2-column `## 主题索引` via DSH `deepseek/deepseek-v4.1-flash`).
4. Clean stray running-header leaks (`。论` in `论黑格尔的逻辑学.md`), OCR typos (`是一一个`, `盘格鲁一美国`, `意識`->`意识`), unpaired `**`, and heal mid-sentence paragraph breaks across prose books.
5. Split >2000-char narrative prose walls at natural semantic sentence boundaries via DSH `deepseek/deepseek-v4.1-flash` with 100% character conservation.
"""
import json
import os
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

DSH_BIN = r"C:\dsh-remote\cli\node_modules\@deepseek-ai\dsh\lib\bin.js"
PATCH = r"D:\咕咕嘎嘎反重力\scripts\dsh_command_v41.yml"
ROOT = Path(r"D:\咕咕嘎嘎反重力")
EXTRA = ROOT / "extra-books"
SRC_ZH = Path(r"D:\文献库\中文译本")
WORK = ROOT / "audit-work" / "gap_repair" / "step4_typo"
WORK.mkdir(parents=True, exist_ok=True)


def call_dsh(prompt: str, timeout: int = 220):
    env = os.environ.copy()
    env["DSH_PERMISSION_MODE"] = "danger-full-access"
    subprocess.run(
        ["node", DSH_BIN, "--profile", "headless", "--patch", PATCH, prompt],
        check=True,
        env=env,
        timeout=timeout,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def fix_kant_cpr():
    p = EXTRA / "康德的《纯粹理性批判》.md"
    lines = p.read_text("utf-8").splitlines()
    out = []
    i = 0
    joined = 0
    while i < len(lines):
        s = lines[i].strip()
        if re.match(r"^##\s+第[一二三四五六七八九十]+[讲节]", s):
            # Look ahead at next 1..2 non-empty lines to see if heading was split across lines
            title = re.sub(r"^##\s+", "", s).strip()
            # Ensure space after 第X讲/第X节
            title = re.sub(r"^(第[一二三四五六七八九十]+[讲节])\s*(?=\S)", r"\1 ", title)
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines):
                nxt = lines[j].strip()
                # Case 1: bare `第一讲` / `第三讲` / `第四讲` / `第八讲`
                if re.match(r"^第[一二三四五六七八九十]+[讲节]$", title) and not nxt.startswith("#") and len(nxt) <= 24:
                    title = f"{title} {nxt}"
                    i = j
                    joined += 1
                    # Check if a 3rd short fragment follows (e.g. 第四讲 空间和时间是感性知识 / 成立的条件)
                    k = i + 1
                    while k < len(lines) and not lines[k].strip():
                        k += 1
                    if k < len(lines) and len(lines[k].strip()) <= 10 and not lines[k].strip().startswith("#"):
                        title = f"{title}{lines[k].strip()}"
                        i = k
                # Case 2: two-line `第X节 ...` where next line is <= 14 chars continuation
                elif not nxt.startswith("#") and len(nxt) <= 14 and not nxt.endswith("。") and not re.match(r"^[1-9][\.\·、]", nxt):
                    title = f"{title}{nxt}"
                    i = j
                    joined += 1
            # Fix unclosed quotes in heading title
            if "“" in title and "”" not in title:
                if title.endswith("’"):
                    title = title[:-1] + "”"
                else:
                    title = title + "”"
            out.append(f"## {title}")
            i += 1
            continue
        out.append(lines[i])
        i += 1
    p.write_text("\n".join(out) + "\n", "utf-8")
    print(f"[康德的《纯粹理性批判》.md] Rejoined {joined} split headings.")


def fix_german_philosophy():
    p = EXTRA / "德国哲学论丛.md"
    txt = p.read_text("utf-8")
    # 1. Demote L759 `## 第2章，第6、7节）` and L1413 `## 第三章“真理问题”的基本内容；对第二方面问题的考察是该书`
    txt = re.sub(r"\n+##\s+第2章，第6、7节）", "第2章，第6、7节）", txt)
    txt = re.sub(
        r"\n+##\s+(第三章“真理问题”的基本内容；对第二方面问题的考察是该书)\n+",
        r"\1",
        txt,
    )
    # 2. Fix L2617 `# 莱布尼茨在中国文化中的两大发现` hierarchy
    txt = txt.replace("# 莱布尼茨在中国文化中的两大发现", "## 莱布尼茨在中国文化中的两大发现")
    for sub in [
        "一、莱布尼茨的符号语言研究",
        "二、二进制算术的创立",
        "三、白晋来信与六十四卦",
        "四、论文的补充与发表",
        "汉字的生命力与简洁性",
        "汉字超越时空的优势",
        "汉字的结构与计算机输入",
        "五笔字型输入法",
        "汉字与计算机",
        "汉字与计算机的融合",
        "莱布尼茨的普遍符号语言理想",
    ]:
        txt = txt.replace(f"\n## {sub}\n", f"\n### {sub}\n")
    txt = txt.replace("\n## 莱布尼茨在中国文化中的两大发现\n\n### 二、《易经》六十四卦与二进制算术", "\n### 二、《易经》六十四卦与二进制算术")
    txt = txt.replace("\n## 莱布尼茨在中国文化中的两大发现（三）\n", "\n")
    txt = txt.replace("\n## 真理的本质?\n", "\n## 真理的本质\n")

    # 3. Group trailing English Abstracts (`## 伽达默尔与晚期海德格尔` at L3103..3254) and German TOC (`## 目录` at L3255..end)
    idx_abs = txt.find("## 伽达默尔与晚期海德格尔")
    idx_dir = txt.find("## 目录\n", idx_abs if idx_abs != -1 else 0)
    if idx_abs != -1 and idx_dir != -1:
        main_part = txt[:idx_abs]
        abs_part = txt[idx_abs:idx_dir]
        dir_part = txt[idx_dir:]
        # In abs_part: remove `（续）` duplicate headings, demote `### ` author lines to bold, demote `## ` paper titles to `### `
        abs_part = re.sub(r"(?m)^##\s+.+（续）\s*$", "", abs_part)
        abs_part = re.sub(r"(?m)^###\s+([一二三四]、.+)$", r"**\1**", abs_part)
        abs_part = re.sub(r"(?m)^###\s+([^\n]+)$", r"**\1**", abs_part)
        abs_part = re.sub(r"(?m)^##\s+([^\n]+)$", r"### \1", abs_part)
        abs_part = "## 英文提要（Abstracts）\n\n" + abs_part.lstrip()

        # In dir_part: demote `# ` / `## ` / `### ` inside German TOC/Resümee so they don't spawn duplicate chapters
        dir_part = re.sub(r"(?m)^#\s+《德国哲学论丛》德文目录.*$", "", dir_part)
        dir_part = re.sub(r"(?m)^##\s+德文目录（续）\s*$", "", dir_part)
        dir_part = re.sub(r"(?m)^###\s+([^\n]+)$", r"**\1**", dir_part)
        dir_part = re.sub(r"(?m)^##\s+(目录|德文目录)\s*$", r"### \1", dir_part)
        dir_part = "## 附录：总目录与德文摘要（Inhalt / Resümee）\n\n" + dir_part.lstrip()
        txt = main_part + abs_part + "\n\n" + dir_part

    txt = re.sub(r"\n{3,}", "\n\n", txt).strip() + "\n"
    p.write_text(txt, "utf-8")
    print("[德国哲学论丛.md] Cleaned false headings and grouped Abstracts/German TOC.")


def fix_reproduction():
    p = EXTRA / "论再生产.md"
    lines = p.read_text("utf-8").splitlines()
    out = []
    seen_h2 = set()
    removed_dup_h2 = 0
    demoted_num_h3 = 0
    i = 0
    while i < len(lines):
        s = lines[i].strip()
        # 1. Join two-line `## 第十一章` / `## 第十二章`
        if s in ("## 第十一章", "## 第十二章"):
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines) and not lines[j].strip().startswith("#"):
                s = f"{s} {lines[j].strip()}"
                i = j
        # 2. Check H2 headings
        if s.startswith("## ") and not s.startswith("### "):
            raw_h2 = s[3:].strip()
            clean_h2 = re.sub(r"[①-⑳＊\*]+$", "", raw_h2).strip()
            # Normalize `## 四、社会分工...` (L1135) to `### 四、社会分工...`
            if clean_h2.startswith("四、社会分工"):
                out.append(f"### {clean_h2}")
                i += 1
                continue
            # Deduplicate running-header H2s (`法文版序...`, `第五章 法`, `第六章...`, `第七章...`, `第八章...`, `第十章...`, `第十二章...`, `关于意识形态国家机器的说明`, `译后记`)
            norm_key = re.sub(r"\s+", "", clean_h2)
            # Note: `论生产关系的再生产` appears once as Ch9 (`第九章 论生产关系的再生产`) and once inside `意识形态和意识形态国家机器（研究笔记）` (L4543)
            if norm_key in seen_h2:
                if clean_h2 in ("国家", "从描述性的理论到理论本身", "马克思主义国家理论的主要内容", "意识形态国家机器", "论生产关系的再生产"):
                    # Inside `意识形态和意识形态国家机器（研究笔记）`, make these H3 sub-sections
                    out.append(f"### {clean_h2}")
                else:
                    # Pure running header repeated mid-chapter (or 2nd part of 译后记): drop the redundant heading!
                    removed_dup_h2 += 1
                i += 1
                continue
            seen_h2.add(norm_key)
            out.append(f"## {clean_h2}")
            i += 1
            continue
        # 3. Demote `### 1. ...` / `### 2. ...` numbered thesis/list items to normal paragraphs
        m_num_h3 = re.match(r"^###\s+(\d+\.\s+.+)$", s)
        if m_num_h3:
            out.append(m_num_h3.group(1))
            demoted_num_h3 += 1
            i += 1
            continue
        # 4. Strip trailing circled numbers from H3 headings
        if s.startswith("### "):
            clean_h3 = re.sub(r"[①-⑳＊\*]+$", "", s[4:].strip()).strip()
            out.append(f"### {clean_h3}")
            i += 1
            continue
        out.append(lines[i])
        i += 1
    txt = re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"
    p.write_text(txt, "utf-8")
    print(f"[论再生产.md] Removed {removed_dup_h2} running-header H2s, demoted {demoted_num_h3} numbered H3 theses.")


def fix_monadology_and_greater_logic():
    # 1. 单子论：新译与导读.md trailing 215 / 219 in headings
    p_mon = next(SRC_ZH.rglob("*单子论*新译*.md"))
    tm = p_mon.read_text("utf-8")
    tm, n_m = re.subn(r"(?m)^(#{1,4}\s+.+（1714[^）]*）)\s*\d{2,3}\s*$", r"\1", tm)
    if n_m:
        p_mon.write_text(tm, "utf-8")
        print(f"[单子论：新译与导读.md] Stripped trailing page numbers from {n_m} headings.")

    # 2. 【完整全本】黑格尔《大逻辑》汉译精注本.md OCR degree/O periods -> `。`
    p_gl = SRC_ZH / "德国古典哲学" / "黑格尔" / "【完整全本】黑格尔《大逻辑》汉译精注本.md"
    if p_gl.exists():
        tg = p_gl.read_text("utf-8")
        tg, n_g1 = re.subn(r"(?<=[\u4e00-\u9fff”’）\)\]])[ \t]*[°º∘][ \t]*(?=$|\n|[”’）\)\]])", "。", tg)
        tg, n_g2 = re.subn(r"(?<=[\u4e00-\u9fff”’）\)\]])[ \t]*O[ \t]*(?=$|\n)", "。", tg)
        if n_g1 or n_g2:
            p_gl.write_text(tg, "utf-8")
            print(f"[大逻辑] Fixed {n_g1 + n_g2} OCR-corrupted Chinese periods (°/O -> 。).")


def fix_lenin_escaped_star_notes(txt: str) -> str:
    """Convert all remaining Pandoc backslash-escaped `\\* ... ——编者注` lines and running headers in 列宁哲学笔记.md."""
    # First strip bold/plain page running headers like `**157 黑格尔《逻辑学》摘要**` or `511　关于普列汉诺夫...的批注`
    txt, n_bh = re.subn(
        r"(?m)^(?:\*\*)?\d{2,3}[\s\u3000]+[^\n*]{2,40}(?:摘要|札记|笔记|批注|讲演录|计划)[^\n*]{0,15}(?:\*\*)?\s*$\n?",
        "",
        txt,
    )
    lines = txt.splitlines()
    n = len(lines)

    def is_esc_star_line(s: str) -> bool:
        s = s.strip()
        if not s or s.startswith("[^"):
            return False
        if re.match(r"^(?:\\?[*＊]){1,10}\s*.*——\s*(?:编者注|译者注|原注)[。.]?\*?\s*$", s):
            return True
        if re.match(r"^\*[^*\n]+——\s*(?:编者注|译者注|原注)[。.]?\*\s*$", s):
            return True
        return False

    # Also catch multi-line star note where line i starts with `\*` or `\*\*` and line i+1 ends with `——编者注`
    star_line_set = set()
    for i in range(n):
        s = lines[i].strip()
        if is_esc_star_line(s):
            star_line_set.add(i)
        elif re.match(r"^(?:\\?[*＊]){1,10}\s+\S", s) and (
            (i + 1 < n and is_esc_star_line(lines[i + 1].strip()))
            or (i > 0 and i - 1 in star_line_set and "——" in s)
        ):
            star_line_set.add(i)

    out = []
    i = 0
    fn_seq = 0
    converted = 0
    while i < n:
        if i not in star_line_set:
            out.append(lines[i])
            i += 1
            continue
        # Collect contiguous block of star_line_set (ignoring blank lines between them)
        cluster_lines = []
        j = i
        while j < n:
            if j in star_line_set:
                cluster_lines.append(lines[j].strip())
                j += 1
            elif not lines[j].strip() and j + 1 < n and (j + 1) in star_line_set:
                j += 1
            else:
                break
        raw_cluster = " ".join(cluster_lines)
        # Strip wrapping italic `*...*` if the entire line was `*...——编者注*`
        if raw_cluster.startswith("*") and raw_cluster.endswith("*") and not raw_cluster.startswith("\\*") and raw_cluster.count("——") == 1:
            raw_cluster = "* " + raw_cluster[1:-1].strip()

        # Split cluster into individual notes by `(?:^|(?<=编者注)|(?<=译者注)|(?<=原注))[\s\u3000]*((?:\\?[*＊]){1,10})\s*`
        parts = re.split(r"(?:^|(?<=编者注)|(?<=译者注)|(?<=原注)|(?<=编者注。))[\s\u3000]+(?=(?:\\?[*＊]){1,10}\s*)", raw_cluster)
        notes = []
        for pt in parts:
            pt = pt.strip()
            if not pt:
                continue
            m = re.match(r"^((?:\\?[*＊]){1,10})\s*(.+)$", pt)
            if m:
                sc = len(re.findall(r"[*＊]", m.group(1)))
                nt = m.group(2).rstrip("*").strip()
                notes.append((sc, nt))
            elif notes:
                notes[-1] = (notes[-1][0], notes[-1][1] + " " + pt.rstrip("*").strip())
            else:
                notes.append((1, pt.rstrip("*").strip()))

        # Find recent non-empty body lines in `out` (up to 12 lines back) to bind inline `\*`..`\*\*\*`
        defs_to_emit = []
        for sc, nt in notes:
            fn_seq += 1
            fid = f"e8{fn_seq:03d}-1"
            defs_to_emit.append(f"[^{fid}]: {nt}")
            converted += 1
            # Search backwards in `out` for an inline star sequence of length `sc`
            pat_inline = re.compile(rf"(?<![*＊\\])(?:\\?[*＊]){{{sc}}}(?![*＊])")
            bound_inline = False
            for back_k in range(len(out) - 1, max(-1, len(out) - 16), -1):
                if not out[back_k].strip() or out[back_k].strip().startswith(("#", "[^")):
                    continue
                if pat_inline.search(out[back_k]):
                    out[back_k] = pat_inline.sub(f"[^{fid}]", out[back_k], count=1)
                    bound_inline = True
                    break
            if not bound_inline:
                # Attach to last non-empty body line in `out`
                for back_k in range(len(out) - 1, -1, -1):
                    if out[back_k].strip() and not out[back_k].strip().startswith(("#", "[^", "---")):
                        out[back_k] = out[back_k].rstrip() + f"[^{fid}]"
                        break

        # Check if the last non-empty body line in `out` was broken mid-sentence across this footnote cluster!
        while out and not out[-1].strip():
            out.pop()
        while j < n and not lines[j].strip():
            j += 1
        if (
            out
            and j < n
            and not out[-1].strip().startswith(("#", "[^", "---", ">"))
            and not re.search(r"[。！？!?…”’）\)\]]$", re.sub(r"\[\^[^\]]+\]", "", out[-1]).strip())
            and not lines[j].strip().startswith(("#", "[^", "---", ">", "NB"))
            and (j not in star_line_set)
        ):
            out[-1] = out[-1].rstrip() + lines[j].lstrip()
            j += 1

        out.append("")
        for d_line in defs_to_emit:
            out.append(d_line)
            out.append("")
        i = j

    print(f"[列宁哲学笔记.md] Converted {converted} escaped star-notes and stripped {n_bh} bold running headers.")
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"


def fix_lenin_indexes():
    p = EXTRA / "列宁哲学笔记.md"
    txt = p.read_text("utf-8")
    txt = fix_lenin_escaped_star_notes(txt)
    # 1. Strip running page headers `613 人名索引` .. `637 主题索引`
    txt, n_hdr = re.subn(r"(?m)^\d{3}\s+(?:人名索引|主题索引)\s*$\n?", "", txt)
    p.write_text(txt, "utf-8")
    print(f"[列宁哲学笔记.md] Stripped {n_hdr} index page headers and saved star-note conversions.")

    # 2. Unscramble 2-column `## 主题索引` via DSH in 8 compact chunks (~45 lines / ~1.3KB each)
    idx_zt = txt.find("## 主题索引")
    if idx_zt == -1:
        return
    before_zt = txt[:idx_zt]
    zt_raw = txt[idx_zt:]
    zt_lines = [l.strip() for l in zt_raw.splitlines() if l.strip() and l.strip() != "## 主题索引"]
    if all(l.startswith(("- ", "### ")) for l in zt_lines[:10]):
        print("[列宁哲学笔记.md] Subject Index already unscrambled.")
        return

    chunk_size = (len(zt_lines) + 7) // 8
    chunks = [zt_lines[i : i + chunk_size] for i in range(0, len(zt_lines), chunk_size)]

    def run_zt_chunk(ci: int, c_lines: list):
        sp = WORK / f"lenin_zt8_src_{ci}.txt"
        op = WORK / f"lenin_zt8_out_{ci}.md"
        raw_s = "\n".join(c_lines)
        sp.write_text(raw_s, "utf-8")
        if op.exists() and len(op.read_text("utf-8").strip()) >= len(raw_s) * 0.7:
            return op.read_text("utf-8").strip()
        prompt = (
            f"请读取 `{sp}`（这是《列宁哲学笔记》书末“主题索引”的双栏 OCR 短片段，约 45 行，因左右两栏交错导致同一词条或不同字母词条穿插在相邻行）。\n"
            f"严禁编写或运行任何脚本、严禁访问其他文件。\n"
            f"请将该片段快速整理为排版清晰的 Markdown 索引格式并写入 `{op}`：\n"
            f"1. **零遗漏词条与页码**：保留片段内出现的字母标题（如 `### A`、`### B`……）、每一个主题词条、子词条与全部页码数字。\n"
            f"2. **理顺双栏穿插**：将被双栏切断的词条与页码拼回所属词条下；每个主词条用 `- **词条名** —— 页码及子项` 单列一行。\n"
            f"3. 直接写入 `{op}`，写完只回复 DONE。"
        )
        try:
            call_dsh(prompt, timeout=200)
            if op.exists() and op.read_text("utf-8").strip():
                return op.read_text("utf-8").strip()
        except Exception as e:
            print(f"  [列宁哲学笔记 主题索引 ERR chunk {ci}]: {e}")
        return "\n\n".join(f"- {ln}" for ln in c_lines)

    results = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(run_zt_chunk, ci, ch): ci for ci, ch in enumerate(chunks)}
        for fut in as_completed(futs):
            ci = futs[fut]
            results[ci] = fut.result()
            print(f"  [列宁哲学笔记 主题索引] Chunk {ci}/7 unscrambled ({len(results[ci])} chars).")

    new_zt = "## 主题索引\n\n" + "\n\n".join(results[k] for k in sorted(results.keys())) + "\n"
    p.write_text(before_zt + new_zt, "utf-8")
    print("[列宁哲学笔记.md] Rebuilt clean 2-column Subject Index.")


def clean_global_typos_and_broken_paragraphs():
    all_mds = sorted(list(EXTRA.glob("*.md")) + [p for p in SRC_ZH.rglob("*.md") if "_backups" not in str(p) and "思辨之声" not in str(p)])
    typo_subs = [
        ("是一一个", "是一个"),
        ("一一个", "一个"),
        ("盘格鲁一美国", "盎格鲁—美国"),
        ("意識", "意识"),
        ("排厅", "排斥"),
        ("神益", "裨益"),
        ("誉写了", "誊写了"),
        ("低毁", "诋毁"),
        ("分道扬，", "分道扬镳，"),
    ]
    MID_SENT_END = re.compile(r"[。！？!?…”’」』）】\.：:—\-…]$")
    SKIP_NEXT_START = re.compile(
        r"^(?:[#>\-\*\+\|]|第[一二三四五六七八九十百千万0-9]+[章节篇部卷讲条]|[一二三四五六七八九十]+[、．\.]|"
        r"（[一二三四五六七八九十0-9]+）|\([一二三四五六七八九十0-9]+\)|[0-9]+[、．\.\)]|"
        r"[\[\(（【〔]?\d{1,3}[\]\)）】〕]|[①-⑳]|\[\^|注\s*释|附\s*释|说\s*明|参\s*见|按[：:])"
    )

    total_typos = 0
    total_stitched = 0
    for mp in all_mds:
        if mp.name.lower() == "readme.md":
            continue
        is_dict = "辞典" in mp.name or "费希特研究" in mp.name
        txt = mp.read_text("utf-8")
        orig = txt
        for k, v in typo_subs:
            if k in txt:
                c = txt.count(k)
                txt = txt.replace(k, v)
                total_typos += c

        # Book-specific running-header leak at end of paragraph: `论黑格尔的逻辑学.md` trailing `。论` -> `。`
        if "论黑格尔的逻辑学" in mp.name:
            txt = re.sub(r"(?m)。论\s*$", "。", txt)
            # Fix ASCII quotes after CJK punctuation e.g. `事实!"` -> `事实！”`
            txt = re.sub(r'(?<=[\u4e00-\u9fff])[!！]"\s*$', "！”", txt, flags=re.M)
            txt = re.sub(r'(?<=[\u4e00-\u9fff。！？])"\s*$', "”", txt, flags=re.M)

        # Strip orphan trailing plain-number footnote digits that were already folded (e.g. `。37` / `。1` at end of paragraph in 消费社会 / 自然哲学体系的第一纲要 / 谢林的有机形式哲学 / 先验唯心论体系)
        if any(w in mp.name for w in ["消费社会", "自然哲学体系的第一纲要", "谢林的有机形式哲学", "先验唯心论体系", "神话哲学"]):
            txt = re.sub(r"(?m)(?<=[。！？!?…”’」』）\)])\d{1,2}[ \t]*$", "", txt)

        # Heal genuine mid-sentence paragraph breaks in prose books (skip dictionaries)
        if not is_dict:
            paras = re.split(r"\n{2,}", txt)
            merged = []
            i = 0
            while i < len(paras):
                cur = paras[i].strip()
                while (
                    i + 1 < len(paras)
                    and cur
                    and "\n" not in cur
                    and not cur.startswith(("#", ">", "-", "*", "|", "[^"))
                    and len(cur) >= 18
                ):
                    cur_clean = re.sub(r"(?:\[\^[^\]]+\]|[①-⑳⁰¹²³⁴⁵⁶⁷⁸⁹]|\s)+$", "", cur).strip()
                    if not cur_clean or MID_SENT_END.search(cur_clean):
                        break
                    nxt = paras[i + 1].strip()
                    if (
                        not nxt
                        or "\n" in nxt
                        or len(nxt) < 6
                        or SKIP_NEXT_START.match(nxt)
                        or re.match(r"^(?:[A-Z\d\s\.\-]+|[（(].+[）)])$", nxt)
                    ):
                        break
                    # Don't merge short heading-like lines (<28 chars without internal comma/period)
                    if len(cur_clean) < 28 and not re.search(r"[，。；：、,]", cur_clean):
                        break
                    joiner = " " if (cur[-1].isascii() and nxt[0].isascii()) else ""
                    cur = cur + joiner + nxt
                    total_stitched += 1
                    i += 1
                merged.append(cur)
                i += 1
            txt = "\n\n".join(p for p in merged if p) + "\n"

        if txt != orig:
            mp.write_text(txt, "utf-8")

    print(f"[Global Typography] Fixed {total_typos} OCR typos and healed {total_stitched} mid-sentence paragraph breaks.")


def split_narrative_prose_walls_via_dsh():
    """Use DSH deepseek-v4.1-flash to split oversized (>2200c) single-line narrative prose paragraphs (e.g. 黑格尔哲学概论) at semantic topic shifts."""
    target_files = [
        EXTRA / "黑格尔哲学概论.md",
        EXTRA / "历史哲学（全本）.md",
        EXTRA / "近代哲学史.md",
    ]
    wall_items = []
    for fp in target_files:
        if not fp.exists():
            continue
        paras = re.split(r"\n{2,}", fp.read_text("utf-8"))
        for idx, p in enumerate(paras):
            s = p.strip()
            if len(s) > 2200 and not s.startswith(("#", "|", "-", "*", "[^")) and "\n" not in s:
                wall_items.append({"id": f"wall_{len(wall_items):02d}", "file": str(fp), "old": s})

    if not wall_items:
        print("[Prose Walls] No >2200c raw markdown narrative prose walls to split via DSH.")
        return

    print(f"[Prose Walls] Dispatching {len(wall_items)} oversized narrative paragraphs to DSH...")

    def run_wall(it: dict):
        wid = it["id"]
        sp = WORK / f"{wid}_src.json"
        op = WORK / f"{wid}_out.json"
        sp.write_text(json.dumps(it, ensure_ascii=False, indent=2), "utf-8")
        if op.exists():
            try:
                res = json.loads(op.read_text("utf-8"))
                if res.get("new") and len(re.sub(r"\s+", "", res["new"])) == len(re.sub(r"\s+", "", it["old"])):
                    return res
            except Exception:
                pass
        prompt = (
            f"请读取 `{sp}`（其中 `old` 是一段超过 2200 字、因扫描排版丢失分段而挤成一团的哲学正文长段）。\n"
            f"严禁编写或运行任何脚本、严禁访问其他文件。\n"
            f"请在不增删、不改动任何一个文字或标点符号的前提下，仅在语义自然转折的句号 `。`（或 `！”`/`？”`/`。”`）之后插入分段空行 `\\n\\n`，将其拆分为 2 到 4 个逻辑层次清晰的自然段（每段约 600–1200 字），以 JSON 对象 `{{\"id\": \"{wid}\", \"new\": \"分段后的完整文本\"}}` 写入 `{op}`，写完只回复 DONE。"
        )
        try:
            call_dsh(prompt, timeout=220)
            if op.exists():
                return json.loads(op.read_text("utf-8"))
        except Exception as e:
            print(f"  [Wall ERR {wid}]: {e}")
        return None

    by_file = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        for fut in as_completed([ex.submit(run_wall, it) for it in wall_items]):
            res = fut.result()
            if res and res.get("new"):
                by_file.setdefault(res["id"], res["new"])

    for it in wall_items:
        new_s = by_file.get(it["id"])
        if not new_s:
            continue
        # Verify 100% non-whitespace character conservation
        if re.sub(r"\s+", "", new_s) != re.sub(r"\s+", "", it["old"]):
            continue
        fp = Path(it["file"])
        t = fp.read_text("utf-8")
        if it["old"] in t:
            t = t.replace(it["old"], new_s, 1)
            fp.write_text(t, "utf-8")
            print(f"  [Prose Wall Split] {fp.name} ({it['id']}): split {len(it['old'])}c -> {new_s.count(chr(10)+chr(10))+1} paragraphs.")


if __name__ == "__main__":
    fix_kant_cpr()
    fix_german_philosophy()
    fix_reproduction()
    fix_monadology_and_greater_logic()
    fix_lenin_indexes()
    clean_global_typos_and_broken_paragraphs()
    split_narrative_prose_walls_via_dsh()
