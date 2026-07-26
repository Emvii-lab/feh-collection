import type { Hero } from '../types';
import { HeroPortrait } from './HeroPortrait';
import { RarityStars } from './icons';

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
      className={`group relative rounded-2xl border bg-white/[0.02] p-0 text-left transition-all duration-150 ${
        owned ? 'cursor-pointer hover:-translate-y-[3px]' : 'cursor-default'
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

      <div className="relative aspect-[1/1.06] overflow-hidden rounded-2xl bg-[rgba(14,10,7,.72)]">
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

        {/* badge tenue resplendissante : cliquable (héros possédé) pour marquer la tenue obtenue */}
        {hasResplendent ? (
          canToggleResplendent ? (
            <span
              role="button"
              aria-label="Marquer la tenue resplendissante comme obtenue"
              aria-pressed={Boolean(resplendentObtained)}
              title={
                resplendentObtained
                  ? 'Tenue resplendissante obtenue (cliquer pour retirer)'
                  : 'Marquer la tenue resplendissante comme obtenue'
              }
              onClick={(e) => {
                e.stopPropagation();
                onToggleResplendent?.();
              }}
              className="absolute left-2 top-2 cursor-pointer transition hover:brightness-110 active:scale-95"
            >
              <img
                src="/feh/ui/alternate_art.png"
                alt="Tenue resplendissante"
                className={`h-9 w-9 object-contain ${
                  resplendentObtained
                    ? 'drop-shadow-[0_0_6px_rgba(251,230,166,0.9)]'
                    : 'opacity-70 grayscale drop-shadow-[0_1px_3px_rgba(0,0,0,.6)]'
                }`}
              />
            </span>
          ) : (
            <img
              src="/feh/ui/alternate_art.png"
              alt="Tenue resplendissante"
              title="Tenue resplendissante"
              className={`absolute left-2 top-2 h-9 w-9 object-contain ${
                resplendentObtained
                  ? 'drop-shadow-[0_0_6px_rgba(251,230,166,0.9)]'
                  : 'opacity-70 grayscale drop-shadow-[0_1px_3px_rgba(0,0,0,.6)]'
              }`}
            />
          )
        ) : null}

        {/* statut possédé / ajouter (masqué en lecture seule : pas d'édition d'autrui) */}
        {readOnly ? null : owned ? (
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
          <RarityStars
            rarity={displayRarity}
            rarityUrl={rarityIcons.get(displayRarity)}
          />
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
