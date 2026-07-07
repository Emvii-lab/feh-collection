import { useEffect, useState } from 'react';
import {
  fetchHeroStats,
  saveHeroStats,
  type CollStats,
} from '../lib/collection';
import { useRarityIcons } from '../lib/useRarityIcons';

type StatKey = 'LVL' | 'PV' | 'ATQ' | 'VIT' | 'DEF' | 'RES';

// Les 5 stats de combat (PV/ATQ/VIT/DÉF/RÉS) + le niveau à part.
const STATS: { key: StatKey; label: string }[] = [
  { key: 'PV', label: 'PV' },
  { key: 'ATQ', label: 'ATQ' },
  { key: 'VIT', label: 'VIT' },
  { key: 'DEF', label: 'DÉF' },
  { key: 'RES', label: 'RÉS' },
];

type Vals = Record<StatKey, string>;
const EMPTY: Vals = { LVL: '', PV: '', ATQ: '', VIT: '', DEF: '', RES: '' };

export function CollectionStats({
  heroId,
  userId,
  onSaved,
}: {
  heroId: string;
  userId: string | null;
  onSaved?: () => void;
}) {
  const [vals, setVals] = useState<Vals>(EMPTY);
  const [rarity, setRarity] = useState<number | null>(null);
  const rarityIcons = useRarityIcons();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMsg(null);
    fetchHeroStats(heroId).then((s) => {
      if (!active) return;
      const next = { ...EMPTY };
      if (s) {
        (Object.keys(EMPTY) as StatKey[]).forEach((k) => {
          next[k] = s[k] != null ? String(s[k]) : '';
        });
      }
      setVals(next);
      setRarity(s?.rarity ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [heroId]);

  const set = (k: StatKey, v: string) =>
    setVals((p) => ({ ...p, [k]: v.replace(/[^0-9]/g, '') }));

  const total = STATS.reduce((sum, s) => sum + (parseInt(vals[s.key]) || 0), 0);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const payload: Partial<CollStats> = { rarity };
    (Object.keys(EMPTY) as StatKey[]).forEach((k) => {
      payload[k] = vals[k].trim() === '' ? null : parseInt(vals[k]);
    });
    const err = await saveHeroStats(heroId, userId, payload);
    setSaving(false);
    if (err) {
      setMsg('Échec de l’enregistrement : ' + err);
    } else {
      setMsg('Stats enregistrées ✓');
      onSaved?.();
    }
  };

  if (loading) {
    return (
      <p className="px-5 pb-5 pt-3 text-sm text-warm-dim">
        Chargement des stats…
      </p>
    );
  }

  return (
    <div className="px-5 pb-5 pt-3">
      <p className="mb-3 text-[12px] text-warm-mute">
        Tes stats pour ce héros (niveau, valeurs investies). Modifiables et
        propres à ton compte.
      </p>

      {/* Rareté de mon exemplaire (étoiles) — au-dessus du niveau */}
      <div className="mb-3 flex items-center gap-3">
        <span className="w-12 shrink-0 font-feh text-[13px] text-warm-dim">
          Étoiles
        </span>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => {
            const active = n <= (rarity ?? 0);
            const url = rarityIcons.get(rarity ?? 5);
            return (
              <button
                key={n}
                type="button"
                onClick={() => setRarity(rarity === n ? null : n)}
                aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
                className="transition hover:brightness-110"
              >
                {url ? (
                  <img
                    src={url}
                    alt=""
                    className={`h-[22px] w-[22px] object-contain ${
                      active ? '' : 'opacity-25 grayscale'
                    }`}
                  />
                ) : (
                  <span
                    className={`text-[22px] leading-none ${
                      active ? 'text-gold-light' : 'text-warm-mute/30'
                    }`}
                  >
                    ★
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setRarity(rarity === 6 ? null : 6)}
            title="Forma (Salle des Formes) — 5 étoiles bleues"
            className={`ml-2 rounded-md border px-2 py-0.5 font-feh text-[11px] transition ${
              rarity === 6
                ? 'border-sky-400/60 bg-sky-400/15 text-sky-200'
                : 'border-white/10 text-warm-mute hover:text-warm-dim'
            }`}
          >
            Forma
          </button>
          <span className="ml-2 font-feh text-[12px] text-warm-dim">
            {rarity === 6
              ? 'Forma · 5★ bleu'
              : rarity
                ? `${rarity}★`
                : 'non renseigné'}
          </span>
        </div>
      </div>

      {/* Niveau */}
      <div className="mb-3 flex items-center gap-3">
        <span className="w-12 shrink-0 font-feh text-[13px] text-warm-dim">
          Niveau
        </span>
        <input
          inputMode="numeric"
          value={vals.LVL}
          onChange={(e) => set('LVL', e.target.value)}
          placeholder="—"
          className="w-20 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-center font-feh text-[14px] text-warm-text outline-none transition focus:border-gold/50 focus:ring-1 focus:ring-gold/30"
        />
      </div>

      {/* Stats de combat */}
      <div className="space-y-2">
        {STATS.map((s) => (
          <div key={s.key} className="flex items-center gap-3">
            <span className="w-12 shrink-0 font-feh text-[13px] text-warm-dim">
              {s.label}
            </span>
            <input
              inputMode="numeric"
              value={vals[s.key]}
              onChange={(e) => set(s.key, e.target.value)}
              placeholder="—"
              className="w-20 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-center font-feh text-[14px] text-warm-text outline-none transition focus:border-gold/50 focus:ring-1 focus:ring-gold/30"
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
        <span className="text-[11px] uppercase tracking-widest text-warm-dim">
          Total
        </span>
        <span className="font-feh text-2xl font-bold text-gold-text">
          {total}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !userId}
          className="feh-tab font-feh text-[13px] font-bold tracking-wide text-[#3a2a08] transition hover:brightness-110 disabled:opacity-60"
        >
          {saving ? '…' : 'Enregistrer'}
        </button>
        {msg ? (
          <span
            className={`text-[12.5px] ${
              msg.startsWith('Échec') ? 'text-red-300' : 'text-emerald-300'
            }`}
          >
            {msg}
          </span>
        ) : null}
      </div>
    </div>
  );
}
