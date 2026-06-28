-- ============================================================
--  Schéma Supabase (SELF-HOSTED) — schéma dédié "feh"
--  Catalogue & Collection Fire Emblem Heroes.
--  À coller dans le SQL Editor de ton Supabase Studio.
--
--  ⚠️ IMPORTANT (self-hosted) : pour que l'API REST (PostgREST)
--  expose le schéma "feh", il faut l'ajouter à la config — voir
--  le bloc "EXPOSER LE SCHÉMA" en bas de ce fichier.
-- ============================================================

-- 0) Schéma dédié
create schema if not exists feh;

-- 1) Voix japonaises (une voix = plusieurs héros)
create table if not exists feh.voice_actors (
  id         serial primary key,
  name       text not null,              -- nom romanisé / latin
  name_ja    text,                       -- nom en japonais
  created_at timestamptz not null default now()
);

-- 1bis) Illustrateurs (un illustrateur = plusieurs héros)
create table if not exists feh.illustrators (
  id         serial primary key,
  name       text not null,              -- nom romanisé / latin
  name_ja    text,                       -- nom en japonais
  created_at timestamptz not null default now()
);

-- 2) Catalogue de tous les héros du jeu
create table if not exists feh.heroes (
  id              text primary key,       -- slug stable, ex: "alfonse-prince-of-askr-466"
  int_id          int,                    -- IntID interne FEH
  name            text not null,
  title           text not null,
  color           text not null check (color in ('red','blue','green','colorless')),
  weapon_type     text not null,          -- Sword, Lance, Axe, Tome, Bow, Dagger, Staff, Dragon, Beast
  move_type       text not null,          -- valeur libre (tu gères les noms toi-même)
  rarity          int  not null default 5,
  origin          text not null default '',
  origin_url      text,                   -- image du jeu d'origine
  description     text,                   -- présentation / lore
  art_url         text,                   -- illustration (normal)
  art_attack_url  text,                   -- illustration pose d'attaque
  art_special_url text,                   -- illustration pose compétence
  art_injured_url text,                   -- illustration pose blessé
  element_url     text,                   -- icône élément/bénédiction (Légendaires/Mythiques)
  art_resplendent_url         text,       -- tenue resplendissante : pose normale (illustration)
  art_resplendent_attack_url  text,       -- tenue resplendissante : pose d'attaque
  art_resplendent_special_url text,       -- tenue resplendissante : pose compétence
  art_resplendent_injured_url text,       -- tenue resplendissante : pose blessé
  sprite_resplendent_url      text,       -- tenue resplendissante : sprite (chibi)
  cv_ja_id        int references feh.voice_actors(id) on delete set null,
  cv_ja_partner_id  int references feh.voice_actors(id) on delete set null,
  cv_ja_partner2_id int references feh.voice_actors(id) on delete set null,
  illustrator_id  int references feh.illustrators(id) on delete set null,
  illustrator_resplendent_id int references feh.illustrators(id) on delete set null,
  release_date    date,
  stats           jsonb,                  -- {hp,atk,spd,def,res} si connu
  created_at      timestamptz not null default now()
);

-- 2) Ma collection : un héros présent = possédé
--    (mono-utilisateur pour l'instant ; user_id ajouté plus tard si besoin)
create table if not exists feh.collection (
  hero_id     text primary key references feh.heroes(id) on delete cascade,
  copies      int not null default 1,     -- nb d'exemplaires / merges
  note        text,
  acquired_at timestamptz not null default now()
);

-- Index utiles
create index if not exists heroes_color_idx  on feh.heroes (color);
create index if not exists heroes_move_idx   on feh.heroes (move_type);
create index if not exists heroes_weapon_idx on feh.heroes (weapon_type);
create index if not exists heroes_cv_ja_idx  on feh.heroes (cv_ja_id);
create index if not exists heroes_cv_ja_partner_idx on feh.heroes (cv_ja_partner_id);
create index if not exists heroes_cv_ja_partner2_idx on feh.heroes (cv_ja_partner2_id);
create index if not exists heroes_illustrator_idx on feh.heroes (illustrator_id);
create index if not exists heroes_illustrator_resp_idx on feh.heroes (illustrator_resplendent_id);

-- 3) Droits sur le schéma & les tables (rôles Supabase)
grant usage on schema feh to anon, authenticated, service_role;
grant all on all tables in schema feh to anon, authenticated, service_role;
grant all on all sequences in schema feh to anon, authenticated, service_role;
-- Pour les futures tables créées dans ce schéma :
alter default privileges in schema feh
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema feh
  grant all on sequences to anon, authenticated, service_role;

-- 4) Row Level Security
--    Lecture publique du catalogue ; collection ouverte en mode perso.
--    (Restreins avec l'auth Supabase quand tu voudras un vrai compte.)
alter table feh.heroes       enable row level security;
alter table feh.collection   enable row level security;
alter table feh.voice_actors enable row level security;
alter table feh.illustrators enable row level security;

drop policy if exists "heroes_read" on feh.heroes;
create policy "heroes_read" on feh.heroes
  for select using (true);

drop policy if exists "voice_actors_read" on feh.voice_actors;
create policy "voice_actors_read" on feh.voice_actors
  for select using (true);
drop policy if exists "voice_actors_all" on feh.voice_actors;
create policy "voice_actors_all" on feh.voice_actors
  for all using (true) with check (true);

drop policy if exists "illustrators_read" on feh.illustrators;
create policy "illustrators_read" on feh.illustrators
  for select using (true);
drop policy if exists "illustrators_all" on feh.illustrators;
create policy "illustrators_all" on feh.illustrators
  for all using (true) with check (true);

drop policy if exists "collection_all" on feh.collection;
create policy "collection_all" on feh.collection
  for all using (true) with check (true);

-- ============================================================
--  EXPOSER LE SCHÉMA "feh" À L'API (à faire UNE fois, self-hosted)
-- ------------------------------------------------------------
--  Méthode A — variable d'environnement PostgREST (recommandée) :
--    Dans le .env de ton stack Supabase (docker), ajoute "feh" :
--      PGRST_DB_SCHEMAS=public,graphql_public,storage,feh
--    puis recharge :  docker compose restart rest
--    (ou redémarre le service "rest" / "postgrest").
--
--  Méthode B — rechargement à chaud sans redémarrer (si tu as déjà
--  ajouté la variable, ou pour forcer PostgREST à relire) :
--      notify pgrst, 'reload config';
--      notify pgrst, 'reload schema';
-- ============================================================
