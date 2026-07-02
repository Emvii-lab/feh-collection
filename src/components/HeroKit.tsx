import type { SkillRow } from '../lib/useHeroSkills';

const CATS: { key: string; label: string }[] = [
  { key: 'weapon', label: 'Armes' },
  { key: 'assist', label: 'Assist' },
  { key: 'special', label: 'Spéciale' },
  { key: 'passivea', label: 'Passif A' },
  { key: 'passiveb', label: 'Passif B' },
  { key: 'passivec', label: 'Passif C' },
];

// Nettoie le wikitext des descriptions ([[..]], {{..}}, <br>, ''gras''…).
function cleanWiki(t: string | null): string {
  if (!t) return '';
  return t
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/''+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function HeroKit({
  skills,
  loading,
}: {
  skills: SkillRow[] | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <p className="px-5 pb-5 pt-3 text-sm text-warm-dim">Chargement du kit…</p>
    );
  }
  if (!skills || skills.length === 0) {
    return (
      <p className="px-5 pb-5 pt-3 text-sm text-warm-dim">
        Aucune compétence trouvée pour ce héros.
      </p>
    );
  }

  // Meilleure arme = plus grosse puissance de base parmi les armes du kit.
  const weapons = skills.filter((s) => s.scategory === 'weapon');
  const bestWeapon =
    weapons.length > 0
      ? weapons.reduce((a, b) => ((b.might ?? 0) > (a.might ?? 0) ? b : a))
      : null;

  return (
    <div className="space-y-4 px-5 pb-5 pt-3">
      {CATS.map((cat) => {
        let list = skills.filter((s) => s.scategory === cat.key);
        if (cat.key === 'weapon') {
          list = [...list].sort((a, b) => (b.might ?? 0) - (a.might ?? 0));
        } else {
          list = [...list].sort((a, b) => (a.sp ?? 0) - (b.sp ?? 0));
        }
        if (list.length === 0) return null;
        return (
          <div key={cat.key}>
            <h4 className="mb-1.5 font-feh text-[13px] font-semibold text-gold-text">
              {cat.label}
            </h4>
            <div className="space-y-1.5">
              {list.map((s) => {
                const isBest = cat.key === 'weapon' && s === bestWeapon;
                return (
                  <div
                    key={s.wiki_name}
                    className={`rounded-lg border px-3 py-2 ${
                      isBest
                        ? 'border-gold/50 bg-gold/[0.08]'
                        : 'border-white/10 bg-black/25'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-warm-text">
                        {s.name}
                      </span>
                      {isBest ? (
                        <span className="shrink-0 rounded-full bg-gold/20 px-2 py-0.5 font-feh text-[10px] font-bold text-gold-light">
                          ★ Meilleure arme
                        </span>
                      ) : null}
                      <span className="ml-auto shrink-0 font-feh text-[11px] text-warm-mute">
                        {s.might != null ? `Pv. ${s.might}` : ''}
                        {s.cooldown != null ? `CD ${s.cooldown}` : ''}
                        {s.sp != null ? ` · ${s.sp} SP` : ''}
                      </span>
                    </div>
                    {s.weapon_effectiveness ? (
                      <div className="mt-0.5 text-[11px] text-emerald-300/90">
                        Efficace vs {cleanWiki(s.weapon_effectiveness)}
                      </div>
                    ) : null}
                    {s.description ? (
                      <p
                        className="mt-1 line-clamp-2 text-[12px] leading-snug text-warm-dim"
                        title={cleanWiki(s.description)}
                      >
                        {cleanWiki(s.description)}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
