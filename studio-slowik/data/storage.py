"""Lecture / ecriture JSON sans risque de fichier corrompu."""
import json
import os
import shutil

from core.paths import data_dir


def load_json(name: str, default):
    path = data_dir() / name
    if not path.exists():
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        # Fichier illisible : on le met de cote et on repart des valeurs par defaut.
        try:
            shutil.copy2(path, path.with_suffix(path.suffix + ".corrompu"))
        except OSError:
            pass
        return default


def save_json(name: str, data) -> None:
    path = data_dir() / name
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
