import { useRef } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';

export function Settings({
  owned,
  total,
  onImport,
}: {
  owned: Set<string>;
  total: number;
  onImport: (ids: string[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify([...owned], null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'feh-collection.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((t) => {
      try {
        const ids = JSON.parse(t);
        if (Array.isArray(ids)) onImport(ids.filter((x) => typeof x === 'string'));
      } catch {
        /* fichier invalide */
      }
    });
    e.target.value = '';
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-2xl border border-white/10 bg-[rgba(20,15,9,.55)] p-5 shadow-card">
        <h3 className="mb-3 font-feh text-[15px] font-semibold text-gold-text">
          Stockage
        </h3>
        <div className="flex items-center gap-2 text-[14px] text-warm-text">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              isSupabaseConfigured ? 'bg-gem-green' : 'bg-warm-mute'
            }`}
          />
          {isSupabaseConfigured
            ? 'Connecté à Supabase (synchronisé sur ton VPS)'
            : 'Mode local (localStorage) — configure .env.local pour synchroniser'}
        </div>
        <p className="mt-2 text-[13px] text-warm-dim">
          {owned.size} / {total} héros dans ta collection.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[rgba(20,15,9,.55)] p-5 shadow-card">
        <h3 className="mb-3 font-feh text-[15px] font-semibold text-gold-text">
          Sauvegarde
        </h3>
        <p className="mb-4 text-[13px] text-warm-dim">
          Exporte ta collection en JSON, ou importe-en une (les héros importés
          sont ajoutés à ta collection).
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={exportJson}
            className="feh-tab font-feh text-[13px] font-bold text-[#3a2a08]"
          >
            Exporter (JSON)
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-xl border border-gold-deep/50 px-5 py-2.5 font-feh text-[13px] font-semibold text-gold-text transition hover:bg-gold/10"
          >
            Importer…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            onChange={handleFile}
            className="hidden"
          />
        </div>
      </div>
    </div>
  );
}
