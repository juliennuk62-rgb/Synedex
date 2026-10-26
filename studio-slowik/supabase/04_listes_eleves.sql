-- =====================================================================
-- Studio SLOWIK - 04 : listes d'eleves (lues sur une photo ou collees), retrouvees sur tous vos appareils
-- A executer UNE fois, apres 01. Reserve a l'admin (vous) : les ecoles n'y ont pas acces.
-- Seuls les noms et prenoms sont enregistres (jamais la photo de la feuille).
-- =====================================================================

create table listes_eleves (
  id         text primary key,                     -- identifiant cree par l'appareil
  nom        text not null default '',             -- nom de la liste (ecole, classe)
  eleves     jsonb not null default '[]'::jsonb,   -- [{ "nom": "DUPONT", "prenom": "Léa" }, ...] dans l'ordre
  created    bigint,
  updated    bigint not null,                      -- heure de la derniere modification (appareil)
  deleted    boolean not null default false,
  synced_at  timestamptz not null default now()
);

alter table listes_eleves enable row level security;
create policy "admin : tout" on listes_eleves for all to authenticated
  using (est_admin()) with check (est_admin());
