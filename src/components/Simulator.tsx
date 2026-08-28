import { useEffect, useMemo, useRef, useState } from 'react';
import type { Color, Hero, WeaponType, MoveType, Stats } from '../types';
import type { CollStats } from '../lib/collection';
import {
  resolveStats, combatVerdict,
  NO_MODS, type Sim, type Unit, type Verdict, type CombatMods,
} from '../lib/combat';
import { type SolveResult, type PlanTurn } from '../lib/solver';
import type { SolverResponse } from '../lib/solverWorker';
import { isRefresher, detectAssist, detectSave, detectDivineVeinIce } from '../lib/battle';
import type { Board, BattleUnit } from '../lib/battle';
import type { SearchResult, SearchUnit, TeamResult } from '../lib/teamSearch';
import { fetchTeamWeapons, fetchEnemyCombat, EMPTY_EFFECTS, type WeaponInfo, type EnemyCombat } from '../lib/simWeapons';
import type { SpecialInfo } from '../lib/skillEffects';
import { WeaponIcon, MoveIcon } from './icons';
import {
  fetchWikiMap, parsePageTitle, resolveEnemy, resolveMapImage,
  type WikiEnemy, type WikiMap,
} from '../lib/wikiMap';
import {
  reachable, attackFrom, threatZone, moveAllowance, weaponRange, moveClass,
  type Terrain, type TerrainMap,
} from '../lib/tactics';
import { MAP_TERRAIN } from '../data/mapTerrain';
import { fetchBuilds } from '../lib/builds';
import { fetchAllHeroStats } from '../lib/heroStats';

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

const ASSIST_LABEL: Record<string, string> = {
  reposition: 'repositionne', swap: 'échange avec', drawback: 'tire', pivot: 'pivote autour de',
  smite: 'catapulte', shove: 'pousse',
};

// Plan tour par tour (réutilisé par « Résoudre la carte » ET les équipes trouvées).
// startTurn : numéro du 1er tour affiché (2+ en re-planification, le tour 1 étant joué).
function PlanSteps({ turns, startTurn = 1 }: { turns: PlanTurn[]; startTurn?: number }) {
  return (
    <ol className="mt-1 space-y-1">
      {turns.map((t, i) => (
        <li key={i} className="rounded bg-black/25 px-2 py-1">
          <span className="font-feh text-[10.5px] text-gold-text">Tour {i + startTurn}</span>
          <ul className="mt-0.5 space-y-0.5 text-warm-dim">
            {t.player.filter((m) => m.from !== m.to || m.targetId).map((m, j) => (
              <li key={j}>
                {m.assist
                  ? `🔀 ${m.name} ${m.from}→${m.to} · ${ASSIST_LABEL[m.assist] ?? 'assiste'} ${m.targetName}`
                  : <>{m.name} {m.from}→{m.to}{m.targetName ? ` ⚔ ${m.targetName} (${m.dmg}${m.kills ? ', K.O.' : ''})` : ''}</>}
              </li>
            ))}
          </ul>
          {t.enemy.filter((m) => m.from !== m.to || m.target).length ? (
            <p className="mt-1 text-[10px] italic text-amber-300/70">
              🛡️ IA prévue : {t.enemy
                .filter((m) => m.from !== m.to || m.target)
                .map((m) => `${m.name} ${m.from}→${m.to}${m.kills ? ' (tue)' : m.heal ? ' (soigne)' : m.target ? ' (attaque)' : ''}`)
                .join(' · ')}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
const EFF = ['flying', 'armored', 'cavalry', 'infantry', 'dragon', 'beast'] as const;
const EFF_LABEL: Record<string, string> = {
  flying: 'Volant', armored: 'Cuirassé', cavalry: 'Cavalier',
  infantry: 'Fantassin', dragon: 'Dragon', beast: 'Bête',
};
const NO_WI: WeaponInfo = { effAgainst: [], effects: EMPTY_EFFECTS(), hasBuild: false };

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

// Re-planification « combat en cours » : état réel saisi après avoir joué un tour.
type LiveOv = { pos: string; hp: number; dead?: boolean };
type LiveState = { enemies: Record<string, LiveOv>; allies: Record<string, LiveOv> };

// Effets parsés → modificateurs de combat (pour construire le plateau du solveur).
function toMods(e: EnemyCombat, effAgainst: string[]): CombatMods {
  return {
    ...NO_MODS, brave: e.brave, effAgainst,
    atkBuff: e.atkBuff, spdBuff: e.spdBuff, defBuff: e.defBuff, resBuff: e.resBuff,
    initBuff: e.initBuff, defendBuff: e.defendBuff,
    bonusDamage: e.bonusDamage, bonusDamageStat: e.bonusDamageStat,
    guaranteedFollowup: e.guaranteedFollowup, followupInit: e.followupInit, followupDefend: e.followupDefend,
    cannotBeDoubled: e.cannotBeDoubled, noFollowup: e.noFollowup,
    counterAnyRange: e.counterAnyRange, preventFoeCounter: e.preventFoeCounter,
    neutralizeFoeBonuses: e.neutralizeFoeBonuses, pierceFoeReduction: e.pierceFoeReduction,
    dmgReductionPct: e.dmgReductionPct, reductionInit: e.reductionInit, reductionDefend: e.reductionDefend,
    flatDmgReduction: e.flatDmgReduction,
    foeAtk: e.foeAtk, foeSpd: e.foeSpd, foeDef: e.foeDef, foeRes: e.foeRes,
    fieldBuff: e.fieldBuff, special: e.special,
  };
}

type EnemyState = {
  name?: string;
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
  ko: { label: 'Le tue (duel)', cls: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200', order: 0 },
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
  // Auto-réparation : une carte en cache d'avant l'ajout de `globalai` (ou du terrain)
  // manque des champs → on la re-télécharge pour retrouver le bon comportement d'IA.
  useEffect(() => {
    if (wikiMap && wikiMap.globalai === undefined && wikiMap.title) {
      fetchWikiMap(wikiMap.title).then(setWikiMap).catch(() => {});
    }
  }, [wikiMap]);
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
      setSolveDeaths(!map.mustSurvive); // Rout → pertes autorisées ; survie/défense → non
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
      ...e, name: u.name, color: r.color, weapon: r.weaponType, move: r.moveType,
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

  // Stats + build modélisé des héros hypothétiques du théorycraft, pour pouvoir « charger »
  // une équipe du jeu (que tu ne possèdes pas) dans le simulateur et l'inspecter à l'identique.
  const theoryUnits = useRef<Map<string, { stats: Stats; mods: CombatMods }>>(new Map());
  const [statsOverride, setStatsOverride] = useState<Map<string, Stats>>(new Map());
  const [modsOverride, setModsOverride] = useState<Map<string, CombatMods>>(new Map());

  const buildUnit = (id: string): Unit | null => {
    const h = byId.get(id);
    // Priorité aux stats hypothétiques chargées depuis le théorycraft (héros non possédés).
    const s = h && (statsOverride.get(id) ?? resolveStats(h, stats.get(id)));
    if (!h || !s) return null;
    // Équipe du jeu « chargée » : on rejoue le build modélisé tel quel.
    const mo = modsOverride.get(id);
    if (mo) return { hero: h, stats: s, mods: mo };
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
        initBuff: ef.initBuff, defendBuff: ef.defendBuff,
        bonusDamage: ef.bonusDamage, bonusDamageStat: ef.bonusDamageStat,
        counterAnyRange: ef.counterAnyRange, preventFoeCounter: ef.preventFoeCounter,
        neutralizeFoeBonuses: ef.neutralizeFoeBonuses, pierceFoeReduction: ef.pierceFoeReduction,
        // malus que TON arme inflige à l'ennemi (Ploy/inflige…)
        foeAtk: ef.foeAtk, foeSpd: ef.foeSpd, foeDef: ef.foeDef, foeRes: ef.foeRes,
        fieldBuff: ef.fieldBuff, // bonus de zone que TON perso accorde à tes autres persos

        guaranteedFollowup: ef.guaranteedFollowup || pu.guaranteedFollowup,
        followupInit: ef.followupInit, followupDefend: ef.followupDefend,
        cannotBeDoubled: ef.cannotBeDoubled, noFollowup: ef.noFollowup,
        dmgReductionPct: Math.max(ef.dmgReductionPct, pu.dmgReductionPct),
        reductionInit: ef.reductionInit, reductionDefend: ef.reductionDefend,
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
  }, [team, enemyUnit, weaponInfo, unitMods, stats, statsOverride, modsOverride]);

  // ===== Solveur de carte : construit le plateau, cherche une ligne gagnante (Web Worker).
  const [solving, setSolving] = useState(false);
  const [solveRes, setSolveRes] = useState<SolveResult | null>(null);
  const [solveTurns, setSolveTurns] = useState(3);
  // Autoriser les pertes : par défaut selon la carte (Rout = pertes OK ; survie/défense =
  // il faut tout garder en vie). Voir wikiMap.mustSurvive.
  const [solveDeaths, setSolveDeaths] = useState(true);
  const [solveNodes, setSolveNodes] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const searchWorkersRef = useRef<Worker[]>([]); // recherche d'équipe parallélisée (N workers)
  const solveStart = useRef(0); // horodatage de départ (jauge de temps)
  const solveLimit = useRef(15_000); // limite de temps utilisée
  useEffect(() => () => { workerRef.current?.terminate(); searchWorkersRef.current.forEach((w) => w.terminate()); }, []); // nettoyage

  // Re-planification « combat en cours » : positions/PV réels saisis après un tour joué.
  const [liveOn, setLiveOn] = useState(false);
  const [liveEnemies, setLiveEnemies] = useState<Record<string, LiveOv>>({});
  const [liveAllies, setLiveAllies] = useState<Record<string, LiveOv>>({});
  const [liveTurn, setLiveTurn] = useState(2); // tour où l'on repart (le tour 1 est déjà joué)
  const [planStartTurn, setPlanStartTurn] = useState(1); // décalage d'affichage du dernier plan
  // (Ré)initialise l'état live depuis les positions/PV de départ de la carte.
  const initLive = () => {
    if (!wikiMap) return;
    const foes = wikiMap.difficulties[wikiDiff] ?? [];
    const en: Record<string, LiveOv> = {};
    foes.forEach((e, i) => { en['E' + i] = { pos: e.pos.toLowerCase(), hp: e.hp, dead: false }; });
    const al: Record<string, LiveOv> = {};
    team.forEach((id, i) => {
      if (i >= wikiMap.allyPos.length) return;
      const h = byId.get(id);
      const s = h && (statsOverride.get(id) ?? resolveStats(h, stats.get(id)));
      if (!h || !s) return;
      al[id] = { pos: wikiMap.allyPos[i].toLowerCase(), hp: s.hp };
    });
    setLiveEnemies(en);
    setLiveAllies(al);
  };

  const stopSearchWorkers = () => {
    searchWorkersRef.current.forEach((w) => w.terminate());
    searchWorkersRef.current = [];
  };

  // Lance la recherche d'équipe en PARALLÈLE sur plusieurs workers (un par cœur, max 4) :
  // chaque worker teste une part disjointe des combos (shard). On agrège les gagnantes et
  // on arrête tout dès qu'on en a assez.
  const launchShardedSearch = (
    pool: SearchUnit[], enemyUnits: BattleUnit[], terrain: TerrainMap,
    allyPos: string[], linked: boolean, baseOpts: Record<string, unknown>,
  ) => {
    stopSearchWorkers();
    // Nombre de workers = nb de cœurs logiques, plafonné à 24. Le min() garantit qu'on ne
    // dépasse JAMAIS les cœurs réels (au-delà : aucun gain, contention + RAM en plus).
    const shardCount = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 24));
    const maxWinners = (baseOpts.maxWinners as number) ?? 1;
    const tested = new Array(shardCount).fill(0);
    const allWinners: TeamResult[] = [];
    let done = 0, finished = false;
    const finalize = () => {
      if (finished) return;
      finished = true;
      stopSearchWorkers();
      const seen = new Set<string>();
      const uniq = allWinners
        .filter((w) => { const k = [...w.ids].sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => a.turns - b.turns)
        .slice(0, maxWinners);
      setSearchRes({
        teams: uniq, tested: tested.reduce((a, b) => a + b, 0), poolSize: pool.length,
        reason: uniq.length ? '' : 'Aucune équipe testée ne nettoie la carte (essaie plus de tours, ou monte tes persos).',
      });
      setSearching(false);
    };
    for (let k = 0; k < shardCount; k++) {
      const worker = new Worker(new URL('../lib/solverWorker.ts', import.meta.url), { type: 'module' });
      searchWorkersRef.current.push(worker);
      worker.onmessage = (ev: MessageEvent<SolverResponse>) => {
        const msg = ev.data;
        if (msg.type === 'searchProgress') {
          tested[k] = msg.tested;
          setSearchProg({ tested: tested.reduce((a, b) => a + b, 0), total: msg.total });
        } else if (msg.type === 'searchDone') {
          allWinners.push(...msg.result.teams);
          done++;
          if (allWinners.length >= maxWinners || done >= shardCount) finalize();
        }
      };
      worker.postMessage({
        kind: 'search', pool, enemies: enemyUnits, terrain, allyPos, linked,
        // chaque shard s'arrête à sa 1re gagnante (best-first) et la remonte tout de
        // suite → dès qu'un shard trouve un clear, le principal finalise (maxWinners=1).
        opts: { ...baseOpts, shard: k, shardCount, maxWinners: 1 },
      });
    }
  };

  const runSolver = async (live?: LiveState) => {
    if (!wikiMap) return;
    setSolving(true);
    setSolveRes(null);
    setSolveNodes(0);
    setPlanStartTurn(live ? liveTurn : 1); // en re-planification, on numérote depuis le tour actuel
    try {
      const foes = wikiMap.difficulties[wikiDiff] ?? [];
      const passive = /passive/i.test(wikiMap.globalai);
      const linked = /linked/i.test(wikiMap.globalai);
      const edits = load<TerrainMap>('feh.sim.terrain.' + wikiMap.title, {});
      const terrain = { ...(MAP_TERRAIN[wikiMap.title] ?? {}), ...wikiMap.terrain, ...edits };

      const mods = await Promise.all(foes.map((e) => fetchEnemyCombat(e.skills)));
      const enemyUnits: BattleUnit[] = [];
      foes.forEach((e, i) => {
        const ov = live?.enemies['E' + i];
        if (ov?.dead) return; // ennemi déjà tué en jeu → on l'enlève
        const r = resolveEnemy(e, heroByName);
        enemyUnits.push({
          id: 'E' + i, side: 'enemy',
          unit: {
            hero: { id: 'E' + i, name: e.name, title: '', color: r.color, weaponType: r.weaponType, moveType: r.moveType, rarity: 5, origin: '' } as Hero,
            stats: { hp: e.hp, atk: e.atk, spd: e.spd, def: e.def, res: e.res },
            mods: toMods(mods[i], []),
          },
          // en re-planification (live), on part de l'état réel : positions/PV saisis,
          // et TOUS les ennemis sont réveillés (on est après le tour 1).
          pos: (ov?.pos || e.pos).toLowerCase(), hp: ov?.hp ?? e.hp,
          active: live ? true : !passive, refresher: isRefresher(e.skills), assist: detectAssist(e.skills), saveType: detectSave(e.skills),
          hasIceVein: detectDivineVeinIce(e.skills),
        });
      });
      const allyUnits: BattleUnit[] = [];
      team.forEach((id, i) => {
        if (i >= wikiMap.allyPos.length) return;
        const h = byId.get(id);
        const s = h && (statsOverride.get(id) ?? resolveStats(h, stats.get(id)));
        if (!h || !s) return;
        const ov = live?.allies[id];
        if (ov?.dead) return; // allié tombé en jeu (pertes autorisées) → hors plateau
        const wi = weaponInfo.get(id) ?? NO_WI;
        const mo = modsOverride.get(id);
        allyUnits.push({
          id, side: 'ally',
          unit: { hero: h, stats: s, mods: mo ?? toMods(wi.effects, wi.effAgainst) },
          pos: (ov?.pos || wikiMap.allyPos[i]).toLowerCase(), hp: ov?.hp ?? s.hp, active: true,
          assist: wi.assistName ? detectAssist([wi.assistName]) : undefined,
          hasIceVein: wi.assistName ? detectDivineVeinIce([wi.assistName]) : false,
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
      const timeLimitMs = solveTurns >= 6 ? 30_000 : 15_000;
      solveStart.current = Date.now();
      solveLimit.current = timeLimitMs;
      worker.postMessage({
        kind: 'solve',
        board,
        // Plus de tours = recherche plus profonde → on laisse plus de temps/budget.
        opts: { maxTurns: solveTurns, nodeBudget: 8_000_000, timeLimitMs, allowDeaths: solveDeaths },
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
  const [builtIds, setBuiltIds] = useState<Set<string>>(new Set()); // persos au build enregistré
  const [searchScope, setSearchScope] = useState<'roster' | 'game'>('roster'); // collection vs tout le jeu
  const [openPlan, setOpenPlan] = useState<number | null>(null); // équipe dont le plan est déplié

  // Charge une équipe trouvée dans le simulateur. Pour le théorycraft (héros non
  // possédés), on injecte leurs stats montées + leur kit natif pour pouvoir les inspecter.
  const loadTeam = (t: TeamResult) => {
    if (searchScope === 'game') {
      setStatsOverride((prev) => {
        const so = new Map(prev);
        t.ids.forEach((id) => { const u = theoryUnits.current.get(id); if (u) so.set(id, u.stats); });
        return so;
      });
      setModsOverride((prev) => {
        const mo = new Map(prev);
        t.ids.forEach((id) => { const u = theoryUnits.current.get(id); if (u) mo.set(id, u.mods); });
        return mo;
      });
    }
    setTeam(t.ids);
  };

  const runTeamSearch = async () => {
    if (!wikiMap) return;
    setSearching(true);
    setSearchScope('roster');
    setSearchRes(null);
    setOpenPlan(null);
    setSearchProg({ tested: 0, total: 0 });
    try {
      const foes = wikiMap.difficulties[wikiDiff] ?? [];

      // Pré-filtre RAPIDE (stats seules, sans base de données) : on classe grossièrement
      // les candidats face au boss et on ne récupère les effets que des ~18 meilleurs.
      const boss = foes.reduce((a, b) => (b.hp > a.hp ? b : a), foes[0]);
      const MAGIC = /Tome|Staff|Dragon/;
      const bossMagic = boss ? MAGIC.test(resolveEnemy(boss, heroByName).weaponType) : false;
      type St = { atk: number; spd: number; def: number; res: number; hp: number };
      const prefScore = (h: Hero, s: St): number => {
        if (!boss) return s.atk + s.spd + s.def + s.res;
        const mit = MAGIC.test(h.weaponType) ? boss.res : boss.def;
        const dmg = Math.max(0, s.atk - mit);
        const surv = (bossMagic ? s.res : s.def) + s.hp - boss.atk;
        return dmg * 2 + Math.max(0, surv);
      };
      // Qui a un build enregistré ? (1 requête légère) → toujours inclus dans les candidats.
      const builds = await fetchBuilds(roster.map((h) => h.id), userId);
      const scored = roster
        .map((h) => ({ h, s: resolveStats(h, stats.get(h.id)) }))
        .filter((x): x is { h: Hero; s: St } => x.s !== null)
        .map((x) => ({ ...x, sc: prefScore(x.h, x.s), built: builds.has(x.h.id) }))
        .sort((a, b) => b.sc - a.sc);
      // Tous les persos buildés (kit complet) + les meilleurs non-buildés, plafonné.
      // 16 → C(16,4) = 1820 équipes (bon compromis vitesse/couverture).
      const built = scored.filter((x) => x.built);
      const unbuilt = scored.filter((x) => !x.built);
      const ranked = [...built, ...unbuilt].slice(0, 16);
      setBuiltIds(new Set(built.map((x) => x.h.id)));

      const wmap = await fetchTeamWeapons(ranked.map((x) => x.h.id), userId);
      const pool: SearchUnit[] = ranked.map(({ h, s }) => {
        const wi = wmap.get(h.id) ?? NO_WI;
        const hero = { id: h.id, name: h.name, title: h.title, color: h.color, weaponType: h.weaponType, moveType: h.moveType, rarity: 5, origin: '', moveUrl: h.moveUrl, weaponUrl: h.weaponUrl } as Hero;
        return { id: h.id, name: h.name, title: h.title, unit: { hero, stats: s, mods: toMods(wi.effects, wi.effAgainst) }, assist: wi.assistName ? detectAssist([wi.assistName]) : undefined };
      });

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
          pos: e.pos.toLowerCase(), hp: e.hp, active: !passive, refresher: isRefresher(e.skills), assist: detectAssist(e.skills), saveType: detectSave(e.skills),
          hasIceVein: detectDivineVeinIce(e.skills),
        };
      });
      if (pool.length < Math.min(4, wikiMap.allyPos.length || 4)) {
        setSearchRes({ teams: [], tested: 0, poolSize: pool.length, reason: 'Pas assez de persos jouables (renseigne leurs stats dans l\'onglet Stats).' });
        setSearching(false);
        return;
      }
      launchShardedSearch(pool, enemyUnits, terrain, wikiMap.allyPos, linked, {
        maxTurns: Math.max(solveTurns, 6), perTeamBudget: 400_000, perTeamMs: 1500, globalMs: 150_000, allowDeaths: solveDeaths, maxWinners: 1,
      });
    } catch {
      setSearchRes({ teams: [], tested: 0, poolSize: 0, reason: 'Erreur pendant la préparation de la recherche.' });
      setSearching(false);
    }
  };

  // ===== Théorycraft : cherche parmi TOUS les héros du jeu une équipe qui NETTOIE la carte.
  const runTheoryCraft = async () => {
    if (!wikiMap) return;
    setSearching(true);
    setSearchScope('game');
    setSearchRes(null);
    setOpenPlan(null);
    setSearchProg({ tested: 0, total: 0 });
    setBuiltIds(new Set());
    try {
      const foes = wikiMap.difficulties[wikiDiff] ?? [];
      const boss = foes.reduce((a, b) => (b.hp > a.hp ? b : a), foes[0]);
      const MAGIC = /Tome|Staff|Dragon/;
      const bossMagic = boss ? MAGIC.test(resolveEnemy(boss, heroByName).weaponType) : false;
      type St = { atk: number; spd: number; def: number; res: number; hp: number };
      const prelim = (h: Hero, s: St) => {
        if (!boss) return s.atk + s.spd + s.def + s.res;
        const mit = MAGIC.test(h.weaponType) ? boss.res : boss.def;
        return Math.max(0, s.atk - mit) * 2 + Math.max(0, (bossMagic ? s.res : s.def) + s.hp - boss.atk);
      };
      const statsMap = await fetchAllHeroStats();
      const ranked = heroes
        .map((h) => ({ h, s: statsMap.get(h.id) }))
        .filter((x): x is { h: Hero; s: St } => !!x.s)
        .sort((a, b) => prelim(b.h, b.s) - prelim(a.h, a.s))
        .slice(0, 16);
      const wmap = await fetchTeamWeapons(ranked.map((x) => x.h.id), null);
      // Théorycraft = « quel héros DU JEU pourrait le faire, bien monté ». On l'évalue
      // donc à un niveau d'investissement réaliste (≈ +10 merges + dragonflowers + IV),
      // pas en 5★ neutre pur (sinon on sous-estime et aucune équipe ne clear une Infernal).
      const built = (s: Stats): Stats => ({
        hp: s.hp + 6, atk: s.atk + 5, spd: s.spd + 5, def: s.def + 5, res: s.res + 5,
      });
      // `base` = les effets RÉELS du kit natif (arme + spéciale + passives lus du learnset).
      // On ne fait que COMBLER les essentiels quasi universels qu'on inherit en pratique et
      // sans lesquels aucune équipe ne survit à une Infernal : une riposte (Distant Counter
      // au corps-à-corps), une spéciale offensive utilisable, et un peu de réduction de
      // dégâts sur les murs. Aucun cumul de stats par-dessus les passives natives.
      const gapFill = (h: Hero, s: Stats, base: CombatMods): CombatMods => {
        const w = h.weaponType;
        const melee = w === 'Sword' || w === 'Lance' || w === 'Axe' || w === 'Dragon' || w === 'Beast';
        const bulky = s.def >= 33 || s.res >= 33;
        // Spéciale offensive de repli si le kit natif n'en a pas (garde la native sinon).
        let special: SpecialInfo;
        if (s.def >= s.res && s.def >= 33) special = { maxCd: 3, kind: 'offense', addStatPct: { stat: 'def', pct: 50 } };
        else if (s.res >= 33) special = { maxCd: 3, kind: 'offense', addStatPct: { stat: 'res', pct: 50 } };
        else special = { maxCd: 2, kind: 'offense', defIgnorePct: 30 };
        const m: CombatMods = { ...base };
        m.special = base.special && base.special.kind === 'offense' ? base.special : special;
        m.counterAnyRange = base.counterAnyRange || melee;          // Distant/Close Counter inherit
        if (bulky) m.dmgReductionPct = Math.max(base.dmgReductionPct || 0, 25); // B de réduction inherit
        return m;
      };
      theoryUnits.current = new Map();
      const pool: SearchUnit[] = ranked.map(({ h, s }) => {
        const wi = wmap.get(h.id) ?? NO_WI;
        const hero = { id: h.id, name: h.name, title: h.title, color: h.color, weaponType: h.weaponType, moveType: h.moveType, rarity: 5, origin: '' } as Hero;
        const bs = built(s);
        hero.moveUrl = h.moveUrl; hero.weaponUrl = h.weaponUrl; // icônes réelles (déplacement + arme)
        const mods = gapFill(hero, bs, toMods(wi.effects, wi.effAgainst));
        theoryUnits.current.set(h.id, { stats: bs, mods }); // pour « charger » un héros non possédé
        return { id: h.id, name: h.name, title: h.title, unit: { hero, stats: bs, mods }, assist: wi.assistName ? detectAssist([wi.assistName]) : undefined };
      });

      const passive = /passive/i.test(wikiMap.globalai || '');
      const linked = /linked/i.test(wikiMap.globalai || '');
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
          pos: e.pos.toLowerCase(), hp: e.hp, active: !passive, refresher: isRefresher(e.skills), assist: detectAssist(e.skills), saveType: detectSave(e.skills),
          hasIceVein: detectDivineVeinIce(e.skills),
        };
      });
      launchShardedSearch(pool, enemyUnits, terrain, wikiMap.allyPos, linked, {
        maxTurns: Math.max(solveTurns, 6), perTeamBudget: 400_000, perTeamMs: 1500, globalMs: 150_000, allowDeaths: solveDeaths, maxWinners: 1,
      });
    } catch {
      setSearchRes({ teams: [], tested: 0, poolSize: 0, reason: 'Erreur pendant la préparation du théorycraft.' });
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
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-3 md:p-5 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative my-auto w-full max-w-5xl xl:max-w-7xl rounded-2xl border border-gold/30 bg-[#33291a] p-4 md:p-6 font-feh shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Fermer"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-warm-text hover:bg-black/65"
        >
          ✕
        </button>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gold/20 pb-2.5 pr-8">
          <div>
            <h2 className="font-feh text-[17px] font-semibold text-gold-text">
              ⚔️ Simulateur — mon équipe vs une carte
            </h2>
            <p className="text-[12px] text-warm-mute">
              Qui de ton équipe bat cette carte ?
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex overflow-hidden rounded-lg border border-white/10 text-[11px]">
              {(['wiki', 'manual', 'hero'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setEnMode(m)}
                  className={`px-2.5 py-1 font-feh transition ${
                    enMode === m ? 'bg-red-500/25 text-red-100 font-semibold' : 'text-warm-mute hover:text-warm-dim'
                  }`}
                >
                  {m === 'wiki' ? 'Carte (wiki)' : m === 'manual' ? 'Stats saisies' : 'Mes héros'}
                </button>
              ))}
            </div>
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
        </div>

        {/* Mode Héros */}
        {enMode === 'hero' ? (
          <div className="mb-4 rounded-xl border border-red-400/25 bg-red-950/20 p-3">
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
          </div>
        ) : null}

        {/* Mode Wiki (URL input) */}
        {enMode === 'wiki' ? (
          <div className="mb-3 rounded-xl border border-sky-400/20 bg-sky-950/20 p-2.5">
            <div className="flex gap-2">
              <input
                value={wikiUrl}
                onChange={(e) => setWikiUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadWiki()}
                placeholder="Colle l'URL du wiki (page « … (map) »)…"
                className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2.5 py-1.5 text-[12px] text-warm-text outline-none focus:border-gold/50"
              />
              <button
                type="button"
                onClick={loadWiki}
                disabled={wikiLoading || !wikiUrl.trim()}
                className="shrink-0 rounded border border-gold-deep/40 bg-black/30 px-3.5 py-1.5 font-feh text-[12px] font-semibold text-gold-text transition hover:border-gold/60 disabled:opacity-50"
              >
                {wikiLoading ? '…' : 'Charger'}
              </button>
            </div>
            {wikiError ? (
              <p className="mt-1.5 text-[11px] text-amber-300/85">{wikiError}</p>
            ) : null}
          </div>
        ) : null}

        {/* ===== VUE 2 COLONNES (CÔTE À CÔTE) LORSQU'UNE CARTE EST CHARGÉE ===== */}
        {enMode === 'wiki' && wikiMap ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* COLONNE GAUCHE (ÉCRAN 1) : CARTE INTERACTIVE, DRAG & DROP, PINCEAUX */}
            <div className="lg:col-span-5 xl:col-span-5 rounded-xl border border-red-400/25 bg-red-950/20 p-3 lg:sticky lg:top-2">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
                <span className="font-feh text-[12.5px] font-semibold text-red-200/90">
                  🗺️ Plateau & Déplacements
                </span>
                <div className="flex flex-wrap gap-1">
                  {Object.keys(wikiMap.difficulties).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setWikiDiff(d)}
                      className={`rounded px-2 py-0.5 font-feh text-[10.5px] transition ${
                        wikiDiff === d ? 'bg-gold-deep/50 text-warm-text font-semibold' : 'text-warm-mute hover:text-warm-dim'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
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
                liveOn={liveOn}
                liveEnemies={liveEnemies}
                liveAllies={liveAllies}
                onMoveEnemy={(i, pos) => {
                  if (!liveOn) {
                    initLive();
                    setLiveOn(true);
                  }
                  const e = (wikiMap.difficulties[wikiDiff] ?? [])[i];
                  setLiveEnemies((p) => ({ ...p, ['E' + i]: { ...(p['E' + i] ?? { pos: e?.pos.toLowerCase() ?? '', hp: e?.hp ?? 0 }), pos } }));
                }}
                onMoveAlly={(id, pos) => {
                  if (!liveOn) {
                    initLive();
                    setLiveOn(true);
                  }
                  const idx = team.indexOf(id);
                  const start = wikiMap.allyPos[idx]?.toLowerCase() ?? '';
                  const h = byId.get(id);
                  const s = h && (statsOverride.get(id) ?? resolveStats(h, stats.get(id)));
                  setLiveAllies((p) => ({ ...p, [id]: { ...(p[id] ?? { pos: start, hp: s ? s.hp : 0 }), pos } }));
                }}
              />

              <div className="mt-2 flex flex-wrap gap-1 justify-center">
                {(wikiMap.difficulties[wikiDiff] ?? []).map((u, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickWikiEnemy(u)}
                    title={`${u.hp}/${u.atk}/${u.spd}/${u.def}/${u.res} · ${u.weapon}`}
                    className={`rounded-md border px-1.5 py-0.5 text-[11px] transition ${
                      wikiSel === u.pos
                        ? 'border-gold/60 bg-gold-deep/25 text-gold-light font-semibold'
                        : 'border-white/10 bg-black/30 text-warm-text hover:border-gold/50 hover:text-gold-light'
                    }`}
                  >
                    {u.name}
                  </button>
                ))}
              </div>

              {/* Stats & Compétences de l'ennemi inspecté */}
              {enemyUnit ? (
                <div className="mt-2.5 rounded-lg border border-white/10 bg-black/35 p-2 text-[11px]">
                  <div className="flex items-center justify-between text-warm-dim mb-1">
                    <span className="font-semibold text-gold-text">{enemy.name || 'Ennemi sélectionné'}</span>
                    <span className="text-[10px] text-warm-mute">{enemy.weapon} · {enemy.move}</span>
                  </div>
                  <div className="grid grid-cols-5 gap-1 text-center">
                    {STAT_ROW.map((s) => (
                      <div key={s.key} className="rounded bg-black/30 py-0.5">
                        <span className="block text-[8px] uppercase tracking-wide text-warm-mute">{s.label}</span>
                        <span className="font-feh font-semibold text-warm-text">{enemy.stats[s.key] || '—'}</span>
                      </div>
                    ))}
                  </div>
                  {enemy.autoNote ? (
                    <p className="mt-1 text-[9.5px] text-emerald-300/85 leading-tight">{enemy.autoNote}</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* COLONNE DROITE (ÉCRAN 2) : SOLVEUR, PLAN ÉTAPE PAR ÉTAPE, RE-PLANIFICATION, RECHERCHE D'ÉQUIPE */}
            <div className="lg:col-span-7 xl:col-span-7 space-y-3">
              {/* ===== Solveur de carte (C3/C4) ===== */}
              <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/[0.06] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-fuchsia-400/20 pb-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={solving}
                      onClick={() => runSolver(liveOn ? { enemies: liveEnemies, allies: liveAllies } : undefined)}
                      className="rounded-lg border border-fuchsia-300/40 bg-fuchsia-500/25 px-3.5 py-1.5 font-feh text-[12.5px] font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/35 disabled:opacity-60"
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
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[11px] text-warm-mute">
                      tours :
                      <select
                        value={solveTurns}
                        onChange={(e) => setSolveTurns(+e.target.value)}
                        className="rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-warm-text font-semibold"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-warm-mute" title={wikiMap?.mustSurvive ? 'Carte de survie/défense : perdre un perso = défaite.' : 'Carte « Rout » : perdre une unité est permis.'}>
                      <input type="checkbox" checked={solveDeaths} onChange={(e) => setSolveDeaths(e.target.checked)} className="h-3.5 w-3.5 accent-fuchsia-400" />
                      pertes autorisées
                    </label>
                  </div>
                </div>

                {solving ? (
                  <div className="mt-2">
                    <ProgressBar color="bg-fuchsia-400/80" pct={((Date.now() - solveStart.current) / solveLimit.current) * 100} />
                  </div>
                ) : null}

                {solveRes ? (
                  <div className="mt-2 text-[11.5px]">
                    {solveRes.win ? (
                      <>
                        <p className="font-feh font-semibold text-emerald-300 text-[13px]">
                          ✅ {planStartTurn > 1
                            ? `Gagnable en ${solveRes.turns.length} tour(s) de plus (à partir du tour ${planStartTurn})`
                            : `Gagnable en ${solveRes.turns.length} tour(s)`} — plan des déplacements :
                        </p>
                        <div className="mt-2 max-h-[380px] overflow-y-auto pr-1">
                          <PlanSteps turns={solveRes.turns} startTurn={planStartTurn} />
                        </div>
                        <p className="mt-1 text-[9.5px] text-warm-mute/70">
                          {solveRes.nodes.toLocaleString('fr')} états explorés. Déplacements calculés pour le positionnement en cours.
                        </p>
                      </>
                    ) : (
                      <p className="text-amber-300/90">
                        ❓ {solveRes.reason}
                        <span className="text-warm-mute/70"> ({solveRes.nodes.toLocaleString('fr')} états explorés — augmente les tours, ou coche « autoriser les pertes ».)</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-1.5 text-[10.5px] text-warm-mute/80">
                    Trouve automatiquement la suite de déplacements & attaques pour nettoyer la carte.
                  </p>
                )}
              </div>

              {/* ===== Re-planification (combat en cours) ===== */}
              <div className="rounded-xl border border-sky-400/30 bg-sky-500/[0.06] p-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 font-feh text-[12.5px] font-semibold text-sky-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={liveOn}
                      onChange={(e) => { const on = e.target.checked; setLiveOn(on); if (on) initLive(); }}
                      className="h-4 w-4 accent-sky-400"
                    />
                    🔄 Combat en cours — re-planifier depuis l'état réel
                  </label>
                  {liveOn ? (
                    <button type="button" onClick={initLive} className="rounded border border-sky-300/40 px-2 py-0.5 text-[10.5px] text-sky-200 hover:bg-sky-500/15">
                      ↺ réinitialiser
                    </button>
                  ) : null}
                </div>

                {liveOn ? (
                  <div className="mt-2.5 space-y-2 text-[11px]">
                    <p className="text-[10px] leading-snug text-warm-mute/90">
                      💡 <strong>Glisse les ennemis ET tes persos directement sur la carte à gauche</strong> (Drag & Drop), ajuste les PV ci-dessous si besoin, puis relance le solveur.
                    </p>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] text-warm-dim">
                        Tour actuel :
                        <input type="number" min={2} value={liveTurn} onChange={(e) => setLiveTurn(Math.max(2, +e.target.value || 2))} className="w-12 rounded bg-black/40 px-1.5 py-0.5 text-center text-warm-text font-bold" />
                      </label>
                      <button
                        type="button"
                        disabled={solving}
                        onClick={() => runSolver({ enemies: liveEnemies, allies: liveAllies })}
                        className="ml-auto rounded-lg border border-sky-300/50 bg-sky-500/25 px-3 py-1 font-feh text-[12px] font-semibold text-sky-100 transition hover:bg-sky-500/35 disabled:opacity-50"
                      >
                        🔄 Re-calculer le plan
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                      <div className="rounded-lg bg-black/25 p-2">
                        <p className="font-feh text-[10.5px] font-semibold text-rose-300/90 mb-1">Ennemis (PV & position)</p>
                        {(wikiMap.difficulties[wikiDiff] ?? []).map((e, i) => {
                          const k = 'E' + i;
                          const ov = liveEnemies[k] ?? { pos: e.pos.toLowerCase(), hp: e.hp };
                          return (
                            <div key={k} className={`flex items-center gap-1.5 py-0.5 ${ov.dead ? 'opacity-40' : ''}`}>
                              <span className="w-20 truncate text-[10.5px] text-warm-dim">{e.name.split(':')[0]}</span>
                              <input value={ov.pos} onChange={(ev) => setLiveEnemies((p) => ({ ...p, [k]: { ...ov, pos: ev.target.value.toLowerCase().replace(/[^a-f1-8]/g, '') } }))} placeholder="c5" className="w-9 rounded bg-black/40 px-1 py-0.5 text-center text-[11px] text-warm-text" />
                              <input type="number" value={ov.hp} onChange={(ev) => setLiveEnemies((p) => ({ ...p, [k]: { ...ov, hp: +ev.target.value || 0 } }))} className="w-12 rounded bg-black/40 px-1 py-0.5 text-center text-[11px] text-warm-text" />
                              <label className="ml-auto flex items-center gap-1 text-[10px] text-warm-mute"><input type="checkbox" checked={!!ov.dead} onChange={(ev) => setLiveEnemies((p) => ({ ...p, [k]: { ...ov, dead: ev.target.checked } }))} className="h-3 w-3 accent-rose-400" />K.O.</label>
                            </div>
                          );
                        })}
                      </div>
                      <div className="rounded-lg bg-black/25 p-2">
                        <p className="font-feh text-[10.5px] font-semibold text-emerald-300/90 mb-1">Tes persos (PV & position)</p>
                        {team.map((id, i) => {
                          if (i >= wikiMap.allyPos.length) return null;
                          const h = byId.get(id);
                          if (!h) return null;
                          const ov = liveAllies[id] ?? { pos: wikiMap.allyPos[i].toLowerCase(), hp: 0 };
                          return (
                            <div key={id} className={`flex items-center gap-1.5 py-0.5 ${ov.dead ? 'opacity-40' : ''}`}>
                              <span className="w-20 truncate text-[10.5px] text-warm-dim">{h.name}</span>
                              <input value={ov.pos} onChange={(ev) => setLiveAllies((p) => ({ ...p, [id]: { ...ov, pos: ev.target.value.toLowerCase().replace(/[^a-f1-8]/g, '') } }))} placeholder="c2" className="w-9 rounded bg-black/40 px-1 py-0.5 text-center text-[11px] text-warm-text" />
                              <input type="number" value={ov.hp} onChange={(ev) => setLiveAllies((p) => ({ ...p, [id]: { ...ov, hp: +ev.target.value || 0 } }))} className="w-12 rounded bg-black/40 px-1 py-0.5 text-center text-[11px] text-warm-text" />
                              <label className="ml-auto flex items-center gap-1 text-[10px] text-warm-mute"><input type="checkbox" checked={!!ov.dead} onChange={(ev) => setLiveAllies((p) => ({ ...p, [id]: { ...ov, dead: ev.target.checked } }))} className="h-3 w-3 accent-rose-400" />K.O.</label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* ===== Recherche d'équipe ===== */}
              <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/[0.06] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={searching}
                    onClick={runTeamSearch}
                    className="rounded-lg border border-cyan-300/40 bg-cyan-500/20 px-3 py-1.5 font-feh text-[12px] font-semibold text-cyan-100 transition hover:bg-cyan-500/30 disabled:opacity-60"
                  >
                    {searching && searchScope === 'roster'
                      ? `⏳ équipe ${searchProg.tested}/${searchProg.total || '…'}…`
                      : '🔎 Équipe (ta collection)'}
                  </button>
                  <button
                    type="button"
                    disabled={searching}
                    onClick={runTheoryCraft}
                    title="Cherche parmi TOUS les héros du jeu une équipe qui nettoie la carte"
                    className="rounded-lg border border-violet-300/40 bg-violet-500/20 px-3 py-1.5 font-feh text-[12px] font-semibold text-violet-100 transition hover:bg-violet-500/30 disabled:opacity-60"
                  >
                    {searching && searchScope === 'game'
                      ? `⏳ équipe ${searchProg.tested}/${searchProg.total || '…'}…`
                      : '🔮 Meilleure équipe (tout le jeu)'}
                  </button>
                  {searching ? (
                    <button
                      type="button"
                      onClick={() => {
                        stopSearchWorkers();
                        setSearching(false);
                        setSearchRes({ teams: [], tested: searchProg.tested, poolSize: 0, reason: 'Recherche arrêtée.' });
                      }}
                      className="rounded-lg border border-red-300/40 bg-red-500/15 px-2.5 py-1.5 font-feh text-[12px] text-red-200 transition hover:bg-red-500/25"
                    >
                      ✕ Stop
                    </button>
                  ) : null}
                </div>
                {searching ? (
                  <div className="mt-2">
                    <ProgressBar
                      color="bg-cyan-400/80"
                      indeterminate={!searchProg.total}
                      pct={searchProg.total ? (searchProg.tested / searchProg.total) * 100 : 0}
                    />
                  </div>
                ) : null}
                {searchRes ? (
                  searchRes.teams.length ? (
                    <div className="mt-2 text-[11.5px]">
                      <p className="font-feh font-semibold text-emerald-300">
                        ✅ {searchRes.teams.length > 1
                          ? `${searchRes.teams.length} équipes qui nettoient la carte`
                          : 'Meilleure équipe trouvée'}{searchScope === 'game' ? ' (héros du jeu)' : ''} :
                      </p>
                      <ul className="mt-1 space-y-1">
                        {searchRes.teams.map((t, i) => (
                          <li key={i} className="rounded bg-black/25 px-2 py-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-warm-dim">
                                {t.names.map((n, j) => {
                                  const mUrl = t.moveUrls?.[j] ?? byId.get(t.ids[j])?.moveUrl;
                                  const wUrl = t.weaponUrls?.[j] ?? byId.get(t.ids[j])?.weaponUrl;
                                  return (
                                  <span key={j} className="inline-flex items-center gap-0.5">
                                    <MoveIcon type={t.moves?.[j] as MoveType} iconUrl={mUrl} size={14} />
                                    <WeaponIcon type={t.weapons?.[j] as WeaponType} iconUrl={wUrl} size={14} />
                                    <span>{n}{t.titles?.[j] ? <span className="text-warm-mute/70"> : {t.titles[j]}</span> : null}</span>
                                    {builtIds.has(t.ids[j]) ? (
                                      <span title="Build enregistré (kit exact)" className="rounded bg-emerald-500/25 px-1 text-[8.5px] font-semibold text-emerald-200">build</span>
                                    ) : (
                                      <span title="Kit natif complet du learnset" className="rounded bg-white/10 px-1 text-[8.5px] text-warm-mute">kit natif</span>
                                    )}
                                    {j < t.names.length - 1 ? <span className="text-warm-mute/50">·</span> : null}
                                  </span>
                                  );
                                })}
                              </span>
                              <span className="text-[10px] text-warm-mute">({t.turns} tour{t.turns > 1 ? 's' : ''})</span>
                              <div className="ml-auto flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setOpenPlan(openPlan === i ? null : i)}
                                  className="rounded border border-amber-300/40 bg-amber-500/10 px-2 py-0.5 text-[10.5px] text-amber-200 hover:bg-amber-500/20"
                                >
                                  {openPlan === i ? '▾ masquer' : '▸ voir le plan'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => loadTeam(t)}
                                  className="rounded border border-emerald-300/40 bg-emerald-500/15 px-2 py-0.5 text-[10.5px] text-emerald-200 hover:bg-emerald-500/25"
                                >
                                  charger
                                </button>
                              </div>
                            </div>
                            {openPlan === i ? (
                              <div className="mt-1.5 border-t border-white/10 pt-1.5">
                                <PlanSteps turns={t.plan} />
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-2 text-[11.5px] text-amber-300/90">❓ {searchRes.reason}</p>
                  )
                ) : null}
              </div>

              {/* ===== Mon équipe & Duels 1v1 ===== */}
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="mb-1 font-feh text-[12px] font-semibold text-warm-dim">
                  👥 Mon équipe ({team.length}) — Duels 1v1 face à {enemy.name || 'l\'ennemi'}
                </div>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setListOpen(true)}
                  onBlur={() => setTimeout(() => setListOpen(false), 150)}
                  placeholder="Ajouter des persos à l'équipe…"
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-[12px] text-warm-text outline-none focus:border-gold/50"
                />
                {listOpen ? (
                  <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-white/10 bg-black/70">
                    {filtered.slice(0, 30).map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => toggleMember(h.id)}
                        className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] text-warm-text hover:bg-white/[0.06]"
                      >
                        <span className="min-w-0 flex-1 truncate">{h.name} <span className="text-warm-mute">— {h.title}</span></span>
                        {team.includes(h.id) ? <span className="text-emerald-300 text-[11px]">✓</span> : <span className="text-warm-mute text-[11px]">+</span>}
                      </button>
                    ))}
                  </div>
                ) : null}

                {team.length > 0 && (
                  <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {results.map((r) => (
                      <UnitRow
                        key={r.id} hero={r.unit.hero} sim={r.sim} foe={r.foe}
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
              </div>
            </div>
          </div>
        ) : (
          /* MODE MANUEL OU INITIAL SANS CARTE WIKI */
          <div className="space-y-4">
            <div className="rounded-xl border border-red-400/25 bg-red-950/20 p-3">
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
            </div>

            {/* Ajouter des persos */}
            <div>
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
                  {filtered.slice(0, 40).map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => toggleMember(h.id)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-warm-text hover:bg-white/[0.06]"
                    >
                      <span className="min-w-0 flex-1 truncate">{h.name} <span className="text-warm-mute">— {h.title}</span></span>
                      {team.includes(h.id) ? <span className="text-emerald-300">✓</span> : <span className="text-warm-mute">+</span>}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Résultats */}
            {team.length > 0 && (
              <div className="space-y-2">
                {results.map((r) => (
                  <UnitRow
                    key={r.id} hero={r.unit.hero} sim={r.sim} foe={r.foe}
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
          </div>
        )}

        <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-warm-mute/80">
          <strong className="text-amber-300/90">Estimation tactique.</strong> Auto depuis tes armes et compétences :
          efficacité, Brave, bonus en combat, réduction de dégâts, Veines divines (Glace), compétences Save/Garde.
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
  ice: 'bg-cyan-400/60 border border-cyan-200/80 shadow-[inset_0_0_6px_rgba(56,189,248,0.6)]',
};
const BRUSHES: { t: Terrain; label: string }[] = [
  { t: 'plain', label: 'Plaine' }, { t: 'wall', label: 'Mur' },
  { t: 'forest', label: 'Forêt' }, { t: 'water', label: 'Eau' },
  { t: 'fort', label: 'Fort' }, { t: 'ice', label: '🧊 Glace' },
];

function MapGrid({
  enemies, allyPos, team, selectedPos, heroByName, onPick, wikiTerrain, mapKey, mapImageUrl,
  liveOn = false, liveEnemies = {}, liveAllies = {}, onMoveEnemy, onMoveAlly,
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
  liveOn?: boolean;
  liveEnemies?: Record<string, LiveOv>;
  liveAllies?: Record<string, LiveOv>;
  onMoveEnemy?: (idx: number, pos: string) => void;
  onMoveAlly?: (id: string, pos: string) => void;
}) {
  // Pion en cours de glisser (mode live) : ennemi (index) ou allié (id du héros).
  const drag = useRef<{ kind: 'e'; idx: number } | { kind: 'a'; id: string } | null>(null);
  const liveDrag = (!!onMoveEnemy || !!onMoveAlly);
  const [showImage, setShowImage] = useState(true);
  // Auto-réparation : si l'URL de l'image manque (carte en cache), on la résout du titre.
  const [imgUrl, setImgUrl] = useState<string | undefined>(mapImageUrl);
  useEffect(() => { setImgUrl(mapImageUrl); }, [mapImageUrl]);
  useEffect(() => {
    if (imgUrl || !mapKey) return;
    let active = true;
    resolveMapImage(mapKey).then((u) => { if (active && u) setImgUrl(u); });
    return () => { active = false; };
  }, [imgUrl, mapKey]);
  const bg = Boolean(imgUrl) && showImage; // image de fond active
  // Positions des ennemis : celles du wiki, sauf en mode « combat en cours » où on
  // prend les positions/K.O. réels saisis (glissés à la souris). enemyIdxAt = case→index.
  const enemyAt = new Map<string, WikiEnemy>();
  const enemyIdxAt = new Map<string, number>();
  enemies.forEach((e, i) => {
    const ov = liveOn ? liveEnemies['E' + i] : undefined;
    if (ov?.dead) return;
    const pos = (ov?.pos || e.pos).toLowerCase();
    enemyAt.set(pos, e);
    enemyIdxAt.set(pos, i);
  });
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

  // Alliés posés : sur leur case de départ, ou leur position live (mode « combat en cours »).
  // Les alliés marqués K.O. (pertes autorisées) sont retirés de la grille.
  const allyEffPos = (i: number) => (liveOn ? liveAllies[team[i]?.id]?.pos : '') || allyOrder[i];
  const placed = team
    .map((h, i) => ({ hero: h, idx: i, pos: allyEffPos(i), dead: liveOn && !!liveAllies[h.id]?.dead }))
    .filter((p) => p.pos && !p.dead);
  const allyAt = new Map(placed.map((p) => [p.pos, p]));

  const enemyPos = new Set(enemyAt.keys());
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
    <div className="mx-auto mt-2 w-full max-w-[320px] sm:max-w-[340px]">
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
      {imgUrl ? (
        <label className="mb-1 flex items-center justify-center gap-1 text-[9.5px] text-warm-mute">
          <input type="checkbox" checked={showImage} onChange={(e) => setShowImage(e.target.checked)} className="h-3 w-3 accent-gold" />
          image de la carte en fond
        </label>
      ) : null}
      {/* Repères : lettres (colonnes) au-dessus, numéros (lignes) à gauche. */}
      <div className="flex">
        <span className="shrink-0" style={{ width: 13 }} />
        <div className="grid flex-1 gap-[2px]" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          {cols.map((c) => (
            <div key={c} className="text-center text-[8.5px] font-bold uppercase text-warm-mute/70">{c}</div>
          ))}
        </div>
      </div>
      <div className="flex">
        <div className="mr-[2px] flex shrink-0 flex-col gap-[2px]" style={{ width: 13 }}>
          {rows.map((r) => (
            <div key={r} className="flex flex-1 items-center justify-center text-[8.5px] font-bold text-warm-mute/70">{r}</div>
          ))}
        </div>
        <div className="relative flex-1">
        {bg ? (
          <img src={imgUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full rounded-[4px] object-cover opacity-90" />
        ) : null}
        <div className="relative grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {rows.flatMap((r) =>
          cols.map((c) => {
            const pos = c + r;
            const en = enemyAt.get(pos);
            const isStart = allyOrder.indexOf(pos) >= 0; // case de départ (▲ / teinte)
            const al = allyAt.get(pos); // allié réellement sur cette case (départ ou live)
            const isAlly = isStart || !!al;
            const ally = al?.hero; // ton perso posé sur cette case
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
                onDragOver={liveDrag ? (ev) => ev.preventDefault() : undefined}
                onDrop={liveDrag ? () => { const d = drag.current; drag.current = null; if (!d) return; if (d.kind === 'e') onMoveEnemy?.(d.idx, pos); else onMoveAlly?.(d.id, pos); } : undefined}
                className={`relative aspect-square rounded-[3px] border ${
                  isAlly ? 'border-sky-400/40' : 'border-white/[0.06]'
                } ${terrBg} ${isThreat ? 'shadow-[inset_0_0_0_2px_rgba(248,113,113,0.55)]' : ''} ${liveDrag ? 'ring-1 ring-inset ring-sky-400/20' : ''}`}
              >
                {overlay ? <span className={`pointer-events-none absolute inset-0 rounded-[3px] ${overlay}`} /> : null}
                {en ? (
                  <button
                    type="button"
                    draggable={liveDrag && !!onMoveEnemy}
                    onDragStart={onMoveEnemy ? () => { const i = enemyIdxAt.get(pos); if (i != null) drag.current = { kind: 'e', idx: i }; } : undefined}
                    onClick={() => onPick(en)}
                    title={liveOn ? `${en.name} — glisse-le à sa position réelle` : `${en.name} — ${en.hp}/${en.atk}/${en.spd}/${en.def}/${en.res}`}
                    className={`absolute inset-0 flex items-center justify-center rounded-[3px] transition ${
                      selectedPos === pos ? 'ring-2 ring-gold' : 'hover:brightness-125'
                    } ${liveDrag && onMoveEnemy ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                    {hero?.art ? (
                      <img src={hero.art} alt={en.name} draggable={false} className="h-full w-full object-contain" />
                    ) : (
                      <span
                        className={`pointer-events-none flex h-[72%] w-[72%] items-center justify-center rounded-full text-[8px] font-bold text-black/80 ${
                          COLOR_BG[resolveEnemy(en, heroByName).color] ?? 'bg-slate-300/80'
                        }`}
                      >
                        {shortLabel(en.name)}
                      </span>
                    )}
                  </button>
                ) : ally ? (
                  <span
                    draggable={liveDrag && !!onMoveAlly}
                    onDragStart={onMoveAlly ? () => { drag.current = { kind: 'a', id: ally.id }; } : undefined}
                    className={`absolute inset-0 flex items-center justify-center ${liveDrag && onMoveAlly ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    title={liveOn ? `${ally.name} — glisse-le à sa position réelle` : `${ally.name} — ${ally.title}`}
                  >
                    {ally.art ? (
                      <img src={ally.art} alt={ally.name} className="pointer-events-none h-full w-full object-contain" />
                    ) : (
                      <span className="pointer-events-none flex h-[72%] w-[72%] items-center justify-center rounded-full bg-sky-500/70 text-[8px] font-bold text-black/80">
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
  hero, sim, foe, enemy, unit, expanded, onToggle, onRemove, mods, onMods, weaponInfo,
}: {
  hero: Hero; sim: Sim; foe: Sim | null; enemy: Unit; unit: Unit;
  expanded: boolean; onToggle: () => void; onRemove: () => void;
  mods: UnitMods; onMods: (m: UnitMods) => void; weaponInfo?: WeaponInfo;
}) {
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden">
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

// Jauge de progression. `pct` = 0..100 ; `indeterminate` = animation sans valeur.
function ProgressBar({ pct, indeterminate, color }: { pct?: number; indeterminate?: boolean; color: string }) {
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/40">
      {indeterminate ? (
        <div className={`h-full w-1/3 animate-pulse rounded-full ${color}`} />
      ) : (
        <div className={`h-full rounded-full ${color} transition-[width] duration-200`} style={{ width: `${Math.min(100, Math.max(2, pct ?? 0))}%` }} />
      )}
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
