#!/usr/bin/env python3
"""
dsh_restore_ontology.py —
Run 8-way parallel DSH (`deepseek/deepseek-v4.1-flash`) on the 27 tiny English-anchored
Ontology bundles (`社会存在本体论·卷一：黑格尔` & `卷二：马克思`) and patch 100% of omissions.
"""
import json
import os
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

DSH_BIN = r"C:\dsh-remote\cli\node_modules\@deepseek-ai\dsh\lib\bin.js"
PATCH = r"D:\咕咕嘎嘎反重力\scripts\dsh_command_v41.yml"
WORK = Path(r"D:\咕咕嘎嘎反重力\audit-work\gap_repair\ontologie")


def call_dsh(prompt: str, timeout: int = 220):
    env = os.environ.copy()
    env["DSH_PERMISSION_MODE"] = "danger-full-access"
    subprocess.run(
        ["node", DSH_BIN, "--profile", "headless", "--patch", PATCH, prompt],
        check=True,
        env=env,
        timeout=timeout,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main():
    manifest = json.loads((WORK / "dispatch_manifest.json").read_text(encoding="utf-8"))

    def run_one(entry):
        sp = Path(entry["src"])
        op = Path(entry["out"])
        src_arr = json.loads(sp.read_text(encoding="utf-8"))
        if op.exists():
            try:
                arr = json.loads(op.read_text(encoding="utf-8"))
                if (
                    isinstance(arr, list)
                    and len(arr) == len(src_arr)
                    and all("new" in x and "脱漏" not in x["new"] and "残缺" not in x["new"] for x in arr)
                ):
                    return f"CACHED {entry['id']}"
            except Exception:
                pass
        prompt = (
            f"请读取 `{sp}`（包含卢卡奇《社会存在本体论》含 `〔原文脱漏〕` 的中文片段 `old`、`zh_context` 及对应英文版 `en_excerpt`）。\n"
            f"严禁编写或运行任何脚本、严禁访问其他文件。\n"
            f"请逐条对照 `en_excerpt` 与 `zh_context`，精准将每条 `old` 中的全部 `〔原文脱漏〕`（连同其前后紧邻的省略号）补译为连贯自然的学术简体中文。\n"
            f"硬性要求：\n"
            f"1. `" + '"old"' + "` 必须逐字原样复制输入文件中的值，一字不能改；\n"
            f"2. `" + '"new"' + "` 必须完整保留 `old` 两端锚点原文，仅补全中间缺漏，绝不能出现“脱漏”“残缺”“省略”字样；\n"
            f"3. 直接写入 JSON 数组 `[{{\"idx\": ..., \"old\": ..., \"new\": ...}}]` 到 `{op}`，写完只回复 DONE。"
        )
        t0 = time.time()
        try:
            call_dsh(prompt, timeout=220)
            return f"OK {entry['id']} ({time.time()-t0:.1f}s)"
        except Exception as e:
            return f"ERR {entry['id']}: {e}"

    print(f"Dispatching {len(manifest)} Ontology batches across 8 DSH workers...")
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(run_one, e) for e in manifest]
        for fut in as_completed(futs):
            print(" ", fut.result())

    # Group by file & apply
    by_file = {}
    for entry in manifest:
        op = Path(entry["out"])
        if not op.exists():
            continue
        try:
            arr = json.loads(op.read_text(encoding="utf-8"))
            by_file.setdefault(entry["file"], []).extend(arr)
        except Exception:
            pass

    for fp_str, items in by_file.items():
        fp = Path(fp_str)
        txt = fp.read_text(encoding="utf-8")
        applied = 0
        for item in items:
            old, new = item.get("old", ""), item.get("new", "")
            if old and new and old in txt and "脱漏" not in new and "残缺" not in new:
                txt = txt.replace(old, new, 1)
                applied += 1
        fp.write_text(txt, encoding="utf-8")
        rem = len(re.findall(r"〔[^〕\n]{0,20}(?:脱漏|残缺)[^〕\n]{0,20}〕", txt))
        print(f"[{fp.name}] Applied {applied}, remaining omission tags={rem}")


if __name__ == "__main__":
    main()
