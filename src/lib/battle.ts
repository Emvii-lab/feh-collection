// C1+C2 : état de combat multi-unités + résolution de la PHASE ENNEMIE via un
// modèle d'IA FEH (best-effort, reconstitué). L'IA ennemie est DÉTERMINISTE :
// pour un état donné, ses coups sont fixés. C'est le socle du solveur (C3).
import { simulate, type Unit } from './combat';
import {
  reachable, threatZone, manhattan, moveAllowance, moveClass, weaponRange,
  parsePos, terrainDR, type TerrainMap,
} from './tactics';

export type Side = 'ally' | 'enemy';
export type BattleUnit = {
  id: string;
  side: Side;
  unit: Unit; // hero + mods ; unit.stats.hp = PV max
  pos: string;
  hp: number; // PV courants
  active: boolean; // ennemis passifs : dormant tant que non déclenché
};
export type Board = {
  units: BattleUnit[];
  terrain: TerrainMap;
  linked: boolean; // globalai=passivelinked → un ennemi réveillé réveille tout le groupe
};

export type EnemyMove = {
  id: string; name: string;
  from: string; to: string;
  target?: string; // id de l'allié attaqué
  dmg?: number; kills?: boolean; selfKilled?: boolean;
};

const alive = (u: BattleUnit) => u.hp > 0;

// Unité prête pour le moteur 1v1 : PV courants + réduction de terrain (cumul multiplicatif).
function atTile(bu: BattleUnit, tile: string, terrain: TerrainMap): Unit {
  const tDR = terrainDR(terrain[tile]);
  const base = bu.unit.mods.dmgReductionPct || 0;
  const dr = tDR ? Math.round((1 - (1 - base / 100) * (1 - tDR / 100)) * 100) : base;
  return {
    ...bu.unit,
    stats: { ...bu.unit.stats, hp: bu.hp },
    mods: { ...bu.unit.mods, dmgReductionPct: dr },
  };
}

// Cases occupées par d'autres unités vivantes (infranchissables pour le déplacement).
function blockedBy(units: BattleUnit[], self: BattleUnit): Set<string> {
  return new Set(units.filter((u) => u !== self && alive(u)).map((u) => u.pos));
}

// Score d'attaque de l'IA (modèle FEH best-effort) : tuer prime ; sinon éviter de
// mourir ; puis max de dégâts ; puis minimiser les dégâts subis ; puis cible d'index bas.
type Option = { tile: string; target: BattleUnit; dmg: number; kills: boolean; selfKilled: boolean; selfDmg: number; targetIdx: number };
function better(a: Option, b: Option | null): boolean {
  if (!b) return true;
  if (a.kills !== b.kills) return a.kills; // tuer prime (vaut le sacrifice)
  if (a.selfKilled !== b.selfKilled) return !a.selfKilled; // sinon, éviter de se faire tuer
  if (a.dmg !== b.dmg) return a.dmg > b.dmg; // max de dégâts
  if (a.selfDmg !== b.selfDmg) return a.selfDmg < b.selfDmg; // minimiser les dégâts reçus
  return a.targetIdx < b.targetIdx; // départage : cible de plus petit index
}

// Résout la phase ennemie complète. Renvoie le nouvel état + le journal des coups.
export function enemyPhase(board: Board): { board: Board; moves: EnemyMove[] } {
  const units = board.units.map((u) => ({ ...u })); // copie mutable
  const terrain = board.terrain;
  const moves: EnemyMove[] = [];
  const allies = () => units.filter((u) => u.side === 'ally' && alive(u));
  const enemies = () => units.filter((u) => u.side === 'enemy' && alive(u));

  // 1) Activation des passifs : un allié dans la zone de menace de l'ennemi le réveille.
  let anyActive = false;
  for (const e of enemies()) {
    if (!e.active) {
      const tz = threatZone(
        e.pos, moveAllowance(e.unit.hero.moveType), moveClass(e.unit.hero.moveType),
        weaponRange(e.unit.hero.weaponType), terrain, blockedBy(units, e),
      );
      if (allies().some((a) => tz.has(a.pos))) e.active = true;
    }
    if (e.active) anyActive = true;
  }
  if (board.linked && anyActive) for (const e of enemies()) e.active = true;

  // 2) Chaque ennemi actif agit (dans l'ordre des unités).
  for (const e of enemies()) {
    if (!e.active || !alive(e)) continue;
    const move = moveAllowance(e.unit.hero.moveType);
    const cls = moveClass(e.unit.hero.moveType);
    const range = weaponRange(e.unit.hero.weaponType);
    const reach = reachable(e.pos, move, cls, terrain, blockedBy(units, e));
    const occ = blockedBy(units, e);

    // Meilleure (case, cible) d'attaque.
    let best: Option | null = null;
    const as = allies();
    for (let i = 0; i < as.length; i++) {
      const a = as[i];
      for (const t of reach) {
        if (t !== e.pos && occ.has(t)) continue; // on ne s'arrête pas sur une case occupée
        if (manhattan(t, a.pos) > range) continue;
        const sim = simulate(atTile(e, t, terrain), atTile(a, a.pos, terrain));
        if (sim.atk.total <= 0) continue; // l'IA n'attaque pas une cible à qui elle fait 0 dégât
        const opt: Option = {
          tile: t, target: a, dmg: sim.atk.total, kills: sim.ko,
          selfKilled: sim.counter?.atkKo ?? false, selfDmg: sim.counter?.total ?? 0, targetIdx: i,
        };
        if (better(opt, best)) best = opt;
      }
    }

    if (best) {
      const sim = simulate(atTile(e, best.tile, terrain), atTile(best.target, best.target.pos, terrain));
      const from = e.pos;
      e.pos = best.tile;
      best.target.hp = sim.defHpAfter;
      if (sim.counter) e.hp = sim.counter.atkHpAfter;
      moves.push({
        id: e.id, name: e.unit.hero.name, from, to: best.tile, target: best.target.id,
        dmg: sim.atk.total, kills: sim.ko, selfKilled: e.hp <= 0,
      });
    } else if (as.length) {
      // Pas de cible atteignable → avancer vers l'allié le plus proche.
      let dest = e.pos, bestD = Infinity;
      for (const t of reach) {
        if (t !== e.pos && occ.has(t)) continue;
        const d = Math.min(...as.map((a) => manhattan(t, a.pos)));
        if (d < bestD) { bestD = d; dest = t; }
      }
      if (dest !== e.pos) {
        moves.push({ id: e.id, name: e.unit.hero.name, from: e.pos, to: dest });
        e.pos = dest;
      }
    }
  }

  return { board: { ...board, units }, moves };
}

// ---- Actions du JOUEUR (pour le solveur C3) --------------------------------

// Cases où l'unité `id` peut se déplacer (terrain + unités bloquantes).
export function unitReach(board: Board, id: string): Set<string> {
  const u = board.units.find((x) => x.id === id);
  if (!u || !alive(u)) return new Set();
  return reachable(
    u.pos, moveAllowance(u.unit.hero.moveType), moveClass(u.unit.hero.moveType),
    board.terrain, blockedBy(board.units, u),
  );
}

export type AttackOption = { tile: string; targetId: string; dmg: number; kills: boolean; selfKilled: boolean };

// Options d'attaque de l'unité `id` : (case atteignable, ennemi à portée).
export function attackOptionsFor(board: Board, id: string): AttackOption[] {
  const u = board.units.find((x) => x.id === id);
  if (!u || !alive(u)) return [];
  const reach = unitReach(board, id);
  const occ = blockedBy(board.units, u);
  const range = weaponRange(u.unit.hero.weaponType);
  const foes = board.units.filter((x) => x.side !== u.side && alive(x));
  const out: AttackOption[] = [];
  for (const t of reach) {
    if (t !== u.pos && occ.has(t)) continue;
    for (const f of foes) {
      if (manhattan(t, f.pos) > range) continue;
      const sim = simulate(atTile(u, t, board.terrain), atTile(f, f.pos, board.terrain));
      if (sim.atk.total <= 0) continue; // inutile d'attaquer pour 0 dégât
      out.push({ tile: t, targetId: f.id, dmg: sim.atk.total, kills: sim.ko, selfKilled: sim.counter?.atkKo ?? false });
    }
  }
  return out;
}

// Applique une attaque du joueur (déplace + résout le combat). Renvoie un NOUVEL état.
export function applyPlayerAttack(board: Board, id: string, tile: string, targetId: string): Board {
  const units = board.units.map((u) => ({ ...u }));
  const u = units.find((x) => x.id === id)!;
  const f = units.find((x) => x.id === targetId)!;
  const sim = simulate(atTile(u, tile, board.terrain), atTile(f, f.pos, board.terrain));
  u.pos = tile;
  f.hp = sim.defHpAfter;
  if (f.side === 'enemy') f.active = true; // un ennemi attaqué se réveille (le groupe suit si linked)
  if (sim.counter) u.hp = sim.counter.atkHpAfter;
  return { ...board, units };
}

// Applique un simple déplacement (sans attaque).
export function applyMove(board: Board, id: string, tile: string): Board {
  const units = board.units.map((u) => (u.id === id ? { ...u, pos: tile } : { ...u }));
  return { ...board, units };
}

// Empreinte d'un état (positions + PV + activation) pour la table de transposition.
export function hashBoard(board: Board): string {
  return board.units
    .map((u) => `${u.id}@${u.pos}:${Math.max(0, u.hp)}${u.active ? 'a' : ''}`)
    .sort()
    .join('|');
}

// Bilan d'un tour : PV, morts de chaque côté.
export function boardSummary(board: Board) {
  const allies = board.units.filter((u) => u.side === 'ally');
  const enemies = board.units.filter((u) => u.side === 'enemy');
  return {
    alliesAlive: allies.filter(alive).length, alliesTotal: allies.length,
    enemiesAlive: enemies.filter(alive).length, enemiesTotal: enemies.length,
    allDead: enemies.every((u) => !alive(u)),
    lostUnit: allies.some((u) => !alive(u)),
  };
}
export { alive, parsePos };
