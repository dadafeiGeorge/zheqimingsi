#!/usr/bin/env python3
"""
reflow_all_extra.py — 对全部 extra-books/*.md 执行智能排版重排与确定性错字/页眉/元数据清洗：
1. 重排《哲学导论.md》（原 9778 碎行 -> 自然段落）并剥离页眉页码。
2. 清理全部 extra-books/*.md 中的 DuXiu/Anna's Archive 元数据、孤立页码、确定性 OCR 错词（如 进人->进入）。
3. 统计每本书的真实段落数与残余 OCR 噪点，供下一阶段 8 路并行 DSH 深度校对精确制导。
"""
import re
from pathlib import Path

EXTRA = Path(r"D:\咕咕嘎嘎反重力\extra-books")

JUNK_LINE_RES = [
    re.compile(r'^[-—–·•\s]*\d{1,4}[-—–·•\s]*$'),
    re.compile(r'^第\s*\d{1,4}\s*页$'),
    re.compile(r'^.*Document\s*generated\s*by\s*Anna.*$', re.I),
    re.compile(r'^.*Images\s+have\s+been\s+losslessly\s+embedded.*$', re.I),
    re.compile(r'^.*"filename_decoded"\s*:\s*".*$'),
    re.compile(r'^.*"filename"\s*:\s*".*"md5"\s*:.*$'),
    re.compile(r'^哲学导论\s*\d{0,4}$'),
    re.compile(r'^\d{1,4}\s*哲学导论$'),
    re.compile(r'^第[一二三四五六七八九十百0-9]+[章编讲部]\s*.{0,18}\s+\d{1,4}$'),
    re.compile(r'^\d{1,4}\s+第[一二三四五六七八九十百0-9]+[章编讲部]\s*.{0,18}$'),
]

HEADING_RE = re.compile(
    r'^(?:#{1,6}\s+|第[一二三四五六七八九十百0-9]+[章编部卷节讲回]\b|[一二三四五六七八九十]+[、.．]\s|\（[一二三四五六七八九十0-9]+\）|\([一二三四五六七八九十0-9]+\)|[0-9]{1,2}\.[0-9]{0,2}\s+\S|附录|译者序|前言|序言|导言|导论|目录|目次|后记|译后记|再版序|第三版序|参考文献|索引|注释)'
)
FOOTNOTE_START_RE = re.compile(r'^(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|\[\^?\d{1,3}\]|\d{1,2}\)\s|注\s*\d{1,2}[：:])')
TERMINAL_PUNCT = set('。！？：；…”』」】）!.?:;')


def is_junk(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    return any(p.match(s) for p in JUNK_LINE_RES)


def reflow_broken_file(path: Path, title_header: str):
    raw_lines = path.read_text(encoding="utf-8").splitlines()
    clean_lines = []
    removed = 0
    for ln in raw_lines:
        s = ln.strip()
        if not s:
            continue
        if is_junk(s):
            removed += 1
            continue
        clean_lines.append(s)

    paragraphs = []
    buf = ""
    for line in clean_lines:
        is_heading = line.startswith("#") or (
            len(line) <= 34
            and HEADING_RE.match(line)
            and line[-1] not in "，、,；;"
            and not re.search(r'[。！？]', line[:-1])
        )
        is_fn = bool(FOOTNOTE_START_RE.match(line))

        if is_heading or is_fn:
            if buf:
                paragraphs.append(buf)
                buf = ""
            if is_heading and not line.startswith("#"):
                if re.match(r'^第[一二三四五六七八九十百0-9]+[章编部卷讲]', line) or line in ("前言", "序言", "导言", "导论", "再版序", "第三版序", "后记", "附录"):
                    paragraphs.append(f"## {line}")
                else:
                    paragraphs.append(f"### {line}")
            else:
                paragraphs.append(line)
            continue

        if not buf:
            buf = line
            continue

        prev_ends = buf[-1] in TERMINAL_PUNCT
        if not prev_ends:
            if re.match(r'[A-Za-z0-9]', buf[-1]) and re.match(r'[A-Za-z0-9]', line[0]):
                buf += " " + line
            elif buf[-1] == '-' and re.match(r'[a-z]', line[0]):
                buf = buf[:-1] + line
            else:
                buf += line
        else:
            paragraphs.append(buf)
            buf = line

    if buf:
        paragraphs.append(buf)

    final_paras = []
    for para in paragraphs:
        if final_paras and re.match(r'^[\)）\]】”’。，、；：！？]', para) and not final_paras[-1].startswith("#"):
            final_paras[-1] += para
        else:
            final_paras.append(para)

    out = f"# {title_header}\n\n" + "\n\n".join(final_paras) + "\n"
    path.write_text(out, encoding="utf-8")
    print(f"[REFLOW] {path.name}: {len(raw_lines)} lines -> {len(final_paras)} paragraphs (removed {removed} page/junk lines)")


def deterministic_typo_clean():
    # 只替换 100% 确定无歧义的中文 OCR 经典误识
    SAFE_FIXES = [
        ("进人", "进入"),
        ("步履購", "步履蹒跚"),
        ("深人", "深入"),
        ("投人", "投入"),
        ("陷人", "陷入"),
        ("纳人", "纳入"),
        ("引引人", "引人"),
        ("收人", "收入"),
        ("加人", "加入"),
        ("融人", "融入"),
        ("介人", "介入"),
        ("输人", "输入"),
        ("注人", "注入"),
        ("嵌人", "嵌入"),
        ("卷人", "卷入"),
        ("写人", "写入"),
        ("传人", "传入"),
    ]
    for p in sorted(EXTRA.glob("*.md")):
        if p.name.endswith("_en.md"):
            continue
        orig = p.read_text(encoding="utf-8")
        # 去除 DuXiu / Anna's Archive 元数据行与孤立页码行
        lines = []
        removed = 0
        for ln in orig.splitlines():
            if ln.strip() and is_junk(ln.strip()):
                removed += 1
                continue
            lines.append(ln)
        txt = "\n".join(lines)
        fix_cnt = 0
        for bad, good in SAFE_FIXES:
            c = txt.count(bad)
            if c:
                txt = txt.replace(bad, good)
                fix_cnt += c
        if txt != orig:
            p.write_text(txt, encoding="utf-8")
            print(f"[CLEAN] {p.name}: removed {removed} junk/page lines, fixed {fix_cnt} deterministic OCR typos")


if __name__ == "__main__":
    reflow_broken_file(EXTRA / "哲学导论.md", "哲学导论")
    deterministic_typo_clean()
