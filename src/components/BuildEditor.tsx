import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { SkillRow } from '../lib/useHeroSkills';
import {
  BUILD_SLOTS, SLOT_CATEGORY, SLOT_LABEL, EMPTY_BUILD,
  fetchBuild, saveBuildSlot, type BuildSlot, type HeroBuild,
} from '../lib/builds';

type Meta = { name: string; icon: string | null };

// Éditeur de build : équipe tes vraies compétences par emplacement. Sert au simulateur
// (précision réelle de TON équipe). Options = kit natif du héros + skills hérités (recherche).
export function BuildEditor({
  heroId, userId, readOnly, learnset,
}: {
  heroId: string;
  userId: string | null;
  readOnly?: boolean;
  learnset: SkillRow[] | null;
}) {
  const [build, setBuild] = useState<HeroBuild>(EMPTY_BUILD);
  const [meta, setMeta] = useState<Map<string, Meta>>(new Map());
  const [open, setOpen] = useState<BuildSlot | null>(null);
  const [saving, setSaving] = useState(false);

  // Cache d'affichage (nom FR + icône) alimenté par le learnset.
  useEffect(() => {
    if (!learnset) return;
    setMeta((prev) => {
      const next = new Map(prev);
      for (const s of learnset) next.set(s.wiki_name, { name: s.name, icon: s.scategory_url });
      return next;
    });
  }, [learnset]);

  // Charge le build existant + le nom/icône des compétences équipées non présentes dans le kit.
  useEffect(() => {
    let active = true;
    fetchBuild(heroId, userId).then(async (b) => {
      if (!active) return;
      const built = b ?? EMPTY_BUILD();
      setBuild(built);
      const unknown = BUILD_SLOTS.map((s) => built[s]).filter(
        (v): v is string => Boolean(v),
      );
      if (supabase && unknown.length) {
        const { data } = await supabase
          .from('skills')
          .select('wiki_name,name,scategory_url')
          .in('wiki_name', unknown);
        if (active && data) {
          setMeta((prev) => {
            const next = new Map(prev);
            for (const r of data as { wiki_name: string; name: string; scategory_url: string | null }[])
              next.set(r.wiki_name, { name: r.name, icon: r.scategory_url });
            return next;
          });
        }
      }
    });
    return () => { active = false; };
  }, [heroId, userId]);

  const equip = async (slot: BuildSlot, wikiName: string | null, m?: Meta) => {
    if (readOnly || !userId) return;
    setSaving(true);
    setBuild((b) => ({ ...b, [slot]: wikiName }));
    if (wikiName && m) setMeta((prev) => new Map(prev).set(wikiName, m));
    setOpen(null);
    const err = await saveBuildSlot(heroId, userId, slot, wikiName);
    setSaving(false);
    if (err) console.warn('Sauvegarde build échouée :', err);
  };

  if (!userId) {
    return (
      <p className="text-[11.5px] text-warm-mute">
        Connecte-toi pour enregistrer ton build (il sert au simulateur de combat).
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-gold-deep/40 bg-gold/[0.05] px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-feh text-[13px] font-semibold text-gold-text">
          ⚔️ Ton build équipé
        </span>
        <span className="text-[10.5px] text-warm-mute">
          {readOnly ? '(lecture seule)' : '· sert au simulateur'}
        </span>
        {saving ? <span className="text-[10px] text-emerald-300/80">enregistré…</span> : null}
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {BUILD_SLOTS.map((slot) => (
          <SlotRow
            key={slot}
            slot={slot}
            value={build[slot]}
            meta={build[slot] ? meta.get(build[slot]!) : undefined}
            learnset={learnset}
            readOnly={readOnly}
            isOpen={open === slot}
            onOpen={() => setOpen((o) => (o === slot ? null : slot))}
            onPick={(wn, m) => equip(slot, wn, m)}
            onClear={() => equip(slot, null)}
          />
        ))}
      </div>
    </div>
  );
}

function SlotRow({
  slot, value, meta, learnset, readOnly, isOpen, onOpen, onPick, onClear,
}: {
  slot: BuildSlot;
  value: string | null;
  meta?: Meta;
  learnset: SkillRow[] | null;
  readOnly?: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onPick: (wikiName: string, m: Meta) => void;
  onClear: () => void;
}) {
  const cat = SLOT_CATEGORY[slot];
  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-black/25 px-2 py-1.5">
        <span className="w-[62px] shrink-0 font-feh text-[10.5px] font-semibold text-warm-mute">
          {SLOT_LABEL[slot]}
        </span>
        <button
          type="button"
          disabled={readOnly}
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
        >
          {meta?.icon ? (
            <img src={meta.icon} alt="" className="h-5 w-5 shrink-0 object-contain" />
          ) : null}
          <span className={`truncate text-[12px] ${value ? 'text-warm-text' : 'text-warm-mute/70 italic'}`}>
            {meta?.name ?? (value ?? '— vide —')}
          </span>
          {!readOnly ? <span className="ml-auto shrink-0 text-[10px] text-warm-mute">▾</span> : null}
        </button>
        {value && !readOnly ? (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 text-warm-mute hover:text-red-300"
            title="Retirer"
          >
            ✕
          </button>
        ) : null}
      </div>
      {isOpen && !readOnly ? (
        <SlotPicker
          category={cat}
          learnset={(learnset ?? []).filter((s) => s.scategory === cat)}
          onPick={onPick}
          onClose={onOpen}
        />
      ) : null}
    </div>
  );
}

function SlotPicker({
  category, learnset, onPick, onClose,
}: {
  category: string;
  learnset: SkillRow[];
  onPick: (wikiName: string, m: Meta) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<{ wiki_name: string; name: string; scategory_url: string | null }[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Fermer au clic extérieur.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  // Recherche héritée dans feh.skills (débouncée) sur la catégorie de l'emplacement.
  useEffect(() => {
    const term = q.trim();
    if (!supabase || term.length < 2) { setRemote([]); return; }
    let active = true;
    const t = setTimeout(async () => {
      const { data } = await supabase!
        .from('skills')
        .select('wiki_name,name,scategory_url')
        .eq('scategory', category)
        .or(`name.ilike.%${term}%,wiki_name.ilike.%${term}%`)
        .limit(40);
      if (active) setRemote((data as typeof remote) ?? []);
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [q, category]);

  // Kit natif filtré + résultats hérités (en évitant les doublons du kit).
  const nativeList = useMemo(() => {
    const term = q.trim().toLowerCase();
    return learnset.filter(
      (s) => !term || s.name.toLowerCase().includes(term) || s.wiki_name.toLowerCase().includes(term),
    );
  }, [learnset, q]);
  const nativeNames = new Set(nativeList.map((s) => s.wiki_name));
  const inherited = remote.filter((r) => !nativeNames.has(r.wiki_name));

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-30 mt-1 w-full min-w-[240px] rounded-lg border border-gold/40 bg-[#241c11] p-2 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.85)]"
    >
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Kit natif — ou tape pour hériter…"
        className="mb-1.5 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-warm-text outline-none focus:border-gold/50"
      />
      <div className="max-h-56 overflow-y-auto">
        {nativeList.length ? (
          <div className="mb-1 px-1 text-[9.5px] uppercase tracking-wide text-warm-mute/70">Kit natif</div>
        ) : null}
        {nativeList.map((s) => (
          <PickerRow
            key={s.wiki_name}
            name={s.name}
            icon={s.scategory_url}
            onClick={() => onPick(s.wiki_name, { name: s.name, icon: s.scategory_url })}
          />
        ))}
        {inherited.length ? (
          <div className="mb-1 mt-1.5 px-1 text-[9.5px] uppercase tracking-wide text-warm-mute/70">Hérité</div>
        ) : null}
        {inherited.map((r) => (
          <PickerRow
            key={r.wiki_name}
            name={r.name}
            icon={r.scategory_url}
            onClick={() => onPick(r.wiki_name, { name: r.name, icon: r.scategory_url })}
          />
        ))}
        {nativeList.length === 0 && inherited.length === 0 ? (
          <p className="px-2 py-2 text-[11px] text-warm-mute">
            {q.trim().length < 2 ? 'Tape au moins 2 lettres pour chercher une compétence héritée.' : 'Aucun résultat.'}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PickerRow({ name, icon, onClick }: { name: string; icon: string | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-white/5"
    >
      {icon ? <img src={icon} alt="" className="h-5 w-5 shrink-0 object-contain" /> : <span className="h-5 w-5 shrink-0" />}
      <span className="truncate text-[12px] text-warm-text">{name}</span>
    </button>
  );
}
