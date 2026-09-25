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

**Choices.** When a card has to ask someone to choose, call
`askChoice(s, player, {key, question, options:[{id,label}], min, max, data})` and register
`registerChoice(key, {resolve(s, player, picked, data), ai?})`. The answer arrives as the action
`{type:'choose', ids}`. Choices queue up behind any prompt that is already open. `viewFor` hides the options from other players.

**Private information.** `revealTo(s, player, cards, why)` lets one player see cards, such as a rival's hand.
Those cards stay visible to that player in their online view, and the log line goes only to them.
- Never set `exposed = true` directly: call `exposeCards(s, cards)`, which skips Plots that cannot be exposed
  (`preventExpose`: a Plot hidden beneath Texas or Fidel Castro) and returns the cards it did expose. Log
  only those names. `exposableHand(s, player, 'Plot')` lists the hidden cards other cards may expose,
  look at or take; `canExpose(s, iid)` checks one card.
- An activated ability with `secret: true` (naming a card in secret, like the Holy Grail) logs its target
  only to its user. A target that is still hidden in a hand or deck is never named publicly either.
- A Resource with `hiddenUnder` set is face down under that card (Warehouse 23): its hooks and abilities
  are off, rivals' cards cannot target it, and rivals' online view shows a card back.
- `viewFor` masks `note` for everyone except the card's controller (its owner once it is out of play).

**Magic attacks.** A card's `magicAttack(s, self, ctx)` hook makes the whole attack Magic (the Spear of
Longinus, even for a Disaster with no attacking Group). Code that asks "is this attack Magic?" should
also check `magicByCard(s, ctx)`.

**Resources as Disaster targets.** `disasterTargetPower: n` lets Disasters strike a Resource in play,
which defends as a Place of Power `n` and is never Devastated (Hidden City). Disaster Plots validate
their target with `disasterTarget(s, iid)`.

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
