import { supabase } from './supabase';
import { parseSkillEffects, type ParsedEffects, type SkillRow } from './skillEffects';

// Efficacité + tous les effets détectables de la meilleure arme de chaque héros
// (lu depuis feh.skills, via le moteur d'effets). Aucune donnée n'est stockée.
// NB : on ne connaît que l'ARME (la base a le learnset, pas l'équipement réel des
// passifs/spéciale), donc ton équipe reste sous-estimée = biais prudent.
export type WeaponInfo = {
  effAgainst: string[];
  effects: ParsedEffects; // brave, bonus, dégâts %stat, riposte à distance, etc.
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

// ---- Effets d'un ennemi de map, détectés depuis SES compétences (best-effort) ----
// Délègue au moteur d'effets extensible (voir skillEffects.ts), qui gère aussi
// les formules « ×/+ compteur de spéciale » et les malus infligés à ton unité.
export type EnemyCombat = ParsedEffects;

// Combine les effets de toutes les compétences d'un ennemi (noms anglais du wiki).
export async function fetchEnemyCombat(skillNames: string[]): Promise<EnemyCombat> {
  const names = skillNames.filter(Boolean);
  if (!supabase || names.length === 0) return parseSkillEffects([]);
  const { data } = await supabase
    .from('skills')
    .select('description, scategory, cooldown')
    .in('wiki_name', names);
  return parseSkillEffects((data ?? []) as SkillRow[]);
}

export async function fetchTeamWeapons(
  heroIds: string[],
): Promise<Map<string, WeaponInfo>> {
  const out = new Map<string, WeaponInfo>();
  if (!supabase || heroIds.length === 0) return out;

  // 1) learnset : héros -> noms d'armes.
  const { data: learn } = await supabase
    .from('hero_learnset')
    .select('hero_id, skill_name')
    .in('hero_id', heroIds);
  const namesByHero = new Map<string, string[]>();
  const allNames = new Set<string>();
  for (const r of learn ?? []) {
    const hid = r.hero_id as string;
    const sn = r.skill_name as string;
    if (!sn) continue;
    (namesByHero.get(hid) ?? namesByHero.set(hid, []).get(hid)!).push(sn);
    allNames.add(sn);
  }
  if (allNames.size === 0) return out;

  // 2) détails des armes uniquement.
  const { data: sk } = await supabase
    .from('skills')
    .select('wiki_name, might, description, weapon_effectiveness, scategory, cooldown')
    .eq('scategory', 'weapon')
    .in('wiki_name', [...allNames]);
  type WRow = {
    might: number | null; description: string | null; weapon_effectiveness: string | null;
    scategory: string | null; cooldown: number | null;
  };
  const weapons = new Map<string, WRow>();
  for (const s of sk ?? []) weapons.set((s as { wiki_name: string }).wiki_name, s as never);

  // 3) meilleure arme par héros → effets détectés via le moteur.
  for (const [hid, names] of namesByHero) {
    let best: WRow | null = null;
    for (const n of names) {
      const w = weapons.get(n);
      if (!w) continue;
      if (!best || effMight(w.might, w.description) > effMight(best.might, best.description)) best = w;
    }
    if (best) {
      out.set(hid, {
        effAgainst: normEff(best.weapon_effectiveness),
        effects: parseSkillEffects([best as SkillRow]),
      });
    }
  }
  return out;
}
