import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Hero } from '../types';
import { dedupeHeroes } from './dedupeHeroes';

const UNKNOWN_HERO_ART =
  'https://res.cloudinary.com/dd4rdtrig/image/upload/v1782335088/unknown_hero_aswwcu.png';

function normalizeSpriteUrl(value: unknown): string {
  return typeof value === 'string' && value.trim()
    ? value
    : UNKNOWN_HERO_ART;
}

// Renvoie la première valeur texte non vide (tolère plusieurs noms de colonne).
function pickStr(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

// Personne créditée (voix ou illustrateur) : nom latin + japonais.
type Person = { name?: string; nameJa?: string };

// Ligne Supabase (feh.heroes) -> modèle Hero de l'app.
function mapRow(
  r: Record<string, unknown>,
  vaMap: Map<number, Person> = new Map(),
  illMap: Map<number, Person> = new Map(),
): Hero {
  const cvId = typeof r.cv_ja_id === 'number' ? r.cv_ja_id : undefined;
  const cv = cvId !== undefined ? vaMap.get(cvId) : undefined;
  const cvPartnerId =
    typeof r.cv_ja_partner_id === 'number' ? r.cv_ja_partner_id : undefined;
  const cvPartner =
    cvPartnerId !== undefined ? vaMap.get(cvPartnerId) : undefined;
  const cvPartner2Id =
    typeof r.cv_ja_partner2_id === 'number' ? r.cv_ja_partner2_id : undefined;
  const cvPartner2 =
    cvPartner2Id !== undefined ? vaMap.get(cvPartner2Id) : undefined;
  const illId = typeof r.illustrator_id === 'number' ? r.illustrator_id : undefined;
  const ill = illId !== undefined ? illMap.get(illId) : undefined;
  const illRespId =
    typeof r.illustrator_resplendent_id === 'number'
      ? r.illustrator_resplendent_id
      : undefined;
  const illResp = illRespId !== undefined ? illMap.get(illRespId) : undefined;
  return {
    id: r.id as string,
    intId: (r.int_id as number) ?? undefined,
    name: r.name as string,
    title: (r.title as string) ?? '',
    color: r.color as Hero['color'],
    weaponType: r.weapon_type as Hero['weaponType'],
    moveType: r.move_type as Hero['moveType'],
    rarity: (r.rarity as number) ?? 5,
    origin: (r.origin as string) ?? '',
    art: normalizeSpriteUrl(r.sprite_url),
    detailArt: normalizeSpriteUrl(r.art_url),
    colorUrl:
      typeof r.color_url === 'string' && r.color_url.trim()
        ? r.color_url
        : undefined,
    weaponUrl:
      typeof r.weapon_type_url === 'string' && r.weapon_type_url.trim()
        ? r.weapon_type_url
        : undefined,
    moveUrl:
      typeof r.move_type_url === 'string' && r.move_type_url.trim()
        ? r.move_type_url
        : undefined,
    elementUrl: pickStr(r.element_url),
    originUrl: pickStr(r.origin_url),
    description: pickStr(
      r.description,
      r.description_fr,
      r.lore,
      r.bio,
      r.summary,
    ),
    artAttack: pickStr(r.art_attack_url),
    artSpecial: pickStr(r.art_special_url),
    artInjured: pickStr(r.art_injured_url),
    artResplendent: pickStr(r.art_resplendent_url),
    artResplendentAttack: pickStr(r.art_resplendent_attack_url),
    artResplendentSpecial: pickStr(r.art_resplendent_special_url),
    artResplendentInjured: pickStr(r.art_resplendent_injured_url),
    spriteResplendent: pickStr(r.sprite_resplendent_url),
    cvName: cv?.name,
    cvNameJa: cv?.nameJa,
    cvPartnerName: cvPartner?.name,
    cvPartnerNameJa: cvPartner?.nameJa,
    cvPartner2Name: cvPartner2?.name,
    cvPartner2NameJa: cvPartner2?.nameJa,
    illustratorName: ill?.name,
    illustratorNameJa: ill?.nameJa,
    illustratorResplendentName: illResp?.name,
    illustratorResplendentNameJa: illResp?.nameJa,
    releaseDate: (r.release_date as string) ?? undefined,
    stats: (r.stats as Hero['stats']) ?? undefined,
    rarity_url: (r.rarity_url as string) ?? undefined,
  };
}

// Délai max d'attente de Supabase avant repli sur le catalogue local (VPN coupé, etc.).
const FETCH_TIMEOUT_MS = 8000;

// Table de personnes (voice_actors / illustrators) -> Map<id, {name, nameJa}>.
// Tolérant : si la table n'existe pas encore, on renvoie une map vide.
async function fetchPeople(
  table: string,
  signal: AbortSignal,
): Promise<Map<number, Person>> {
  const map = new Map<number, Person>();
  if (!supabase) return map;
  const { data, error } = await supabase
    .from(table)
    .select('id,name,name_ja')
    .abortSignal(signal);
  if (error) return map;
  for (const v of data ?? []) {
    const row = v as Record<string, unknown>;
    if (typeof row.id !== 'number') continue;
    map.set(row.id, {
      name: pickStr(row.name),
      nameJa: pickStr(row.name_ja),
    });
  }
  return map;
}

// Récupère tout le catalogue depuis feh.heroes (paginé : PostgREST plafonne à 1000).
// Renvoie `null` si Supabase est indisponible (erreur ou timeout) -> repli local.
async function fetchAll(): Promise<Hero[] | null> {
  if (!supabase) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const signal = controller.signal;
  try {
    const [vaMap, illMap] = await Promise.all([
      fetchPeople('voice_actors', signal),
      fetchPeople('illustrators', signal),
    ]);
    const rows: Record<string, unknown>[] = [];
    const size = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('heroes')
        .select('*')
        .order('int_id', { ascending: true })
        .range(from, from + size - 1)
        .abortSignal(signal);
      if (error) {
        console.warn('Catalogue Supabase indisponible :', error.message);
        return null;
      }
      rows.push(...(data ?? []));
      if (!data || data.length < size) break;
      from += size;
    }
    return dedupeHeroes(rows.map((r) => mapRow(r, vaMap, illMap)));
  } catch (e) {
    console.warn('Catalogue Supabase injoignable (timeout / réseau) :', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Catalogue : Supabase est l'unique source. Si indisponible, liste vide.
export function useHeroes(): Hero[] {
  const [heroes, setHeroes] = useState<Hero[]>([]);
  useEffect(() => {
    if (!supabase) return;

    let active = true;
    fetchAll().then((h) => {
      if (active) setHeroes(h ?? []);
    });
    return () => {
      active = false;
    };
  }, []);
  return heroes;
}
