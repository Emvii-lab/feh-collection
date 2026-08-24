// Worker : lance le solveur hors du thread principal (pas de gel de l'UI), ce qui
// permet un GROS budget. Renvoie la progression puis le résultat.
import { solve, type SolveOpts, type SolveResult } from './solver';
import type { Board } from './battle';

export type SolverRequest = { board: Board; opts: SolveOpts };
export type SolverResponse =
  | { type: 'progress'; nodes: number }
  | { type: 'done'; result: SolveResult };

self.onmessage = (e: MessageEvent<SolverRequest>) => {
  const { board, opts } = e.data;
  let last = 0;
  const result = solve(board, opts, (nodes) => {
    const now = Date.now();
    if (now - last > 120) { // throttle des messages de progression
      last = now;
      (self as unknown as Worker).postMessage({ type: 'progress', nodes } satisfies SolverResponse);
    }
  });
  (self as unknown as Worker).postMessage({ type: 'done', result } satisfies SolverResponse);
};
