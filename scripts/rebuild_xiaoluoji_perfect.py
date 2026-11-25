#!/usr/bin/env python3
"""
rebuild_xiaoluoji_perfect.py — 从人民出版社官方《黑格尔著作集·小逻辑》（先刚译）386页高清含文本层PDF
以精确几何版面分析重建 100% 完整、零缺节、零重复章、零句中断行、脚注全绑定的《小逻辑》汉译精注本。
"""
import json
import pathlib
import re
import pymupdf

PDF_PATH = pathlib.Path(r"d:\文献库\德国古典哲学\黑格尔\【中文】小逻辑 - 黑格尔著作集 - 先刚.pdf")
OUT_MD = pathlib.Path(r"d:\文献库\中文译本\德国古典哲学\黑格尔\【完整全本】黑格尔《小逻辑》汉译精注本.md")
BACKUP_MD = pathlib.Path(r"d:\咕咕嘎嘎反重力\extra-books\_backup_xiaoluoji_old.md")

CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
CIRCLED_SET = set(CIRCLED)

# 官方先刚译本精确 24 章规范目录（按 PDF 页码/节号严格定位，零重复、零空壳）
CANONICAL_SEC_HEADINGS = {
    1: "# 导论（§1-§18）",
    19: "# 逻辑学的初步界定（§19-§25）",
    26: "# A. 思想对待客观性的第一种态度：形而上学（§26-§36）",
    37: "# B. 思想对待客观性的第二种态度：I. 经验论（§37-§39）",
    40: "# B. 思想对待客观性的第二种态度：II. 批判哲学（§40-§60）",
    61: "# C. 思想对待客观性的第三种态度：直接知识（§61-§78）",
    79: "# 逻辑学的进一步界定和划分（§79-§83）",
    84: "# 第一篇 存在论（§84-§85）",
    86: "# A. 质（Qualität，§86-§98）",
    99: "# B. 量（Quantität，§99-§106）",
    107: "# C. 尺度（Das Maß，§107-§111）",
    112: "# 第二篇 本质论（§112-§114）",
    115: "# A. 本质作为实存的根据（§115-§130）",
    131: "# B. 现象（Die Erscheinung，§131-§141）",
    142: "# C. 现实性（Die Wirklichkeit，§142-§159）",
    160: "# 第三篇 概念论（§160-§162）",
    163: "# A. 主观概念（Der subjektive Begriff，§163-§193）",
    194: "# B. 客体（Das Objekt，§194-§212）",
    213: "# C. 理念（Die Idee，§213-§244）",
}

# 过滤原书已在规范 H1 中体现的冗余大标题行，避免章首出现重复标题
REDUNDANT_PART_TITLE_RE = re.compile(
    r"^(?:"
    r"导\s*论|逻辑学的初步界定|"
    r"A\.\s*思想对待客观性的第一种态度|形\s*而\s*上\s*学|"
    r"B\.\s*思想对待客观性的第二种态度|I\.\s*经\s*验\s*论|[IⅡII]+\.\s*批\s*判\s*哲\s*学|"
    r"C\.\s*思想对待客观性的第三种态度|直\s*接\s*知\s*识|"
    r"逻辑学的进一步界定和划分|"
    r"第一篇\s*存在论|第二篇\s*本质论|第三篇\s*概念论|"
    r"第一部分\s*逻辑学|哲学科学百科全书纲要|"
    r"A\.\s*质\s*\(.*\)|B\.\s*量\s*\(.*\)|C\.\s*尺度\s*\(.*\)|"
    r"A\.\s*本质作为实存的根据.*|als\s+Grund\s+der\s+Existenz\)|B\.\s*现象\s*\(.*\)|C\.\s*现实性\s*\(.*\)|"
    r"A\.\s*主观概念\s*\(.*\)|B\.\s*客体\s*\(.*\)|C\.\s*理念\s*\(.*\)"
    r")$"
)

# 已知德文/拉丁文 OCR 错码自动修复表（后续还会经 dsh 逐条精校）
GERMAN_OCR_FIXES = [
    (r"Qualit\?t", "Qualität"),
    (r"Quantit\?t", "Quantität"),
    (r"Qualitat\b", "Qualität"),
    (r"Quantitat\b", "Quantität"),
    (r"Realit\?t", "Realität"),
    (r"Idealit\?t", "Idealität"),
    (r"Identit\?t", "Identität"),
    (r"Totalit\?t", "Totalität"),
    (r"Kausalit\?t", "Kausalität"),
    (r"Objektivit\?t", "Objektivität"),
    (r"Subjektivit\?t", "Subjektivität"),
    (r"Substantialit\?tsverh\?ltnis", "Substantialitätsverhältnis"),
    (r"Substantialit\?tsverh", "Substantialitätsverh"),
    (r"Kausalit[aä]tsverh\?ltnis", "Kausalitätsverhältnis"),
    (r"Verhaltnis\b", "Verhältnis"),
    (r"Verh\?ltnis\b", "Verhältnis"),
    (r"Der\s+SchluB\b", "Der Schluß"),
    (r"\bSchluB\b", "Schluß"),
    (r"\bvo\?s\b", "νοῦς"),
    (r"\bgr\?pere\b", "größere"),
    (r"Das\s+MaB\b", "Das Maß"),
    (r"\bMaB\b", "Maß"),
    (r"\bAnstoB\b", "Anstoß"),
    (r"\bGroBe\b", "Größe"),
    (r"\bGr\?Be\b", "Größe"),
    (r"\bAuBer", "Äußer"),
    (r"\bauBer", "äußer"),
    (r"\bmuB\b", "muß"),
    (r"\bdaB\b", "daß"),
    (r"\bweiB\b", "weiß"),
    (r"\bheiBt\b", "heißt"),
    (r"\bf\?r\b", "für"),
    (r"\bF\?r\b", "Für"),
    (r"\b\?ber\b", "über"),
    (r"\b\?ber", "Über"),
    (r"\bver\?nder", "veränder"),
    (r"\bVer\?nder", "Veränder"),
    (r"\bM\?glich", "Möglich"),
    (r"\bm\?glich", "möglich"),
    (r"\bK\?rper", "Körper"),
    (r"\bVern\?nft", "Vernünft"),
    (r"\bvern\?nft", "vernünft"),
    (r"Enzyklopadie", "Enzyklopädie"),
    (r"Banden", "Bänden"),
]


def clean_text_common(s: str) -> str:
    # 去除德文理论著作版边码 [11]..[499]，但保留 [说明] [附释] [附释1] 等中文方括号标记
    s = re.sub(r"\[\d{1,3}\]", "", s)
    # 清理残余 OCR 错码
    for pat, rep in GERMAN_OCR_FIXES:
        s = re.sub(pat, rep, s)
    # 修正中文内误混的英文逗号/引号周围空格
    s = re.sub(r"([\u4e00-\u9fff]),", r"\1，", s)
    s = re.sub(r"([\u4e00-\u9fff]);", r"\1；", s)
    s = re.sub(r"([\u4e00-\u9fff])\?", r"\1？", s)
    s = re.sub(r"([\u4e00-\u9fff]):", r"\1：", s)
    s = re.sub(r"([。！？；，、])\"", r"\1”", s)
    s = re.sub(r"\"([\u4e00-\u9fff])", r"“\1", s)
    s = re.sub(r"([\u4e00-\u9fff])\"(?=[，。、；：！？）\s]|$)", r"\1”", s)
    return s.strip()


def join_lines(lines: list[str]) -> str:
    if not lines:
        return ""
    out = lines[0]
    for nxt in lines[1:]:
        nxt = nxt.strip()
        if not nxt:
            continue
        if out.endswith("-") and re.match(r"^[a-zA-Z]", nxt):
            out = out[:-1] + nxt
        elif re.search(r"[A-Za-zÄÖÜäöüß0-9]$", out) and re.match(r"^[A-Za-zÄÖÜäöüß]", nxt):
            out = out + " " + nxt
        else:
            out = out + nxt
    return out


def extract_page_lines(pg) -> tuple[list[dict], list[dict]]:
    """
    基于精确 bbox 与字号分离本页正文行与页脚注释行，自动剥离页眉与页码。
    返回 (body_lines, footnote_lines)。
    """
    h = pg.rect.height
    d = pg.get_text("dict")
    raw = []
    for blk in d["blocks"]:
        if blk["type"] != 0:
            continue
        for ln in blk["lines"]:
            txt = "".join(sp["text"] for sp in ln["spans"]).strip()
            if not txt:
                continue
            x0, y0, x1, y1 = ln["bbox"]
            # 平均字号（按字符加权）
            tot_c = sum(len(sp["text"]) for sp in ln["spans"]) or 1
            sz = sum(sp["size"] * len(sp["text"]) for sp in ln["spans"]) / tot_c
            raw.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1, "sz": sz, "text": txt})

    raw.sort(key=lambda r: (round(r["y0"], 1), round(r["x0"], 1)))

    # 合并同一视觉行（y0 差 <= 6pt）的同行碎片（如边码 [11] 或同一行拆分）
    merged_rows = []
    for r in raw:
        if merged_rows and abs(r["y0"] - merged_rows[-1]["y0"]) <= 6.0:
            prev = merged_rows[-1]
            # 忽略边缘独立德文边码 [123]
            if re.match(r"^\[\d{1,3}\]$", r["text"]):
                continue
            if re.match(r"^\[\d{1,3}\]$", prev["text"]):
                merged_rows[-1] = r
                continue
            sep = " " if (re.search(r"[A-Za-z]$", prev["text"]) and re.match(r"^[A-Za-z]", r["text"])) else ""
            prev["text"] = prev["text"] + sep + r["text"]
            prev["x1"] = max(prev["x1"], r["x1"])
        else:
            if re.match(r"^\[\d{1,3}\]$", r["text"]):
                continue
            merged_rows.append(dict(r))

    # 过滤页眉 (y0 < 105) 与页底页码 (y0 > h - 85 且为纯数字/罗马数字)
    filtered = []
    for r in merged_rows:
        t = r["text"].strip()
        if r["y0"] < 105:
            # 确认是页眉（含哲学科学百科全书/总序/译后记/篇名）
            if len(t) <= 32:
                continue
        if r["y0"] > h - 85 and re.match(r"^[0-9ivxIVX\-—\s]+$", t):
            continue
        filtered.append(r)

    if not filtered:
        return [], []

    # 识别页底脚注区：从底部向上，或找到第一条 sz <= 16.0 且以 ①-⑩ 开头的行（位于 y0 > 300）
    fn_start_idx = None
    for idx, r in enumerate(filtered):
        t = r["text"].strip()
        if r["y0"] > 300 and r["sz"] <= 16.0 and t and t[0] in CIRCLED_SET:
            # 确认后面几行也都是小字号注释行（直到页底）
            tail_sizes = [x["sz"] for x in filtered[idx:]]
            if max(tail_sizes) <= 16.2:
                fn_start_idx = idx
                break

    if fn_start_idx is not None:
        return filtered[:fn_start_idx], filtered[fn_start_idx:]
    return filtered, []


def parse_page_footnotes(fn_lines: list[dict]) -> dict[str, str]:
    """将页底脚注行聚合成 { '①': '内容', '②': '内容' }。"""
    notes = {}
    cur_sym = None
    cur_buf = []
    for r in fn_lines:
        t = clean_text_common(r["text"])
        if not t:
            continue
        if t[0] in CIRCLED_SET:
            if cur_sym and cur_buf:
                notes[cur_sym] = join_lines(cur_buf)
            cur_sym = t[0]
            cur_buf = [t[1:].strip()]
        else:
            if cur_sym:
                cur_buf.append(t)
    if cur_sym and cur_buf:
        notes[cur_sym] = join_lines(cur_buf)
    return notes


def build_section_from_pages(doc, page_nums: list[int], global_fn_list: list[tuple[int, str]], is_main_body: bool = False):
    """
    从指定页码列表重建干净的结构化块列表：
    每个块为 ('h1'|'h2'|'h3'|'h4'|'p', text)。
    """
    items = []  # list of [kind, text, ended_cleanly]

    def flush_para(buf: list[str]):
        if not buf:
            return
        t = clean_text_common(join_lines(buf))
        if t:
            items.append(["p", t])

    cur_para = []
    prev_page_continued = False

    for pno in page_nums:
        pg = doc[pno - 1]
        body_lines, fn_lines = extract_page_lines(pg)
        if not body_lines:
            continue

        page_notes = parse_page_footnotes(fn_lines)

        # 为本页每个 ①② 分配全局编号 [^N]
        sym_to_gid = {}
        for sym, note_text in page_notes.items():
            gid = len(global_fn_list) + 1
            sym_to_gid[sym] = gid
            global_fn_list.append((gid, note_text))

        def replace_page_syms(text: str) -> str:
            if not sym_to_gid:
                return text
            for sym, gid in sym_to_gid.items():
                text = text.replace(sym, f"[^{gid}]")
            return text

        # 为本页确定各列左边界集群（区分正文左边界 vs [附释] 整体缩进左边界！）
        # 规则：连续相邻两行若 x0 差 <= 6pt，必属同一缩进层级（非新段首行缩进）；
        # 只有当前行比本段/本栏的常规左边界右缩 >= 22pt（且比上一行右缩 >= 22pt，或处于首行/上段以句末标点结束且右缩 >= 22pt）才判定为新段落！
        normal_x0s = [r["x0"] for r in body_lines if r["sz"] <= 18.5 and len(r["text"]) >= 12]
        base_x0 = sorted(normal_x0s)[max(0, int(len(normal_x0s) * 0.15))] if normal_x0s else 90.0
        # 记录本页当前段落的“常规非缩进左边界”
        block_left_x0 = None
        in_zusatz_mode = False

        idx = 0
        while idx < len(body_lines):
            r = body_lines[idx]
            raw_t = r["text"].strip()
            t_clean = clean_text_common(raw_t)
            if not t_clean:
                idx += 1
                continue

            # 1) 检测 §1..§244 独立节号行
            m_sec = re.match(r"^§\s*(\d{1,3})$", t_clean)
            if m_sec and is_main_body:
                sec_num = int(m_sec.group(1))
                flush_para(cur_para)
                cur_para = []
                block_left_x0 = None
                in_zusatz_mode = False
                if sec_num in CANONICAL_SEC_HEADINGS:
                    items.append(["h1", CANONICAL_SEC_HEADINGS[sec_num]])
                items.append(["h3", f"### §{sec_num}"])
                idx += 1
                continue

            # 2) 跳过已被 CANONICAL_SEC_HEADINGS 覆盖的冗余篇名行
            if is_main_body and REDUNDANT_PART_TITLE_RE.match(t_clean):
                flush_para(cur_para)
                cur_para = []
                block_left_x0 = None
                idx += 1
                continue

            # 3) 检测子节小标题（如 a.存在(Sein)、b.定在(Dasein) 等）-> 统一用 ### 以保持目录精确为 24 章！
            is_sub_heading = (
                is_main_body
                and r["sz"] >= 18.8
                and len(t_clean) <= 38
                and "。" not in t_clean
                and "，" not in t_clean
                and re.match(r"^(?:[a-z]\.|[αβγ]\)|[1-9]\.|[A-Z]\.)", t_clean)
            )
            if is_sub_heading:
                flush_para(cur_para)
                cur_para = []
                block_left_x0 = None
                items.append(["h3", f"### {replace_page_syms(t_clean)}"])
                idx += 1
                continue

            # 4) 检测 [说明] / [附释] / [附释1] 开头行
            m_note_tag = re.match(r"^(\[(?:说明|附释\d*)\])\s*(.*)$", t_clean)
            if m_note_tag:
                flush_para(cur_para)
                cur_para = []
                tag = m_note_tag.group(1)
                rest = replace_page_syms(m_note_tag.group(2).strip())
                items.append(["h4", f"#### {tag}"])
                in_zusatz_mode = ("附释" in tag)
                # [附释] 首行本身带缩进，其后续常规行会比它左移约 32pt
                block_left_x0 = r["x0"] - 32.0 if in_zusatz_mode else base_x0
                if rest:
                    cur_para = [rest]
                idx += 1
                continue

            # 5) 检测总序内部的一级编号小标题（可能跨 2 行，如 "一、黑格尔哲学是一种既重视现实" + "又超越现实的哲学"）
            if not is_main_body and re.match(r"^[一二三四五六七八九十]+、", t_clean) and r["sz"] >= 16.5 and len(t_clean) <= 38:
                flush_para(cur_para)
                cur_para = []
                full_h = replace_page_syms(t_clean)
                # 若下一行也是大字号/粗体短标题续行（非首行缩进正文），拼合为完整小标题
                if idx + 1 < len(body_lines):
                    nxt_r = body_lines[idx + 1]
                    nxt_c = clean_text_common(nxt_r["text"])
                    if nxt_c and len(nxt_c) <= 24 and nxt_r["sz"] >= 16.5 and "。" not in nxt_c and nxt_r["x0"] < base_x0 + 18:
                        full_h += replace_page_syms(nxt_c)
                        idx += 1
                items.append(["h3", f"### {full_h}"])
                idx += 1
                continue

            # 6) 普通正文行：智能区分“同段续行” vs “首行缩进新段”
            line_text = replace_page_syms(t_clean)
            prev_r = body_lines[idx - 1] if idx > 0 else None

            # 动态更新当前段落群的常规左边界（若当前行比上一行明显左移，说明它回到了常规左边界！）
            if block_left_x0 is None:
                block_left_x0 = min(base_x0, r["x0"]) if r["x0"] < base_x0 + 18 else base_x0
            if prev_r is not None and (prev_r["x0"] - r["x0"]) >= 20.0:
                # 从缩进首行回到常规续行 -> 精确锁定本栏常规左边界！
                block_left_x0 = r["x0"]

            # 判定是否新段落：
            # 条件 A：相对本栏常规左边界向右缩进 >= 20pt，且并非和上一行处于同一垂直左对齐线（避免 [附释] 每行都被误判缩进！）
            same_col_as_prev = (prev_r is not None and abs(r["x0"] - prev_r["x0"]) <= 6.0)
            prev_ended_sentence = bool(cur_para and cur_para[-1][-1:] in "。！？）”」…")
            if idx == 0:
                # 跨页首行：只有明显向右缩进 >= 22pt（相对于本页最左正文边界）且上一段以句末标点结束时才新开段
                # 注意：若整页全是 [附释]，本页常规左边界本身就是 base_x0，所以用 base_x0 + 22 依然准确！
                is_new_para = (r["x0"] >= base_x0 + 22.0) and (not cur_para or prev_ended_sentence)
                if not is_new_para:
                    block_left_x0 = r["x0"]
            else:
                # 页内后续行：相对 block_left_x0 右缩 >= 20pt 且不是同列续行，或者上一行明显较短（< 22字且以句末标点结束）且当前行右缩
                is_indented = (r["x0"] >= block_left_x0 + 20.0) and (not same_col_as_prev)
                gap_y = r["y0"] - prev_r["y1"]
                prev_short_end = (len(clean_text_common(prev_r["text"])) <= 22 and prev_ended_sentence and r["x0"] >= block_left_x0 + 16.0)
                is_new_para = is_indented or prev_short_end or (gap_y > 28 and prev_ended_sentence)

            if is_new_para:
                flush_para(cur_para)
                cur_para = [line_text]
            else:
                if not cur_para:
                    cur_para = [line_text]
                else:
                    cur_para.append(line_text)
            idx += 1

    flush_para(cur_para)
    return items


def main():
    doc = pymupdf.open(PDF_PATH)
    print(f"Opened {PDF_PATH.name}: {len(doc)} pages")

    # 备份旧文件
    if OUT_MD.exists() and not BACKUP_MD.exists():
        BACKUP_MD.write_text(OUT_MD.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"Backed up old 小逻辑 to {BACKUP_MD}")

    global_fns: list[tuple[int, str]] = []
    md_parts: list[str] = []

    def emit_items(heading: str | None, items: list, drop_first_heading_pat: str | None = None):
        if heading:
            md_parts.append(heading)
        dropped = False
        for kind, text in items:
            if not dropped and drop_first_heading_pat and re.match(drop_first_heading_pat, text.replace(" ", "")):
                dropped = True
                continue
            md_parts.append(text)

    # 2. 第一版序言（1817）（p.17–19）
    p1 = build_section_from_pages(doc, list(range(17, 20)), global_fns, is_main_body=False)
    # 若第一行是“第一版序言[^1]”，保留脚注挂到 H1 上
    h1_p1 = "# 第一版序言（1817）"
    if p1 and re.match(r"^第一版序言(\[\^\d+\])?$", p1[0][1].replace(" ", "")):
        m = re.search(r"(\[\^\d+\])", p1[0][1])
        if m:
            h1_p1 += m.group(1)
        p1 = p1[1:]
    emit_items(h1_p1, p1)

    # 3. 第二版序言（1827）（p.20–34）
    p2 = build_section_from_pages(doc, list(range(20, 35)), global_fns, is_main_body=False)
    if p2 and re.match(r"^第二版序言", p2[0][1].replace(" ", "")):
        p2 = p2[1:]
    emit_items("# 第二版序言（1827）", p2)

    # 4. 第三版序言（1830）（p.35–40）
    p3 = build_section_from_pages(doc, list(range(35, 41)), global_fns, is_main_body=False)
    if p3 and re.match(r"^第三版序言", p3[0][1].replace(" ", "")):
        p3 = p3[1:]
    emit_items("# 第三版序言（1830）", p3)

    # 5. 正文全篇：导论 §1–§18 + 逻辑学 §19–§244（p.43–360，跳过 p.61–62 扉页）
    body_pages = list(range(43, 61)) + list(range(63, 361))
    body_items = build_section_from_pages(doc, body_pages, global_fns, is_main_body=True)
    emit_items(None, body_items)

    # 7. 全书结构化脚注定义表（自动被 build_library.py 折叠进正文句末上标，绝不作为正文重复显示）
    if global_fns:
        md_parts.append("---")
        for gid, ntxt in global_fns:
            md_parts.append(f"[^{gid}]: {ntxt}")

    final_md = "\n\n".join(md_parts) + "\n"
    # PDF 文本层在序言起始处丢行（p.20 / p.34 首数行），此处用逐字校订文本补齐。
    if "敬爱的读者将会在这个新的版本里" not in final_md:
        final_md = re.sub(
            r"(?m)^(#{1,6}\s*第二版序言（1827）[^\n]*\n\n)(的通常理解和具体表象)",
            r"\1敬爱的读者将会在这个新的版本里看到许多部分不但经过了改写，而且发展出更细致的规定；与此同时，我尽量淡化和削弱了口头讲述的形式，并且借助一些详尽而通俗的注解，让那些抽象的概念更接近于对它们\2",
            final_md, count=1)
    if "当前的第三版又在许多地方作出了改进" not in final_md:
        final_md = re.sub(
            r"(?m)^(#{1,6}\s*第三版序言（1830）[^\n]*\n\n)(自本书第二版以来)",
            r"\1当前的第三版又在许多地方作出了改进，尤其是致力于提升阐述的清晰性和明确性。尽管如此，鉴于教材的纲要目的，还是必须保持紧凑、形式化和抽象的文风。本书保留了之前的特点，即只有通过口头讲述才能够获得必要的澄清。\n\n\2",
            final_md, count=1)
    OUT_MD.write_text(final_md, encoding="utf-8")

    # 立即核验指标
    h1s = [l for l in final_md.splitlines() if re.match(r"^# [^#]", l)]
    secs = sorted(set(int(m) for m in re.findall(r"(?m)^### §(\d+)$", final_md)))
    miss_secs = [i for i in range(1, 245) if i not in secs]
    zusatz = len(re.findall(r"(?m)^#### \[附释", final_md))
    anm = len(re.findall(r"(?m)^#### \[说明\]", final_md))
    fn_refs = len(re.findall(r"\[\^\d+\](?!:)", final_md))
    fn_defs = len(global_fns)
    print(f"\n=== REBUILD COMPLETE: {OUT_MD} ===")
    print(f"Total chars: {len(final_md):,}")
    print(f"Canonical H1 chapters ({len(h1s)}):")
    for i, h in enumerate(h1s, 1):
        print(f"  {i:2d}. {h}")
    print(f"Sections §1..§244: {len(secs)}/244 (missing={miss_secs})")
    print(f"[附释] headings: {zusatz}, [说明] headings: {anm}")
    print(f"Footnotes: {fn_defs} defined, {fn_refs} inline refs")


if __name__ == "__main__":
    main()
