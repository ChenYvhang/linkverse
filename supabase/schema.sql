-- LinkVerse pipeline storage.
--
-- Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Safe to re-run: every statement is idempotent.
--
-- Isolation is enforced by Row Level Security, in the database, not by the API
-- layer. An API that forgets a `where user_id = ...` is the single most common
-- way this kind of feature leaks one customer's data to another; with RLS on,
-- that query returns nothing instead of everything.

create table if not exists public.tracked_creators (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  category    text        not null,
  creator_id  text        not null,
  stage       text        not null default 'tracked',
  note        text        not null default '',
  updated_at  timestamptz not null default now(),
  primary key (user_id, category, creator_id)
);

-- Stage is a closed vocabulary. Keeping it as a check constraint rather than an
-- enum means adding a stage later is a one-line migration, not a type rewrite.
alter table public.tracked_creators
  drop constraint if exists tracked_creators_stage_check;
alter table public.tracked_creators
  add constraint tracked_creators_stage_check
  check (stage in ('tracked', 'contacted', 'replied', 'signed', 'declined'));

-- The app always reads one user's pipeline for one category.
create index if not exists tracked_creators_user_category_idx
  on public.tracked_creators (user_id, category);

alter table public.tracked_creators enable row level security;

-- One policy per operation, all with the same predicate: you only ever see and
-- write your own rows. `with check` on insert/update is what stops a client
-- from writing a row belonging to someone else.
drop policy if exists "own rows: select" on public.tracked_creators;
create policy "own rows: select" on public.tracked_creators
  for select using (auth.uid() = user_id);

drop policy if exists "own rows: insert" on public.tracked_creators;
create policy "own rows: insert" on public.tracked_creators
  for insert with check (auth.uid() = user_id);

drop policy if exists "own rows: update" on public.tracked_creators;
create policy "own rows: update" on public.tracked_creators
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows: delete" on public.tracked_creators;
create policy "own rows: delete" on public.tracked_creators
  for delete using (auth.uid() = user_id);

-- Keep updated_at honest: the client sends whatever it likes, and "when did
-- this change" is exactly the field a stale-pipeline view depends on.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tracked_creators_touch on public.tracked_creators;
create trigger tracked_creators_touch
  before insert or update on public.tracked_creators
  for each row execute function public.touch_updated_at();
