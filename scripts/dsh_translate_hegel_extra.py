#!/usr/bin/env python3
"""
dsh_translate_hegel_extra.py — 抽取两部完整英文黑格尔原著（《历史哲学》全本、《黑格尔论宗教与政治》全本），
按自然段落切片并交由 DSH (commandcode / deepseek/deepseek-v4.1-flash) 8 路并发新开对话逐段精译，
完成后自动校验完整度并输出至 extra-books/。
"""
import os
import re
import json
import time
import zipfile
import unicodedata
import subprocess
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import pymupdf

WORK_DIR = Path(r"D:\咕咕嘎嘎反重力\translation-work-hegel")
OUT_DIR = Path(r"D:\咕咕嘎嘎反重力\extra-books")
DSH_BIN = r"C:\dsh-remote\cli\node_modules\@deepseek-ai\dsh\lib\bin.js"
PATCH_FILE = r"D:\咕咕嘎嘎反重力\scripts\dsh_command_v41.yml"

HEGEL_GLOSSARY = """核心术语统一表（黑格尔历史哲学与宗教政治哲学）：
- Spirit / Geist -> 精神；World-Spirit / Weltgeist -> 世界精神；Absolute Spirit -> 绝对精神；Objective Spirit -> 客观精神
- Volksgeist / National Spirit -> 民族精神；Sittlichkeit / Ethical Life -> 伦理 / 伦理生活；Moralität / Morality -> 道德
- Aufhebung / Sublation -> 扬弃；Cunning of Reason / List der Vernunft -> 理性的狡计
- State -> 国家；Civil Society / bürgerliche Gesellschaft -> 市民社会；Freedom -> 自由；Necessity -> 必然性
- Reason -> 理性；Understanding -> 知性；Idea -> 理念；Notion / Concept -> 概念；Universal -> 普遍性；Particular -> 特殊性；Individual -> 个别性
- Providence -> 天意 / 神意；Theodicy -> 神义论；Reformation -> 宗教改革；Enlightenment -> 启蒙运动
- Substantiality -> 实体性；Subjectivity -> 主体性；Reconciliation / Versöhnung -> 和解；Alienation -> 异化
- Angelica Nuzzo -> 安杰莉卡·努佐；G. W. F. Hegel -> G. W. F. 黑格尔"""

LIGATURES = {
    "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl",
    "\ufb03": "ffi", "\ufb04": "ffl", "\ufb05": "ft", "\ufb06": "st",
}


def clean_en(text: str) -> str:
    out = []
    for ch in text:
        cp = ord(ch)
        if 0xF761 <= cp <= 0xF77A:
            out.append(chr(cp - 0xF761 + ord("a")))
        elif 0xF730 <= cp <= 0xF739:
            out.append(chr(cp - 0xF730 + ord("0")))
        elif ch in LIGATURES:
            out.append(LIGATURES[ch])
        elif 0xE000 <= cp <= 0xF8FF or cp == 0xFFFD or (cp < 32 and ch not in ("\n", "\r", "\t")):
            continue
        else:
            out.append(ch)
    return unicodedata.normalize("NFC", "".join(out))


class SimpleEpubParser(HTMLParser):
    SKIP = {"script", "style", "head", "title", "svg"}

    def __init__(self):
        super().__init__()
        self.blocks = []
        self.skip = 0
        self.tag = None
        self.buf = []

    def flush(self):
        txt = clean_en(re.sub(r"\s+", " ", "".join(self.buf)).strip())
        self.buf = []
        if not txt:
            return
        if self.tag in ("h1", "h2", "h3", "h4"):
            lvl = int(self.tag[1])
            self.blocks.append(f"{'#' * min(3, lvl + 1)} {txt}")
        else:
            self.blocks.append(txt)

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t in self.SKIP:
            self.skip += 1
            return
        if self.skip:
            return
        if t in ("p", "h1", "h2", "h3", "h4", "li", "blockquote", "div"):
            self.flush()
            self.tag = t

    def handle_endtag(self, tag):
        t = tag.lower()
        if t in self.SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if t in ("p", "h1", "h2", "h3", "h4", "li", "blockquote", "div"):
            self.flush()
            self.tag = None

    def handle_data(self, data):
        if not self.skip:
            self.buf.append(data)


def extract_epub_md(epub_path: Path, title: str) -> str:
    parts = [f"# {title}"]
    with zipfile.ZipFile(epub_path) as z:
        names = z.namelist()
        opf = next((n for n in names if n.lower().endswith(".opf")), None)
        ordered = []
        if opf:
            opf_dir = os.path.dirname(opf)
            root = ET.fromstring(z.read(opf))
            manifest = {}
            for item in root.iter():
                if item.tag.endswith("item") and "id" in item.attrib and "href" in item.attrib:
                    href = item.attrib["href"]
                    full = os.path.normpath(os.path.join(opf_dir, href)).replace("\\", "/") if opf_dir else href
                    manifest[item.attrib["id"]] = full
            for ref in root.iter():
                if ref.tag.endswith("itemref") and "idref" in ref.attrib:
                    f = manifest.get(ref.attrib["idref"])
                    if f and f in names:
                        ordered.append(f)
        if not ordered:
            ordered = sorted(n for n in names if n.lower().endswith((".xhtml", ".html", ".htm")))
        for f in ordered:
            p = SimpleEpubParser()
            p.feed(z.read(f).decode("utf-8", errors="replace"))
            p.flush()
            parts.extend(p.blocks)
    return "\n\n".join(parts)


def extract_pdf_md(pdf_path: Path, title: str) -> str:
    doc = pymupdf.open(str(pdf_path))
    parts = [f"# {title}"]
    for i in range(len(doc)):
        blocks = doc[i].get_text("blocks")
        blocks.sort(key=lambda b: (round(b[1], 1), round(b[0], 1)))
        ph = doc[i].rect.height
        for x0, y0, x1, y1, txt, *_ in blocks:
            raw = clean_en(txt).strip()
            if not raw:
                continue
            if (y0 < ph * 0.065 or y1 > ph * 0.935) and re.fullmatch(r"[\d\s·\-—ivxIVX]+", raw):
                continue
            cleaned = re.sub(r"-\s*\n\s*", "", raw)
            cleaned = re.sub(r"\s*\n\s*", " ", cleaned)
            cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
            if not cleaned:
                continue
            if len(cleaned) <= 65 and re.match(
                r"^(PART\s+[IVX\d]+.*|SECTION\s+[IVX\d]+.*|CHAPTER\s+[IVX\d]+.*|INTRODUCTION.*|THE\s+(ORIENTAL|GREEK|ROMAN|GERMAN)\s+WORLD.*|CLASSIFICATION\s+OF.*)$",
                cleaned,
                re.I,
            ):
                parts.append(f"## {cleaned}")
            else:
                parts.append(cleaned)
    doc.close()
    return "\n\n".join(parts)


def slice_md(md: str, target_words: int = 2600) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n{2,}", md) if p.strip()]
    slices, cur, cw = [], [], 0
    for p in paras:
        w = len(p.split())
        if cur and (cw >= target_words or (p.startswith("#") and cw >= target_words * 0.65)):
            slices.append("\n\n".join(cur))
            cur, cw = [], 0
        cur.append(p)
        cw += w
    if cur:
        slices.append("\n\n".join(cur))
    return slices


def check_valid(zp: Path, words: int) -> bool:
    if not zp.exists():
        return False
    t = zp.read_text(encoding="utf-8", errors="replace").strip()
    if len(t) < min(180, max(15, words * 2)):
        return False
    zh = len(re.findall(r"[\u4e00-\u9fff]", t))
    min_zh = max(120, int(words * 0.65)) if words > 250 else max(8, words)
    return zh >= min_zh


def run_dsh_part(book_title: str, total_parts: int, idx: int, sp: Path, zp: Path, words: int) -> tuple[int, bool, str]:
    prompt = (
        f"你是资深德国古典哲学与黑格尔研究翻译家。请将英文原文 `{sp}`（《{book_title}》第 {idx}/{total_parts} 片，约 {words} 英文词）"
        f"**逐段、完整、忠实、流畅地翻译为学术规范简体中文**，直接写入 `{zp}`。\n\n"
        f"严格要求：\n"
        f"1. **100% 完整翻译**：逐段逐句翻译全部正文、标题、引文与注释，严禁省略、概括或跳段！\n"
        f"2. **术语精准统一**：\n{HEGEL_GLOSSARY}\n"
        f"3. **纯净 Markdown**：保留 `#` / `##` / `###` 标题与自然分段，不要对星号加反斜杠转义（不要写 `\\*`），不要写任何乱码或客套话。\n"
        f"4. 写入 `{zp}` 完成后，仅回复“DONE #{idx:03d}”。"
    )
    env = os.environ.copy()
    env["DSH_PERMISSION_MODE"] = "danger-full-access"
    err = ""
    for _ in range(2):
        try:
            proc = subprocess.run(
                ["node", DSH_BIN, "--profile", "headless", "--patch", PATCH_FILE, prompt],
                cwd=str(WORK_DIR),
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=480,
            )
            if check_valid(zp, words):
                zh = len(re.findall(r"[\u4e00-\u9fff]", zp.read_text(encoding="utf-8", errors="replace")))
                return idx, True, f"OK (zh={zh:,})"
            err = (proc.stderr or proc.stdout or "")[-140:].replace("\n", " ")
        except Exception as e:
            err = str(e)
        time.sleep(2)
    return idx, check_valid(zp, words), f"FAIL ({err})"


def process_book(bid: str, title: str, out_name: str, src_path: Path, kind: str):
    bdir = WORK_DIR / bid
    sdir, zdir = bdir / "src", bdir / "zh"
    sdir.mkdir(parents=True, exist_ok=True)
    zdir.mkdir(parents=True, exist_ok=True)

    meta_f = bdir / "parts.json"
    if not meta_f.exists():
        md = extract_epub_md(src_path, title) if kind == "epub" else extract_pdf_md(src_path, title)
        slices = slice_md(md, target_words=2600)
        parts = []
        for idx, sl in enumerate(slices, 1):
            sp = sdir / f"part_{idx:03d}.md"
            zp = zdir / f"part_{idx:03d}.md"
            sp.write_text(sl, encoding="utf-8")
            parts.append({"idx": idx, "src": str(sp), "zh": str(zp), "words": len(sl.split())})
        meta_f.write_text(json.dumps(parts, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        parts = json.loads(meta_f.read_text(encoding="utf-8"))

    pending = [p for p in parts if not check_valid(Path(p["zh"]), p["words"])]
    print(f"\n=== DSH Translating 《{title}》: {len(pending)}/{len(parts)} slices pending ===", flush=True)
    done = len(parts) - len(pending)
    t0 = time.time()

    if pending:
        with ThreadPoolExecutor(max_workers=8) as pool:
            futs = {
                pool.submit(run_dsh_part, title, len(parts), p["idx"], Path(p["src"]), Path(p["zh"]), p["words"]): p
                for p in pending
            }
            for f in as_completed(futs):
                idx, ok, msg = f.result()
                if ok:
                    done += 1
                print(f"  [DSH] {title} #{idx:03d}/{len(parts):03d}: {msg} | {done}/{len(parts)} ({time.time()-t0:.1f}s)", flush=True)

        still = [p for p in parts if not check_valid(Path(p["zh"]), p["words"])]
        if still:
            print(f"  [RETRY] {title}: retrying {len(still)} slices...", flush=True)
            with ThreadPoolExecutor(max_workers=4) as pool:
                for f in as_completed([
                    pool.submit(run_dsh_part, title, len(parts), p["idx"], Path(p["src"]), Path(p["zh"]), p["words"])
                    for p in still
                ]):
                    idx, ok, msg = f.result()
                    print(f"    [RETRY] {title} #{idx:03d}: {msg}", flush=True)

    chunks = []
    for p in parts:
        zp = Path(p["zh"])
        if zp.exists():
            c = zp.read_text(encoding="utf-8", errors="replace").strip()
            if c:
                chunks.append(c)
    full = "\n\n".join(chunks)
    if not full.startswith("# "):
        full = f"# {title}\n\n" + full
    out_p = OUT_DIR / out_name
    out_p.write_text(full, encoding="utf-8")
    zh = len(re.findall(r"[\u4e00-\u9fff]", full))
    print(f"[ASSEMBLED FULL] {out_p.name}: {len(full):,} chars (汉字 {zh:,})", flush=True)


def main():
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    # 先译较短的《黑格尔论宗教与政治》(91k words)，再译《历史哲学》(192k words)
    process_book(
        "hegel_religion_politics",
        "黑格尔论宗教与政治",
        "黑格尔论宗教与政治（全本）.md",
        Path(r"D:\文献库\黑格尔翻译\待翻译\【黑格尔研究】黑格尔论宗教与政治.epub"),
        "epub",
    )
    process_book(
        "hegel_philosophy_of_history",
        "历史哲学",
        "历史哲学（全本）.md",
        Path(r"D:\文献库\黑格尔翻译\待翻译\【英文】历史哲学 - 黑格尔.pdf"),
        "pdf",
    )
    print("\nBOTH FULL HEGEL BOOKS TRANSLATED & ASSEMBLED!", flush=True)


if __name__ == "__main__":
    main()
