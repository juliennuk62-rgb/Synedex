-- =====================================================================
-- Studio SLOWIK - 02 : facturation
-- A executer UNE fois, apres 01_comptes_ecoles.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Vos coordonnees (une seule ligne), imprimees sur les factures
-- ---------------------------------------------------------------------
create table parametres (
  id            int primary key default 1 check (id = 1),
  nom           text not null default 'Julien SLOWIK',
  enseigne      text not null default 'Studio SLOWIK',
  adresse       text not null default '',
  code_postal   text not null default '',
  ville         text not null default '',
  siret         text not null default '842 857 757',
  telephone     text not null default '',
  email         text not null default '',
  iban          text not null default '',
  mention_tva   text not null default 'TVA non applicable, art. 293 B du CGI',
  conditions    text not null default 'Paiement à réception de facture. En cas de retard de paiement : pénalités au taux légal en vigueur et indemnité forfaitaire de 40 € pour frais de recouvrement.',
  updated_at    timestamptz not null default now()
);
insert into parametres (id) values (1) on conflict do nothing;

create trigger parametres_updated_at before update on parametres
  for each row execute function maj_updated_at();

-- ---------------------------------------------------------------------
-- 2. Factures
--    ca = total des lignes ; commission = ca x taux (VERSEE a l'etablissement) ;
--    net = ca - commission (ce que vous gardez).
-- ---------------------------------------------------------------------
create table factures (
  id                 uuid primary key default gen_random_uuid(),
  numero             text not null unique,            -- AAAAMMJJ, puis AAAAMMJJ-2...
  date_facture       date not null default current_date,
  ecole_id           uuid not null references ecoles (id) on delete restrict,
  client             jsonb not null,                  -- copie de la fiche ecole au moment de la facture
  emetteur           jsonb not null,                  -- copie de vos coordonnees au moment de la facture
  lignes             jsonb not null,                  -- [{"designation": "...", "montant": 123.45}]
  ca                 numeric(12,2) not null check (ca >= 0),
  taux               numeric(5,2) not null check (taux between 0 and 100),
  commission         numeric(12,2) not null,
  net                numeric(12,2) not null,
  notes              text not null default '',
  statut             text not null default 'emise' check (statut in ('emise', 'annulee')),
  commission_versee  boolean not null default false,
  created_at         timestamptz not null default now()
);

create index factures_ecole on factures (ecole_id);
create index factures_date on factures (date_facture);

-- Creation : numero, montants et copies calcules par la base (jamais par le navigateur).
create function creer_facture(p_ecole uuid, p_date date, p_lignes jsonb, p_taux numeric, p_notes text)
returns factures
language plpgsql security definer set search_path = public as $$
declare
  e ecoles; prm parametres; f factures;
  base text; n int; v_ca numeric(12,2); v_com numeric(12,2); item jsonb;
begin
  if not est_admin() then raise exception 'Action non autorisee.'; end if;
  select * into e from ecoles where id = p_ecole;
  if not found then raise exception 'Ecole introuvable.'; end if;
  select * into prm from parametres where id = 1;
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Ajoutez au moins une ligne.';
  end if;
  v_ca := 0;
  for item in select * from jsonb_array_elements(p_lignes) loop
    if coalesce(btrim(item ->> 'designation'), '') = '' then raise exception 'Chaque ligne doit avoir une designation.'; end if;
    if (item ->> 'montant')::numeric < 0 then raise exception 'Montant negatif interdit.'; end if;
    v_ca := v_ca + round((item ->> 'montant')::numeric, 2);
  end loop;
  if p_taux is null or p_taux < 0 or p_taux > 100 then raise exception 'Taux de commission invalide.'; end if;
  v_com := round(v_ca * p_taux / 100, 2);

  -- numero unique : AAAAMMJJ, puis -2, -3 le meme jour
  perform pg_advisory_xact_lock(hashtext('slowik-numero-facture'));
  base := to_char(coalesce(p_date, current_date), 'YYYYMMDD');
  select count(*) into n from factures where numero = base or numero like base || '-%';
  insert into factures (numero, date_facture, ecole_id, client, emetteur, lignes, ca, taux, commission, net, notes)
  values (
    case when n = 0 then base else base || '-' || (n + 1) end,
    coalesce(p_date, current_date), e.id,
    jsonb_build_object('nom', e.nom, 'adresse', e.adresse, 'code_postal', e.code_postal, 'ville', e.ville,
                       'contact_nom', e.contact_nom, 'contact_email', e.contact_email),
    to_jsonb(prm) - 'id' - 'updated_at',
    p_lignes, v_ca, p_taux, v_com, v_ca - v_com, coalesce(p_notes, ''))
  returning * into f;
  return f;
end $$;

-- ---------------------------------------------------------------------
-- 3. Securite
-- ---------------------------------------------------------------------
alter table parametres enable row level security;
alter table factures   enable row level security;

create policy "connectes : lecture" on parametres for select to authenticated using (true);
create policy "admin : modification" on parametres for update to authenticated
  using (est_admin()) with check (est_admin());

-- Les factures sont creees par creer_facture ; ensuite seuls le statut,
-- le versement de la commission et les notes changent (jamais les montants).
create policy "admin : lecture" on factures for select to authenticated using (est_admin());
create policy "ecole : ses factures" on factures for select to authenticated
  using (ecole_id = mon_ecole() and statut = 'emise');
create policy "admin : suivi" on factures for update to authenticated
  using (est_admin()) with check (est_admin());

create function factures_figees() returns trigger language plpgsql as $$
begin
  if new.numero <> old.numero or new.date_facture <> old.date_facture or new.ecole_id <> old.ecole_id
     or new.lignes <> old.lignes or new.ca <> old.ca or new.taux <> old.taux
     or new.commission <> old.commission or new.net <> old.net
     or new.client <> old.client or new.emetteur <> old.emetteur then
    raise exception 'Une facture emise ne peut pas etre modifiee : annulez-la et faites-en une nouvelle.';
  end if;
  return new;
end $$;

create trigger factures_figees before update on factures
  for each row execute function factures_figees();
