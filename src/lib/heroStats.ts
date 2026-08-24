import { supabase } from './supabase';
import type { Stats } from '../types';

// Stats niv. 40 (5★ neutre) de TOUS les héros du jeu (table feh.hero_stats,
// calculées depuis les stats de base du wiki). Sert au « théorycraft » : quelle
// équipe du jeu pourrait nettoyer une carte, au-delà de ta collection.
export async function fetchAllHeroStats(): Promise<Map<string, Stats>> {
  const out = new Map<string, Stats>();
  if (!supabase) return out;
  // pagination (PostgREST plafonne à 1000 par défaut).
  for (let from = 0; from < 3000; from += 1000) {
    const { data, error } = await supabase
      .from('hero_stats')
      .select('hero_id,hp,atk,spd,def,res')
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    for (const r of data as { hero_id: string; hp: number; atk: number; spd: number; def: number; res: number }[]) {
      out.set(r.hero_id, { hp: r.hp, atk: r.atk, spd: r.spd, def: r.def, res: r.res });
    }
    if (data.length < 1000) break;
  }
  return out;
}
