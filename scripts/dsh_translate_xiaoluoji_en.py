#!/usr/bin/env python3
"""
dsh_translate_xiaoluoji_en.py — 基于剑桥大学出版社《黑格尔哲学科学百科全书纲要·第一部分：逻辑学》
（Brinkmann & Dahlstrom 权威英译本，含全部德文关键术语对照、全部三版序言、导论、§1-§244、全部 154 条口述附释与学术脚注），
采用 16 路并行 DSH (commandcode / deepseek-v4.1-flash) 逐段精译为术语统一、语境连贯、零缺节、零重复章的全新中文学术译本。
"""
import concurrent.futures
import html
import json
import pathlib
import re
import subprocess
import time
import zipfile

EPUB_PATH = pathlib.Path(r"d:\文献库\德国古典哲学\黑格尔\【英文】小逻辑.epub")
CACHE_DIR = pathlib.Path(r"d:\咕咕嘎嘎反重力\extra-books\_xlj_en_trans_cache")
OUT_MD = pathlib.Path(r"d:\文献库\中文译本\德国古典哲学\黑格尔\【完整全本】黑格尔《小逻辑》汉译精注本.md")

DSH_BIN = r"C:\dsh-remote\cli\node_modules\@deepseek-ai\dsh\lib\bin.js"
PATCH = r"D:\咕咕嘎嘎反重力\scripts\dsh_command_v41.yml"
WORKERS = 16
CHUNK_TARGET = 2500

# 24 章主体 + 2 章剑桥编者导论/译者说明 = 26 章精确规范目录（零重复、零空壳）
CANONICAL_SEC_H1 = {
    1: "# 导论（§1-§18）",
    19: "# 逻辑学的初步概念（§19-§25）",
    26: "# A. 思想对待客观性的第一种态度：形而上学（§26-§36）",
    37: "# B. 思想对待客观性的第二种态度：I. 经验论（§37-§39）",
    40: "# B. 思想对待客观性的第二种态度：II. 批判哲学（§40-§60）",
    61: "# C. 思想对待客观性的第三种态度：直接知识（§61-§78）",
    79: "# 逻辑学的进一步概念与划分（§79-§83）",
    84: "# 第一篇 存在论（§84-§85）",
    86: "# A. 质（Qualität，§86-§98）",
    99: "# B. 量（Quantität，§99-§106）",
    107: "# C. 尺度（Das Maß，§107-§111）",
    112: "# 第二篇 本质论（§112-§114）",
    115: "# A. 本质作为实存的根据（§115-§130）",
    131: "# B. 现象（Die Erscheinung，§131-§141）",
    142: "# C. 现实性（Die Wirklichkeit，§142-§159）",
    160: "# 第三篇 概念论（§160-§162）",
    163: "# A. 主观概念（Der subjektive Begriff，§163-§193）",
    194: "# B. 客体（Das Objekt，§194-§212）",
    213: "# C. 理念（Die Idee，§213-§244）",
}

FILE_PREFIX_H1 = {
    "OEBPS/part0007.xhtml": "# 译者导论：黑格尔的《百科全书逻辑学》",
    "OEBPS/part0008.xhtml": "# 剑桥版译者说明",
    "OEBPS/part0010.xhtml": "# 第一版序言（1817）",
    "OEBPS/part0011.xhtml": "# 第二版序言（1827）",
    "OEBPS/part0012.xhtml": "# 第三版序言（1830）",
}

# 跳过原 EPUB 中已由 CANONICAL_SEC_H1 或 FILE_PREFIX_H1 规范统领的独立大标题，避免章首重复
SKIP_RAW_TITLES = {
    "introduction",
    "introduction hegel's encyclopedia logic",
    "translators' note",
    "preface to the first edition",
    "preface to the second edition",
    "foreword to the third edition",
    "part i science of logic",
    "preliminary conception",
    "a. first position of thought towards objectivity",
    "metaphysics",
    "b. second position of thought towards objectivity",
    "i. empiricism",
    "ii. critical philosophy",
    "c. third position of thought towards objectivity",
    "immediate knowing",
    "more precise conception and division of the logic",
    "first subdivision of the logic: the doctrine of being",
    "a. quality",
    "b. quantity",
    "c. measure",
    "second subdivision of the logic: the doctrine of essence",
    "a. essence as ground of existence",
    "b. appearance",
    "b. appearanc e",
    "c. actuality",
    "third subdivision of the logic: the doctrine of the concept",
    "a. the subjective concept",
    "b. the object",
    "c. the idea",
}

GLOSSARY_GUIDE = """【黑格尔《小逻辑》权威学术译名统一表（全书严格一致）】
- being / Sein → 存在；nothing / Nichts → 无；becoming / Werden → 生成
- existence (in Being) / Dasein → 定在；existence (in Essence) / Existenz → 实存
- actuality / Wirklichkeit → 现实性；reality / Realität → 实在性；ideality / Idealität → 理念性（观念性）
- essence / Wesen → 本质；shine / Schein → 映象；appearance / Erscheinung → 现象；ground / Grund → 根据
- concept / Begriff → 概念；idea / Idee → 理念；spirit / Geist → 精神；soul / Seele → 灵魂
- representation / Vorstellung → 表象；intuition / Anschauung → 直观；thinking / Denken → 思维
- understanding / Verstand → 知性；reason / Vernunft → 理性；reflection / Reflexion → 反思
- sublate / aufheben → 扬弃；determinacy / Bestimmtheit → 规定性；determination / Bestimmung → 规定
- in itself / an sich → 自在；for itself / für sich → 自为；in and for itself / an und für sich → 自在自为
- being-for-itself / Fürsichsein → 自为存在；mediation / Vermittlung → 中介；immediacy / Unmittelbarkeit → 直接性
- measure / Maß → 尺度；quantum / Quantum → 定量；degree / Grad → 度数；magnitude / Größe → 大小/量
- judgment / Urteil → 判断；syllogism / Schluß → 推论；object / Objekt → 客体；subject / Subjekt → 主体
- teleology / Teleologie → 目的论；mechanism / Mechanismus → 机械性；chemism / Chemismus → 化学性
- Addition / Zusatz → 使用 #### [附释] 或 #### [附释1] 独立小标题；Remark / Anmerkung → 使用 #### [说明] 独立小标题"""


def clean_inline_html(inner: str, fn_prefix: str) -> str:
    # 将 § 图标替换为 §
    s = re.sub(r'<img[^>]*/>', '§', inner)
    # 行内脚注锚点 <a ... class="class_25">23</a> -> [^fn_prefix_23]
    s = re.sub(
        r'<a[^>]*class="class_25"[^>]*>\s*(\d+)\s*</a>',
        lambda m: f"[^{fn_prefix}{m.group(1)}]",
        s,
    )
    # 保留斜体强调（如德文原词或重点概念）为简洁文本或 *...*，去除空 span/id
    s = re.sub(r'<span[^>]*class="class_4"[^>]*>([\s\S]*?)</span>', r'\1', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def parse_cambridge_epub() -> list[dict]:
    """
    提取剑桥版《小逻辑》EPUB 全部正文章节（part0007..0008, part0010..0013, part0015..0021），
    按 26 个规范 H1 章节组织，每章包含 blocks（英语原文段落/小节号）与 footnotes（本章脚注定义）。
    """
    part_files = [
        "OEBPS/part0007.xhtml",
        "OEBPS/part0008.xhtml",
        "OEBPS/part0010.xhtml",
        "OEBPS/part0011.xhtml",
        "OEBPS/part0012.xhtml",
        "OEBPS/part0013.xhtml",
        "OEBPS/part0015.xhtml",
        "OEBPS/part0016.xhtml",
        "OEBPS/part0017.xhtml",
        "OEBPS/part0018.xhtml",
        "OEBPS/part0019.xhtml",
        "OEBPS/part0020.xhtml",
        "OEBPS/part0021.xhtml",
    ]

    chapters = []  # [{"h1": str, "items": [(kind, text), ...], "fns": {fid: text}}]
    cur_ch = None
    all_fn_defs = {}  # fid -> text

    def start_chapter(h1: str):
        nonlocal cur_ch
        cur_ch = {"h1": h1, "items": [], "fn_ids": []}
        chapters.append(cur_ch)

    with zipfile.ZipFile(EPUB_PATH) as z:
        for fidx, fn in enumerate(part_files, 1):
            raw = z.read(fn).decode("utf-8", errors="replace")
            # 文件级唯一脚注前缀（避免跨文件编号撞车）
            fn_prefix = f"p{fidx}_"
            if fn in FILE_PREFIX_H1:
                start_chapter(FILE_PREFIX_H1[fn])

            # 逐 div 提取（严格按文档顺序）
            for m in re.finditer(r'<div[^>]*class="([^"]+)"[^>]*>([\s\S]*?)</div>', raw):
                cls = m.group(1)
                inner = m.group(2)

                # 1) 脚注定义块 (class_29 / class_31 / class_53)
                if cls in ("class_29", "class_31", "class_53"):
                    am = re.search(r'<a[^>]*class="class_30"[^>]*>\s*(\d+)\s*</a>([\s\S]*)', inner)
                    if am:
                        fnum = f"{fn_prefix}{am.group(1)}"
                        ftxt = clean_inline_html(am.group(2), fn_prefix)
                        all_fn_defs[fnum] = ftxt
                    continue

                txt = clean_inline_html(inner, fn_prefix)
                if not txt:
                    continue

                # 2) 检测 § 1 .. § 244
                sm = re.match(r'^§\s*(\d{1,3})$', txt)
                if sm:
                    sec_n = int(sm.group(1))
                    if sec_n in CANONICAL_SEC_H1:
                        start_chapter(CANONICAL_SEC_H1[sec_n])
                    if cur_ch is None:
                        start_chapter("# 导论（§1-§18）")
                    cur_ch["items"].append(("sec", f"### §{sec_n}"))
                    continue

                # 3) 跳过冗余大篇标题
                norm_low = re.sub(r'\s+', ' ', txt).strip().lower()
                if cls in ("class_34", "class_42", "class_45", "class_46", "class_", "class_36") and norm_low in SKIP_RAW_TITLES:
                    continue

                if cur_ch is None:
                    continue

                # 4) Addition / Addition 1 / Addition 2
                am = re.match(r'^Addition(?:\s*(\d+))?\.\s*(.*)$', txt)
                if cls == "class_43" or am:
                    if am:
                        anum = am.group(1) or ""
                        tag = f"#### [附释{anum}]"
                        rest = am.group(2).strip()
                        cur_ch["items"].append(("sub", tag))
                        if rest:
                            cur_ch["items"].append(("p", rest))
                        continue

                # 5) 子节小标题 (e.g. a. Being, b. Existence, c. Being-for-itself, Bibliographical references)
                if cls in ("class_36", "class_42", "class_45", "class_46", "class_27") and len(txt) <= 85:
                    cur_ch["items"].append(("h3", txt))
                    continue

                # 6) 普通正文段落（记录段落内引用的脚注编号）
                cur_ch["items"].append(("p", txt))

    # 把每个脚注归位到引用它的章节，并重新赋予全书连续纯数字编号 [^1], [^2], ...
    global_gid = 0
    old_to_new = {}
    for ch in chapters:
        ch_fns = []
        new_items = []
        for kind, txt in ch["items"]:
            def repl(match):
                nonlocal global_gid
                old_id = match.group(1)
                if old_id not in all_fn_defs:
                    return ""
                if old_id not in old_to_new:
                    global_gid += 1
                    old_to_new[old_id] = str(global_gid)
                    ch_fns.append((str(global_gid), all_fn_defs[old_id]))
                return f"[^{old_to_new[old_id]}]"

            txt2 = re.sub(r'\[\^(p\d+_\d+)\]', repl, txt)
            new_items.append((kind, txt2))
        ch["items"] = new_items
        ch["fns"] = ch_fns

    return chapters


def build_translation_jobs(chapters: list[dict]) -> list[dict]:
    """将全部 26 章切分为 ~2,500 字符的语义完整英语翻译块（严禁跨段切断，附带前文语境锚点）。"""
    jobs = []
    for ch_idx, ch in enumerate(chapters):
        # 组装正文块
        cur_lines = []
        cur_len = 0
        prev_tail = ""

        def flush_chunk(is_fn=False):
            nonlocal cur_lines, cur_len, prev_tail
            if not cur_lines:
                return
            src_txt = "\n\n".join(cur_lines)
            jobs.append({
                "id": len(jobs),
                "ch_idx": ch_idx,
                "ch_h1": ch["h1"],
                "is_fn": is_fn,
                "prev_context": prev_tail,
                "source": src_txt,
            })
            # 提取最后 180 字符作为下一块的只读语境参考
            plain = re.sub(r'^#+ .*$', '', cur_lines[-1], flags=re.M).strip()
            if plain:
                prev_tail = plain[-220:]
            cur_lines = []
            cur_len = 0

        for kind, txt in ch["items"]:
            if kind == "sec":
                line = txt
            elif kind == "sub":
                line = txt
            elif kind == "h3":
                line = f"### {txt}"
            else:
                line = txt

            # 若新节号/大段超出目标长度，在段落边界切分
            if cur_lines and (cur_len + len(line) > CHUNK_TARGET) and kind not in ("sub",):
                flush_chunk(is_fn=False)
            cur_lines.append(line)
            cur_len += len(line)

        flush_chunk(is_fn=False)

        # 本章脚注作为单独小块翻译（保持 [^N]: 编号一一对应）
        if ch["fns"]:
            fn_buf = []
            fn_len = 0
            for fid, ftxt in ch["fns"]:
                fl = f"[^{fid}]: {ftxt}"
                if fn_buf and fn_len + len(fl) > 2200:
                    jobs.append({
                        "id": len(jobs),
                        "ch_idx": ch_idx,
                        "ch_h1": ch["h1"],
                        "is_fn": True,
                        "prev_context": "",
                        "source": "\n\n".join(fn_buf),
                    })
                    fn_buf, fn_len = [], 0
                fn_buf.append(fl)
                fn_len += len(fl)
            if fn_buf:
                jobs.append({
                    "id": len(jobs),
                    "ch_idx": ch_idx,
                    "ch_h1": ch["h1"],
                    "is_fn": True,
                    "prev_context": "",
                    "source": "\n\n".join(fn_buf),
                })

    return jobs


def validate_translation(job: dict, out: str) -> tuple[bool, str]:
    if not out or len(out.strip()) < 15:
        return False, "empty output"
    # 检查中文占比（正文必须主要是中文；脚注/书目允许中英混排）
    cjk = len(re.findall(r'[\u4e00-\u9fff]', out))
    latin = len(re.findall(r'[A-Za-z]', out))
    if not job["is_fn"] and len(job["source"]) > 200:
        if cjk < len(job["source"]) * 0.14:
            return False, f"too short cjk={cjk} vs src={len(job['source'])}"
        if latin > cjk * 1.4 and "Bibliographical" not in job["source"]:
            return False, f"too much untranslated latin={latin} vs cjk={cjk}"
    # 校验所有 ### §N 节号必须 100% 保留
    src_secs = re.findall(r'(?m)^### §(\d+)$', job["source"])
    out_secs = re.findall(r'§\s*(\d+)', out)
    for s in src_secs:
        if s not in out_secs:
            return False, f"missing §{s}"
    # 校验脚注定义编号保留
    if job["is_fn"]:
        src_fids = re.findall(r'(?m)^\[\^(\d+)\]:', job["source"])
        for fid in src_fids:
            if f"[^{fid}]:" not in out:
                return False, f"missing [^{fid}]:"
    return True, "ok"


def translate_one_job(job: dict) -> tuple[int, bool, str]:
    cache_file = CACHE_DIR / f"chunk_{job['id']:04d}.txt"
    if cache_file.exists():
        cached = cache_file.read_text(encoding="utf-8").strip()
        ok, _ = validate_translation(job, cached)
        if ok:
            return job["id"], True, "cached"

    ctx_block = (
        f"【上文衔接语境（仅供理解上下文，切勿重复翻译）】：\n{job['prev_context']}\n\n"
        if job["prev_context"]
        else ""
    )

    if job["is_fn"]:
        prompt = (
            f"你是资深德国古典哲学汉译专家。请将以下剑桥版黑格尔《小逻辑》学术脚注精准译为流畅、严谨的中文：\n"
            f"{GLOSSARY_GUIDE}\n"
            "【硬性要求】\n"
            "1. 严格保留每条开头的 `[^数字]: ` 标记，逐条对应翻译，不可合并或遗漏任何一条。\n"
            "2. 人名、书名、拉丁/德文引文按哲学学术惯例译出中文并在必要处括注原词。\n"
            "3. 直接输出译文，不要加任何解释、前言或代码块围栏。\n\n"
            f"【待译脚注（所属章节：{job['ch_h1']}）】：\n{job['source']}"
        )
    else:
        prompt = (
            f"你是资深德国古典哲学汉译专家。请将以下剑桥大学出版社黑格尔《小逻辑》（Brinkmann & Dahlstrom 英译本，含原文德文括注）精准、忠实、流畅地译为典雅严谨的中文学术译文：\n"
            f"{GLOSSARY_GUIDE}\n"
            "【硬性要求】\n"
            "1. 100% 忠实逐句全译，严禁省略、改写、缩写或跳过任何句子与从句；语义须严格符合黑格尔辩证逻辑语境，行文自然通顺、学术规范。\n"
            "2. 严格原样保留所有 `### §数字` 节号标题、`#### [附释]` / `#### [附释1]` 小标题以及行内脚注标记 `[^数字]`（位置紧贴所注词句后）。\n"
            "3. 若原文出现 `### ` 英文子标题（如 `### a. Being`），请将其译为中文子标题并保留 `### ` 前缀（如 `### a. 存在（Sein）`）；若段首为 Remark 性质的阐述，自然衔接译出。\n"
            "4. 原文方括号内的德文关键术语（如 `[Wissen]`、`[des Seienden]`）请按中文学术惯例适度以中文括号保留核心德文原词，其余英文一律完整译为中文。\n"
            "5. 直接输出纯净中文 Markdown 译文，不要加任何说明、致谢或代码块标记。\n\n"
            f"{ctx_block}"
            f"【所属章节：{job['ch_h1']}】\n"
            f"【待译正文】：\n{job['source']}"
        )

    last_err = ""
    for attempt in range(1, 4):
        try:
            r = subprocess.run(
                ["node", DSH_BIN, "--profile", "headless", "--patch", PATCH, prompt],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=130,
            )
            out = (r.stdout or "").strip()
            out = re.sub(r"^```(?:markdown)?\s*\n?", "", out)
            out = re.sub(r"\n?```\s*$", "", out).strip()
            # 规范 ### § N -> ### §N
            out = re.sub(r"(?m)^#{2,4}\s*§\s*(\d+)\s*$", r"### §\1", out)
            ok, reason = validate_translation(job, out)
            if r.returncode == 0 and ok:
                cache_file.write_text(out, encoding="utf-8")
                return job["id"], True, f"ok(try={attempt}, {len(out)}ch)"
            last_err = f"try={attempt} rc={r.returncode} reason={reason}"
        except Exception as e:
            last_err = f"try={attempt} exc={e}"
        time.sleep(1.5 * attempt)

    return job["id"], False, last_err


def assemble_final_markdown(chapters: list[dict], jobs: list[dict]):
    by_ch = {i: {"body": [], "fn": []} for i in range(len(chapters))}
    missing = []
    for job in jobs:
        cf = CACHE_DIR / f"chunk_{job['id']:04d}.txt"
        if not cf.exists():
            missing.append(job["id"])
            continue
        txt = cf.read_text(encoding="utf-8").strip()
        if job["is_fn"]:
            by_ch[job["ch_idx"]]["fn"].append(txt)
        else:
            by_ch[job["ch_idx"]]["body"].append(txt)

    if missing:
        print(f"ERROR: {len(missing)} chunks still missing: {missing[:20]}")
        return False

    parts = []
    for ch_idx, ch in enumerate(chapters):
        parts.append(ch["h1"])
        parts.extend(by_ch[ch_idx]["body"])
        if by_ch[ch_idx]["fn"]:
            parts.extend(by_ch[ch_idx]["fn"])

    final_md = "\n\n".join(parts) + "\n"
    OUT_MD.write_text(final_md, encoding="utf-8")

    h1s = re.findall(r"(?m)^# [^\n]+$", final_md)
    secs = sorted(set(int(m) for m in re.findall(r"(?m)^### §(\d+)$", final_md)))
    miss_secs = [i for i in range(1, 245) if i not in secs]
    zusatz = len(re.findall(r"(?m)^#### \[附释", final_md))
    fn_defs = len(re.findall(r"(?m)^\[\^\d+\]:", final_md))
    print(f"\n=== ASSEMBLED AI-TRANSLATED 小逻辑: {OUT_MD} ===")
    print(f"Total chars: {len(final_md):,}")
    print(f"Canonical H1 chapters: {len(h1s)}")
    print(f"Sections §1..§244: {len(secs)}/244 (missing={miss_secs})")
    print(f"[附释] headings: {zusatz}, Footnotes defined: {fn_defs}")
    return len(miss_secs) == 0


def main():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    chapters = parse_cambridge_epub()
    jobs = build_translation_jobs(chapters)
    (CACHE_DIR / "manifest.json").write_text(
        json.dumps({"chapters": len(chapters), "jobs": len(jobs)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Parsed Cambridge 小逻辑 EPUB: {len(chapters)} chapters, {len(jobs)} translation chunks (~{sum(len(j['source']) for j in jobs):,} EN chars)")

    t0 = time.time()
    done = 0
    failed = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(translate_one_job, j) for j in jobs]
        for fut in concurrent.futures.as_completed(futs):
            jid, ok, msg = fut.result()
            done += 1
            if not ok:
                failed.append((jid, msg))
                print(f"  [FAIL] chunk {jid:04d}: {msg}", flush=True)
            elif done % 20 == 0 or done == len(jobs):
                elapsed = time.time() - t0
                rate = done / max(1.0, elapsed)
                eta = (len(jobs) - done) / max(0.01, rate)
                print(f"  [PROGRESS] {done}/{len(jobs)} ({done*100/len(jobs):.1f}%) | elapsed={elapsed:.0f}s | ETA={eta:.0f}s | failed={len(failed)}", flush=True)

    print(f"\nTranslation pass finished in {time.time()-t0:.1f}s: {len(jobs)-len(failed)}/{len(jobs)} succeeded, {len(failed)} failed")
    if failed:
        print("Retrying failed chunks with 4 workers...")
        still_failed = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            futs = [ex.submit(translate_one_job, jobs[jid]) for jid, _ in failed]
            for fut in concurrent.futures.as_completed(futs):
                jid, ok, msg = fut.result()
                if not ok:
                    still_failed.append((jid, msg))
                    print(f"  [STILL FAIL] chunk {jid:04d}: {msg}", flush=True)
        failed = still_failed

    if not failed:
        assemble_final_markdown(chapters, jobs)
    else:
        print(f"WARNING: {len(failed)} chunks still failed; rerun script to resume cleanly from cache.")


if __name__ == "__main__":
    main()
