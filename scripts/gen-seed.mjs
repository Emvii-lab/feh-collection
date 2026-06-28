// Régénère supabase/seed.sql à partir de src/data/heroes.json (SANS appel API).
// Usage : node scripts/gen-seed.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSeed } from './seed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const heroes = JSON.parse(
  await readFile(join(ROOT, 'src/data/heroes.json'), 'utf8'),
);
await writeFile(join(ROOT, 'supabase/seed.sql'), buildSeed(heroes, 'feh'), 'utf8');

console.log(`✅ seed.sql régénéré (${heroes.length} héros, schéma feh).`);
