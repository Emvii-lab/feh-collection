import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Ligne feh.hero_voices : hero_id + colonnes <categorie>_<n> contenant des URLs Cloudinary.
export type HeroVoices = { hero_id: string } & Record<string, string | null>;

// Récupère les voix d'un héros (table feh.hero_voices). `null` si rien / table absente.
export function useHeroVoices(heroId: string | null, enabled = true) {
  const [voices, setVoices] = useState<HeroVoices | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supabase || !heroId || !enabled) {
      setVoices(null);
      return;
    }
    let active = true;
    setLoading(true);
    supabase
      .from('hero_voices')
      .select('*')
      .eq('hero_id', heroId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) {
          setVoices((data as HeroVoices) ?? null);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [heroId, enabled]);

  return { voices, loading };
}
