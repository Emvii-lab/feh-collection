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
  // Bonus conditionnés par la PHASE : n'appliquer que si le porteur INITIE le combat
  // (initBuff, ex. Fer mortel/Death Blow) ou seulement s'il DÉFEND (defendBuff, ex. Posture).
  initBuff: { atk: number; spd: number; def: number; res: number };
  defendBuff: { atk: number; spd: number; def: number; res: number };
  // Dégâts ajoutés à chaque coup.
  bonusDamage: number; // fixes (ex. « = compteur × N »)
  bonusDamageStat: { atk: number; spd: number; def: number; res: number; hp: number }; // % d'une stat
  // Réductions des dégâts subis (porteur en défense).
  dmgReductionPct: number; // en % (max, ne s'empile pas linéairement)
  reductionInit: number; // réduction % SI le porteur initie ; reductionDefend = SI attaqué
  reductionDefend: number;
  flatDmgReduction: number; // fixe (somme)
  // Contrôle de l'échange (porteur).
  brave: boolean;
  guaranteedFollowup: boolean; // le porteur double à coup sûr (inconditionnel)
  followupInit: boolean; // double garanti SI le porteur initie ; followupDefend = SI attaqué (Quick Riposte)
  followupDefend: boolean;
  cannotBeDoubled: boolean; // l'adversaire ne peut pas doubler le porteur
  noFollowup: boolean; // le porteur ne peut pas doubler
  counterAnyRange: boolean; // riposte quelle que soit la portée
  // Effets imposés à l'ADVERSAIRE (= ton unité quand l'ennemi porte le skill).
  preventFoeCounter: boolean; // l'adversaire ne peut pas riposter
  neutralizeFoeBonuses: boolean; // les bonus de l'adversaire sont annulés
  pierceFoeReduction: boolean; // annule la réduction de dégâts de l'adversaire
  foeAtk: number; foeSpd: number; foeDef: number; foeRes: number; // malus (valeurs positives)
  // Bonus de ZONE accordés aux alliés proches (Aubaine/Hone, Fortification, Poussée…).
  fieldBuff: { atk: number; spd: number; def: number; res: number; range: number };
  special: SpecialInfo; // spéciale équipée (jauge simulée coup par coup)
  // Effets spéciaux d'armes (Faux de Hel, Miracle, etc.)
  miracleNonMagic: boolean; // Hel: survit avec 1 PV si attaquant != magie/bâton et PV > 1
  miracle: boolean; // Miracle universel : survit avec 1 PV si PV > 1
  targetResNonMagic: boolean; // Hel: calcule les dégâts sur la Rés si adversaire != magie/bâton
  postCombatHeal: number; // PV soignés après combat (ex: 7 PV)
  // Après avoir attaqué, le porteur inflige « coupe-riposte » à la cible ET aux alliés de la
  // cible dans N cases jusqu'à leur prochaine action (ex. Frostbite Breath de Nifl) : ces
  // unités ne ripostent plus pendant le reste de la phase → un tank comme Hector encaisse 0.
  inflictNoCounterAoE: number; // rayon (0 = aucun)
  // Contre un adversaire à PORTÉE 2, les dégâts sont calculés sur la plus BASSE de Déf/Rés.
  targetLowerDefRes: boolean;
};

// Spéciale équipée : compteur + effet au déclenchement (offensive ou défensive).
export type SpecialInfo = {
  maxCd: number; // compteur EFFECTIF (avec accélération) — 0 = pas de spéciale modélisée
  kind: 'offense' | 'defense' | 'none';
  addStatPct?: { stat: StatKey | 'hp'; pct: number }; // +% d'une stat (Bonfire, Draconic Aura…)
  addDamagePct?: number; // +% des dégâts dealt (Glimmer/Astra)
  defIgnorePct?: number; // ignore % de la DÉF/RÉS de l'adversaire (Moonbow/Luna)
  reducePct?: number; // réduit les dégâts subis de % (défensive : Aegis, Ice Wall…)
};

const EMPTY = (): ParsedEffects => ({
  atkBuff: 0, spdBuff: 0, defBuff: 0, resBuff: 0,
  initBuff: { atk: 0, spd: 0, def: 0, res: 0 },
  defendBuff: { atk: 0, spd: 0, def: 0, res: 0 },
  bonusDamage: 0, bonusDamageStat: { atk: 0, spd: 0, def: 0, res: 0, hp: 0 },
  dmgReductionPct: 0, reductionInit: 0, reductionDefend: 0, flatDmgReduction: 0,
  brave: false, guaranteedFollowup: false, followupInit: false, followupDefend: false, cannotBeDoubled: false,
  noFollowup: false, counterAnyRange: false,
  preventFoeCounter: false, neutralizeFoeBonuses: false, pierceFoeReduction: false,
  foeAtk: 0, foeSpd: 0, foeDef: 0, foeRes: 0,
  fieldBuff: { atk: 0, spd: 0, def: 0, res: 0, range: 0 },
  special: { maxCd: 0, kind: 'none' },
  miracleNonMagic: false, miracle: false, targetResNonMagic: false, postCombatHeal: 0,
  inflictNoCounterAoE: 0, targetLowerDefRes: false,
});

// Enlève le HTML + les parenthèses d'EXEMPLE (qui contiennent des nombres illustratifs
// « (Example: … grants Atk+14 …) » à ne PAS lire comme de vrais bonus), déaccentue, minuscule.
// On ne retire QUE les exemples : les autres parenthèses (« (cooldown count-1) »,
// « (excluding area-of-effect Specials) ») restent, car elles servent à d'autres détections.
const clean = (s: string) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/\((?:example|exemple|e\.g\.|ex\.)[^)]*\)/gi, ' ')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

const STAT_KEY: Record<string, StatKey> = {
  atk: 'atk', atq: 'atk', spd: 'spd', vit: 'spd', def: 'def', res: 'res',
};
const STAT_RE = '(?:at[kq]|spd|vit|def|res)';
const CD = '(?:special cooldown|compteur[^.;]*?speciale)'; // « compteur (max) de spéciale »

const isBrave = (d: string) => /attacks?\s+twice|\bbrave\b/.test(d);

// --- Chaque pattern renseigne `out` à partir d'une description nettoyée. -----------

// Bonus de ZONE : « grants Atk/Spd+6 to allies within 2 spaces » / « to adjacent allies ».
const FIELD_RE = new RegExp(
  `(${STAT_RE}(?:/${STAT_RE})*)\\s*\\+\\s*(\\d+)\\s+to\\s+(?:unit and\\s+)?(?:adjacent allies|allies?\\s+within\\s+(\\d+))`, 'g');
function pFieldBuff(d: string, out: ParsedEffects) {
  FIELD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIELD_RE.exec(d))) {
    const n = +m[2];
    const range = m[3] ? +m[3] : 1; // « adjacent » = 1 case
    if (range > out.fieldBuff.range) out.fieldBuff.range = range;
    for (const s of m[1].split('/')) {
      const k = STAT_KEY[s]; if (k && n > out.fieldBuff[k]) out.fieldBuff[k] = n;
    }
  }
}

// Porte d'une clause conditionnelle : dit s'il faut l'APPLIQUER et à quelle PHASE.
// - `apply` : on évalue les seuils de PV à PV PLEINS (soi=ennemi=100 %, l'état de début
//   de combat / du 1er échange). Un « si PV ≤ 25 % » est donc FAUX → on n'applique pas
//   (corrige le sur-comptage de Brazen/Wrath à pleine vie) ; un « si PV ≥ 25 % » est VRAI.
// - `phase` : init (si le porteur initie) / defend (si attaqué) / always.
// PRUDENT : condition alternative (« … ou … ») → on applique en « always » (comportement
// historique, aucune régression). La condition = tout ce qui précède le verbe d'effet.
function clauseGate(clause: string): { apply: boolean; phase: 'init' | 'defend' | 'always' } {
  // On isole les SEGMENTS DE CONDITION (le texte introduit par « if/when/si »), qu'ils
  // précèdent ou suivent l'effet (« si X, accorde Y » comme « accorde Y si X »). Ça évite
  // qu'un « ou » présent dans l'EFFET (« 1re attaque ou riposte ») fausse la détection.
  const segs: string[] = [];
  const cre = /\b(?:if|when|si|s'ils?|s'il)\b\s+([^,.;]*)/g;
  let cm: RegExpExecArray | null;
  while ((cm = cre.exec(clause))) segs.push(cm[1]);
  const cond = segs.join(' ; ');
  if (!cond) return { apply: true, phase: 'always' }; // aucune condition → toujours actif
  if (/\bor\b|\bou\b/.test(cond)) return { apply: true, phase: 'always' };
  // Adjacence/soutien, hypothèse « formation » (les persos jouent groupés) : les bonus
  // « près d'un allié » sont supposés ACTIFS (comportement historique = always), mais les
  // bonus « SOLO » (si PAS adjacent / aucun allié à proximité) sont supposés INACTIFS → drop.
  if (/not adjacent to (?:an?|any) all|isn'?t adjacent to (?:an?|any) all|no all(?:y|ies) (?:are )?within|not within \d+ spaces? of (?:an? )?all|(?:pas|n'?est pas) adjacent[e]? (?:a|à) (?:un|des) allie|aucun allie/.test(cond))
    return { apply: false, phase: 'always' };
  // Seuils de PV, évalués à PV pleins (début de combat).
  const hpRe = /hp\s*(>=|≥|<=|≤|=|>|<)\s*(\d+)\s*%?/g;
  let hm: RegExpExecArray | null;
  while ((hm = hpRe.exec(cond))) {
    const cur = 100, thr = +hm[2], cmp = hm[1];
    const ok = cmp === '>=' || cmp === '≥' ? cur >= thr
      : cmp === '<=' || cmp === '≤' ? cur <= thr
        : cmp === '>' ? cur > thr : cmp === '<' ? cur < thr : cur === thr;
    if (!ok) return { apply: false, phase: 'always' };
  }
  const init = /(?:unit|l'?unite)\s+initiates?\s+combat|l'?unite\s+initie|s'?il\s+initie/.test(cond);
  const foeInit = /foe\s+initiates?\s+combat|ennemi\s+initie/.test(cond);
  const attacked = /unit\s+is\s+attacked|l'?unite\s+est\s+attaquee/.test(cond);
  const phase = init && !foeInit ? 'init' : (foeInit || attacked) ? 'defend' : 'always';
  return { apply: true, phase };
}

// P1. Bonus fixes « Atk/Res+6 » (porteur), routés par CLAUSE selon la phase (init/defend/
// toujours). Comme avant : MAX par stat dans UNE description (anti-double-compte), SOMMÉ
// entre compétences (via `out += …`). Chaque phase a son propre max intra-description.
function pFlatBuffs(d: string, out: ParsedEffects) {
  const mk = () => ({ atk: 0, spd: 0, def: 0, res: 0 });
  const always = mk(), init = mk(), defend = mk();
  const re = new RegExp(`(${STAT_RE}(?:/${STAT_RE})*)\\s*\\+\\s*(\\d+)`, 'g');
  for (const clause of d.split(/[.;]/)) {
    const g = clauseGate(clause);
    if (!g.apply) continue; // condition de PV non satisfaite à pleine vie → on n'applique pas
    const bucket = g.phase === 'init' ? init : g.phase === 'defend' ? defend : always;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clause))) {
      const n = +m[2];
      for (const s of m[1].split('/')) { const k = STAT_KEY[s]; if (k && n > bucket[k]) bucket[k] = n; }
    }
  }
  out.atkBuff += always.atk; out.spdBuff += always.spd; out.defBuff += always.def; out.resBuff += always.res;
  out.initBuff.atk += init.atk; out.initBuff.spd += init.spd; out.initBuff.def += init.def; out.initBuff.res += init.res;
  out.defendBuff.atk += defend.atk; out.defendBuff.spd += defend.spd; out.defendBuff.def += defend.def; out.defendBuff.res += defend.res;
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

// P6. Réduction en POURCENTAGE : « reduces damage ... by N% » (max), routée par phase.
// Garde-fous : (1) la réduction des spéciales À EFFET DE ZONE (AoE) ne s'applique PAS au
// combat normal (ex. Heroic Maltet « …de 80% ») → ignorée ; (2) « à hauteur de N% de la
// Déf » est une réduction liée à une STAT (fixe), pas un % de combat → exclue (lookahead).
function pPctReduction(d: string, out: ParsedEffects, phase: 'init' | 'defend' | 'always') {
  if (/effet de zone|area[- ]of[- ]effect|\baoe\b/.test(d)) return;
  const m =
    d.match(/reduces damage[^.;]*?by\s*(\d+)\s*%(?!\s*of)/) ||
    d.match(/reduit les degats[^.;]*?de\s*(\d+)\s*%(?!\s*de\s+l)/);
  if (!m) return;
  const n = +m[1];
  if (phase === 'init') out.reductionInit = Math.max(out.reductionInit, n);
  else if (phase === 'defend') out.reductionDefend = Math.max(out.reductionDefend, n);
  else out.dmgReductionPct = Math.max(out.dmgReductionPct, n);
}

// P7. Malus infligés à l'adversaire : « inflicts Atk/Res-4 on foe(s) » (Ploy, Chill,
// Menace/Threaten…). On accepte « on foe », « on foes », « on the foe », « on those foes ».
function pFoeDebuff(d: string, out: ParsedEffects) {
  const re = new RegExp(
    `(?:inflicts|inflige)\\s*(${STAT_RE}(?:/${STAT_RE})*)\\s*-\\s*(\\d+)\\s*(?:on\\s+(?:the\\s+|those\\s+)?foes?|(?:a|sur|aux?)\\s+l['e ]?(?:ennemi|adversaire)s?)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const n = +m[2];
    for (const s of m[1].split('/')) {
      const k = STAT_KEY[s];
      if (k) out[('foe' + k[0].toUpperCase() + k.slice(1)) as 'foeAtk'] += n;
    }
  }
}

// P8. Contrôle du doublon + riposte + neutralisations (drapeaux). Le DOUBLON GARANTI est
// routé par phase (Quick Riposte = uniquement si attaqué) ; les autres restent inconditionnels
// une fois la clause validée par la porte (phase/PV).
function pFlags(d: string, out: ParsedEffects, phase: 'init' | 'defend' | 'always') {
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
  if (/guaranteed follow-up|guarantees[^.;]*?unit'?s?[^.;]*?follow-up|double.{0,6}garanti|riposte suivie garantie/.test(d)) {
    if (phase === 'init') out.followupInit = true;
    else if (phase === 'defend') out.followupDefend = true;
    else out.guaranteedFollowup = true;
  }
  if (/(?:foe|foes) cannot[^.;]*?follow-up|prevents[^.;]*?foe'?s?[^.;]*?follow-up|adversaire ne peut pas[^.;]*?(?:doubler|riposte suivie)|empeche[^.;]*?riposte suivie[^.;]*?(?:ennemi|adversaire)/.test(d))
    out.cannotBeDoubled = true;
  if (/unit cannot[^.;]*?follow-up|ne peut pas (?:effectuer|faire)[^.;]*?riposte suivie/.test(d))
    out.noFollowup = true;
  // Miracle contre les non-magiciens (Faux de Hel, etc.)
  if (/does not use magic or staff[^.;]*?survives[^.;]*?1 hp|n'?utilise pas la magie ou un b[aâ]ton[^.;]*?survit[^.;]*?1 pv/i.test(d))
    out.miracleNonMagic = true;
  // Miracle inconditionnel
  if (/(?:unit'?s? hp > 1[^.;]*?)?survives (?:a lethal blow|with 1 hp|a fatal hit)|(?:pv[^.;]*?> 1[^.;]*?)?survit [aà] un coup mortel avec 1 pv/i.test(d))
    out.miracle = true;
  // Calcul des dégâts sur la Résistance contre les non-magiciens
  if (/does not use magic or staff[^.;]*?calculates damage using foe'?s? res|n'?utilise pas la magie ou un b[aâ]ton[^.;]*?d[ée]g[âa]ts sont calcul[ée]s avec sa r[ée]s/i.test(d))
    out.targetResNonMagic = true;
  // Soin après combat (ex: rend 7 PV à l'unité après le combat)
  const healM = d.match(/restores (\d+) hp to unit after combat|rend (\d+) pv [aà] l'?unit[ée] apr[eè]s le combat/i);
  if (healM) {
    out.postCombatHeal = Math.max(out.postCombatHeal, +(healM[1] || healM[2]));
  }
  // « coupe-riposte » infligé en zone après attaque (cible + alliés à N cases) — ex. Frostbite
  // Breath. Distinct de preventFoeCounter (qui vaut pour le combat du porteur lui-même).
  const ncM = d.match(/preventing counter-?attacks?[^.;]*?within (\d+) spaces?|emp[eê]ch(?:e|ant)[^.;]*?(?:contre-attaque|riposte)[^.;]*?(\d+) case/i);
  if (ncM) out.inflictNoCounterAoE = Math.max(out.inflictNoCounterAoE, +(ncM[1] || ncM[2]));
  else if (/(?:inflicts?|status)[^.;]*?preventing counter-?attacks?|inflige[^.;]*?(?:statut|malus)[^.;]*?coupe-riposte/i.test(d))
    out.inflictNoCounterAoE = Math.max(out.inflictNoCounterAoE, 1);
  // Dégâts calculés sur la plus basse de Déf/Rés (gaté sur la portée 2 côté combat).
  if (/calculates? damage using (?:the )?lower of foe'?s? def(?:ense)?\s*(?:or|\/)\s*res(?:istance)?|d[ée]g[âa]ts[^.;]*?calcul[ée]s? avec la (?:d[ée]f(?:ense)?|r[ée]s(?:istance)?)[^.;]*?la plus (?:basse|faible)/i.test(d))
    out.targetLowerDefRes = true;
}

// Compteur MAX de spéciale (base) = cooldown de la spéciale équipée (pour les formules).
function specialMaxCd(skills: SkillRow[]): number {
  let cd = 0;
  for (const s of skills)
    if ((s.scategory ?? '').toLowerCase() === 'special' && (s.cooldown ?? 0) > cd) cd = s.cooldown as number;
  return cd;
}

// Effet de la spéciale équipée (défensive prioritaire si elle réduit, sinon offensive).
function parseSpecial(row: SkillRow | null, accel: boolean): SpecialInfo {
  if (!row || !row.description || (row.cooldown ?? 0) <= 0) return { maxCd: 0, kind: 'none' };
  const maxCd = Math.max(1, (row.cooldown as number) - (accel ? 1 : 0)); // accélération (Slaying…)
  const d = clean(row.description);
  const red = d.match(/reduces damage[^.;]*?by\s*(\d+)\s*%/) || d.match(/reduit les degats[^.;]*?de\s*(\d+)\s*%/);
  if (red) return { maxCd, kind: 'defense', reducePct: +red[1] };
  const ign = d.match(/foe'?s?\s*def(?:ense)?(?:\/res(?:istance)?| or res)?[^.;]*?reduced[^.;]*?by\s*(\d+)\s*%/)
    || d.match(/(?:des?|de la)\s*(?:def|res)[^.;]*?reduite?[^.;]*?de\s*(\d+)\s*%/);
  if (ign) return { maxCd, kind: 'offense', defIgnorePct: +ign[1] };
  const st = d.match(/(?:boosts?|adds?|grants?) damage[^.;]*?by\s*(\d+)\s*%\s*of\s*(?:unit'?s?\s*)?(atk|spd|def|res|hp)/)
    // FR : « dégâts +N% de la Vit » OU « augmente les dégâts à hauteur de N% de l'Atq » (Aura draconique…)
    || d.match(/degats[^.;]*?(?:\+|hauteur de)\s*(\d+)\s*%\s*(?:de\s*l['’]?|des?|de la|du)\s*(atq|vit|def|res|pv)/);
  if (st) {
    const raw = st[2];
    const stat = raw === 'hp' || raw === 'pv' ? 'hp' : STAT_KEY[raw];
    if (stat) return { maxCd, kind: 'offense', addStatPct: { stat, pct: +st[1] } };
  }
  const dd = d.match(/boosts? damage(?: dealt)? by\s*(\d+)\s*%(?!\s*of)/);
  if (dd) return { maxCd, kind: 'offense', addDamagePct: +dd[1] };
  return { maxCd, kind: 'none' }; // spéciale à effet non modélisé (soin, etc.)
}

const ACCEL_RE = /accelerates special|cooldown count\s*-\s*1|\bslaying\b|time'?s pulse|compteur\s*-\s*1|accelere[^.;]*?special/i;

// Combine les effets de toute une panoplie de compétences.
export function parseSkillEffects(skills: SkillRow[]): ParsedEffects {
  const out = EMPTY();
  const cd = specialMaxCd(skills); // base, pour les formules « = compteur × N »
  const specialRow = skills.find((s) => (s.scategory ?? '').toLowerCase() === 'special') ?? null;
  const accel = skills.some((s) => s.description && ACCEL_RE.test(s.description));
  out.special = parseSpecial(specialRow, accel);
  for (const s of skills) {
    if (!s.description) continue;
    // La description de la SPÉCIALE est gérée par le modèle de jauge (parseSpecial),
    // pas en réduction/dégâts « toujours actifs » → on ne la relit pas ici (anti-doublon).
    if ((s.scategory ?? '').toLowerCase() === 'special') continue;
    const d = clean(s.description);
    pFieldBuff(d, out); // bonus de zone aux alliés (capté à part)
    // pour les bonus « self », on retire les clauses « … to allies within N » (anti-doublon).
    const base = d.replace(new RegExp(FIELD_RE.source, 'g'), ' ');
    pFlatBuffs(base, out); // bonus de stat : gère lui-même clauses + porte + phase
    // Les autres effets, clause par clause, avec la PORTE (phase + seuils de PV) : une clause
    // dont la condition de PV échoue à pleine vie n'est PAS appliquée ; la réduction et le
    // doublon garanti sont routés selon la phase (init/defend).
    for (const clause of base.split(/[.;]/)) {
      const g = clauseGate(clause);
      if (!g.apply) continue;
      pSpecialScaledBuff(clause, cd, out);
      pSpecialScaledDamage(clause, cd, out);
      pStatScaledDamage(clause, out);
      pSpecialScaledReduction(clause, cd, out);
      pPctReduction(clause, out, g.phase);
      pFoeDebuff(clause, out);
      pFlags(clause, out, g.phase);
    }
    if (isBrave(d)) out.brave = true;
  }
  return out;
}
