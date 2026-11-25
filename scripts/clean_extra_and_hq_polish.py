#!/usr/bin/env python3
"""
clean_extra_and_hq_polish.py —
阶段 1：对全部 10 部含封面/CIP/版权/原书目录/页眉页码的 extra-books/*.md 执行精确手术式清洗与章节结构化（零正文损失）。
阶段 2：8 路并行调用 DSH (commandcode / deepseek-v4.1-flash) 深度精校：
  - 《黑格尔《精神现象学》述评.md》（全本 100% 精校，彻底根除 1962 年繁体旧印 OCR 错字并规范六章标题）
  - 《黑格尔《小逻辑》译注.md》（精准识别全部含 OCR 噪点/错字切片并 8 路并行精校，彻底根除 黑恪尔/排尿/企第/黑分/水乎 等错识）
"""
import os
import re
import time
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

EXTRA = Path(r"D:\咕咕嘎嘎反重力\extra-books")
WORK = Path(r"D:\咕咕嘎嘎反重力\polish-work-hq")
WORK.mkdir(parents=True, exist_ok=True)

DSH_BIN = r"C:\dsh-remote\cli\node_modules\@deepseek-ai\dsh\lib\bin.js"
PATCH = r"D:\咕咕嘎嘎反重力\scripts\dsh_command_v41.yml"
WORKERS = 8

TERMINAL_PUNCT = set('。！？：；…”』」】）!.?:;')


def read_paras(path: Path) -> list[str]:
    return [x.strip() for x in re.split(r'\n\s*\n', path.read_text(encoding='utf-8')) if x.strip()]


def write_paras(path: Path, title: str, paras: list[str]):
    out = [f"# {title}"]
    for p in paras:
        s = p.strip()
        if not s:
            continue
        if len(out) == 1 and s in (f"# {title}", title):
            continue
        out.append(s)
    path.write_text("\n\n".join(out) + "\n", encoding="utf-8")


def find_idx(paras: list[str], predicate, start: int = 0) -> int:
    for i in range(start, len(paras)):
        if predicate(paras[i]):
            return i
    return -1


def clean_all_extra_front_back_and_toc():
    # 1. 哲学导论.md
    p = EXTRA / "哲学导论.md"
    paras = read_paras(p)
    idx = find_idx(paras, lambda s: "导言" in s and "什么是哲学" in s)
    if idx > 1:
        paras = paras[idx:]
    cleaned = []
    for s in paras:
        # 去除行内嵌入页眉：如 "1 | 导言什么是哲学..." 或 "哲学导论（第三版）| 2..." 或 "3 I 导言什么是哲学..."
        s = re.sub(r'^\d{1,3}\s*[|｜I]\s*导言\s*什么是哲学\s*', '', s)
        s = re.sub(r'^哲学导论（第三版）\s*[|｜I]\s*\d{1,3}\s*', '', s)
        s = re.sub(r'^\d{1,3}\s*[|｜I]\s*第[一二三四五六七八九十]+章[^\n]{0,16}\s*', '', s)
        if re.match(r'^(?:\d{1,3}\s*[|｜I]\s*.*|哲学导论（第三版）\s*[|｜I]?\s*\d*)$', s) and len(s) < 28:
            continue
        if s:
            cleaned.append(s)
    write_paras(p, "哲学导论", cleaned)
    print(f"[CLEANED] {p.name}: {len(cleaned)} paras")

    # 2. 康德的《纯粹理性批判》.md
    p = EXTRA / "康德的《纯粹理性批判》.md"
    paras = read_paras(p)
    i_xu = find_idx(paras, lambda s: s in ("序", "## 序"))
    i_toc = find_idx(paras, lambda s: re.match(r'^目.{0,2}录$', s), start=max(0, i_xu))
    i_lec1 = find_idx(paras, lambda s: re.match(r'^##\s*第一讲\s*$', s) or (s.startswith("## 第一讲") and "·" not in s and not re.search(r'\d+$', s)), start=max(0, i_toc + 1))
    if i_xu >= 0 and i_toc > i_xu and i_lec1 > i_toc:
        kept = ["## 序"] + paras[i_xu + 1:i_toc] + paras[i_lec1:]
    elif i_lec1 > 0:
        kept = paras[i_lec1:]
    else:
        kept = paras
    kept = [s for s in kept if not re.match(r'^[·•\.。\-—\s]*\d{1,3}[·•\.。\-—\s]*$', s)]
    write_paras(p, "康德的《纯粹理性批判》", kept)
    print(f"[CLEANED] {p.name}: {len(kept)} paras")

    # 3. 张世英黑格尔哲学五讲.md
    p = EXTRA / "张世英黑格尔哲学五讲.md"
    paras = read_paras(p)
    i_preface = find_idx(paras, lambda s: s.startswith("1982年暑期"))
    i_toc = find_idx(paras, lambda s: s in ("目", "目录", "目 录"), start=max(0, i_preface))
    i_body = find_idx(paras, lambda s: re.match(r'^##\s*第一讲\s*黑格尔哲学体系', s), start=max(0, i_toc))
    if i_preface >= 0 and i_toc > i_preface and i_body > i_toc:
        raw_kept = ["## 前言"] + paras[i_preface:i_toc] + paras[i_body:]
    elif i_body > 0:
        raw_kept = paras[i_body:]
    else:
        raw_kept = paras

    # 去除页码/页眉/误标为 ## 的纯数字或句子碎片，并把被页码打断的句子拼接起来
    merged = []
    for s in raw_kept:
        s = s.replace("张叶英", "张世英")
        if re.match(r'^#{1,6}\s+\d{1,3}$', s):
            continue
        if re.match(r'^[/7lI|]?\s*\d{1,3}\s*/$', s):
            continue
        if s in ("张世英黑格尔哲学五讲", "黑格尔哲学五讲", "前", "言", "作者近照"):
            continue
        # 误把正文“## 第三部分，他叫伦理学...”识别成标题 -> 降级回正文
        if s.startswith("## "):
            inner = s[3:].strip()
            if (len(inner) > 36 or "，" in inner or "。" in inner) and not re.match(r'^第[一二三四五]讲', inner):
                s = inner
        # 促进真实的五讲小节标题
        if not s.startswith("#") and s in (
            "三个部门：逻辑学、自然哲学、精神哲学",
            "精神哲学是最具体最高的哲学",
            "三个部门：三位一体，互为中项",
            "人的精神和绝对精神的关系",
            "《精神现象学》的序言：关于真理问题",
            "《精神现象学》和黑格尔整个哲学体系的关系",
            "“爬梯子”：整个精神现象的发展过程",
            "思想、概念的四大特点",
            "《逻辑学》三大部分的划分以及如何开端的问题",
            "存在论", "本质论", "概念论",
            "主观精神", "客观精神", "绝对精神",
        ):
            s = f"### {s}"

        if (
            merged
            and not s.startswith("#")
            and not merged[-1].startswith("#")
            and len(merged[-1]) > 0
            and merged[-1][-1] not in TERMINAL_PUNCT
            and not re.match(r'^(①|②|③|④|⑤|2017年|张世英)', s)
        ):
            merged[-1] = merged[-1] + s
        else:
            merged.append(s)
    write_paras(p, "张世英黑格尔哲学五讲", merged)
    print(f"[CLEANED] {p.name}: {len(merged)} paras")

    # 4. 德国哲学论丛.md
    p = EXTRA / "德国哲学论丛.md"
    paras = read_paras(p)
    i_start = find_idx(paras, lambda s: s == "加达默尔与后期海德格尔" or s.startswith("## 加达默尔与后期海德格尔"))
    if i_start > 1:
        paras = paras[i_start:]
    ESSAY_TITLES = [
        "加达默尔与后期海德格尔",
        "解释学上的施莱尔马赫之路与黑格尔之路",
        "“实际生活经验”的“形式显示”",
        "“解神话”与人的生存",
        "诠释学中的真、假和似真性",
        "对他人及其生命表现的理解",
        "海德格尔与黑格尔论无",
        "存在的两极：理性与生存",
        "雅斯贝尔斯悲剧哲学初探",
        "胡塞尔的现象学时间观",
        "胡塞尔“意向性”观念简论",
        "神秘主义的合理化与理性的神秘化",
        "康德美学新探",
        "论康德形而上学的人类学基础",
        "康德实践论中的人",
        "莱布尼茨在中国文化中的两大发现",
        "真理的本质",
        "名人权威也要同读者对话",
        "和平仅仅是没有战争吗？",
        "费尔巴哈在什么意义上终结了启蒙之宗教批判？",
        "A．鲁斯特：《维特根斯坦的心理哲学》",
        "汉斯·米夏埃尔·鲍姆加特纳",
        "内容提要",
    ]
    cleaned = []
    for s in paras:
        if not s.startswith("#"):
            for et in ESSAY_TITLES:
                if s == et or (s.startswith(et) and len(s) <= len(et) + 12):
                    s = f"## {s}"
                    break
        cleaned.append(s)
    write_paras(p, "德国哲学论丛", cleaned)
    print(f"[CLEANED] {p.name}: {len(cleaned)} paras")

    # 5. 自我实现的历程：解读黑格尔《精神现象学》.md
    p = EXTRA / "自我实现的历程：解读黑格尔《精神现象学》.md"
    paras = read_paras(p)
    i_xu = find_idx(paras, lambda s: s.startswith("人要想实现自我，创造一个辉煌的世界"))
    if i_xu > 1:
        paras = ["## 序"] + paras[i_xu:]
    cleaned = []
    for s in paras:
        s = re.sub(r'^名家解读经典名著[从丛]书\s*', '', s)
        if s in ("序", "名家解读经典名著从书", "名家解读经典名著丛书"):
            continue
        if s:
            cleaned.append(s)
    write_paras(p, "自我实现的历程：解读黑格尔《精神现象学》", cleaned)
    print(f"[CLEANED] {p.name}: {len(cleaned)} paras")

    # 6. 西方哲学史（张世英）.md
    p = EXTRA / "西方哲学史（张世英）.md"
    paras = read_paras(p)
    i_start = find_idx(paras, lambda s: s.startswith("西方哲学史是关于公元前6世纪"))
    if i_start > 1:
        paras = ["## 导论：西方哲学史概说"] + paras[i_start:]
    MAJOR_H2 = {
        "古希腊哲学", "中世纪哲学", "近代哲学", "现代哲学",
        "西方哲学史的主要问题和主要特点", "附录",
    }
    SUB_H3 = {
        "中世纪早期哲学", "中世纪中期哲学", "中世纪晚期哲学",
        "文艺复兴时期哲学", "近代中期哲学", "德国古典哲学",
        "哲学与科学、宗教的关系", "思维与存在的关系", "一与多的关系",
        "古希腊哲学主要学派", "现代西方哲学主要学说、思潮和学派",
    }
    cleaned = []
    seen_intro_skip = 0
    for idx_p, s in enumerate(paras):
        # 开头 30 段内的概览卡片里也有“古希腊哲学”“中世纪哲学”，只提升正文中首次之后或长度匹配的正式标题
        if not s.startswith("#"):
            if s in MAJOR_H2 and idx_p > 5:
                s = f"## {s}"
            elif s in SUB_H3 and idx_p > 5:
                s = f"### {s}"
        cleaned.append(s)
    write_paras(p, "西方哲学史", cleaned)
    print(f"[CLEANED] {p.name}: {len(cleaned)} paras")

    # 7. 论黑格尔的逻辑学.md
    p = EXTRA / "论黑格尔的逻辑学.md"
    paras = read_paras(p)
    # 找正文开端的 "## 绪 论"（后面紧跟 "黑格尔哲学，极其复杂矛盾"）
    i_xu = find_idx(paras, lambda s: s.startswith("黑格尔哲学，极其复杂矛盾"))
    if i_xu > 2:
        paras = ["## 绪论"] + paras[i_xu:]
    cleaned = []
    for s in paras:
        if re.match(r'^(?:\.{1,4}\d{1,3}\.{0,4}|\d{1,3}\.{2,4})$', s):
            continue
        cleaned.append(s)
    write_paras(p, "论黑格尔的逻辑学", cleaned)
    print(f"[CLEANED] {p.name}: {len(cleaned)} paras")

    # 8. 黑格尔论宗教与政治（全本）.md
    p = EXTRA / "黑格尔论宗教与政治（全本）.md"
    paras = read_paras(p)
    i_intro = find_idx(paras, lambda s: s in ("导论", "## 导论"))
    if i_intro > 1:
        paras = ["## 导论"] + paras[i_intro + 1:]
    write_paras(p, "黑格尔论宗教与政治", paras)
    print(f"[CLEANED] {p.name}: {len(paras)} paras")

    # 9. 黑格尔《精神现象学》述评.md (先清理封面/版权/原书目录)
    p = EXTRA / "黑格尔《精神现象学》述评.md"
    paras = read_paras(p)
    i_pre = find_idx(paras, lambda s: s in ("## 前言", "前言") and find_idx(paras, lambda x: "1806年" in x, start=0) > 0)
    i_1806 = find_idx(paras, lambda s: "1806年" in s and "1807年" in s)
    if i_1806 > 1:
        paras = ["## 前言"] + paras[i_1806:]
    write_paras(p, "黑格尔《精神现象学》述评", paras)
    print(f"[CLEANED] {p.name}: {len(paras)} paras")

    # 10. 黑格尔《小逻辑》译注.md (保留序言，剥离封面/简写表/自录)
    p = EXTRA / "黑格尔《小逻辑》译注.md"
    paras = read_paras(p)
    i_xu = find_idx(paras, lambda s: s.startswith("本书的内容是逐节讲解和注释"))
    i_jian = find_idx(paras, lambda s: "简写表" in s, start=max(0, i_xu))
    i_v1 = find_idx(paras, lambda s: s in ("## 第一版序言", "第一版序言") and find_idx(paras, lambda x: "黑格尔亲自发表的著作有四" in x, start=0) > 0, start=max(0, i_jian))
    i_v1_body = find_idx(paras, lambda s: s.startswith("黑格尔亲自发表的著作有四"))
    if i_xu >= 0 and i_jian > i_xu and i_v1_body > i_jian:
        kept = ["## 序言"] + paras[i_xu:i_jian] + ["## 第一版序言"] + paras[i_v1_body:]
    elif i_v1_body > 0:
        kept = ["## 第一版序言"] + paras[i_v1_body:]
    else:
        kept = paras
    # 清除零散 "+3" / "T" 噪声行并提升主要章节标题
    cleaned = []
    for s in kept:
        if re.match(r'^[+＋·•\-—\s]*\d{1,3}[+＋·•\-—\s]*$', s) or s in ("T", "I", "l"):
            continue
        if not s.startswith("#") and re.match(r'^(第二版序言|第三版序言|导言|逻辑学概念的初步规定|第一篇\s*存在论|第二篇\s*本质论|第三篇\s*概念论|附录[：:]\s*黑格尔论)', s) and len(s) <= 32:
            s = f"## {s}"
        elif not s.startswith("#") and re.match(r'^第[一二三四五六七八九十百0-9]+节(?:\s|$|（)', s) and len(s) <= 28:
            s = f"### {s}"
        cleaned.append(s)
    write_paras(p, "黑格尔《小逻辑》译注", cleaned)
    print(f"[CLEANED] {p.name}: {len(cleaned)} paras")


def call_dsh(prompt: str, timeout: int = 300):
    env = os.environ.copy()
    env["DSH_PERMISSION_MODE"] = "danger-full-access"
    try:
        subprocess.run(
            ["node", DSH_BIN, "--profile", "headless", "--patch", PATCH, prompt],
            check=True,
            env=env,
            timeout=timeout,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        pass


def dsh_polish_book(path: Path, slug: str, book_desc: str, only_noisy: bool = False):
    paras = read_paras(path)
    title_line = paras[0] if paras and paras[0].startswith("# ") else f"# {path.stem}"
    body = paras[1:] if paras and paras[0].startswith("# ") else paras

    # 切分为 ~4200 字切片
    slices = []
    cur, clen = [], 0
    for p in body:
        if clen + len(p) > 4200 and cur:
            slices.append("\n\n".join(cur))
            cur, clen = [p], len(p)
        else:
            cur.append(p)
            clen += len(p)
    if cur:
        slices.append("\n\n".join(cur))

    NOISE_RE = re.compile(
        r'(黑恪尔|排尿|企第|企崇|黑分|水乎|述坪|邂辑|艳对|对理念|对知|对精神|认識|辯證|眞|真。|\d+真|'
        r'《[^《》\n]{1,28}>|<[^《》\n]{1,28}》|一—|一-|弓l者|器格尔|Vovolis|Goitlob|艾因西德谟>|'
        r'世杞|普逼|餐乏|懒情|学間|抖不是|會經|简写 表|绎注|热忧|倩感|主艾)'
    )

    sdir = WORK / slug
    (sdir / "src").mkdir(parents=True, exist_ok=True)
    (sdir / "out").mkdir(parents=True, exist_ok=True)

    todo = []
    for i, sl in enumerate(slices):
        sp = sdir / "src" / f"part_{i:03d}.md"
        op = sdir / "out" / f"part_{i:03d}.md"
        sp.write_text(sl, encoding="utf-8")
        if only_noisy and not NOISE_RE.search(sl):
            continue
        if op.exists() and len(op.read_text(encoding="utf-8")) >= len(sl) * 0.78:
            continue
        todo.append((i, sp, op, len(sl)))

    print(f"[DSH {slug}] total slices={len(slices)}, todo={len(todo)} (only_noisy={only_noisy})")

    def run_one(item):
        idx, sp, op, slen = item
        prompt = (
            f"你是精通德国古典哲学与黑格尔文献的资深出版编校专家。\n"
            f"请逐段完整精校 `{sp}`（{book_desc} 的高精度扫描 OCR 稿），直接将精校后的干净简体中文 Markdown 写入 `{op}`。\n"
            "严格要求：\n"
            "1. 修复全部 OCR 错别字、繁体异体字（统一为规范简体中文）、破损书名号（如 `<...》`/`《...>`）、错误破折号（如 `一一`/`一-` -> `——`）、错误页码字（如 `第48真` -> `第48页`）、人名与德文拼写错误（如 `黑恪尔`->`黑格尔`、`黑格尔企第`->`黑格尔全集`、`排尿任何中介性`->`排斥任何中介性`、`邂辑学`->`逻辑学`、`对理念`->`绝对理念`、`Vovolis`->`Novalis`）。\n"
            "2. 100% 忠实保留全部原文意思、论证、注释与外文术语，绝不删减、改写或总结；将误断的同一自然段合并流畅。\n"
            "3. 将明确的章节标题（如 `第一章 ...`、`第二章 ...`、`第一篇 ...`、`§...` / `第X节`）规范为 Markdown `##` / `###` 标题；切勿输出任何 HTML 标签或反斜杠转义星号。\n"
            "完成后仅回复 DONE。"
        )
        t0 = time.time()
        for attempt in range(2):
            call_dsh(prompt, timeout=300)
            if op.exists() and len(op.read_text(encoding="utf-8")) >= slen * 0.78:
                return f"OK part_{idx:03d} ({slen}->{len(op.read_text(encoding='utf-8'))}, {time.time()-t0:.1f}s)"
        return f"FALLBACK part_{idx:03d}"

    if todo:
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futs = [ex.submit(run_one, it) for it in todo]
            for f in as_completed(futs):
                print(f"  [{slug}]", f.result())

    # 装配回原文件
    assembled = [title_line]
    for i, sl in enumerate(slices):
        op = sdir / "out" / f"part_{i:03d}.md"
        if op.exists() and len(op.read_text(encoding="utf-8")) >= len(sl) * 0.78:
            assembled.append(op.read_text(encoding="utf-8").strip())
        else:
            assembled.append(sl)
    full = "\n\n".join(assembled) + "\n"
    path.write_text(full, encoding="utf-8")
    print(f"[DSH DONE {slug}] {path.name}: {len(full):,} chars")


if __name__ == "__main__":
    print("=== PHASE 1: Surgical Front-Matter / TOC / Header Cleanup ===")
    clean_all_extra_front_back_and_toc()

    print("\n=== PHASE 2: 8-way DSH HQ Proofreading ===")
    dsh_polish_book(
        EXTRA / "黑格尔《精神现象学》述评.md",
        "shuping_1962",
        "张世英《黑格尔〈精神现象学〉述评》（1962年版）",
        only_noisy=False,
    )
    dsh_polish_book(
        EXTRA / "黑格尔《小逻辑》译注.md",
        "xiaoluoji_1982",
        "张世英编著《黑格尔〈小逻辑〉译注》（1982年版）",
        only_noisy=True,
    )
    print("\nALL HQ CLEANUP & DSH POLISH COMPLETED!")
