#!/usr/bin/env python3
"""
gpu_translate_books.py — 基于 RTX 5070 Ti CUDA GPU + CTranslate2 + Meta NLLB-200-1.3B (INT8)
100% 本地零限流神经机器翻译引擎，将全部英文哲学原著极速高质量译为简体中文。
"""
import os
import re
import glob
import site
import time
from pathlib import Path

os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

# 注入 pip 安装的 CUDA 12 运行时 DLL 路径（cublas64_12.dll 等）供 CTranslate2 调用 RTX 5070 Ti GPU
for sp in site.getsitepackages():
    for bin_dir in glob.glob(os.path.join(sp, "nvidia", "*", "bin")):
        if os.path.isdir(bin_dir):
            os.add_dll_directory(bin_dir)
            os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")

import ctranslate2
import pymupdf
from huggingface_hub import snapshot_download
from tokenizers import Tokenizer

SRC_DIR = Path(r"D:\文献库\待翻译转写转录")
OUT_DIR = Path(r"D:\咕咕嘎嘎反重力\extra-books")
OCR_CACHE_DIR = OUT_DIR / "_ocr_cache"

MODEL_REPO = "JustFrederik/nllb-200-distilled-1.3B-ct2-int8"
SRC_LANG = "eng_Latn"
TGT_LANG = "zho_Hans"

GLOSSARY = [
    ("辩证法启蒙", "启蒙辩证法"),
    ("现象学的精神", "精神现象学"),
    ("精神的现象学", "精神现象学"),
    ("纯粹理性的批判", "纯粹理性批判"),
    ("实践理性的批判", "实践理性批判"),
    ("判断力的批判", "判断力批判"),
    ("逻辑科学", "逻辑学"),
    ("意识形态国家设备", "意识形态国家机器"),
    ("文化产业", "文化工业"),
    ("绝对的想法", "绝对理念"),
    ("否定辩证法", "否定的辩证法"),
]


def polish_zh(zh: str) -> str:
    # 清理 NLLB 偶发多余空格与标点间距
    zh = re.sub(r'(?<=[\u4e00-\u9fff，。！？；：、（）《》“”])\s+(?=[\u4e00-\u9fff，。！？；：、（）《》“”])', '', zh)
    for bad, good in GLOSSARY:
        zh = zh.replace(bad, good)
    zh = re.sub(r'[ \t]+([，。！？；：、》）】])', r'\1', zh)
    zh = re.sub(r'([《（【])[ \t]+', r'\1', zh)
    return zh.strip()


def extract_english_pdf(pdf_path: Path, title: str) -> str:
    doc = pymupdf.open(str(pdf_path))
    toc = doc.get_toc()
    toc_by_page = {}
    for lvl, heading, pnum in toc:
        p0 = max(0, int(pnum) - 1)
        hc = heading.strip()
        if hc and not re.match(r'^(Cover|Title|Copyright|Contents|Table of Contents)$', hc, re.I):
            toc_by_page.setdefault(p0, []).append((min(3, max(1, lvl)), hc))

    parts = [f"# {title}"]
    for i in range(len(doc)):
        if i in toc_by_page:
            for lvl, htxt in toc_by_page[i]:
                parts.append(f"{'#' * min(3, lvl + 1)} {htxt}")
        blocks = doc[i].get_text("blocks")
        blocks.sort(key=lambda b: (round(b[1], 1), round(b[0], 1)))
        page_h = doc[i].rect.height
        for x0, y0, x1, y1, txt, *_ in blocks:
            raw = txt.strip()
            if not raw:
                continue
            if (y0 < page_h * 0.065 or y1 > page_h * 0.935) and re.fullmatch(r'[\d\s·\-—ivxIVX]+', raw):
                continue
            cleaned = re.sub(r'-\s*\n\s*', '', raw)
            cleaned = re.sub(r'\s*\n\s*', ' ', cleaned)
            cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip()
            if not cleaned:
                continue
            if len(cleaned) <= 55 and re.match(
                r'^(CHAPTER\s+\w+.*|PART\s+\w+.*|CONSPECTUS\s+OF\s+.*|PREFACE.*|INTRODUCTION.*|APPENDIX.*|EXCURSUS.*)$',
                cleaned,
                re.I,
            ):
                parts.append(f"## {cleaned}")
            else:
                parts.append(cleaned)
    doc.close()
    return "\n\n".join(parts)


def split_to_sentences(text: str, max_len: int = 380) -> list[str]:
    if len(text) <= max_len:
        return [text]
    pieces = re.split(r'(?<=[.!?])\s+', text)
    out = []
    buf = ""
    for p in pieces:
        if len(buf) + len(p) + 1 > max_len and buf:
            out.append(buf.strip())
            buf = p
        else:
            buf = (buf + " " + p).strip() if buf else p
    if buf.strip():
        out.append(buf.strip())
    # 防御超长无标点块
    final = []
    for seg in out:
        if len(seg) <= max_len + 80:
            final.append(seg)
        else:
            for k in range(0, len(seg), max_len):
                final.append(seg[k : k + max_len])
    return final


def load_gpu_translator():
    print(f"Downloading / loading {MODEL_REPO}...", flush=True)
    model_dir = snapshot_download(repo_id=MODEL_REPO)
    tokenizer = Tokenizer.from_file(str(Path(model_dir) / "tokenizer.json"))
    device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    compute = "int8_float16" if device == "cuda" else "int8"
    print(f"Loading CTranslate2 Translator on {device} ({compute})...", flush=True)
    translator = ctranslate2.Translator(model_dir, device=device, compute_type=compute)
    return translator, tokenizer


def translate_sentences_gpu(translator: ctranslate2.Translator, tokenizer: Tokenizer, sentences: list[str], batch_size: int = 96) -> list[str]:
    out = [""] * len(sentences)
    # 收集需要翻译的英文句子索引
    todo_idx = []
    todo_tokens = []
    for i, s in enumerate(sentences):
        if not s.strip() or not re.search(r'[A-Za-z]{2,}', s):
            out[i] = s
            continue
        enc = tokenizer.encode(s)
        toks = [SRC_LANG] + [t for t in enc.tokens if t not in ("<s>", "</s>", SRC_LANG)][:420] + ["</s>"]
        todo_idx.append(i)
        todo_tokens.append(toks)

    if not todo_tokens:
        return out

    t0 = time.time()
    total = len(todo_tokens)
    for start in range(0, total, batch_size):
        end = min(total, start + batch_size)
        sub_toks = todo_tokens[start:end]
        target_prefixes = [[TGT_LANG]] * len(sub_toks)
        res = translator.translate_batch(
            sub_toks,
            target_prefix=target_prefixes,
            beam_size=2,
            max_decoding_length=480,
            no_repeat_ngram_size=3,
        )
        for k, r in enumerate(res):
            hyp = r.hypotheses[0]
            if hyp and hyp[0] == TGT_LANG:
                hyp = hyp[1:]
            ids = [tokenizer.token_to_id(t) for t in hyp]
            ids = [x for x in ids if x is not None]
            txt = tokenizer.decode(ids, skip_special_tokens=True)
            out[todo_idx[start + k]] = polish_zh(txt)

        if end % (batch_size * 5) < batch_size or end == total:
            spd = end / max(0.1, time.time() - t0)
            print(f"    -> translated {end}/{total} sentences ({spd:.1f} sent/s)", flush=True)
    return out


def translate_book(translator, tokenizer, en_md: str, title: str) -> str:
    paras = [p.strip() for p in re.split(r'\n{2,}', en_md) if p.strip()]
    para_plans = []  # (prefix, start_sent_idx, count)
    all_sents = []

    for idx, p in enumerate(paras):
        if idx == 0 and p.startswith("# "):
            para_plans.append(("KEEP_TITLE", -1, 0))
            continue
        m = re.match(r'^(#{1,4})\s+(.+)$', p)
        if m:
            prefix = m.group(1) + " "
            body = m.group(2).strip()
        else:
            prefix = ""
            body = p
        sents = split_to_sentences(body)
        para_plans.append((prefix, len(all_sents), len(sents)))
        all_sents.extend(sents)

    print(f"\n[GPU TRANSLATE] {title}: {len(paras)} paras, {len(all_sents)} sentences", flush=True)
    zh_sents = translate_sentences_gpu(translator, tokenizer, all_sents, batch_size=96)

    out_paras = []
    for prefix, s0, cnt in para_plans:
        if prefix == "KEEP_TITLE":
            out_paras.append(f"# {title}")
        else:
            joined = "".join(zh_sents[s0 : s0 + cnt]).strip()
            if joined:
                out_paras.append(prefix + joined)
    return "\n\n".join(out_paras)


def main():
    translator, tokenizer = load_gpu_translator()

    # 快速自检两条经典哲学句
    test_zh = translate_sentences_gpu(
        translator,
        tokenizer,
        [
            "The Phenomenology of Spirit is Hegel's most widely discussed philosophical work.",
            "Dialectic of Enlightenment investigates how instrumental reason reverts to mythology.",
        ],
        batch_size=2,
    )
    print("GPU NLLB Self-Test:", test_zh, flush=True)
    assert any("\u4e00" <= ch <= "\u9fff" for ch in test_zh[0]), "GPU NLLB test did not output Chinese!"

    jobs = [
        ("enlightenment", SRC_DIR / "【英文】启蒙辩证法-霍克海默，阿多诺.pdf", "pdf", OUT_DIR / "启蒙辩证法.md", "启蒙辩证法：哲学断片"),
        ("lenin38", SRC_DIR / "Lenin_Collected_Works_Volume_38_Philosophical_Notebooks_(Vladimir_Ilyich_Lenin)_(z-library.sk,_1lib.sk,_z-lib.sk).pdf", "pdf", OUT_DIR / "列宁哲学笔记.md", "列宁哲学笔记（全集第38卷）"),
        ("aesthetics_politics", OCR_CACHE_DIR / "aesthetics_politics_en.md", "md", OUT_DIR / "美学与政治.md", "美学与政治"),
        ("stace_hegel", OCR_CACHE_DIR / "stace_hegel_en.md", "md", OUT_DIR / "黑格尔哲学（斯退士）.md", "黑格尔哲学（斯退士）"),
    ]

    for tid, src_path, kind, out_path, title in jobs:
        if not src_path.exists():
            print(f"[MISSING SRC] {src_path}", flush=True)
            continue
        # 检查已有文件是否已经包含足够多中文（避免跳过上次被 429 污染的英文文件）
        if out_path.exists():
            existing = out_path.read_text(encoding="utf-8", errors="replace")
            zh_cnt = len(re.findall(r'[\u4e00-\u9fff]', existing))
            if zh_cnt > 10000:
                print(f"[SKIP ALREADY ZH] {out_path.name} (zh={zh_cnt:,})", flush=True)
                continue

        en_md = extract_english_pdf(src_path, title) if kind == "pdf" else src_path.read_text(encoding="utf-8")
        zh_md = translate_book(translator, tokenizer, en_md, title)
        out_path.write_text(zh_md, encoding="utf-8")
        zh_cnt = len(re.findall(r'[\u4e00-\u9fff]', zh_md))
        print(f"[GPU TRANSLATED SAVED] {out_path.name} ({len(zh_md):,} chars, zh={zh_cnt:,})", flush=True)

    print("\nALL 4 ENGLISH BOOKS GPU-TRANSLATED TO CHINESE!", flush=True)


if __name__ == "__main__":
    main()
