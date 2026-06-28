-- ============================================================
--  Migration : tenues resplendissantes (4 poses)
--  À coller dans le SQL Editor de ton Supabase Studio (schéma feh).
-- ============================================================

alter table feh.heroes add column if not exists art_resplendent_url         text; -- pose normale (illustration)
alter table feh.heroes add column if not exists art_resplendent_attack_url  text; -- pose d'attaque
alter table feh.heroes add column if not exists art_resplendent_special_url text; -- pose de compétence
alter table feh.heroes add column if not exists art_resplendent_injured_url text; -- pose blessé
alter table feh.heroes add column if not exists sprite_resplendent_url      text; -- sprite (chibi) resplendissant

-- Illustrateur de la tenue resplendissante (peut différer ; même table illustrators)
alter table feh.heroes
  add column if not exists illustrator_resplendent_id int references feh.illustrators(id) on delete set null;
create index if not exists heroes_illustrator_resp_idx on feh.heroes (illustrator_resplendent_id);

-- Forcer PostgREST à relire le schéma
notify pgrst, 'reload schema';
