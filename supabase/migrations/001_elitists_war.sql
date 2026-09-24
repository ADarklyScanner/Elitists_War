-- Elitists War online play.
-- ew_games holds the full, secret game state: no client can read it directly (RLS on, no policies);
-- only the ew-game Edge Function (service role) reads and writes it and hands each player a
-- redacted view. ew_game_pings is a small public-to-players row that changes on every move so
-- browsers can subscribe with Realtime and know when to fetch their new view.

create table if not exists public.ew_games (
  id text primary key,
  invite text unique not null,
  record jsonb not null,
  updated_at bigint not null,
  player_ids uuid[] not null default '{}',
  finished boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.ew_games enable row level security;
create index if not exists ew_games_players on public.ew_games using gin (player_ids);

create table if not exists public.ew_game_pings (
  game_id text primary key references public.ew_games(id) on delete cascade,
  version bigint not null,
  waiting uuid[] not null default '{}',
  player_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.ew_game_pings enable row level security;
create policy "players see pings for their games" on public.ew_game_pings
  for select to authenticated using ((select auth.uid()) = any (player_ids));

alter publication supabase_realtime add table public.ew_game_pings;
