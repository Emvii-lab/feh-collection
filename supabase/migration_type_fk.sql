-- Tables de correspondance + FK pour color / move_type / weapon_type (schema feh).
-- Non destructif : ne touche PAS aux colonnes *_url existantes de feh.heroes.
-- A executer dans Supabase Studio (SQL Editor). Idempotent (re-jouable).

create table if not exists feh.colors      (value text primary key, url text);
create table if not exists feh.move_types  (value text primary key, url text);
-- icone d'arme = fonction du COUPLE (couleur, arme) -> cle primaire composite
create table if not exists feh.weapon_types (color text, weapon_type text, url text,
                                             primary key (color, weapon_type));

insert into feh.colors (value,url) values
  ('blue','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782338009/summon_blue_u5ahab.png'),
  ('colorless','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782338012/summon_grey_w5ps0j.png'),
  ('green','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782338009/summon_green_uydhqy.png'),
  ('red','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782338013/summon_red_btkctv.png')
on conflict (value) do update set url=excluded.url;

insert into feh.move_types (value,url) values
  ('Cavalerie','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343963/Icon_Move_Cavalry_rzc32z.webp'),
  ('Cuirassé','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343968/Icon_Move_Armored_rjnx7a.webp'),
  ('Fantassin','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343972/Icon_Move_Infantry_pt9unv.webp'),
  ('Unité volante','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343969/Icon_Move_Flying_tvnja7.webp')
on conflict (value) do update set url=excluded.url;

insert into feh.weapon_types (color,weapon_type,url) values
  ('blue','Arc','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343951/Icon_Class_Blue_Bow_dqs2js.webp'),
  ('blue','Bête','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343960/Icon_Class_Blue_Beast_tpfxdc.webp'),
  ('blue','Dague','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343949/Icon_Class_Blue_Dagger_kkacsk.webp'),
  ('blue','Lance','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343953/Icon_Class_Blue_Lance_uosveu.webp'),
  ('blue','Souffle','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343946/Icon_Class_Blue_Breath_xx49um.webp'),
  ('blue','Tome','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343947/Icon_Class_Blue_Tome_puu7xd.webp'),
  ('colorless','Arc','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782344531/Icon_Class_Colorless_Bow_ar7wjo.webp'),
  ('colorless','Bâton','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782344533/Icon_Class_Colorless_Staff_fjszpv.webp'),
  ('colorless','Bête','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782344525/Icon_Class_Colorless_Beast_oqsjnb.webp'),
  ('colorless','Dague','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782344526/Icon_Class_Colorless_Dagger_a23nj4.webp'),
  ('colorless','Souffle','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782344528/Icon_Class_Colorless_Breath_jefhbl.webp'),
  ('colorless','Tome','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782344530/Icon_Class_Colorless_Tome_atrvik.webp'),
  ('green','Arc','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343943/Icon_Class_Green_Bow_izbe5b.webp'),
  ('green','Bête','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343941/Icon_Class_Green_Beast_luzgdv.webp'),
  ('green','Dague','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343939/Icon_Class_Green_Dagger_cabtqc.webp'),
  ('green','Hache','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343944/Icon_Class_Green_Axe_xug5e0.webp'),
  ('green','Souffle','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343936/Icon_Class_Green_Breath_njmgvj.webp'),
  ('green','Tome','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343937/Icon_Class_Green_Tome_liutv8.webp'),
  ('red','Arc','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343966/Icon_Class_Red_Bow_ohtmhv.webp'),
  ('red','Bête','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343957/Icon_Class_Red_Beast_tvx9oj.webp'),
  ('red','Dague','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343959/Icon_Class_Red_Dagger_dfjcd3.webp'),
  ('red','Souffle','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343954/Icon_Class_Red_Breath_uyzon7.webp'),
  ('red','Tome','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343956/Icon_Class_Red_Tome_u240yk.webp'),
  ('red','Épée','https://res.cloudinary.com/dd4rdtrig/image/upload/v1782343965/Icon_Class_Red_Sword_bpvxbx.webp')
on conflict (color,weapon_type) do update set url=excluded.url;

-- Cles etrangeres. Verifie le 2026-07-09 : les 1393 lignes de heroes matchent toutes
-- (0 violation sur color, move_type, et le couple (color, weapon_type)).
alter table feh.heroes add constraint heroes_color_fk
  foreign key (color) references feh.colors(value);
alter table feh.heroes add constraint heroes_move_type_fk
  foreign key (move_type) references feh.move_types(value);
alter table feh.heroes add constraint heroes_weapon_type_fk
  foreign key (color, weapon_type) references feh.weapon_types(color, weapon_type);

-- ------------------------------------------------------------------
-- Suppression des colonnes *_url redondantes de feh.heroes.
-- A EXECUTER SEULEMENT APRES avoir deploye la version de l'app qui lit
-- les icones depuis feh.colors / move_types / weapon_types (useHeroes.ts,
-- fetchLookup). Sinon l'app en ligne perd ses icones.
-- alter table feh.heroes
--   drop column color_url,
--   drop column weapon_type_url,
--   drop column move_type_url;
