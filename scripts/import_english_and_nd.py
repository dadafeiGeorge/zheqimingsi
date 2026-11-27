#!/usr/bin/env python3
r"""
import_english_and_nd.py — 清洗并导入：
1. d:\文献库\待转写的英译本\Markdown_中文译本\否定辩证法.md -> new-books/否定辩证法.md
2. d:\文献库\待转写的英译本\Markdown\*.md（全部 67 部外文哲学原典与辞典）-> english-books/*.md

自动修复：
- UTF-8 损毁字符精准还原（据英译原典核对）
- 移除所有内嵌 Markdown 目录（## 目录 / ## Contents ... ---）与 <a id="..."></a> 锚点
- 保护学术版边码/校勘尖括号（如康德 <A>/<B>、诺瓦利斯/谢林 <...>），防止被误判为 HTML 粗体或剥除
- 剔除扫描图书馆印章（SDTU KOTUPHANESI）、罗马数字页眉标题（Introduction Xxiii）与 OCR 单字母伪标题
- 修复残缺/OCR 错认标题，清理紧邻重复标题，统一层级结构
"""
import re
from pathlib import Path

CN_ND_SRC = Path(r"D:\文献库\待转写的英译本\Markdown_中文译本\否定辩证法.md")
EN_SRC_DIR = Path(r"D:\文献库\待转写的英译本\Markdown")

NEW_BOOKS_DIR = Path(r"D:\咕咕嘎嘎反重力\new-books")
EN_OUT_DIR = Path(r"D:\咕咕嘎嘎反重力\english-books")

STD_HTML_TAGS = {
    "a", "b", "i", "u", "p", "br", "hr", "em", "strong", "sup", "sub",
    "span", "div", "img", "font", "center", "table", "tr", "td", "th",
    "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
    "section", "article", "header", "footer", "nav", "figure", "figcaption",
    "small", "big", "abbr", "cite", "mark", "del", "ins", "code", "pre",
    "meta", "link", "style", "script",
}


def strip_front_header_and_toc(text: str) -> str:
    """移除顶部 '# Title / *Author* / > Note / --- / ## Contents|目录 / ... / ---' 前置自动目录。"""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r'(?m)^\s*<a\s+id="[^"]*"\s*>\s*</a>\s*$', "", text)
    text = re.sub(r'<a\s+id="[^"]*"\s*>\s*</a>', "", text)
    lines = text.splitlines()

    toc_idx = None
    for idx in range(min(len(lines), 40)):
        if re.match(r'^##\s*(?:目录|Contents|Table of Contents)\s*$', lines[idx].strip(), re.I):
            toc_idx = idx
            break

    if toc_idx is not None:
        # 寻找目录块结束的 '---'（支持像 kant-lexikon 这样长达 2500 行的目录）
        for idx in range(toc_idx + 1, min(len(lines), 6000)):
            if lines[idx].strip() == "---":
                lines = lines[idx + 1:]
                break
        else:
            # 若没有结束分隔线，跳过连续的目录列表项
            end = toc_idx + 1
            while end < len(lines) and (not lines[end].strip() or re.match(r'^\s*[-*]\s+\[', lines[end])):
                end += 1
            lines = lines[end:]
    return "\n".join(lines).strip()


def clean_cn_negative_dialectics() -> tuple[str, int]:
    """清洗阿多诺《否定辩证法》中文译本：修复 2 处 UTF-8 乱码，去除内嵌目录，重建清晰大章结构。"""
    raw = CN_ND_SRC.read_text(encoding="utf-8", errors="replace")
    # 1. 据英译原典核对，精准还原两处损毁 UTF-8 字符
    raw = raw.replace("客观价值论的\ufffd\ufffd\ufffd代", "客观价值论的时代")
    raw = raw.replace("神圣全能的\ufffd\ufffd则", "神圣全能的原则")
    raw = raw.replace("\ufffd", "")

    body = strip_front_header_and_toc(raw)
    lines = body.splitlines()
    out = []
    cur_part = ""
    for ln in lines:
        st = ln.strip()
        if st == "## 第一部分 与存在论的关系":
            cur_part = "第一部分"
            continue
        if st == "## 第三部分 模型":
            cur_part = "第三部分"
            continue
        if st == "## 第二部分 否定辩证法：概念与范畴":
            cur_part = "第二部分"
            out.append("## 第二部分 否定辩证法：概念与范畴")
            continue
        if st == "## 注释":
            out.append("## 原书注释")
            continue
        if st.startswith("### "):
            sub = st[4:].strip()
            if cur_part == "第一部分":
                if sub == "导论":
                    out.append("## 第一部分 · 导论")
                else:
                    out.append(f"## 第一部分 · {sub}")
                continue
            if cur_part == "第三部分":
                if sub.startswith("自由"):
                    out.append(f"## 第三部分 · 一、{sub}")
                elif sub.startswith("世界精神"):
                    out.append(f"## 第三部分 · 二、{sub}")
                elif sub.startswith("形而上学"):
                    out.append(f"## 第三部分 · 三、{sub}")
                else:
                    out.append(f"## 第三部分 · {sub}")
                continue
        if st.startswith("#### "):
            out.append("### " + st[5:].strip())
            continue
        out.append(ln)

    cleaned = re.sub(r'\n{3,}', '\n\n', "\n".join(out)).strip() + "\n"
    NEW_BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = NEW_BOOKS_DIR / "否定辩证法.md"
    out_path.write_text(cleaned, encoding="utf-8")
    return out_path.name, len(cleaned)


def protect_editorial_angle_brackets(text: str) -> str:
    """将学术文本中的非 HTML 校勘/边码尖括号安全转换，防止误伤康德 <A>/<B> 或谢林/诺瓦利斯编者补字。"""
    # 康德《纯粹理性批判》A/B 版边码
    text = re.sub(r'<\s*\.?\s*A\s*>', '[A]', text)
    text = re.sub(r'<\s*\.?\s*B\s*>', '[B]', text)

    def _repl(m: re.Match) -> str:
        inner = m.group(1)
        tag_m = re.match(r'^/?([A-Za-z][A-Za-z0-9]*)(?:\s|>|$)', inner)
        if tag_m and tag_m.group(1).lower() in STD_HTML_TAGS and len(inner) < 40:
            # 若仅是单独的大写 <I> / <O> 字母或含空格短语，视为校勘括注而非 HTML
            if inner.strip() in ("I", "O", "A", "B", "I.", "o"):
                return f"⟨{inner.strip()}⟩"
            if re.match(r'^/?(?:a|b|i|u|p|em|strong|sup|sub|br|hr|span|div)\b', inner, re.I):
                if " " in inner and "=" not in inner:
                    return f"⟨{inner.strip()}⟩"
                return m.group(0)
        return f"⟨{inner.strip()}⟩"

    return re.sub(r'<([^<>\n]{1,120})>', _repl, text)


# 针对个别英文原典的精准标题勘误表
EN_HEADING_FIXES = {
    "critique-of-pure-reason": {
        "Preface to the second": "Preface to the Second Edition",
        "Chapter L On the paralogisms of pure": "Chapter I: On the Paralogisms of Pure Reason",
        "Section L System of cosmological": "Section I: System of Cosmological Ideas",
        "Conclusion of the solution of the psychological": "Conclusion of the Solution of the Psychological Paralogism",
        "Section IV On the transcendental": "Section IV: On the Transcendental Ideas",
        "Section V Skeptical": "Section V: Skeptical Representation of the Cosmological Questions",
    },
    "the-encyclopaedia-logic-part-i-of-the-encyclopaedia-of-the-philosophical-sciences": {
        "Preface to the first": "Preface to the First Edition",
        "Preface to the second": "Preface to the Second Edition",
        "Glossary of translated": "Glossary of Translated Terms",
    },
    "how-to-read-lacan": {
        "FROM Che": "From Che vuoi? to Fantasy: Lacan with Eyes Wide Shut",
    },
    "the-phenomenology-of-spirit": {
        "A": "A. Consciousness",
        "B": "B. Self-Consciousness",
        "C": "C. (AA) Reason",
    },
    "lectures-on-the-history-of-philosophy-vol-i": {
        "INTRODUCTION1": "Introduction",
    },
}

# 确认需要保留单字母小节标题的书籍（如辞典 A-Z、黑格尔哲学史 A/B/C/D/E 分节、读资本论 A/B/C）
KEEP_SINGLE_LETTER_BOOKS = {
    "kant-lexikon",
    "the-kant-dictionary",
    "lectures-on-the-history-of-philosophy-volume-iii",
    "reading-capital",
}


def clean_english_book(src_path: Path) -> tuple[str, int]:
    """清洗单部英文/外文 Markdown 典籍并规范其章节标题与段落排版。"""
    stem = src_path.stem
    raw = src_path.read_text(encoding="utf-8", errors="replace")
    raw = raw.replace("\ufffd", "")
    body = strip_front_header_and_toc(raw)
    body = protect_editorial_angle_brackets(body)

    fixes = EN_HEADING_FIXES.get(stem, {})
    lines = body.splitlines()
    out = []
    last_h_norm = ""
    chars_since_h = 99999

    # 跳过开篇紧跟的孤立 "Contents" 词行（如 a-hegel-dictionary.md L16）
    start_i = 0
    while start_i < min(len(lines), 10) and lines[start_i].strip().lower() in ("", "contents", "table of contents"):
        start_i += 1
    lines = lines[start_i:]

    for ln in lines:
        st = ln.strip()
        m = re.match(r'^(#{1,6})\s+(.+)$', st)
        if m:
            lvl_str, title = m.group(1), re.sub(r'\s+', ' ', m.group(2)).strip()
            # 1) 剔除已知图书馆印章与罗马页码页眉
            if re.search(r'SDTU\s+KOTUPHANESI', title, re.I):
                continue
            if re.match(r'^Introduction\s+[XxVvIi]{2,6}$', title):
                continue
            # 2) 应用精准标题勘误
            if title in fixes:
                title = fixes[title]
            # 3) 剔除非辞典书中的孤立 OCR 单字母/星号噪声标题（保留有效罗马数字 I/II/III/IV/V/VI/IX/X）
            if stem not in KEEP_SINGLE_LETTER_BOOKS:
                if re.fullmatch(r'[*•·\-—]+', title):
                    continue
                if re.fullmatch(r'[A-HJ-UWYZ]', title):
                    # 单独一个字母（非 I/V/X 罗马数字）通常是 PDF 首字下沉或页眉残留
                    continue
                if stem == "the-complete-works-of-john-locke" and title in ("MR", "DR"):
                    continue
            else:
                if re.fullmatch(r'[*•·\-—]+', title):
                    continue

            # 4) 清理紧邻重复标题（如 ## Preface 紧接 ### Preface）
            h_norm = re.sub(r'[^a-z0-9]+', '', title.lower())
            if h_norm and h_norm == last_h_norm and chars_since_h < 220:
                continue

            # 5) 规范化洛克全集等书中的全大写超长标题（保持易读，但保留短罗马编号如 BOOK I）
            if len(title) >= 28 and title.isupper() and sum(c.isalpha() for c in title) >= 16:
                title = title.title()
                title = re.sub(r'\b(Of|The|And|In|On|To|For|A|An|With|By|From|Or|At|As)\b', lambda mm: mm.group(1).lower(), title)
                title = title[0].upper() + title[1:]
                # 还原罗马数字大写
                title = re.sub(r'\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii|Xiii|Xiv|Xv|Xvi|Xvii|Xviii|Xix|Xx)\b', lambda mm: mm.group(1).upper(), title)

            out.append(f"{lvl_str} {title}")
            last_h_norm = h_norm
            chars_since_h = 0
            continue

        if st:
            chars_since_h += len(st)
        out.append(ln)

    cleaned = re.sub(r'\n{3,}', '\n\n', "\n".join(out)).strip() + "\n"
    EN_OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = EN_OUT_DIR / src_path.name
    out_path.write_text(cleaned, encoding="utf-8")
    return out_path.name, len(cleaned)


def main():
    nd_name, nd_chars = clean_cn_negative_dialectics()
    print(f"[CN] {nd_name}: {nd_chars:,} chars")

    EN_OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in EN_OUT_DIR.glob("*.md"):
        old.unlink()

    en_files = sorted(f for f in EN_SRC_DIR.glob("*.md") if f.name != "00-library-index.md")
    total_en_chars = 0
    for f in en_files:
        name, nchars = clean_english_book(f)
        total_en_chars += nchars
    print(f"[EN] Cleaned {len(en_files)} English/Foreign books -> {EN_OUT_DIR} ({total_en_chars:,} chars)")


if __name__ == "__main__":
    main()
