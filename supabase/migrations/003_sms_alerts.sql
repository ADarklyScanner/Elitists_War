-- Opt-in text-message alerts. Only the ew-game Edge Function (service role) touches this table:
-- RLS is on with no policies, so phone numbers are never readable from a browser.
create table if not exists public.ew_sms_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null,
  opted_in boolean not null default false,
  consented_at timestamptz,
  last_sent_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.ew_sms_prefs enable row level security;

-- Atomic throttle: returns the number and stamps last_sent_at only if the player opted in and
-- has not been texted within the cooldown. Two moves racing cannot both get a number back.
create or replace function public.ew_claim_sms(p_user uuid, p_cooldown_minutes int)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.ew_sms_prefs
     set last_sent_at = now()
   where user_id = p_user
     and opted_in
     and (last_sent_at is null or last_sent_at < now() - make_interval(mins => p_cooldown_minutes))
  returning phone;
$$;
revoke all on function public.ew_claim_sms(uuid, int) from public, anon, authenticated;
grant execute on function public.ew_claim_sms(uuid, int) to service_role;
