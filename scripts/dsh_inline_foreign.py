#!/usr/bin/env python3
"""
dsh_inline_foreign.py — 扫遍全部 72 部书籍正文段落中内嵌的 >=10 词未译外语引文
（拉丁语、古希腊语、法语、德语、英语格言与原著引句），8 路并行调用 DSH (commandcode / deepseek-v4.1-flash)
生成精准学术中文译注，写入 scripts/inline_foreign_gloss_map.json 供 build_library.py 注入【译注】。
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
OUT_JSON = Path(r"D:\咕咕嘎嘎反重力\scripts\inline_foreign_gloss_map.json")
WORK = Path(r"D:\咕咕嘎嘎反重力\polish-work-foreign\inline")
WORK.mkdir(parents=True, exist_ok=True)

BIB_CH_RE = re.compile(r"(参考书目|参考文献|引用文献|书目|索引|进一步阅读|注释|bibliography|references|index)", re.I)
BIB_SEG_RE = re.compile(r"\b(Press|University|Verlag|ed\.|eds\.|trans\.|pp\.|vol\.|ISBN|Routledge|Cambridge|Oxford|Princeton|Chicago|Stuttgart|Frankfurt|Paris|Seuil|Suhrkamp|Norton|London|New York|Boston|Leipzig|Berlin|Continuum|Polity|Bloomsbury|http|www\.|1[789]\d{2}|20[012]\d|Jahrbuch|Wörterbuch|Faksimile)\b", re.I)
INLINE_FOREIGN_RE = re.compile(r"(?:[A-Za-zÀ-ÿα-ωΑ-Ωἀ-ῼ]{2,}[\s,;:\'\"\-–—’‘]+){9,}[A-Za-zÀ-ÿα-ωΑ-Ωἀ-ῼ]{2,}")


def main():
    existing = json.loads(OUT_JSON.read_text(encoding="utf-8")) if OUT_JSON.exists() else {}
    cat = json.loads((LIB_ROOT / "catalog.json").read_text(encoding="utf-8"))

    items = []
    seen = set()
    for b in cat["books"]:
        if b["category"] == "辞典与术语工具":
            continue
        bdir = LIB_ROOT / "books" / b["id"]
        for pf in sorted(bdir.glob("p_*.json")):
            d = json.loads(pf.read_text(encoding="utf-8"))
            for ch_idx, ch in d.items():
                ct = ch.get("t", "")
                if BIB_CH_RE.search(ct):
                    continue
                blks = ch.get("b", [])
                for bi, blk in enumerate(blks):
                    t = blk.get("t", "").strip()
                    if not t or blk.get("y") == "r":
                        continue
                    nxt = blks[bi + 1].get("t", "") if bi + 1 < len(blks) else ""
                    if "【译注】" in t or "【译注】" in nxt:
                        continue
                    cjk = len(re.findall(r"[\u4e00-\u9fff]", t))
                    if cjk < 15:
                        continue
                    segs = [m.group(0).strip() for m in INLINE_FOREIGN_RE.finditer(t) if not BIB_SEG_RE.search(m.group(0))]
                    if not segs:
                        continue
                    key = hashlib.sha1(t.encode("utf-8")).hexdigest()[:16]
                    if key in seen or key in existing:
                        continue
                    seen.add(key)
                    items.append({
                        "key": key,
                        "book": b["title"],
                        "chapter": ct[:32],
                        "foreign_segments": segs[:3],
                        "context": t[:450],
                    })

    print(f"[INLINE FOREIGN] Found {len(items)} body paragraphs with embedded >=10-word foreign quotes across all 72 books")
    if not items:
        return

    batches = [items[i:i + 10] for i in range(0, len(items), 10)]
    env = os.environ.copy()
    env["DSH_PERMISSION_MODE"] = "danger-full-access"

    def run_batch(bi, batch):
        sp = WORK / f"inline_{bi:02d}_src.json"
        op = WORK / f"inline_{bi:02d}_out.json"
        sp.write_text(json.dumps(batch, ensure_ascii=False, indent=2), encoding="utf-8")
        if op.exists():
            try:
                return json.loads(op.read_text(encoding="utf-8"))
            except Exception:
                pass
        prompt = (
            f"你是精通古希腊语、拉丁语、德语、法语、英语的资深哲学文献翻译家。\n"
            f"请读取 `{sp}`（每条包含 `key`、`book`、`foreign_segments` 及所在段落 `context`），"
            f"判断 `foreign_segments` 是否已在 `context` 的中文上下文中给出了完整直译。\n"
            f"将结果以纯 JSON 对象 `{{\"<key>\": \"...\"}}` 写入 `{op}`：\n"
            "1. 若该外语片段只是书名/文献引用，或**紧邻的中文上下文中已经给出了该外语句子的完整中译**，请将值设为空字符串 `\"\"`（避免画蛇添足）。\n"
            "2. 若该拉丁/希腊/法/德/英语引文、哲学格言或诗句在上下文中**没有中译**，请给出精准、典雅的简体中文译文（不含“【译注】”前缀；若有多句，用分号连贯译出）。\n"
            "仅输出合法 UTF-8 JSON 对象写入目标文件，完成后回复 DONE。"
        )
        t0 = time.time()
        try:
            subprocess.run(
                ["node", DSH_BIN, "--profile", "headless", "--patch", PATCH, prompt],
                check=True,
                env=env,
                timeout=240,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except subprocess.TimeoutExpired:
            pass
        if op.exists():
            raw = op.read_text(encoding="utf-8").strip()
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.S).strip()
            res = json.loads(raw)
            print(f"  [INLINE] Batch {bi:02d}/{len(batches)} OK ({sum(1 for v in res.values() if str(v).strip())} glosses, {time.time()-t0:.1f}s)")
            return res
        return {}

    with ThreadPoolExecutor(max_workers=min(8, len(batches))) as ex:
        futs = [ex.submit(run_batch, i + 1, b) for i, b in enumerate(batches)]
        for f in as_completed(futs):
            res = f.result()
            if isinstance(res, dict):
                for k, v in res.items():
                    if isinstance(v, str):
                        existing[k] = v.strip()

    OUT_JSON.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    non_empty = sum(1 for v in existing.values() if v.strip())
    print(f"[INLINE FOREIGN DONE] Saved {OUT_JSON.name}: {non_empty} non-empty glosses / {len(existing)} evaluated")


if __name__ == "__main__":
    main()
