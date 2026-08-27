// Moteur de combat FEH — couvre le cœur des règles + modificateurs (auto ou saisis).
// Stats : viennent de la collection (tes persos) ou d'une saisie (carte ennemie) —
// jamais dupliquées dans la base. Effets : lus depuis feh.skills (efficacité, Brave)
// ou renseignés à la main (bonus en combat, doublon, réduction, vantage).
import type { Color, Hero, Stats, WeaponType } from '../types';
import type { CollStats } from './collection';
import type { SpecialInfo } from './skillEffects';

const RANGED: Set<string> = new Set(['Bow', 'Dagger', 'Tome', 'Staff']);
const MAGICAL: Set<string> = new Set(['Tome', 'Staff', 'Dragon']);

export const isRanged = (w: WeaponType) => RANGED.has(w);
const targetsRes = (w: WeaponType) => MAGICAL.has(w);

const BEATS: Record<string, string> = { red: 'green', green: 'blue', blue: 'red' };
export function triangle(a: Color, d: Color): 1 | 0 | -1 {
  if (a === 'colorless' || d === 'colorless') return 0;
  if (BEATS[a] === d) return 1;
  if (BEATS[d] === a) return -1;
  return 0;
}

export function resolveStats(hero: Hero, coll?: CollStats | null): Stats | null {
  if (
    coll &&
    coll.PV != null && coll.ATQ != null && coll.VIT != null &&
    coll.DEF != null && coll.RES != null
  ) {
    return { hp: coll.PV, atk: coll.ATQ, spd: coll.VIT, def: coll.DEF, res: coll.RES };
  }
  return hero.stats ?? null;
}

// Modificateurs de combat d'une unité (auto-détectés depuis les skills, ou saisis).
export type CombatMods = {
  brave: boolean; // attaque ×2
  effAgainst: string[]; // types ciblés par l'efficacité (ex. "Flying", "Dragon")
  atkBuff: number; // +ATQ en combat (Death Blow, buffs d'arme…)
  spdBuff: number; // +VIT en combat (pour le doublon)
  defBuff: number; // +DÉF en combat (encaisse mieux les attaques physiques)
  resBuff: number; // +RÉS en combat (encaisse mieux la magie)
  // Bonus conditionnés par la phase : appliqués seulement si le porteur INITIE (initBuff)
  // ou seulement s'il DÉFEND (defendBuff). Fusionnés dans les buffs au début de simulate().
  initBuff: { atk: number; spd: number; def: number; res: number };
  defendBuff: { atk: number; spd: number; def: number; res: number };
  bonusDamage: number; // dégâts fixes ajoutés à chaque coup (ex. « deals damage = X »)
  bonusDamageStat: { atk: number; spd: number; def: number; res: number; hp: number }; // % d'une stat en +
  guaranteedFollowup: boolean; // double garanti
  noFollowup: boolean; // ne peut pas doubler
  cannotBeDoubled: boolean; // l'adversaire ne peut pas doubler cette unité
  counterAnyRange: boolean; // riposte quelle que soit la portée (Distant/Close Counter)
  preventFoeCounter: boolean; // l'adversaire ne peut pas riposter
  neutralizeFoeBonuses: boolean; // annule les bonus en combat de l'adversaire
  pierceFoeReduction: boolean; // annule la réduction de dégâts de l'adversaire
  dmgReductionPct: number; // % de réduction des dégâts SUBIS (0-100)
  flatDmgReduction: number; // réduction FIXE des dégâts subis (par coup)
  // Malus que CETTE unité inflige à son adversaire (Ploy, Chill, Menace, « inflige X »).
  foeAtk: number; foeSpd: number; foeDef: number; foeRes: number; // valeurs positives
  // Bonus de ZONE que cette unité accorde à ses alliés proches (Aubaine/Hone, Ralliement, Poussée…).
  fieldBuff: { atk: number; spd: number; def: number; res: number; range: number };
  special: SpecialInfo; // spéciale équipée (jauge simulée)
  vantage: boolean; // en défense : frappe en premier
};

export const NO_MODS: CombatMods = {
  brave: false, effAgainst: [], atkBuff: 0, spdBuff: 0, defBuff: 0, resBuff: 0,
  initBuff: { atk: 0, spd: 0, def: 0, res: 0 }, defendBuff: { atk: 0, spd: 0, def: 0, res: 0 },
  bonusDamage: 0, bonusDamageStat: { atk: 0, spd: 0, def: 0, res: 0, hp: 0 },
  guaranteedFollowup: false, noFollowup: false, cannotBeDoubled: false,
  counterAnyRange: false, preventFoeCounter: false, neutralizeFoeBonuses: false,
  pierceFoeReduction: false, dmgReductionPct: 0, flatDmgReduction: 0,
  foeAtk: 0, foeSpd: 0, foeDef: 0, foeRes: 0,
  fieldBuff: { atk: 0, spd: 0, def: 0, res: 0, range: 0 },
  special: { maxCd: 0, kind: 'none' }, vantage: false,
};

export type Unit = { hero: Hero; stats: Stats; mods: CombatMods };

// Les "types" d'une unité pour matcher l'efficacité (déplacement + arme + famille).
function unitTypes(u: Unit): string[] {
  const t: string[] = [];
  const mv = (u.hero.moveType || '').toLowerCase();
  if (/fly|vol/.test(mv)) t.push('flying');
  if (/armor|cuiras/.test(mv)) t.push('armored');
  if (/caval/.test(mv)) t.push('cavalry');
  if (/infan|fantass/.test(mv)) t.push('infantry');
  const w = u.hero.weaponType;
  if (w === 'Dragon') t.push('dragon');
  if (w === 'Beast') t.push('beast');
  if (w === 'Bow') t.push('bow');
  if (w === 'Tome') t.push('tome', 'magic');
  return t;
}

function isEffective(attacker: Unit, defender: Unit): boolean {
  if (!attacker.mods.effAgainst.length) return false;
  const dt = new Set(unitTypes(defender));
  return attacker.mods.effAgainst.some((e) => dt.has(e.toLowerCase().trim()));
}

export type HitResult = {
  dmg: number; hits: number; total: number;
  adv: 1 | 0 | -1; targetsRes: boolean; effective: boolean;
};

// Bonus/malus de stat effectifs d'une unité — annulés si l'adversaire neutralise
// les bonus (on ne retire alors que la partie POSITIVE, les malus restent).
function effMod(u: Unit, foe: Unit, k: 'atkBuff' | 'spdBuff' | 'defBuff' | 'resBuff'): number {
  const v = u.mods[k] || 0;
  return foe.mods.neutralizeFoeBonuses ? Math.min(0, v) : v;
}

// Dégâts d'UN coup (une frappe). `offense` = spéciale offensive déclenchée sur ce
// coup ; `defReducePct` = réduction de la spéciale DÉFENSIVE du défenseur si elle
// se déclenche sur ce coup. Renvoie aussi les méta pour l'affichage.
type StrikeMeta = { dmg: number; adv: 1 | 0 | -1; targetsRes: boolean; effective: boolean };
function strikeDamage(
  atk: Unit, def: Unit, offense: SpecialInfo | null, defReducePct: number,
): StrikeMeta {
  const adv = triangle(atk.hero.color, def.hero.color);
  let a = effStat(atk, def, 'atk');
  const mod = Math.trunc(a * 0.2);
  a = adv === 1 ? a + mod : adv === -1 ? a - mod : a;
  const effective = isEffective(atk, def);
  if (effective) a = Math.trunc(a * 1.5);
  const useRes = targetsRes(atk.hero.weaponType);
  let mit = Math.max(0, useRes ? effStat(def, atk, 'res') : effStat(def, atk, 'def'));
  if (offense?.defIgnorePct) mit = mit - Math.trunc(mit * offense.defIgnorePct / 100);
  let dmg = Math.max(0, a - mit);
  dmg += atk.mods.bonusDamage || 0; // dégâts fixes (ex. « = compteur × N »)
  dmg += statBonusDamage(atk, def); // dégâts = % d'une stat (toujours actifs)
  if (offense?.addStatPct) {
    dmg += Math.trunc(statVal(atk, def, offense.addStatPct.stat) * offense.addStatPct.pct / 100);
  }
  if (offense?.addDamagePct) dmg = Math.round(dmg * (1 + offense.addDamagePct / 100));
  const pierce = atk.mods.pierceFoeReduction;
  if (!pierce && def.mods.dmgReductionPct > 0) {
    dmg = Math.round(dmg * (1 - def.mods.dmgReductionPct / 100));
  }
  if (!pierce && defReducePct > 0) dmg = Math.round(dmg * (1 - defReducePct / 100)); // spéciale déf.
  if (!pierce && def.mods.flatDmgReduction > 0) dmg = dmg - def.mods.flatDmgReduction;
  return { dmg: Math.max(0, dmg), adv, targetsRes: useRes, effective };
}

// Stat effective d'une unité face à son adversaire : base + bonus (annulé si l'ennemi
// neutralise) − malus que l'ennemi lui inflige (Ploy/Chill/Menace/« inflige X »).
function effStat(u: Unit, foe: Unit, stat: 'atk' | 'spd' | 'def' | 'res'): number {
  const buff = effMod(u, foe, (stat + 'Buff') as 'atkBuff');
  const foeKey = ('foe' + stat[0].toUpperCase() + stat.slice(1)) as 'foeAtk';
  return u.stats[stat] + buff - (foe.mods[foeKey] || 0);
}

// Valeur effective d'une stat pour les dégâts « = % de la stat ».
function statVal(u: Unit, foe: Unit, stat: 'atk' | 'spd' | 'def' | 'res' | 'hp'): number {
  return stat === 'hp' ? u.stats.hp : effStat(u, foe, stat);
}

// Dégâts bonus = pourcentage d'une stat du porteur (toujours actifs, hors spéciale).
function statBonusDamage(atk: Unit, def: Unit): number {
  const p = atk.mods.bonusDamageStat;
  if (!p) return 0;
  const val = (v: number, pct: number) => (pct ? Math.trunc(v * pct / 100) : 0);
  return (
    val(effStat(atk, def, 'atk'), p.atk) +
    val(effStat(atk, def, 'spd'), p.spd) +
    val(effStat(atk, def, 'def'), p.def) +
    val(effStat(atk, def, 'res'), p.res) +
    val(atk.stats.hp, p.hp)
  );
}

// L'unité U double-t-elle V ? (VIT +5, ou garanti ; sauf empêchements).
function doubles(u: Unit, v: Unit): boolean {
  if (u.mods.noFollowup) return false;
  if (v.mods.cannotBeDoubled) return false;
  if (u.mods.guaranteedFollowup) return true;
  return effStat(u, v, 'spd') - effStat(v, u, 'spd') >= 5;
}

export function canCounter(attacker: Unit, defender: Unit): boolean {
  if (defender.hero.weaponType === 'Staff') return false;
  if (attacker.mods.preventFoeCounter) return false; // l'attaquant empêche la riposte
  if (defender.mods.counterAnyRange) return true; // Distant/Close Counter
  return isRanged(attacker.hero.weaponType) === isRanged(defender.hero.weaponType);
}

export type Sim = {
  atk: HitResult;
  defHpAfter: number;
  ko: boolean;
  counter: (HitResult & { atkHpAfter: number; atkKo: boolean }) | null;
  vantage: boolean; // le défenseur a riposté en premier
  chargeAfter: { atk: number; def: number }; // jauge de spéciale restante (pour la persistance)
};
// Jauges de départ (compteur courant de spéciale) transmises entre combats d'un tour.
export type StartCharges = { atk?: number; def?: number };

// État d'un combattant pendant l'échange (PV + jauge de spéciale).
type Fighter = {
  u: Unit;
  hp: number;
  spec: SpecialInfo | null;
  charge: number; // compteur courant (0 = prête). Infinity = pas de spéciale.
  dmgTotal: number;
  hitCount: number;
  first: StrikeMeta | null;
};
function mkFighter(u: Unit, startCharge?: number): Fighter {
  const s = u.mods.special && u.mods.special.kind !== 'none' && u.mods.special.maxCd > 0
    ? u.mods.special : null;
  const charge = s ? Math.max(0, Math.min(s.maxCd, startCharge ?? s.maxCd)) : Infinity;
  return { u, hp: u.stats.hp, spec: s, charge, dmgTotal: 0, hitCount: 0, first: null };
}

// Une frappe (ou 2 si Brave) de S vers R, en gérant la jauge de spéciale.
function doStrike(S: Fighter, R: Fighter) {
  const n = S.u.mods.brave ? 2 : 1;
  for (let i = 0; i < n; i++) {
    if (S.hp <= 0 || R.hp <= 0) return;
    // Spéciale OFFENSIVE de S : se déclenche si la jauge est à 0 au moment de frapper.
    let offense: SpecialInfo | null = null;
    if (S.spec && S.spec.kind === 'offense' && S.charge === 0) {
      offense = S.spec; S.charge = S.spec.maxCd;
    }
    // Spéciale DÉFENSIVE de R : réduit ce coup si sa jauge est à 0 quand il est touché.
    let defReduce = 0, defFired = false;
    if (R.spec && R.spec.kind === 'defense' && R.charge === 0) {
      defReduce = R.spec.reducePct || 0; defFired = true; R.charge = R.spec.maxCd;
    }
    const res = strikeDamage(S.u, R.u, offense, defReduce);
    R.hp -= res.dmg;
    S.dmgTotal += res.dmg; S.hitCount++;
    if (!S.first) S.first = res;
    // Charge : +1 pour S qui frappe, +1 pour R qui est touché (sauf si déclenchée à l'instant).
    if (!offense && S.spec) S.charge = Math.max(0, S.charge - 1);
    if (!defFired && R.spec) R.charge = Math.max(0, R.charge - 1);
  }
}

// Fusionne les bonus conditionnés par la phase dans les buffs de combat : l'attaquant
// (= initiateur) reçoit son initBuff, le défenseur son defendBuff.
function withRole(u: Unit, role: 'init' | 'defend'): Unit {
  const b = role === 'init' ? u.mods.initBuff : u.mods.defendBuff;
  if (!b || (!b.atk && !b.spd && !b.def && !b.res)) return u;
  return {
    ...u,
    mods: {
      ...u.mods,
      atkBuff: u.mods.atkBuff + b.atk, spdBuff: u.mods.spdBuff + b.spd,
      defBuff: u.mods.defBuff + b.def, resBuff: u.mods.resBuff + b.res,
    },
  };
}

// Échange complet, coup par coup (jauge de spéciale + Vantage + doublons).
// `start` = jauges de spéciale courantes (persistance d'un combat à l'autre).
export function simulate(rawAttacker: Unit, rawDefender: Unit, start?: StartCharges): Sim {
  const attacker = withRole(rawAttacker, 'init');   // l'attaquant initie → bonus « si initie »
  const defender = withRole(rawDefender, 'defend'); // le défenseur → bonus « si attaqué »
  const A = mkFighter(attacker, start?.atk);
  const D = mkFighter(defender, start?.def);
  const canCtr = canCounter(attacker, defender);
  const vantage = canCtr && defender.mods.vantage;
  const aDouble = doubles(attacker, defender);
  const dDouble = canCtr && doubles(defender, attacker);

  // Ordre des frappes : Vantage = le défenseur riposte en premier.
  const seq: [Fighter, Fighter][] = vantage
    ? [[D, A], [A, D], ...(aDouble ? [[A, D] as [Fighter, Fighter]] : []), ...(dDouble ? [[D, A] as [Fighter, Fighter]] : [])]
    : [[A, D], ...(canCtr ? [[D, A] as [Fighter, Fighter]] : []), ...(aDouble ? [[A, D] as [Fighter, Fighter]] : []), ...(dDouble ? [[D, A] as [Fighter, Fighter]] : [])];
  for (const [S, R] of seq) if (S.hp > 0 && R.hp > 0) doStrike(S, R);

  const toHit = (f: Fighter): HitResult => ({
    dmg: f.hitCount ? Math.round(f.dmgTotal / f.hitCount) : 0,
    hits: f.hitCount, total: f.dmgTotal,
    adv: f.first?.adv ?? 0, targetsRes: f.first?.targetsRes ?? false, effective: f.first?.effective ?? false,
  });
  const counter = D.hitCount > 0
    ? { ...toHit(D), atkHpAfter: Math.max(0, A.hp), atkKo: A.hp <= 0 }
    : null;
  const chargeAfter = {
    atk: A.spec ? A.charge : (start?.atk ?? 0),
    def: D.spec ? D.charge : (start?.def ?? 0),
  };
  return { atk: toHit(A), defHpAfter: Math.max(0, D.hp), ko: D.hp <= 0, counter, vantage, chargeAfter };
}

// Verdict synthétique pour la vue équipe.
export type Verdict = 'ko' | 'win' | 'trade' | 'lose';
export function verdictOf(sim: Sim): Verdict {
  if (sim.ko) return 'ko'; // tue la carte dans l'échange
  if (sim.counter?.atkKo) return 'lose'; // se fait tuer en retour
  if (sim.counter && sim.counter.total > 0) return 'trade'; // survit, l'ennemi aussi
  return 'win'; // survit sans (presque) rien prendre
}

// Verdict SUR DEUX PHASES : ta phase (tu inities) PUIS la phase ennemie (le boss
// t'attaque). Indispensable face à un boss : un corps-à-corps « gagne l'échange »
// en attaquant un mage à distance (pas de riposte), mais meurt quand le boss le
// frappe à la phase ennemie. On suppose que le boss t'attaque s'il n'est pas tué.
export type PhaseVerdict = { verdict: Verdict; player: Sim; foe: Sim | null };
export function combatVerdict(you: Unit, enemy: Unit): PhaseVerdict {
  const player = simulate(you, enemy); // tu inities (ta phase)
  if (player.ko) return { verdict: 'ko', player, foe: null }; // tu le tues, pas de phase ennemie
  if (player.counter?.atkKo) return { verdict: 'lose', player, foe: null }; // sa riposte te tue
  const foe = simulate(enemy, you); // le boss initie (phase ennemie)
  if (foe.ko) return { verdict: 'lose', player, foe }; // il te tue à sa phase
  if (foe.counter?.atkKo) return { verdict: 'ko', player, foe }; // tu le tues en ripostant
  const took = (player.counter?.total ?? 0) > 0 || foe.atk.total > 0;
  return { verdict: took ? 'trade' : 'win', player, foe };
}
