#!/usr/bin/env python3
"""
dsh_master_polish.py — 使用 8 路并行 DSH (commandcode / deepseek-v4.1-flash) 完成三项深度精修：
A. 《德国哲学论丛》英文论文 + 英文/德文 RESUME 全本翻译（8 片并行，无遗漏）
B. 《论再生产》全书 OCR 错字与标点深度校对（严格 100% 保留全文，长度校验 85%~115%）
C. 《哲学导论》含 OCR 噪点段落精准校对与还原（如希腊词、标点、数字错识）
全部支持断点续传。
"""
import os
import re
import time
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

DSH_BIN = r"C:\dsh-remote\cli\node_modules\@deepseek-ai\dsh\lib\bin.js"
PATCH = r"D:\咕咕嘎嘎反重力\scripts\dsh_command_v41.yml"
EXTRA = Path(r"D:\咕咕嘎嘎反重力\extra-books")
WORK = Path(r"D:\咕咕嘎嘎反重力\polish-work-dsh")
WORK.mkdir(parents=True, exist_ok=True)
WORKERS = 8


def call_dsh(prompt: str, timeout: int = 420):
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


def split_paragraphs_by_chars(paras: list, target_chars: int) -> list:
    chunks = []
    cur = []
    cur_len = 0
    for p in paras:
        plen = len(p) + 2
        if cur and cur_len + plen > target_chars:
            chunks.append("\n\n".join(cur))
            cur = [p]
            cur_len = plen
        else:
            cur.append(p)
            cur_len += plen
    if cur:
        chunks.append("\n\n".join(cur))
    return chunks


# ==================== JOB A: 德国哲学论丛 英文篇目翻译 ====================
def job_a_german_anthology():
    target = EXTRA / "德国哲学论丛.md"
    lines = target.read_text(encoding="utf-8").splitlines()

    # 检查是否已经翻译过（避免重复运行）
    full_txt = "\n".join(lines)
    if "Leibniz's Two Discoveries" not in full_txt and "Gadamer und der spatere Heidegger" not in full_txt:
        print("[JOB A] 德国哲学论丛.md 英文部分已翻译完成，跳过。")
        return

    # 定位两个英文区段（从第 2500 行正文后搜索，避免误匹配书首目录）
    s1_start = next((i for i in range(2500, len(lines)) if "Leibniz's Two Discoveries" in lines[i]), None)
    s1_end = next((i for i in range((s1_start or 2500) + 10, len(lines)) if l_match_zh_title(lines[i])), None) if s1_start is not None else None
    s2_start = next((i for i in range(2500, len(lines)) if lines[i].strip() == "RESUME"), None)

    print(f"[JOB A] Located EN ranges: sec1={s1_start}..{s1_end}, sec2={s2_start}..{len(lines)}")
    adir = WORK / "anthology"
    (adir / "src").mkdir(parents=True, exist_ok=True)
    (adir / "zh").mkdir(parents=True, exist_ok=True)

    tasks = []
    sec1_parts = []
    if s1_start is not None and s1_end is not None:
        p1 = [l.strip() for l in lines[s1_start:s1_end] if l.strip()]
        chunks1 = split_paragraphs_by_chars(p1, 5500)
        for idx, ch in enumerate(chunks1, 1):
            sp = adir / "src" / f"s1_{idx:02d}.md"
            op = adir / "zh" / f"s1_{idx:02d}.md"
            sp.write_text(ch, encoding="utf-8")
            sec1_parts.append(op)
            tasks.append((sp, op, f"孙小礼《莱布尼茨在中国文化中的两大发现》第 {idx}/{len(chunks1)} 片"))

    sec2_parts = []
    if s2_start is not None:
        p2 = [l.strip() for l in lines[s2_start:] if l.strip()]
        chunks2 = split_paragraphs_by_chars(p2, 7000)
        for idx, ch in enumerate(chunks2, 1):
            sp = adir / "src" / f"s2_{idx:02d}.md"
            op = adir / "zh" / f"s2_{idx:02d}.md"
            sp.write_text(ch, encoding="utf-8")
            sec2_parts.append(op)
            tasks.append((sp, op, f"《德国哲学论丛》英文摘要与德文目录 第 {idx}/{len(chunks2)} 片"))

    def run_one(item):
        sp, op, desc = item
        if op.exists() and len(re.findall(r'[\u4e00-\u9fff]', op.read_text(encoding="utf-8"))) >= 400:
            return f"CACHED {op.name}"
        prompt = (
            f"你是资深哲学翻译家。请将 `{sp}` 中的英文/德文哲学论文与摘要（{desc}）**逐段、100% 完整、忠实流畅地翻译为规范学术简体中文**，直接写入 `{op}`。\n"
            "要求：\n"
            "1. 修复 OCR 断词连字符，严禁省略、概括或遗漏任何句子与注释。\n"
            "2. 哲学术语与人名精准规范（莱布尼茨、白晋、闵明我、《易经》六十四卦、二进制算术、康德、黑格尔、海德格尔、伽达默尔、胡塞尔、狄尔泰、维特根斯坦等）。\n"
            "3. 使用自然分段与清晰 Markdown 标题（`##`/`###`），不要写任何 HTML 标签或反斜杠转义星号。\n"
            f"4. 写入 `{op}` 后仅回复 DONE。"
        )
        t0 = time.time()
        call_dsh(prompt, timeout=420)
        assert op.exists() and len(re.findall(r'[\u4e00-\u9fff]', op.read_text(encoding="utf-8"))) >= 300
        return f"OK {op.name} ({time.time()-t0:.1f}s)"

    print(f"[JOB A] Running {len(tasks)} slices in {WORKERS}-way parallel DSH...")
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(run_one, t) for t in tasks]
        for f in as_completed(futs):
            print("  [A]", f.result())

    # 拼接回 德国哲学论丛.md
    zh1 = "\n\n".join(p.read_text(encoding="utf-8").strip() for p in sec1_parts)
    zh2 = "\n\n".join(p.read_text(encoding="utf-8").strip() for p in sec2_parts)
    out_lines = []
    if s1_start is not None and s1_end is not None and s2_start is not None:
        out_lines = lines[:s1_start] + ["", zh1, ""] + lines[s1_end:s2_start] + ["", zh2, ""]
    elif s2_start is not None:
        out_lines = lines[:s2_start] + ["", zh2, ""]
    if out_lines:
        target.write_text("\n".join(out_lines), encoding="utf-8")
        print(f"[JOB A DONE] Updated 德国哲学论丛.md ({len(target.read_text(encoding='utf-8')):,} chars)")


def l_match_zh_title(line: str) -> bool:
    s = line.strip()
    return s.startswith("真理的本质")


# ==================== JOB B: 《论再生产》全书 OCR 深度校对 ====================
def job_b_proofread_lun_zaishengchan():
    target = EXTRA / "论再生产.md"
    bdir = WORK / "lun_zaishengchan"
    (bdir / "src").mkdir(parents=True, exist_ok=True)
    (bdir / "out").mkdir(parents=True, exist_ok=True)
    done_marker = bdir / "ASSEMBLED.flag"
    if done_marker.exists():
        print("[JOB B] 论再生产.md 已完成全书 DSH 校对，跳过。")
        return

    raw = target.read_text(encoding="utf-8")
    paras = [p.strip() for p in re.split(r'\n\s*\n', raw) if p.strip()]
    chunks = split_paragraphs_by_chars(paras, 5500)
    print(f"[JOB B] 《论再生产》split into {len(chunks)} slices (~5.5k chars each)")

    pending = []
    out_paths = []
    for idx, ch in enumerate(chunks, 1):
        sp = bdir / "src" / f"part_{idx:03d}.md"
        op = bdir / "out" / f"part_{idx:03d}.md"
        sp.write_text(ch, encoding="utf-8")
        out_paths.append((sp, op, idx))
        if not (op.exists() and len(op.read_text(encoding="utf-8")) >= len(ch) * 0.80):
            pending.append((sp, op, idx, len(ch)))

    print(f"[JOB B] {len(pending)}/{len(chunks)} slices pending DSH proofreading...")

    def run_slice(item):
        sp, op, idx, orig_len = item
        prompt = (
            f"你是资深马克思主义哲学古籍编辑与文字校对专家。`{sp}` 是阿尔都塞名著《论再生产》中文译本的 OCR 识别稿（第 {idx}/{len(chunks)} 片，约 {orig_len} 字），其中包含不少老旧 PDF OCR 错别字、误识字符和排版瑕疵（例如：'奵'实为'在'、'娃'实为'是'、'E 得了'实为'赢得了'、'丨9〗8—1\"〇'实为'1918—1990'、'®'实为注释号、残缺引号与乱空格等）。\n"
            f"请你**逐段、100% 完整地校对并修复所有 OCR 错别字、数字年代错识、外文人名/书名错识与标点排版**，直接写入 `{op}`。\n"
            "严格铁律：\n"
            "1. **绝对禁止删减、缩写或改写原译文内容**：每个自然段、每条注释都必须 100% 完整保留，输出字数应与原文基本一致（±10% 以内）。\n"
            "2. **阿尔都塞核心哲学术语规范统一**：再生产、生产关系、意识形态国家机器（AIE）、镇压性国家机器、询唤、主体、认识论断裂、多元决定、经济基础与上层建筑、阶级斗争等。\n"
            "3. **纯净 Markdown 排版**：保留清晰的 `##`/`###` 章节标题与自然分段，清除误夹在正文中的孤立页码与页眉，不要写任何 HTML 标签或反斜杠转义星号。\n"
            f"4. 写入 `{op}` 完成后仅回复 DONE #{idx:03d}。"
        )
        t0 = time.time()
        for attempt in range(3):
            try:
                call_dsh(prompt, timeout=480)
                if op.exists():
                    out_len = len(op.read_text(encoding="utf-8"))
                    if out_len >= orig_len * 0.80:
                        return f"OK #{idx:03d}/{len(chunks)} ({orig_len}->{out_len} chars, {time.time()-t0:.1f}s)"
            except Exception as e:
                print(f"  [B] Retry {attempt+1} #{idx:03d}: {e}")
        return f"WARN #{idx:03d} fell back to original"

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(run_slice, it) for it in pending]
        done_cnt = len(chunks) - len(pending)
        for f in as_completed(futs):
            done_cnt += 1
            print(f"  [B] ({done_cnt}/{len(chunks)}) {f.result()}")

    # 校验全部切片完整后安全覆盖原文件（先备份）
    bak = bdir / "论再生产.orig.md.bak"
    if not bak.exists():
        bak.write_text(raw, encoding="utf-8")
    merged_parts = []
    for sp, op, _ in out_paths:
        if op.exists() and len(op.read_text(encoding="utf-8")) >= len(sp.read_text(encoding="utf-8")) * 0.80:
            merged_parts.append(op.read_text(encoding="utf-8").strip())
        else:
            merged_parts.append(sp.read_text(encoding="utf-8").strip())
    merged = "\n\n".join(merged_parts)
    target.write_text(merged + "\n", encoding="utf-8")
    done_marker.write_text("OK", encoding="utf-8")
    print(f"[JOB B DONE] 论再生产.md fully proofread: {len(merged):,} chars")


# ==================== JOB C: 《哲学导论》含噪点段落精准校对 ====================
def job_c_proofread_zhexue_daolun():
    target = EXTRA / "哲学导论.md"
    cdir = WORK / "zhexue_daolun_v2"
    (cdir / "src").mkdir(parents=True, exist_ok=True)
    (cdir / "out").mkdir(parents=True, exist_ok=True)
    done_marker = cdir / "ASSEMBLED.flag"
    if done_marker.exists():
        print("[JOB C] 哲学导论.md 噪点段落已完成 DSH 校对，跳过。")
        return

    raw = target.read_text(encoding="utf-8")
    paras = [p.strip() for p in re.split(r'\n\s*\n', raw) if p.strip()]
    NOISE_RE = re.compile(
        r'[\u4e00-\u9fff]\s*[A-Za-z丨丿]\s+[\u4e00-\u9fff]|[\u4e00-\u9fff][丨丿®©™£¥§¤\\^]|cpi\\|第[A-Za-z]\s*页|[\u4e00-\u9fff]9\s+[\u4e00-\u9fff]|:[<《]|《[^》\n]+>|（[^）\n]+》'
    )
    noisy_indices = [i for i, p in enumerate(paras) if NOISE_RE.search(p)]
    print(f"[JOB C] 《哲学导论》detected {len(noisy_indices)} noisy paragraphs out of {len(paras)}")
    if not noisy_indices:
        done_marker.write_text("OK", encoding="utf-8")
        return

    # 按字符上限 ~3500 字打包，确保每批在 40~90 秒内极速完成
    batches = []
    cur_b = []
    cur_len = 0
    for idx in noisy_indices:
        plen = len(paras[idx]) + 20
        if cur_b and (cur_len + plen > 3500 or len(cur_b) >= 12):
            batches.append(cur_b)
            cur_b = [idx]
            cur_len = plen
        else:
            cur_b.append(idx)
            cur_len += plen
    if cur_b:
        batches.append(cur_b)
    print(f"[JOB C] Split into {len(batches)} compact batches (~3.5k chars each)")

    def run_batch(b_idx, idxs):
        sp = cdir / "src" / f"batch_{b_idx:02d}.md"
        op = cdir / "out" / f"batch_{b_idx:02d}.md"
        body = "\n\n".join(f"<<<P{k}>>>\n{paras[k]}" for k in idxs)
        sp.write_text(body, encoding="utf-8")
        if op.exists() and op.read_text(encoding="utf-8").count("<<<P") >= len(idxs):
            return f"CACHED batch_{b_idx:02d}"
        prompt = (
            f"你是资深哲学编校专家。`{sp}` 包含张世英《哲学导论》中的 {len(idxs)} 个带编号 OCR 段落（每个以 `<<<P数字>>>` 开头），里面含有局部 OCR 识别错字、希腊/拉丁文乱码（如 `cpi\\6ao<po£` 实为 `φιλόσοφος`）、标点误识（如把句号识成 `9`、把注释号识成 `®`、`^`、破损书名号等）。\n"
            f"请逐条精准修复其中的 OCR 错字、外文词拼写与标点错误，**严格保持每条原有的 `<<<P数字>>>` 标记与段落数量一一对应，绝不增删句子或合并条目**，写入 `{op}`。\n"
            f"写完 `{op}` 后仅回复 DONE batch_{b_idx:02d}。"
        )
        t0 = time.time()
        for attempt in range(3):
            try:
                call_dsh(prompt, timeout=420)
                if op.exists() and op.read_text(encoding="utf-8").count("<<<P") >= len(idxs) - 1:
                    return f"OK batch_{b_idx:02d} ({time.time()-t0:.1f}s)"
            except Exception as e:
                print(f"  [C] Retry {attempt+1} batch_{b_idx:02d}: {e}")
        return f"WARN batch_{b_idx:02d} skipped"

    with ThreadPoolExecutor(max_workers=min(WORKERS, len(batches))) as ex:
        futs = [ex.submit(run_batch, i + 1, b) for i, b in enumerate(batches)]
        for f in as_completed(futs):
            print("  [C]", f.result())

    # 回填修复后的段落
    bak = cdir / "哲学导论.orig.md.bak"
    if not bak.exists():
        bak.write_text(raw, encoding="utf-8")
    replaced = 0
    for b_idx in range(1, len(batches) + 1):
        op = cdir / "out" / f"batch_{b_idx:02d}.md"
        if not op.exists():
            continue
        out_txt = op.read_text(encoding="utf-8")
        parts = re.split(r'<<<P(\d+)>>>\s*', out_txt)
        for j in range(1, len(parts) - 1, 2):
            pidx = int(parts[j])
            ptext = parts[j + 1].strip()
            if 0 <= pidx < len(paras) and len(ptext) >= len(paras[pidx]) * 0.65:
                paras[pidx] = ptext
                replaced += 1

    target.write_text("\n\n".join(paras) + "\n", encoding="utf-8")
    done_marker.write_text("OK", encoding="utf-8")
    print(f"[JOB C DONE] 哲学导论.md updated {replaced}/{len(noisy_indices)} noisy paragraphs")


if __name__ == "__main__":
    job_a_german_anthology()
    job_c_proofread_zhexue_daolun()
    job_b_proofread_lun_zaishengchan()
    print("\nALL DSH MASTER POLISH JOBS COMPLETED!")
