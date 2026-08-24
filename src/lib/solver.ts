// C3 : le solveur. Recherche déterministe d'une ligne de jeu qui nettoie la carte.
// Seuls TES coups créent des branches ; la phase ennemie est une réponse fixe
// (voir battle.ts). DFS avec élagage, table de transposition et budget de nœuds.
import {
  enemyPhase, boardSummary, alive,
  attackOptionsFor, applyPlayerAttack, hashBoard,
  type Board, type EnemyMove,
} from './battle';

export type PlayerMove = {
  id: string; name: string; from: string; to: string;
  targetId?: string; targetName?: string; dmg?: number; kills?: boolean;
};
export type PlanTurn = { player: PlayerMove[]; enemy: EnemyMove[] };
export type SolveResult = { win: boolean; turns: PlanTurn[]; nodes: number; reason: string };

export type SolveOpts = { maxTurns?: number; allowDeaths?: boolean; nodeBudget?: number };

export function solve(board: Board, opts: SolveOpts = {}): SolveResult {
  const maxTurns = opts.maxTurns ?? 3;
  const allowDeaths = opts.allowDeaths ?? false;
  const budget = opts.nodeBudget ?? 200_000;
  const seen = new Set<string>();
  let nodes = 0;
  let out: SolveResult | null = null;

  // Génère les états après une PHASE JOUEUR complète (chaque allié agit une fois).
  function* playerPhases(b0: Board): Generator<{ board: Board; moves: PlayerMove[] }> {
    const allyIds = b0.units.filter((u) => u.side === 'ally' && alive(u)).map((u) => u.id);
    function* rec(i: number, b: Board, moves: PlayerMove[]): Generator<{ board: Board; moves: PlayerMove[] }> {
      if (i >= allyIds.length) { yield { board: b, moves }; return; }
      const id = allyIds[i];
      const cur = b.units.find((u) => u.id === id)!;
      if (!alive(cur)) { yield* rec(i + 1, b, moves); return; }
      // attaques candidates (KO puis dégâts), plafonnées, + une option « attente ».
      const atks = attackOptionsFor(b, id)
        .sort((x, y) => Number(y.kills) - Number(x.kills) || y.dmg - x.dmg)
        .slice(0, 8);
      for (const a of atks) {
        if (!allowDeaths && a.selfKilled) continue; // se suicide en attaquant
        const nb = applyPlayerAttack(b, id, a.tile, a.targetId);
        const tgt = b.units.find((u) => u.id === a.targetId)!;
        yield* rec(i + 1, nb, [...moves, {
          id, name: cur.unit.hero.name, from: cur.pos, to: a.tile,
          targetId: a.targetId, targetName: tgt.unit.hero.name, dmg: a.dmg, kills: a.kills,
        }]);
      }
      yield* rec(i + 1, b, [...moves, { id, name: cur.unit.hero.name, from: cur.pos, to: cur.pos }]);
    }
    yield* rec(0, b0, []);
  }

  function dfs(b: Board, turn: number, plan: PlanTurn[]): boolean {
    if (boardSummary(b).allDead) { out = { win: true, turns: plan, nodes, reason: 'Carte nettoyée.' }; return true; }
    if (turn >= maxTurns) return false;
    if (++nodes > budget) return false;
    const key = hashBoard(b) + '#' + turn;
    if (seen.has(key)) return false;
    seen.add(key);
    for (const pp of playerPhases(b)) {
      if (nodes > budget) return false;
      if (!allowDeaths && boardSummary(pp.board).lostUnit) continue; // mort en riposte
      const ep = enemyPhase(pp.board);
      if (!allowDeaths && boardSummary(ep.board).lostUnit) continue; // mort en phase ennemie
      if (dfs(ep.board, turn + 1, [...plan, { player: pp.moves, enemy: ep.moves }])) return true;
    }
    return false;
  }

  dfs(board, 0, []);
  return out ?? {
    win: false, turns: [], nodes,
    reason: nodes > budget
      ? 'Budget de calcul atteint : aucune ligne gagnante trouvée dans la limite.'
      : `Aucune ligne gagnante en ${maxTurns} tour(s) sans perte.`,
  };
}
