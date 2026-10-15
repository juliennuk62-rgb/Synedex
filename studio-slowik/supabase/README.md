# Studio SLOWIK : base de données en ligne

Projet Supabase **séparé** de celui de Synedex. Les fichiers SQL sont numérotés : on les exécute dans l'ordre, chacun **une seule fois**. Les suivants arriveront avec les prochaines étapes (facturation, photos de groupe).

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

## Photos de groupe (fichier 02)

Après le fichier 01, exécutez de la même façon `02_photos_groupes.sql` (*SQL Editor > New query > Run*). Il crée :
- les **fonds proposés**, les mêmes pour toutes les écoles ;
- les **groupes** : nom, saison, nombre d'adultes, photo ;
- les **choix** : un fond par adulte, jamais plus que le nombre d'adultes (le même fond peut revenir) ;
- deux espaces de stockage **privés** : `fonds` et `photos-groupes`. Une école ne voit que les photos de ses groupes.

Les images sont allégées avant l'envoi : 2000 pixels pour les photos de groupe, 1600 pour les fonds. Les originaux restent sur votre ordinateur.

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
