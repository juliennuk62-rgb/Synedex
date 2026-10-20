# Détourage fond vert — conception

Application dédiée au détourage des portraits et des photos de groupe pris sur fond vert.
Elle se trouve dans `studio-slowik/detourage/`. Le compositeur actuel de Studio SLOWIK reste
en place.

## Décisions prises avec Julien (19/10/2026)

| Sujet | Décision |
|---|---|
| Fichiers sources | JPEG et TIFF (8 et 16 bits) |
| Ombres au sol (groupes) | Toujours supprimées |
| Intelligence artificielle | Oui, hors ligne, dans le navigateur |
| Compositeur actuel | Conservé, les deux outils coexistent |

## 1. Forme et architecture

- Une page web séparée, installable et hors ligne : `studio-slowik/detourage/index.html`,
  avec le même service worker. On l'ouvre depuis l'onglet « Détourage » de Studio SLOWIK.
- Elle reprend le système de design (`css/style.css`) et les outils existants : `utils.js`,
  `images.js` (lecture TIFF par UTIF), `fsa.js` (dossiers, pas d'écrasement) et `naming.js`.
- Chrome / Edge sur PC (File System Access API). Sur tablette, la page sert uniquement à
  consulter et valider les résultats.

```
detourage/
  index.html
  js/
    pipeline/
      analyse-fond.js   échantillonnage du vert, carte d'éclairage du fond, alertes
      cle.js            masque par différence de couleur (espace YCbCr normalisé)
      trimap.js         zones sûr fond / sûr sujet / incertain (+ masque IA)
      matting.js        affinage de l'alpha dans la zone incertaine (guided filter)
      despill.js        suppression du reflet vert, protection des tons chair
      affinage.js       érosion/dilatation, adoucissement, îlots et trous
      score.js          score de confiance et motifs de doute
      gpu/              shaders WebGL2 des étapes pixel à pixel (lot 4)
    ia/
      segmentation.js   onnxruntime-web (WebGPU, puis WASM en secours)
    worker/
      detourage-worker.js   une photo complète, découpée en tuiles si besoin
    data/
      seance.js         état d'une séance (IndexedDB) : réglages, retouches, statuts
      prereglages.js    préréglages nommés, import/export en fichier
    ui/
      seance.js  reglage.js  lot.js  retouche.js
  vendor/
    onnxruntime-web/  (fichiers WASM, licence MIT)
    modeles/          (modèle de segmentation et sa licence)
```

## 2. Chaîne de détourage (une photo)

1. **Lecture** : JPEG (orientation EXIF appliquée) ou TIFF 8/16 bits. Calcul en flottant,
   profil couleur repris dans les métadonnées à l'export.
2. **Analyse du fond**, sur une copie réduite au 1/4 :
   - pixels « franchement verts » pris en bordure, puis étendus ;
   - couleur de clé = médiane de ces pixels ;
   - carte d'éclairage = surface lisse ajustée sur ces pixels (polynôme de degré 2,
     ou flou très large), qui capte le vignetage, le dégradé et les plis ;
   - alertes : fond trop sombre, trop bleu, trop inégal, sujet trop près du fond.
3. **Normalisation** : chaque pixel est divisé par la carte d'éclairage. Un fond inégal
   devient uniforme, et une ombre au sol (vert sombre) redevient « du vert ». C'est ce qui
   supprime les ombres, comme décidé.
4. **Clé par différence de couleur** (principe de Keylight) :
   `écart = G' − max(R', B')` ou distance chromatique en YCbCr. Deux seuils doux donnent
   le *masque cœur* (sûr) et le *masque bord*.
5. **IA** : masque « personne » basse définition, agrandi au format de la photo. Il ne
   sert qu'à corriger le trimap : un vêtement vert ou une peluche verte DANS la silhouette
   IA est forcé en « sujet ». L'IA ne découpe jamais seule.
6. **Trimap** : sûr fond / sûr sujet / bande incertaine autour du bord. La largeur de la
   bande dépend de la taille de l'image.
7. **Matting** : dans la bande incertaine seulement, guided filter (He et al.) guidé par
   l'image. Il donne des cheveux fins semi-transparents au lieu d'un bord dur.
8. **Despill** : limitation `G ≤ max(R,B)` ou `G ≤ (R+B)/2`, réglable. Appliqué
   surtout là où alpha < 1 et sur les reflets. Les tons chair sont protégés et la teinte
   retirée peut être remplacée par celle du futur fond.
9. **Affinage** :
   - érosion / dilatation et adoucissement en pixels relatifs (même rendu en aperçu
     et en pleine taille) ;
   - suppression des îlots isolés et rebouchage des trous dans le sujet (composantes
     connexes) ;
   - masque de zone dessiné une fois par série (bancs, chaises).
10. **Score de confiance** (0–100), avec le motif affiché :
    - part de vert restant dans le sujet ;
    - désaccord entre la clé et l'IA ;
    - largeur de la zone incertaine ;
    - nombre d'îlots ;
    - fond non conforme.
11. **Sortie** :
    - PNG transparent dans `Détourés/<classe>/`, sans jamais écraser ;
    - option masque seul (niveaux de gris) ;
    - journal CSV de la séance.

Les photos de groupe jusqu'à 45 Mpx sont traitées en tuiles de 2 048 px qui se
chevauchent de 64 px, pour éviter les coutures. La carte d'éclairage et le masque IA sont
calculés une seule fois sur l'image entière réduite.

## 3. Modèle d'IA proposé

| Modèle | Licence | Poids | Usage | Avis |
|---|---|---|---|---|
| **MODNet** (portrait matting) | Apache 2.0 | ≈ 25 Mo (≈ 7 Mo quantifié) | portraits | **retenu pour les portraits** |
| **MediaPipe Selfie Multiclass** | Apache 2.0 | ≈ 16 Mo | cheveux / peau / vêtements | retenu en option : il repère les **vêtements** verts |
| U²-Net human seg | Apache 2.0 | ≈ 170 Mo | personnes | trop lourd |
| BiRefNet | MIT | ≥ 170 Mo | général | trop lourd pour un PC portable |
| RMBG 1.4 / 2.0 (BRIA) | non commercial | — | — | **exclu** (licence) |

Pour les groupes, le modèle travaille sur des tuiles autour de chaque silhouette, repérées
par la clé couleur. Au lot 1, le choix final sera fait par **mesure** sur vos photos
(qualité et temps). Budget total visé pour l'IA : 40 Mo au plus, téléchargés une seule fois
puis gardés hors ligne. L'application reste utilisable sans l'IA (case à cocher).

## 4. Écrans (maquette)

```
SÉANCE      [Dossier photos]  [Dossier export]  Type : (•) Portraits ( ) Groupes
            Préréglage : [Studio classe ▾]   IA : [x]       [Commencer →]

RÉGLAGE     ┌ Original ┐┌ Masque ┐┌ Damier ┐┌ Sur fond ┐   Photos témoins : ◉ ○ ○
            Essentiel : Tolérance ▬▬●▬  Bord ▬●▬▬  Reflet vert ▬▬▬●
            ▸ Avancé (12 réglages)   Loupe 100 % / 200 %   [Enregistrer le préréglage]

LOT         ███████████░░░░ 312 / 540 — reste ≈ 6 min   [Pause] [Annuler]
            Filtres : À vérifier (14) · Validées · Retouchées
            [vignette 42 ⚠ vêtement vert] [vignette 17 ⚠ cheveux] …

RETOUCHE    Pinceaux : Garder · Retirer · Affiner le bord   Taille ● Dureté ●
            Ctrl+Z / Ctrl+Y   [Appliquer aux suivantes de la classe]  [Valider ✓]
```

## 5. Performances visées

- Portrait 24 Mpx : 1,5 s au plus. Groupe 45 Mpx : 6 s au plus. Aperçu des réglages :
  moins de 150 ms.
- Étapes pixel à pixel sur la carte graphique (WebGL2) au lot 4 ; JavaScript optimisé
  avant cela.
- Mémoire limitée à 2 Go. Nombre de workers = min(4, cœurs − 1, mémoire / 2).

## 6. Tests

- Images de synthèse (`npm test`) :
  - fond dégradé, ombre au sol, cheveux simulés par des traits de 1 px, vêtement vert ;
  - chaque filtre comparé à une version de référence simple.
- Jeu réel : 20 à 30 photos difficiles fournies par Julien, avec des masques de
  référence. Mesures d'erreur (SAD / MSE, bords) comparées au compositeur actuel.

## 7. Lots

| Lot | Contenu |
|---|---|
| 1 ✅ | Chaîne de détourage (étapes 1 à 9, sans IA) et écran Réglage |
| 2 ✅ | Lot complet, reprise, galerie de contrôle, score de confiance |
| 3 ✅ | IA, retouche au pinceau, masques de zone, spécificités des groupes |
| 4 ✅ | Exports, intégration à Studio SLOWIK, carte graphique |
| 5 | Mesures sur photos réelles, réglages par défaut calibrés |

## Avancement

### Lot 1 (fait)

- Chaîne complète dans `js/pipeline/` : analyse du fond (`fond.js`), clé par différence de couleur
  avec suppression des ombres (`cle.js`), affinage des bords par filtre guidé couleur (`matting.js`),
  décontamination et reflet vert (`despill.js`), taches / trous / contour (`detourage.js`, `outils.js`).
- Écran Réglage : photos témoins choisies automatiquement (claire, sombre, cheveux), 4 vues,
  avant / après, loupe 100 % / 200 % en pleine définition, préréglages (enregistrer, exporter,
  importer), export PNG transparent.
- Mesures (image de synthèse 900 × 675, transparence exacte connue) :

  | | Compositeur actuel | Détourage avancé |
  |---|---|---|
  | Erreur moyenne de transparence | 2,03 ‰ | 0,52 ‰ |
  | Erreur sur les bords (MSE) | 0,097 | 0,003 |
  | Mèches fines conservées (alpha moyen, vérité 0,28) | 0,06 | 0,26 |

- Temps (environnement de test, sans carte graphique) : photo 24 Mpx ≈ 3,5 s, aperçu 1 280 px ≈ 0,3 s.
  Objectifs (1,5 s et 150 ms) visés au lot 4 (carte graphique, filtre guidé sous-échantillonné).
- Correctif après essais de Julien : lueurs rouges autour des cheveux bruns. Cause : la compression
  JPEG mélange la teinte des bords fins avec le vert ; le démixage l'amplifiait. Correction :
  démixage plafonné (opacité 0,4) et nouveau réglage « Couleur des bords prise dans le sujet » (80 par
  défaut). Mesure : lueur 3,54 → 0,08 (test « pas de lueur rouge »).
- Limites : TIFF 16 bits lus en 8 bits ; vêtement vert encore retiré (IA au lot 3) ; tests sur
  images de synthèse uniquement (photos réelles au lot 5).

### Lot 2 (fait)

- Écran « Traitement par lot » (onglet 2) : dossier des photos (sous-dossiers = classes), dossier
  d'export, lancement, pause, arrêt, temps restant. Calcul en parallèle (1 à 4 workers selon la
  machine, 2 au plus pour les groupes).
- Sorties : `Détourés/<classe>/<photo>.png`. Un fichier déjà présent n'est jamais écrasé (`-2`).
  « Refaire » range l'ancienne version dans `Détourés/_anciennes versions/`.
- État de la séance dans `Détourés/.seance-detourage.json` et vignettes dans `Détourés/.vignettes/` :
  reprise après fermeture du navigateur, ou depuis un autre ordinateur. « Reprendre » propose la
  dernière séance (dossiers mémorisés par le navigateur).
- Score de confiance (`js/pipeline/score.js`, seuil 75) et motifs : fond (alertes), sujet absent,
  vert conservé, grandes transparences, buste retiré (portraits), zone verte sombre, trous, taches.
- Galerie : les plus douteuses d'abord, filtres (à vérifier, validées, erreurs), valider, ouvrir
  dans l'écran Réglage, refaire (une photo ou toutes celles affichées).
- Journal `Détourés/journal-detourage.csv` (Excel) écrit à la fin de chaque traitement.
- Limite : un vêtement de la même couleur que le fond n'est détecté que par sa forme (buste retiré) ;
  l'IA du lot 3 le protégera.

### Lot 3 (fait)

- IA hors ligne : MODNet (Apache 2.0, 6,6 Mo) exécuté par ONNX Runtime Web (MIT, carte graphique si
  WebGPU, sinon processeur). Téléchargée à la première utilisation (28 Mo) puis gardée dans un cache
  à part, conservé d'une version de l'application à l'autre. Licences : `ia/LICENCES.txt`.
- Fusion (`js/pipeline/ia.js`) : l'IA ne découpe jamais seule. Elle rend opaque l'intérieur des
  personnes (masque lissé, marge de 2 pixels), uniquement dans les zones qui recouvrent déjà du sujet
  trouvé par la clé (une forme « inventée » dans le fond est ignorée). Le reflet vert n'est pas
  retiré dans les zones protégées (le vêtement reste vert). Réglage « Protection des personnes par
  l'IA » (0 = désactivée). Photos de groupe : modèle appliqué en plus grand (768 px au lieu de 512).
- Score : motif « Vert gardé grâce à l'IA », pour vérifier le contour.
- Pinceau (`js/pipeline/retouches.js`) : Garder, Retirer, Affiner le bord. Taille, dureté,
  Ctrl+Z / Ctrl+Y. Portée : cette photo, toute la classe, toute la séance (masque de zone pour un
  banc, une chaise ou un pied de lampe, dessiné une fois). Les traits sont indépendants de la
  définition et gardés dans le navigateur (par dossier de photos).
- Lot : retouches appliquées, filtre « Retouchées ».
- Mesures (photo réelle, combinaison recolorée exactement du vert du fond, cas extrême) :
  sans IA 1 % de la combinaison gardée, avec IA 54 % ; fond retiré à 99,6 %. Le reste se complète
  au pinceau « Garder » ; la photo est marquée « à vérifier ». Un vêtement vert d'une teinte
  différente du fond (cas courant) est bien mieux reconnu.
- Temps : IA ≈ 3 à 4,5 s par photo sur processeur (environnement de test) ; bien moins avec WebGPU.
- Limites : photos de groupe toujours traitées en une fois (pas en tuiles) ; IA testée sur une seule
  photo réelle (photos de Julien au lot 5).

### Lot 4 (fait)

- Vitesse, mêmes résultats (mesures sur une image de 27 Mpx, environnement de test, processeur seul) :
  4,1 s → 2,3 s par photo, précision inchangée (erreur moyenne 0,54 ‰ → 0,55 ‰).
  - filtre guidé « rapide » (coefficients calculés 4 fois plus petit, seulement pour les grands
    rayons) : 1,2 s → 0,4 s ;
  - bande des bords calculée sur une grille réduite : 0,5 s → 0,1 s ;
  - analyse du fond sur un pixel sur 4 : 0,34 s → 0,07 s ;
  - score de confiance sur une version de 1 500 px : 0,64 s → 0,12 s.
- Carte graphique (`js/pipeline/gpu.js`, WebGL2) : clé et couleurs du sujet calculées par la carte
  graphique pour les photos de 4 Mpx et plus. Mêmes résultats que le processeur (1 niveau sur 255
  d'écart au plus, testé). Jamais utilisée si la carte est simulée par logiciel (plus lente).
  Gain non mesurable ici (pas de carte graphique dans l'environnement de test).
- Exports (onglet Lot) : PNG transparents, masques seuls (dossier « Masques »), photos posées sur des
  fonds (dossier « Sur fonds », noms `{Projet}{n}_{Fond}` ou `{Photo}_{n}_{Fond}` comme le compositeur,
  n = numéro de la photo dans sa classe ; remplir / étirer / contenir ; JPEG, PNG ou WebP).
  Reprise : une photo est refaite si les exports demandés ont changé (anciens fichiers rangés dans
  `_anciennes versions/`).
- Métadonnées (`js/pipeline/meta.js`) : résolution (dpi) relue (JFIF, Exif, PNG, TIFF) et réécrite
  dans les PNG et JPEG. Couleurs : JPEG et PNG convertis en sRGB par le navigateur (standard des
  laboratoires) ; TIFF : profil d'origine (Adobe RGB…) remis dans les fichiers. WebP : sans dpi.
- Intégration : « Ouvrir les PNG dans le compositeur » (dossier « Détourés » en sources, fond vert
  désactivé, sous-dossiers = classes) et « Envoyer au choix des fonds » (photos de groupe : une classe
  chacune). Passage par `js/data/envoi.js` (IndexedDB).
- Limites : objectif 1,5 s par photo de 24 Mpx atteint seulement avec une carte graphique (à mesurer
  sur le PC de Julien) ; photos posées sur des fonds en sRGB même pour une source TIFF Adobe RGB.

### Lot 5 (en cours) : réglage sur les photos de Julien

Les photos réelles restent sur l'ordinateur de travail ; elles ne sont jamais ajoutées au dépôt
(public).

- Photos 1 et 2 (cheveux longs blond foncé et blonds bouclés, lunettes, dentelle, chemisier ajouré) :
  silhouette, lunettes et vêtements corrects, score 100 et 95.
- Défaut trouvé : teinte vert-olive dans les mèches blondes au bord (le reflet vert « Standard »
  laisse le vert au niveau du rouge). Corrections :
  - méthode du reflet vert « Forte » par défaut (ne touche ni la peau ni les cheveux, plus rouges
    que verts) ;
  - reflet vert local : près du contour, un pixel n'est jamais plus vert que le sujet plein voisin
    (bords semi-transparents et pixels opaques du contour ; l'intérieur du sujet n'est pas touché).
- Mesure (pixels verdâtres dans une bande de 20 px autour du sujet, photo 2) : 10,2 % sans
  correction, 1,98 % avec les réglages du lot 4, 0,35 % maintenant. Test automatique sur cheveux
  blonds de synthèse : 42 % → 0,02 %.
- Retour de Julien sur la photo 2 (« pas réglé pour elle ») : taches de fond vert gardées entre les
  boucles et mèches vert pâle sur l'épaule et le bras. Causes et corrections :
  - l'IA englobait les trous de fond entre les boucles et y empêchait le retrait du reflet vert :
    elle ne protège plus que les grandes zones qu'elle ajoute (vêtement vert) ; ailleurs (cheveux, peau), le reflet vert est retiré normalement ;
  - « Trous à boucher » remplissait aussi ces trous de fond : 0 par défaut ;
  - mèches fines traversées par la lumière du fond (couleur kaki) : près du contour, un pixel dont la
    couleur est un mélange entre les cheveux voisins et le fond voit son vert ramené au niveau des
    cheveux (rouge et bleu gardés). Les couleurs qui ne sont pas un tel mélange (dentelle jaune)
    ne bougent pas. Même calcul sur la carte graphique.
  - Pixels de fond vert gardés (opacité > 50 %, nettement verts) : 1 024 → 0.
- Série suivante (4 portraits, 1 groupe) :
  - cheveux frisés blonds et auburn : la frange gris-vert ou olive des boucles devient dorée. Le
    mélange cheveux/fond est maintenant corrigé sur une bande de 2,5 % du grand côté autour des bords
    semi-transparents (au lieu de quelques pixels), seulement quand la couleur est bien un mélange
    entre les cheveux voisins et le fond ; le maillot et la peau ne bougent pas ;
  - fond sombre dans un coin (portrait) : l'IA le prenait pour la personne (environ 1 % de l'image).
    Taille minimale d'une zone ajoutée par l'IA : 2 % de l'image pour un portrait (la combinaison
    verte de la photo d'essai fait 12 %), 0,4 % pour une photo de groupe (sujets plus petits) ;
  - photo de groupe dont le fond vert ne couvre que le haut du cadre : la clé ne retire que le vert,
    la salle reste (score 70, « à vérifier »). L'IA seule ne suffit pas pour séparer les élèves de
    la salle : sur cette photo elle colle le sol aux élèves et en perd une partie. Pour les groupes,
    le fond doit couvrir tout le cadre derrière et autour des élèves.

### Lot 6 (fait) : détourage hors du fond vert (photos de groupe)

Besoin : photo de groupe dont le fond vert ne couvre que le haut du cadre (salle, fenêtres, sol
visibles autour des élèves). La clé verte ne retire que le vert ; il faut aussi retirer la salle.

- IA de groupe : BiRefNet « general » (licence MIT), comparé sur la photo réelle à MODNet (perd des
  élèves, colle le sol), ISNet (élèves à moitié transparents), BiRefNet « lite », « massive » et
  « HRSOD » : « general » est le plus net et garde le moins de morceaux de banc.
- Installation séparée (bouton « Installer l'IA de groupe », écran Réglage) : 510 Mo en 6 morceaux
  de 99 Mo (limite de GitHub), vérifiés un par un (SHA-256), gardés hors ligne (cache
  `ia-slowik-1`, stockage persistant demandé). Un morceau abîmé est refusé.
- Préparation du modèle, sans changer le résultat (écart mesuré sur la photo réelle : 4/255 au
  plus) : poids en demi-précision (973 → 510 Mo), calcul en pleine précision ; découpages et
  assemblages de plus de 7 morceaux (jusqu'à 1 024) remplacés par des cascades (WebGPU : 8 tableaux
  au plus par opération) ; GatherND (convolutions déformables du décodeur) et Sum, absents de la
  carte graphique dans onnxruntime-web 1.20, remplacés par Gather sur le tableau aplati et des Add :
  sinon calculés par le processeur, avec des tableaux de 800 Mo qui dépassent la mémoire du
  navigateur (mesuré : échec du calcul, 2,8 Go → 1,1 Go de mémoire du navigateur après correction).
  Scripts dans `scripts/`.
- Calcul sur la carte graphique (WebGPU) obligatoire : sur le processeur, le navigateur dépasse sa
  limite de 4 Go de mémoire (message clair). Environ 6 Go de mémoire pendant le calcul.
- Photo entière et son miroir (moyenne), lue à 2048 px au plus. Un seul calcul à la fois, dans un
  calcul en arrière-plan dédié (un seul exemplaire du modèle en mémoire), partagé par l'écran
  Réglage et le traitement par lot.
- Tuiles de détail (4 morceaux agrandis ×1,7) essayées puis retirées : sur la 2e photo de groupe de
  Julien (6720 × 4480, carte graphique : 6 passes en 30 s), une tuile qui coupe une personne à
  mi-corps ne la reconnaît plus ; le raccord laissait des dégradés gris (visage et jambes à moitié
  transparents, marches d'escalier sur une manche). Sans tuiles : contours nets, 2 passes.
- Défaut trouvé sur cette photo : la passe en miroir n'était pas remise à l'endroit dans
  l'application (le prototype le faisait) ; le masque mélangeait la photo et son reflet (visage
  fantôme, zones grises). Corrigé ; le test place une personne sans symétrique et compare le masque
  aux vraies personnes (19 % de pixels faux avec le défaut, 0,02 % sans).
- « L'IA ne fonctionne pas du tout » sur une 3e photo, sans message : l'erreur de la carte
  graphique était avalée (repli sur le processeur, qui échoue toujours avec ce modèle). Désormais :
  l'erreur de la carte est donnée telle quelle ; bouton « Tester l'IA de groupe » (navigateur, carte,
  limites, chargement du modèle, une passe chronométrée) avec un rapport à copier ; la carte la plus
  puissante est demandée (PC à deux cartes).
- Combinaison (`js/pipeline/groupe.js`) :
  - près du fond vert visible, la clé (mèches fines, reflet vert retiré), limitée à la silhouette
    de l'IA ; un pixel sans vert suit l'IA (2 à 3 pixels près) ;
  - la zone de la clé s'arrête là où le fond visible n'est plus vert : sur la photo réelle, les
    pieds du support du fond et le bord de la fenêtre étaient gardés à côté des élèves (corrigé) ;
  - ailleurs, l'IA, affinée sur l'image (filtre guidé) ; protection des vêtements verts par la
    même IA (MODNet n'est plus utilisé) ;
  - couleurs hors du fond vert : pixels pleins d'origine (pas de correction de vert sur un
    vêtement vert devant la salle), bords : couleur de la salle juste derrière retirée.
- Réglage « Détourer aussi hors du fond vert » : Non / Auto / Toujours (Auto par défaut pour les
  groupes). Auto : seulement si moins de la moitié du tour de l'image est du fond vert (mesure
  `bordVert` de l'analyse) ; portraits et groupes devant un grand fond ne changent pas.
- Score : les alertes « peu de fond vert » ne comptent plus quand l'IA de groupe détoure ; motif
  « Détourage par l'IA hors du fond vert : vérifiez les pieds, chaises et bancs » (−5).
- Photo réelle (2000 × 1333, 31 personnes) : salle, sol, radiateur, fenêtres retirés ; cheveux du
  rang du haut sans liseré vert ; restent quelques pieds de banc sous les élèves (pinceau
  « Retirer »). Score 80.
- Vérifié sur carte graphique simulée (WebGPU logiciel, onnxruntime-web 1.20.1) avec la version
  « lite » préparée de la même façon (mêmes opérations) : aucune erreur, résultat identique au
  processeur (écart 0,02/255). Limites : la durée par photo n'est pas mesurée sur une vraie carte
  (simulation : 28 min par passe) ; mesurée chez Julien : 5 s par passe environ. Test automatique avec un petit modèle de même
  forme (`tests/mocks/ia-groupe/`).
