import type { GameState } from '../types';
import { registerAbilities } from '../abilities';
import { registerHooks } from '../hooks';
import { def, cardName } from '../cards';
import { controllerOf2, log, player, resourcesOf } from '../game';

// The nine Illuminati. Parts that need a script are in registerHooks below.
registerAbilities({
  'adepts-of-hermes': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Magic'] }, value: 6, scope: 'any' },
    { kind: 'failedHandReturns' },
  ],
  'bavarian-illuminati': [
    { kind: 'freePrivilegedAttack' },
    { kind: 'specialGoal', goal: 'totalPower', value: 50 },
  ],
  'bermuda-triangle': [
    { kind: 'specialGoal', goal: 'bermuda', value: 35 },
  ],
  'discordian-society': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Weird'] }, value: 4, scope: 'any' },
    { kind: 'doubleCount', match: { alignments: ['Weird'] }, minPower: 3 },
    { kind: 'structureImmune', from: { alignments: ['Government', 'Straight'] } },
  ],
  'gnomes-of-zurich': [
    { kind: 'handLimit', value: 1 },
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Bank'] }, value: 4, scope: 'any' },
    { kind: 'doubleCount', match: { alignments: ['Corporate'] }, minPower: 4 },
    { kind: 'doubleCount', match: { attributes: ['Bank'] }, minPower: 4 },
  ],
  'the-network': [
    { kind: 'extraPlotDraw', value: 1 },
    { kind: 'doubleCount', match: { attributes: ['Computer'] }, minPower: 3 },
  ],
  'servants-of-cthulhu': [
    { kind: 'attackBonus', on: 'destroy', value: 4, scope: 'any', instant: true },
    { kind: 'drawPlotOnDestroy' },
    { kind: 'specialGoal', goal: 'destroyCount', value: 8 },
  ],
  'shangri-la': [
    { kind: 'structureDefense', value: 5, instant: true },
    { kind: 'canOnlyDestroy', match: { alignments: ['Violent'] } },
    { kind: 'specialGoal', goal: 'peacefulPower', value: 30 },
  ],
  'ufos': [
    { kind: 'extraIlluminatiToken', value: 1 },
    // Up to three Goal cards, winning with any one of them: goalLimit and meetsGoal in game.ts.
  ],
});

const isMagicResource = (s: GameState, iid: string) => /\bMagic\b/.test(def(s, iid).uniqueness ?? '');

registerHooks({
  'adepts-of-hermes': {
    // Each Magic Resource (a "Magic Artifact") in play counts as one more controlled Group.
    goalBonus: (s, self) => {
      const pl = controllerOf2(s, self);
      return pl ? resourcesOf(s, pl).filter((r) => !s.cards[r].hiddenUnder && isMagicResource(s, r)).length : 0;
    },
  },

  'bermuda-triangle': {
    // Free reorganization at the end of the turn: once it starts, no more attacks this turn.
    actions: [{
      id: 'reorganize', label: 'Start the end-of-turn reorganization (free moves, no more attacks this turn)', timing: ['main'], usesToken: false, oncePerTurn: true, ai: 'never',
      check: (s, pl) => (s.turnFlags.freeMoves === pl ? 'You can already move your Groups freely.' : null),
      apply(s, pl, self) {
        s.turnFlags.freeMoves = pl;
        s.cards[self].data = { ...s.cards[self].data, reorgTurn: s.turn };
        log(s, `${cardName(s, self)}: ${player(s, pl).name} reorganizes the Power Structure for free and makes no more attacks this turn.`, pl);
      },
    }],
    forbidAttack: (s, self, _attacker, _target, type, attackerPlayer) =>
      type !== 'takeover' && attackerPlayer === controllerOf2(s, self) && s.cards[self].data?.reorgTurn === s.turn
        ? 'You have started your end-of-turn reorganization: no more attacks this turn.' : null,
  },
});
