"""Genera iconos de app (cuadrado con esquinas redondeadas) desde el logo RG."""
from PIL import Image, ImageDraw
from pathlib import Path

SRC = Path(
    r"C:\Users\Lenovo\.cursor\projects\c-Users-Lenovo-Proyectos-rg-suite\assets\LOGO_RGapp-f0d18fc7-7d5e-4f32-a3eb-fbb4e490477c.jpg"
)
APP_DIR = Path(r"C:\Users\Lenovo\Proyectos\finanzas-socios-app\src\app")
PUB_DIR = Path(r"C:\Users\Lenovo\Proyectos\finanzas-socios-app\public")
RG_ICONS = Path(r"C:\Users\Lenovo\Proyectos\rg-suite\public\icons")
CHECK_APP = Path(r"C:\Users\Lenovo\Proyectos\Check\src\app")


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def make_icon(size: int, corner_ratio: float = 0.22) -> Image.Image:
    """Recorta al centro cuadrado, aplica esquinas redondeadas."""
    logo = Image.open(SRC).convert("RGBA")
    w, h = logo.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    square = logo.crop((left, top, left + side, top + side))
    square = square.resize((size, size), Image.Resampling.LANCZOS)
    radius = max(1, int(size * corner_ratio))
    mask = rounded_mask(size, radius)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(square, (0, 0), mask)
    return out


def save_all() -> None:
    PUB_DIR.mkdir(exist_ok=True)
    APP_DIR.mkdir(parents=True, exist_ok=True)

    icon512 = make_icon(512)
    icon512.save(APP_DIR / "icon.png", optimize=True)
    icon512.save(PUB_DIR / "icon-512.png", optimize=True)

    icon192 = make_icon(192)
    icon192.save(PUB_DIR / "icon-192.png", optimize=True)

    apple = make_icon(180)
    apple.save(APP_DIR / "apple-icon.png", optimize=True)
    apple.save(PUB_DIR / "apple-icon.png", optimize=True)

    # favicon: fondo opaco (mejor en pestañas)
    fav = make_icon(256).convert("RGBA")
    fav.save(APP_DIR / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])

    if RG_ICONS.exists():
        icon192.save(RG_ICONS / "icon-192.png", optimize=True)
        icon512.save(RG_ICONS / "icon-512.png", optimize=True)
        icon512.save(RG_ICONS / "icon-maskable-512.png", optimize=True)
        apple.save(RG_ICONS / "apple-touch-icon.png", optimize=True)

    if CHECK_APP.exists():
        icon512.save(CHECK_APP / "icon.png", optimize=True)
        apple.save(CHECK_APP / "apple-icon.png", optimize=True)
        fav.save(CHECK_APP / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])

    print("icons updated")


if __name__ == "__main__":
    save_all()
