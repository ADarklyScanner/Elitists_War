// Request handler for the ew-game Edge Function. Every request carries the player's Supabase
// session; the function works out who they are and returns only what that player may see.
import { joinTable, newTable, setOrders, submit, tick, viewFor, type GameRecord, type Store } from './service';
import { RuleError, goalCount, goalNeeded, waitingFor, cardName, type Action } from '../engine';

export interface ApiRequest {
  op: 'list' | 'new' | 'join' | 'view' | 'move' | 'orders' | 'tick';
  gameId?: string;
  code?: string;
  name?: string;
  illuminati?: string;
  seats?: number;
  computerSeats?: number;
  quick?: boolean;
  action?: Action;
  orders?: { passWhenNothing?: boolean; passWhenUninvolved?: boolean };
}

function summary(rec: GameRecord, userId: string) {
  const seat = rec.seats.find((s) => s.userId === userId);
  const s = rec.state;
  return {
    id: rec.id, invite: rec.invite, updatedAt: rec.updatedAt,
    seats: rec.seats.map((x) => ({ id: x.id, name: x.name || '(open seat)', isAI: x.isAI, joined: !!x.userId || x.isAI })),
    me: seat?.id,
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

export async function handle(store: Store, userId: string, req: ApiRequest): Promise<unknown> {
  const name = (req.name ?? 'Player').slice(0, 24);
  switch (req.op) {
    case 'list':
      return { games: (await store.listForUser(userId)).map((r) => summary(r, userId)) };
    case 'new': {
      const seats = Math.min(6, Math.max(2, req.seats ?? 2));
      const rec = await newTable(store, { userId, name, illuminati: req.illuminati ?? 'bavarian-illuminati' }, {
        seats, computerSeats: Math.min(seats - 1, req.computerSeats ?? 0), settings: { houseRules: req.quick ? ['quickGame'] : [] },
      });
      return reply(rec, userId);
    }
    case 'join':
      return reply(await joinTable(store, req.code ?? '', { userId, name, illuminati: req.illuminati ?? 'the-network' }), userId);
    case 'view': {
      const rec = await store.get(req.gameId ?? '');
      if (!rec || !rec.seats.some((s) => s.userId === userId)) throw new RuleError('Game not found.');
      return reply(rec, userId);
    }
    case 'move':
      return reply(await submit(store, req.gameId ?? '', userId, req.action!), userId);
    case 'orders':
      return reply(await setOrders(store, req.gameId ?? '', userId, req.orders ?? {}), userId);
    case 'tick':
      return { changed: await tick(store) };
  }
  throw new RuleError('Unknown request.');
}
