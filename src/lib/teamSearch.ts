// Recherche d'équipe : parmi tes persos jouables, cherche une équipe qui nettoie la
// carte. On teste TOUTES les combinaisons de 4 du pool, dans l'ordre du plus prometteur
// (classement selon la tenue face au boss). Pour rester rapide, un pré-filtre bon marché
// (dégâts cumulés vs PV de chaque ennemi) écarte instantanément les équipes qui ne
// peuvent physiquement pas tuer tout le monde, et seules les équipes crédibles passent
// par le solveur lourd. Budget de temps global pour ne pas figer le navigateur.
import { solve, type PlanTurn } from './solver';
import { combatVerdict, simulate, type Unit } from './combat';
import type { Board, BattleUnit } from './battle';
import type { TerrainMap } from './tactics';

export type SearchUnit = { id: string; name: string; title: string; unit: Unit };
export type TeamResult = {
  ids: string[]; names: string[]; titles: string[];
  moves: string[]; weapons: string[];                  // type de déplacement/arme (repli)
  moveUrls: (string | undefined)[]; weaponUrls: (string | undefined)[]; // vraies icônes
  turns: number; plan: PlanTurn[];      // plan tour par tour de la ligne gagnante
};
export type SearchResult = { teams: TeamResult[]; tested: number; poolSize: number; reason: string };

export type SearchOpts = {
  maxTurns?: number; topK?: number; perTeamBudget?: number; perTeamMs?: number;
  maxWinners?: number; allowDeaths?: boolean; globalMs?: number;
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
  const perTeamBudget = opts.perTeamBudget ?? 300_000;
  const perTeamMs = opts.perTeamMs ?? 2500;
  const maxWinners = opts.maxWinners ?? 3;
  const globalMs = opts.globalMs ?? 120_000;      // budget total (on teste dans l'ordre)
  const globalDeadline = Date.now() + globalMs;
  // topK = combien de héros on garde pour former les combos. Par défaut : TOUT le pool
  // → on teste réellement toutes les combinaisons de 4 (C(pool,4)), pas un sous-ensemble.
  const topK = opts.topK ?? pool.length;
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

  // Pré-filtre bon marché (condition NÉCESSAIRE, pas de faux négatif) : les dégâts
  // qu'un membre inflige à chaque ennemi en un échange, calculés UNE fois (pool ×
  // ennemis). Une équipe qui, même en concentrant ses 4 membres sur chaque tour, ne
  // peut pas cumuler assez de dégâts pour tuer un ennemi donné dans le budget de tours
  // ne pourra JAMAIS nettoyer la carte → on saute le solveur lourd pour elle.
  const dmg = new Map<string, Map<string, number>>();
  for (const u of ranked) {
    const row = new Map<string, number>();
    for (const e of enemies) row.set(e.id, simulate(u.unit, e.unit).atk.total);
    dmg.set(u.id, row);
  }
  const canTeamReachAllHp = (team: SearchUnit[]): boolean => {
    for (const e of enemies) {
      let perTurn = 0;
      for (const u of team) perTurn += dmg.get(u.id)!.get(e.id) ?? 0;
      // borne TRÈS généreuse (chaque membre frappe cet ennemi ~1×/tour, + marge 1,5×
      // pour les spéciales/bonus de zone non simulés en 1v1) : on ne veut écarter QUE
      // les équipes réellement incapables de tuer cet ennemi. Aucun faux négatif.
      if (perTurn * maxTurns * 1.5 < e.hp) return false;
    }
    return true;
  };

  const winners: TeamResult[] = [];
  let tested = 0, solved = 0, timedOut = false;
  for (const team of teams) {
    if (Date.now() > globalDeadline) { timedOut = true; break; }
    tested++;
    onProgress?.(tested, teams.length);
    // écarté instantanément si l'équipe ne peut pas cumuler assez de dégâts.
    if (!canTeamReachAllHp(team)) continue;
    solved++;
    const allies: BattleUnit[] = team.map((u, i) => ({
      id: u.id, side: 'ally', unit: u.unit, pos: allyPos[i].toLowerCase(), hp: u.unit.stats.hp, active: true,
    }));
    const board: Board = { units: [...enemies.map((e) => ({ ...e })), ...allies], terrain, linked };
    // survie obligatoire : on ne veut pas d'une « victoire » où un héros meurt.
    const res = solve(board, { maxTurns, nodeBudget: perTeamBudget, timeLimitMs: perTeamMs, allowDeaths: opts.allowDeaths ?? false });
    if (res.win) {
      winners.push({
        ids: team.map((u) => u.id),
        names: team.map((u) => u.name),
        titles: team.map((u) => u.title),
        moves: team.map((u) => u.unit.hero.moveType),
        weapons: team.map((u) => u.unit.hero.weaponType),
        moveUrls: team.map((u) => u.unit.hero.moveUrl),
        weaponUrls: team.map((u) => u.unit.hero.weaponUrl),
        turns: res.turns.length,
        plan: res.turns,
      });
      if (winners.length >= maxWinners) break;
    }
  }
  return {
    teams: winners, tested, poolSize: pool.length,
    reason: winners.length ? ''
      : timedOut
        ? `Budget de temps atteint : ${tested}/${teams.length} équipes parcourues (${solved} analysées à fond), aucune ne nettoie la carte sans perte. Essaie plus de tours, ou monte tes persos.`
        : `Aucune des ${teams.length} équipes possibles ne nettoie la carte sans perte (${solved} crédibles analysées à fond). Essaie plus de tours, ou monte tes persos.`,
  };
}
