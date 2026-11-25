#!/usr/bin/env python3
"""
使用 DSH (commandcode / deepseek-v4.1-flash) 完整翻译《德国哲学论丛》中的两段外语正文：
1. L2725..L2840: Sun Xiaoli《Leibniz's Two Discoveries in the Chinese Culture》
2. L3189..L3448: RESUME（全书各篇论文英文摘要与德文目录），并彻底清除文末 Anna's Archive / DuXiu 元数据垃圾。
"""
import os
import subprocess
import tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

DSH_BIN = r"C:\dsh-remote\cli\node_modules\@deepseek-ai\dsh\lib\bin.js"
PATCH = r"D:\咕咕嘎嘎反重力\scripts\dsh_command_v41.yml"
TARGET = Path(r"D:\咕咕嘎嘎反重力\extra-books\德国哲学论丛.md")
WORK = Path(r"D:\咕咕嘎嘎反重力\translation-work-anthology")
WORK.mkdir(parents=True, exist_ok=True)

lines = TARGET.read_text(encoding="utf-8").splitlines()
part1_lines = lines[2724:2840]  # L2725..L2840
# Strip Anna's Archive tail
end_idx = len(lines)
for idx in range(3188, len(lines)):
    if "DocumentgeneratedbyAnna" in lines[idx] or "Anna'sArchive" in lines[idx] or '"filename_decoded"' in lines[idx]:
        end_idx = idx
        break
part2_lines = lines[3188:end_idx]  # L3189..before Anna's Archive

src1 = WORK / "sec1_leibniz_en.md"
out1 = WORK / "sec1_leibniz_zh.md"
src2 = WORK / "sec2_resume_en.md"
out2 = WORK / "sec2_resume_zh.md"

src1.write_text("\n".join(part1_lines), encoding="utf-8")
src2.write_text("\n".join(part2_lines), encoding="utf-8")


def run_dsh(src_path: Path, out_path: Path, desc: str):
    prompt = (
        f"你是资深哲学翻译与编辑。请将 `{src_path}` 中的外语学术文本（{desc}）"
        f"完整、忠实、流畅地翻译为规范学术简体中文，修复其中的 OCR 断词连字符（如 mathemati-cian -> mathematician），"
        f"并使用清晰的 Markdown 标题与自然分段直接写入 `{out_path}`。\n"
        "严格要求：\n"
        "1. 100% 完整翻译所有正文、标题、注释与摘要，严禁删节或概括。\n"
        "2. 专有名词与哲学术语精准规范（莱布尼茨、白晋/Joachim Bouvet、闵明我/Grimaldi、《易经》六十四卦、二进制算术、通用符号语言、康德、黑格尔、海德格尔、伽达默尔、胡塞尔、狄尔泰、费希特、维特根斯坦等）。\n"
        "3. 不要使用反斜杠转义星号（不要写 `\\*`），不要包含任何 HTML 标签或客套话。\n"
        f"4. 写完 `{out_path}` 后仅回复 DONE。"
    )
    env = os.environ.copy()
    env["DSH_PERMISSION_MODE"] = "danger-full-access"
    subprocess.run(
        ["node", DSH_BIN, "--profile", "headless", "--patch", PATCH, prompt],
        check=True,
        env=env,
        timeout=360,
    )
    assert out_path.exists() and len(out_path.read_text(encoding="utf-8")) > 500, f"Output too short: {out_path}"
    print(f"  [OK] {desc} -> {len(out_path.read_text(encoding='utf-8')):,} chars")


with ThreadPoolExecutor(max_workers=2) as ex:
    f1 = ex.submit(run_dsh, src1, out1, "孙小礼《莱布尼茨在中国文化中的两大发现》英文论文")
    f2 = ex.submit(run_dsh, src2, out2, "《德国哲学论丛》英文论文摘要 RESUME 与德文篇目表")
    f1.result()
    f2.result()

zh1 = out1.read_text(encoding="utf-8").strip()
zh2 = out2.read_text(encoding="utf-8").strip()

new_lines = (
    lines[:2724]
    + ["", zh1, ""]
    + lines[2840:3188]
    + ["", zh2, ""]
)
TARGET.write_text("\n".join(new_lines), encoding="utf-8")
print(f"DONE! Updated {TARGET.name}: {len(TARGET.read_text(encoding='utf-8')):,} chars")
