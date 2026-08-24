// Worker : lance le solveur / la recherche d'équipe hors du thread principal (pas de
// gel de l'UI), ce qui permet un GROS budget. Renvoie la progression puis le résultat.
import { solve, type SolveOpts, type SolveResult } from './solver';
import { searchTeam, type SearchUnit, type SearchOpts, type SearchResult } from './teamSearch';
import type { Board, BattleUnit } from './battle';
import type { TerrainMap } from './tactics';

export type SolverRequest =
  | { kind: 'solve'; board: Board; opts: SolveOpts }
  | {
      kind: 'search';
      pool: SearchUnit[]; enemies: BattleUnit[]; terrain: TerrainMap;
      allyPos: string[]; linked: boolean; opts: SearchOpts;
    };
export type SolverResponse =
  | { type: 'progress'; nodes: number }
  | { type: 'done'; result: SolveResult }
  | { type: 'searchProgress'; tested: number; total: number }
  | { type: 'searchDone'; result: SearchResult };

const post = (m: SolverResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<SolverRequest>) => {
  const req = e.data;
  if (req.kind === 'solve') {
    let last = 0;
    const result = solve(req.board, req.opts, (nodes) => {
      const now = Date.now();
      if (now - last > 120) { last = now; post({ type: 'progress', nodes }); }
    });
    post({ type: 'done', result });
  } else {
    const result = searchTeam(
      req.pool, req.enemies, req.terrain, req.allyPos, req.linked, req.opts,
      (tested, total) => post({ type: 'searchProgress', tested, total }),
    );
    post({ type: 'searchDone', result });
  }
};
