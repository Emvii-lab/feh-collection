// C3 : le solveur. Recherche déterministe d'une ligne de jeu qui nettoie la carte.
// Seuls TES coups créent des branches ; la phase ennemie est une réponse fixe
// (voir battle.ts). DFS avec élagage, table de transposition et budget de nœuds.
import {
  enemyPhase, boardSummary, alive,
  attackOptionsFor, applyPlayerAttack, applyMove, unitReach, hashBoard,
  type Board, type EnemyMove,
} from './battle';
import { manhattan } from './tactics';

export type PlayerMove = {
  id: string; name: string; from: string; to: string;
  targetId?: string; targetName?: string; dmg?: number; kills?: boolean;
};
export type PlanTurn = { player: PlayerMove[]; enemy: EnemyMove[] };
export type SolveResult = { win: boolean; turns: PlanTurn[]; nodes: number; reason: string };

export type SolveOpts = { maxTurns?: number; allowDeaths?: boolean; nodeBudget?: number; timeLimitMs?: number };

export function solve(
  board: Board, opts: SolveOpts = {}, onProgress?: (nodes: number) => void,
): SolveResult {
  const maxTurns = opts.maxTurns ?? 3;
  const allowDeaths = opts.allowDeaths ?? false;
  const budget = opts.nodeBudget ?? 200_000;
  const deadline = Date.now() + (opts.timeLimitMs ?? 15_000);
  const seen = new Set<string>();
  let nodes = 0;
  let timedOut = false;
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
      const usable = atks.filter((a) => allowDeaths || !a.selfKilled);
      for (const a of usable) {
        const nb = applyPlayerAttack(b, id, a.tile, a.targetId);
        const tgt = b.units.find((u) => u.id === a.targetId)!;
        yield* rec(i + 1, nb, [...moves, {
          id, name: cur.unit.hero.name, from: cur.pos, to: a.tile,
          targetId: a.targetId, targetName: tgt.unit.hero.name, dmg: a.dmg, kills: a.kills,
        }]);
      }
      // S'il ne peut pas attaquer utilement, proposer d'AVANCER vers l'ennemi le plus
      // proche (une seule case, pour ne pas exploser la recherche).
      if (usable.length === 0) {
        const foes = b.units.filter((u) => u.side !== 'ally' && alive(u));
        if (foes.length) {
          const occ = new Set(b.units.filter((u) => u.id !== id && alive(u)).map((u) => u.pos));
          let dest = cur.pos, bd = Infinity;
          for (const t of unitReach(b, id)) {
            if (t !== cur.pos && occ.has(t)) continue;
            const d = Math.min(...foes.map((f) => manhattan(t, f.pos)));
            if (d < bd) { bd = d; dest = t; }
          }
          if (dest !== cur.pos) {
            const nb = applyMove(b, id, dest);
            yield* rec(i + 1, nb, [...moves, { id, name: cur.unit.hero.name, from: cur.pos, to: dest }]);
          }
        }
      }
      // Option « attente » (rester sur place).
      yield* rec(i + 1, b, [...moves, { id, name: cur.unit.hero.name, from: cur.pos, to: cur.pos }]);
    }
    yield* rec(0, b0, []);
  }

  function dfs(b: Board, turn: number, plan: PlanTurn[]): boolean {
    if (boardSummary(b).allDead) { out = { win: true, turns: plan, nodes, reason: 'Carte nettoyée.' }; return true; }
    if (turn >= maxTurns) return false;
    if (++nodes > budget) return false;
    if ((nodes & 1023) === 0) {
      onProgress?.(nodes);
      if (Date.now() > deadline) { timedOut = true; return false; }
    }
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
    reason: timedOut
      ? 'Temps de calcul écoulé : aucune ligne gagnante trouvée (essaie moins de tours).'
      : nodes > budget
        ? 'Budget de calcul atteint : aucune ligne gagnante trouvée dans la limite.'
        : `Aucune ligne gagnante en ${maxTurns} tour(s)${allowDeaths ? '' : ' sans perte'}.`,
  };
}
