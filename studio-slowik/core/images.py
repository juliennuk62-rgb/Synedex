"""Recherche et ouverture des images."""
import os
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

# Grandes photos acceptees sans alerte de Pillow.
Image.MAX_IMAGE_PIXELS = None

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".jpe", ".jfif", ".tif", ".tiff",
              ".bmp", ".webp", ".gif"}


@dataclass
class SourceItem:
    path: Path
    classe: str  # sous-dossier relatif ("" = racine)


def natural_key(text: str):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", str(text))]


def is_image(path: Path) -> bool:
    name = path.name
    return (path.suffix.lower() in IMAGE_EXTS
            and not name.startswith(".") and not name.startswith("~"))


def list_images(folder) -> list:
    """Images directement dans le dossier (sans sous-dossiers)."""
    folder = Path(folder)
    if not folder.is_dir():
        return []
    files = [p for p in folder.iterdir() if p.is_file() and is_image(p)]
    return sorted(files, key=lambda p: natural_key(p.name))


def _is_inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except (ValueError, OSError):
        return False


def scan_sources(folder, recursive: bool, exclude=()) -> list:
    """Liste les photos sources. En mode recursif, chaque sous-dossier = une classe.

    Les dossiers de `exclude` (export, fonds) sont ignores s'ils sont a l'interieur.
    """
    folder = Path(folder)
    if not folder.is_dir():
        return []
    excluded = [Path(e) for e in exclude if e and Path(e).is_dir()]
    excluded = [e for e in excluded if e.resolve() != folder.resolve()]
    if not recursive:
        return [SourceItem(p, "") for p in list_images(folder)]

    items = []
    for root, dirs, files in os.walk(folder):
        root_p = Path(root)
        dirs[:] = sorted(
            (d for d in dirs
             if not d.startswith(".")
             and not any(_is_inside(root_p / d, e) for e in excluded)),
            key=natural_key)
        rel = root_p.relative_to(folder)
        classe = "" if str(rel) == "." else str(rel)
        for name in sorted(files, key=natural_key):
            p = root_p / name
            if is_image(p):
                items.append(SourceItem(p, classe))
    return items


def _to_8bit(im: Image.Image) -> Image.Image:
    arr = np.asarray(im).astype(np.float32)
    peak = float(arr.max()) if arr.size else 0.0
    if peak > 255:
        arr = arr / (65535.0 if peak > 4095 else 4095.0) * 255.0
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "L")


def open_image(path, max_size: int | None = None):
    """Ouvre une image en RGB (ou RGBA si elle a de la transparence).

    Retourne (image, profil_icc). `max_size` reduit l'image (apercu, vignettes).
    """
    with Image.open(path) as src:
        icc = src.info.get("icc_profile")
        if max_size and src.format == "JPEG":
            src.draft("RGB", (max_size, max_size))
        im = ImageOps.exif_transpose(src)
        im.load()

    has_alpha = (im.mode in ("RGBA", "LA", "PA")
                 or (im.mode == "P" and "transparency" in im.info))
    if im.mode in ("I;16", "I;16B", "I;16L", "I;16N", "I"):
        im = _to_8bit(im).convert("RGB")
    elif im.mode == "CMYK":
        im = im.convert("RGB")
        icc = None  # le profil CMYK ne s'applique plus a une image RGB
    elif has_alpha:
        im = im.convert("RGBA")
    elif im.mode != "RGB":
        im = im.convert("RGB")

    if max_size:
        im.thumbnail((max_size, max_size), Image.LANCZOS)
    return im, icc
