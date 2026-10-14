"""Galerie des fonds : vignettes + cases a cocher."""
import queue
import threading
from pathlib import Path

import customtkinter as ctk

from core.images import list_images, open_image

THUMB = 130
COLUMNS = 4


class _FondItem(ctk.CTkFrame):
    def __init__(self, master, path: Path, on_toggle, on_click):
        super().__init__(master, corner_radius=8, border_width=2, border_color="gray25")
        self.path = path
        self.var = ctk.BooleanVar(value=True)
        self.image_label = ctk.CTkLabel(self, text="…", width=THUMB, height=THUMB)
        self.image_label.grid(row=0, column=0, padx=6, pady=(6, 2))
        name = path.stem if len(path.stem) <= 18 else path.stem[:17] + "…"
        self.check = ctk.CTkCheckBox(self, text=name, variable=self.var, command=on_toggle,
                                     checkbox_width=18, checkbox_height=18)
        self.check.grid(row=1, column=0, padx=6, pady=(0, 6), sticky="w")
        self.image_label.bind("<Button-1>", lambda _e: on_click(self.path))

    def set_thumb(self, pil_img):
        img = ctk.CTkImage(light_image=pil_img, dark_image=pil_img, size=pil_img.size)
        self.image_label.configure(image=img, text="")
        self.image_label._thumb = img  # garde une reference

    def set_selected(self, selected: bool):
        self.configure(border_color="#1f6aa5" if selected else "gray25")


class FondsGallery(ctk.CTkFrame):
    def __init__(self, master, on_change=None, on_select=None):
        super().__init__(master)
        self.on_change = on_change
        self.on_select = on_select
        self.items = []
        self.selected = None
        self._generation = 0
        self._thumbs = queue.Queue()
        self._pending = 0

        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=0, column=0, sticky="ew", padx=8, pady=(8, 4))
        self.title = ctk.CTkLabel(bar, text="Fonds", font=ctk.CTkFont(size=15, weight="bold"))
        self.title.pack(side="left")
        ctk.CTkButton(bar, text="Tout décocher", width=110,
                      command=lambda: self._set_all(False)).pack(side="right")
        ctk.CTkButton(bar, text="Tout cocher", width=110,
                      command=lambda: self._set_all(True)).pack(side="right", padx=6)
        ctk.CTkLabel(self, text="Clic sur une vignette = fond utilisé pour l'aperçu",
                     text_color="gray60", anchor="w").grid(row=1, column=0, sticky="w", padx=10)

        self.scroll = ctk.CTkScrollableFrame(self)
        self.scroll.grid(row=2, column=0, sticky="nsew", padx=8, pady=8)
        self.rowconfigure(2, weight=1)
        self.columnconfigure(0, weight=1)
        self.empty_label = ctk.CTkLabel(self.scroll, text="Choisissez le dossier des fonds.",
                                        text_color="gray60")
        self.empty_label.grid(row=0, column=0, padx=10, pady=20)

    # --- chargement -------------------------------------------------------
    def load_folder(self, folder: str, checked=None):
        self._generation += 1
        for item in self.items:
            item.destroy()
        self.items = []
        self.selected = None
        paths = list_images(folder) if folder else []
        self.empty_label.grid_forget()
        if not paths:
            self.empty_label.configure(text="Aucune image dans ce dossier." if folder
                                       else "Choisissez le dossier des fonds.")
            self.empty_label.grid(row=0, column=0, padx=10, pady=20)
        checked_set = set(checked) if checked is not None else None
        for i, path in enumerate(paths):
            item = _FondItem(self.scroll, path, self._toggled, self._clicked)
            if checked_set is not None:
                item.var.set(path.name in checked_set)
            item.grid(row=i // COLUMNS, column=i % COLUMNS, padx=4, pady=4, sticky="n")
            self.items.append(item)
        self._update_title()
        if self.items:
            first = next((it for it in self.items if it.var.get()), self.items[0])
            self._clicked(first.path)
        elif self.on_select:
            self.on_select(None)
        if self.on_change:
            self.on_change()
        self._start_thumbnails([it.path for it in self.items])

    def _start_thumbnails(self, paths):
        gen = self._generation
        out = self._thumbs
        self._pending = len(paths)
        if not paths:
            return

        def worker():
            for p in paths:
                if gen != self._generation:
                    return
                try:
                    img, _ = open_image(p, max_size=THUMB * 2)
                    img.thumbnail((THUMB, THUMB))
                    if img.mode != "RGB":
                        img = img.convert("RGB")
                except Exception:
                    img = None
                out.put((gen, p, img))

        threading.Thread(target=worker, daemon=True).start()
        self.after(50, self._poll_thumbnails)

    def _poll_thumbnails(self):
        try:
            for _ in range(20):
                gen, path, img = self._thumbs.get_nowait()
                if gen != self._generation:
                    continue
                self._pending -= 1
                for item in self.items:
                    if item.path == path:
                        if img is None:
                            item.image_label.configure(text="illisible")
                        else:
                            item.set_thumb(img)
        except queue.Empty:
            pass
        if self._pending > 0:
            self.after(60, self._poll_thumbnails)

    # --- selection --------------------------------------------------------
    def _set_all(self, value: bool):
        for item in self.items:
            item.var.set(value)
        self._toggled()

    def _toggled(self):
        self._update_title()
        if self.on_change:
            self.on_change()

    def _clicked(self, path):
        self.selected = path
        for item in self.items:
            item.set_selected(item.path == path)
        if self.on_select:
            self.on_select(path)

    def _update_title(self):
        n = len(self.checked_paths())
        self.title.configure(text=f"Fonds ({n} coché(s) sur {len(self.items)})")

    def checked_paths(self) -> list:
        return [item.path for item in self.items if item.var.get()]
