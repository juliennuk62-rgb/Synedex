"""Fenetre principale avec les onglets."""
from tkinter import messagebox

import customtkinter as ctk

from data.settings import load_settings, save_settings
from ui.tab_compositeur import CompositeurTab

APP_TITLE = "Studio SLOWIK"


class App(ctk.CTk):
    def __init__(self):
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("1400x900")
        self.minsize(1100, 700)
        self.settings = load_settings()

        self.tabs = ctk.CTkTabview(self)
        self.tabs.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        for name in ("Compositeur", "Planche contact", "Facturation", "Commandes"):
            self.tabs.add(name)

        self.compositeur = CompositeurTab(self.tabs.tab("Compositeur"), self.settings)
        self.compositeur.pack(fill="both", expand=True)
        for name in ("Planche contact", "Facturation", "Commandes"):
            ctk.CTkLabel(self.tabs.tab(name), text="Bientôt disponible.",
                         text_color="gray60").pack(pady=40)

        self.protocol("WM_DELETE_WINDOW", self.on_close)

    def on_close(self):
        if self.compositeur.is_running():
            if not messagebox.askyesno("Export en cours",
                                       "Un export est en cours. Quitter quand même ?"):
                return
            self.compositeur.cancel_export()
        self.settings["compositeur"] = self.compositeur.get_settings()
        try:
            save_settings(self.settings)
        except OSError:
            pass
        self.destroy()
