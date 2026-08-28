// Catalogue de cartes du simulateur : évite de coller un lien wiki à chaque fois.
//  - searchWikiMaps() : autocomplétion EN DIRECT sur le wiki (on tape un nom, on choisit).
//    On filtre aux vraies CARTES (Category:Maps) pour ne pas noyer la liste sous les
//    pages de héros/compétences.
//  - fetchSavedMaps()/upsertSavedMap()/… : liste réutilisable stockée dans Supabase
//    (feh.sim_map). Chaque carte chargée y est mémorisée avec un nom FR éditable, si bien
//    qu'une personne qui ne connaît pas le wiki n'a plus qu'à piocher dans la liste.
import { supabase } from './supabase';
import type { WikiMap } from './wikiMap';

const WIKI_API = 'https://feheroes.fandom.com/api.php';

export type MapSuggestion = { title: string; category: string };
export type SavedMap = {
  page_title: string;
  name: string;
  category: string;
  data: WikiMap | null;
  updated_at: string;
};

// Traduit les catégories brutes du wiki en un regroupement FR lisible.
function catFromWiki(cats: string[]): string {
  const has = (re: RegExp) => cats.some((c) => re.test(c));
  if (has(/Main Story|Book [IVX]+ maps|Paralogue/i)) return 'Histoire';
  if (has(/Grand Hero Battle/i)) return 'Grand Hero Battle';
  if (has(/Bound Hero Battle/i)) return 'Bound Hero Battle';
  if (has(/Legendary|Mythic/i)) return 'Héros légendaires/mythiques';
  if (has(/Tempest/i)) return 'Épreuve de la tempête';
  if (has(/Chain Challenge|Squad Assault|Special Maps|Training/i)) return 'Défis';
  return 'Événements & autres';
}

// Recherche de cartes par NOM sur le wiki (préfixe), filtrée aux vraies cartes.
export async function searchWikiMaps(query: string): Promise<MapSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // 1) suggestions par préfixe (namespace principal uniquement).
  const osUrl =
    `${WIKI_API}?action=opensearch&format=json&origin=*&namespace=0&limit=12&search=` +
    encodeURIComponent(q);
  let titles: string[] = [];
  try {
    const j = await (await fetch(osUrl)).json();
    titles = Array.isArray(j?.[1]) ? j[1] : [];
  } catch {
    return [];
  }
  if (!titles.length) return [];

  // 2) une seule requête groupée : catégories de tous les candidats → on ne garde
  //    que ceux appartenant à « Category:Maps », et on déduit un regroupement FR.
  const catUrl =
    `${WIKI_API}?action=query&prop=categories&cllimit=max&format=json&origin=*&titles=` +
    titles.map((t) => encodeURIComponent(t)).join('|');
  try {
    const j = await (await fetch(catUrl)).json();
    const pages: Record<string, { title: string; categories?: { title: string }[] }> =
      j?.query?.pages ?? {};
    const out: MapSuggestion[] = [];
    for (const p of Object.values(pages)) {
      const cats = (p.categories ?? []).map((c) => c.title);
      if (cats.some((c) => c === 'Category:Maps')) {
        out.push({ title: p.title, category: catFromWiki(cats) });
      }
    }
    // on respecte l'ordre de pertinence d'opensearch.
    out.sort((a, b) => titles.indexOf(a.title) - titles.indexOf(b.title));
    return out;
  } catch {
    // repli : pas de filtre catégorie (l'utilisateur verra l'erreur au clic si ce n'est pas une carte).
    return titles.map((t) => ({ title: t, category: '' }));
  }
}

// Liste des cartes enregistrées (plus récemment utilisées en premier).
export async function fetchSavedMaps(): Promise<SavedMap[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('sim_map')
    .select('page_title, name, category, data, updated_at')
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return data as unknown as SavedMap[];
}

// Enregistre / met à jour une carte (clé = titre de page wiki → aucun doublon).
// Le nom FR déjà personnalisé n'est PAS écrasé : le caller le résout et le passe.
export async function upsertSavedMap(entry: {
  page_title: string;
  name: string;
  category?: string;
  data?: WikiMap | null;
}): Promise<void> {
  if (!supabase) return;
  await supabase.from('sim_map').upsert(
    {
      page_title: entry.page_title,
      name: entry.name,
      category: entry.category ?? '',
      data: entry.data ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'page_title' },
  );
}

// Renomme une carte (nom FR affiché).
export async function renameSavedMap(page_title: string, name: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('sim_map').update({ name }).eq('page_title', page_title);
}

// Retire une carte du catalogue.
export async function deleteSavedMap(page_title: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('sim_map').delete().eq('page_title', page_title);
}
