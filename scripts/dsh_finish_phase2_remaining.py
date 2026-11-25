#!/usr/bin/env python3
"""
dsh_finish_phase2_remaining.py — Cleanly finish Step 1:
1. Fix `美学与政治.md` truncated sentence (`智识……\n\n上的兴奋。` -> `智识上的兴奋。`).
2. Directly patch Lukacs notes 86-90 from verified EN PDF pp. 771-772, then run the remaining 8 omissions in `理性的毁灭.md` in 4 tiny 2-item batches (full-book exact keyword search + timeout=220).
3. Finish the remaining 30 omissions in `单子论：新译与导读.md` using `leibniz_47_bundles.json` matched to exact line numbers, 2 items/batch = 15 tiny batches (timeout=220).
4. Translate genuinely untranslated foreign blocks (`青年黑格尔 L6049` French appendix + `神话哲学` untranslated Latin/French/German note quotes) into scholarly Simplified Chinese appended cleanly below/after the original quote.
"""
import json
import os
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import pymupdf

DSH_BIN = r"C:\dsh-remote\cli\node_modules\@deepseek-ai\dsh\lib\bin.js"
PATCH = r"D:\咕咕嘎嘎反重力\scripts\dsh_command_v41.yml"
ROOT = Path(r"D:\咕咕嘎嘎反重力")
WORK = ROOT / "audit-work" / "gap_repair" / "p2_finish"
SRC_ZH = Path(r"D:\文献库\中文译本")
EXTRA = ROOT / "extra-books"
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


def fix_aesthetics_cut():
    ap = EXTRA / "美学与政治.md"
    txt = ap.read_text(encoding="utf-8")
    new_txt, n = re.subn(r"智识……\s+上的兴奋。", "智识上的兴奋。", txt)
    if n:
        ap.write_text(new_txt, encoding="utf-8")
        print(f"[美学与政治] Healed `智识…… 上的兴奋。` ({n} replacement).")
    else:
        print("[美学与政治] Pattern not found or already healed.")


def find_en_excerpt_smart(en_pages: list, est_page: int, zh_ctx: str, hints: list) -> str:
    n = len(en_pages)
    best_sc = -1e9
    best_pi = max(0, min(n - 1, est_page - 1))
    lat_toks = set(re.findall(r"[A-Za-zÀ-ÿ]{4,}", zh_ctx))
    for pi, pt in enumerate(en_pages):
        pt_l = pt.lower()
        sc = sum(4 for h in hints if h.lower() in pt_l) + sum(5 for t in lat_toks if t.lower() in pt_l)
        sc -= abs(pi - est_page) * 0.012
        if sc > best_sc:
            best_sc = sc
            best_pi = pi
    prev_t = en_pages[best_pi - 1][-800:] if best_pi > 0 else ""
    cur_t = en_pages[best_pi]
    next_t = en_pages[best_pi + 1][:800] if best_pi + 1 < n else ""
    return f"[p.{best_pi+1}]\n{prev_t}\n{cur_t}\n{next_t}"[:3200]


def finish_lukacs_remaining():
    md_path = SRC_ZH / "西马" / "理性的毁灭" / "理性的毁灭.md"
    txt = md_path.read_text(encoding="utf-8")

    # Direct verified patch for note 86-90 from EN p.771-772
    old_86 = "86 张伯伦《十九世纪的基础》，第 1 卷，……〔原文串行脱漏〕（英译本 1915 年以《一个叛徒的呓语》为题出版。）\n\n〔87–90 条原书缺失〕"
    new_86 = (
        "86 张伯伦《十九世纪的基础》，第 1 卷，第 230 页。\n\n"
        "87 张伯伦《康德》，第 303 页。\n\n"
        "88 张伯伦《十九世纪的基础》，第 2 卷，第 644 页。\n\n"
        "89 同上书，第 2 卷，第 592 页及以下。\n\n"
        "90 张伯伦《战时论文集》，慕尼黑，1915 年，第 76 页。（英译本 1915 年以《一个叛徒的呓语》为题出版。）"
    )
    if old_86 in txt:
        txt = txt.replace(old_86, new_86, 1)
        md_path.write_text(txt, encoding="utf-8")
        print("[Lukacs] Patched notes 86-90 directly from EN p.771-772.")

    matches = list(re.finditer(r"〔原文[^〕]{0,20}脱漏〕", txt))
    if not matches:
        print("[Lukacs] 0 omissions left!")
        return

    en_doc = pymupdf.open(r"D:\文献库\西马\卢卡奇\理性的毁灭（英文版）-卢卡奇.pdf")
    en_pages = [pg.get_text("text") for pg in en_doc]
    en_doc.close()

    proper_hints = {
        "间接辩护": "indirect apologetics", "宗教的无神论": "religious atheism", "叔本华": "Schopenhauer",
        "尼采": "Nietzsche", "齐美尔": "Simmel", "康德伦理学": "Kant's ethics",
        "平等理想": "equality", "和平共处": "peaceful coexistence", "帝国主义": "imperialist",
        "希特勒": "Hitler", "布尔根兰": "Burgenland", "赫利奥波利斯": "Heliopolis",
        "荣格尔": "Jünger", "Jünger": "Jünger", "柏林的大屠杀": "Berlin",
        "共产党宣言": "Communist Manifesto", "新的人民共和国": "People's Republics", "中国": "China",
        "主观真诚": "subjective", "激情": "passion", "李嘉图": "Ricardo",
        "极端形式": "extreme form", "法国": "France",
    }

    items = []
    for idx, m in enumerate(matches):
        ratio = m.start() / len(txt)
        est_p = max(1, min(len(en_pages), int(ratio * len(en_pages))))
        p_lo = max(0, txt.rfind("\n", 0, m.start()) + 1)
        p_hi = txt.find("\n", m.end())
        if p_hi < 0:
            p_hi = len(txt)
        snippet_old = txt[max(p_lo, m.start() - 50) : min(p_hi, m.end() + 50)]
        zh_ctx = txt[max(0, m.start() - 200) : min(len(txt), m.end() + 200)]
        hints = [v for k, v in proper_hints.items() if k in zh_ctx]
        en_win = find_en_excerpt_smart(en_pages, est_p, zh_ctx, hints)
        items.append({
            "idx": idx,
            "old": snippet_old,
            "zh_context": txt[max(p_lo, m.start() - 180) : min(p_hi, m.end() + 180)],
            "en_excerpt": en_win,
        })

    batches = [items[i : i + 2] for i in range(0, len(items), 2)]
    tasks = []
    for bi, b in enumerate(batches):
        sp = WORK / f"luk_rem_src_{bi:02d}.json"
        op = WORK / f"luk_rem_out_{bi:02d}.json"
        sp.write_text(json.dumps(b, ensure_ascii=False, indent=2), encoding="utf-8")
        tasks.append((bi, sp, op))

    def run_one(t):
        bi, sp, op = t
        if op.exists():
            try:
                arr = json.loads(op.read_text(encoding="utf-8"))
                if isinstance(arr, list) and len(arr) == len(json.loads(sp.read_text(encoding="utf-8"))) and all("new" in x and "脱漏" not in x["new"] for x in arr):
                    return f"CACHED luk_{bi:02d}"
            except Exception:
                pass
        prompt = (
            f"请读取 `{sp}`（包含 2 条《理性的毁灭》中文 `old` 缺漏片段与英文原文 `en_excerpt`）。\n"
            f"严禁编写或运行任何脚本、严禁访问其他文件。\n"
            f"请对照 `en_excerpt` 与 `zh_context`，忠实精准补译每条 `old` 中的 `〔原文脱漏〕`（及紧邻多余省略号）。\n"
            f"要求：`old` 原样复制不得修改；`new` 保留 `old` 前后锚点词句，中间补译成连贯准确的学术简体中文，绝不能包含“脱漏”二字。\n"
            f"直接把 JSON 数组 `[{{\"idx\": ..., \"old\": ..., \"new\": ...}}]` 写入 `{op}`，写完只回复 DONE。"
        )
        t0 = time.time()
        try:
            call_dsh(prompt, timeout=220)
            return f"OK luk_{bi:02d} ({time.time()-t0:.1f}s)"
        except Exception as e:
            return f"ERR luk_{bi:02d}: {e}"

    return md_path, tasks, run_one


def finish_leibniz_remaining():
    md_path = SRC_ZH / "德国古典哲学" / "莱布尼茨单子论：新译与导读" / "单子论：新译与导读.md"
    txt = md_path.read_text(encoding="utf-8")
    bundles = json.loads((ROOT / "audit-work" / "gap_repair" / "leibniz_47_bundles.json").read_text(encoding="utf-8"))
    by_line = {b["line"]: b for b in bundles}
    lines = txt.splitlines()
    rem_items = []
    for li, ln in enumerate(lines, 1):
        if "脱漏" in ln:
            b = by_line.get(ln)
            if not b:
                # Fallback match on stripped prefix
                for cand in bundles:
                    if cand["line"][:20] == ln[:20] and "脱漏" in cand["line"]:
                        b = cand
                        break
            en_str = "\n".join(c["text"][:1300] for c in (b["en_candidates"][:2] if b else []))
            if not en_str:
                prev_c = "\n".join(lines[max(0, li - 3) : li - 1])
                next_c = "\n".join(lines[li : min(len(lines), li + 2)])
                en_str = f"[Adjacent ZH context]\n{prev_c}\n{next_c}"
            rem_items.append({
                "line_no": li,
                "note_num": b["note_num"] if b else "",
                "old": ln,
                "prev": lines[max(0, li - 3) : li - 1],
                "next": lines[li : min(len(lines), li + 2)],
                "en_text": en_str,
            })

    batches = [rem_items[i : i + 2] for i in range(0, len(rem_items), 2)]
    tasks = []
    for bi, b in enumerate(batches):
        sp = WORK / f"lb_rem_src_{bi:02d}.json"
        op = WORK / f"lb_rem_out_{bi:02d}.json"
        sp.write_text(json.dumps(b, ensure_ascii=False, indent=2), encoding="utf-8")
        tasks.append((bi, sp, op))

    def run_one(t):
        bi, sp, op = t
        if op.exists():
            try:
                arr = json.loads(op.read_text(encoding="utf-8"))
                if isinstance(arr, list) and len(arr) == len(json.loads(sp.read_text(encoding="utf-8"))) and all("new" in x and "脱漏" not in x["new"] for x in arr):
                    return f"CACHED lb_{bi:02d}"
            except Exception:
                pass
        prompt = (
            f"请读取 `{sp}`（包含 1-2 条莱布尼茨《单子论》学术注释行 `old` 与英文原版 `en_text`）。\n"
            f"严禁编写或运行任何脚本、严禁访问其他文件。\n"
            f"请对照 `en_text` 中对应的 `note_num` 条目及相邻注释体例，将 `old` 中的 `〔原文脱漏〕` 精准补译为学术简体中文（若为 `Ibid.` / `同上` 类引文亦请按同书体例完整译出）。\n"
            f"要求：`old` 原样保留一字不变，`new` 绝不能含“脱漏”。直接写出 JSON 数组 `[{{\"line_no\": ..., \"old\": ..., \"new\": ...}}]` 到 `{op}`，写完只回复 DONE。"
        )
        t0 = time.time()
        try:
            call_dsh(prompt, timeout=220)
            return f"OK lb_{bi:02d} ({time.time()-t0:.1f}s)"
        except Exception as e:
            return f"ERR lb_{bi:02d}: {e}"

    return md_path, tasks, run_one


def prepare_foreign_translations():
    # Prepare 2 compact translation tasks for genuinely untranslated long foreign quotes
    yh_path = SRC_ZH / "西马" / "青年黑格尔：辩证法与经济学之关系研究" / "青年黑格尔：辩证法与经济学之关系研究.md"
    myth_path = SRC_ZH / "德国古典哲学" / "神话哲学历史批判导论" / "神话哲学历史批判导论.md"
    yh_lines = yh_path.read_text(encoding="utf-8").splitlines()
    myth_lines = myth_path.read_text(encoding="utf-8").splitlines()

    items_yh = []
    for li, ln in enumerate(yh_lines, 1):
        if "Dans la monarchie le peuple ne fut une puissance active" in ln:
            items_yh.append({"id": "yh_fr_app", "file": str(yh_path), "old": ln, "lang": "French"})

    myth_targets = [
        "Magnam molestiam suscepit et minime necessariam primus Zeno",
        "Alia quoque ex ratione, et quidem physica, magna fluxit multitudo Deorum",
        "Les ecclésiastiques y en ont ajouté une autre fausseté positive en disant",
        "Quand la tempête ou le vent renverse leurs huttes",
        "Ils parlent ordinairement beaucoup de la gorge et du nez",
        "Autant que nous pouvons suivre le fil de l'histoire",
        "ob die mythologischen Vorstellungen überhaupt gemeint",
    ]
    items_myth = []
    for ln in myth_lines:
        for pat in myth_targets:
            if pat in ln:
                items_myth.append({"id": f"myth_{len(items_myth)}", "file": str(myth_path), "old": ln, "lang": "Latin/French/German"})
                break

    all_batches = [items_yh] + [items_myth[i : i + 2] for i in range(0, len(items_myth), 2)]
    tasks = []
    for bi, b in enumerate(all_batches):
        if not b:
            continue
        sp = WORK / f"for_src_{bi:02d}.json"
        op = WORK / f"for_out_{bi:02d}.json"
        sp.write_text(json.dumps(b, ensure_ascii=False, indent=2), encoding="utf-8")
        tasks.append((bi, sp, op))

    def run_one(t):
        bi, sp, op = t
        if op.exists():
            try:
                arr = json.loads(op.read_text(encoding="utf-8"))
                if isinstance(arr, list) and arr and all("zh_trans" in x and x["zh_trans"].strip() for x in arr):
                    return f"CACHED for_{bi:02d}"
            except Exception:
                pass
        prompt = (
            f"请读取 `{sp}`。\n"
            f"严禁编写或运行任何脚本、严禁访问其他文件。\n"
            f"对每条文本中的拉丁文、法文或德文原句部分，请提供忠实典雅的学术简体中文译文 `zh_trans`（若原行只含外语引文则整段译出；若原行前面已有中文编号如 `16 ... 17 ...` 或说明，则仅译出外语引文句子并以 `〔译文：……〕` 形式返回，准备紧附于原引文之后，既保留权威原文又方便中文读者无障碍阅读）。\n"
            f"直接将 JSON 数组 `[{{\"id\": ..., \"file\": ..., \"old\": ..., \"zh_trans\": ...}}]` 写入 `{op}`，写完只回复 DONE。"
        )
        t0 = time.time()
        try:
            call_dsh(prompt, timeout=200)
            return f"OK for_{bi:02d} ({time.time()-t0:.1f}s)"
        except Exception as e:
            return f"ERR for_{bi:02d}: {e}"

    return tasks, run_one


if __name__ == "__main__":
    fix_aesthetics_cut()
    luk_res = finish_lukacs_remaining()
    lb_res = finish_leibniz_remaining()
    for_tasks, for_fn = prepare_foreign_translations()

    all_jobs = []
    if luk_res:
        luk_path, luk_tasks, luk_fn = luk_res
        for t in luk_tasks:
            all_jobs.append(("luk", luk_fn, t))
    if lb_res:
        lb_path, lb_tasks, lb_fn = lb_res
        for t in lb_tasks:
            all_jobs.append(("lb", lb_fn, t))
    for t in for_tasks:
        all_jobs.append(("for", for_fn, t))

    print(f"Dispatching {len(all_jobs)} compact DSH jobs across 8 workers...")
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(fn, t) for _, fn, t in all_jobs]
        for fut in as_completed(futs):
            print(" ", fut.result())

    # Apply Lukacs
    if luk_res:
        txt = luk_path.read_text(encoding="utf-8")
        applied = 0
        for _, _, op in luk_tasks:
            if op.exists():
                for item in json.loads(op.read_text(encoding="utf-8")):
                    old, new = item.get("old", ""), item.get("new", "")
                    if old and new and old in txt and "脱漏" not in new:
                        txt = txt.replace(old, new, 1)
                        applied += 1
        luk_path.write_text(txt, encoding="utf-8")
        print(f"[Lukacs final] Applied {applied}, remaining 脱漏={len(re.findall(r'脱漏', txt))}")

    # Apply Leibniz
    if lb_res:
        txt = lb_path.read_text(encoding="utf-8")
        applied = 0
        for _, _, op in lb_tasks:
            if op.exists():
                for item in json.loads(op.read_text(encoding="utf-8")):
                    old, new = item.get("old", ""), item.get("new", "")
                    if old and new and old in txt and "脱漏" not in new:
                        txt = txt.replace(old, new, 1)
                        applied += 1
        lb_path.write_text(txt, encoding="utf-8")
        print(f"[Leibniz final] Applied {applied}, remaining 脱漏={len(re.findall(r'脱漏', txt))}")

    # Apply Foreign translations (append right after original line/paragraph if not already appended)
    for _, _, op in for_tasks:
        if op.exists():
            for item in json.loads(op.read_text(encoding="utf-8")):
                fp = Path(item["file"])
                old = item["old"]
                zh_tr = item["zh_trans"].strip()
                txt = fp.read_text(encoding="utf-8")
                if old in txt and zh_tr and zh_tr not in txt:
                    if item["id"] == "yh_fr_app":
                        rep = old + "\n\n**〔附录参考译文〕**\n\n" + zh_tr
                    else:
                        rep = old + "\n\n" + (zh_tr if zh_tr.startswith("〔") else f"〔译文：{zh_tr}〕")
                    txt = txt.replace(old, rep, 1)
                    fp.write_text(txt, encoding="utf-8")
                    print(f"[Foreign] Appended translation for {item['id']} in {fp.name}")
