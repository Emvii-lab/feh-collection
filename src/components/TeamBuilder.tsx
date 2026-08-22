import { useMemo, useState } from 'react';
import type { Color, Hero } from '../types';
import { statTotal, type CollStats } from '../lib/collection';
import { COLOR_LABEL } from '../theme';

const COLORS: Color[] = ['red', 'blue', 'green', 'colorless'];

// Métriques de tri/classement.
const METRICS: { key: string; label: string }[] = [
  { key: 'total', label: 'Total' },
  { key: 'ATQ', label: 'Attaque' },
  { key: 'VIT', label: 'Vitesse' },
  { key: 'PV', label: 'PV' },
  { key: 'DEF', label: 'Défense' },
  { key: 'RES', label: 'Résistance' },
];

function metricValue(s: CollStats | undefined, key: string): number {
  if (!s) return 0;
  if (key === 'total') return statTotal(s);
  return (s[key as keyof CollStats] ?? 0) as number;
}

type Enriched = { hero: Hero; stats: CollStats | undefined; total: number };

export function TeamBuilder({
  heroes,
  owned,
  stats,
  onSelectHero,
  onSimulate,
}: {
  heroes: Hero[];
  owned: Set<string>;
  stats: Map<string, CollStats>;
  onSelectHero: (h: Hero) => void;
  onSimulate?: () => void; // ouvre le simulateur de combat intégré
}) {
  const [metric, setMetric] = useState('total');
  const [color, setColor] = useState<Color | 'all'>('all');
  const [weapon, setWeapon] = useState('all');
  const [move, setMove] = useState('all');

  // Héros possédés enrichis de leurs stats.
  const ownedHeroes = useMemo<Enriched[]>(
    () =>
      heroes
        .filter((h) => owned.has(h.id))
        .map((h) => {
          const s = stats.get(h.id);
          return { hero: h, stats: s, total: statTotal(s) };
        }),
    [heroes, owned, stats],
  );

  const weapons = useMemo(
    () => [...new Set(ownedHeroes.map((e) => e.hero.weaponType))].sort(),
    [ownedHeroes],
  );
  const moves = useMemo(
    () => [...new Set(ownedHeroes.map((e) => e.hero.moveType))].sort(),
    [ownedHeroes],
  );

  // Meilleur héros par couleur (par total de stats).
  const bestByColor = useMemo(() => {
    const m = new Map<Color, Enriched>();
    for (const e of ownedHeroes) {
      const cur = m.get(e.hero.color);
      if (!cur || e.total > cur.total) m.set(e.hero.color, e);
    }
    return m;
  }, [ownedHeroes]);

  // Classement filtré + trié.
  const ranked = useMemo(() => {
    return ownedHeroes
      .filter((e) => color === 'all' || e.hero.color === color)
      .filter((e) => weapon === 'all' || e.hero.weaponType === weapon)
      .filter((e) => move === 'all' || e.hero.moveType === move)
      .sort(
        (a, b) =>
          metricValue(b.stats, metric) - metricValue(a.stats, metric) ||
          b.total - a.total ||
          a.hero.name.localeCompare(b.hero.name),
      );
  }, [ownedHeroes, color, weapon, move, metric]);

  if (ownedHeroes.length === 0) {
    return (
      <div className="mx-auto max-w-5xl">
        <p className="rounded-2xl border border-white/10 bg-[rgba(20,15,9,.55)] p-6 text-center text-sm text-warm-dim">
          Aucun héros possédé pour l'instant. Ajoute des héros à ta collection et
          saisis leurs stats pour voir tes meilleurs persos.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Accès au simulateur de combat intégré */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSimulate}
          title="Ouvrir le simulateur de combat"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gold-deep/40 bg-black/30 px-3 py-1.5 font-feh text-[12.5px] font-semibold text-gold-text transition hover:border-gold/60 hover:text-gold-light"
        >
          ⚔️ Simuler un combat
        </button>
      </div>

      {/* Meilleure équipe par couleur */}
      <div className="rounded-2xl border border-gold-deep/40 bg-[rgba(20,15,9,.6)] p-5 shadow-card">
        <h3 className="mb-1 font-feh text-[15px] font-semibold tracking-wide text-gold-text">
          Meilleure équipe — triangle des couleurs
        </h3>
        <p className="mb-4 text-[12px] text-warm-mute">
          Ton plus gros total par couleur. Rouge &gt; Vert &gt; Bleu &gt; Rouge ·
          l'incolore est neutre.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COLORS.map((c) => {
            const e = bestByColor.get(c);
            return (
              <div
                key={c}
                className="rounded-xl border border-white/10 bg-black/25 p-3 text-center"
              >
                <div className="mb-2 font-feh text-[12px] font-semibold text-warm-dim">
                  {COLOR_LABEL[c]}
                </div>
                {e ? (
                  <button
                    onClick={() => onSelectHero(e.hero)}
                    className="group w-full transition hover:brightness-110"
                  >
                    <img
                      src={e.hero.art}
                      alt={e.hero.name}
                      className="mx-auto h-16 w-16 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,.5)]"
                    />
                    <div className="mt-1 truncate font-feh text-[13px] text-warm-text">
                      {e.hero.name}
                    </div>
                    <div className="font-feh text-[13px] font-bold text-gold-text">
                      {e.total || '—'}
                    </div>
                  </button>
                ) : (
                  <div className="py-6 text-[12px] text-warm-mute">aucun</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Classement */}
      <div className="rounded-2xl border border-white/10 bg-[rgba(20,15,9,.55)] p-5 shadow-card">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <h3 className="mr-auto font-feh text-[15px] font-semibold tracking-wide text-gold-text">
            Top 10
            {ranked.length > 10 ? (
              <span className="ml-1 text-[12px] font-normal text-warm-mute">
                / {ranked.length} possédés
              </span>
            ) : null}
          </h3>
          <Select label="Trier par" value={metric} onChange={setMetric}>
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
          <Select label="Couleur" value={color} onChange={(v) => setColor(v as Color | 'all')}>
            <option value="all">Toutes</option>
            {COLORS.map((c) => (
              <option key={c} value={c}>
                {COLOR_LABEL[c]}
              </option>
            ))}
          </Select>
          <Select label="Arme" value={weapon} onChange={setWeapon}>
            <option value="all">Toutes</option>
            {weapons.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
          <Select label="Déplacement" value={move} onChange={setMove}>
            <option value="all">Tous</option>
            {moves.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          {ranked.slice(0, 10).map((e, i) => (
            <button
              key={e.hero.id}
              onClick={() => onSelectHero(e.hero)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.05]"
            >
              <span className="w-6 shrink-0 text-right font-feh text-[12px] text-warm-mute">
                {i + 1}
              </span>
              <img
                src={e.hero.art}
                alt=""
                className="h-10 w-10 shrink-0 object-contain"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-warm-text">
                  {e.hero.name}
                  <span className="text-warm-mute"> · {e.hero.title}</span>
                </div>
                <div className="truncate text-[11px] text-warm-mute">
                  {COLOR_LABEL[e.hero.color]} · {e.hero.weaponType} ·{' '}
                  {e.hero.moveType}
                  {e.stats
                    ? ` — PV ${fmt(e.stats.PV)} ATQ ${fmt(e.stats.ATQ)} VIT ${fmt(
                        e.stats.VIT,
                      )} DÉF ${fmt(e.stats.DEF)} RÉS ${fmt(e.stats.RES)}`
                    : ' — stats non saisies'}
                </div>
              </div>
              <span className="shrink-0 font-feh text-[15px] font-bold text-gold-text">
                {metricValue(e.stats, metric) || '—'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function fmt(n: number | null): string {
  return n == null ? '–' : String(n);
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-warm-mute">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[13px] text-warm-text outline-none transition focus:border-gold/50"
      >
        {children}
      </select>
    </label>
  );
}
