"""Genererar PWA-ikoner (tass-logga på grön bakgrund) i flera storlekar.
Körs en gång manuellt vid behov: python scripts/generate-icons.py
Kräver Pillow (pip install Pillow). Resultatet checkas in i public/icons.
"""
from PIL import Image, ImageDraw
import os

GREEN = (66, 107, 85, 255)      # --green
PAW = (246, 247, 242, 255)      # --cream (ljus tass mot grön bakgrund)

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "icons")


def draw_paw(draw, cx, cy, scale):
    # Stor huvudkudde (oval), förskjuten något nedåt för att ge plats åt tårna
    pad_w, pad_h = 0.30 * scale, 0.22 * scale
    pad_cy = cy + 0.14 * scale
    draw.ellipse(
        [cx - pad_w, pad_cy - pad_h, cx + pad_w, pad_cy + pad_h],
        fill=PAW,
    )
    # Fyra tår ovanför huvudkudden
    toe_r = 0.115 * scale
    offsets = [(-0.26, -0.30), (-0.095, -0.42), (0.095, -0.42), (0.26, -0.30)]
    for dx, dy in offsets:
        tx, ty = cx + dx * scale, cy + dy * scale
        draw.ellipse([tx - toe_r, ty - toe_r, tx + toe_r, ty + toe_r], fill=PAW)


def make_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Bakgrund: rundat kvadrat i grönt (maskable-varianten fyller hela ytan utan rundning)
    radius = size * (0.0 if maskable else 0.22)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=GREEN)

    # Lite djupare grön i nedre halvan för subtil skuggkänsla
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle([0, size * 0.55, size - 1, size - 1], radius=radius, fill=(0, 0, 0, 28))
    img.alpha_composite(shadow)

    scale = size * (0.56 if maskable else 0.66)
    draw_paw(ImageDraw.Draw(img), size / 2, size / 2, scale)

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    sizes = [16, 32, 180, 192, 512]
    for size in sizes:
        icon = make_icon(size)
        icon.save(os.path.join(OUT_DIR, f"icon-{size}.png"))
    maskable = make_icon(512, maskable=True)
    maskable.save(os.path.join(OUT_DIR, "icon-maskable-512.png"))
    print("Ikoner skapade i", OUT_DIR)


if __name__ == "__main__":
    main()
