# Studio SLOWIK

Outil en ligne pour la photo scolaire (indépendant du jeu Synedex), sans installation.

- **Adresse** : `https://juliennuk62-rgb.github.io/Synedex/studio-slowik/`
- **Navigateur** : Google Chrome ou Microsoft Edge sur ordinateur (accès aux dossiers du PC).
- **Photos** : elles sont traitées dans le navigateur et ne sont jamais envoyées sur Internet.
- **Projets récents et réglages** : enregistrés dans le navigateur de l'ordinateur utilisé.

## Organisation du code

- `index.html`, `css/style.css` : la page.
- `js/core/` : détourage, lecture des images (dont TIFF), noms de fichiers, accès aux dossiers.
- `js/data/` : sauvegardes locales.
- `js/ui/` : écrans.
- `js/worker/` : export par lot en arrière-plan.
- `js/vendor/` : lecteur TIFF (UTIF.js, pako), licences MIT dans `LICENSES.txt`.
