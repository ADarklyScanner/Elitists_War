// SubGenius pack (97 cards). Card agents add the pack's cards here (or in subgenius2.ts, ... imported
// from src/engine/index.ts). See docs/CARD_SCRIPTING.md, "Expansions", and docs/EXPANSIONS.md.
//
// The Church of the SubGenius is encoded with the rules foundation because the stand-alone SubGenius
// game cannot be played without it: its Slack is a new rule of the pack.
import { registerAbilities } from '../abilities';
import { registerHooks } from '../hooks';
import { attributes } from '../stats';
import { def } from '../cards';
import { controllerOf2 } from '../game';

registerAbilities({
  'church-of-the-subgenius': [
    { kind: 'slack' },
    { kind: 'specialGoal', goal: 'slack', value: 3 },
  ],
});

registerHooks({
  'church-of-the-subgenius': {
    // +2 on direct Attacks to Control a SubGenius Group, made by the Church itself or by one of its SubGenius Groups.
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || ctx.type !== 'control' || ctx.instant || !ctx.attacker) return 0;
      if (ctx.attackerPlayer !== controllerOf2(s, self) || !attributes(s, ctx.target).includes('SubGenius')) return 0;
      const by = ctx.attacker;
      return by === self || (def(s, by).type === 'Group' && attributes(s, by).includes('SubGenius')) ? 2 : 0;
    },
  },
});
