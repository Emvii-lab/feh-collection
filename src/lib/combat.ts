// Moteur de combat FEH — couvre le cœur des règles + modificateurs (auto ou saisis).
// Stats : viennent de la collection (tes persos) ou d'une saisie (carte ennemie) —
// jamais dupliquées dans la base. Effets : lus depuis feh.skills (efficacité, Brave)
// ou renseignés à la main (bonus en combat, doublon, réduction, vantage).
import type { Color, Hero, Stats, WeaponType } from '../types';
import type { CollStats } from './collection';

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
  vantage: boolean; // en défense : frappe en premier
};

export const NO_MODS: CombatMods = {
  brave: false, effAgainst: [], atkBuff: 0, spdBuff: 0, defBuff: 0, resBuff: 0,
  bonusDamage: 0, bonusDamageStat: { atk: 0, spd: 0, def: 0, res: 0, hp: 0 },
  guaranteedFollowup: false, noFollowup: false, cannotBeDoubled: false,
  counterAnyRange: false, preventFoeCounter: false, neutralizeFoeBonuses: false,
  pierceFoeReduction: false, dmgReductionPct: 0, flatDmgReduction: 0, vantage: false,
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

export function computeHit(atk: Unit, def: Unit): HitResult {
  const adv = triangle(atk.hero.color, def.hero.color);
  let a = atk.stats.atk + effMod(atk, def, 'atkBuff');
  const mod = Math.trunc(a * 0.2);
  a = adv === 1 ? a + mod : adv === -1 ? a - mod : a;
  const effective = isEffective(atk, def);
  if (effective) a = Math.trunc(a * 1.5);
  const useRes = targetsRes(atk.hero.weaponType);
  const mit = useRes
    ? def.stats.res + effMod(def, atk, 'resBuff')
    : def.stats.def + effMod(def, atk, 'defBuff');
  let dmg = Math.max(0, a - mit);
  dmg += atk.mods.bonusDamage || 0; // dégâts fixes ajoutés (ex. « = compteur × N »)
  dmg += statBonusDamage(atk, def); // dégâts = % d'une stat
  const pierce = atk.mods.pierceFoeReduction;
  if (!pierce && def.mods.dmgReductionPct > 0) {
    dmg = Math.max(0, Math.round(dmg * (1 - def.mods.dmgReductionPct / 100)));
  }
  if (!pierce && def.mods.flatDmgReduction > 0) {
    dmg = Math.max(0, dmg - def.mods.flatDmgReduction); // réduction FIXE après le %
  }
  // Doublon : garanti, ou VIT (avec bonus) ≥ +5, sauf "noFollowup" / "cannotBeDoubled".
  const spdOk =
    (atk.stats.spd + effMod(atk, def, 'spdBuff')) -
      (def.stats.spd + effMod(def, atk, 'spdBuff')) >=
    5;
  const canDouble =
    !atk.mods.noFollowup && !def.mods.cannotBeDoubled &&
    (atk.mods.guaranteedFollowup || spdOk);
  const hits = (canDouble ? 2 : 1) * (atk.mods.brave ? 2 : 1);
  return { dmg, hits, total: dmg * hits, adv, targetsRes: useRes, effective };
}

// Dégâts bonus = pourcentage d'une stat du porteur (Spd/Def/Res/Atk/HP).
function statBonusDamage(atk: Unit, def: Unit): number {
  const p = atk.mods.bonusDamageStat;
  if (!p) return 0;
  const val = (base: number, buff: number, pct: number) =>
    pct ? Math.trunc((base + buff) * pct / 100) : 0;
  return (
    val(atk.stats.atk, effMod(atk, def, 'atkBuff'), p.atk) +
    val(atk.stats.spd, effMod(atk, def, 'spdBuff'), p.spd) +
    val(atk.stats.def, effMod(atk, def, 'defBuff'), p.def) +
    val(atk.stats.res, effMod(atk, def, 'resBuff'), p.res) +
    val(atk.stats.hp, 0, p.hp)
  );
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
};

// Échange : gestion du Vantage (le défenseur frappe en premier s'il peut contrer).
export function simulate(attacker: Unit, defender: Unit): Sim {
  const counters = canCounter(attacker, defender);
  const vantage = counters && defender.mods.vantage;

  if (vantage) {
    // Le défenseur frappe d'abord.
    const c = computeHit(defender, attacker);
    const atkHp = attacker.stats.hp - c.total;
    if (atkHp <= 0) {
      // L'attaquant tombe avant d'agir.
      return {
        atk: { dmg: 0, hits: 0, total: 0, adv: 0, targetsRes: false, effective: false },
        defHpAfter: defender.stats.hp, ko: false,
        counter: { ...c, atkHpAfter: 0, atkKo: true }, vantage: true,
      };
    }
    const a = computeHit(attacker, defender);
    return {
      atk: a, defHpAfter: Math.max(0, defender.stats.hp - a.total),
      ko: defender.stats.hp - a.total <= 0,
      counter: { ...c, atkHpAfter: Math.max(0, atkHp), atkKo: false },
      vantage: true,
    };
  }

  // Cas normal : l'attaquant initie.
  const a = computeHit(attacker, defender);
  const defHp = defender.stats.hp - a.total;
  const ko = defHp <= 0;
  let counter: Sim['counter'] = null;
  if (!ko && counters) {
    const c = computeHit(defender, attacker);
    const atkHp = attacker.stats.hp - c.total;
    counter = { ...c, atkHpAfter: Math.max(0, atkHp), atkKo: atkHp <= 0 };
  }
  return { atk: a, defHpAfter: Math.max(0, defHp), ko, counter, vantage: false };
}

// Verdict synthétique pour la vue équipe.
export type Verdict = 'ko' | 'win' | 'trade' | 'lose';
export function verdictOf(sim: Sim): Verdict {
  if (sim.ko) return 'ko'; // tue la carte dans l'échange
  if (sim.counter?.atkKo) return 'lose'; // se fait tuer en retour
  if (sim.counter && sim.counter.total > 0) return 'trade'; // survit, l'ennemi aussi
  return 'win'; // survit sans (presque) rien prendre
}
