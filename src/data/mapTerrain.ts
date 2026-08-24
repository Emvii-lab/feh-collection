import type { Terrain } from '../lib/tactics';

// Terrain pré-rempli par carte (lu depuis l'image de la carte sur le wiki, car il
// n'est pas fourni en données). Clé = titre de page (wikiMap.title). Fusionné SOUS
// les murs auto du wiki et SOUS tes retouches au pinceau → tu peux corriger.
// fort = case fortifiée (30% de réduction + soin), forest = arbres, wall/water/mountain.
export const MAP_TERRAIN: Record<string, Record<string, Terrain>> = {
  'Rodrigue: Faerghus Shield (map)': {
    // structures tan : INFRANCHISSABLES en jeu (vérifié) → murs (pas des forts passables)
    b7: 'wall', e7: 'wall', b4: 'wall', e4: 'wall', c1: 'wall', d1: 'wall',
    // forêts (arbres)
    e5: 'forest', d4: 'forest', b3: 'forest',
  },
};
