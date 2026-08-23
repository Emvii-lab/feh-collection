// Moteur d'effets de compétences — extensible, pattern par pattern.
// On lit les descriptions de feh.skills (EN + FR mélangés) et on en tire des
// modificateurs de combat. Aucune donnée n'est stockée. Chaque effet est une
// fonction isolée : on en ajoute sans casser les autres.

export type SkillRow = {
  description: string | null;
  scategory: string | null;
  cooldown: number | null;
};

type StatKey = 'atk' | 'spd' | 'def' | 'res';

export type ParsedEffects = {
  // Bonus « en combat » du porteur (on SOMME, ils s'empilent en combat).
  atkBuff: number; spdBuff: number; defBuff: number; resBuff: number;
  // Dégâts ajoutés à chaque coup.
  bonusDamage: number; // fixes (ex. « = compteur × N »)
  bonusDamageStat: { atk: number; spd: number; def: number; res: number; hp: number }; // % d'une stat
  // Réductions des dégâts subis (porteur en défense).
  dmgReductionPct: number; // en % (max, ne s'empile pas linéairement)
  flatDmgReduction: number; // fixe (somme)
  // Contrôle de l'échange (porteur).
  brave: boolean;
  guaranteedFollowup: boolean; // le porteur double à coup sûr
  cannotBeDoubled: boolean; // l'adversaire ne peut pas doubler le porteur
  noFollowup: boolean; // le porteur ne peut pas doubler
  counterAnyRange: boolean; // riposte quelle que soit la portée
  // Effets imposés à l'ADVERSAIRE (= ton unité quand l'ennemi porte le skill).
  preventFoeCounter: boolean; // l'adversaire ne peut pas riposter
  neutralizeFoeBonuses: boolean; // les bonus de l'adversaire sont annulés
  pierceFoeReduction: boolean; // annule la réduction de dégâts de l'adversaire
  foeAtk: number; foeSpd: number; foeDef: number; foeRes: number; // malus (valeurs positives)
};

const EMPTY = (): ParsedEffects => ({
  atkBuff: 0, spdBuff: 0, defBuff: 0, resBuff: 0,
  bonusDamage: 0, bonusDamageStat: { atk: 0, spd: 0, def: 0, res: 0, hp: 0 },
  dmgReductionPct: 0, flatDmgReduction: 0,
  brave: false, guaranteedFollowup: false, cannotBeDoubled: false,
  noFollowup: false, counterAnyRange: false,
  preventFoeCounter: false, neutralizeFoeBonuses: false, pierceFoeReduction: false,
  foeAtk: 0, foeSpd: 0, foeDef: 0, foeRes: 0,
});

// Enlève les accents pour un matching FR/EN uniforme, nettoie le HTML, minuscule.
const clean = (s: string) =>
  s.replace(/<[^>]*>/g, ' ').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

const STAT_KEY: Record<string, StatKey> = {
  atk: 'atk', atq: 'atk', spd: 'spd', vit: 'spd', def: 'def', res: 'res',
};
const STAT_RE = '(?:at[kq]|spd|vit|def|res)';
const CD = '(?:special cooldown|compteur[^.;]*?speciale)'; // « compteur (max) de spéciale »

const isBrave = (d: string) => /attacks?\s+twice|\bbrave\b/.test(d);

// --- Chaque pattern renseigne `out` à partir d'une description nettoyée. -----------

// P1. Bonus fixes « Atk/Res+6 » (porteur). Max par stat dans UNE description, sommé dehors.
function pFlatBuffs(d: string, out: ParsedEffects) {
  const local = { atk: 0, spd: 0, def: 0, res: 0 };
  const re = new RegExp(`(${STAT_RE}(?:/${STAT_RE})*)\\s*\\+\\s*(\\d+)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const n = +m[2];
    for (const s of m[1].split('/')) { const k = STAT_KEY[s]; if (k && n > local[k]) local[k] = n; }
  }
  out.atkBuff += local.atk; out.spdBuff += local.spd;
  out.defBuff += local.def; out.resBuff += local.res;
}

// P2. Bonus lié au compteur de spéciale : « Atk/Res = ... compteur ... + N ».
function pSpecialScaledBuff(d: string, cd: number, out: ParsedEffects) {
  if (!cd) return;
  const re = new RegExp(`(${STAT_RE}(?:/${STAT_RE})*)\\s*=\\s*[^.;]*?${CD}[^.;+]*?\\+\\s*(\\d+)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const val = cd + +m[2];
    for (const s of m[1].split('/')) {
      const k = STAT_KEY[s]; if (k) out[(k + 'Buff') as 'atkBuff'] += val;
    }
  }
}

// P3. Dégâts bonus liés au compteur : « deals damage = ... compteur ... × N ».
function pSpecialScaledDamage(d: string, cd: number, out: ParsedEffects) {
  if (!cd) return;
  const re = new RegExp(`(?:deals damage|inflige[^.;]*?degats)\\s*=\\s*[^.;]*?${CD}[^.;]*?[x×*]\\s*(\\d+)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.bonusDamage += cd * +m[1];
}

// P4. Dégâts bonus = % d'une stat : « deals damage = 20% of unit's Spd ».
function pStatScaledDamage(d: string, out: ParsedEffects) {
  const re =
    /(?:deals damage|adds? damage|inflige[^.;]*?degats)\s*=\s*(\d+)\s*%\s*of\s*(?:unit'?s?\s*)?(atk|spd|def|res|hp)|=\s*(\d+)\s*%\s*(?:des?|de la)\s*(atq|vit|def|res|pv)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const pct = +(m[1] ?? m[3]);
    const raw = (m[2] ?? m[4]) as string;
    const stat = raw === 'hp' || raw === 'pv' ? 'hp' : STAT_KEY[raw];
    if (stat && pct) out.bonusDamageStat[stat] += pct;
  }
}

// P5. Réduction FIXE liée au compteur : « reduces damage ... compteur ... × N ».
function pSpecialScaledReduction(d: string, cd: number, out: ParsedEffects) {
  if (!cd) return;
  const re = new RegExp(`(?:reduces damage|reduit les degats)[^.;]*?${CD}[^.;]*?[x×*]\\s*(\\d+)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.flatDmgReduction += cd * +m[1];
}

// P6. Réduction en POURCENTAGE : « reduces damage ... by N% » (max).
function pPctReduction(d: string, out: ParsedEffects) {
  const m =
    d.match(/reduces damage[^.;]*?by\s*(\d+)\s*%/) ||
    d.match(/reduit les degats[^.;]*?de\s*(\d+)\s*%/);
  if (m) out.dmgReductionPct = Math.max(out.dmgReductionPct, +m[1]);
}

// P7. Malus infligés à l'adversaire : « inflicts Atk/Res-4 on foe » (somme).
function pFoeDebuff(d: string, out: ParsedEffects) {
  const re = new RegExp(
    `(?:inflicts|inflige)\\s*(${STAT_RE}(?:/${STAT_RE})*)\\s*-\\s*(\\d+)\\s*(?:on foe|a l'ennemi|sur l'ennemi)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const n = +m[2];
    for (const s of m[1].split('/')) {
      const k = STAT_KEY[s];
      if (k) out[('foe' + k[0].toUpperCase() + k.slice(1)) as 'foeAtk'] += n;
    }
  }
}

// P8. Contrôle du doublon + riposte + neutralisations (drapeaux).
function pFlags(d: string, out: ParsedEffects) {
  if (/foe cannot counterattack|ennemi ne peut pas (?:riposter|contre-attaquer)|adversaire ne peut pas (?:riposter|contre-attaquer)/.test(d))
    out.preventFoeCounter = true;
  if (/counterattacks?\s+regardless of[^.;]*range|distant counter|close counter|riposte[^.;]*?quelle que soit[^.;]*?(?:distance|portee)/.test(d))
    out.counterAnyRange = true;
  if (/neutralizes[^.;,]*?foe'?s?[^.;,]*?bonus|neutralise[^.;,]*?bonus[^.;,]*?(?:ennemi|adversaire)/.test(d))
    out.neutralizeFoeBonuses = true;
  // Perce-réduction : « neutralizes … "reduce damage" effects ». On interdit la virgule
  // pour ne pas relier « neutralizes unit's penalties, … reduces damage » (= SA propre réduc).
  if (/neutralizes[^.;,]*?reduce[sd]? damage|neutralise[^.;,]*?reduction[^.;,]*?degats/.test(d))
    out.pierceFoeReduction = true;
  if (/guaranteed follow-up|guarantees[^.;]*?unit'?s?[^.;]*?follow-up|double.{0,6}garanti|riposte suivie garantie/.test(d))
    out.guaranteedFollowup = true;
  if (/(?:foe|foes) cannot[^.;]*?follow-up|prevents[^.;]*?foe'?s?[^.;]*?follow-up|adversaire ne peut pas[^.;]*?(?:doubler|riposte suivie)|empeche[^.;]*?riposte suivie[^.;]*?(?:ennemi|adversaire)/.test(d))
    out.cannotBeDoubled = true;
  if (/unit cannot[^.;]*?follow-up|ne peut pas (?:effectuer|faire)[^.;]*?riposte suivie/.test(d))
    out.noFollowup = true;
}

// Compteur MAX de spéciale = cooldown de base de la spéciale équipée.
function specialMaxCd(skills: SkillRow[]): number {
  let cd = 0;
  for (const s of skills)
    if ((s.scategory ?? '').toLowerCase() === 'special' && (s.cooldown ?? 0) > cd) cd = s.cooldown as number;
  return cd;
}

// Combine les effets de toute une panoplie de compétences.
export function parseSkillEffects(skills: SkillRow[]): ParsedEffects {
  const out = EMPTY();
  const cd = specialMaxCd(skills);
  for (const s of skills) {
    if (!s.description) continue;
    const d = clean(s.description);
    pFlatBuffs(d, out);
    pSpecialScaledBuff(d, cd, out);
    pSpecialScaledDamage(d, cd, out);
    pStatScaledDamage(d, out);
    pSpecialScaledReduction(d, cd, out);
    pPctReduction(d, out);
    pFoeDebuff(d, out);
    pFlags(d, out);
    if (isBrave(d)) out.brave = true;
  }
  return out;
}
