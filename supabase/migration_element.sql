-- ============================================================
--  Migration : élément / bénédiction (Légendaires & Mythiques)
--  À coller dans le SQL Editor de ton Supabase Studio (schéma feh).
-- ============================================================

-- Lien vers l'icône de l'élément (Feu, Eau, Vent, Terre, Lumière, Ténèbres, Astres, Anima).
-- Null pour les héros sans élément prédéfini.
alter table feh.heroes add column if not exists element_url text;

-- Forcer PostgREST à relire le schéma
notify pgrst, 'reload schema';
