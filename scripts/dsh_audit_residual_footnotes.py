#!/usr/bin/env python3
"""
dsh_audit_residual_footnotes.py — Stage 2 全 72 部书籍残留注释段 8 路并行 DSH (commandcode / deepseek-v4.1-flash) 终审器。
扫描 build_library.py 构建后的全部 72 部书正文章节，抓取每一处仍疑似“正文里夹杂的注释/尾注/译注/文献注”的残余块
（连同其紧邻前 2 段正文作为语境），送 8 路并行 DSH 逐条甄别：
  - 若确认是应归入上文句末注脚的注释/引文/译注，写入 scripts/dsh_footnote_fold_map.json (`fold: true`)；
  - 若确认是正常正文段落（如德文原版边码 `[3] 先生们...`、黑格尔纲目 `②概念—逻辑学的对象`），标为 `fold: false` 绝不误删。
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
OUT_MAP = Path(r"D:\咕咕嘎嘎反重力\scripts\dsh_footnote_fold_map.json")
WORK = Path(r"D:\咕咕嘎嘎反重力\polish-work-footnotes")
WORK.mkdir(parents=True, exist_ok=True)
WORKERS = 8

NOTES_CH_RE = re.compile(
    r"^(?:注释|译者注|译注|尾注|脚注|注|编者注|导论注释|卡桑篇注释|巴迪欧篇注释|原注|编者注释|编辑说明|译者注)(?:（续\s*\d+）| · .*)?$"
)
SUS_RE = re.compile(
    r"^(?:"
    r"[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚]+"
    r"|[¹²³⁴⁵⁶⁷⁸⁹][⁰¹²³⁴⁵⁶⁷⁸⁹]*[\s\u3000]"
    r"|\[\^?(?:注|译注|原注)?\d{1,3}\][\s\u3000:：]"
    r"|〔\d{1,3}〕[\s\u3000:：]"
    r"|(?:注释|译者注|译注|校注|原注|编者注|脚注|按语|注)\s*\d*[：:.、\s]"
    r"|\d{1,3}[\s\u3000]+(?=《|见|参|同上|引|即|按|此|该|德|法|英|拉|译|原|编|「|“|黑格尔|康德|马克思|恩格斯|列宁|谢林|费希特|柏拉图|亚里士多德|笛卡尔|斯宾诺莎|莱布尼茨|卢卡奇|拉康|弗洛伊德|海德格尔|阿尔都塞|胡塞尔|尼采|歌德|本雅明|阿多诺|霍克海默|鲍德里亚|洛克|休谟|卢梭|伏尔泰|[A-Z]\.)"
    r"|\(\d{1,2}\)[\s\u3000]+(?=《|见|参|同上|引|详|译|原|编|[A-Z])"
    r")"
)
END_NOTE_RE = re.compile(r"——\s*(?:译者注?|编者注?|校者注?|原注|译注|拉松版|米希勒本|荷夫麦斯特本)\s*[。.]?$")


def block_key(text: str) -> str:
    return hashlib.sha1(text.strip().encode("utf-8")).hexdigest()[:16]


def main():
    existing = json.loads(OUT_MAP.read_text(encoding="utf-8")) if OUT_MAP.exists() else {}
    cat = json.loads((LIB_ROOT / "catalog.json").read_text(encoding="utf-8"))

    todo = []
    seen = set()

    for b in cat["books"]:
        if b["category"] == "辞典与术语工具":
            continue
        bdir = LIB_ROOT / "books" / b["id"]
        for pf in sorted(bdir.glob("p_*.json"), key=lambda x: int(x.stem.split("_")[1])):
            d = json.loads(pf.read_text(encoding="utf-8"))
            for ch_k, ch in d.items():
                ct = ch["t"].strip()
                if NOTES_CH_RE.match(ct):
                    continue
                blks = ch["b"]
                for bi, blk in enumerate(blks):
                    if blk["y"] in ("h", "r", "t"):
                        continue
                    s = blk["t"].strip()
                    if not s or len(s) > 1000:
                        continue
                    # 排除明显德文原版边码长正文（如《神话哲学》`[3] 先生们，你们期望...`）
                    if re.match(r"^\[\d{1,3}\]\s+[\u4e00-\u9fff]", s) and len(s) > 160 and not END_NOTE_RE.search(s) and not re.search(r"(同上|第\s*\d+\s*页|年版|译者|拉松|荷夫|米希勒|参见|参阅)", s):
                        continue
                    if not (SUS_RE.match(s) or (END_NOTE_RE.search(s) and len(s) < 350)):
                        continue
                    k = block_key(s)
                    if k in seen or k in existing:
                        continue
                    seen.add(k)
                    prev_ctx = blks[bi - 1]["t"].strip()[:160] if bi > 0 else ""
                    todo.append({
                        "key": k,
                        "book": b["title"],
                        "chapter": ct[:28],
                        "prev": prev_ctx,
                        "text": s,
                    })

    print(f"[DSH FOOTNOTE AUDIT] Found {len(todo)} residual suspicious note-like blocks across all 72 books (cached={len(existing)})")
    if not todo:
        return

    batches = [todo[i:i + 18] for i in range(0, len(todo), 18)]
    env = os.environ.copy()
    env["DSH_PERMISSION_MODE"] = "danger-full-access"

    def run_batch(bi, batch):
        sp = WORK / f"fn_batch_{bi:02d}_src.json"
        op = WORK / f"fn_batch_{bi:02d}_out.json"
        sp.write_text(json.dumps(batch, ensure_ascii=False, indent=2), encoding="utf-8")
        if op.exists():
            try:
                res = json.loads(op.read_text(encoding="utf-8"))
                if isinstance(res, dict) and len(res) >= len(batch) - 1:
                    return res
            except Exception:
                pass
        prompt = (
            f"你是资深哲学古籍出版编校专家。请读取 `{sp}`（JSON 数组，每条含 `key`、`book`、`chapter`、`prev` 前一段正文、`text` 当前待审段落）。\n"
            f"请逐条严格判断 `text` 是「**应当收纳进上文注脚的冗余注释/尾注/文献出处/译者注**」还是「**作者正常的正文论述/纲目/原版边码段落**」。\n"
            f"将结果以纯 JSON 对象写入 `{op}`，格式：\n"
            '`{"<key>": {"fold": true, "label": "1", "text": "去掉行首标号后的干净注释正文"}, "<key2>": {"fold": false}}`\n'
            "严格判定规则：\n"
            "1. `fold: true`（收纳为句末注脚并从正文流隐藏）：凡属于书目出处、页码引证、译者注/编者注/原注、词源解释、版本异文说明、人名小传注、或无标号的裸文献注，一律 `fold: true`！`label` 取原编号（如 `1`、`12`），无编号则填 `注` 或 `译注`；`text` 去掉行首重复的 `[1]`/`①`/`1 ` 等标号。\n"
            "2. `fold: false`（保留为正文，绝不误删）：凡属于作者的正常哲学论述段落、带原版边码的正文（如 `[3] 先生们，你们期望...`）、正文里的列点纲目（如 `②概念—逻辑学的对象`、`（1）早期的哲学史...`），一律 `fold: false`！\n"
            "仅输出合法 UTF-8 JSON 对象写入目标文件，完成后回复 DONE。"
        )
        t0 = time.time()
        for attempt in range(2):
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
                try:
                    raw = op.read_text(encoding="utf-8").strip()
                    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.S).strip()
                    res = json.loads(raw)
                    if isinstance(res, dict):
                        fcnt = sum(1 for v in res.values() if isinstance(v, dict) and v.get("fold"))
                        print(f"  [DSH FN] Batch {bi:02d}/{len(batches)} OK (fold={fcnt}/{len(res)}, {time.time()-t0:.1f}s)")
                        return res
                except Exception as e:
                    print(f"  [DSH FN] Retry {attempt+1} batch {bi:02d}: {e}")
        return {}

    with ThreadPoolExecutor(max_workers=min(WORKERS, len(batches))) as ex:
        futs = [ex.submit(run_batch, i + 1, b) for i, b in enumerate(batches)]
        for f in as_completed(futs):
            res = f.result()
            if isinstance(res, dict):
                for k, v in res.items():
                    if isinstance(v, dict):
                        existing[k] = v

    OUT_MAP.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    tot_fold = sum(1 for v in existing.values() if isinstance(v, dict) and v.get("fold"))
    print(f"[DSH FOOTNOTE AUDIT DONE] Saved {OUT_MAP.name}: {tot_fold} confirmed footnotes to fold / {len(existing)} audited!")


if __name__ == "__main__":
    main()
