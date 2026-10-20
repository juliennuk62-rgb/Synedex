# Studio SLOWIK Detourage : lance le moteur local et ouvre l'interface dans sa propre fenetre
# (Microsoft Edge ou Google Chrome en mode application). Le logiciel s'arrete a la fermeture de la
# fenetre.
#   python lancer.py            normal
#   python lancer.py --test     modele de test (sans poids, pour les tests automatiques)
#   python lancer.py --serveur  sans fenetre (le serveur tourne jusqu'a Ctrl+C)
import argparse
import os
import shutil
import subprocess
import sys
import time
import webbrowser

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
from slowik_moteur.serveur import demarrer  # noqa: E402

# Port fixe : l'adresse ne change pas d'un lancement a l'autre (reglages et prereglages gardes).
PORT = 47321


def navigateur():
    pf = [os.environ.get(k, '') for k in ('ProgramFiles(x86)', 'ProgramFiles', 'LOCALAPPDATA')]
    candidats = [os.path.join(b, *p) for b in pf if b for p in (
        ('Microsoft', 'Edge', 'Application', 'msedge.exe'), ('Google', 'Chrome', 'Application', 'chrome.exe'))]
    candidats += [shutil.which(n) for n in ('msedge', 'google-chrome', 'chromium', 'chrome')]
    return next((c for c in candidats if c and os.path.exists(c)), None)


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--test', action='store_true')
    a.add_argument('--serveur', action='store_true')
    a.add_argument('--port', type=int, default=PORT)
    a.add_argument('--racine', default=os.environ.get('SLOWIK_SITE') or os.path.join(ICI, '..'))
    o = a.parse_args()
    srv = demarrer(os.path.abspath(o.racine), o.port, o.test)
    url = f'http://127.0.0.1:{srv.server_address[1]}/detourage/index.html'
    print(f'Studio SLOWIK Détourage : {url}', flush=True)
    if o.serveur:
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return
    nav = navigateur()
    if not nav:
        webbrowser.open(url)
        print('Fenêtre ouverte dans le navigateur. Ctrl+C pour arrêter.', flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return
    profil = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~/.local/share'), 'StudioSlowik', 'fenetre')
    p = subprocess.Popen([nav, f'--app={url}', f'--user-data-dir={profil}', '--no-first-run', '--start-maximized'])
    p.wait()


if __name__ == '__main__':
    main()
