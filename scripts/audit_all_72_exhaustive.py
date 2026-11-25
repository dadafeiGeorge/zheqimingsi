#!/usr/bin/env python3
"""
audit_all_72_exhaustive.py — 对全部 72 部书籍（含 56 部中文译本 + 16 部 extra-books）
执行最严苛的四维逐本全面体检：
  1. 无关正文内容（封面/版权/CIP/ISBN/出版广告/电子书制作水印/空白页/原目录/致谢/索引/出版说明）
  2. 缺文少字 / 残余乱码 / OCR 错字 / 残破标签与断句碎片
  3. 单独未译外语引文/句子/标题（涵盖 >=3 词外语块，以及中文段内长未译外语引句）
  4. 目录质量（全部 72 部书的章节数、首尾章节、异常标题、错序、吞章、碎片章）
"""
import json
import re
from pathlib import Path

LIB_ROOT = Path(r"D:\咕咕嘎嘎反重力\library-data")

NON_BODY_PAT = re.compile(
    r"(图书在版编目|CIP\s*数据|ISBN\s*[\d\-X]{8,}|版权所有[，,、\s]*侵权必究|印装质量问题|"
    r"定价[：:]\s*\d|印\s*张[：:\s]*\d|开\s*本[：:\s]*\d|发行所|新华书店经销|出版发行[：:]|"
    r"All rights reserved|Library of Congress|Printed in the United States|Delphi Classics|"
    r"Cultural Memory in the Present|Images\s*have\s*been|Anna[\'\u2019]?s\s*Archive|SS号=|"
    r"此页故意留白|本页有意留白|intentionally left blank|微信公众号|关注我们|免费下载|扫描版|"
    r"电子书制作|校对整理|更多电子书|版权页|扉页|封底|责任编辑[：:\s]|策划编辑|装帧设计|封面设计|"
    r"为多年使用而设计的多佛版|北京大学哲学教材系列|当下的文化记忆丛书)",
    re.I,
)

NON_BODY_TITLE_PAT = re.compile(
    r"(目录|目次|封面|扉页|封底|版权|出版说明|编写说明|编辑说明|凡例|致谢|鸣谢|缩写|简写表|"
    r"插图|索引|作者简介|译者简介|内容简介|丛书|广告|contents|copyright|index|acknowledg|abbreviations|series)",
    re.I,
)

OCR_BAD_PAT = re.compile(
    r"(进人|深人|陷人|纳人|投人|收人|加人|融人|排尿|黑恪尔|情神现象学|企崇|企第|认填|述坪|邂辑|"
    r"艳对|水乎|弓l者|器格尔|Vovolis|Goitlob|\ufffd|<a\s+id=|<sup|\]\(#h|\\\*"
    r"|《[^《》\n]{1,24}>|<[^《》\n]{1,24}》)"
)

CJK_RE = re.compile(r"[\u4e00-\u9fff]")
WORD_RE = re.compile(r"[A-Za-zÀ-ÿα-ωΑ-Ωἀ-ῼ]{2,}")
BIB_CH_RE = re.compile(r"(参考书目|参考文献|引用文献|书目|索引|进一步阅读|拉康著作|米勒著作|弗洛伊德著作|网络文献|延伸阅读|bibliography|references|index)", re.I)
BIB_LINE_RE = re.compile(r"\b(Press|University|Verlag|ed\.|eds\.|trans\.|pp\.|vol\.|ISBN|Routledge|Cambridge|Oxford|Princeton|Chicago|Stuttgart|Frankfurt|Paris|Seuil|Suhrkamp|Norton|London|New York|Boston|Leipzig|Berlin|Continuum|Polity|Bloomsbury|http://|https://|www\.)\b", re.I)


def main():
    cat = json.loads((LIB_ROOT / "catalog.json").read_text(encoding="utf-8"))
    books = cat["books"]
    print(f"=== EXHAUSTIVE 4-PILLAR AUDIT OF ALL {len(books)} BOOKS ===\n")

    p1_books = []
    p2_books = []
    p3_books = []
    p4_issues = []

    for b in books:
        bid = b["id"]
        title = b["title"]
        cat_name = b["category"]
        is_ref = (cat_name == "辞典与术语工具")
        bdir = LIB_ROOT / "books" / bid

        # Gather all chapters in order
        chapters = []
        for pf in sorted(bdir.glob("p_*.json"), key=lambda x: int(x.stem.split("_")[1])):
            cdata = json.loads(pf.read_text(encoding="utf-8"))
            for k in sorted(cdata.keys(), key=lambda x: int(x)):
                chapters.append((int(k), cdata[k]))

        p1_hits = []
        p2_hits = []
        p3_hits = []
        ch_lens = []
        bad_titles = []

        for ch_idx, ch in chapters:
            ct = ch.get("t", "")
            blks = ch.get("b", [])
            clen = sum(len(x.get("t", "")) for x in blks)
            ch_lens.append((ch_idx, ct, clen))

            # Pillar 1: non-body chapter title
            if not is_ref and NON_BODY_TITLE_PAT.search(ct):
                p1_hits.append(f"CH[{ch_idx}] title='{ct}' ({clen}c)")

            # Pillar 4: suspicious chapter titles
            if len(ct) > 48 or re.search(r'([。！？]{1}|[·…\.]{3,}\s*\d*$|/\s*\d+$|^\d{1,3}$|^[（(]\d+[）)]$|^\s*$)', ct):
                bad_titles.append(f"CH[{ch_idx}]='{ct[:55]}'({clen}c)")
            elif re.match(r'^第[零一二三四五六七八九十百0-9]+[章节讲篇部].*(?:就不可能|所谈|只有|在这些|第一自然段|第二自然段)', ct):
                bad_titles.append(f"CH[{ch_idx}]='{ct[:55]}'({clen}c)")

            for bi, blk in enumerate(blks):
                t = blk.get("t", "").strip()
                if not t:
                    continue

                # Pillar 1: inline non-body text
                m1 = NON_BODY_PAT.search(t)
                if m1:
                    p1_hits.append(f"CH[{ch_idx}]({ct[:18]}) b[{bi}] match='{m1.group(0)}': {t[:65]}")

                # Pillar 2: OCR typos / broken tags / garbled chars
                m2 = OCR_BAD_PAT.search(t)
                if m2:
                    p2_hits.append(f"CH[{ch_idx}] b[{bi}]='{m2.group(0)}': {t[:65]}")

                # Pillar 3: standalone untranslated foreign block (>=4 words, low CJK, not followed by 【译注】)
                if not is_ref and not BIB_CH_RE.search(ct) and blk.get("y") != "r":
                    nxt_t = blks[bi + 1].get("t", "") if bi + 1 < len(blks) else ""
                    if "【译注】" not in t and "【译注】" not in nxt_t:
                        words = WORD_RE.findall(t)
                        cjk = len(CJK_RE.findall(t))
                        if len(words) >= 4 and cjk < len(words) * 0.35:
                            if not (BIB_LINE_RE.search(t) and len(words) < 35):
                                if not (re.search(r"\(\d{4}(?:[–\-]\d{2,4})?\)", t) and len(words) < 25):
                                    p3_hits.append(f"CH[{ch_idx}]({ct[:16]}) b[{bi}] ({len(words)}w): {t[:75]}")

        if p1_hits:
            p1_books.append((title, len(p1_hits), p1_hits[:6]))
        if p2_hits:
            p2_books.append((title, len(p2_hits), p2_hits[:5]))
        if p3_hits:
            p3_books.append((title, len(p3_hits), p3_hits[:5]))

        # Pillar 4 structural checks
        total_c = sum(x[2] for x in ch_lens)
        n_ch = len(ch_lens)
        tiny_ch = sum(1 for x in ch_lens if x[2] < 80)
        dup_titles = len(ch_lens) - len(set(x[1] for x in ch_lens))
        flags = []
        if n_ch <= 2 and total_c > 25000:
            flags.append(f"TOO_FEW_CH({n_ch}ch/{total_c}c)")
        if n_ch > 180 and not is_ref:
            flags.append(f"TOO_MANY_CH({n_ch}ch)")
        if tiny_ch >= 5 and tiny_ch / max(1, n_ch) > 0.25:
            flags.append(f"MANY_TINY({tiny_ch}/{n_ch})")
        if bad_titles:
            flags.append(f"BAD_TITLES({len(bad_titles)}): {bad_titles[:3]}")
        if dup_titles >= 4 and not is_ref:
            flags.append(f"DUP_TITLES({dup_titles})")
        if flags:
            p4_issues.append((title, n_ch, total_c, flags, [x[1] for x in ch_lens[:4]]))

    print(f"================ PILLAR 1: NON-BODY JUNK ({len(p1_books)}/72 books) ================")
    for title, cnt, samples in sorted(p1_books, key=lambda x: -x[1]):
        print(f"  [{cnt:3d}] {title}")
        for s in samples[:4]:
            print(f"        {s}")

    print(f"\n================ PILLAR 2: OCR TYPOS / BROKEN TAGS ({len(p2_books)}/72 books) ================")
    for title, cnt, samples in sorted(p2_books, key=lambda x: -x[1]):
        print(f"  [{cnt:3d}] {title}")
        for s in samples[:3]:
            print(f"        {s}")

    print(f"\n================ PILLAR 3: UNTRANSLATED STANDALONE FOREIGN ({len(p3_books)}/72 books) ================")
    for title, cnt, samples in sorted(p3_books, key=lambda x: -x[1]):
        print(f"  [{cnt:3d}] {title}")
        for s in samples[:4]:
            print(f"        {s}")

    print(f"\n================ PILLAR 4: TOC ANOMALIES ({len(p4_issues)}/72 books) ================")
    for title, n_ch, tot, flags, head_t in p4_issues:
        print(f"  {title} ({n_ch}ch, {tot:,}c) -> {' | '.join(flags)}")
        print(f"        first chapters: {head_t}")


if __name__ == "__main__":
    main()
