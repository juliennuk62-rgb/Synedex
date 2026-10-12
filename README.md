# Synedex

Jeu de cartes à collectionner privé, entre amis, sur invitation.

- **Le jeu** : `index.html`, un site autonome publié avec GitHub Pages.
- **La base de données** : `supabase/synedex_schema.sql` (Supabase). Le guide d'installation est dans `supabase/README-base-de-donnees.md`.

La clé présente dans `index.html` est la clé publique (`anon`) de Supabase. Elle est faite pour être visible : la sécurité repose sur les règles de la base, qui interdisent toute écriture directe.
