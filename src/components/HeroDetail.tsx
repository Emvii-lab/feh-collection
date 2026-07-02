import { useRef, useState } from 'react';
import type { Hero } from '../types';
import { MoveIcon, RarityStars, WeaponIcon } from './icons';
import { useHeroVoices, type HeroVoices } from '../lib/useHeroVoices';
import { CollectionStats } from './CollectionStats';
import { HeroKit } from './HeroKit';
import { useHeroSkills } from '../lib/useHeroSkills';

const GOLD_GRAD = 'linear-gradient(90deg,#b78a2e,#ffd166 70%,#fff3cf)';

// Catégories de voix (clé de colonne = `${key}_${n}`) + libellé FR + nb max de clips.
const VOICE_CATS: { key: string; label: string; max: number }[] = [
  { key: 'attack', label: 'Attaque', max: 2 },
  { key: 'special', label: 'Compétence spéciale', max: 2 },
  { key: 'skill', label: 'Compétence', max: 6 },
  { key: 'damage', label: 'Dégâts', max: 3 },
  { key: 'dead', label: 'Défaite', max: 1 },
  { key: 'map', label: 'Sur la carte', max: 4 },
  { key: 'status', label: 'Statut / accueil', max: 11 },
  { key: 'support', label: 'Soutien', max: 3 },
  { key: 'reliance', label: 'Lien (Reliance)', max: 19 },
  { key: 'title', label: 'Titre', max: 15 },
  { key: 'tutorial', label: 'Tutoriel', max: 9 },
];

const FALLBACK_ART =
  'https://res.cloudinary.com/dd4rdtrig/image/upload/v1782335088/unknown_hero_aswwcu.png';
const LOUPE_ICON =
  'https://res.cloudinary.com/dd4rdtrig/image/upload/v1782413393/loupe_ylabux.png';

export function HeroDetail({
  hero,
  onClose,
  userId,
  onSaved,
}: {
  hero: Hero;
  onClose: () => void;
  userId: string | null;
  onSaved?: () => void;
}) {
  // Tenue resplendissante (si au moins une pose resp. existe).
  const hasResplendent = Boolean(
    hero.artResplendent ||
      hero.artResplendentAttack ||
      hero.artResplendentSpecial ||
      hero.artResplendentInjured,
  );
  const [resplendent, setResplendent] = useState(false);
  const showResp = resplendent && hasResplendent;

  const [failed, setFailed] = useState(false);
  const baseArt = showResp ? hero.artResplendent : hero.detailArt;
  const artUrl = !failed && baseArt && baseArt.trim() ? baseArt : FALLBACK_ART;

  // Galerie d'illustrations (loupe) : les poses de la tenue active.
  const variants = (
    showResp
      ? [
          hero.artResplendent,
          hero.artResplendentAttack,
          hero.artResplendentSpecial,
          hero.artResplendentInjured,
        ]
      : [hero.detailArt, hero.artAttack, hero.artSpecial, hero.artInjured]
  ).filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
  const galleryArts = variants.length ? variants : [artUrl];
  const [gallery, setGallery] = useState(false);
  const [artIndex, setArtIndex] = useState(0);

  // Onglet bas de modal : stats ou voix (voix chargées à la demande).
  const [detailTab, setDetailTab] = useState<'stats' | 'kit' | 'voix'>('stats');
  const { voices, loading: voicesLoading } = useHeroVoices(
    hero.id,
    detailTab === 'voix',
  );
  const { skills, loading: skillsLoading } = useHeroSkills(
    hero.id,
    detailTab === 'kit',
  );

  const toggleResplendent = () => {
    setResplendent((v) => !v);
    setFailed(false);
    setArtIndex(0);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gold/30 bg-[#33291a] font-feh shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] md:h-[850px] md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* bouton fermer (niveau modal) */}
        <button
          onClick={onClose}
          className="absolute right-2.5 top-2.5 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-warm-text hover:bg-black/65"
          aria-label="Fermer"
        >
          ✕
        </button>

        {/* ===== PAGE GAUCHE : le héros + description + origine ===== */}
        <div className="flex shrink-0 flex-col overflow-y-auto md:h-full md:w-[50%] md:rounded-l-2xl">
        <div
          className="relative h-[460px] shrink-0 overflow-hidden md:h-[600px]"
          style={{
            backgroundImage: 'url(/feh/ui/detail_bg.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
          }}
        >
          <img
            src={artUrl}
            alt={`${hero.name} — ${hero.title}`}
            onError={() => setFailed(true)}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-contain object-bottom drop-shadow-[0_6px_14px_rgba(0,0,0,0.5)]"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#33291a]" />

          {/* bascule tenue normale / resplendissante */}
          {hasResplendent ? (
            <button
              onClick={toggleResplendent}
              className="absolute right-3 top-14 z-20 transition hover:brightness-110 active:scale-95"
              title={
                showResp
                  ? 'Revenir à la tenue normale'
                  : 'Voir la tenue resplendissante'
              }
              aria-label="Basculer la tenue resplendissante"
              aria-pressed={showResp}
            >
              <img
                src="/feh/ui/alternate_art.png"
                alt=""
                className={`h-12 w-12 object-contain transition ${
                  showResp
                    ? 'drop-shadow-[0_0_8px_rgba(251,230,166,0.9)]'
                    : 'opacity-80 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]'
                }`}
              />
            </button>
          ) : null}

          {/* loupe : voir les illustrations du personnage */}
          <button
            onClick={() => {
              setArtIndex(0);
              setGallery(true);
            }}
            className="absolute left-3 top-3 z-20 transition hover:brightness-110 active:scale-95"
            aria-label="Voir les illustrations"
            title="Voir les illustrations"
          >
            <img
              src={LOUPE_ICON}
              alt=""
              className="h-14 w-14 object-contain"
            />
          </button>

          {/* icônes type d'arme + déplacement (+ élément), sous la loupe */}
          <div className="absolute left-4 top-[74px] z-20 flex flex-col gap-2.5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
            <WeaponIcon type={hero.weaponType} iconUrl={hero.weaponUrl} size={46} />
            <MoveIcon type={hero.moveType} iconUrl={hero.moveUrl} size={46} />
            {hero.elementUrl ? (
              <img
                src={hero.elementUrl}
                alt="Élément"
                title="Élément"
                className="object-contain"
                style={{ width: 46, height: 46 }}
              />
            ) : null}
          </div>

          {/* bannière-parchemin double : titre (bande haute) + nom (bande basse) */}
          <div className="absolute inset-x-0 -bottom-[2px] z-10 flex justify-center">
            <div className="relative w-[70%] max-w-[360px]">
              <img
                src="/feh/ui/nameplate.png"
                alt=""
                className="w-full select-none"
                draggable={false}
              />
              <span className="txt-banner absolute inset-x-0 top-[35%] -translate-y-1/2 truncate px-[15%] text-center font-feh text-[16px] leading-[1.35]">
                {hero.title || 'Héros'}
              </span>
              <span className="txt-banner absolute inset-x-0 top-[62%] -translate-y-1/2 truncate px-[13%] text-center font-feh text-[25px] font-bold leading-[1.35]">
                {hero.name}
              </span>
              <div className="absolute inset-x-0 top-[84%] -translate-y-1/2 flex justify-center">
                <RarityStars rarity={hero.rarity} rarityUrl={hero.rarity_url} />
              </div>
            </div>
          </div>

          {/* crédits (en bas à gauche de l'art) : voix puis illustrateur */}
          {hero.cvName ||
          hero.cvNameJa ||
          hero.illustratorName ||
          hero.illustratorNameJa ? (
            <div className="absolute bottom-3 left-4 z-20 flex max-w-[200px] flex-col gap-1.5">
              <Credit
                icon="/feh/ui/voice.png"
                alt="Voix"
                name={hero.cvName}
                nameJa={hero.cvNameJa}
              />
              <Credit
                icon="/feh/ui/voice.png"
                alt="Voix (partenaire)"
                name={hero.cvPartnerName}
                nameJa={hero.cvPartnerNameJa}
              />
              <Credit
                icon="/feh/ui/voice.png"
                alt="Voix (partenaire 2)"
                name={hero.cvPartner2Name}
                nameJa={hero.cvPartner2NameJa}
              />
              <Credit
                icon="/feh/ui/design.png"
                alt="Illustrateur"
                name={
                  showResp &&
                  (hero.illustratorResplendentName ||
                    hero.illustratorResplendentNameJa)
                    ? hero.illustratorResplendentName
                    : hero.illustratorName
                }
                nameJa={
                  showResp &&
                  (hero.illustratorResplendentName ||
                    hero.illustratorResplendentNameJa)
                    ? hero.illustratorResplendentNameJa
                    : hero.illustratorNameJa
                }
              />
            </div>
          ) : null}
        </div>

        {/* description : fond teal du jeu (desc_panel.png) + texte blanc à contour */}
        {hero.description && hero.description.trim() ? (
          <div className="px-5 pt-3">
            <div className="feh-desc txt-desc text-center font-feh text-sm leading-relaxed">
              {hero.description}
            </div>
          </div>
        ) : null}

        {/* origine : image origin_url (repli sur le texte si absente) */}
        {hero.originUrl ? (
          <div className="flex justify-center px-5 py-3">
            <img
              src={hero.originUrl}
              alt={hero.origin || 'Origine'}
              title={hero.origin}
              className="h-[110px] w-auto max-w-full object-contain"
            />
          </div>
        ) : hero.origin ? (
          <div className="flex flex-wrap gap-2 px-5 py-3 text-sm">
            <Tag>📜 {hero.origin}</Tag>
          </div>
        ) : null}

        </div>

        {/* ===== PAGE DROITE : onglets (scroll indépendant) ===== */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-3 md:shadow-[inset_10px_0_16px_-10px_rgba(0,0,0,0.55)]">
        {/* onglets : Stats / Voix */}
        <div className="flex gap-2 px-5 pt-3">
          {(['stats', 'kit', 'voix'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setDetailTab(t)}
              className={`feh-tab font-feh text-[13px] font-bold tracking-wide text-[#3a2a08] transition ${
                detailTab === t
                  ? 'brightness-110'
                  : 'opacity-60 grayscale-[.35] hover:opacity-85'
              }`}
            >
              {t === 'stats' ? 'Stats' : t === 'kit' ? 'Compétences' : 'Voix'}
            </button>
          ))}
        </div>

        {detailTab === 'stats' ? (
          <CollectionStats
            heroId={hero.id}
            userId={userId}
            onSaved={onSaved}
          />
        ) : (
          detailTab === 'kit' ? (
          <HeroKit skills={skills} loading={skillsLoading} heroId={hero.id} />
        ) : (
          <VoiceTab voices={voices} loading={voicesLoading} />
        ))}
        </div>
      </div>

      {/* galerie d'illustrations (ouverte via la loupe) */}
      {gallery ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setGallery(false);
          }}
        >
          <img
            src={galleryArts[artIndex]}
            alt={hero.name}
            className="max-h-[92vh] max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setGallery(false);
            }}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-warm-text hover:bg-black/70"
            aria-label="Fermer"
          >
            ✕
          </button>
          {galleryArts.length > 1 ? (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setArtIndex((i) => (i - 1 + galleryArts.length) % galleryArts.length);
                }}
                className="absolute left-3 top-1/2 -translate-y-1/2 transition hover:brightness-125 sm:left-6"
                aria-label="Illustration précédente"
              >
                <span className="anim-arrow-l block">
                  <img
                    src="/feh/ui/arrow.png"
                    alt=""
                    className="h-12 w-auto -scale-x-100 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
                  />
                </span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setArtIndex((i) => (i + 1) % galleryArts.length);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 transition hover:brightness-125 sm:right-6"
                aria-label="Illustration suivante"
              >
                <span className="anim-arrow-r block">
                  <img
                    src="/feh/ui/arrow.png"
                    alt=""
                    className="h-12 w-auto drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
                  />
                </span>
              </button>
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-warm-text">
                {artIndex + 1} / {galleryArts.length}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Credit({
  icon,
  alt,
  name,
  nameJa,
}: {
  icon: string;
  alt: string;
  name?: string;
  nameJa?: string;
}) {
  if (!name && !nameJa) return null;
  return (
    <div className="flex items-center gap-2">
      <img
        src={icon}
        alt={alt}
        className="h-5 w-5 flex-none object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,.7)]"
      />
      <div className="min-w-0 leading-tight text-white [text-shadow:0_1px_2px_rgba(0,0,0,.9),0_0_5px_rgba(0,0,0,.7)]">
        {name ? (
          <div className="break-words text-[13px] font-semibold">{name}</div>
        ) : null}
        {nameJa ? (
          <div className="break-words text-[11px] text-white/85">{nameJa}</div>
        ) : null}
      </div>
    </div>
  );
}

function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Lecteur audio custom aux couleurs FEH (remplace <audio controls>).
function VoicePlayer({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = ref.current;
    if (!a || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur;
  };

  const pct = dur ? (cur / dur) * 100 : 0;

  return (
    <div className="flex items-center gap-2.5 rounded-full border border-gold-deep/40 bg-black/30 py-1.5 pl-1.5 pr-3 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
      <audio
        ref={ref}
        src={src}
        preload="none"
        onPlay={() => {
          document
            .querySelectorAll('audio')
            .forEach((el) => el !== ref.current && el.pause());
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setCur(ref.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDur(ref.current?.duration ?? 0)}
      />
      <button
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Lecture'}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#ffe39a] to-[#b78a2e] text-[#3a2a08] shadow-[0_1px_2px_rgba(0,0,0,0.5)] transition hover:brightness-110 active:scale-95"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
            <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4 fill-current">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <div
        onClick={seek}
        className="relative h-2 flex-1 cursor-pointer rounded-full bg-black/45"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: GOLD_GRAD }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#fff3cf] shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
          style={{ left: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 font-feh text-[11px] tabular-nums text-warm-mute">
        {fmtTime(cur)} / {fmtTime(dur)}
      </span>
    </div>
  );
}

function VoiceTab({
  voices,
  loading,
}: {
  voices: HeroVoices | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <p className="px-5 pb-5 pt-3 text-sm text-warm-dim">
        Chargement des voix…
      </p>
    );
  }
  const groups = VOICE_CATS.map((c) => {
    const clips: { n: number; url: string; text?: string }[] = [];
    for (let i = 1; i <= c.max; i++) {
      const url = voices?.[`${c.key}_${i}`];
      if (typeof url === 'string' && url.trim()) {
        const t = voices?.[`${c.key}_${i}_transcription`];
        clips.push({
          n: i,
          url,
          text: typeof t === 'string' && t.trim() ? t : undefined,
        });
      }
    }
    return { ...c, clips };
  }).filter((g) => g.clips.length > 0);

  if (groups.length === 0) {
    return (
      <p className="px-5 pb-5 pt-3 text-sm text-warm-dim">
        Aucune voix disponible pour ce héros.
      </p>
    );
  }

  return (
    <div className="space-y-4 px-5 pb-5 pt-3">
      {groups.map((g) => (
        <div key={g.key}>
          <h4 className="mb-1.5 font-feh text-[13px] font-semibold text-gold-text">
            {g.label}
          </h4>
          <div className="space-y-1.5">
            {g.clips.map((clip) => (
              <div key={clip.n} className="flex items-start gap-2">
                <span className="mt-2 w-5 shrink-0 text-right font-feh text-[11px] text-warm-mute">
                  {clip.n}
                </span>
                <div className="min-w-0 flex-1">
                  <VoicePlayer src={clip.url} />
                  {clip.text ? (
                    <p className="mt-1 px-1 text-[12.5px] italic leading-snug text-warm-dim">
                      « {clip.text} »
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-warm-dim">
      {children}
    </span>
  );
}
