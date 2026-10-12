-- =====================================================================
--  SYNEDEX — Base de données (Supabase / PostgreSQL 15+)
--  À exécuter UNE fois : Supabase > SQL Editor > New query > coller > Run
--
--  Principe : les joueurs LISENT les tables directement, mais toutes les
--  ÉCRITURES passent par des fonctions serveur (RPC). Impossible donc de
--  tricher depuis le navigateur (se donner des cartes, des Éclats, etc.).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------
create type card_status  as enum ('pending', 'approved', 'refused');
create type pull_source  as enum ('booster', 'fusion', 'trade', 'market', 'admin');
create type trade_status as enum ('pending', 'accepted', 'refused', 'cancelled', 'invalid');
create type trade_side   as enum ('give', 'want');
create type market_side  as enum ('buy', 'sell');
create type news_target  as enum ('card', 'group');

-- ---------------------------------------------------------------------
-- 2. Réglages du jeu (une seule ligne) — tout l'équilibrage est ici
-- ---------------------------------------------------------------------
create table config (
  id                smallint primary key default 1 check (id = 1),
  booster_interval  interval not null default '15 minutes',
  max_stack         int      not null default 20,
  start_stock       int      not null default 5,
  per_booster       int      not null default 5,
  low_uncommon_rate numeric  not null default 0.15,           -- cartes 1-3 : 15 % peu commune
  high_slot         jsonb    not null default '{"5":0.01,"4":0.07,"3":0.20,"2":0.72}', -- carte 5
  pity_threshold    int      not null default 500,
  shiny_rate        numeric  not null default 0.01,
  fusion_cost       int      not null default 5,
  fusion_max_from   int      not null default 3,             -- super rare → ultra rare max
  market jsonb not null default '{
    "base":[10,25,60,150,400,1200], "shiny_mult":4,
    "alpha":0.5, "scar_min":0.5, "scar_max":3,
    "mom_step":0.05, "mom_half_hours":12, "mom_min":0.75, "mom_max":1.5,
    "spread_buy":1.10, "spread_sell":0.85, "start_balance":500 }',
  score  jsonb not null default '{"points":[1,4,15,60,250,1500], "dup_factor":0.1, "shiny_bonus":1500}',
  design jsonb not null default '{}'                          -- nom, couleurs, paquet… (onglet Design)
);
insert into config default values;

-- ---------------------------------------------------------------------
-- 3. Joueurs (jeu privé : inscription sur invitation uniquement)
-- ---------------------------------------------------------------------
create table allowed_emails (
  email        text primary key,
  display_name text,
  is_admin     boolean not null default false
);

create table profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  display_name    text not null check (char_length(display_name) between 1 and 24),
  is_admin        boolean not null default false,
  balance         int not null default 500 check (balance >= 0),        -- Éclats
  pity            int not null default 0 check (pity >= 0),             -- cartes depuis la dernière légendaire
  booster_stock   int not null default 5 check (booster_stock >= 0),
  booster_last    timestamptz not null default now(),
  boosters_opened int not null default 0,
  cards_opened    int not null default 0,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. Cartes et collections (groupes de synergie)
-- ---------------------------------------------------------------------
create table groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  description text not null default '',
  created_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table cards (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 40),
  body          text not null default '' check (char_length(body) <= 220),
  rarity        smallint not null check (rarity between 0 and 5),  -- 0 commune … 5 légendaire
  group_id      uuid references groups (id) on delete set null,
  creator_id    uuid not null references profiles (id) on delete cascade,
  image_path    text,                                              -- chemin dans le bucket card-images
  status        card_status not null default 'pending',
  refuse_reason text,
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid references profiles (id) on delete set null
);
create index cards_status_rarity on cards (status, rarity);
create index cards_group on cards (group_id);

-- ---------------------------------------------------------------------
-- 5. Collections des joueurs, vitrine de la banque, historique des tirages
-- ---------------------------------------------------------------------
create table inventory (
  owner_id uuid not null references profiles (id) on delete cascade,
  card_id  uuid not null references cards (id) on delete cascade,
  shiny    boolean not null default false,
  qty      int not null check (qty >= 0),
  primary key (owner_id, card_id, shiny)
);
create index inventory_card on inventory (card_id);

create table bank_stock (
  card_id uuid not null references cards (id) on delete cascade,
  shiny   boolean not null default false,
  qty     int not null default 0 check (qty >= 0),
  primary key (card_id, shiny)
);

create table pulls (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null references profiles (id) on delete cascade,
  card_id    uuid not null references cards (id) on delete cascade,
  shiny      boolean not null default false,
  source     pull_source not null,
  is_new     boolean not null default false,
  forced     boolean not null default false,    -- légendaire garantie par la jauge
  created_at timestamptz not null default now()
);
create index pulls_recent on pulls (created_at desc);
create index pulls_owner on pulls (owner_id, created_at desc);

-- ---------------------------------------------------------------------
-- 6. Échanges entre joueurs
-- ---------------------------------------------------------------------
create table trades (
  id          uuid primary key default gen_random_uuid(),
  from_id     uuid not null references profiles (id) on delete cascade,
  to_id       uuid not null references profiles (id) on delete cascade,
  status      trade_status not null default 'pending',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  check (from_id <> to_id)
);
create index trades_to on trades (to_id, status);
create index trades_from on trades (from_id, status);

create table trade_items (
  trade_id uuid not null references trades (id) on delete cascade,
  side     trade_side not null,          -- give = ce que l'émetteur donne, want = ce qu'il demande
  card_id  uuid not null references cards (id) on delete cascade,
  shiny    boolean not null default false,
  qty      int not null default 1 check (qty > 0),
  primary key (trade_id, side, card_id, shiny)
);

-- ---------------------------------------------------------------------
-- 7. Bourse des potes
-- ---------------------------------------------------------------------
create table market_tx (
  id         bigint generated always as identity primary key,
  card_id    uuid not null references cards (id) on delete cascade,
  shiny      boolean not null default false,
  side       market_side not null,
  player_id  uuid not null references profiles (id) on delete cascade,
  price      int not null check (price > 0),
  created_at timestamptz not null default now()
);
create index market_tx_card on market_tx (card_id, created_at desc);
create index market_tx_recent on market_tx (created_at desc);

create table news (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 80),
  target_type  news_target not null,
  target_id    uuid not null,
  pct          numeric not null check (pct between -0.5 and 1),   -- +0.30 = +30 %
  starts_at    timestamptz not null default now(),
  duration     interval not null,
  created_by   uuid references profiles (id) on delete set null,
  cancelled_at timestamptz
);
create index news_target_idx on news (target_type, target_id);

create table price_history (
  card_id uuid not null references cards (id) on delete cascade,
  at      timestamptz not null default now(),
  price   int not null,
  primary key (card_id, at)
);

-- =====================================================================
-- 8. Fonctions internes (non appelables par les joueurs)
-- =====================================================================
create function _uid() returns uuid
language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Non connecté'; end if;
  return u;
end $$;

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false)
$$;

create function _require_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  return auth.uid();
end $$;

-- Recharge des boosters (1 toutes les 15 min, réserve max 20). Verrouille la ligne du joueur.
create function _sync_boosters(p_uid uuid) returns profiles
language plpgsql security definer set search_path = public as $$
declare c config; p profiles; g int;
begin
  select * into c from config where id = 1;
  select * into p from profiles where id = p_uid for update;
  if not found then raise exception 'Profil introuvable'; end if;
  if p.booster_stock >= c.max_stack then
    update profiles set booster_stock = c.max_stack, booster_last = now() where id = p_uid returning * into p;
  else
    g := floor(extract(epoch from now() - p.booster_last) / extract(epoch from c.booster_interval));
    if g > 0 then
      update profiles
         set booster_stock = least(c.max_stack, booster_stock + g),
             booster_last  = case when booster_stock + g >= c.max_stack then now()
                                  else booster_last + g * c.booster_interval end
       where id = p_uid returning * into p;
    end if;
  end if;
  return p;
end $$;

-- Ajoute des exemplaires ; renvoie vrai si c'est une nouvelle carte pour ce joueur
create function _inv_add(p_owner uuid, p_card uuid, p_shiny boolean, p_n int default 1) returns boolean
language plpgsql security definer set search_path = public as $$
declare was_new boolean;
begin
  was_new := not exists (select 1 from inventory i where i.owner_id = p_owner and i.card_id = p_card and i.qty > 0);
  insert into inventory (owner_id, card_id, shiny, qty) values (p_owner, p_card, p_shiny, p_n)
  on conflict (owner_id, card_id, shiny) do update set qty = inventory.qty + excluded.qty;
  return was_new;
end $$;

-- Retire des exemplaires ; renvoie faux si le joueur n'en a pas assez
create function _inv_remove(p_owner uuid, p_card uuid, p_shiny boolean, p_n int default 1) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update inventory i set qty = i.qty - p_n
   where i.owner_id = p_owner and i.card_id = p_card and i.shiny = p_shiny and i.qty >= p_n;
  if not found then return false; end if;
  delete from inventory i where i.owner_id = p_owner and i.card_id = p_card and i.shiny = p_shiny and i.qty = 0;
  return true;
end $$;

-- Tire une carte validée d'une rareté (repli sur la rareté inférieure si vide)
create function _draw_card(p_rarity int, p_max int default 5) returns cards
language plpgsql security definer set search_path = public as $$
declare ord int[] := array[p_rarity]; k int; r cards;
begin
  for d in 1..5 loop if p_rarity - d >= 0 then ord := ord || (p_rarity - d); end if; end loop;
  for d in 1..5 loop if p_rarity + d <= p_max then ord := ord || (p_rarity + d); end if; end loop;
  foreach k in array ord loop
    select * into r from cards c where c.status = 'approved' and c.rarity = k order by random() limit 1;
    if found then return r; end if;
  end loop;
  return null;
end $$;

-- =====================================================================
-- 9. Cours de la Bourse : Base × Rareté réelle × Actus × Tendance
--    (même formule que dans l'appli, recalculée à chaque instant)
-- =====================================================================
create function market_price(p_card uuid, p_shiny boolean default false, p_at timestamptz default now())
returns int language plpgsql stable security definer set search_path = public as $$
declare
  m jsonb; k cards; base numeric; n numeric; e numeric; scar numeric; ev numeric; mom numeric; half numeric;
begin
  select market into m from config where id = 1;
  select * into k from cards where id = p_card;
  if not found or k.status <> 'approved' then return null; end if;

  base := (m->'base'->>k.rarity)::numeric * case when p_shiny then (m->>'shiny_mult')::numeric else 1 end;

  -- Rareté réelle : exemplaires chez les joueurs vs moyenne des cartes de même rareté
  select coalesce(sum(i.qty), 0) into n from inventory i where i.card_id = p_card;
  select greatest(1,
           coalesce((select sum(i.qty) from inventory i join cards c2 on c2.id = i.card_id
                      where c2.rarity = k.rarity and c2.status = 'approved'), 0)::numeric
           / greatest(1, (select count(*) from cards c3 where c3.rarity = k.rarity and c3.status = 'approved')))
    into e;
  scar := least((m->>'scar_max')::numeric, greatest((m->>'scar_min')::numeric,
                power(e / greatest(n, 0.5), (m->>'alpha')::numeric)));

  -- Actus en cours (effet qui décroît linéairement jusqu'à 0)
  select coalesce(exp(sum(ln(1 + nw.pct * (1 - extract(epoch from p_at - nw.starts_at) / extract(epoch from nw.duration))))), 1)
    into ev
    from news nw
   where nw.cancelled_at is null
     and p_at >= nw.starts_at and p_at < nw.starts_at + nw.duration
     and ((nw.target_type = 'card'  and nw.target_id = p_card)
       or (nw.target_type = 'group' and nw.target_id = k.group_id));

  -- Tendance : +5 % par achat, −5 % par revente, effet divisé par 2 toutes les 12 h
  half := (m->>'mom_half_hours')::numeric * 3600;
  select coalesce(sum(case when t.side = 'buy' then 1 else -1 end
                      * power(0.5::numeric, extract(epoch from p_at - t.created_at) / half)), 0)
    into mom
    from market_tx t
   where t.card_id = p_card and t.created_at <= p_at and t.created_at > p_at - make_interval(secs => half * 8);
  mom := least((m->>'mom_max')::numeric, greatest((m->>'mom_min')::numeric, 1 + (m->>'mom_step')::numeric * mom));

  return greatest(1, round(base * scar * ev * mom))::int;
end $$;

-- Ajoute un point d'historique si le cours a bougé d'au moins 0,5 % (ou toutes les heures)
create function record_price(p_card uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p int; la timestamptz; lp int;
begin
  p := market_price(p_card);
  if p is null then return; end if;
  select h.at, h.price into la, lp from price_history h where h.card_id = p_card order by h.at desc limit 1;
  if la is null or abs(p - lp)::numeric / lp >= 0.005 or now() - la > interval '1 hour' then
    insert into price_history (card_id, at, price) values (p_card, now(), p)
    on conflict (card_id, at) do update set price = excluded.price;
  end if;
end $$;

create function record_prices() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from cards where status = 'approved' loop perform record_price(r.id); end loop;
end $$;

-- =====================================================================
-- 10. Fonctions appelées par l'appli (supabase.rpc('nom', {...}))
-- =====================================================================

-- État du joueur connecté (solde, boosters, prochain booster, jauge)
create function my_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles; c config;
begin
  p := _sync_boosters(_uid());
  select * into c from config where id = 1;
  return jsonb_build_object(
    'id', p.id, 'display_name', p.display_name, 'is_admin', p.is_admin,
    'balance', p.balance, 'booster_stock', p.booster_stock, 'max_stack', c.max_stack,
    'next_booster_at', case when p.booster_stock >= c.max_stack then null else p.booster_last + c.booster_interval end,
    'pity', p.pity, 'pity_threshold', c.pity_threshold);
end $$;

-- Ouvre un booster : structure garantie + jauge légendaire + shiny
create function open_booster()
returns table (slot int, card_id uuid, rarity smallint, shiny boolean, is_new boolean, forced boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
  uid uuid := _uid(); c config; p profiles;
  slots int[] := '{}'; hr int; x numeric; acc numeric := 0; k text;
  r cards; sh boolean; nw boolean; fc boolean; got_leg boolean := false; is_forced boolean := false; n int := 0;
begin
  select * into c from config where id = 1;
  p := _sync_boosters(uid);
  if p.booster_stock < 1 then raise exception 'Plus de booster disponible'; end if;
  if not exists (select 1 from cards cc where cc.status = 'approved') then raise exception 'Aucune carte validée dans le jeu'; end if;

  for i in 1 .. c.per_booster - 2 loop
    slots := slots || (case when random() < c.low_uncommon_rate then 1 else 0 end);
  end loop;
  select array_agg(v order by v) into slots from unnest(slots) as v;
  slots := slots || 1;                                         -- peu commune garantie

  if p.pity + c.per_booster >= c.pity_threshold then
    hr := 5; is_forced := true;                                -- jauge pleine
  else
    x := random(); hr := 2;
    for k in select key from jsonb_each_text(c.high_slot) order by key::int desc loop
      acc := acc + (c.high_slot->>k)::numeric;
      if x < acc then hr := k::int; exit; end if;
    end loop;
  end if;
  slots := slots || hr;                                        -- emplacement rare ou mieux

  for i in 1 .. array_length(slots, 1) loop
    r := _draw_card(slots[i]);
    continue when r.id is null;
    sh := r.rarity = 5 and random() < c.shiny_rate;
    nw := _inv_add(uid, r.id, sh, 1);
    fc := is_forced and i = array_length(slots, 1) and r.rarity = 5;
    if r.rarity = 5 then got_leg := true; end if;
    n := n + 1;
    insert into pulls (owner_id, card_id, shiny, source, is_new, forced) values (uid, r.id, sh, 'booster', nw, fc);
    slot := i; card_id := r.id; rarity := r.rarity; shiny := sh; is_new := nw; forced := fc;
    return next;
  end loop;

  update profiles
     set booster_stock   = booster_stock - 1,
         pity            = case when got_leg then 0 else least(c.pity_threshold, profiles.pity + n) end,
         boosters_opened = boosters_opened + 1,
         cards_opened    = cards_opened + n
   where id = uid;
  perform record_prices();
end $$;

-- Fusion : 5 doublons d'une rareté → 1 carte aléatoire de la rareté au-dessus (max ultra rare)
create function fuse(p_cards uuid[])
returns table (card_id uuid, rarity smallint, is_new boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare uid uuid := _uid(); c config; r_from int; nb int; rec record; got cards; nw boolean;
begin
  select * into c from config where id = 1;
  if coalesce(array_length(p_cards, 1), 0) <> c.fusion_cost then
    raise exception 'Il faut exactement % doublons', c.fusion_cost;
  end if;
  perform 1 from profiles where id = uid for update;
  select count(*), min(k.rarity) into nb, r_from
    from unnest(p_cards) as u(id) join cards k on k.id = u.id and k.status = 'approved';
  if nb <> c.fusion_cost then raise exception 'Carte invalide'; end if;
  if exists (select 1 from unnest(p_cards) as u(id) join cards k on k.id = u.id where k.rarity <> r_from) then
    raise exception 'Les doublons doivent être de la même rareté';
  end if;
  if r_from > c.fusion_max_from then raise exception 'Cette rareté ne peut pas être fusionnée'; end if;

  for rec in select u.id as cid, count(*)::int as k from unnest(p_cards) as u(id) group by u.id loop
    if coalesce((select i.qty from inventory i where i.owner_id = uid and i.card_id = rec.cid and not i.shiny), 0) < rec.k + 1 then
      raise exception 'Pas assez de doublons (ton dernier exemplaire est toujours conservé)';
    end if;
    perform _inv_remove(uid, rec.cid, false, rec.k);
  end loop;

  got := _draw_card(r_from + 1, c.fusion_max_from + 1);
  nw := _inv_add(uid, got.id, false, 1);
  insert into pulls (owner_id, card_id, shiny, source, is_new) values (uid, got.id, false, 'fusion', nw);
  perform record_prices();
  card_id := got.id; rarity := got.rarity; is_new := nw;
  return next;
end $$;

-- Proposer une carte (validation admin ensuite)
create function submit_card(p_title text, p_body text, p_rarity smallint,
                            p_group_id uuid default null, p_new_group text default null, p_image_path text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := _uid(); gid uuid := p_group_id; cid uuid;
begin
  if p_new_group is not null and btrim(p_new_group) <> '' then
    insert into groups (name, created_by) values (btrim(p_new_group), uid) returning id into gid;
  end if;
  insert into cards (title, body, rarity, group_id, creator_id, image_path)
  values (btrim(p_title), coalesce(btrim(p_body), ''), p_rarity, gid, uid, p_image_path)
  returning id into cid;
  return cid;
end $$;

-- Valider / refuser une carte (admin), avec correction possible de la rareté
create function review_card(p_card uuid, p_approve boolean, p_rarity smallint default null, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_admin();
begin
  update cards
     set status = case when p_approve then 'approved'::card_status else 'refused'::card_status end,
         rarity = coalesce(p_rarity, rarity),
         refuse_reason = case when p_approve then null else p_reason end,
         reviewed_at = now(), reviewed_by = uid
   where id = p_card and status = 'pending';
  if not found then raise exception 'Carte introuvable ou déjà traitée'; end if;
  if p_approve then perform record_prices(); end if;
end $$;

-- Échanges : items = [{"card_id":"…","shiny":false,"qty":1}, …]
create function propose_trade(p_to uuid, p_give jsonb, p_want jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := _uid(); tid uuid;
begin
  if p_to = uid then raise exception 'Impossible d''échanger avec soi-même'; end if;
  if not exists (select 1 from profiles where id = p_to) then raise exception 'Joueur introuvable'; end if;
  if jsonb_array_length(coalesce(p_give, '[]')) + jsonb_array_length(coalesce(p_want, '[]')) = 0 then
    raise exception 'Échange vide';
  end if;
  insert into trades (from_id, to_id) values (uid, p_to) returning id into tid;
  insert into trade_items (trade_id, side, card_id, shiny, qty)
  select tid, s.side, s.card_id, s.shiny, sum(s.qty)::int
    from (select 'give'::trade_side as side, (e->>'card_id')::uuid as card_id,
                 coalesce((e->>'shiny')::boolean, false) as shiny, greatest(1, coalesce((e->>'qty')::int, 1)) as qty
            from jsonb_array_elements(coalesce(p_give, '[]')) e
          union all
          select 'want'::trade_side, (e->>'card_id')::uuid, coalesce((e->>'shiny')::boolean, false), greatest(1, coalesce((e->>'qty')::int, 1))
            from jsonb_array_elements(coalesce(p_want, '[]')) e) s
   group by s.side, s.card_id, s.shiny;
  if exists (select 1 from trade_items ti
              where ti.trade_id = tid
                and coalesce((select i.qty from inventory i
                               where i.owner_id = case when ti.side = 'give' then uid else p_to end
                                 and i.card_id = ti.card_id and i.shiny = ti.shiny), 0) < ti.qty) then
    raise exception 'Une des cartes demandées ou proposées n''est pas disponible';
  end if;
  return tid;
end $$;

create function respond_trade(p_trade uuid, p_accept boolean)
returns trade_status language plpgsql security definer set search_path = public as $$
declare uid uuid := _uid(); t trades; it record; giver uuid; taker uuid;
begin
  select * into t from trades where id = p_trade for update;
  if not found or t.to_id <> uid then raise exception 'Échange introuvable'; end if;
  if t.status <> 'pending' then raise exception 'Échange déjà traité'; end if;
  if not p_accept then
    update trades set status = 'refused', resolved_at = now() where id = p_trade;
    return 'refused';
  end if;
  perform 1 from profiles where id in (t.from_id, t.to_id) order by id for update;  -- ordre fixe : pas d'interblocage
  if exists (select 1 from trade_items ti
              where ti.trade_id = p_trade
                and coalesce((select i.qty from inventory i
                               where i.owner_id = case when ti.side = 'give' then t.from_id else t.to_id end
                                 and i.card_id = ti.card_id and i.shiny = ti.shiny), 0) < ti.qty) then
    update trades set status = 'invalid', resolved_at = now() where id = p_trade;
    return 'invalid';
  end if;
  for it in select * from trade_items where trade_id = p_trade loop
    if it.side = 'give' then giver := t.from_id; taker := t.to_id; else giver := t.to_id; taker := t.from_id; end if;
    perform _inv_remove(giver, it.card_id, it.shiny, it.qty);
    insert into pulls (owner_id, card_id, shiny, source, is_new)
    values (taker, it.card_id, it.shiny, 'trade', _inv_add(taker, it.card_id, it.shiny, it.qty));
  end loop;
  update trades set status = 'accepted', resolved_at = now() where id = p_trade;
  perform record_prices();
  return 'accepted';
end $$;

create function cancel_trade(p_trade uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update trades set status = 'cancelled', resolved_at = now()
   where id = p_trade and from_id = _uid() and status = 'pending';
  if not found then raise exception 'Échange introuvable ou déjà traité'; end if;
end $$;

-- Bourse : revendre à la banque (la carte part en vitrine)
create function market_sell(p_card uuid, p_shiny boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare uid uuid := _uid(); m jsonb; pr int;
begin
  select market into m from config where id = 1;
  perform 1 from profiles where id = uid for update;
  pr := market_price(p_card, p_shiny);
  if pr is null then raise exception 'Carte introuvable'; end if;
  pr := greatest(1, floor(pr * (m->>'spread_sell')::numeric))::int;
  if not _inv_remove(uid, p_card, p_shiny, 1) then raise exception 'Tu ne possèdes pas cette carte'; end if;
  insert into bank_stock (card_id, shiny, qty) values (p_card, p_shiny, 1)
  on conflict (card_id, shiny) do update set qty = bank_stock.qty + 1;
  update profiles set balance = balance + pr where id = uid;
  insert into market_tx (card_id, shiny, side, player_id, price) values (p_card, p_shiny, 'sell', uid, pr);
  perform record_price(p_card);
  return pr;
end $$;

-- Bourse : acheter un exemplaire en vitrine
create function market_buy(p_card uuid, p_shiny boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare uid uuid := _uid(); m jsonb; pr int; q int; bal int;
begin
  select market into m from config where id = 1;
  select balance into bal from profiles where id = uid for update;
  select b.qty into q from bank_stock b where b.card_id = p_card and b.shiny = p_shiny for update;
  if coalesce(q, 0) < 1 then raise exception 'Plus d''exemplaire en vitrine'; end if;
  pr := ceil(market_price(p_card, p_shiny) * (m->>'spread_buy')::numeric)::int;
  if bal < pr then raise exception 'Pas assez d''Éclats'; end if;
  update bank_stock set qty = qty - 1 where card_id = p_card and shiny = p_shiny;
  update profiles set balance = balance - pr where id = uid;
  insert into pulls (owner_id, card_id, shiny, source, is_new)
  values (uid, p_card, p_shiny, 'market', _inv_add(uid, p_card, p_shiny, 1));
  insert into market_tx (card_id, shiny, side, player_id, price) values (p_card, p_shiny, 'buy', uid, pr);
  perform record_price(p_card);
  return pr;
end $$;

-- Actus (admin) : effet de −50 % à +100 %, de 1 à 30 jours
create function publish_news(p_title text, p_target_type news_target, p_target_id uuid, p_pct numeric, p_days int)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := _require_admin(); nid uuid;
begin
  if p_days not between 1 and 30 then raise exception 'Durée entre 1 et 30 jours'; end if;
  if p_target_type = 'card' and not exists (select 1 from cards where id = p_target_id) then raise exception 'Carte introuvable'; end if;
  if p_target_type = 'group' and not exists (select 1 from groups where id = p_target_id) then raise exception 'Collection introuvable'; end if;
  insert into news (title, target_type, target_id, pct, duration, created_by)
  values (btrim(p_title), p_target_type, p_target_id, p_pct, make_interval(days => p_days), uid)
  returning id into nid;
  perform record_prices();
  return nid;
end $$;

create function cancel_news(p_news uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin();
  update news set cancelled_at = now() where id = p_news and cancelled_at is null;
  perform record_prices();
end $$;

-- Divers
create function set_display_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin update profiles set display_name = btrim(p_name) where id = _uid(); end $$;

create function update_design(p_design jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin perform _require_admin(); update config set design = p_design where id = 1; end $$;

create function invite_player(p_email text, p_name text default null, p_admin boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin();
  insert into allowed_emails (email, display_name, is_admin) values (lower(btrim(p_email)), p_name, p_admin)
  on conflict (email) do update set display_name = excluded.display_name, is_admin = excluded.is_admin;
end $$;

-- =====================================================================
-- 11. Création automatique du profil à l'inscription (sur invitation)
-- =====================================================================
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv allowed_emails; c config;
begin
  select * into inv from allowed_emails where email = lower(new.email);
  if not found then raise exception 'Synedex est sur invitation : cet e-mail n''est pas autorisé.'; end if;
  select * into c from config where id = 1;
  insert into profiles (id, display_name, is_admin, balance, booster_stock)
  values (new.id,
          left(coalesce(inv.display_name, new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), 24),
          inv.is_admin, (c.market->>'start_balance')::int, c.start_stock);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function handle_new_user();

-- =====================================================================
-- 12. Vues pratiques pour l'appli
-- =====================================================================
-- Classement : la rareté prime, le volume départage
create view leaderboard as
with per_card as (
  select i.owner_id, i.card_id, k.rarity, sum(i.qty) as n, sum(case when i.shiny then i.qty else 0 end) as s
    from inventory i join cards k on k.id = i.card_id and k.status = 'approved'
   group by i.owner_id, i.card_id, k.rarity
), pts as (
  select (e.ord - 1)::int as rarity, e.value::numeric as pts
    from config c, jsonb_array_elements_text(c.score->'points') with ordinality as e(value, ord)
)
select p.id, p.display_name, p.boosters_opened, p.cards_opened,
       coalesce(round(sum(pts.pts + (pc.n - 1) * pts.pts * (c.score->>'dup_factor')::numeric
                          + pc.s * (c.score->>'shiny_bonus')::numeric)), 0)::int as score,
       count(pc.card_id)::int as unique_cards,
       coalesce(sum(pc.n), 0)::int as total_cards,
       coalesce(sum(case when pc.rarity = 5 then pc.n end), 0)::int as legendaries,
       coalesce(sum(pc.s), 0)::int as shinies
  from profiles p
  cross join config c
  left join per_card pc on pc.owner_id = p.id
  left join pts on pts.rarity = pc.rarity
 group by p.id, p.display_name, p.boosters_opened, p.cards_opened, c.score
 order by score desc, total_cards desc;

-- Tableau de la Bourse : cours actuel, cours d'il y a 24 h, exemplaires, vitrine
create view market_board as
select k.id as card_id, k.title, k.rarity, k.group_id, k.image_path,
       coalesce((select sum(i.qty) from inventory i where i.card_id = k.id), 0)::int as held,
       coalesce((select b.qty from bank_stock b where b.card_id = k.id and not b.shiny), 0) as stock,
       coalesce((select b.qty from bank_stock b where b.card_id = k.id and b.shiny), 0) as stock_shiny,
       market_price(k.id) as price,
       (select h.price from price_history h where h.card_id = k.id and h.at <= now() - interval '24 hours'
         order by h.at desc limit 1) as price_24h
  from cards k
 where k.status = 'approved';

-- Fil des gros tirages (super rare et mieux)
create view big_pulls as
select pl.id, pl.owner_id, pr.display_name, pl.card_id, k.title, k.rarity, pl.shiny, pl.source, pl.created_at
  from pulls pl join cards k on k.id = pl.card_id join profiles pr on pr.id = pl.owner_id
 where k.rarity >= 3
 order by pl.created_at desc
 limit 50;

-- =====================================================================
-- 13. Sécurité : lecture seule pour les joueurs, écritures via les fonctions
-- =====================================================================
alter table config         enable row level security;
alter table allowed_emails enable row level security;
alter table profiles       enable row level security;
alter table groups         enable row level security;
alter table cards          enable row level security;
alter table inventory      enable row level security;
alter table bank_stock     enable row level security;
alter table pulls          enable row level security;
alter table trades         enable row level security;
alter table trade_items    enable row level security;
alter table market_tx      enable row level security;
alter table news           enable row level security;
alter table price_history  enable row level security;

create policy "lecture joueurs" on config        for select to authenticated using (true);
create policy "lecture admin"   on allowed_emails for select to authenticated using (is_admin());
create policy "lecture joueurs" on profiles      for select to authenticated using (true);
create policy "lecture joueurs" on groups        for select to authenticated using (true);
create policy "cartes visibles" on cards         for select to authenticated
  using (status = 'approved' or creator_id = auth.uid() or is_admin());
create policy "lecture joueurs" on inventory     for select to authenticated using (true);
create policy "lecture joueurs" on bank_stock    for select to authenticated using (true);
create policy "lecture joueurs" on pulls         for select to authenticated using (true);
create policy "mes échanges"    on trades        for select to authenticated using (auth.uid() in (from_id, to_id));
create policy "mes échanges"    on trade_items   for select to authenticated
  using (exists (select 1 from trades t where t.id = trade_id and auth.uid() in (t.from_id, t.to_id)));
create policy "lecture joueurs" on market_tx     for select to authenticated using (true);
create policy "lecture joueurs" on news          for select to authenticated using (true);
create policy "lecture joueurs" on price_history for select to authenticated using (true);

-- Aucun accès anonyme, et aucune écriture directe pour les joueurs
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;

-- Seules les fonctions "publiques" sont appelables
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  is_admin(), my_state(), open_booster(), fuse(uuid[]),
  submit_card(text, text, smallint, uuid, text, text), review_card(uuid, boolean, smallint, text),
  propose_trade(uuid, jsonb, jsonb), respond_trade(uuid, boolean), cancel_trade(uuid),
  market_price(uuid, boolean, timestamptz), market_sell(uuid, boolean), market_buy(uuid, boolean),
  publish_news(text, news_target, uuid, numeric, int), cancel_news(uuid),
  set_display_name(text), update_design(jsonb), invite_player(text, text, boolean)
to authenticated;

-- =====================================================================
-- 14. Photos des cartes (Supabase Storage)
-- =====================================================================
do $$
begin
  insert into storage.buckets (id, name, public) values ('card-images', 'card-images', true)
  on conflict (id) do nothing;
  create policy "photos : lecture" on storage.objects for select using (bucket_id = 'card-images');
  create policy "photos : envoi dans mon dossier" on storage.objects for insert to authenticated
    with check (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);
exception when others then
  raise notice 'Stockage non configuré (%). Crée le bucket "card-images" à la main si besoin.', sqlerrm;
end $$;

-- =====================================================================
-- 15. Temps réel : l'appli est prévenue à chaque changement
-- =====================================================================
do $$
begin
  alter publication supabase_realtime add table
    profiles, cards, inventory, bank_stock, pulls, trades, trade_items, market_tx, news, price_history;
exception when others then
  raise notice 'Temps réel non configuré (%).', sqlerrm;
end $$;

-- =====================================================================
-- 16. Tâches planifiées : historique des cours chaque minute
--     (nécessite l'extension pg_cron : Database > Extensions > pg_cron)
-- =====================================================================
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('synedex-record-prices', '* * * * *', 'select public.record_prices()');
  perform cron.schedule('synedex-prune-history', '0 4 * * *',
    $c$delete from public.price_history where at < now() - interval '90 days'$c$);
exception when others then
  raise notice 'pg_cron indisponible (%). Active-le puis relance ce bloc.', sqlerrm;
end $$;

-- =====================================================================
-- 17. PREMIER ADMIN — remplace par ton e-mail, puis inscris-toi dans l'appli
-- =====================================================================
insert into allowed_emails (email, display_name, is_admin) values
  ('ton-email@exemple.com', 'Julien', true)
on conflict (email) do nothing;
