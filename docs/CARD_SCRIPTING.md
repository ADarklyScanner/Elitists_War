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
- `forbidPuppet(s, self, group, master, player)` refuses a master for a Group however it would get there
  (automatic takeover, capture, move, a card): `puppetForbidden()` / `puppetSides()` in game.ts read it, so a
  card placing a Group itself should ask `puppetSides(s, player, group, master)` for the sides it may use.
- `rulesOffTable: true` keeps a card's own `forbidAttack` / `forbidPuppet` working while it waits in a hand or
  the uncontrolled area (Citizens for Normalcy, NHGH). `forbidIsImmunity: true` says its `forbidAttack` only
  expresses immunity or "cannot be controlled / destroyed", which Schizm (`overridesImmunity`) sets aside.
- `replaceAttackResult(s, self, ctx)` deals with the target of a successful attack instead of the usual result
  (Schizm, the "Bobbies"); `onDiceRolled(s, self, ctx)` runs the moment an attack's dice are first rolled.
- `onTokensPlaced(s, self, activePlayer)` runs for every active card right after the active player's tokens are
  placed; `extraGroupDraws` adds start-of-turn Group draws; `globalEqualsPower` makes Global Power equal to
  Power (`'current'`) or Permanent Power (`'permanent'`, `power(s, iid, { permanent: true })`).
- `neverDestroyed` / `cannotMove` (static): destroyGroup leaves the card alone and its controller may not move it.
- A card that ends the turn outside an attack or Plot window calls `endTurnAtOnce(s)`.
- A question asked during the start-of-turn draws (`askChoice` in `onDraw`) is answered before the
  automatic takeover prompt.
- `lastWord: true` runs the card's `alignmentMod` / `attributeMod` after every other card's ("takes
  precedence over any other card": Orgone Grinder, Alien Abduction).
- `baseAlignments(s, iid)` (static, read wherever the card is) replaces its printed alignments (Dittoheads).
- `resistanceMul` multiplies a card's Resistance (the largest multiplier applies, R047).
- `losesTokens` makes a card lose the tokens it holds at once, after every action (Antitrust Legislation);
  `noTokens` only stops new ones.
- `masterRule(s, iid, master)` (static, on the card being placed) says why `master` may not take it as a
  puppet: checked for automatic takeovers, captures and moves. `anySideOnMove` extends `anySideMaster` to moves.
- `neverAgents` (static): the card is never an agents card. `onAgents` runs when an agents card is played.
- `fanaticSameAsMaster` (static): its Fanatic alignment is the same as its master's (they share it).
- `takeoverPermission(s, self, card, player)`: the automatic takeover of `card` needs this card's
  controller's permission; the engine asks him (`takeoverPermission` choice) and remembers a refusal for the turn.
- `keepsLinkedPlots` (static): Plots linked to the Group are set aside, not discarded, when it is destroyed
  (they carry `data.keptFor`); the card's own `delayedRevive` puts them back (General Disorder).
- `beforeAction(s, self)` runs at the start of every action, for a card whose rules read the outside world;
  it records what it read in the state (Australia reads `localTime(s, player)`, from `localClock.now()`,
  which tests replace). Players may carry `utcOffset` (minutes east of UTC), reported by the interface.
- `onTokensPlaced` runs right after the active player's Action tokens are placed. Before they are, a
  `tokenPlacement` event is raised (its window opens only if someone holds a Plot answering it).
- An activated ability may list its own ways of being used with `options(s, pl, self)` (several cards to
  pick, pairs, decks): `abilityOptions` offers each one that its `check` accepts.
- Cards discarded from a hand or a deck to pay for a Plot or a special ability are announced with
  `noteCostDiscard(s, payer, [{ kind, place, cards }])` (Go, Lemmings, Go! answers the `costDiscard` event).
- `shieldFromGoFish(s, player)` / `goFishShielded(s, player)`: a player who received a Plot from a rival, or
  was forced to show one, is immune to Go Fish until the end of his next turn. `revealTo` (unless told the
  showing was voluntary) and `exposeCards` (unless `{ voluntary: true }`) record it themselves.
- A card whose `data.copyOf` is set is a Copy Shops copy: it leaves the game instead of reaching a discard
  pile or a hand. A copied Goal is declared with `declareCopiedGoal` (claim id `copy:<card id>`).
- `startAttack(..., { strip, stripAlignment })` makes the Drug Companies' attack (no arrow, no capture);
  `{ partitionOf }` lets a duplicate of a Place in play be attacked from hand (Partition).

Modifiers `{kind:'addAttr'|'removeAttr', attr}` and `{kind:'addArrow', side}` change attributes and arrows
while the card is in play.

## Tests

Put tests in `tests/content/<file>.test.ts`. Use `scenario()` (p1's main phase, both players past
their first turn, empty structures, 1 Illuminati token each) and `give(s, player, cardId, where)`
from `tests/helpers.ts` to set up positions, then drive the game with `applyAction`. Force dice by
setting `s.attack.roll = [a, b]` while the roll window is open. Test the card's main effect and at
least one restriction for every card you encode.

## Expansions (Assassins, SubGenius)

The rules decisions behind everything below are in `docs/EXPANSIONS.md`. The rules themselves are
already in the engine and tested in `tests/expansions.test.ts`; a card script only picks options.

### Where things live

- **Card data**: `src/data/expansions/assassins.json` (125 cards) and `subgenius.json` (97). Same
  schema as `src/data/cards.json`, plus `set` (`'Assassins' | 'SubGenius'`; base cards have none, read
  it with `cardSet(def)`), `keywords` (printed Plot keywords: `Zap`, `Freeze`, `Paralysis`, `Disaster`,
  `Assassination`, `Instant`, `Special`), `nwoColor` on NWOs and `playRequirement` (the printed
  requirement line, as a hint). Gadget/Artifact and Unique live in `uniqueness`, as for base Resources.
  Ids are slugs of the names; no expansion card collides with a base id (a collision would get a
  `-assassins` / `-subgenius` suffix).
- **Scripts**: `src/engine/content/assassins.ts` and `src/engine/content/subgenius.ts`. When a file
  grows, add `assassins2.ts`, `subgenius2.ts`, … and import them in `src/engine/index.ts` right after the
  existing expansion imports. Use the same three mechanisms as base cards (abilities, hooks, Plot
  handlers). The Church of the SubGenius is already encoded (it carries the Slack rule).
- **Families** (`src/engine/content/families.ts`, also exported from the engine index):
  `assassinationPlot`, `zapPlot` / `registerZap`, `paralysisPlot`, `freezePlot`.
- **Tests**: `tests/content/assassins*.test.ts` and `tests/content/subgenius*.test.ts`, written like
  the other content tests (`scenario()`, `give()`, `applyAction`). `scenario()` is a base game; the
  engine plays any card you `give()` whatever the game's settings say, so no pack switch is needed.
  For the stand-alone SubGenius game build one with
  `createGame({ seed, players, settings: { subgeniusRules: true } })` (see the SubGenius tests in
  `tests/expansions.test.ts`).

### Marking a card implemented, and switching a pack on

`cardImplemented(id)` (`src/engine/expansions.ts`) decides: Groups and Illuminati need an ability entry
with no `pending` part (`registerAbilities`, even `[]` for a vanilla Group plus hooks); Resources need
hooks (`registerHooks`, `{}` is enough for a Resource with no effect); Goal cards need `registerGoals`;
other Plots and NWOs need `registerPlots`. If a Resource or Plot is only partly done, call
`markPending(id, 'what is missing')`. `tests/expansions.test.ts › pack implementation progress` prints
`implemented/total` for each pack. When a pack reaches 100%, set its flag in `EXPANSIONS_READY`
(`src/engine/expansions.ts`): the test then insists on 100%, and the interface starts offering the pack
(new-game page, offline and online). Until then random decks leave unimplemented expansion cards out.

### "Requires ... Action": declare the cost, the engine pays it

Give the Plot handler a `requires` (`src/engine/costs.ts`) instead of paying in `apply`:

```ts
import { anyOf, illuminatiAction, groupActions, targetAction, plotDiscards, targetResistance } from '../costs';
'yacatisma': { timing: ['anytime'], requires: anyOf(groupActions({ attributes: ['SubGenius'] })), … }
'comet-hail-bob': { requires: anyOf(illuminatiAction(), groupActions({ attributes: ['Church'] }, { count: 2 })), … }
'13013': { requires: anyOf(targetAction()), … }                 // "counts as the action of the Group it affects"
'tape-runs-out': { requires: anyOf(illuminatiAction(), plotDiscards(3)), … }
'whistle-blowers' (a Paralysis): groupActions({ alignments: ['Corporate'] }, { power: targetResistance })
```

The player names the payers in `play.payWith` (Groups spending an action) or `play.discards` (Plots from
hand). `checkPlot` refuses a play that does not pay exactly one alternative, `playPlot` spends the
tokens and discards the cards before `apply` runs, and `plotOptions` / the computer players offer one
play per affordable alternative (`costPlays`). A token held back by a Paralysis or Freeze cannot pay.
Illuminati tokens are "Slack" on the Church of the SubGenius: an Illuminati action spends one of them.

### Zaps

```ts
registerZap('brushfire-war', { noTakeover: { alignments: ['Peaceful'] } });
registerZap('a-brief-attack-of-conscience', { noInstants: true });
registerZap('fickle-finger-of-fate', {
  canTarget: (s) => (s.players.filter((p) => !p.eliminated).length === 2 ? 'Not in a two-player game.' : null),
  hooks: { forbidAttack: (s, self, _a, _t, type, pl) => (type === 'takeover' && pl === zappedPlayer(s, self) ? 'No automatic takeovers.' : null), … },
});
```

`zapPlot` gives the Plot (played on a rival's Illuminati, `needs.target: 'rival'`, an Illuminati action,
never in a Privileged attack, `condition: 'zap'`) and hooks that restrict the victim's whole Power
Structure. `noTakeover` covers Attacks to Control and automatic takeovers (the `'takeover'` type of
`forbidAttack`, which the Resource play also consults, so a "no Resources" Zap is
`forbidAttack(…, type === 'takeover' && def(s, target).type === 'Resource')`). Extra hooks receive
`self` = the Zap card; `zappedPlayer(s, self)` is its victim. Useful hook points: `beforeDraw` may return
`'plotInstead'` (Back to the Drawing Board), `noProximityBonus` (Sorry, Wrong Number), `onDraw`
(Security Leak), `forbidUse`. Played during an attack a Zap links at once, so an attack it forbids
becomes illegal and is cancelled. Removal is an engine action: `{type: 'removeZaps', player}` (any
player, one Illuminati action, any time except during an Instant attack); `zapsOn(s, player)` lists
them; `clearConditions(s, player)` removes Zaps, Paralysis and Freezes (Enough is Enough).
Reverse Whammy redirects a Zap by changing its `linkedTo` to the Zapper's Illuminati.

### Paralysis

```ts
registerPlots({ 'cat-juggling': paralysisPlot({ on: { alignments: ['Peaceful'] }, pay: { alignments: ['Violent'] } }) });
```

The Plot links to a Group (in a Power Structure or in the uncontrolled area). While linked, the engine
holds back the Group's tokens (`heldTokens`), switches off its abilities, hooks and linked Resources,
lets it get no new puppets and leaves it out of Goal counts (`goalCount`, Special Goals). It is
discarded as soon as the Group no longer matches `on` (its `linkLegal`), or when someone frees it
with `{type: 'freeGroup', group, payWith}` (its master, paid by its controller, or the payer's own
Illuminati; at any time, victory claims included). `isParalyzed(s, g)` and `paralysesOn(s, g)` read it.
Goal cards that count Groups themselves must skip `isParalyzed` Groups.

### Freezes

```ts
registerPlots({ 'junk-bonds': freezePlot({ match: { attributes: ['Bank'] }, label: 'Bank' }) });
registerPlots({ 'hubble-trouble': freezePlot({ match: { attributes: ['Space', 'Science'] }, resources: ['killer-satellite', 'power-satellite', 'spy-satellite', 'orbital-mind-control-lasers'], label: 'Space and Science',
  pay: [illuminatiAction(), groupActions({ attributes: ['Space', 'Science'] })] }) });
registerPlots({ 'school-prayer': freezePlot({ match: [{ attributes: ['Church'] }, { alignments: ['Liberal', 'Conservative'] }],
  cancel: { attributes: ['Church'] }, label: 'Church, Liberal and Conservative' }) });
```

Mode `'freeze'` (no target) puts `s.freezes` in effect until the end of the turn: matching Groups (and
listed Resources) hold their tokens back and may spend them only to defend themselves (`canOppose`
allows the held token for self-defense). Mode `'cancel'` with `play.target` = a matching Group that is
acting right now (attacking, aiding, opposing, or an announced action) cancels that action. `match`
and `cancel` may be a list of Matches (any of them); a single Match with both `attributes` and
`alignments` needs both. The default cost is an Illuminati action or an action of a matching Group.
`frozen(s, iid)` reads it; `addFreeze(s, {...})` starts one from any script.

### Assassinations, Disasters, killed Personalities

- `assassinationPlot({ power: 10 | (s, target) => n, helper?: Match | Match[] })` (the base game's
  Assassinations use it too). A successful Assassination marks the Personality `killed`.
- `killPersonality(s, iid, by)` destroys and marks killed; `isKilled(s, iid)`. The rules treat "killed"
  and "assassinated" as the same thing.
- Disasters: `startInstantAttack` / `startCardAttack` as for base cards. Who may help against them is
  the Plot handler's `joinRule(s, ctx, group, 'aid' | 'oppose')` (true = may join whatever its
  alignments, even an Instant attack; false = may not; undefined = normal rules) and
  `joinMultiplier(s, ctx, group)` (the Center for Disease Control's triple Power).
- Truck Bomb, General Disorder and similar cards change attacks through the usual `attackMod`,
  `beforeAttackResult` and `ctx` fields.

### SubGenius: Slack, the uncontrolled area, links

- **Slack** is the Church's Action tokens: `{ kind: 'slack' }` keeps them from turn to turn;
  `{ kind: 'specialGoal', goal: 'slack', value: 3 }` counts up to 3 toward the Basic Goal
  (`slackCount(s, player)`). Cards that give or take Slack just change the Illuminati's `tokens`.
- **The uncontrolled area** exists only in the stand-alone game (`s.common`, `sgRules(s)`):
  `uncontrolledCards(s)`; `putUncontrolled(s, iid, by)` puts a card there (in a standard game it goes to
  that player's hand instead, as the official rulings say for SubGenius cards in standard INWO). The
  shared decks: `plotDeckOf(s, player)` / `groupDeckOf(s, player)` (always use these instead of
  `player.plotDeck` in new code). Cards in the area have zone `'uncontrolled'`, no controller, and
  `placedBy` / `placedTurn`. Attacks may target them (`ctx.fromArea`); a Resource there is taken with
  the normal `playResource` action. A card that says "from your hand or the uncontrolled area" should
  accept both zones; one that says "in standard INWO, instead …" should branch on `sgRules(s)`.
- **Links**: a linked Plot's `linkLegal(s, plot, group)` returns `'inactive'` while the link is
  temporarily illegal (no effect, may not move) or `'discard'` once it is illegal for good (13013 when the
  Group stops being SubGenius for good). Linked Plots stay with their Group when it changes hands or goes
  to the uncontrolled area. A link is re-checked after every action (`syncConditions`).
- **The SubGenius attribute** is plain card data: match it with `{ attributes: ['SubGenius'] }`.
- **Die rolls outside attacks**: roll with `cardRoll(s, player, 1 | 2, key, data)` and handle the result in
  `registerRollResult({ key(s, player, total, dice, data) {…} })`. The roll is announced as a `dieRoll` event,
  which the cards changing "any die roll" answer (Bulldada, Luck Plane, S.C.A.M., Shordurpersav with timing
  `'event'` and `events: ['dieRoll']`; the Janor Device's ability); they read and change it with
  `eventAnswered(s)`, `rollOf(e)` and `changeRoll(e, …)`. With nobody able to answer, or during an attack (no
  window can wait there), the handler runs at once. `afterCardRoll` hooks see the final roll.
- **Control taken outside the automatic takeover**: a successful Attack to Control on a Group in a hand or the
  uncontrolled area, or a card putting one into play, raises a `gainedControl` event (Comet Hail-"Bob").
- **Forced plays**: `s.forcedPlay = { player, card }` lets that Plot be played at once whatever its usual
  moment (Sacred Jests); `plotOptions` then lists every complete legal way to play it.
- **Illuminati spending**: `turnFlags.illuminatiSpent` lists players whose Illuminati spent a token this turn
  on anything but buying Plots, and `turnFlags.illuminatiLocked` refuses such spending (Time Control).
