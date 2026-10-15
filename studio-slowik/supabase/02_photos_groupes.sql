-- =====================================================================
-- Studio SLOWIK - 02 : photos de groupe et choix des fonds par les ecoles
-- A executer UNE fois, apres 01_comptes_ecoles.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fonds proposes (les memes pour toutes les ecoles)
-- ---------------------------------------------------------------------
create table fonds_offerts (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null check (char_length(btrim(nom)) > 0),
  chemin      text not null unique,          -- fichier dans le stockage "fonds"
  ordre       int not null default 0,
  actif       boolean not null default true, -- false = cache aux ecoles
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Groupes (classe, equipe...) avec leur photo et le nombre d'adultes
-- ---------------------------------------------------------------------
create table groupes (
  id            uuid primary key default gen_random_uuid(),
  ecole_id      uuid not null references ecoles (id) on delete cascade,
  nom           text not null check (char_length(btrim(nom)) > 0),
  saison        text not null default '',      -- ex : 2026-2027
  nb_adultes    int not null default 1 check (nb_adultes between 1 and 30),
  photo_chemin  text,                          -- fichier dans le stockage "photos-groupes"
  verrouille    boolean not null default false, -- true = l'ecole ne peut plus modifier
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index groupes_ecole on groupes (ecole_id);

create trigger groupes_updated_at before update on groupes
  for each row execute function maj_updated_at();

-- ---------------------------------------------------------------------
-- 3. Choix : un fond par adulte (rang 1..nb_adultes), le meme fond peut revenir
-- ---------------------------------------------------------------------
create table choix_fonds (
  groupe_id   uuid not null references groupes (id) on delete cascade,
  rang        int not null check (rang >= 1),
  fond_id     uuid not null references fonds_offerts (id) on delete restrict,
  nom_adulte  text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (groupe_id, rang)
);

-- Si vous baissez le nombre d'adultes, les choix en trop sont retires.
create function ajuste_choix() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from choix_fonds where groupe_id = new.id and rang > new.nb_adultes;
  return null;
end $$;

create trigger groupes_nb_adultes after update of nb_adultes on groupes
  for each row execute function ajuste_choix();

-- Enregistrement des choix par l'ecole (ou par vous) : jamais plus de nb_adultes.
-- p_choix = [{"rang": 1, "fond_id": "...", "nom_adulte": "Mme Durand"}, ...]
create function enregistrer_choix(p_groupe uuid, p_choix jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare g groupes; item jsonb; r int; f uuid;
begin
  select * into g from groupes where id = p_groupe;
  if not found or not (est_admin() or g.ecole_id = mon_ecole()) then
    raise exception 'Groupe introuvable.';
  end if;
  if g.verrouille and not est_admin() then
    raise exception 'Les choix de ce groupe sont verrouilles par le photographe.';
  end if;
  if jsonb_typeof(p_choix) <> 'array' then
    raise exception 'Format de choix invalide.';
  end if;
  if jsonb_array_length(p_choix) > g.nb_adultes then
    raise exception 'Pas plus de % fond(s) pour ce groupe.', g.nb_adultes;
  end if;
  delete from choix_fonds where groupe_id = p_groupe;
  for item in select * from jsonb_array_elements(p_choix) loop
    r := (item ->> 'rang')::int;
    f := (item ->> 'fond_id')::uuid;
    if r is null or r < 1 or r > g.nb_adultes then
      raise exception 'Numero d''adulte invalide.';
    end if;
    if not exists (select 1 from fonds_offerts where id = f and actif) then
      raise exception 'Ce fond n''est plus disponible.';
    end if;
    insert into choix_fonds (groupe_id, rang, fond_id, nom_adulte)
    values (p_groupe, r, f, left(btrim(coalesce(item ->> 'nom_adulte', '')), 60));
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Recapitulatif pour vous (export CSV)
-- ---------------------------------------------------------------------
create view choix_recap with (security_invoker = true) as
  select e.nom as ecole, g.saison, g.nom as groupe, g.nb_adultes, c.rang,
         c.nom_adulte, f.nom as fond, g.verrouille, c.updated_at, g.ecole_id, g.id as groupe_id
  from choix_fonds c
  join groupes g on g.id = c.groupe_id
  join ecoles e on e.id = g.ecole_id
  join fonds_offerts f on f.id = c.fond_id;

-- ---------------------------------------------------------------------
-- 5. Securite
-- ---------------------------------------------------------------------
alter table fonds_offerts enable row level security;
alter table groupes       enable row level security;
alter table choix_fonds   enable row level security;

create policy "admin : tout" on fonds_offerts for all to authenticated
  using (est_admin()) with check (est_admin());
create policy "connectes : fonds actifs" on fonds_offerts for select to authenticated
  using (actif);

create policy "admin : tout" on groupes for all to authenticated
  using (est_admin()) with check (est_admin());
create policy "ecole : ses groupes" on groupes for select to authenticated
  using (ecole_id = mon_ecole());

create policy "admin : tout" on choix_fonds for all to authenticated
  using (est_admin()) with check (est_admin());
create policy "ecole : ses choix" on choix_fonds for select to authenticated
  using (exists (select 1 from groupes g where g.id = groupe_id and g.ecole_id = mon_ecole()));

-- ---------------------------------------------------------------------
-- 6. Stockage des images (prive) :
--    fonds/<fichier>.jpg  et  photos-groupes/<id ecole>/<fichier>.jpg
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('fonds', 'fonds', false),
  ('photos-groupes', 'photos-groupes', false)
on conflict (id) do nothing;

create policy "slowik : admin gere les images" on storage.objects for all to authenticated
  using (bucket_id in ('fonds', 'photos-groupes') and public.est_admin())
  with check (bucket_id in ('fonds', 'photos-groupes') and public.est_admin());

create policy "slowik : fonds visibles" on storage.objects for select to authenticated
  using (bucket_id = 'fonds');

create policy "slowik : photos de son ecole" on storage.objects for select to authenticated
  using (bucket_id = 'photos-groupes' and (storage.foldername(name))[1] = public.mon_ecole()::text);
