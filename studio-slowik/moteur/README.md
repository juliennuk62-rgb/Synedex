# Studio SLOWIK Détourage — logiciel Windows (moteur local)

Le logiciel est l'application du site (dossier parent), servie sur l'ordinateur par un petit
serveur Python qui calcule aussi l'IA de groupe avec PyTorch sur la carte graphique (NVIDIA
conseillée). Rien ne sort de l'ordinateur : le serveur n'écoute que 127.0.0.1.

- `lancer.py` : démarre le serveur (port 47321) et ouvre l'interface dans une fenêtre Edge ou
  Chrome en mode application. `--serveur` : sans fenêtre ; `--test` : modèle de test sans poids.
- `slowik_moteur/serveur.py` : fichiers de l'interface et API (`/api/etat`, `/api/installer`,
  `/api/masque`).
- `slowik_moteur/modeles.py` : BiRefNet HR-matting (chaises gardées) et dynamic (chaises retirées),
  2048 px, photo + miroir, demi-précision sur carte graphique. Poids téléchargés et vérifiés
  (SHA-256) depuis les publications officielles du projet BiRefNet, dans
  `%LOCALAPPDATA%\StudioSlowik\modeles`.
- `birefnet/` : code du modèle BiRefNet (licence MIT, voir `PROVENANCE.txt`).
- `installation/` : installateur Inno Setup, fabriqué par GitHub (`.github/workflows/logiciel.yml`)
  avec un Python portable ; PyTorch (CUDA) est installé au premier lancement (`dependances.ps1`).

Développement : `pip install -r requirements.txt` puis `python lancer.py --serveur`.
