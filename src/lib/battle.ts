// C1+C2 : état de combat multi-unités + résolution de la PHASE ENNEMIE via un
// modèle d'IA FEH (best-effort, reconstitué). L'IA ennemie est DÉTERMINISTE :
// pour un état donné, ses coups sont fixés. C'est le socle du solveur (C3).
import { simulate, type Unit } from './combat';
import {
  reachable, threatZone, manhattan, moveAllowance, moveClass, weaponRange,
  parsePos, toPos, occupiable, terrainDR, type TerrainMap,
} from './tactics';

export type Side = 'ally' | 'enemy';
export type BattleUnit = {
  id: string;
  side: Side;
  unit: Unit; // hero + mods ; unit.stats.hp = PV max
  pos: string;
  hp: number; // PV courants
  active: boolean; // ennemis passifs : dormant tant que non déclenché
  charge?: number; // compteur courant de spéciale (persistant). Absent = plein (maxCd).
  refresher?: boolean; // danseuse/chanteuse : rejoue un allié
  assist?: AssistType; // assist de déplacement équipé (Repositionnement, Échange…)
  saveType?: SaveType; // compétence Save/garde : intercepte les attaques sur un allié proche
};

// Assists de déplacement modélisés (repositionnement d'un allié adjacent).
export type AssistType = 'reposition' | 'swap' | 'drawback' | 'pivot' | 'smite' | 'shove';
const ASSIST_RE: [AssistType, RegExp][] = [
  ['reposition', /reposition|reposit/i], ['drawback', /draw ?back|retrait/i],
  ['swap', /\bswap\b|permut/i], ['pivot', /\bpivot\b/i],
  ['smite', /\bsmite\b|catapult/i], ['shove', /\bshove\b|poussee|bourrade/i],
];
export function detectAssist(skillNames: string[]): AssistType | undefined {
  for (const n of skillNames) for (const [t, re] of ASSIST_RE) if (re.test(n)) return t;
  return undefined;
}

// Compétences « Save/garde » : l'unité intercepte les attaques contre un allié proche
// (dans les 2 cases). 'far' = protège des attaquants À DISTANCE ; 'near' = du corps-à-corps.
export type SaveType = 'far' | 'near';
export function detectSave(skillNames: string[]): SaveType | undefined {
  for (const n of skillNames) {
    if (/far save/i.test(n)) return 'far';
    if (/near save/i.test(n)) return 'near';
  }
  return undefined;
}

// Compteur de spéciale courant d'une unité (plein par défaut).
const curCharge = (bu: BattleUnit): number =>
  bu.charge ?? (bu.unit.mods.special.kind !== 'none' ? bu.unit.mods.special.maxCd : 0);

// Détecte une danseuse/chanteuse depuis ses compétences (assist de rejeu).
const REFRESH_RE = /\b(?:dance|sing)\b|gray waves|whimsical dream|tender dream|blizzard|geirsk|virtuoso/i;
export const isRefresher = (skillNames: string[]): boolean =>
  skillNames.some((n) => REFRESH_RE.test(n));
export type Board = {
  units: BattleUnit[];
  terrain: TerrainMap;
  linked: boolean; // globalai=passivelinked → un ennemi réveillé réveille tout le groupe
};

export type EnemyMove = {
  id: string; name: string;
  from: string; to: string;
  target?: string; // id de l'unité visée (attaquée ou soignée)
  dmg?: number; kills?: boolean; selfKilled?: boolean;
  heal?: number; // soin prodigué (soigneur au bâton)
};

const alive = (u: BattleUnit) => u.hp > 0;

// Unité prête pour le moteur 1v1 : PV courants + réduction de terrain (cumul multiplicatif).
// Bonus de zone REÇUS par une unité (max par stat) depuis ses alliés à portée.
function fieldBuffFor(units: BattleUnit[], self: BattleUnit, atPos: string) {
  const r = { atk: 0, spd: 0, def: 0, res: 0 };
  for (const o of units) {
    if (o === self || o.side !== self.side || !alive(o)) continue;
    const fb = o.unit.mods.fieldBuff;
    if (!fb || !fb.range) continue;
    if (manhattan(o.pos, atPos) <= fb.range) {
      if (fb.atk > r.atk) r.atk = fb.atk; if (fb.spd > r.spd) r.spd = fb.spd;
      if (fb.def > r.def) r.def = fb.def; if (fb.res > r.res) r.res = fb.res;
    }
  }
  return r;
}

function atTile(bu: BattleUnit, tile: string, terrain: TerrainMap, units: BattleUnit[]): Unit {
  const tDR = terrainDR(terrain[tile]);
  const base = bu.unit.mods.dmgReductionPct || 0;
  const dr = tDR ? Math.round((1 - (1 - base / 100) * (1 - tDR / 100)) * 100) : base;
  const fb = fieldBuffFor(units, bu, tile); // bonus de zone alliés (Hone/Fortify/Drive…)
  const m = bu.unit.mods;
  return {
    ...bu.unit,
    stats: { ...bu.unit.stats, hp: bu.hp },
    mods: {
      ...m, dmgReductionPct: dr,
      atkBuff: (m.atkBuff || 0) + fb.atk, spdBuff: (m.spdBuff || 0) + fb.spd,
      defBuff: (m.defBuff || 0) + fb.def, resBuff: (m.resBuff || 0) + fb.res,
    },
  };
}

// PASSAGE : seules les unités ADVERSES bloquent le déplacement (on traverse ses alliés).
function blockedBy(units: BattleUnit[], self: BattleUnit): Set<string> {
  return new Set(units.filter((u) => u !== self && alive(u) && u.side !== self.side).map((u) => u.pos));
}
// ARRÊT : on ne peut pas s'arrêter sur une case occupée (allié ou ennemi).
function occupiedTiles(units: BattleUnit[], self: BattleUnit): Set<string> {
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
  // Action complète d'UN ennemi (soin, sinon meilleure attaque, sinon avance).
  // Renvoie true s'il a attaqué (utile aux danseuses). `move`=false : sans déplacement.
  const actEnemy = (e: BattleUnit, allowMove = true): boolean => {
    if (!alive(e)) return false;
    const range = weaponRange(e.unit.hero.weaponType);
    const reach = allowMove
      ? reachable(e.pos, moveAllowance(e.unit.hero.moveType), moveClass(e.unit.hero.moveType), terrain, blockedBy(units, e))
      : new Set([e.pos]);
    const occ = occupiedTiles(units, e);

    // Soigneur (bâton) : soigne l'allié le plus amoché à portée, plutôt qu'attaquer.
    if (e.unit.hero.weaponType === 'Staff') {
      let healTile: string | null = null, healTgt: BattleUnit | null = null, worst = 0;
      for (const o of enemies()) {
        if (o.id === e.id || !alive(o)) continue;
        const missing = o.unit.stats.hp - o.hp;
        if (missing <= 0) continue;
        for (const t of reach) {
          if (t !== e.pos && occ.has(t)) continue;
          if (manhattan(t, o.pos) <= 2 && missing > worst) { worst = missing; healTile = t; healTgt = o; }
        }
      }
      if (healTgt && healTile) {
        const heal = Math.min(healTgt.unit.stats.hp, healTgt.hp + Math.max(20, Math.round(worst * 0.5)));
        const from = e.pos; e.pos = healTile;
        const done = heal - healTgt.hp; healTgt.hp = heal;
        moves.push({ id: e.id, name: e.unit.hero.name, from, to: healTile, target: healTgt.id, heal: done });
        return false;
      }
    }

    // Meilleure (case, cible) d'attaque.
    let best: Option | null = null;
    const as = allies();
    const boardSnap: Board = { units, terrain, linked: board.linked }; // pour effectiveDefender
    for (let i = 0; i < as.length; i++) {
      const a = as[i];
      for (const t of reach) {
        if (t !== e.pos && occ.has(t)) continue; // on ne s'arrête pas sur une case occupée
        if (manhattan(t, a.pos) > range) continue;
        // Garde (Save) : si un allié de la cible intercepte, c'est lui qui encaisse.
        const def = effectiveDefender(boardSnap, a, range);
        const sim = simulate(atTile(e, t, terrain, units), atTile(def, def.pos, terrain, units), { atk: curCharge(e), def: curCharge(def) });
        if (sim.atk.total <= 0) continue; // l'IA n'attaque pas une cible à qui elle fait 0 dégât
        const opt: Option = {
          tile: t, target: def, dmg: sim.atk.total, kills: sim.ko,
          selfKilled: sim.counter?.atkKo ?? false, selfDmg: sim.counter?.total ?? 0, targetIdx: i,
        };
        if (better(opt, best)) best = opt;
      }
    }

    if (best) {
      const sim = simulate(atTile(e, best.tile, terrain, units), atTile(best.target, best.target.pos, terrain, units), { atk: curCharge(e), def: curCharge(best.target) });
      const from = e.pos;
      e.pos = best.tile;
      best.target.hp = sim.defHpAfter;
      e.charge = sim.chargeAfter.atk; best.target.charge = sim.chargeAfter.def; // jauge persistante
      if (sim.counter) e.hp = sim.counter.atkHpAfter;
      moves.push({
        id: e.id, name: e.unit.hero.name, from, to: best.tile, target: best.target.id,
        dmg: sim.atk.total, kills: sim.ko, selfKilled: e.hp <= 0,
      });
      return true;
    }
    if (allowMove && as.length) {
      // Pas de cible atteignable → avancer vers l'allié le plus proche.
      let dest = e.pos, bestD = Infinity;
      for (const t of reach) {
        if (t !== e.pos && occ.has(t)) continue;
        const d = Math.min(...as.map((a) => manhattan(t, a.pos)));
        if (d < bestD) { bestD = d; dest = t; }
      }
      if (dest !== e.pos) { moves.push({ id: e.id, name: e.unit.hero.name, from: e.pos, to: dest }); e.pos = dest; }
    }
    return false;
  };

  // Les non-danseuses agissent d'abord ; on retient qui a attaqué.
  const acted = new Set<string>();
  for (const e of enemies()) {
    if (!e.active || !alive(e) || e.refresher) continue;
    if (actEnemy(e)) acted.add(e.id);
  }
  // Danseuses : rejouent un allié adjacent qui a déjà attaqué (2e action, sans déplacement).
  for (const d of enemies()) {
    if (!d.refresher || !d.active || !alive(d)) continue;
    const target = enemies()
      .filter((o) => o.id !== d.id && alive(o) && acted.has(o.id) && manhattan(d.pos, o.pos) <= 1)
      .sort((x, y) => y.hp - x.hp)[0]; // le plus en forme (le plus utile à rejouer)
    if (target) {
      moves.push({ id: d.id, name: d.unit.hero.name, from: d.pos, to: d.pos, target: target.id });
      actEnemy(target); // rejoue (déplacement + attaque)
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

// Défenseur EFFECTIF quand on frappe `target` : si un allié de `target` porte une garde
// (Save) compatible avec la portée de l'attaquant et se tient dans les 2 cases, c'est LUI
// qui encaisse (Far Save = contre le distant ≥2 ; Near Save = contre le corps-à-corps).
export function effectiveDefender(board: Board, target: BattleUnit, attackerRange: number): BattleUnit {
  const want: SaveType = attackerRange >= 2 ? 'far' : 'near';
  for (const s of board.units) {
    if (s.saveType !== want || s.side !== target.side || s.id === target.id || !alive(s)) continue;
    if (manhattan(s.pos, target.pos) <= 2) return s; // il intercepte à la place de la cible
  }
  return target;
}

// Options d'attaque de l'unité `id` : (case atteignable, ennemi à portée). Tient compte des
// gardes (Save) : frapper un ennemi protégé revient à combattre son garde.
export function attackOptionsFor(board: Board, id: string): AttackOption[] {
  const u = board.units.find((x) => x.id === id);
  if (!u || !alive(u)) return [];
  const reach = unitReach(board, id);
  const occ = occupiedTiles(board.units, u);
  const range = weaponRange(u.unit.hero.weaponType);
  const foes = board.units.filter((x) => x.side !== u.side && alive(x));
  const out: AttackOption[] = [];
  for (const t of reach) {
    if (t !== u.pos && occ.has(t)) continue;
    for (const f of foes) {
      if (manhattan(t, f.pos) > range) continue;
      const def = effectiveDefender(board, f, range); // garde éventuel
      const sim = simulate(atTile(u, t, board.terrain, board.units), atTile(def, def.pos, board.terrain, board.units), { atk: curCharge(u), def: curCharge(def) });
      if (sim.atk.total <= 0) continue; // inutile d'attaquer pour 0 dégât
      out.push({ tile: t, targetId: def.id, dmg: sim.atk.total, kills: sim.ko, selfKilled: sim.counter?.atkKo ?? false });
    }
  }
  return out;
}

// Applique une attaque du joueur (déplace + résout le combat). Renvoie un NOUVEL état.
export function applyPlayerAttack(board: Board, id: string, tile: string, targetId: string): Board {
  const units = board.units.map((u) => ({ ...u }));
  const u = units.find((x) => x.id === id)!;
  const f = units.find((x) => x.id === targetId)!;
  const sim = simulate(atTile(u, tile, board.terrain, units), atTile(f, f.pos, board.terrain, board.units), { atk: curCharge(u), def: curCharge(f) });
  u.pos = tile;
  f.hp = sim.defHpAfter;
  u.charge = sim.chargeAfter.atk; f.charge = sim.chargeAfter.def; // jauge de spéciale persistante
  if (f.side === 'enemy') f.active = true; // un ennemi attaqué se réveille (le groupe suit si linked)
  if (sim.counter) u.hp = sim.counter.atkHpAfter;
  return { ...board, units };
}

// Applique un simple déplacement (sans attaque).
export function applyMove(board: Board, id: string, tile: string): Board {
  const units = board.units.map((u) => (u.id === id ? { ...u, pos: tile } : { ...u }));
  return { ...board, units };
}

// ---- Assists de déplacement -------------------------------------------------------
export type AssistMove = { targetId: string; targetName: string; toUser: string; toTarget: string };
const onBoard = (x: number, y: number) => x >= 0 && x <= 5 && y >= 1 && y <= 8;
type XY = { x: number; y: number };
// Positions finales (porteur, cible) selon l'assist. `via` = case intermédiaire à traverser
// (Smite). dir = vecteur unitaire porteur→cible (ils sont adjacents).
function assistGeom(a: AssistType, pu: XY, pt: XY, dx: number, dy: number): { toUser: XY; toTarget: XY; via?: XY } | null {
  switch (a) {
    case 'reposition': return { toUser: pu, toTarget: { x: pu.x - dx, y: pu.y - dy } }; // cible de l'autre côté du porteur
    case 'swap': return { toUser: pt, toTarget: pu };
    case 'drawback': return { toUser: { x: pu.x - dx, y: pu.y - dy }, toTarget: pu }; // porteur recule, cible prend sa place
    case 'pivot': return { toUser: { x: pt.x + dx, y: pt.y + dy }, toTarget: pt }; // porteur saute de l'autre côté de la cible
    case 'smite': return { toUser: pu, toTarget: { x: pt.x + 2 * dx, y: pt.y + 2 * dy }, via: { x: pt.x + dx, y: pt.y + dy } };
    case 'shove': return { toUser: pu, toTarget: { x: pt.x + dx, y: pt.y + dy } };
    default: return null;
  }
}
// Options d'assist du porteur `id` : chaque allié adjacent repositionnable (cases valides).
export function assistOptions(board: Board, id: string): AssistMove[] {
  const u = board.units.find((x) => x.id === id);
  if (!u || !alive(u) || !u.assist) return [];
  const pu = parsePos(u.pos);
  if (!pu) return [];
  const out: AssistMove[] = [];
  for (const t of board.units) {
    if (t.side !== u.side || t.id === u.id || !alive(t) || manhattan(u.pos, t.pos) !== 1) continue;
    const pt = parsePos(t.pos)!;
    const g = assistGeom(u.assist, pu, pt, pt.x - pu.x, pt.y - pu.y);
    if (!g) continue;
    if (!onBoard(g.toUser.x, g.toUser.y) || !onBoard(g.toTarget.x, g.toTarget.y)) continue;
    const toUser = toPos(g.toUser.x, g.toUser.y), toTarget = toPos(g.toTarget.x, g.toTarget.y);
    if (toUser === toTarget) continue;
    if (!occupiable(board.terrain[toUser], u.unit.hero.moveType)) continue;
    if (!occupiable(board.terrain[toTarget], t.unit.hero.moveType)) continue;
    // cases d'arrivée libres (hors le porteur et la cible eux-mêmes).
    const busy = (p: string) => board.units.some((o) => alive(o) && o.id !== u.id && o.id !== t.id && o.pos === p);
    if (busy(toUser) || busy(toTarget)) continue;
    if (g.via) { const v = toPos(g.via.x, g.via.y); if (!onBoard(g.via.x, g.via.y) || busy(v) || board.terrain[v] === 'wall') continue; }
    out.push({ targetId: t.id, targetName: t.unit.hero.name, toUser, toTarget });
  }
  return out;
}
// Applique un assist (repositionne porteur + cible). Nouvel état.
export function applyAssist(board: Board, id: string, m: AssistMove): Board {
  const units = board.units.map((u) =>
    u.id === id ? { ...u, pos: m.toUser } : u.id === m.targetId ? { ...u, pos: m.toTarget } : { ...u });
  return { ...board, units };
}

// Empreinte d'un état (positions + PV + activation) pour la table de transposition.
export function hashBoard(board: Board): string {
  return board.units
    .map((u) => `${u.id}@${u.pos}:${Math.max(0, u.hp)}${u.active ? 'a' : ''}c${curCharge(u)}`)
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
