# Studio SLOWIK

Outil en ligne pour la photo scolaire (indépendant du jeu Synedex), sans installation.

- **Adresse** : `https://juliennuk62-rgb.github.io/Synedex/studio-slowik/`
- **Navigateur** : Google Chrome ou Microsoft Edge sur ordinateur (accès aux dossiers du PC).
- **Photos** : elles sont traitées dans le navigateur et ne sont jamais envoyées sur Internet.
- **Choix des fonds des photos de groupe** : onglet « Choix des fonds », sur ordinateur, tablette ou téléphone. Tout est enregistré sur l'appareil (aucun compte, aucune base en ligne). Bouton « Sauvegarder (fichier) » pour garder une copie.
- **Hors ligne** : après une première ouverture avec Internet, le site s'installe (bouton « Installer l'application ») et s'ouvre sans connexion. Le compositeur fonctionne alors entièrement. Les écoles, les photos de groupe et la connexion demandent Internet.
- **Projets récents et réglages** : enregistrés dans le navigateur de l'ordinateur utilisé.
- **Listes d'élèves** : onglet « Listes d'élèves », aussi sur téléphone. Photo de la liste de classe → nom et prénom de chaque élève trouvés automatiquement (lecture Tesseract dans le navigateur, la photo n'est envoyée nulle part ; colonnes date, sexe, numéro ignorées). Chaque nom est affiché à côté de l'extrait de la feuille, les lectures incertaines sont en orange, une ligne mal lue n'est jamais sautée. Liste enregistrée sur l'appareil et, connecté, retrouvée sur vos autres appareils (`supabase/04_listes_eleves.sql`).
- **Photo de classe** : onglet « Photo de classe » (Chrome / Edge sur ordinateur). Chaque groupe détouré (PNG transparent, une par classe) est posé sur chaque fond du dossier des fonds de classe : tirage 24 × 18 cm paysage, JPEG 300 dpi. Le groupe est calé automatiquement sur ses 4 bords (poussières du détourage ignorées) dans des marges de 3 cm (4,5 cm en bas), sans déformation ; établissement à gauche et année scolaire (calculée, modifiable) à droite, à 3 cm du bas. Marges, texte, police et couleur réglables, aperçu avec repères.
- **Renommer** : onglet « Renommer » (Chrome / Edge sur ordinateur). Les photos d'un dossier prennent, dans l'ordre de leur nom de fichier, les noms d'une liste (collée ou enregistrée). Jamais d'écrasement, dernier renommage annulable.
- **Détourage avancé** (`detourage/`, lien dans le compositeur) : détourage fond vert de qualité pour portraits et groupes (cheveux, ombres au sol, fond inégal, reflet vert), réglé sur des photos témoins, puis traitement de toute une séance (PNG transparents par classe, reprise, galerie de contrôle triée par score de confiance), IA hors ligne qui protège les vêtements verts, retouche au pinceau, exports sur fonds avec dpi conservés, envoi direct au compositeur et au choix des fonds. Conception et lots : `detourage/CONCEPTION.md`.

## Organisation du code

- `index.html`, `css/style.css` : la page.
- `js/core/` : détourage, lecture des images (dont TIFF), noms de fichiers, accès aux dossiers.
- `js/data/` : sauvegardes locales.
- `js/ui/` : écrans.
- `js/worker/` : export par lot en arrière-plan.
- `js/vendor/` : lecteur TIFF (UTIF.js, pako), supabase-js et lecteur de texte (`ocr/` : Tesseract.js, français), licences dans `LICENSES.txt`.
- `sw.js`, `manifest.webmanifest`, `icons/` : installation et fonctionnement hors ligne. Après toute modification, lancer `node scripts/build-sw.mjs` : il régénère la liste des fichiers et la version (`--check` pour vérifier).
- `detourage/` : module de détourage avancé. `ia/` : moteur et modèle d'IA (non préchargés, licences dans `ia/LICENCES.txt`). `js/pipeline/` (calculs, sans dépendance à la page), `js/worker/` (calculs en arrière-plan), `js/ui/` (écran), `css/` (styles propres au module).
- `js/core/utils.js` : outils communs (gabarits HTML protégés `html`, fenêtres de confirmation, messages, téléchargement, formats français).

## Tests

`npm install` puis `npm test` (ou `node tests/run.mjs`) : 22 tests de bout en bout dans Chromium, avec une base en ligne simulée.
Ils couvrent le compositeur, le mode hors ligne, les comptes et écoles, le choix des fonds, la planche de demande, la facturation, la planche contact, la synchronisation et le détourage avancé (précision mesurée sur une image de synthèse dont la transparence exacte est connue, temps de calcul sur 24 Mpx).
`node tests/run.mjs facturation` ne lance que les tests dont le nom contient « facturation ».
Avant chaque mise en ligne : `node scripts/build-sw.mjs` puis `npm test`.
