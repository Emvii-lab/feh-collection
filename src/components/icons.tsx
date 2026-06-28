import type { MoveType, WeaponType } from '../types';

const WEAPON_GLYPH: Record<WeaponType, string> = {
  Sword: '🗡️',
  Lance: '🔱',
  Axe: '🪓',
  Tome: '📖',
  Bow: '🏹',
  Dagger: '🔪',
  Staff: '✨',
  Dragon: '🐉',
  Beast: '🐾',
};

export function WeaponIcon({
  type,
  iconUrl,
  size = 18,
}: {
  type: WeaponType;
  iconUrl?: string;
  size?: number;
}) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={type}
        title={type}
        style={{ width: size, height: size }}
        className="inline-block object-contain align-middle"
      />
    );
  }
  return (
    <span title={type} aria-label={type}>
      {WEAPON_GLYPH[type]}
    </span>
  );
}

// Emoji « best-effort » selon le libellé (quel qu'il soit) ; sinon générique.
function moveGlyph(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('infanterie') || l.includes('infantry')) return '👣';
  if (l.includes('blind') || l.includes('armor')) return '🛡️';
  if (l.includes('cavalier') || l.includes('cavalry') || l.includes('cheval'))
    return '🐎';
  if (l.includes('volant') || l.includes('flying') || l.includes('vol'))
    return '🕊️';
  return '•';
}

export function MoveIcon({
  type,
  iconUrl,
  size = 18,
}: {
  type: MoveType;
  iconUrl?: string;
  size?: number;
}) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={type}
        title={type}
        style={{ width: size, height: size }}
        className="inline-block object-contain align-middle"
      />
    );
  }
  return (
    <span title={type} aria-label={type}>
      {moveGlyph(type)}
    </span>
  );
}

export function RarityStars({ rarity, rarityUrl }: { rarity: number; rarityUrl?: string }) {
  if (rarityUrl) {
    return (
      <span className="flex items-center justify-center -space-x-[3px]">
        {Array.from({ length: rarity }).map((_, i) => (
          <img
            key={i}
            src={rarityUrl}
            alt="★"
            className="h-[19px] w-[19px] object-contain"
          />
        ))}
      </span>
    );
  }
  return (
    <span className="tracking-[1px] text-gold-text">
      {'★'.repeat(rarity)}
      <span className="text-white/15">{'★'.repeat(5 - rarity)}</span>
    </span>
  );
}
