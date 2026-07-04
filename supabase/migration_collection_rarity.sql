-- ============================================================
--  Rareté de MON exemplaire (étoiles) par héros, dans la collection.
--  feh.collection.rarity : 1..5 (null = non renseigné).
--  À exécuter dans le SQL Editor de Supabase Studio.
-- ============================================================

alter table feh.collection add column if not exists rarity int;

alter table feh.collection drop constraint if exists collection_rarity_chk;
alter table feh.collection
  add constraint collection_rarity_chk
  check (rarity is null or rarity between 1 and 5);
