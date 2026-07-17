-- Ajout des héros sortis le 2026-07-17/18 (IntID 1395-1399).
-- Titre + origine en anglais (comme le reste de la table) ; arme/déplacement
-- en français (valeurs des FK weapon_types / move_types). art_url laissé NULL.
-- ON CONFLICT DO NOTHING : ré-exécutable sans créer de doublon.

insert into feh.heroes
  (id, int_id, name, title, color, weapon_type, move_type, rarity, origin, release_date)
values
  ('groa-future-daughter-1395',   1395, 'Gróa',      'Future Daughter', 'blue',  'Tome',  'Unité volante', 5, 'Fire Emblem Heroes',  '2026-07-17'),
  ('alear-and-sommie-1396',       1396, 'Alear',     'And Sommie!',     'red',   'Souffle','Fantassin',    5, 'Fire Emblem Engage',  '2026-07-17'),
  ('alear-casual-duelist-1397',   1397, 'Alear',     'Casual Duelist',  'red',   'Épée',  'Fantassin',     5, 'Fire Emblem Engage',  '2026-07-17'),
  ('jade-iron-wall-1398',         1398, 'Jade',      'Iron Wall',       'green', 'Hache', 'Cuirassé',      5, 'Fire Emblem Engage',  '2026-07-17'),
  ('boucheron-big-softy-1399',    1399, 'Boucheron', 'Big Softy',       'green', 'Hache', 'Fantassin',     5, 'Fire Emblem Engage',  '2026-07-18')
on conflict (id) do nothing;
