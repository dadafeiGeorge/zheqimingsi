#!/usr/bin/env python3
r"""
build_library.py — 将 d:\文献库\中文译本 与 d:\咕咕嘎嘎反重力\extra-books（由待翻译转写转录整理产出）
中的全部哲学中文译本与著作解析为超轻量化、分卷打包、带正文首章定位（自动跳过目录扉页）的 JSON 文献库。
"""
import os
import re
import html
import json
import hashlib
import zipfile
import shutil
import unicodedata
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from footnote_folder import fold_cross_chapter_notes, parse_footnote_def

TOTAL_FN_STATS = {"folded": 0, "bound": 0, "gloss": 0, "cross_bound": 0, "pruned_note_chs": 0}

SOURCE_ROOT = Path(r"D:\文献库\中文译本")
EXTRA_ROOT = Path(r"D:\咕咕嘎嘎反重力\extra-books")
NEW_BOOKS_ROOT = Path(r"D:\咕咕嘎嘎反重力\new-books")
ENGLISH_BOOKS_ROOT = Path(r"D:\咕咕嘎嘎反重力\english-books")
OUT_ROOT = Path(r"D:\咕咕嘎嘎反重力\library-data")

BOOK_META_OVERRIDES = {
    # 1. 古希腊与近代哲思 (classic)
    "希腊哲学批评史": ("希腊哲学批评史", "W. T. 斯退士", "古希腊与近代哲思", "classic"),
    "宗教与现代心灵": ("宗教与现代心灵", "W. T. 斯退士", "古希腊与近代哲思", "classic"),
    "西方人的命运": ("西方人的命运", "W. T. 斯退士", "古希腊与近代哲思", "classic"),
    "第一哲学沉思集-笛卡尔": ("第一哲学沉思集", "勒内·笛卡尔", "古希腊与近代哲思", "classic"),
    "形而上学论与单子论": ("形而上学论与单子论", "G. W. 莱布尼茨", "古希腊与近代哲思", "classic"),
    "单子论：新译与导读": ("单子论：新译与导读", "G. W. 莱布尼茨", "古希腊与近代哲思", "classic"),
    "洛克全集（中文·校对版）": ("洛克全集", "约翰·洛克", "古希腊与近代哲思", "classic"),
    "哲学，很简单": ("哲学，很简单", "DK 出版社", "古希腊与近代哲思", "classic"),

    # 2. 德国古典原典 (german)
    "纯粹理性批判": ("纯粹理性批判", "伊曼努尔·康德", "德国古典原典", "german"),
    "实践理性批判": ("实践理性批判", "伊曼努尔·康德", "德国古典原典", "german"),
    "判断力批判": ("判断力批判", "伊曼努尔·康德", "德国古典原典", "german"),
    "伦理学体系": ("伦理学体系", "J. G. 费希特", "德国古典原典", "german"),
    "费希特作品选": ("费希特作品选", "J. G. 费希特", "德国古典原典", "german"),
    "费希特研究": ("费希特研究", "诺瓦利斯", "德国古典原典", "german"),
    "费希特与谢林之间的哲学断裂：选文": ("费希特与谢林之间的哲学断裂", "费希特 / 谢林", "德国古典原典", "german"),
    "先验唯心论体系": ("先验唯心论体系", "F. W. J. 谢林", "德国古典原典", "german"),
    "自然哲学体系的第一纲要": ("自然哲学体系的第一纲要", "F. W. J. 谢林", "德国古典原典", "german"),
    "艺术哲学": ("艺术哲学", "F. W. J. 谢林", "德国古典原典", "german"),
    "关于人类自由之本质的哲学探究": ("关于人类自由之本质的哲学探究", "F. W. J. 谢林", "德国古典原典", "german"),
    "克拉拉，或论自然与精神世界的联系": ("克拉拉，或论自然与精神世界的联系", "F. W. J. 谢林", "德国古典原典", "german"),
    "神话哲学历史批判导论": ("神话哲学历史批判导论", "F. W. J. 谢林", "德国古典原典", "german"),
    "肯定哲学的奠基：柏林讲演录": ("肯定哲学的奠基：柏林讲演录", "F. W. J. 谢林", "德国古典原典", "german"),
    "观念论与理论的终结": ("观念论与理论的终结", "F. W. J. 谢林", "德国古典原典", "german"),
    "近代哲学史 (谢林著作集)": ("近代哲学史", "F. W. J. 谢林", "德国古典原典", "german"),
    "近代哲学史": ("近代哲学史", "F. W. J. 谢林", "德国古典原典", "german"),
    "谢林的有机形式哲学：生命作为自由的图型": ("谢林的有机形式哲学：生命作为自由的图型", "布鲁斯·马修斯", "德国古典原典", "german"),
    "精神现象学（Pinkard英译本·中译）": ("精神现象学", "G. W. F. 黑格尔", "德国古典原典", "german"),
    "【完整全本】黑格尔《大逻辑》汉译精注本": ("大逻辑（逻辑学）", "G. W. F. 黑格尔", "德国古典原典", "german"),
    "【完整全本】黑格尔《小逻辑》汉译精注本": ("小逻辑", "G. W. F. 黑格尔", "德国古典原典", "german"),
    "自然哲学": ("自然哲学（哲学科学百科全书·第二部）", "G. W. F. 黑格尔", "德国古典原典", "german"),
    "00_法哲学原理_序言与导论（§1-§33）": ("法哲学原理：序言与导论（§1-§33）", "G. W. F. 黑格尔", "德国古典原典", "german"),
    "【完整全本】黑格尔《法哲学原理》汉译精注本": ("法哲学原理", "G. W. F. 黑格尔", "德国古典原典", "german"),
    "【完整全本】黑格尔《历史哲学》汉译精注本": ("历史哲学（精注本）", "G. W. F. 黑格尔", "德国古典原典", "german"),
    "历史哲学（全本）": ("历史哲学", "G. W. F. 黑格尔", "德国古典原典", "german"),
    "【完整全本】黑格尔《哲学史讲演录》汉译精注本": ("哲学史讲演录", "G. W. F. 黑格尔", "德国古典原典", "german"),
    "【完整汉译】黑格尔论宗教与政治（全十章精译与导读）": ("黑格尔论宗教与政治", "安杰莉卡·努佐 编", "德国古典原典", "german"),
    "黑格尔论宗教与政治（全本）": ("黑格尔论宗教与政治", "安杰莉卡·努佐 编", "德国古典原典", "german"),
    "【学术导读】黑格尔《历史哲学》导读与精讲": ("黑格尔《历史哲学》导读与精讲", "黑格尔研究导读", "德国古典原典", "german"),
    "【学术导读】黑格尔论宗教与政治（导读与精讲）": ("黑格尔论宗教与政治导读与精讲", "黑格尔研究导读", "德国古典原典", "german"),
    "黑格尔逻辑学论文集": ("黑格尔逻辑学论文集", "乔治·迪乔瓦尼 编", "德国古典原典", "german"),
    "黑格尔哲学（斯退士）": ("黑格尔哲学", "W. T. 斯退士", "德国古典原典", "german"),
    "《小逻辑》评注": ("《小逻辑》评注", "庄振华", "德国古典原典", "german"),
    "德国哲学论丛": ("德国哲学论丛（1996—1997）", "湖北大学哲学研究所 编", "德国古典原典", "german"),

    # 3. 马克思与批判理论 (marxism)
    "黑格尔法哲学批判": ("黑格尔法哲学批判", "卡尔·马克思", "马克思与批判理论", "marxism"),
    "列宁哲学笔记": ("列宁哲学笔记（全集第38卷）", "弗拉基米尔·列宁", "马克思与批判理论", "marxism"),
    "历史与阶级意识（中文版）": ("历史与阶级意识", "格奥尔格·卢卡奇", "马克思与批判理论", "marxism"),
    "青年黑格尔：辩证法与经济学之关系研究": ("青年黑格尔", "格奥尔格·卢卡奇", "马克思与批判理论", "marxism"),
    "理性的毁灭": ("理性的毁灭", "格奥尔格·卢卡奇", "马克思与批判理论", "marxism"),
    "社会存在本体论·卷一：黑格尔": ("社会存在本体论·卷一：黑格尔", "格奥尔格·卢卡奇", "马克思与批判理论", "marxism"),
    "社会存在本体论·卷二：马克思": ("社会存在本体论·卷二：马克思", "格奥尔格·卢卡奇", "马克思与批判理论", "marxism"),
    "社会存在本体论·卷三：劳动": ("社会存在本体论·卷三：劳动", "格奥尔格·卢卡奇", "马克思与批判理论", "marxism"),
    "列宁：其思想之统一性研究": ("列宁：其思想之统一性研究", "格奥尔格·卢卡奇", "马克思与批判理论", "marxism"),
    "策略与伦理：政治文集 1919—1929": ("策略与伦理：政治文集 1919—1929", "格奥尔格·卢卡奇", "马克思与批判理论", "marxism"),
    "民主化的进程-卢卡奇（中文版）": ("民主化的进程", "格奥尔格·卢卡奇", "马克思与批判理论", "marxism"),
    "启蒙辩证法": ("启蒙辩证法：哲学断片", "霍克海默 / 阿多诺", "马克思与批判理论", "marxism"),
    "否定辩证法": ("否定辩证法", "特奥多尔·W. 阿多诺", "马克思与批判理论", "marxism"),
    "反认识论": ("反认识论：对胡塞尔与现象学二律背反的元批判", "特奥多尔·W. 阿多诺", "马克思与批判理论", "marxism"),
    "本真性的行话": ("本真性的行话", "特奥多尔·W. 阿多诺", "马克思与批判理论", "marxism"),
    "单向度的人：发达工业社会意识形态研究": ("单向度的人", "赫伯特·马尔库塞", "马克思与批判理论", "marxism"),
    "美学与政治": ("美学与政治", "阿多诺 / 本雅明 / 布洛赫 / 布莱希特 / 卢卡奇", "马克思与批判理论", "marxism"),
    "读《资本论》": ("读《资本论》", "路易·阿尔都塞 / 艾蒂安·巴里巴尔", "马克思与批判理论", "marxism"),
    "论再生产": ("论再生产", "路易·阿尔都塞", "马克思与批判理论", "marxism"),
    "列宁与哲学及其他论文": ("列宁与哲学及其他论文", "路易·阿尔都塞", "马克思与批判理论", "marxism"),
    "解放心理学文集": ("解放心理学文集", "伊格纳西奥·马丁-巴罗", "马克思与批判理论", "marxism"),
    "去意识形态化：解放心理学与矛盾的位置": ("去意识形态化：解放心理学与矛盾的位置", "尼克·马勒布", "马克思与批判理论", "marxism"),
    "哲学的非意识形态化危机": ("哲学的非意识形态化危机", "N. S. 尤林娜", "马克思与批判理论", "marxism"),
    "哲学的非意识形态化危机（尤林娜）": ("哲学的非意识形态化危机", "N. S. 尤林娜", "马克思与批判理论", "marxism"),

    # 4. 现象学与存在哲学 (phenomenology)
    "德国观念论与当前哲学的困境": ("德国观念论与当前哲学的困境", "马丁·海德格尔", "现象学与存在哲学", "phenomenology"),
    "时间概念史导论": ("时间概念史导论", "马丁·海德格尔", "现象学与存在哲学", "phenomenology"),
    "《存在与时间》释义": ("《存在与时间》释义", "张汝伦", "现象学与存在哲学", "phenomenology"),
    "现代西方哲学十五讲": ("现代西方哲学十五讲", "张汝伦", "现象学与存在哲学", "phenomenology"),
    "黑格尔与我们同在": ("黑格尔与我们同在", "张汝伦", "现象学与存在哲学", "phenomenology"),
    "张汝伦文集（普罗之火精选64篇）": ("张汝伦文集（精选64篇）", "张汝伦", "现象学与存在哲学", "phenomenology"),

    # 5. 精神分析与后现代 (postmodern)
    "拉康《焦虑》研讨班X中译本": ("拉康《焦虑》研讨班 X", "雅克·拉康", "精神分析与后现代", "postmodern"),
    "拉康《精神分析的四个基本概念》中译本": ("精神分析的四个基本概念", "雅克·拉康", "精神分析与后现代", "postmodern"),
    "芬克《拉康式主体》中译本": ("拉康式主体：在语言与享乐之间", "布鲁斯·芬克", "精神分析与后现代", "postmodern"),
    "蒙卡约《拉康精神分析的实践》中译本": ("拉康精神分析的实践", "劳尔·蒙卡约", "精神分析与后现代", "postmodern"),
    "齐泽克《如何阅读拉康》中译本": ("如何阅读拉康", "斯拉沃热·齐泽克", "精神分析与后现代", "postmodern"),
    "知否：享乐作为政治因素": ("知否：享乐作为政治因素", "斯拉沃热·齐泽克", "精神分析与后现代", "postmodern"),
    "延迟的否定": ("延迟的否定：康德、黑格尔与意识形态批判", "斯拉沃热·齐泽克", "精神分析与后现代", "postmodern"),
    "书写与差异": ("书写与差异", "雅克·德里达", "精神分析与后现代", "postmodern"),
    "托姆希奇与泽夫尼克《拉康：在精神分析与政治之间》中译本": ("拉康：在精神分析与政治之间", "托姆希奇 / 泽夫尼克", "精神分析与后现代", "postmodern"),
    "拟像与仿真": ("拟像与仿真", "让·鲍德里亚", "精神分析与后现代", "postmodern"),
    "消费社会": ("消费社会", "让·鲍德里亚", "精神分析与后现代", "postmodern"),
    "象征交换与死亡": ("象征交换与死亡", "让·鲍德里亚", "精神分析与后现代", "postmodern"),
    "鲍德里亚文选": ("鲍德里亚文选", "让·鲍德里亚", "精神分析与后现代", "postmodern"),
    "导读鲍德里亚": ("导读鲍德里亚", "克里斯·霍罗克斯", "精神分析与后现代", "postmodern"),
    "巴迪欧与卡桑《性关系不存在》中译本": ("巴迪欧与卡桑《性关系不存在》", "阿兰·巴迪欧 / 芭芭拉·卡桑", "精神分析与后现代", "postmodern"),

    # 6. 张世英哲学全书 (chinese)
    "张世英文集·第1卷：论黑格尔哲学三书": ("张世英文集·第1卷：论黑格尔哲学三书", "张世英", "张世英哲学全书", "chinese"),
    "论黑格尔的逻辑学": ("论黑格尔的逻辑学（第3版）", "张世英", "张世英哲学全书", "chinese"),
    "黑格尔《小逻辑》译注": ("黑格尔《小逻辑》绎注", "张世英", "张世英哲学全书", "chinese"),
    "张世英文集·第4卷：康德与西方哲学研究": ("张世英文集·第4卷：康德与西方哲学研究", "张世英", "张世英哲学全书", "chinese"),
    "张世英文集·第5卷：天人之际：中西哲学的困惑与选择": ("天人之际：中西哲学的困惑与选择（文集第5卷）", "张世英", "张世英哲学全书", "chinese"),
    "哲学导论": ("哲学导论", "张世英", "张世英哲学全书", "chinese"),
    "张世英文集·第7卷：境界与文化：成人之道": ("境界与文化：成人之道（文集第7卷）", "张世英", "张世英哲学全书", "chinese"),
    "张世英文集·第8卷：中西文化与自我": ("中西文化与自我（文集第8卷）", "张世英", "张世英哲学全书", "chinese"),
    "张世英文集·第9卷：美在自由：中欧美学思想比较研究": ("美在自由：中欧美学思想比较研究（文集第9卷）", "张世英", "张世英哲学全书", "chinese"),
    "张世英文集·第10卷：随笔、回忆录及其他": ("张世英文集·第10卷：随笔、回忆录及其他", "张世英", "张世英哲学全书", "chinese"),
    "康德的《纯粹理性批判》": ("康德的《纯粹理性批判》", "张世英", "张世英哲学全书", "chinese"),
    "西方哲学史（张世英）": ("西方哲学史", "张世英", "张世英哲学全书", "chinese"),
    "黑格尔《精神现象学》述评": ("黑格尔《精神现象学》述评", "张世英", "张世英哲学全书", "chinese"),
    "自我实现的历程：解读黑格尔《精神现象学》": ("自我实现的历程：解读黑格尔《精神现象学》", "张世英", "张世英哲学全书", "chinese"),
    "张世英黑格尔哲学五讲": ("张世英黑格尔哲学五讲", "张世英", "张世英哲学全书", "chinese"),
    "黑格尔哲学概论": ("黑格尔哲学概论", "张世英", "张世英哲学全书", "chinese"),

    # 7. 辞典与术语工具 (reference)
    "康德辞典": ("康德辞典", "卢卡斯·索普", "辞典与术语工具", "reference"),
    "康德辞典（第 1 卷）": ("康德辞典（第 1 卷）", "维拉舍克 等编", "辞典与术语工具", "reference"),
    "00_拉康术语表": ("拉康术语译名表", "学术译名统一表", "辞典与术语工具", "reference"),
}

ENGLISH_BOOK_META = {
    # 1. 古希腊与近代原典 (classic)
    "a-critical-history-of-greek-philosophy": ("A Critical History of Greek Philosophy", "W. T. Stace", "古希腊与近代原典", "classic"),
    "religion-and-the-modern-mind": ("Religion and the Modern Mind", "W. T. Stace", "古希腊与近代原典", "classic"),
    "discourse-on-metaphysics-and-the-monadology": ("Discourse on Metaphysics and The Monadology", "G. W. Leibniz", "古希腊与近代原典", "classic"),
    "the-complete-works-of-john-locke": ("The Complete Works of John Locke", "John Locke", "古希腊与近代原典", "classic"),

    # 2. 康德·费希特与谢林 (german)
    "critique-of-pure-reason": ("Critique of Pure Reason", "Immanuel Kant", "康德·费希特与谢林", "german"),
    "critique-of-practical-reason": ("Critique of Practical Reason", "Immanuel Kant", "康德·费希特与谢林", "german"),
    "critique-of-the-power-of-judgment": ("Critique of the Power of Judgment", "Immanuel Kant", "康德·费希特与谢林", "german"),
    "the-system-of-ethics": ("The System of Ethics", "J. G. Fichte", "康德·费希特与谢林", "german"),
    "works-of-johann-gottlieb-fichte": ("Works of Johann Gottlieb Fichte", "J. G. Fichte", "康德·费希特与谢林", "german"),
    "fichte-studies": ("Fichte Studies", "Novalis", "康德·费希特与谢林", "german"),
    "system-of-transcendental-idealism": ("System of Transcendental Idealism", "F. W. J. Schelling", "康德·费希特与谢林", "german"),
    "first-outline-of-a-system-of-the-philosophy-of-nature": ("First Outline of a System of the Philosophy of Nature", "F. W. J. Schelling", "康德·费希特与谢林", "german"),
    "the-philosophy-of-art": ("The Philosophy of Art", "F. W. J. Schelling", "康德·费希特与谢林", "german"),
    "clara-or-on-nature-s-connection-to-the-spirit-world": ("Clara, or On Nature's Connection to the Spirit World", "F. W. J. Schelling", "康德·费希特与谢林", "german"),
    "historical-critical-introduction-to-the-philosophy-of-mythology": ("Historical-Critical Introduction to the Philosophy of Mythology", "F. W. J. Schelling", "康德·费希特与谢林", "german"),
    "the-grounding-of-positive-philosophy-the-berlin-lectures": ("The Grounding of Positive Philosophy: The Berlin Lectures", "F. W. J. Schelling", "康德·费希特与谢林", "german"),
    "idealism-and-the-endgame-of-theory-three-essays-by-f-w-j-schelling": ("Idealism and the Endgame of Theory: Three Essays", "F. W. J. Schelling", "康德·费希特与谢林", "german"),
    "the-philosophical-rupture-between-fichte-and-schelling-selected-texts-and-correspondence-1800-1802": ("The Philosophical Rupture between Fichte and Schelling (1800–1802)", "F. W. J. Schelling & J. G. Fichte", "康德·费希特与谢林", "german"),
    "schelling-s-organic-form-of-philosophy-life-as-the-schema-of-freedom": ("Schelling's Organic Form of Philosophy: Life as the Schema of Freedom", "Bruce Matthews", "康德·费希特与谢林", "german"),

    # 3. 黑格尔原典与研究 (german)
    "the-phenomenology-of-spirit": ("The Phenomenology of Spirit", "G. W. F. Hegel", "黑格尔原典与研究", "german"),
    "the-science-of-logic": ("The Science of Logic", "G. W. F. Hegel", "黑格尔原典与研究", "german"),
    "the-encyclopaedia-logic-part-i-of-the-encyclopaedia-of-the-philosophical-sciences": ("The Encyclopaedia Logic (Part I)", "G. W. F. Hegel", "黑格尔原典与研究", "german"),
    "hegels-philosophy-of-nature": ("Hegel's Philosophy of Nature", "G. W. F. Hegel", "黑格尔原典与研究", "german"),
    "the-philosophy-of-history": ("The Philosophy of History", "G. W. F. Hegel", "黑格尔原典与研究", "german"),
    "lectures-on-the-philosophy-of-world-history-introduction": ("Lectures on the Philosophy of World History: Introduction", "G. W. F. Hegel", "黑格尔原典与研究", "german"),
    "lectures-on-the-history-of-philosophy-vol-i": ("Lectures on the History of Philosophy, Vol. I", "G. W. F. Hegel", "黑格尔原典与研究", "german"),
    "lectures-on-the-history-of-philosophy-vol-ii": ("Lectures on the History of Philosophy, Vol. II", "G. W. F. Hegel", "黑格尔原典与研究", "german"),
    "lectures-on-the-history-of-philosophy-volume-iii": ("Lectures on the History of Philosophy, Vol. III", "G. W. F. Hegel", "黑格尔原典与研究", "german"),
    "essays-on-hegels-logic": ("Essays on Hegel's Logic", "George di Giovanni (ed.)", "黑格尔原典与研究", "german"),
    "the-philosophy-of-hegel": ("The Philosophy of Hegel", "W. T. Stace", "黑格尔原典与研究", "german"),

    # 4. 马克思与批判理论 (marxism)
    "critique-of-hegels-philosophy-of-right": ("Critique of Hegel's Philosophy of Right", "Karl Marx", "马克思与批判理论", "marxism"),
    "collected-works-volume-38-philosophical-notebooks": ("Collected Works, Vol. 38: Philosophical Notebooks", "V. I. Lenin", "马克思与批判理论", "marxism"),
    "history-and-class-consciousness": ("History and Class Consciousness", "Georg Lukács", "马克思与批判理论", "marxism"),
    "the-young-hegel-studies-in-the-relations-between-dialectics-and-economics": ("The Young Hegel: Dialectics and Economics", "Georg Lukács", "马克思与批判理论", "marxism"),
    "the-destruction-of-reason": ("The Destruction of Reason", "Georg Lukács", "马克思与批判理论", "marxism"),
    "ontology-of-social-being-vol-i": ("Ontology of Social Being, Vol. I: Hegel", "Georg Lukács", "马克思与批判理论", "marxism"),
    "ontology-of-social-being-vol-ii": ("Ontology of Social Being, Vol. II: Marx", "Georg Lukács", "马克思与批判理论", "marxism"),
    "ontology-of-social-being-vol-iii": ("Ontology of Social Being, Vol. III: Labour", "Georg Lukács", "马克思与批判理论", "marxism"),
    "lenin-a-study-on-the-unity-of-his-thought": ("Lenin: A Study on the Unity of His Thought", "Georg Lukács", "马克思与批判理论", "marxism"),
    "tactics-and-ethics-political-writings-1919-1929": ("Tactics and Ethics: Political Writings 1919–1929", "Georg Lukács", "马克思与批判理论", "marxism"),
    "negative-dialectics": ("Negative Dialectics", "Theodor W. Adorno", "马克思与批判理论", "marxism"),
    "against-epistemology": ("Against Epistemology: A Metacritique", "Theodor W. Adorno", "马克思与批判理论", "marxism"),
    "the-jargon-of-authenticity": ("The Jargon of Authenticity", "Theodor W. Adorno", "马克思与批判理论", "marxism"),
    "dialectic-of-enlightenment": ("Dialectic of Enlightenment", "Max Horkheimer & Theodor W. Adorno", "马克思与批判理论", "marxism"),
    "one-dimensional-man": ("One-Dimensional Man", "Herbert Marcuse", "马克思与批判理论", "marxism"),
    "aesthetics-and-politics": ("Aesthetics and Politics", "Adorno, Benjamin, Bloch, Brecht & Lukács", "马克思与批判理论", "marxism"),
    "reading-capital": ("Reading Capital", "Louis Althusser & Étienne Balibar", "马克思与批判理论", "marxism"),
    "lenin-and-philosophy-and-other-essays": ("Lenin and Philosophy and Other Essays", "Louis Althusser", "马克思与批判理论", "marxism"),
    "writings-for-a-liberation-psychology": ("Writings for a Liberation Psychology", "Ignacio Martín-Baró", "马克思与批判理论", "marxism"),
    "de-ideologization-liberation-psychology": ("De-ideologization: Liberation Psychology and Contradiction", "Nick Malherbe", "马克思与批判理论", "marxism"),
    "the-de-ideologization-crisis-in-philosophy": ("The De-Ideologization Crisis in Philosophy", "N. S. Iulina", "马克思与批判理论", "marxism"),

    # 5. 现象学与存在哲学 (phenomenology)
    "history-of-the-concept-of-time": ("History of the Concept of Time: Prolegomena", "Martin Heidegger", "现象学与存在哲学", "phenomenology"),

    # 6. 精神分析与后现代 (postmodern)
    "anxiety-the-seminar-of-jacques-lacan-book-x": ("Anxiety: The Seminar of Jacques Lacan, Book X", "Jacques Lacan", "精神分析与后现代", "postmodern"),
    "the-four-fundamental-concepts-of-psychoanalysis": ("The Four Fundamental Concepts of Psychoanalysis", "Jacques Lacan", "精神分析与后现代", "postmodern"),
    "on-feminine-sexuality-encore": ("On Feminine Sexuality: The Seminar of Jacques Lacan, Book XX (Encore)", "Jacques Lacan", "精神分析与后现代", "postmodern"),
    "the-lacanian-subject": ("The Lacanian Subject: Between Language and Jouissance", "Bruce Fink", "精神分析与后现代", "postmodern"),
    "the-practice-of-lacanian-psychoanalysis-theories-and-principles": ("The Practice of Lacanian Psychoanalysis", "Raul Moncayo", "精神分析与后现代", "postmodern"),
    "how-to-read-lacan": ("How to Read Lacan", "Slavoj Žižek", "精神分析与后现代", "postmodern"),
    "for-they-know-not-what-they-do": ("For They Know Not What They Do: Enjoyment as a Political Factor", "Slavoj Žižek", "精神分析与后现代", "postmodern"),
    "tarrying-with-the-negative": ("Tarrying with the Negative: Kant, Hegel, and the Critique of Ideology", "Slavoj Žižek", "精神分析与后现代", "postmodern"),
    "writing-and-difference": ("Writing and Difference", "Jacques Derrida", "精神分析与后现代", "postmodern"),
    "jacques-lacan-between-psychoanalysis-and-politics": ("Jacques Lacan: Between Psychoanalysis and Politics", "Samo Tomšič & Andreja Zevnik (eds.)", "精神分析与后现代", "postmodern"),
    "there-s-no-such-thing-as-a-sexual-relationship": ("There's No Such Thing as a Sexual Relationship", "Alain Badiou & Barbara Cassin", "精神分析与后现代", "postmodern"),
    "simulacra-and-simulation": ("Simulacra and Simulation", "Jean Baudrillard", "精神分析与后现代", "postmodern"),
    "symbolic-exchange-and-death": ("Symbolic Exchange and Death", "Jean Baudrillard", "精神分析与后现代", "postmodern"),
    "the-consumer-society-myths-and-structures": ("The Consumer Society: Myths and Structures", "Jean Baudrillard", "精神分析与后现代", "postmodern"),
    "jean-baudrillard-selected-writings": ("Jean Baudrillard: Selected Writings", "Jean Baudrillard", "精神分析与后现代", "postmodern"),
    "introducing-baudrillard-a-graphic-guide": ("Introducing Baudrillard: A Graphic Guide", "Chris Horrocks & Zoran Jevtic", "精神分析与后现代", "postmodern"),

    # 7. 辞典与通识百科 (reference)
    "a-hegel-dictionary": ("A Hegel Dictionary", "Michael Inwood", "辞典与通识百科", "reference"),
    "the-kant-dictionary": ("The Kant Dictionary", "Lucas Thorpe", "辞典与通识百科", "reference"),
    "kant-lexikon": ("Kant-Lexikon", "Willaschek, Stolzenberg, Mohr & Schierbaum (eds.)", "辞典与通识百科", "reference"),
    "simply-philosophy": ("Simply Philosophy", "DK Publishing", "辞典与通识百科", "reference"),
    "nature-encyclopedia": ("Nature Encyclopedia", "DK Publishing", "辞典与通识百科", "reference"),
}

CORE_PHILOSOPHY_GLOSSARY = [
    ("扬弃", "Aufhebung", "黑格尔辩证法核心范畴，同时包含「否定/取消」「保存/保留」与「提升到更高阶段」三重含义。", "黑格尔哲学核心术语"),
    ("定在", "Dasein", "黑格尔《逻辑学》中「存在」与「无」经由「变易」沉淀而成的有规定性的存在，即「某物」。", "黑格尔哲学核心术语"),
    ("绝对精神", "Absoluter Geist", "黑格尔精神哲学最高阶段，主体与客体、无限与有限达到完全和解，依次表现为艺术、宗教与哲学。", "黑格尔哲学核心术语"),
    ("绝对理念", "Absolute Idee", "黑格尔《逻辑学》的终点，概念与实在、主观与客观、理论理念与实践理念的辩证统一。", "黑格尔哲学核心术语"),
    ("理性的狡计", "List der Vernunft", "黑格尔历史哲学概念，指世界理性借助历史人物的个人激情与私利相互抵消，却在背后实现普遍历史目的。", "黑格尔哲学核心术语"),
    ("主奴辩证法", "Herr-Knecht-Dialektik", "《精神现象学》自我意识章核心环节：主人通过奴隶间接占有物，反而在劳动与畏惧中由奴隶获得真正的自我意识与独立性。", "黑格尔哲学核心术语"),
    ("伦理生活", "Sittlichkeit", "黑格尔《法哲学原理》中高于抽象法与主观道德的客观自由领域，具体实现于家庭、市民社会与国家三环节。", "黑格尔哲学核心术语"),
    ("市民社会", "Bürgerliche Gesellschaft", "黑格尔与马克思分析现代社会的关键概念，指以个人需要体系、市场交换与司法行政为中介的特殊利益领域。", "德国古典与西马核心术语"),
    ("自在之物", "Ding an sich", "康德批判哲学概念，指独立于人类感性直观形式与知性范畴之外的物自身；它可被思议而不可被经验认识。", "康德哲学核心术语"),
    ("先验统觉", "Transzendentale Apperzeption", "康德《纯粹理性批判》中「我思」必须能够伴随我的一切表象的纯粹自我意识，是一切知识综合统一的最高根据。", "康德哲学核心术语"),
    ("先天综合判断", "Synthetische Urteile a priori", "康德认识论的核心问题：既扩展新知识（综合的）又具有普遍必然性（先天的）的判断，是数学与自然科学的基础。", "康德哲学核心术语"),
    ("定言命令", "Kategorischer Imperativ", "康德伦理学中无条件约束一切理性存在者的道德律：要只按照你同时认为也能成为普遍规律的准则去行动。", "康德哲学核心术语"),
    ("物化", "Verdinglichung / Reification", "卢卡奇《历史与阶级意识》核心范畴：在商品拜物教支配下，人与人的社会关系在意识中呈现为物与物的僵化属性与自然规律。", "西方马克思主义核心术语"),
    ("总体性", "Totalität / Totality", "卢卡奇等西马思想家强调的辩证方法论原则：只有将局部现象置于历史发展的具体总体关系中，才能把握其真实本质。", "西方马克思主义核心术语"),
    ("文化工业", "Kulturindustrie", "霍克海默与阿多诺《启蒙辩证法》提出的概念：大众文化按标准化工业流水线生产，将审美降格为麻痹批判意识的商品消费。", "法兰克福学派核心术语"),
    ("工具理性", "Instrumentelle Vernunft", "法兰克福学派批判的现代理性畸变形态：理性沦为只计算手段效率而不反思价值目的的支配与控制工具。", "法兰克福学派核心术语"),
    ("启蒙辩证法", "Dialektik der Aufklärung", "霍克海默与阿多诺核心命题：原本旨在破除神话与恐惧的启蒙理性，在追求对自然与人的绝对支配中反而重新堕落为新神话。", "法兰克福学派核心术语"),
    ("意识形态国家机器", "Appareils Idéologiques d'État", "阿尔都塞概念：与暴力镇压性国家机器相对，指学校、家庭、媒体、宗教等通过「询唤」将个体塑造成主体的制度网络。", "阿尔都塞核心术语"),
    ("单向度的人", "One-Dimensional Man", "马尔库塞对发达工业社会的批判：技术理性与虚假消费需求同化了一切否定性与批判维度，使人与社会丧失超越现存秩序的想象力。", "马尔库塞核心术语"),
    ("拟像", "Simulacre / Simulacrum", "鲍德里亚后现代理论核心概念：不再指涉任何「原初实在」的纯粹复制品与符号模型，最终先于并取代真实本身。", "鲍德里亚核心术语"),
    ("超真实", "Hyperréalité", "鲍德里亚概念：由媒介、代码与拟像建构出的比现实更加「真实」的仿真秩序，真实与虚构的界限由此彻底消融。", "鲍德里亚核心术语"),
    ("大他者", "Grand Autre (A)", "拉康精神分析核心概念：代表象征秩序、语言法则与无意识之场所，主体正是在大他者的能指场域中被建构并产生欲望。", "拉康精神分析核心术语"),
    ("对象a", "Objet petit a", "拉康概念：既非具体经验客体亦非镜中他者，而是驱动欲望不断运转的「欲望的对象-原因」与象征界无法完全吸收的剩余。", "拉康精神分析核心术语"),
    ("享乐", "Jouissance", "拉康概念：超越弗洛伊德「快乐原则」的极限快感，往往伴随痛苦、逾越与死亡驱力的张力。", "拉康精神分析核心术语"),
    ("象征界", "Le Symbolique", "拉康三界之一：由语言、能指链、社会律法与亲属结构构成的无意识秩序。", "拉康精神分析核心术语"),
    ("想象界", "L'Imaginaire", "拉康三界之一：源于镜像阶段，由视觉形象、自恋认同、误认与二元对立关系构成的领域。", "拉康精神分析核心术语"),
    ("实在界", "Le Réel", "拉康三界之一：抗拒一切符号化与想象捕捉的创伤性内核，是象征秩序中的裂隙与「不可能之物」。", "拉康精神分析核心术语"),
    ("此在", "Dasein", "海德格尔《存在与时间》核心概念：唯独人这种在自身存在中关切存在本身之意义的「在此存在者」。", "海德格尔现象学核心术语"),
    ("操心", "Sorge / Care", "海德格尔揭示的此在之整体存在结构：先行于自身、已经在世界之中、寓于世内照面的存在者。", "海德格尔现象学核心术语"),
    ("在世存在", "In-der-Welt-sein", "海德格尔用以破除主客二元对立的基本建构：此在并非装在容器里的主体，而是原初地敞开并栖居于意义世界之中。", "海德格尔现象学核心术语"),
    ("向死存在", "Sein zum Tode", "海德格尔概念：此在直面死亡这一最本己、无所关联、不可逾越的可能性，从而摆脱「常人」沉沦并进入本真决断。", "海德格尔现象学核心术语"),
    ("万有相通", "Interconnectedness", "张世英融合海德格尔存在论与中国天人合一传统提出的核心哲学理念：人我万物在审美与诗意境界中超越主客二分而彼此通达。", "张世英哲学核心术语"),
    ("解放心理学", "Psicología de la Liberación", "伊格纳西奥·马丁-巴罗创立的批判社会心理学：主张去意识形态化、恢复受压迫者的历史记忆，使心理学服务于社会解放而非既定权力。", "批判理论与解放心理学"),
]

COVER_PALETTES = {
    "古希腊与近代哲思": ["bronze-ivory", "prussian-navy", "slate-ochre", "forest-brass"],
    "古希腊与近代原典": ["bronze-ivory", "prussian-navy", "slate-ochre", "forest-brass"],
    "德国古典原典": ["obsidian-gold", "prussian-navy", "forest-brass", "burgundy-ivory", "slate-ochre"],
    "康德·费希特与谢林": ["obsidian-gold", "forest-brass", "burgundy-ivory", "slate-ochre", "prussian-navy"],
    "黑格尔原典与研究": ["prussian-navy", "obsidian-gold", "burgundy-ivory", "slate-ochre", "forest-brass"],
    "马克思与批判理论": ["crimson-ink", "terracotta-charcoal", "rust-parchment", "iron-amber"],
    "现象学与存在哲学": ["teal-obsidian", "cobalt-cream", "obsidian-gold", "slate-ochre"],
    "精神分析与后现代": ["indigo-silver", "plum-sand", "teal-obsidian", "cobalt-cream"],
    "张世英哲学全书": ["celadon-ink", "vermilion-paper", "forest-brass", "bronze-ivory"],
    "辞典与术语工具": ["emerald-gold", "bronze-ivory"],
    "辞典与通识百科": ["emerald-gold", "bronze-ivory", "teal-obsidian", "celadon-ink"],
}

MAX_CHAPTER_CHARS = 28000
EN_MAX_CHAPTER_CHARS = 65000
# 个别“文集/笔记/大型辞典”类书按合理篇幅分章，避免切碎或爆炸
BOOK_MAX_CHAPTER_CHARS = {
    "列宁哲学笔记（全集第38卷）": 100000,
    "Kant-Lexikon": 180000,
    "The Complete Works of John Locke": 95000,
}
CHUNK_TARGET_CHARS = 65000


# 常见 PDF 字体私用区/连字精准还原映射
PUA_RESTORE_MAP = {
    "\ue837": "抽",
    "\ue562": "ä",
    "\ue56e": "ö",
    "\ue7b2": "ό",
    "\uf867": "ῦ",
    "\uf824": "φ",
    "\ue4fe": "，",
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
}


def _tidy_cjk_spacing(s: str) -> str:
    """Collapse OCR spacing between CJK characters (headings only)."""
    s = re.sub(r'(第[零一二三四五六七八九十百千万0-9]+部)[ \t]+分', r'\1分', s)
    s = re.sub(r'(?<=[章篇卷部编节讲分])[ \t]+(?=[\u4e00-\u9fff])', '\u0001', s)
    s = re.sub(r'(?<=[\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])', '', s)
    s = s.replace('\u0001', ' ')
    s = re.sub(r'[ \t]+([：；，。！？、）】》」』”’])', r'\1', s)
    s = re.sub(r'([（【《「『“‘])[ \t]+', r'\1', s)
    return s.strip()


def _join_wrapped_lines(lines: list) -> str:
    """智能拼接段落内折行：中文/中文标点之间不插多余空格，拉丁词之间保留单空格。"""
    if not lines:
        return ""
    out = lines[0]
    for nxt in lines[1:]:
        if not nxt:
            continue
        if not out:
            out = nxt
            continue
        last_ch = out[-1]
        first_ch = nxt[0]
        if re.match(r'[A-Za-z0-9À-ÿ]', last_ch) and re.match(r'[A-Za-z0-9À-ÿ]', first_ch):
            out += " " + nxt
        elif last_ch == '-' and re.match(r'[a-z]', first_ch):
            # 修复英文断词连字符（如 mathemati- + cian）
            out = out[:-1] + nxt
        else:
            out += nxt
    return out


def _fix_unmatched_bold(line: str) -> str:
    """修复段落中未成对闭合的 ** 加粗符号，防止正文出现孤立星号。"""
    if line.count("**") % 2 == 1:
        # 若行首或行尾有孤立 **，优先去掉孤立端
        if line.strip().startswith("**") and not line.strip().endswith("**"):
            line = re.sub(r'^\s*\*\*\s*', '', line, count=1)
        elif line.strip().endswith("**") and not line.strip().startswith("**"):
            line = re.sub(r'\s*\*\*\s*$', '', line, count=1)
        else:
            # 去掉最后一个未闭合的 **
            idx = line.rfind("**")
            if idx >= 0:
                line = line[:idx] + line[idx + 2:]
    return line


def sanitize_book_text(text: str) -> str:
    """彻底清除书籍中的乱码、残留 HTML 标签（如 <a id="h8"></a>）、内部锚点链接、DuXiu 元数据、孤立页码与排版破损。"""
    if not text:
        return ""
    out = []
    for ch in text:
        cp = ord(ch)
        if ch in PUA_RESTORE_MAP:
            out.append(PUA_RESTORE_MAP[ch])
        elif 0xF761 <= cp <= 0xF77A:
            out.append(chr(cp - 0xF761 + ord("a")))
        elif 0xF730 <= cp <= 0xF739:
            out.append(chr(cp - 0xF730 + ord("0")))
        elif 0xE000 <= cp <= 0xF8FF or cp == 0xFFFD or cp == 0xFEFF:
            continue
        elif cp < 32 and ch not in ("\n", "\r", "\t"):
            continue
        else:
            out.append(ch)
    s = "".join(out)
    # 统一换行符与 CJK 兼容汉字（如 念 U+F9A3 -> 念）
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = unicodedata.normalize("NFC", s)

    # 1. 彻底清除残留 HTML/XML 标签（特别是 <a id="h8"></a>、<sup>1</sup>、<span>、<div>、注释等）
    s = re.sub(r'<!--[\s\S]*?-->', '', s)
    s = re.sub(r'<a\b[^>]*>\s*</a>', '', s, flags=re.I)
    s = re.sub(r'<a\b[^>]*>(.*?)</a>', r'\1', s, flags=re.I)
    s = re.sub(r'<sup\b[^>]*>\s*\[?\^?(\d{1,3})\]?\s*</sup>', r'[\1]', s, flags=re.I)
    s = re.sub(r'<sup\b[^>]*>(.*?)</sup>', r'\1', s, flags=re.I)
    s = re.sub(r'<sub\b[^>]*>(.*?)</sub>', r'\1', s, flags=re.I)
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'</?(?:strong|b)\b[^>]*>', '**', s, flags=re.I)
    s = re.sub(r'</?(?:em|i)\b[^>]*>', '*', s, flags=re.I)
    s = re.sub(r'</?(?:span|div|p|img|font|center|u|section|article|header|footer|nav|figure|figcaption|table|tr|td|th|ul|ol|li|blockquote|hr|h[1-6]|meta|link|style|script|small|big|abbr|cite|mark|del|ins)\b[^>]*>', '', s, flags=re.I)
    # 清除极少数未知尖括号伪标签（如 <paustis>），保留正常数学比较符
    s = re.sub(r'</?[a-zA-Z][a-zA-Z0-9_-]{2,24}(?:\s+[a-zA-Z_-]+="[^"]*")?\s*/?>', '', s)

    # 2. 解码 HTML 实体（&nbsp; &mdash; &ldquo; &amp; &#123; 等）
    s = html.unescape(s)
    s = s.replace('\u00a0', ' ')

    # 3. 清除 Markdown 内部锚点链接 [标题[2]](#h8) -> 标题[2]、破损图片、Pandoc 属性 {#id}、意外转义符号
    s = re.sub(r'!\[[^\]]*\]\([^\)]+\)', '', s)
    s = re.sub(r'\[((?:[^\[\]]|\[[^\]]*\])+)\]\(#[^\)]*\)', r'\1', s)
    s = re.sub(r'\[((?:[^\[\]]|\[[^\]]*\])+)\]\((?:file|local):[^\)]*\)', r'\1', s)
    s = re.sub(r'\{[#.][^\}\n]{1,60}\}', '', s)
    s = re.sub(r'\\([*_`\[\]#~])', r'\1', s)

    # 4. 清除 Anna's Archive / DuXiu / 超星扫描 PDF 元数据、盗版电子书广告、期刊下载页眉、出版社版权/ISBN/CIP/封底广告
    s = re.sub(r'(?im)^.*Document\s*generated\s*by\s*Anna[\'\u2019]?s\s*Archive.*$', '', s)
    s = re.sub(r'(?im)^.*Images\s*have\s*been\s*losslessly\s*embedded.*$', '', s)
    s = re.sub(r'(?im)^.*"filename"\s*:\s*"[^"]+".*"md5"\s*:\s*"[^"]+.*$', '', s)
    s = re.sub(r'(?im)^.*"filename_decoded"\s*:\s*"[^"]+.*$', '', s)
    s = re.sub(r'(?im)^.*\\u256c\\u2248.*$', '', s)
    s = re.sub(r'(?im)^.*pdg_main_pages.*$', '', s)
    s = re.sub(r'(?im)^.*\[G[eｅ]n[eｅ]ral\s*[Iilｌ]n[fｆ]o[rｒ]mat[iｉ]on\].*$', '', s)
    s = re.sub(r'(?im)^.*SS号\s*=\s*\d+.*$', '', s)
    s = re.sub(r'(?im)^.*(?:此页故意留白|本页有意留白|This page intentionally left blank)[。.]?\s*$', '', s)
    s = re.sub(r'(?im)^.*(?:读累了记得休息一会哦|公众号[：:]\s*古德猫宁李|电子书搜索下载|书友学习交流).*$', '', s)
    s = re.sub(r'(?im)^.*(?:The Delphi Classics Catalogue|©\s*Delphi Classics|By Delphi Classics).*$', '', s)
    s = re.sub(r'(?im)^.*(?:ISSN[：:]\s*0038-5883|期刊主页[：:]\s*http://www\.tandfonline|本文链接[：:]\s*http://dx\.doi\.org|向本刊投稿；查看相关文章；下载者|完整条款与条件见[：:]\s*http://www\.tandfonline).*$', '', s)
    s = re.sub(r'(?im)^G\.?\s*W\.?\s*F\.?\s*Hegel,\s*The Philosophy of History,?\s*\d*\s*$', '', s)
    s = re.sub(r'(?im)^.*(?:图书在版编目（CIP）数据|中国版本图书馆CIP数据核字|标准书号（Standard Book Number）|美国国会图书馆目录卡片号|Library of Congress Catalog).*$', '', s)
    s = re.sub(r'(?im)^.*(?:制作[：:].{1,30}营销[：:]|封面设计[：:]|纽约州立大学出版社\s*www\.sunypress\.edu).*$', '', s)
    s = re.sub(r'(?im)^.*(?:除为研究或私人学习目的.*版权、设计与专利法|大不列颠惠特斯特布尔石印有限公司).*$', '', s)
    s = re.sub(r'(?im)^.*p\.\s*cm\.[—\-–]+.*ISBN.*$', '', s)
    s = re.sub(r'(?im)^\s*ISBN(?:-13)?\s*[:：]?\s*[\d\-–X\s]{8,}(?:（[^）]{1,12}）)?\s*$', '', s)
    s = re.sub(r'(?m)^.*(?:“丛书”出版之初，即以封底颜色为别|集中体现了我馆“昌明教育，开启民智”|中华民族在伟大复兴的进程中，必将以更加开放的姿态).*$', '', s)
    s = re.sub(r'(?m)^.*379\s*[|｜I]\s*余论希望的哲学北京大学哲学教材系列.*$', '', s)
    # 清除常见出版社封底丛书广告与版权印刷声明
    s = re.sub(r'(?s)\n+(?:为多年使用而设计的多佛版！|北京大学哲学教材系列\s*\*|道德哲学的探索与反思张华夏)[\s\S]{0,2500}$', '', s)
    s = re.sub(r'(?s)\n+本版图书如有印装质量问题[\s\S]{0,400}$', '', s)
    s = re.sub(r'(?m)^.*(?:书号\s*ISBN|印\s*张\s*\d+\.\d+|版\s*次\s*\d{4}年\d{1,2}月第\d版).*$', '', s)

    # 5. 清除 PDF 缺字方块/异常符号噪声与扫描文件名水印
    s = re.sub(r'[■□◆▲▼●]{1,}\s*[•·]?\s*', '', s)
    s = re.sub(r'_\s*卜垚\s*\+', '', s)
    s = re.sub(r'(?m)^\s*￥{2,}\s*$', '---', s)
    s = re.sub(r'＿＿+[－\-]?', '——', s)
    s = re.sub(r'(?m)^\s*#*\s*\d{10,}\.pdf\s*$', '', s)
    s = re.sub(r'(?m)^\s*/\d+(?:\.\d+)?/?\s*$', '', s)

    # 5.5 清除插在中文词句中间的原版印刷页码标记（如《大逻辑》《小逻辑》中的 "普遍 **[17]** 者"），保留段首《精神现象学》Miller 节号 "**[1]** 在一部..."
    s = re.sub(
        r'(?<=[\u4e00-\u9fff，、；：（）“”《》a-zA-Z])[ \t]*\*\*\[\d{1,4}\]\*\*[ \t]*(?=[\u4e00-\u9fff，、；：（）“”《》a-zA-Z])',
        '',
        s,
    )
    # 修复德文标题 OCR 常见变音符号破损
    s = s.replace('Qualit?t', 'Qualität').replace('Quantit?t', 'Quantität').replace('Das MaB', 'Das Maß')
    s = re.sub(r'(?m)^(#+\s+A\.本质作为实存的根据)\(\s*Das Wesen\s*$', r'\1 (Das Wesen als Grund der Existenz)', s)

    # 6. 修复 OCR 常见单边书名号破损与确定性 OCR 错词
    s = re.sub(r'《([^《》\n]{1,36})>', r'《\1》', s)
    s = re.sub(r'<([^《》\n]{1,36})》', r'《\1》', s)
    s = s.replace('排尿“中介性”', '排斥“中介性”').replace('排尿任何中介性', '排斥任何中介性')
    s = s.replace('《情神现象学》', '《精神现象学》').replace('黑恪尔', '黑格尔').replace('黑格尔企崇', '黑格尔全集')
    s = s.replace('认填学习', '认真学习').replace('已并人', '已并入')
    s = s.replace('在艳对空间里', '在绝对空间里').replace('《哲学入门>》', '《哲学入门》')
    s = s.replace('进人主体', '进入主体').replace('进人我们的考察范围', '进入我们的考察范围')
    s = s.replace('进人现实性', '进入现实性').replace('进人实存', '进入实存')
    return s


def clean_preview(raw: str) -> str:
    s = sanitize_book_text(raw)
    s = re.sub(r'⟦fn:\d+⟧', '', s)
    s = re.sub(r'!\[([^\]]*)\]\([^)]+\)', '', s)
    s = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', s)
    s = re.sub(r'\[\^?\d+\]', '', s)
    s = re.sub(r'[*_`~#>]', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def is_front_matter_chapter(title: str, blocks: list) -> bool:
    """精确识别目录页、凡例、版权页、缩写索引等非实质正文章节，防止电台默认朗读目录。"""
    t = re.sub(r'[\s　·\-—:：()（）\[\]【】]', '', title).lower()
    if re.match(
        r'^(目录|目次|总目录|凡例|版权|版权页|版权信息|出版说明|缩写|缩写索引|索引|致谢|鸣谢|封面|书名|书名页|扉页|contents|tableofcontents|index|abbreviations|acknowledgements?|copyright)$',
        t,
    ):
        return True
    if t.startswith(("目录", "目次", "总目录")):
        return True

    non_empty = [b for b in blocks if b["y"] != "r" and len(b["t"].strip()) > 0]
    if not non_empty:
        return True
    # 如果 55% 以上块是列表项或短目录链接/页码行，判定为目录页
    toc_like = 0
    for b in non_empty:
        txt = b["t"].strip()
        if b["y"] == "l" and len(txt) < 90:
            toc_like += 1
        elif re.search(r'(\]\(#|[·…\.]{4,}\s*\d+$|/\s*\d+$)', txt):
            toc_like += 1
    if len(non_empty) >= 4 and (toc_like / len(non_empty)) >= 0.55:
        return True
    return False


PAGE_NUM_LINE_RE = re.compile(
    r'^(?:[-—–·•/\s]*\d{1,4}(?:\.\d+)?[-—–·•/\s]*|第\s*\d{1,4}\s*页|p\.\s*\d{1,4}|\[\s*\d{1,4}\s*\])$',
    re.I,
)

FALSE_HEADING_PROSE_RE = re.compile(
    r'^(?:'
    r'[）)，。、》…]+|'
    r'\d{4}$|'
    r'第[零一二三四五六七八九十百0-9]+[章节讲篇部]\s*(?:[）)]|就不可能|所谈|只有|在这些|也作了|第一自然段|第二自然段|法创造|三段式去从事)|'
    r'第一节[。.]?$|'
    r'(?:第一|第二|第三)部分.{0,45}(?:是关于|这个词源于)|'
    r'1\.第一个得到考察的无条件者是灵魂|'
    r'§\s*\d+\)|'
    r'引言：两个主张本文|'
    r'此页故意留白|本页有意留白|'
    r'读累了记得休息一会哦|'
    r'G\.\s*W\.\s*F\.\s*黑格尔，'
    r')'
)


def is_valid_heading_text(t: str, lang: str = "zh") -> bool:
    """严格判别是否为真实章节标题，将误识为标题的叙述句碎片自动降级为正文段落。"""
    s = t.strip()
    if not s or PAGE_NUM_LINE_RE.match(s):
        return False
    if FALSE_HEADING_PROSE_RE.match(s):
        return False
    if lang == "en":
        if len(s) > 135:
            return False
        if len(s) > 55 and s.endswith((".", ",", ";")) and not re.match(r'^(?:Chapter|Section|Book|Part|\d+\.)', s, re.I):
            return False
        if re.search(r'([·…\.]{3,}\s*\d*\s*$)', s):
            return False
        return True
    # 以 "1." / "2." / "I." 开头的长叙述句（如《小逻辑》误标为 # 的正文列举句）降级为正文
    if re.match(r'^(?:\d+|[IVX]+)\.\s*', s) and (
        len(s) >= 30
        and (any(p in s for p in ('，', '。', '；', '（', '(', '“', '"', '——', '[')) or s.endswith((',', '，', '必', '的', '是', '就', '在', '这', '那', '出', '并')))
    ):
        return False
    # 以引号开头且含句内标点的长引文句子不是标题（如《列宁哲学笔记》摘录句）
    if s.startswith(('“', '「')) and len(s) >= 16 and any(p in s for p in ('，', '。', '…', '；')):
        return False
    # 含句号或逗号结尾的完整叙述句不是标题（保留莱布尼茨《形而上学论》“一、...”命题式节题）
    if len(s) > 20 and s.endswith(("。", "，", "；", ",")) and not re.match(r'^[一二三四五六七八九十百]+、', s):
        return False
    if len(s) > 68:
        return False
    # 纯带页码目录项（如 "... / 59" 或 "... ···（2）" 或 "...（12）"，排除四位数年份如 "第一版序言（1817）"）
    if re.search(r'([·…\.]{3,}\s*\d*\s*$|/\s*\d{1,3}\s*$|（\d{1,3}）\s*$|\(\d{1,3}\)\s*$)', s):
        return False
    return True


def format_clean_title(raw: str, lang: str = "zh") -> str:
    """规范化章节目录标题：清除上标角标、尾部页码、多余句号、OCR 破折号与多余截断。"""
    s = clean_preview(raw)
    if lang == "en":
        s = re.sub(r'[⁰¹²³⁴⁵⁶⁷⁸⁹①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]+', '', s)
        s = re.sub(r'\s+', ' ', s).strip().rstrip(',;')
        if len(s) > 120:
            window = s[:120]
            cut = window.rfind(' ')
            s = (window[:cut] if cut >= 50 else window[:114]).rstrip(' ·—-:,;(') + '…'
        return s or "Section"
    # 清除 Unicode 上标数字、康德英译编者注字母（ᵃᵇᶜ）、圆圈注码（①②…）、尾部孤立注释字母（如 "经验的类比c，"）与孤立 <
    s = re.sub(r'[⁰¹²³⁴⁵⁶⁷⁸⁹ᵃᵇᶜᵈᵉᶠ①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]+', '', s)
    s = re.sub(r'([a-z])[,，]\s*$', '', s)
    s = re.sub(r'\s*<\s*(?=[\u4e00-\u9fff])', ' ', s)
    s = re.sub(r'^\d{1,3}\s*(后记|前言|序言|导言|导论|附录)', r'\1', s)
    s = re.sub(r'[\s·\.…\-—]*\d{2,4}\s*$', lambda m: m.group(0) if re.search(r'(?:1[6-9]\d{2}|20\d{2}|第\s*\d+|§\s*\d+|卷|年)', s) else '', s)
    s = s.replace('-——', '——').replace('一-', '——').replace('-—', '——')
    s = re.sub(r'[。，,；;]+$', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    if len(s) > 80:
        # 保留完整学术标题；仅在确实过长时于最后一个自然停顿处截断
        window = s[:80]
        cut = max(window.rfind(ch) for ch in "；;。，,")
        if cut >= 30:
            s = window[:cut].rstrip(" ·—-：（(") + "…"
        else:
            s = window[:74].rstrip(" ·—-：（(") + "…"
    return s or "正文"


PURE_NON_BODY_TITLE_RE = re.compile(
    r'^(?:'
    r'目录|目次|总目录|分卷目录|详细目录|德文目录|德文目录续|各卷书目|'
    r'封面|书名|书名页|扉页|封底|英文版封底|版权|版权页|版权信息|图书在版编目|cip|'
    r'凡例|出版说明|出版者说明|编辑说明|编写说明|体例说明|编辑体例与标准缩写|征引方式与缩写|文献来源与缩写说明|关于转录的说明|'
    r'汉译世界学术名著丛书分科本出版说明|汉译世界学术名著丛书出版说明|'
    r'缩写|缩写表|缩写索引|缩略语|缩略语表|简写表|'
    r'致谢|鸣谢|插图|插图目录|索引|索引续\d*|人名索引|主题索引|概念索引|术语索引|列宁所引文献索引|资料来源索引|三篇论文索引|'
    r'丛书书目|剑桥哲学史丛书|如何阅读丛书|丛书主编序我该如何阅读如何阅读|'
    r'作者简介|作者与译者简介|导论作者简介|georglukács|georglukacs|读累了记得休息一会哦|'
    r'contents|tableofcontents|copyright|titlepage|cover|acknowledgements?|abbreviations|index|'
    r'seriescontents|alsointhisseries|thedelphiclassicscatalogue'
    r')$',
    re.I,
)


COPY_MARK_RE = re.compile(
    r'未经出版者书面许可|All rights reserved|版权所有|ISBN|图书在版编目|CIP|'
    r'德国国家图书馆|Library of Congress|出版者书面许可|State University of New York Press|'
    r'Cambridge University Press|Printed in|出版发行|定价|©'
)


def is_prunable_non_body_chapter(title: str, blocks: list, is_reference_book: bool = False, keep_index: bool = False) -> bool:
    """判定是否为可彻底剔除的无关正文冗余章节（版权/封面/封底/纯目录/致谢/凡例/缩写/索引/丛书广告）。"""
    t_norm = re.sub(r'[\s　·\-—:：()（）\[\]【】《》「」“”"\'.,，。~]', '', title).lower()
    if keep_index and '索引' in t_norm:
        return False
    if is_reference_book and ('索引' in t_norm or '体例' in t_norm or '缩写' in t_norm):
        return False
    if any(k in t_norm for k in (
        'culturalmemoryinthepresent', '当下的文化记忆丛书', 'delphiclassics',
        '汉译世界学术名著丛书', '剑桥哲学史丛书', '读累了记得休息一会哦', '德文目录', '英文版封底',
        '术语部分主题索引', '三篇论文索引', '德尔斐古典丛书目录', 'alphabeticallistoftitles',
    )):
        return True
    if t_norm in (
        'seriescontents', 'alsointhisseries', 'copyright', '封底', '封面', '版权页', '版权信息', '版权',
        '书名', '书名页', '扉页', '插图', '索引', '人名索引', '主题索引', '概念索引', '术语索引',
        '列宁所引文献索引', '资料来源索引', '三篇论文索引', '丛书书目', '作者简介', '作者与译者简介',
        '导论作者简介', '如何阅读丛书', '关于转录的说明', '各卷书目', '编辑体例与标准缩写',
        '征引方式与缩写', '简写表', '缩写', '缩写表', '缩写索引', 'georglukács', 'georglukacs',
    ) or re.match(r'^索引续\d+$', t_norm):
        return True

    # 对目录/致谢/凡例/编辑说明/文献来源与缩写说明，确认里面没有被误吞的大段正文再安全剔除
    if PURE_NON_BODY_TITLE_RE.match(t_norm) or t_norm.startswith(('目录', '目次', '总目录')):
        prose_paras = [
            b for b in blocks
            if b["y"] == "p" and len(b["t"].strip()) >= 80
            and not re.search(r'\d{2,3}\s*$', b["t"].strip())
        ]
        prose_chars = sum(len(b["t"]) for b in prose_paras)
        # 目录章里若夹着两段以上、合计 400 字以上的实质正文（如《纯粹理性批判》剑桥版
        # 译者导言被 TOC 吞进首章），必须保留并交给上层拆解，绝不整章误删。
        joined = "\n".join(b["t"] for b in blocks)
        # 目录章吞进来的若只是版权/CIP/出版社地址（无标题、无译者前言），仍应剔除；
        # 有译者前言/导言或实质正文标题的则保留。
        if (
            t_norm.startswith(('目录', '目次', '总目录'))
            and not any(b["y"] == "h" for b in blocks)
            and len(COPY_MARK_RE.findall(joined)) >= 2
            and len(joined) < 2500
            and not re.search(r'译者前言|译者导言|译序|前言|导言', joined)
        ):
            return True
        if t_norm.startswith(('目录', '目次', '总目录')) and len(prose_paras) >= 2 and prose_chars >= 400:
            return False
        if t_norm.startswith(('目录', '目次', '总目录')) and prose_chars > 2800:
            return False
        if t_norm in ('致谢', '鸣谢', '凡例', '编辑说明', '出版说明', '文献来源与缩写说明') and prose_chars > 12000:
            return False
        return True

    # 极短原书目录碎片（如《理性的毁灭》前几条含页码的短 TOC 章节）与纯英文封面目录（如《洛克全集》The Complete Works of ... Contents）
    joined = "\n".join(b["t"] for b in blocks)
    if len(joined) < 420 and (
        re.search(r'(?:第一章|第二章|第三章|第四章|第五章|第六章)\s+.{2,28}\s+\d{2,3}\b', joined)
        or len(re.findall(r'\b\d{2,3}\s*$', joined, re.M)) >= 2
    ):
        return True
    if t_norm == '序言与导读' and re.search(r'The Complete Works of[\s\S]{0,120}Contents', joined, re.I):
        return True

    # 仅含极短版权/ISBN/SS号/盗版广告块的杂章
    if len(joined) < 1600 and re.search(r'(图书在版编目|ISBN\s*[\d\-–X]{8,}|All rights reserved|SS号=|出版发行.*印刷|古德猫宁李|Delphi Classics)', joined, re.I):
        return True
    return False


def parse_markdown_to_blocks(md_text: str, lang: str = "zh") -> list:
    md_text = sanitize_book_text(md_text)
    # Consecutive GitHub-style footnote definitions ([^1]: ... [^2]: ...)
    # are often written without blank lines. Split them so each definition
    # becomes its own block and can be parsed/folded individually.
    md_text = re.sub(r'(?m)(?<=\S)\n(?=\[\^\d+\]:)', '\n\n', md_text)
    blocks = []
    lines = md_text.splitlines()
    i = 0
    n = len(lines)
    in_notes_sec = False
    notes_sec_lvl = 99
    ol_counter = 0
    ol_active = False

    while i < n:
        stripped = lines[i].strip()
        if not stripped:
            i += 1
            continue

        # 跳过孤立页码行（如 "123"、"- 45 -"、"第 18 页"）
        if PAGE_NUM_LINE_RE.match(stripped):
            i += 1
            continue

        if re.match(r'^(\*{3,}|-{3,}|_{3,})$', stripped):
            blocks.append({"y": "r", "t": ""})
            i += 1
            continue

        m_h = re.match(r'^(#{1,6})\s+(.+)$', stripped)
        if m_h:
            lvl = len(m_h.group(1))
            raw_h = _fix_unmatched_bold(re.sub(r'\s+#+$', '', m_h.group(2).strip()))
            t = raw_h.strip() if lang == "en" else _tidy_cjk_spacing(raw_h)
            if not t or PAGE_NUM_LINE_RE.match(t):
                i += 1
                continue
            if lang == "zh" and re.search(r'([·…\.]{3,}\s*\d*\s*$|/\s*\d{1,3}\s*$|（\d{1,3}）\s*$|\(\d{1,3}\)\s*$)', t):
                blocks.append({"y": "l", "t": t})
            elif not is_valid_heading_text(t, lang=lang):
                # 误识为标题的叙述句碎片安全降级为正文段落，既不丢字也不污染目录！
                blocks.append({"y": "p", "t": t})
            else:
                blocks.append({"y": "h", "l": lvl, "t": t})
                t_clean_h = re.sub(r'[①-⑳⁰¹²³⁴⁵⁶⁷⁸⁹\s]+$', '', t).strip()
                if (
                    re.search(r'(?:注释|译者注|译注|尾注|脚注|编辑说明)$', t_clean_h)
                    or t_clean_h in ('注', '原注', '编者注', '编者注释')
                ) and '各种注释' not in t_clean_h:
                    in_notes_sec = True
                    notes_sec_lvl = lvl
                elif in_notes_sec and lvl <= notes_sec_lvl:
                    in_notes_sec = False
                    notes_sec_lvl = 99
                ol_counter = 0
                ol_active = False
            i += 1
            continue

        if stripped.startswith('>'):
            q_lines = []
            while i < n and lines[i].strip().startswith('>'):
                ql = _fix_unmatched_bold(re.sub(r'^>\s?', '', lines[i].strip()))
                if ql and not PAGE_NUM_LINE_RE.match(ql):
                    q_lines.append(ql)
                i += 1
            q_text = "\n".join(x for x in q_lines if x.strip())
            if q_text:
                blocks.append({"y": "q", "t": q_text})
            if not in_notes_sec:
                ol_counter = 0
                ol_active = False
            continue

        if '|' in stripped and i + 1 < n and re.match(r'^[\s|:\-]+$', lines[i + 1].strip()) and '-' in lines[i + 1]:
            tbl_lines = []
            while i < n and '|' in lines[i].strip() and lines[i].strip():
                tbl_lines.append(lines[i].strip())
                i += 1
            if len(tbl_lines) >= 2:
                blocks.append({"y": "t", "t": "\n".join(tbl_lines)})
            continue

        if re.match(r'^([-*+]|\d+\.)\s+', stripped):
            while i < n and re.match(r'^([-*+]|\d+\.)\s+', lines[i].strip()):
                cur_ln = lines[i].strip()
                m_ol = re.match(r'^(\d+)\.\s+(.*)$', cur_ln)
                if m_ol:
                    raw_num = int(m_ol.group(1))
                    item_txt = _fix_unmatched_bold(m_ol.group(2))
                    pks = [
                        int(x)
                        for x in re.findall(
                            r'(?:^|(?<=[。.”’）)》」』])\s*|(?<=[\.\!\?])\s+)(\d{1,3})\.\s+',
                            item_txt,
                        )
                    ]
                    if raw_num == 1 and (ol_active or in_notes_sec) and ol_counter >= 1:
                        ol_counter += 1
                    elif raw_num > 1 and ol_counter >= raw_num and in_notes_sec:
                        # Handle occasional sub-item number or OCR digit glitch gracefully if needed
                        ol_counter = raw_num
                    else:
                        ol_counter = raw_num
                    if in_notes_sec and raw_num == 1 and pks:
                        if (len(pks) >= 2 and pks[1] == pks[0] + 1) or (pks[0] == ol_counter + 1):
                            if pks[0] - 1 >= 1:
                                ol_counter = pks[0] - 1
                    emit_num = ol_counter
                    ol_active = True
                    # Track inline packed `2. ... 3. ... 4. ...` numbers inside the same Pandoc line
                    for k in pks:
                        if ol_counter < k <= ol_counter + 20:
                            ol_counter = k
                    if item_txt and not PAGE_NUM_LINE_RE.match(item_txt):
                        blocks.append({"y": "l", "t": f"{emit_num}. {item_txt}"})
                else:
                    ol_counter = 0
                    ol_active = False
                    item_txt = _fix_unmatched_bold(re.sub(r'^[-*+]\s+', '', cur_ln))
                    if item_txt and not PAGE_NUM_LINE_RE.match(item_txt):
                        blocks.append({"y": "l", "t": item_txt})
                i += 1
            continue

        p_lines = [stripped]
        i += 1
        while i < n:
            nxt = lines[i].strip()
            if not nxt:
                break
            if PAGE_NUM_LINE_RE.match(nxt):
                i += 1
                continue
            if re.match(r'^(#{1,6}\s+|>|[-*+]\s+|\d+\.\s+|\*{3,}|-{3,}|_{3,})', nxt):
                break
            if '|' in nxt and i + 1 < n and re.match(r'^[\s|:\-]+$', lines[i + 1].strip()):
                break
            p_lines.append(nxt)
            i += 1
        para = _fix_unmatched_bold(_join_wrapped_lines(p_lines))
        # 段首 Miller 节号 **[435]** 仅是段落编号，去掉但不与上一行合并；保留非加粗行首 [1] 学术注脚定义！
        para = re.sub(r'^\*\*\[\d{1,4}\]\*\*[ \t]*', '', para)
        if para and not PAGE_NUM_LINE_RE.match(para):
            blocks.append({"y": "p", "t": para})
            if not in_notes_sec:
                ol_counter = 0
                ol_active = False

    return heal_broken_paragraphs(blocks, lang=lang)


NO_MERGE_START_RE = re.compile(
    r'^(?:'
    r'\*\*\[\d{1,4}\]\*\*|'
    r'\[\^?(?:注|译注)?\d{1,3}\]|'
    r'[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|'
    r'【(?:译注|注|按|编者按|附释|说明)】|'
    r'\[(?:附释|说明|补遗|按)\]|'
    r'(?:注释|译注|校注|原注|编者注|注)\s*\d*[：:.、\s]|'
    r'§\s*\d+|'
    r'第[零一二三四五六七八九十百0-9]+[章节篇卷回讲部]|'
    r'(?:写于|按手稿刊印|最初发表于|首次发表于|伯尔尼[：:]|译自|选自|载于|署名[：:])|'
    r'(?:19|20)\d{2}年(?:首次发表|最初发表|发表)|'
    r'（[一二三四五六七八九十0-9]+）|'
    r'[一二三四五六七八九十]+、|'
    r'\(\d{1,2}\)|'
    r'\[\^[^\]]+\]:|'
    r'\*\*.+\*\*$|'
    r'[A-Z]\.\s'
    r')'
)

MID_SENTENCE_END_CHARS = set('，,、的是一了着之而与和或但即则以于为被把将这那其不也就都所使由从向对至及若如（(“「《—-')


def _is_mid_sentence_break(a: str, b: str) -> bool:
    """判断两个相邻正文段落 A -> B 是否因 PDF/OCR 硬折行导致的句中强断。"""
    sa = re.sub(r'(?:⟦fn:\d+⟧|[①-⑳⁰¹²³⁴⁵⁶⁷⁸⁹]|\s)+$', '', a.strip()).strip()
    sb = re.sub(r'^(?:⟦fn:\d+⟧|\s)+', '', b.strip()).strip()
    if not sa or not sb:
        return False
    if NO_MERGE_START_RE.match(sb):
        return False
    if NO_MERGE_START_RE.match(sa) and len(sa) < 28 and not re.search(r'[，,；：、]', sa):
        return False
    # 若续行以不可能开启新段落的中文助词或闭合标点开头（如 "的逻辑学..."、"）..."），必然是断行延续
    if sb[0] in '的了着得、，。；：）)”』》':
        return True
    # 末尾已经是完整句末标点时，不判定为句中断行
    if sa[-1] in '。！？!?…．':
        return False
    # 含未闭合引号或括号且下一段不是新节/注释，必然是同段断行
    if (sa.count('“') > sa.count('”') or sa.count('（') > sa.count('）') or sa.count('《') > sa.count('》')) and len(sa) >= 8:
        return True
    # 短于 12 字且未以典型虚词/逗号结尾的，保留为独立短行（如诗句、署名、日期、小标题）
    if len(sa) < 12 and sa[-1] not in MID_SENTENCE_END_CHARS:
        return False
    # 末尾为中文字符、逗号、顿号、开括号、连字符或英文/数字/闭括号（且续行以中文、英文或方括号注释开头）
    if re.search(r'[\u4e00-\u9fff，,、：（(“「《—\-]$', sa):
        # 冒号结尾且下一段很短/引语式时不强并，冒号前超过 24 字且续行非编号时才合并
        if sa[-1] == '：' and len(sa) < 24:
            return False
        return True
    if re.search(r'[a-zA-Z0-9）\)]$', sa) and re.match(r'^[a-zA-Z0-9\u4e00-\u9fff［\[（(“]', sb):
        return True
    return False


def _heal_english_paragraphs(blocks: list) -> list:
    """英文原典温和断行修复：仅合并明显断词连字符或句中无标点且下段小写续接的 PDF 折行，绝不误并正常英文段落。"""
    if not blocks:
        return blocks
    out = []
    for blk in blocks:
        if blk.get("y") != "p":
            out.append(blk)
            continue
        cur_t = (blk.get("t") or "").strip()
        if not cur_t:
            continue
        if out and out[-1].get("y") == "p":
            prev_t = out[-1]["t"].strip()
            # 1) 断词连字符（word- + continuation）
            if prev_t.endswith("-") and len(prev_t) >= 3 and prev_t[-2].isalpha() and cur_t[0].islower():
                out[-1]["t"] = _fix_unmatched_bold(prev_t[:-1] + cur_t)
                continue
            # 2) 上段以普通字母/逗号结尾（非句末标点）且下段以小写字母开头，且上段非极短标题行
            if (
                len(prev_t) >= 45
                and prev_t[-1] not in '.!?:;”"\'’)]—–'
                and (prev_t[-1].isalpha() or prev_t[-1] == ',')
                and cur_t[0].islower()
            ):
                out[-1]["t"] = _fix_unmatched_bold(prev_t + " " + cur_t)
                continue
        nb = {"y": "p", "t": cur_t}
        if blk.get("f"):
            nb["f"] = list(blk["f"])
        out.append(nb)
    return out


def heal_broken_paragraphs(blocks: list, lang: str = "zh") -> list:
    """修复全库因 PDF/OCR 按视觉行宽插入空行导致的句中断裂与阶梯缩进问题（零丢字，完整保留并重映注脚）。"""
    if not blocks:
        return blocks
    if lang == "en":
        return _heal_english_paragraphs(blocks)
    # 预处理：若某段正文 p 在句中未完结处被一个浮动小标题 h 切断，且 h 紧随的下一段 p 恰好是该句的后半截，
    # 则先将该句后半截归还到前段，再放置小标题 h（同时将“注释里面已经指出……”这类伪标题还原为 p）
    blocks = [dict(b) for b in blocks]
    for b in blocks:
        if b.get("y") == "h":
            ht = (b.get("t") or "").strip()
            if ht.startswith("注释里面") or (len(ht) > 22 and "，" in ht and not re.match(r"^(?:第[一二三四五六七八九十0-9]+[章节篇部讲]|[一二三四五六七八九十0-9]+[、\.\s])", ht)):
                b["y"] = "p"
                b.pop("l", None)
    idx_sw = 0
    while idx_sw + 2 < len(blocks):
        b0, b1, b2 = blocks[idx_sw], blocks[idx_sw + 1], blocks[idx_sw + 2]
        if b0.get("y") == "p" and b1.get("y") == "h" and b2.get("y") == "p":
            if _is_mid_sentence_break(b0.get("t") or "", b2.get("t") or ""):
                blocks[idx_sw + 1], blocks[idx_sw + 2] = b2, b1
                continue
        idx_sw += 1
    out = []
    # 记录当前段落合并了多少条视觉行，以及上一条原始行长度，用以修复硬折行区里恰好落在行末的句号
    merged_runs = 0
    last_raw_len = 0
    for blk in blocks:
        if blk["y"] != "p":
            out.append(blk)
            merged_runs = 0
            last_raw_len = 0
            continue
        cur_t = blk["t"].strip()
        if not cur_t:
            continue
        if out and out[-1]["y"] == "p":
            prev_t = out[-1]["t"]
            should_merge = _is_mid_sentence_break(prev_t, cur_t)
            # 额外处理：处于连续 PDF 固定列宽折行带内（>=2 行已拼接），上一原始行恰满 22-38 字且以句号收尾，
            # 而当前行也是 12-38 字且未以句末标点结尾的硬折行片段，合并回同段！
            if (
                not should_merge
                and merged_runs >= 2
                and 22 <= last_raw_len <= 38
                and prev_t.endswith(('。', '”', '）'))
                and not NO_MERGE_START_RE.match(cur_t)
                and 12 <= len(cur_t) <= 38
                and cur_t[-1] not in '。！？!?…'
            ):
                should_merge = True
            if should_merge:
                bf = blk.get("f") or []
                if bf:
                    pf = out[-1].setdefault("f", [])
                    base = len(pf)
                    cur_t_mapped = re.sub(r'⟦fn:(\d+)⟧', lambda m: f'⟦fn:{base + int(m.group(1))}⟧', cur_t)
                    pf.extend(bf)
                else:
                    cur_t_mapped = cur_t
                out[-1]["t"] = _fix_unmatched_bold(_join_wrapped_lines([prev_t, cur_t_mapped]))
                merged_runs += 1
                last_raw_len = len(cur_t)
                continue
        nb = {"y": "p", "t": cur_t}
        if blk.get("f"):
            nb["f"] = list(blk["f"])
        out.append(nb)
        merged_runs = 0
        last_raw_len = len(cur_t)
    return out


def _load_foreign_gloss_map() -> dict:
    merged = {}
    for fname in ("foreign_gloss_map.json", "inline_foreign_gloss_map.json"):
        p = Path(__file__).parent / fname
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    for k, v in data.items():
                        if isinstance(v, str) and v.strip():
                            merged[k] = v.strip()
            except Exception:
                pass
    return merged


FOREIGN_GLOSS_MAP = {}


def inject_foreign_glosses(blocks: list, is_reference_book: bool = False) -> list:
    """为正文中的独立未译外语引文/诗句/原话自动附带精准中文【译注】块。"""
    if is_reference_book or not FOREIGN_GLOSS_MAP:
        return blocks
    out = []
    for idx, b in enumerate(blocks):
        out.append(b)
        if b["y"] == "r":
            continue
        t = b["t"].strip()
        if not t:
            continue
        key = hashlib.sha1(t.encode("utf-8")).hexdigest()[:16]
        gloss = (FOREIGN_GLOSS_MAP.get(key) or "").strip()
        if gloss:
            # 避免重复插入
            nxt_t = blocks[idx + 1]["t"] if idx + 1 < len(blocks) else ""
            if "【译注】" not in nxt_t:
                out.append({"y": "q", "t": f"【译注】{gloss}"})
    return out


BOILERPLATE_BLOCK_RE = re.compile(
    r'^(?:Copyright\s*©|经许可使用的摘录|版权所有。本电子书|本电子书的大英图书馆|'
    r'初版于\s*\d{4}\s*年由.*出版；本电子书版|'
    r'斯拉沃热·齐泽克依据.*版权|All rights reserved\.?$|ISBN\s*[\d\-–X]{8,})',
    re.I,
)


def _drop_boilerplate_blocks(blocks: list) -> list:
    """Drop standalone copyright/permissions/publisher boilerplate paragraphs."""
    out = []
    for b in blocks:
        t = (b.get('t') or '').strip()
        if b.get('y') == 'h' and re.fullmatch(r'版权信息|版权页|版权|出版信息', t):
            continue
        if (b.get('y') in ('p', 'q', 'l') and len(t) < 400
                and t.rstrip().endswith('CIP')
                and re.search(r'\b(?:I|II|III)\.', t)):
            continue
        if b.get('y') in ('p', 'q', 'l') and re.match(r'^[A-Z][A-Za-z]+ (Publications|Press|Books),', t):
            continue
        if b.get('y') in ('p', 'q', 'l') and len(t) < 1200 and BOILERPLATE_BLOCK_RE.match(t):
            continue
        out.append(b)
    return out


def _merge_orphan_punctuation(blocks: list) -> list:
    """Merge body blocks that begin with closing punctuation into the previous body block.

    OCR/EPUB line splitting sometimes leaves a paragraph starting with "，。；：、！？）》」』”’".
    Such a block is a continuation, not a new paragraph; merging restores reading flow and
    keeps footnote indices consistent.
    """
    out = []
    for b in blocks:
        t = (b.get('t') or '').strip()
        if out and b.get('y') in ('p', 'q', 'l') and re.match(r'^[，。；：、！？）》」』”’]', t):
            prev = out[-1]
            if prev.get('y') in ('p', 'q', 'l'):
                bf = b.get('f') or []
                if bf:
                    pf = prev.setdefault('f', [])
                    base = len(pf)
                    t = re.sub(r'⟦fn:(\d+)⟧', lambda m: f'⟦fn:{base + int(m.group(1))}⟧', t)
                    pf.extend(bf)
                prev['t'] = (prev.get('t') or '').rstrip() + t
                continue
        out.append(b)
    return out


def _strip_runin_titles(blocks: list) -> list:
    """Remove a chapter run-in title glued to the first paragraph (e.g. EPUB headings repeated in text)."""
    _stop = set('是也使可就则即为在有把被而但并或与及其这那意指称所谓若如虽因由从对向于之的等以，。、；：？！））」』”’')
    out, last_h = [], None
    for b in blocks:
        t = (b.get('t') or '').strip()
        if b.get('y') == 'h':
            last_h = t
            out.append(b)
            continue
        if last_h and len(last_h) >= 4 and t.startswith(last_h):
            rem = t[len(last_h):]
            if rem and rem[0] not in _stop:
                nb = dict(b)
                nb['t'] = rem.lstrip(' 　')
                out.append(nb)
                continue
        out.append(b)
    return out


def split_blocks_into_chapters(all_blocks: list, book_title: str, is_reference_book: bool = False, lang: str = "zh") -> list:
    if not all_blocks:
        return [{"title": "Text" if lang == "en" else "正文", "level": 1, "blocks": []}]

    if lang != "en":
        all_blocks = inject_foreign_glosses(all_blocks, is_reference_book=is_reference_book)
    all_blocks = _drop_boilerplate_blocks(all_blocks)
    all_blocks = _merge_orphan_punctuation(all_blocks)
    if lang != "en":
        all_blocks = _strip_runin_titles(all_blocks)
    keep_index = book_title in ("哲学史讲演录", "列宁哲学笔记（全集第38卷）")

    # 清除特定德文原版全集边码/书页夹码 `[16]` / `**[17]**` / `[3]`（《大逻辑》《小逻辑》《神话哲学》，不影响别书 `[n]` 脚注）
    if book_title in ("大逻辑（逻辑学）", "小逻辑", "神话哲学历史批判导论"):
        for b in all_blocks:
            bt = b.get("t") or ""
            if "[" in bt:
                bt = re.sub(
                    r'(?<=[\u4e00-\u9fff，、；：（）“”《》a-zA-Z.!?;。！？])[ \t]*\[\d{1,4}\][ \t]*(?=[\u4e00-\u9fff，、；：（）“”《》a-zA-Z0-9（“「])',
                    '',
                    bt,
                )
                bt = re.sub(r'^\[\d{1,4}\][ \t]*', '', bt)
                bt = re.sub(r'[ \t]*\[\d{1,4}\]$', '', bt)
                b["t"] = bt.strip()

    # 针对《西方哲学史（张世英）》等无显式 Markdown 标题的通史文本，自动识别主时期标题
    h_counts = {lvl: sum(1 for b in all_blocks if b["y"] == "h" and b.get("l") == lvl) for lvl in range(1, 7)}
    if sum(h_counts.values()) <= 2:
        promoted = []
        for b in all_blocks:
            t = b["t"].strip()
            if (
                b["y"] == "p"
                and 3 <= len(t) <= 22
                and re.match(
                    r'^(古希腊哲学|古希腊罗马哲学|中世纪哲学|文艺复兴时期哲学|近代哲学|英国经验论|大陆唯理论|法国启蒙哲学|德国古典哲学|现代西方哲学|分析哲学|现象学|存在主义|实用主义|历史哲学|第[一二三四五六七八九十]+章.*)$',
                    t,
                )
            ):
                promoted.append({"y": "h", "l": 2, "t": t})
            else:
                promoted.append(b)
        all_blocks = promoted
        h_counts = {lvl: sum(1 for b in all_blocks if b["y"] == "h" and b.get("l") == lvl) for lvl in range(1, 7)}

    # 动态决定分章标题级别：确保诸如《关于人类自由之本质的哲学探究》(H5/H6) 或《哲学的非意识形态化危机》(H3) 不被吞入“目录”！
    def count_body_headings(levels: set) -> int:
        cnt = 0
        for b in all_blocks:
            if b["y"] == "h" and b.get("l", 1) in levels:
                tn = re.sub(r'[\s　·\-—:：()（）\[\]【】]', '', b["t"]).lower()
                if not PURE_NON_BODY_TITLE_RE.match(tn) and tn != re.sub(r'[\s　《》]', '', book_title).lower():
                    cnt += 1
        return cnt

    split_levels = {1, 2}
    if count_body_headings({1, 2}) < 2:
        for extra_lvl in (3, 4, 5, 6):
            split_levels.add(extra_lvl)
            if count_body_headings(split_levels) >= 3:
                if extra_lvl == 5:
                    split_levels.add(6)  # 如《关于人类自由之本质的哲学探究》用 H5/H6 混排
                break
    elif count_body_headings({1}) < 4 and h_counts[2] < 2 and h_counts[3] >= 3:
        split_levels = {1, 2, 3}

    # 合并紧邻断行的双行标题（如 "关于人类自由之本质的" + "哲学探究"）
    coalesced = []
    idx_b = 0
    while idx_b < len(all_blocks):
        cur_b = all_blocks[idx_b]
        if (
            cur_b["y"] == "h"
            and idx_b + 1 < len(all_blocks)
            and all_blocks[idx_b + 1]["y"] == "h"
            and all_blocks[idx_b + 1].get("l") == cur_b.get("l")
            and cur_b["t"].strip().endswith(("的", "之", "与", "以及"))
            and len(cur_b["t"]) + len(all_blocks[idx_b + 1]["t"]) <= 44
        ):
            nxt_t = all_blocks[idx_b + 1]["t"].strip()
            coalesced.append({"y": "h", "l": cur_b["l"], "t": cur_b["t"].strip() + nxt_t})
            idx_b += 2
            continue
        coalesced.append(cur_b)
        idx_b += 1
    all_blocks = coalesced

    # 若单书存在大量微节号 H2（如《小逻辑》226个 §1..§244、《法哲学原理》353个 第1节..第360节）且已有清晰的 H1 大篇/章框架，
    # 将微节号降级为章内三级小标题（保留完整正文小标题呈现，同时让目录保持连贯清晰的大章结构！）
    micro_sec_h2 = sum(
        1 for b in all_blocks
        if b["y"] == "h" and b.get("l") == 2
        and re.match(r'^(?:§\s*\d+|第\s*\d+\s*节|（[一二三四五六七八九十]+）)$', b["t"].strip())
    )
    valid_h1_cnt = count_body_headings({1})
    if micro_sec_h2 >= 25 and valid_h1_cnt >= 4:
        for b in all_blocks:
            if b["y"] == "h" and b.get("l") == 2 and re.match(
                r'^(?:§\s*\d+|第\s*\d+\s*节|（[一二三四五六七八九十]+）)$', b["t"].strip()
            ):
                b["l"] = 3
        split_levels = {1}

    # 若单书出现 40+ 个重复的“注释/说明/附释”分章标题（如《大逻辑》200+ 条注释），降级为章内小标题避免目录爆炸
    note_h_cnt = sum(
        1 for b in all_blocks
        if b["y"] == "h" and b.get("l", 1) in split_levels
        and re.sub(r'[\s　·\-—:：()（）\[\]【】\d]', '', b["t"]) in ("注释", "说明", "附释", "备注")
    )
    demote_note_headings = (note_h_cnt >= 35)

    # 合并《小逻辑》等书中“外层卷标 H1”紧接“重复内层篇名 H1”（如 "黑格尔《小逻辑》：第一篇 存在论（§84-§111）" + "第一篇 存在论"）
    dedup_blocks = []
    bi_d = 0
    while bi_d < len(all_blocks):
        cur_b = all_blocks[bi_d]
        if (
            cur_b["y"] == "h"
            and cur_b.get("l") == 1
            and bi_d + 1 < len(all_blocks)
            and all_blocks[bi_d + 1]["y"] == "h"
            and all_blocks[bi_d + 1].get("l") == 1
        ):
            t1 = re.sub(r'^黑格尔《[^》]+》[：:]\s*', '', cur_b["t"].strip())
            t2 = all_blocks[bi_d + 1]["t"].strip()
            t1_core = re.sub(r'[\s（(][^）)]*[）)]', '', t1)
            t2_core = re.sub(r'\s+', '', t2)
            if t2_core and t2_core in t1_core:
                dedup_blocks.append({"y": "h", "l": 1, "t": t1})
                bi_d += 2
                continue
        if cur_b["y"] == "h" and cur_b.get("l") == 1 and cur_b["t"].strip().startswith("黑格尔《小逻辑》："):
            dedup_blocks.append({"y": "h", "l": 1, "t": re.sub(r'^黑格尔《小逻辑》[：:]\s*', '', cur_b["t"].strip())})
            bi_d += 1
            continue
        dedup_blocks.append(cur_b)
        bi_d += 1
    all_blocks = dedup_blocks

    def _split_part_chapters(chapters):
        """Split a container chapter (第X部分 / 结构综览) at its H3 第X章 headings.

        The part/rubric heading stays as the opening block of the first chapter,
        but the table of contents gets only real chapters.
        """
        out = []
        part_re = re.compile(r'^(?:第\s*[〇零一二三四五六七八九十百千0-9]+\s*部分|《精神现象学》结构综览)')
        chap_re = re.compile(r'^第\s*[〇零一二三四五六七八九十百千0-9]+\s*章')
        for ch in chapters:
            if not part_re.match(ch["title"].strip()):
                out.append(ch)
                continue
            blocks = ch["blocks"]
            starts = [
                i for i, b in enumerate(blocks)
                if b["y"] == "h" and b.get("l", 1) == 3 and chap_re.match(b["t"].strip())
            ]
            if not starts:
                out.append(ch)
                continue
            prefix_chars = sum(len(b["t"]) for b in blocks[:starts[0]])
            if prefix_chars > 3000:
                out.append(ch)
                continue
            part_m = re.match(r"^(第\s*[〇零一二三四五六七八九十百千0-9]+\s*部分)", ch["title"].strip())
            part_label = part_m.group(1) if part_m else "结构综览"
            for k, start in enumerate(starts):
                end = starts[k + 1] if k + 1 < len(starts) else len(blocks)
                seg = (blocks[:start] if k == 0 else []) + blocks[start:end]
                chapter_title = format_clean_title(blocks[start]["t"])
                if book_title == "青年黑格尔":
                    chapter_title = f"{part_label} · {chapter_title}"
                out.append({
                    "title": chapter_title,
                    "level": ch["level"],
                    "blocks": seg,
                })
        return out

    LENIN_WORK_SPLIT_RULES = {
        "黑格尔《逻辑学》一书摘要": [r"^第\s*[一二三]\s*卷"],
        "格·瓦·普列汉诺夫《尼·加·车尔尼雪夫斯基》": [r"^第[一二]部分$", r"^第二部$"],
        "黑格尔著作摘要": [r"^黑格尔《历史哲学讲演录》摘要", r"^小逻辑（百科全书）的目录"],
        "阿贝尔·雷伊《现代哲学》": [r"^第[一二三四五六七八九十]+章"],
    }

    def _split_lenin_works(chapters):
        """Split Lenin's four largest reading notes at their internal volume/chapter headings."""
        if book_title != "列宁哲学笔记（全集第38卷）":
            return chapters
        out = []
        for ch in chapters:
            pats = LENIN_WORK_SPLIT_RULES.get(ch["title"].strip())
            if not pats:
                out.append(ch)
                continue
            blocks = ch["blocks"]
            starts = []
            for i, b in enumerate(blocks):
                if b["y"] != "h":
                    continue
                t = re.sub(r"\s+", "", b["t"].strip())
                if any(re.match(p, t) for p in pats):
                    starts.append(i)
            if not starts:
                out.append(ch)
                continue
            base = ch["title"]
            for k, s in enumerate(starts):
                end = starts[k + 1] if k + 1 < len(starts) else len(blocks)
                seg = (blocks[:s] if k == 0 else []) + blocks[s:end]
                ttl = base if k == 0 else f"{base} · {format_clean_title(blocks[s]['t'])}"
                out.append({"title": ttl, "level": ch["level"], "blocks": seg})
        return out

    LENIN_OVERSIZED_SPLIT_RULES = {
        "黑格尔《逻辑学》一书摘要 · 第三卷：主观逻辑或概念学说": [
            r"^第一部分：主观性", r"^第二篇：客观性", r"^第三篇：理念", r"^第二章 认识的理念",
        ],
        "黑格尔著作摘要": [r"^黑格尔《历史哲学讲演录》摘要"],
        "格·瓦·普列汉诺夫《尼·加·车尔尼雪夫斯基》 · 第二部": [
            r"^第二章 空想社会主义", r"^第三章", r"^第四章",
        ],
    }

    def _split_lenin_oversized(chapters):
        """Further split Lenin chapters that remain above 30k after the work-level split."""
        if book_title != "列宁哲学笔记（全集第38卷）":
            return chapters
        out = []
        for ch in chapters:
            pats = LENIN_OVERSIZED_SPLIT_RULES.get(ch["title"].strip()) or []
            blocks = ch["blocks"]
            starts = []
            for i, b in enumerate(blocks):
                if b["y"] != "h":
                    continue
                t = re.sub(r"\s+", "", b["t"].strip())
                if any(re.match(p, t) for p in pats):
                    starts.append(i)
            base = ch["title"]
            if not starts:
                total = sum(len(b.get("t", "")) for b in blocks)
                if total <= 30000:
                    out.append(ch)
                    continue
                acc = 0
                cut = None
                for i, b in enumerate(blocks):
                    acc += len(b.get("t", ""))
                    if acc >= total // 2 and b.get("y") in ("p", "q", "l"):
                        cut = i
                        break
                if cut is None or cut < 2:
                    out.append(ch)
                    continue
                out.append({"title": base + "（一）", "level": ch["level"], "blocks": blocks[:cut]})
                out.append({"title": base + "（二）", "level": ch["level"], "blocks": blocks[cut:]})
                continue
            if len(starts) == 1:
                s = starts[0]
                prefix_chars = sum(len(b.get("t", "")) for b in blocks[:s])
                if prefix_chars < 200:
                    out.append(ch)
                    continue
                out.append({"title": base, "level": ch["level"], "blocks": blocks[:s]})
                out.append({"title": f"{base} · {format_clean_title(blocks[s]['t'])}", "level": ch["level"], "blocks": blocks[s:]})
                continue
            for k, s in enumerate(starts):
                end = starts[k + 1] if k + 1 < len(starts) else len(blocks)
                seg = (blocks[:s] if k == 0 else []) + blocks[s:end]
                ttl = base if k == 0 else f"{base} · {format_clean_title(blocks[s]['t'])}"
                out.append({"title": ttl, "level": ch["level"], "blocks": seg})
        return out

    raw_chapters = []
    cur_title = "Introduction" if lang == "en" else "序言与导读"
    cur_level = 1
    cur_blocks = []

    for b in all_blocks:
        is_split_h = b["y"] == "h" and b.get("l", 1) in split_levels
        if is_split_h and demote_note_headings:
            if re.sub(r'[\s　·\-—:：()（）\[\]【】\d]', '', b["t"]) in ("注释", "说明", "附释", "备注"):
                is_split_h = False
        if is_split_h:
            new_title = format_clean_title(b["t"], lang=lang)
            # 若与上一章标题实质相同（页眉重复，含短页眉如 "第一篇"/"P"/"S" 或尾带 *），直接并入上一章而不是再拆出假章
            norm_new = re.sub(r'[\s\*＊·：:]+', '', new_title)
            norm_cur = re.sub(r'[\s\*＊·：:]+', '', cur_title)
            if cur_blocks and norm_new and norm_new == norm_cur:
                continue
            if cur_blocks:
                raw_chapters.append({"title": cur_title, "level": cur_level, "blocks": cur_blocks})
            cur_title = new_title
            cur_level = min(b.get("l", 1), 3)
            cur_blocks = [b]
        else:
            cur_blocks.append(b)

    if cur_blocks:
        raw_chapters.append({"title": cur_title, "level": cur_level, "blocks": cur_blocks})

    raw_chapters = _split_part_chapters(raw_chapters)
    raw_chapters = _split_lenin_works(raw_chapters)
    raw_chapters = _split_lenin_oversized(raw_chapters)
    raw_chapters = _split_lenin_oversized(raw_chapters)

    # 清除尾页“黑格尔哲学概论”封底广告（书末连续 4+ 个极短《第一讲…》《第二讲…》书目宣传项）
    while len(raw_chapters) >= 4:
        tail = raw_chapters[-1]
        tail_chars = sum(len(b["t"].strip()) for b in tail["blocks"])
        if tail_chars < 60 and re.match(r'^第[一二三四五六七八九十]+讲', tail["title"]):
            raw_chapters.pop()
        else:
            break

    # 彻底剔除纯无关正文前/后置章节（版权/封面/封底/目录/致谢/凡例/缩写/索引/出版社广告）
    cleaned_chapters = []
    for ch in raw_chapters:
        if is_prunable_non_body_chapter(ch["title"], ch["blocks"], is_reference_book=is_reference_book, keep_index=keep_index):
            continue
        # 若某章开头混有原书目录列表项 + "前言：..."（如《理性的毁灭》原 TOC 末项误吞前言），剥离目录项并正名
        if len(ch["blocks"]) >= 8:
            toc_end = None
            for bi in range(1, min(14, len(ch["blocks"]))):
                bt = ch["blocks"][bi]["t"].strip()
                if re.match(r'^(?:前言|序言|导言|导论)[：:]', bt) and len(bt) <= 45:
                    # 确认前面确实是目录列表或含页码行
                    pre_txt = "\n".join(x["t"] for x in ch["blocks"][:bi])
                    if re.search(r'(\d{2,3}\s*$|人名索引|尾声)', pre_txt, re.M):
                        toc_end = bi
                        break
            if toc_end is not None:
                kept = ch["blocks"][toc_end:]
                ch = {"title": format_clean_title(kept[0]["t"]), "level": 1, "blocks": kept}

        # 若某个“目录”章里混杂了未拆出的正文段落，只剥离前段目录列表、保留正文段落并正名
        t_norm = re.sub(r'[\s　·\-—:：()（）\[\]【】]', '', ch["title"]).lower()
        if t_norm.startswith(('目录', '目次', '总目录')):
            prose_start = None
            for bi, blk in enumerate(ch["blocks"]):
                if blk["y"] == "p" and len(blk["t"].strip()) >= 110 and not re.search(r'^\s*第[一二三四五六七八九十0-9]+[章节讲].{0,20}\d+\s*$', blk["t"]):
                    prose_start = bi
                    break
            if prose_start is not None:
                kept = ch["blocks"][prose_start:]
                first_h = next((b["t"] for b in kept[:4] if b["y"] == "h"), None)
                if first_h and kept and kept[0]["y"] == "h":
                    ch_title = format_clean_title(first_h)
                else:
                    ch_title = "卷首导言"
                ch = {"title": ch_title, "level": 1, "blocks": kept}
            else:
                continue
        cleaned_chapters.append(ch)

    # 若首章仅是空壳书名/封面页（<140字且与书名一致、无实质正文），且后续已有正式章节，则安全移除
    while len(cleaned_chapters) >= 2:
        c0 = cleaned_chapters[0]
        c0_chars = sum(len(b["t"].strip()) for b in c0["blocks"])
        c0_prose = sum(len(b["t"].strip()) for b in c0["blocks"] if b["y"] == "p" and len(b["t"].strip()) >= 60)
        if c0_chars < 150 and c0_prose == 0:
            cleaned_chapters.pop(0)
        else:
            break

    if not cleaned_chapters:
        cleaned_chapters = raw_chapters

    merged = []
    pending = []
    for ch in cleaned_chapters:
        text_len = sum(len(b["t"].strip()) for b in ch["blocks"])
        if text_len == 0:
            continue
        if text_len < 35 or (len(ch["blocks"]) <= 2 and all(b["y"] in ("h", "r") for b in ch["blocks"])):
            pending.extend(ch["blocks"])
        else:
            if pending:
                ch["blocks"] = pending + ch["blocks"]
                pending = []
            merged.append(ch)
    if pending and merged:
        merged[-1]["blocks"].extend(pending)
    elif pending:
        merged.append({"title": book_title, "level": 1, "blocks": pending})

    # 合并极短空壳过渡章（<120字且无实质长段落的篇/部/讲引题页）及紧邻同名/父子包裹章，确保目录中每一章都有充实正文
    coalesced_merged = []
    mi = 0
    while mi < len(merged):
        ch = merged[mi]
        if mi + 1 < len(merged) and not is_reference_book:
            nxt = merged[mi + 1]
            c_len = sum(len(b["t"].strip()) for b in ch["blocks"])
            c_prose_len = sum(len(b["t"].strip()) for b in ch["blocks"] if b["y"] == "p")
            t1_core = re.sub(r'[\s\*＊（(][^）)]*[）)]', '', ch["title"]).strip()
            t1_core = re.sub(r'[\s\*＊]+', '', t1_core)
            t2_core = re.sub(r'[\s\*＊]+', '', nxt["title"]).strip()
            # 情况 1：紧邻同名或包裹重复章（如 "第一篇 存在论（§84-§111）" + "第一篇 存在论"、"第十二章" + "第十二章 论意识形态"、"关于意识形态国家机器的说明＊" + "关于意识形态国家机器的说明"）
            if t1_core and t2_core and (
                t1_core == t2_core
                or (c_len < 650 and len(t1_core) >= 3 and (t2_core in t1_core or t1_core in t2_core))
            ):
                keep_title = ch["title"] if len(ch["title"]) >= len(nxt["title"]) else nxt["title"]
                nxt["title"] = keep_title.rstrip("*＊ ")
                nxt["level"] = min(ch["level"], nxt["level"])
                nxt["blocks"] = [b for b in ch["blocks"] if b["y"] != "h"] + nxt["blocks"]
                mi += 1
                continue
            # 情况 2：空壳过渡章（总字数 < 120 且正文段落 < 80 字，如 "第一部分 审美判断力的批判 (58ch)"、"第十五讲 男人的事 (64ch)"、"第二部分 逻辑学 (38ch)"）
            if c_len < 120 and c_prose_len < 80:
                # 若当前是更高级别的章/讲/部标题，把子节并入它之下保留清晰主标题；否则将引题块附入下一章开头
                if ch["level"] < nxt["level"] or re.match(r'^第[一二三四五六七八九十百\d]+[部卷篇讲章]', ch["title"]):
                    nxt["title"] = f"{ch['title']} · {nxt['title']}" if len(ch["title"]) + len(nxt["title"]) <= 34 else ch["title"]
                nxt["level"] = min(ch["level"], nxt["level"])
                nxt["blocks"] = ch["blocks"] + nxt["blocks"]
                mi += 1
                continue
        coalesced_merged.append(ch)
        mi += 1
    merged = coalesced_merged

    # 构建期全书级注脚与【译注】结构化收纳（在切分（续 N）之前执行，支持跨节/跨“注释”章精确配对！）
    if lang != "en":
        merged, fn_st = fold_cross_chapter_notes(merged, is_reference_book=is_reference_book)
        for k in TOTAL_FN_STATS:
            TOTAL_FN_STATS[k] += fn_st.get(k, 0)
        # 注脚从句间抽离后，二次愈合因页底脚注穿插而断裂的跨页句段（自动重映射 ⟦fn:N⟧ 索引）
        for ch in merged:
            ch["blocks"] = heal_broken_paragraphs(ch["blocks"], lang=lang)

    # 针对碎片化极短微章过多的非辞典书（如《导读鲍德里亚》/ Simply Philosophy），按阅读节奏归并微章为自然节群（保留全部小标题零丢字）
    micro_med_cap = 1600 if lang == "en" else 650
    micro_group_min = 4200 if lang == "en" else 2200
    micro_group_max = 7500 if lang == "en" else 3600
    micro_single_max = 3200 if lang == "en" else 1600
    if (not is_reference_book or book_title in ("Simply Philosophy", "Nature Encyclopedia")) and len(merged) >= 45:
        ch_lens = sorted(sum(len(b["t"]) for b in c["blocks"]) for c in merged)
        median_len = ch_lens[len(ch_lens) // 2]
        if median_len < micro_med_cap:
            grouped = []
            cur_g = None
            cur_g_len = 0
            for ch in merged:
                cl = sum(len(b["t"]) for b in ch["blocks"])
                if cur_g is None:
                    cur_g = {"title": ch["title"], "level": ch["level"], "blocks": list(ch["blocks"])}
                    cur_g_len = cl
                elif cur_g_len < micro_group_min and cur_g_len + cl <= micro_group_max and cl < micro_single_max:
                    # 将被归并微章的首标题降级为章内三级小标题保留
                    sub_blks = []
                    for bi_s, blk_s in enumerate(ch["blocks"]):
                        if bi_s == 0 and blk_s["y"] == "h":
                            sub_blks.append({"y": "h", "l": 3, "t": blk_s["t"]})
                        else:
                            sub_blks.append(blk_s)
                    cur_g["blocks"].extend(sub_blks)
                    cur_g_len += cl
                else:
                    grouped.append(cur_g)
                    cur_g = {"title": ch["title"], "level": ch["level"], "blocks": list(ch["blocks"])}
                    cur_g_len = cl
            if cur_g:
                grouped.append(cur_g)
            merged = grouped

    # --- Chapter hygiene (run BEFORE size splitting, so that the parts
    #     produced by long-chapter splitting keep their chapter status) ------
    final_chapters = merged
    # --- Chapter hygiene ---------------------------------------------------
    def _norm_title(t):
        return re.sub(r'[\s·、,，。.:：;；!！?？（）()\[\]【】—\-–"“”\'‘’]', '', t or '').lower()

    def _cjk_len(s):
        return len(re.findall(r'[\u3400-\u9fffA-Za-z0-9]', s or ''))

    def _chap_chars(c):
        return sum(_cjk_len(b["t"]) for b in c["blocks"])

    # (0) Fold tiny fragments (heading-only leftovers, orphan page lines,
    #     split bibliography stubs) into the preceding chapter.  Measured in
    #     CJK characters so punctuation-only blocks cannot inflate them.
    folded = []
    for c in final_chapters:
        if folded and _chap_chars(c) < 60:
            folded[-1]["blocks"].extend(c["blocks"])
            continue
        folded.append(c)
    final_chapters = folded

    # (0b) Drop a leading table-of-contents chapter (title page + 目录 dump).
    if final_chapters:
        first = final_chapters[0]
        ftxt = "".join(b["t"] for b in first["blocks"])
        if _norm_title(first["title"]) == _norm_title(book_title) and ("目录" in ftxt or "目次" in ftxt):
            final_chapters = final_chapters[1:]

    # (0c) Structural normalisation: when the book really is organised as
    #      "第X章", every other heading (numbered subsections such as "四、…",
    #      inline "注释" pages, repeated rubrics caused by page breaks) belongs
    #      to the current chapter, not to the table of contents.  Without this
    #      pass those headings become one-chapter-per-heading, which is what
    #      produces duplicated rubric titles and chapters whose body is empty.
    RE_CH = re.compile(r'^第\s*[〇零一二三四五六七八九十百千0-9]+\s*章')
    RE_FRONT = re.compile(r'^(序|序言|前言|导论|绪论|导言|引言|译者|译后记|后记|跋|尾声|结语|结论|附录|参考文献|索引|目录|目次|告读者|编者|中文版|法文版|英文版|德文版|致谢|年表|缩写|缩略语|人名|术语|出版说明|内容提要|题解|导读|凡例|插图|译名|大事记|书目)')

    def _chap_num(t):
        m = re.match(r'^第\s*([〇零一二三四五六七八九十百千0-9]+)\s*章', (t or '').strip())
        return m.group(1) if m else None

    real_idx = [i for i, c in enumerate(final_chapters) if RE_CH.match(c["title"].strip())]
    if len(real_idx) >= 4:
        first_ch = real_idx[0]
        RE_BACK = re.compile(r'^(附录|参考文献|索引|译后记|后记|跋|结语|结论|致谢|年表|人名|术语|书目|大事记|出版说明)')
        normed = []
        for pos, c in enumerate(final_chapters):
            t = c["title"].strip()
            is_ch = bool(RE_CH.match(t))
            # front matter is only front matter when it precedes the first real
            # chapter; later "导论"/"注释" headings are section rubrics.
            is_front = bool(RE_FRONT.match(t)) and (pos < first_ch or bool(RE_BACK.match(t)))
            num = _chap_num(t)
            prev_num = _chap_num(normed[-1]["title"]) if normed else None
            same_chapter = num is not None and prev_num is not None and num == prev_num
            if not is_ch and not is_front and normed:
                blocks = c["blocks"]
                if blocks and blocks[0]["y"] == "h":
                    blocks[0]["l"] = 3
                normed[-1]["blocks"].extend(blocks)
                continue
            if same_chapter:
                blocks = c["blocks"]
                if blocks and blocks[0]["y"] == "h" and _norm_title(blocks[0]["t"]) == _norm_title(t):
                    blocks = blocks[1:]
                normed[-1]["blocks"].extend(blocks)
                continue
            normed.append(c)
        final_chapters = normed

    # Split pathologically long paragraphs (bibliography dumps, OCR lines
    # merged into one block) so that size-splitting can keep chapters readable.
    def _split_long_block(t, limit=12000, target=6000):
        parts = []
        rest = t
        while len(rest) > limit:
            cut = rest.rfind(" ", target, limit)
            if cut < target // 2:
                cut = rest.rfind("。", target, limit)
            if cut < target // 2:
                cut = target
            parts.append(rest[:cut].rstrip())
            rest = rest[cut:].lstrip()
        if rest:
            parts.append(rest)
        return parts

    for c in final_chapters:
        nb = []
        for b in c["blocks"]:
            if b["y"] != "h" and len(b["t"]) > 12000:
                for piece in _split_long_block(b["t"]):
                    nb.append({**b, "t": piece})
            else:
                nb.append(b)
        c["blocks"] = nb

    # 在切分（续 N）之前先为合法的同名独立章节加编号（如《艺术哲学》两处“各种注释” -> （一）（二）），避免出现“（续二）（一）”叠后缀
    pre_counts = {}
    for c in final_chapters:
        k = _norm_title(c["title"])
        pre_counts[k] = pre_counts.get(k, 0) + 1
    pre_seen = {}
    _pre_cn = "一二三四五六七八九十"
    for c in final_chapters:
        k = _norm_title(c["title"])
        if pre_counts.get(k, 0) > 1 and not re.search(r'[（(][一二三四五六七八九十\d]+[）)]$', c["title"]):
            pre_seen[k] = pre_seen.get(k, 0) + 1
            pn = pre_seen[k]
            if lang == "en":
                c["title"] = f"{c['title']} ({pn})"
            else:
                lbl = _pre_cn[pn - 1] if pn <= len(_pre_cn) else str(pn)
                c["title"] = f"{c['title']}（{lbl}）"

    default_max = EN_MAX_CHAPTER_CHARS if lang == "en" else MAX_CHAPTER_CHARS
    book_max = BOOK_MAX_CHAPTER_CHARS.get(book_title, default_max)
    split_final = []
    for ch in final_chapters:
        ch_chars = sum(len(b["t"]) for b in ch["blocks"])
        if ch_chars <= book_max:
            split_final.append(ch)
            continue

        sub_parts = []
        base_title = ch["title"]
        cur_sub_title = base_title
        cur_sub_blocks = []
        cur_sub_chars = 0
        part_num = 1

        for b in ch["blocks"]:
            blen = len(b["t"])
            bt_s = b["t"].strip()
            is_non_split_sub = bool(re.match(r'^[\[\(（【]?(?:附释|说明|注释|补遗|备注|译者注)', bt_s))
            is_micro_sec = bool(re.match(r'^(?:§\s*\d+|第\s*\d+\s*节)', bt_s))
            is_sub_heading = b["y"] == "h" and b.get("l", 1) >= 3 and not is_non_split_sub and is_valid_heading_text(bt_s, lang=lang)
            min_split_chars = (24000 if lang == "en" else 10000) if is_micro_sec else (12000 if lang == "en" else 3500)
            if is_sub_heading and cur_sub_chars >= min_split_chars and not (book_title == "Kant-Lexikon"):
                sub_parts.append({"title": cur_sub_title, "level": min(ch["level"] + 1, 3), "blocks": cur_sub_blocks})
                sub_clean = format_clean_title(bt_s, lang=lang)
                cur_sub_title = sub_clean if len(sub_clean) >= 6 else f"{base_title} · {sub_clean}"
                cur_sub_blocks = [b]
                cur_sub_chars = blen
                part_num = 1
            elif cur_sub_chars + blen > book_max and cur_sub_blocks:
                sub_parts.append({"title": cur_sub_title, "level": ch["level"], "blocks": cur_sub_blocks})
                part_num += 1
                if lang == "en":
                    clean_parent = re.sub(r'\s*\(Part\s*\d+\)$', '', cur_sub_title)
                    cur_sub_title = f"{clean_parent} (Part {part_num})"
                else:
                    clean_parent = re.sub(r'（续\s*\d+）$', '', cur_sub_title)
                    cur_sub_title = f"{clean_parent}（续 {part_num}）"
                cur_sub_blocks = [b]
                cur_sub_chars = blen
            else:
                cur_sub_blocks.append(b)
                cur_sub_chars += blen

        if cur_sub_blocks:
            sub_parts.append({"title": cur_sub_title, "level": ch["level"], "blocks": cur_sub_blocks})
        for sp in sub_parts:
            sp_chars = sum(len(b["t"].strip()) for b in sp["blocks"])
            if sp_chars > 0 and not is_prunable_non_body_chapter(sp["title"], sp["blocks"], is_reference_book=is_reference_book, keep_index=keep_index):
                split_final.append(sp)

    final_chapters = split_final
    final_chapters = [c for c in final_chapters if sum(len(b["t"].strip()) for b in c["blocks"]) > 0]
    # Fold tiny shards left by size-splitting (heading-only parts, page-break
    # leftovers) into the preceding chapter; a tiny first chapter folds forward.
    folded2 = []
    carry2 = []
    for c in final_chapters:
        if _chap_chars(c) < 60:
            if folded2:
                folded2[-1]["blocks"].extend(c["blocks"])
            else:
                carry2.extend(c["blocks"])
            continue
        if carry2:
            c["blocks"] = carry2 + c["blocks"]
            carry2 = []
        folded2.append(c)
    final_chapters = folded2

    # (1) Size-splitting can emit two chapters with the same title (e.g. two
    #     "（续 2）" parts when a heading restarts part numbering).  Merge
    #     consecutive same-title chapters back into one logical chapter.
    merged_final = []
    for c in final_chapters:
        if merged_final and _norm_title(merged_final[-1]["title"]) == _norm_title(c["title"]):
            merged_final[-1]["blocks"].extend(c["blocks"])
            continue
        merged_final.append(c)
    final_chapters = merged_final

    # (1b) Index chapters are reference apparatus, not narrative body.  Keep
    #      them readable instead of leaving one 30k-character目录 block: split
    #      oversized indexes by blocks, and restore the philosophy-history
    #      indexes as labelled appendices.
    def _cn_num(n):
        digits = "零一二三四五六七八九"
        if n <= 10:
            return "十" if n == 10 else digits[n]
        if n < 20:
            return "十" + digits[n % 10]
        if n < 100:
            return digits[n // 10] + "十" + (digits[n % 10] if n % 10 else "")
        return str(n)

    def _split_oversized_index(chapters):
        out = []
        for c in chapters:
            title = c.get("title", "")
            blocks = []
            for b in c["blocks"]:
                if b["y"] != "h" and len(b["t"]) > 6000:
                    for piece in _split_long_block(b["t"], limit=6000, target=3000):
                        blocks.append({**b, "t": piece})
                else:
                    blocks.append(b)
            c = {**c, "blocks": blocks}
            total = sum(len(b["t"]) for b in blocks)
            if "索引" not in title or total <= 12000:
                out.append(c)
                continue
            groups, cur, cur_chars = [], [], 0
            for b in blocks:
                blen = len(b["t"])
                if cur and cur_chars + blen > 10000:
                    groups.append(cur)
                    cur, cur_chars = [], 0
                cur.append(b)
                cur_chars += blen
            if cur:
                groups.append(cur)
            if len(groups) <= 1:
                out.append(c)
                continue
            for i, g in enumerate(groups):
                out.append({**c, "title": f"{title}（{_cn_num(i + 1)}）", "blocks": g})
        return out

    def _prefix_appendix_indexes(chapters):
        out = []
        for c in chapters:
            if "索引" in c.get("title", "") and not c["title"].startswith("附录"):
                c = {**c, "title": "附录：" + c["title"]}
            out.append(c)
        return out

    def _normalize_index_titles(chapters):
        bases = []
        for c in chapters:
            title = c.get("title", "")
            if "索引" not in title:
                bases.append(None)
                continue
            base = re.sub(r"(?:（(?:续\s*[0-9一二三四五六七八九十]+|[一二三四五六七八九十]+)）)+$", "", title)
            bases.append(base)
        totals = {}
        for base in bases:
            if base:
                totals[base] = totals.get(base, 0) + 1
        counters = {}
        out = []
        for c, base in zip(chapters, bases):
            if not base or totals[base] <= 1:
                out.append(c)
                continue
            counters[base] = counters.get(base, 0) + 1
            out.append({**c, "title": f"{base}（{_cn_num(counters[base])}）"})
        return out

    final_chapters = _split_oversized_index(final_chapters)
    if book_title == "哲学史讲演录":
        final_chapters = _prefix_appendix_indexes(final_chapters)
    final_chapters = _normalize_index_titles(final_chapters)
    # Make size-split labels readable: （续 2） -> （续二）.
    final_chapters = [
        {**c, "title": re.sub(r"（续\s*(\d+)）", lambda m: f"（续{_cn_num(int(m.group(1)))}）", c["title"])}
        for c in final_chapters
    ]

    # (2) Remaining duplicate titles (e.g. per-lecture "注释", four volumes of
    #     "译者后记") are legitimately separate chapters but must be told
    #     apart in the table of contents.
    counts = {}
    for c in final_chapters:
        k = _norm_title(c["title"])
        counts[k] = counts.get(k, 0) + 1
    seen = {}
    cn_num = "一二三四五六七八九十"
    for c in final_chapters:
        k = _norm_title(c["title"])
        if counts.get(k, 0) > 1:
            seen[k] = seen.get(k, 0) + 1
            n = seen[k]
            if lang == "en":
                c["title"] = f"{c['title']} ({n})"
            else:
                label = cn_num[n - 1] if n <= len(cn_num) else str(n)
                c["title"] = f"{c['title']}（{label}）"

    # Drop a "卷首导言" chapter that is only copyright/CIP/publisher boilerplate.
    def _copyright_only(c):
        text = "\n".join(b["t"] for b in c["blocks"])
        if c["title"] != "卷首导言":
            return False
        if len(text) < 1500 and re.search(r'未经出版者书面许可|本出版物受版权保护', text):
            return True
        return (
            len(COPY_MARK_RE.findall(text)) >= 2
            and len(text) < 2500
            and not re.search(r'译者前言|译者导言|译序|前言|导言', text)
        )

    final_chapters = [c for c in final_chapters if not _copyright_only(c)]

    # Remove invalid footnote placeholders (e.g. ⟦fn:-1⟧ left when a note
    # was aimed at a heading) and any marker whose f-entry does not exist.
    def _fold_dashed_endnotes(chapters):
        # Some editions use page-based endnote IDs such as [^361-1]. Collect
        # their definitions first, then attach each definition to its refs.
        id_pat = r"[0-9A-Za-z]+(?:-[0-9A-Za-z]+)+"
        def_re = re.compile(r"\[\^(" + id_pat + r")\]:\s*")
        ref_re = re.compile(r"\[\^(" + id_pat + r")\]")
        defs = {}
        for c in chapters:
            kept = []
            for b in c.get("blocks", []):
                t = b.get("t") or ""
                ms = list(def_re.finditer(t))
                if ms and not t[:ms[0].start()].strip():
                    for j, m in enumerate(ms):
                        end = ms[j + 1].start() if j + 1 < len(ms) else len(t)
                        defs[m.group(1)] = t[m.end():end].strip()
                    continue
                kept.append(b)
            c["blocks"] = kept
        if not defs:
            return chapters
        for c in chapters:
            for b in c.get("blocks", []):
                t = b.get("t") or ""
                if "[^" not in t:
                    continue
                out = []
                last = 0
                changed = False
                for m in ref_re.finditer(t):
                    label = m.group(1)
                    if label not in defs:
                        continue
                    out.append(t[last:m.start()])
                    fns = b.get("f")
                    if not isinstance(fns, list):
                        fns = []
                        b["f"] = fns
                    idx = len(fns)
                    note_text = defs[label]
                    if re.match(r"^[eu]\d*-\d+$", label, re.I):
                        ui_label = "编者注" if "编者注" in note_text else ("译注" if "译者" in note_text or "译注" in note_text else f"注{label.split('-')[-1]}")
                    elif re.match(r"^c\d+-(\d+)$", label, re.I):
                        ui_label = label.split("-")[-1]
                    elif re.match(r"^s-(\d+)$", label, re.I):
                        ui_label = "*" * min(3, int(label.split("-")[-1]))
                    else:
                        ui_label = label
                    fns.append({"l": ui_label, "k": "fn", "t": note_text})
                    out.append(f"⟦fn:{idx}⟧")
                    last = m.end()
                    changed = True
                if changed:
                    out.append(t[last:])
                    b["t"] = "".join(out)
        return chapters

    def _clean_fn_tokens(text: str, fns: list) -> str:
        def repl(m):
            i = int(m.group(1))
            return m.group(0) if 0 <= i < len(fns) else ""
        cleaned = re.sub(r"⟦fn:(-?\d+)⟧", repl, text or "")
        # Drop literal markdown footnote refs that could not be bound to a
        # definition (duplicate numbering, pruned notes chapters, missing defs).
        return re.sub(r"\[\^[^\]]{0,16}\]", "", cleaned)

    final_chapters = _fold_dashed_endnotes(final_chapters)
    final_chapters = [c for c in final_chapters if any((b.get("t") or "").strip() for b in c.get("blocks", []))]

    def _split_oversized_narrative_p(blk: dict, max_len: int = 1950, target_len: int = 1050) -> list:
        t = blk.get("t") or ""
        if lang == "en":
            max_len = 3600
            target_len = 2000
        if blk.get("y") != "p" or len(t) <= max_len:
            return [blk]
        old_fns = blk.get("f") or []
        # Candidate split positions: right after sentence-ending punctuation + any attached closing quote/bracket + any ⟦fn:k⟧ tokens
        if lang == "en":
            sent_ends = [
                m.end()
                for m in re.finditer(r'(?:[.!?](?:["”’\')\]])?)\s+', t)
            ]
        else:
            sent_ends = [
                m.end()
                for m in re.finditer(r"(?:[。！？!?](?:[”’」』）\)】])?)(?:\s*⟦fn:\d+⟧)*", t)
            ]
        pieces = []
        start = 0
        while len(t) - start > max_len:
            lo = start + 500
            hi = start + max_len
            cands = [pos for pos in sent_ends if lo <= pos <= hi]
            if cands:
                ideal = start + target_len
                cut = min(cands, key=lambda p: abs(p - ideal))
            else:
                # Fallback to semicolon or comma if a single sentence exceeds max_len
                semi_cands = [
                    m.end()
                    for m in re.finditer(r"[；;，,](?:\s*⟦fn:\d+⟧)*", t[lo:hi])
                ]
                cut = (lo + semi_cands[len(semi_cands) // 2]) if semi_cands else (start + target_len)
            pieces.append(t[start:cut].strip())
            start = cut
        if start < len(t):
            tail = t[start:].strip()
            if tail:
                if pieces and len(tail) < 180 and len(pieces[-1]) + len(tail) <= max_len + 150:
                    pieces[-1] = pieces[-1] + tail
                else:
                    pieces.append(tail)

        out_blks = []
        for pc in pieces:
            if not old_fns:
                out_blks.append({"y": "p", "t": pc})
            else:
                new_fns = []
                idx_map = {}

                def _remap_fn(mm):
                    oi = int(mm.group(1))
                    if 0 <= oi < len(old_fns):
                        if oi not in idx_map:
                            idx_map[oi] = len(new_fns)
                            new_fns.append(old_fns[oi])
                        return f"⟦fn:{idx_map[oi]}⟧"
                    return ""

                new_pc = re.sub(r"⟦fn:(-?\d+)⟧", _remap_fn, pc)
                nb = {"y": "p", "t": new_pc}
                if new_fns:
                    nb["f"] = new_fns
                out_blks.append(nb)
        return out_blks

    for c in final_chapters:
        c["title"] = _clean_fn_tokens(c.get("title") or "", [])
        kept_blks = []
        for b in c["blocks"]:
            bt = _clean_fn_tokens(b.get("t") or "", b.get("f") or "").strip()
            if book_title == "哲学史讲演录":
                bt = re.sub(r"(?<=[。！？!?…”’）\)])[ \t]*\[\d{1,4}\][ \t]*$", "", bt).strip()
            if not bt or PAGE_NUM_LINE_RE.match(bt):
                continue
            b["t"] = bt
            kept_blks.append(b)
        c["blocks"] = heal_broken_paragraphs(kept_blks, lang=lang)
        is_idx_ch = any(k in c["title"] for k in ("索引", "目录", "术语表", "词汇表", "文献", "年表", "Bibliography", "Index", "Glossary"))
        if not is_reference_book and not is_idx_ch:
            split_blks = []
            for b in c["blocks"]:
                split_blks.extend(_split_oversized_narrative_p(b))
            c["blocks"] = split_blks
        # Consolidate any >=3 trailing consecutive ⟦fn:k⟧ badges on the same block so 0 blocks have >=3 stacked trailing badges
        for b in c["blocks"]:
            bt = (b.get("t") or "").strip()
            fns = b.get("f")
            if not isinstance(fns, list) or len(fns) < 3:
                continue
            m_stack = re.search(r"((?:⟦fn:\d+⟧\s*){3,})$", bt)
            if m_stack:
                tail_str = m_stack.group(1)
                t_idxs = [int(x) for x in re.findall(r"⟦fn:(\d+)⟧", tail_str) if 0 <= int(x) < len(fns)]
                if len(t_idxs) >= 3:
                    # Keep the first trailing badge as-is, merge the remaining (t_idxs[1:]) into the second trailing badge
                    keep_first = t_idxs[0]
                    merge_target = t_idxs[1]
                    merged_texts = [fns[i].get("t", "").strip() for i in t_idxs[1:] if fns[i].get("t", "").strip()]
                    fns[merge_target]["t"] = "；".join(merged_texts)
                    drop_set = set(t_idxs[2:])
                    new_bt = bt[:m_stack.start()].rstrip() + f"⟦fn:{keep_first}⟧⟦fn:{merge_target}⟧"
                    # Rebuild fns list without drop_set and remap indices in new_bt
                    new_fns = []
                    remap = {}
                    for old_i, fn_obj in enumerate(fns):
                        if old_i in drop_set:
                            continue
                        remap[old_i] = len(new_fns)
                        new_fns.append(fn_obj)
                    b["f"] = new_fns
                    b["t"] = re.sub(
                        r"⟦fn:(\d+)⟧",
                        lambda mm: f"⟦fn:{remap[int(mm.group(1))]}⟧" if int(mm.group(1)) in remap else "",
                        new_bt,
                    )

    return final_chapters


class EpubHtmlExtractor(HTMLParser):
    SKIP_TAGS = {"script", "style", "head", "title", "svg"}

    def __init__(self):
        super().__init__()
        self.blocks = []
        self.skip_depth = 0
        self.cur_tag = None
        self.cur_buf = []
        self.in_blockquote = False

    def flush(self):
        text = _fix_unmatched_bold(sanitize_book_text(re.sub(r'\s+', ' ', "".join(self.cur_buf)).strip()))
        self.cur_buf = []
        if not text or PAGE_NUM_LINE_RE.match(text):
            return
        tag = self.cur_tag or "p"
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6") and is_valid_heading_text(text):
            self.blocks.append({"y": "h", "l": int(tag[1]), "t": text})
        elif self.in_blockquote or tag == "blockquote":
            self.blocks.append({"y": "q", "t": text})
        elif tag == "li":
            self.blocks.append({"y": "l", "t": text})
        else:
            self.blocks.append({"y": "p", "t": text})

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t in self.SKIP_TAGS:
            self.skip_depth += 1
            return
        if self.skip_depth > 0:
            return
        if t == "blockquote":
            self.in_blockquote = True
        if t in ("p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "dt", "dd"):
            self.flush()
            self.cur_tag = t
        elif t == "br":
            self.cur_buf.append(" ")

    def handle_endtag(self, tag):
        t = tag.lower()
        if t in self.SKIP_TAGS:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth > 0:
            return
        if t == "blockquote":
            self.flush()
            self.in_blockquote = False
            self.cur_tag = None
        elif t in ("p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "dt", "dd"):
            self.flush()
            self.cur_tag = None

    def handle_data(self, data):
        if self.skip_depth == 0:
            self.cur_buf.append(data)


def parse_epub_to_blocks(epub_path: Path) -> list:
    all_blocks = []
    with zipfile.ZipFile(epub_path, "r") as z:
        names = z.namelist()
        opf_path = None
        if "META-INF/container.xml" in names:
            try:
                croot = ET.fromstring(z.read("META-INF/container.xml"))
                for elem in croot.iter():
                    if elem.tag.endswith("rootfile") and "full-path" in elem.attrib:
                        opf_path = elem.attrib["full-path"]
                        break
            except Exception:
                pass
        if not opf_path:
            opfs = [n for n in names if n.lower().endswith(".opf")]
            opf_path = opfs[0] if opfs else None

        ordered_files = []
        if opf_path and opf_path in names:
            opf_dir = os.path.dirname(opf_path)
            root = ET.fromstring(z.read(opf_path))
            manifest = {}
            for item in root.iter():
                if item.tag.endswith("item") and "id" in item.attrib and "href" in item.attrib:
                    href = item.attrib["href"]
                    full = os.path.normpath(os.path.join(opf_dir, href)).replace("\\", "/") if opf_dir else href
                    manifest[item.attrib["id"]] = full
            for itemref in root.iter():
                if itemref.tag.endswith("itemref") and "idref" in itemref.attrib:
                    ref = manifest.get(itemref.attrib["idref"])
                    if ref and ref in names:
                        ordered_files.append(ref)

        if not ordered_files:
            ordered_files = sorted(n for n in names if n.lower().endswith((".xhtml", ".html", ".htm")))

        # 解析 EPUB 的 toc.ncx，为不含 <h1>..<h6> 的 XHTML 章节文件精准补全原书目录标题
        ncx_titles = {}
        ncx_candidates = [n for n in names if n.lower().endswith(".ncx")]
        if ncx_candidates:
            try:
                ncx_path = ncx_candidates[0]
                ncx_dir = os.path.dirname(ncx_path)
                nroot = ET.fromstring(z.read(ncx_path))
                for np in nroot.iter():
                    if np.tag.endswith("navPoint"):
                        label_txt = ""
                        src_href = ""
                        for child in np:
                            if child.tag.endswith("navLabel"):
                                for t_el in child.iter():
                                    if t_el.tag.endswith("text") and t_el.text:
                                        label_txt = t_el.text.strip()
                                        break
                            elif child.tag.endswith("content") and "src" in child.attrib:
                                src_href = child.attrib["src"].split("#")[0]
                        if label_txt and src_href:
                            full_ref = os.path.normpath(os.path.join(ncx_dir, src_href)).replace("\\", "/") if ncx_dir else src_href
                            if full_ref not in ncx_titles:
                                ncx_titles[full_ref] = label_txt
            except Exception:
                pass

        for fname in ordered_files:
            # 跳过盗版电子书插入的广告章节文件（如 EPUB/ad_chapter.xhtml）
            if re.search(r'(?:^|/)(?:ad_chapter|advert|promo|guanggao)', fname, re.I):
                continue
            try:
                raw_html = z.read(fname).decode("utf-8", errors="replace")
            except Exception:
                continue
            if len(raw_html) < 5000 and re.search(r'(读累了记得休息一会哦|古德猫宁李|电子书搜索下载)', raw_html):
                continue
            parser = EpubHtmlExtractor()
            parser.feed(raw_html)
            parser.flush()
            if parser.blocks:
                has_h = any(b["y"] == "h" for b in parser.blocks[:6])
                ftn_marks = len(re.findall(r'id="(?:_?ftn\d+|zhushi\d+)"|class="note1"', raw_html))
                ncx_t = sanitize_book_text(ncx_titles.get(fname, "")).strip() if fname in ncx_titles else ""
                is_epub_endnote_file = (
                    not has_h
                    and (not ncx_t or bool(re.match(r"^(?:注释|尾注|脚注|译注|译者注|注)$", ncx_t)))
                    and ftn_marks >= 4
                    and ftn_marks >= len(parser.blocks) * 0.55
                    and bool(parse_footnote_def(parser.blocks[0]))
                )
                if is_epub_endnote_file:
                    all_blocks.append({"y": "h", "l": 1, "t": "注释"})
                elif not has_h and ncx_t:
                    all_blocks.append({"y": "h", "l": 1, "t": ncx_t})
                all_blocks.extend(parser.blocks)
    return heal_broken_paragraphs(all_blocks)


def make_book_id(key: str) -> str:
    return "bk_" + hashlib.md5(key.encode("utf-8")).hexdigest()[:10]


def main():
    global FOREIGN_GLOSS_MAP
    FOREIGN_GLOSS_MAP = _load_foreign_gloss_map()
    if FOREIGN_GLOSS_MAP:
        print(f"Loaded {len(FOREIGN_GLOSS_MAP)} foreign-quote Chinese glosses.")
    if OUT_ROOT.exists():
        shutil.rmtree(OUT_ROOT)
    (OUT_ROOT / "books").mkdir(parents=True, exist_ok=True)

    seen_hashes = set()
    sources = []  # (path, origin_tag)

    # 如果已有全本精译替代原目录中的纲要版或局部节选版，自动跳过重复局部文件
    replace_stubs = set()
    if (EXTRA_ROOT / "历史哲学（全本）.md").exists() and (EXTRA_ROOT / "历史哲学（全本）.md").stat().st_size > 50000:
        replace_stubs.add("【完整全本】黑格尔《历史哲学》汉译精注本")
    if (EXTRA_ROOT / "黑格尔论宗教与政治（全本）.md").exists() and (EXTRA_ROOT / "黑格尔论宗教与政治（全本）.md").stat().st_size > 50000:
        replace_stubs.add("【完整汉译】黑格尔论宗教与政治（全十章精译与导读）")
    if (SOURCE_ROOT / "德国古典哲学" / "黑格尔" / "【完整全本】黑格尔《法哲学原理》汉译精注本.md").exists():
        replace_stubs.add("00_法哲学原理_序言与导论（§1-§33）")
    if (NEW_BOOKS_ROOT / "哲学的非意识形态化危机（尤林娜）.md").exists():
        replace_stubs.add("哲学的非意识形态化危机")
    if (NEW_BOOKS_ROOT / "张世英文集·第4卷：康德与西方哲学研究.md").exists():
        replace_stubs.add("康德的《纯粹理性批判》")

    # 1. 原中文译本目录
    for dp, dn, fn in os.walk(SOURCE_ROOT):
        if "思辨之声阅读器" in dp:
            continue
        md_stems = {re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", os.path.splitext(x)[0])
                    for x in fn if x.lower().endswith(".md")}
        for f in sorted(fn):
            ext = os.path.splitext(f)[1].lower()
            if ext not in (".md", ".epub") or f.lower() == "readme.md":
                continue
            if ext == ".epub" and any(s and s in re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", os.path.splitext(f)[0])
                                      for s in md_stems):
                continue
            full_path = Path(dp) / f
            if full_path.stem in replace_stubs:
                continue
            data_hash = hashlib.md5(full_path.read_bytes()).hexdigest()
            if data_hash in seen_hashes:
                continue
            seen_hashes.add(data_hash)
            sources.append((full_path, "main"))

    # 2. 原先精校转录目录 (extra-books/*.md)
    if EXTRA_ROOT.exists():
        for f in sorted(EXTRA_ROOT.glob("*.md")):
            if f.name.startswith("_") or f.stat().st_size < 1000 or f.stem in replace_stubs:
                continue
            data_hash = hashlib.md5(f.read_bytes()).hexdigest()
            if data_hash in seen_hashes:
                continue
            seen_hashes.add(data_hash)
            sources.append((f, "extra"))

    # 3. 新批次成品典籍与《张世英文集》增补分卷 (new-books/*.md)
    if NEW_BOOKS_ROOT.exists():
        for f in sorted(NEW_BOOKS_ROOT.glob("*.md")):
            if f.name.startswith("_") or f.stat().st_size < 1000:
                continue
            data_hash = hashlib.md5(f.read_bytes()).hexdigest()
            if data_hash in seen_hashes:
                continue
            seen_hashes.add(data_hash)
            sources.append((f, "new"))

    # 4. 英文/外文原典书库 (english-books/*.md)
    if ENGLISH_BOOKS_ROOT.exists():
        for f in sorted(ENGLISH_BOOKS_ROOT.glob("*.md")):
            if f.name.startswith("_") or f.name == "00-library-index.md" or f.stat().st_size < 1000:
                continue
            data_hash = hashlib.md5(f.read_bytes()).hexdigest()
            if data_hash in seen_hashes:
                continue
            seen_hashes.add(data_hash)
            sources.append((f, "en"))

    catalog = []
    search_index = []
    palette_counters = {}
    total_chunk_files = 0

    for src, origin in sources:
        rel = str(src.relative_to(SOURCE_ROOT)) if origin == "main" else f"{origin}/{src.name}"
        stem = src.stem
        top_folder = src.relative_to(SOURCE_ROOT).parts[0] if origin == "main" else origin
        lang = "en" if origin == "en" else "zh"

        if lang == "en":
            if stem in ENGLISH_BOOK_META:
                title, author, category, station = ENGLISH_BOOK_META[stem]
            else:
                title = stem.replace("-", " ").title()
                author = "Philosophy Archive"
                category, station = "古希腊与近代原典", "classic"
        elif stem in BOOK_META_OVERRIDES:
            title, author, category, station = BOOK_META_OVERRIDES[stem]
        else:
            title = stem
            author = "哲学译著"
            if "德国" in top_folder:
                category, station = "德国古典原典", "german"
            elif "西马" in top_folder:
                category, station = "马克思与批判理论", "marxism"
            elif "结构" in top_folder or "后现代" in top_folder or "巴迪欧" in top_folder:
                category, station = "精神分析与后现代", "postmodern"
            else:
                category, station = "张世英哲学全书", "chinese"

        book_id = make_book_id(rel)
        if src.suffix.lower() == ".md":
            all_blocks = parse_markdown_to_blocks(src.read_text(encoding="utf-8", errors="replace"), lang=lang)
        else:
            all_blocks = parse_epub_to_blocks(src)

        is_ref = category in ("辞典与术语工具", "辞典与通识百科")
        chapters = split_blocks_into_chapters(
            all_blocks,
            title,
            is_reference_book=is_ref,
            lang=lang,
        )
        book_dir = OUT_ROOT / "books" / book_id
        book_dir.mkdir(parents=True, exist_ok=True)

        chapter_metas = []
        total_chars = 0
        total_words = 0
        lead_excerpt = ""
        first_body_chapter = None

        cur_chunk_idx = 0
        cur_chunk_data = {}
        cur_chunk_chars = 0

        def flush_chunk():
            nonlocal cur_chunk_idx, cur_chunk_data, cur_chunk_chars, total_chunk_files
            if not cur_chunk_data:
                return
            (book_dir / f"p_{cur_chunk_idx}.json").write_text(
                json.dumps(cur_chunk_data, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8"
            )
            total_chunk_files += 1
            cur_chunk_idx += 1
            cur_chunk_data = {}
            cur_chunk_chars = 0

        chunk_cap = 140000 if lang == "en" else CHUNK_TARGET_CHARS
        for ch_idx, ch in enumerate(chapters):
            ch_chars = sum(len(b["t"]) for b in ch["blocks"])
            if lang == "en":
                total_words += sum(len(b["t"].split()) for b in ch["blocks"])
            if cur_chunk_data and cur_chunk_chars + ch_chars > chunk_cap:
                flush_chunk()

            front_flag = is_front_matter_chapter(ch["title"], ch["blocks"])
            if first_body_chapter is None and not front_flag and ch_chars >= 180:
                first_body_chapter = ch_idx

            ch_preview = ""
            headings_in_ch = []
            for b in ch["blocks"]:
                if b["y"] == "h":
                    headings_in_ch.append(clean_preview(b["t"]))
                if not ch_preview and b["y"] in ("p", "q"):
                    cp = clean_preview(b["t"])
                    if len(cp) >= 20:
                        ch_preview = cp[:110]
                if not lead_excerpt and not front_flag and b["y"] in ("p", "q"):
                    cp = clean_preview(b["t"])
                    if len(cp) >= 36:
                        lead_excerpt = cp[:150]

            total_chars += ch_chars
            cur_chunk_data[str(ch_idx)] = {
                "i": ch_idx,
                "t": ch["title"],
                "l": ch["level"],
                "b": ch["blocks"],
            }
            cur_chunk_chars += ch_chars

            ch_meta = {
                "index": ch_idx,
                "chunk": cur_chunk_idx,
                "title": ch["title"],
                "level": ch["level"],
                "charCount": ch_chars,
                "blockCount": len(ch["blocks"]),
                "preview": ch_preview,
            }
            if front_flag:
                ch_meta["isFrontMatter"] = True
            chapter_metas.append(ch_meta)

            search_index.append({
                "b": book_id,
                "c": ch_idx,
                "t": ch["title"],
                "k": " ".join(headings_in_ch[:4])[:100],
                "p": ch_preview[:80],
            })

        flush_chunk()

        if first_body_chapter is None:
            first_body_chapter = 0

        palettes = COVER_PALETTES.get(category, ["obsidian-gold"])
        p_idx = palette_counters.get(category, 0)
        palette = palettes[p_idx % len(palettes)]
        palette_counters[category] = p_idx + 1

        est_read = max(1, round(total_words / 220)) if lang == "en" else max(1, round(total_chars / 420))
        est_listen = max(1, round(total_words / 150)) if lang == "en" else max(1, round(total_chars / 230))
        mono_m = re.search(r'[A-Za-z\u4e00-\u9fff]', title)
        monogram = mono_m.group(0).upper() if mono_m else ("P" if lang == "en" else "哲")

        book_meta = {
            "id": book_id,
            "sourcePath": str(src),
            "title": title,
            "author": author,
            "category": category,
            "lang": lang,
            "station": station,
            "sourceFormat": src.suffix.lower().lstrip("."),
            "charCount": total_chars,
            "wordCount": total_words if lang == "en" else total_chars,
            "chapterCount": len(chapter_metas),
            "chunkCount": cur_chunk_idx,
            "estReadMin": est_read,
            "estListenMin": est_listen,
            "coverPalette": palette,
            "monogram": monogram,
            "excerpt": lead_excerpt or (f"Collected in {category}." if lang == "en" else f"收录于《{category}》典藏书系。"),
            "firstBodyChapter": first_body_chapter,
            "chapters": chapter_metas,
        }
        (book_dir / "meta.json").write_text(
            json.dumps(book_meta, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8"
        )

        catalog.append({k: v for k, v in book_meta.items() if k != "chapters"})

    cat_order = {
        "古希腊与近代哲思": 1,
        "古希腊与近代原典": 1,
        "德国古典原典": 2,
        "康德·费希特与谢林": 2,
        "黑格尔原典与研究": 3,
        "马克思与批判理论": 4,
        "现象学与存在哲学": 5,
        "精神分析与后现代": 6,
        "张世英哲学全书": 7,
        "辞典与术语工具": 8,
        "辞典与通识百科": 8,
    }
    catalog.sort(key=lambda x: (0 if x.get("lang", "zh") == "zh" else 1, cat_order.get(x["category"], 99), x["author"], x["title"]))

    (OUT_ROOT / "catalog.json").write_text(
        json.dumps({
            "version": 4,
            "generatedAt": "2026-11-27",
            "bookCount": len(catalog),
            "totalChars": sum(b["charCount"] for b in catalog),
            "books": catalog,
        }, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8"
    )

    (OUT_ROOT / "search-index.json").write_text(
        json.dumps(search_index, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8"
    )

    # 构建跨书哲学术语联动词典 (glossary-index.json)
    glossary_map = {}
    for term, orig, desc, src_label in CORE_PHILOSOPHY_GLOSSARY:
        glossary_map[term] = {"t": term, "o": orig, "d": desc, "s": src_label}

    # 自动从内置的《拉康术语译名表》和《康德辞典》抽取词条并绑定原书跳转定位
    for b in catalog:
        if b.get("lang", "zh") != "zh" or b["category"] != "辞典与术语工具":
            continue
        bdir = OUT_ROOT / "books" / b["id"]
        meta = json.loads((bdir / "meta.json").read_text(encoding="utf-8"))
        for ch_meta in meta["chapters"]:
            if ch_meta.get("isFrontMatter"):
                continue
            chunk = json.loads((bdir / f"p_{ch_meta['chunk']}.json").read_text(encoding="utf-8"))
            raw_ch = chunk.get(str(ch_meta["index"]))
            if not raw_ch:
                continue
            # 1) 表格类术语（如《拉康术语译名表》）
            for blk in raw_ch["b"]:
                if blk["y"] == "t":
                    lines = [ln.strip() for ln in blk["t"].splitlines() if "|" in ln]
                    for ln in lines[2:]:
                        cells = [clean_preview(c) for c in ln.strip("|").split("|")]
                        if len(cells) >= 3:
                            orig_term = cells[0][:40]
                            zh_term = re.split(r'[（(/／、，,]', cells[1])[0].strip()
                            note = " · ".join(c for c in cells[2:] if c)[:200]
                            if 1 <= len(zh_term) <= 14 and zh_term not in glossary_map and note:
                                glossary_map[zh_term] = {
                                    "t": zh_term,
                                    "o": orig_term,
                                    "d": note,
                                    "s": f"《{b['title']}》",
                                    "b": b["id"],
                                    "c": ch_meta["index"],
                                }
            # 2) 辞典词条小节（如《康德辞典》）
            if "康德辞典" in b["title"]:
                for bi, blk in enumerate(raw_ch["b"]):
                    if blk["y"] == "h" and blk.get("l", 2) >= 2:
                        head = clean_preview(blk["t"])
                        zh_term = re.split(r'[（(\[【·:：]', head)[0].strip()
                        orig_m = re.search(r'[（(]([A-Za-zÄÖÜäöüß\s\-/]+)[）)]', head)
                        orig_term = orig_m.group(1).strip() if orig_m else ""
                        if 2 <= len(zh_term) <= 10 and re.search(r'[\u4e00-\u9fff]', zh_term) and zh_term not in glossary_map:
                            # 取其后第一个正文段落作为简要释义
                            desc = ""
                            for nb in raw_ch["b"][bi + 1 : bi + 4]:
                                if nb["y"] == "p":
                                    desc = clean_preview(nb["t"])[:220]
                                    break
                            if len(desc) >= 25:
                                glossary_map[zh_term] = {
                                    "t": zh_term,
                                    "o": orig_term,
                                    "d": desc,
                                    "s": f"《{b['title']}》",
                                    "b": b["id"],
                                    "c": ch_meta["index"],
                                }

    glossary_list = list(glossary_map.values())
    (OUT_ROOT / "glossary-index.json").write_text(
        json.dumps(glossary_list, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    total_bytes = sum(p.stat().st_size for p in OUT_ROOT.rglob("*") if p.is_file())
    total_files = sum(1 for p in OUT_ROOT.rglob("*") if p.is_file())
    front_skipped = sum(1 for b in catalog if b["firstBodyChapter"] > 0)
    print(f"DONE! Books: {len(catalog)}, Chapters: {len(search_index)}, Glossary terms: {len(glossary_list)}, Chunk files: {total_chunk_files}, Total files: {total_files}")
    print(f"Build-time footnotes folded: {TOTAL_FN_STATS['folded']:,} redundant blocks removed (in-ch bound={TOTAL_FN_STATS['bound']:,}, cross-ch bound={TOTAL_FN_STATS['cross_bound']:,}, glosses={TOTAL_FN_STATS['gloss']:,}, empty note chapters pruned={TOTAL_FN_STATS['pruned_note_chs']})")
    print(f"Books with auto-skipped TOC/front-matter: {front_skipped}/{len(catalog)}")
    print(f"Total chars: {sum(b['charCount'] for b in catalog):,}")
    print(f"Total JSON size (uncompressed): {total_bytes / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
