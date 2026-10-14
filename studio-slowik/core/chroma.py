"""Detourage fond vert (chroma key HSV)."""
import numpy as np
from PIL import Image, ImageChops, ImageFilter

GREEN_HUE = 85.0   # 120 degres sur l'echelle 0-255 de Pillow
CHUNK_ROWS = 256   # traitement par bandes pour limiter la memoire


def _process_rows(rgb: np.ndarray, hsv: np.ndarray, tolerance: float,
                  softness: float, spill: float):
    h = hsv[..., 0].astype(np.float32)
    s = hsv[..., 1].astype(np.float32)
    v = hsv[..., 2].astype(np.float32)

    d = np.abs(h - GREEN_HUE)
    d = np.minimum(d, 256.0 - d)

    hue_w = 6.0 + tolerance * 0.40       # largeur de teinte consideree verte
    soft_h = 2.0 + softness * 0.25       # transition sur la teinte
    sat_min = 100.0 - tolerance * 0.70   # saturation minimale du vert
    soft_s = 4.0 + softness * 0.50

    hue_score = np.clip((hue_w + soft_h - d) / soft_h, 0.0, 1.0)
    sat_score = np.clip((s - sat_min + soft_s) / soft_s, 0.0, 1.0)
    val_score = np.clip((v - 30.0) / 25.0, 0.0, 1.0)
    green = hue_score * sat_score * val_score
    alpha = ((1.0 - green) * 255.0 + 0.5).astype(np.uint8)

    out = rgb
    if spill > 0:
        f = rgb.astype(np.float32)
        r, g, b = f[..., 0], f[..., 1], f[..., 2]
        limit = np.maximum(r, b)
        excess = np.clip(g - limit, 0.0, None)
        f[..., 1] = g - excess * (spill / 100.0)
        out = (f + 0.5).astype(np.uint8)
    return alpha, out


def extract(img: Image.Image, chroma_on: bool, tolerance: float = 50,
            softness: float = 30, spill: float = 50):
    """Separe le sujet du fond.

    Retourne (sujet_rgb, masque_L ou None). Masque None = photo opaque sans detourage.
    """
    src_alpha = img.getchannel("A") if img.mode == "RGBA" else None
    rgb_img = img.convert("RGB") if img.mode != "RGB" else img

    if not chroma_on:
        return rgb_img, src_alpha

    rgb = np.asarray(rgb_img)
    hsv = np.asarray(rgb_img.convert("HSV"))
    height = rgb.shape[0]
    alpha = np.empty(rgb.shape[:2], dtype=np.uint8)
    fg = np.empty_like(rgb)
    for y in range(0, height, CHUNK_ROWS):
        a, c = _process_rows(rgb[y:y + CHUNK_ROWS], hsv[y:y + CHUNK_ROWS],
                             tolerance, softness, spill)
        alpha[y:y + CHUNK_ROWS] = a
        fg[y:y + CHUNK_ROWS] = c
    del hsv

    mask = Image.fromarray(alpha, "L")
    # Adoucissement des bords proportionnel a la taille de l'image.
    radius = softness / 100.0 * max(rgb_img.size) / 1500.0
    if radius >= 0.3:
        mask = mask.filter(ImageFilter.GaussianBlur(radius))
    if src_alpha is not None:
        mask = ImageChops.darker(mask, src_alpha)
    return Image.fromarray(fg, "RGB"), mask


def composite(subject: Image.Image, mask, background: Image.Image) -> Image.Image:
    """Pose le sujet sur le fond (deja a la bonne taille)."""
    if mask is None:
        return subject.copy()
    return Image.composite(subject, background, mask)
