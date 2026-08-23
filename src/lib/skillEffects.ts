// Moteur d'effets de compétences — extensible, pattern par pattern.
// On lit les descriptions de feh.skills (EN + FR mélangés) et on en tire des
// modificateurs de combat. Aucune donnée n'est stockée. Chaque pattern est isolé
// pour pouvoir en ajouter de nouveaux sans casser les précédents.

export type SkillRow = {
  description: string | null;
  scategory: string | null;
  cooldown: number | null;
};

export type ParsedEffects = {
  // Bonus « en combat » de l'unité qui porte les compétences (on SOMME, elles s'empilent).
  atkBuff: number; spdBuff: number; defBuff: number; resBuff: number;
  bonusDamage: number; // dégâts fixes ajoutés à chaque coup (somme)
  flatDmgReduction: number; // réduction FIXE des dégâts subis (somme)
  dmgReductionPct: number; // % de réduction (on prend le max, ils ne s'empilent pas linéairement)
  brave: boolean;
  guaranteedFollowup: boolean;
  // Malus infligés à l'ADVERSAIRE (= ton unité quand l'ennemi porte le skill). Valeurs positives.
  foeAtk: number; foeSpd: number; foeDef: number; foeRes: number;
};

const EMPTY = (): ParsedEffects => ({
  atkBuff: 0, spdBuff: 0, defBuff: 0, resBuff: 0,
  bonusDamage: 0, flatDmgReduction: 0, dmgReductionPct: 0,
  brave: false, guaranteedFollowup: false,
  foeAtk: 0, foeSpd: 0, foeDef: 0, foeRes: 0,
});

// Enlève les accents (é→e, ×/x conservés) pour un matching FR/EN uniforme.
const deacc = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
// Nettoie le HTML des descriptions du wiki.
const clean = (s: string) => deacc(s.replace(/<[^>]*>/g, ' ')).toLowerCase();

const STAT_KEY: Record<string, 'atk' | 'spd' | 'def' | 'res'> = {
  atk: 'atk', atq: 'atk', spd: 'spd', vit: 'spd', def: 'def', res: 'res',
};
const STAT_RE = '(?:at[kq]|spd|vit|def|res)';

const isBrave = (d: string) => /attacks?\s+twice|\bbrave\b/.test(d);
const isGuaranteedFollowup = (d: string) =>
  /guaranteed follow-up|double.{0,4}garanti|deuxieme fois garanti/.test(d);

// --- Chaque pattern renseigne `out` à partir d'une description nettoyée. -----------

// P1. Bonus fixes « Atk/Res+6 » (self). Max par stat DANS une description, puis sommé dehors.
function pFlatBuffs(d: string, out: ParsedEffects) {
  const local = { atk: 0, spd: 0, def: 0, res: 0 };
  const re = new RegExp(`(${STAT_RE}(?:/${STAT_RE})*)\\s*\\+\\s*(\\d+)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const n = +m[2];
    for (const s of m[1].split('/')) {
      const k = STAT_KEY[s]; if (k && n > local[k]) local[k] = n;
    }
  }
  out.atkBuff += local.atk; out.spdBuff += local.spd;
  out.defBuff += local.def; out.resBuff += local.res;
}

// P2. Bonus lié au compteur de spéciale : « Atk/Res = ... special cooldown ... + N ».
function pSpecialScaledBuff(d: string, cd: number, out: ParsedEffects) {
  if (!cd) return;
  const re = new RegExp(
    `(${STAT_RE}(?:/${STAT_RE})*)\\s*=\\s*[^.;]*?(?:special cooldown|compteur[^.;]*?speciale)[^.;+]*?\\+\\s*(\\d+)`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const val = cd + +m[2];
    for (const s of m[1].split('/')) {
      const k = STAT_KEY[s];
      if (k) { const key = (k + 'Buff') as 'atkBuff'; out[key] += val; }
    }
  }
}

// P3. Dégâts bonus liés au compteur : « deals damage = ... special cooldown ... × N ».
function pSpecialScaledDamage(d: string, cd: number, out: ParsedEffects) {
  if (!cd) return;
  const re =
    /(?:deals damage|inflige[^.;]*?degats)\s*=\s*[^.;]*?(?:special cooldown|compteur[^.;]*?speciale)[^.;]*?[x×*]\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.bonusDamage += cd * +m[1];
}

// P4. Réduction FIXE liée au compteur : « reduces damage ... special cooldown ... × N ».
function pSpecialScaledReduction(d: string, cd: number, out: ParsedEffects) {
  if (!cd) return;
  const re =
    /(?:reduces damage|reduit les degats)[^.;]*?(?:special cooldown|compteur[^.;]*?speciale)[^.;]*?[x×*]\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.flatDmgReduction += cd * +m[1];
}

// P5. Réduction en POURCENTAGE : « reduces damage ... by N% » (max, ne s'empile pas).
function pPctReduction(d: string, out: ParsedEffects) {
  const m =
    d.match(/reduces damage[^.;]*?by\s*(\d+)\s*%/) ||
    d.match(/reduit les degats[^.;]*?de\s*(\d+)\s*%/);
  if (m) out.dmgReductionPct = Math.max(out.dmgReductionPct, +m[1]);
}

// P6. Malus infligés à l'adversaire : « inflicts Atk/Res-4 on foe » (somme).
function pFoeDebuff(d: string, out: ParsedEffects) {
  const re = new RegExp(
    `(?:inflicts|inflige)\\s*(${STAT_RE}(?:/${STAT_RE})*)\\s*-\\s*(\\d+)\\s*(?:on foe|a l'ennemi|sur l'ennemi)`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const n = +m[2];
    for (const s of m[1].split('/')) {
      const k = STAT_KEY[s];
      if (k) { const key = ('foe' + k[0].toUpperCase() + k.slice(1)) as 'foeAtk'; out[key] += n; }
    }
  }
}

// Compteur MAX de spéciale de la panoplie = cooldown de base de la spéciale équipée.
function specialMaxCd(skills: SkillRow[]): number {
  let cd = 0;
  for (const s of skills) {
    if ((s.scategory ?? '').toLowerCase() === 'special' && (s.cooldown ?? 0) > cd) {
      cd = s.cooldown as number;
    }
  }
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
    pSpecialScaledReduction(d, cd, out);
    pPctReduction(d, out);
    pFoeDebuff(d, out);
    if (isBrave(d)) out.brave = true;
    if (isGuaranteedFollowup(d)) out.guaranteedFollowup = true;
  }
  return out;
}
