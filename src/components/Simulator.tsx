import { useEffect, useMemo, useRef, useState } from 'react';
import type { Color, Hero, WeaponType } from '../types';
import type { CollStats } from '../lib/collection';
import {
  resolveStats, combatVerdict,
  NO_MODS, type Sim, type Unit, type Verdict, type CombatMods,
} from '../lib/combat';
import { type SolveResult } from '../lib/solver';
import type { SolverResponse } from '../lib/solverWorker';
import type { Board, BattleUnit } from '../lib/battle';
import type { SearchResult, SearchUnit } from '../lib/teamSearch';
import { fetchTeamWeapons, fetchEnemyCombat, EMPTY_EFFECTS, type WeaponInfo, type EnemyCombat } from '../lib/simWeapons';
import type { SpecialInfo } from '../lib/skillEffects';
import {
  fetchWikiMap, parsePageTitle, resolveEnemy,
  type WikiEnemy, type WikiMap,
} from '../lib/wikiMap';
import {
  reachable, attackFrom, threatZone, moveAllowance, weaponRange, moveClass,
  type Terrain, type TerrainMap,
} from '../lib/tactics';
import { MAP_TERRAIN } from '../data/mapTerrain';

// Persistance légère (équipe + carte ennemie) entre les ouvertures / rechargements.
const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, val: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* quota/private mode : on ignore */
  }
};

type StatKey = 'hp' | 'atk' | 'spd' | 'def' | 'res';
const STAT_ROW: { key: StatKey; label: string }[] = [
  { key: 'hp', label: 'PV' }, { key: 'atk', label: 'ATQ' }, { key: 'spd', label: 'VIT' },
  { key: 'def', label: 'DÉF' }, { key: 'res', label: 'RÉS' },
];
const COLORS: { v: Color; label: string }[] = [
  { v: 'red', label: 'Rouge' }, { v: 'blue', label: 'Bleu' },
  { v: 'green', label: 'Vert' }, { v: 'colorless', label: 'Incolore' },
];
const WEAPONS: WeaponType[] = ['Sword', 'Lance', 'Axe', 'Tome', 'Bow', 'Dagger', 'Staff', 'Dragon', 'Beast'];
const MOVES = ['Infantry', 'Cavalry', 'Flying', 'Armored'] as const;
const EFF = ['flying', 'armored', 'cavalry', 'infantry', 'dragon', 'beast'] as const;
const EFF_LABEL: Record<string, string> = {
  flying: 'Volant', armored: 'Cuirassé', cavalry: 'Cavalier',
  infantry: 'Fantassin', dragon: 'Dragon', beast: 'Bête',
};
const NO_WI: WeaponInfo = { effAgainst: [], effects: EMPTY_EFFECTS() };

// Extrait les effets auto-parsés (ParsedEffects) vers les champs de l'ennemi.
const pickEffects = (c: EnemyCombat) => ({
  atkBuff: c.atkBuff, spdBuff: c.spdBuff, defBuff: c.defBuff, resBuff: c.resBuff,
  bonusDamage: c.bonusDamage, bonusDamageStat: c.bonusDamageStat,
  dmgReductionPct: c.dmgReductionPct, flatDmgReduction: c.flatDmgReduction,
  brave: c.brave, guaranteedFollowup: c.guaranteedFollowup, cannotBeDoubled: c.cannotBeDoubled,
  noFollowup: c.noFollowup, counterAnyRange: c.counterAnyRange,
  preventFoeCounter: c.preventFoeCounter, neutralizeFoeBonuses: c.neutralizeFoeBonuses,
  pierceFoeReduction: c.pierceFoeReduction,
  foeAtk: c.foeAtk, foeSpd: c.foeSpd, foeDef: c.foeDef, foeRes: c.foeRes,
  special: c.special,
});
const ZERO_EFFECTS = pickEffects(EMPTY_EFFECTS());

// Effets parsés → modificateurs de combat (pour construire le plateau du solveur).
function toMods(e: EnemyCombat, effAgainst: string[]): CombatMods {
  return {
    ...NO_MODS, brave: e.brave, effAgainst,
    atkBuff: e.atkBuff, spdBuff: e.spdBuff, defBuff: e.defBuff, resBuff: e.resBuff,
    bonusDamage: e.bonusDamage, bonusDamageStat: e.bonusDamageStat,
    guaranteedFollowup: e.guaranteedFollowup, cannotBeDoubled: e.cannotBeDoubled, noFollowup: e.noFollowup,
    counterAnyRange: e.counterAnyRange, preventFoeCounter: e.preventFoeCounter,
    neutralizeFoeBonuses: e.neutralizeFoeBonuses, pierceFoeReduction: e.pierceFoeReduction,
    dmgReductionPct: e.dmgReductionPct, flatDmgReduction: e.flatDmgReduction,
    foeAtk: e.foeAtk, foeSpd: e.foeSpd, foeDef: e.foeDef, foeRes: e.foeRes, special: e.special,
  };
}

type EnemyState = {
  color: Color; weapon: WeaponType; move: string;
  stats: Record<StatKey, string>;
  brave: boolean; effAgainst: string[];
  atkBuff: number; spdBuff: number; defBuff: number; resBuff: number;
  bonusDamage: number; flatDmgReduction: number; dmgReductionPct: number;
  bonusDamageStat: { atk: number; spd: number; def: number; res: number; hp: number };
  foeAtk: number; foeSpd: number; foeDef: number; foeRes: number; // malus infligés à TON unité
  counterAnyRange: boolean; preventFoeCounter: boolean;
  neutralizeFoeBonuses: boolean; pierceFoeReduction: boolean; noFollowup: boolean;
  guaranteedFollowup: boolean; cannotBeDoubled: boolean; vantage: boolean;
  special: SpecialInfo; // spéciale de l'ennemi (jauge simulée)
  autoNote?: string; // récap des effets auto-appliqués depuis les skills du wiki
};
type UnitMods = { atkBuff: number; guaranteedFollowup: boolean; dmgReductionPct: number };

const VERDICT_META: Record<Verdict, { label: string; cls: string; order: number }> = {
  ko: { label: 'K.O. la carte', cls: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200', order: 0 },
  win: { label: 'Survit (ne le tue pas)', cls: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200/90', order: 1 },
  trade: { label: 'Survit, chip', cls: 'border-gold-deep/40 bg-black/25 text-gold-text', order: 2 },
  lose: { label: 'Se fait tuer', cls: 'border-red-400/40 bg-red-500/15 text-red-200', order: 3 },
};

export function Simulator({
  heroes, owned, stats, initialAttacker, userId, onClose,
}: {
  heroes: Hero[];
  owned: Set<string>;
  stats: Map<string, CollStats>;
  initialAttacker: Hero | null;
  userId: string | null; // pour lire tes builds équipés (feh.hero_build)
  onClose: () => void;
}) {
  const byId = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes]);
  // Persos jouables = possédés avec stats saisies.
  const roster = useMemo(
    () =>
      heroes
        .filter((h) => owned.has(h.id) && resolveStats(h, stats.get(h.id)))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.title.localeCompare(b.title, 'fr')),
    [heroes, owned, stats],
  );

  const [team, setTeam] = useState<string[]>(() => {
    const saved = load<string[]>('feh.sim.team', []);
    if (initialAttacker && !saved.includes(initialAttacker.id)) return [initialAttacker.id, ...saved];
    return saved;
  });
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(initialAttacker?.id ?? null);
  const [unitMods, setUnitMods] = useState<Map<string, UnitMods>>(
    () => new Map(load<[string, UnitMods][]>('feh.sim.unitMods', [])),
  );
  const [advEnemy, setAdvEnemy] = useState(false);
  // Ennemi : carte du wiki, saisie manuelle, ou un de tes héros.
  const [enMode, setEnMode] = useState<'wiki' | 'manual' | 'hero'>(() => {
    const m = load<string>('feh.sim.enMode', 'wiki');
    return m === 'manual' || m === 'hero' ? m : 'wiki';
  });
  const [enemyHeroId, setEnemyHeroId] = useState(() => load<string>('feh.sim.enemyHeroId', ''));
  // Chargement d'une carte depuis le wiki FEH (mémorisé pour réafficher la grille).
  const [wikiUrl, setWikiUrl] = useState(() => load<string>('feh.sim.wikiUrl', ''));
  const [wikiMap, setWikiMap] = useState<WikiMap | null>(() => load<WikiMap | null>('feh.sim.wikiMap', null));
  const [wikiDiff, setWikiDiff] = useState(() => load<string>('feh.sim.wikiDiff', ''));
  const [wikiLoading, setWikiLoading] = useState(false);
  const [wikiError, setWikiError] = useState<string | null>(null);
  const [wikiSel, setWikiSel] = useState(() => load<string>('feh.sim.wikiSel', '')); // pos sélectionnée
  // Matche un nom du wiki à un de tes héros par SLUG (l'id est un slug anglais,
  // ex. "rodrigue-faerghus-shield-1146"), robuste face aux titres FR de l'app.
  const heroByName = useMemo(() => {
    const slug = (s: string) =>
      s
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const bySlug = new Map<string, Hero>();
    for (const h of heroes) bySlug.set(h.id.replace(/-\d+$/, ''), h);
    return (name: string) => bySlug.get(slug(name));
  }, [heroes]);

  const loadWiki = async () => {
    setWikiLoading(true); setWikiError(null);
    try {
      const map = await fetchWikiMap(parsePageTitle(wikiUrl));
      setWikiMap(map);
      const diffs = Object.keys(map.difficulties);
      setWikiDiff(diffs[diffs.length - 1] ?? ''); // par défaut la difficulté la plus élevée
    } catch (e) {
      setWikiMap(null);
      setWikiError(e instanceof Error ? e.message : 'Échec du chargement');
    } finally {
      setWikiLoading(false);
    }
  };

  const pickWikiEnemy = async (u: WikiEnemy) => {
    setWikiSel(u.pos);
    const r = resolveEnemy(u, heroByName);
    setEnemy((e) => ({
      ...e, color: r.color, weapon: r.weaponType, move: r.moveType,
      stats: {
        hp: String(r.hp), atk: String(r.atk), spd: String(r.spd),
        def: String(r.def), res: String(r.res),
      },
      // on repart propre puis on applique les effets détectés
      ...ZERO_EFFECTS, brave: false, autoNote: 'Lecture des compétences…',
    }));
    const c = await fetchEnemyCombat(u.skills);
    const b = [
      c.atkBuff ? `ATQ+${c.atkBuff}` : '', c.spdBuff ? `VIT+${c.spdBuff}` : '',
      c.defBuff ? `DÉF+${c.defBuff}` : '', c.resBuff ? `RÉS+${c.resBuff}` : '',
    ].filter(Boolean).join(' ');
    const foe = [
      c.foeAtk ? `ATQ-${c.foeAtk}` : '', c.foeSpd ? `VIT-${c.foeSpd}` : '',
      c.foeDef ? `DÉF-${c.foeDef}` : '', c.foeRes ? `RÉS-${c.foeRes}` : '',
    ].filter(Boolean).join(' ');
    const st = c.bonusDamageStat;
    const statDmg = (['atk', 'spd', 'def', 'res', 'hp'] as const)
      .filter((k) => st[k]).map((k) => `${st[k]}% ${k.toUpperCase()}`).join('+');
    const sp = c.special;
    const specNote = sp.kind === 'defense'
      ? `spéciale déf. (CD ${sp.maxCd}, −${sp.reducePct}%)`
      : sp.kind === 'offense'
        ? `spéciale off. (CD ${sp.maxCd}${sp.defIgnorePct ? `, ignore ${sp.defIgnorePct}% DÉF/RÉS` : sp.addStatPct ? `, +${sp.addStatPct.pct}% ${sp.addStatPct.stat.toUpperCase()}` : sp.addDamagePct ? `, +${sp.addDamagePct}% dégâts` : ''})`
        : '';
    const parts = [
      b,
      c.bonusDamage ? `+${c.bonusDamage} dégâts/coup` : '',
      statDmg ? `+dégâts (${statDmg})` : '',
      c.dmgReductionPct ? `réduc. ${c.dmgReductionPct}%` : '',
      c.flatDmgReduction ? `−${c.flatDmgReduction} dégâts subis` : '',
      foe ? `t'inflige ${foe}` : '',
      c.preventFoeCounter ? 'coupe ta riposte' : '',
      c.counterAnyRange ? 'riposte à toute portée' : '',
      c.neutralizeFoeBonuses ? 'annule tes bonus' : '',
      c.pierceFoeReduction ? 'perce ta réduction' : '',
      c.cannotBeDoubled ? 'empêche ton doublon' : '',
      specNote,
      c.brave ? 'Brave' : '', c.guaranteedFollowup ? 'double garanti' : '',
    ].filter(Boolean);
    setEnemy((e) => ({
      ...e, ...pickEffects(c),
      autoNote: parts.length
        ? 'Auto depuis ses compétences : ' + parts.join(' · ')
        : 'Aucun effet fixe détecté (ses skills sont à formules non captées).',
    }));
  };

  const [enemy, setEnemy] = useState<EnemyState>(() =>
    load<EnemyState>('feh.sim.enemy', {
      color: 'red', weapon: 'Sword', move: 'Infantry',
      stats: { hp: '', atk: '', spd: '', def: '', res: '' },
      effAgainst: [], vantage: false, ...ZERO_EFFECTS,
    }),
  );

  // Sauvegarde de l'équipe + carte ennemie entre les ouvertures/rechargements.
  useEffect(() => save('feh.sim.team', team), [team]);
  useEffect(() => save('feh.sim.unitMods', [...unitMods]), [unitMods]);
  useEffect(() => save('feh.sim.enemy', enemy), [enemy]);
  useEffect(() => save('feh.sim.enMode', enMode), [enMode]);
  useEffect(() => save('feh.sim.enemyHeroId', enemyHeroId), [enemyHeroId]);
  useEffect(() => save('feh.sim.wikiUrl', wikiUrl), [wikiUrl]);
  useEffect(() => save('feh.sim.wikiMap', wikiMap), [wikiMap]);
  useEffect(() => save('feh.sim.wikiDiff', wikiDiff), [wikiDiff]);
  useEffect(() => save('feh.sim.wikiSel', wikiSel), [wikiSel]);

  // Armes (efficacité/Brave) des membres de l'équipe (+ l'ennemi s'il est un héros).
  const [weaponInfo, setWeaponInfo] = useState<Map<string, WeaponInfo>>(new Map());
  useEffect(() => {
    const ids = [...team, ...(enMode === 'hero' && enemyHeroId ? [enemyHeroId] : [])];
    const missing = ids.filter((id) => !weaponInfo.has(id));
    if (missing.length === 0) return;
    let active = true;
    fetchTeamWeapons(missing, userId).then((m) => {
      if (!active) return;
      setWeaponInfo((prev) => {
        const next = new Map(prev);
        for (const id of missing) next.set(id, m.get(id) ?? NO_WI);
        return next;
      });
    });
    return () => { active = false; };
  }, [team, enMode, enemyHeroId, weaponInfo, userId]);

  // Modificateurs de l'ennemi (auto depuis ses skills wiki + réglage manuel).
  const enemyMods = {
    ...NO_MODS, brave: enemy.brave, effAgainst: enemy.effAgainst,
    atkBuff: enemy.atkBuff, spdBuff: enemy.spdBuff, defBuff: enemy.defBuff, resBuff: enemy.resBuff,
    bonusDamage: enemy.bonusDamage ?? 0, flatDmgReduction: enemy.flatDmgReduction ?? 0,
    bonusDamageStat: enemy.bonusDamageStat ?? NO_MODS.bonusDamageStat,
    dmgReductionPct: enemy.dmgReductionPct, guaranteedFollowup: enemy.guaranteedFollowup,
    cannotBeDoubled: enemy.cannotBeDoubled, noFollowup: enemy.noFollowup ?? false,
    counterAnyRange: enemy.counterAnyRange ?? false,
    preventFoeCounter: enemy.preventFoeCounter ?? false,
    neutralizeFoeBonuses: enemy.neutralizeFoeBonuses ?? false,
    pierceFoeReduction: enemy.pierceFoeReduction ?? false,
    foeAtk: enemy.foeAtk ?? 0, foeSpd: enemy.foeSpd ?? 0,
    foeDef: enemy.foeDef ?? 0, foeRes: enemy.foeRes ?? 0,
    special: enemy.special ?? NO_MODS.special,
    vantage: enemy.vantage,
  };

  // Unité ennemie : soit un de tes héros (auto), soit une carte saisie.
  const enNums = STAT_ROW.map((s) => parseInt(enemy.stats[s.key], 10));
  const enComplete = enNums.every((n) => Number.isFinite(n) && n >= 0);
  let enemyUnit: Unit | null = null;
  if (enMode === 'hero') {
    const eh = enemyHeroId ? byId.get(enemyHeroId) : null;
    const s = eh ? resolveStats(eh, stats.get(eh.id)) : null;
    if (eh && s) {
      const wi = weaponInfo.get(eh.id) ?? NO_WI;
      enemyUnit = {
        hero: eh, stats: s,
        mods: { ...enemyMods, brave: enemyMods.brave || wi.effects.brave,
          effAgainst: enemyMods.effAgainst.length ? enemyMods.effAgainst : wi.effAgainst },
      };
    }
  } else if (enComplete) {
    enemyUnit = {
      hero: {
        id: 'enemy', name: 'Carte ennemie', title: '', color: enemy.color,
        weaponType: enemy.weapon, moveType: enemy.move, rarity: 5, origin: '',
      } as Hero,
      stats: { hp: enNums[0], atk: enNums[1], spd: enNums[2], def: enNums[3], res: enNums[4] },
      mods: enemyMods,
    };
  }

  const buildUnit = (id: string): Unit | null => {
    const h = byId.get(id);
    const s = h && resolveStats(h, stats.get(id));
    if (!h || !s) return null;
    const wi = weaponInfo.get(id) ?? NO_WI;
    const pu = unitMods.get(id) ?? { atkBuff: 0, guaranteedFollowup: false, dmgReductionPct: 0 };
    const ef = wi.effects; // effets détectés sur TON arme (best-effort, arme seule)
    // Les malus que l'ennemi t'inflige sont désormais appliqués PAR LE MOTEUR
    // (enemyMods.foeXxx), plus besoin de les soustraire ici.
    return {
      hero: h, stats: s,
      mods: {
        ...NO_MODS, brave: ef.brave, effAgainst: wi.effAgainst,
        atkBuff: ef.atkBuff + pu.atkBuff,
        spdBuff: ef.spdBuff, defBuff: ef.defBuff, resBuff: ef.resBuff,
        bonusDamage: ef.bonusDamage, bonusDamageStat: ef.bonusDamageStat,
        counterAnyRange: ef.counterAnyRange, preventFoeCounter: ef.preventFoeCounter,
        neutralizeFoeBonuses: ef.neutralizeFoeBonuses, pierceFoeReduction: ef.pierceFoeReduction,
        // malus que TON arme inflige à l'ennemi (Ploy/inflige…)
        foeAtk: ef.foeAtk, foeSpd: ef.foeSpd, foeDef: ef.foeDef, foeRes: ef.foeRes,
        guaranteedFollowup: ef.guaranteedFollowup || pu.guaranteedFollowup,
        cannotBeDoubled: ef.cannotBeDoubled, noFollowup: ef.noFollowup,
        dmgReductionPct: Math.max(ef.dmgReductionPct, pu.dmgReductionPct),
        flatDmgReduction: ef.flatDmgReduction, special: ef.special,
      },
    };
  };

  const results = useMemo(() => {
    if (!enemyUnit) return [];
    return team
      .map((id) => {
        const u = buildUnit(id);
        if (!u) return null;
        const { verdict, player, foe } = combatVerdict(u, enemyUnit);
        return { id, unit: u, sim: player, foe, verdict };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => VERDICT_META[a.verdict].order - VERDICT_META[b.verdict].order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, enemyUnit, weaponInfo, unitMods, stats]);

  // ===== Solveur de carte : construit le plateau, cherche une ligne gagnante (Web Worker).
  const [solving, setSolving] = useState(false);
  const [solveRes, setSolveRes] = useState<SolveResult | null>(null);
  const [solveTurns, setSolveTurns] = useState(3);
  const [solveDeaths, setSolveDeaths] = useState(false);
  const [solveNodes, setSolveNodes] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => () => workerRef.current?.terminate(), []); // nettoyage à la fermeture

  const runSolver = async () => {
    if (!wikiMap) return;
    setSolving(true);
    setSolveRes(null);
    setSolveNodes(0);
    try {
      const foes = wikiMap.difficulties[wikiDiff] ?? [];
      const passive = /passive/i.test(wikiMap.globalai);
      const linked = /linked/i.test(wikiMap.globalai);
      const edits = load<TerrainMap>('feh.sim.terrain.' + wikiMap.title, {});
      const terrain = { ...(MAP_TERRAIN[wikiMap.title] ?? {}), ...wikiMap.terrain, ...edits };

      const mods = await Promise.all(foes.map((e) => fetchEnemyCombat(e.skills)));
      const enemyUnits: BattleUnit[] = foes.map((e, i) => {
        const r = resolveEnemy(e, heroByName);
        return {
          id: 'E' + i, side: 'enemy',
          unit: {
            hero: { id: 'E' + i, name: e.name, title: '', color: r.color, weaponType: r.weaponType, moveType: r.moveType, rarity: 5, origin: '' } as Hero,
            stats: { hp: e.hp, atk: e.atk, spd: e.spd, def: e.def, res: e.res },
            mods: toMods(mods[i], []),
          },
          pos: e.pos.toLowerCase(), hp: e.hp, active: !passive,
        };
      });
      const allyUnits: BattleUnit[] = [];
      team.forEach((id, i) => {
        if (i >= wikiMap.allyPos.length) return;
        const h = byId.get(id);
        const s = h && resolveStats(h, stats.get(id));
        if (!h || !s) return;
        const wi = weaponInfo.get(id) ?? NO_WI;
        allyUnits.push({
          id, side: 'ally',
          unit: { hero: h, stats: s, mods: toMods(wi.effects, wi.effAgainst) },
          pos: wikiMap.allyPos[i].toLowerCase(), hp: s.hp, active: true,
        });
      });
      if (!allyUnits.length) {
        setSolveRes({ win: false, turns: [], nodes: 0, reason: 'Ajoute des persos (avec stats saisies) puis relance.' });
        setSolving(false);
        return;
      }
      const board: Board = { units: [...enemyUnits, ...allyUnits], terrain, linked };
      // Calcul dans un Web Worker : gros budget sans figer l'interface.
      workerRef.current?.terminate();
      const worker = new Worker(new URL('../lib/solverWorker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (ev: MessageEvent<SolverResponse>) => {
        const msg = ev.data;
        if (msg.type === 'progress') setSolveNodes(msg.nodes);
        else if (msg.type === 'done') {
          setSolveRes(msg.result);
          setSolveNodes(msg.result.nodes);
          setSolving(false);
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        }
      };
      worker.postMessage({
        kind: 'solve',
        board,
        opts: { maxTurns: solveTurns, nodeBudget: 3_000_000, timeLimitMs: 12_000, allowDeaths: solveDeaths },
      });
    } catch {
      setSolveRes({ win: false, turns: [], nodes: 0, reason: 'Erreur pendant la préparation du calcul.' });
      setSolving(false);
    }
  };

  // ===== Recherche d'équipe : quelle équipe de ta collection nettoie la carte ?
  const [searching, setSearching] = useState(false);
  const [searchRes, setSearchRes] = useState<SearchResult | null>(null);
  const [searchProg, setSearchProg] = useState({ tested: 0, total: 0 });

  const runTeamSearch = async () => {
    if (!wikiMap) return;
    setSearching(true);
    setSearchRes(null);
    setSearchProg({ tested: 0, total: 0 });
    try {
      const rosterIds = roster.map((h) => h.id);
      const wmap = await fetchTeamWeapons(rosterIds, userId);
      const pool: SearchUnit[] = roster
        .map((h): SearchUnit | null => {
          const s = resolveStats(h, stats.get(h.id));
          if (!s) return null;
          const wi = wmap.get(h.id) ?? NO_WI;
          const hero = { id: h.id, name: h.name, title: h.title, color: h.color, weaponType: h.weaponType, moveType: h.moveType, rarity: 5, origin: '' } as Hero;
          return { id: h.id, name: h.name, title: h.title, unit: { hero, stats: s, mods: toMods(wi.effects, wi.effAgainst) } };
        })
        .filter((x): x is SearchUnit => x !== null);

      const foes = wikiMap.difficulties[wikiDiff] ?? [];
      const passive = /passive/i.test(wikiMap.globalai);
      const linked = /linked/i.test(wikiMap.globalai);
      const edits = load<TerrainMap>('feh.sim.terrain.' + wikiMap.title, {});
      const terrain = { ...(MAP_TERRAIN[wikiMap.title] ?? {}), ...wikiMap.terrain, ...edits };
      const emods = await Promise.all(foes.map((e) => fetchEnemyCombat(e.skills)));
      const enemyUnits: BattleUnit[] = foes.map((e, i) => {
        const r = resolveEnemy(e, heroByName);
        return {
          id: 'E' + i, side: 'enemy',
          unit: {
            hero: { id: 'E' + i, name: e.name, title: '', color: r.color, weaponType: r.weaponType, moveType: r.moveType, rarity: 5, origin: '' } as Hero,
            stats: { hp: e.hp, atk: e.atk, spd: e.spd, def: e.def, res: e.res }, mods: toMods(emods[i], []),
          },
          pos: e.pos.toLowerCase(), hp: e.hp, active: !passive,
        };
      });
      if (pool.length < Math.min(4, wikiMap.allyPos.length || 4)) {
        setSearchRes({ teams: [], tested: 0, poolSize: pool.length, reason: 'Pas assez de persos jouables (renseigne leurs stats dans l\'onglet Stats).' });
        setSearching(false);
        return;
      }
      workerRef.current?.terminate();
      const worker = new Worker(new URL('../lib/solverWorker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (ev: MessageEvent<SolverResponse>) => {
        const msg = ev.data;
        if (msg.type === 'searchProgress') setSearchProg({ tested: msg.tested, total: msg.total });
        else if (msg.type === 'searchDone') {
          setSearchRes(msg.result);
          setSearching(false);
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        }
      };
      worker.postMessage({
        kind: 'search', pool, enemies: enemyUnits, terrain, allyPos: wikiMap.allyPos, linked,
        opts: { maxTurns: solveTurns, topK: 6, perTeamBudget: 400_000, perTeamMs: 2500 },
      });
    } catch {
      setSearchRes({ teams: [], tested: 0, poolSize: 0, reason: 'Erreur pendant la préparation de la recherche.' });
      setSearching(false);
    }
  };

  const filtered = query
    ? roster.filter((h) =>
        (h.name + ' ' + h.title).toLowerCase().includes(query.toLowerCase()),
      )
    : roster;

  const toggleMember = (id: string) =>
    setTeam((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative my-auto w-full max-w-3xl rounded-2xl border border-gold/30 bg-[#33291a] p-5 font-feh shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Fermer"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-warm-text hover:bg-black/65"
        >
          ✕
        </button>

        <h2 className="mb-1 font-feh text-[17px] font-semibold text-gold-text">
          ⚔️ Simulateur — mon équipe vs une carte
        </h2>
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[12px] text-warm-mute">
            Qui de ton équipe bat cette carte ?
          </p>
          <a
            href={`${import.meta.env.BASE_URL}sim/`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] font-semibold text-gold-text underline decoration-dotted underline-offset-2 hover:text-gold-light"
            title="Simulateur complet (tous les effets) — nouvel onglet"
          >
            Simulateur complet ↗
          </a>
        </div>

        {/* ===== Carte ennemie ===== */}
        <div className="mb-4 rounded-xl border border-red-400/25 bg-red-950/20 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-feh text-[13px] font-semibold text-red-200/90">
              🛡️ Carte ennemie
            </span>
            <div className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-lg border border-white/10 text-[11px]">
                {(['wiki', 'manual', 'hero'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setEnMode(m)}
                    className={`px-2 py-1 font-feh transition ${
                      enMode === m ? 'bg-red-500/25 text-red-100' : 'text-warm-mute hover:text-warm-dim'
                    }`}
                  >
                    {m === 'wiki' ? 'Carte (wiki)' : m === 'manual' ? 'Stats saisies' : 'Mes héros'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setAdvEnemy((v) => !v)}
                className="text-[11px] text-warm-mute underline decoration-dotted hover:text-warm-dim"
              >
                {advEnemy ? 'Masquer' : 'Compétences ▾'}
              </button>
            </div>
          </div>

          {enMode === 'hero' ? (
            <>
              <select
                value={enemyHeroId}
                onChange={(e) => setEnemyHeroId(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[13px] text-warm-text outline-none focus:border-gold/50"
              >
                <option value="">Choisir un de tes héros (stats saisies)…</option>
                {roster.map((h) => (
                  <option key={h.id} value={h.id}>{h.name} — {h.title}</option>
                ))}
              </select>
              {enemyUnit ? (
                <p className="mt-1.5 text-[11px] text-warm-mute">
                  {enemyUnit.stats.hp} PV · {enemyUnit.stats.atk} ATQ · {enemyUnit.stats.spd} VIT ·{' '}
                  {enemyUnit.stats.def} DÉF · {enemyUnit.stats.res} RÉS
                </p>
              ) : roster.length === 0 ? (
                <p className="mt-1.5 text-[11px] text-amber-300/85">
                  Aucun héros avec stats saisies — renseigne-les dans l'onglet Stats d'une fiche.
                </p>
              ) : null}
            </>
          ) : (
            <>
              {enMode === 'wiki' ? (
                <div className="mb-2 rounded-lg border border-sky-400/20 bg-sky-950/20 p-2.5">
                  <div className="flex gap-2">
                    <input
                      value={wikiUrl}
                      onChange={(e) => setWikiUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && loadWiki()}
                      placeholder="Colle l'URL du wiki (page « … (map) »)…"
                      className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-warm-text outline-none focus:border-gold/50"
                    />
                    <button
                      type="button"
                      onClick={loadWiki}
                      disabled={wikiLoading || !wikiUrl.trim()}
                      className="shrink-0 rounded border border-gold-deep/40 bg-black/30 px-3 py-1.5 font-feh text-[12px] font-semibold text-gold-text transition hover:border-gold/60 disabled:opacity-50"
                    >
                      {wikiLoading ? '…' : 'Charger'}
                    </button>
                  </div>
                  {wikiError ? (
                    <p className="mt-1.5 text-[11px] text-amber-300/85">{wikiError}</p>
                  ) : null}
                  {wikiMap ? (
                    <div className="mt-2">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-warm-mute">Difficulté :</span>
                        {Object.keys(wikiMap.difficulties).map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setWikiDiff(d)}
                            className={`rounded px-2 py-0.5 font-feh text-[11px] transition ${
                              wikiDiff === d ? 'bg-gold-deep/50 text-warm-text' : 'text-warm-mute hover:text-warm-dim'
                            }`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                      <MapGrid
                        enemies={wikiMap.difficulties[wikiDiff] ?? []}
                        allyPos={wikiMap.allyPos}
                        team={team.map((id) => byId.get(id)).filter((h): h is Hero => !!h)}
                        selectedPos={wikiSel}
                        heroByName={heroByName}
                        onPick={pickWikiEnemy}
                        wikiTerrain={wikiMap.terrain}
                        mapKey={wikiMap.title}
                        mapImageUrl={wikiMap.mapImageUrl}
                      />
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(wikiMap.difficulties[wikiDiff] ?? []).map((u, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => pickWikiEnemy(u)}
                            title={`${u.hp}/${u.atk}/${u.spd}/${u.def}/${u.res} · ${u.weapon}`}
                            className={`rounded-md border px-2 py-1 text-[11.5px] transition ${
                              wikiSel === u.pos
                                ? 'border-gold/60 bg-gold-deep/25 text-gold-light'
                                : 'border-white/10 bg-black/30 text-warm-text hover:border-gold/50 hover:text-gold-light'
                            }`}
                          >
                            {u.name}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[10.5px] text-warm-mute/80">
                        Clique un ennemi → ses <strong className="text-warm-dim">stats</strong> se remplissent (couleur/arme ajustables).
                      </p>
                      <p className="mt-1 text-[10.5px] text-emerald-300/80">
                        ✓ Ses <strong>compétences sont auto-appliquées</strong> : bonus, dégâts (fixes/%stat),
                        réduction, coupe-riposte, neutralisation, malus, et sa <strong>spéciale</strong> (jauge simulée).
                        Reste peu capté : effets conditionnels (PV, position). Ajuste au besoin via « Compétences ▾ ».
                      </p>

                      {/* ===== Solveur de carte (C3/C4) ===== */}
                      <div className="mt-3 rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/[0.06] p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={solving}
                            onClick={runSolver}
                            className="rounded-lg border border-fuchsia-300/40 bg-fuchsia-500/20 px-3 py-1.5 font-feh text-[12px] font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/30 disabled:opacity-60"
                          >
                            {solving ? `⏳ ${solveNodes.toLocaleString('fr')} états…` : '🧠 Résoudre la carte'}
                          </button>
                          {solving ? (
                            <button
                              type="button"
                              onClick={() => {
                                workerRef.current?.terminate();
                                workerRef.current = null;
                                setSolving(false);
                                setSolveRes({ win: false, turns: [], nodes: solveNodes, reason: 'Calcul arrêté.' });
                              }}
                              className="rounded-lg border border-red-300/40 bg-red-500/15 px-2.5 py-1.5 font-feh text-[12px] text-red-200 transition hover:bg-red-500/25"
                            >
                              ✕ Stop
                            </button>
                          ) : null}
                          <label className="flex items-center gap-1 text-[10.5px] text-warm-mute">
                            tours
                            <select
                              value={solveTurns}
                              onChange={(e) => setSolveTurns(+e.target.value)}
                              className="rounded border border-white/10 bg-black/40 px-1 py-0.5 text-warm-text"
                            >
                              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </label>
                          <label className="flex items-center gap-1 text-[10.5px] text-warm-mute">
                            <input type="checkbox" checked={solveDeaths} onChange={(e) => setSolveDeaths(e.target.checked)} className="h-3 w-3 accent-fuchsia-400" />
                            autoriser les pertes
                          </label>
                        </div>
                        {solveRes ? (
                          <div className="mt-2 text-[11.5px]">
                            {solveRes.win ? (
                              <>
                                <p className="font-feh font-semibold text-emerald-300">
                                  ✅ Gagnable en {solveRes.turns.length} tour(s) — plan :
                                </p>
                                <ol className="mt-1 space-y-1">
                                  {solveRes.turns.map((t, i) => (
                                    <li key={i} className="rounded bg-black/25 px-2 py-1">
                                      <span className="font-feh text-[10.5px] text-gold-text">Tour {i + 1}</span>
                                      <ul className="mt-0.5 space-y-0.5 text-warm-dim">
                                        {t.player.filter((m) => m.from !== m.to || m.targetId).map((m, j) => (
                                          <li key={j}>
                                            {m.name} {m.from}→{m.to}
                                            {m.targetName ? ` ⚔ ${m.targetName} (${m.dmg}${m.kills ? ', K.O.' : ''})` : ''}
                                          </li>
                                        ))}
                                      </ul>
                                    </li>
                                  ))}
                                </ol>
                                <p className="mt-1 text-[9.5px] text-warm-mute/70">
                                  {solveRes.nodes} états explorés. Plan valable si l'IA se comporte comme le modèle standard.
                                </p>
                              </>
                            ) : (
                              <p className="text-amber-300/90">
                                ❓ {solveRes.reason}
                                <span className="text-warm-mute/70"> ({solveRes.nodes} états explorés — augmente les tours, ou coche « autoriser les pertes ».)</span>
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="mt-1.5 text-[10px] text-warm-mute/70">
                            Cherche une suite de placements/attaques qui nettoie la carte (départ sur tes cases, IA ennemie simulée). Calcul en tâche de fond (~12 s max) : « pas trouvé » = aucune ligne dans la limite, pas forcément impossible.
                          </p>
                        )}
                      </div>

                      {/* ===== Recherche d'équipe ===== */}
                      <div className="mt-2 rounded-lg border border-cyan-400/30 bg-cyan-500/[0.06] p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={searching}
                            onClick={runTeamSearch}
                            className="rounded-lg border border-cyan-300/40 bg-cyan-500/20 px-3 py-1.5 font-feh text-[12px] font-semibold text-cyan-100 transition hover:bg-cyan-500/30 disabled:opacity-60"
                          >
                            {searching
                              ? `⏳ équipe ${searchProg.tested}/${searchProg.total || '…'}…`
                              : '🔎 Trouver une équipe qui gagne'}
                          </button>
                          {searching ? (
                            <button
                              type="button"
                              onClick={() => {
                                workerRef.current?.terminate();
                                workerRef.current = null;
                                setSearching(false);
                                setSearchRes({ teams: [], tested: searchProg.tested, poolSize: 0, reason: 'Recherche arrêtée.' });
                              }}
                              className="rounded-lg border border-red-300/40 bg-red-500/15 px-2.5 py-1.5 font-feh text-[12px] text-red-200 transition hover:bg-red-500/25"
                            >
                              ✕ Stop
                            </button>
                          ) : null}
                        </div>
                        {searchRes ? (
                          searchRes.teams.length ? (
                            <div className="mt-2 text-[11.5px]">
                              <p className="font-feh font-semibold text-emerald-300">
                                ✅ {searchRes.teams.length} équipe(s) qui nettoie(nt) la carte :
                              </p>
                              <ul className="mt-1 space-y-1">
                                {searchRes.teams.map((t, i) => (
                                  <li key={i} className="flex flex-wrap items-center gap-2 rounded bg-black/25 px-2 py-1">
                                    <span className="text-warm-dim">{t.names.join(', ')}</span>
                                    <span className="text-[10px] text-warm-mute">({t.turns} tour{t.turns > 1 ? 's' : ''})</span>
                                    <button
                                      type="button"
                                      onClick={() => setTeam(t.ids)}
                                      className="ml-auto rounded border border-emerald-300/40 bg-emerald-500/15 px-2 py-0.5 text-[10.5px] text-emerald-200 hover:bg-emerald-500/25"
                                    >
                                      charger cette équipe
                                    </button>
                                  </li>
                                ))}
                              </ul>
                              <p className="mt-1 text-[9.5px] text-warm-mute/70">
                                {searchRes.tested} équipe(s) testée(s) sur {searchRes.poolSize} persos jouables. Plans valables si l'IA joue standard.
                              </p>
                            </div>
                          ) : (
                            <p className="mt-2 text-[11.5px] text-amber-300/90">❓ {searchRes.reason}</p>
                          )
                        ) : (
                          <p className="mt-1.5 text-[10px] text-warm-mute/70">
                            Teste les combinaisons les plus prometteuses de tes persos jouables (stats saisies) et te propose celles qui battent la carte.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="grid grid-cols-3 gap-2">
                <Select value={enemy.color} onChange={(v) => setEnemy((e) => ({ ...e, color: v as Color }))}
                  options={COLORS.map((c) => [c.v, c.label])} />
                <Select value={enemy.weapon} onChange={(v) => setEnemy((e) => ({ ...e, weapon: v as WeaponType }))}
                  options={WEAPONS.map((w) => [w, w])} />
                <Select value={enemy.move} onChange={(v) => setEnemy((e) => ({ ...e, move: v }))}
                  options={MOVES.map((m) => [m, m])} />
              </div>
              <div className="mt-2 grid grid-cols-5 gap-1">
                {STAT_ROW.map((s) => (
                  <label key={s.key} className="text-center">
                    <span className="block text-[9px] uppercase tracking-wide text-warm-mute">{s.label}</span>
                    <input
                      inputMode="numeric" value={enemy.stats[s.key]} placeholder="—"
                      onChange={(ev) =>
                        setEnemy((e) => ({ ...e, stats: { ...e.stats, [s.key]: ev.target.value.replace(/[^0-9]/g, '') } }))
                      }
                      className="w-full rounded border border-white/10 bg-black/40 px-1 py-1 text-center font-feh text-[13px] text-warm-text outline-none focus:border-gold/50"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[10.5px] text-warm-mute/80">
                Touche la carte en jeu pour lire ses 5 stats (niv. 40).
              </p>
              {enemy.autoNote ? (
                <p className="mt-1 text-[10.5px] text-emerald-300/85">{enemy.autoNote}</p>
              ) : null}
            </>
          )}

          {advEnemy ? (
            <div className="mt-3 space-y-2 border-t border-white/10 pt-3 text-[11.5px]">
              <ModRow>
                <Check label="Arme Brave (×2)" checked={enemy.brave} onChange={(b) => setEnemy((e) => ({ ...e, brave: b }))} />
                <Check label="Vantage (contre en 1er)" checked={enemy.vantage} onChange={(b) => setEnemy((e) => ({ ...e, vantage: b }))} />
                <Check label="Double garanti" checked={enemy.guaranteedFollowup} onChange={(b) => setEnemy((e) => ({ ...e, guaranteedFollowup: b }))} />
                <Check label="Empêche ton doublon" checked={enemy.cannotBeDoubled} onChange={(b) => setEnemy((e) => ({ ...e, cannotBeDoubled: b }))} />
              </ModRow>
              <NumRow label="ATQ en combat (+)" value={enemy.atkBuff} onChange={(n) => setEnemy((e) => ({ ...e, atkBuff: n }))} />
              <NumRow label="Réduction de dégâts (%)" value={enemy.dmgReductionPct} onChange={(n) => setEnemy((e) => ({ ...e, dmgReductionPct: n }))} />
              <EffPicker value={enemy.effAgainst} onChange={(v) => setEnemy((e) => ({ ...e, effAgainst: v }))} label="Efficace contre" />
            </div>
          ) : null}
        </div>

        {/* ===== Ajouter des persos ===== */}
        <div className="mb-3">
          <div className="mb-1 font-feh text-[12px] font-semibold text-warm-dim">
            👥 Mon équipe à tester ({team.length})
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setListOpen(true)}
            onBlur={() => setTimeout(() => setListOpen(false), 150)}
            placeholder="Clique ici pour ajouter tes persos…"
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px] text-warm-text outline-none focus:border-gold/50"
          />
          {listOpen ? (
            <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-black/60">
              {roster.length === 0 ? (
                <p className="px-3 py-3 text-[12px] text-amber-300/85">
                  Aucun perso jouable : le simulateur n'affiche que tes héros
                  <strong> possédés dont tu as saisi les stats</strong> (LVL/PV/ATQ… dans
                  l'onglet Stats d'une fiche). Renseigne-les d'abord.
                </p>
              ) : filtered.length === 0 ? (
                <p className="px-3 py-2 text-[12px] text-warm-mute">Aucun résultat pour « {query} ».</p>
              ) : (
                filtered.slice(0, 40).map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggleMember(h.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-warm-text hover:bg-white/[0.06]"
                  >
                    {h.art ? (
                      <img src={h.art} alt="" className="h-8 w-8 shrink-0 object-contain" />
                    ) : (
                      <span className="h-8 w-8 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {h.name} <span className="text-warm-mute">— {h.title}</span>
                    </span>
                    {team.includes(h.id) ? <span className="shrink-0 text-emerald-300">✓ ajouté</span> : <span className="shrink-0 text-warm-mute">+</span>}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        {/* ===== Résultats ===== */}
        {!enemyUnit ? (
          <p className="rounded-xl border border-white/10 bg-black/25 p-4 text-center text-[13px] text-warm-dim">
            Saisis les 5 stats de la carte ennemie pour lancer les calculs.
          </p>
        ) : team.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-black/25 p-4 text-center text-[13px] text-warm-dim">
            Ajoute des persos ci-dessus pour voir qui bat cette carte.
          </p>
        ) : (
          <div className="space-y-2">
            {results.map((r) => (
              <UnitRow
                key={r.id} hero={r.unit.hero} sim={r.sim} foe={r.foe} verdict={r.verdict}
                enemy={enemyUnit} unit={r.unit}
                expanded={expanded === r.id}
                onToggle={() => setExpanded((x) => (x === r.id ? null : r.id))}
                onRemove={() => toggleMember(r.id)}
                mods={unitMods.get(r.id) ?? { atkBuff: 0, guaranteedFollowup: false, dmgReductionPct: 0 }}
                onMods={(m) => setUnitMods((prev) => new Map(prev).set(r.id, m))}
                weaponInfo={weaponInfo.get(r.id)}
              />
            ))}
          </div>
        )}

        <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-warm-mute/80">
          <strong className="text-amber-300/90">Estimation approximative.</strong> Auto depuis tes armes :
          efficacité, Brave, bonus en combat de l'arme. Mais le simulateur ne connaît <strong className="text-warm-dim">ni
          les passifs/spéciales équipés, ni les compétences de l'ennemi, ni les réductions de dégâts</strong> —
          donc le résultat peut <strong className="text-warm-dim">différer du jeu dans les deux sens</strong> sur les
          unités à kit chargé (boss). Pour l'exact, fie-toi à la <strong className="text-warm-dim">prévision de
          combat en jeu</strong>, ou ajuste à la main les ▾ (toi et l'ennemi via « Compétences ▾ »).
        </p>
      </div>
    </div>
  );
}

/* ---------- sous-composants ---------- */

const COLOR_BG: Record<string, string> = {
  red: 'bg-red-500/80', blue: 'bg-sky-500/80', green: 'bg-emerald-500/80', colorless: 'bg-slate-300/80',
};
const shortLabel = (n: string) =>
  n.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// Grille tactique 6×8 (comme le wiki) : ennemis placés + cases de départ alliées.
// Couche A : sélectionne un de tes persos pour voir sa portée de déplacement, les
// cases d'où il frappe l'ennemi choisi, et la zone de menace de cet ennemi.
const TERRAIN_BG: Record<Terrain, string> = {
  plain: '', wall: 'bg-stone-500/70', forest: 'bg-green-800/50',
  water: 'bg-blue-700/45', trench: 'bg-amber-900/40',
  fort: 'bg-amber-300/30', defensive: 'bg-amber-300/30', mountain: 'bg-stone-600/60',
};
const BRUSHES: { t: Terrain; label: string }[] = [
  { t: 'plain', label: 'Plaine' }, { t: 'wall', label: 'Mur' },
  { t: 'forest', label: 'Forêt' }, { t: 'water', label: 'Eau' },
  { t: 'fort', label: 'Fort' },
];

function MapGrid({
  enemies, allyPos, team, selectedPos, heroByName, onPick, wikiTerrain, mapKey, mapImageUrl,
}: {
  enemies: WikiEnemy[];
  allyPos: string[];
  team: Hero[];
  selectedPos: string;
  heroByName: (n: string) => Hero | undefined;
  onPick: (u: WikiEnemy) => void;
  wikiTerrain: TerrainMap;
  mapKey: string;
  mapImageUrl?: string;
}) {
  const [showImage, setShowImage] = useState(true);
  const bg = Boolean(mapImageUrl) && showImage; // image de fond active
  const enemyAt = new Map(enemies.map((e) => [e.pos.toLowerCase(), e]));
  const allyOrder = allyPos.map((p) => p.toLowerCase()); // ordonné : 1re case → 1er perso
  const cols = ['a', 'b', 'c', 'd', 'e', 'f'];
  const rows = [8, 7, 6, 5, 4, 3, 2, 1]; // rangée 8 en haut (camp ennemi)

  const [selAlly, setSelAlly] = useState<number | null>(null);
  const [showThreat, setShowThreat] = useState(true);
  const [brush, setBrush] = useState<Terrain | null>(null); // pinceau terrain actif
  // Terrain édité à la main (persisté par carte), fusionné par-dessus le wiki.
  const tKey = 'feh.sim.terrain.' + mapKey;
  const [edits, setEdits] = useState<TerrainMap>(() => load<TerrainMap>(tKey, {}));
  useEffect(() => { setEdits(load<TerrainMap>(tKey, {})); }, [tKey]);
  // Terrain effectif : pré-rempli (image) < murs auto du wiki < tes retouches.
  const terrain: TerrainMap = { ...(MAP_TERRAIN[mapKey] ?? {}), ...wikiTerrain, ...edits };
  const paint = (pos: string) => {
    setEdits((prev) => {
      const next = { ...prev };
      if (brush === 'plain') next[pos] = 'plain';
      else next[pos] = brush as Terrain;
      save(tKey, next);
      return next;
    });
  };

  // Alliés effectivement posés sur une case de départ.
  const placed = team
    .map((h, i) => ({ hero: h, idx: i, pos: allyOrder[i] }))
    .filter((p) => p.pos);

  const enemyPos = new Set(enemies.map((e) => e.pos.toLowerCase()));
  const allyPosSet = new Set(placed.map((p) => p.pos));
  const occupied = new Set([...enemyPos, ...allyPosSet]);

  // Portée + cases d'attaque de l'allié sélectionné (terrain pris en compte).
  let reachSet = new Set<string>();
  let attackSet = new Set<string>();
  const sel = selAlly != null ? placed.find((p) => p.idx === selAlly) : undefined;
  if (sel) {
    reachSet = reachable(sel.pos, moveAllowance(sel.hero.moveType), moveClass(sel.hero.moveType), terrain, enemyPos);
    if (selectedPos) {
      attackSet = attackFrom(reachSet, selectedPos, weaponRange(sel.hero.weaponType), occupied);
    }
  }
  // Zone de menace de l'ennemi sélectionné.
  let threatSet = new Set<string>();
  if (showThreat && selectedPos) {
    const se = enemyAt.get(selectedPos);
    if (se) {
      const r = resolveEnemy(se, heroByName);
      const blocked = new Set([...allyPosSet, ...[...enemyPos].filter((p) => p !== selectedPos)]);
      threatSet = threatZone(selectedPos, moveAllowance(r.moveType), moveClass(r.moveType), weaponRange(r.weaponType), terrain, blocked);
    }
  }

  return (
    <div className="mx-auto mt-2 w-full max-w-[288px]">
      {placed.length ? (
        <div className="mb-1.5 flex flex-wrap items-center justify-center gap-1">
          <span className="text-[9.5px] text-warm-mute">Positionner :</span>
          {placed.map((p) => (
            <button
              key={p.idx}
              type="button"
              onClick={() => setSelAlly((s) => (s === p.idx ? null : p.idx))}
              title={p.hero.name}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition ${
                selAlly === p.idx
                  ? 'bg-amber-400/80 text-black'
                  : 'bg-black/40 text-warm-dim hover:bg-black/60'
              }`}
            >
              {shortLabel(p.hero.name)}
            </button>
          ))}
          <label className="ml-1 flex items-center gap-1 text-[9.5px] text-warm-mute">
            <input type="checkbox" checked={showThreat} onChange={(e) => setShowThreat(e.target.checked)} className="h-3 w-3 accent-red-400" />
            menace
          </label>
        </div>
      ) : null}
      {/* Pinceau terrain (le wiki ne donne que les murs → peins forêt/eau à la main). */}
      <div className="mb-1.5 flex flex-wrap items-center justify-center gap-1">
        <span className="text-[9.5px] text-warm-mute">Terrain :</span>
        {BRUSHES.map((b) => (
          <button
            key={b.t}
            type="button"
            onClick={() => setBrush((x) => (x === b.t ? null : b.t))}
            className={`rounded px-1.5 py-0.5 text-[10px] transition ${
              brush === b.t ? 'bg-gold/80 text-black' : 'bg-black/40 text-warm-dim hover:bg-black/60'
            }`}
          >
            {b.label}
          </button>
        ))}
        {Object.keys(edits).length ? (
          <button
            type="button"
            onClick={() => { setEdits({}); save(tKey, {}); }}
            className="rounded px-1.5 py-0.5 text-[10px] text-warm-mute hover:text-red-300"
          >
            réinitialiser
          </button>
        ) : null}
      </div>
      {brush ? (
        <p className="mb-1 text-center text-[9px] text-gold-text/80">
          Clique une case pour la peindre en « {BRUSHES.find((b) => b.t === brush)?.label} ».
        </p>
      ) : null}
      {mapImageUrl ? (
        <label className="mb-1 flex items-center justify-center gap-1 text-[9.5px] text-warm-mute">
          <input type="checkbox" checked={showImage} onChange={(e) => setShowImage(e.target.checked)} className="h-3 w-3 accent-gold" />
          image de la carte en fond
        </label>
      ) : null}
      <div className="relative">
        {bg ? (
          <img src={mapImageUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full rounded-[4px] object-cover opacity-90" />
        ) : null}
        <div className="relative grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {rows.flatMap((r) =>
          cols.map((c) => {
            const pos = c + r;
            const en = enemyAt.get(pos);
            const allyIdx = allyOrder.indexOf(pos);
            const isAlly = allyIdx >= 0;
            const ally = isAlly ? team[allyIdx] : undefined; // ton perso posé sur cette case
            const hero = en ? heroByName(en.name) : undefined;
            const isAttack = attackSet.has(pos);
            const isReach = reachSet.has(pos) && !isAttack;
            const isThreat = threatSet.has(pos);
            const terr = terrain[pos] ?? 'plain';
            const terrBg = bg
              ? 'bg-transparent' // l'image montre déjà le terrain
              : TERRAIN_BG[terr] || (isAlly ? 'bg-sky-500/10' : 'bg-black/25');
            const overlay = isAttack ? 'bg-amber-400/45' : isReach ? 'bg-sky-500/30' : '';
            return (
              <div
                key={pos}
                className={`relative aspect-square rounded-[3px] border ${
                  isAlly ? 'border-sky-400/40' : 'border-white/[0.06]'
                } ${terrBg} ${isThreat ? 'shadow-[inset_0_0_0_2px_rgba(248,113,113,0.55)]' : ''}`}
              >
                {overlay ? <span className={`pointer-events-none absolute inset-0 rounded-[3px] ${overlay}`} /> : null}
                {en ? (
                  <button
                    type="button"
                    onClick={() => onPick(en)}
                    title={`${en.name} — ${en.hp}/${en.atk}/${en.spd}/${en.def}/${en.res}`}
                    className={`absolute inset-0 flex items-center justify-center rounded-[3px] transition ${
                      selectedPos === pos ? 'ring-2 ring-gold' : 'hover:brightness-125'
                    }`}
                  >
                    {hero?.art ? (
                      <img src={hero.art} alt={en.name} className="h-full w-full object-contain" />
                    ) : (
                      <span
                        className={`flex h-[72%] w-[72%] items-center justify-center rounded-full text-[8px] font-bold text-black/80 ${
                          COLOR_BG[resolveEnemy(en, heroByName).color] ?? 'bg-slate-300/80'
                        }`}
                      >
                        {shortLabel(en.name)}
                      </span>
                    )}
                  </button>
                ) : ally ? (
                  <span
                    className="absolute inset-0 flex items-center justify-center"
                    title={`${ally.name} — ${ally.title}`}
                  >
                    {ally.art ? (
                      <img src={ally.art} alt={ally.name} className="h-full w-full object-contain" />
                    ) : (
                      <span className="flex h-[72%] w-[72%] items-center justify-center rounded-full bg-sky-500/70 text-[8px] font-bold text-black/80">
                        {shortLabel(ally.name)}
                      </span>
                    )}
                  </span>
                ) : isAlly ? (
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] text-sky-300/70">▲</span>
                ) : null}
                {brush ? (
                  <button
                    type="button"
                    onClick={() => paint(pos)}
                    title={`Peindre ${pos}`}
                    className="absolute inset-0 z-20 rounded-[3px] ring-1 ring-inset ring-gold/30 hover:ring-gold/70"
                  />
                ) : null}
              </div>
            );
          }),
        )}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[9.5px] text-warm-mute">
        <span><span className="inline-block h-2 w-2 rounded-[1px] bg-sky-500/40 align-middle" /> déplacement</span>
        <span><span className="inline-block h-2 w-2 rounded-[1px] bg-amber-400/60 align-middle" /> d'ici tu frappes</span>
        <span><span className="inline-block h-2 w-2 rounded-[1px] align-middle shadow-[inset_0_0_0_2px_rgba(248,113,113,0.7)]" /> menacé</span>
        <span><span className="inline-block h-2 w-2 rounded-[1px] bg-stone-500/70 align-middle" /> mur</span>
        <span><span className="inline-block h-2 w-2 rounded-[1px] bg-green-800/60 align-middle" /> forêt</span>
        <span><span className="inline-block h-2 w-2 rounded-[1px] bg-blue-700/60 align-middle" /> eau</span>
        <span><span className="inline-block h-2 w-2 rounded-[1px] bg-amber-300/50 align-middle" /> fort (−30%)</span>
      </div>
      <p className="mt-0.5 text-center text-[9px] text-warm-mute/70">
        Terrain pré-rempli (lu de l'image) + murs du wiki ; corrige au pinceau. Fort/forêt passables (fort ≠ blocage, il réduit les dégâts). Sans IA : repère, pas une garantie.
      </p>
    </div>
  );
}

function UnitRow({
  hero, sim, foe, verdict, enemy, unit, expanded, onToggle, onRemove, mods, onMods, weaponInfo,
}: {
  hero: Hero; sim: Sim; foe: Sim | null; verdict: Verdict; enemy: Unit; unit: Unit;
  expanded: boolean; onToggle: () => void; onRemove: () => void;
  mods: UnitMods; onMods: (m: UnitMods) => void; weaponInfo?: WeaponInfo;
}) {
  const v = VERDICT_META[verdict];
  return (
    <div className={`rounded-xl border ${v.cls.replace(/text-[^ ]+/, '')} overflow-hidden`}>
      <div className="flex items-center gap-2 p-2.5">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {hero.art ? (
            <img
              src={hero.art}
              alt=""
              className="h-9 w-9 shrink-0 object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,.6)]"
            />
          ) : null}
          <span className="min-w-0 truncate font-feh text-[13px] font-semibold text-warm-text">
            {hero.name} <span className="text-warm-mute">— {hero.title}</span>
          </span>
        </button>
        <span className={`shrink-0 rounded-md border px-2 py-0.5 font-feh text-[11px] ${v.cls}`}>{v.label}</span>
        <button type="button" onClick={onToggle} className="shrink-0 text-warm-mute hover:text-warm-dim" title="Détails">
          {expanded ? '▴' : '▾'}
        </button>
        <button type="button" onClick={onRemove} className="shrink-0 text-warm-mute hover:text-red-300" title="Retirer">✕</button>
      </div>
      {expanded ? (
        <div className="border-t border-white/10 bg-black/20 p-3">
          <p className="mb-1 font-feh text-[11px] font-semibold text-gold-text/90">⚔️ Ta phase (tu attaques)</p>
          <Result sim={sim} atk={unit} def={enemy} />
          {foe ? (
            <>
              <p className="mb-1 mt-3 font-feh text-[11px] font-semibold text-amber-300/85">
                🛡️ Phase ennemie ({enemy.hero.name} t'attaque)
              </p>
              <Result sim={foe} atk={enemy} def={unit} />
            </>
          ) : null}
          <div className="mt-3 space-y-1.5 border-t border-white/10 pt-2 text-[11.5px]">
            {weaponInfo ? (
              <p className="text-emerald-300/80">
                Auto (arme) :{' '}
                {(() => {
                  const ef = weaponInfo.effects;
                  return [
                    ef.brave ? 'Brave' : '',
                    weaponInfo.effAgainst.length
                      ? `eff. vs ${weaponInfo.effAgainst.map((e) => EFF_LABEL[e] ?? e).join(', ')}`
                      : '',
                    [
                      ef.atkBuff ? `ATQ+${ef.atkBuff}` : '',
                      ef.spdBuff ? `VIT+${ef.spdBuff}` : '',
                      ef.defBuff ? `DÉF+${ef.defBuff}` : '',
                      ef.resBuff ? `RÉS+${ef.resBuff}` : '',
                    ].filter(Boolean).join(' '),
                    ef.counterAnyRange ? 'riposte à toute portée' : '',
                    ef.preventFoeCounter ? 'coupe sa riposte' : '',
                    ef.neutralizeFoeBonuses ? 'annule ses bonus' : '',
                  ].filter(Boolean).join(' · ') || 'aucun effet détecté';
                })()}
              </p>
            ) : null}
            <p className="text-[10.5px] text-warm-mute/70">
              Ajoute à la main tes passifs/spéciales (Fury, Death Blow, esquive…) que l'app ne connaît pas :
            </p>
            <NumRow label="+ ATQ en combat (passifs)" value={mods.atkBuff} onChange={(n) => onMods({ ...mods, atkBuff: n })} />
            <NumRow label="Réduction de dégâts subis (%)" value={mods.dmgReductionPct} onChange={(n) => onMods({ ...mods, dmgReductionPct: n })} />
            <Check label="Double garanti" checked={mods.guaranteedFollowup} onChange={(b) => onMods({ ...mods, guaranteedFollowup: b })} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Result({ sim, atk, def }: { sim: Sim; atk: Unit; def: Unit }) {
  return (
    <div className="space-y-2">
      {sim.vantage ? (
        <p className="text-[11px] italic text-amber-300/80">L'ennemi a le Vantage : il frappe en premier.</p>
      ) : null}
      <Line who={atk.hero.name} arrow={`→ ${def.hero.name}`} r={sim.atk} targetHp={def.stats.hp} hpAfter={sim.defHpAfter} />
      {sim.counter ? (
        <Line who={def.hero.name} arrow={`↩ ${atk.hero.name}`} r={sim.counter} targetHp={atk.stats.hp} hpAfter={sim.counter.atkHpAfter} faded />
      ) : (
        <p className="px-1 text-[11.5px] italic text-warm-mute">
          {def.hero.name} ne contre pas
          {def.hero.weaponType === 'Staff' ? ' (bâton)' : ' (portée différente)'}
          {sim.ko ? ' — et tombe.' : '.'}
        </p>
      )}
    </div>
  );
}

function Line({
  who, arrow, r, targetHp, hpAfter, faded,
}: {
  who: string; arrow: string;
  r: { dmg: number; hits: number; total: number; targetsRes: boolean; effective: boolean };
  targetHp: number; hpAfter: number; faded?: boolean;
}) {
  const pct = targetHp > 0 ? Math.round((hpAfter / targetHp) * 100) : 0;
  return (
    <div className={`rounded-lg border border-white/10 bg-black/20 p-2.5 ${faded ? 'opacity-90' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-feh text-[12.5px] font-semibold text-warm-text">
          {who} <span className="text-warm-mute">{arrow}</span>
        </span>
        <span className="shrink-0 font-feh text-[12.5px] text-gold-text">
          {r.hits === 0 ? '—' : <>{r.dmg}{r.hits > 1 ? ` ×${r.hits} = ${r.total}` : ''}</>}
          <span className="ml-1 text-[10px] text-warm-mute">
            ({r.targetsRes ? 'RÉS' : 'DÉF'}{r.effective ? ', eff.' : ''})
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/50">
        <div className={`h-full rounded-full ${hpAfter <= 0 ? 'bg-red-500/80' : 'bg-emerald-500/70'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-0.5 text-right text-[10.5px] text-warm-mute">PV : {hpAfter} / {targetHp}</div>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-warm-text outline-none focus:border-gold/50">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-warm-dim">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-gold-deep" />
      {label}
    </label>
  );
}
function NumRow({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-warm-dim">
      <span>{label}</span>
      <input inputMode="numeric" value={value || ''} placeholder="0"
        onChange={(e) => onChange(parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0)}
        className="w-16 rounded border border-white/10 bg-black/40 px-2 py-1 text-center font-feh text-[12px] text-warm-text outline-none focus:border-gold/50" />
    </label>
  );
}
function ModRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1.5">{children}</div>;
}
function EffPicker({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-warm-dim">
      <span>{label} :</span>
      {EFF.map((e) => (
        <Check key={e} label={EFF_LABEL[e]} checked={value.includes(e)}
          onChange={(b) => onChange(b ? [...value, e] : value.filter((x) => x !== e))} />
      ))}
    </div>
  );
}
