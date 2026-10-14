"""Adaptation des fonds a la taille de la photo."""
from PIL import Image, ImageOps

MODES = {"cover": "Remplir (cover)", "stretch": "Étirer", "contain": "Contenir (bords blancs)"}


def fit_background(bg: Image.Image, size: tuple, mode: str) -> Image.Image:
    if bg.mode != "RGB":
        if bg.mode == "RGBA":
            flat = Image.new("RGB", bg.size, (255, 255, 255))
            flat.paste(bg, mask=bg.getchannel("A"))
            bg = flat
        else:
            bg = bg.convert("RGB")
    if mode == "stretch":
        return bg.resize(size, Image.LANCZOS, reducing_gap=3.0)
    if mode == "contain":
        inner = ImageOps.contain(bg, size, Image.LANCZOS)
        canvas = Image.new("RGB", size, (255, 255, 255))
        canvas.paste(inner, ((size[0] - inner.width) // 2, (size[1] - inner.height) // 2))
        return canvas
    return ImageOps.fit(bg, size, Image.LANCZOS, centering=(0.5, 0.5))
