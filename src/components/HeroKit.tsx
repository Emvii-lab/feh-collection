import { useEffect, useState } from 'react';
import type { SkillRow } from '../lib/useHeroSkills';
import { fetchHeroStats, type CollStats } from '../lib/collection';
import { supabase } from '../lib/supabase';
import { isHighRarity, type SealPick } from '../lib/seals';
import { BuildEditor } from './BuildEditor';

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
// L'indentation de début de ligne est préservée (pour les listes à puces « - … »),
// tandis que les espaces internes multiples sont réduits. À afficher avec `whitespace-pre-wrap`.
function cleanWikiML(t: string | null): string {
  if (!t) return '';
  return t
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/''+/g, '')
    .split('\n')
    .map((line) => {
      const indent = line.match(/^[ \t]*/)?.[0] ?? '';
      const body = line.slice(indent.length).replace(/[ \t]+/g, ' ').trimEnd();
      return indent + body;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const isBrave = (d: string | null) => /attacks?\s+twice|brave/i.test(d ?? '');
const isSlaying = (d: string | null) =>
  /accelerates special|slaying|special cooldown charge/i.test(d ?? '');

// stat_modifiers = "HP,ATK,SPD,DEF,RES" (inclut le raffinage, ex. raffinage ATQ → +ATQ).
function parseMods(s: SkillRow): { hp: number; atk: number; spd: number; def: number; res: number } {
  const p = (s.stat_modifiers ?? '').split(',').map((x) => parseInt(x, 10) || 0);
  return { hp: p[0] ?? 0, atk: p[1] ?? 0, spd: p[2] ?? 0, def: p[3] ?? 0, res: p[4] ?? 0 };
}
// Dmg réel d'une arme = l'ATQ des stat_modifiers (prend en compte le raffinage ATQ) ;
// repli sur `might` si absent.
function weaponDmg(s: SkillRow): number {
  return parseMods(s).atk || s.might || 0;
}
// Stats bonus À AFFICHER en plus du Dmg (l'ATQ est déjà le Dmg) : PV/VIT/DÉF/RÉS non nuls.
function extraModsLabel(s: SkillRow): string {
  const m = parseMods(s);
  return [
    m.hp ? `PV+${m.hp}` : '',
    m.spd ? `VIT+${m.spd}` : '',
    m.def ? `DÉF+${m.def}` : '',
    m.res ? `RÉS+${m.res}` : '',
  ].filter(Boolean).join(' ');
}

// Classement d'arme = le Dmg (puissance) prime — Dmg = ATQ raffinage compris. Seul Brave
// (≈ ×2 coups) augmente le Dmg réel ; l'efficacité (situationnelle) et le slaying ne
// comptent PAS ici.
function effMight(w: SkillRow): number {
  const m = weaponDmg(w);
  return isBrave(w.description) ? Math.round(m * 1.9) : m;
}
// Départage à Dmg égal : la somme des autres stats bonus (PV/VIT/DÉF/RÉS).
function weaponSecondary(s: SkillRow): number {
  const m = parseMods(s);
  return m.hp + m.spd + m.def + m.res;
}
// Meilleure arme : on classe sur le PLAFOND de Dmg (meilleur raffinage possible, via
// `ceilings` lu en base) — une PRF raffinable à 18 bat une commune plafonnée à 16 même
// non raffinée ; à plafond égal, plus de stats bonus, puis la version supérieure.
function pickBestWeapon(weapons: SkillRow[], ceilings?: Map<string, number>): SkillRow | null {
  if (weapons.length === 0) return null;
  const sup = supersededSet(weapons);
  const dmgOf = (w: SkillRow) => Math.max(effMight(w), ceilings?.get(w.name) ?? 0);
  return weapons.reduce((a, b) => {
    const ea = dmgOf(a), eb = dmgOf(b);
    if (eb !== ea) return eb > ea ? b : a;
    const sa = weaponSecondary(a), sb = weaponSecondary(b);
    if (sb !== sa) return sb > sa ? b : a;
    return sup.has(a.wiki_name) && !sup.has(b.wiki_name) ? b : a;
  });
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
  userId,
  readOnly,
  sealPick,
}: {
  skills: SkillRow[] | null;
  loading: boolean;
  heroId: string;
  userId: string | null; // compte dont on lit les stats (soi-même ou compte consulté)
  readOnly?: boolean; // consultation d'une autre collection : build en lecture seule
  sealPick?: SealPick | null; // sceau attribué par la répartition globale (unique)
}) {
  const [stats, setStats] = useState<CollStats | null>(null);
  const [detail, setDetail] = useState<SkillRow | null>(null);
  useEffect(() => {
    let active = true;
    fetchHeroStats(heroId, userId).then((s) => active && setStats(s));
    return () => {
      active = false;
    };
  }, [heroId, userId]);

  // Pour CHAQUE arme du héros, on lit dans toute la base ses variantes raffinées :
  // - le PLAFOND de Dmg (meilleur raffinage possible) → sert au classement, pour qu'une
  //   PRF raffinable à 18 batte une commune plafonnée à 16, même si tu ne l'as pas raffinée.
  // - les chemins de raffinage dispo (atk/spd/def/res/effet) → pour le conseil de forge.
  const [refineData, setRefineData] = useState<{ ceilings: Map<string, number>; pathsByName: Map<string, string[]> }>(
    { ceilings: new Map(), pathsByName: new Map() },
  );
  useEffect(() => {
    const ws = (skills ?? []).filter((s) => s.scategory === 'weapon');
    if (!supabase || ws.length === 0) {
      setRefineData({ ceilings: new Map(), pathsByName: new Map() });
      return;
    }
    const names = [...new Set(ws.map((w) => w.name))];
    let active = true;
    supabase
      .from('skills')
      .select('name,might,stat_modifiers,description,refine_path')
      .eq('scategory', 'weapon')
      .in('name', names)
      .then(({ data }) => {
        if (!active) return;
        const ceilings = new Map<string, number>();
        const pathsByName = new Map<string, string[]>();
        for (const r of (data ?? []) as SkillRow[]) {
          ceilings.set(r.name, Math.max(ceilings.get(r.name) ?? 0, effMight(r)));
          if (r.refine_path) {
            const arr = pathsByName.get(r.name) ?? [];
            if (!arr.includes(r.refine_path)) arr.push(r.refine_path);
            pathsByName.set(r.name, arr);
          }
        }
        setRefineData({ ceilings, pathsByName });
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
    const key = sealPick?.key;
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
  }, [sealPick?.key]);

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

  // Meilleure arme = plus gros Dmg (ATQ, raffinage inclus) ; À DMG ÉGAL, on préfère celle
  // qui apporte le plus de stats bonus (PV/VIT/DÉF/RÉS) — ex. un Fer meurtrier raffiné ATQ
  // (Dmg 16 + PV5) bat l'Épée sans nom de base (Dmg 16, 0 bonus) à effet identique ; en
  // dernier recours, la version supérieure de la chaîne (le +).
  const weapons = skills.filter((s) => s.scategory === 'weapon');
  const bestWeapon = pickBestWeapon(weapons, refineData.ceilings);

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
  const seal = sealPick ?? null;
  const refineText = refineAdvice(stats, bestWeapon ? refineData.pathsByName.get(bestWeapon.name) ?? [] : []);

  return (
    <>
    <div className="space-y-4 px-5 pb-5 pt-3">
      <BuildEditor heroId={heroId} userId={userId} readOnly={readOnly} learnset={skills} />

      {advice ? (
        <div className="rounded-lg border border-gold-deep/40 bg-gold/[0.06] px-3 py-2 text-[12.5px] text-warm-text">
          <span className="font-feh font-semibold text-gold-text">
            Conseil :{' '}
          </span>
          {advice}
        </div>
      ) : (
        <p className="text-[11.5px] text-warm-mute">
          Astuce : saisis les stats du héros (onglet Stats) pour un conseil de
          build adapté à son profil.
        </p>
      )}

      {/* Sceau (S) : chaque sceau est unique → réparti sur tes 5★+ (rareté puis stats). */}
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
            (Sceau unique, réservé à ce héros parmi tes 5★+ ; à forger puis
            assigner via « Assigner sceaux ».)
          </span>
        </div>
      ) : isHighRarity(stats?.rarity) ? (
        <p className="text-[11.5px] text-warm-mute">
          Aucun sceau unique restant pour ce héros : chaque sceau n’existe qu’en
          un exemplaire et a été attribué à des héros mieux classés (rareté puis
          total de stats).
        </p>
      ) : (
        <p className="text-[11.5px] text-warm-mute">
          Les sceaux ne sont conseillés que pour tes héros 5★ et plus (rareté de
          ton exemplaire, à renseigner dans l’onglet Stats).
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
                const dmgVal = cat.key === 'weapon' ? weaponDmg(s) : s.might;
                const extraMods = cat.key === 'weapon' ? extraModsLabel(s) : '';
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
                            dmgVal != null ? `Dmg ${dmgVal}` : null,
                            s.cooldown != null ? `CD ${s.cooldown}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {extraMods ? (
                          <span className="font-feh text-[11px] text-sky-300/90" title="Bonus de stats (raffinage inclus)">
                            {extraMods}
                          </span>
                        ) : null}
                        {isBest && dmgVal != null && (refineData.ceilings.get(s.name) ?? 0) > dmgVal ? (
                          <span className="font-feh text-[10px] text-gold-light/80" title="Dmg atteignable une fois raffinée (raffinage ATQ)">
                            → Dmg {refineData.ceilings.get(s.name)} raffinée
                          </span>
                        ) : null}
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
                {(detail.scategory === 'weapon' ? weaponDmg(detail) : detail.might) != null
                  ? ` · Dmg ${detail.scategory === 'weapon' ? weaponDmg(detail) : detail.might}` : ''}
                {detail.cooldown != null ? ` · CD ${detail.cooldown}` : ''}
                {detail.scategory === 'weapon' && extraModsLabel(detail) ? ` · ${extraModsLabel(detail)}` : ''}
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
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-warm-dim">
            {cleanWikiML(detail.description) || 'Aucune description.'}
          </p>
        </div>
      </div>
    ) : null}
    </>
  );
}
