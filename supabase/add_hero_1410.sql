-- Ajout auto (feh_gen_sql.py) : héros IntID 1410, généré le 2026-09-05.
-- Titre + origine en anglais (comme le reste de la table) ; arme/déplacement
-- en français (valeurs des FK weapon_types / move_types). Rarity = 5 (convention
-- du catalogue). art_url laissé NULL. VÉRIFIE avant d'exécuter (titre EN à garder,
-- ou traduire toi-même comme d'habitude). ON CONFLICT DO NOTHING : ré-exécutable.
insert into feh.heroes
  (id, int_id, name, title, color, weapon_type, move_type, rarity, origin, release_date)
values
  ('rhea-the-final-child-1410',1410,'Rhea','The Final Child','blue','Souffle','Fantassin',5,'Fire Emblem: Three Houses','2026-08-31')
on conflict (id) do nothing;
