-- ============================================================
--  feh.hero_voices — URLs Cloudinary des voix par héros
--  Une ligne par héros ; une colonne par clip vocal.
--  À coller dans le SQL Editor de Supabase Studio.
-- ============================================================

create table if not exists feh.hero_voices (
  hero_id text primary key references feh.heroes(id) on delete cascade,

  -- Voix de combat (universelles)
  attack_1 text,
  attack_2 text,
  special_1 text,
  special_2 text,
  damage_1 text,
  damage_2 text,
  damage_3 text,
  dead_1 text,
  skill_1 text,
  skill_2 text,
  skill_3 text,
  skill_4 text,
  skill_5 text,
  skill_6 text,
  map_1 text,
  map_2 text,
  map_3 text,
  map_4 text,
  status_1 text,
  status_2 text,
  status_3 text,
  status_4 text,
  status_5 text,
  status_6 text,
  status_7 text,
  status_8 text,
  status_9 text,
  status_10 text,
  status_11 text,
  support_1 text,
  support_2 text,
  support_3 text,

  -- Catégories de niche (supprime ce bloc si tu n'en veux pas)
  reliance_1 text,
  reliance_2 text,
  reliance_3 text,
  reliance_4 text,
  reliance_5 text,
  reliance_6 text,
  reliance_7 text,
  reliance_8 text,
  reliance_9 text,
  reliance_10 text,
  reliance_11 text,
  reliance_12 text,
  reliance_13 text,
  reliance_14 text,
  reliance_15 text,
  reliance_16 text,
  reliance_17 text,
  reliance_18 text,
  reliance_19 text,
  title_1 text,
  title_2 text,
  title_3 text,
  title_4 text,
  title_5 text,
  title_6 text,
  title_7 text,
  title_8 text,
  title_9 text,
  title_10 text,
  title_11 text,
  title_12 text,
  title_13 text,
  title_14 text,
  title_15 text,
  tutorial_1 text,
  tutorial_2 text,
  tutorial_3 text,
  tutorial_4 text,
  tutorial_5 text,
  tutorial_6 text,
  tutorial_7 text,
  tutorial_8 text,
  tutorial_9 text,

  updated_at timestamptz not null default now()
);

-- Droits (cohérent avec le reste du schéma feh)
grant all on feh.hero_voices to anon, authenticated, service_role;

-- RLS : lecture publique, écriture autorisée (mono-utilisateur)
alter table feh.hero_voices enable row level security;

drop policy if exists "hero_voices_read" on feh.hero_voices;
create policy "hero_voices_read" on feh.hero_voices
  for select using (true);

drop policy if exists "hero_voices_all" on feh.hero_voices;
create policy "hero_voices_all" on feh.hero_voices
  for all using (true) with check (true);
