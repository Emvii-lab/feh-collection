-- ============================================================
--  Migration : seconde voix (Héros Duo / Harmonisés)
--  À coller dans le SQL Editor de ton Supabase Studio (schéma feh).
-- ============================================================

-- Voix du second personnage (Duo/Harmonisé ; null sinon)
alter table feh.heroes
  add column if not exists cv_ja_partner_id int references feh.voice_actors(id) on delete set null;
create index if not exists heroes_cv_ja_partner_idx on feh.heroes (cv_ja_partner_id);

-- Voix du troisième personnage (Trio ; null sinon)
alter table feh.heroes
  add column if not exists cv_ja_partner2_id int references feh.voice_actors(id) on delete set null;
create index if not exists heroes_cv_ja_partner2_idx on feh.heroes (cv_ja_partner2_id);

-- Forcer PostgREST à relire le schéma
notify pgrst, 'reload schema';
