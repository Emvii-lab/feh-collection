// ============================================================
//  Import du roster Fire Emblem Heroes depuis le wiki (Fandom).
//  - Lit la table Cargo "Units" (paginée, throttlée).
//  - Dérive couleur / arme / image (URL construite via MD5, sans appel API).
//  - Produit : src/data/heroes.json  +  supabase/seed.sql
//
//  Usage :  node scripts/import-heroes.mjs
// ============================================================
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSeed } from './seed.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const API = 'https://feheroes.fandom.com/api.php';
const PAGE = 500; // lignes par requête
const DELAY = 5000; // ms entre requêtes (respect du rate limit)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Mappings -------------------------------------------------
const COLOR_MAP = { Red: 'red', Blue: 'blue', Green: 'green', Colorless: 'colorless' };

// "Blue Lance" -> { color:'blue', weaponType:'Lance' }
// NB : le wiki nomme l'arme des dragons "Breath" et celle des bêtes "Beast".
function parseWeapon(wt) {
  if (!wt) return { color: 'colorless', weaponType: 'Sword' };
  const first = wt.split(' ')[0];
  const color = COLOR_MAP[first] ?? 'colorless';
  let weaponType;
  if (/Breath/.test(wt)) weaponType = 'Dragon';
  else if (/Beast/.test(wt)) weaponType = 'Beast';
  else if (/Tome/.test(wt)) weaponType = 'Tome';
  else
    weaponType =
      ['Sword', 'Lance', 'Axe', 'Bow', 'Dagger', 'Staff'].find((w) =>
        wt.includes(w),
      ) ?? 'Sword';
  return { color, weaponType };
}

function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// URL d'image Fandom dérivée du MD5 du nom de fichier (pas d'appel API).
function imageUrl(name, title) {
  const file = `${name} ${title} Face.webp`.replace(/ /g, '_');
  const h = createHash('md5').update(file).digest('hex');
  return `https://static.wikia.nocookie.net/feheroes_gamepedia_en/images/${h[0]}/${h.slice(
    0,
    2,
  )}/${encodeURIComponent(file)}`;
}

// ---- Récupération paginée ------------------------------------
async function fetchAllUnits() {
  const rows = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      action: 'cargoquery',
      tables: 'Units',
      fields: 'Name,Title,WeaponType,MoveType,Origin,IntID,Properties,ReleaseDate',
      order_by: 'IntID',
      limit: String(PAGE),
      offset: String(offset),
      format: 'json',
    });
    const url = `${API}?${params}`;
    let json;
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'feh-collection-tracker/1.0 (perso)' },
      });
      json = await res.json();
      if (json.error?.code === 'ratelimited') {
        const wait = Math.min(60000, 15000 * (attempt + 1));
        console.warn(`  rate limit, pause ${wait / 1000}s…`);
        await sleep(wait);
        continue;
      }
      break;
    }
    if (json.error) throw new Error(JSON.stringify(json.error));
    const batch = json.cargoquery ?? [];
    rows.push(...batch.map((x) => x.title));
    console.log(`  +${batch.length} (total ${rows.length}, offset ${offset})`);
    if (batch.length < PAGE) break;
    offset += PAGE;
    await sleep(DELAY);
  }
  return rows;
}

// ---- Transformation ------------------------------------------
function toHero(u) {
  const { color, weaponType } = parseWeapon(u.WeaponType);
  const name = u.Name?.trim();
  const title = u.Title?.trim() ?? '';
  const intId = Number(u.IntID) || undefined;
  return {
    id: `${slugify(name)}-${slugify(title)}${intId ? '-' + intId : ''}`,
    intId,
    name,
    title,
    color,
    weaponType,
    moveType: u.MoveType ?? 'Infantry',
    rarity: 5,
    origin: u.Origin ?? '',
    art: imageUrl(name, title),
    releaseDate: u.ReleaseDate || undefined,
  };
}

// ---- Main ----------------------------------------------------
(async () => {
  console.log('Téléchargement du roster depuis le wiki FEH…');
  const units = await fetchAllUnits();

  const heroes = units
    .filter((u) => u.Name && u.Name !== '???' && u.WeaponType) // ignore les héros masqués
    .map(toHero);

  // Dédoublonnage par id
  const seen = new Set();
  const unique = heroes.filter((h) => !seen.has(h.id) && seen.add(h.id));

  await mkdir(join(ROOT, 'src/data'), { recursive: true });
  await mkdir(join(ROOT, 'supabase'), { recursive: true });

  await writeFile(
    join(ROOT, 'src/data/heroes.json'),
    JSON.stringify(unique, null, 2),
    'utf8',
  );
  await writeFile(join(ROOT, 'supabase/seed.sql'), buildSeed(unique), 'utf8');

  console.log(`\n✅ ${unique.length} héros importés.`);
  console.log('   → src/data/heroes.json');
  console.log('   → supabase/seed.sql');
})().catch((e) => {
  console.error('❌ Échec import :', e);
  process.exit(1);
});
