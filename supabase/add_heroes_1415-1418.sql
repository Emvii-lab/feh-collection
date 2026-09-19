-- Ajout auto (feh_gen_sql.py) : héros IntID 1415-1418, généré le 2026-09-19.
-- Titre + origine en anglais (comme le reste de la table) ; arme/déplacement
-- en français (valeurs des FK weapon_types / move_types). Rarity = 5 (convention
-- du catalogue). art_url laissé NULL. VÉRIFIE avant d'exécuter (titre EN à garder,
-- ou traduire toi-même comme d'habitude). ON CONFLICT DO NOTHING : ré-exécutable.
insert into feh.heroes
  (id, int_id, name, title, color, weapon_type, move_type, rarity, origin, release_date)
values
  ('lyn-earth-and-sky-1415',1415,'Lyn','Earth and Sky','red','Arc','Cavalerie',5,'Fire Emblem: The Blazing Blade','2026-09-18'),
  ('takumi-divine-bow-prince-1416',1416,'Takumi','Divine Bow Prince','colorless','Arc','Fantassin',5,'Fire Emblem Fates','2026-09-18'),
  ('rebecca-in-the-sun-s-rays-1417',1417,'Rebecca','In the Sun''s Rays','green','Arc','Cavalerie',5,'Fire Emblem: The Blazing Blade','2026-09-18'),
  ('shamir-sniper-s-path-1418',1418,'Shamir','Sniper''s Path','blue','Arc','Fantassin',5,'Fire Emblem: Three Houses','2026-09-18')
on conflict (id) do nothing;
