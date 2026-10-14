-- =====================================================================
-- Studio SLOWIK - 01 : comptes, acces et carnet d'ecoles
-- A executer UNE fois dans un projet Supabase dedie (pas celui de Synedex).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Carnet d'ecoles (et clubs), reutilisable d'une annee sur l'autre
-- ---------------------------------------------------------------------
create table ecoles (
  id               uuid primary key default gen_random_uuid(),
  nom              text not null check (char_length(btrim(nom)) > 0),
  type             text not null default 'ecole' check (type in ('ecole', 'club', 'autre')),
  adresse          text not null default '',
  code_postal      text not null default '',
  ville            text not null default '',
  contact_nom      text not null default '',
  contact_email    text not null default '',
  telephone        text not null default '',
  -- part du CA reversee a l'etablissement (en %)
  taux_commission  numeric(5,2) not null default 30 check (taux_commission between 0 and 100),
  notes            text not null default '',
  archivee         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create function maj_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger ecoles_updated_at before update on ecoles
  for each row execute function maj_updated_at();

-- ---------------------------------------------------------------------
-- 2. Acces : seuls les e-mails de cette liste peuvent creer un compte
--    role 'admin' = vous ; role 'ecole' = un acces rattache a une ecole
-- ---------------------------------------------------------------------
create table acces_autorises (
  email       text primary key check (email = lower(btrim(email)) and email like '%@%'),
  role        text not null check (role in ('admin', 'ecole')),
  ecole_id    uuid references ecoles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  check ((role = 'ecole') = (ecole_id is not null))
);

create table profils (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('admin', 'ecole')),
  ecole_id    uuid references ecoles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index profils_ecole on profils (ecole_id);
create index acces_ecole on acces_autorises (ecole_id);

-- ---------------------------------------------------------------------
-- 3. Fonctions utiles aux regles de securite
-- ---------------------------------------------------------------------
create function est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profils where id = auth.uid() and role = 'admin');
$$;

create function mon_ecole() returns uuid
language sql stable security definer set search_path = public as $$
  select ecole_id from profils where id = auth.uid() and role = 'ecole';
$$;

-- ---------------------------------------------------------------------
-- 4. Creation du profil a l'inscription (refusee si e-mail non autorise)
-- ---------------------------------------------------------------------
create function nouvel_utilisateur() returns trigger
language plpgsql security definer set search_path = public as $$
declare a acces_autorises;
begin
  select * into a from acces_autorises where email = lower(new.email);
  if not found then
    raise exception 'Studio SLOWIK : cet e-mail n''est pas autorise.';
  end if;
  insert into profils (id, email, role, ecole_id)
  values (new.id, lower(new.email), a.role, a.ecole_id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function nouvel_utilisateur();

-- Garde les profils en phase quand vous ajoutez, modifiez ou retirez un acces.
create function synchro_acces() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from profils where email = old.email;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into profils (id, email, role, ecole_id)
    select u.id, new.email, new.role, new.ecole_id
    from auth.users u where lower(u.email) = new.email
    on conflict (id) do update set role = excluded.role, ecole_id = excluded.ecole_id, email = excluded.email;
  end if;
  return null;
end $$;

create trigger acces_synchro after insert or update or delete on acces_autorises
  for each row execute function synchro_acces();

-- ---------------------------------------------------------------------
-- 5. Vue pour l'admin : qui a acces, compte cree ou non
-- ---------------------------------------------------------------------
create view acces_etat with (security_invoker = true) as
  select a.email, a.role, a.ecole_id, a.created_at,
         exists (select 1 from profils p where p.email = a.email) as compte_cree
  from acces_autorises a;

-- ---------------------------------------------------------------------
-- 6. Securite : chacun ne voit que ce qui le concerne
-- ---------------------------------------------------------------------
alter table ecoles          enable row level security;
alter table acces_autorises enable row level security;
alter table profils         enable row level security;

create policy "admin : tout" on ecoles for all to authenticated
  using (est_admin()) with check (est_admin());
create policy "ecole : sa fiche" on ecoles for select to authenticated
  using (id = mon_ecole());

create policy "admin : tout" on acces_autorises for all to authenticated
  using (est_admin()) with check (est_admin());

create policy "mon profil ou admin" on profils for select to authenticated
  using (id = auth.uid() or est_admin());

-- ---------------------------------------------------------------------
-- 7. PREMIER ADMIN : remplacez par VOTRE e-mail avant d'executer,
--    puis creez votre compte dans le site avec ce meme e-mail.
-- ---------------------------------------------------------------------
insert into acces_autorises (email, role) values
  (lower('votre-email@exemple.com'), 'admin')
on conflict (email) do nothing;
