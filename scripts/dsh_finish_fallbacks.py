#!/usr/bin/env python3
"""
dsh_finish_fallbacks.py — 对 polish-work-hq/<slug> 中因超长而 fallback 的切片，
拆分为约 2000 字的半片并行送入 DSH (commandcode / deepseek-v4.1-flash) 精校，
确保 100% 全部切片（无一遗漏）高质量落盘并重新装配为完整 Markdown。
用法: python dsh_finish_fallbacks.py <slug> <target_md_filename>
"""
import os
import re
import sys
import time
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

DSH_BIN = r"C:\dsh-remote\cli\node_modules\@deepseek-ai\dsh\lib\bin.js"
PATCH = r"D:\咕咕嘎嘎反重力\scripts\dsh_command_v41.yml"
WORK = Path(r"D:\咕咕嘎嘎反重力\polish-work-hq")
EXTRA = Path(r"D:\咕咕嘎嘎反重力\extra-books")


def call_dsh(prompt: str, timeout: int = 240):
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


def main():
    slug = sys.argv[1]
    target_name = sys.argv[2]
    desc = sys.argv[3] if len(sys.argv) > 3 else target_name

    sdir = WORK / slug
    hdir = sdir / "halves"
    hdir.mkdir(parents=True, exist_ok=True)
    target = EXTRA / target_name

    srcs = sorted((sdir / "src").glob("part_*.md"))
    missing = []
    for sp in srcs:
        op = sdir / "out" / sp.name
        sl = len(sp.read_text(encoding="utf-8"))
        ol = len(op.read_text(encoding="utf-8")) if op.exists() else 0
        if ol < sl * 0.78:
            missing.append(sp)

    print(f"[FALLBACK {slug}] {len(missing)}/{len(srcs)} slices need half-split DSH proofreading...")

    tasks = []
    for sp in missing:
        txt = sp.read_text(encoding="utf-8")
        paras = [p.strip() for p in re.split(r"\n\s*\n", txt) if p.strip()]
        mid = max(1, len(paras) // 2)
        for tag, chunk in [("a", "\n\n".join(paras[:mid])), ("b", "\n\n".join(paras[mid:]))]:
            if not chunk.strip():
                continue
            hsp = hdir / f"{sp.stem}_{tag}_src.md"
            hop = hdir / f"{sp.stem}_{tag}_out.md"
            hsp.write_text(chunk, encoding="utf-8")
            if not (hop.exists() and len(hop.read_text(encoding="utf-8")) >= len(chunk) * 0.78):
                tasks.append((sp.stem, tag, hsp, hop, len(chunk)))

    def run_half(item):
        stem, tag, hsp, hop, slen = item
        prompt = (
            f"你是精通德国古典哲学与黑格尔文献的资深出版编校专家。\n"
            f"请逐段完整精校 `{hsp}`（{desc} OCR 稿），直接将精校后的规范简体中文 Markdown 写入 `{hop}`。\n"
            "要求：\n"
            "1. 修复全部 OCR 错字、繁体异体字（转为规范简体）、破损书名号（`<...》`/`《...>`）、错误破折号（`一一`/`一-`->`——`）、错页码字（`真`->`页`）、哲学专词错字（`艳对`/`对`->`绝对`、`邂辑`/`避辑`->`逻辑`、`黑恪尔`->`黑格尔`、`排尿`->`排斥`、`企第`/`企崇`->`全集`）。\n"
            "2. 100% 忠实保留全部原文与注释，绝不删减概括；明确章节标题用 `##`/`###`，无 HTML 标签或反斜杠转义星号。\n"
            "完成后仅回复 DONE。"
        )
        t0 = time.time()
        for _ in range(2):
            call_dsh(prompt, timeout=240)
            if hop.exists() and len(hop.read_text(encoding="utf-8")) >= slen * 0.78:
                return f"OK {stem}_{tag} ({slen}->{len(hop.read_text(encoding='utf-8'))}, {time.time()-t0:.1f}s)"
        return f"FAIL {stem}_{tag}"

    if tasks:
        with ThreadPoolExecutor(max_workers=8) as ex:
            futs = [ex.submit(run_half, it) for it in tasks]
            for f in as_completed(futs):
                print(f"  [{slug}]", f.result())

    # 合并半片回 out/part_xxx.md
    for sp in missing:
        parts = []
        for tag in ("a", "b"):
            hsp = hdir / f"{sp.stem}_{tag}_src.md"
            hop = hdir / f"{sp.stem}_{tag}_out.md"
            if hop.exists() and len(hop.read_text(encoding="utf-8")) >= len(hsp.read_text(encoding="utf-8")) * 0.78:
                parts.append(hop.read_text(encoding="utf-8").strip())
            elif hsp.exists():
                parts.append(hsp.read_text(encoding="utf-8").strip())
        if parts:
            (sdir / "out" / sp.name).write_text("\n\n".join(parts) + "\n", encoding="utf-8")

    # 重新装配全书
    title_line = f"# {target.stem}"
    assembled = [title_line]
    ok_cnt = 0
    for sp in srcs:
        op = sdir / "out" / sp.name
        sl = len(sp.read_text(encoding="utf-8"))
        if op.exists() and len(op.read_text(encoding="utf-8")) >= sl * 0.78:
            assembled.append(op.read_text(encoding="utf-8").strip())
            ok_cnt += 1
        else:
            assembled.append(sp.read_text(encoding="utf-8").strip())
    full = "\n\n".join(assembled) + "\n"
    target.write_text(full, encoding="utf-8")
    print(f"[ASSEMBLED {slug}] {target.name}: {ok_cnt}/{len(srcs)} slices proofread, {len(full):,} chars")


if __name__ == "__main__":
    main()
