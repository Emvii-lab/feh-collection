import { useState } from 'react';
import type { Hero } from '../types';
import { PORTRAIT } from '../theme';

// Fond teinté par couleur d'arme (repris de la maquette) + illustration wiki.
export function HeroPortrait({
  hero,
  className = '',
  forceFallback = false,
  imageUrl,
}: {
  hero: Hero;
  className?: string;
  forceFallback?: boolean;
  imageUrl?: string;
}) {
  const [failed, setFailed] = useState(false);
  const fallbackUrl = 'https://supabase.emvii.fr/storage/v1/object/public/feh-assets/ui/unknown_hero_aswwcu.png';
  const resolvedImageUrl =
    !forceFallback && !failed && imageUrl && imageUrl.trim()
      ? imageUrl
      : !forceFallback && hero.art && hero.art.trim() && !failed
        ? hero.art
      : fallbackUrl;

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ background: PORTRAIT[hero.color] }}
    >
      {failed && resolvedImageUrl === fallbackUrl ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-feh text-5xl font-bold text-white/80">
            {hero.name.charAt(0)}
          </span>
        </div>
      ) : (
        <img
          src={resolvedImageUrl}
          alt={`${hero.name} — ${hero.title}`}
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-contain object-bottom drop-shadow-[0_4px_10px_rgba(0,0,0,0.55)]"
        />
      )}
    </div>
  );
}
