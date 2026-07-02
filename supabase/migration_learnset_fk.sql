-- ============================================================
--  FK : feh.hero_learnset.skill_name -> feh.skills.wiki_name
--  Intégrité référentielle + jointures/embedding PostgREST.
--  À exécuter dans le SQL Editor de Supabase Studio (petit, pas de limite).
--  Vérifié : 0 orphelin (tous les skill_name existent dans skills).
-- ============================================================

alter table feh.hero_learnset drop constraint if exists hero_learnset_skill_fk;

alter table feh.hero_learnset
  add constraint hero_learnset_skill_fk
  foreign key (skill_name) references feh.skills(wiki_name)
  on delete cascade;

-- Index utiles (créés s'ils manquent)
create index if not exists learnset_skill_idx on feh.hero_learnset (skill_name);
create index if not exists skills_scategory_idx on feh.skills (scategory);
