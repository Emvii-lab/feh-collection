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
  weapon_effectiveness_url: string | null;
  scategory_url: string | null;
  required: string | null; // wiki_name de la compétence prérequise (chaîne d'amélioration)
  stat_modifiers: string | null; // "HP,ATK,SPD,DEF,RES" (inclut le raffinage)
  refine_path: string | null; // atk/spd/def/res/skill1… (null = arme de base)
  unlock_rarity: number | null; // rareté (étoiles) à laquelle le héros débloque la compétence
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
        .select('skill_name, unlock_rarity')
        .eq('hero_id', heroId);
      const rarByName = new Map<string, number | null>();
      for (const r of learn ?? []) {
        rarByName.set(r.skill_name as string, r.unlock_rarity as number | null);
      }
      const names = [...rarByName.keys()].filter(Boolean);
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
          'wiki_name,name,scategory,use_range,might,sp,cooldown,description,weapon_effectiveness,weapon_effectiveness_url,scategory_url,required,stat_modifiers,refine_path',
        )
        .in('wiki_name', names);
      const rows = (sk ?? []).map((s) => {
        const wn = (s as { wiki_name: string }).wiki_name;
        return {
          ...(s as Omit<SkillRow, 'unlock_rarity'>),
          unlock_rarity: rarByName.get(wn) ?? null,
        };
      });
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
