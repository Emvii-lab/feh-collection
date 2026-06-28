import { useState } from 'react';
import type { Hero } from '../types';
import { HeroPortrait } from './HeroPortrait';
import { RarityStars } from './icons';

export function HeroCard({
  hero,
  owned,
  selected,
  onOpen,
  onToggleOwned,
}: {
  hero: Hero;
  owned: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleOwned: () => void;
}) {


  const hasResplendent = Boolean(
    hero.artResplendent ||
      hero.artResplendentAttack ||
      hero.artResplendentSpecial ||
      hero.artResplendentInjured ||
      hero.spriteResplendent,
  );
  // On ne peut basculer le sprite de la carte que si le sprite resp. existe.
  const canToggleSprite = Boolean(hero.spriteResplendent);
  const [respSprite, setRespSprite] = useState(false);
  const showRespSprite = respSprite && canToggleSprite;

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
    <button
      onClick={owned ? onOpen : undefined}
      aria-disabled={!owned}
      style={{ boxShadow: cardShadow, borderColor }}
      className={`group relative overflow-hidden rounded-2xl border bg-white/[0.02] p-0 text-left transition-all duration-150 ${
        owned ? 'cursor-pointer hover:-translate-y-[3px]' : 'cursor-default'
      } ${selected ? '-translate-y-[3px]' : ''}`}
    >
      <div className="relative aspect-[1/1.06] overflow-hidden bg-[rgba(14,10,7,.72)]">
        <div className="absolute inset-x-0 top-0 bottom-[62px]">
          <HeroPortrait
            hero={hero}
            className="h-full w-full"
            forceFallback={!owned}
            imageUrl={showRespSprite ? hero.spriteResplendent : undefined}
          />
        </div>

        {/* dégradé bas pour lisibilité du texte */}
        <div className="absolute inset-x-0 bottom-0 h-[82px] bg-gradient-to-b from-transparent via-[rgba(14,10,7,.88)] to-[rgba(14,10,7,.96)]" />

        {/* badge tenue resplendissante : cliquable pour basculer le sprite si dispo */}
        {hasResplendent ? (
          canToggleSprite ? (
            <span
              role="button"
              aria-label="Basculer le sprite resplendissant"
              title={
                showRespSprite ? 'Sprite normal' : 'Sprite resplendissant'
              }
              onClick={(e) => {
                e.stopPropagation();
                setRespSprite((v) => !v);
              }}
              className="absolute left-2 top-2 cursor-pointer transition hover:brightness-110 active:scale-95"
            >
              <img
                src="/feh/ui/alternate_art.png"
                alt="Tenue resplendissante"
                className={`h-9 w-9 object-contain ${
                  showRespSprite
                    ? 'drop-shadow-[0_0_6px_rgba(251,230,166,0.9)]'
                    : 'drop-shadow-[0_1px_3px_rgba(0,0,0,.6)]'
                }`}
              />
            </span>
          ) : (
            <img
              src="/feh/ui/alternate_art.png"
              alt="Tenue resplendissante"
              title="Tenue resplendissante"
              className="absolute left-2 top-2 h-9 w-9 object-contain drop-shadow-[0_1px_3px_rgba(0,0,0,.6)]"
            />
          )
        ) : null}

        {/* statut possédé / ajouter */}
        {owned ? (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleOwned();
            }}
            title="Retirer de ma collection"
            aria-label="Retirer de ma collection"
            className="absolute right-2 top-2 cursor-pointer transition hover:brightness-110 active:scale-95"
          >
            <img
              src="/feh/ui/button_down.png"
              alt="Retirer"
              className="h-7 w-7 drop-shadow-[0_2px_3px_rgba(0,0,0,.5)]"
            />
          </span>
        ) : (
          <span
            role="button"
            aria-label="Ajouter à ma collection"
            onClick={(e) => {
              e.stopPropagation();
              onToggleOwned();
            }}
            title="Ajouter à ma collection"
            className="absolute right-2 top-2 cursor-pointer transition hover:brightness-110 active:scale-95"
          >
            <img
              src="/feh/ui/plus.png"
              alt="Ajouter"
              className="h-7 w-7 drop-shadow-[0_2px_3px_rgba(0,0,0,.5)]"
            />
          </span>
        )}

        {/* étoiles */}
        <div className="absolute inset-x-0 bottom-[44px] flex justify-center text-[11px] tracking-[1px] text-gold-text">
          <RarityStars rarity={hero.rarity} rarityUrl={hero.rarity_url} />
        </div>

        {/* nom + épithète */}
        <div className="absolute inset-x-0 bottom-[11px] px-2 text-center">
          <div className="font-feh text-[17px] font-semibold leading-[1.05] tracking-[0.3px] text-warm-head">
            {hero.name}
          </div>
          <div className="mt-px truncate text-[10.5px] text-[#c4b48f]">
            {hero.title}
          </div>
        </div>
      </div>
    </button>
  );
}
