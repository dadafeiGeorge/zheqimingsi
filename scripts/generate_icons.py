#!/usr/bin/env python3
"""生成「哲启明思」绿底白字「哲」高清应用图标（桌面端 .ico/.png + Android mipmap-* + Web favicon.svg）"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(r"D:\咕咕嘎嘎反重力")


def draw_icon(size: int = 512) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. 圆角深翠青苔绿底色（精致微径向渐变，通透沉稳）
    pad = int(size * 0.04)
    radius = int(size * 0.22)
    base_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(base_layer)
    # 先画深翠绿底板
    bdraw.rectangle([0, 0, size, size], fill=(22, 82, 60, 255))

    # 中心柔和玉翠高光渐变
    cx, cy = size // 2, int(size * 0.44)
    max_r = int(size * 0.62)
    for r in range(max_r, 0, -3):
        t = r / max_r
        # 中心清润苍翠 (38, 128, 94) -> 边缘沉稳墨绿 (18, 68, 50)
        red = int(38 * (1 - t) + 18 * t)
        grn = int(128 * (1 - t) + 68 * t)
        blu = int(94 * (1 - t) + 50 * t)
        bdraw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(red, grn, blu, 255))

    # 圆角遮罩裁切
    mask = Image.new("L", (size, size), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.rounded_rectangle([pad, pad, size - pad, size - pad], radius=radius, fill=255)
    img.paste(base_layer, (0, 0), mask)

    # 2. 极细雅白玉线内框（印章书卷气质）
    m1 = int(size * 0.105)
    m2 = int(size * 0.128)
    draw.rounded_rectangle(
        [m1, m1, size - m1, size - m1],
        radius=int(size * 0.165),
        outline=(255, 255, 255, 185),
        width=max(2, size // 136),
    )
    draw.rounded_rectangle(
        [m2, m2, size - m2, size - m2],
        radius=int(size * 0.142),
        outline=(255, 255, 255, 68),
        width=max(1, size // 256),
    )

    # 3. 中心醒目纯白「哲」字（优选楷/宋体厚重笔锋，辅以加粗描边增强小尺寸识别度）
    font = None
    for fpath in [
        r"C:\Windows\Fonts\STZHONGS.TTF",
        r"C:\Windows\Fonts\simsun.ttc",
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
    ]:
        if Path(fpath).exists():
            try:
                font = ImageFont.truetype(fpath, int(size * 0.50))
                break
            except Exception:
                pass
    if font is None:
        font = ImageFont.load_default()

    text = "哲"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = size // 2 - tw // 2 - bbox[0]
    ty = size // 2 - th // 2 - bbox[1] - int(size * 0.012)

    # 柔和深绿投影提升立体感
    shadow_off = max(2, int(size * 0.014))
    draw.text((tx + shadow_off, ty + shadow_off), text, font=font, fill=(10, 42, 30, 150))
    # 纯白主体字（带 1px 微描边让 16x16 / 32x32 任务栏图标依然清晰饱满）
    stroke_w = max(1, size // 200)
    draw.text(
        (tx, ty),
        text,
        font=font,
        fill=(255, 255, 255, 255),
        stroke_width=stroke_w,
        stroke_fill=(255, 255, 255, 230),
    )

    return img


def write_web_favicon():
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="g" cx="50%" cy="42%" r="65%">
      <stop offset="0%" stop-color="#26805E"/>
      <stop offset="100%" stop-color="#124432"/>
    </radialGradient>
  </defs>
  <rect x="20" y="20" width="472" height="472" rx="112" fill="url(#g)"/>
  <rect x="54" y="54" width="404" height="404" rx="84" fill="none" stroke="#FFFFFF" stroke-opacity="0.72" stroke-width="4"/>
  <rect x="66" y="66" width="380" height="380" rx="72" fill="none" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="2"/>
  <text x="256" y="346" text-anchor="middle" fill="#FFFFFF" font-family="'STZhongsong','SimSun','Songti SC',serif" font-size="260" font-weight="700">哲</text>
</svg>
"""
    pub = ROOT / "web" / "public"
    pub.mkdir(parents=True, exist_ok=True)
    (pub / "favicon.svg").write_text(svg, encoding="utf-8")


def main():
    base = draw_icon(512)

    # Desktop icon assets (.png + multi-size .ico)
    desk_assets = ROOT / "desktop" / "assets"
    desk_assets.mkdir(parents=True, exist_ok=True)
    base.save(desk_assets / "icon.png", format="PNG")
    base.save(
        desk_assets / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    # Web favicon
    write_web_favicon()
    base.resize((192, 192), Image.Resampling.LANCZOS).save(ROOT / "web" / "public" / "icon-192.png", format="PNG")

    # Android mipmap icons
    densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    res_root = ROOT / "android" / "app" / "src" / "main" / "res"
    for folder, px in densities.items():
        d = res_root / folder
        d.mkdir(parents=True, exist_ok=True)
        resized = base.resize((px, px), Image.Resampling.LANCZOS)
        resized.save(d / "ic_launcher.png", format="PNG")
        resized.save(d / "ic_launcher_round.png", format="PNG")

    print("Green-bg white-text '哲' icons generated successfully!")


if __name__ == "__main__":
    main()
