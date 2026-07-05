import { useEffect, useState } from 'react';
import type { SkillRow } from '../lib/useHeroSkills';
import { fetchHeroStats, type CollStats } from '../lib/collection';
import { supabase } from '../lib/supabase';

const REFINE_LABEL: Record<string, string> = {
  atk: 'ATQ',
  spd: 'VIT',
  def: 'DÉF',
  res: 'RÉS',
};

// Raffinage conseillé (atelier d'armement) : selon le profil + les raffinages dispo de l'arme.
function refineAdvice(s: CollStats | null, paths: string[]): string | null {
  if (paths.length === 0) return null;
  const hasEffect = paths.some((p) => p.startsWith('skill'));
  if (s && s.ATQ != null && s.VIT != null && s.DEF != null && s.RES != null) {
    const max = Math.max(s.ATQ, s.VIT, s.DEF, s.RES);
    const want =
      max === s.ATQ ? 'atk' : max === s.VIT ? 'spd' : max === s.DEF ? 'def' : 'res';
    if (paths.includes(want))
      return (
        `raffinage ${REFINE_LABEL[want]}` +
        (hasEffect ? ' (ou le raffinage à effet, souvent le meilleur sur une arme PRF)' : '')
      );
  }
  const stat = paths.filter((p) => REFINE_LABEL[p]).map((p) => REFINE_LABEL[p]);
  const parts: string[] = [];
  if (stat.length) parts.push('stat : ' + stat.join('/'));
  if (hasEffect) parts.push('effet');
  return parts.length ? 'raffinable — ' + parts.join(' · ') : null;
}

const CATS: { key: string; label: string }[] = [
  { key: 'weapon', label: 'Armes' },
  { key: 'assist', label: 'Assist' },
  { key: 'special', label: 'Spéciale' },
  { key: 'passivea', label: 'Passif A' },
  { key: 'passiveb', label: 'Passif B' },
  { key: 'passivec', label: 'Passif C' },
  { key: 'passivex', label: 'Passif X' },
];
const CAT_LABEL: Record<string, string> = Object.fromEntries(
  CATS.map((c) => [c.key, c.label]),
);

// Nettoie le wikitext des descriptions.
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

// Version multiligne : les <br> deviennent de vrais retours à la ligne (pour l'affichage complet).
function cleanWikiML(t: string | null): string {
  if (!t) return '';
  return t
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/''+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const isBrave = (d: string | null) => /attacks?\s+twice|brave/i.test(d ?? '');
const isSlaying = (d: string | null) =>
  /accelerates special|slaying|special cooldown charge/i.test(d ?? '');

// Classement d'arme = le Dmg (puissance) prime. Seul Brave (≈ ×2 coups) augmente
// le Dmg réel ; l'efficacité (situationnelle) et le slaying ne comptent PAS ici.
function effMight(w: SkillRow): number {
  const m = w.might ?? 0;
  return isBrave(w.description) ? Math.round(m * 1.9) : m;
}
function weaponReason(w: SkillRow): string[] {
  const r: string[] = [];
  if (isBrave(w.description)) r.push('×2 attaques');
  if (isSlaying(w.description)) r.push('spéciale accélérée');
  return r;
}

// Ligne d'efficacité d'arme : libellé « Eff » + icône(s) (weapon_effectiveness_url).
// Le champ peut contenir PLUSIEURS urls séparées par des virgules (ex. armored,flying)
// → une icône par url, côte à côte. Repli sur le texte « vs … » si pas d'icône.
function WeaponEff({ w, size }: { w: SkillRow; size: number }) {
  if (!w.weapon_effectiveness) return null;
  const label = cleanWiki(w.weapon_effectiveness);
  const urls = (w.weapon_effectiveness_url ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  return (
    <span className="inline-flex items-center gap-1 font-feh text-[11px] text-emerald-300/90" title={`Efficace vs ${label}`}>
      Eff
      {urls.length ? (
        urls.map((u, i) => (
          <img
            key={i}
            src={u}
            alt={label}
            style={{ height: size, width: size }}
            className="object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,.5)]"
          />
        ))
      ) : (
        <span>vs {label}</span>
      )}
    </span>
  );
}

// Sceau (S) conseillé selon le profil — UNIQUEMENT des sceaux forgeables à la
// Forge sacré (noms FR in-game). Les accélérateurs de spéciale (Lame lourde,
// Lame miroitante…) ne sont PAS forgeables : anciennes récompenses d'events,
// donc jamais conseillés ici pour rester obtenables.
// key = wiki_name du sceau dans feh.skills (pour récupérer nom FR + icône scategory_url) ;
// label = repli affiché si la ligne n'est pas (encore) trouvée en base.
function sealReco(
  s: CollStats | null,
): { key: string; label: string; why: string } | null {
  if (!s || s.ATQ == null || s.VIT == null || s.DEF == null || s.RES == null)
    return null;
  const { ATQ, VIT, DEF, RES } = s;
  const max = Math.max(ATQ, VIT, DEF, RES);
  if (max === ATQ)
    return VIT >= ATQ - 8
      ? { key: 'AtkSpd 2', label: 'Atq/Vit', why: 'boost ATQ + VIT en continu — sécurise tes doublons' }
      : { key: 'AttackDef Plus2', label: 'Atq/Déf +2', why: 'boost ATQ + DÉF en continu — tu tapes fort et encaisses la riposte' };
  if (max === VIT)
    return { key: 'AtkSpd 2', label: 'Atq/Vit', why: 'boost ATQ + VIT en continu — double et évite d’être doublé' };
  if (max === DEF)
    return { key: 'Close Def 3', label: 'Déf proche', why: 'réduit les dégâts des ennemis au corps à corps' };
  return { key: 'Resistance Plus2', label: 'Résistance +2', why: 'RÉS en plus pour encaisser la magie' };
}

// Orientation de build à partir des stats de collection (si saisies).
function orientation(s: CollStats | null): string | null {
  if (!s || s.ATQ == null || s.VIT == null || s.DEF == null || s.RES == null)
    return null;
  const { ATQ, VIT, DEF, RES } = s;
  const max = Math.max(ATQ, VIT, DEF, RES);
  if (max === ATQ) {
    const slow = VIT < ATQ - 8;
    return `Profil offensif (grosse ATQ). Arme puissante + spéciale de dégâts.${
      slow ? ' VIT limitée → un skill B de doublon garanti (type Riposte prompte) fiabilise les kills.' : ''
    }`;
  }
  if (max === VIT)
    return 'Profil rapide (grosse VIT). Joue la vitesse : double l’ennemi et évite d’être doublé (skills de VIT, esquive).';
  if (max === DEF)
    return 'Profil tank physique (grosse DÉF). Contre à distance + doublon garanti, spéciale défensive.';
  return 'Profil tank magique (grosse RÉS). Encaisse la magie ; contre à distance + spéciale défensive.';
}

// Couleur du badge de rareté selon le palier de déblocage (5★ or, 4★ argent, 3★ bronze…).
function rarityClass(r: number): string {
  if (r >= 5) return 'text-amber-200';
  if (r === 4) return 'text-slate-200';
  if (r === 3) return 'text-orange-300/90';
  return 'text-warm-mute';
}

// Compétences "dépassées" dans un slot = celles qui servent de prérequis (`required`)
// à une autre compétence présente dans le kit → il existe une version supérieure.
function supersededSet(list: SkillRow[]): Set<string> {
  return new Set(
    list.map((s) => s.required).filter((x): x is string => Boolean(x)),
  );
}

export function HeroKit({
  skills,
  loading,
  heroId,
}: {
  skills: SkillRow[] | null;
  loading: boolean;
  heroId: string;
}) {
  const [stats, setStats] = useState<CollStats | null>(null);
  const [detail, setDetail] = useState<SkillRow | null>(null);
  useEffect(() => {
    let active = true;
    fetchHeroStats(heroId).then((s) => active && setStats(s));
    return () => {
      active = false;
    };
  }, [heroId]);

  // Raffinages disponibles pour la meilleure arme du héros.
  const [refinePaths, setRefinePaths] = useState<string[]>([]);
  useEffect(() => {
    const ws = (skills ?? []).filter((s) => s.scategory === 'weapon');
    if (!supabase || ws.length === 0) {
      setRefinePaths([]);
      return;
    }
    const best = ws.reduce((a, b) => (effMight(b) > effMight(a) ? b : a));
    let active = true;
    supabase
      .from('skills')
      .select('refine_path')
      .eq('scategory', 'weapon')
      .eq('name', best.name)
      .not('refine_path', 'is', null)
      .then(({ data }) => {
        if (active)
          setRefinePaths([
            ...new Set(
              (data ?? [])
                .map((r) => r.refine_path as string)
                .filter(Boolean),
            ),
          ]);
      });
    return () => {
      active = false;
    };
  }, [skills]);

  // Ligne DB du sceau conseillé (nom FR + icône), suit les traductions ajoutées en base.
  const [sealRow, setSealRow] = useState<{
    name: string | null;
    scategory_url: string | null;
  } | null>(null);
  useEffect(() => {
    const key = sealReco(stats)?.key;
    if (!supabase || !key) {
      setSealRow(null);
      return;
    }
    let active = true;
    supabase
      .from('skills')
      .select('name,scategory_url')
      .eq('wiki_name', key)
      .maybeSingle()
      .then(({ data }) => {
        if (active)
          setSealRow(
            (data as { name: string | null; scategory_url: string | null } | null) ??
              null,
          );
      });
    return () => {
      active = false;
    };
  }, [stats]);

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

  // Meilleure arme (en général) = plus gros Dmg ; à Dmg égal, la version supérieure (le +).
  const weapons = skills.filter((s) => s.scategory === 'weapon');
  const bestWeapon = (() => {
    if (weapons.length === 0) return null;
    const sup = supersededSet(weapons);
    return weapons.reduce((a, b) => {
      const ea = effMight(a);
      const eb = effMight(b);
      if (eb !== ea) return eb > ea ? b : a;
      return sup.has(a.wiki_name) && !sup.has(b.wiki_name) ? b : a;
    });
  })();

  // Compétence conseillée par slot = version la plus haute (SP max, et la version
  // supérieure de la chaîne d'amélioration à SP égal).
  const bestPerSlot = new Map<string, string>(); // scategory -> wiki_name
  for (const cat of CATS) {
    if (cat.key === 'weapon') continue;
    const list = skills.filter((s) => s.scategory === cat.key);
    if (list.length) {
      const sup = supersededSet(list);
      const pool = list.filter((s) => !sup.has(s.wiki_name));
      const top = (pool.length ? pool : list).reduce((a, b) =>
        (b.sp ?? 0) > (a.sp ?? 0) ? b : a,
      );
      bestPerSlot.set(cat.key, top.wiki_name);
    }
  }

  const advice = orientation(stats);
  const seal = sealReco(stats);
  const refineText = refineAdvice(stats, refinePaths);

  return (
    <>
    <div className="space-y-4 px-5 pb-5 pt-3">
      {advice ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-gold-deep/40 bg-gold/[0.06] px-3 py-2 text-[12.5px] text-warm-text">
            <span className="font-feh font-semibold text-gold-text">
              Conseil :{' '}
            </span>
            {advice}
          </div>
          {seal ? (
            <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[12.5px] text-warm-dim">
              <span className="font-feh font-semibold text-gold-text">
                Sceau (S) conseillé :{' '}
              </span>
              {sealRow?.scategory_url ? (
                <img
                  src={sealRow.scategory_url}
                  alt=""
                  className="mr-1 inline-block h-5 w-5 align-text-bottom object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
                />
              ) : null}
              <span className="text-warm-text">{sealRow?.name ?? seal.label}</span> — {seal.why}.
              <span className="text-warm-mute">
                {' '}
                (Forgeable à la Forge sacré, puis à assigner via « Assigner sceaux ».)
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[11.5px] text-warm-mute">
          Astuce : saisis les stats du héros (onglet Stats) pour un conseil de
          build adapté à son profil.
        </p>
      )}

      {refineText && bestWeapon ? (
        <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[12.5px] text-warm-dim">
          <span className="font-feh font-semibold text-gold-text">
            Raffinage conseillé :{' '}
          </span>
          <span className="text-warm-text">{bestWeapon.name}</span> — {refineText}.
          <span className="text-warm-mute"> (à forger à l'Atelier d'armement.)</span>
        </div>
      ) : null}

      {CATS.map((cat) => {
        let list = skills.filter((s) => s.scategory === cat.key);
        if (list.length === 0) return null;
        const sup = supersededSet(list);
        list =
          cat.key === 'weapon'
            ? [...list].sort(
                (a, b) =>
                  effMight(b) - effMight(a) ||
                  Number(sup.has(a.wiki_name)) - Number(sup.has(b.wiki_name)),
              )
            : [...list].sort(
                (a, b) =>
                  (b.sp ?? 0) - (a.sp ?? 0) ||
                  Number(sup.has(a.wiki_name)) - Number(sup.has(b.wiki_name)),
              );
        return (
          <div key={cat.key}>
            <h4 className="mb-1.5 font-feh text-[13px] font-semibold text-gold-text">
              {cat.label}
            </h4>
            <div className="space-y-1.5">
              {list.map((s) => {
                const isBest = cat.key === 'weapon' && s === bestWeapon;
                const isReco =
                  cat.key !== 'weapon' &&
                  bestPerSlot.get(cat.key) === s.wiki_name;
                const highlight = isBest || isReco;
                const reasons = cat.key === 'weapon' ? weaponReason(s) : [];
                return (
                  <div
                    key={s.wiki_name}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetail(s)}
                    className={`cursor-pointer rounded-lg border px-3 py-2 transition hover:brightness-110 ${
                      highlight
                        ? 'border-gold/50 bg-gold/[0.08]'
                        : 'border-white/10 bg-black/25'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {s.scategory_url ? (
                        <img
                          src={s.scategory_url}
                          alt=""
                          className="h-6 w-6 shrink-0 object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,.5)]"
                        />
                      ) : null}
                      <span className="truncate text-[13px] font-semibold text-warm-text">
                        {s.name}
                      </span>
                      {isBest ? (
                        <span className="shrink-0 rounded-full bg-gold/20 px-2 py-0.5 font-feh text-[10px] font-bold text-gold-light">
                          ★ Meilleure arme
                        </span>
                      ) : null}
                      {isReco ? (
                        <span className="shrink-0 rounded-full bg-gold/20 px-2 py-0.5 font-feh text-[10px] font-bold text-gold-light">
                          ✓ Conseillé
                        </span>
                      ) : null}
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        {s.unlock_rarity ? (
                          <span
                            title={`Se débloque à ${s.unlock_rarity}★`}
                            className={`rounded-full bg-black/40 px-1.5 py-0.5 font-feh text-[10px] font-bold ${rarityClass(
                              s.unlock_rarity,
                            )}`}
                          >
                            {s.unlock_rarity}★
                          </span>
                        ) : null}
                        <span className="font-feh text-[11px] text-warm-mute">
                          {[
                            s.might != null ? `Dmg ${s.might}` : null,
                            s.cooldown != null ? `CD ${s.cooldown}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        <WeaponEff w={s} size={16} />
                      </div>
                    </div>
                    {reasons.length ? (
                      <div className="mt-0.5 text-[11px] text-emerald-300/90">
                        {reasons.join(' · ')}
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

    {detail ? (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4"
        onClick={() => setDetail(null)}
      >
        <div
          className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-gold/40 bg-[#33291a] p-5 font-feh shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center gap-3">
            {detail.scategory_url ? (
              <img
                src={detail.scategory_url}
                alt=""
                className="h-9 w-9 shrink-0 object-contain"
              />
            ) : null}
            <div className="min-w-0">
              <div className="truncate font-feh text-[16px] font-bold text-warm-head">
                {detail.name}
              </div>
              <div className="text-[11px] text-warm-mute">
                {CAT_LABEL[detail.scategory] ?? detail.scategory}
                {detail.might != null ? ` · Dmg ${detail.might}` : ''}
                {detail.cooldown != null ? ` · CD ${detail.cooldown}` : ''}
                {detail.sp != null ? ` · ${detail.sp} SP` : ''}
                {detail.unlock_rarity ? (
                  <span className={rarityClass(detail.unlock_rarity)}>
                    {' '}
                    · se débloque à {detail.unlock_rarity}★
                  </span>
                ) : null}
              </div>
            </div>
            <button
              onClick={() => setDetail(null)}
              className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/40 text-warm-text hover:bg-black/60"
              aria-label="Fermer"
            >
              ✕
            </button>
          </div>
          {detail.weapon_effectiveness ? (
            <div className="mb-2 flex items-center gap-1.5 text-[12px]">
              <WeaponEff w={detail} size={20} />
            </div>
          ) : null}
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-warm-dim">
            {cleanWikiML(detail.description) || 'Aucune description.'}
          </p>
        </div>
      </div>
    ) : null}
    </>
  );
}
