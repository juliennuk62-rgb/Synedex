"""Reglages generaux du logiciel (reglages.json)."""
import copy

from data.storage import load_json, save_json

FILE = "reglages.json"

DEFAULTS = {
    "compositeur": {
        "chroma_on": True,
        "tolerance": 50,
        "softness": 30,
        "spill": 50,
        "mode": "cover",
        "format": "JPEG",
        "quality": 92,
        "recursive": True,
    },
}


def _merge(base: dict, extra: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load_settings() -> dict:
    data = load_json(FILE, {})
    if not isinstance(data, dict):
        data = {}
    return _merge(DEFAULTS, data)


def save_settings(settings: dict) -> None:
    save_json(FILE, settings)
