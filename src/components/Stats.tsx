import type { Color, Hero } from '../types';
import { GEM, COLOR_LABEL } from '../theme';

const COLORS: Color[] = ['red', 'blue', 'green', 'colorless'];
const GOLD = 'linear-gradient(90deg,#b78a2e,#ffd166 70%,#fff3cf)';

type Bucket = { owned: number; total: number };

function tally(heroes: Hero[], owned: Set<string>, key: (h: Hero) => string) {
  const m = new Map<string, Bucket>();
  for (const h of heroes) {
    const k = key(h);
    const e = m.get(k) ?? { owned: 0, total: 0 };
    e.total++;
    if (owned.has(h.id)) e.owned++;
    m.set(k, e);
  }
  return m;
}

function Bar({
  label,
  data,
  fill,
}: {
  label: string;
  data: Bucket;
  fill: string;
}) {
  const pct = data.total ? (data.owned / data.total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-[88px] shrink-0 truncate text-[13px] text-warm-dim">
        {label}
      </span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-black/45">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: fill }}
        />
      </div>
      <span className="w-[58px] shrink-0 text-right font-feh text-[12px] text-warm-text">
        {data.owned}
        <span className="text-warm-mute">/{data.total}</span>
      </span>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[rgba(20,15,9,.55)] p-5 shadow-card">
      <h3 className="mb-4 font-feh text-[15px] font-semibold tracking-wide text-gold-text">
        {title}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

export function Stats({
  heroes,
  owned,
}: {
  heroes: Hero[];
  owned: Set<string>;
}) {
  const total = heroes.length;
  const ownedCount = owned.size;
  const pct = total ? Math.round((ownedCount / total) * 100) : 0;
  const missing = total - ownedCount;

  const byColor = tally(heroes, owned, (h) => h.color);
  const byMove = tally(heroes, owned, (h) => h.moveType);
  const byWeapon = tally(heroes, owned, (h) => h.weaponType);
  const byOrigin = [...tally(heroes, owned, (h) => h.origin).entries()].sort(
    (a, b) => b[1].total - a[1].total,
  );

  const empty: Bucket = { owned: 0, total: 0 };

  return (
    <div className="mx-auto max-w-5xl">
      {/* Complétion globale */}
      <div className="mb-5 rounded-2xl border border-gold-deep/40 bg-[rgba(20,15,9,.6)] p-6 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-feh text-[17px] font-semibold text-warm-head">
              Ma collection
            </p>
            <p className="mt-1 text-[13px] text-warm-dim">
              <span className="font-feh text-gold-text">{ownedCount}</span> /{' '}
              {total} obtenus ·{' '}
              <span className="text-warm-mute">{missing} manquants</span>
            </p>
          </div>
          <div className="font-feh text-4xl font-bold text-gold-text">
            {pct}
            <span className="text-2xl">%</span>
          </div>
        </div>
        <div className="mt-4 h-3.5 overflow-hidden rounded-full bg-black/45 ring-1 ring-gold-deep/30">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: GOLD }}
          />
        </div>
      </div>

      {/* Répartitions */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Par couleur">
          {COLORS.map((c) => (
            <Bar
              key={c}
              label={COLOR_LABEL[c]}
              data={byColor.get(c) ?? empty}
              fill={GEM[c]}
            />
          ))}
        </Panel>

        <Panel title="Par déplacement">
          {[...byMove.entries()]
            .sort((a, b) => b[1].total - a[1].total)
            .map(([m, d]) => (
              <Bar key={m} label={m || '—'} data={d} fill={GOLD} />
            ))}
        </Panel>

        <Panel title="Par arme">
          {[...byWeapon.entries()]
            .sort((a, b) => b[1].total - a[1].total)
            .map(([w, d]) => (
              <Bar key={w} label={w} data={d} fill={GOLD} />
            ))}
        </Panel>

        <Panel title="Par jeu d'origine (top 12)">
          {byOrigin.slice(0, 12).map(([o, d]) => (
            <Bar key={o} label={o || '—'} data={d} fill={GOLD} />
          ))}
        </Panel>
      </div>
    </div>
  );
}
