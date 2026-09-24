-- Every 15 minutes the database calls the game server to pass for players whose response deadline
-- ran out and to end turns that have been idle for 3 days. The anon key is public by design.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
select cron.schedule('ew-game-deadlines', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://rcujnqrqartmgdzsfkdv.supabase.co/functions/v1/ew-game',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <anon key from supabase/config.json>'),
    body := '{"op":"tick"}'::jsonb);
$$);
comment on table public.ew_games is 'Elitists War full game state. RLS on with no policies on purpose: only the ew-game Edge Function (service role) may read it, because it holds every player''s hidden cards.';
