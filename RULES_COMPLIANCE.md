# Rules compliance

How the engine (`src/engine/`, mostly `game.ts`) follows the rules summary in the **Core Rules** tab of
`data/Elitists_War.xlsx` (rows R001–R050), and where it follows the owner's rulings in the **Research
Needed** tab instead. Last audited against the engine with real card shapes (`geometry.ts`), announced
actions, hand-drawn start-of-turn draws, protected hidden information, Warehouse 23 and computer
difficulty levels.

Status key:

- **Tested**: the engine does it and a test checks it.
- **Untested**: the engine does it, but no test checks it yet.
- **Choice**: the engine follows a deliberate choice or house ruling (see *Deliberate choices*).
- **Gap**: the engine does not do it (see *Known gaps*).

Tests are named as `file › "test name"`. `compliance` is `tests/compliance.test.ts`, `rules` is
`tests/rules.test.ts`, `features` is `tests/engineFeatures.test.ts`, `server` is `tests/server.test.ts`,
`geometry` is `tests/geometry.test.ts`, `data` is `tests/data.test.ts` and `content/…` is a file in
`tests/content/`. Where a rule has several parts, one or two representative tests are named.

## Rule by rule

| Rule | Status | What the engine does | Checked by |
|---|---|---|---|
| R001 Turn sequence | Tested | Each turn runs start-of-turn, main phase and end-of-turn in order. At the start a person is asked to draw a Plot and a Group card (a `draw` prompt; `skipDraw` passes, as the draws are optional); computer players draw automatically. Then one optional automatic takeover, then every Group without a token gets one (not Groups captured this turn, not Groups whose Power was cut to 0, not Groups under a Devastated Place); card-granted extra tokens are added at the same step. In the main phase the player may attack, move, use abilities, play Plots, bring one Resource into play and draw one Group card with the Illuminati's token. Buying Plots is allowed at any time. At the end of the turn every player gets a response window, then Goals are checked and play passes to the next seat. Nobody may target or interfere with a player who has not finished a first turn. | features › "waits for the person to draw from each deck, then carries on", "the draws are optional: skipping keeps the hand as it was", "computer players still draw automatically"; compliance › "the active player draws a Plot and a Group, then gets tokens", "a Group whose Power has been reduced to 0 gets no token at the start of its turn (R001, R026)", "the Illuminati may draw a Group card once per turn for its token (R001)", "first-turn protection: no cards against a player who has not finished a turn (R001)" |
| R002 Automatic takeover | Tested | The start-of-turn takeover is offered only when there is a legal placement, and can be skipped. It may place a Group on any open arrow or put a Resource into play. Separately, once per turn in the main phase, the Illuminati's token puts a Resource from hand into play. | compliance › "the automatic takeover is optional: skipping it keeps the card in hand", "an Illuminati action brings a Resource from hand into play, once per turn (R002, R041)" |
| R003 Attack to Control | Tested | Costs the attacker's token and needs an open arrow on the attacker. Targets a rival's Group or a Group in the attacker's own hand, never an Illuminati. Strength is attacking Power plus aid and bonuses, minus Resistance, the master-alignment bonus, the position bonus and opposition; the leading attacker alone gets +4 per shared and −4 per opposed alignment. Success hangs the target (with its puppets, same layout) on the attacker's arrow; captured cards lose their tokens. A failed takeover of a card from hand is discarded at the end of the turn. | rules › "uses Power minus Resistance, +4 per shared alignment, position and master-alignment bonuses", "a target defending itself doubles its Power, and capture moves it with its puppets"; compliance › "control: +4 per identical alignment, −4 per opposite pair; destroy is the reverse", "an Attack to Control needs an open control arrow; an Attack to Destroy does not", "the Illuminati can never be attacked, and Resources cannot be attacked (R003, R021)" |
| R004 Attack to Destroy | Tested | Needs no open arrow and may target the attacker's own Group. Uses the target's Power (not Resistance, no master bonus); the alignment modifier is reversed. A destroyed Group goes to the destroyed pile with credit to the destroyer; its puppets return to the hand of whoever controlled it; its linked Resources are destroyed and linked Plots discarded. | compliance › "puppets of a destroyed Group return to their controller's hand and the destroyer gets credit", "a player may destroy his own Group, and it gets no position bonus (R004, R006)", "a destroyed Group takes its linked Resources with it (R004, R041)" |
| R005 Attack kinds | Tested | Only two kinds of attack exist, control and destroy, plus Instant attacks launched by cards. There is no neutralize attack; an action asking for any other kind is refused. Cancel effects exist as Plot and ability effects. | compliance › "there is no third kind of attack (R005)" |
| R006 Defense bonuses | Tested | Position: +10 for a direct puppet of the Illuminati, +5 one Group further, 0 beyond; not when you attack your own Group (which also covers an Instant attack launched by the target's owner) and not for a card attacked from hand. Master alignment (control only): +4 per alignment shared with the master, never for Fanatic, nothing for puppets of the Illuminati. A target spending its own token to defend raises its multiplier one step (×2, or the next whole multiplier). Opposing Groups add their Power, or Global Power without a link. | compliance › "position bonus is +10 next to the Illuminati, +5 one Group away, 0 further out", "a target gets +4 per alignment it shares with its master, but never for Fanatic (R006b)", "self-defense raises the multiplier one step, before additions (R006c, R047)" |
| R007 Devastation value | Tested | A Devastated Place counts half its Power, rounded down, when defending against an Attack to Destroy. Relief needs three times its printed Power. | compliance › "a Devastated Place defends with half its Power (rounded down) against an Attack to Destroy (R007, R037)", "Relief needs actions totalling three times the Place's printed Power" |
| R008 Clamped dice | Tested | A roll changed by cards never goes below 2 or above 12. | compliance › "a modified roll is kept within 2 to 12 (R008, R047)" |
| R009 Cancelling | Tested | Inside an attack, Plots and abilities are recorded in play order and can be cancelled (and the cancel cancelled) until the dice settle. A cancelled attacking action ends the attack: aiding and opposing Groups get their tokens back and other players' Plots go back to hand, exposed. Outside attacks, moves, main-phase abilities, Relief, Resource plays, links and the Illuminati's Group draw are announced (the `action` event) so rivals may respond or cancel; costs stay paid, and a cancelled once-per-turn action may be tried again. The attacker may call off an attack until he commits a Plot. | features › "a cancelled action never happens, but its costs stay paid and a once-per-turn action may be retried", "waits for responses when a card can answer, then carries the action out"; compliance › "the attacker may call off an attack before committing a Plot; helpers get tokens back"; content/groups1 › "Nuclear Power Companies cancel the attacking Group's action" |
| R010 Timing | Tested | Effects apply in the order played and a later effect can undo an earlier one. Every player gets a chance to answer before a roll or a resolution; an attack's strength is only fixed once everyone has passed. Plays are checked for legality when made. | rules › "+10 Plots add to the attack, and a cancelled cancel restores them (R010)"; features › "opens no window and happens at once when nobody can respond" |
| R011 Cards over rules | Tested | Card scripts (hooks and ability entries) override the general rules where they disagree. | content/groups0 › "Intellectuals: the Media master cannot be captured" › "forbids an Attack to Control on it, not an Attack to Destroy"; content/groups0 › "Gun Lobby" › "Resistance becomes 10 against Liberal attackers" |
| R012 Public discards | Tested | Each player's discard pile is visible to everyone. | compliance › "a rival sees the cards in another player's discard pile" |
| R013 No dropping | Tested | There is no move that removes a Group from a Power Structure at will; only attacks, moves and card effects change it. | compliance › "a Group in play can never be discarded or dropped (R013, R039)" |
| R014 Secret Groups | Tested | Only Illuminati and Secret Groups may attack, aid against or oppose for a Secret Group, except its own master and puppets, which may defend it and aid it. In any attack by or against a Secret Group, Groups' ability bonuses are ignored; Plots still work, and so do Resources unless linked to a Group that is not Secret. Secret Groups are never exposed (house ruling). | compliance › "only Illuminati or Secret Groups may attack a Secret Group (R014)", "a Resource still works in an attack on a Secret Group, unless it is linked to a non-Secret Group"; content/groups0 › "Junk Mail" › "may attack a Secret Group, with +6 to control it" |
| R015 NWO order | Tested | NWOs sit in three colour slots and apply one at a time; a new NWO of a colour replaces the old one. | compliance › "NWOs: a new one of the same colour replaces the old one (R045)" |
| R016 Winning | Tested | Goals are checked for every live player at the end of each turn, never in round 1. Basic Goal: 12 Groups for 2–3 players, 11 for 4, 10 for 5+, never under 12 with two. Special Goals of the Illuminati and Goal cards in hand also win. At most 3 Groups count double, none more than double; Groups at or under a Devastated Place and temporary +10 bonuses never count. The Goal-card hand limit (normally 1) is enforced at all times. Two factions of one Illuminati cannot share a win. The last player left wins. | compliance › "nobody wins in the first round, even with enough Groups", "a player who meets the Basic Goal wins at the end of a turn after round 1", "no more than three Groups ever count double", "a player may hold only his limit of Goal cards; the excess must go at once", "a Devastated Place and its puppets do not count toward the goal (R037)"; content/plots2 › "Goals" › "Criminal Overlords counts Violent Criminal Groups twice" |
| R017 No early win | Tested | No win in round 1. Victory is checked automatically after the end-of-turn window, so nothing can be played against a Goal card while it is being checked. | compliance › "nobody wins in the first round, even with enough Groups" |
| R018 Early elimination | Tested | A player can be knocked out only once he has finished three turns. | compliance › "nobody is eliminated before finishing a third turn (R018)" |
| R019 Reload cards | Tested | Reload-type Plots cost an Illuminati action and refresh up to 5 Power of Groups (or any single Group), never one captured this turn. | compliance › "Reload costs an Illuminati action and refreshes at most 5 Power of Groups (errata)" |
| R020 Permanent and temporary | Tested | Every change is a modifier with a lifetime (this attack, end of turn, start of the owner's next turn, permanent); expired ones are removed at that moment. Victory is checked before end-of-turn changes expire. | compliance › "\"until end of turn\" changes expire when the turn ends; permanent ones stay (R020)" |
| R021 Resources are not Groups | Tested | Resources live in their own zone beside the structure, cannot be attacked, have their own play, link and uniqueness rules. | compliance › "the Illuminati can never be attacked, and Resources cannot be attacked (R003, R021)", "a second copy of a Unique Resource cannot come into play (R041)" |
| R022 Deals | Choice | Players may talk and agree what they like; the engine binds nobody to a promise. Cards cannot be traded yet (see R040). | not tested |
| R023 Two players | Tested | Goal never below 12; neither player may attack the other until both have had a turn; an automatic takeover costs that turn's Illuminati token. | rules › "two-player: nobody attacks the other before both have had a full turn (R023)"; compliance › "two-player: an automatic takeover costs that turn's Illuminati token (R023)", "the Basic Goal is 12 Groups in a two-player game" |
| R024 Later corrections | Tested | Card data and scripts use the corrected values where a later correction exists (for example Volcano at Power 18). | rules › "Volcano uses Power 18 (errata) and Devastates or destroys a Place" |
| R025 Setup | Tested | 45-card decks split into Plot and Group decks; 3 Plots dealt; each player picks a lead Group (people choose, computers pick the best), identical picks are set aside and picked again; lead placed on the Illuminati; 6 Group cards dealt, then set-aside cards shuffled back; highest 2d6 starts (ties re-roll). Undrawn cards stay hidden from everyone. | compliance › "decks are 45 cards including the Illuminati", "each player starts with a lead Group on the Illuminati, 3 Plots and 6 Groups in hand", "lead Groups are chosen by the players, and duplicate picks are set aside and re-picked (R025)" |
| R026 Action tokens | Tested | Tokens pay for attacks, aid, opposition, abilities and Plot costs. A Group spends at most one token per attack unless it is the target defending itself. A Group whose Power drops to 0 loses its tokens at once and gets none until it recovers. Illuminati tokens also buy Plots, play a Resource and draw a Group card. | compliance › "a Group whose Power drops to 0 loses its tokens at once (R026)", "a captured Group gets no token on the turn it was captured" |
| R027 Plot limit and buying | Tested | Outside his own turn a player may hold 5 Plots (more with some cards), counting exposed ones; any excess must go at once, to the discard pile or back into the Plot deck, even in the middle of someone else's action. The limit also applies to the active player once his turn ends. Buying a Plot costs 1 Illuminati token or tokens from 2 different other Groups, works at any time, and is never announced or cancellable. Rivals see how many hidden Plots each player holds, never which. | compliance › "a player outside his turn must discard down to the limit at once, even mid-turn", "the active player has no limit during his own turn", "excess Plots may go back into the Plot deck instead of the discard pile (R027)", "buying costs 1 Illuminati token or 2 other tokens"; features › "buying a Plot is not an action and is never announced"; server › "starts a game once a friend joins with the invite code, and hides each hand from the other player" |
| R028 Plot lifecycle | Tested | A played Plot stays on the table while it works, then goes to the discard pile; linked Plots and NWOs stay. +10 Plots boost one action or give defense until end of turn, count once, and never count for Goals. Power-raising Plots only raise. (The card set has no Zap, Paralyze or Attribute Freeze cards.) | rules › "+10 Plots add to the attack, and a cancelled cancel restores them (R010)"; content/plots3 › "Charismatic Leader / Citizenship Award" › "raise a Fanatic / Conservative Group to Power 6 using its action" |
| R029 Aid and oppose | Tested | Any Group with a token other than the attacker may help. To control: aid needs a shared alignment; to destroy: an opposed one. Oppose needs a shared alignment or being the target, its master or its puppet. Without that, a Group helps with Global Power (capped at its Power), or not at all if that is 0. Helpers get no alignment modifier. | compliance › "helping a destroy attack takes an opposite alignment, or else uses Global Power (R029)", "a puppet of the target may oppose with its full Power even without a shared alignment (R029)", "Global Power is used when a helper lacks a matching alignment, capped at its Power (R029)" |
| R030 No doubled Plots | Tested | A player may not use two copies of one Plot in the same attack (a cancelled copy does not count); only one agents card per attack. | compliance › "the same Plot cannot be used twice in one attack", "a duplicate in hand adds +10 to the attack; only one agents card per attack (R030, R031)" |
| R031 Hidden agents | Tested | A card in hand that duplicates the attacked Group may be revealed during a normal attack by anyone but that Group's controller: +10 to the attack or 6 to the defense (only defense against a takeover from hand), then it is discarded. Not usable in Instant attacks. | compliance › "a duplicate in hand adds +10 to the attack; only one agents card per attack (R030, R031)", "agents oppose for 6, but never by the attacked Group's own controller (R031)" |
| R032 Privileged attacks | Tested | Privilege comes only from a card or ability and is set when the attack is declared. Then only the attacker and the defender may act (cards that negate Privilege or let a player interfere excepted); anyone may still use roll-changing cards. | compliance › "in a Privileged attack only the attacker and defender take part", "an NWO cannot be played during a Privileged attack (R032, R045)"; content/groups1 › "Moonies and Religious Reich interfere in Privileged attacks" › "Moonies join either side regardless of alignment and end the privilege" |
| R033 Immunity | Tested | Immunities come from card scripts and ability entries: an immune target cannot be attacked or aided against by the named Groups, one way only. Plots are not blocked unless a card says so. | content/groups0 › "I.R.S. and Lawyers" › "a rival with Lawyers is immune"; content/groups1 › "Offshore Banks" › "cannot be destroyed by a Government Group" |
| R034 Instant attacks | Tested | Launched by a card, with the card's Power against the target's Power as it was when the card was played (plus position unless it is the owner's own card). Only abilities that name Instant attacks apply; no Group joins unless a card allows it; the target cannot spend tokens; it cannot be called off; two cannot overlap. | compliance › "the target of an Instant attack cannot spend tokens, and a Disaster costs it a token", "an Instant attack cannot be called off (R034)" |
| R035 Assassinations | Tested | An Instant attack on a Personality; if it succeeds the Personality is marked killed, and only cards that restore killed Personalities bring it back. | compliance › "a successful Assassination kills the Personality (R035)"; content/groups0 › "C.I.A., Clone Arrangers and Joggers" › "C.I.A. turns an attack on a Personality into an Assassination; Clone Arrangers bring it back" |
| R036 Disasters | Tested | An Instant attack on a Place that takes one of its tokens when played (given back if the Disaster is cancelled). Success Devastates the Place, or destroys it when the card's margin is reached. | compliance › "a cancelled Disaster gives back the token it took (R036, R009)"; rules › "Volcano uses Power 18 (errata) and Devastates or destroys a Place" |
| R037 Devastation and Relief | Tested | A Devastated Place and everything below it lose their tokens, get none, and do not count for Goals; Devastating it again does nothing; moving a Group under it strips its tokens. Relief by one player's Groups with Power totalling 3× the printed Power clears it, at any moment that player may act. | compliance › "a Devastated Place and its puppets do not count toward the goal (R037)", "Relief needs actions totalling three times the Place's printed Power"; content/groups2 › "Center for Disease Control" › "sends Relief to a Devastated Place with its action" |
| R038 Moving Groups | Tested | In his own main phase a player moves a Group, with its puppets in the same layout, to an open arrow in his own structure (house ruling), for a token from the Group, its old or new master, or the Illuminati. Puppets that no longer fit are placed elsewhere under the same master or returned to hand. | compliance › "costs one token from the Group, a master, or the Illuminati", "a Group moves with its puppets, and only within its own Power Structure (R038)"; geometry › "moves keep every puppet centred on its master's arrow" |
| R039 No dropping | Tested | Same as R013: nothing lets a player remove his own Group. | compliance › "a Group in play can never be discarded or dropped (R013, R039)" |
| R040 Gifts and trades | Gap | Players cannot give or trade cards, Resources or Groups. | not tested |
| R041 Resources | Tested | Drawn from the Group deck; played by automatic takeover, once per turn for an Illuminati token, or by cards; linked to the Illuminati at first and relinkable to own Groups. They follow a captured Group and are destroyed with a destroyed one. Unique ones allow a single copy, never again once destroyed (unless the card says so); "one per player" limits are honoured. Warehouse 23 holds Resources face down: inactive, unreachable by rivals, and shown to them only as a card back. | compliance › "a captured Group brings its linked Resources along (R041)", "a second copy of a Unique Resource cannot come into play (R041)"; server › "a Resource face down under Warehouse 23 is a card back to rivals only"; content/hiddenInfo › "Warehouse 23" › "a Resource hidden under it is face down: unnamed in the public log and inactive" |
| R042 Links | Tested | In his main phase a player links his Resource to one of his Groups; a link moves at most once per turn; a card's own link restriction and locked links are honoured; linked Plots stay with their Group and are discarded if it is destroyed. | compliance › "a Resource link may be moved only once per turn (R042)"; content/resources › "Cyborg Soldiers" › "cannot link to a non-Violent Group"; content/groups0 › "Evil Geniuses: linked Resources are locked" › "a Resource linked to them cannot be moved" |
| R043 Duplicate Groups | Tested | A Group cannot enter play while a copy is in play or destroyed (unless its card allows several); a copy only discarded may be played. A duplicate of a rival's Group is used as agents. Identical lead picks are re-picked. | compliance › "a Group already in play or destroyed cannot be played again; one merely discarded can (R043)", "lead Groups are chosen by the players, and duplicate picks are set aside and re-picked (R025)" |
| R044 Factions of one Illuminati | Tested | Players may share an Illuminati: +5 to attacks on the other faction's Groups; they cannot share a win (except the Peaceful Special Goal of the Shangri-La kind); knocking out another faction hands you its Resources. | compliance › "+5 to attacks on a Group of another faction of your own Illuminati (R044)", "...unless another faction of the same Illuminati knocked him out: it takes them (R044, R049)" |
| R045 NWOs | Tested | One NWO per colour, the newest replaces the old; they affect everyone, their changes count for Goals, and they cannot be played during an Instant or Privileged attack. | compliance › "NWOs: a new one of the same colour replaces the old one (R045)", "an NWO cannot be played during a Privileged attack (R032, R045)"; content/plots6 › "New World Orders" › "Military-Industrial Complex: Corporate cards are Government too, but not for Goals" |
| R046 Group basics | Tested | Illuminati have four arrows and cannot be attacked. Alignment opposites are built in (two Fanatics are opposites, Criminal has none); gaining one alignment removes its opposite. Cards are real 5×7 rectangles that turn to face their master and may never overlap, so a card lying sideways can close a neighbour's arrow. | compliance › "gaining an alignment removes its opposite (R046)"; geometry › "stands cards on top/bottom arrows upright and lays cards on side arrows sideways", "closes an arrow when a card lying there would overlap another card"; data › "every Group has stats and a legal arrow layout" |
| R047 Calculation order | Tested | Set-to values first, then the single largest multiplier (self-defense one step higher), then additions; Power never below 0. Attack rolls: 2d6, at or under strength wins, 11–12 always fails, strength under 2 fails without a roll. A destroyed Group comes back with printed values. | compliance › "Solidarity does not stack with another multiplier and applies before additions", "a natural 11 or 12 always fails", "strength below 2 fails without a roll" |
| R048 Discards and card access | Tested | Discards go face up to the owner's pile and every card keeps its owner. Draws come from the top of a deck unless a card says otherwise. Discarding at will is not offered (see gaps). | compliance › "a rival sees the cards in another player's discard pile" |
| R049 Elimination | Tested | After his third turn, a player whose Illuminati has no puppets is out at once: his hand and decks leave the game, and his Resources leave play (or pass to a same-Illuminati faction that knocked him out). A player of the destroy-count Illuminati who destroys his own last Group for his winning total is not knocked out and wins at the end of the turn. | compliance › "a player with no Groups after his third turn is eliminated at once (R049)", "an eliminated player's Resources leave play (R049)", "the Servants of Cthulhu destroying their own last Group as the 8th win at the end of the turn instead (R049)" |
| R050 Special card kinds | Tested | Not a rule of its own: Illuminati, NWOs, Goal cards and the Plot families follow their own rows (R016, R028, R044, R045). | see those rows |

Totals: 48 Tested (R050 among them, though it only points to other rows), 0 Untested, 1 Choice (R022),
1 Gap (R040).
Parts of several tested rows are missing; they are listed under *Known gaps*.

## Deliberate choices

House rulings chosen by the owner (Research Needed tab):

- **Turn order** goes by seat order, the order players joined, because the rules name two different
  directions.
- **Secret Groups** have no way to be exposed: they are face up and only have the protections in R014,
  since the rules never say how exposure would work.
- **Moving Groups** only within your own Power Structure, reading "any Group" in the rules as your own.
- **Taking over Resources**: by capturing the Group they are linked to, or by spending an Illuminati
  action to put one from hand into play (the later rules update).
- **Celebrity Spokesman**: the Organization may not have an alignment opposite to one of the
  Personality's (content/plots3 › "Celebrity Spokesman").
- **Corruption**: the Relief just sent is cancelled, the Place stays Devastated, and no Relief may be
  tried there until after the player's next turn (content/plots6 › "Corruption").
- **Weather Satellite**: +10 for Tornado, Hurricane and Rain of Frogs, the −4 option still applies to
  those three, Tidal Wave gets nothing special (content/resources › "Weather Satellite").
- **Other ambiguous cards** use the reading written in each card's Research Notes.

Engine choices, made so the game can be played on screens, in pieces and online:

- **Start-of-turn draws**: people draw each card by hand (and may skip); computer players always draw,
  since a draw never hurts during your own turn.
- **"Any time" plays** (including NWOs) are allowed in your own main phase, in every response window
  and at the end of every turn, but not at an arbitrary moment of a rival's main phase.
- **Announcing**: actions outside attacks are announced only when nothing else is happening; inside
  another window they happen at once. Linking spends no Group's token, so only Plots can answer it.
  Buying Plots is never announced (R027). A window closes when everyone has passed; online, a player who
  does not answer before the deadline passes.
- **Victory** is not declared by hand: every live player who meets a Goal at the end of a turn is a
  declarer. The end-of-turn window before the check is where Plots and abilities can change the outcome.
- **One thing at a time**: the engine handles plays in sequence, so the simultaneous roll-off never
  arises, and every free bonus is applied automatically (nothing is forgotten).
- **+10 Plots on the attacker** are played when the attack is declared, as the card text says.
- **Captures and moves** re-place puppets that no longer fit automatically; any still left over are
  discarded after a capture or returned to hand after a move.
- **Hidden information**: each player's view (`viewFor` in `src/server/service.ts`) hides decks, other
  players' hidden Plots, Plots hidden beneath cards, face-down Warehouse 23 Resources, secret ability
  choices and private log lines.
- **Quick game**: an optional house rule lowers the Basic Goal to 8 Groups.
- **Unanimous agreements on cards**: International Cocaine Smugglers' optional extension of its +4 to
  Personalities that every player agrees on is not offered (the engine has no all-player vote), so only
  its named Groups and their puppets count (content/groups0 › "International Cocaine Smugglers").
- **Bill Clinton's die**: rather than at every single check of his alignments, he rolls at the start of
  each attack (the result holds for that attack) and at the start of each turn (the result holds for
  everything else) (content/groups2 › "Bill Clinton").
- **The I.R.S. tax** is a once-per-turn ability used in its controller's main phase. Under Tax Reform
  the same tax takes the top Plot of every rival's deck; the controller's own deck is never taxed
  (content/plots2 › "New World Orders").
- **Computer difficulty** (Easy, Normal, Hard) only changes how well the computer chooses; every level
  plays by the same rules (tests/aiLevels.test.ts › "Easy, Normal and Hard all play complete, legal games").

## Known gaps

- **Gifts and trades** (R040, R022): no giving or trading of cards in hand or in-play Resources, and no
  handing a Group to another player (the transfer part of R038).
- **Relief from several players at once** (R037): only one player's Groups can pay for a Relief.
- **Spare Illuminati as agents** (R006e, R044): decks never hold extra Illuminati cards, so the +3 agent
  and the "one agent per Illuminati" rules do not exist yet.
- **First-turn protection exception** (R001): a player who attacks someone during his first turn is
  still protected from that player until the turn ends.
- **Discarding or returning Plots at will** (R027, R048): a player can only discard or return Plots
  to the deck when over a hand limit.
- **Warehouse 23 and Unique duplicates** (R041): a Unique Resource hidden face down simply blocks a
  rival's copy; the owner is not asked to reveal it, and the rival never gets to keep his copy in play.
- **Link restrictions** (R042): a Resource that already helped this turn may still have its link moved
  that turn (the once-per-turn limit on moving a link is enforced).
- **Capturing with a duplicate** (R031): when a duplicate card helps capture, the original card moves
  to the capturer; the swap of copies is not modelled.
- **Leaving a game** (R049): a player cannot resign from a started game, so leaving never counts as
  elimination.

## Fixed in this audit

- An eliminated player's Resources stayed in play and kept working; they now leave play, or pass to a
  same-Illuminati faction that knocked him out (R049, R044).
- The destroy-count Illuminati destroying its own last Group for its winning total was knocked out
  before the end-of-turn check; it now wins at the end of the turn (R049).
- In attacks by or against a Secret Group, Resources and linked Plots were ignored along with Group
  abilities; they now apply, except Resources linked to a non-Secret Group (R014).
- An attack of any kind other than control or destroy is now refused instead of being treated as a
  destroy attack (R005).
- Card fixes (Groups and Resources): Count Dracula and the Magic Artifacts linked to him can never come
  back once he is destroyed; Antiwar Activists' extra Resistance no longer counts against Attacks to
  Destroy; Rogue Boomer's one-shot +10 against a Place is for its holder's own attacks only; Ronald
  Reagan is immune to Media Groups even while in a hand; Elders of Zion's reorganization ends at the
  player's next step other than a move; Tax Reform no longer taxes automatically or the I.R.S.'s own
  controller.
