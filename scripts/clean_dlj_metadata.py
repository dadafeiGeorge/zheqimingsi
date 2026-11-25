# -*- coding: utf-8 -*-
import pathlib, shutil

p = pathlib.Path(r"D:/文献库/中文译本/德国古典哲学/黑格尔/【完整全本】黑格尔《大逻辑》汉译精注本.md")
backup = pathlib.Path(r"D:/咕咕嘎嘎反重力/extra-books/_backups/_backup_dlj_pre_metadata_removal.md")
backup.parent.mkdir(parents=True, exist_ok=True)
if not backup.exists():
    shutil.copy2(p, backup)

lines = p.read_text(encoding="utf-8").splitlines()
assert lines[0].startswith("# 黑格尔《大逻辑》"), lines[0]
assert lines[7].startswith("## 第一版序言"), lines[7]
assert lines[14].startswith("第一版序言"), lines[14]

# Drop H1 + bibliographic metadata (1-7) and the wrapper's copy-note/rule (9-14).
new = lines[7:8] + [""] + lines[14:]
for i, l in enumerate(new):
    if l.strip() == "第一版序言 **[13]**":
        new[i] = "### 第一版序言（1812）"
    elif l.strip() == "第二版序言":
        new[i] = "### 第二版序言（1831）"
    elif l.strip() == "导 论":
        new[i] = "### 导论"

p.write_text("\n".join(new) + "\n", encoding="utf-8")
print("lines", len(lines), "->", len(new))
for i, l in enumerate(new[:6], 1):
    print(i, repr(l[:100]))
