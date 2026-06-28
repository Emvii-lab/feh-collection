import type { Color } from './types';

// Dégradés repris de la maquette de référence "Hall of Heroes".
export const GEM: Record<Color, string> = {
  red: 'linear-gradient(150deg,#e36b66,#c23a39)',
  blue: 'linear-gradient(150deg,#5ea2f5,#2563c9)',
  green: 'linear-gradient(150deg,#5fcf81,#249a52)',
  colorless: 'linear-gradient(150deg,#e6edf4,#aebbcb)',
};

export const PORTRAIT: Record<Color, string> = {
  red: 'radial-gradient(80% 70% at 50% 22%, rgba(227,107,102,.4), transparent 64%), linear-gradient(180deg,#3a1d20,#16100f)',
  blue: 'radial-gradient(80% 70% at 50% 22%, rgba(94,162,245,.4), transparent 64%), linear-gradient(180deg,#162a44,#0d1422)',
  green:
    'radial-gradient(80% 70% at 50% 22%, rgba(95,207,129,.38), transparent 64%), linear-gradient(180deg,#16331f,#0d1813)',
  colorless:
    'radial-gradient(80% 70% at 50% 22%, rgba(200,214,228,.34), transparent 64%), linear-gradient(180deg,#2a3340,#141922)',
};

export const COLOR_LABEL: Record<Color, string> = {
  red: 'Rouge',
  blue: 'Bleu',
  green: 'Vert',
  colorless: 'Incolore',
};
