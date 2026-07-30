import { useEffect, useRef, useState } from 'react';
import type { Hero } from '../types';
import { HeroPortrait } from './HeroPortrait';
import { RarityStars } from './icons';

// Particules du « Get ! » : 6 directions fixes façon éclat d'objet ramassé.
const BURST_DOTS = [0, 60, 120, 180, 240, 300].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.cos(rad) * 42, y: Math.sin(rad) * 42 };
});

// Anneau de focus commun aux contrôles de la carte : sans lui, le style par
// défaut du navigateur est un outline noir de 1px, invisible sur le fond sombre.
const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-gold-light/70 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-deep';

export function HeroCard({
  hero,
  owned,
  selected,
  onOpen,
  onToggleOwned,
  rarityIcons,
  copyRarity,
  maxLevel,
  resplendentObtained,
  onToggleResplendent,
  readOnly,
  index = 0,
}: {
  hero: Hero;
  owned: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleOwned: () => void;
  rarityIcons: Map<number, string>;
  copyRarity?: number | null;
  maxLevel?: boolean; // exemplaire monté au niveau 40 (max)
  resplendentObtained?: boolean; // tenue resplendissante obtenue (collection)
  onToggleResplendent?: () => void;
  readOnly?: boolean; // consultation d'une autre collection : pas d'édition
  index?: number; // position dans la grille filtrée → délai d'entrée en cascade
}) {
  // Rareté affichée = mon exemplaire si renseigné, sinon rareté max du héros.
  const displayRarity = copyRarity ?? hero.rarity;

  const hasResplendent = Boolean(
    hero.artResplendent ||
      hero.artResplendentAttack ||
      hero.artResplendentSpecial ||
      hero.artResplendentInjured ||
      hero.spriteResplendent,
  );
  // Cliquer sur le badge marque la tenue comme obtenue (héros possédé, hors lecture seule).
  const canToggleResplendent = owned && hasResplendent && !readOnly;
  // Sprite resplendissant affiché sur la carte quand la tenue est obtenue (si dispo).
  const showRespSprite = Boolean(resplendentObtained && hero.spriteResplendent);

  // « Get ! » : éclat de particules quand le héros rejoint la collection.
  const [burst, setBurst] = useState(false);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (burstTimer.current) clearTimeout(burstTimer.current);
    },
    [],
  );
  const triggerBurst = () => {
    setBurst(true);
    if (burstTimer.current) clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(() => setBurst(false), 550);
  };

  const cardShadow = selected
    ? '0 0 0 2px rgba(232,196,94,.95), 0 8px 26px rgba(180,120,20,.4)'
    : owned
      ? '0 6px 16px rgba(0,0,0,.35), 0 0 14px rgba(216,177,78,.12)'
      : '0 6px 16px rgba(0,0,0,.35)';
  const borderColor = selected
    ? 'rgba(232,196,94,.95)'
    : owned
      ? 'rgba(216,177,78,.45)'
      : 'rgba(255,255,255,.08)';

  return (
    // Élément dédié à l'entrée en cascade : elle anime `transform`, tout comme
    // le survol de la carte — sur un même nœud, l'une écraserait l'autre.
    <div
      className="card-enter w-full"
      style={{ animationDelay: `${Math.min(index, 18) * 20}ms` }}
    >
      {/* La carte est un conteneur et NON un <button> : les pastilles de
          collection sont de vrais boutons, or un <button> ne peut pas en
          contenir d'autres. L'ouverture de la fiche passe par un bouton
          transparent plein cadre (z-10), les contrôles vivant au-dessus (z-20). */}
      <article
        style={{ boxShadow: cardShadow, borderColor }}
        className={`group relative block w-full rounded-2xl border bg-white/[0.02] text-left transition-all duration-150 ${
          owned ? 'hover:-translate-y-[3px]' : ''
        } ${selected ? '-translate-y-[3px]' : ''}`}
      >
        {/* marqueur niveau 40 (max) : onglet qui dépasse AU-DESSUS du cadre */}
        {maxLevel ? (
          <span
            title="Niveau 40 (max)"
            aria-label="Niveau 40"
            className="pointer-events-none absolute left-1/2 top-0 z-20 rounded-t-md px-2.5 py-[3px] font-feh text-[10.5px] font-bold leading-none tracking-[0.5px] text-[#3a2a06] shadow-[0_-1px_3px_rgba(0,0,0,.45)] ring-1 ring-[rgba(255,244,214,.7)]"
            style={{
              background: 'linear-gradient(180deg,#ffe9a8,#e8c45e 58%,#b78a2e)',
              // bas de l'onglet posé PILE sur le bord haut du cadre (tout au-dessus)
              transform: 'translate(-50%, calc(-100% - 1px))',
              // la police FEH plafonne à 700 : on épaissit les traits pour un vrai gras
              WebkitTextStroke: '0.4px #3a2a06',
            }}
          >
            NIV. 40
          </span>
        ) : null}

        <div className="card-flash relative aspect-[1/1.06] overflow-hidden rounded-2xl bg-[rgba(14,10,7,.72)]">
          {/* le sprite respire au survol/focus */}
          <div className="card-sprite-bob absolute inset-x-0 top-0 bottom-[62px]">
            <HeroPortrait
              hero={hero}
              className="h-full w-full"
              forceFallback={!owned}
              imageUrl={showRespSprite ? hero.spriteResplendent : undefined}
            />
          </div>

          {/* dégradé bas pour lisibilité du texte */}
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-[82px] bg-gradient-to-b from-transparent via-[rgba(14,10,7,.88)] to-[rgba(14,10,7,.96)]"
          />

          {/* éclat « Get ! » quand le héros vient de rejoindre la collection */}
          {burst
            ? BURST_DOTS.map((d, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="burst-dot z-20"
                  style={{
                    ['--bx' as string]: `${d.x}px`,
                    ['--by' as string]: `${d.y}px`,
                    animationDelay: `${i * 15}ms`,
                  }}
                />
              ))
            : null}

          {/* Ouverture de la fiche : bouton plein cadre. Il porte l'anneau de
              focus, qui trace donc exactement le contour de la carte. */}
          <button
            type="button"
            onClick={onOpen}
            disabled={!owned}
            aria-label={`Ouvrir la fiche de ${hero.name} — ${hero.title}`}
            className={`absolute inset-0 z-10 rounded-2xl ${FOCUS_RING} ${
              owned ? 'cursor-pointer' : 'cursor-default'
            }`}
          />

          {/* badge tenue resplendissante. Cible de 44px obtenue par le padding
              du bouton, le sprite gardant sa taille et sa position d'origine. */}
          {hasResplendent ? (
            canToggleResplendent ? (
              <button
                type="button"
                aria-label="Marquer la tenue resplendissante comme obtenue"
                aria-pressed={Boolean(resplendentObtained)}
                title={
                  resplendentObtained
                    ? 'Tenue resplendissante obtenue (cliquer pour retirer)'
                    : 'Marquer la tenue resplendissante comme obtenue'
                }
                onClick={onToggleResplendent}
                className={`absolute left-1 top-1 z-20 rounded-lg p-1 transition hover:brightness-110 active:scale-95 ${FOCUS_RING}`}
              >
                <img
                  src="/feh/ui/alternate_art.png"
                  alt=""
                  className={`h-9 w-9 object-contain ${
                    resplendentObtained
                      ? 'drop-shadow-[0_0_6px_rgba(251,230,166,0.9)]'
                      : 'opacity-70 grayscale drop-shadow-[0_1px_3px_rgba(0,0,0,.6)]'
                  }`}
                />
              </button>
            ) : (
              <img
                src="/feh/ui/alternate_art.png"
                alt="Tenue resplendissante"
                title="Tenue resplendissante"
                className={`pointer-events-none absolute left-2 top-2 z-20 h-9 w-9 object-contain ${
                  resplendentObtained
                    ? 'drop-shadow-[0_0_6px_rgba(251,230,166,0.9)]'
                    : 'opacity-70 grayscale drop-shadow-[0_1px_3px_rgba(0,0,0,.6)]'
                }`}
              />
            )
          ) : null}

          {/* Bascule de collection : un vrai <button> (c'était un <span
              role="button"> sans tabindex ni gestionnaire clavier, donc
              l'action centrale de l'app était inatteignable au clavier).
              Padding = cible de 44px, le sprite de 28px restant à sa place.
              Sur un héros possédé, RIEN au repos : l'état est déjà porté par le
              liseré doré et le sprite à pleine saturation ; le losange de
              retrait n'apparaît qu'au survol ou au focus. */}
          {readOnly ? null : (
            <button
              type="button"
              onClick={() => {
                onToggleOwned();
                if (!owned) triggerBurst();
              }}
              title={owned ? 'Retirer de ma collection' : 'Ajouter à ma collection'}
              aria-label={
                owned ? 'Retirer de ma collection' : 'Ajouter à ma collection'
              }
              aria-pressed={owned}
              className={`absolute right-0 top-0 z-20 rounded-lg p-2 transition hover:brightness-110 active:scale-95 ${FOCUS_RING}`}
            >
              <img
                src={owned ? '/feh/ui/button_down.png' : '/feh/ui/plus.png'}
                alt=""
                className={`h-7 w-7 drop-shadow-[0_2px_3px_rgba(0,0,0,.5)] transition-opacity ${
                  owned
                    ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                    : ''
                }`}
              />
            </button>
          )}

          {/* étoiles */}
          <div className="pointer-events-none absolute inset-x-0 bottom-[44px] z-20 flex justify-center text-[11px] tracking-[1px] text-gold-text">
            <RarityStars
              rarity={displayRarity}
              rarityUrl={rarityIcons.get(displayRarity)}
            />
          </div>

          {/* nom + épithète */}
          <div className="pointer-events-none absolute inset-x-0 bottom-[11px] z-20 px-2 text-center">
            <div className="font-feh text-[17px] font-semibold leading-[1.05] tracking-[0.3px] text-warm-head">
              {hero.name}
            </div>
            <div className="mt-px truncate text-[10.5px] text-[#c4b48f]">
              {hero.title}
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}