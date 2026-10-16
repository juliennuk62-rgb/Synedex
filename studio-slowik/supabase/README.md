# Studio SLOWIK : base de données en ligne

Projet Supabase **séparé** de celui de Synedex. Les fichiers SQL sont numérotés : on les exécute dans l'ordre, chacun **une seule fois**. - `01_comptes_ecoles.sql` : comptes, accès, carnet d'écoles.
- `02_facturation.sql` : vos coordonnées et les factures.

Le **choix des fonds des photos de groupe** n'utilise pas cette base : il fonctionne sur l'appareil, sans compte ni Internet.

## Installation (10 minutes)

1. **Créer le projet** sur supabase.com (offre gratuite), nom `studio-slowik`, région *Paris (eu-west-3)*. Notez le mot de passe de la base dans un endroit sûr.
2. **Mettre votre e-mail** dans la dernière section du fichier `01_comptes_ecoles.sql` (remplacer `votre-email@exemple.com`). Vous serez l'administrateur.
3. **Exécuter le fichier** : *SQL Editor > New query*, coller tout le contenu de `01_comptes_ecoles.sql`, puis *Run*. Le message attendu est « Success. No rows returned ».
4. **Adresse du site** : *Authentication > URL Configuration*
   - *Site URL* : `https://juliennuk62-rgb.github.io/Synedex/studio-slowik/`
   - *Redirect URLs* : ajouter la même adresse.
   Les liens des e-mails (confirmation, mot de passe oublié) ramèneront sur le site.
5. **Récupérer les clés** : *Project Settings > API* (ou *Data API*), copier `Project URL` et la clé `anon public`.
6. **Les coller dans `studio-slowik/js/config.js`** (ou me les envoyer, je fais la modification) :
   ```js
   supabaseUrl: 'https://xxxxxxxx.supabase.co',
   supabaseAnonKey: 'eyJhbGciOi...',
   ```
   Cette clé est faite pour être publique : la sécurité repose sur les règles de la base. Ne communiquez **jamais** la clé `service_role`.
7. **Créer votre compte** : ouvrir le site, « Première connexion : créer mon accès », avec l'e-mail de l'étape 2. Cliquer sur le lien reçu par e-mail, puis se connecter.

## Facturation (fichier 02)

Exécutez `02_facturation.sql` comme le 01 (*SQL Editor > New query > Run*). Ensuite, sur le site : onglet **Facturation > Mes coordonnées** pour compléter l'adresse et le SIRET.

- Numéro de facture : la date (AAAAMMJJ), puis -2, -3 pour les factures suivantes du même jour.
- Commission **versée** à l'établissement = CA × taux de l'école ; votre part = CA − commission. Calculé par la base.
- Une facture émise ne peut plus être modifiée : on l'annule et on en fait une nouvelle.
- Chaque école voit ses factures (non annulées) dans « Mon espace ».

## Donner un accès à une école

Onglet **Écoles** > choisir l'école > *Accès en ligne* > saisir l'e-mail > *Donner l'accès*.
La personne va sur le site, clique sur « Première connexion : créer mon accès » et utilise cet e-mail. Toute autre adresse est refusée.
*Retirer* coupe l'accès immédiatement.

## Sécurité

- Seuls les e-mails autorisés peuvent créer un compte.
- Une école ne voit **que sa propre fiche**. Elle ne peut rien modifier.
- Vous (admin) voyez et modifiez tout.
- Les visiteurs non connectés ne voient rien.

## E-mails

L'offre gratuite de Supabase envoie peu d'e-mails par heure (confirmation, mot de passe oublié). C'est suffisant pour quelques écoles. Pour un envoi plus large, on pourra brancher plus tard un service d'e-mails (*Authentication > Emails > SMTP Settings*).
