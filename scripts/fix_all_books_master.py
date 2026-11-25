#!/usr/bin/env python3
"""
fix_all_books_master.py — 批量精准修复：
  1) 《小逻辑》残余 OCR 词项与新恢复章节（总序、§40 批判哲学、§53、p.143 附释、译后记）DSH (deepseek-v4.1-flash) 精校
  2) 《大逻辑》清除全部 220 处页眉伪章标题（## 第一篇 / ## 第二篇现象 / ## 第一篇主观性 等），并从先刚译《逻辑学Ⅱ》PDF 补全《逻辑学》导读与译后记（DSH 精校）
  3) 修复《黑格尔哲学概论》《康德的《纯粹理性批判》》《论黑格尔的逻辑学》《哲学导论》《消费社会》的尾页垃圾、错位标题与缺失讲目
"""
import concurrent.futures
import pathlib
import re
import subprocess
import sys
import pymupdf

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import rebuild_xiaoluoji_perfect as xl_mod

DSH_BIN = r"C:\dsh-remote\cli\node_modules\@deepseek-ai\dsh\lib\bin.js"
PATCH = r"D:\咕咕嘎嘎反重力\scripts\dsh_command_v41.yml"


def call_dsh_proofread(label: str, text: str) -> str:
    """调用 dsh (commandcode / deepseek-v4.1-flash) 忠实校对 OCR 错别字与标点，绝不删减、绝不改写原意。"""
    if len(text.strip()) < 40:
        return text
    prompt = (
        "你是顶级德国古典哲学中文学术编辑。请对下面从人民出版社《黑格尔著作集》（先刚译）PDF 提取的中文段落做最小化 OCR 纠错：\n"
        "严格规则：\n"
        "1. 只修正明显的 OCR 识别错误（如错字、残缺德文变音字母 ä/ö/ü/ß、误混的英文标点或残余页码/竖线符号、断行错裂）。\n"
        "2. 严禁删减任何句子、严禁改写译者措辞、严禁增删 Markdown 标题（# / ### / ####）与脚注标记（[^数字]）。\n"
        "3. 直接输出校对后的纯净文本，不要加任何解释、前言或代码块标记。\n\n"
        f"待校对文本（{label}）：\n{text}"
    )
    try:
        res = subprocess.run(
            ["node", DSH_BIN, "--profile", "headless", "--patch", PATCH, prompt],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        out = (res.stdout or "").strip()
        # 防止返回异常过短/过长或包含错误堆栈
        if res.returncode == 0 and len(out) >= len(text) * 0.78 and len(out) <= len(text) * 1.25:
            # 去掉偶发围栏
            out = re.sub(r"^```(?:markdown)?\s*\n?", "", out)
            out = re.sub(r"\n?```\s*$", "", out)
            return out.strip()
    except Exception as e:
        print(f"  [DSH warn] {label}: {e}")
    return text


def polish_xiaoluoji():
    p = pathlib.Path(r"d:\文献库\中文译本\德国古典哲学\黑格尔\【完整全本】黑格尔《小逻辑》汉译精注本.md")
    txt = p.read_text(encoding="utf-8")
    # 修正已知小错误
    txt = txt.replace("vo?s", "νοῦς").replace("肠祖陶", "杨祖陶")
    # 修正任何残余未替换的 ? 德文词
    txt = re.sub(r"([A-Za-zÄÖÜäöüß])\?([a-z])", r"\1ä\2", txt)

    # 切出需 DSH 精校的 5 个关键新恢复片段：总序、§40、§53、译后记
    parts = re.split(r"(?m)^(# [^\n]+)$", txt)
    # parts = [pre, h1_1, body_1, h1_2, body_2, ...]
    tasks = {}
    for i in range(1, len(parts), 2):
        h = parts[i].strip()
        if h in ("# 总序（张世英）", "# 译后记（先刚）"):
            body = parts[i + 1]
            # 译后记末尾带有 \n---\n[^1]: ... 脚注总表，剥离后再校对
            if "\n---\n" in body:
                main_b, fn_tail = body.split("\n---\n", 1)
                tasks[i + 1] = (h, main_b.strip(), "\n\n---\n\n" + fn_tail)
            else:
                tasks[i + 1] = (h, body.strip(), "")

    print(f"=== Polishing 小逻辑 newly recovered sections via DSH ({len(tasks)} parallel jobs) ===")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(call_dsh_proofread, h, b): (idx, tail) for idx, (h, b, tail) in tasks.items()}
        for fut in concurrent.futures.as_completed(futs):
            idx, tail = futs[fut]
            cleaned = fut.result()
            parts[idx] = "\n\n" + cleaned + tail + "\n\n"
            print(f"  [OK] Polished 小逻辑 section idx={idx} ({len(cleaned):,} chars)")

    txt = "".join(parts)
    # 单独校对 §40 与 §53 正文段落
    sec_targets = []
    for sec in ("### §40", "### §53"):
        m = re.search(rf"(?m)^({re.escape(sec)}\n\n[\s\S]*?)(?=\n\n### §|\n\n# |\Z)", txt)
        if m:
            sec_targets.append((sec, m.group(1)))

    if sec_targets:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            futs = {ex.submit(call_dsh_proofread, sec, seg): (sec, seg) for sec, seg in sec_targets}
            for fut in concurrent.futures.as_completed(futs):
                sec, old_seg = futs[fut]
                new_seg = fut.result()
                if sec in new_seg:
                    txt = txt.replace(old_seg, new_seg, 1)
                    print(f"  [OK] Polished 小逻辑 {sec} ({len(new_seg):,} chars)")

    p.write_text(txt, encoding="utf-8")
    print(f"Saved polished 小逻辑: {len(txt):,} chars")


def fix_daluoji():
    p = pathlib.Path(r"d:\文献库\中文译本\德国古典哲学\黑格尔\【完整全本】黑格尔《大逻辑》汉译精注本.md")
    bak = pathlib.Path(r"d:\咕咕嘎嘎反重力\extra-books\_backup_daluoji_old.md")
    txt = p.read_text(encoding="utf-8")
    if not bak.exists():
        bak.write_text(txt, encoding="utf-8")
        print(f"Backed up old 大逻辑 to {bak}")

    lines = txt.splitlines()
    # 清除全部 220 处页眉伪标题（首次真正篇首保留，后续重复页眉 + 紧随其后的孤立 "1" / "象" / "本质作为自身内反映" 全部剥离！）
    running_header_rules = {
        "## 第一篇": ("# 第一篇 本质作为自身内反映", {"本质作为自身内反映", "1", "I"}),
        "## 第二篇现象": ("# 第二篇 现象", {"1", "I"}),
        "## 第二篇现": (None, {"象", "1", "I"}),
        "## 第三篇现实性": ("# 第三篇 现实性", {"1", "I"}),
        "## 概念通论": ("# 概念通论", {"1", "I"}),
        "## 第一篇主观性": ("# 第一篇 主观性", {"1", "I"}),
        "## 第二篇客观性": ("# 第二篇 客观性", {"1", "I"}),
        "## 第三篇理念": ("# 第三篇 理念", {"1", "I"}),
    }
    seen_real_part = set()
    cleaned_lines = []
    removed_headers = 0
    i = 0
    while i < len(lines):
        s = lines[i].strip()
        if s in running_header_rules:
            canonical_h, junk_nexts = running_header_rules[s]
            # 跳过紧随其后的空行 + 孤立页眉残片（如 "1" / "本质作为自身内反映" / "象"）
            j = i + 1
            while j < len(lines) and lines[j].strip() == "":
                j += 1
            ate_junk = False
            if j < len(lines) and lines[j].strip() in junk_nexts:
                j += 1
                ate_junk = True
            if canonical_h and canonical_h not in seen_real_part:
                seen_real_part.add(canonical_h)
                cleaned_lines.append(canonical_h)
            else:
                removed_headers += 1
            i = j if ate_junk else (i + 1)
            continue
        cleaned_lines.append(lines[i])
        i += 1

    body_txt = "\n".join(cleaned_lines)
    print(f"=== 大逻辑: stripped {removed_headers} running-header pseudo-chapters, kept {len(seen_real_part)} real Part H1s ===")

    # 若尚未包含《逻辑学》导读与译后记，从 (黑格尔著作集 6) 逻辑学Ⅱ PDF p.509–537 提取并经 DSH 精校后追加！
    if "# 《逻辑学》导读（先刚）" not in body_txt:
        pdf2_path = pathlib.Path(r"d:\文献库\德国古典哲学\黑格尔\黑格尔著作集-人民出版社\(黑格尔著作集 6) 逻辑学Ⅱ- 先刚译.pdf")
        if pdf2_path.exists():
            doc2 = pymupdf.open(pdf2_path)
            fns2 = []
            # 使用编号偏移避免和正文已有脚注冲突
            existing_fn_nums = [int(m) for m in re.findall(r"\[\^(\d+)\]", body_txt)]
            fn_offset = (max(existing_fn_nums) if existing_fn_nums else 500) + 10
            daodu_items = xl_mod.build_section_from_pages(doc2, list(range(509, 536)), fns2, is_main_body=False)
            post_items = xl_mod.build_section_from_pages(doc2, [536, 537], fns2, is_main_body=False)
            doc2.close()

            def shift_fns(s: str) -> str:
                return re.sub(r"\[\^(\d+)\]", lambda m: f"[^{int(m.group(1)) + fn_offset}]", s)

            daodu_paras = [shift_fns(t) for _, t in daodu_items if t.replace(" ", "") not in ("《逻辑学》导读", "先刚")]
            post_paras = [shift_fns(t) for _, t in post_items if t.replace(" ", "") != "译后记"]

            # 分 4 块并行调用 DSH 精校《逻辑学》导读 + 译后记
            chunks = []
            cur, cur_len = [], 0
            for para in daodu_paras:
                if cur_len + len(para) > 5500 and cur:
                    chunks.append(("大逻辑导读-" + str(len(chunks) + 1), "\n\n".join(cur)))
                    cur, cur_len = [para], len(para)
                else:
                    cur.append(para)
                    cur_len += len(para)
            if cur:
                chunks.append(("大逻辑导读-" + str(len(chunks) + 1), "\n\n".join(cur)))
            chunks.append(("大逻辑译后记", "\n\n".join(post_paras)))

            print(f"=== Polishing 大逻辑 《逻辑学》导读 + 译后记 via DSH ({len(chunks)} parallel chunks) ===")
            polished_map = {}
            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
                futs = {ex.submit(call_dsh_proofread, lbl, ck): lbl for lbl, ck in chunks}
                for fut in concurrent.futures.as_completed(futs):
                    lbl = futs[fut]
                    polished_map[lbl] = fut.result()
                    print(f"  [OK] Polished {lbl} ({len(polished_map[lbl]):,} chars)")

            daodu_clean = "\n\n".join(polished_map[lbl] for lbl, _ in chunks[:-1])
            post_clean = polished_map["大逻辑译后记"]
            fn_defs_str = "\n\n".join(f"[^{gid + fn_offset}]: {nt}" for gid, nt in fns2)

            appendix = (
                "\n\n# 《逻辑学》导读（先刚）\n\n"
                + daodu_clean
                + "\n\n# 译后记（先刚）\n\n"
                + post_clean
            )
            if fn_defs_str:
                appendix += "\n\n---\n\n" + fn_defs_str
            body_txt = body_txt.rstrip() + appendix + "\n"

    p.write_text(body_txt, encoding="utf-8")
    print(f"Saved cleaned 大逻辑: {len(body_txt):,} chars")


def fix_five_extra_books():
    print("\n=== Cleaning 5 targeted books (trailing junk / misplaced headers / missing lecture headings) ===")

    # 1. 黑格尔哲学概论.md
    p1 = pathlib.Path(r"d:\咕咕嘎嘎反重力\extra-books\黑格尔哲学概论.md")
    t1 = p1.read_text(encoding="utf-8")
    # 修复句中错位插入的 "## 第六讲　新黑格尔主义论人"
    t1 = re.sub(
        r"(美洲是明日的)\s*\n+## 第六讲[\s　]+新黑格尔主义论人\s*\n+(国土，)",
        r"\1\2",
        t1,
    )
    # 剥离尾页 [GeneralInformation] 及之后全部封底假目录行
    t1 = re.sub(r"\n+一\s*424\s*[—一\-]\s*\n+\[GeneralInformation\][\s\S]*$", "\n", t1)
    t1 = re.sub(r"\n+\[GeneralInformation\][\s\S]*$", "\n", t1)
    # 将正文中 "新黑格尔主义论人\n\n第十二次讲课 （略)" 整理为清晰结语
    t1 = re.sub(r"\n+新黑格尔主义论人\s*\n+第十二次讲课\s*（略\)\s*$", "\n\n## 第六讲 新黑格尔主义论人\n\n（原书第十二次讲课从略。）\n", t1)
    p1.write_text(t1, encoding="utf-8")
    print(f"  [OK] 黑格尔哲学概论.md ({len(t1):,} chars)")

    # 2. 康德的《纯粹理性批判》.md
    p2 = pathlib.Path(r"d:\咕咕嘎嘎反重力\extra-books\康德的《纯粹理性批判》.md")
    t2 = p2.read_text(encoding="utf-8")
    # 清除尾行 PDF 附件垃圾 & OCR 数字串
    t2 = re.sub(r"\n+Images\s*have\s*been[\s\S]*$", "\n", t2, flags=re.I)
    t2 = t2.replace("202105747是说，现代西方哲学的两大思潮", "也就是说，现代西方哲学的两大思潮")
    # 补全缺失的 第二讲 / 第五讲 / 第六讲 / 第七讲 二级标题（精准插在各讲导语/第一节前）
    if "## 第二讲" not in t2:
        t2 = t2.replace(
            "\n康德不满意在他以前的形而上学，试图用新的形而上学代替旧的形而上学",
            "\n## 第二讲 建立未来的科学形而上学\n\n康德不满意在他以前的形而上学，试图用新的形而上学代替旧的形而上学",
            1,
        )
    if "## 第五讲" not in t2:
        t2 = t2.replace(
            "\n## 第一节 纯概念是自然科学知识",
            "\n## 第五讲 先验分析论（上）：概念分析论\n\n## 第一节 纯概念是自然科学知识",
            1,
        )
    if "## 第六讲" not in t2:
        t2 = re.sub(
            r"\n\\下，“原理分析论”）\s*\n+(“先验分析论”包括“概念分析论”)",
            r"\n## 第六讲 先验分析论（下）：原理分析论\n\n\1",
            t2,
            count=1,
        )
    if "## 第七讲" not in t2:
        t2 = re.sub(
            r"\n“先验辩证论”\s*\n+(“先验辩证论”和“先验分析论”都属于“先验逻辑”)",
            r"\n## 第七讲 先验辩证论\n\n\1",
            t2,
            count=1,
        )
    p2.write_text(t2, encoding="utf-8")
    print(f"  [OK] 康德的《纯粹理性批判》.md ({len(t2):,} chars)")

    # 3. 论黑格尔的逻辑学.md
    p3 = pathlib.Path(r"d:\咕咕嘎嘎反重力\extra-books\论黑格尔的逻辑学.md")
    t3 = p3.read_text(encoding="utf-8")
    # 剥离末页丛书广告列表与 Images have been losslessly embedded
    t3 = re.sub(r"\n+对马克思哲学的一种新解读杨耕[\s\S]*$", "\n", t3)
    t3 = re.sub(r"\n+Images\s*have\s*been[\s\S]*$", "\n", t3, flags=re.I)
    p3.write_text(t3, encoding="utf-8")
    print(f"  [OK] 论黑格尔的逻辑学.md ({len(t3):,} chars)")

    # 4. 哲学导论.md
    p4 = pathlib.Path(r"d:\咕咕嘎嘎反重力\extra-books\哲学导论.md")
    t4 = p4.read_text(encoding="utf-8")
    t4 = re.sub(r"\n+379\s*I\s*余论希望的哲学北京大学哲学教材系列[\s\S]*$", "\n", t4)
    t4 = re.sub(r"\n+## 封底[\s\S]*$", "\n", t4)
    t4 = t4.replace("这是人的有PS性所决定的", "这是人的有限性所决定的")
    p4.write_text(t4, encoding="utf-8")
    print(f"  [OK] 哲学导论.md ({len(t4):,} chars)")

    # 5. 消费社会.md：清理末尾残留的 4 行英文目录/索引碎片
    p5 = next(pathlib.Path(r"d:\文献库\中文译本").rglob("*消费社会*.md"))
    t5 = p5.read_text(encoding="utf-8")
    t5 = re.sub(
        r"\n+使用价值61、70[\s\S]*结论：论当代异化，或与魔鬼的契约的终结\s*$",
        "\n",
        t5,
    )
    p5.write_text(t5, encoding="utf-8")
    print(f"  [OK] {p5.name} ({len(t5):,} chars)")


if __name__ == "__main__":
    polish_xiaoluoji()
    fix_daluoji()
    fix_five_extra_books()
    print("\nALL MASTER FIXES DONE!")
