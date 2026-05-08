"""Generate PNG icons for snapbubbles PWA + iOS.

Outputs to ../icons/:
  apple-touch-icon.png   180x180  (iOS Add-to-Home-Screen)
  icon-192.png           192x192  (PWA manifest)
  icon-512.png           512x512  (PWA manifest)
  icon-512-maskable.png  512x512  (PWA maskable, Android adaptive)
"""

from __future__ import annotations
import math
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "icons"))

BG = (13, 17, 23, 255)            # #0d1117
GLOW = (47, 129, 247, 90)          # cyan glow with alpha


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_rgb(c1, c2, t):
    return tuple(int(round(lerp(c1[i], c2[i], t))) for i in range(3))


def draw_bubble(size, *, padding_ratio=0.10, with_bg=True, with_glow=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if with_bg:
        # Rounded square background
        radius = int(size * 0.18)
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=BG)

    cx, cy = size / 2, size / 2
    r = size * (0.5 - padding_ratio)

    # Optional glow
    if with_glow:
        glow_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        gdraw = ImageDraw.Draw(glow_layer)
        gdraw.ellipse(
            (cx - r * 1.05, cy - r * 1.05 + size * 0.012,
             cx + r * 1.05, cy + r * 1.05 + size * 0.012),
            fill=GLOW,
        )
        glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(radius=size * 0.04))
        img = Image.alpha_composite(img, glow_layer)

    # Procedural bubble gradient (radial + highlight + shadow), pixel by pixel
    bubble = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = bubble.load()
    inner = (191, 231, 255)   # light cyan
    mid = (58, 169, 240)
    outer = (29, 88, 145)
    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, y - cy
            d = math.sqrt(dx * dx + dy * dy)
            if d > r:
                # antialiased edge
                if d <= r + 1:
                    a = int(255 * (1 - (d - r)))
                    if a <= 0: continue
                    base = outer
                    px[x, y] = (base[0], base[1], base[2], a)
                continue
            t = d / r  # 0 center, 1 edge
            if t < 0.6:
                color = lerp_rgb(inner, mid, t / 0.6)
            else:
                color = lerp_rgb(mid, outer, (t - 0.6) / 0.4)

            # Highlight (upper-left)
            hx, hy = cx - r * 0.36, cy - r * 0.42
            hd = math.sqrt((x - hx) ** 2 + (y - hy) ** 2)
            hr = r * 0.42
            if hd < hr:
                ht = 1 - (hd / hr)
                ht = ht * ht  # ease out
                color = lerp_rgb(color, (255, 255, 255), 0.7 * ht)

            # Shadow (lower-right)
            sx, sy = cx + r * 0.32, cy + r * 0.36
            sd = math.sqrt((x - sx) ** 2 + (y - sy) ** 2)
            sr = r * 0.55
            if sd < sr:
                st = 1 - (sd / sr)
                st = st * st * 0.6
                color = lerp_rgb(color, (0, 0, 0), 0.18 * st)

            px[x, y] = (color[0], color[1], color[2], 255)

    img = Image.alpha_composite(img, bubble)
    return img


def draw_og_image(width=1200, height=630):
    """Open Graph image for social sharing — bubble wrap field with wordmark."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 255))
    draw = ImageDraw.Draw(img)

    # Background gradient — same teal as the game
    for y in range(height):
        t = y / height
        r = int(lerp(0x2c, 0x0a, t))
        g = int(lerp(0x73, 0x2c, t))
        b = int(lerp(0x82, 0x36, t))
        draw.line([(0, y), (width, y)], fill=(r, g, b, 255))

    # Tile bubbles across the surface
    bubble_size = 110
    gap = 6
    cols = width // (bubble_size + gap) + 2
    rows = height // (bubble_size + gap) + 2
    bubble = draw_bubble(bubble_size, padding_ratio=0.04, with_bg=False, with_glow=False)
    for r in range(rows):
        for c in range(cols):
            x = c * (bubble_size + gap)
            y = r * (bubble_size + gap)
            img.alpha_composite(bubble, (x, y))

    # Darken right side for text contrast
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for x in range(width):
        t = max(0.0, (x / width - 0.25) / 0.75)
        a = int(t * t * 200)
        od.line([(x, 0), (x, height)], fill=(8, 25, 35, a))
    img = Image.alpha_composite(img, overlay)

    # Wordmark text — "Snap Bubbles" + tagline
    draw = ImageDraw.Draw(img)
    title = "Snap Bubbles"
    tagline = "Virtual Bubble Wrap"
    sub = "Zen / Speed / Survival"

    # Try to load nicer fonts; fall back to default
    title_font = None
    tagline_font = None
    sub_font = None
    candidate_fonts = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Avenir Next.ttc",
    ]
    for path in candidate_fonts:
        if os.path.exists(path):
            try:
                from PIL import ImageFont
                title_font = ImageFont.truetype(path, 110)
                tagline_font = ImageFont.truetype(path, 46)
                sub_font = ImageFont.truetype(path, 32)
                break
            except Exception:
                continue

    title_x = width * 0.55
    title_y = height * 0.36
    if title_font:
        draw.text((title_x, title_y), title, fill=(255, 255, 255, 255), font=title_font)
        draw.text((title_x, title_y + 130), tagline, fill=(190, 220, 235, 255), font=tagline_font)
        draw.text((title_x, title_y + 200), sub, fill=(140, 180, 200, 220), font=sub_font)
    else:
        draw.text((title_x, title_y), title, fill=(255, 255, 255, 255))

    return img


def main():
    os.makedirs(OUT, exist_ok=True)

    # iOS apple-touch-icon: 180px, dark bg, rounded square (iOS does its own rounding too but rounded looks fine)
    apple = draw_bubble(180, padding_ratio=0.10, with_bg=True, with_glow=True)
    apple.save(os.path.join(OUT, "apple-touch-icon.png"), optimize=True)

    # 192x192
    icon192 = draw_bubble(192, padding_ratio=0.10, with_bg=True, with_glow=True)
    icon192.save(os.path.join(OUT, "icon-192.png"), optimize=True)

    # 512x512
    icon512 = draw_bubble(512, padding_ratio=0.10, with_bg=True, with_glow=True)
    icon512.save(os.path.join(OUT, "icon-512.png"), optimize=True)

    # 512x512 maskable: bubble fills more of the canvas (safe zone is inner 80%)
    masked = draw_bubble(512, padding_ratio=0.04, with_bg=True, with_glow=False)
    masked.save(os.path.join(OUT, "icon-512-maskable.png"), optimize=True)

    # Open Graph image (social share preview) 1200x630
    og = draw_og_image(1200, 630)
    og.convert("RGB").save(os.path.join(OUT, "og-image.png"), optimize=True)

    print("Generated:")
    for name in ("apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-512-maskable.png", "og-image.png"):
        path = os.path.join(OUT, name)
        size = os.path.getsize(path)
        print(f"  {name}  {size/1024:.1f} KB")


if __name__ == "__main__":
    main()
