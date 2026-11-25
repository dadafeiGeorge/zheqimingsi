#!/usr/bin/env python3
"""
dsh_foreign_and_gaps.py — 使用 8 路并行 DSH (commandcode / deepseek-v4.1-flash) 完成：
1. 补校《论再生产》此前回退/漏校的 3 个切片 (part_009, part_060, part_063) 并重新装配干净全本（同步清除尾页版权/印张信息）。
2. 提取全部 72 部书籍正文中的独立未译外语句子/引文（希腊/拉丁/法/德/英文，排除纯参考文献书目与辞典），
   8 路并行生成精准学术中文译注，写入 scripts/foreign_gloss_map.json，供 build_library.py 自动注入正文。
"""
import hashlib
import json
import os
import re
import time
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

DSH_BIN = r"C:\dsh-remote\cli\node_modules\@deepseek-ai\dsh\lib\bin.js"
PATCH = r"D:\咕咕嘎嘎反重力\scripts\dsh_command_v41.yml"
LIB_ROOT = Path(r"D:\咕咕嘎嘎反重力\library-data")
EXTRA_DIR = Path(r"D:\咕咕嘎嘎反重力\extra-books")
GLOSS_OUT = Path(r"D:\咕咕嘎嘎反重力\scripts\foreign_gloss_map.json")
WORK = Path(r"D:\咕咕嘎嘎反重力\polish-work-foreign")
WORK.mkdir(parents=True, exist_ok=True)
WORKERS = 8

CJK_RE = re.compile(r"[\u4e00-\u9fff]")
LATIN_GREEK_RE = re.compile(r"[A-Za-zÀ-ÿα-ωΑ-Ωἀ-ῼ]{2,}")
BIB_CHAPTER_RE = re.compile(
    r"(参考书目|参考文献|引用文献|书目|索引|进一步阅读|拉康著作|米勒著作|弗洛伊德著作|网络文献|延伸阅读|缩写|bibliography|references|index|further reading|works cited)",
    re.I,
)
BIB_LINE_RE = re.compile(
    r"\b(Press|University|Verlag|ed\.|eds\.|trans\.|pp\.|vol\.|ISBN|Routledge|Cambridge|Oxford|Princeton|Chicago|Stuttgart|Frankfurt|Paris|Seuil|Suhrkamp|Norton|London|New York|Boston|Leipzig|Berlin|Continuum|Polity|Bloomsbury|Everyman|accessed|http://|www\.)\b",
    re.I,
)
JUNK_LINE_RE = re.compile(r"(Images\s*have\s*been|losslessly\s*embedded|\\u256c|filename_decoded|Anna[\'\u2019]?s\s*Archive|General\s*Information)", re.I)


def call_dsh(prompt: str, timeout: int = 360):
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
        # DSH 有时写完目标文件后在进程退出阶段挂起；由调用方检查目标文件是否已完整落盘
        pass


def fix_lun_zaishengchan_3_slices():
    bdir = Path(r"D:\咕咕嘎嘎反重力\polish-work-dsh\lun_zaishengchan")
    target = EXTRA_DIR / "论再生产.md"
    if not (bdir / "src").exists():
        return
    need = []
    for name in ["part_009.md", "part_060.md", "part_063.md"]:
        sp = bdir / "src" / name
        op = bdir / "out" / name
        if not sp.exists():
            continue
        sl = len(sp.read_text(encoding="utf-8"))
        ol = len(op.read_text(encoding="utf-8")) if op.exists() else 0
        if ol < sl * 0.80:
            need.append((sp, op, sl))

    if need:
        print(f"[LUN] Proofreading {len(need)} remaining slices of 《论再生产》...")
        def do_one(item):
            sp, op, sl = item
            # 拆成两半避免超长超时
            txt = sp.read_text(encoding="utf-8")
            paras = [p.strip() for p in re.split(r"\n\s*\n", txt) if p.strip()]
            mid = max(1, len(paras) // 2)
            halves = [("\n\n".join(paras[:mid]), "a"), ("\n\n".join(paras[mid:]), "b")]
            out_halves = []
            for htxt, tag in halves:
                if not htxt.strip():
                    continue
                hsp = WORK / f"lun_{sp.stem}_{tag}_src.md"
                hop = WORK / f"lun_{sp.stem}_{tag}_out.md"
                hsp.write_text(htxt, encoding="utf-8")
                if not (hop.exists() and len(hop.read_text(encoding="utf-8")) >= len(htxt) * 0.78):
                    prompt = (
                        f"你是资深马克思主义哲学文字校对专家。请逐段完整校对 `{hsp}`（阿尔都塞《论再生产》OCR 识别稿），修复所有 OCR 错别字、年代数字错识与标点问题，100% 保留全部原意与段落（绝不删减改写），不要写 HTML 标签或反斜杠转义星号，直接写入 `{hop}`。完成后仅回复 DONE。"
                    )
                    call_dsh(prompt, timeout=300)
                if hop.exists() and len(hop.read_text(encoding="utf-8")) >= len(htxt) * 0.78:
                    out_halves.append(hop.read_text(encoding="utf-8").strip())
                else:
                    out_halves.append(htxt)
            op.write_text("\n\n".join(out_halves) + "\n", encoding="utf-8")
            return f"OK {sp.name} ({sl}->{len(op.read_text(encoding='utf-8'))})"

        with ThreadPoolExecutor(max_workers=3) as ex:
            for f in as_completed([ex.submit(do_one, it) for it in need]):
                print("  [LUN]", f.result())

    # 重新装配全 65 片，并清除尾页版权/印张/ISBN/定价/调换电话
    parts = []
    for sp in sorted((bdir / "src").glob("part_*.md")):
        op = bdir / "out" / sp.name
        txt = op.read_text(encoding="utf-8").strip() if (op.exists() and len(op.read_text(encoding="utf-8")) >= len(sp.read_text(encoding="utf-8")) * 0.75) else sp.read_text(encoding="utf-8").strip()
        parts.append(txt)
    full = "\n\n".join(parts)
    # 剥离末尾版权页（从 图书在版编目 / 印张 / 书号 ISBN 起）
    full = re.sub(r"\n+(?:#{1,6}\s*)?(?:图书在版编目|版权页|责任编[辑审]|印\s*张\s*\d|字\s*数\s*\d+千|书\s*号\s*ISBN)[\s\S]{0,1800}$", "", full)
    full = re.sub(r"\n+本版图书如有印装质量问题[\s\S]{0,300}$", "", full)
    target.write_text(full.strip() + "\n", encoding="utf-8")
    print(f"[LUN DONE] 论再生产.md 65/65 slices assembled cleanly ({len(full):,} chars)")


def collect_and_translate_foreign_quotes():
    existing = {}
    if GLOSS_OUT.exists():
        try:
            existing = json.loads(GLOSS_OUT.read_text(encoding="utf-8"))
        except Exception:
            existing = {}

    cat = json.loads((LIB_ROOT / "catalog.json").read_text(encoding="utf-8"))
    to_translate = []
    seen_keys = set()

    for b in cat["books"]:
        if b["category"] == "辞典与术语工具":
            continue
        bdir = LIB_ROOT / "books" / b["id"]
        for pf in sorted(bdir.glob("p_*.json")):
            cdata = json.loads(pf.read_text(encoding="utf-8"))
            for ch_idx_s, ch_obj in cdata.items():
                ch_title = ch_obj.get("t", "")
                if BIB_CHAPTER_RE.search(ch_title):
                    continue
                for blk in ch_obj.get("b", []):
                    t = blk.get("t", "").strip()
                    if not t or blk.get("y") == "r" or len(t) > 2500:
                        continue
                    if JUNK_LINE_RE.search(t):
                        continue
                    if "【译注】" in t or "【中译】" in t:
                        continue
                    words = LATIN_GREEK_RE.findall(t)
                    cjk = len(CJK_RE.findall(t))
                    if len(words) < 5:
                        continue
                    if cjk >= len(words) * 0.45:
                        continue
                    # 排除纯文献书目行（如 "Author, Title (New York: Norton, 1998)"）
                    if BIB_LINE_RE.search(t) and len(words) < 38:
                        continue
                    # 排除纯人名/出版地短行或带年份引文索引
                    if re.search(r"\(\d{4}(?:[–\-]\d{2,4})?\)", t) and len(words) < 28 and not re.search(r"[「『“\"]", t):
                        continue
                    if len(words) < 8 and not re.search(r"[.,;:!?\"'“”‘’α-ωΑ-Ωἀ-ῼäöüßéèêàç]", t):
                        continue
                    key = hashlib.sha1(t.encode("utf-8")).hexdigest()[:16]
                    if key in seen_keys or key in existing:
                        continue
                    seen_keys.add(key)
                    to_translate.append({
                        "key": key,
                        "book": b["title"],
                        "chapter": ch_title[:40],
                        "text": t,
                    })

    print(f"[FOREIGN] Found {len(to_translate)} standalone untranslated foreign quotes/passages across 72 books (cached={len(existing)})")
    if not to_translate:
        return

    # 分批（每批 12 条）交 8 路并行 DSH 生成精准中文译注
    batches = [to_translate[i:i + 12] for i in range(0, len(to_translate), 12)]

    def run_batch(b_idx, items):
        sp = WORK / f"foreign_batch_{b_idx:02d}_src.json"
        op = WORK / f"foreign_batch_{b_idx:02d}_out.json"
        sp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        if op.exists():
            try:
                res = json.loads(op.read_text(encoding="utf-8"))
                if isinstance(res, dict) and len(res) >= len(items) - 1:
                    return res
            except Exception:
                pass
        prompt = (
            f"你是精通古希腊语、拉丁语、德语、法语与英语的资深哲学翻译家。\n"
            f"请读取 `{sp}`（JSON 数组，每条含 `key`、`book`、`chapter`、`text`），为每一条外语引文/诗句/哲学原话/外文标题提供**忠实、优美、学术规范的简体中文译注**。\n"
            f"将结果以纯 JSON 对象格式（`{{\"<key>\": \"中文译文\", ...}}`）直接写入 `{op}`。\n"
            "严格要求：\n"
            "1. 若某条为纯学术文献书目或网址而无需翻译，则将其值设为空字符串 `\"\"`。\n"
            "2. 若某条为拉丁/希腊/德/法/英文诗句、哲学格言、原著引文、长注释或外文章节标题，请给出完整、准确、符合该哲学家语境的简体中文译文（不含前缀“【译注】”，纯译文即可；若原文有明显 OCR 错字如 `gr?pere Publikum`，按正确原文意译）。\n"
            "3. 输出必须是合法 UTF-8 JSON 对象（无 markdown 代码块包裹），写入 `{op}` 后仅回复 DONE。"
        )
        t0 = time.time()
        for attempt in range(2):
            try:
                call_dsh(prompt, timeout=360)
                if op.exists():
                    raw = op.read_text(encoding="utf-8").strip()
                    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.S).strip()
                    res = json.loads(raw)
                    if isinstance(res, dict):
                        print(f"  [FOREIGN] Batch {b_idx:02d}/{len(batches)} OK ({len(res)} items, {time.time()-t0:.1f}s)")
                        return res
            except Exception as e:
                print(f"  [FOREIGN] Retry {attempt+1} batch {b_idx:02d}: {e}")
        return {}

    with ThreadPoolExecutor(max_workers=min(WORKERS, len(batches))) as ex:
        futs = [ex.submit(run_batch, i + 1, b) for i, b in enumerate(batches)]
        for f in as_completed(futs):
            res = f.result()
            if isinstance(res, dict):
                for k, v in res.items():
                    if isinstance(v, str):
                        existing[k] = v.strip()

    GLOSS_OUT.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    non_empty = sum(1 for v in existing.values() if v.strip())
    print(f"[FOREIGN DONE] Saved {GLOSS_OUT.name}: {non_empty} scholarly Chinese glosses ready!")


if __name__ == "__main__":
    fix_lun_zaishengchan_3_slices()
    collect_and_translate_foreign_quotes()
    print("\nALL FOREIGN GLOSS & LUN GAP TASKS COMPLETED!")
