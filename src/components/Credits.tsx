import { useMemo, useState } from 'react';
import type { Hero } from '../types';

// Dégradé doré réutilisé des autres panneaux.
const GOLD = 'linear-gradient(90deg,#b78a2e,#ffd166 70%,#fff3cf)';

type Entry = { name: string; ja?: string; heroes: Hero[] };

// Regroupe les héros par personne créditée.
// `fields` = plusieurs extracteurs (voix principale + partenaires, illus + resplendissant).
// Un héros Duo/Trio compte pour chaque voix ; un resplendissant pour son illustrateur.
function tallyPeople(
  heroes: Hero[],
  fields: ((h: Hero) => { name?: string; ja?: string })[],
): Entry[] {
  const m = new Map<string, Entry>();
  for (const h of heroes) {
    const seen = new Set<string>(); // évite de compter 2x le même héros pour une personne
    for (const f of fields) {
      const { name, ja } = f(h);
      if (!name || !name.trim() || seen.has(name)) continue;
      seen.add(name);
      const e = m.get(name) ?? { name, ja, heroes: [] };
      if (!e.ja && ja) e.ja = ja;
      e.heroes.push(h);
      m.set(name, e);
    }
  }
  // tri des héros de chaque personne par jeu d'origine puis nom (regroupe par jeu)
  for (const e of m.values()) {
    e.heroes.sort(
      (a, b) =>
        (a.origin || '').localeCompare(b.origin || '') ||
        a.name.localeCompare(b.name),
    );
  }
  return [...m.values()].sort(
    (a, b) => b.heroes.length - a.heroes.length || a.name.localeCompare(b.name),
  );
}

function PersonRow({
  entry,
  rank,
  max,
  open,
  onToggle,
  onSelectHero,
}: {
  entry: Entry;
  rank: number;
  max: number;
  open: boolean;
  onToggle: () => void;
  onSelectHero?: (h: Hero) => void;
}) {
  const count = entry.heroes.length;
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left transition hover:bg-white/[0.04]"
      >
        <span className="w-5 shrink-0 text-right font-feh text-[12px] text-warm-mute">
          {rank}
        </span>
        <span
          className={`shrink-0 text-warm-mute transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] text-warm-text">
              {entry.name}
              {entry.ja && (
                <span className="ml-1.5 text-[11px] text-warm-mute">
                  {entry.ja}
                </span>
              )}
            </span>
            <span className="shrink-0 font-feh text-[12px] text-gold-text">
              {count}
              <span className="text-warm-mute"> persos</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/40">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(count / max) * 100}%`, background: GOLD }}
            />
          </div>
        </div>
      </button>

      {open && (
        <ul className="mb-1.5 ml-9 mt-1 space-y-0.5 border-l border-white/10 pl-3">
          {entry.heroes.map((h, i) => (
            <li key={h.id + ':' + i}>
              <button
                onClick={() => onSelectHero?.(h)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left transition hover:bg-white/[0.05]"
              >
                <span className="truncate text-[12.5px] text-warm-text">
                  {h.name}
                  <span className="text-warm-mute"> : {h.title}</span>
                </span>
                <span className="shrink-0 text-[11px] text-warm-dim">
                  {h.origin || '—'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RankList({
  title,
  entries,
  onSelectHero,
}: {
  title: string;
  entries: Entry[];
  onSelectHero?: (h: Hero) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const max = entries.length ? entries[0].heroes.length : 1;
  return (
    <div className="rounded-2xl border border-white/10 bg-[rgba(20,15,9,.55)] p-5 shadow-card">
      <div className="mb-4 flex items-baseline justify-between">
        <h3 className="font-feh text-[15px] font-semibold tracking-wide text-gold-text">
          {title}
        </h3>
        <span className="text-[12px] text-warm-mute">
          {entries.length} personnes
        </span>
      </div>
      <div className="max-h-[560px] space-y-1.5 overflow-y-auto pr-1.5 [scrollbar-color:rgba(255,255,255,.18)_transparent] [scrollbar-width:thin]">
        {entries.map((e, i) => (
          <PersonRow
            key={e.name}
            entry={e}
            rank={i + 1}
            max={max}
            open={open === e.name}
            onToggle={() => setOpen(open === e.name ? null : e.name)}
            onSelectHero={onSelectHero}
          />
        ))}
        {entries.length === 0 && (
          <p className="py-6 text-center text-[13px] text-warm-dim">
            Aucune donnée pour le moment.
          </p>
        )}
      </div>
    </div>
  );
}

export function Credits({
  heroes,
  onSelectHero,
}: {
  heroes: Hero[];
  onSelectHero?: (h: Hero) => void;
}) {
  const voices = useMemo(
    () =>
      tallyPeople(heroes, [
        (h) => ({ name: h.cvName, ja: h.cvNameJa }),
        (h) => ({ name: h.cvPartnerName, ja: h.cvPartnerNameJa }),
        (h) => ({ name: h.cvPartner2Name, ja: h.cvPartner2NameJa }),
      ]),
    [heroes],
  );
  const illus = useMemo(
    () =>
      tallyPeople(heroes, [
        (h) => ({ name: h.illustratorName, ja: h.illustratorNameJa }),
        (h) => ({
          name: h.illustratorResplendentName,
          ja: h.illustratorResplendentNameJa,
        }),
      ]),
    [heroes],
  );
  const credited = useMemo(
    () => heroes.filter((h) => h.cvName || h.illustratorName).length,
    [heroes],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 rounded-2xl border border-gold-deep/40 bg-[rgba(20,15,9,.6)] p-6 shadow-card">
        <p className="font-feh text-[17px] font-semibold text-warm-head">
          Crédits voix &amp; illustrations
        </p>
        <p className="mt-1 text-[13px] text-warm-dim">
          <span className="font-feh text-gold-text">{voices.length}</span>{' '}
          doubleurs ·{' '}
          <span className="font-feh text-gold-text">{illus.length}</span>{' '}
          illustrateurs · sur{' '}
          <span className="text-warm-mute">{credited} persos crédités</span>
        </p>
        <p className="mt-1 text-[12px] text-warm-mute">
          Clique sur une personne pour voir ses persos et leurs jeux d'origine.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RankList
          title="Doubleurs (voix JP)"
          entries={voices}
          onSelectHero={onSelectHero}
        />
        <RankList
          title="Illustrateurs"
          entries={illus}
          onSelectHero={onSelectHero}
        />
      </div>

      <p className="mt-6 text-center text-[11px] text-warm-mute/70">
        Comptage incluant les voix de duos/trios et les illustrateurs des tenues
        resplendissantes.
      </p>
    </div>
  );
}
