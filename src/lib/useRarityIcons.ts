import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Icônes d'étoiles par palier de rareté (feh.rarity_icons), chargées une fois.
let cache: Map<number, string> | null = null;

export function useRarityIcons() {
  const [icons, setIcons] = useState<Map<number, string>>(cache ?? new Map());
  useEffect(() => {
    if (cache || !supabase) return;
    supabase
      .from('rarity_icons')
      .select('rarity,url')
      .then(({ data, error }) => {
        if (error) return; // table pas encore créée → repli sur l'étoile du héros
        const m = new Map<number, string>();
        for (const r of data ?? [])
          m.set(r.rarity as number, r.url as string);
        cache = m;
        setIcons(m);
      });
  }, []);
  return icons;
}
