#!/usr/bin/env python3
"""
reflow_ocr_books.py — 修复 OCR 转录书籍中的跨行碎段与页眉页脚穿插：
1. 重点修复《论再生产.md》的逐行断段（40.5% 中途断行）及穿插在句子中间的页眉（如 "中文版阿尔都塞著作集序3"、"论再生产 45"、"第X章 ... 128"）。
2. 同步扫描全部 extra-books/*.md，清除孤立页码、DuXiu/Anna's Archive 元数据尾页、常见 OCR 错字/断词连字符。
"""
import re
from pathlib import Path

EXTRA = Path(r"D:\咕咕嘎嘎反重力\extra-books")

PAGE_HEADER_PATTERNS = [
    re.compile(r'^中文版阿尔都塞著作集序\s*\d{0,4}$'),
    re.compile(r'^\d{0,4}\s*论\s*再\s*生\s*产\s*\d{0,4}$'),
    re.compile(r'^\d{1,4}\s*(?:第[一二三四五六七八九十百0-9]+[章编部分节讲]|序言|前言|导言|导论|附录|跋|后记|译后记)\b.{0,24}$'),
    re.compile(r'^(?:第[一二三四五六七八九十百0-9]+[章编部分节讲]|序言|前言|导言|导论|附录|跋|后记|译后记).{0,24}\s*\d{1,4}$'),
    re.compile(r'^[-—–·•\s]*\d{1,4}[-—–·•\s]*$'),
    re.compile(r'^第\s*\d{1,4}\s*页$'),
    re.compile(r'^.*Document\s*generated\s*by\s*Anna.*$', re.I),
    re.compile(r'^.*Images\s+have\s+been\s+losslessly\s+embedded.*$', re.I),
    re.compile(r'^.*"filename_decoded"\s*:\s*".*$'),
]

HEADING_RE = re.compile(
    r'^(?:#{1,6}\s+|第[一二三四五六七八九十百0-9]+[章编部卷节讲回]\b|[一二三四五六七八九十]+[、.．]\s|\（[一二三四五六七八九十0-9]+\）|\([一二三四五六七八九十0-9]+\)|[0-9]{1,2}\.[0-9]{0,2}\s+\S|附录|译者序|前言|序言|导言|导论|目录|目次|后记|译后记|参考文献|索引|注释)'
)
FOOTNOTE_START_RE = re.compile(r'^(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|\[\^?\d{1,3}\]|\d{1,2}\)\s|注\s*\d{1,2}[：:])')
TERMINAL_PUNCT = set('。！？：；…”』」】）!.?:;')


def is_running_header_or_junk(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    for pat in PAGE_HEADER_PATTERNS:
        if pat.match(s):
            return True
    return False


def reflow_lun_zaishengchan():
    p = EXTRA / "论再生产.md"
    raw_lines = p.read_text(encoding="utf-8").splitlines()
    # 1. 过滤页眉页脚与空行，收集逻辑文本行
    clean_lines = []
    removed_headers = 0
    for ln in raw_lines:
        s = ln.strip()
        if not s:
            continue
        if is_running_header_or_junk(s):
            removed_headers += 1
            continue
        # 特殊模式：如 "12 第一章 什么是哲学" 或 "第二章 国家机器 47" 仅在短行出现时视为页眉
        if len(s) <= 26 and re.match(r'^(\d{1,3}\s+[\u4e00-\u9fff]{2,18}|[\u4e00-\u9fff]{2,18}\s*\d{1,3})$', s):
            # 但保留真正的编号条款如 "1 生产方式" 或 "1968 年"
            if not re.match(r'^(?:19|18|20)\d{2}', s) and not re.match(r'^\d{1,2}[、.．]', s):
                removed_headers += 1
                continue
        clean_lines.append(s)

    # 2. 智能重排：合并被 PDF 换行切碎的同一段落
    paragraphs = []
    buf = ""
    for line in clean_lines:
        is_heading = line.startswith("#") or (len(line) <= 32 and HEADING_RE.match(line) and line[-1] not in "，、,")
        is_fn = bool(FOOTNOTE_START_RE.match(line))

        if is_heading or is_fn:
            if buf:
                paragraphs.append(buf)
                buf = ""
            if is_heading and not line.startswith("#"):
                # 标题标准化为 ## 或 ### 以便目录分章清晰
                if re.match(r'^第[一二三四五六七八九十百0-9]+[章编部卷]', line) or line in ("译者序", "中文版阿尔都塞著作集序", "前言", "导言", "附录", "后记", "译后记"):
                    paragraphs.append(f"## {line}")
                else:
                    paragraphs.append(f"### {line}")
            else:
                paragraphs.append(line)
            continue

        if not buf:
            buf = line
            continue

        # 判断 buf 是否应该与当前 line 合并为同一自然段
        prev_ends_sentence = buf[-1] in TERMINAL_PUNCT
        # PDF 每行大约 25~33 个汉字；若上一行明显未满行且以句末标点结尾，说明是自然段尾
        prev_short_end = prev_ends_sentence and (len(line) <= 34) and (
            buf[-1] in "。！？" or buf.endswith("。”") or buf.endswith("！”") or buf.endswith("？”") or buf.endswith("。）")
        )
        # 如果上一行不以句末标点结尾（如汉字、逗号、顿号、分号、左引号、破折号等），必定是中途断行 -> 必须无缝拼接！
        if not prev_ends_sentence:
            if re.match(r'[A-Za-z0-9]', buf[-1]) and re.match(r'[A-Za-z0-9]', line[0]):
                buf += " " + line
            elif buf[-1] == '-' and re.match(r'[a-z]', line[0]):
                buf = buf[:-1] + line
            else:
                buf += line
        else:
            # 上一行以句末标点结尾：如果当前行长度接近满行（或 buf 很长），多数情况可能是段尾换段
            paragraphs.append(buf)
            buf = line

    if buf:
        paragraphs.append(buf)

    # 3. 合并仍被拆成孤立短尾句的段落（如以 ")。" 或 "。" 开头）
    final_paras = []
    for para in paragraphs:
        if final_paras and re.match(r'^[\)）\]】”’。，、；：！？]', para) and not final_paras[-1].startswith("#"):
            final_paras[-1] += para
        else:
            final_paras.append(para)

    out_text = "# 论再生产\n\n" + "\n\n".join(final_paras) + "\n"
    p.write_text(out_text, encoding="utf-8")
    print(f"[REFLOW] 论再生产.md: {len(raw_lines)} raw lines -> {len(final_paras)} clean paragraphs (removed {removed_headers} running headers/page nums)")


def clean_other_extra_books():
    for p in sorted(EXTRA.glob("*.md")):
        if p.name.endswith("_en.md") or p.name == "论再生产.md":
            continue
        orig = p.read_text(encoding="utf-8")
        lines = orig.splitlines()
        cleaned = []
        removed = 0
        for ln in lines:
            s = ln.strip()
            if s and any(pat.match(s) for pat in PAGE_HEADER_PATTERNS[4:]):
                removed += 1
                continue
            cleaned.append(ln)
        new_txt = "\n".join(cleaned)
        # 修复明显的 OCR 常见孤字错识（仅针对已核实的确定错字）
        new_txt = new_txt.replace("步履購", "步履蹒跚")
        if new_txt != orig:
            p.write_text(new_txt, encoding="utf-8")
            print(f"[CLEAN] {p.name}: removed {removed} junk/page lines")


if __name__ == "__main__":
    reflow_lun_zaishengchan()
    clean_other_extra_books()
