"""Apercu en direct : une photo source + le fond selectionne + les reglages."""
import customtkinter as ctk
from PIL import Image

from core import chroma
from core.compositor import fit_background
from core.images import open_image

PREVIEW_MAX = 1000  # taille de calcul de l'apercu (pixels)


class PreviewPanel(ctk.CTkFrame):
    def __init__(self, master, get_params):
        """get_params() -> dict(chroma_on, tolerance, softness, spill, mode)."""
        super().__init__(master)
        self.get_params = get_params
        self.sources = []
        self.index = 0
        self.background = None
        self._src_cache = (None, None)
        self._bg_cache = {}
        self._job = None
        self._image_ref = None

        nav = ctk.CTkFrame(self, fg_color="transparent")
        nav.grid(row=0, column=0, sticky="ew", padx=8, pady=(8, 4))
        ctk.CTkLabel(nav, text="Aperçu", font=ctk.CTkFont(size=15, weight="bold")).pack(side="left")
        ctk.CTkButton(nav, text="▶", width=36, command=lambda: self.step(1)).pack(side="right")
        ctk.CTkButton(nav, text="◀", width=36, command=lambda: self.step(-1)).pack(side="right", padx=4)
        self.info = ctk.CTkLabel(nav, text="", text_color="gray70")
        self.info.pack(side="right", padx=8)

        self.canvas = ctk.CTkLabel(self, text="Choisissez le dossier des sources.",
                                   text_color="gray60")
        self.canvas.grid(row=1, column=0, sticky="nsew", padx=8, pady=(0, 8))
        self.rowconfigure(1, weight=1)
        self.columnconfigure(0, weight=1)
        self.canvas.bind("<Configure>", lambda _e: self.refresh())

    # --- donnees ----------------------------------------------------------
    def set_sources(self, sources: list):
        current = self.sources[self.index].path if self.sources else None
        self.sources = sources
        self.index = 0
        for i, item in enumerate(sources):
            if item.path == current:
                self.index = i
        self.refresh()

    def set_background(self, path):
        self.background = path
        self.refresh()

    def step(self, delta: int):
        if self.sources:
            self.index = (self.index + delta) % len(self.sources)
            self.refresh()

    # --- rendu ------------------------------------------------------------
    def refresh(self):
        if self._job is not None:
            self.after_cancel(self._job)
        self._job = self.after(120, self._render)

    def _source_image(self, path):
        if self._src_cache[0] != path:
            img, _ = open_image(path, max_size=PREVIEW_MAX)
            self._src_cache = (path, img)
        return self._src_cache[1]

    def _bg_image(self, path):
        if path not in self._bg_cache:
            if len(self._bg_cache) > 30:
                self._bg_cache.clear()
            img, _ = open_image(path, max_size=PREVIEW_MAX * 2)
            self._bg_cache[path] = img
        return self._bg_cache[path]

    def _render(self):
        self._job = None
        if not self.sources:
            self.info.configure(text="")
            self._show_text("Aucune photo source.")
            return
        item = self.sources[self.index]
        name = f"{item.classe}/{item.path.name}" if item.classe else item.path.name
        self.info.configure(text=f"{self.index + 1}/{len(self.sources)} : {name}")
        p = self.get_params()
        try:
            src = self._source_image(item.path)
            subject, mask = chroma.extract(src, p["chroma_on"], p["tolerance"],
                                           p["softness"], p["spill"])
            if self.background is not None:
                bg = fit_background(self._bg_image(self.background), subject.size, p["mode"])
            else:
                bg = Image.new("RGB", subject.size, (128, 128, 128))
            result = chroma.composite(subject, mask, bg)
        except Exception as exc:
            self._show_text(f"Impossible d'afficher cette photo :\n{exc}")
            return

        # winfo_* donne des pixels reels, CTkImage attend des unites ecran (zoom Windows).
        zoom = getattr(self.canvas, "_get_widget_scaling", lambda: 1.0)() or 1.0
        w = max((self.canvas.winfo_width() - 4) / zoom, 100)
        h = max((self.canvas.winfo_height() - 4) / zoom, 100)
        scale = min(w / result.width, h / result.height)
        size = (max(1, int(result.width * scale)), max(1, int(result.height * scale)))
        img = ctk.CTkImage(light_image=result, dark_image=result, size=size)
        self._image_ref = img
        self.canvas.configure(image=img, text="")

    def _show_text(self, text):
        self._image_ref = None
        self.canvas.configure(image=None, text=text)
