// In-memory Store for tests and local play. A hosted version implements the same interface on a database.
import type { GameRecord, Store } from './service';
import type { PlayProfile } from '../ai/profile';

export class MemoryStore implements Store {
  private games = new Map<string, GameRecord>();
  profiles = new Map<string, PlayProfile>();

  async get(id: string) { const r = this.games.get(id); return r && structuredClone(r); }
  async getByInvite(code: string) {
    for (const r of this.games.values()) if (r.invite === code) return structuredClone(r);
    return undefined;
  }
  async put(rec: GameRecord, expectedUpdatedAt?: number) {
    const cur = this.games.get(rec.id);
    if (cur && expectedUpdatedAt !== undefined && cur.updatedAt !== expectedUpdatedAt) throw new Error('Someone else moved first — reload and try again.');
    this.games.set(rec.id, structuredClone(rec));
  }
  async listForUser(userId: string) {
    return [...this.games.values()].filter((r) => r.seats.some((s) => s.userId === userId)).map((r) => structuredClone(r));
  }
  async delete(id: string) { this.games.delete(id); }
  async listWithDeadlines(_before: number) {
    return [...this.games.values()].filter((r) => r.state && r.state.phase !== 'gameOver').map((r) => structuredClone(r));
  }
  async getProfile(userId: string) { const p = this.profiles.get(userId); return p && structuredClone(p); }
  async setProfile(userId: string, profile: PlayProfile) { this.profiles.set(userId, structuredClone(profile)); }
}
