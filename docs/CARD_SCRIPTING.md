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

## Engine features for unusual cards

**Targets.** `needs.target` on a Plot (or on an ability) sets what `play.target` may be. Besides Groups
(`ownGroup`, `anyGroup`, `rivalGroup`, `place`, `personality`) and Plots on the table (`plot`), you can use:
`resource`; `handCard`, `handGroup`, `handPlot` (your own hand); `destroyed` (the destroyed pile);
`discardPile` (any discard pile); `nwo` (an NWO on the table); `rival` (the target is that rival's
Illuminati card); and `rivalHand` (a card in a rival's hand). For a set of cards use
`needs.targetsOf: 'handPlot' | 'handGroup' | 'handCard'`; the result goes in `play.targets`.

**Events.** Timing `'event'` plus `events: ['takeover', 'destroyed', …]` makes a Plot playable only
in the response window that follows that event. The window shows the event in `s.window.event`. Engine code
announces events with `raiseEvent(s, {type, player, card, cards, by, data}, then?)`. The events are
`turnStart`, `drawn`, `takeover`, `destroyed` (with `data.layout`, where the Group and its puppets were), `devastated`, `discarded`, `plotResolved`, `relief` and `failedTakeover` (a Group played from hand was not taken over).
The `onEvent` hook runs at once for every event.

**Announced actions (R009/R010).** An action outside an attack is announced before it happens: moving a
Group, an activated ability used in your own main phase, Relief, bringing a Resource into play, linking a
Resource, and the Illuminati's Group draw. The costs are paid, then an `action` event is raised with
`player` (who acts), `cards` (the Groups whose token pays: the actors a cancel may target), `card` (the
card acted on) and `data: {kind, action}` (the original action). The action itself runs as that event's
continuation (`then: 'resolveAction'`) once its window closes. When nobody can respond, it runs at once,
so games without such cards play exactly as before. Buying Plots is not an action and is never announced.
Actions taken while another window is open (Relief during an attack, abilities in a window) still happen
at once.
- A Plot answers with `timing: ['event'], events: ['action']` and calls `respondToAction(s, pl, card, effect)`
  from its `resolve`; `{t: 'fail'}` cancels the whole action.
- An activated ability answers with `timing: ['event']` (optional `events`, default `['action']`) and a
  `listens(s, pl, self, e)` test. The window opens only if some card listens, so keep `listens` precise
  (token available, matching actor). What `apply` returns is recorded on `e.responses`.
  `{t: 'cancelGroup', group}` cancels one actor; `{t: 'cancelPlot', target}` cancels an earlier response.
- `announcedCancel(ok)` gives the `listens`/`check`/`apply` of "spend this card's action to cancel an action
  of a [matching] Group" outside attacks. Use it with `needs: {target: 'actingGroup'}`.
- Use `announcedAction(s)`, `announcedActors(e)`, `actionCancelled(e, card?)` and `actionSummary(s, e)` to
  read the pending action. A cancelled action never happens and its costs stay paid. A once-per-turn
  action (Resource play, Group draw, a once-per-turn ability) may be tried again.
- An ability with timing `'counter'` may be used against a non-attack Plot waiting in its `plot` window.
  Returning `{t: 'cancelPlot', target: window.plot.iid}` negates that Plot (MI-5).

**Choices.** When a card has to ask someone to choose, call
`askChoice(s, player, {key, question, options:[{id,label}], min, max, data})` and register
`registerChoice(key, {resolve(s, player, picked, data), ai?})`. The answer arrives as the action
`{type:'choose', ids}`. Choices queue up behind any prompt that is already open. `viewFor` hides the options from other players.

**Private information.** `revealTo(s, player, cards, why)` lets one player see cards, such as a rival's hand.
Those cards stay visible to that player in their online view, and the log line goes only to them.

**Attacks started by cards.**
- `startCardAttack(s, player, {plot, target, power, disaster?, aidRule?})` is an attack that has no attacking Group; its strength is `power`.
- `aidRule: 'defenderOnly'` means only the target's side may add Power.
- `startAttack(s, player, action, {outOfTurn: true})` makes an attack outside the attacker's turn.

**Turn flags** (`s.turnFlags`, cleared every turn):
- `noPlotDraws` (a list of player ids);
- `noTakeover`;
- `restricted` (the player may only draw and place tokens);
- `extraTurn`;
- `freeMoves` (a player id);
- `noDraws`.

To give a player an extra turn next, set `s.extraTurnFor = playerId`.

**More hooks.**
- `alignmentMod` and `attributeMod` edit a card's alignments and attributes.
- `forbidAttack` returns a reason to refuse an attack or takeover.
- `forbidJoin` bars a Group from aiding or opposing.
- `ignoreImmunity` lets an attack ignore the target's immunity.
- `secretOverride` makes a Group count as Secret, or not.
- `noTokens` stops a card from receiving tokens.
- `disablesAbilities` works on table cards only. It switches off a Group's own abilities and hooks.
- `beforeDraw` returns `'skip'` or `'bottom'` to change a draw.
- `onDraw` runs after a card is drawn.
- `lockLinks` stops Resources linked to the card from being linked elsewhere.
- `worksInSecretAttacks: true` keeps the card's `attackMod` in attacks by or against Secret Groups (R014 normally drops it).
- `goalAlignWeight(s, iid, alignment)` says how many Groups of that alignment the card counts as for Goal cards
  (in play or destroyed); Goal code reads it with `goalAlignWeight()` from game.ts.
- `beforeAttackResult` runs when everyone has passed after the roll, before the result is applied. It may
  push a live effect such as a re-roll or a `fail`. Return true to open the roll window again, and never
  do that twice in one attack.
- `replaceableWhenDestroyed` lets another copy of a Unique Resource come into play once this one is destroyed.
- A question asked during the start-of-turn draws (`askChoice` in `onDraw`) is answered before the
  automatic takeover prompt.

Modifiers `{kind:'addAttr'|'removeAttr', attr}` and `{kind:'addArrow', side}` change attributes and arrows
while the card is in play.

## Tests

Put tests in `tests/content/<file>.test.ts`. Use `scenario()` (p1's main phase, both players past
their first turn, empty structures, 1 Illuminati token each) and `give(s, player, cardId, where)`
from `tests/helpers.ts` to set up positions, then drive the game with `applyAction`. Force dice by
setting `s.attack.roll = [a, b]` while the roll window is open. Test the card's main effect and at
least one restriction for every card you encode.
