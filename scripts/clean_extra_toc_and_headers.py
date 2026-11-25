#!/usr/bin/env python3
"""
clean_extra_toc_and_headers.py — 精准清洗 5 部 extra-books 的原书目录页、页眉重复标题与英文页码行：
  1. 启蒙辩证法.md：剥离 L0001..L0079 扉页/版权/原目录，清除带罗马页码的重复页眉标题
  2. 黑格尔哲学概论.md：保留前言，剥离原目录，将 ### 第一讲..第六讲 升为 ## 并去重
  3. 历史哲学（全本）.md：剥离封面/版权/原目录（至译者导言），清除全部 203 行英文页眉
  4. 自我实现的历程：解读黑格尔《精神现象学》.md：保留序，剥离原目录，清除 80+ 重复页眉 ## 第X章，修补《哲学人门>
  5. 张世英黑格尔哲学五讲.md：清除 135 个每页重复的页眉 ## 第一讲..第五讲（保留真正首现的五讲标题）
"""
import re
from pathlib import Path

EXTRA = Path(r"D:\咕咕嘎嘎反重力\extra-books")


def clean_qimeng():
    p = EXTRA / "启蒙辩证法.md"
    lines = p.read_text(encoding="utf-8").splitlines()
    # 找到正文真正开始的第 2 次 "## 新版序言（1969年）"（无尾随 xi）
    start = 0
    for i, ln in enumerate(lines):
        if re.match(r'^##\s*新版序言（1969年）\s*$', ln.strip()):
            start = i
            break
    if start > 0:
        lines = ["# 启蒙辩证法：哲学断片", ""] + lines[start:]

    out = []
    prev_h = ""
    for ln in lines:
        s = ln.strip()
        # 去除带罗马/阿拉伯页码的页眉标题（如 "## 序言（1944年与1947年） xv" 或 "## 启蒙的概念 12"）
        if s.startswith("## ") and re.search(r'\s+(?:[ivxlcdm]{1,6}|\d{1,3})\s*$', s, re.I):
            continue
        # 去除紧邻重复的同类标题
        if s.startswith("## "):
            norm = re.sub(r'[\s\*\\]+', '', s)
            if norm == prev_h:
                continue
            prev_h = norm
            ln = ln.replace(r'\*', '').replace('*', '')
        out.append(ln)
    p.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"[CLEANED] {p.name}: {len(out)} lines")


def clean_gailun():
    p = EXTRA / "黑格尔哲学概论.md"
    lines = p.read_text(encoding="utf-8").splitlines()
    # 找到前言后原书目录区间：从 "## 第一讲黑格尔哲学体系三部份之间的关系···" 到 "### 第一讲　黑格尔哲学体系三部份之间的关系"
    i_toc = -1
    i_body = -1
    for i, ln in enumerate(lines):
        s = ln.strip()
        if i_toc < 0 and s.startswith("## 第一讲") and ("·" in s or "（2）" in s):
            i_toc = i
        if i_toc >= 0 and re.match(r'^###\s*第一讲\s+黑格尔哲学体系', s):
            i_body = i
            break
    if i_toc >= 0 and i_body > i_toc:
        lines = lines[:i_toc] + lines[i_body:]

    out = []
    for ln in lines:
        s = ln.strip()
        # 跳过孤立的重复短标题 "## 第二讲" / "## 第三讲" / "## 第六讲"
        if re.match(r'^##\s*第[一二三四五六]讲\s*$', s):
            continue
        # 将 "### 第一讲 ..." 提升为 "## 第一讲 ..."
        if re.match(r'^###\s*第[一二三四五六]讲\b', s):
            ln = "## " + s[3:].strip()
        out.append(ln)
    p.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"[CLEANED] {p.name}: {len(out)} lines")


def clean_lishizhexue():
    p = EXTRA / "历史哲学（全本）.md"
    lines = p.read_text(encoding="utf-8").splitlines()
    # 剥离封面/版权/原目录，直达 "## 译者导言"
    start = 0
    for i, ln in enumerate(lines):
        if ln.strip() == "## 译者导言":
            start = i
            break
    if start > 0:
        lines = ["# 历史哲学", ""] + lines[start:]

    out = []
    removed_hdr = 0
    for ln in lines:
        s = ln.strip()
        if re.match(r'^G\.?\s*W\.?\s*F\.?\s*Hegel,\s*The Philosophy of History,?\s*\d*\s*$', s, re.I):
            removed_hdr += 1
            continue
        out.append(ln)
    p.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"[CLEANED] {p.name}: {len(out)} lines (removed {removed_hdr} English running headers)")


def clean_ziwoshixian():
    p = EXTRA / "自我实现的历程：解读黑格尔《精神现象学》.md"
    paras = [x.strip() for x in re.split(r'\n\s*\n', p.read_text(encoding='utf-8')) if x.strip()]
    # 找原书目录（"## 第一章《精神现象学》的“序言”" 到正文第一个无页码的长篇第一章开始）
    # 先定位所有以 "## 第一章《精神现象学》" 开头的段落
    c1_idxs = [i for i, s in enumerate(paras) if s.startswith("## 第一章") and "序言" in s]
    if len(c1_idxs) >= 2:
        # c1_idxs[0] 是原书目录开始，c1_idxs[1] 是正文第一章开始！
        # 检查 c1_idxs[0] 之前是否是“序”，之间全删（但确认中间没有正文段落 > 300字）
        toc_start = c1_idxs[0]
        # 往回退掉可能紧挨的“目录”字样
        if toc_start > 1 and paras[toc_start - 1] in ("目录", "目 录"):
            toc_start -= 1
        # 检查 toc_start..c1_idxs[1] 之间有没有真正的“序”结尾或大段正文
        mid_long = [i for i in range(toc_start, c1_idxs[1]) if len(paras[i]) > 200]
        if not mid_long:
            paras = paras[:toc_start] + paras[c1_idxs[1]:]
        else:
            # 如果中间有正文，只删原目录行（含页码点或目录项集群）
            kept = []
            for i, s in enumerate(paras):
                if toc_start <= i < c1_idxs[1] and (s.startswith("## 第") and (re.search(r'\d+\s*$', s) or len(s) < 55)):
                    if i < mid_long[0]:
                        continue
                kept.append(s)
            paras = kept

    # 清除每页重复的页眉标题：如 "## 第一章", "## 第一章59", 或重复出现的同章长标题
    out = []
    seen_major = set()
    for s in paras:
        s = s.replace("《哲学人门>", "《哲学入门》").replace("哲学人门", "哲学入门")
        # 裸页眉如 "## 第一章" 或 "## 第四章 110"
        if re.match(r'^##\s*第[一二三四五六七八九十]+章\s*\d*\s*$', s):
            continue
        if s.startswith("## "):
            # 清理标题里的错破折号与尾页码
            clean_h = re.sub(r'[·…\.]+\s*\d+\s*$', '', s[3:]).strip()
            clean_h = clean_h.replace('-——', '——').replace('一-', '——').replace('-—', '——').replace('一一', '——')
            m_ch = re.match(r'^(第[一二三四五六七八九十]+章|附录[一二三])', clean_h)
            if m_ch:
                key = m_ch.group(1)
                if key in seen_major:
                    # 这就是重复页眉！彻底跳过
                    continue
                seen_major.add(key)
                s = f"## {clean_h}"
        out.append(s)
    p.write_text("\n\n".join(out) + "\n", encoding="utf-8")
    print(f"[CLEANED] {p.name}: {len(out)} paras, unique chapters={len(seen_major)}")


def clean_wujiang():
    p = EXTRA / "张世英黑格尔哲学五讲.md"
    paras = [x.strip() for x in re.split(r'\n\s*\n', p.read_text(encoding='utf-8')) if x.strip()]
    out = []
    seen_lectures = set()
    for s in paras:
        if s.startswith("## "):
            m = re.match(r'^##\s*(第[一二三四五]讲)', s)
            if m:
                lec = m.group(1)
                if lec in seen_lectures:
                    # 每页页眉重复打印的 "## 第一讲黑格尔哲学体系三部分之间的关系" -> 彻底跳过！
                    continue
                seen_lectures.add(lec)
        out.append(s)
    p.write_text("\n\n".join(out) + "\n", encoding="utf-8")
    print(f"[CLEANED] {p.name}: {len(out)} paras, unique lectures={sorted(seen_lectures)}")


if __name__ == "__main__":
    clean_qimeng()
    clean_gailun()
    clean_lishizhexue()
    clean_ziwoshixian()
    clean_wujiang()
