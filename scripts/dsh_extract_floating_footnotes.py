#!/usr/bin/env python3
"""
dsh_extract_floating_footnotes.py —
Step 3:
1. Deterministic lossless pre-clean for spliced running pipe headers in `哲学导论.md`,
   orphan circled-number lines (`\n\n①\n\n`), `启蒙辩证法.md` mixed packed notes, and `大逻辑` `吸弓| 174`.
2. 8-way parallel DSH (`deepseek/deepseek-v4.1-flash`, <=5KB/batch, strict no-script prompt)
   to convert floating editorial/page footnotes in `列宁哲学笔记.md` (~114 star-note clusters)
   and mid-paragraph spliced footnotes in other books (`自然哲学体系的第一纲要`, `哲学导论`,
   `自我实现的历程`, `论黑格尔的逻辑学`, `黑格尔《小逻辑》译注`, `历史哲学`, `读《资本论》`, etc.)
   cleanly into standard `[^fn_...]` inline refs at sentence ends + `[^fn_...]: ...` definitions
   and stitch broken prose seamlessly.
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
ROOT = Path(r"D:\咕咕嘎嘎反重力")
EXTRA = ROOT / "extra-books"
SRC_ZH = Path(r"D:\文献库\中文译本")
WORK = ROOT / "audit-work" / "gap_repair" / "step3_floating"
WORK.mkdir(parents=True, exist_ok=True)


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


def deterministic_preclean():
    # 1. 哲学导论.md: remove exact mid-word/mid-line pipe running headers + join orphan circled lines
    jd_p = EXTRA / "哲学导论.md"
    txt = jd_p.read_text(encoding="utf-8")
    # 76 mid-line even-page running headers `哲学导论（第三版）| 4` etc.
    txt, c1 = re.subn(r"哲学导论[（(]\s*第三版[^|\n]{0,12}[|｜]\s*\d{1,3}", "", txt)
    # Odd-page running headers discovered verbatim in audit
    odd_hdrs = [
        r"\n*##\s+第三十章中国哲学发展的历程\s+\d{3}\s*[|｜]\s*\n*",
        r"7\s*[|｜]\s*导言什么是哲学",
        r"7\s*[|｜]\s*第一章",
        r"47\s*[|｜]\s*第四章两种超越的途径:\s*思维与想象",
        r"117\s*[|｜]\s*第十一章审美意识的在世结构人与世界的融合",
        r"147\s*[|｜]\s*第十三章典型说与显隐说",
        r"153\s*[|｜]\s*第[+十]四章审美意识:\s*超越有限",
        r"159\s*[|｜]\s*第十四章审美意识:\s*超越有限",
        r"185\s*[|｜]\s*第十六章两种哲学[，,]\s*两种语言观",
        r"247\s*[|｜]\s*第二十一章人类中心主义和民胞物与说",
        r"(?:319|321|327|333|335)\s*[|｜]\s*第二十九章西方哲学发展的历程",
        r"341\s*[|｜]\s*第三十章中国哲学发展的历程",
    ]
    c2 = 0
    for idx_pat, pat in enumerate(odd_hdrs):
        rep = "\n\n" if idx_pat == 0 else ""
        txt, k = re.subn(pat, rep, txt)
        c2 += k
    # Orphan circled lines `\n\n①\n\n同上书...` -> `\n\n① 同上书...`
    txt, c3 = re.subn(r"\n{2,}([①②③④⑤⑥⑦⑧⑨⑩])\n{2,}(?=[^\n#])", r"\n\n\1 ", txt)
    # Clean residual `[■•]` OCR noise inside JD like `■• 人生在世"` or `o PBggeler)`
    txt = txt.replace("o PBggeler)", "奥托·佩格勒（Otto Pöggeler）")
    txt = txt.replace('■• 人生在世"', '《“人生在世”')
    jd_p.write_text(txt, encoding="utf-8")
    print(f"[Preclean 哲学导论] even_hdr={c1}, odd_hdr={c2}, orphan_circles={c3}")

    # 2. 大逻辑 `吸弓| 174` -> `吸引`
    dl_p = SRC_ZH / "德国古典哲学" / "黑格尔" / "【完整全本】黑格尔《大逻辑》汉译精注本.md"
    if dl_p.exists():
        dt = dl_p.read_text(encoding="utf-8")
        if "吸弓| 174" in dt:
            dt = dt.replace("吸弓| 174", "吸引")
            dl_p.write_text(dt, encoding="utf-8")
            print("[Preclean 大逻辑] Fixed `吸弓| 174` -> `吸引`.")

    # 3. 启蒙辩证法 mixed `[N]` & `N.` packed notes in Notes sections (lines with >=2 note defs packed)
    qm_p = EXTRA / "启蒙辩证法.md"
    if qm_p.exists():
        lines = qm_p.read_text(encoding="utf-8").splitlines()
        out_lines = []
        split_cnt = 0
        for ln in lines:
            s = ln.strip()
            if (re.match(r"^(?:\[\d{1,3}\]|\d{1,3}\.)\s+\S", s)
                    and len(re.findall(r"(?:^|\s)(?:\[\d{1,3}\]|\d{1,3}\.)\s+", s)) >= 2):
                # Split packed [N] or N. endnotes into standalone blank-separated items
                parts = re.split(r"(?<=[。.”’）).!?])\s+(?=(?:\[\d{1,3}\]|\d{1,3}\.)\s+\S)", s)
                if len(parts) >= 2:
                    for p in parts:
                        out_lines.append(p.strip())
                        out_lines.append("")
                    split_cnt += 1
                    continue
            out_lines.append(ln)
        if split_cnt:
            qm_p.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
            print(f"[Preclean 启蒙辩证法] Unpacked {split_cnt} mixed endnote lines.")


def collect_lenin_star_windows():
    fp = EXTRA / "列宁哲学笔记.md"
    lines = fp.read_text(encoding="utf-8").splitlines()
    n = len(lines)

    def is_star_note(s: str) -> bool:
        return bool(re.match(r"^(?:[*＊]{1,6}|#)\s*.*——\s*(?:编者注|译者注|原注|俄译本|英译者注)[。.]?\s*$", s))

    def is_artifact(s: str) -> bool:
        return s in ("*缩小*",) or bool(re.match(r"^\*\d+\s+.+\*$", s))

    # Find indices of lines that are floating notes or scan artifacts interrupting prose
    mark = [False] * n
    in_notes = False
    for i, ln in enumerate(lines):
        s = ln.strip()
        if s.startswith("#"):
            in_notes = bool(re.search(r"索引|注释", s))
            continue
        if in_notes:
            continue
        if is_star_note(s) or is_artifact(s):
            mark[i] = True

    # Group contiguous/nearby marked lines (within 4 lines of each other) into edit windows
    windows = []
    i = 0
    while i < n:
        if not mark[i]:
            i += 1
            continue
        w_start = i
        j = i
        while j < n:
            # Extend if another marked line sits within 3 non-empty blocks
            nxt = -1
            for k in range(j + 1, min(n, j + 8)):
                if mark[k]:
                    nxt = k
                    break
                if lines[k].strip().startswith("#"):
                    break
            if nxt >= 0:
                j = nxt
            else:
                break
        # Expand up to 2 non-empty context lines before and 2 non-empty context lines after (without crossing `#`)
        lo = w_start
        seen_pre = 0
        while lo > 0:
            lo -= 1
            st = lines[lo].strip()
            if st.startswith("#"):
                lo += 1
                break
            if st:
                seen_pre += 1
                if seen_pre >= 2 and st[-1] in "。！？!?…”』」":
                    break
        hi = j
        seen_post = 0
        while hi + 1 < n:
            st_n = lines[hi + 1].strip()
            if st_n.startswith("#"):
                break
            hi += 1
            if st_n:
                seen_post += 1
                if seen_post >= 2 and st_n[-1] in "。！？!?…”』」":
                    break
        chunk = "\n".join(lines[lo : hi + 1]).strip()
        if len(chunk) <= 2200:
            windows.append({
                "id": f"lenin_{len(windows):03d}",
                "file": str(fp),
                "mode": "lenin_star",
                "old": chunk,
            })
        i = max(j + 1, hi + 1)
    return windows


def collect_general_floating_windows():
    """Find paragraphs in non-Lenin books where a page footnote is genuinely spliced into body flow."""
    targets = [
        EXTRA / "哲学导论.md",
        SRC_ZH / "德国古典哲学" / "自然哲学体系的第一纲要" / "自然哲学体系的第一纲要.md",
        SRC_ZH / "现代西方哲学" / "自我实现的历程：解读黑格尔《精神现象学》" / "自我实现的历程：解读黑格尔《精神现象学》.md",
        SRC_ZH / "现代西方哲学" / "论黑格尔的逻辑学" / "论黑格尔的逻辑学.md",
        SRC_ZH / "现代西方哲学" / "黑格尔《精神现象学》述评" / "黑格尔《精神现象学》述评.md",
        EXTRA / "黑格尔《小逻辑》译注.md",
        EXTRA / "历史哲学（全本）.md",
        SRC_ZH / "西马" / "读《资本论》" / "读《资本论》.md",
        SRC_ZH / "西马" / "青年黑格尔：辩证法与经济学之关系研究" / "青年黑格尔：辩证法与经济学之关系研究.md",
        SRC_ZH / "西马" / "策略与伦理：政治文集 1919—1929" / "策略与伦理：政治文集 1919—1929.md",
    ]
    # Add any matching file paths by glob if subfolder differs
    resolved = []
    for p in targets:
        if p.exists():
            resolved.append(p)
        else:
            for cand in list(EXTRA.glob(p.name)) + list(SRC_ZH.rglob(p.name)):
                if "_backups" not in str(cand):
                    resolved.append(cand)
                    break

    windows = []
    for fp in resolved:
        lines = fp.read_text(encoding="utf-8").splitlines()
        n = len(lines)
        in_notes = False
        used_until = -1
        for i, ln in enumerate(lines):
            if i <= used_until:
                continue
            s = ln.strip()
            if not s:
                continue
            if s.startswith("#"):
                in_notes = bool(re.search(r"注释|译者注|译注|索引", s))
                continue
            if in_notes:
                continue
            if re.match(r"^(?:\[\^?\d+\]|〔\d+〕|[①-⑳]|\d{1,3}[\s\u3000.])", s):
                continue

            hit = False
            # Spliced circled note citation followed by continuation on next lines (`不在① Kant...` + `场即显现...`)
            if re.search(r"[①②③④⑤⑥⑦⑧⑨⑩]\s*(?:《[^》]{2,30}》|Immanuel|Hegel|Kant|同上|参见|转引自|第\s*\d+|格洛克纳|黑格尔全集).{8,}", s) and len(s) >= 40:
                # Ignore normal body quote merely mentioning a title if not preceded by mid-word cut or note pattern
                if re.search(r"[^\n。！？；：”’）」][①-⑩]\s*", s) or re.search(r"[①-⑩]\s*(?:Immanuel|Hegel|同上书|转引自|格洛克纳|.*——(?:编者|译者|引者))", s):
                    hit = True
            elif re.search(r"(?:\(至此为原有的注|（至此为原有的注|［至?此为原有的注|＊（据《全集》本.*——译者）|‡（手稿在此处.*——译者）|（原注。.*——译者）)", s):
                hit = True
            elif "——卢卡奇注" in s or "1986年秋本书作者摄于瑞士伯尔尼黑" in s:
                hit = True
            elif "哲学导论" in fp.name and "参见黑格尔" in s and len(s) >= 200:
                hit = True
            elif "历史哲学" in fp.name and s.startswith("参见黑格尔《宗教哲学讲演录》"):
                hit = True

            if hit:
                # Expand +/-1 non-empty line for sentence healing if broken
                lo = i
                if i > 1 and not lines[i - 2].strip().startswith("#") and lines[i - 2].strip() and lines[i - 2].strip()[-1] not in "。！？!?…”』」":
                    lo = i - 2
                hi = i
                for k in range(i + 1, min(n, i + 4)):
                    if lines[k].strip():
                        hi = k
                        break
                chunk = "\n".join(lines[lo : hi + 1]).strip()
                # Verify unique in file
                full_t = "\n".join(lines)
                if full_t.count(chunk) == 1 and len(chunk) <= 2600:
                    windows.append({
                        "id": f"gen_{len(windows):03d}",
                        "file": str(fp),
                        "mode": "general_splice",
                        "old": chunk,
                    })
                    used_until = hi
    return windows


def run_dsh_windows(windows: list):
    if not windows:
        print("No floating windows found for DSH.")
        return

    batches = [windows[i : i + 2] for i in range(0, len(windows), 2)]
    tasks = []
    for bi, b in enumerate(batches):
        sp = WORK / f"f_src_{bi:03d}.json"
        op = WORK / f"f_out_{bi:03d}.json"
        sp.write_text(json.dumps(b, ensure_ascii=False, indent=2), encoding="utf-8")
        tasks.append((bi, sp, op))

    def run_one(t):
        bi, sp, op = t
        src_arr = json.loads(sp.read_text(encoding="utf-8"))
        if op.exists():
            try:
                arr = json.loads(op.read_text(encoding="utf-8"))
                if isinstance(arr, list) and len(arr) == len(src_arr) and all(x.get("new") and x.get("old") == src_arr[k]["old"] for k, x in enumerate(arr)):
                    return f"CACHED f_{bi:03d}"
            except Exception:
                pass
        prompt = (
            f"请读取 `{sp}`（包含 1-2 段哲学文本 `old`，其中正文中夹杂着原书页底脚注、星号编者注/译者注、或被跨页脚注/图片说明切断的半句话）。\n"
            f"严禁编写或运行任何脚本、严禁访问其他文件。\n"
            f"请对每条 `old` 按如下规范修复并输出 `new`：\n"
            f"1. **零删改正文内容**：忠实保留全部正文词句与注释内容（仅可删除 `*缩小*` / `1986年秋...摄于...` 这类纯粹印刷扫描杂屑）。\n"
            f"2. **抽离飘在正文里的脚注**：将正文中出现的页脚/星号注（如 `* ... ——编者注`、`① Immanuel Kant...`、`（原注。——译者）`、`‡（手稿...）`、`（至此为原有的注...）` 等），从正文中抽离为标准 Markdown 脚注：\n"
            f"   - 在正文对应的词尾/句末标点后紧接放置唯一脚注编号（用连字符格式 `[^e{bi:03d}-1]`、`[^e{bi:03d}-2]` 顺序递增，切勿使用下划线！并删去原来充当注标的孤立 `*` / `**` / `①`）；\n"
            f"   - 在该段正文后的独立空行下，用 `[^e{bi:03d}-1]: 完整注释正文` 列出对应注释。\n"
            f"3. **愈合被脚注切断的句子**：如果正文句子因为这些页底脚注或 `*25 ...*` 跨页而被切成了上下两截（如 `不在` 与 `场即……`、`Allgemeine Literatur-Zeitung` 与 `——马克思……`），务必重新拼合为一个连贯完整的自然段。\n"
            f"4. **逐字复制 `old`**：`\"old\"` 字段必须与输入文件一字不差，直接写入 JSON 数组 `[{{\"id\": ..., \"file\": ..., \"old\": ..., \"new\": ...}}]` 到 `{op}`，写完只回复 DONE。"
        )
        t0 = time.time()
        try:
            call_dsh(prompt, timeout=220)
            return f"OK f_{bi:03d} ({time.time()-t0:.1f}s)"
        except Exception as e:
            return f"ERR f_{bi:03d}: {e}"

    print(f"Dispatching {len(windows)} floating-note windows in {len(tasks)} batches across 8 DSH workers...")
    with ThreadPoolExecutor(max_workers=8) as ex:
        for fut in as_completed([ex.submit(run_one, t) for t in tasks]):
            print(" ", fut.result())

    # Apply edits safely per file (reverse-apply / unique replacement + sanity conservation check)
    by_file = {}
    for _, _, op in tasks:
        if not op.exists():
            continue
        try:
            arr = json.loads(op.read_text(encoding="utf-8"))
            for item in arr:
                by_file.setdefault(item["file"], []).append(item)
        except Exception:
            pass

    for fp_s, items in by_file.items():
        fp = Path(fp_s)
        txt = fp.read_text(encoding="utf-8")
        applied = 0
        for item in items:
            old, new = item.get("old", ""), item.get("new", "")
            if not old or not new or old == new or old not in txt:
                continue
            # Safety guard: preserve >= 82% of characters (since moving notes keeps almost 100% chars)
            if len(new) < len(old) * 0.78:
                print(f"  [SKIP shrunk] {item.get('id')}: old={len(old)}, new={len(new)}")
                continue
            txt = txt.replace(old, new, 1)
            applied += 1
        fp.write_text(txt, encoding="utf-8")
        print(f"[{fp.name}] Applied {applied}/{len(items)} floating-note fixes.")


if __name__ == "__main__":
    deterministic_preclean()
    w1 = collect_lenin_star_windows()
    w2 = collect_general_floating_windows()
    print(f"Collected {len(w1)} Lenin windows + {len(w2)} general windows.")
    run_dsh_windows(w1 + w2)
