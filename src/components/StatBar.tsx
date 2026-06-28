import type { Stats } from '../types';
import { STAT_LABELS } from '../types';

const MAX = 60;

export function StatBar({ stat, value }: { stat: keyof Stats; value: number }) {
  const pct = Math.min(100, (value / MAX) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 shrink-0 font-feh text-[11px] font-medium uppercase text-warm-dim">
        {STAT_LABELS[stat]}
      </span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-black/40">
        <div
          className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold-light transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-7 shrink-0 text-right font-feh text-[12px] font-medium tabular-nums text-warm-text">
        {value}
      </span>
    </div>
  );
}
