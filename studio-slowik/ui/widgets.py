"""Petits composants d'interface reutilisables."""
import os
from datetime import datetime
from tkinter import filedialog

import customtkinter as ctk


class FolderPicker(ctk.CTkFrame):
    """Libelle + champ texte + bouton Parcourir."""

    def __init__(self, master, label: str, on_change=None):
        super().__init__(master, fg_color="transparent")
        self.on_change = on_change
        self._last = ""
        self.var = ctk.StringVar()
        ctk.CTkLabel(self, text=label, anchor="w").grid(row=0, column=0, columnspan=2, sticky="w")
        self.entry = ctk.CTkEntry(self, textvariable=self.var)
        self.entry.grid(row=1, column=0, sticky="ew", padx=(0, 6))
        ctk.CTkButton(self, text="Parcourir", width=90, command=self._browse).grid(row=1, column=1)
        self.columnconfigure(0, weight=1)
        self.entry.bind("<Return>", lambda _e: self._notify())
        self.entry.bind("<FocusOut>", lambda _e: self._notify())

    def _browse(self):
        start = self.get() if os.path.isdir(self.get()) else None
        folder = filedialog.askdirectory(initialdir=start, mustexist=True)
        if folder:
            self.set(folder)

    def get(self) -> str:
        value = self.var.get().strip().strip('"')
        return os.path.normpath(value) if value else ""

    def set(self, value: str, notify: bool = True):
        self.var.set(os.path.normpath(value) if value else "")
        if notify:
            self._notify()
        else:
            self._last = self.get()

    def _notify(self):
        value = self.get()
        if value != self._last:
            self._last = value
            if self.on_change:
                self.on_change(value)


class LabeledSlider(ctk.CTkFrame):
    """Curseur 0-100 avec son libelle et sa valeur."""

    def __init__(self, master, label: str, from_=0, to=100, value=50, command=None):
        super().__init__(master, fg_color="transparent")
        self.command = command
        self.title = ctk.CTkLabel(self, text=label, anchor="w")
        self.title.grid(row=0, column=0, sticky="w")
        self.value_label = ctk.CTkLabel(self, text="", width=40, anchor="e")
        self.value_label.grid(row=0, column=1, sticky="e")
        steps = int(to - from_)
        self.slider = ctk.CTkSlider(self, from_=from_, to=to, number_of_steps=steps,
                                    command=self._moved)
        self.slider.grid(row=1, column=0, columnspan=2, sticky="ew")
        self.columnconfigure(0, weight=1)
        self.set(value)

    def _moved(self, value):
        self.value_label.configure(text=str(int(round(value))))
        if self.command:
            self.command()

    def get(self) -> int:
        return int(round(self.slider.get()))

    def set(self, value):
        self.slider.set(value)
        self.value_label.configure(text=str(int(round(value))))

    def set_enabled(self, enabled: bool):
        state = "normal" if enabled else "disabled"
        self.slider.configure(state=state)
        color = ("gray10", "gray90") if enabled else ("gray60", "gray45")
        self.title.configure(text_color=color)
        self.value_label.configure(text_color=color)


class LogBox(ctk.CTkTextbox):
    """Journal en lecture seule."""

    MAX_LINES = 3000

    def __init__(self, master, **kwargs):
        super().__init__(master, wrap="none", **kwargs)
        self.configure(state="disabled")

    def append(self, text: str):
        stamp = datetime.now().strftime("%H:%M:%S")
        self.configure(state="normal")
        self.insert("end", f"[{stamp}] {text}\n")
        lines = int(self.index("end-1c").split(".")[0])
        if lines > self.MAX_LINES:
            self.delete("1.0", f"{lines - self.MAX_LINES}.0")
        self.see("end")
        self.configure(state="disabled")

    def clear(self):
        self.configure(state="normal")
        self.delete("1.0", "end")
        self.configure(state="disabled")
