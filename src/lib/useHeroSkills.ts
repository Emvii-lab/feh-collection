import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type SkillRow = {
  wiki_name: string;
  name: string;
  scategory: string; // weapon / assist / special / passivea / passiveb / passivec
  use_range: number | null;
  might: number | null;
  sp: number | null;
  cooldown: number | null;
  description: string | null;
  weapon_effectiveness: string | null;
  skill_pos: number | null;
};

// Récupère le kit natif d'un héros : learnset (feh.hero_learnset) + détails (feh.skills).
export function useHeroSkills(heroId: string | null, enabled = true) {
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supabase || !heroId || !enabled) {
      setSkills(null);
      return;
    }
    let active = true;
    setLoading(true);
    (async () => {
      const { data: learn } = await supabase
        .from('hero_learnset')
        .select('skill_name, skill_pos')
        .eq('hero_id', heroId);
      const posByName = new Map<string, number | null>();
      for (const r of learn ?? []) posByName.set(r.skill_name as string, r.skill_pos as number | null);
      const names = [...posByName.keys()].filter(Boolean);
      if (names.length === 0) {
        if (active) {
          setSkills([]);
          setLoading(false);
        }
        return;
      }
      const { data: sk } = await supabase
        .from('skills')
        .select(
          'wiki_name,name,scategory,use_range,might,sp,cooldown,description,weapon_effectiveness',
        )
        .in('wiki_name', names);
      const rows = (sk ?? []).map((s) => ({
        ...(s as Omit<SkillRow, 'skill_pos'>),
        skill_pos: posByName.get((s as { wiki_name: string }).wiki_name) ?? null,
      }));
      if (active) {
        setSkills(rows as SkillRow[]);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [heroId, enabled]);

  return { skills, loading };
}
