from PIL import Image
from pathlib import Path

src = Path(
    r"C:\Users\Lenovo\.cursor\projects\c-Users-Lenovo-Proyectos-rg-suite\assets\LOGO_RG-215c6dc8-3084-4dc8-8462-f9333032249e.png"
)
logo = Image.open(src).convert("RGBA")
print("logo size", logo.size)

pixels = list(logo.getdata())
pinks = []
for r, g, b, a in pixels:
    if a > 200 and r > 180 and b > 80 and g < 120:
        pinks.append((r, g, b))
if pinks:
    pinks.sort()
    mid = pinks[len(pinks) // 2]
    print("sample pink", mid)
else:
    mid = (233, 30, 140)
    print("fallback pink", mid)


def make_icon(size: int, pad_ratio: float = 0.12) -> Image.Image:
    bg = Image.new("RGBA", (size, size), (*mid, 255))
    max_w = int(size * (1 - 2 * pad_ratio))
    max_h = int(size * (1 - 2 * pad_ratio))
    lw, lh = logo.size
    scale = min(max_w / lw, max_h / lh)
    nw, nh = max(1, int(lw * scale)), max(1, int(lh * scale))
    resized = logo.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (size - nw) // 2
    y = (size - nh) // 2
    bg.alpha_composite(resized, (x, y))
    return bg


out_dir = Path(r"C:\Users\Lenovo\Proyectos\finanzas-socios-app\src\app")
icon512 = make_icon(512, 0.10)
icon512.save(out_dir / "icon.png", optimize=True)
print("wrote icon.png")

icon180 = make_icon(180, 0.10)
icon180.save(out_dir / "apple-icon.png", optimize=True)
print("wrote apple-icon.png")

favicon = make_icon(256, 0.08)
# Pillow ICO: save multiple sizes via append_images
ico16 = make_icon(16, 0.06).convert("RGBA")
ico32 = make_icon(32, 0.06).convert("RGBA")
ico48 = make_icon(48, 0.06).convert("RGBA")
favicon.convert("RGBA").save(
    out_dir / "favicon.ico",
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48)],
    append_images=[ico16, ico32, ico48],
)
print("wrote favicon.ico")

pub = Path(r"C:\Users\Lenovo\Proyectos\finanzas-socios-app\public")
pub.mkdir(exist_ok=True)
icon512.save(pub / "icon-512.png", optimize=True)
make_icon(192, 0.10).save(pub / "icon-192.png", optimize=True)
print("wrote public icons")
