import { supabase } from './supabase';
import { parseSkillEffects, type ParsedEffects, type SkillRow } from './skillEffects';
import { fetchBuilds, BUILD_SLOTS } from './builds';

// Efficacité + tous les effets détectables du kit de chaque héros (lu depuis feh.skills,
// via le moteur d'effets). Aucune donnée n'est stockée. Si TON build est enregistré, on
// lit l'équipement exact ; sinon on reconstruit le KIT NATIF complet depuis le learnset
// (meilleure arme + spéciale + passives A/B/C au palier le plus haut).
export type WeaponInfo = {
  effAgainst: string[];
  effects: ParsedEffects; // brave, bonus, dégâts %stat, riposte à distance, etc.
  hasBuild: boolean; // true = effets lus de ton build équipé (kit exact) ; false = arme seule
};
export const EMPTY_EFFECTS = (): ParsedEffects => parseSkillEffects([]);

// Normalise le champ weapon_effectiveness vers les jetons du moteur.
function normEff(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.toLowerCase().trim())
    .map((t) => {
      if (t.startsWith('fly')) return 'flying';
      if (t.startsWith('armor')) return 'armored';
      if (t.startsWith('caval')) return 'cavalry';
      if (t.startsWith('infan')) return 'infantry';
      if (t.startsWith('dragon')) return 'dragon';
      if (t.startsWith('beast')) return 'beast';
      if (t.startsWith('bow')) return 'bow';
      if (t.startsWith('tome') || t.startsWith('magic')) return 'magic';
      return t;
    })
    .filter(Boolean);
}

const isBrave = (d: string | null) => /attacks?\s+twice|\bbrave\b/i.test(d ?? '');
// Puissance effective pour choisir la "meilleure" arme (Brave compte double).
const effMight = (might: number | null, desc: string | null) =>
  (might ?? 0) * (isBrave(desc) ? 1.9 : 1);

// Palier d'un skill (Fury 3 > Fury 1, HP Plus5 > Plus3). Sans chiffre = premium nommé
// (Flash Sparrow, Get Behind Me…) → considéré comme haut de gamme.
const skillTier = (name: string): number => {
  const m = name.match(/(\d+)\s*$/) || name.match(/Plus\s*(\d+)/i);
  return m ? +m[1] : 3.5;
};

// Reconstruit le KIT NATIF équipable à partir de tout le learnset : un seul skill par
// catégorie (le meilleur palier), pour éviter de cumuler Fury 1+2+3. Arme = plus grosse
// puissance ; spéciale = charge la plus élevée ; passives/sceau = palier le plus haut.
function topKit(rows: WRow[]): WRow[] {
  const byCat = new Map<string, WRow[]>();
  for (const r of rows) {
    const c = (r.scategory ?? '').toLowerCase();
    (byCat.get(c) ?? byCat.set(c, []).get(c)!).push(r);
  }
  const out: WRow[] = [];
  for (const [c, list] of byCat) {
    let best = list[0];
    for (const r of list) {
      if (c === 'weapon') { if (effMight(r.might, r.description) > effMight(best.might, best.description)) best = r; }
      else if (c === 'special') { if ((r.cooldown ?? 0) > (best.cooldown ?? 0)) best = r; }
      else if (skillTier(r.wiki_name) > skillTier(best.wiki_name)) best = r;
    }
    out.push(best);
  }
  return out;
}

// ---- Effets d'un ennemi de map, détectés depuis SES compétences (best-effort) ----
// Délègue au moteur d'effets extensible (voir skillEffects.ts), qui gère aussi
// les formules « ×/+ compteur de spéciale » et les malus infligés à ton unité.
export type EnemyCombat = ParsedEffects;

// Le wiki écrit les préfixes de stats avec un « / » (« Atk/Res Aria ») alors que la base
// les stocke collés (« AtkRes Aria »). On interroge les DEUX formes pour ne rien rater.
const STAT_TOK = '(?:Atk|Spd|Def|Res|HP)';
const deslashName = (n: string) =>
  n.replace(new RegExp(`\\b(${STAT_TOK})/(${STAT_TOK})`, 'g'), '$1$2');

// Combine les effets de toutes les compétences d'un ennemi (noms anglais du wiki).
export async function fetchEnemyCombat(skillNames: string[]): Promise<EnemyCombat> {
  const base = skillNames.filter(Boolean);
  if (!supabase || base.length === 0) return parseSkillEffects([]);
  const names = [...new Set(base.flatMap((n) => [n, deslashName(n)]))];
  const { data } = await supabase
    .from('skills')
    .select('description, scategory, cooldown')
    .in('wiki_name', names);
  return parseSkillEffects((data ?? []) as SkillRow[]);
}

type WRow = {
  wiki_name: string;
  might: number | null; description: string | null; weapon_effectiveness: string | null;
  scategory: string | null; cooldown: number | null;
};

// Effets de combat de chaque héros de l'équipe. Si TON build est enregistré
// (feh.hero_build), on lit TOUTES tes compétences équipées → précision réelle.
// Sinon on retombe sur la meilleure arme du kit natif (best-effort, sous-estime).
export async function fetchTeamWeapons(
  heroIds: string[],
  userId?: string | null,
): Promise<Map<string, WeaponInfo>> {
  const out = new Map<string, WeaponInfo>();
  if (!supabase || heroIds.length === 0) return out;

  // 0) builds équipés (le cas échéant).
  const builds = await fetchBuilds(heroIds, userId ?? null);
  const equipped = new Set<string>();
  for (const b of builds.values())
    for (const slot of BUILD_SLOTS) if (b[slot]) equipped.add(b[slot] as string);

  // 1) learnset (pour les héros SANS build → meilleure arme).
  const noBuild = heroIds.filter((id) => !builds.has(id));
  const namesByHero = new Map<string, string[]>();
  const weaponNames = new Set<string>();
  if (noBuild.length) {
    const { data: learn } = await supabase
      .from('hero_learnset')
      .select('hero_id, skill_name')
      .in('hero_id', noBuild);
    for (const r of learn ?? []) {
      const hid = r.hero_id as string;
      const sn = r.skill_name as string;
      if (!sn) continue;
      (namesByHero.get(hid) ?? namesByHero.set(hid, []).get(hid)!).push(sn);
      weaponNames.add(sn);
    }
  }

  // 2) détails de toutes les compétences utiles (armes du kit + tout ton équipement).
  const allNames = [...new Set([...equipped, ...weaponNames])];
  const skillMap = new Map<string, WRow>();
  if (allNames.length) {
    const { data: sk } = await supabase
      .from('skills')
      .select('wiki_name, might, description, weapon_effectiveness, scategory, cooldown')
      .in('wiki_name', allNames);
    for (const s of sk ?? []) skillMap.set((s as WRow).wiki_name, s as WRow);
  }

  // 3a) héros AVEC build → moteur d'effets sur toute la panoplie équipée.
  for (const [hid, b] of builds) {
    const rows = BUILD_SLOTS.map((s) => b[s])
      .filter((n): n is string => Boolean(n))
      .map((n) => skillMap.get(n))
      .filter((w): w is WRow => Boolean(w));
    const weaponRow = b.weapon ? skillMap.get(b.weapon) : null;
    out.set(hid, {
      effAgainst: normEff(weaponRow?.weapon_effectiveness ?? null),
      effects: parseSkillEffects(rows as SkillRow[]),
      hasBuild: true,
    });
  }

  // 3b) héros SANS build → KIT NATIF complet (arme + spéciale + passives A/B/C) au
  // meilleur palier, reconstruit depuis le learnset. Vraie donnée de jeu, pas une
  // simple arme : on récupère les effets réels du perso (Distant Counter d'arme,
  // réduction de dégâts, doublon garanti, buffs…).
  for (const [hid, names] of namesByHero) {
    const rows = names.map((n) => skillMap.get(n)).filter((w): w is WRow => Boolean(w));
    const kit = topKit(rows);
    const weaponRow = kit.find((r) => (r.scategory ?? '').toLowerCase() === 'weapon') ?? null;
    if (kit.length) {
      out.set(hid, {
        effAgainst: normEff(weaponRow?.weapon_effectiveness ?? null),
        effects: parseSkillEffects(kit as SkillRow[]),
        hasBuild: false,
      });
    }
  }
  return out;
}
