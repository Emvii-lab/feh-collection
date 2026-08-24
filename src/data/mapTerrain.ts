import type { Terrain } from '../lib/tactics';

// Terrain pré-rempli par carte (lu depuis l'image de la carte sur le wiki, car il
// n'est pas fourni en données). Clé = titre de page (wikiMap.title). Fusionné SOUS
// les murs auto du wiki et SOUS tes retouches au pinceau → tu peux corriger.
// fort = case fortifiée (30% de réduction + soin), forest = arbres, wall/water/mountain.
export const MAP_TERRAIN: Record<string, Record<string, Terrain>> = {
  'Rodrigue: Faerghus Shield (map)': {
    // forts (cases fortifiées, tan) : 2 en haut, 2 au milieu, 2 en bas
    b7: 'fort', e7: 'fort', b4: 'fort', e4: 'fort', c1: 'fort', d1: 'fort',
    // forêts (arbres)
    e5: 'forest', d4: 'forest', b3: 'forest',
  },
};
