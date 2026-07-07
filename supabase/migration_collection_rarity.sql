-- ============================================================
--  Rareté de MON exemplaire (étoiles) par héros, dans la collection.
--  feh.collection.rarity : 1..5 (null = non renseigné).
--  À exécuter dans le SQL Editor de Supabase Studio.
-- ============================================================

alter table feh.collection add column if not exists rarity int;

-- 1..6 : 6 = Forma (5 étoiles bleues, Salle des Formes), image dans rarity_icons(6).
alter table feh.collection drop constraint if exists collection_rarity_chk;
alter table feh.collection
  add constraint collection_rarity_chk
  check (rarity is null or rarity between 1 and 6);

-- FK vers les icônes de rareté (cohérence avec heroes.rarity).
alter table feh.collection drop constraint if exists collection_rarity_fk;
alter table feh.collection
  add constraint collection_rarity_fk
  foreign key (rarity) references feh.rarity_icons(rarity);
