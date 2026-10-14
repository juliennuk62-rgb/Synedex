"""Traitement par lot du compositeur, dans un thread separe."""
import queue
import threading
import time
import traceback
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path

from core import chroma
from core.compositor import fit_background
from core.images import open_image, scan_sources
from core.naming import FORMATS, build_name, unique_path

BG_CACHE_BYTES = 900 * 1024 * 1024  # memoire max pour les fonds deja redimensionnes


@dataclass
class BatchConfig:
    sources_dir: str
    export_dir: str
    fonds: list                      # chemins des fonds coches
    project: str = ""
    recursive: bool = True
    exclude: list = field(default_factory=list)
    chroma_on: bool = True
    tolerance: float = 50
    softness: float = 30
    spill: float = 50
    mode: str = "cover"
    fmt: str = "JPEG"
    quality: int = 92


class _BgCache:
    def __init__(self, budget: int):
        self.budget = budget
        self.used = 0
        self.items = OrderedDict()
        self.originals = {}

    def get(self, path: Path, size: tuple, mode: str):
        key = (str(path), size, mode)
        if key in self.items:
            self.items.move_to_end(key)
            return self.items[key]
        original = self.originals.get(str(path))
        if original is None:
            original, _ = open_image(path)
        fitted = fit_background(original, size, mode)
        cost = size[0] * size[1] * 3
        while self.items and self.used + cost > self.budget:
            _, old = self.items.popitem(last=False)
            self.used -= old.width * old.height * 3
        self.items[key] = fitted
        self.used += cost
        return fitted


def save_image(img, path: Path, fmt: str, quality: int, icc=None):
    kwargs = {}
    if icc:
        kwargs["icc_profile"] = icc
    if fmt == "JPEG":
        img.save(path, "JPEG", quality=int(quality), subsampling=0 if quality >= 90 else 2,
                 optimize=True, **kwargs)
    elif fmt == "WebP":
        img.save(path, "WEBP", quality=int(quality), method=4, **kwargs)
    else:
        img.save(path, "PNG", compress_level=6, **kwargs)


class BatchJob(threading.Thread):
    """Envoie dans self.events : ("log", texte), ("progress", fait, total), ("done", resume)."""

    def __init__(self, cfg: BatchConfig):
        super().__init__(daemon=True)
        self.cfg = cfg
        self.events = queue.Queue()
        self.cancel_event = threading.Event()

    def cancel(self):
        self.cancel_event.set()

    def _log(self, text):
        self.events.put(("log", text))

    def run(self):
        summary = {"ok": 0, "errors": 0, "cancelled": False, "seconds": 0}
        start = time.time()
        try:
            self._run(summary)
        except Exception:  # erreur inattendue : on la montre dans le journal
            self._log("ERREUR inattendue :\n" + traceback.format_exc())
            summary["errors"] += 1
        summary["seconds"] = round(time.time() - start)
        self.events.put(("done", summary))

    def _run(self, summary):
        cfg = self.cfg
        sources = scan_sources(cfg.sources_dir, cfg.recursive, cfg.exclude)
        fonds = [Path(f) for f in cfg.fonds]
        ext = FORMATS.get(cfg.fmt, ".jpg")
        total = len(sources) * len(fonds)
        self._log(f"{len(sources)} photo(s) × {len(fonds)} fond(s) = {total} export(s)")
        self.events.put(("progress", 0, total))
        if not total:
            return

        export_root = Path(cfg.export_dir)
        cache = _BgCache(BG_CACHE_BYTES)
        warned_opaque = False
        done = 0
        counters = {}

        for item in sources:
            if self.cancel_event.is_set():
                summary["cancelled"] = True
                self._log("Export annulé.")
                return
            n = counters.get(item.classe, 0) + 1
            counters[item.classe] = n
            out_dir = export_root / item.classe if item.classe else export_root
            label = f"{item.classe}/{item.path.name}" if item.classe else item.path.name
            try:
                out_dir.mkdir(parents=True, exist_ok=True)
                img, icc = open_image(item.path)
                subject, mask = chroma.extract(img, cfg.chroma_on, cfg.tolerance,
                                               cfg.softness, cfg.spill)
                del img
                if mask is None and not warned_opaque:
                    self._log("Attention : photo sans transparence et détourage désactivé, "
                              "le fond ne sera pas visible.")
                    warned_opaque = True
            except Exception as exc:
                self._log(f"ERREUR lecture {label} : {exc}")
                summary["errors"] += len(fonds)
                done += len(fonds)
                self.events.put(("progress", done, total))
                continue

            for bg_path in fonds:
                if self.cancel_event.is_set():
                    break
                try:
                    bg = cache.get(bg_path, subject.size, cfg.mode)
                    result = chroma.composite(subject, mask, bg)
                    name = build_name(cfg.project, n, item.path.stem, bg_path.stem, ext)
                    target = unique_path(out_dir, name)
                    save_image(result, target, cfg.fmt, cfg.quality, icc)
                    summary["ok"] += 1
                    self._log(f"OK  {label}  →  {target.name}")
                except Exception as exc:
                    summary["errors"] += 1
                    self._log(f"ERREUR {label} + {bg_path.name} : {exc}")
                done += 1
                self.events.put(("progress", done, total))
