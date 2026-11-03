-- =====================================================================
-- Studio SLOWIK - 03 : synchronisation du choix des fonds entre vos appareils
-- A executer UNE fois, apres 01 et 02. Reserve a l'admin (vous) : les ecoles n'y ont pas acces.
-- =====================================================================

-- Fonds numerotes
create table choix_fonds_sync (
  id         text primary key,                 -- identifiant cree par l'appareil
  numero     int not null,
  nom        text not null default '',
  actif      boolean not null default true,
  chemin     text,                             -- image dans le stockage prive "choix"
  created    bigint,
  updated    bigint not null,                  -- heure de la derniere modification (appareil)
  deleted    boolean not null default false,
  synced_at  timestamptz not null default now()
);

-- Classes (photos de groupe PNG) et choix
create table choix_classes_sync (
  id         text primary key,
  numero     int not null,
  fichier    text not null default '',
  nb         int not null default 1 check (nb between 1 and 30),
  choix      jsonb not null default '{}'::jsonb,   -- { id du fond : quantite }
  chemin     text,
  created    bigint,
  updated    bigint not null,
  deleted    boolean not null default false,
  synced_at  timestamptz not null default now()
);

-- Heure d'arrivee sur le serveur (sert a ne recuperer que les nouveautes)
create function maj_synced_at() returns trigger language plpgsql as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;

create trigger choix_fonds_synced before insert or update on choix_fonds_sync
  for each row execute function maj_synced_at();
create trigger choix_classes_synced before insert or update on choix_classes_sync
  for each row execute function maj_synced_at();

create index choix_fonds_sync_at on choix_fonds_sync (synced_at);
create index choix_classes_sync_at on choix_classes_sync (synced_at);

-- Securite : vous seul
alter table choix_fonds_sync   enable row level security;
alter table choix_classes_sync enable row level security;
create policy "admin : tout" on choix_fonds_sync for all to authenticated
  using (est_admin()) with check (est_admin());
create policy "admin : tout" on choix_classes_sync for all to authenticated
  using (est_admin()) with check (est_admin());

-- Stockage prive des images (fonds et photos de groupe)
insert into storage.buckets (id, name, public) values ('choix', 'choix', false)
on conflict (id) do nothing;

create policy "slowik : choix admin" on storage.objects for all to authenticated
  using (bucket_id = 'choix' and public.est_admin())
  with check (bucket_id = 'choix' and public.est_admin());
