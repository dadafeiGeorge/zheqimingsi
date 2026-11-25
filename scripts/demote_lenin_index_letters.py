
import re
from pathlib import Path
p=Path('extra-books/列宁哲学笔记.md')
t=p.read_text(encoding='utf-8')
out=[]
n=0
for l in t.splitlines():
    m=re.match(r'^(#{1,6})\s+([A-ZА-ЯШ])\s*$', l)
    if m:
        out.append(m.group(2)); n+=1
    else:
        out.append(l)
p.write_text('\n'.join(out)+'\n', encoding='utf-8')
print('demoted', n)
