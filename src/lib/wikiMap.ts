// Charge les ennemis d'une carte (map) depuis le wiki FEH (API Fandom, CORS ok).
// Rien n'est stocké : tout est récupéré en direct à la demande.
import type { Color, Hero, WeaponType } from '../types';

export type WikiEnemy = {
  name: string;
  hp: number; atk: number; spd: number; def: number; res: number;
  weapon: string;
  skills: string[]; // arme + spéciale + passifs A/B/C + sceau (noms anglais)
  pos: string; // case sur la grille, ex. "d7"
};
export type WikiMap = {
  title: string;
  difficulties: Record<string, WikiEnemy[]>;
  allyPos: string[]; // cases de départ des alliés
  terrain: Record<string, 'wall' | 'forest' | 'water' | 'trench'>; // murs lus du wiki (le reste = plaine)
};

export type ResolvedEnemy = WikiEnemy & {
  color: Color; weaponType: WeaponType; moveType: string;
};

// Extrait le titre de page depuis une URL de wiki (ou renvoie l'entrée telle quelle).
export function parsePageTitle(input: string): string {
  const t = input.trim();
  const m = t.match(/\/wiki\/([^?#]+)/i);
  const raw = m ? m[1] : t;
  try {
    return decodeURIComponent(raw).replace(/_/g, ' ');
  } catch {
    return raw.replace(/_/g, ' ');
  }
}

const DIFF_RE = /\|(\w+)\s*=\s*\[((?:[^[\]]|\[[^\]]*\])*)\]/g;
const UNIT_BLOCK = /\{([^{}]*)\}/g; // chaque unité { … }
const KNOWN_DIFF = /^(normal|hard|lunatic|infernal|abyssal)$/i;

const field = (block: string, key: string): string => {
  const m = block.match(new RegExp('(?:^|;)' + key + '=([^;]*)'));
  return m ? m[1].trim() : '';
};

export async function fetchWikiMap(pageTitle: string): Promise<WikiMap> {
  const url =
    'https://feheroes.fandom.com/api.php?action=parse&prop=wikitext&format=json&origin=*&page=' +
    encodeURIComponent(pageTitle);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Wiki injoignable (' + res.status + ')');
  const j = await res.json();
  const wt: string = j?.parse?.wikitext?.['*'] ?? '';
  if (!wt) throw new Error('Page introuvable — vérifie l’URL (une page « … (map) »).');

  const difficulties: Record<string, WikiEnemy[]> = {};
  let m: RegExpExecArray | null;
  DIFF_RE.lastIndex = 0;
  while ((m = DIFF_RE.exec(wt))) {
    if (!KNOWN_DIFF.test(m[1])) continue;
    const units: WikiEnemy[] = [];
    let u: RegExpExecArray | null;
    UNIT_BLOCK.lastIndex = 0;
    while ((u = UNIT_BLOCK.exec(m[2]))) {
      const blk = u[1];
      if (!/(?:^|;)unit=/.test(blk)) continue;
      const st = blk.match(/stats=\[(\d+);(\d+);(\d+);(\d+);(\d+)\]/);
      if (!st) continue;
      const skills = ['weapon', 'special', 'a', 'b', 'c', 'seal']
        .map((k) => field(blk, k))
        .filter((s) => s && s !== '-' && s !== '—');
      units.push({
        name: field(blk, 'unit'), pos: field(blk, 'pos'),
        hp: +st[1], atk: +st[2], spd: +st[3], def: +st[4], res: +st[5],
        weapon: field(blk, 'weapon'), skills,
      });
    }
    if (units.length) difficulties[m[1]] = units;
  }
  if (Object.keys(difficulties).length === 0)
    throw new Error('Aucune unité trouvée — cette page n’est pas une carte de combat.');
  const allyM = wt.match(/\|allyPos\s*=\s*([a-h0-9,\s]+)/i);
  const allyPos = allyM
    ? allyM[1].split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  // Terrain : grille par case du wiki (« | b8={{Wall|… »). Seul le mur est encodé
  // de façon fiable (forêt/eau/mer sont dans l'image de fond → à peindre à la main).
  const terrain: WikiMap['terrain'] = {};
  const TERR: Record<string, WikiMap['terrain'][string]> = {
    wall: 'wall', forest: 'forest', water: 'water', trench: 'trench',
  };
  for (const m of wt.matchAll(/\|\s*([a-f][1-8])\s*=\s*\{\{(\w+)/g)) {
    const t = TERR[m[2].toLowerCase()];
    if (t) terrain[m[1].toLowerCase()] = t;
  }

  return { title: pageTitle, difficulties, allyPos, terrain };
}

// Déduit couleur / type d'arme / déplacement : d'abord via tes héros (nom exact),
// sinon depuis le nom générique de l'ennemi (« Axe Knight », « Red Flier »…).
export function resolveEnemy(
  e: WikiEnemy,
  heroByName: (name: string) => Hero | undefined,
): ResolvedEnemy {
  const h = heroByName(e.name);
  if (h) return { ...e, color: h.color, weaponType: h.weaponType, moveType: h.moveType };

  const n = e.name.toLowerCase();
  let color: Color = /\bred\b/.test(n)
    ? 'red' : /\bblue\b/.test(n)
    ? 'blue' : /\bgreen\b/.test(n)
    ? 'green' : 'colorless';

  let weaponType: WeaponType = 'Sword';
  if (/sword/.test(n)) { weaponType = 'Sword'; if (color === 'colorless') color = 'red'; }
  else if (/lance/.test(n)) { weaponType = 'Lance'; if (color === 'colorless') color = 'blue'; }
  else if (/axe/.test(n)) { weaponType = 'Axe'; if (color === 'colorless') color = 'green'; }
  else if (/bow|archer/.test(n)) weaponType = 'Bow';
  else if (/dagger|thief|assassin|ninja|rogue/.test(n)) weaponType = 'Dagger';
  else if (/mage|tome|sage|scholar|monk|druid/.test(n)) weaponType = 'Tome';
  else if (/troubadour|cleric|priest|bishop|staff|healer/.test(n)) weaponType = 'Staff';
  else if (/manakete|dragon|breath/.test(n)) weaponType = 'Dragon';
  else if (/beast|wolf|cat|fox|hare|bear|tiger|dog|bird|owl/.test(n)) weaponType = 'Beast';

  let moveType = 'Infantry';
  if (/flier|flying|pegasus|wyvern|falcon|hawk|raven|griffin/.test(n)) moveType = 'Flying';
  else if (/cavalier|cavalry|paladin|troubadour|nomad|horse/.test(n)) moveType = 'Cavalry';
  else if (/knight|armor|general|baron|fortress/.test(n)) moveType = 'Armored';

  return { ...e, color, weaponType, moveType };
}
