// Modèle de données d'un héros, inspiré de Fire Emblem Heroes.

export type Color = 'red' | 'blue' | 'green' | 'colorless';

// Famille d'arme simplifiée (la couleur est portée par `color`).
export type WeaponType =
  | 'Sword'
  | 'Lance'
  | 'Axe'
  | 'Tome'
  | 'Bow'
  | 'Dagger'
  | 'Staff'
  | 'Dragon'
  | 'Beast';

// Valeur libre : c'est ce qui est stocké dans Supabase (feh.heroes.move_type)
// qui fait foi — l'app affiche la valeur telle quelle.
export type MoveType = string;

export interface Stats {
  hp: number;
  atk: number;
  spd: number;
  def: number;
  res: number;
}

export interface Hero {
  id: string; // identifiant unique stable (slug + IntID)
  intId?: number; // identifiant interne FEH
  name: string;
  title: string; // ex: "Princesse d'Askr"
  color: Color;
  weaponType: WeaponType;
  moveType: MoveType;
  rarity: number; // étoiles à l'apparition (3-5)
  origin: string; // jeu d'origine
  accent?: string; // couleur d'accent pour le placeholder
  art?: string; // URL de l'illustration (wiki) si disponible
  detailArt?: string;
  colorUrl?: string;
  weaponUrl?: string; // icône du type d'arme (Supabase: weapon_type_url)
  moveUrl?: string; // icône du type de déplacement (Supabase: move_type_url)
  elementUrl?: string; // icône de l'élément/bénédiction (Supabase: element_url)
  originUrl?: string; // image du jeu d'origine (Supabase: origin_url)
  description?: string; // texte de présentation / lore (Supabase: description)
  artAttack?: string; // illustration pose d'attaque (Supabase: art_attack_url)
  artSpecial?: string; // illustration pose compétence (Supabase: art_special_url)
  artInjured?: string; // illustration pose blessé (Supabase: art_injured_url)
  // Tenue resplendissante (Supabase: art_resplendent*_url)
  artResplendent?: string;
  artResplendentAttack?: string;
  artResplendentSpecial?: string;
  artResplendentInjured?: string;
  spriteResplendent?: string; // sprite resplendissant (Supabase: sprite_resplendent_url)
  cvName?: string; // voix : nom latin (feh.voice_actors.name)
  cvNameJa?: string; // voix : nom japonais (feh.voice_actors.name_ja)
  // Voix supplémentaires (Duo = 2e, Trio = 2e + 3e, 4e voix = cv_ja_partner3_id)
  cvPartnerName?: string;
  cvPartnerNameJa?: string;
  cvPartner2Name?: string;
  cvPartner2NameJa?: string;
  cvPartner3Name?: string;
  cvPartner3NameJa?: string;
  illustratorName?: string; // illustrateur : nom latin (feh.illustrators.name)
  illustratorNameJa?: string; // illustrateur : nom japonais (feh.illustrators.name_ja)
  // Illustrateur de la tenue resplendissante (peut différer)
  illustratorResplendentName?: string;
  illustratorResplendentNameJa?: string;
  releaseDate?: string;
  stats?: Stats; // stats au niveau 40, 5★ (si connues)
  rarity_url?: string;
}

export const STAT_LABELS: Record<keyof Stats, string> = {
  hp: 'PV',
  atk: 'ATQ',
  spd: 'VIT',
  def: 'DÉF',
  res: 'RÉS',
};
