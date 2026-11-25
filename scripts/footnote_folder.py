#!/usr/bin/env python3
"""
footnote_folder.py — 构建期全书级学术注脚与【译注】结构化收纳引擎。
在 build_library.py 切分（续 N）之前、跨同组子章及紧邻「注释」章执行，彻底消除
“句中已有注脚、下文又以正文形式重复显现注释内容”的现象。

每个被绑定的正文块会获得：
  - 行内占位符 `⟦fn:0⟧`（前端直接渲染为可点击角标 `[1]` / `①` / `译注`，朗读自动跳过）
  - 结构化 `"f": [{"l": "1", "k": "fn"|"gloss", "t": "完整注释正文"}, ...]`
所有已收纳的冗余注释段落、断行续接段、孤立“注释”分隔标题及已被完全吸收的空“注释”章，
均会在构建期从正文流中彻底移除，确保滚动模式、翻页模式与电台朗读三端零重复。
"""
import hashlib
import json
import re
from pathlib import Path

CIRCLED_CHARS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚"
CIRCLED_MAP = {ch: str(i + 1) for i, ch in enumerate(CIRCLED_CHARS)}
SUP_MAP = {"⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9"}

CITATION_HINT_RE = re.compile(
    r"(《|》|第\s*\d+\s*页|\d+\s*页|年版|同上|参阅|参见|参看|引自|引者|译者|译注|编者|原注|边码|"
    r"\d{4}\s*[：:]\s*\d|及以下|见\s*[A-Z][A-Za-z]+|见\s*[\u4e00-\u9fff]{2,6}\s*[（(]?\d{4}|SE\s*\d+|"
    r"译本|见本卷|见第[一二三四五六七八九十]+章|[（(][^）)]{2,24}\d{4}[）)]|"
    r"全集|选集|文集|著作集|出版社|书局|p\.\s*\d|pp\.\s*\d|vol\.|Verlag|Press|University|"
    r"——\s*(?:译者注?|编者注?|校者注?|原注|译注)|根据作者电子稿|此处指|系指|即指)",
    re.I,
)

NOTE_HEADER_RE = re.compile(r"^(?:注释|注|脚注|尾注|译注|译者注|校注|原注|编者注|编者注释)[：:。\s]*$")


def _is_note_header(t: str) -> bool:
    s = re.sub(r"^[#*_\s]+|[#*_\s]+$", "", t or "")
    return bool(NOTE_HEADER_RE.match(s))
NOTES_CHAPTER_TITLE_RE = re.compile(
    r"^(?!各种注释)(?:注释|译者注|译注|译者注释|尾注|脚注|注|编者注|原注|编者注释|编辑说明|"
    r".+(?:篇|章|节|部分|导言|前言|导论|文本)注释)"
    r"(?:（(?:续\s*\d+|[一二三四五六七八九十]+)）)?$"
)

ROMAN_VAL_MAP = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def _is_valid_roman(s: str) -> bool:
    if not s or len(s) > 10 or not re.fullmatch(r"[IVXLCDM]+", s):
        return False
    return bool(re.fullmatch(r"M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})", s))
DEDICATION_RE = re.compile(r"^(?:献给|纪念|谨以|谨献|献词|in memory of|dedicated to)", re.I)
BARE_CITATION_RE = re.compile(
    r"^(?:《[^《》]{1,40}》[，,：:]\s*(?:见《|第\s*\d+|上卷|下卷|商务|人民|三联|\d+页)|"
    r"同上书?[，,。.\s]|"
    r"(?:参见|参阅|参看|详参|引自|见)[：:\s]*(?:《|第\s*\d+|上文|下文|前文|本书|[A-Z]))"
)

DSH_FOLD_MAP_PATH = Path(__file__).parent / "dsh_footnote_fold_map.json"


def _load_dsh_fold_map() -> dict:
    if DSH_FOLD_MAP_PATH.exists():
        try:
            data = json.loads(DSH_FOLD_MAP_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    return {}


def _decode_sup(s: str) -> str:
    return "".join(SUP_MAP.get(c, "") for c in s)


def _block_key(text: str) -> str:
    return hashlib.sha1(text.strip().encode("utf-8")).hexdigest()[:16]


def _add_fn_to_block(blk: dict, label: str, kind: str, note_text: str) -> int:
    # 标题块不承载脚注：脚注必须挂在正文段落上，否则标题会带 ⟦fn:N⟧ 却没有 f 条目
    if blk.get("y") == "h":
        return -1
    fns = blk.setdefault("f", [])
    idx = len(fns)
    fns.append({"l": label, "k": kind, "t": note_text.strip()})
    return idx


def parse_footnote_def(blk: dict) -> dict | None:
    """解析单个块是否为候选脚注定义块。"""
    if blk.get("y") not in ("p", "q", "l"):
        return None
    raw = (blk.get("t") or "").strip()
    if not raw or len(raw) > 3200:
        return None
    if raw.startswith("【译注】"):
        return None

    # 1) 圆圈编号 ① / ①② / ①②③④ ...
    m = re.match(rf"^([{CIRCLED_CHARS}]+)[、.．:：\s\u3000]*(.{{2,}})$", raw, re.S)
    if m:
        nums = [CIRCLED_MAP[c] for c in m.group(1) if c in CIRCLED_MAP]
        if nums:
            return {"kind": "circle", "nums": nums, "text": m.group(2).strip()}

    # 2) Unicode 上标编号 ¹ ² ³ ...
    m = re.match(r"^([¹²³⁴⁵⁶⁷⁸⁹][⁰¹²³⁴⁵⁶⁷⁸⁹]*)[\s\u3000]+(.{2,})$", raw, re.S)
    if m:
        num = _decode_sup(m.group(1))
        if num:
            return {"kind": "sup", "nums": [num], "text": m.group(2).strip()}

    # 3) 六角括号 〔1〕
    m = re.match(r"^〔(\d{1,3})〕[\s\u3000:：]*(.{2,})$", raw, re.S)
    if m:
        num = int(m.group(1))
        txt = m.group(2).strip()
        # 三位数且正文较长、无引文特征者多为原书页码边码（如〔208〕），不是脚注
        if num >= 100 and len(txt) > 120 and not CITATION_HINT_RE.search(txt):
            return None
        return {"kind": "tortoise", "nums": [m.group(1)], "text": txt}

    # 4) 方括号 [1] / [^1] / [注1]
    m = re.match(r"^\[\^?(?:注|译注|原注)?(\d{1,3})\][：:\s\u3000]*(.{2,})$", raw, re.S)
    if m:
        return {"kind": "bracket", "nums": [m.group(1)], "text": m.group(2).strip()}

    # 5) 显式“注1：/注释1：/译注1：/原注1：/编者注1：/译者注1：/脚注1：”
    m = re.match(r"^(?:注释|译者注|译注|校注|原注|编者注|脚注|注)\s*(\d{1,3})[：:.、\s\u3000]+(.{2,})$", raw, re.S)
    if m:
        return {"kind": "explicit", "nums": [m.group(1)], "text": m.group(2).strip()}

    # 6) 半角/全角圆括号 (1) / （1）（如《近代哲学史》）
    m = re.match(r"^[（(](\d{1,3})[）)][\s\u3000:：]*(.{2,})$", raw, re.S)
    if m and 1 <= int(m.group(1)) <= 200:
        return {"kind": "paren", "nums": [m.group(1)], "text": m.group(2).strip()}

    # 7) 纯数字 + 空白/全角空格（如 `1　《列宁》...` / `12 康德...`）
    m = re.match(r"^(\d{1,3})[\s\u3000]+([^\d\s].{2,})$", raw, re.S)
    if m and 1 <= int(m.group(1)) <= 350:
        tail = m.group(2).strip()
        # “18 世纪启蒙的进步目标……”这类正文年份/世纪不是注码
        if re.match(r"^(?:世纪|年代|年|月|日)", tail):
            return None
        return {"kind": "numspace", "nums": [m.group(1)], "text": tail}

    # 8) 纯数字 + 点 + 空白（仅在明确引文或注脚章节内匹配；允许以年份如 1801 年 开头）
    m = re.match(r"^(\d{1,3})\.[\s\u3000]+(\S.{2,})$", raw, re.S)
    if m and 1 <= int(m.group(1)) <= 350:
        tail = m.group(2).strip()
        if re.match(r"^(?:世纪|年代|年|月|日)", tail):
            return None
        return {"kind": "numdot", "nums": [m.group(1)], "text": tail}

    # 9) 罗马数字编号 I / II / LXX / CCXVIII + 空白 + 注释正文（如《神话哲学历史批判导论》）
    m = re.match(r"^([IVXLCDM]{1,10})[\s\u3000]+(.{4,})$", raw, re.S)
    if m and _is_valid_roman(m.group(1)):
        rm = m.group(1)
        tail = m.group(2).strip()
        if not (rm == "I" and re.match(r"^[a-z]", tail)) and not re.match(r"^[书名题目章节卷第]", tail):
            return {"kind": "roman", "nums": [rm], "text": tail}

    # 9b) 方括号包裹的小写罗马页码注［[vii] / [xiii] / [xiv]］（如《启蒙辩证法》献辞/序言注释）
    m = re.match(r"^\[([ivxlcdm]{1,8})\][\s\u3000]+(.{4,})$", raw, re.S)
    if m and _is_valid_roman(m.group(1).upper()):
        return {"kind": "roman", "nums": [m.group(1).upper()], "text": m.group(2).strip()}

    return None


def _is_compatible(ref_kind: str, def_kind: str) -> bool:
    if ref_kind == def_kind:
        return True
    if ref_kind == "plain":
        return True
    if def_kind == "explicit":
        return True
    if ref_kind == "sup" and def_kind in ("numspace", "numdot", "bracket", "circle", "paren"):
        return True
    if ref_kind == "bracket" and def_kind in ("numspace", "numdot", "sup", "paren"):
        return True
    if ref_kind == "circle" and def_kind in ("numspace", "bracket", "sup"):
        return True
    if ref_kind == "paren" and def_kind in ("numspace", "bracket", "sup"):
        return True
    return False


# 行内脚注标记扫描器（按文本出现顺序逐一捕获，绝不跳过同段重复的 ①②）
INLINE_REF_RE = re.compile(
    rf"(?P<circle>[{CIRCLED_CHARS}])"
    r"|(?P<tortoise>〔(?P<tnum>\d{1,3})〕)"
    r"|(?P<bracket>\[\^?(?P<bnum>\d{1,3})\])"
    r"|(?P<zhnote>[（(\[【]注\s*(?P<znum>\d{1,3})[）)\]】])"
    r"|(?P<suppos>[¹²³⁴⁵⁶⁷⁸⁹][⁰¹²³⁴⁵⁶⁷⁸⁹]*)"
    r"|(?P<paren>\((?P<pnum>\d{1,2})\))"
)


def _iter_inline_refs(text: str):
    """按出现顺序迭代一段正文里的所有合法行内注脚标记。"""
    for m in INLINE_REF_RE.finditer(text):
        s, e = m.start(), m.end()
        if m.group("circle"):
            yield s, e, "circle", CIRCLED_MAP[m.group("circle")], m.group("circle")
        elif m.group("tortoise"):
            yield s, e, "tortoise", m.group("tnum"), m.group("tortoise")
        elif m.group("bracket"):
            # 跳过加粗页码 **[13]**
            if s >= 2 and text[s - 2:s] == "**" and text[e:e + 2] == "**":
                continue
            yield s, e, "bracket", m.group("bnum"), m.group("bracket")
        elif m.group("zhnote"):
            yield s, e, "bracket", m.group("znum"), m.group("zhnote")
        elif m.group("suppos"):
            sup_str = m.group("suppos")
            prev = text[s - 1] if s > 0 else ""
            prev2 = text[s - 2] if s > 1 else ""
            # 仅排除孤立数学幂 x²/y³/z²，保留 1972⁸ / Lacan¹ / reason³
            if sup_str in ("²", "³") and prev in "xyzXYZ" and not prev2.isalpha():
                continue
            num = _decode_sup(sup_str)
            if num:
                yield s, e, "sup", num, sup_str
        elif m.group("paren"):
            # 半角 (1) 仅当非行首且前文不是年份/公式时作为候选（仅在能匹配到 paren 定义块时生效）
            if s == 0:
                continue
            yield s, e, "paren", m.group("pnum"), m.group("paren")


# 纯数字行内注码（OCR 常把上标注码压成普通数字）：仅当该数字紧贴中文/标点、
# 且其后是标点或空白时才视为候选；年份、页码、章节号（第2章/20 节）不会命中。
PLAIN_REF_RE = re.compile(
    r"(?<=[\u4e00-\u9fff，。；：！？、）」』”’\"\)\?\!])(\d{1,3})(?=[。，、；：！？（(\s—\-]|$)"
)
ROMAN_REF_RE = re.compile(
    r"(?<=[\u4e00-\u9fff」》”’）)\]。，；！？a-zA-Z.\d])(?<![A-Z])([IVXLCDM]{1,10})(?![A-Za-z/])(?=[\u4e00-\u9fff。，、；：！？「《“‘（(\s\[]|$)"
)


def _iter_refs_with_plain(text: str, allowed_nums: set):
    """在常规标记之外，补充“纯数字/罗马数字注码”，但只接受本章/本组注文里真实存在的号。"""
    items = list(_iter_inline_refs(text))
    for m in PLAIN_REF_RE.finditer(text):
        num = m.group(1)
        if num not in allowed_nums:
            continue
        s, e = m.start(), m.end()
        if any(not (e <= a or s >= b) for a, b, _k, _n, _r in items):
            continue
        items.append((s, e, "plain", num, m.group(0)))
    if any(x.isalpha() and x.isupper() for x in allowed_nums):
        for m in ROMAN_REF_RE.finditer(text):
            rm = m.group(1)
            if rm not in allowed_nums or not _is_valid_roman(rm):
                continue
            s, e = m.start(), m.end()
            if rm == "I" and s > 0 and text[s - 1].isascii() and not text[s - 1] in ".":
                continue
            if any(not (e <= a or s >= b) for a, b, _k, _n, _r in items):
                continue
            items.append((s, e, "roman", rm, rm))
    items.sort(key=lambda x: x[0])
    return items


SECTION_LABEL_RE = re.compile(
    r"^(?:前言|序言|导言|导论|编者导论|总导论|导言注释|作者序|译者说明|克拉拉／导论|"
    r"第[一二三四五六七八九十百\d]+[讲章节部卷篇](?:[：:\s\u3000].{0,40})?|"
    r"(?:卡桑篇|巴迪欧篇|费希特文本|谢林文本|费希特—谢林通信).*|"
    r"〈[^〉]{2,40}〉)$"
)


def _merge_continuation_blocks(blocks: list, defs_by_idx: dict, merge_all_prose: bool = False) -> set:
    """合并被 OCR 断行或多段排版的脚注续接段，返回已被吸收的续接块索引集合。"""
    absorbed = set()
    n = len(blocks)
    for idx in sorted(defs_by_idx.keys()):
        if idx in absorbed:
            continue
        d = defs_by_idx[idx]
        cur = idx + 1
        while cur < n:
            if cur in defs_by_idx or cur in absorbed:
                break
            nb = blocks[cur]
            if nb.get("y") not in (("p", "q", "l") if merge_all_prose else ("p",)):
                break
            nt = (nb.get("t") or "").strip()
            if not nt or nt.startswith("【译注】") or NOTE_HEADER_RE.match(nt):
                break
            if merge_all_prose and len(nt) <= 36 and SECTION_LABEL_RE.match(nt):
                break
            prev_t = d["text"].strip()
            if merge_all_prose:
                joiner = " " if (prev_t and prev_t[-1].isascii() and nt[0].isascii()) else ""
                sep = joiner if not prev_t.endswith(("。", "！", "？", ".", "!", "?", "”", "』", "」", "】", "）", ")")) else "\n"
                d["text"] = prev_t + sep + nt
                d.setdefault("cont_indices", []).append(cur)
                absorbed.add(cur)
                cur += 1
                continue
            prev_incomplete = not prev_t.endswith(("。", "！", "？", ".", "!", "?", "”", "』", "」", "】", "）", ")"))
            next_is_cont = (
                len(nt) <= 280
                and (
                    prev_incomplete
                    or re.match(r"^(?:[）)\]”’。，、；：]|文有改动|版[，,。]|第\s*\d+\s*页|（\d{4}年）|[a-z]|Zwanzig|Suhrkamp|Verlag|Press)", nt)
                )
            )
            # 若下一段之后紧跟另一个脚注定义，或前段明显未完句且本段明显是续接片段，合并！
            nxt_is_def = (cur + 1) in defs_by_idx
            if next_is_cont and (prev_incomplete or nxt_is_def):
                joiner = " " if (prev_t and prev_t[-1].isascii() and nt[0].isascii()) else ""
                d["text"] = prev_t + joiner + nt
                d.setdefault("cont_indices", []).append(cur)
                absorbed.add(cur)
                cur += 1
                if not d["text"].strip().endswith(("。", "！", "？", ".", "!", "?", "”", "』", "」", "】", "）", ")")):
                    continue
                break
            else:
                break
    return absorbed


def _split_packed_footnote_blocks(blocks: list, in_notes_ch: bool = False) -> list:
    """将挤在同一自然段内的多条连续脚注（如 `10 拉松...`、`56 ... 57 ...`、`1. ... 87. ... 88.`、`[71] ... [72] ...`）拆分为独立候选块。"""
    def _split_monotonic_seq(raw_str: str, pat: re.Pattern, num_pat: re.Pattern) -> list[str] | None:
        splits = [0]
        m0 = num_pat.match(raw_str)
        if not m0:
            return None
        last_n = int(m0.group(1))
        matches = list(pat.finditer(raw_str))
        for mi, m in enumerate(matches):
            nxt_n = int(m.group(1))
            if last_n < nxt_n <= last_n + 6:
                splits.append(m.start())
                last_n = nxt_n
            elif len(splits) == 1 and mi + 1 < len(matches):
                # 允许首条重编（如 3. -> 87. -> 88.），只要后续紧跟至少一次 +1..+6 单调递进
                after_n = int(matches[mi + 1].group(1))
                if nxt_n < after_n <= nxt_n + 6:
                    splits.append(m.start())
                    last_n = nxt_n
        if len(splits) < 2:
            return None
        splits.append(len(raw_str))
        parts = [raw_str[splits[k]:splits[k + 1]].strip() for k in range(len(splits) - 1)]
        return [p for p in parts if p]

    out = []
    for blk in blocks:
        if blk.get("y") not in ("p", "q", "l"):
            out.append(blk)
            continue
        raw = (blk.get("t") or "").strip()
        # 情况 A: 行首是 `[N] ...` 且段内含多个 ` [M] `
        if re.match(r"^\[\d{1,3}\]\s*", raw) and len(re.findall(r"(?:^|\s)\[\d{1,3}\]\s*", raw)) >= 2:
            parts = re.split(r"(?<=[。.”’）).!?])\s*(?=\[\d{1,3}\]\s*\S)", raw)
            if len(parts) >= 2:
                for p in parts:
                    if p.strip():
                        out.append({"y": blk["y"], "t": p.strip()})
                continue
        # 情况 B: Pandoc `N. ... M. ...` 挤在同一列表段（如《费希特与谢林》《艺术哲学》《谢林的有机形式哲学》）
        if re.match(r"^\d{1,3}\.\s+\S", raw):
            parts = _split_monotonic_seq(
                raw,
                re.compile(r"(?:(?<=[。.”’）)》」』])\s*|(?<=[\.\!\?])\s+)(\d{1,3})\.\s+(?=[^\d\s])"),
                re.compile(r"^(\d{1,3})\.\s+"),
            )
            if parts:
                for p in parts:
                    out.append({"y": blk["y"], "t": p})
                continue
        # 情况 B2: 专门“注释”章内，前一条注文的续段尾部粘连了下一条 `38. ...`
        if in_notes_ch and not re.match(r"^\d{1,3}\.\s+", raw):
            parts = re.split(r"(?:(?<=[。.”’）)》」』])\s*|(?<=[\.\!\?])\s+)(?=\d{1,3}\.\s+(?:[^\d\s]|(?:见|参|同上|[A-Z])))", raw)
            if len(parts) >= 2:
                for p in parts:
                    if p.strip():
                        out.append({"y": blk["y"], "t": p.strip()})
                continue
        # 情况 C: `N <非数字>` 挤在同一自然段（如《判断力批判》编辑说明 56..94 / `同上书...`）
        if re.match(r"^\d{1,3}[\s\u3000]+[^\d\s]", raw) and len(raw) <= 4500:
            parts = _split_monotonic_seq(
                raw,
                re.compile(r"(?<=[。.”’）).!?])\s*(?!(?:1[0-9]|2[0-9]|3[0-1])(?:年|月|日|世纪))(\d{1,3})[\s\u3000]+(?=(?!世纪|年代|年|月|日)[^\d\s])"),
                re.compile(r"^(\d{1,3})[\s\u3000]+"),
            )
            if parts:
                for p in parts:
                    out.append({"y": blk["y"], "t": p})
                continue
        # 情况 D: 圆圈编号 ①... ②... 挤在同一自然段
        if re.match(rf"^[{CIRCLED_CHARS}]", raw) and len(re.findall(rf"[{CIRCLED_CHARS}]", raw)) >= 2:
            parts = re.split(rf"(?<=[。.”’）)!?])\s*(?=[{CIRCLED_CHARS}]\s*\S)", raw)
            if len(parts) >= 2:
                for p in parts:
                    if p.strip():
                        out.append({"y": blk["y"], "t": p.strip()})
                continue
        out.append(blk)
    return out


def fold_footnotes_in_block_list(
    blocks: list,
    is_dedicated_notes_ch: bool = False,
    dsh_fold_map: dict | None = None,
    allow_fallback: bool = True,
) -> tuple[list, dict]:
    """
    对单个（尚未拆分为续2/续3的）完整章节块列表执行注脚收纳。
    返回 (清理后的 blocks, stats)。
    """
    if not blocks:
        return blocks, {"folded": 0, "bound": 0, "gloss": 0}

    blocks = _split_packed_footnote_blocks(blocks)
    dsh_fold_map = dsh_fold_map or {}
    hidden = set()
    stats = {"folded": 0, "bound": 0, "gloss": 0}

    # 清理纯孤立的单个圆圈数字噪声行（如《哲学导论》孤立一行 `①`）
    for idx, blk in enumerate(blocks):
        if blk.get("y") == "p" and re.match(rf"^[{CIRCLED_CHARS}]+$", (blk.get("t") or "").strip()):
            hidden.add(idx)

    # Step 1: 识别所有【译注】块，直接收纳到紧邻前一段末尾的“译注”注脚
    for idx, blk in enumerate(blocks):
        t = (blk.get("t") or "").strip()
        if t.startswith("【译注】"):
            gloss = t[4:].strip()
            if not gloss:
                hidden.add(idx)
                continue
            target = None
            for p in range(idx - 1, -1, -1):
                if p in hidden or blocks[p].get("y") == "r":
                    continue
                if (blocks[p].get("t") or "").strip().startswith("【译注】"):
                    continue
                target = p
                break
            if target is not None:
                fi = _add_fn_to_block(blocks[target], "译注", "gloss", gloss)
                blocks[target]["t"] = blocks[target]["t"].rstrip() + f"⟦fn:{fi}⟧"
                hidden.add(idx)
                stats["gloss"] += 1
                stats["folded"] += 1

    # 专门“注释”章或跨章尾注集群：只做章内精确配对，绝不把未绑定注释
    # 兜底塞进本章第一段（那会把上一章的注文错误地挂到本章开头）。
    skip_fallback = is_dedicated_notes_ch or not allow_fallback

    # Step 2: 收集全部候选脚注定义块 + 合并断行续接段
    defs_by_idx = {}
    for idx, blk in enumerate(blocks):
        if idx in hidden:
            continue
        parsed = parse_footnote_def(blk)
        if parsed:
            parsed["idx"] = idx
            parsed["cont_indices"] = []
            defs_by_idx[idx] = parsed

    cont_absorbed = _merge_continuation_blocks(blocks, defs_by_idx)
    def_nums = set()
    for _d in defs_by_idx.values():
        def_nums.update(_d["nums"])

    # 按出现顺序排列的候选定义列表，支持单调消耗（解决同段/同章多页重复 ①②③！）
    def_indices_sorted = sorted(defs_by_idx.keys())
    used_def_keys = set()  # (def_idx, num) 已消费记录，但若为组合注 ①② 允许分别匹配 1 和 2
    bound_def_indices = set()

    def find_next_def(body_idx: int, ref_kind: str, num: str):
        # 1) 优先向后寻找最近的、尚未被本号消费的同型/兼容定义块
        best_any = None
        for di in def_indices_sorted:
            if di <= body_idx:
                continue
            d = defs_by_idx[di]
            if num not in d["nums"]:
                continue
            if (di, num) in used_def_keys:
                continue
            if not _is_compatible(ref_kind, d["kind"]):
                continue
            if d["kind"] == ref_kind:
                return d
            if best_any is None:
                best_any = d
        if best_any is not None:
            return best_any
        # 2) 允许极近前向回溯（最多前 3 段，防止 OCR 页脚微错位）
        for di in reversed(def_indices_sorted):
            if di >= body_idx:
                continue
            if body_idx - di > 3:
                break
            d = defs_by_idx[di]
            if num not in d["nums"] or (di, num) in used_def_keys:
                continue
            if _is_compatible(ref_kind, d["kind"]):
                return d
        return None

    # 记录本章出现过的全部标记号，供 Step 4a 判断“圆圈编号是否真是注脚”
    chapter_ref_nums = set()
    for _b in blocks:
        for _s, _e, _k, _n, _r in _iter_refs_with_plain(_b.get("t") or "", def_nums):
            chapter_ref_nums.add(_n)

    # Step 3: 逐段逐处按序替换正文里的全部行内注脚标号 -> ⟦fn:i⟧
    for idx, blk in enumerate(blocks):
        if idx in hidden or idx in defs_by_idx or idx in cont_absorbed:
            continue
        if blk.get("y") in ("r", "t", "h"):
            continue
        text = blk.get("t") or ""
        if not text:
            continue

        replacements = []  # (start, end, token_str)
        for s, e, ref_kind, num, raw_tok in _iter_refs_with_plain(text, def_nums):
            d = find_next_def(idx, ref_kind, num)
            if d is None:
                continue
            used_def_keys.add((d["idx"], num))
            bound_def_indices.add(d["idx"])
            hidden.add(d["idx"])
            for ci in d["cont_indices"]:
                hidden.add(ci)
            fi = _add_fn_to_block(blk, num, "fn", d["text"])
            replacements.append((s, e, f"⟦fn:{fi}⟧"))
            stats["bound"] += 1

        if replacements:
            # 从后往前替换，保持偏移精准
            new_t = text
            for s, e, rep in reversed(replacements):
                new_t = new_t[:s] + rep + new_t[e:]
            blk["t"] = new_t

    # Step 3b: 最近邻反向绑定 —— 处理“页底注文排在正文标记之前”或
    # “标记与定义相隔较远”的 OCR 版式。只在非注释章执行；注释章留给跨章 Pass 2。
    if not skip_fallback:
        pending_refs = []
        for idx, blk in enumerate(blocks):
            if idx in hidden or idx in defs_by_idx or idx in cont_absorbed:
                continue
            if blk.get("y") in ("r", "t", "h"):
                continue
            text = blk.get("t") or ""
            for s, e, ref_kind, num, raw_tok in _iter_refs_with_plain(text, def_nums):
                pending_refs.append({"bi": idx, "s": s, "e": e, "kind": ref_kind, "num": num})
        if pending_refs:
            used_refs = set()
            repl_by_block = {}
            for di in def_indices_sorted:
                if di in bound_def_indices or di in hidden:
                    continue
                d = defs_by_idx[di]
                best = None
                best_key = None
                for ri, rr in enumerate(pending_refs):
                    if ri in used_refs or rr["num"] not in d["nums"]:
                        continue
                    if not _is_compatible(rr["kind"], d["kind"]):
                        continue
                    dist = abs(rr["bi"] - di)
                    # 同距离时优先取定义之前的标记（页底注文通常注释本页正文）
                    key = (dist, 0 if rr["bi"] < di else 1, rr["bi"])
                    if best_key is None or key < best_key:
                        best_key = key
                        best = (ri, rr)
                if best is None:
                    continue
                ri, rr = best
                used_refs.add(ri)
                used_def_keys.add((di, rr["num"]))
                bound_def_indices.add(di)
                hidden.add(di)
                for ci in d["cont_indices"]:
                    hidden.add(ci)
                fi = _add_fn_to_block(blocks[rr["bi"]], rr["num"], "fn", d["text"])
                repl_by_block.setdefault(rr["bi"], []).append((rr["s"], rr["e"], f"⟦fn:{fi}⟧"))
                stats["bound"] += 1
            for bi, reps in repl_by_block.items():
                text = blocks[bi].get("t") or ""
                for s, e, rep in sorted(reps, key=lambda x: x[0], reverse=True):
                    text = text[:s] + rep + text[e:]
                blocks[bi]["t"] = text

    if skip_fallback:
        stats["folded"] = len(hidden)
        out = [b for i, b in enumerate(blocks) if i not in hidden]
        return out, stats

    # Step 4: 兜底收纳明显的未匹配页底脚注 / OCR 丢失角标的注脚（含 ® 替换、裸文献注、显式注、DSH 审查清单）
    # 硬性限制每段最多吸收 2 条未配对兜底注文，严禁把未拆/未绑尾注集群倾倒到同一段落形成堆叠！
    fallback_hits = {}

    def _can_take_fb(blk: dict) -> bool:
        if blk.get("_fb", 0) >= 2:
            return False
        bt = (blk.get("t") or "").strip()
        if re.search(r"(?:⟦fn:\d+⟧\s*){2,}$", bt):
            return False
        return True

    def find_prev_visible_body(pos_idx: int) -> int | None:
        for p in range(pos_idx - 1, -1, -1):
            if p in hidden or p in defs_by_idx or p in cont_absorbed:
                continue
            pt = (blocks[p].get("t") or "").strip()
            if NOTE_HEADER_RE.match(pt):
                continue  # 跳过“注释：”分隔标题，继续向上找到它所注释的正文段！
            if blocks[p].get("y") in ("r", "h"):
                break
            if len(pt) >= 12 and _can_take_fb(blocks[p]):
                return p
        return None

    # 4a) 对未绑定的明确脚注（circle / sup / explicit / 带引文或译者注特征的 bracket / tortoise / paren / numspace）
    for di in def_indices_sorted:
        if di in bound_def_indices or di in hidden:
            continue
        d = defs_by_idx[di]
        kind = d["kind"]
        note_txt = d["text"]
        # 严格防误伤：绝不误吞《克拉拉》[3] 或《神话哲学》〔208〕等德文边码正文段，也不误吞普通列表 1. / (1)
        is_explicit_note = (
            kind in ("circle", "sup", "explicit")
            and (
                CITATION_HINT_RE.search(note_txt)
                or len(note_txt) <= 240
                # 圆圈编号若在本章正文里确实作为标记出现过，即使注文较长也按注脚收纳
                or (kind == "circle" and di > 0 and any(n in chapter_ref_nums for n in d["nums"]))
            )
        )
        is_citation_bracket = (
            kind in ("bracket", "tortoise", "paren", "numspace")
            and CITATION_HINT_RE.search(note_txt)
            and len(note_txt) <= 450
            and not re.match(r"^(?:第一章|第二章|第一|第二|一、|二、)", note_txt)
        )
        if not (is_explicit_note or is_citation_bracket):
            continue

        prev_b = find_prev_visible_body(di)
        if prev_b is None:
            continue
        if blocks[prev_b].get("_fb", 0) >= 2:
            continue
        blocks[prev_b]["_fb"] = blocks[prev_b].get("_fb", 0) + 1

        label = "/".join(d["nums"])
        fi = _add_fn_to_block(blocks[prev_b], label, "fn", note_txt)
        # 若前一段里正好有 OCR 把 ① 误识成的 ®，原地替换！
        if "®" in blocks[prev_b]["t"]:
            blocks[prev_b]["t"] = blocks[prev_b]["t"].replace("®", f"⟦fn:{fi}⟧", 1)
        else:
            blocks[prev_b]["t"] = blocks[prev_b]["t"].rstrip() + f"⟦fn:{fi}⟧"
        bound_def_indices.add(di)
        hidden.add(di)
        for ci in d["cont_indices"]:
            hidden.add(ci)
        stats["bound"] += 1

    # 4b) 裸页底文献注（OCR 漏掉行首 ① 的纯引文行）+ DSH 4.1 Flash 逐条核查确认的冗余注释块
    for idx, blk in enumerate(blocks):
        if idx in hidden or blk.get("y") not in ("p", "q", "l"):
            continue
        raw = (blk.get("t") or "").strip()
        if not raw:
            continue
        bkey = _block_key(raw)
        dsh_entry = dsh_fold_map.get(bkey)

        should_fold = False
        label = "注"
        note_txt = raw
        if dsh_entry and isinstance(dsh_entry, dict) and dsh_entry.get("fold"):
            should_fold = True
            label = str(dsh_entry.get("label") or "注")
            note_txt = str(dsh_entry.get("text") or raw).strip()
        elif len(raw) <= 220 and BARE_CITATION_RE.match(raw) and CITATION_HINT_RE.search(raw):
            should_fold = True
        elif len(raw) <= 260 and re.search(r"——\s*(?:译者注?|编者注?|校者注?|原注|译注)\s*[。.]?$", raw):
            # 独立的短“……——译者注”段落（不是整段正文）
            if not re.match(r"^[「“《（(]", raw) or len(raw) <= 140:
                should_fold = True
                label = "译注" if "译" in raw[-8:] else "注"

        if should_fold:
            prev_b = find_prev_visible_body(idx)
            if prev_b is not None and blocks[prev_b].get("_fb", 0) < 2:
                blocks[prev_b]["_fb"] = blocks[prev_b].get("_fb", 0) + 1
                fi = _add_fn_to_block(blocks[prev_b], label, "fn", note_txt)
                blocks[prev_b]["t"] = blocks[prev_b]["t"].rstrip() + f"⟦fn:{fi}⟧"
                hidden.add(idx)
                stats["bound"] += 1

    # Step 5: 清除下方注释已被全部隐藏的孤立“注释 / 注释：”标题块
    for idx, blk in enumerate(blocks):
        if idx in hidden:
            continue
        if not NOTE_HEADER_RE.match((blk.get("t") or "").strip()):
            continue
        saw_hidden = False
        saw_visible = False
        for j in range(idx + 1, len(blocks)):
            if blocks[j].get("y") == "h" and not NOTE_HEADER_RE.match((blocks[j].get("t") or "").strip()):
                break
            if blocks[j].get("y") == "r":
                continue
            if j in hidden:
                saw_hidden = True
            else:
                saw_visible = True
                break
        if saw_hidden and not saw_visible:
            hidden.add(idx)

    stats["folded"] = len(hidden)
    out = [b for i, b in enumerate(blocks) if i not in hidden]
    return out, stats


def fold_cross_chapter_notes(chapters: list, is_reference_book: bool = False) -> tuple[list, dict]:
    """
    全书级注脚收纳总入口（在 build_library.py 切分 MAX_CHAPTER_CHARS 之前调用！）：
      1. 先在每一章内部执行 fold_footnotes_in_block_list（含多页重复 ①②③、断行续接、译注、DSH清单）；
      2. 再执行跨章尾注/“注释”章收纳：
         - 若第 k 章是专门的“注释 / 译者注”章（或第 k 章末尾残留未绑定的 [1]..[130] 尾注集群，如《法哲学原理》的（七）、《哲学史讲演录》的丙节），
           将其中能与前面正文各章（第 k-1 章或同组前若干章）的行内标号精确配对的注释，直接绑定到正文对应句中并从尾注中删除！
         - 若整个“注释”章的注释已全部吸收完毕，直接从目录中移除空“注释”章！
    """
    if is_reference_book or not chapters:
        return chapters, {"folded": 0, "bound": 0, "gloss": 0, "cross_bound": 0, "pruned_note_chs": 0}

    dsh_fold_map = _load_dsh_fold_map()
    totals = {"folded": 0, "bound": 0, "gloss": 0, "cross_bound": 0, "pruned_note_chs": 0}

    # Pass 1: 章节内部收纳
    for ch in chapters:
        is_notes_ch = bool(NOTES_CHAPTER_TITLE_RE.match(ch["title"].strip()))
        # 预扫描：判断本章是否是“注释集群”（注释章 / 注释标题后的尾注 / 多条定义集中在章尾但正文标记很少）。
        # 这类章必须保留未绑定定义，交给 Pass 2 跨章精确配对；否则兜底逻辑会把
        # 尾注全部错误地塞进章内前一段，造成堆叠和错挂。
        blks_scan = _split_packed_footnote_blocks(ch["blocks"])
        defs_n = 0
        local_refs = 0
        first_def = None
        def_idxs = set()
        for bi, b in enumerate(blks_scan):
            d = parse_footnote_def(b)
            if d:
                defs_n += 1
                def_idxs.add(bi)
                if first_def is None:
                    first_def = bi
            else:
                local_refs += sum(1 for _ in _iter_inline_refs(b.get("t") or ""))
        tail_defs = 0
        non_def_gap = 0
        for bi in range(len(blks_scan) - 1, -1, -1):
            if bi in def_idxs:
                tail_defs += 1
                non_def_gap = 0
            elif blks_scan[bi].get("y") == "r" or NOTE_HEADER_RE.match((blks_scan[bi].get("t") or "").strip()):
                continue
            elif non_def_gap < 2 and len((blks_scan[bi].get("t") or "").strip()) < 220:
                non_def_gap += 1
            else:
                break
        has_note_header = False
        if first_def is not None:
            has_note_header = any(
                NOTE_HEADER_RE.match((b.get("t") or "").strip())
                for b in blks_scan[:first_def]
            )
        cluster = (
            defs_n >= 3
            and local_refs < defs_n
            and first_def is not None
            and (tail_defs >= 3 or first_def >= len(blks_scan) * 0.5 or (has_note_header and first_def >= len(blks_scan) * 0.35))
        )
        allow_fallback = not (is_notes_ch or cluster)
        new_blks, st = fold_footnotes_in_block_list(
            ch["blocks"],
            is_dedicated_notes_ch=is_notes_ch,
            dsh_fold_map=dsh_fold_map,
            allow_fallback=allow_fallback,
        )
        ch["blocks"] = new_blks
        totals["folded"] += st["folded"]
        totals["bound"] += st["bound"]
        totals["gloss"] += st["gloss"]

    # Pass 2: 跨章收纳（专门的“注释”章 + 含跨节尾注集群的章，如《法哲学原理》第33节/（七）、《哲学史讲演录》各节、《黑格尔论宗教与政治》各章注释）
    pruned_ch_indices = set()
    prev_cluster_end = 0
    for ch_idx, ch in enumerate(chapters):
        if ch_idx == 0:
            continue
        is_notes_ch = bool(NOTES_CHAPTER_TITLE_RE.match(ch["title"].strip()))
        blks = _split_packed_footnote_blocks(ch["blocks"], in_notes_ch=is_notes_ch)
        ch["blocks"] = blks
        defs_by_idx = {}
        for bi, blk in enumerate(blks):
            d = parse_footnote_def(blk)
            if d:
                d["idx"] = bi
                d["cont_indices"] = []
                defs_by_idx[bi] = d
        if not defs_by_idx:
            continue
        # 非专门“注释”章仅在章内含 >= 2 条未绑定尾注集群时尝试向前面同组章节回溯绑定
        if not is_notes_ch and len(defs_by_idx) < 2:
            continue

        cont_absorbed = _merge_continuation_blocks(blks, defs_by_idx, merge_all_prose=is_notes_ch)

        # 确定向前扫描的正文范围：专门“注释”章回溯到上一个注释章之后；
        # 非专门尾注集群章（如《哲学史讲演录》每大节末尾）回溯到上一个尾注集群或注释章之后，最多 45 章。
        prev_notes_boundary = 0
        for prev_i in range(ch_idx - 1, -1, -1):
            if NOTES_CHAPTER_TITLE_RE.match(chapters[prev_i]["title"].strip()):
                prev_notes_boundary = prev_i + 1
                break
        cluster_boundary = prev_notes_boundary if is_notes_ch else max(prev_notes_boundary, prev_cluster_end, ch_idx - 45)

        # 将本章内的定义按子节标题 / 编号重置（1 / I）拆分为顺序“分桶”，
        # 确保《巴迪欧与卡桑》《艺术哲学》《神话哲学》《费希特与谢林》《判断力批判》各分节 1..N 各自精确对应自身正文章节！
        buckets = []  # [{"hint": str|None, "dis": [di...], "label_idxs": [bi...]}]
        cur_hint = None
        cur_dis = []
        cur_labels = []
        for bi in range(len(blks)):
            blk = blks[bi]
            bt = (blk.get("t") or "").strip()
            if blk.get("y") == "h" and not NOTE_HEADER_RE.match(bt):
                if cur_dis:
                    buckets.append({"hint": cur_hint, "dis": cur_dis, "label_idxs": cur_labels})
                    cur_dis, cur_labels = [], []
                cur_hint = bt
                cur_labels.append(bi)
                continue
            if bi not in defs_by_idx and bi not in cont_absorbed and blk.get("y") in ("p", "l") and len(bt) <= 36 and SECTION_LABEL_RE.match(bt):
                if cur_dis:
                    buckets.append({"hint": cur_hint, "dis": cur_dis, "label_idxs": cur_labels})
                    cur_dis, cur_labels = [], []
                cur_hint = bt
                cur_labels.append(bi)
                continue
            if bi in defs_by_idx:
                n0 = defs_by_idx[bi]["nums"][0]
                has_ge2 = any(defs_by_idx[x]["nums"][0] not in ("1", "I") for x in cur_dis)
                if cur_dis and n0 in ("1", "I") and has_ge2:
                    buckets.append({"hint": cur_hint, "dis": cur_dis, "label_idxs": cur_labels})
                    cur_dis, cur_labels = [], []
                cur_dis.append(bi)
        if cur_dis or cur_labels:
            buckets.append({"hint": cur_hint, "dis": cur_dis, "label_idxs": cur_labels})

        def _bind_bucket(dis_list: list, start_c: int, end_c: int, used_di: set, used_pairs: set, sequential: bool = False) -> int:
            b_defs_by_num = {}
            for di in sorted(dis_list):
                d = defs_by_idx[di]
                for num in d["nums"]:
                    b_defs_by_num.setdefault(num, []).append(d)
            b_allowed = set(b_defs_by_num)
            if not b_allowed:
                return start_c

            max_hit_c = start_c
            if not sequential:
                for ci in range(start_c, end_c):
                    if ci in pruned_ch_indices or NOTES_CHAPTER_TITLE_RE.match(chapters[ci]["title"].strip()):
                        continue
                    for bi, b in enumerate(chapters[ci]["blocks"]):
                        if ci == ch_idx and (bi in defs_by_idx or bi in cont_absorbed):
                            continue
                        if b.get("y") in ("r", "t") or parse_footnote_def(b):
                            continue
                        txt = b.get("t") or ""
                        if not txt:
                            continue
                        reps = []
                        for s, e, ref_kind, num, _raw in _iter_refs_with_plain(txt, b_allowed):
                            cands = b_defs_by_num.get(num)
                            if not cands:
                                continue
                            picked = None
                            for cand in cands:
                                if (cand["idx"], num) in used_pairs:
                                    continue
                                if _is_compatible(ref_kind, cand["kind"]):
                                    picked = cand
                                    break
                            if picked is None:
                                continue
                            used_pairs.add((picked["idx"], num))
                            used_di.add(picked["idx"])
                            fi = _add_fn_to_block(b, num, "fn", picked["text"])
                            reps.append((s, e, f"⟦fn:{fi}⟧"))
                            totals["cross_bound"] += 1
                            if ci > max_hit_c:
                                max_hit_c = ci
                        if reps:
                            new_t = txt
                            for s, e, rep in reversed(reps):
                                new_t = new_t[:s] + rep + new_t[e:]
                            b["t"] = new_t
            else:
                refs = []
                for ci in range(start_c, end_c):
                    if ci in pruned_ch_indices or NOTES_CHAPTER_TITLE_RE.match(chapters[ci]["title"].strip()):
                        continue
                    for bi, b in enumerate(chapters[ci]["blocks"]):
                        if ci == ch_idx and (bi in defs_by_idx or bi in cont_absorbed):
                            continue
                        if b.get("y") in ("r", "t") or parse_footnote_def(b):
                            continue
                        txt = b.get("t") or ""
                        if not txt:
                            continue
                        for s, e, ref_kind, num, _raw in _iter_refs_with_plain(txt, b_allowed):
                            refs.append((ci, b, s, e, ref_kind, num))
                pending = []
                cursor = 0
                used_ri = set()
                for di in sorted(dis_list):
                    if di in used_di:
                        continue
                    d = defs_by_idx[di]
                    picked = None
                    for ri in range(cursor, len(refs)):
                        if ri in used_ri:
                            continue
                        ci, b, s, e, ref_kind, num = refs[ri]
                        if num not in d["nums"] or (di, num) in used_pairs:
                            continue
                        if not _is_compatible(ref_kind, d["kind"]):
                            continue
                        picked = (ri, ci, b, s, e, num)
                        break
                    if picked is None:
                        for ri, (ci, b, s, e, ref_kind, num) in enumerate(refs):
                            if ri in used_ri:
                                continue
                            if num not in d["nums"] or (di, num) in used_pairs:
                                continue
                            if not _is_compatible(ref_kind, d["kind"]):
                                continue
                            picked = (ri, ci, b, s, e, num)
                            break
                    if picked is None:
                        continue
                    ri, ci, b, s, e, num = picked
                    used_ri.add(ri)
                    used_pairs.add((di, num))
                    used_di.add(di)
                    fi = _add_fn_to_block(b, num, "fn", d["text"])
                    pending.append((b, s, e, fi))
                    totals["cross_bound"] += 1
                    cursor = ri + 1
                    if ci > max_hit_c:
                        max_hit_c = ci
                by_block = {}
                for b, s, e, fi in pending:
                    by_block.setdefault(id(b), (b, []))[1].append((s, e, fi))
                for b, reps in by_block.values():
                    t = b["t"]
                    for s, e, fi in sorted(reps, reverse=True):
                        t = t[:s] + f"⟦fn:{fi}⟧" + t[e:]
                    b["t"] = t
            return max_hit_c

        bound_dis = set()
        used_pairs = set()
        if len(buckets) <= 1:
            end_target = ch_idx if is_notes_ch else (ch_idx + 1)
            _bind_bucket(list(defs_by_idx.keys()), cluster_boundary, end_target, bound_dis, used_pairs, sequential=False)
            if is_notes_ch and len(bound_dis) < len(defs_by_idx):
                _bind_bucket(list(defs_by_idx.keys()), cluster_boundary, ch_idx, bound_dis, used_pairs, sequential=True)
            if len(bound_dis) < len(defs_by_idx) and cluster_boundary > prev_notes_boundary:
                _bind_bucket(list(defs_by_idx.keys()), prev_notes_boundary, cluster_boundary, bound_dis, used_pairs, sequential=False)
                if is_notes_ch and len(bound_dis) < len(defs_by_idx):
                    _bind_bucket(list(defs_by_idx.keys()), prev_notes_boundary, cluster_boundary, bound_dis, used_pairs, sequential=True)
        else:
            b_cursor = prev_notes_boundary
            for bk_i, bk in enumerate(buckets):
                if not bk["dis"]:
                    continue
                hint = bk["hint"] or ""
                h_core = re.sub(r"(?:注释|译者注|译注|〈|〉|《|》|\s)", "", hint)
                hint_c = None
                if len(h_core) >= 2:
                    for ci in range(b_cursor, ch_idx):
                        if ci in pruned_ch_indices or NOTES_CHAPTER_TITLE_RE.match(chapters[ci]["title"].strip()):
                            continue
                        ct = re.sub(r"[\s·《》〈〉]", "", chapters[ci]["title"])
                        if h_core in ct or ct in h_core:
                            hint_c = ci
                            break
                if hint_c is not None:
                    max_c = _bind_bucket(bk["dis"], hint_c, ch_idx, bound_dis, used_pairs, sequential=False)
                    if sum(1 for di in bk["dis"] if di not in bound_dis) > 0:
                        max_c = max(max_c, _bind_bucket(bk["dis"], hint_c, ch_idx, bound_dis, used_pairs, sequential=True))
                    # Only search earlier [b_cursor, hint_c) if leftovers remain and we haven't jumped past an earlier merged intro (like bucket 0)
                    if bk_i == 0 and hint_c > b_cursor and sum(1 for di in bk["dis"] if di not in bound_dis) > 0:
                        _bind_bucket(bk["dis"], b_cursor, hint_c, bound_dis, used_pairs, sequential=False)
                    b_cursor = max(b_cursor, hint_c, max_c)
                else:
                    max_c = _bind_bucket(bk["dis"], b_cursor, ch_idx, bound_dis, used_pairs, sequential=False)
                    if sum(1 for di in bk["dis"] if di not in bound_dis) > 0:
                        max_c = max(max_c, _bind_bucket(bk["dis"], b_cursor, ch_idx, bound_dis, used_pairs, sequential=True))
                    if max_c > b_cursor:
                        b_cursor = max_c
                    # Fallback within [prev_notes_boundary, ch_idx) ONLY when bucket had no matched hint_c!
                    if sum(1 for di in bk["dis"] if di not in bound_dis) > 0:
                        _bind_bucket(bk["dis"], prev_notes_boundary, ch_idx, bound_dis, used_pairs, sequential=True)

        if bound_dis:
            if not is_notes_ch:
                prev_cluster_end = ch_idx + 1
            to_drop = set(bound_dis)
            for di in bound_dis:
                for ci in defs_by_idx[di]["cont_indices"]:
                    to_drop.add(ci)
            # Clear empty section labels inside a notes chapter when their bucket's defs were all absorbed
            for bk in buckets:
                if bk["dis"] and all(di in bound_dis for di in bk["dis"]):
                    for li in bk["label_idxs"]:
                        to_drop.add(li)
            remaining = [b for bi, b in enumerate(blks) if bi not in to_drop]
            totals["folded"] += len(to_drop)
            rem_prose = [
                b for b in remaining
                if b.get("y") not in ("h", "r")
                and not NOTE_HEADER_RE.match((b.get("t") or "").strip())
                and not re.match(r"^原书注释按.*编次.*$", (b.get("t") or "").strip())
            ]
            if is_notes_ch and len(rem_prose) == 0:
                pruned_ch_indices.add(ch_idx)
                totals["pruned_note_chs"] += 1
            else:
                ch["blocks"] = remaining

    # Pass 3: 无标记孤儿注文兜底 —— 只收纳“明显是注文”的短定义（引文/同上/译者注），
    # 严禁根据“纯数字>=10在章后部”误吞编号圣经节/格言，并严格限制每段最多吸收 2 条防止堆叠！
    p3_hits = {}
    for ch_idx, ch in enumerate(chapters):
        if ch_idx in pruned_ch_indices:
            continue
        blks = ch["blocks"]
        defs_here = {}
        for bi, b in enumerate(blks):
            d = parse_footnote_def(b)
            if d:
                d["idx"] = bi
                d["cont_indices"] = []
                defs_here[bi] = d
        if not defs_here:
            continue
        is_notes_ch_p3 = bool(NOTES_CHAPTER_TITLE_RE.match(ch["title"].strip()))
        cont_absorbed = _merge_continuation_blocks(blks, defs_here, merge_all_prose=is_notes_ch_p3)

        def _can_take_fb2(blk: dict) -> bool:
            if blk.get("_fb", 0) >= 2:
                return False
            bt = (blk.get("t") or "").strip()
            if re.search(r"(?:⟦fn:\d+⟧\s*){2,}$", bt):
                return False
            return True

        def _prev_body_in_chapter(pos: int):
            for p in range(pos - 1, -1, -1):
                if p in defs_here or p in cont_absorbed:
                    continue
                if blks[p].get("y") in ("r", "t", "h"):
                    continue
                t = (blks[p].get("t") or "").strip()
                if NOTE_HEADER_RE.match(t):
                    continue
                if len(t) >= 12 and _can_take_fb2(blks[p]):
                    return blks[p]
            return None

        def _last_body_before_chapter(ci: int):
            for cj in range(ci - 1, -1, -1):
                if cj in pruned_ch_indices or NOTES_CHAPTER_TITLE_RE.match(chapters[cj]["title"].strip()):
                    continue
                for p in range(len(chapters[cj]["blocks"]) - 1, -1, -1):
                    b2 = chapters[cj]["blocks"][p]
                    if parse_footnote_def(b2):
                        continue
                    if b2.get("y") in ("r", "t", "h"):
                        continue
                    t = (b2.get("t") or "").strip()
                    if NOTE_HEADER_RE.match(t) or SECTION_LABEL_RE.match(t):
                        continue
                    if len(t) >= 12 and _can_take_fb2(b2):
                        return b2
            return None

        is_notes_ch_p3 = bool(NOTES_CHAPTER_TITLE_RE.match(ch["title"].strip()))
        to_drop = set()
        leading_def_run = True
        for bi, d in defs_here.items():
            if bi > 0:
                leading_def_run = all(
                    (p in defs_here) or (p in cont_absorbed)
                    or _is_note_header(blks[p].get("t") or "")
                    for p in range(bi)
                )
            else:
                leading_def_run = True
            txt = d["text"].strip()
            if DEDICATION_RE.match(txt):
                continue
            note_like = (
                is_notes_ch_p3
                or bool(CITATION_HINT_RE.search(txt))
                or txt.startswith("同上")
                or "译者注" in txt[:12]
                or "原注" in txt[:12]
                or "编者注" in txt[:12]
            )
            if not note_like and len(defs_here) >= 1 and re.search(r"（续\s*\d+）$", ch["title"].strip()):
                if not re.match(r"^[（(]\d+[）)]", txt):
                    if bi <= 2 or leading_def_run:
                        note_like = True
            if not note_like and bi >= len(blks) * 0.4 and len(txt) < 350 and re.search(r"[（(]\d{4}[）)]", txt):
                note_like = True
            if not note_like:
                after_note_header = any(
                    _is_note_header(blks[p].get("t") or "")
                    for p in range(max(0, bi - 3), bi)
                )
                if after_note_header:
                    note_like = True
            if not note_like:
                continue
            target = None if is_notes_ch_p3 else _prev_body_in_chapter(bi)
            if target is None:
                target = _last_body_before_chapter(ch_idx)
            if target is None:
                continue
            if target.get("_fb", 0) >= 2:
                continue
            target["_fb"] = target.get("_fb", 0) + 1
            label = "/".join(d["nums"])
            fi = _add_fn_to_block(target, label, "fn", txt)
            target["t"] = (target.get("t") or "").rstrip() + f"⟦fn:{fi}⟧"
            to_drop.add(bi)
            for ci in d.get("cont_indices", []):
                to_drop.add(ci)
            totals["bound"] += 1
        if to_drop or is_notes_ch_p3:
            remaining = [b for i, b in enumerate(blks) if i not in to_drop]
            totals["folded"] += len(to_drop)
            rem_prose = [
                b for b in remaining
                if b.get("y") not in ("h", "r")
                and not NOTE_HEADER_RE.match((b.get("t") or "").strip())
                and not (len((b.get("t") or "").strip()) <= 36 and SECTION_LABEL_RE.match((b.get("t") or "").strip()))
            ]
            if is_notes_ch_p3 and len(rem_prose) <= 1 and sum(len((b.get("t") or "").strip()) for b in rem_prose) <= 320:
                if len(rem_prose) == 1:
                    tb = _last_body_before_chapter(ch_idx)
                    if tb is not None:
                        fi = _add_fn_to_block(tb, "注", "fn", (rem_prose[0].get("t") or "").strip())
                        tb["t"] = (tb.get("t") or "").rstrip() + f"⟦fn:{fi}⟧"
                        totals["bound"] += 1
                        totals["folded"] += 1
                        rem_prose = []
            if is_notes_ch_p3 and len(rem_prose) == 0:
                pruned_ch_indices.add(ch_idx)
                totals["pruned_note_chs"] += 1
            else:
                ch["blocks"] = remaining

    final_chapters = [ch for i, ch in enumerate(chapters) if i not in pruned_ch_indices]
    for ch in final_chapters:
        blks = ch.get("blocks", [])
        for bi, b in enumerate(blks):
            b.pop("_fb", None)
            # 防止极个别行内注恰好插在兜底注前形成 >=3 连续尾注标记：将最后一条迁移至前文相邻段
            t = (b.get("t") or "").strip()
            m_tail = re.search(r"(?:⟦fn:(\d+)⟧\s*){3,}$", t)
            if m_tail and isinstance(b.get("f"), list) and len(b["f"]) >= 3:
                for prev_i in range(bi - 1, -1, -1):
                    pb = blks[prev_i]
                    if pb.get("y") in ("p", "q") and len((pb.get("t") or "").strip()) >= 12 and not re.search(r"(?:⟦fn:\d+⟧\s*){2,}$", (pb.get("t") or "").strip()):
                        m_last = re.search(r"⟦fn:(\d+)⟧\s*$", b["t"])
                        if m_last and 0 <= int(m_last.group(1)) < len(b["f"]):
                            rm_idx = int(m_last.group(1))
                            moved_fn = b["f"].pop(rm_idx)
                            new_bt = b["t"][:m_last.start()].rstrip()
                            new_bt = re.sub(
                                r"⟦fn:(\d+)⟧",
                                lambda mm: f"⟦fn:{int(mm.group(1)) - 1}⟧" if int(mm.group(1)) > rm_idx else mm.group(0),
                                new_bt,
                            )
                            b["t"] = new_bt
                            nfi = _add_fn_to_block(pb, moved_fn.get("l", "注"), moved_fn.get("k", "fn"), moved_fn.get("t", ""))
                            pb["t"] = (pb.get("t") or "").rstrip() + f"⟦fn:{nfi}⟧"
                        break
    return final_chapters, totals
