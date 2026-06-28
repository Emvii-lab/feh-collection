-- ============================================================
--  Migration : illustrateurs (même structure que les voix)
--  À coller dans le SQL Editor de ton Supabase Studio (schéma feh).
-- ============================================================

-- 1) Table des illustrateurs (un illustrateur = plusieurs héros)
create table if not exists feh.illustrators (
  id         serial primary key,
  name       text not null,            -- nom romanisé / latin
  name_ja    text,                     -- nom en japonais
  created_at timestamptz not null default now()
);

-- 2) Lien héros -> illustrateur (FK ; null si inconnu)
alter table feh.heroes
  add column if not exists illustrator_id int references feh.illustrators(id) on delete set null;
create index if not exists heroes_illustrator_idx on feh.heroes (illustrator_id);

-- 3) RLS + droits
alter table feh.illustrators enable row level security;
drop policy if exists "illustrators_read" on feh.illustrators;
create policy "illustrators_read" on feh.illustrators for select using (true);
drop policy if exists "illustrators_all" on feh.illustrators;
create policy "illustrators_all" on feh.illustrators for all using (true) with check (true);

grant all on all tables in schema feh to anon, authenticated, service_role;
grant all on all sequences in schema feh to anon, authenticated, service_role;

-- 4) Forcer PostgREST à relire le schéma
notify pgrst, 'reload schema';
