"""Historique des 10 derniers projets du compositeur (projets.json)."""
from datetime import datetime

from data.storage import load_json, save_json

FILE = "projets.json"
MAX_PROJECTS = 10


def load_projects() -> list:
    data = load_json(FILE, [])
    return data if isinstance(data, list) else []


def add_project(name: str, sources: str, fonds: str, export: str,
                recursive: bool, checked_fonds: list) -> list:
    """Ajoute (ou remonte en tete) un projet et garde les 10 plus recents."""
    entry = {
        "name": name,
        "sources": sources,
        "fonds": fonds,
        "export": export,
        "recursive": bool(recursive),
        "checked_fonds": list(checked_fonds),
        "date": datetime.now().strftime("%d/%m/%Y %H:%M"),
    }
    key = (name, sources, fonds, export)
    projects = [p for p in load_projects()
                if (p.get("name"), p.get("sources"), p.get("fonds"), p.get("export")) != key]
    projects.insert(0, entry)
    projects = projects[:MAX_PROJECTS]
    save_json(FILE, projects)
    return projects
