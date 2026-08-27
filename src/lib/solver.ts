// C3 : le solveur. Recherche GUIDÉE (best-first + beam) d'une ligne de jeu qui
// nettoie la carte. FEH est déterministe, et l'IA ennemie aussi (voir battle.ts) →
// seuls TES coups branchent. Au lieu d'un DFS aveugle, on ordonne l'exploration par
// une heuristique (moins d'ennemis / moins de PV ennemis / plus d'alliés vivants =
// plus proche de la victoire), avec un faisceau (beam) pour borner la recherche.
import {
  enemyPhase, boardSummary, alive,
  attackOptionsFor, applyPlayerAttack, applyMove, unitReach, hashBoard,
  assistOptions, applyAssist,
  type Board, type EnemyMove,
} from './battle';
import { manhattan } from './tactics';

export type PlayerMove = {
  id: string; name: string; from: string; to: string;
  targetId?: string; targetName?: string; dmg?: number; kills?: boolean;
  assist?: string; // assist de déplacement (Repositionnement…) : cible = targetName
};
export type PlanTurn = { player: PlayerMove[]; enemy: EnemyMove[] };
export type SolveResult = { win: boolean; turns: PlanTurn[]; nodes: number; reason: string };
export type SolveOpts = {
  maxTurns?: number; allowDeaths?: boolean; nodeBudget?: number; timeLimitMs?: number;
  beam?: number; ppBeam?: number; attacksPerUnit?: number;
};

// Heuristique : plus c'est BAS, plus on est proche du nettoyage.
function heuristic(b: Board): number {
  let enHp = 0, enAlive = 0, alAlive = 0, alHp = 0;
  for (const u of b.units) {
    if (u.side === 'enemy') { if (u.hp > 0) { enAlive++; enHp += u.hp; } }
    else if (u.hp > 0) { alAlive++; alHp += u.hp; }
  }
  return enAlive * 100_000 + enHp * 10 - alAlive * 1_000 - alHp;
}

// Toutes les phases-joueur possibles (chaque allié agit une fois), avec un nombre
// d'attaques plafonné par unité (les meilleures : KO puis dégâts).
function* playerPhases(
  b0: Board, allowDeaths: boolean, attacksPerUnit: number,
): Generator<{ board: Board; moves: PlayerMove[] }> {
  const allyIds = b0.units.filter((u) => u.side === 'ally' && alive(u)).map((u) => u.id);
  function* rec(i: number, b: Board, moves: PlayerMove[]): Generator<{ board: Board; moves: PlayerMove[] }> {
    if (i >= allyIds.length) { yield { board: b, moves }; return; }
    const id = allyIds[i];
    const cur = b.units.find((u) => u.id === id)!;
    if (!alive(cur)) { yield* rec(i + 1, b, moves); return; }
    const atks = attackOptionsFor(b, id)
      .filter((a) => allowDeaths || !a.selfKilled)
      .sort((x, y) => Number(y.kills) - Number(x.kills) || y.dmg - x.dmg)
      .slice(0, attacksPerUnit);
    for (const a of atks) {
      const nb = applyPlayerAttack(b, id, a.tile, a.targetId);
      const tgt = b.units.find((u) => u.id === a.targetId)!;
      yield* rec(i + 1, nb, [...moves, {
        id, name: cur.unit.hero.name, from: cur.pos, to: a.tile,
        targetId: a.targetId, targetName: tgt.unit.hero.name, dmg: a.dmg, kills: a.kills,
      }]);
    }
    // Assists de déplacement : le porteur peut, au lieu d'attaquer, repositionner un allié
    // adjacent (Repositionnement, Échange, Pivot…). Utile pour amener un allié à portée /
    // le mettre à l'abri. On plafonne à quelques options pour borner la recherche.
    if (cur.assist) {
      for (const opt of assistOptions(b, id).slice(0, 6)) {
        const nb = applyAssist(b, id, opt);
        yield* rec(i + 1, nb, [...moves, {
          id, name: cur.unit.hero.name, from: cur.pos, to: opt.toUser,
          targetId: opt.targetId, targetName: opt.targetName, assist: cur.assist,
        }]);
      }
    }
    // S'il ne peut pas attaquer utilement : avancer vers l'ennemi le plus proche.
    if (atks.length === 0) {
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
    // Option « attente ».
    yield* rec(i + 1, b, [...moves, { id, name: cur.unit.hero.name, from: cur.pos, to: cur.pos }]);
  }
  yield* rec(0, b0, []);
}

type Node = { board: Board; plan: PlanTurn[]; depth: number; hv: number };

export function solve(
  board: Board, opts: SolveOpts = {}, onProgress?: (nodes: number) => void,
): SolveResult {
  const maxTurns = opts.maxTurns ?? 6;
  const allowDeaths = opts.allowDeaths ?? true;
  const budget = opts.nodeBudget ?? 4_000_000;
  const deadline = Date.now() + (opts.timeLimitMs ?? 15_000);
  const beam = opts.beam ?? 800;          // taille max du faisceau global
  const ppBeam = opts.ppBeam ?? 40;       // phases-joueur retenues par nœud
  const attacksPerUnit = opts.attacksPerUnit ?? 5;
  const SEEN_CAP = 800_000;               // borne mémoire de la table de transposition

  const seen = new Set<string>([hashBoard(board)]);
  let frontier: Node[] = [{ board, plan: [], depth: 0, hv: heuristic(board) }];
  let nodes = 0, timedOut = false;
  let out: SolveResult | null = null;

  while (frontier.length && !out) {
    // best-first : on développe le nœud le plus prometteur.
    frontier.sort((a, b) => a.hv - b.hv || a.depth - b.depth);
    const cur = frontier.shift()!;
    if (boardSummary(cur.board).allDead) { out = { win: true, turns: cur.plan, nodes, reason: 'Carte nettoyée.' }; break; }
    if (cur.depth >= maxTurns) continue;
    if (++nodes > budget) break;
    if ((nodes & 127) === 0) { onProgress?.(nodes); if (Date.now() > deadline) { timedOut = true; break; } }

    // 1) toutes les phases-joueur, notées par l'heuristique APRÈS tes coups (avant IA).
    const pps: { board: Board; moves: PlayerMove[]; hv: number }[] = [];
    for (const pp of playerPhases(cur.board, allowDeaths, attacksPerUnit)) {
      if (!allowDeaths && boardSummary(pp.board).lostUnit) continue;
      pps.push({ ...pp, hv: heuristic(pp.board) });
    }
    pps.sort((a, b) => a.hv - b.hv);

    // 2) on ne résout la phase ennemie que pour les meilleures (beam), puis on empile.
    for (const pp of pps.slice(0, ppBeam)) {
      const ep = enemyPhase(pp.board);
      if (!allowDeaths && boardSummary(ep.board).lostUnit) continue;
      const key = hashBoard(ep.board) + '#' + (cur.depth + 1);
      if (seen.has(key)) continue;
      if (seen.size < SEEN_CAP) seen.add(key); // au-delà : on accepte des revisites (mémoire bornée)
      if (boardSummary(ep.board).allDead) {
        out = { win: true, turns: [...cur.plan, { player: pp.moves, enemy: ep.moves }], nodes, reason: 'Carte nettoyée.' };
        break;
      }
      frontier.push({ board: ep.board, plan: [...cur.plan, { player: pp.moves, enemy: ep.moves }], depth: cur.depth + 1, hv: heuristic(ep.board) });
    }
    // 3) bornage du faisceau : on garde les meilleurs.
    if (frontier.length > beam) {
      frontier.sort((a, b) => a.hv - b.hv);
      frontier.length = beam;
    }
  }

  return out ?? {
    win: false, turns: [], nodes,
    reason: timedOut
      ? 'Temps de calcul écoulé sans ligne gagnante trouvée.'
      : nodes > budget
        ? 'Budget de calcul atteint sans ligne gagnante trouvée.'
        : `Aucune ligne gagnante en ${maxTurns} tour(s)${allowDeaths ? '' : ' sans perte'}.`,
  };
}
