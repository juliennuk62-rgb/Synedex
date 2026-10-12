# Synedex : base de données Supabase

Un seul fichier à exécuter : `synedex_schema.sql`. Il crée tout : tables, règles du jeu côté serveur, sécurité, stockage des photos, temps réel et historique des cours.

## Installation (10 minutes)

1. **Créer le projet** sur supabase.com (offre gratuite) et choisir la région *Paris (eu-west-3)*.
2. **Activer pg_cron** : *Database > Extensions*, chercher `pg_cron`, activer. Il sert à enregistrer l'historique des cours chaque minute.
3. **Mettre ton e-mail** dans la dernière section du fichier (`ton-email@exemple.com`), c'est le premier admin.
4. **Exécuter le fichier** : *SQL Editor > New query*, coller tout le contenu, puis *Run*. Il est fait pour être exécuté une seule fois, sur un projet vide.
5. **Connexion** : *Authentication > Providers*, laisser *Email* activé (lien magique ou mot de passe).
6. **Récupérer les clés** pour l'appli : *Project Settings > API*, noter `Project URL` et la clé `anon public`.
7. **Inscris-toi dans l'appli** avec ton e-mail : ton profil admin est créé automatiquement.

## Inviter les amis

Le jeu est **sur invitation** : seuls les e-mails de la table `allowed_emails` peuvent s'inscrire. Toute autre inscription est refusée.

- Depuis l'appli (admin) : `supabase.rpc('invite_player', { p_email, p_name, p_admin })`
- Ou à la main : *Table Editor > allowed_emails > Insert row*

## Ce que contient la base

| Table | Rôle |
|---|---|
| `config` | Tous les réglages : boosters (15 min, réserve 20), taux, jauge (500), shiny (1 %), fusion, bourse, barème du classement, design. Modifiable sans toucher au code. |
| `allowed_emails` | Liste des invités. |
| `profiles` | Un joueur : pseudo, admin, solde d'Éclats, jauge, boosters. |
| `groups` | Les collections (synergies). |
| `cards` | Les cartes : titre, texte, rareté, collection, photo, statut (en attente, validée, refusée). |
| `inventory` | Qui possède quoi, normal et shiny séparés. |
| `bank_stock` | La vitrine de la banque (cartes revendues). |
| `pulls` | Historique de tous les gains : booster, fusion, échange, achat. |
| `trades`, `trade_items` | Les propositions d'échange. |
| `market_tx` | Achats et reventes à la banque. |
| `news` | Les actus qui font bouger les cours. |
| `price_history` | Historique des cours, pour les graphiques. |

Il y a aussi trois vues prêtes à lire : `leaderboard` (classement), `market_board` (tableau de la bourse avec le cours actuel et celui d'il y a 24 h) et `big_pulls` (fil des gros tirages).

## Sécurité

- Les joueurs peuvent **lire** les tables, mais **aucune écriture directe** n'est permise. Tout passe par les fonctions ci-dessous, qui vérifient les règles côté serveur. Impossible de se donner des cartes ou des Éclats depuis la console du navigateur.
- Chacun ne voit que **ses** échanges. Les cartes en attente ne sont visibles que par leur créateur et les admins.
- Les visiteurs non connectés ne voient rien.
- Les photos vont dans le bucket public `card-images`, et chaque joueur ne peut envoyer que dans son propre dossier : `<son id>/nom-du-fichier.jpg`.

## Fonctions à appeler depuis l'appli

```js
const { data, error } = await supabase.rpc('open_booster')        // → 5 lignes : slot, card_id, rarity, shiny, is_new, forced
await supabase.rpc('my_state')                                      // solde, boosters, prochain booster, jauge
await supabase.rpc('fuse', { p_cards: [id, id, id, id, id] })       // 5 doublons → 1 carte
await supabase.rpc('submit_card', { p_title, p_body, p_rarity, p_group_id, p_new_group, p_image_path })
await supabase.rpc('review_card', { p_card, p_approve: true, p_rarity, p_reason })        // admin
await supabase.rpc('propose_trade', { p_to, p_give: [{ card_id, shiny: false, qty: 1 }], p_want: [...] })
await supabase.rpc('respond_trade', { p_trade, p_accept: true })   // → 'accepted' | 'refused' | 'invalid'
await supabase.rpc('cancel_trade', { p_trade })
await supabase.rpc('market_sell', { p_card, p_shiny: false })      // → Éclats reçus
await supabase.rpc('market_buy',  { p_card, p_shiny: false })      // → Éclats payés
await supabase.rpc('publish_news', { p_title, p_target_type: 'group', p_target_id, p_pct: 0.4, p_days: 7 }) // admin
await supabase.rpc('cancel_news', { p_news })                       // admin
await supabase.rpc('update_design', { p_design: {...} })           // admin
await supabase.rpc('set_display_name', { p_name })
```

En cas de refus, `error.message` contient un message en français prêt à afficher : « Plus de booster disponible », « Pas assez d'Éclats », etc.

## Temps réel

Les tables utiles au direct sont déjà branchées sur Supabase Realtime. Exemple pour la Bourse :

```js
supabase.channel('bourse')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'market_tx' }, refresh)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'news' }, refresh)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, refresh)
  .subscribe()
```

Le cours est calculé par la fonction `market_price` avec **exactement la même formule** que le prototype : `Base × Rareté réelle × Actus × Tendance`. Le serveur fait foi au moment d'un achat ou d'une vente, et l'appli peut recalculer le cours localement entre deux mises à jour pour l'affichage en direct.

## Ce qui a été testé

Le fichier a été exécuté sur PostgreSQL 16, avec une simulation de l'environnement Supabase, et un scénario complet à 3 joueurs a été joué :

- inscription d'un non-invité refusée ;
- boosters avec structure garantie, jauge forcée à 495 (la 5e carte sort légendaire et la jauge repart à zéro), recharge après 47 minutes (+3 boosters) ;
- fusion, refusée si elle touche le dernier exemplaire ou une légendaire ;
- échange accepté, invisible pour un troisième joueur ;
- revente et rachat à la bonne marge ;
- actu à +40 %, qui ne vaut plus que +20 % à mi-parcours ;
- classement ;
- toutes les tentatives de triche bloquées (écriture directe, fonctions internes, actions admin, accès anonyme).
