// Plays made illegal partway through an attack ("Cancellations, Illegal Actions, & Other Surprises").
import { describe, expect, it } from 'vitest';
import { applyAction, attackCancelled, attackStrength, openArrows, type Action, type GameState } from '../src/engine';
import { give, scenario } from './helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const hand = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.hand;
const boost = (s: GameState, iid: string) => s.cards[iid].mods.push({ source: 'test', kind: 'power', value: 30, until: 'permanent' });
function put(s: GameState, pl: string, cardId: string, master?: string): string {
  const m = master ?? ill(s, pl);
  return give(s, pl, cardId, { under: m, side: openArrows(s, m)[0] });
}
/** Everyone passes until the attack is over, with the dice forced to a sure success. */
function resolve(s: GameState): GameState {
  for (let i = 0; i < 30 && s.attack; i++) {
    if (s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = [1, 1];
    const who = s.window ? s.players.map((p) => p.id).find((id) => !s.window!.passed.includes(id)) : undefined;
    if (!who) break;
    s = act(s, who, { type: 'pass' });
  }
  return s;
}
/** Make `target` Peaceful with Kinder and Gentler, paid by p2's Illuminati. */
function kinder(s: GameState, target: string): GameState {
  const k = give(s, 'p2', 'kinder-and-gentler', { hand: true });
  return act(s, 'p2', { type: 'playPlot', play: { card: k, target, payWith: [ill(s, 'p2')] } });
}

describe('a play made illegal partway through an attack', () => {
  it('a Violent attacker made Peaceful loses its Terrorist Nuke: it returns to hand, exposed, and the attack goes on', () => {
    let s = scenario();
    const mafia = put(s, 'p1', 'the-mafia');
    boost(s, mafia);
    const t = put(s, 'p2', 'dentists');
    const nuke = give(s, 'p1', 'terrorist-nuke', { hand: true });
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: mafia, target: t, plots: [{ card: nuke, target: mafia, mode: 'power' }] });
    const before = attackStrength(s, s.attack!).attack;
    s = kinder(s, mafia);
    expect(s.attack).toBeDefined();
    expect(attackCancelled(s.attack!)).toBe(false);
    expect(hand(s, 'p1')).toContain(nuke);
    expect(s.cards[nuke].zone).toBe('hand');
    expect(s.cards[nuke].exposed).toBe(true);
    // The +10 is gone (and the attacker is now Peaceful rather than Violent).
    expect(attackStrength(s, s.attack!).attack).toBeLessThan(before - 9);
    s = resolve(s);
    expect(s.cards[t].zone).toBe('destroyed'); // the attack still happened
    expect(s.cards[nuke].zone).toBe('hand'); // not discarded with the attack's Plots
  });

  it('a new immunity stops the attack: token spent, Nuke discarded, aider refunded, its Benefit Concert back exposed (Vatican City example)', () => {
    let s = scenario();
    const mafia = put(s, 'p1', 'the-mafia');
    boost(s, mafia);
    const libs = put(s, 'p1', 'democrats');
    const vatican = put(s, 'p2', 'vatican-city');
    const nuke = give(s, 'p1', 'terrorist-nuke', { hand: true });
    const concert = give(s, 'p1', 'benefit-concert', { hand: true });
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: mafia, target: vatican, plots: [{ card: nuke, target: mafia, mode: 'power' }] });
    s = act(s, 'p1', { type: 'aid', group: libs });
    s = act(s, 'p1', { type: 'playPlot', play: { card: concert, target: libs, mode: 'power' } });
    expect(s.cards[libs].tokens).toBe(0);
    s = kinder(s, mafia); // the attacker is now Peaceful, and Vatican City is immune to Peaceful Groups
    expect(s.attack?.illegal).toMatch(/immune/);
    expect(attackCancelled(s.attack!)).toBe(true);
    s = resolve(s);
    expect(s.attack).toBeUndefined();
    expect(s.cards[vatican].zone).toBe('structure'); // the attack did not happen
    expect(s.cards[mafia].tokens).toBe(0); // the attacker's token stays spent
    expect(s.cards[nuke].zone).toBe('discard');
    expect(s.cards[libs].tokens).toBe(1); // the aiding Group gets its token back
    expect(hand(s, 'p1')).toContain(concert);
    expect(s.cards[concert].exposed).toBe(true);
    expect(s.log.some((l) => /does not happen/.test(l.text))).toBe(true);
  });

  it('an attack made illegal becomes legal again if a later play undoes the change before the roll', () => {
    let s = scenario();
    const mafia = put(s, 'p1', 'the-mafia');
    boost(s, mafia);
    const vatican = put(s, 'p2', 'vatican-city');
    const lasers = give(s, 'p1', 'orbital-mind-control-lasers', { resource: true });
    s.cards[lasers].tokens = 1;
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: mafia, target: vatican });
    s = kinder(s, mafia);
    expect(s.attack?.illegal).toBeTruthy();
    s = act(s, 'p1', { type: 'useAbility', card: lasers, ability: 'align', params: { target: mafia, mode: 'remove', alignment: 'Peaceful' } });
    expect(s.attack?.illegal).toBeUndefined();
    expect(s.log.some((l) => /legal again/.test(l.text))).toBe(true);
    s = resolve(s);
    expect(s.cards[vatican].zone).toBe('destroyed');
  });

  it('is checked again before the attack resolves, not only when a play is made', () => {
    let s = scenario();
    const mafia = put(s, 'p1', 'the-mafia');
    boost(s, mafia);
    const vatican = put(s, 'p2', 'vatican-city');
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: mafia, target: vatican });
    // Something outside any play changes the attacker (a card effect with no action of its own).
    s.cards[mafia].mods.push({ source: 'test', kind: 'addAlign', align: 'Peaceful', until: 'endOfTurn' });
    expect(s.attack?.illegal).toBeUndefined();
    s = resolve(s);
    expect(s.cards[vatican].zone).toBe('structure');
    expect(s.log.some((l) => /does not happen/.test(l.text))).toBe(true);
  });
  it('an aiding Group the target becomes immune to stops counting, and the attack goes on', () => {
    let s = scenario();
    const mafia = put(s, 'p1', 'the-mafia');
    const libs = put(s, 'p1', 'democrats');
    const vatican = put(s, 'p2', 'vatican-city');
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: mafia, target: vatican });
    s = act(s, 'p1', { type: 'aid', group: libs });
    const withAid = attackStrength(s, s.attack!).attack;
    s = kinder(s, libs); // the aiding Group is now Peaceful: Vatican City is immune to it
    expect(s.attack?.illegal).toBeUndefined();
    expect(s.attack?.illegalGroups).toEqual([libs]);
    expect(attackStrength(s, s.attack!).attack).toBeLessThan(withAid);
  });
});
