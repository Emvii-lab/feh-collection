-- ============================================================
--  Couche 1 : catalogue des compétences (armes + skills) + learnset
--  Source : tables Cargo "Skills" et "UnitSkills" du wiki FEH.
--  Ordre : 1) ce fichier  2) seed_skills.sql  3) seed_learnset.sql
-- ============================================================

-- Toutes les compétences du jeu (armes, assists, spéciales, passives A/B/C/S).
create table if not exists feh.skills (
  wiki_name            text primary key,   -- identifiant unique (page wiki)
  name                 text,               -- nom affiché
  group_name           text,
  tag_id               text,
  scategory            text,   -- weapon / assist / special / passivea / passiveb / passivec / passives
  use_range            int,    -- portée (1 mêlée / 2 distance)
  refine_path          text,
  description          text,   -- effet (texte)
  required             text,   -- compétence prérequise (chaîne)
  next                 text,   -- amélioration suivante
  exclusive            boolean,-- PRF (non héritable)
  sp                   int,    -- coût SP
  can_use_move         text,   -- types de déplacement autorisés (héritage)
  can_use_weapon       text,   -- types d'arme autorisés (héritage)
  might                int,     -- puissance (armes)
  stat_modifiers       text,    -- bonus de stats (passives/seals)
  cooldown             int,     -- jauge (spéciales)
  weapon_effectiveness text,    -- efficace contre (armes)
  properties           text
);
create index if not exists skills_scategory_idx on feh.skills (scategory);

-- Kit natif : quelle unité apprend quelle compétence, à quelle rareté.
create table if not exists feh.hero_learnset (
  id             bigint generated always as identity primary key,
  unit_wiki_name text,                       -- nom de page de l'unité (brut)
  hero_id        text references feh.heroes(id) on delete cascade, -- résolu (peut être null)
  skill_name     text,                        -- = feh.skills.name / wiki_name
  skill_pos      int,
  default_rarity int,
  unlock_rarity  int
);
create index if not exists learnset_hero_idx on feh.hero_learnset (hero_id);
create index if not exists learnset_unit_idx on feh.hero_learnset (unit_wiki_name);

-- Droits + RLS (lecture publique, comme le catalogue de héros)
grant all on feh.skills to anon, authenticated, service_role;
grant all on feh.hero_learnset to anon, authenticated, service_role;
grant usage, select on all sequences in schema feh to anon, authenticated, service_role;

alter table feh.skills        enable row level security;
alter table feh.hero_learnset enable row level security;

drop policy if exists "skills_read" on feh.skills;
create policy "skills_read" on feh.skills for select using (true);

drop policy if exists "learnset_read" on feh.hero_learnset;
create policy "learnset_read" on feh.hero_learnset for select using (true);
