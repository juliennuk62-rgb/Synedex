"""Noms des fichiers exportes (jamais d'ecrasement)."""
import re
from pathlib import Path

FORMATS = {"JPEG": ".jpg", "PNG": ".png", "WebP": ".webp"}

_FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def clean(text: str) -> str:
    text = _FORBIDDEN.sub("_", str(text)).strip().rstrip(".")
    return text


def build_name(project: str, n: int, source_stem: str, bg_name: str, ext: str) -> str:
    project = clean(project)
    bg_name = clean(bg_name)
    if project:
        return f"{project}{n}_{bg_name}{ext}"
    return f"{clean(source_stem)}_{n}_{bg_name}{ext}"


def unique_path(folder: Path, filename: str) -> Path:
    """Ajoute -2, -3... si le fichier existe deja."""
    path = folder / filename
    if not path.exists():
        return path
    stem, ext = path.stem, path.suffix
    k = 2
    while True:
        candidate = folder / f"{stem}-{k}{ext}"
        if not candidate.exists():
            return candidate
        k += 1
