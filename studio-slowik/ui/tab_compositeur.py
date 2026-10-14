"""Onglet Module 1 : compositeur fond vert."""
import os
from pathlib import Path
from tkinter import messagebox

import customtkinter as ctk

from core.batch import BatchConfig, BatchJob
from core.compositor import MODES
from core.images import scan_sources
from core.naming import FORMATS
from core.paths import open_folder
from data.projects import add_project, load_projects
from data.settings import save_settings
from ui.gallery_fonds import FondsGallery
from ui.preview import PreviewPanel
from ui.widgets import FolderPicker, LabeledSlider, LogBox

BOLD = {"size": 15, "weight": "bold"}


class CompositeurTab(ctk.CTkFrame):
    def __init__(self, master, settings: dict):
        super().__init__(master, fg_color="transparent")
        self.settings = settings
        conf = settings["compositeur"]
        self.sources = []
        self.job = None
        self._history = []

        self.columnconfigure(0, weight=0, minsize=430)
        self.columnconfigure(1, weight=1)
        self.rowconfigure(0, weight=3)
        self.rowconfigure(1, weight=2)

        left = ctk.CTkScrollableFrame(self, width=410)
        left.grid(row=0, column=0, rowspan=2, sticky="nsew", padx=(0, 8))
        left.columnconfigure(0, weight=1)
        self._build_controls(left, conf)

        self.preview = PreviewPanel(self, self.preview_params)
        self.preview.grid(row=0, column=1, sticky="nsew", pady=(0, 8))
        self.gallery = FondsGallery(self, on_change=self._update_counter,
                                    on_select=self.preview.set_background)
        self.gallery.grid(row=1, column=1, sticky="nsew")

        self._refresh_history()
        self._update_chroma_state()

    # ------------------------------------------------------------------ UI
    def _section(self, parent, row, title):
        ctk.CTkLabel(parent, text=title, font=ctk.CTkFont(**BOLD), anchor="w").grid(
            row=row, column=0, sticky="w", padx=8, pady=(14, 4))

    def _build_controls(self, f, conf):
        r = 0
        self._section(f, r, "Projet"); r += 1
        self.history_menu = ctk.CTkOptionMenu(f, values=["(aucun projet récent)"],
                                              command=self._load_history)
        self.history_menu.grid(row=r, column=0, sticky="ew", padx=8, pady=2); r += 1
        ctk.CTkLabel(f, text="Nom du projet (vide = nom du fichier source)", anchor="w").grid(
            row=r, column=0, sticky="w", padx=8); r += 1
        self.project_var = ctk.StringVar()
        ctk.CTkEntry(f, textvariable=self.project_var, placeholder_text="ex : EcoleJaures").grid(
            row=r, column=0, sticky="ew", padx=8, pady=(0, 4)); r += 1

        self._section(f, r, "Dossiers"); r += 1
        self.src_picker = FolderPicker(f, "Photos sources", on_change=lambda _v: self._rescan())
        self.src_picker.grid(row=r, column=0, sticky="ew", padx=8, pady=2); r += 1
        self.recursive_var = ctk.BooleanVar(value=conf["recursive"])
        ctk.CTkCheckBox(f, text="Inclure les sous-dossiers (1 sous-dossier = 1 classe)",
                        variable=self.recursive_var, command=self._rescan).grid(
            row=r, column=0, sticky="w", padx=8, pady=4); r += 1
        self.bg_picker = FolderPicker(f, "Fonds", on_change=self._fonds_changed)
        self.bg_picker.grid(row=r, column=0, sticky="ew", padx=8, pady=2); r += 1
        self.out_picker = FolderPicker(f, "Export", on_change=lambda _v: self._rescan())
        self.out_picker.grid(row=r, column=0, sticky="ew", padx=8, pady=2); r += 1

        self._section(f, r, "Détourage"); r += 1
        self.chroma_var = ctk.BooleanVar(value=conf["chroma_on"])
        ctk.CTkSwitch(f, text="Fond vert à retirer (OFF = photos déjà détourées)",
                      variable=self.chroma_var, command=self._chroma_toggled).grid(
            row=r, column=0, sticky="w", padx=8, pady=4); r += 1
        self.tol = LabeledSlider(f, "Tolérance", value=conf["tolerance"], command=self.preview_refresh)
        self.tol.grid(row=r, column=0, sticky="ew", padx=8, pady=2); r += 1
        self.soft = LabeledSlider(f, "Adoucissement des bords", value=conf["softness"],
                                  command=self.preview_refresh)
        self.soft.grid(row=r, column=0, sticky="ew", padx=8, pady=2); r += 1
        self.spill = LabeledSlider(f, "Réduction du reflet vert", value=conf["spill"],
                                   command=self.preview_refresh)
        self.spill.grid(row=r, column=0, sticky="ew", padx=8, pady=2); r += 1
        ctk.CTkButton(f, text="Valeurs par défaut", width=140, fg_color="gray30",
                      command=self._reset_sliders).grid(row=r, column=0, sticky="w", padx=8, pady=4); r += 1

        self._section(f, r, "Placement du fond"); r += 1
        self._mode_labels = {v: k for k, v in MODES.items()}
        self.mode_var = ctk.StringVar(value=MODES.get(conf["mode"], MODES["cover"]))
        ctk.CTkSegmentedButton(f, values=list(MODES.values()), variable=self.mode_var,
                               command=lambda _v: self.preview_refresh()).grid(
            row=r, column=0, sticky="ew", padx=8, pady=2); r += 1

        self._section(f, r, "Export"); r += 1
        line = ctk.CTkFrame(f, fg_color="transparent")
        line.grid(row=r, column=0, sticky="ew", padx=8); r += 1
        ctk.CTkLabel(line, text="Format").pack(side="left")
        self.format_var = ctk.StringVar(value=conf["format"] if conf["format"] in FORMATS else "JPEG")
        ctk.CTkOptionMenu(line, values=list(FORMATS), variable=self.format_var, width=100,
                          command=lambda _v: self._update_quality_state()).pack(side="left", padx=8)
        self.quality = LabeledSlider(f, "Qualité (JPEG / WebP)", from_=50, to=100,
                                     value=conf["quality"])
        self.quality.grid(row=r, column=0, sticky="ew", padx=8, pady=2); r += 1
        self._update_quality_state()

        self.counter = ctk.CTkLabel(f, text="", font=ctk.CTkFont(size=14, weight="bold"),
                                    anchor="w", justify="left")
        self.counter.grid(row=r, column=0, sticky="w", padx=8, pady=(14, 4)); r += 1

        buttons = ctk.CTkFrame(f, fg_color="transparent")
        buttons.grid(row=r, column=0, sticky="ew", padx=8, pady=4); r += 1
        buttons.columnconfigure(0, weight=1)
        self.start_btn = ctk.CTkButton(buttons, text="Lancer l'export", height=38,
                                       font=ctk.CTkFont(size=14, weight="bold"),
                                       command=self.start_export)
        self.start_btn.grid(row=0, column=0, sticky="ew")
        self.cancel_btn = ctk.CTkButton(buttons, text="Annuler", width=90, height=38,
                                        fg_color="#8b2b2b", hover_color="#6e2020",
                                        state="disabled", command=self.cancel_export)
        self.cancel_btn.grid(row=0, column=1, padx=(6, 0))

        self.progress = ctk.CTkProgressBar(f)
        self.progress.set(0)
        self.progress.grid(row=r, column=0, sticky="ew", padx=8, pady=(6, 0)); r += 1
        self.progress_label = ctk.CTkLabel(f, text="", anchor="w")
        self.progress_label.grid(row=r, column=0, sticky="w", padx=8); r += 1
        ctk.CTkButton(f, text="Ouvrir le dossier d'export", fg_color="gray30",
                      command=self._open_export).grid(row=r, column=0, sticky="w", padx=8, pady=4); r += 1

        self.log = LogBox(f, height=180)
        self.log.grid(row=r, column=0, sticky="ew", padx=8, pady=(4, 8)); r += 1

    # ------------------------------------------------------------ reglages
    def preview_params(self) -> dict:
        return {
            "chroma_on": self.chroma_var.get(),
            "tolerance": self.tol.get(),
            "softness": self.soft.get(),
            "spill": self.spill.get(),
            "mode": self._mode_labels.get(self.mode_var.get(), "cover"),
        }

    def preview_refresh(self):
        self.preview.refresh()

    def _chroma_toggled(self):
        self._update_chroma_state()
        self.preview_refresh()

    def _update_chroma_state(self):
        on = self.chroma_var.get()
        for s in (self.tol, self.soft, self.spill):
            s.set_enabled(on)

    def _update_quality_state(self):
        self.quality.set_enabled(self.format_var.get() != "PNG")

    def _reset_sliders(self):
        self.tol.set(50)
        self.soft.set(30)
        self.spill.set(50)
        self.preview_refresh()

    def get_settings(self) -> dict:
        p = self.preview_params()
        return {
            "chroma_on": p["chroma_on"], "tolerance": p["tolerance"],
            "softness": p["softness"], "spill": p["spill"], "mode": p["mode"],
            "format": self.format_var.get(), "quality": self.quality.get(),
            "recursive": self.recursive_var.get(),
        }

    # ------------------------------------------------------------ dossiers
    def _exclusions(self):
        return [self.out_picker.get(), self.bg_picker.get()]

    def _rescan(self):
        folder = self.src_picker.get()
        self.sources = scan_sources(folder, self.recursive_var.get(), self._exclusions()) \
            if folder else []
        self.preview.set_sources(self.sources)
        self._update_counter()

    def _fonds_changed(self, folder, checked=None):
        self.gallery.load_folder(folder, checked)
        self._rescan()

    def _update_counter(self):
        n_src = len(self.sources)
        n_bg = len(self.gallery.checked_paths())
        classes = len({s.classe for s in self.sources})
        txt = f"{n_src} photo(s) × {n_bg} fond(s) = {n_src * n_bg} export(s)"
        if self.recursive_var.get() and n_src:
            txt += f"\n{classes} classe(s)"
        self.counter.configure(text=txt)

    # ------------------------------------------------------------ historique
    def _refresh_history(self):
        self._history = load_projects()
        labels = []
        for i, p in enumerate(self._history, 1):
            name = p.get("name") or Path(p.get("sources", "")).name or "sans nom"
            labels.append(f"{i}. {name}  ({p.get('date', '')})")
        if labels:
            self.history_menu.configure(values=labels, state="normal")
        else:
            labels = ["(aucun projet récent)"]
            self.history_menu.configure(values=labels, state="disabled")
        self.history_menu.set("Projets récents…" if self._history else labels[0])

    def _load_history(self, label):
        try:
            index = int(label.split(".", 1)[0]) - 1
            p = self._history[index]
        except (ValueError, IndexError):
            return
        self.project_var.set(p.get("name", ""))
        self.recursive_var.set(p.get("recursive", True))
        self.src_picker.set(p.get("sources", ""), notify=False)
        self.out_picker.set(p.get("export", ""), notify=False)
        self.bg_picker.set(p.get("fonds", ""), notify=False)
        self._fonds_changed(self.bg_picker.get(), p.get("checked_fonds"))
        missing = [k for k in ("sources", "fonds", "export")
                   if p.get(k) and not os.path.isdir(p[k])]
        if missing:
            self.log.append("Attention, dossier(s) introuvable(s) : " + ", ".join(missing))
        self.log.append(f"Projet rechargé : {p.get('name') or '(sans nom)'}")
        self.history_menu.set("Projets récents…")

    # ------------------------------------------------------------ export
    def start_export(self):
        if self.job is not None:
            return
        src, bg, out = self.src_picker.get(), self.bg_picker.get(), self.out_picker.get()
        errors = []
        if not src or not os.path.isdir(src):
            errors.append("Le dossier des sources est introuvable.")
        if not bg or not os.path.isdir(bg):
            errors.append("Le dossier des fonds est introuvable.")
        if not out:
            errors.append("Choisissez un dossier d'export.")
        self._rescan()
        fonds = self.gallery.checked_paths()
        if not errors and not self.sources:
            errors.append("Aucune photo trouvée dans le dossier des sources.")
        if not errors and not fonds:
            errors.append("Cochez au moins un fond.")
        if errors:
            messagebox.showwarning("Export impossible", "\n".join(errors))
            return
        try:
            os.makedirs(out, exist_ok=True)
        except OSError as exc:
            messagebox.showerror("Export impossible", f"Dossier d'export inaccessible :\n{exc}")
            return

        project = self.project_var.get().strip()
        add_project(project, src, bg, out, self.recursive_var.get(), [p.name for p in fonds])
        self._refresh_history()
        self.settings["compositeur"] = self.get_settings()
        try:
            save_settings(self.settings)
        except OSError:
            pass

        p = self.preview_params()
        cfg = BatchConfig(
            sources_dir=src, export_dir=out, fonds=[str(x) for x in fonds], project=project,
            recursive=self.recursive_var.get(), exclude=self._exclusions(),
            chroma_on=p["chroma_on"], tolerance=p["tolerance"], softness=p["softness"],
            spill=p["spill"], mode=p["mode"], fmt=self.format_var.get(),
            quality=self.quality.get())
        self.log.clear()
        self.log.append(f"Début de l'export : {project or '(sans nom de projet)'}")
        self.progress.set(0)
        self.progress_label.configure(text="")
        self.start_btn.configure(state="disabled")
        self.cancel_btn.configure(state="normal")
        self.job = BatchJob(cfg)
        self.job.start()
        self.after(100, self._poll_job)

    def cancel_export(self):
        if self.job is not None:
            self.job.cancel()
            self.cancel_btn.configure(state="disabled")
            self.log.append("Annulation demandée…")

    def is_running(self) -> bool:
        return self.job is not None

    def _poll_job(self):
        job = self.job
        if job is None:
            return
        finished = None
        for _ in range(200):
            try:
                event = job.events.get_nowait()
            except Exception:
                break
            if event[0] == "log":
                self.log.append(event[1])
            elif event[0] == "progress":
                done, total = event[1], event[2]
                self.progress.set(done / total if total else 0)
                self.progress_label.configure(text=f"{done} / {total}")
            elif event[0] == "done":
                finished = event[1]
        if finished is None:
            self.after(100, self._poll_job)
            return
        self.job = None
        self.start_btn.configure(state="normal")
        self.cancel_btn.configure(state="disabled")
        s = finished
        minutes, seconds = divmod(s["seconds"], 60)
        msg = f"{s['ok']} fichier(s) exporté(s), {s['errors']} erreur(s), en {minutes} min {seconds} s."
        if s["cancelled"]:
            msg = "Export annulé. " + msg
        self.log.append(msg)
        if s["errors"]:
            messagebox.showwarning("Export terminé", msg + "\nVoir le journal pour le détail.")
        else:
            messagebox.showinfo("Export terminé", msg)

    def _open_export(self):
        out = self.out_picker.get()
        if out and os.path.isdir(out):
            open_folder(out)
        else:
            messagebox.showinfo("Dossier d'export", "Le dossier d'export n'existe pas encore.")
