# Serveur local du logiciel : l'interface (fichiers du site) et l'IA (/api/...), sur cet ordinateur
# seulement (127.0.0.1) : aucune photo ne sort de l'ordinateur.
#   GET  /api/etat                       carte graphique, modeles, telechargement en cours
#   POST /api/installer?modele=ID        telecharge un modele (verifie)
#   POST /api/masque?modele=ID&cote=2048 corps = fichier photo ; reponse = masque (uint16, 0..65535)
#        en-tetes X-Largeur, X-Hauteur, X-Duree-Ms, X-Carte
import io
import json
import mimetypes
import os
import posixpath
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from PIL import Image, ImageOps

from .modeles import CATALOGUE, Moteur, Telechargement, installe

VERSION = '1'
Image.MAX_IMAGE_PIXELS = 200_000_000  # photos de groupe jusqu'a 200 Mpx
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('application/manifest+json', '.webmanifest')


def creer(racine, test=False):
    moteur = {'m': None, 'erreur': None}
    verrou = threading.Lock()
    dl = Telechargement()

    def obtenir():
        with verrou:
            if moteur['m'] is None and moteur['erreur'] is None:
                try:
                    moteur['m'] = Moteur(test=test)
                except Exception as e:  # noqa: BLE001 - PyTorch absent ou abime : dit a l'interface
                    moteur['erreur'] = f'moteur d\'IA indisponible : {e}'
            return moteur['m']

    class Gestion(BaseHTTPRequestHandler):
        server_version = 'StudioSlowik/' + VERSION

        def log_message(self, *a):
            pass

        def _json(self, code, obj):
            b = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(b)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            if u.path == '/api/etat':
                m = obtenir()
                e = m.etat() if m else {'modeles': []}
                e.update({'version': VERSION, 'erreur': moteur['erreur'] or dl.erreur, 'telechargement': dl.encours})
                return self._json(200, e)
            self._fichier(u.path)

        def do_POST(self):
            u = urllib.parse.urlparse(self.path)
            q = dict(urllib.parse.parse_qsl(u.query))
            mid = q.get('modele', 'hr-matting')
            if mid not in CATALOGUE:
                return self._json(400, {'erreur': f'modèle inconnu : {mid}'})
            if u.path == '/api/installer':
                dl.lancer(mid)
                return self._json(200, {'ok': True})
            if u.path != '/api/masque':
                return self._json(404, {'erreur': 'inconnu'})
            m = obtenir()
            if not m:
                return self._json(503, {'erreur': moteur['erreur']})
            if not m.test and not installe(mid):
                return self._json(409, {'erreur': f'modèle {mid} non installé'})
            n = int(self.headers.get('Content-Length') or 0)
            try:
                img = ImageOps.exif_transpose(Image.open(io.BytesIO(self.rfile.read(n)))).convert('RGB')
                p, ms = m.masque(img, mid, int(q.get('cote', 2048)))
            except Exception as e:  # noqa: BLE001
                return self._json(500, {'erreur': f'calcul impossible : {e}'})
            b = (np.clip(p, 0, 1) * 65535 + 0.5).astype('<u2').tobytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(len(b)))
            self.send_header('X-Largeur', str(p.shape[1]))
            self.send_header('X-Hauteur', str(p.shape[0]))
            self.send_header('X-Duree-Ms', str(ms))
            self.send_header('X-Carte', urllib.parse.quote(m.carte))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(b)

        def _fichier(self, chemin_url):
            rel = posixpath.normpath(urllib.parse.unquote(chemin_url)).lstrip('/')
            if rel in ('', '.'):
                rel = 'index.html'
            p = os.path.join(racine, *rel.split('/'))
            if os.path.isdir(p):
                p = os.path.join(p, 'index.html')
            if not os.path.abspath(p).startswith(os.path.abspath(racine)) or not os.path.isfile(p):
                self.send_error(404)
                return
            with open(p, 'rb') as f:
                b = f.read()
            self.send_response(200)
            self.send_header('Content-Type', mimetypes.guess_type(p)[0] or 'application/octet-stream')
            self.send_header('Content-Length', str(len(b)))
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(b)

    return Gestion


def demarrer(racine, port=0, test=False):
    srv = ThreadingHTTPServer(('127.0.0.1', port), creer(racine, test))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
