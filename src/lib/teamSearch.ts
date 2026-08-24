// Recherche d'équipe : parmi tes persos jouables, cherche une équipe qui nettoie la
// carte. Heuristique (on ne teste pas TOUTES les combinaisons) : on classe les persos
// selon leur tenue face au boss, on garde les meilleurs, et on résout les combos les
// plus prometteurs jusqu'à trouver des équipes gagnantes.
import { solve } from './solver';
import { combatVerdict, type Unit } from './combat';
import type { Board, BattleUnit } from './battle';
import type { TerrainMap } from './tactics';

export type SearchUnit = { id: string; name: string; title: string; unit: Unit };
export type TeamResult = { ids: string[]; names: string[]; turns: number };
export type SearchResult = { teams: TeamResult[]; tested: number; poolSize: number; reason: string };

export type SearchOpts = {
  maxTurns?: number; topK?: number; perTeamBudget?: number; perTeamMs?: number; maxWinners?: number;
};

// k-combinaisons d'un tableau.
function combos<T>(arr: T[], k: number): T[][] {
  if (k <= 0) return [[]];
  if (k > arr.length) return [];
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}

export function searchTeam(
  pool: SearchUnit[],
  enemies: BattleUnit[],
  terrain: TerrainMap,
  allyPos: string[],
  linked: boolean,
  opts: SearchOpts = {},
  onProgress?: (tested: number, total: number) => void,
): SearchResult {
  const maxTurns = opts.maxTurns ?? 3;
  const topK = opts.topK ?? 6;
  const perTeamBudget = opts.perTeamBudget ?? 300_000;
  const perTeamMs = opts.perTeamMs ?? 2500;
  const maxWinners = opts.maxWinners ?? 3;
  const slots = Math.min(4, allyPos.length || 4);
  if (pool.length < slots || enemies.length === 0) {
    return { teams: [], tested: 0, poolSize: pool.length, reason: 'Pas assez de persos jouables (avec stats) pour former une équipe.' };
  }

  // Boss = l'ennemi le plus coriace (plus de PV). Score = tenue en 1v1 face à lui + stats.
  const boss = enemies.reduce((a, b) => (b.unit.stats.hp > a.unit.stats.hp ? b : a));
  const score = (u: SearchUnit): number => {
    const v = combatVerdict(u.unit, boss.unit).verdict;
    const base = v === 'ko' ? 100 : v === 'trade' ? 45 : v === 'win' ? 35 : 0;
    const s = u.unit.stats;
    return base + (s.atk + s.spd + s.def + s.res) / 20;
  };
  const scoreMap = new Map(pool.map((u) => [u.id, score(u)] as const));
  const ranked = [...pool].sort((a, b) => scoreMap.get(b.id)! - scoreMap.get(a.id)!).slice(0, topK);

  // Combos des mieux classés, testés du plus prometteur au moins prometteur.
  const teams = combos(ranked, slots)
    .sort((A, B) =>
      B.reduce((s, u) => s + scoreMap.get(u.id)!, 0) - A.reduce((s, u) => s + scoreMap.get(u.id)!, 0));

  const winners: TeamResult[] = [];
  let tested = 0;
  for (const team of teams) {
    tested++;
    onProgress?.(tested, teams.length);
    const allies: BattleUnit[] = team.map((u, i) => ({
      id: u.id, side: 'ally', unit: u.unit, pos: allyPos[i].toLowerCase(), hp: u.unit.stats.hp, active: true,
    }));
    const board: Board = { units: [...enemies.map((e) => ({ ...e })), ...allies], terrain, linked };
    const res = solve(board, { maxTurns, nodeBudget: perTeamBudget, timeLimitMs: perTeamMs, allowDeaths: false });
    if (res.win) {
      winners.push({ ids: team.map((u) => u.id), names: team.map((u) => u.name), turns: res.turns.length });
      if (winners.length >= maxWinners) break;
    }
  }
  return {
    teams: winners, tested, poolSize: pool.length,
    reason: winners.length ? '' : 'Aucune des équipes testées ne nettoie la carte sans perte (essaie plus de tours, ou monte tes persos).',
  };
}
