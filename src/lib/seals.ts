import { statTotal, type CollStats } from './collection';

// ============================================================
//  Répartition des sceaux sacrés (S) sur les héros possédés.
//
//  Contrainte clé (règle du jeu, confirmée par la joueuse) : chaque sceau
//  n'existe qu'en UN exemplaire — on ne peut pas le créer en double. Donc un
//  même sceau ne peut être conseillé qu'à UN seul héros. On fait donc une
//  répartition GLOBALE : on trie les héros 5★+ possédés (rareté puis total de
//  stats) et on donne à chacun le meilleur sceau ENCORE disponible pour son
//  profil.
//
//  Le pool ci-dessous ne contient que des sceaux réellement présents en base
//  (feh.skills, via leur passif A partagé — `key` = wiki_name). Il exclut les
//  sceaux "Duels d'Invocateurs" (Squad Ace / Initiate Seal), hors PvE/Arène.
//  Pour ajouter/retirer un sceau : éditer POOLS (garder un wiki_name valide).
// ============================================================

export type SealPick = { key: string; label: string; why: string };

// Sceaux par profil, du plus au moins conseillé. `key` = wiki_name en base.
const S = {
  atkSpd: { key: 'AtkSpd 2', label: 'Atq/Vit', why: 'boost ATQ + VIT en continu — sécurise tes doublons et évite d’être doublé' },
  atkDef: { key: 'AttackDef Plus2', label: 'Atq/Déf', why: 'boost ATQ + DÉF en continu — tu frappes fort et encaisses la riposte' },
  sturdyBlow: { key: 'Sturdy Blow 2', label: 'Coup robuste', why: '+ATQ/+DÉF quand tu attaques — grosse frappe à l’initiation' },
  fierceStance: { key: 'Fierce Stance 3', label: 'Posture féroce', why: '+ATQ quand on t’attaque — riposte plus tranchante' },
  atkDefFinish: { key: 'AtkDef Finish 3', label: 'Finition Atq/Déf', why: '+ATQ/+DÉF et action après combat' },
  attack: { key: 'Attack Plus3', label: 'Attaque +3', why: 'ATQ pur, simple et efficace' },
  speed: { key: 'Speed Plus3', label: 'Vitesse +3', why: 'VIT pur — aide à doubler' },
  closeDef: { key: 'Close Def 3', label: 'Déf proche', why: 'réduit les dégâts des ennemis au corps à corps (+DÉF/+RÉS)' },
  fortressDef: { key: 'Fortress Def 3', label: 'Forteresse (DÉF)', why: 'grosse DÉF (léger malus ATQ) — mur physique' },
  defense: { key: 'Defense Plus3', label: 'Défense +3', why: 'DÉF pure pour encaisser' },
  resistance: { key: 'Resistance Plus2', label: 'Résistance +2', why: 'RÉS en plus pour encaisser la magie' },
  hpRes: { key: 'HPRes 2', label: 'PV/Rés', why: '+PV +RÉS — survie face à la magie' },
  fortressRes: { key: 'Fortress Res 3', label: 'Forteresse (RÉS)', why: 'grosse RÉS (léger malus ATQ) — mur magique' },
} as const;

const POOLS: Record<'fastOff' | 'bulkyOff' | 'defTank' | 'resTank', SealPick[]> = {
  fastOff: [S.atkSpd, S.sturdyBlow, S.fierceStance, S.attack, S.speed],
  bulkyOff: [S.atkDef, S.sturdyBlow, S.fierceStance, S.atkDefFinish, S.attack],
  defTank: [S.closeDef, S.fortressDef, S.defense, S.atkDefFinish],
  resTank: [S.resistance, S.hpRes, S.fortressRes, S.closeDef],
};

// Profil de build à partir des stats saisies. `null` si stats incomplètes.
function profile(s: CollStats): keyof typeof POOLS | null {
  if (s.ATQ == null || s.VIT == null || s.DEF == null || s.RES == null) return null;
  const { ATQ, VIT, DEF, RES } = s;
  const max = Math.max(ATQ, VIT, DEF, RES);
  if (max === ATQ) return VIT >= ATQ - 8 ? 'fastOff' : 'bulkyOff';
  if (max === VIT) return 'fastOff';
  if (max === DEF) return 'defTank';
  return 'resTank';
}

// Liste de sceaux souhaités pour un héros, par ordre de préférence.
// Sans stats : profil offensif rapide par défaut (les héros sans stats saisies
// sont de toute façon en fin de priorité).
function rankedSealsFor(s: CollStats): SealPick[] {
  const p = profile(s);
  return p ? POOLS[p] : POOLS.fastOff;
}

// Rareté "de mon exemplaire" jugée 5★ ou plus (5★, ou Forma = 6).
export const isHighRarity = (r: number | null | undefined): boolean =>
  (r ?? 0) >= 5;

// Répartition globale : chaque sceau attribué à AU PLUS un héros.
// Priorité : rareté décroissante, puis total de stats saisi.
export function allocateSeals(
  stats: Map<string, CollStats>,
): Map<string, SealPick> {
  const eligible = [...stats.entries()]
    .filter(([, s]) => isHighRarity(s.rarity))
    .sort(([aId, a], [bId, b]) => {
      const byRarity = (b.rarity ?? 0) - (a.rarity ?? 0);
      if (byRarity) return byRarity;
      const byStats = statTotal(b) - statTotal(a);
      if (byStats) return byStats;
      return aId.localeCompare(bId); // départage stable
    });

  const used = new Set<string>();
  const out = new Map<string, SealPick>();
  for (const [id, s] of eligible) {
    const pick = rankedSealsFor(s).find((p) => !used.has(p.key));
    if (pick) {
      used.add(pick.key);
      out.set(id, pick);
    }
    // sinon : plus aucun sceau unique disponible pour ce profil -> pas d'entrée
  }
  return out;
}
