// Text alerts: only a game starting, a turn beginning, or an Attack to Destroy on you; one per
// player every five minutes.
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/server/memoryStore';
import { joinTable, newTable, submit, type AlertKind, type Notifier } from '../src/server/service';
import { MemorySmsPrefs, SmsNotifier, alertText, normalizePhone } from '../src/server/sms';
import { waitingFor } from '../src/engine';
import { chooseAction } from '../src/ai/ai';

class Recorder implements Notifier {
  sent: { user: string; kind: AlertKind; what: string }[] = [];
  async alert(user: string, _g: string, kind: AlertKind, what: string) { this.sent.push({ user, kind, what }); }
}

async function twoPlayerGame(n: Notifier) {
  const store = new MemoryStore();
  const t = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'bavarian-illuminati' }, { seats: 2 }, n);
  const g = await joinTable(store, t.invite, { userId: 'bob', name: 'Bob', illuminati: 'ufos' }, n);
  return { store, id: g.id };
}

describe('text alerts', () => {
  it('tells the other players when the lobby fills and the game starts', async () => {
    const r = new Recorder();
    await twoPlayerGame(r);
    expect(r.sent).toEqual([{ user: 'ann', kind: 'gameStarted', what: 'Your game has started' }]);
  });

  it('only alerts for turns and Attacks to Destroy, and never the player who just moved', async () => {
    const r = new Recorder();
    const { store, id } = await twoPlayerGame(r);
    r.sent = [];
    let turnAlerts = 0;
    for (let i = 0; i < 400; i++) {
      const rec = (await store.get(id))!;
      const s = rec.state!;
      if (s.phase === 'gameOver') break;
      const seat = waitingFor(s)[0];
      const user = rec.seats.find((x) => x.id === seat)!.userId!;
      const before = r.sent.length;
      await submit(store, id, user, chooseAction(s, seat), r);
      for (const a of r.sent.slice(before)) {
        expect(a.user).not.toBe(user);
        expect(['yourTurn', 'destroyAttack']).toContain(a.kind);
        if (a.kind === 'yourTurn') turnAlerts++;
      }
    }
    expect(turnAlerts).toBeGreaterThan(2);
    // Far fewer alerts than moves: reaction windows alone never text anyone.
    expect(r.sent.length).toBeLessThan(120);
  });

  it('sends at most one text per player every five minutes, and only to players who opted in', async () => {
    const prefs = new MemorySmsPrefs();
    let clock = 1_000_000;
    prefs.now = () => clock;
    prefs.rows.set('ann', { phone: '+15551234567', optedIn: true });
    prefs.rows.set('bob', { phone: '+15557654321', optedIn: false });
    const texts: string[] = [];
    const n = new SmsNotifier(prefs, async (to, body) => { texts.push(`${to} ${body}`); }, 'https://example.test/');
    await n.alert('ann', 'g', 'yourTurn', 'It is your turn');
    await n.alert('ann', 'g', 'destroyAttack', 'Hollywood is under an Attack to Destroy');
    await n.alert('bob', 'g', 'yourTurn', 'It is your turn');
    expect(texts).toHaveLength(1);
    clock += 4 * 60_000;
    await n.alert('ann', 'g', 'yourTurn', 'It is your turn');
    expect(texts).toHaveLength(1);
    clock += 60_000;
    await n.alert('ann', 'g', 'yourTurn', 'It is your turn');
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('Reply STOP');
  });

  it('accepts phone numbers in international form', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('+15551234567');
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
    expect(normalizePhone('12')).toBeNull();
    expect(alertText('destroyAttack', 'X is under an Attack to Destroy', 'u')).toMatch(/^Elitists War: Under attack!/);
  });
});
