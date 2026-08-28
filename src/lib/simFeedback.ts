// Retour d'expérience du simulateur : chaque fois que la RÉALITÉ (état saisi tour par
// tour) diverge de la PRÉDICTION, ou qu'un plan a échoué en jeu, on l'enregistre dans
// feh.sim_feedback. Ces écarts sont une donnée concrète pour corriger le moteur là où ça
// compte (sur les cartes réellement jouées). Aucune donnée sensible : carte + positions.
import { supabase } from './supabase';

export type FeedbackKind = 'divergence' | 'plan_failed';

export async function logFeedback(entry: {
  map: string;
  difficulty?: string;
  turn?: number;
  kind: FeedbackKind;
  payload?: unknown;
  note?: string;
}): Promise<string | null> {
  if (!supabase) return 'Supabase non configuré.';
  const { error } = await supabase.from('sim_feedback').insert({
    map: entry.map,
    difficulty: entry.difficulty ?? '',
    turn: entry.turn ?? null,
    kind: entry.kind,
    payload: entry.payload ?? null,
    note: entry.note ?? null,
  });
  return error ? error.message : null;
}
