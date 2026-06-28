-- ============================================================
--  Migration : voix japonaises + variantes d'illustration
--  À coller dans le SQL Editor de ton Supabase Studio (schéma feh).
-- ============================================================

-- 1) Table des voix (une voix = plusieurs héros)
create table if not exists feh.voice_actors (
  id         serial primary key,
  name       text not null,            -- nom romanisé / latin
  name_ja    text,                     -- nom en japonais (ex: 江口拓也)
  created_at timestamptz not null default now()
);

-- 2) Lien héros -> voix japonaise (FK ; null si inconnu)
alter table feh.heroes
  add column if not exists cv_ja_id int references feh.voice_actors(id) on delete set null;
create index if not exists heroes_cv_ja_idx on feh.heroes (cv_ja_id);

-- 3) Variantes d'illustration (pour la loupe)
alter table feh.heroes add column if not exists art_attack_url  text; -- pose d'attaque
alter table feh.heroes add column if not exists art_special_url text; -- pose de compétence
alter table feh.heroes add column if not exists art_injured_url text; -- pose blessé

-- (description : au cas où elle n'existe pas encore)
alter table feh.heroes add column if not exists description text;

-- 4) RLS + droits pour la nouvelle table
alter table feh.voice_actors enable row level security;
drop policy if exists "voice_actors_read" on feh.voice_actors;
create policy "voice_actors_read" on feh.voice_actors for select using (true);
drop policy if exists "voice_actors_all" on feh.voice_actors;
create policy "voice_actors_all" on feh.voice_actors for all using (true) with check (true);

grant all on all tables in schema feh to anon, authenticated, service_role;
grant all on all sequences in schema feh to anon, authenticated, service_role;

-- 5) Forcer PostgREST à relire le schéma (sinon la FK/embed n'apparaît pas)
notify pgrst, 'reload schema';
