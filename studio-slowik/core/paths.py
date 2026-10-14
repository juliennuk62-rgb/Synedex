"""Emplacements des fichiers : les donnees sont toujours a cote du .exe."""
import os
import subprocess
import sys
from pathlib import Path

DATA_DIR_NAME = "SlowikData"


def app_dir() -> Path:
    """Dossier du .exe (version compilee) ou du projet (version Python)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    d = app_dir() / DATA_DIR_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def open_folder(path) -> None:
    """Ouvre un dossier dans l'explorateur."""
    path = str(path)
    if sys.platform.startswith("win"):
        os.startfile(path)  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])
