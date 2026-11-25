
import re, shutil
from pathlib import Path
src=Path('extra-books/列宁哲学笔记.md')
dry=Path('audit-work/lenin_clean_dry.md')
def cjk(s): return len(re.findall(r'[\u4e00-\u9fff]', s))
a=src.read_text(encoding='utf-8'); b=dry.read_text(encoding='utf-8')
print('before cjk', cjk(a), 'after cjk', cjk(b), 'delta', cjk(b)-cjk(a))
print('before lines', len(a.splitlines()), 'after lines', len(b.splitlines()))
bak=Path('extra-books/_backups/_backup_lenin_pre_clean.md')
bak.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(src, bak)
src.write_text(b, encoding='utf-8')
print('backup', bak, bak.stat().st_size, 'written', src.stat().st_size)
