
import re
from pathlib import Path
src=Path('extra-books/列宁哲学笔记.md')
lines=src.read_text(encoding='utf-8').splitlines()
SUP='⁰¹²³⁴⁵⁶⁷⁸⁹¹²³²³¹'
def strip_marks(s):
    s=re.sub(r'[\*\\'+SUP+r']+$','',s).strip()
    return s
def is_page_header(t):
    s=strip_marks(t)
    if not s: return False
    if re.fullmatch(r'\d{1,3}\s*(?:弗·伊·列宁|前言|目录)', s): return True
    if re.fullmatch(r'弗·伊·列宁\s*\d{1,3}', s): return True
    if re.fullmatch(r'\d{1,3}', s): return True
    if re.fullmatch(r'\d{1,3}\s+.*(?:摘要|札记|前言|目录)', s): return True
    if re.fullmatch(r'.*目录\s*\d{1,3}', s): return True
    return False
def heading_page(t):
    m=re.match(r'^(#{1,6})\s*(.+?)\s*$', t)
    if not m: return False
    h,title=m.group(1),strip_marks(m.group(2))
    if re.fullmatch(r'弗·伊·列宁\s*\d{1,3}', title): return True
    if re.fullmatch(r'\d{1,3}\s*(?:前言|目录)', title): return True
    if re.fullmatch(r'前言\s*\d{1,3}', title): return True
    if re.fullmatch(r'\d{1,3}\s*前言', title): return True
    if re.fullmatch(r'\d{1,3}\s+.*(?:摘要|札记|论辩证法问题)', title): return True
    if re.fullmatch(r'.*……\s*\d{1,3}', title): return True
    if re.fullmatch(r'\d{1,3}\s+.{0,20}', title): return True
    return False
def clean_heading(t):
    m=re.match(r'^(#{1,6})\s*(.+?)\s*$', t)
    if not m: return t
    h,title=m.group(1),strip_marks(m.group(2))
    title=re.sub(r'(?<=[\u4e00-\u9fff》」』”’）)])\s*\d{1,3}$','',title).strip()
    bodyish = (len(title)>=45 and re.search(r'[。！？；]', title)) or ('……' in title and len(title)>=30) or (len(title)>=15 and title.startswith(('“','「','（'))) or ('***' in title) or ('（根据）' in title) or re.fullmatch(r'[\u4e00-\u9fff]+，\d{4}年', title)
    if bodyish:
        return title
    return f"{h} {title}"
start=None; end=None
for idx,l in enumerate(lines):
    if l.strip()=='## 目录': start=idx
    if start is not None and l.strip()=='## 前言': end=idx; break
if start is not None and end is not None:
    lines=lines[:start]+lines[end:]
def drop_block(lines, title):
    out=[]; skip=False
    for l in lines:
        if l.strip()==title: skip=True; continue
        if skip:
            if re.match(r'^#{1,2}\s+', l): skip=False
            else: continue
        out.append(l)
    return out
lines=drop_block(lines,'## 插图')
lines=drop_block(lines,'## 关于转录的说明')
out=[]
for l in lines:
    s=l.strip()
    if not s: out.append(''); continue
    if is_page_header(s): continue
    if heading_page(s): continue
    if re.fullmatch(r'\*\*\d{1,4}\*\*', s): continue
    if re.fullmatch(r'\d{1,4}\s*(?:注释|前言|目录)', s): continue
    out.append(clean_heading(s))
text='\n'.join(out)
text=re.sub(r'## 马克思和恩格斯著\s*\n+', '', text)
text=re.sub(r'## 神圣家族，\s*\n+## 或\s*\n+## 对批判的批判所作的批判\s*\n+## 驳布鲁诺·鲍威尔及其伙伴\s*\n+## 弗里德里希·恩格斯和卡尔·马克思著\s*\n+## 美因河畔法兰克福，文学出版社（约·吕滕）\s*\n+## 1845',
            '> 神圣家族，或对批判的批判所作的批判。驳布鲁诺·鲍威尔及其伙伴。弗里德里希·恩格斯和卡尔·马克思著。美因河畔法兰克福，文学出版社（约·吕滕），1845。', text)
text=re.sub(r'## 第二部分：\s*\n+## 量（数量）', '## 第二部分：量（数量）', text)
text=re.sub(r'## 第三部分：\s*\n+## 度', '## 第三部分：度', text)
text=re.sub(r'(## 第 二 卷：本 质)\s*\n+\1', r'\1', text)
text=re.sub(r'(## 第三卷：主观逻辑或概念学说)\s*\n+\1', r'\1', text)
text=re.sub(r'\n{3,}', '\n\n', text)

MAJOR = set('''前言
《神圣家族》一书摘要
弗·宇伯威格《哲学史纲要》
弗·保尔森《哲学导论》
关于海克尔《生命的奇迹》和《宇宙之谜》书评的札记
关于索邦图书馆中自然科学和哲学书籍的札记
费尔巴哈《宗教本质讲演录》一书摘要
黑格尔《逻辑学》一书摘要
黑格尔著作摘要
拉萨尔著作摘要
论辩证法问题
论辩证法
亚里士多德《形而上学》一书摘要
关于费尔巴哈和黑格尔全集的札记
费尔巴哈《莱布尼茨哲学的阐述、分析和批判》一书摘要
约翰·普伦格博士《马克思与黑格尔》
书籍札记
苏黎世州立图书馆中关于哲学的书籍
关于约翰·普伦格《马克思与黑格尔》一书的评论
关于R. B. 佩里一书的评论
《当代哲学倾向》
关于A. 阿利奥塔一书的评论
《唯心主义对科学的反动》
关于希法亭在《金融资本》中对马赫的观点的意见
书中的批注
阿贝尔·雷伊《现代哲学》
乔治·诺埃尔《黑格尔的逻辑学》
J. 佩兰《物理化学专论。原理》
彼得·格诺夫《费尔巴哈的认识论和形而上学》
保罗·福尔克曼《自然科学的认识论基础》
马克斯·维尔沃恩《生原假说》
弗·丹纳曼《我们的世界图景是怎样产生的》
路德维希·达姆施泰特《自然科学与技术史手册》
拿破仑《思想》
阿图尔·埃里希·哈斯《现代物理学中的希腊精神》
泰奥多尔·利普斯《自然科学与世界观》
斐迪南·拉萨尔《爱非斯的晦涩哲人赫拉克利特的哲学》'''.splitlines())
def normalize_heading(line):
    m=re.match(r'^(#{1,6})\s+(.*)$', line)
    if not m: return line
    title=m.group(2).strip()
    if title.startswith('列宁哲学笔记'): return '# '+title
    if title in MAJOR: return '## '+title
    if title.startswith('§'): return '#### '+title
    return '### '+title
text='\n'.join(normalize_heading(l) if re.match(r'^#{1,6}\s+', l) else l for l in text.splitlines())
Path('audit-work/lenin_clean_dry.md').write_text(text, encoding='utf-8')
heads=[l for l in text.splitlines() if re.match(r'^#{1,6}\s+', l)]
from collections import Counter
print('lines', len(text.splitlines()), 'heads', len(heads), Counter(len(l.split()[0]) for l in heads))
for h in heads:
    if h.startswith('## '): print(h[:160])
