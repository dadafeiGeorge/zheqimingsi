import json
import re
from pathlib import Path

WORK_DIR = Path(r"D:\咕咕嘎嘎反重力\translation-work")
OUT_DIR = Path(r"D:\咕咕嘎嘎反重力\extra-books")

GLOSSARY_BY_BOOK = {
    "aesthetics_politics": """
核心术语统一表（《美学与政治》）：
- Expressionism -> 表现主义；Realism -> 现实主义；Formalism -> 形式主义；Modernism -> 现代主义；Avant-garde -> 先锋派
- Totality -> 总体性；Reification -> 物化；Alienation / Estrangement -> 异化 / 陌生化（布莱希特戏剧用“间离效果” Verfremdungseffekt）
- Montage -> 蒙太奇；Aura -> 灵晕（本雅明）；Commitment -> 介入（萨特/阿多诺）；Autonomous art -> 自律艺术
- Dialectical image -> 辩证意象；Popular Front -> 人民阵线；Decadence -> 颓废；Heritage -> 文化遗产
- Ernst Bloch -> 恩斯特·布洛赫；Georg Lukács -> 格奥尔格·卢卡奇；Bertolt Brecht -> 贝尔托特·布莱希特；Walter Benjamin -> 瓦尔特·本雅明；Theodor W. Adorno -> 特奥多尔·W·阿多诺；Fredric Jameson -> 弗雷德里克·詹姆逊
""",
    "enlightenment": """
核心术语统一表（霍克海默、阿多诺《启蒙辩证法》）：
- Dialectic of Enlightenment -> 启蒙辩证法；Philosophical Fragments -> 哲学断片
- Culture Industry -> 文化工业；Instrumental Reason -> 工具理性；Disenchantment -> 祛魅；Myth / Mythology -> 神话
- Mimesis -> 模仿；Domination -> 统治 / 支配；Self-preservation -> 自我保存；Reification -> 物化
- Excursus -> 补论；Odysseus -> 奥德修斯；Juliette -> 茱莉叶；Elements of Anti-Semitism -> 反犹主义要素
- Positivism -> 实证主义；Enlightenment as Mass Deception -> 作为大众欺骗的启蒙；Determinate negation -> 确定的否定
- Max Horkheimer -> 马克斯·霍克海默；Theodor W. Adorno -> 特奥多尔·W·阿多诺
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

SYSTEM_RULES = """你是资深西方哲学翻译家。请将指定的英文哲学片段**完整、逐段、忠实、流畅地翻译为学术规范简体中文**。
严格铁律：
1. **100% 内容完整**：必须逐段逐句完整翻译源文件中的所有正文、标题、引文与注释，严禁任何形式的概括、省略、跳段或缩写！
2. **术语精准统一**：严格遵守下方给出的本著作核心哲学术语表；重要德文/希腊文/拉丁文原词可按学术惯例随原文保留（如“扬弃（Aufhebung）”）。
3. **纯净 Markdown 格式**：保留原文的 `#` / `##` / `###` 标题层级与段落结构；修正明显的 OCR 断词拼写错误；绝对不要输出乱码、控制字符、或“以下是翻译”等任何多余开场白/结语。
4. **直接落盘**：调用 `write_file`（`Overwrite=True`）将完整译文写入目标路径，并在 `finish` 中简短回报完成字数。"""

SCHEMA = {
    "type": "object",
    "properties": {
        "ok": {"type": "boolean"},
        "zh_chars": {"type": "integer"},
        "note": {"type": "string"},
    },
    "required": ["ok", "zh_chars"],
}


def check_part_valid(src_path: str, zh_path: str, src_words: int) -> bool:
    zp = Path(zh_path)
    if not zp.exists():
        return False
    txt = zp.read_text(encoding="utf-8", errors="replace").strip()
    if len(txt) < 200:
        return False
    zh_cnt = len(re.findall(r"[\u4e00-\u9fff]", txt))
    # 中文译文字数通常约为英文词数的 1.4~2.2 倍；对索引/参考文献允许略低，但绝不接受低于 0.75 或纯英文
    min_zh = max(120, int(src_words * 0.78)) if src_words > 250 else 30
    return zh_cnt >= min_zh


manifest = json.loads((WORK_DIR / "manifest.json").read_text(encoding="utf-8"))
wave_size = 10

for book in manifest:
    bid = book["id"]
    title = book["title"]
    glossary = GLOSSARY_BY_BOOK.get(bid, "")
    phase(f"精译《{title}》({book['part_count']} 片)")

    pending = [
        p for p in book["parts"]
        if not check_part_valid(p["src"], p["zh"], p["words"])
    ]
    log(f"《{title}》: 共 {book['part_count']} 片，待译 {len(pending)} 片")

    for attempt in range(2):
        if not pending:
            break
        if attempt == 1:
            log(f"《{title}》重试未达完整度阈值的 {len(pending)} 片...")
        for start in range(0, len(pending), wave_size):
            batch = pending[start : start + wave_size]

            def make_agent(p):
                prompt = (
                    f"{SYSTEM_RULES}\n\n"
                    f"书籍：《{title}》（作者：{book['author']}），第 {p['index']}/{book['part_count']} 片（约 {p['words']} 英文词）。\n"
                    f"{glossary}\n"
                    f"请执行：\n"
                    f"1. 使用 `read_file` 读取英文原文 `{p['src']}`；\n"
                    f"2. 逐段完整精译为学术简体中文（严禁删节，译文汉字数应与原文篇幅严格匹配）；\n"
                    f"3. 使用 `write_file`（`Overwrite=True`）将纯译文写入 `{p['zh']}`；\n"
                    f"4. 调用 `finish` 返回 ok 与译文字符数。"
                )
                return agent(
                    prompt,
                    schema=SCHEMA,
                    role=f"精译《{title}》#{p['index']:03d}",
                    model="flash",
                )

            await parallel(batch, make_agent)
            done_now = sum(1 for x in book["parts"] if check_part_valid(x["src"], x["zh"], x["words"]))
            log(f"  《{title}》进度: {done_now}/{book['part_count']} 片通过完整度校验")

        pending = [
            p for p in book["parts"]
            if not check_part_valid(p["src"], p["zh"], p["words"])
        ]

    # 汇总合并全书 Markdown
    assembled = []
    for p in book["parts"]:
        zp = Path(p["zh"])
        if zp.exists():
            chunk = zp.read_text(encoding="utf-8", errors="replace").strip()
            if chunk:
                assembled.append(chunk)
    full_md = "\n\n".join(assembled)
    if not full_md.startswith("# "):
        full_md = f"# {title}\n\n" + full_md
    out_file = OUT_DIR / book["out_name"]
    out_file.write_text(full_md, encoding="utf-8")
    zh_total = len(re.findall(r"[\u4e00-\u9fff]", full_md))
    log(f"[ASSEMBLED] {out_file.name}: {len(full_md):,} chars (汉字 {zh_total:,}) | 剩余不合格片: {len(pending)}")

log("全部 4 部英文哲学原著 AI 逐段精译与合并完成！")
