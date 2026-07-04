import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Logos des jeux (feh.games : name -> icon_url), chargés une fois.
let cache: Map<string, string> | null = null;

export function useGames() {
  const [games, setGames] = useState<Map<string, string>>(cache ?? new Map());
  useEffect(() => {
    if (cache || !supabase) return;
    supabase
      .from('games')
      .select('name,icon_url')
      .then(({ data, error }) => {
        if (error) return; // table pas encore créée → repli sur hero.originUrl
        const m = new Map<string, string>();
        for (const g of data ?? [])
          if (g.icon_url) m.set(g.name as string, g.icon_url as string);
        cache = m;
        setGames(m);
      });
  }, []);
  return games;
}
