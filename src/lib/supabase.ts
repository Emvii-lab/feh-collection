import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Renseigne ces variables dans un fichier .env.local (voir .env.example).
// Tant qu'elles sont absentes, l'appli fonctionne en mode local (localStorage).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Toutes les tables vivent dans le schéma dédié "feh".
// (Doit être exposé côté PostgREST — voir supabase/schema.sql.)
export const DB_SCHEMA = 'feh';

export const supabase: SupabaseClient<any, any, any> | null =
  url && anonKey
    ? createClient(url, anonKey, { db: { schema: DB_SCHEMA } })
    : null;

export const isSupabaseConfigured = Boolean(supabase);
