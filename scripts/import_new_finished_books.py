#!/usr/bin/env python3
r"""
import_new_finished_books.py — 将 d:\文献库\新待翻译转写内容\_成品\{中文译本,中文原著}
中的所有新增典籍（含拆分《张世英文集（全十册）》新增/扩充卷册）进行深度排版清洗、
乱码修复、页眉剔除与分级目录重构，输出至 d:\咕咕嘎嘎反重力\new-books\ 供 build_library.py 统一打包。
"""
import os
import re
from pathlib import Path

SRC_TRANS = Path(r"D:\文献库\新待翻译转写内容\_成品\中文译本")
SRC_ORIG = Path(r"D:\文献库\新待翻译转写内容\_成品\中文原著")
OUT_DIR = Path(r"D:\咕咕嘎嘎反重力\new-books")


def strip_front_toc_and_anchors(text: str) -> str:
    """移除 _成品 自动化生成的顶部 '# 书名 / > 作者 / ## 目录 / ---' 与所有 <a id="h..."></a> 锚点。"""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r'(?m)^\s*<a\s+id="[^"]*"\s*>\s*</a>\s*$', "", text)
    text = re.sub(r'<a\s+id="[^"]*"\s*>\s*</a>', "", text)
    lines = text.splitlines()
    # 找到前 300 行内的首条 '---' 分隔线（如果前面有 '## 目录'）
    has_front_toc = any(re.match(r'^##\s+目录\s*$', l.strip()) for l in lines[:25])
    if has_front_toc:
        for idx in range(min(len(lines), 4000)):
            if lines[idx].strip() == "---":
                lines = lines[idx + 1 :]
                break
    return "\n".join(lines).strip()


def common_cleanup(text: str) -> str:
    """通用排版与标点清洗：消除多余空行、全角孤立噪声、规范标题空格与引号。"""
    text = re.sub(r'(?m)^\s*<a\b[^>]*>\s*</a>\s*$', '', text)
    # 清除常见出版版权、ISBN、CIP、扫码广告行
    text = re.sub(r'(?im)^.*(?:图书在版编目[（(]CIP[）)]数据|中国版本图书馆CIP数据核字|ISBN\s*[:：]?\s*[\d\-–X]{8,}).*$', '', text)
    text = re.sub(r'(?im)^.*(?:未经(?:出版者|作者|出版社)?书面许可|All rights reserved|版权所有|State University Plaza|印\s*张\s*\d+|开\s*本\s*\d+|定\s*价\s*[:：]).*$', '', text)
    # 合并多余空行
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip() + "\n"


def tidy_cn_heading(title: str) -> str:
    """规范化中文标题中的章节序号与正文间距，去除尾部标点与角标。"""
    t = title.strip()
    t = re.sub(r'\s+', ' ', t)
    t = re.sub(r'^(第[零一二三四五六七八九十百千万0-9]+部)\s+分', r'\1分', t)
    t = re.sub(r'^(第[零一二三四五六七八九十百千万0-9]+(?:部分|[篇部编卷章讲回节]))(?=[^\s：:·—\-\(（])', r'\1 ', t)
    t = re.sub(r'\[\d{1,2}\]\s*$', '', t)
    t = re.sub(r'\s*\(\d{1,2}\)\s*$', '', t)
    t = re.sub(r'[。，,；;]+$', '', t)
    return t.strip()


def clean_nature_philosophy(raw: str) -> str:
    """黑格尔《自然哲学》：剔除重复页眉（自然哲学导论/力学/有机界/动物有机体等），重建篇-章-节三级目录。"""
    s = strip_front_toc_and_anchors(raw)
    lines = s.splitlines()
    out = []
    seen_major = set()
    running_headers = {
        "自然哲学导论", "力学", "有限力学", "空间与时间", "绝对力学",
        "有机界", "植物本性", "动物有机体", "物理学", "普遍个体性的物理学",
        "特殊个体性的物理学", "整体个体性的物理学", "地质的自然", "植物的自然",
    }
    first_seen_ok = {
        "普遍个体性的物理学", "特殊个体性的物理学", "整体个体性的物理学",
        "地质的自然", "植物的自然", "动物有机体",
    }

    for ln in lines:
        st = ln.strip()
        m = re.match(r'^#{2,6}\s+(.+)$', st)
        if m:
            h = re.sub(r'\s+', ' ', m.group(1)).strip()
            h_norm = re.sub(r'[\s　]+', '', h)
            # 重复页眉直接丢弃
            if h_norm in running_headers:
                if h_norm in first_seen_ok and h_norm not in seen_major:
                    seen_major.add(h_norm)
                    if h_norm == "动物有机体":
                        out.append("## 第三篇 有机物理学 · 动物有机体")
                    elif h_norm == "地质的自然":
                        out.append("## 第三篇 有机物理学 · 地质的自然")
                    elif h_norm == "植物的自然":
                        out.append("## 第三篇 有机物理学 · 植物的自然")
                    else:
                        out.append(f"### {h}")
                continue
            if h_norm == "导论":
                out.append("## 导论")
            elif h_norm.startswith("第二篇"):
                out.append("## 第二篇 物理学")
            elif h_norm.startswith("第一篇"):
                out.append("## 第一篇 力学")
            elif h_norm.startswith("第三篇"):
                out.append("## 第三篇 有机物理学")
            elif re.match(r'^[甲乙丙]、', h):
                if h.startswith("甲、空间与时间") and "第一篇" not in seen_major:
                    seen_major.add("第一篇")
                    out.append("## 第一篇 力学")
                out.append(f"## {h}" if "空间与时间" in h or "物质与运动" in h else f"### {h}")
            elif re.match(r'^[ABC]\.\s*', h):
                if "绝对力学" in h:
                    out.append("## 丙、绝对力学")
                else:
                    out.append(f"### {h}")
            else:
                out.append(f"### {h}")
            continue
        out.append(ln)
    return common_cleanup("\n".join(out))


def clean_marx_hegel_right(raw: str) -> str:
    """马克思《黑格尔法哲学批判》：剔除内嵌目录列表与书末年表，按原著五大板块精准分章。"""
    s = strip_front_toc_and_anchors(raw)
    lines = s.splitlines()
    # 找到正文起始（卡尔·马克思《德法年鉴》1844年2月，或 L85 附近）
    body_start = 0
    for i, ln in enumerate(lines[:150]):
        if "《德法年鉴》" in ln or "对宗教的批判" in ln:
            body_start = max(0, i - 1)
            break
    lines = lines[body_start:]

    out = ["## 导言（1844）", ""]
    inserted = set()
    stop_at_biblio = False

    for ln in lines:
        st = ln.strip()
        # 剔除末尾无关的马克思全集年代索引目录（1840年代..1890年代）
        if re.match(r'^#{2,4}\s*(?:选集|1840年代)\s*$', st):
            stop_at_biblio = True
        if stop_at_biblio:
            continue

        if re.match(r'^§\s*261\b', st) and "p1" not in inserted:
            inserted.add("p1")
            out.append("\n## 第一部分 国家（§§ 261—271）\n")
        elif re.match(r'^§\s*27[23]\b', st) and "p2" not in inserted:
            inserted.add("p2")
            out.append("\n## 第二部分 宪制与王权（§§ 272—286）\n")
        elif re.match(r'^§\s*28[789]\b', st) and "p3" not in inserted:
            inserted.add("p3")
            out.append("\n## 第三部分 行政权与官僚机构（§§ 287—297）\n")
        elif re.match(r'^§\s*29[89]\b', st) and "p4" not in inserted:
            inserted.add("p4")
            out.append("\n## 第四部分 立法权（§§ 298—303）\n")
        elif re.match(r'^§\s*304\b', st) and "p5" not in inserted:
            inserted.add("p5")
            out.append("\n## 第五部分 等级、私有财产与长子继承权（§§ 304—307）\n")
        elif re.match(r'^§\s*308\b', st) and "p6" not in inserted:
            inserted.add("p6")
            out.append("\n## 第六部分 市民社会、代表制与等级要素（§§ 308—313）\n")
        elif re.match(r'^##\s+黑格尔法哲学\s*$', st):
            out.append("\n## 附录 黑格尔法哲学分析性目录\n")
            continue
        elif re.match(r'^###\s+分析性目录\s*$', st):
            continue

        out.append(ln)
    return common_cleanup("\n".join(out))


def clean_hegel_logic_essays(raw: str) -> str:
    """乔治·迪乔瓦尼 编《黑格尔逻辑学论文集》：规范 6-10 级 # 标题为清晰的论文分章。"""
    s = strip_front_toc_and_anchors(raw)
    lines = s.splitlines()
    # 跳过开头版权与纸书目录页，直接从 #### 序言 开始
    start_idx = 0
    for i, ln in enumerate(lines[:100]):
        if re.match(r'^#{2,6}\s*序言\s*$', ln.strip()):
            start_idx = i
            break
    lines = lines[start_idx:]

    out = []
    i = 0
    n = len(lines)
    while i < n:
        st = lines[i].strip()
        m = re.match(r'^(#{2,10})\s+(.+)$', st)
        if m:
            title = m.group(2).strip()
            # 合并跨行拆分的论文主副标题（如 "在有与本质之间：" + "反思的逻辑伪装"）
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            if j < n and re.match(r'^#{2,10}\s+', lines[j].strip()) and (title.endswith(("：", ":", "。")) or "模态的方式" in title):
                sub = re.sub(r'^#{2,10}\s+', '', lines[j].strip()).strip()
                title = title.rstrip("。") + (" " if not title.endswith(("：", ":")) else "") + sub
                i = j
                # 检查是否还有第三行碎片（如 "消失之间"）
                k = i + 1
                while k < n and not lines[k].strip():
                    k += 1
                if k < n and re.match(r'^#{2,10}\s+消失之间', lines[k].strip()):
                    title = title + "：介于耶拿的缺席与柏林的消失之间"
                    i = k
            if re.match(r'^[1-9]\.\s+', title):
                out.append(f"### {title}")
            else:
                out.append(f"## {title}")
            i += 1
            continue
        # 修补少量漏标的小节标题（如 "1. 开端的问题与自身扬弃的理念"）
        if re.match(r'^[1-9l]\.\s+[\u4e00-\u9fff「《“]', st) and len(st) <= 32 and not st.endswith(("。", "，", "；")):
            fixed = re.sub(r'^l\.', '1.', st)
            out.append(f"### {fixed}")
            i += 1
            continue
        out.append(lines[i])
        i += 1
    return common_cleanup("\n".join(out))


def clean_stace_greek(raw: str) -> str:
    """W. T. 斯退士《希腊哲学批评史》：将 #### 第X章 与紧随其后的章名合并为规范 ## 第X章 标题。"""
    s = strip_front_toc_and_anchors(raw)
    lines = s.splitlines()
    out = []
    i = 0
    n = len(lines)
    while i < n:
        st = lines[i].strip()
        m = re.match(r'^#{2,6}\s+(前言|第[一二三四五六七八九十]+章)\s*$', st)
        if m:
            head = m.group(1)
            if head == "前言":
                out.append("## 前言")
                i += 1
                continue
            # 寻找下一个非空行作为章名
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            if j < n:
                sub = lines[j].strip().rstrip("。.")
                if 2 <= len(sub) <= 28 and not re.search(r'[，；：]', sub):
                    out.append(f"## {head} {sub}")
                    i = j + 1
                    continue
            out.append(f"## {head}")
            i += 1
            continue
        out.append(lines[i])
        i += 1
    return common_cleanup("\n".join(out))


def clean_stace_religion(raw: str) -> str:
    """W. T. 斯退士《宗教与现代心灵》：去除利物浦图书馆印章，合并全部 12 章的章号与标题。"""
    s = strip_front_toc_and_anchors(raw)
    lines = s.splitlines()
    # 跳过开头图书馆印章与出版页，直达 ##### 序言
    start_idx = 0
    for i, ln in enumerate(lines[:60]):
        if re.match(r'^#{2,6}\s*序言\s*$', ln.strip()):
            start_idx = i
            break
    lines = lines[start_idx:]

    out = []
    i = 0
    n = len(lines)
    ch_counter = 0
    while i < n:
        st = lines[i].strip()
        m = re.match(r'^#{2,10}\s+(.+)$', st)
        if m:
            h = m.group(1).strip()
            if h == "序言":
                out.append("## 序言")
                i += 1
                continue
            # 寻找下一非空行
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            nxt = lines[j].strip() if j < n else ""
            nxt_clean = re.sub(r'^#{2,10}\s+', '', nxt).strip()

            # 情形 A: "##### 第六章" + "### 道德方面的后果"
            if re.match(r'^第[一二三四五六七八九十]+章$', h) and j < n and re.match(r'^#{2,10}\s+', nxt):
                ch_counter += 1
                out.append(f"## {h} {nxt_clean}")
                i = j + 1
                continue
            # 情形 B: "## 自然主义" + "### 第八章" 或 "##### 中世纪的宇宙图景" + "第一章"
            if re.match(r'^第[一二三四五六七八九十]+章$', nxt_clean):
                ch_counter += 1
                # 第 10 章后出现第二部/第三部重编号“第二章”时改为“第十一章”避免重名
                ch_label = nxt_clean
                if ch_counter >= 11 and nxt_clean == "第二章":
                    ch_label = "第十一章"
                elif ch_counter >= 12 and nxt_clean == "第三章":
                    ch_label = "第十二章"
                if h == "上帝与世界的目的是":
                    h = "上帝与世界的目的"
                out.append(f"## {ch_label} {h}")
                i = j + 1
                continue
            out.append(f"## {h}")
            i += 1
            continue
        out.append(lines[i])
        i += 1
    return common_cleanup("\n".join(out))


def clean_stace_destiny(raw: str) -> str:
    """W. T. 斯退士《西方人的命运》：去除内嵌目录，精准合并部名、章号与章题。"""
    s = strip_front_toc_and_anchors(raw)
    lines = s.splitlines()
    # 跳过开头版权页，直达 序言，并在 ### 目录 到 ### 第一部 之间剔除内嵌目录
    start_idx = 0
    for i, ln in enumerate(lines[:80]):
        if re.match(r'^#{2,6}\s*序言\s*$', ln.strip()):
            start_idx = i
            break
    lines = lines[start_idx:]

    out = []
    i = 0
    n = len(lines)
    in_inner_toc = False
    while i < n:
        st = lines[i].strip()
        if re.match(r'^#{2,6}\s*目录\s*$', st):
            in_inner_toc = True
            i += 1
            continue
        if in_inner_toc:
            if re.match(r'^#{2,6}\s*第一部\s*$', st):
                in_inner_toc = False
            else:
                i += 1
                continue

        m = re.match(r'^#{2,6}\s+(.+)$', st)
        if m:
            h = m.group(1).strip()
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            nxt = lines[j].strip() if j < n else ""
            m2 = re.match(r'^#{2,6}\s+(.+)$', nxt)
            h2 = m2.group(1).strip() if m2 else ""

            if re.match(r'^第[一二三]部$', h) and h2:
                out.append(f"## {h} {h2}")
                i = j + 1
                continue
            if re.match(r'^第[一二三四五六七八九十]+章$', h) and h2:
                out.append(f"## {h} {h2}")
                i = j + 1
                continue
            if h2 and re.match(r'^第[一二三四五六七八九十]+章$', h2):
                out.append(f"## {h2} {h}")
                i = j + 1
                continue
            if h == "序言":
                out.append("## 序言")
            else:
                out.append(f"### {h}")
            i += 1
            continue
        out.append(lines[i])
        i += 1
    return common_cleanup("\n".join(out))


def clean_dk_philosophy(raw: str) -> str:
    """DK《哲学，很简单》：将 137 个小词条按哲学主题归入清晰的 7 大篇目章节，去除尾部纯索引。"""
    s = strip_front_toc_and_anchors(raw)
    lines = s.splitlines()
    # 按 DK 原书编排节点自动插入一级哲学主题篇名，使目录既层次分明又保留全部 137 个词条小节
    part_anchors = {
        "放弃神话": "## 第一篇 古代与中世纪哲学：探寻世界本源",
        "钟表世界": "## 第二篇 近代哲学：理性主义与经验主义",
        "我们的心灵塑造世界": "## 第三篇 德国古典与十九世纪哲学",
        "我们是什么意思？": "## 第四篇 语言哲学与分析传统",
        "意识是有意向性的": "## 第五篇 现象学、存在主义与诠释学",
        "正义是什么？": "## 第六篇 伦理学、政治与社会哲学",
        "什么是艺术？": "## 第七篇 美学、科学与心灵哲学",
    }
    out = []
    for ln in lines:
        st = ln.strip()
        if re.match(r'^##\s*索引\s*$', st):
            break
        m = re.match(r'^###\s+(.+)$', st)
        if m:
            t = m.group(1).strip()
            if t in part_anchors:
                out.append(part_anchors[t])
                out.append("")
            out.append(f"### {t}")
            continue
        out.append(ln)
    return common_cleanup("\n".join(out))


def clean_liberation_psych(raw: str) -> str:
    """马丁-巴罗《解放心理学文集》与马勒布《去意识形态化》：清爽标准化目录。"""
    s = strip_front_toc_and_anchors(raw)
    lines = s.splitlines()
    out = []
    for ln in lines:
        st = ln.strip()
        m = re.match(r'^(#{2,4})\s+(.+)$', st)
        if m:
            lvl, title = m.group(1), m.group(2).strip()
            title = re.sub(r'\s*[｜|]\s*', ' · ', title)
            if title in ("前言", "翻译说明", "导论") and lvl == "###":
                lvl = "##"
            out.append(f"{lvl} {title}")
            continue
        out.append(ln)
    return common_cleanup("\n".join(out))


def clean_being_and_time(raw: str) -> str:
    """张汝伦《〈存在与时间〉释义》：去除重复内嵌目录、规范章节标题间距与角标。"""
    s = strip_front_toc_and_anchors(raw)
    lines = s.splitlines()
    out = []
    skip_toc = False
    for ln in lines:
        st = ln.strip()
        if re.match(r'^#{2,3}\s*目录\s*$', st):
            skip_toc = True
            continue
        if skip_toc:
            if re.match(r'^#{2,3}\s*(引言|发凡|导论)', st):
                skip_toc = False
            else:
                continue
        m = re.match(r'^(#{2,4})\s+(.+)$', st)
        if m:
            lvl, title = m.group(1), tidy_cn_heading(m.group(2))
            if title == "释义" and lvl == "##":
                continue
            if re.match(r'^第[一二三四五六七八九十]+章\s', title) or title.startswith(("引言", "发凡", "破题", "结语", "征引书目", "导论", "《存在与时间》的缘起")):
                lvl = "##"
            elif re.match(r'^第[一二三]部\s|^第[一二三]篇\s', title):
                lvl = "##"
            out.append(f"{lvl} {title}")
            continue
        out.append(ln)
    return common_cleanup("\n".join(out))


def clean_heidegger_german_idealism(raw: str) -> str:
    """海德格尔《德国观念论与当前哲学的困境》：转换 [图片：编者注] 为规范注释、剔除版权页与重复页眉、合并后记标题。"""
    s = strip_front_toc_and_anchors(raw)
    # 原文中的 [图片：...] 实为电子书将脚注弹窗误转成的文本，转为标准行内编者注保留全部学术内容
    s = re.sub(r'\[图片[：:]\s*([^\]]+)\]', r'（注：\1）', s)
    lines = s.splitlines()
    out = []
    skip_copyright = False
    i = 0
    n = len(lines)
    while i < n:
        st = lines[i].strip()
        if re.match(r'^##\s*版权信息\s*$', st):
            skip_copyright = True
            i += 1
            continue
        if skip_copyright:
            if re.match(r'^##\s+', st):
                skip_copyright = False
            else:
                i += 1
                continue

        # 剔除重复页眉（### 费希特 / ### 谢林）
        if re.match(r'^###\s*(?:费希特|谢林|导论)\s*$', st):
            i += 1
            continue

        # 合并 "## 确定性与有限性" + "## ——论海德格尔的德国观念论研究（代译后记）"
        if re.match(r'^##\s+确定性与有限性\s*$', st):
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            if j < n and "代译后记" in lines[j]:
                sub = re.sub(r'^##\s+', '', lines[j].strip())
                out.append(f"## 确定性与有限性{sub}")
                i = j + 1
                continue

        # 提升正文中漏标的 "第一章" / "第二章" / "第三章"
        if re.match(r'^第[一二三]章$', st):
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            nxt = lines[j].strip() if j < n else ""
            if nxt and len(nxt) < 42 and not nxt.endswith(("。", "，")):
                out.append(f"## {st} {nxt}")
                i = j + 1
                continue
            out.append(f"## {st}")
            i += 1
            continue

        m = re.match(r'^(#{2,4})\s+(.+)$', st)
        if m:
            lvl, title = m.group(1), m.group(2).strip()
            # 清理标题中被误粘进来的长编者注
            if title.startswith("导论") and "（注：" in title:
                note_m = re.search(r'（注：[^）]+）', title)
                out.append("## 导论")
                if note_m:
                    out.append("")
                    out.append(note_m.group(0))
                i += 1
                continue
            out.append(f"{lvl} {tidy_cn_heading(title)}")
            i += 1
            continue

        out.append(lines[i])
        i += 1
    return common_cleanup("\n".join(out))


def clean_modern_west_15(raw: str) -> str:
    """张汝伦《现代西方哲学十五讲》：剔除封面与版权信息，规范十五讲主目录。"""
    s = strip_front_toc_and_anchors(raw)
    lines = s.splitlines()
    out = []
    skip_front = False
    for ln in lines:
        st = ln.strip()
        if re.match(r'^##\s*(封面|版权信息)\s*$', st):
            skip_front = True
            continue
        if skip_front:
            if re.match(r'^##\s+', st):
                skip_front = False
            else:
                continue
        m = re.match(r'^(#{2,4})\s+(.+)$', st)
        if m:
            out.append(f"{m.group(1)} {tidy_cn_heading(m.group(2))}")
            continue
        out.append(ln)
    return common_cleanup("\n".join(out))


def clean_hegel_with_us(raw: str) -> str:
    """张汝伦《黑格尔与我们同在》：剔除书名页与内嵌目录，规范编章标题。"""
    s = strip_front_toc_and_anchors(raw)
    lines = s.splitlines()
    out = []
    skip_front = False
    for ln in lines:
        st = ln.strip()
        if re.match(r'^##\s*(书名页|目录)\s*$', st):
            skip_front = True
            continue
        if skip_front:
            if re.match(r'^##\s+(序言|代前言|第一编)', st):
                skip_front = False
            else:
                continue
        m = re.match(r'^(#{2,4})\s+(.+)$', st)
        if m:
            lvl, title = m.group(1), tidy_cn_heading(m.group(2))
            out.append(f"{lvl} {title}")
            continue
        out.append(ln)
    return common_cleanup("\n".join(out))


def try_fix_cp437_mojibake(s: str) -> str:
    """尝试将 CP437 错码的 UTF-8 文件名标题还原为正常中文。"""
    try:
        decoded = s.encode("cp437").decode("utf-8")
        if re.search(r'[\u4e00-\u9fff]{2,}', decoded):
            return decoded.strip()
    except Exception:
        pass
    return ""


def clean_zhang_rulun_64(raw: str) -> str:
    """张汝伦《张汝伦文集（普罗之火精选64篇）》：清除/还原全部 CP437 乱码文件名标题，合并作者署名行，保留清晰 64 篇目录。"""
    s = strip_front_toc_and_anchors(raw)
    lines = s.splitlines()
    out = []
    i = 0
    n = len(lines)
    moji_re = re.compile(r'[µσΘτ∩╝ƒΓÇöΦ╛âσô▓σ¡ªΣ╕Çσƒ║µ£¼Θù«Θóÿ]')

    while i < n:
        st = lines[i].strip()
        m = re.match(r'^(#{2,4})\s+(.+)$', st)
        if m:
            lvl, title = m.group(1), m.group(2).strip()
            # 1) 乱码文件名标题：若紧随其后 5 行内已有正常中文 ## 标题，则直接丢弃乱码行；否则解码还原为中文标题！
            if len(moji_re.findall(title)) >= 3:
                has_clean_next = False
                for k in range(i + 1, min(n, i + 7)):
                    nk = lines[k].strip()
                    if re.match(r'^##\s+', nk) and len(moji_re.findall(nk)) == 0:
                        has_clean_next = True
                        break
                if has_clean_next:
                    i += 1
                    continue
                fixed = try_fix_cp437_mojibake(title)
                if fixed:
                    out.append(f"## {tidy_cn_heading(fixed)}")
                i += 1
                continue

            # 2) 独立作者署名行（如 "## 张 汝 伦" / "#### 张汝伦"）降级为正文署名，绝不拆成空章节
            t_nospace = re.sub(r'\s+', '', title)
            if t_nospace in ("张汝伦", "金重远", "附：", "附:"):
                out.append(f"*{t_nospace}*")
                i += 1
                continue

            # 3) 规范中文空格（如 "文 化 研 究 三 题 议" -> "文化研究三题议"）
            title = re.sub(r'(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])', '', title)
            title = re.sub(r'\s+o\s*0\s*广n\s*$', '', title)
            title = re.sub(r'^[、，,]\s*', '', title)
            # 跳过明显 OCR 乱码短英文/短残片标题
            if re.match(r'^[a-zA-Z0-9\s\.\-,!?]{1,18}$', title) or title in ('” , 路漫漫兮!', '”,路漫漫兮!'):
                i += 1
                continue
            # 合并紧随其后的副标题（如 "非普遍的普遍主义" + "———论康德的世界主义和种族主义" 或 "释义学的" + "实践哲学"）
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            if j < n:
                m_sub = re.match(r'^#{2,4}\s+(.+)$', lines[j].strip())
                if m_sub:
                    sub_t = re.sub(r'(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])', '', m_sub.group(1).strip())
                    if sub_t.startswith(("——", "—")) or (title.endswith("的") and len(title) <= 8 and len(sub_t) <= 12):
                        sub_t = re.sub(r'^—{3,}', '——', sub_t)
                        title = title + sub_t
                        i = j
            out.append(f"{lvl} {tidy_cn_heading(title)}")
            i += 1
            continue
        out.append(lines[i])
        i += 1
    return common_cleanup("\n".join(out))


def clean_zhuang_xiaoluoji(raw: str) -> str:
    """庄振华《〈小逻辑〉评注》：拆分误粘连在标题后的正文句，规范全书章节目录。"""
    s = strip_front_toc_and_anchors(raw)
    lines = s.splitlines()
    out = []
    for ln in lines:
        st = ln.strip()
        m = re.match(r'^(#{2,4})\s+(.+)$', st)
        if m:
            lvl, title = m.group(1), m.group(2).strip()
            # 拆分如 "### 第90一91节 大致对应于《大逻辑》的“定在本身”范畴。本节需要注意的..."
            m_sec = re.match(r'^(第\s*\d+(?:[—\-一]\d+)?\s*节)\s+(.{16,})$', title)
            if m_sec:
                sec_lbl = m_sec.group(1).replace("一", "—")
                out.append(f"### {sec_lbl}")
                out.append("")
                out.append(m_sec.group(2))
                continue
            out.append(f"{lvl} {tidy_cn_heading(title)}")
            continue
        out.append(ln)
    return common_cleanup("\n".join(out))


def split_and_clean_zhang_shiying_volumes() -> list:
    """将《张世英文集（全十册）.md》精准拆分为 7 册新增/扩充单卷，剔除每卷卷首内嵌目录与重复断行页眉。"""
    src = SRC_ORIG / "张世英文集（全十册）.md"
    zsy = src.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")
    zsy = re.sub(r'<a\s+id="[^"]*"\s*>\s*</a>', '', zsy)

    starts = [m.start() for m in re.finditer(r'(?m)^##\s+张世英文集[\.．]第[0-9一二三四五六七八九十]+卷', zsy)]
    assert len(starts) == 10, f"Expected 10 volumes, found {len(starts)}"

    # 卷 2/3/6 已有高精校单行本；卷 1/4/5/7/8/9/10 为全新或大幅扩充卷（卷4含63.5万字完整版）
    target_vols = {
        1: "张世英文集·第1卷：论黑格尔哲学三书",
        4: "张世英文集·第4卷：康德与西方哲学研究",
        5: "张世英文集·第5卷：天人之际：中西哲学的困惑与选择",
        7: "张世英文集·第7卷：境界与文化：成人之道",
        8: "张世英文集·第8卷：中西文化与自我",
        9: "张世英文集·第9卷：美在自由：中欧美学思想比较研究",
        10: "张世英文集·第10卷：随笔、回忆录及其他",
    }

    written = []
    for vol_num, fname in target_vols.items():
        st = starts[vol_num - 1]
        ed = starts[vol_num] if vol_num < 10 else len(zsy)
        chunk = zsy[st:ed]
        lines = chunk.splitlines()

        # 跳过卷首 CIP 与内嵌目录：每卷正文真正始于第二次出现的 "第X卷说明"（或首次出现若只出现一次）
        note_pat = re.compile(r'^##\s*第\s*(?:' + str(vol_num) + r'|[一二三四五六七八九十]+)\s*卷说明\s*$')
        note_hits = [idx for idx, l in enumerate(lines[:350]) if note_pat.match(l.strip())]
        if len(note_hits) >= 2:
            lines = lines[note_hits[1] :]
        elif len(note_hits) == 1:
            lines = lines[note_hits[0] :]
        else:
            lines = lines[1:]

        cleaned_lines = []
        seen_h2_norms = set()
        last_h_norm = ""
        chars_since_last_h = 99999
        i = 0
        n = len(lines)
        while i < n:
            st_ln = lines[i].strip()
            m = re.match(r'^(#{2,4})\s+(.+)$', st_ln)
            if m:
                lvl = m.group(1)
                t = m.group(2).strip()
                if "张世英文集" in t and ("北京" in t or "出版社" in t):
                    i += 1
                    continue
                if re.match(r'^[，。、；：]|[的之与和]$', t) and len(t) < 16 and not re.match(r'^第[一二三四五六七八九十0-9]+', t):
                    i += 1
                    continue
                is_vol_note = bool(re.match(r'^第\s*\d+\s*卷\s*说明$', t))
                j = i + 1
                while j < n and not lines[j].strip():
                    j += 1
                if not is_vol_note and j < n:
                    m2 = re.match(r'^#{2,4}\s+(.+)$', lines[j].strip())
                    if m2:
                        t2 = m2.group(1).strip()
                        if t2 != t and (t2.startswith(("——", "—")) or (
                            not re.match(r'^(第[一二三四五六七八九十0-9]+[卷篇编部章讲节]|[一二三四五六七八九十]+[\s、.]|\d+[\s、.]|序|再版序|前言|后记|附录|上篇|下篇)', t2)
                            and len(t) < 28 and len(t2) < 24 and not t.endswith(("。", "？", "！"))
                        )):
                            t = (t + t2).replace("——", "——")
                            i = j

                t = tidy_cn_heading(t)
                t_norm = re.sub(r'[\s　：:·—\-“”《》]+', '', t)
                # 整卷内重复页眉与残缺前置标题全局去重，始终保留唯一最完整的章题
                if t_norm and t_norm in seen_h2_norms:
                    i += 1
                    continue
                if t_norm and any(len(t_norm) >= 6 and t_norm in prev for prev in seen_h2_norms) and chars_since_last_h < 2500:
                    i += 1
                    continue
                if t_norm and last_h_norm and chars_since_last_h < 1200 and len(last_h_norm) >= 5 and last_h_norm in t_norm:
                    for rev in range(len(cleaned_lines) - 1, max(-1, len(cleaned_lines) - 10), -1):
                        if cleaned_lines[rev].startswith("#"):
                            cleaned_lines[rev] = f"{lvl} {t}"
                            break
                    seen_h2_norms.add(t_norm)
                    last_h_norm = t_norm
                    chars_since_last_h = 0
                    i += 1
                    continue

                if re.match(r'^(第[一二三四五六七八九十0-9]+[卷篇编部章讲]|上篇|中篇|下篇|序|再版序|前言|导言|绪论|附录|后记|北窗呓语|黑格尔的哲学|论黑格尔的精神哲学)', t):
                    lvl = "##"
                if lvl == "##" and t_norm:
                    seen_h2_norms.add(t_norm)
                cleaned_lines.append(f"{lvl} {t}")
                last_h_norm = t_norm
                chars_since_last_h = 0
                i += 1
                continue

            if st_ln:
                chars_since_last_h += len(st_ln)
            cleaned_lines.append(lines[i])
            i += 1

        out_path = OUT_DIR / f"{fname}.md"
        out_path.write_text(common_cleanup("\n".join(cleaned_lines)), encoding="utf-8")
        written.append((fname, out_path.stat().st_size))
    return written


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.md"):
        old.unlink()

    jobs = [
        # 中文译本（10 部，含升级版《哲学的非意识形态化危机》）
        (SRC_TRANS / "自然哲学.md", "自然哲学.md", clean_nature_philosophy),
        (SRC_TRANS / "黑格尔法哲学批判.md", "黑格尔法哲学批判.md", clean_marx_hegel_right),
        (SRC_TRANS / "黑格尔逻辑学论文集.md", "黑格尔逻辑学论文集.md", clean_hegel_logic_essays),
        (SRC_TRANS / "希腊哲学批评史.md", "希腊哲学批评史.md", clean_stace_greek),
        (SRC_TRANS / "宗教与现代心灵.md", "宗教与现代心灵.md", clean_stace_religion),
        (SRC_TRANS / "西方人的命运.md", "西方人的命运.md", clean_stace_destiny),
        (SRC_TRANS / "哲学，很简单.md", "哲学，很简单.md", clean_dk_philosophy),
        (SRC_TRANS / "解放心理学文集.md", "解放心理学文集.md", clean_liberation_psych),
        (SRC_TRANS / "去意识形态化：解放心理学与矛盾的位置.md", "去意识形态化：解放心理学与矛盾的位置.md", clean_liberation_psych),
        (SRC_TRANS / "哲学的非意识形态化危机.md", "哲学的非意识形态化危机（尤林娜）.md", clean_liberation_psych),
        # 中文原著（6 部全新独立巨著）
        (SRC_ORIG / "《存在与时间》释义.md", "《存在与时间》释义.md", clean_being_and_time),
        (SRC_ORIG / "德国观念论与当前哲学的困境.md", "德国观念论与当前哲学的困境.md", clean_heidegger_german_idealism),
        (SRC_ORIG / "现代西方哲学十五讲.md", "现代西方哲学十五讲.md", clean_modern_west_15),
        (SRC_ORIG / "黑格尔与我们同在.md", "黑格尔与我们同在.md", clean_hegel_with_us),
        (SRC_ORIG / "张汝伦文集（普罗之火精选64篇）.md", "张汝伦文集（普罗之火精选64篇）.md", clean_zhang_rulun_64),
        (SRC_ORIG / "《小逻辑》评注.md", "《小逻辑》评注.md", clean_zhuang_xiaoluoji),
    ]

    for src, out_name, fn in jobs:
        raw = src.read_text(encoding="utf-8", errors="replace")
        cleaned = fn(raw)
        out_path = OUT_DIR / out_name
        out_path.write_text(cleaned, encoding="utf-8")
        h2s = re.findall(r'(?m)^##\s+(.+)$', cleaned)
        h3s = re.findall(r'(?m)^###\s+(.+)$', cleaned)
        moji = len(re.findall(r'[µσΘτ∩╝ƒΓÇö]{2,}', cleaned))
        print(f"OK {out_name:36s} | {len(cleaned):8,d}c | H2={len(h2s):3d} H3={len(h3s):3d} | moji={moji}")

    print("\n--- Splitting 张世英文集（全十册） -> 7 new/expanded volumes ---")
    for name, sz in split_and_clean_zhang_shiying_volumes():
        txt = (OUT_DIR / f"{name}.md").read_text(encoding="utf-8")
        h2s = re.findall(r'(?m)^##\s+(.+)$', txt)
        h3s = re.findall(r'(?m)^###\s+(.+)$', txt)
        print(f"OK {name:36s} | {len(txt):8,d}c | H2={len(h2s):3d} H3={len(h3s):3d}")


if __name__ == "__main__":
    main()
