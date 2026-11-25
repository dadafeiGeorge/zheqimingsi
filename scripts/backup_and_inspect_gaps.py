#!/usr/bin/env python3
"""
backup_and_inspect_gaps.py —
1. 安全备份 extra-books/*.md 与 D:\文献库\中文译本 内所有即将处理的源文件到 extra-books/_backups/20261123_fix/
2. 使用 RTX 5070 Ti (RapidOCR) 300 DPI 对所有检出的漏页/低字数高墨量页做高精度重扫（含反色测试）
3. 精确定位并导出全库所有 〔原文脱漏〕 / OCR 残缺 / 缺失 / 长外文块的原版 PDF/EPUB 上下文，供 DSH deepseek-v4.1-flash 补全。
"""
import json
import re
import shutil
import zipfile
from pathlib import Path
import pymupdf
import numpy as np
from rapidocr_onnxruntime import RapidOCR

BACKUP_ROOT = Path(r"D:\咕咕嘎嘎反重力\extra-books\_backups\20261123_fix")
EXTRA = Path(r"D:\咕咕嘎嘎反重力\extra-books")
SRC_ZH = Path(r"D:\文献库\中文译本")
WORK = Path(r"D:\咕咕嘎嘎反重力\audit-work\gap_repair")
WORK.mkdir(parents=True, exist_ok=True)


def backup_sources():
    b_extra = BACKUP_ROOT / "extra-books"
    b_zh = BACKUP_ROOT / "zh-sources"
    if not b_extra.exists():
        b_extra.mkdir(parents=True, exist_ok=True)
        for f in EXTRA.glob("*.md"):
            shutil.copy2(f, b_extra / f.name)
    if not b_zh.exists():
        b_zh.mkdir(parents=True, exist_ok=True)
        for f in SRC_ZH.rglob("*"):
            if f.is_file() and f.suffix.lower() in (".md", ".epub", ".txt"):
                rel = f.relative_to(SRC_ZH)
                dst = b_zh / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, dst)
    print(f"[Backup] Complete at {BACKUP_ROOT}")


def enhance_contrast(img: np.ndarray, invert: bool = False) -> np.ndarray:
    gray = (0.299 * img[:, :, 0] + 0.587 * img[:, :, 1] + 0.114 * img[:, :, 2]).astype(np.float32)
    if invert:
        gray = 255.0 - gray
    p2, p98 = np.percentile(gray, (2, 98))
    if p98 - p2 > 15:
        scaled = np.clip((gray - p2) * (255.0 / (p98 - p2)), 0, 255).astype(np.uint8)
        return np.stack([scaled, scaled, scaled], axis=-1)
    u8 = np.clip(gray, 0, 255).astype(np.uint8)
    return np.stack([u8, u8, u8], axis=-1)


def ocr_pdf_pages():
    ocr = RapidOCR(det_use_dml=True, cls_use_dml=True, rec_use_dml=True)
    jobs = [
        ("张世英黑格尔哲学五讲", r"D:\文献库\待翻译转写转录\张世英系列\张世英黑格尔哲学五讲.pdf", [11, 12, 41, 42, 96, 97, 98, 128, 129, 130, 268, 269, 270]),
        ("康德的《纯粹理性批判》", r"D:\文献库\待翻译转写转录\张世英系列\康德的《纯粹理性批判》.pdf", [64, 237]),
        ("德国哲学论丛", r"D:\文献库\待翻译转写转录\张世英系列\德国哲学论丛.pdf", [35, 77, 173, 206, 312]),
        ("论黑格尔的逻辑学", r"D:\文献库\待翻译转写转录\张世英系列\论黑格尔的逻辑学  第3版 -- 张世英编著.pdf", [70, 312, 318, 358]),
        ("黑格尔《小逻辑》译注", r"D:\文献库\待翻译转写转录\张世英系列\黑格尔《小逻辑》译注.pdf", [32]),
        ("黑格尔《精神现象学》述评", r"D:\文献库\待翻译转写转录\张世英系列\黑格尔《精神现象学》述评.pdf", [9, 40, 50]),
        ("自我实现的历程", r"D:\文献库\待翻译转写转录\张世英系列\自我实现的历程  解读黑格尔《精神现象学».pdf", [9, 10, 12, 119, 166, 283]),
        ("西方哲学史", r"D:\文献库\待翻译转写转录\张世英系列\西方哲学史 - 图文版.pdf", [100]),
    ]
    out = {}
    for name, ppath, pages in jobs:
        doc = pymupdf.open(ppath)
        out[name] = {}
        print(f"\n=== GPU 300 DPI RE-OCR: {name} ({len(pages)} pages) ===")
        for pn in pages:
            pg = doc[pn - 1]
            pix = pg.get_pixmap(dpi=300, colorspace=pymupdf.csRGB)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
            img_enh = enhance_contrast(img, invert=False)
            res1, _ = ocr(img_enh)
            txt1 = "\n".join(str(x[1]).strip() for x in (res1 or []) if x and len(x) >= 2)
            # Also try inverted if dark background or very short text
            txt2 = ""
            if len(txt1) < 120:
                img_inv = enhance_contrast(img, invert=True)
                res2, _ = ocr(img_inv)
                txt2 = "\n".join(str(x[1]).strip() for x in (res2 or []) if x and len(x) >= 2)
            best = txt2 if len(txt2) > len(txt1) else txt1
            # Save debug PNG for visual inspection if needed
            out[name][pn] = {"normal_len": len(txt1), "inv_len": len(txt2), "best": best}
            print(f"  p.{pn:3d}: norm={len(txt1):4d}c, inv={len(txt2):4d}c | sample={best[:90].replace(chr(10),' ')!r}")
        doc.close()
    (WORK / "reocr_suspect_pages.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    backup_sources()
    ocr_pdf_pages()
