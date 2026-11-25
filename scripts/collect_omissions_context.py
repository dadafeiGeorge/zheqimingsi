#!/usr/bin/env python3
"""
collect_omissions_context.py — 从原版 PDF/EPUB 中精准定位所有明确标注的：
  - 〔原文脱漏〕 / [此处原文有脱漏] / ［原文此处残缺］ / 43. [缺失] / 20100827143457278 / 断词页
  - 《先验唯心论体系》《理性的毁灭》《单子论：新译与导读》《拉康：在精神分析与政治之间》
    《拉康《焦虑》研讨班 X》《美学与政治》《历史哲学》《洛克全集》
导出上下文及原版对应文字/PDF页码供本地 GPU 重扫 & DSH v4.1-flash 补全。
"""
import json
import re
import zipfile
from pathlib import Path
import pymupdf

WORK = Path(r"D:\咕咕嘎嘎反重力\audit-work\gap_repair")
WORK.mkdir(parents=True, exist_ok=True)
SRC_ZH = Path(r"D:\文献库\中文译本")
EXTRA = Path(r"D:\咕咕嘎嘎反重力\extra-books")


def inspect_xianyan():
    p = SRC_ZH / "德国古典哲学" / "先验唯心论体系" / "先验唯心论体系.md"
    txt = p.read_text(encoding="utf-8")
    hits = []
    for m in re.finditer(r"脱漏", txt):
        s = max(0, m.start() - 350)
        e = min(len(txt), m.end() + 350)
        hits.append({"pos": m.start(), "context": txt[s:e]})
    print(f"[先验唯心论体系] hits={len(hits)}")
    return hits


def inspect_lixing():
    p = SRC_ZH / "西马" / "理性的毁灭" / "理性的毁灭.md"
    txt = p.read_text(encoding="utf-8")
    hits = []
    for m in re.finditer(r"[〔\[（(][^〕\]）)]{0,16}脱漏[^〕\]）)]{0,16}[〕\]）)]", txt):
        s = max(0, m.start() - 280)
        e = min(len(txt), m.end() + 280)
        hits.append({"pos": m.start(), "marker": m.group(0), "context": txt[s:e]})
    print(f"[理性的毁灭] hits={len(hits)}")
    return hits


def inspect_lacan_between():
    p = SRC_ZH / "结构主义 后现代" / "拉康" / "托姆希奇与泽夫尼克《拉康：在精神分析与政治之间》" / "托姆希奇与泽夫尼克《拉康：在精神分析与政治之间》中译本.md"
    txt = p.read_text(encoding="utf-8")
    hits = []
    for m in re.finditer(r"残缺|脱漏", txt):
        if "残缺" in m.group(0) and "［原文" not in txt[max(0, m.start() - 10):m.end() + 10]:
            continue
        s = max(0, m.start() - 350)
        e = min(len(txt), m.end() + 350)
        hits.append({"pos": m.start(), "context": txt[s:e]})
    print(f"[拉康：在精神分析与政治之间] hits={len(hits)}")
    return hits


def inspect_lacan_x():
    p = SRC_ZH / "结构主义 后现代" / "拉康" / "拉康《焦虑》研讨班X" / "拉康《焦虑》研讨班X中译本.md"
    txt = p.read_text(encoding="utf-8")
    hits = []
    for m in re.finditer(r"OCR\s*残缺", txt):
        s = max(0, m.start() - 300)
        e = min(len(txt), m.end() + 300)
        hits.append({"pos": m.start(), "context": txt[s:e]})
    print(f"[拉康《焦虑》研讨班X] hits={len(hits)}")
    return hits


def inspect_danzi():
    p = SRC_ZH / "德国古典哲学" / "莱布尼茨单子论：新译与导读" / "单子论：新译与导读.md"
    txt = p.read_text(encoding="utf-8")
    hits = []
    for m in re.finditer(r"脱漏", txt):
        s = max(0, m.start() - 350)
        e = min(len(txt), m.end() + 350)
        hits.append({"pos": m.start(), "context": txt[s:e]})
    print(f"[单子论：新译与导读] hits={len(hits)}")
    return hits


def inspect_locke_missing():
    epub_zh = SRC_ZH / "德国古典哲学" / "洛克全集（中文·校对版）.epub"
    epub_en = Path(r"D:\文献库\德国古典哲学\洛克全集（英文）.epub")
    with zipfile.ZipFile(epub_zh) as zf:
        for nm in zf.namelist():
            if nm.endswith((".xhtml", ".html", ".htm")):
                raw = zf.read(nm).decode("utf-8", errors="ignore")
                if "[缺失]" in raw or "缺失" in raw:
                    for m in re.finditer(r"\[缺失\]", raw):
                        print(f"[洛克全集 ZH {nm}]: {raw[max(0,m.start()-200):m.end()+200]}")
    if epub_en.exists():
        with zipfile.ZipFile(epub_en) as zf:
            for nm in zf.namelist():
                if nm.endswith((".xhtml", ".html", ".htm")):
                    raw = zf.read(nm).decode("utf-8", errors="ignore")
                    if "HIC SECUNDUS" in raw or "43." in raw and "Second Letter" in raw:
                        if "HIC SECUNDUS" in raw:
                            print(f"[洛克全集 EN {nm}]: found HIC SECUNDUS")


def inspect_aesthetics_and_history():
    ap = (EXTRA / "美学与政治.md").read_text(encoding="utf-8")
    idx = ap.find("20100827143457278")
    if idx >= 0:
        print("\n[美学与政治 20100827143457278]:\n", ap[max(0, idx - 300):idx + 600])
    idx2 = ap.find("某种文")
    if idx2 >= 0:
        print("\n[美学与政治 某种文]:\n", ap[max(0, idx2 - 250):idx2 + 500])
    hp = (EXTRA / "历史哲学（全本）.md").read_text(encoding="utf-8")
    idx3 = hp.find("种叙事描绘原始状态时")
    if idx3 >= 0:
        print("\n[历史哲学 种叙事描绘]:\n", hp[max(0, idx3 - 300):idx3 + 400])


def main():
    report = {
        "先验唯心论体系": inspect_xianyan(),
        "理性的毁灭": inspect_lixing(),
        "拉康_政治": inspect_lacan_between(),
        "拉康_焦虑X": inspect_lacan_x(),
        "单子论_新译": inspect_danzi(),
    }
    (WORK / "omissions_context.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    inspect_locke_missing()
    inspect_aesthetics_and_history()


if __name__ == "__main__":
    main()
