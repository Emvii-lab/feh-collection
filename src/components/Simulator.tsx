import { useEffect, useMemo, useState } from 'react';
import type { Color, Hero, WeaponType } from '../types';
import type { CollStats } from '../lib/collection';
import {
  resolveStats, simulate, verdictOf,
  NO_MODS, type Sim, type Unit, type Verdict,
} from '../lib/combat';
import { fetchTeamWeapons, type WeaponInfo } from '../lib/simWeapons';
import {
  fetchWikiMap, parsePageTitle, resolveEnemy,
  type WikiEnemy, type WikiMap,
} from '../lib/wikiMap';

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
const NO_WI: WeaponInfo = {
  brave: false, effAgainst: [], atkBuff: 0, spdBuff: 0, defBuff: 0, resBuff: 0,
};

type EnemyState = {
  color: Color; weapon: WeaponType; move: string;
  stats: Record<StatKey, string>;
  brave: boolean; effAgainst: string[]; atkBuff: number; dmgReductionPct: number;
  guaranteedFollowup: boolean; cannotBeDoubled: boolean; vantage: boolean;
};
type UnitMods = { atkBuff: number; guaranteedFollowup: boolean; dmgReductionPct: number };

const VERDICT_META: Record<Verdict, { label: string; cls: string; order: number }> = {
  ko: { label: 'K.O. la carte', cls: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200', order: 0 },
  win: { label: 'Gagne l’échange', cls: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200/90', order: 1 },
  trade: { label: 'Échange (les 2 vivent)', cls: 'border-gold-deep/40 bg-black/25 text-gold-text', order: 2 },
  lose: { label: 'Se fait tuer', cls: 'border-red-400/40 bg-red-500/15 text-red-200', order: 3 },
};

export function Simulator({
  heroes, owned, stats, initialAttacker, onClose,
}: {
  heroes: Hero[];
  owned: Set<string>;
  stats: Map<string, CollStats>;
  initialAttacker: Hero | null;
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

  const [team, setTeam] = useState<string[]>(
    initialAttacker && roster.some((h) => h.id === initialAttacker.id) ? [initialAttacker.id] : [],
  );
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(initialAttacker?.id ?? null);
  const [unitMods, setUnitMods] = useState<Map<string, UnitMods>>(new Map());
  const [advEnemy, setAdvEnemy] = useState(false);
  // Ennemi : carte du wiki, saisie manuelle, ou un de tes héros.
  const [enMode, setEnMode] = useState<'wiki' | 'manual' | 'hero'>('wiki');
  const [enemyHeroId, setEnemyHeroId] = useState('');
  // Chargement d'une carte depuis le wiki FEH.
  const [wikiUrl, setWikiUrl] = useState('');
  const [wikiMap, setWikiMap] = useState<WikiMap | null>(null);
  const [wikiDiff, setWikiDiff] = useState('');
  const [wikiLoading, setWikiLoading] = useState(false);
  const [wikiError, setWikiError] = useState<string | null>(null);
  const [wikiSel, setWikiSel] = useState(''); // pos de l'ennemi sélectionné
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

  const pickWikiEnemy = (u: WikiEnemy) => {
    setWikiSel(u.pos);
    const r = resolveEnemy(u, heroByName);
    setEnemy((e) => ({
      ...e, color: r.color, weapon: r.weaponType, move: r.moveType,
      stats: {
        hp: String(r.hp), atk: String(r.atk), spd: String(r.spd),
        def: String(r.def), res: String(r.res),
      },
    }));
  };

  const [enemy, setEnemy] = useState<EnemyState>({
    color: 'red', weapon: 'Sword', move: 'Infantry',
    stats: { hp: '', atk: '', spd: '', def: '', res: '' },
    brave: false, effAgainst: [], atkBuff: 0, dmgReductionPct: 0,
    guaranteedFollowup: false, cannotBeDoubled: false, vantage: false,
  });

  // Armes (efficacité/Brave) des membres de l'équipe (+ l'ennemi s'il est un héros).
  const [weaponInfo, setWeaponInfo] = useState<Map<string, WeaponInfo>>(new Map());
  useEffect(() => {
    const ids = [...team, ...(enMode === 'hero' && enemyHeroId ? [enemyHeroId] : [])];
    const missing = ids.filter((id) => !weaponInfo.has(id));
    if (missing.length === 0) return;
    let active = true;
    fetchTeamWeapons(missing).then((m) => {
      if (!active) return;
      setWeaponInfo((prev) => {
        const next = new Map(prev);
        for (const id of missing) next.set(id, m.get(id) ?? NO_WI);
        return next;
      });
    });
    return () => { active = false; };
  }, [team, enMode, enemyHeroId, weaponInfo]);

  // Modificateurs manuels de l'ennemi (avancé), communs aux deux modes.
  const enemyMods = {
    ...NO_MODS, brave: enemy.brave, effAgainst: enemy.effAgainst, atkBuff: enemy.atkBuff,
    dmgReductionPct: enemy.dmgReductionPct, guaranteedFollowup: enemy.guaranteedFollowup,
    cannotBeDoubled: enemy.cannotBeDoubled, vantage: enemy.vantage,
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
        mods: { ...enemyMods, brave: enemyMods.brave || wi.brave,
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
    return {
      hero: h, stats: s,
      mods: {
        ...NO_MODS, brave: wi.brave, effAgainst: wi.effAgainst,
        // bonus en combat auto (arme) + réglage manuel de l'ATQ
        atkBuff: wi.atkBuff + pu.atkBuff,
        spdBuff: wi.spdBuff, defBuff: wi.defBuff, resBuff: wi.resBuff,
        guaranteedFollowup: pu.guaranteedFollowup, dmgReductionPct: pu.dmgReductionPct,
      },
    };
  };

  const results = useMemo(() => {
    if (!enemyUnit) return [];
    return team
      .map((id) => {
        const u = buildUnit(id);
        if (!u) return null;
        const sim = simulate(u, enemyUnit);
        return { id, unit: u, sim, verdict: verdictOf(sim) };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => VERDICT_META[a.verdict].order - VERDICT_META[b.verdict].order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, enemyUnit, weaponInfo, unitMods, stats]);

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
                        Clique un ennemi → ses stats se remplissent (ajuste couleur/arme si besoin).
                      </p>
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
                key={r.id} hero={r.unit.hero} sim={r.sim} verdict={r.verdict}
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
          Auto-détecté depuis tes armes : <strong className="text-warm-dim">efficacité</strong>, <strong className="text-warm-dim">Brave</strong>,
          et les <strong className="text-warm-dim">bonus en combat de l'arme</strong> (ex. « ATQ/VIT/DÉF/RÉS+5 »).
          Mais l'app ne connaît <strong className="text-warm-dim">pas tes passifs A/B/C ni tes spéciales équipés</strong> —
          ajoute-les à la main par unité (▾), sinon le simulateur sous-estime ta survie.
          Formule : ATQ (±20 % triangle, ×1,5 si efficace) − DÉF/RÉS, doublon si VIT ≥ +5 ou garanti.
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
function MapGrid({
  enemies, allyPos, team, selectedPos, heroByName, onPick,
}: {
  enemies: WikiEnemy[];
  allyPos: string[];
  team: Hero[];
  selectedPos: string;
  heroByName: (n: string) => Hero | undefined;
  onPick: (u: WikiEnemy) => void;
}) {
  const enemyAt = new Map(enemies.map((e) => [e.pos.toLowerCase(), e]));
  const allyOrder = allyPos.map((p) => p.toLowerCase()); // ordonné : 1re case → 1er perso
  const cols = ['a', 'b', 'c', 'd', 'e', 'f'];
  const rows = [8, 7, 6, 5, 4, 3, 2, 1]; // rangée 8 en haut (camp ennemi)
  return (
    <div className="mx-auto mt-2 w-full max-w-[288px]">
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {rows.flatMap((r) =>
          cols.map((c) => {
            const pos = c + r;
            const en = enemyAt.get(pos);
            const allyIdx = allyOrder.indexOf(pos);
            const isAlly = allyIdx >= 0;
            const ally = isAlly ? team[allyIdx] : undefined; // ton perso posé sur cette case
            const hero = en ? heroByName(en.name) : undefined;
            return (
              <div
                key={pos}
                className={`relative aspect-square rounded-[3px] border ${
                  isAlly ? 'border-sky-400/40 bg-sky-500/10' : 'border-white/[0.06] bg-black/25'
                }`}
              >
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
              </div>
            );
          }),
        )}
      </div>
      <div className="mt-1 flex items-center justify-center gap-3 text-[9.5px] text-warm-mute">
        <span><span className="text-sky-300">▲</span> départ allié</span>
        <span>· rangée 8 (haut) = ennemis</span>
      </div>
    </div>
  );
}

function UnitRow({
  hero, sim, verdict, enemy, unit, expanded, onToggle, onRemove, mods, onMods, weaponInfo,
}: {
  hero: Hero; sim: Sim; verdict: Verdict; enemy: Unit; unit: Unit;
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
          <Result sim={sim} atk={unit} def={enemy} />
          <div className="mt-3 space-y-1.5 border-t border-white/10 pt-2 text-[11.5px]">
            {weaponInfo ? (
              <p className="text-emerald-300/80">
                Auto (arme) :{' '}
                {[
                  weaponInfo.brave ? 'Brave' : '',
                  weaponInfo.effAgainst.length
                    ? `eff. vs ${weaponInfo.effAgainst.map((e) => EFF_LABEL[e] ?? e).join(', ')}`
                    : '',
                  [
                    weaponInfo.atkBuff ? `ATQ+${weaponInfo.atkBuff}` : '',
                    weaponInfo.spdBuff ? `VIT+${weaponInfo.spdBuff}` : '',
                    weaponInfo.defBuff ? `DÉF+${weaponInfo.defBuff}` : '',
                    weaponInfo.resBuff ? `RÉS+${weaponInfo.resBuff}` : '',
                  ].filter(Boolean).join(' '),
                ].filter(Boolean).join(' · ') || 'aucun bonus détecté'}
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
