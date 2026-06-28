// Génération du seed SQL pour le catalogue de héros (schéma "feh").
// Partagé entre import-heroes.mjs et gen-seed.mjs.

export function sql(value) {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function buildSeed(heroes, schema = 'feh') {
  const t = `${schema}.heroes`;
  const lines = [
    '-- Seed auto-généré (catalogue des héros). À exécuter APRÈS supabase/schema.sql',
    'begin;',
    `insert into ${t} (id,int_id,name,title,color,weapon_type,move_type,rarity,origin,art_url,release_date) values`,
  ];
  const values = heroes.map(
    (h) =>
      `  (${sql(h.id)},${sql(h.intId ?? null)},${sql(h.name)},${sql(h.title)},${sql(
        h.color,
      )},${sql(h.weaponType)},${sql(h.moveType)},${sql(h.rarity)},${sql(
        h.origin,
      )},${sql(h.art ?? null)},${sql(h.releaseDate ?? null)})`,
  );
  lines.push(values.join(',\n'));
  lines.push(
    'on conflict (id) do update set',
    '  int_id=excluded.int_id, name=excluded.name, title=excluded.title,',
    '  color=excluded.color, weapon_type=excluded.weapon_type, move_type=excluded.move_type,',
    '  rarity=excluded.rarity, origin=excluded.origin, art_url=excluded.art_url,',
    '  release_date=excluded.release_date;',
    'commit;',
  );
  return lines.join('\n');
}
