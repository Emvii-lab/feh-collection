import { useEffect, useMemo, useState } from 'react';
import { useHeroes } from './lib/useHeroes';
import type { Color, Hero } from './types';
import { HeroCard } from './components/HeroCard';
import { HeroDetail } from './components/HeroDetail';
import { Stats } from './components/Stats';
import { Credits } from './components/Credits';
import { TeamBuilder } from './components/TeamBuilder';
import { Settings } from './components/Settings';
import { statTotal } from './lib/collection';
import { COLOR_LABEL } from './theme';
import { useCollection } from './lib/useCollection';
import { isSupabaseConfigured } from './lib/supabase';
import { useAuth, signOut } from './lib/useAuth';
import { Login } from './components/Login';

type OwnFilter = 'all' | 'owned' | 'missing';
const COLORS: Color[] = ['red', 'blue', 'green', 'colorless'];

const RAIL = [
  { key: 'heroes', label: 'Héros', icon: 'shield' },
  { key: 'equipe', label: 'Équipe', icon: 'swords' },
  { key: 'stats', label: 'Stats', icon: 'chart' },
  { key: 'credits', label: 'Crédits', icon: 'credits' },
  { key: 'settings', label: 'Réglages', icon: 'gear' },
] as const;

// Onglets dont l'icône est une image FEH (plaque déjà incluse) → pas de fond feh-btn.
const RAIL_IMG: Record<string, string> = {
  heroes: '/feh/ui/button_heroes.png',
  equipe: '/feh/ui/battle.png',
  stats: '/feh/ui/stats.png',
  credits: '/feh/ui/voice_actor.png',
  settings: '/feh/ui/settings.png',
};

function RailIcon({ name, color }: { name: string; color: string }) {
  const s = { width: 20, height: 20, stroke: color, fill: 'none', strokeWidth: 2 };
  switch (name) {
    case 'shield':
      return (
        <svg viewBox="0 0 24 24" {...s} strokeLinejoin="round">
          <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
        </svg>
      );
    case 'orb':
      return (
        <svg viewBox="0 0 24 24" {...s}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
    case 'credits':
      return (
        <svg viewBox="0 0 24 24" {...s} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="9" r="5" />
          <path d="M8.5 13.5L7 21l5-3 5 3-1.5-7.5" />
        </svg>
      );
    case 'logout':
      return (
        <svg viewBox="0 0 24 24" {...s} strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-3" />
          <path d="M10 12h11M18 9l3 3-3 3" />
        </svg>
      );
    case 'swords':
      return (
        <svg viewBox="0 0 24 24" {...s} strokeLinecap="round">
          <path d="M5 5l9 9M19 5l-9 9M4 16l4 4M20 16l-4 4" />
        </svg>
      );
    case 'chart':
      return (
        <svg viewBox="0 0 24 24" {...s} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
    case 'gear':
      return (
        <svg viewBox="0 0 24 24" {...s} strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" {...s} strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
  }
}

export default function App() {
  const [query, setQuery] = useState<string>(
    () => localStorage.getItem('feh.query') ?? '',
  );
  const [colorFilter, setColorFilter] = useState<Color | null>(() => {
    const v = localStorage.getItem('feh.colorFilter');
    return v === 'red' || v === 'blue' || v === 'green' || v === 'colorless'
      ? (v as Color)
      : null;
  });
  const [ownFilter, setOwnFilter] = useState<OwnFilter>(() => {
    const v = localStorage.getItem('feh.ownFilter');
    return v === 'owned' || v === 'missing' ? v : 'all';
  });
  const [tab, setTab] = useState<string>(() => {
    const saved =
      typeof localStorage !== 'undefined' ? localStorage.getItem('feh.tab') : null;
    return saved && RAIL.some((t) => t.key === saved) ? saved : 'heroes';
  });
  const [selected, setSelected] = useState<Hero | null>(null);
  const [visible, setVisible] = useState(60);
  const [sortStat, setSortStat] = useState<string>(() => {
    const v = localStorage.getItem('feh.sortStat');
    return v &&
      ['default', 'release', 'total', 'ATQ', 'VIT', 'PV', 'DEF', 'RES'].includes(v)
      ? v
      : 'default';
  });
  const { user, loading: authLoading } = useAuth();
  const { owned, stats, toggle, refetch } = useCollection(user?.id ?? null);
  const heroes = useHeroes();

  // Mémorise le dernier onglet ouvert + les filtres (rechargement de page).
  useEffect(() => {
    localStorage.setItem('feh.tab', tab);
  }, [tab]);
  useEffect(() => {
    if (query) localStorage.setItem('feh.query', query);
    else localStorage.removeItem('feh.query');
  }, [query]);
  useEffect(() => {
    if (colorFilter) localStorage.setItem('feh.colorFilter', colorFilter);
    else localStorage.removeItem('feh.colorFilter');
  }, [colorFilter]);
  useEffect(() => {
    localStorage.setItem('feh.ownFilter', ownFilter);
  }, [ownFilter]);
  useEffect(() => {
    localStorage.setItem('feh.sortStat', sortStat);
  }, [sortStat]);

  const ownedCount = owned.size;
  const total = heroes.length;
  const filterColorIconByColor = useMemo(() => {
    const icons = new Map<Color, string>();
    for (const hero of heroes) {
      if (hero.colorUrl && !icons.has(hero.color)) {
        icons.set(hero.color, hero.colorUrl);
      }
    }
    return icons;
  }, [heroes]);

  const importOwned = (ids: string[]) => {
    for (const id of ids) if (!owned.has(id)) toggle(id);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = heroes.filter((h) => {
      if (colorFilter && h.color !== colorFilter) return false;
      if (ownFilter === 'owned' && !owned.has(h.id)) return false;
      if (ownFilter === 'missing' && owned.has(h.id)) return false;
      if (!q) return true;
      return (
        h.name.toLowerCase().includes(q) ||
        h.title.toLowerCase().includes(q) ||
        h.origin.toLowerCase().includes(q)
      );
    });
    if (sortStat === 'release') {
      // Date de sortie, de la plus ancienne à la plus récente (tri stable → départage par Ordre d'Askr).
      list.sort((a, b) =>
        (a.releaseDate ?? '9999-99-99').localeCompare(b.releaseDate ?? '9999-99-99'),
      );
    } else if (sortStat !== 'default') {
      const val = (h: Hero) => {
        const s = stats.get(h.id);
        if (!s) return 0;
        return sortStat === 'total'
          ? statTotal(s)
          : ((s[sortStat as keyof typeof s] ?? 0) as number);
      };
      list.sort((a, b) => val(b) - val(a));
    }
    return list;
  }, [heroes, query, colorFilter, ownFilter, owned, sortStat, stats]);

  useEffect(() => setVisible(60), [query, colorFilter, ownFilter]);
  const shown = filtered.slice(0, visible);

  // Login obligatoire : tant que la session charge / si non connecté.
  if (authLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-warm-deep font-feh text-warm-dim">
        Chargement…
      </div>
    );
  }
  if (!user) {
    return <Login />;
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-warm-deep">
      {/* Fond peint officiel (Hall d'Askr) + voile pour la lisibilité */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/feh/bg/askr-hall.png')" }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 0%, rgba(10,14,24,.28), rgba(8,11,20,.68) 82%)',
        }}
      />
      {/* ===== Top bar (cadre pierre FEH) ===== */}
      <header
        className="relative z-20 flex h-[80px] flex-none items-center gap-5"
        style={{
          backgroundImage: "url('/feh/ui/header.png')",
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          paddingLeft: '3.5%',
          paddingRight: '19.5%',
        }}
      >
        <img
          src="/feh/ui/logo.png"
          alt="Fire Emblem Heroes"
          className="mt-5 h-10 w-auto flex-none self-start drop-shadow-[0_2px_3px_rgba(0,0,0,0.55)]"
        />
        <div className="mt-5 flex-none self-start">
          <div className="txt-stroke font-feh text-[22px] font-semibold leading-none tracking-[0.5px]">
            Catalogue des Héros
          </div>
          <div className="txt-stroke-sm mt-[4px] text-[11.5px] font-semibold">
            Ordre d'Askr · {ownedCount} / {total} obtenus
          </div>
        </div>

        {/* recherche centrée — plaque de pierre gravée FEH */}
        <div className="mx-auto mt-5 hidden max-w-[480px] flex-1 self-start md:block">
          <div className="feh-search flex items-center gap-2.5">
            <SearchGlyph />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder="Rechercher un héros par nom…"
              className="min-w-0 flex-1 border-0 bg-transparent text-[14px] font-semibold text-[#fff4e0] outline-none [text-shadow:0_1px_2px_rgba(0,0,0,.8)] placeholder:font-medium placeholder:text-[#d8c9a6]"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Effacer la recherche"
                title="Effacer (Échap)"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-black/30 text-[13px] leading-none text-[#e6d6ad] transition hover:bg-black/55 hover:text-[#fff4e0] [text-shadow:0_1px_2px_rgba(0,0,0,.8)]"
              >
                ✕
              </button>
            ) : null}
            <span className="font-feh text-[12px] font-semibold text-[#e6d6ad] [text-shadow:0_1px_2px_rgba(0,0,0,.8)]">
              {filtered.length}
            </span>
          </div>
        </div>

        {/* statut Supabase (currencies retirées) */}
        <div className="mt-8 flex flex-none items-center self-start">
          <img
            src={
              isSupabaseConfigured
                ? '/feh/ui/status_on.png'
                : '/feh/ui/status_off.png'
            }
            alt={isSupabaseConfigured ? 'Supabase connecté' : 'Mode local'}
            title={
              isSupabaseConfigured
                ? 'Connecté à Supabase'
                : 'Mode local (localStorage)'
            }
            className="h-4 w-4 drop-shadow-[0_1px_2px_rgba(0,0,0,.5)]"
          />
        </div>

        {/* Barre lumineuse sur la démarcation du header */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-4 z-30 h-5"
          style={{
            backgroundImage: "url('/feh/ui/bar.png')",
            backgroundSize: '100% 100%',
            backgroundRepeat: 'no-repeat',
          }}
        />
      </header>

      {/* ===== Body ===== */}
      <div
        className="relative z-[2] flex min-h-0 flex-1"
        style={{ backgroundColor: '#2a2218' }}
      >
        {/* Rail gauche */}
        <nav className="flex w-[96px] flex-none flex-col items-center gap-2 border-r border-white/[0.06] bg-[rgba(24,17,10,.4)] py-5">
          {RAIL.map((t) => {
            const on = tab === t.key;
            const img = RAIL_IMG[t.key];
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex w-[76px] flex-col items-center gap-1.5 py-[11px] transition ${
                  img
                    ? 'rounded-2xl'
                    : on
                      ? 'feh-btn brightness-110'
                      : 'rounded-2xl hover:bg-white/[0.04]'
                }`}
              >
                {img ? (
                  <img
                    src={img}
                    alt=""
                    className={`h-11 w-11 object-contain transition ${
                      on ? '' : 'opacity-55 grayscale hover:opacity-80'
                    }`}
                  />
                ) : (
                  <RailIcon name={t.icon} color={on ? '#eaf6ff' : '#94866c'} />
                )}
                <span
                  className="font-feh text-[11px] font-semibold drop-shadow-[0_1px_1px_rgba(0,0,0,.5)]"
                  style={{ color: on ? '#eaf6ff' : '#94866c' }}
                >
                  {t.label}
                </span>
              </button>
            );
          })}

          {/* Déconnexion (bas du rail) */}
          <button
            onClick={() => signOut()}
            title={user.email ? `Connecté : ${user.email}` : 'Se déconnecter'}
            className="mt-auto flex w-[76px] flex-col items-center gap-1.5 rounded-2xl py-[11px] transition hover:bg-white/[0.04]"
          >
            <RailIcon name="logout" color="#94866c" />
            <span
              className="font-feh text-[11px] font-semibold drop-shadow-[0_1px_1px_rgba(0,0,0,.5)]"
              style={{ color: '#94866c' }}
            >
              Quitter
            </span>
          </button>
        </nav>

        {/* Main */}
        <main className="min-w-0 flex-1 overflow-y-auto px-5 pb-12 pt-5 sm:px-8">
          {tab === 'equipe' && (
            <TeamBuilder
              heroes={heroes}
              owned={owned}
              stats={stats}
              onSelectHero={setSelected}
            />
          )}
          {tab === 'stats' && <Stats heroes={heroes} owned={owned} />}
          {tab === 'credits' && (
            <Credits heroes={heroes} onSelectHero={setSelected} />
          )}
          {tab === 'settings' && (
            <Settings owned={owned} total={total} onImport={importOwned} />
          )}
          {tab === 'heroes' && (
            <>
              <div className="mb-5 flex flex-wrap items-center gap-3.5">
                {/* segment — boutons vernis FEH */}
                <div className="flex items-center gap-2">
                  {(
                    [
                      ['all', 'Tous'],
                      ['owned', 'Possédés'],
                      ['missing', 'Manquants'],
                    ] as [OwnFilter, string][]
                  ).map(([key, label]) => {
                    const on = ownFilter === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setOwnFilter(key)}
                        className={`feh-tab font-feh text-[13px] font-bold tracking-wide text-[#3a2a08] transition ${on
                          ? 'brightness-110'
                          : 'opacity-60 grayscale-[.35] hover:opacity-85'
                          }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* gemmes couleur */}
                <div className="flex items-center gap-1.5">
                  {COLORS.map((c) => {
                    const on = colorFilter === c;
                    const colorIconUrl = filterColorIconByColor.get(c);
                    return (
                      <button
                        key={c}
                        title={COLOR_LABEL[c]}
                        onClick={() => setColorFilter(on ? null : c)}
                        className={`flex h-[28px] w-[28px] items-center justify-center rounded-[8px] transition ${on
                          ? 'ring-2 ring-gold-light ring-offset-2 ring-offset-warm-bg'
                          : 'opacity-55 hover:opacity-100'
                          }`}
                      >
                        {colorIconUrl && (
                          <img
                            src={colorIconUrl}
                            alt=""
                            className="h-full w-full object-contain drop-shadow-[0_1px_3px_rgba(0,0,0,.45)]"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* tri par stat de collection */}
                <select
                  value={sortStat}
                  onChange={(e) => setSortStat(e.target.value)}
                  title="Trier par stat"
                  className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[12.5px] text-warm-text outline-none focus:border-gold/50"
                >
                  <option value="default">Tri : défaut</option>
                  <option value="release">Sortie (ancien → récent)</option>
                  <option value="total">Total stats</option>
                  <option value="ATQ">Attaque</option>
                  <option value="VIT">Vitesse</option>
                  <option value="PV">PV</option>
                  <option value="DEF">Défense</option>
                  <option value="RES">Résistance</option>
                </select>

                <div className="text-[13.5px] text-warm-dim">
                  {filtered.length} héros
                </div>
              </div>
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))',
                }}
              >
                {shown.map((h) => (
                  <HeroCard
                    key={h.id}
                    hero={h}
                    owned={owned.has(h.id)}
                    selected={selected?.id === h.id}
                    onOpen={() => setSelected(h)}
                    onToggleOwned={() => toggle(h.id)}
                  />
                ))}
              </div>

              {filtered.length === 0 && (
                <p className="py-16 text-center text-warm-dim">
                  Aucun héros ne correspond aux filtres.
                </p>
              )}

              {visible < filtered.length && (
                <div className="mt-7 flex justify-center">
                  <button
                    onClick={() => setVisible((v) => v + 60)}
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-6 py-2.5 font-feh text-[13px] font-semibold text-warm-text transition hover:border-gold/40 hover:text-gold-light"
                  >
                    Voir plus ({filtered.length - visible} restants)
                  </button>
                </div>
              )}

              <p className="mt-10 text-center text-[11px] text-warm-mute/70">
                Projet personnel non officiel · Fire Emblem Heroes © Nintendo /
                Intelligent Systems.
              </p>
            </>
          )}
        </main>
      </div>

      {selected && (
        <HeroDetail
          hero={selected}
          onClose={() => setSelected(null)}
          userId={user.id}
          onSaved={refetch}
        />
      )}
    </div>
  );
}

function SearchGlyph() {
  return (
    <span className="relative block h-[14px] w-[14px] flex-none rounded-full border-2 border-[#e6d6ad]">
      <i className="absolute -bottom-1 -right-1 block h-[2px] w-[7px] rotate-45 rounded bg-[#e6d6ad]" />
    </span>
  );
}
