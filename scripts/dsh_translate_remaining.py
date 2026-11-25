#!/usr/bin/env python3
"""
dsh_translate_remaining.py — 将尚未译完的分片交给 DSH (DeepSeek Harness)
每次新开独立 DSH 对话，指定 provider: commandcode, model: deepseek/deepseek-v4.1-flash，
并行完成《黑格尔哲学（斯退士）》剩余 24 片与《列宁哲学笔记（全集第38卷）》全部 72 片的学术精译，
并在完成后自动校验完整度、合并输出至 extra-books/。
"""
import os
import re
import json
import time
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

WORK_DIR = Path(r"D:\咕咕嘎嘎反重力\translation-work")
OUT_DIR = Path(r"D:\咕咕嘎嘎反重力\extra-books")
DSH_BIN = r"C:\dsh-remote\cli\node_modules\@deepseek-ai\dsh\lib\bin.js"
PATCH_FILE = r"D:\咕咕嘎嘎反重力\scripts\dsh_command_v41.yml"

GLOSSARY_BY_BOOK = {
    "aesthetics_politics": """
核心术语统一表（《美学与政治》）：
- Expressionism -> 表现主义；Realism -> 现实主义；Formalism -> 形式主义；Modernism -> 现代主义；Avant-garde -> 先锋派
- Totality -> 总体性；Reification -> 物化；Alienation / Estrangement -> 异化 / 陌生化（布莱希特戏剧用“间离效果”）
- Montage -> 蒙太奇；Aura -> 灵晕（本雅明）；Commitment -> 介入；Autonomous art -> 自律艺术
""",
    "enlightenment": """
核心术语统一表（霍克海默、阿多诺《启蒙辩证法》）：
- Dialectic of Enlightenment -> 启蒙辩证法；Philosophical Fragments -> 哲学断片
- Culture Industry -> 文化工业；Instrumental Reason -> 工具理性；Disenchantment -> 祛魅；Myth -> 神话
- Mimesis -> 模仿；Domination -> 统治 / 支配；Self-preservation -> 自我保存；Reification -> 物化
""",
    "stace_hegel": """
核心术语统一表（W. T. 斯退士《黑格尔哲学》）：
- Being -> 存在 / 有；Nothing -> 无；Becoming -> 变易；Determinate Being (Dasein) -> 定在
- Being-in-itself -> 自在存在；Being-for-itself -> 自为存在；Being-in-and-for-itself -> 自在自为存在
- Quality -> 质；Quantity -> 量；Measure -> 尺度；Essence -> 本质；Appearance -> 现象；Actuality -> 现实
- Notion / Concept (Begriff) -> 概念；Judgment -> 判断；Syllogism -> 推论；Idea -> 理念；Absolute Idea -> 绝对理念
- Aufhebung / Sublation -> 扬弃；Dialectical method -> 辩证法；Speculative -> 思辨的；Understanding (Verstand) -> 知性；Reason (Vernunft) -> 理性
- Concrete Universal -> 具体普遍性；Abstract Universal -> 抽象普遍性；Spirit / Mind (Geist) -> 精神
- Subjective Spirit -> 主观精神；Objective Spirit -> 客观精神；Absolute Spirit -> 绝对精神；Philosophy of Nature -> 自然哲学
""",
    "lenin38": """
核心术语统一表（《列宁哲学笔记·全集第38卷》）：
- Conspectus -> 摘要；Science of Logic -> 《逻辑学》；Lectures on the History of Philosophy -> 《哲学史讲演录》；Lectures on the Philosophy of History -> 《历史哲学》
- Dialectics -> 辩证法；Materialism -> 唯物主义；Idealism -> 唯心主义；Thing-in-itself -> 自在之物
- Reflection -> 反映 / 反思（认识论中用“反映”，黑格尔本质论中用“反思”）；Practice / Praxis -> 实践
- Unity of opposites -> 对立统一；Leap -> 飞跃；Negation of the negation -> 否定之否定；Contradiction -> 矛盾
- Notion / Concept -> 概念；Essence -> 本质；Appearance / Semblance -> 假象 / 现象；Law -> 规律；Causality -> 因果性
- NB -> NB（注意）；Sensuous certainty -> 感性确定性；Absolute Idea -> 绝对理念；Epistemology -> 认识论
""",
}


def check_part_valid(zh_path: str, src_words: int) -> bool:
    zp = Path(zh_path)
    if not zp.exists():
        return False
    txt = zp.read_text(encoding="utf-8", errors="replace").strip()
    if len(txt) < min(180, max(10, src_words * 2)):
        return False
    zh_cnt = len(re.findall(r"[\u4e00-\u9fff]", txt))
    min_zh = max(120, int(src_words * 0.6)) if src_words > 250 else max(4, src_words)
    return zh_cnt >= min_zh


def assemble_book(book: dict):
    assembled = []
    for p in book["parts"]:
        zp = Path(p["zh"])
        if zp.exists():
            chunk = zp.read_text(encoding="utf-8", errors="replace").strip()
            if chunk:
                assembled.append(chunk)
    full_md = "\n\n".join(assembled)
    if not full_md.startswith("# "):
        full_md = f"# {book['title']}\n\n" + full_md
    out_file = OUT_DIR / book["out_name"]
    out_file.write_text(full_md, encoding="utf-8")
    zh_total = len(re.findall(r"[\u4e00-\u9fff]", full_md))
    print(f"[ASSEMBLED] {out_file.name}: {len(full_md):,} chars (汉字 {zh_total:,})", flush=True)


def run_dsh_for_part(book: dict, part: dict) -> tuple[int, bool, str]:
    bid = book["id"]
    title = book["title"]
    glossary = GLOSSARY_BY_BOOK.get(bid, "").strip()
    idx = part["index"]
    src_path = part["src"]
    zh_path = part["zh"]
    words = part["words"]

    prompt = (
        f"你是资深西方哲学翻译家。请将英文哲学源文件 `{src_path}`（《{title}》第 {idx}/{book['part_count']} 片，约 {words} 英文词）"
        f"**逐段、完整、忠实、流畅地翻译为学术规范简体中文**，并将完整中文译文直接写入 `{zh_path}`。\n\n"
        f"严格要求：\n"
        f"1. **100% 内容完整**：必须逐段逐句完整翻译源文件中的所有正文、标题、引文与注释，严禁任何形式的概括、删节、跳段或缩写！\n"
        f"2. **术语精准统一**：\n{glossary}\n"
        f"3. **纯净 Markdown**：保留 `#` / `##` / `###` 标题层级与段落结构，修正明显的 OCR 断词拼写错误，不要写入任何乱码或“以下是翻译”等客套话。\n"
        f"4. 写入 `{zh_path}` 完成后，仅简短回复“DONE #{idx:03d}”即可。"
    )

    env = os.environ.copy()
    env["DSH_PERMISSION_MODE"] = "danger-full-access"

    for attempt in range(2):
        try:
            proc = subprocess.run(
                ["node", DSH_BIN, "--profile", "headless", "--patch", PATCH_FILE, prompt],
                cwd=str(WORK_DIR),
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=600,
            )
            if check_part_valid(zh_path, words):
                zh_txt = Path(zh_path).read_text(encoding="utf-8", errors="replace")
                zh_cnt = len(re.findall(r"[\u4e00-\u9fff]", zh_txt))
                return idx, True, f"OK (zh={zh_cnt:,})"
            err_tail = (proc.stderr or proc.stdout or "")[-160:].replace("\n", " ")
        except Exception as e:
            err_tail = str(e)
        time.sleep(2)

    return idx, check_part_valid(zh_path, words), f"FAIL ({err_tail})"


def main():
    manifest = json.loads((WORK_DIR / "manifest.json").read_text(encoding="utf-8"))

    for book in manifest:
        title = book["title"]
        pending = [p for p in book["parts"] if not check_part_valid(p["zh"], p["words"])]
        if not pending:
            print(f"[BOOK ALREADY 100%] {title} ({book['part_count']}/{book['part_count']})", flush=True)
            assemble_book(book)
            continue

        print(f"\n=== DSH Translating (commandcode / deepseek-v4.1-flash): {title} ({len(pending)}/{book['part_count']} remaining) ===", flush=True)
        t0 = time.time()
        done_count = book["part_count"] - len(pending)

        # 并发开启 6 个独立 DSH 对话（commandcode / deepseek-v4.1-flash）
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = {pool.submit(run_dsh_for_part, book, p): p for p in pending}
            for fut in as_completed(futures):
                idx, ok, msg = fut.result()
                if ok:
                    done_count += 1
                elapsed = time.time() - t0
                print(f"  [DSH] {title} #{idx:03d}/{book['part_count']:03d}: {msg} | total={done_count}/{book['part_count']} ({elapsed:.1f}s)", flush=True)

        # 二次补漏重试任何未达标的片
        still_pending = [p for p in book["parts"] if not check_part_valid(p["zh"], p["words"])]
        if still_pending:
            print(f"  [DSH RETRY] {title}: retrying {len(still_pending)} slices...", flush=True)
            with ThreadPoolExecutor(max_workers=4) as pool:
                for fut in as_completed([pool.submit(run_dsh_for_part, book, p) for p in still_pending]):
                    idx, ok, msg = fut.result()
                    print(f"    [RETRY] {title} #{idx:03d}: {msg}", flush=True)

        assemble_book(book)

    print("\nALL DSH TRANSLATIONS & ASSEMBLIES COMPLETE!", flush=True)


if __name__ == "__main__":
    main()
