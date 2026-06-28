-- ============================================================
--  feh.collection — passage en multi-utilisateur (auth Supabase)
--  À coller dans le SQL Editor de Supabase Studio.
-- ============================================================

-- 1) Backfill : toutes les lignes sans utilisateur -> compte maki_22@hotmail.fr
update feh.collection
   set user_id = '637481bd-990a-41b9-b1a0-7a5c34f5cfe8'
 where user_id is null;

-- 2) user_id obligatoire + valeur par défaut = utilisateur connecté
alter table feh.collection alter column user_id set not null;
alter table feh.collection alter column user_id set default auth.uid();

-- 3) (optionnel) lier user_id à auth.users — ignore si déjà présent
do $$
begin
  alter table feh.collection
    add constraint collection_user_fk
    foreign key (user_id) references auth.users(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 4) Clé primaire composite : chaque utilisateur a SA propre collection
alter table feh.collection drop constraint if exists collection_pkey;
alter table feh.collection add primary key (user_id, hero_id);

-- 5) RLS : chacun ne voit et ne modifie que sa propre collection
drop policy if exists "collection_all" on feh.collection;
drop policy if exists "collection_own" on feh.collection;
create policy "collection_own" on feh.collection
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
