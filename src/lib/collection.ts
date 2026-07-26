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

// Tenues resplendissantes obtenues (mode local, sans Supabase).
const LS_RESP_KEY = 'feh.collection.resplendent';

function readLocalResp(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_RESP_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeLocalResp(ids: Set<string>) {
  localStorage.setItem(LS_RESP_KEY, JSON.stringify([...ids]));
}

// Stats de collection (propres à l'utilisateur, par héros).
export type CollStats = {
  LVL: number | null;
  PV: number | null;
  ATQ: number | null;
  VIT: number | null;
  DEF: number | null;
  RES: number | null;
  rarity: number | null; // étoiles de MON exemplaire (1..5), null = non renseigné
  resplendent: boolean; // tenue resplendissante obtenue (resplendent_art_obtained)
};

export const STAT_COLS = ['LVL', 'PV', 'ATQ', 'VIT', 'DEF', 'RES'] as const;

// Récupère les stats du héros pour l'utilisateur `userId`, ou null.
export async function fetchHeroStats(
  heroId: string,
  userId: string | null,
): Promise<CollStats | null> {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from('collection')
    .select(STAT_COLS.join(','))
    .eq('hero_id', heroId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  // rareté + tenue resp. récupérées à part et tolérantes (n'échoue pas si absentes).
  const { data: rr } = await supabase
    .from('collection')
    .select('rarity, resplendent_art_obtained')
    .eq('hero_id', heroId)
    .eq('user_id', userId)
    .maybeSingle();
  const meta = rr as {
    rarity: number | null;
    resplendent_art_obtained: boolean | null;
  } | null;
  const rarity = meta?.rarity ?? null;
  const resplendent = Boolean(meta?.resplendent_art_obtained);
  return {
    ...(data as unknown as Omit<CollStats, 'rarity' | 'resplendent'>),
    rarity,
    resplendent,
  };
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

export async function fetchOwned(userId: string | null): Promise<Set<string>> {
  if (supabase && userId) {
    const { data, error } = await supabase
      .from('collection')
      .select('hero_id')
      .eq('user_id', userId);
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
export async function fetchCollection(
  userId: string | null,
): Promise<CollRow[]> {
  if (supabase && userId) {
    // Essaie avec rarity + tenue resp. ; repli sans si les colonnes n'existent pas.
    let res = await supabase
      .from('collection')
      .select(
        ['hero_id', ...STAT_COLS, 'rarity', 'resplendent_art_obtained'].join(','),
      )
      .eq('user_id', userId);
    if (res.error)
      res = await supabase
        .from('collection')
        .select(['hero_id', ...STAT_COLS].join(','))
        .eq('user_id', userId);
    if (!res.error)
      return (res.data ?? []).map((r) => ({
        rarity: null,
        resplendent: Boolean(
          (r as { resplendent_art_obtained?: boolean | null })
            .resplendent_art_obtained,
        ),
        ...(r as object),
      })) as unknown as CollRow[];
    console.warn('Collection indisponible :', res.error.message);
  }
  return [...readLocal()].map((hero_id) => ({
    hero_id,
    LVL: null,
    PV: null,
    ATQ: null,
    VIT: null,
    DEF: null,
    RES: null,
    rarity: null,
    resplendent: readLocalResp().has(hero_id),
  }));
}

// Marque (ou retire) la tenue resplendissante comme obtenue pour ce héros.
// upsert : crée la ligne de collection si besoin (le héros devient possédé).
export async function setResplendentObtained(
  heroId: string,
  userId: string | null,
  obtained: boolean,
): Promise<string | null> {
  if (supabase && userId) {
    const { error } = await supabase
      .from('collection')
      .upsert(
        {
          hero_id: heroId,
          user_id: userId,
          resplendent_art_obtained: obtained,
        },
        { onConflict: 'user_id,hero_id' },
      );
    return error ? error.message : null;
  }
  const set = readLocalResp();
  if (obtained) set.add(heroId);
  else set.delete(heroId);
  writeLocalResp(set);
  return null;
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

// Un compte consultable (vue feh.profiles : id + email).
export type Profile = { id: string; email: string | null };

// Liste des comptes proposés au sélecteur « Voir la collection de … ».
// Vide si Supabase n'est pas configuré ou si la vue profiles n'existe pas.
export async function fetchProfiles(): Promise<Profile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email');
  if (error) {
    console.warn('Liste des comptes indisponible :', error.message);
    return [];
  }
  return (data ?? []) as Profile[];
}
