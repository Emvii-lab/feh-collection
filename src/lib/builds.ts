import { supabase } from './supabase';

// Build (équipement réel) d'un héros pour un utilisateur : les compétences ÉQUIPÉES
// par emplacement. Ce sont TES données (comme les stats), pas des données du jeu :
// on stocke juste des wiki_name (anglais) qui pointent vers feh.skills.
// Table feh.hero_build : calquée sur feh.collection (clé user_id+hero_id, même RLS).

export const BUILD_SLOTS = [
  'weapon', 'assist', 'special', 'passive_a', 'passive_b', 'passive_c', 'seal',
] as const;
export type BuildSlot = (typeof BUILD_SLOTS)[number];

// Emplacement → catégorie de skill (scategory) dans feh.skills.
export const SLOT_CATEGORY: Record<BuildSlot, string> = {
  weapon: 'weapon', assist: 'assist', special: 'special',
  passive_a: 'passivea', passive_b: 'passiveb', passive_c: 'passivec', seal: 'sacredseal',
};
export const SLOT_LABEL: Record<BuildSlot, string> = {
  weapon: 'Arme', assist: 'Assist', special: 'Spéciale',
  passive_a: 'Passif A', passive_b: 'Passif B', passive_c: 'Passif C', seal: 'Sceau',
};

export type HeroBuild = Record<BuildSlot, string | null>;
export const EMPTY_BUILD = (): HeroBuild => ({
  weapon: null, assist: null, special: null,
  passive_a: null, passive_b: null, passive_c: null, seal: null,
});

// Récupère le build d'un héros pour `userId` (ou null si aucun).
export async function fetchBuild(
  heroId: string,
  userId: string | null,
): Promise<HeroBuild | null> {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from('hero_build')
    .select(BUILD_SLOTS.join(','))
    .eq('hero_id', heroId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return { ...EMPTY_BUILD(), ...(data as unknown as Partial<HeroBuild>) };
}

// Récupère les builds de plusieurs héros d'un coup (pour le simulateur).
export async function fetchBuilds(
  heroIds: string[],
  userId: string | null,
): Promise<Map<string, HeroBuild>> {
  const out = new Map<string, HeroBuild>();
  if (!supabase || !userId || heroIds.length === 0) return out;
  const { data } = await supabase
    .from('hero_build')
    .select(['hero_id', ...BUILD_SLOTS].join(','))
    .eq('user_id', userId)
    .in('hero_id', heroIds);
  for (const row of data ?? []) {
    const r = row as unknown as Partial<HeroBuild> & { hero_id: string };
    out.set(r.hero_id, { ...EMPTY_BUILD(), ...r });
  }
  return out;
}

// Enregistre un emplacement du build (upsert : crée la ligne si besoin).
export async function saveBuildSlot(
  heroId: string,
  userId: string | null,
  slot: BuildSlot,
  value: string | null,
): Promise<string | null> {
  if (!supabase || !userId) return 'Non connecté.';
  const { error } = await supabase
    .from('hero_build')
    .upsert(
      { hero_id: heroId, user_id: userId, [slot]: value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,hero_id' },
    );
  return error ? error.message : null;
}
