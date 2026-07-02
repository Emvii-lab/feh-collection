// ============================================================
//  Couche 1 : import des compétences (armes + skills) + learnset.
//  Lit les tables Cargo "Skills" et "UnitSkills" du wiki FEH.
//  Produit : supabase/seed_skills.sql  +  supabase/seed_learnset.sql
//  Usage :   node scripts/import-skills.mjs
// ============================================================
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://feheroes.fandom.com/api.php';
const PAGE = 500;
const DELAY = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Récupération Cargo paginée + tolérante au rate limit ----
async function fetchAll(tables, fields) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      action: 'cargoquery',
      tables,
      fields,
      limit: String(PAGE),
      offset: String(offset),
      format: 'json',
    });
    const url = `${API}?${params}`;
    let json;
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'feh-collection-tracker/1.0 (perso)' },
      });
      json = await res.json();
      const info = json.error?.info || '';
      if (json.error && /rate limit|ratelimited/i.test(info)) {
        const wait = Math.min(90000, 20000 * (attempt + 1));
        console.warn(`  rate limit, pause ${wait / 1000}s…`);
        await sleep(wait);
        continue;
      }
      break;
    }
    if (json.error) throw new Error(JSON.stringify(json.error));
    const batch = (json.cargoquery ?? []).map((x) => x.title);
    rows.push(...batch);
    console.log(`  ${tables}: +${batch.length} (total ${rows.length})`);
    if (batch.length < PAGE) break;
    offset += PAGE;
    await sleep(DELAY);
  }
  return rows;
}

// ---- Helpers SQL ---------------------------------------------
const s = (v) => {
  if (v === undefined || v === null || v === '') return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const n = (v) => {
  const x = parseInt(v, 10);
  return Number.isFinite(x) ? String(x) : 'null';
};
const b = (v) => (v === '1' || v === 'true' || v === 'yes' ? 'true' : 'false');

// INSERT chunké (évite un unique statement géant).
function chunkedInsert(table, cols, rows, rowToVals, onConflict, chunk = 800) {
  const out = ['begin;'];
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    out.push(`insert into ${table} (${cols.join(',')}) values`);
    out.push(slice.map((r) => '  (' + rowToVals(r).join(',') + ')').join(',\n') + onConflict + ';');
  }
  out.push('commit;');
  return out.join('\n');
}

// ---- Main ----------------------------------------------------
(async () => {
  await mkdir(join(ROOT, 'supabase'), { recursive: true });

  // 1) Compétences
  console.log('Import des compétences (table Skills)…');
  const rawSkills = await fetchAll(
    'Skills',
    'WikiName,Name,GroupName,TagID,Scategory,UseRange,RefinePath,Description,Required,Next,Exclusive,SP,CanUseMove,CanUseWeapon,Might,StatModifiers,Cooldown,WeaponEffectiveness,Properties',
  );
  // dédoublonnage par WikiName
  const seen = new Set();
  const skills = rawSkills.filter(
    (k) => k.WikiName && !seen.has(k.WikiName) && seen.add(k.WikiName),
  );
  const skillsSeed = chunkedInsert(
    'feh.skills',
    ['wiki_name', 'name', 'group_name', 'tag_id', 'scategory', 'use_range',
     'refine_path', 'description', 'required', 'next', 'exclusive', 'sp',
     'can_use_move', 'can_use_weapon', 'might', 'stat_modifiers', 'cooldown',
     'weapon_effectiveness', 'properties'],
    skills,
    (k) => [
      s(k.WikiName), s(k.Name), s(k.GroupName), s(k.TagID), s(k.Scategory),
      n(k.UseRange), s(k.RefinePath), s(k.Description), s(k.Required), s(k.Next),
      b(k.Exclusive), n(k.SP), s(k.CanUseMove), s(k.CanUseWeapon), n(k.Might),
      s(k.StatModifiers), n(k.Cooldown), s(k.WeaponEffectiveness), s(k.Properties),
    ],
    `\non conflict (wiki_name) do update set
  name=excluded.name, scategory=excluded.scategory, use_range=excluded.use_range,
  refine_path=excluded.refine_path, description=excluded.description,
  required=excluded.required, next=excluded.next, exclusive=excluded.exclusive,
  sp=excluded.sp, can_use_move=excluded.can_use_move, can_use_weapon=excluded.can_use_weapon,
  might=excluded.might, stat_modifiers=excluded.stat_modifiers, cooldown=excluded.cooldown,
  weapon_effectiveness=excluded.weapon_effectiveness, properties=excluded.properties`,
  );
  await writeFile(join(ROOT, 'supabase/seed_skills.sql'),
    '-- Seed compétences (à exécuter APRÈS migration_skills.sql)\n' + skillsSeed, 'utf8');
  console.log(`✅ ${skills.length} compétences → supabase/seed_skills.sql`);

  // 2) Learnset (UnitSkills)
  console.log('\nImport du learnset (table UnitSkills)…');
  const learn = await fetchAll('UnitSkills', 'WikiName,skill,skillPos,defaultRarity,unlockRarity');
  const learnSeed = chunkedInsert(
    'feh.hero_learnset',
    ['unit_wiki_name', 'skill_name', 'skill_pos', 'default_rarity', 'unlock_rarity'],
    learn,
    (r) => [s(r.WikiName), s(r.skill), n(r.skillPos), n(r.defaultRarity), n(r.unlockRarity)],
    '', // pas de conflit (clé surrogate)
  );
  // Résolution hero_id via le nom de page reconstruit "Name: Title"
  const resolve = `
-- Relie chaque ligne à un héros du catalogue (nom de page = "Nom: Titre").
update feh.hero_learnset l
   set hero_id = h.id
  from feh.heroes h
 where l.hero_id is null
   and l.unit_wiki_name = case
         when coalesce(h.title,'') = '' then h.name
         else h.name || ': ' || h.title end;
`;
  await writeFile(join(ROOT, 'supabase/seed_learnset.sql'),
    '-- Seed learnset (à exécuter APRÈS seed_skills.sql)\n' + learnSeed + '\n' + resolve, 'utf8');
  console.log(`✅ ${learn.length} lignes de learnset → supabase/seed_learnset.sql`);

  console.log('\nTerminé. Exécute dans Studio, dans l\'ordre :');
  console.log('  1) supabase/migration_skills.sql');
  console.log('  2) supabase/seed_skills.sql');
  console.log('  3) supabase/seed_learnset.sql');
})().catch((e) => {
  console.error('❌ Échec import :', e);
  process.exit(1);
});
