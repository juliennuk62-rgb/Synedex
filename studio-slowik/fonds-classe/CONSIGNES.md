# Fonds de photo de classe : consignes de création

À relire avant de créer ou de modifier un fond. Ces règles viennent du fonctionnement de l'onglet
« Photo de classe » (`js/core/photo-classe.js`).

## Format

- **Taille** : 2835 × 2126 px (24 × 18 cm paysage à 300 dpi), JPEG de bonne qualité, 300 dpi inscrits dans le fichier.
- Un fond d'une autre proportion est recadré au centre (`couvrir`) : on garde donc exactement 4:3.

## Où tombe le groupe

Réglages par défaut : marges de 3 cm en haut, à gauche et à droite, et de 4,5 cm en bas. Le groupe est
agrandi au maximum dans ce cadre et centré.

- **Zone du groupe** : de x = 3 à 21 cm et de y = 3 à 13,5 cm (depuis le haut). Pour un groupe large
  (cas habituel, environ 2:1), il occupe à peu près y = 3,75 à 12,75 cm.
- **Texte** : l'établissement à gauche (à partir de 3 cm) et l'année scolaire à droite, avec le milieu
  de la ligne à 3 cm du bas (y = 15 cm). La couleur est automatique (blanc ou noir selon le fond).

## Règles de dessin

1. **Centre calme** : rien de net ni de chargé derrière le groupe. Les détails forts (arbre, feuillage,
   fleurs, objets) vont dans les marges : bande du haut (y < 3,3 cm), côtés (x < 3,4 cm ou x > 20,6 cm)
   et premier plan du bas, sur les côtés.
2. **Demi-teintes derrière les têtes** : de y = 3 à 6 cm environ, ni blanc pur ni très foncé. Les cheveux
   détourés gardent un léger halo, qui se voit surtout sur un fond très clair ou très sombre.
   (Correction d'un ancien conseil : un fond vert n'est pas un problème. Un liseré vert se voit moins sur
   du vert que sur une autre couleur.)
3. **Un sol** : un sol ou une ligne d'horizon doit passer derrière le groupe (horizon vers y = 9 à 10 cm,
   sol jusqu'en bas) pour que les pieds du premier rang (vers y = 12,5 à 13,5 cm) aient un appui.
4. **Bande du texte unie** : de y = 14 à 16,5 cm, une teinte régulière, sans motif contrasté. Le sol peut
   y foncer un peu pour que le texte blanc ressorte. L'outil écrit en blanc si la luminance moyenne de
   cette bande (y = 14,6 à 15,4 cm) est sous 140/255, sinon en noir. `generer.mjs` affiche cette mesure :
   on évite les valeurs entre 125 et 155, où le choix peut basculer d'un tirage à l'autre.
5. **Lumière douce et de face** : pas d'ombres latérales marquées ni de soleil rasant, puisque le groupe
   est photographié en studio, éclairé de face.
6. **Profondeur** : le lointain est plus clair et plus bleuté que le premier plan (perspective
   atmosphérique). Un fond légèrement flou derrière le groupe est plus naturel qu'un fond net.
7. **Léger grain** sur toute l'image, pour éviter les bandes dans les dégradés à l'impression.
8. **Pas de marque, de personnage ou de logo protégé** : uniquement des décors originaux.

## Série et proposition aux familles

- Proposer environ 3 fonds par école : un classique, un original et un local.
- Une série (par exemple les saisons) garde la même composition. Seuls changent les couleurs et les détails.
- Avant de livrer, vérifier chaque fond avec un groupe témoin et le texte (`apercu-*.jpg`).

## Fichiers

- `generer.mjs` : dessine les fonds (Chromium et Playwright). `node fonds-classe/generer.mjs` depuis
  `studio-slowik/`.
- `saisons/` : série des 4 saisons, un même arbre au fil de l'année.
- Les `.jpg`, `.md` et `.mjs` de ce dossier ne sont pas mis en cache par l'application (voir `scripts/build-sw.mjs`).
