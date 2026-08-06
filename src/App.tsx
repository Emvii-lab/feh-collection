import { useEffect, useMemo, useRef, useState } from 'react';
import { useHeroes } from './lib/useHeroes';
import type { Color, Hero } from './types';
import { HeroCard } from './components/HeroCard';
import { useRarityIcons } from './lib/useRarityIcons';
import { HeroDetail } from './components/HeroDetail';
import { Stats } from './components/Stats';
import { Credits } from './components/Credits';
import { TeamBuilder } from './components/TeamBuilder';
import { Settings } from './components/Settings';
import { statTotal } from './lib/collection';
import { COLOR_LABEL } from './theme';
import { useCollection } from './lib/useCollection';
import { useProfiles } from './lib/useProfiles';
import { allocateSeals } from './lib/seals';
import { isSupabaseConfigured } from './lib/supabase';
import { useAuth, signOut } from './lib/useAuth';
import { Login } from './components/Login';

type OwnFilter = 'all' | 'owned' | 'missing';
const COLORS: Color[] = ['red', 'blue', 'green', 'colorless'];

// Lettres spéciales (surtout nordiques, fréquentes dans FEH) qui ne se
// décomposent PAS via NFD car ce sont des lettres à part entière et non des
// lettres accentuées : on les translittère à la main.
const SPECIAL_CHARS: Record<string, string> = {
  æ: 'ae',
  œ: 'oe',
  ð: 'd', // eth → d (ex. « Læraðr » → « laeradr », « Höðr » → « hodr »)
  þ: 'th', // thorn (ex. « Eikþyrnir » → « eikthyrnir »)
  ø: 'o',
  ł: 'l',
  ß: 'ss',
  đ: 'd',
};

// Minuscule + translittération des lettres spéciales + suppression des
// accents/diacritiques → « Fáfnir » devient « fafnir », « Læraðr » devient
// « laeradr », pour qu'une recherche sans caractère spécial trouve le héros.
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[æœðþøłßđ]/g, (c) => SPECIAL_CHARS[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

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
  // Nombre de cards affichées, restauré au rechargement pour retrouver le scroll.
  const [visible, setVisible] = useState(() => {
    const v = parseInt(sessionStorage.getItem('feh.visible') ?? '', 10);
    return Number.isFinite(v) && v >= 60 ? v : 60;
  });
  // Conteneur scrollable de la liste des héros (pour sauver/restaurer la position).
  const mainRef = useRef<HTMLElement>(null);
  const [sortStat, setSortStat] = useState<string>(() => {
    const v = localStorage.getItem('feh.sortStat');
    return v &&
      ['default', 'release', 'total', 'ATQ', 'VIT', 'PV', 'DEF', 'RES'].includes(v)
      ? v
      : 'release';
  });
  const { user, loading: authLoading } = useAuth();
  // Compte dont on affiche la collection (null = la mienne). Persisté au rechargement.
  const [viewUserId, setViewUserId] = useState<string | null>(
    () => localStorage.getItem('feh.viewUserId') || null,
  );
  const profiles = useProfiles();
  const {
    owned,
    stats,
    toggle,
    toggleResplendent,
    refetch,
    readOnly,
    loading: collectionLoading,
  } = useCollection(user?.id ?? null, viewUserId);
  const heroes = useHeroes();
  const rarityIcons = useRarityIcons();
  // Répartition des sceaux : chaque sceau unique va à un seul héros 5★+.
  const sealAlloc = useMemo(() => allocateSeals(stats), [stats]);

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
  useEffect(() => {
    if (viewUserId) localStorage.setItem('feh.viewUserId', viewUserId);
    else localStorage.removeItem('feh.viewUserId');
  }, [viewUserId]);
  // Compte consulté restauré mais introuvable (supprimé, plus accessible) → retour à ma collection.
  useEffect(() => {
    if (
      viewUserId &&
      viewUserId !== user?.id &&
      profiles.length > 0 &&
      !profiles.some((p) => p.id === viewUserId)
    ) {
      setViewUserId(null);
    }
  }, [viewUserId, profiles, user?.id]);

  const ownedCount = owned.size;
  const total = heroes.length;
  // Email du compte consulté (null si je regarde ma propre collection).
  const viewedEmail = viewUserId
    ? (profiles.find((p) => p.id === viewUserId)?.email ?? 'un autre compte')
    : null;
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
    const q = normalize(query.trim());
    const list = heroes.filter((h) => {
      if (colorFilter && h.color !== colorFilter) return false;
      if (ownFilter === 'owned' && !owned.has(h.id)) return false;
      if (ownFilter === 'missing' && owned.has(h.id)) return false;
      if (!q) return true;
      return (
        normalize(h.name).includes(q) ||
        normalize(h.title).includes(q) ||
        normalize(h.origin).includes(q)
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

  // Reset au changement de filtre (mais PAS au 1er montage, pour préserver la restauration).
  const firstFilterRun = useRef(true);
  useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false;
      return;
    }
    setVisible(60);
    if (mainRef.current) mainRef.current.scrollTop = 0;
    sessionStorage.setItem('feh.scroll', '0');
  }, [query, colorFilter, ownFilter]);

  // Persiste le nombre de cards affichées.
  useEffect(() => {
    sessionStorage.setItem('feh.visible', String(visible));
  }, [visible]);

  // Sauvegarde la position de scroll (throttlée) pendant le défilement des héros.
  const scrollTick = useRef(false);
  const handleMainScroll = () => {
    if (tab !== 'heroes' || scrollTick.current) return;
    scrollTick.current = true;
    requestAnimationFrame(() => {
      scrollTick.current = false;
      if (mainRef.current) {
        sessionStorage.setItem('feh.scroll', String(mainRef.current.scrollTop));
      }
    });
  };

  // Restaure la position de scroll une fois les données chargées (une seule fois).
  const didRestore = useRef(false);
  useEffect(() => {
    if (didRestore.current) return;
    if (tab !== 'heroes' || collectionLoading || heroes.length === 0) return;
    didRestore.current = true;
    const saved = parseInt(sessionStorage.getItem('feh.scroll') ?? '0', 10);
    if (!saved) return;
    // double rAF : attend que la grille soit mise en page avant de repositionner.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (mainRef.current) mainRef.current.scrollTop = saved;
      }),
    );
  }, [tab, collectionLoading, heroes]);

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
            {viewedEmail
              ? `Collection de ${viewedEmail} · ${ownedCount} / ${total} · lecture seule`
              : `Ordre d'Askr · ${ownedCount} / ${total} obtenus`}
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

      {/* Recherche mobile : bande pleine largeur sous le header (le header est trop étroit sur mobile) */}
      <div className="relative z-20 mt-2 flex-none bg-[rgba(24,17,10,.55)] px-3 py-2 md:hidden">
        <div className="feh-search flex items-center gap-2.5">
          <SearchGlyph />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Rechercher un héros…"
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] font-semibold text-[#fff4e0] outline-none [text-shadow:0_1px_2px_rgba(0,0,0,.8)] placeholder:font-medium placeholder:text-[#d8c9a6]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Effacer la recherche"
              title="Effacer"
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

      {/* ===== Body ===== */}
      <div
        className="relative z-[2] flex min-h-0 flex-1 flex-col md:flex-row"
        style={{ backgroundColor: '#2a2218' }}
      >
        {/* Navigation : barre horizontale en haut sur mobile, rail vertical à gauche sur desktop */}
        <nav className="flex w-full flex-none flex-row items-center gap-1 overflow-x-auto border-b border-white/[0.06] bg-[rgba(24,17,10,.4)] px-2 py-2 md:w-[96px] md:flex-col md:gap-2 md:overflow-visible md:border-b-0 md:border-r md:px-0 md:py-5">
          {RAIL.map((t) => {
            const on = tab === t.key;
            const img = RAIL_IMG[t.key];
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex w-[62px] flex-none flex-col items-center gap-1 py-2 transition md:w-[76px] md:gap-1.5 md:py-[11px] ${
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
                    className={`h-9 w-9 object-contain transition md:h-11 md:w-11 ${
                      on ? '' : 'opacity-55 grayscale hover:opacity-80'
                    }`}
                  />
                ) : (
                  <RailIcon name={t.icon} color={on ? '#eaf6ff' : '#94866c'} />
                )}
                <span
                  className="font-feh text-[10px] font-semibold drop-shadow-[0_1px_1px_rgba(0,0,0,.5)] md:text-[11px]"
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
            className="ml-auto flex w-[62px] flex-none flex-col items-center gap-1 rounded-2xl py-2 transition hover:bg-white/[0.04] md:ml-0 md:mt-auto md:w-[76px] md:gap-1.5 md:py-[11px]"
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
        <main
          ref={mainRef}
          onScroll={handleMainScroll}
          className="min-w-0 flex-1 overflow-y-auto px-5 pb-12 pt-5 sm:px-8"
        >
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

                {/* sélecteur : voir la collection d'un autre compte (lecture seule) */}
                {profiles.some((p) => p.id !== user.id) ? (
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-[12.5px] text-warm-dim">
                      Collection :
                    </span>
                    <select
                      value={viewUserId ?? ''}
                      onChange={(e) => setViewUserId(e.target.value || null)}
                      title="Voir la collection d'un autre compte"
                      className="max-w-[220px] rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[12.5px] text-warm-text outline-none focus:border-gold/50"
                    >
                      <option value="">Ma collection</option>
                      {profiles
                        .filter((p) => p.id !== user.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.email ?? p.id}
                          </option>
                        ))}
                    </select>
                  </div>
                ) : null}
              </div>

              {/* bandeau : consultation en lecture seule */}
              {readOnly ? (
                <div className="mb-5 flex items-center gap-2 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-[12.5px] text-sky-100">
                  <span aria-hidden>👁️</span>
                  Tu consultes la collection de{' '}
                  <strong className="font-semibold">{viewedEmail}</strong> —
                  lecture seule, aucune modification enregistrée.
                </div>
              ) : null}
              <div
                className="grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fill,minmax(128px,1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(152px,1fr))] md:[grid-template-columns:repeat(auto-fill,minmax(176px,1fr))]"
              >
                {shown.map((h, i) => (
                  <HeroCard
                    key={h.id}
                    index={i}
                    hero={h}
                    owned={owned.has(h.id)}
                    selected={selected?.id === h.id}
                    onOpen={() => setSelected(h)}
                    onToggleOwned={() => toggle(h.id)}
                    rarityIcons={rarityIcons}
                    copyRarity={stats.get(h.id)?.rarity ?? null}
                    maxLevel={stats.get(h.id)?.LVL === 40}
                    resplendentObtained={stats.get(h.id)?.resplendent ?? false}
                    onToggleResplendent={() => toggleResplendent(h.id)}
                    readOnly={readOnly}
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
          userId={viewUserId ?? user.id}
          readOnly={readOnly}
          copyRarity={stats.get(selected.id)?.rarity ?? null}
          resplendentObtained={stats.get(selected.id)?.resplendent ?? false}
          sealPick={sealAlloc.get(selected.id) ?? null}
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
