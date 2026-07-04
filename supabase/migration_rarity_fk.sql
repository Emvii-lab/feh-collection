-- ============================================================
--  FK : feh.heroes.rarity -> feh.rarity_icons.rarity
--  (rarity_icons contient déjà 1..6 ; aucune rareté hero hors plage/null.)
--  À exécuter dans le SQL Editor de Supabase Studio.
-- ============================================================

alter table feh.heroes drop constraint if exists heroes_rarity_fk;
alter table feh.heroes
  add constraint heroes_rarity_fk
  foreign key (rarity) references feh.rarity_icons(rarity);
