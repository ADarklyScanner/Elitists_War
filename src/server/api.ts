// Request handler for the ew-game Edge Function. Every request carries the player's Supabase
// session; the function works out who they are and returns only what that player may see.
import { deleteOrLeave, joinTable, newTable, setOrders, submit, tick, viewFor, type GameRecord, type Notifier, type Store } from './service';
import { normalizePhone } from './sms';

/** Reading and saving a player's text-alert settings. */
export interface AlertSettings {
  get(userId: string): Promise<{ phone: string; optedIn: boolean } | null>;
  set(userId: string, phone: string, optedIn: boolean): Promise<void>;
}
import { RuleError, goalCount, goalNeeded, waitingFor, cardName, type Action } from '../engine';

export interface ApiRequest {
  op: 'list' | 'new' | 'join' | 'view' | 'move' | 'orders' | 'tick' | 'alerts' | 'delete';
  gameId?: string;
  code?: string;
  name?: string;
  illuminati?: string;
  seats?: number;
  computerSeats?: number;
  quick?: boolean;
  action?: Action;
  orders?: { passWhenNothing?: boolean; passWhenUninvolved?: boolean };
  /** op 'alerts': omit to read the current settings. */
  alerts?: { phone: string; optIn: boolean };
}

function summary(rec: GameRecord, userId: string) {
  const seat = rec.seats.find((s) => s.userId === userId);
  const s = rec.state;
  return {
    id: rec.id, invite: rec.invite, updatedAt: rec.updatedAt,
    seats: rec.seats.map((x) => ({ id: x.id, name: x.name || '(open seat)', isAI: x.isAI, joined: !!x.userId || x.isAI })),
    me: seat?.id,
    host: !!seat && seat.id === rec.seats[0].id,
    started: !!s,
    finished: s?.phase === 'gameOver',
    yourMove: !!s && !!seat && waitingFor(s).includes(seat.id),
    progress: s && seat ? `${goalCount(s, seat.id)}/${goalNeeded(s, seat.id)} Groups` : '',
    illuminati: s && seat ? cardName(s, s.players.find((p) => p.id === seat.id)!.illuminati) : undefined,
  };
}

function reply(rec: GameRecord, userId: string) {
  const seat = rec.seats.find((s) => s.userId === userId);
  return { game: summary(rec, userId), state: rec.state && seat ? viewFor(rec.state, seat.id) : null, orders: seat ? rec.orders[seat.id] : undefined };
}

export async function handle(store: Store, userId: string, req: ApiRequest, notifier?: Notifier, alertSettings?: AlertSettings): Promise<unknown> {
  const name = (req.name ?? 'Player').slice(0, 24);
  switch (req.op) {
    case 'list':
      return { games: (await store.listForUser(userId)).map((r) => summary(r, userId)) };
    case 'new': {
      const seats = Math.min(6, Math.max(2, req.seats ?? 2));
      const rec = await newTable(store, { userId, name, illuminati: req.illuminati ?? 'bavarian-illuminati' }, {
        seats, computerSeats: Math.min(seats - 1, req.computerSeats ?? 0), settings: { houseRules: req.quick ? ['quickGame'] : [] },
      }, notifier);
      return reply(rec, userId);
    }
    case 'join':
      return reply(await joinTable(store, req.code ?? '', { userId, name, illuminati: req.illuminati ?? 'the-network' }, notifier), userId);
    case 'view': {
      const rec = await store.get(req.gameId ?? '');
      if (!rec || !rec.seats.some((s) => s.userId === userId)) throw new RuleError('Game not found.');
      return reply(rec, userId);
    }
    case 'move':
      return reply(await submit(store, req.gameId ?? '', userId, req.action!, notifier), userId);
    case 'orders':
      return reply(await setOrders(store, req.gameId ?? '', userId, req.orders ?? {}), userId);
    case 'delete':
      return { result: await deleteOrLeave(store, req.gameId ?? '', userId) };
    case 'tick':
      return { changed: await tick(store, Date.now(), 72, notifier) };
    case 'alerts': {
      if (!alertSettings) return { available: false };
      if (req.alerts) {
        const phone = normalizePhone(req.alerts.phone);
        if (req.alerts.optIn && !phone) throw new RuleError('Enter a mobile number with its country code, e.g. +1 555 123 4567.');
        await alertSettings.set(userId, phone ?? '', !!req.alerts.optIn && !!phone);
      }
      const cur = await alertSettings.get(userId);
      return { available: !!notifier, phone: cur?.phone ?? '', optIn: !!cur?.optedIn };
    }
  }
  throw new RuleError('Unknown request.');
}
