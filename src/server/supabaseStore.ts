// Store backed by the ew_games table (service role only). Used inside the Edge Function.
import type { GameRecord, Store } from './service';
import { waitingFor } from '../engine';

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

  async listWithDeadlines(_before: number) {
    const { data, error } = await this.db.from('ew_games').select('record').eq('finished', false).limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []).map(rowToRecord);
  }
}
