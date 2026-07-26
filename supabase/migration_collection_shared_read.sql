-- ============================================================
--  feh.collection — lecture partagée (consultation d'autres collections)
--  Objectif : une personne connectée peut CONSULTER (lecture seule) la
--  collection d'une autre, mais ne peut MODIFIER que la sienne.
--  À coller dans le SQL Editor de Supabase Studio (schéma feh).
-- ============================================================

-- 1) On remplace la policy « tout ou rien réservé au propriétaire »
--    par : lecture ouverte aux personnes connectées + écriture réservée au propriétaire.
drop policy if exists "collection_all" on feh.collection;
drop policy if exists "collection_own" on feh.collection;

-- Lecture : n'importe quelle personne authentifiée peut lire toutes les collections.
create policy "collection_read_authenticated" on feh.collection
  for select
  using (auth.uid() is not null);

-- Écriture : chacun ne crée / modifie / supprime QUE sa propre collection.
create policy "collection_insert_own" on feh.collection
  for insert
  with check (user_id = auth.uid());
create policy "collection_update_own" on feh.collection
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "collection_delete_own" on feh.collection
  for delete
  using (user_id = auth.uid());

-- 2) Liste des comptes à proposer dans le sélecteur « Voir la collection de … ».
--    Vue en lecture seule sur auth.users (id + email), lisible par les connectés.
--    security_invoker=off (défaut) : la vue lit auth.users avec les droits du
--    propriétaire de la vue ; on n'expose QUE id + email.
create or replace view feh.profiles as
  select id, email
  from auth.users;

grant select on feh.profiles to authenticated;

-- Forcer PostgREST à relire le schéma
notify pgrst, 'reload schema';
