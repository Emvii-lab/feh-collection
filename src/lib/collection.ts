import { supabase } from './supabase';

// Couche d'accès à la collection (héros possédés).
// - Si Supabase est configuré : table `collection` (colonne hero_id).
// - Sinon : repli sur localStorage pour que l'appli marche tout de suite.

const LS_KEY = 'feh.collection.owned';

function readLocal(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeLocal(owned: Set<string>) {
  localStorage.setItem(LS_KEY, JSON.stringify([...owned]));
}

// Stats de collection (propres à l'utilisateur, par héros).
export type CollStats = {
  LVL: number | null;
  PV: number | null;
  ATQ: number | null;
  VIT: number | null;
  DEF: number | null;
  RES: number | null;
};

export const STAT_COLS = ['LVL', 'PV', 'ATQ', 'VIT', 'DEF', 'RES'] as const;

// Récupère les stats du héros pour l'utilisateur connecté (RLS), ou null.
export async function fetchHeroStats(
  heroId: string,
): Promise<CollStats | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('collection')
    .select(STAT_COLS.join(','))
    .eq('hero_id', heroId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as CollStats;
}

// Enregistre les stats (upsert : crée la ligne de collection si besoin → possédé).
export async function saveHeroStats(
  heroId: string,
  userId: string | null,
  stats: Partial<CollStats>,
): Promise<string | null> {
  if (!supabase || !userId) return 'Non connecté.';
  const { error } = await supabase
    .from('collection')
    .upsert(
      { hero_id: heroId, user_id: userId, ...stats },
      { onConflict: 'user_id,hero_id' },
    );
  return error ? error.message : null;
}

export async function fetchOwned(): Promise<Set<string>> {
  if (supabase) {
    const { data, error } = await supabase.from('collection').select('hero_id');
    if (error) {
      console.warn('Supabase indisponible, repli localStorage :', error.message);
      return readLocal();
    }
    return new Set((data ?? []).map((r) => r.hero_id as string));
  }
  return readLocal();
}

// Une ligne de collection = héros possédé + ses stats.
export type CollRow = { hero_id: string } & CollStats;

// Somme des 5 stats de combat (PV+ATQ+VIT+DÉF+RÉS), le niveau exclu.
export function statTotal(s: Partial<CollStats> | undefined | null): number {
  if (!s) return 0;
  return (
    (s.PV ?? 0) + (s.ATQ ?? 0) + (s.VIT ?? 0) + (s.DEF ?? 0) + (s.RES ?? 0)
  );
}

// Récupère toute la collection de l'utilisateur (hero_id + stats) en une requête.
export async function fetchCollection(): Promise<CollRow[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from('collection')
      .select(['hero_id', ...STAT_COLS].join(','));
    if (!error) return (data ?? []) as unknown as CollRow[];
    console.warn('Collection indisponible :', error.message);
  }
  return [...readLocal()].map((hero_id) => ({
    hero_id,
    LVL: null,
    PV: null,
    ATQ: null,
    VIT: null,
    DEF: null,
    RES: null,
  }));
}

export async function setOwned(
  heroId: string,
  owned: boolean,
  userId: string | null,
): Promise<void> {
  if (supabase && userId) {
    if (owned) {
      // user_id explicite (la table a aussi un défaut auth.uid()).
      await supabase
        .from('collection')
        .upsert(
          { hero_id: heroId, user_id: userId },
          { onConflict: 'user_id,hero_id', ignoreDuplicates: true },
        );
    } else {
      await supabase
        .from('collection')
        .delete()
        .eq('hero_id', heroId)
        .eq('user_id', userId);
    }
    return;
  }
  const set = readLocal();
  if (owned) set.add(heroId);
  else set.delete(heroId);
  writeLocal(set);
}
