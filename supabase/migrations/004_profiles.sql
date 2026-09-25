-- Play profiles: how each signed-in player plays, learned from their finished games, from which the
-- game makes "mirror" computer players. Only the ew-game Edge Function (service role) touches this
-- table: RLS is on with no policies, so a browser can neither read nor forge a profile.
create table if not exists public.ew_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.ew_profiles enable row level security;
