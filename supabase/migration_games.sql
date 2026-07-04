-- ============================================================
--  Table des jeux + FK feh.heroes.origin -> feh.games.name
--  Choix : "jeu principal" = 1er jeu de la liste `origin` (séparée par des
--  virgules). Les jeux secondaires (cross-apparitions) sont abandonnés.
--  À exécuter dans le SQL Editor de Supabase Studio.
-- ============================================================

-- 1) Réduire origin au jeu principal (1er élément avant la virgule).
update feh.heroes
set origin = split_part(origin, ',', 1)
where origin is not null and origin like '%,%';

-- 2) Table des jeux (icon_url = logo à remplir plus tard, comme rarity_icons).
create table if not exists feh.games (
  name       text primary key,
  icon_url   text,
  sort_order int
);
grant all on feh.games to anon, authenticated, service_role;
alter table feh.games enable row level security;
drop policy if exists "games_read" on feh.games;
create policy "games_read" on feh.games for select using (true);

-- 3) Peupler depuis les origines (désormais mono-jeu).
insert into feh.games (name)
select distinct origin from feh.heroes where origin is not null
on conflict (name) do nothing;

-- 4) FK.
alter table feh.heroes drop constraint if exists heroes_origin_fk;
alter table feh.heroes
  add constraint heroes_origin_fk
  foreign key (origin) references feh.games(name);
