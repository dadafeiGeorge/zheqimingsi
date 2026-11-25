# -*- coding: utf-8 -*-
import pathlib, shutil, re
p = pathlib.Path(r"D:/咕咕嘎嘎反重力/extra-books/黑格尔哲学（斯退士）.md")
raw = p.read_text(encoding="utf-8")
lines = raw.splitlines()
start = None
for i, ln in enumerate(lines):
    if ln.strip() == "## 序言":
        start = i
        break
if start is None:
    raise SystemExit("no 序言 heading")
out = lines[start:]
changed = 0
for i, ln in enumerate(out):
    if ln.strip() == "C. 亚里士多德与黑格尔":
        out[i] = "### C. 亚里士多德与黑格尔"
        changed += 1
    elif ln.strip() == "## D. 结果":
        out[i] = "### D. 结果"
        changed += 1
backup = pathlib.Path(r"D:/咕咕嘎嘎反重力/extra-books/_backups/_backup_stace_pre_frontfix.md")
backup.parent.mkdir(parents=True, exist_ok=True)
if not backup.exists():
    shutil.copy2(p, backup)
p.write_text("\n".join(out) + "\n", encoding="utf-8")
print("start_line", start + 1, "removed", start, "heading_changes", changed, "lines", len(out))
print("first", repr(out[0]), "second", repr(out[1]) if len(out) > 1 else "")
print("C?", sum(1 for x in out if x.strip() == "### C. 亚里士多德与黑格尔"))
print("D?", sum(1 for x in out if x.strip() == "### D. 结果"))
