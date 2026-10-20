# Modeles d'IA du moteur local : telechargement (verifie), chargement sur la carte graphique, masque.
import hashlib
import os
import sys
import threading
import time
import urllib.request

import numpy as np
from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(ICI), 'birefnet'))

SOURCE = 'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/'
# taille : cote du carre d'entree (modeles entraines en 2048 x 2048) ou None (format de la photo).
CATALOGUE = {
    'hr-matting': {
        'nom': 'BiRefNet HR-matting (2048 px, bords doux, cheveux)', 'fichier': 'BiRefNet_HR-matting-epoch_135.pth',
        'octets': 444622828, 'sha256': '93842d02b902ac384676df408e9ae237cae35d8950bd4c9ca8131f3c3367238e', 'carre': True,
    },
    'dynamic': {
        'nom': 'BiRefNet dynamic (toute taille, retire les chaises)', 'fichier': 'BiRefNet_dynamic-general-epoch_174.pth',
        'octets': 441657146, 'sha256': 'f1e6fb2a457b1852303358ccdf02d6ab8a86875396df3b74fb2ca0134d541fb5', 'carre': False,
    },
}
MOY = np.array([0.485, 0.456, 0.406], np.float32)
ECART = np.array([0.229, 0.224, 0.225], np.float32)


def dossier_modeles():
    base = os.environ.get('SLOWIK_MODELES') or os.path.join(
        os.environ.get('LOCALAPPDATA') or os.path.expanduser('~/.local/share'), 'StudioSlowik', 'modeles')
    os.makedirs(base, exist_ok=True)
    return base


def chemin(mid):
    return os.path.join(dossier_modeles(), CATALOGUE[mid]['fichier'])


def installe(mid):
    p = chemin(mid)
    return os.path.exists(p) and os.path.getsize(p) == CATALOGUE[mid]['octets']


class Telechargement:
    """Telechargement d'un modele en arriere-plan (progression lisible par l'etat du moteur)."""

    def __init__(self):
        self.verrou = threading.Lock()
        self.encours = None   # { modele, fait, total }
        self.erreur = None

    def lancer(self, mid):
        with self.verrou:
            if self.encours or installe(mid):
                return
            self.encours = {'modele': mid, 'fait': 0, 'total': CATALOGUE[mid]['octets']}
            self.erreur = None
        threading.Thread(target=self._telecharger, args=(mid,), daemon=True).start()

    def _telecharger(self, mid):
        m = CATALOGUE[mid]
        tmp = chemin(mid) + '.partiel'
        try:
            h = hashlib.sha256()
            with urllib.request.urlopen(SOURCE + m['fichier'], timeout=60) as r, open(tmp, 'wb') as f:
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
                    h.update(b)
                    self.encours['fait'] += len(b)
            if h.hexdigest() != m['sha256']:
                raise ValueError('fichier abîmé pendant le téléchargement, relancez l\'installation')
            os.replace(tmp, chemin(mid))
        except Exception as e:  # noqa: BLE001 - message rendu a l'interface
            self.erreur = f'{mid} : {e}'
            if os.path.exists(tmp):
                os.remove(tmp)
        finally:
            self.encours = None


class Moteur:
    """Modeles charges a la demande, un calcul a la fois (memoire de la carte)."""

    def __init__(self, test=False):
        self.test = test
        self.verrou = threading.Lock()
        self.modeles = {}
        if test:  # modele de test : PyTorch inutile
            self.appareil, self.carte, self.memoire, self.demi = 'cpu', 'modèle de test', 0, False
            return
        import torch
        self.torch = torch
        if torch.cuda.is_available():
            self.appareil = 'cuda'
            p = torch.cuda.get_device_properties(0)
            self.carte, self.memoire = p.name, p.total_memory
        elif getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available():
            self.appareil, self.carte, self.memoire = 'mps', 'Apple (Metal)', 0
        else:
            self.appareil, self.carte, self.memoire = 'cpu', 'processeur (sans carte graphique)', 0
        self.demi = self.appareil != 'cpu'

    def etat(self):
        return {'appareil': self.appareil, 'carte': self.carte, 'memoire': self.memoire, 'test': self.test,
                'modeles': [{'id': k, 'nom': v['nom'], 'octets': v['octets'], 'installe': self.test or installe(k)}
                            for k, v in CATALOGUE.items()]}

    def _modele(self, mid):
        if mid not in self.modeles:
            torch = self.torch
            from models.birefnet import BiRefNet
            m = BiRefNet(bb_pretrained=False)
            sd = torch.load(chemin(mid), map_location='cpu', weights_only=True)
            for k in list(sd):
                for pre in ('module.', '_orig_mod.'):
                    if k.startswith(pre):
                        sd[k[len(pre):]] = sd.pop(k)
                        break
            m.load_state_dict(sd)
            m.eval().to(self.appareil)
            if self.demi:
                m.half()
            self.modeles[mid] = m
        return self.modeles[mid]

    def _taille(self, mid, w, h, cote):
        if CATALOGUE[mid]['carre']:
            return cote, cote
        k = cote / max(w, h)
        return max(32, round(w * k / 32) * 32), max(32, round(h * k / 32) * 32)

    def masque(self, img, mid, cote=2048):
        """img : PIL RGB (orientation deja appliquee). Retourne (masque float32 0..1 au format de la
        photo, long cote = cote), duree en ms."""
        w, h = img.size
        k = min(1, cote / max(w, h))
        mw, mh = max(1, round(w * k)), max(1, round(h * k))
        with self.verrou:
            t0 = time.time()
            if self.test:
                p = self._masque_test(img, mw, mh)
            else:
                p = self._masque_birefnet(img, mid, cote, mw, mh)
            return p, round((time.time() - t0) * 1000)

    def _masque_birefnet(self, img, mid, cote, mw, mh):
        torch = self.torch
        lw, lh = self._taille(mid, *img.size, cote)
        x = np.asarray(img.resize((lw, lh), Image.BICUBIC), dtype=np.float32) / 255
        x = torch.from_numpy(((x - MOY) / ECART).transpose(2, 0, 1)[None].copy()).to(self.appareil)
        if self.demi:
            x = x.half()
        m = self._modele(mid)
        with torch.inference_mode():
            a = m(x)[-1].float().sigmoid()
            b = m(torch.flip(x, [3]))[-1].float().sigmoid().flip([3])  # miroir remis a l'endroit
            p = ((a + b) / 2)[0, 0].cpu().numpy()
        if self.appareil == 'cuda':
            torch.cuda.empty_cache()
        return np.asarray(Image.fromarray(p, 'F').resize((mw, mh), Image.BILINEAR), dtype=np.float32)

    @staticmethod
    def _masque_test(img, mw, mh):
        # Modele de test (tests automatiques, sans poids) : couleur saturee et non verte = personne.
        x = np.asarray(img.resize((mw, mh), Image.BILINEAR), dtype=np.float32) / 255
        chroma = x.max(2) - x.min(2)
        vert = np.minimum(x[..., 1] - x[..., 0], x[..., 1] - x[..., 2])
        return (1 / (1 + np.exp(-(60 * (chroma - 0.2) - 200 * np.maximum(vert, 0))))).astype(np.float32)
