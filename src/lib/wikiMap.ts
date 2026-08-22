// Charge les ennemis d'une carte (map) depuis le wiki FEH (API Fandom, CORS ok).
// Rien n'est stocké : tout est récupéré en direct à la demande.
import type { Color, Hero, WeaponType } from '../types';

export type WikiEnemy = {
  name: string;
  hp: number; atk: number; spd: number; def: number; res: number;
  weapon: string;
  pos: string; // case sur la grille, ex. "d7"
};
export type WikiMap = {
  title: string;
  difficulties: Record<string, WikiEnemy[]>;
  allyPos: string[]; // cases de départ des alliés
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
const UNIT_RE = /unit=([^;]+);pos=([^;]*);[^]*?stats=\[(\d+);(\d+);(\d+);(\d+);(\d+)\];weapon=([^;]*)/g;
const KNOWN_DIFF = /^(normal|hard|lunatic|infernal|abyssal)$/i;

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
    UNIT_RE.lastIndex = 0;
    while ((u = UNIT_RE.exec(m[2]))) {
      units.push({
        name: u[1].trim(), pos: (u[2] || '').trim(),
        hp: +u[3], atk: +u[4], spd: +u[5], def: +u[6], res: +u[7],
        weapon: (u[8] || '').trim(),
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
  return { title: pageTitle, difficulties, allyPos };
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
