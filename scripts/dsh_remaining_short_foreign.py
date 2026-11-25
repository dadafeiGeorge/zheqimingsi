#!/usr/bin/env python3
"""
dsh_remaining_short_foreign.py — 扫遍全部 72 部书籍（含 56 部中文译本 + 16 部 extra-books），
捕获所有剩余的 3-7 词及以上独立未译外语引文/诗句/拉丁格言/德法小节副题（排除纯书目与辞典），
调用 DSH (commandcode / deepseek-v4.1-flash) 生成学术中文译注并合并写入 scripts/foreign_gloss_map.json。
"""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

DSH_BIN = r"C:\dsh-remote\cli\node_modules\@deepseek-ai\dsh\lib\bin.js"
PATCH = r"D:\咕咕嘎嘎反重力\scripts\dsh_command_v41.yml"
LIB_ROOT = Path(r"D:\咕咕嘎嘎反重力\library-data")
GLOSS_OUT = Path(r"D:\咕咕嘎嘎反重力\scripts\foreign_gloss_map.json")
WORK = Path(r"D:\咕咕嘎嘎反重力\polish-work-foreign")
WORK.mkdir(parents=True, exist_ok=True)

CJK_RE = re.compile(r"[\u4e00-\u9fff]")
WORD_RE = re.compile(r"[A-Za-zÀ-ÿα-ωΑ-Ωἀ-ῼ]{2,}")
BIB_CH_RE = re.compile(r"(参考书目|参考文献|引用文献|书目|索引|进一步阅读|拉康著作|米勒著作|弗洛伊德著作|网络文献|延伸阅读|其他文献|苏黎世州立图书馆|bibliography|references|index)", re.I)
BIB_LINE_RE = re.compile(r"\b(Press|University|Verlag|ed\.|eds\.|trans\.|pp\.|vol\.|ISBN|Routledge|Cambridge|Oxford|Princeton|Chicago|Stuttgart|Frankfurt|Paris|Seuil|Suhrkamp|Norton|London|New York|Boston|Leipzig|Berlin|Continuum|Polity|Bloomsbury|Harmondsworth|Penguin|Mouton|Aubier|Hamburg|Meiner|Heidelberg|Dublin|Geneva|http://|https://|www\.|Session of|Edited by)\b", re.I)
FORMULA_RE = re.compile(r"^(?:\d+\s+)?(?:UV|EcEV|SgEV|SbE|MHA|AA|CPR|R\s*\d+)\b")


def main():
    existing = json.loads(GLOSS_OUT.read_text(encoding="utf-8")) if GLOSS_OUT.exists() else {}
    cat = json.loads((LIB_ROOT / "catalog.json").read_text(encoding="utf-8"))

    todo = []
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
                    if blk.get("y") == "r":
                        continue
                    t = blk.get("t", "").strip()
                    if not t or len(t) > 1500:
                        continue
                    nxt_t = blks[bi + 1].get("t", "") if bi + 1 < len(blks) else ""
                    if "【译注】" in t or "【译注】" in nxt_t:
                        continue
                    words = WORD_RE.findall(t)
                    cjk = len(CJK_RE.findall(t))
                    if len(words) < 3 or cjk >= len(words) * 0.35:
                        continue
                    if BIB_LINE_RE.search(t) and len(words) < 35:
                        continue
                    if FORMULA_RE.match(t):
                        continue
                    if re.search(r"\(\d{4}(?:[–\-]\d{2,4})?\)", t) and len(words) < 25:
                        continue
                    if re.search(r",\s*(?:p\.|pp\.|S\.|SS\.|vol\.|pl?\d+)", t):
                        continue
                    key = hashlib.sha1(t.encode("utf-8")).hexdigest()[:16]
                    if key in seen or key in existing:
                        continue
                    seen.add(key)
                    todo.append({"key": key, "book": b["title"], "chapter": ct[:36], "text": t})

    print(f"[SHORT FOREIGN] Found {len(todo)} remaining short standalone foreign quotes across all 72 books")
    if not todo:
        return

    # 拆成每批 25 条，交给 DSH
    batches = [todo[i:i + 25] for i in range(0, len(todo), 25)]
    env = os.environ.copy()
    env["DSH_PERMISSION_MODE"] = "danger-full-access"

    for bi, batch in enumerate(batches, 1):
        sp = WORK / f"short_foreign_{bi:02d}_src.json"
        op = WORK / f"short_foreign_{bi:02d}_out.json"
        sp.write_text(json.dumps(batch, ensure_ascii=False, indent=2), encoding="utf-8")
        prompt = (
            f"你是精通古希腊语、拉丁语、德语、法语、意大利语与英语的资深哲学翻译家。\n"
            f"请读取 `{sp}`，为每条外语引文/格言/诗句/外文小节副题提供精准优雅的简体中文译注，以纯 JSON 对象 `{{\"<key>\": \"中文译文\"}}` 写入 `{op}`。\n"
            "要求：\n"
            "1. 若某条只是纯书目引用、页码索引、人名/出版地或无实质语义的编号碎片，设为空字符串 `\"\"`。\n"
            "2. 若为拉丁/希腊/德/法/意/英文哲学原话、诗句、题词或章节外文副标题（如 `*Hic* Rhodus,*hic* saltus.`、`Che′l Volgare ignorante ogn′ un riprenda`、`Je suis ce malheureux comparable aux miroirs`、`principum amicitias et arma`、`Zum Behuf seiner Vorlesungen`、`(Die Lehre Vom Sein)`、`La reproduction des rapports de production` 等），请给出准确典雅的中文译文（不含“【译注】”前缀；若为德/法文拼写略有 OCR 误差如 `Exislenz`，按正确词 `Existenz` 译出）。\n"
            "3. 仅输出合法 UTF-8 JSON 对象写入目标文件，完成后回复 DONE。"
        )
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
            added = 0
            for k, v in res.items():
                if isinstance(v, str):
                    existing[k] = v.strip()
                    if v.strip():
                        added += 1
            print(f"  [SHORT FOREIGN] Batch {bi}/{len(batches)} OK (+{added} new glosses)")

    GLOSS_OUT.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    non_empty = sum(1 for v in existing.values() if v.strip())
    print(f"[SHORT FOREIGN DONE] Total glosses in {GLOSS_OUT.name}: {non_empty} non-empty / {len(existing)} keys")


if __name__ == "__main__":
    main()
