-- ============================================================
--  Icônes d'étoiles par palier de rareté (réutilisées partout).
--  feh.rarity_icons : rarity (1..5) -> url de l'étoile de ce palier.
--  À exécuter dans le SQL Editor de Supabase Studio.
-- ============================================================

create table if not exists feh.rarity_icons (
  rarity int primary key,
  url    text not null
);

grant all on feh.rarity_icons to anon, authenticated, service_role;
alter table feh.rarity_icons enable row level security;
drop policy if exists "rarity_icons_read" on feh.rarity_icons;
create policy "rarity_icons_read" on feh.rarity_icons for select using (true);

insert into feh.rarity_icons (rarity, url) values
  (3, 'https://res.cloudinary.com/dd4rdtrig/image/upload/v1782333778/rarity_3_cjvbgu.png'),
  (4, 'https://res.cloudinary.com/dd4rdtrig/image/upload/v1782333779/rarity_4_zt23ts.png'),
  (5, 'https://res.cloudinary.com/dd4rdtrig/image/upload/v1782333780/rarity_5_lgorol.png')
on conflict (rarity) do update set url = excluded.url;
