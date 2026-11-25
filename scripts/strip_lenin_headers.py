# -*- coding: utf-8 -*-
import re, shutil, os
p = r"D:\咕咕嘎嘎反重力\extra-books\列宁哲学笔记.md"
bak = r"D:\咕咕嘎嘎反重力\extra-books\_backups\_backup_lenin_pre_header_strip.md"
shutil.copy2(p, bak)
txt = open(p, encoding="utf-8").read()
lines = txt.splitlines(keepends=True)
pat1 = re.compile(r"^\*{0,2}\s*\d{1,4}\s*(?:前言|目录|弗·伊·列宁)\s*\*{0,2}\s*$")
pat2 = re.compile(r"^\*{0,2}\s*弗·伊·列宁\s*\d{1,4}\s*\*{0,2}\s*$")
out = []
removed = []
for line in lines:
    s = line.strip().replace("\u3000", " ")
    if pat1.match(s) or pat2.match(s):
        removed.append(s)
        continue
    out.append(line)
new = "".join(out)
open(p, "w", encoding="utf-8", newline="").write(new)
print("removed", len(removed))
for s in removed[:25]: print(repr(s))
print("bytes", len(txt.encode("utf-8")), "->", len(new.encode("utf-8")))
