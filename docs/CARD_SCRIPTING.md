# Encoding cards

Every card's behaviour lives in `src/engine/content/`. Card text (paraphrased) is in
`src/data/cards.json` (`text`, `modifier`, `notes`, `trigger`, `target`, `cost`). The rules are in
`RULES_COMPLIANCE.md` and the Core Rules tab of `data/Elitists_War.xlsx`.

Card ids are lowercase slugs of names: `"Gun Lobby"` → `gun-lobby`, `"I.R.S."` → `i-r-s`.

## Three ways to give a card behaviour

1. **Declarative abilities** (`abilities.ts`, `registerAbilities`) — preferred for simple, common
   effects: `attackBonus`, `aidBonus`, `structureDefense`, `selfDefense`, `structureImmune`,
   `selfImmune`, `cannotBeDestroyed`, `powerPer`, `extraPlotDraw`, `handLimit`, `noTokens`, …
   A `{ kind: 'pending', note }` entry marks a part that is not encoded; the UI shows it to players.
2. **Hooks** (`hooks.ts`, `registerHooks`) — anything else a Group, Resource or linked Plot does while
   in play: constant effects (`powerMod`, `resistanceMod`, `extraTokens`, `attackMod`, `mayJoin`,
   `immune`, `preventDestroy`, `mayInterfere`, `handLimit`, `extraPlotDraws`, `goalBonus`),
   triggers (`onTurnStart`, `onDestroy`, `onCapture`, `onAttackEnd`, `onEnterPlay`), and
   **activated abilities** (`actions`: "spend this card's action to …"). Resources with their own
   action set `hasAction: true`; link restrictions go in `linkTo`.
3. **Plot handlers** (`plotTypes.ts`, `registerPlots`) — every Plot card. Goal cards also register a
   condition with `registerGoals`.

## Rules for hooks

- `self` is the card that has the hook; it is active only while in play (`zone` `structure`,
  `resources`, or a Plot on the `table` with `linkedTo` set). Get its controller with
  `controllerOf2(s, self)`.
- `powerMod` / `resistanceMod` / `globalMod` must **not** call `power()` / `resistance()` of other
  cards (that can recurse forever). Use printed values from `def(s, iid)` or counts instead.
- `attackMod(s, self, ctx, side)` returns a number added to the attack (`side === 'attack'`) or the
  defense. Check `ctx.type`, `ctx.instant`, `ctx.disaster`, `ctx.assassination`, `ctx.attacker`,
  `ctx.aid`, `ctx.target`, `ctx.targetPlayer`, `ctx.attackerPlayer` to decide if it applies.
- An activated ability's `apply` may push onto `ctx.attackBonus` / `ctx.defenseBonus` (give the entry
  `plot: <any unique string>` only if it should be cancellable), or return a live effect
  (`cancelGroup`, `reroll`, `delta`, `set`, `fail`, …) during an attack.
- Mutate state only inside `apply` / triggers / Plot `apply`/`resolve`. Log with `log(s, text, player)`.
- Use `RuleError` messages (returned strings from `check`) written for players: say what is wrong
  and how to fix it.

## Tests

Put tests in `tests/content/<file>.test.ts`. Use `scenario()` (p1's main phase, both players past
their first turn, empty structures, 1 Illuminati token each) and `give(s, player, cardId, where)`
from `tests/helpers.ts` to set up positions, then drive the game with `applyAction`. Force dice by
setting `s.attack.roll = [a, b]` while the roll window is open. Test the card's main effect and at
least one restriction for every card you encode.
