import { supabase } from './supabase';

// Efficacité + Brave de la meilleure arme de chaque héros (lu depuis feh.skills).
// Aucune donnée n'est stockée : on lit le learnset + les skills existants.
export type WeaponInfo = { brave: boolean; effAgainst: string[] };

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
    .select('wiki_name, might, description, weapon_effectiveness')
    .eq('scategory', 'weapon')
    .in('wiki_name', [...allNames]);
  const weapons = new Map<
    string,
    { might: number | null; description: string | null; weapon_effectiveness: string | null }
  >();
  for (const s of sk ?? []) {
    weapons.set((s as { wiki_name: string }).wiki_name, s as never);
  }

  // 3) meilleure arme par héros.
  for (const [hid, names] of namesByHero) {
    let best: { might: number | null; description: string | null; weapon_effectiveness: string | null } | null = null;
    for (const n of names) {
      const w = weapons.get(n);
      if (!w) continue;
      if (!best || effMight(w.might, w.description) > effMight(best.might, best.description)) {
        best = w;
      }
    }
    if (best) {
      out.set(hid, {
        brave: isBrave(best.description),
        effAgainst: normEff(best.weapon_effectiveness),
      });
    }
  }
  return out;
}
