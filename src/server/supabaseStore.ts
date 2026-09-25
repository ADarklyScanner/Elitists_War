// Store backed by the ew_games table (service role only). Used inside the Edge Function.
import type { GameRecord, Store } from './service';
import { waitingFor } from '../engine';
import { normalizeProfile, type PlayProfile } from '../ai/profile';

// Minimal shape of the supabase-js client we use, so this file doesn't depend on the package.
interface Db {
  from(table: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const rowToRecord = (r: { record: GameRecord }) => r.record;

export class SupabaseStore implements Store {
  constructor(private db: Db) {}

  async get(id: string) {
    const { data, error } = await this.db.from('ew_games').select('record').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToRecord(data) : undefined;
  }

  async getByInvite(code: string) {
    const { data, error } = await this.db.from('ew_games').select('record').eq('invite', code).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToRecord(data) : undefined;
  }

  async put(rec: GameRecord, expectedUpdatedAt?: number) {
    const playerIds = rec.seats.map((s) => s.userId).filter(Boolean);
    const row = {
      id: rec.id, invite: rec.invite, record: rec, updated_at: rec.updatedAt, player_ids: playerIds,
      finished: rec.state?.phase === 'gameOver',
    };
    if (expectedUpdatedAt === undefined) {
      const { error } = await this.db.from('ew_games').insert(row);
      if (error) throw new Error(error.message);
    } else {
      // Optimistic concurrency: only succeeds if nobody else saved since we read.
      const { data, error } = await this.db.from('ew_games').update(row).eq('id', rec.id).eq('updated_at', expectedUpdatedAt).select('id');
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error('Someone else moved first — reload and try again.');
    }
    // Tell subscribed browsers that something changed and who has to move.
    const waiting = rec.state ? waitingFor(rec.state).map((id) => rec.seats.find((s) => s.id === id)?.userId).filter(Boolean) : [];
    await this.db.from('ew_game_pings').upsert({
      game_id: rec.id, version: rec.updatedAt, waiting, player_ids: playerIds, updated_at: new Date().toISOString(),
    });
  }

  async listForUser(userId: string) {
    const { data, error } = await this.db.from('ew_games').select('record').contains('player_ids', [userId]).order('updated_at', { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map(rowToRecord);
  }

  async delete(id: string) {
    const { error } = await this.db.from('ew_games').delete().eq('id', id); // pings go with it (cascade)
    if (error) throw new Error(error.message);
  }

  async listWithDeadlines(_before: number) {
    const { data, error } = await this.db.from('ew_games').select('record').eq('finished', false).limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []).map(rowToRecord);
  }

  /** Play profiles (table ew_profiles, service role only): what each player's mirrors are made from. */
  async getProfile(userId: string): Promise<PlayProfile | undefined> {
    const { data, error } = await this.db.from('ew_profiles').select('profile').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? normalizeProfile(data.profile) : undefined;
  }

  async setProfile(userId: string, profile: PlayProfile): Promise<void> {
    const { error } = await this.db.from('ew_profiles').upsert({ user_id: userId, profile, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  }
}

/** Opt-in phone numbers for text alerts (table ew_sms_prefs, service role only). */
export class SupabaseSmsPrefs {
  constructor(private db: Db & { rpc(fn: string, args: Record<string, unknown>): any }) {} // eslint-disable-line @typescript-eslint/no-explicit-any

  async claim(userId: string, cooldownMinutes: number): Promise<string | null> {
    const { data, error } = await this.db.rpc('ew_claim_sms', { p_user: userId, p_cooldown_minutes: cooldownMinutes });
    if (error) throw new Error(error.message);
    return typeof data === 'string' ? data : null;
  }

  async get(userId: string): Promise<{ phone: string; optedIn: boolean } | null> {
    const { data, error } = await this.db.from('ew_sms_prefs').select('phone, opted_in').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { phone: data.phone, optedIn: data.opted_in } : null;
  }

  async set(userId: string, phone: string, optedIn: boolean): Promise<void> {
    const row = { user_id: userId, phone, opted_in: optedIn, updated_at: new Date().toISOString(), ...(optedIn ? { consented_at: new Date().toISOString() } : {}) };
    const { error } = await this.db.from('ew_sms_prefs').upsert(row);
    if (error) throw new Error(error.message);
  }
}
