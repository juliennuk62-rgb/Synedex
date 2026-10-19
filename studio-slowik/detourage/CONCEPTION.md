# Détourage fond vert — Lot 0 : conception (à valider)

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
| 1 | Chaîne de détourage (étapes 1 à 9, sans IA) et écran Réglage |
| 2 | Lot complet, reprise, galerie de contrôle, score de confiance |
| 3 | IA, retouche au pinceau, masques de zone, spécificités des groupes |
| 4 | Exports, intégration à Studio SLOWIK, carte graphique |
| 5 | Mesures sur photos réelles, réglages par défaut calibrés |
