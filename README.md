# FEH Collection Tracker

Application web personnelle pour suivre ma collection **Fire Emblem Heroes** :
voir tous les héros du jeu et marquer ceux que je possède / qui me manquent.
Design « à la manière de » FEH (bleu glacier, or), **aucun asset officiel** packagé
(les illustrations sont chargées depuis le wiki communautaire).

> Projet perso / portfolio. Fire Emblem Heroes © Nintendo / Intelligent Systems.

## Stack

- **Vite + React + TypeScript**
- **Tailwind CSS** (thème FEH custom)
- **Supabase** (self-hosted sur VPS) pour le catalogue + la collection
  - Repli automatique sur `localStorage` tant que Supabase n'est pas configuré.

## Démarrage

```bash
npm install
npm run dev
```

## Données : importer tout le roster

Le roster est récupéré depuis le wiki FEH (table Cargo `Units`) :

```bash
node scripts/import-heroes.mjs
```

Génère :
- `src/data/heroes.json` — catalogue chargé par l'app.
- `supabase/seed.sql` — INSERT/UPSERT pour la table `heroes`.

Le script est throttlé (rate limit du wiki) et construit les URLs d'images
sans appel API (dérivation MD5 du nom de fichier Fandom).

## Brancher Supabase (VPS, self-hosted)

Les tables vivent dans un **schéma Postgres dédié `feh`** (pas `public`).

1. **Exposer le schéma `feh` à l'API** (PostgREST) — une seule fois.
   Dans le `.env` de ton stack Supabase (docker), ajoute `feh` :
   ```
   PGRST_DB_SCHEMAS=public,graphql_public,storage,feh
   ```
   puis `docker compose restart rest`.
2. Dans Supabase Studio → SQL Editor, exécute `supabase/schema.sql`
   (schéma `feh`, tables `heroes` + `collection`, droits + RLS).
3. Puis `supabase/seed.sql` pour peupler le catalogue (1509 héros).
4. Copie `.env.example` → `.env.local` et renseigne :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. `npm run dev` → le badge passe de **○ Local** à **● Supabase**.

> Le client supabase-js est configuré sur le schéma `feh`
> (`db: { schema: 'feh' }` dans `src/lib/supabase.ts`).

### Régénérer le seed sans re-télécharger

```bash
node scripts/gen-seed.mjs   # relit src/data/heroes.json → supabase/seed.sql
```

## Structure

```
src/
  components/   Cartes héros, détail, barre de stats, nav, icônes
  data/         heroes.json (importé) + loader
  lib/          client Supabase, accès collection, hook
  types.ts      modèle de données
scripts/
  import-heroes.mjs   import du roster depuis le wiki
supabase/
  schema.sql    tables + RLS
  seed.sql      catalogue (généré)
```

## Pistes suivantes

- Import des **stats** (PV/ATQ/VIT/DÉF/RÉS) et de la **rareté** par héros.
- Auth Supabase pour multi-collections.
- Vues dédiées (Collection, complétion par jeu d'origine).
