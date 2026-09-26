# Rules compliance

How the engine (`src/engine/`, mostly `game.ts`) follows the rules summary in the **Core Rules** tab of
`data/Elitists_War.xlsx` (rows R001–R050), and where it follows the owner's rulings in the **Research
Needed** tab instead. Last audited against the engine with real card shapes (`geometry.ts`), announced
actions, hand-drawn start-of-turn draws, protected hidden information, Warehouse 23 and computer
difficulty levels, and again after closing the last known gaps (joint Relief, spare Illuminati agents,
the first-turn exception, the Warehouse 23 showdown, used Resources, duplicate captures, leaving a
game, the lead Group's arrow, rearranging new puppets and the agreed Basic Goal).

Status key:

- **Tested**: the engine does it and a test checks it.
- **Untested**: the engine does it, but no test checks it yet.
- **Choice**: the engine follows a deliberate choice or house ruling (see *Deliberate choices*).
- **Gap**: the engine does not do it (see *Known gaps*).

Tests are named as `file › "test name"`. `compliance` is `tests/compliance.test.ts`, `rules` is
`tests/rules.test.ts`, `features` is `tests/engineFeatures.test.ts`, `server` is `tests/server.test.ts`,
`geometry` is `tests/geometry.test.ts`, `victory` is `tests/victory.test.ts`, `data` is `tests/data.test.ts`, `gaps` is `tests/rulesGaps.test.ts`, `deals` is
`tests/deals.test.ts`, `dealsAi` is `tests/dealsAi.test.ts`, `illegalMidAttack` is `tests/illegalMidAttack.test.ts` and `content/…` is a file in `tests/content/`. Where a rule has several parts, one or two representative tests are named.

## Rule by rule

| Rule | Status | What the engine does | Checked by |
|---|---|---|---|
| R001 Turn sequence | Tested | Each turn runs start-of-turn, main phase and end-of-turn in order. At the start a person is asked to draw a Plot and a Group card (a `draw` prompt; `skipDraw` passes, as the draws are optional); computer players draw automatically. Then one optional automatic takeover, then every Group without a token gets one (not Groups captured this turn, not Groups whose Power was cut to 0, not Groups under a Devastated Place); card-granted extra tokens are added at the same step. In the main phase the player may attack, move, use abilities, play Plots, bring one Resource into play and draw one Group card with the Illuminati's token. Buying Plots is allowed at any time. At the end of the turn the player knocks (`endTurn`, or `declareVictory` to knock and claim a win at once); every player then gets a response window, in which victories may be declared and answered (R016), and play passes to the next seat. Nobody may target or interfere with a player who has not finished a first turn, except that a player he attacks during that first turn (any attack aimed at one of that player's Groups, Instant attacks included) may answer him with anything he can, from then on. | gaps › "a player attacked by someone in his first turn may answer that player, and only him", "an attack made in the first turn lifts the protection for the target's player"; features › "waits for the person to draw from each deck, then carries on", "the draws are optional: skipping keeps the hand as it was", "computer players still draw automatically"; compliance › "the active player draws a Plot and a Group, then gets tokens", "a Group whose Power has been reduced to 0 gets no token at the start of its turn (R001, R026)", "the Illuminati may draw a Group card once per turn for its token (R001)", "first-turn protection: no cards against a player who has not finished a turn (R001)" |
| R002 Automatic takeover | Tested | The start-of-turn takeover is offered only when there is a legal placement, and can be skipped. It may place a Group on any open arrow or put a Resource into play. Separately, once per turn in the main phase, the Illuminati's token puts a Resource from hand into play. | compliance › "the automatic takeover is optional: skipping it keeps the card in hand", "an Illuminati action brings a Resource from hand into play, once per turn (R002, R041)" |
| R003 Attack to Control | Tested | Costs the attacker's token and needs an open arrow on the attacker. Targets a rival's Group or a Group in the attacker's own hand, never an Illuminati. Strength is attacking Power plus aid and bonuses, minus Resistance, the master-alignment bonus, the position bonus and opposition; the leading attacker alone gets +4 per shared and −4 per opposed alignment. Success hangs the target (with its puppets, same layout) on the attacker's arrow; captured cards lose their tokens. A failed takeover of a card from hand may be retried; it is discarded when the player ends the turn, before the end-of-turn window. | rules › "uses Power minus Resistance, +4 per shared alignment, position and master-alignment bonuses", "a target defending itself doubles its Power, and capture moves it with its puppets"; compliance › "control: +4 per identical alignment, −4 per opposite pair; destroy is the reverse", "an Attack to Control needs an open control arrow; an Attack to Destroy does not", "the Illuminati can never be attacked, and Resources cannot be attacked (R003, R021)" |
| R004 Attack to Destroy | Tested | Needs no open arrow and may target the attacker's own Group. Uses the target's Power (not Resistance, no master bonus); the alignment modifier is reversed. A destroyed Group goes to the destroyed pile with credit to the destroyer; its puppets return to the hand of whoever controlled it; its linked Resources are destroyed and linked Plots discarded. | compliance › "puppets of a destroyed Group return to their controller's hand and the destroyer gets credit", "a player may destroy his own Group, and it gets no position bonus (R004, R006)", "a destroyed Group takes its linked Resources with it (R004, R041)" |
| R005 Attack kinds | Tested | Only two kinds of attack exist, control and destroy, plus Instant attacks launched by cards. There is no neutralize attack; an action asking for any other kind is refused. Cancel effects exist as Plot and ability effects. | compliance › "there is no third kind of attack (R005)" |
| R006 Defense bonuses | Tested | Position: +10 for a direct puppet of the Illuminati, +5 one Group further, 0 beyond; not when you attack your own Group (which also covers an Instant attack launched by the target's owner) and not for a card attacked from hand. Master alignment (control only): +4 per alignment shared with the master, never for Fanatic, nothing for puppets of the Illuminati. A target spending its own token to defend raises its multiplier one step (×2, or the next whole multiplier). Opposing Groups add their Power, or Global Power without a link. | compliance › "position bonus is +10 next to the Illuminati, +5 one Group away, 0 further out", "a target gets +4 per alignment it shares with its master, but never for Fanatic (R006b)", "self-defense raises the multiplier one step, before additions (R006c, R047)" |
| R007 Devastation value | Tested | A Devastated Place counts half its Power, rounded down, when defending against an Attack to Destroy. Relief needs three times its printed Power. | compliance › "a Devastated Place defends with half its Power (rounded down) against an Attack to Destroy (R007, R037)", "Relief needs actions totalling three times the Place's printed Power" |
| R008 Clamped dice | Tested | A roll changed by cards never goes below 2 or above 12. | compliance › "a modified roll is kept within 2 to 12 (R008, R047)" |
| R009 Cancelling | Tested | Inside an attack, Plots and abilities are recorded in play order and can be cancelled (and the cancel cancelled) until the dice settle. A cancelled (or illegal, see R010) attacking action ends the attack: the attacker's token stays spent and its Plots for the attacking Group are discarded; aiding and opposing Groups get their tokens back, Plots used for them go back to hand, exposed, and agents go back to their owner's hand. Outside attacks, moves, main-phase abilities, Relief, Resource plays, links and the Illuminati's Group draw are announced (the `action` event) so rivals may respond or cancel; costs stay paid, and a cancelled once-per-turn action may be tried again. The attacker may call off an attack until he commits: a Plot, an agents card, a token of one of his own Groups spent aiding or opposing, or a token he removes from one of his cards during the attack. | gaps › "a player may take a token off his own card; during his attack that commits it", "spending another Group's token to aid your own attack commits it too"; features › "a cancelled action never happens, but its costs stay paid and a once-per-turn action may be retried", "waits for responses when a card can answer, then carries the action out"; compliance › "the attacker may call off an attack before committing a Plot; helpers get tokens back"; content/groups1 › "Nuclear Power Companies cancel the attacking Group's action" |
| R010 Timing | Tested | Effects apply in the order played and a later effect can undo an earlier one. Every player gets a chance to answer before a roll or a resolution; an attack's strength is only fixed once everyone has passed. Plays are checked for legality when made, and during an attack everything is checked again after each play or ability and just before the roll and the result ("Cancellations, Illegal Actions, & Other Surprises"): an attacking action made illegal (a new immunity, a changed alignment, a card that now forbids it) does not happen, like a cancelled one, unless a later play makes it legal again before the roll; an aiding or opposing Group the target has become immune to stops counting and the attack goes on; a Plot whose requirement no longer holds (a Violent attacker made Peaceful loses its Terrorist Nuke) returns to its owner's hand, exposed, with its costs spent. An Instant attack whose target becomes immune to its card returns that card to hand, exposed. | rules › "+10 Plots add to the attack, and a cancelled cancel restores them (R010)"; features › "opens no window and happens at once when nobody can respond"; illegalMidAttack › "a Violent attacker made Peaceful loses its Terrorist Nuke: it returns to hand, exposed, and the attack goes on", "a new immunity stops the attack: token spent, Nuke discarded, aider refunded, its Benefit Concert back exposed (Vatican City example)", "an attack made illegal becomes legal again if a later play undoes the change before the roll", "is checked again before the attack resolves, not only when a play is made", "an aiding Group the target becomes immune to stops counting, and the attack goes on" |
| R011 Cards over rules | Tested | Card scripts (hooks and ability entries) override the general rules where they disagree. | content/groups0 › "Intellectuals: the Media master cannot be captured" › "forbids an Attack to Control on it, not an Attack to Destroy"; content/groups0 › "Gun Lobby" › "Resistance becomes 10 against Liberal attackers" |
| R012 Public discards | Tested | Each player's discard pile, and his destroyed pile, is visible to everyone and browsable card by card, not only its top card. | compliance › "a rival sees the cards in another player's discard pile" |
| R013 No dropping | Tested | There is no move that removes a Group from a Power Structure at will; only attacks, moves and card effects change it. | compliance › "a Group in play can never be discarded or dropped (R013, R039)" |
| R014 Secret Groups | Tested | Only Illuminati and Secret Groups may attack, aid against or oppose for a Secret Group, except its own master and puppets, which may defend it and aid it. In any attack by or against a Secret Group, Groups' ability bonuses are ignored; Plots still work, and so do Resources unless linked to a Group that is not Secret. Secret Groups are never exposed (house ruling). | compliance › "only Illuminati or Secret Groups may attack a Secret Group (R014)", "a Resource still works in an attack on a Secret Group, unless it is linked to a non-Secret Group"; content/groups0 › "Junk Mail" › "may attack a Secret Group, with +6 to control it" |
| R015 NWO order | Tested | NWOs sit in three colour slots and apply one at a time; a new NWO of a colour replaces the old one. | compliance › "NWOs: a new one of the same colour replaces the old one (R045)" |
| R016 Winning | Tested | Nobody wins without declaring. After the knock, any live player who meets a Goal may declare victory (`declareVictory` naming the Goal: `basic`, `special`, or a Goal card in hand); the knocker may declare as he knocks. Every other player then gets a response window in which Plots and abilities, including Instant attacks, may be used to stop or secure the claim; any play reopens the window. When everyone has passed, each claim wins if its declared Goal is still met. Claims that hold share the victory; factions of one Illuminati cannot share (neither wins, but a third claimant who holds still does), except Shangri-La players who all hold with the Peaceful Special Goal. A Goal card is shown (exposed) when declared, cannot be taken or affected while the claim is decided, and stays exposed in hand if the claim fails. A winner shows all his Plots, and holding too many Goal cards would put him out. Basic Goal: 12 Groups for 2–3 players, 11 for 4, 10 for 5+, or another number the players agree on before the game (a setting on the start screens, default the book's number), never under 12 with two. At most 3 Groups count double, none more than double; Groups at or under a Devastated Place and temporary +10 bonuses never count. The Goal-card hand limit (normally 1) is enforced at all times. Eliminating every rival wins at once, with no declaration. | gaps › "a Basic Goal agreed before the game is used; with two players it never goes below 12"; victory › "declaring as you knock ends your turn; the claim wins when every rival passes", "a rival stops the claim with an Instant attack (a Disaster Plot): the turn then ends normally", "a rival stops the claim with an Assassination", "a failed claim with a Goal card leaves the card in hand, exposed", "a shown Goal card cannot be taken or affected while the claim is being decided", "special goals: the Illuminati's own Special Goal can be declared", "two players who both declare and are not stopped share the victory", "factions of the same Illuminati cannot share: neither wins, but a third claimant still does"; compliance › "a player who meets the Basic Goal and declares it wins at the end of a turn after round 1", "meeting a Goal without declaring it wins nothing (R016)", "no more than three Groups ever count double", "a player may hold only his limit of Goal cards; the excess must go at once", "a Devastated Place and its puppets do not count toward the goal (R037)"; content/plots2 › "Goals" › "Criminal Overlords counts Violent Criminal Groups twice" |
| R017 No early win | Tested | No declaration in round 1: the first chance is at the end of the first player's second turn. No declaration at the end of a turn a card ended at once (Power Grab). | victory › "nobody can declare in the first round, even with enough Groups", "the first chance is at the end of the first player's second turn (round 2)", "a turn cut short by a card cannot end in a victory"; compliance › "nobody wins in the first round, even with enough Groups" |
| R018 Early elimination | Tested | A player can be knocked out only once he has finished three turns. | compliance › "nobody is eliminated before finishing a third turn (R018)" |
| R019 Reload cards | Tested | Reload-type Plots cost an Illuminati action and refresh up to 5 Power of Groups (or any single Group), never one captured this turn. | compliance › "Reload costs an Illuminati action and refreshes at most 5 Power of Groups (errata)" |
| R020 Permanent and temporary | Tested | Every change is a modifier with a lifetime (this attack, end of turn, start of the owner's next turn, permanent); expired ones are removed at that moment. Claims are decided before end-of-turn changes expire, so a temporary change helps only a claim made while it lasts, at the close of that same turn. | compliance › "\"until end of turn\" changes expire when the turn ends; permanent ones stay (R020)" |
| R021 Resources are not Groups | Tested | Resources live in their own zone beside the structure, cannot be attacked, have their own play, link and uniqueness rules. | compliance › "the Illuminati can never be attacked, and Resources cannot be attacked (R003, R021)", "a second copy of a Unique Resource cannot come into play (R041)" |
| R022 Deals | Tested | A player offers another a deal (what he gives, what he asks for, and an optional promise). Offers are private to the two players and never hold up the game. On acceptance the exchange happens at once and is binding; the promise is only shown, never enforced. I Lied lets a player keep his side of a deal just agreed. | deals › "a promise about the future is shown but never enforced", "a trade swaps cards at once, as one step: if either part is no longer possible nothing changes"; deals › "I Lied" › "accepting with I Lied: you receive the other side at once and keep your own" |
| R023 Two players | Tested | Goal never below 12; neither player may attack the other until both have had a turn; an automatic takeover costs that turn's Illuminati token. | rules › "two-player: nobody attacks the other before both have had a full turn (R023)"; compliance › "two-player: an automatic takeover costs that turn's Illuminati token (R023)", "the Basic Goal is 12 Groups in a two-player game" |
| R024 Later corrections | Tested | Card data and scripts use the corrected values where a later correction exists (for example Volcano at Power 18). | rules › "Volcano uses Power 18 (errata) and Devastates or destroys a Place" |
| R025 Setup | Tested | 45-card decks split into Plot and Group decks; 3 Plots dealt; each player picks a lead Group (people choose, computers pick the best) and the Illuminati arrow it goes on (bottom by default), identical picks are set aside and picked again; lead placed on the chosen arrow; a Plot deck may hold a spare Illuminati card (R044); 6 Group cards dealt, then set-aside cards shuffled back; highest 2d6 starts (ties re-roll). Undrawn cards stay hidden from everyone. | gaps › "each player chooses which Illuminati arrow his lead hangs from"; compliance › "decks are 45 cards including the Illuminati", "each player starts with a lead Group on the Illuminati, 3 Plots and 6 Groups in hand", "lead Groups are chosen by the players, and duplicate picks are set aside and re-picked (R025)" |
| R026 Action tokens | Tested | Tokens pay for attacks, aid, opposition, abilities and Plot costs. A Group spends at most one token per attack unless it is the target defending itself. A Group whose Power drops to 0 loses its tokens at once and gets none until it recovers. Illuminati tokens also buy Plots, play a Resource and draw a Group card. | compliance › "a Group whose Power drops to 0 loses its tokens at once (R026)", "a captured Group gets no token on the turn it was captured" |
| R027 Plot limit and buying | Tested | Outside his own turn a player may hold 5 Plots (more with some cards), counting exposed ones; any excess must go at once, to the discard pile or back into the Plot deck, even in the middle of someone else's action. The limit also applies to the active player once his turn ends. Buying a Plot costs 1 Illuminati token or tokens from 2 different other Groups, works at any time, and is never announced or cancellable. Rivals see how many hidden Plots each player holds, never which. | compliance › "a player outside his turn must discard down to the limit at once, even mid-turn", "the active player has no limit during his own turn", "excess Plots may go back into the Plot deck instead of the discard pile (R027)", "buying costs 1 Illuminati token or 2 other tokens"; features › "buying a Plot is not an action and is never announced"; server › "starts a game once a friend joins with the invite code, and hides each hand from the other player" |
| R028 Plot lifecycle | Tested | A played Plot stays on the table while it works, then goes to the discard pile; linked Plots and NWOs stay. +10 Plots boost one action or give defense until end of turn, count once, and never count for Goals. Power-raising Plots only raise. (The card set has no Zap, Paralyze or Attribute Freeze cards.) | rules › "+10 Plots add to the attack, and a cancelled cancel restores them (R010)"; content/plots3 › "Charismatic Leader / Citizenship Award" › "raise a Fanatic / Conservative Group to Power 6 using its action" |
| R029 Aid and oppose | Tested | Any Group with a token other than the attacker may help. To control: aid needs a shared alignment; to destroy: an opposed one. Oppose needs a shared alignment or being the target, its master or its puppet. Without that, a Group helps with Global Power (capped at its Power), or not at all if that is 0. Helpers get no alignment modifier. | compliance › "helping a destroy attack takes an opposite alignment, or else uses Global Power (R029)", "a puppet of the target may oppose with its full Power even without a shared alignment (R029)", "Global Power is used when a helper lacks a matching alignment, capped at its Power (R029)" |
| R030 No doubled Plots | Tested | A player may not use two copies of one Plot in the same attack (a cancelled copy does not count); only one agents card per attack. | compliance › "the same Plot cannot be used twice in one attack", "a duplicate in hand adds +10 to the attack; only one agents card per attack (R030, R031)" |
| R031 Hidden agents | Tested | A card in hand that duplicates the attacked Group may be revealed during a normal attack by anyone but that Group's controller: +10 to the attack or 6 to the defense (only defense against a takeover from hand), then it is discarded. Not usable in Instant attacks. When the attacker's own agents card helped him capture the Group from another player, his copy takes the Group's place in his Power Structure (with its puppets, links and changes) and the original card is set aside for its owner, out of the game (Meta-Rules). New puppets that do not fit are placed as in R038, and a person may rearrange them before any still without room are discarded. | gaps › "the capturer's own copy goes into his Power Structure and the owner keeps his card"; compliance › "a duplicate in hand adds +10 to the attack; only one agents card per attack (R030, R031)", "agents oppose for 6, but never by the attacked Group's own controller (R031)" |
| R032 Privileged attacks | Tested | Privilege comes only from a card or ability and is set when the attack is declared. Then only the attacker and the defender may act (cards that negate Privilege or let a player interfere excepted); anyone may still use roll-changing cards. | compliance › "in a Privileged attack only the attacker and defender take part", "an NWO cannot be played during a Privileged attack (R032, R045)"; content/groups1 › "Moonies and Religious Reich interfere in Privileged attacks" › "Moonies join either side regardless of alignment and end the privilege" |
| R033 Immunity | Tested | Immunities come from card scripts and ability entries: an immune target cannot be attacked or aided against by the named Groups, one way only. Plots are not blocked unless a card says so. | content/groups0 › "I.R.S. and Lawyers" › "a rival with Lawyers is immune"; content/groups1 › "Offshore Banks" › "cannot be destroyed by a Government Group" |
| R034 Instant attacks | Tested | Launched by a card, with the card's Power against the target's Power as it was when the card was played (plus position unless it is the owner's own card). Only abilities that name Instant attacks apply; no Group joins unless a card allows it; the target cannot spend tokens; it cannot be called off; two cannot overlap. | compliance › "the target of an Instant attack cannot spend tokens, and a Disaster costs it a token", "an Instant attack cannot be called off (R034)" |
| R035 Assassinations | Tested | An Instant attack on a Personality; if it succeeds the Personality is marked killed, and only cards that restore killed Personalities bring it back. | compliance › "a successful Assassination kills the Personality (R035)"; content/groups0 › "C.I.A., Clone Arrangers and Joggers" › "C.I.A. turns an attack on a Personality into an Assassination; Clone Arrangers bring it back" |
| R036 Disasters | Tested | An Instant attack on a Place that takes one of its tokens when played (given back if the Disaster is cancelled). Success Devastates the Place, or destroys it when the card's margin is reached. | compliance › "a cancelled Disaster gives back the token it took (R036, R009)"; rules › "Volcano uses Power 18 (errata) and Devastates or destroys a Place" |
| R037 Devastation and Relief | Tested | A Devastated Place and everything below it lose their tokens, get none, and do not count for Goals; Devastating it again does nothing; moving a Group under it strips its tokens. Relief by Groups with Power totalling 3× the printed Power clears it, at any moment the sender may act: in his own main phase, a rival's turn, or any response window he can act in, and he chooses which of his Groups pay. Several players may pay together: each other player's share is a pledge (`pledgeRelief`, allowed at any time, withdrawable, lapsing at the end of the turn), and the sender names the pledges he includes (`partners`); all the Groups spend their tokens at the same moment. Relief abilities (Red Cross, NATO, United Nations, the Center for Disease Control, the Boy Sprouts) offer the same choice of helper Groups, and the Boy Sprouts' Relief honours the Corruption Plot's "no Relief yet" block like the others. | gaps › "a pledge from one player and Groups of another pay one Relief, spent at the same time", "a player's Groups cannot be used without his pledge, and a pledge lapses when the turn ends"; compliance › "a Devastated Place and its puppets do not count toward the goal (R037)", "Relief needs actions totalling three times the Place's printed Power"; content/groups2 › "Center for Disease Control" › "sends Relief to a Devastated Place with its action"; features › "abilityOptions fills payWith for a Relief ability that needs helper Groups", "Boy Sprouts' Relief still respects the Corruption Plot's 'no Relief yet' block" |
| R038 Moving Groups | Tested | In his own main phase a player moves a Group, with its puppets in the same layout, to an open arrow in his own structure (house ruling), for a token from the Group, its old or new master, or the Illuminati. Puppets that no longer fit are placed elsewhere under the same master; if any had to change arrows or found no room, a person gets a `placeCaptured` prompt to put each new Group on another open arrow of its own master before any still without room go back to his hand (computer players keep the first arrangement). A Group is handed to another player through a deal both agree to, in the main phase of either of them, onto an open arrow the receiver chooses, for a token from the Group, its old or new master, or either Illuminati; its puppets and linked Resources go with it. | gaps › "a person may rearrange before Groups that still do not fit go back to his hand", "a waiting Group can be placed on an open arrow of its own master; one still waiting when done is lost"; compliance › "costs one token from the Group, a master, or the Illuminati", "a Group moves with its puppets, and only within its own Power Structure (R038)"; geometry › "moves keep every puppet centred on its master's arrow"; deals › "a Group handed over takes its puppets and linked Resources onto the open arrow the receiver picks, for one token" |
| R039 No dropping | Tested | Same as R013: nothing lets a player remove his own Group. | compliance › "a Group in play can never be discarded or dropped (R013, R039)" |
| R040 Gifts and trades | Tested | Cards in hand (hidden or exposed Plots, Group and Resource cards) may be given or traded whenever a player likes, but not during a decision or draw, nor while a Plot waits to resolve, nor from outside a Privileged attack to a player in it; they go to the receiver's hand, and a hidden card is known only to the two players. Undrawn cards never change hands. A Resource in play not used this turn (no ability used, and no benefit lent: see R042) may be given in the main phase of either player; it is linked to the receiver's Illuminati. Groups change hands as in R038. A trade is two gifts made at once. You may ask only for cards you can see, or for cards of the other player's choice. | deals › "a hidden Plot given away goes to the receiver's hand and is revealed only to the two players", "no cards may be given to a player in a Privileged attack by someone outside it", "a Resource given away is linked to the receiver's Illuminati; a Resource used this turn cannot be given"; dealsAi › "an offer goes through the service like any move; only the two players see it, and the answer completes it" |
| R041 Resources | Tested | Drawn from the Group deck; played by automatic takeover, once per turn for an Illuminati token, or by cards; linked to the Illuminati at first and relinkable to own Groups. They follow a captured Group and are destroyed with a destroyed one. Unique ones allow a single copy, never again once destroyed (unless the card says so); "one per player" limits are honoured. Warehouse 23 holds Resources face down: inactive, unreachable by rivals, and shown to them only as a card back. When someone tries to play a copy of a Unique Resource that a rival holds face down, that rival must at once show it (the play fails; the automatic takeover or the Illuminati's Resource play is given back; the card becomes public) or keep it hidden (the other player's copy comes into play, and the hidden one is discarded if it is ever turned face up). | gaps › "the controller must show the hidden copy: the play fails and costs nothing", "keeping it hidden gives the rival the Resource; the hidden copy is discarded when turned face up", "the computer always shows its hidden copy"; compliance › "a captured Group brings its linked Resources along (R041)", "a second copy of a Unique Resource cannot come into play (R041)"; server › "a Resource face down under Warehouse 23 is a card back to rivals only"; content/hiddenInfo › "Warehouse 23" › "a Resource hidden under it is face down: unnamed in the public log and inactive" |
| R042 Links | Tested | In his main phase a player links his Resource to one of his Groups; a link moves at most once per turn, and not at all once the Resource has been used or has given a benefit that turn (an ability used, a bonus lent to an attack or Power lent to a Group taking part in one, an extra token or draw); a card's own link restriction and locked links are honoured; linked Plots stay with their Group and are discarded if it is destroyed. | gaps › "may not have its link moved, or be given away, after lending a bonus to an attack"; compliance › "a Resource link may be moved only once per turn (R042)"; content/resources › "Cyborg Soldiers" › "cannot link to a non-Violent Group"; content/groups0 › "Evil Geniuses: linked Resources are locked" › "a Resource linked to them cannot be moved" |
| R043 Duplicate Groups | Tested | A Group cannot enter play while a copy is in play or destroyed (unless its card allows several); a copy only discarded may be played. A duplicate of a rival's Group is used as agents. Identical lead picks are re-picked. | compliance › "a Group already in play or destroyed cannot be played again; one merely discarded can (R043)", "lead Groups are chosen by the players, and duplicate picks are set aside and re-picked (R025)" |
| R044 Factions of one Illuminati | Tested | Players may share an Illuminati: +5 to attacks on the other faction's Groups; they cannot share a win (except the Peaceful Special Goal of the Shangri-La kind); knocking out another faction hands you its Resources. A spare Illuminati card in the Plot deck is held as a Plot; if it duplicates a rival's Illuminati (never your own) it may be played at any time you may act (`playAgent`), for the top card of your Plot deck and of your Group deck, as an agent beside your Resources: +3 to your normal attacks on that Illuminati's Groups and to your defense against its Groups' attacks, against every faction of it; one agent per Illuminati. | gaps › "is held with the Plots, played for the top card of each deck, and gives +3 against that Illuminati's Power Structure", "only one agent per Illuminati, never inside your own, and only when a rival plays it", "shows a Plot back to rivals while in hand, and is public once played", "decks sometimes carry one spare Illuminati in the Plot deck, keeping the book's deck shape"; compliance › "+5 to attacks on a Group of another faction of your own Illuminati (R044)", "...unless another faction of the same Illuminati knocked him out: it takes them (R044, R049)" |
| R045 NWOs | Tested | One NWO per colour, the newest replaces the old; they affect everyone, their changes count for Goals, and they cannot be played during an Instant or Privileged attack. | compliance › "NWOs: a new one of the same colour replaces the old one (R045)", "an NWO cannot be played during a Privileged attack (R032, R045)"; content/plots6 › "New World Orders" › "Military-Industrial Complex: Corporate cards are Government too, but not for Goals" |
| R046 Group basics | Tested | Illuminati have four arrows and cannot be attacked. Alignment opposites are built in (two Fanatics are opposites, Criminal has none); gaining one alignment removes its opposite. Cards are real 5×7 rectangles that turn to face their master and may never overlap, so a card lying sideways can close a neighbour's arrow. | compliance › "gaining an alignment removes its opposite (R046)"; geometry › "stands cards on top/bottom arrows upright and lays cards on side arrows sideways", "closes an arrow when a card lying there would overlap another card"; data › "every Group has stats and a legal arrow layout" |
| R047 Calculation order | Tested | Set-to values first, then the single largest multiplier (self-defense one step higher), then additions; Power never below 0. Attack rolls: 2d6, at or under strength wins, 11–12 always fails, strength under 2 fails without a roll. A destroyed Group comes back with printed values. | compliance › "Solidarity does not stack with another multiplier and applies before additions", "a natural 11 or 12 always fails", "strength below 2 fails without a roll" |
| R048 Discards and card access | Tested | Discards go face up to the owner's pile and every card keeps its owner. Draws come from the top of a deck unless a card says otherwise. A player may discard any card from his hand at will, at any time; a Plot may instead be returned to his Plot deck (top, middle or bottom of his choosing), voluntarily exposed, or shown privately to one rival (`showCard`: that rival alone learns it), also at any time, not only when forced by a hand limit. | gaps › "a hidden Plot shown to one rival is seen by him only"; compliance › "a rival sees the cards in another player's discard pile"; features › "a Group may voluntarily discard any card from its hand at any time (R048)", "a Plot may voluntarily be returned to the deck at a chosen position (R048)", "a Plot may voluntarily be exposed at any time (R048)" |
| R049 Elimination | Tested | After his third turn, a player whose Illuminati has no puppets is out at once: his hand and decks leave the game, and his Resources leave play (or pass to a same-Illuminati faction that knocked him out). A player of the destroy-count Illuminati who destroys his own last Group for his winning total is not knocked out and may declare victory at the end of the turn (if he does not, or the claim fails, he is out once play passes on). Leaving the game (`resign`, offline and online, once the lead Groups are chosen) counts as elimination at once: besides his hand, decks and Resources, his agents and his Power Structure leave play (his own cards leave the game, captured ones go to their owners' discard piles); an attack he is part of ends as if it never happened, a Plot of his still waiting to resolve never does, a card question he was asked is answered as a computer would, and if it was his turn, play passes on. Online, a non-host leaving a started game resigns; the host may still delete a game. | gaps › "leaving counts as elimination: the last player standing wins", "when the player whose turn it is leaves, play passes on and an attack he made never happened", "online, leaving a started game resigns; the host can still delete it"; compliance › "a player with no Groups after his third turn is eliminated at once (R049)", "an eliminated player's Resources leave play (R049)", "the Servants of Cthulhu destroying their own last Group as the 8th may declare victory at the end of the turn instead (R049)" |
| R050 Special card kinds | Tested | Not a rule of its own: Illuminati, NWOs, Goal cards and the Plot families follow their own rows (R016, R028, R044, R045). | see those rows |

Totals: 50 Tested (R050 among them, though it only points to other rows), 0 Untested, 0 Choice, 0 Gap.
No part of a row is known to be missing (see *Known gaps*); details the rulebook leaves open follow the rulings under *Deliberate choices*.

## Deliberate choices

House rulings chosen by the owner (Research Needed tab):

- **Turn order** goes by seat order, the order players joined, because the rules name two different
  directions.
- **Secret Groups** have no way to be exposed: they are face up and only have the protections in R014,
  since the rules never say how exposure would work.
- **Moving Groups** only within your own Power Structure, reading "any Group" in the rules as your own.
  Handing a Group to another player is done with a deal (R038, R040).
- **Taking over Resources**: by capturing the Group they are linked to, or by spending an Illuminati
  action to put one from hand into play (the later rules update).
- **Celebrity Spokesman**: the Organization may not have an alignment opposite to one of the
  Personality's (content/plots3 › "Celebrity Spokesman").
- **Corruption**: the Relief just sent is cancelled, the Place stays Devastated, and no Relief may be
  tried there until after the player's next turn (content/plots6 › "Corruption").
- **Weather Satellite**: +10 for Tornado, Hurricane and Rain of Frogs, the −4 option still applies to
  those three, Tidal Wave gets nothing special (content/resources › "Weather Satellite").
- **Spear of Longinus**: "as often as you wish" is read as usable in every attack to destroy and every
  Disaster, without an action, but +1 once per attack (content/resources › "Spear of Longinus").
- **Ark of the Covenant**: when the protected Group falls to a Plot (a Disaster, an Assassination, a
  card-launched attack or a Plot that destroys directly), the Illuminati of the player behind the Plot
  counts as the destroyer, since Plots are directed by the Illuminati; that player chooses a Group to lose
  (content/resources › "Ark of the Covenant").
- **Other ambiguous cards** use the reading written in each card's Research Notes.

Rulings on the rules closed in the last audit (where the book leaves a detail open):

- **Spare Illuminati cards** (R044): the book calls a drawn one "a Plot", so it counts against the Plot
  hand limit and may be traded, discarded, returned to the deck, exposed or shown like one. Its cost (the
  top card of each deck) must be payable, so it cannot be played with an empty deck. Its +3 is an attack
  bonus, so it does not apply to Instant attacks (Glossary), nor to card attacks with no attacking Group.
  It cannot be played aimed at an Illuminati whose only players are still in their first turn. Generated
  decks carry one about one time in five, in place of one Plot, so the Plot deck (Plots plus the spare)
  stays inside the book's 24-32. Rivals see it as a Plot back while it is in hand or deck.
- **Relief from several players** (R037): "spent at the same time" is modelled as pledges. A pledge is a
  promise, not a play: it may be made while someone else has priority, spends nothing until the Relief is
  sent, and lapses when the turn ends or the Place is relieved. The sender may add no Groups of his own if
  the pledges suffice. Computer players include pledges made toward their own Places, but never pledge.
- **The first-turn exception** (R001) is lifted for the attacked player only, and only against the player
  who attacked him; other players still leave that player alone until his first turn ends.
- **Warehouse 23 showdown** (R041): a shown copy stays under Warehouse 23, face down but public, and
  blocks every later copy. A play that fails because a copy was shown costs nothing for the Illuminati's
  once-per-turn Resource play or the automatic takeover (the takeover prompt comes back); other card
  effects that bring a Resource into play keep their costs, as for any play that proves illegal. Whether a
  copy was kept hidden stays secret. The owner is asked for every such attempt, even by a card, so the
  question itself can tell the table that something lies under Warehouse 23.
- **A Resource "used" this turn** (R040, R042): an activated ability used, a bonus it adds to an attack
  that is not cancelled, Power or Resistance it gives to a Group taking part in that attack, an extra
  token or an extra start-of-turn draw. Standing effects outside attacks (hand limits, Goal counts) do not
  count as a benefit given.
- **A duplicate that helps capture** (R031, Meta-Rules): only the capturer's own agents card is swapped
  in, only when the Group came from another player's Power Structure, and only if the original is not
  the capturer's own card. The original is set aside for its owner, out of the game (it is not destroyed,
  so another copy may be played later).
- **Leaving a game** (R049): the book says the effect is as if the player were eliminated; since a player
  who leaves may still have Groups in play, the engine removes his whole Power Structure too (see R049
  above). Leaving is refused while the lead Groups are being chosen (the game has not begun); online the
  host can delete the game instead. Offline, the browser puts the game away after you leave, as only
  computers would be left.
- **Taking a token off your own card** (Action Tokens, p.3): allowed whenever you may act; during your
  own attack it commits the attack, as the book's "calling off" rule describes.
- **Secret Groups** stay as ruled above: the book never defines exposing one.

Engine limits on card timing (the card allows more than the engine does):

- **No Group leaves play and no Illuminati is swapped in the middle of an attack**: Upheaval! and Unmasked!
  ("any time") wait until no attack is under way (content/plots7 › "Upheaval!", "Unmasked!").
- **Sucked Dry and Cast Aside!** ("for one action only") can only be used on an action in an attack:
  attacking, aiding, opposing or defending. Using it to raise the Power of a Relief or of a Plot's cost
  is not offered (content/plots5 › "Sucked Dry and Cast Aside").
- **Discarding a failed takeover** (R003): as players cannot discard at will, a Group that failed a
  takeover from hand is discarded when its owner ends the turn, just before the end-of-turn window;
  Opportunity Knocks and Vultures are played in that window (content/plots7 › "Opportunity Knocks").

Engine choices, made so the game can be played on screens, in pieces and online:

- **Start-of-turn draws**: people draw each card by hand (and may skip); computer players always draw,
  since a draw never hurts during your own turn.
- **"Any time" plays** (including NWOs) are allowed in your own main phase, in every response window
  and at the end of every turn, but not at an arbitrary moment of a rival's main phase. Buying a Plot
  and sending Relief have no such restriction in the engine (the rulebook's own "Any Time" Moves, p.3),
  and the interface offers them wherever they are legal: your own turn, a rival's, or any response
  window you can act in — not only your own idle main phase.
- **Announcing**: actions outside attacks are announced only when nothing else is happening; inside
  another window they happen at once. Linking spends no Group's token, so only Plots can answer it.
  Buying Plots is never announced (R027). A window closes when everyone has passed; online, a player who
  does not answer before the deadline passes.
- **Declaring victory** (R016): see *Declaring victory* below for each call made where the rulebook
  leaves room.
- **One thing at a time**: the engine handles plays in sequence, so the simultaneous roll-off never
  arises, and every free bonus is applied automatically (nothing is forgotten).
- **+10 Plots on the attacker** are played when the attack is declared, as the card text says.
- **Captures and moves**: puppets that no longer fit are first tried on the other open arrows of the same
  master. A person may then rearrange the new Groups (each keeps its master) before any still without room
  are discarded (capture) or go back to his hand (move). Computer players keep the first arrangement, so
  they never wait on it. Handing a Group over in a deal and card effects that move Groups keep the
  automatic arrangement.
- **Hidden information**: each player's view (`viewFor` in `src/server/service.ts`) hides decks, other
  players' hidden Plots, Plots hidden beneath cards, face-down Warehouse 23 Resources, secret ability
  choices and private log lines.
- **Basic Goal**: the start screens (offline and online) fill in the book's number for the table size and
  let the players agree another (4 to 20; never under 12 with two players, as the two-player rules advise).
  **Quick game** is a separate, optional house rule that lowers it to 8.
- **Unanimous agreements on cards**: International Cocaine Smugglers' optional extension of its +4 to
  Personalities that every player agrees on is not offered (the engine has no all-player vote), so only
  its named Groups and their puppets count (content/groups0 › "International Cocaine Smugglers").
- **Bill Clinton's die**: rather than at every single check of his alignments, he rolls at the start of
  each attack (the result holds for that attack) and at the start of each turn (the result holds for
  everything else) (content/groups2 › "Bill Clinton").
- **The I.R.S. tax** is a once-per-turn ability used in its controller's main phase. Under Tax Reform
  the same tax takes the top Plot of every rival's deck; the controller's own deck is never taxed
  (content/plots2 › "New World Orders").
- **Deals** (R022, R040): offers are seen only by the two players (deals may be secret), never hold up
  the game, and lapse when the turn they were made in ends (a trade binds only when made on the spot, so
  nothing carries over). An accepted offer is carried out as one step: if any part is not legal at that
  moment, nothing changes. Cards in hand do not change hands while any player is in the middle of a
  decision or a draw, or while any Plot waits to resolve (it may be looking at or taking cards from a
  hand); Groups and Resources in play only when nothing else is going on, as with moves. Handing a
  Group over is not announced as an action, so cards that cancel actions cannot stop it. You can ask for
  a rival's cards in hand only if you can see them, or ask for a number of Plots or Group cards of his
  choice; the Group of yours you give goes where the receiver chooses. A Resource counts as used this
  turn once one of its activated abilities has been used or it has given a benefit (see R042). Computer players answer offers at once, and
  make a simple offer now and then (a Group card they have no room for, traded for a Plot; or, for a
  Meddler or Kingslayer, a Plot given to a rival best placed to stop a leader about to win).
- **I Lied** (deals › "I Lied"): the player accepting an offer plays it with his acceptance; the player
  making an offer can attach it to the offer in secret, and it is played the moment the offer is
  accepted (online games are played a move at a time, so he is not asked again). The other side is
  delivered at once; the liar's side is held back while the Plot can be countered, and delivered after
  all if I Lied is cancelled. It cannot be played while an attack is under way; an offerer's I Lied
  that cannot be played when his offer is accepted is simply not played, and he hands over his side.
- **Computer difficulty** (Easy, Normal, Hard) only changes how well the computer chooses; every level
  plays by the same rules (tests/aiLevels.test.ts › "Easy, Normal and Hard all play complete, legal games").

## Declaring victory

The rulebook's procedure, in short: when the player whose turn it is has finished and knocked, anyone
who has met one of his Goals may declare victory. Everyone else then gets a chance to use Plots and
special abilities (Instant attacks included; ordinary attacks are not possible, since it is nobody's
main phase) to stop the claim, and the claimant may answer to secure it. If nobody stops it, he wins;
if several claims hold, they share the win, except factions of one Illuminati. No win in the first
round, nor at the end of a turn cut short. A Goal card is shown, not played; rivals cannot touch it
during the attempt, and it returns to the hand exposed if the attempt fails. A winner shows his Plots
to prove he had no extra Goal cards. Eliminating all rivals is a win on its own.

Calls the engine makes where the book is silent or a screen needs a rule:

- **When to declare.** The player whose turn it is may declare as he knocks (`declareVictory` in his
  main phase ends the turn and makes the claim), or at any moment while the end-of-turn window is open;
  any other live player may declare while that window is open, even after passing. Pressing plain
  *End turn* is knocking without claiming. Declaring during an attack, a Plot's counter window or a
  prompt is refused: the claim waits until that is over.
- **Only a met Goal can be declared.** An announced play must be legal when it is made, so a claim for a
  Goal that is not met is refused with the reason; there is no penalty for the attempt.
- **What a claim is.** A claim names the Goal it is made with (Basic Goal, the Illuminati's
  self-contained Special Goal, or one Goal card). It holds if that Goal is still met when everyone has
  passed. While the window is open, a claimant may add another Goal he meets to his claim (each one
  shown if it is a card). Goals that modify the Basic Goal (Illuminati that count some Groups double,
  Goal cards that do) are claimed as that Goal card, or as the Basic Goal for an Illuminati's own
  modifier.
- **The response window** is the end-of-turn window: every live player must pass in a row for claims to
  be decided, and any Plot, ability, attack or new claim reopens it for everyone, the claimant included
  (so he can secure his victory). Buying Plots with Action tokens is allowed as usual.
- **Shown Goal cards**: exposed at the moment of the claim (so every player, and online every view, sees
  it); no card can target it until the claim is decided. A Goal card hidden beneath Fidel Castro is named
  in the claim but, as it cannot be exposed, goes back beneath the card if the claim fails.
- **Proving the hand**: a winner's Plots are listed in the public log. The Goal-card limit is already
  enforced at every moment, so the "caught with too many Goal cards" loss is checked but cannot really
  arise.
- **Same-Illuminati factions** whose claims both hold both fail; a third claimant whose claim holds
  still wins. Shangri-La factions share only if every one of them holds with the Peaceful Special Goal.
- **Elimination** wins at once, with no declaration, as the book says "you win" outright.
- **A turn ended at once** (Power Grab): the engine still opens the end-of-turn window for other plays,
  but no victory can be declared in it.
- **Reminder for learners**: `settings.victoryReminder` (off by default) makes `victoryReminder()`
  return the Goals a player could declare now. The browser turns it on in Tutorial and Guided help
  and off with help off: it shows a "You meet a Goal" note and stops *End turn* or *Pass* once with a
  warning. In strict play there is no reminder and nobody wins without declaring. The *Declare victory*
  buttons themselves are shown whenever a declaration is legal, as a tabletop player can always see
  his own position.
- **Passing for you**: "Pass for me when I have no possible response" (and the online standing order)
  counts declaring as a possible response, so it never passes away your chance to win. In the browser,
  a rival's claim is always shown to you, even with nothing to answer it; online, the standing order
  still passes for a player with no possible answer.
- **Computer players** always declare as soon as they may (a Goal card only when nothing else is met,
  since a failed claim exposes it). When a rival claims, they play out every Plot and ability they
  could use (Instant attacks included, weighed by their odds) and use the one most likely to stop every
  claim; with nothing in hand, Normal and Hard buy Plots with spare tokens and look again.

## Expansion packs

The rules the Assassins and SubGenius packs add (Zaps, Paralysis, Freezes, "Requires ... Action" costs,
Slack, the stand-alone SubGenius game with shared decks and an uncontrolled area, SubGenius links) and
every decision taken for them are in `docs/EXPANSIONS.md`, tested in `tests/expansions.test.ts` and
`tests/expansionGames.test.ts`. Both packs are off by default and do not change base games.

## Known gaps

None. Every item listed in earlier audits is now handled (see *Fixed in this audit*). Where the rulebook
leaves a detail open, the engine follows a ruling listed under *Deliberate choices*; card-specific
readings are in the Research Notes of the card database.

## Fixed in this audit

Closing the last known gaps:

- **Relief from several players at once** (R037): pledges let other players' Groups pay for one Relief
  together with the sender's, all spent at once (see R037 and *Deliberate choices*).
- **Spare Illuminati as agents** (R006e, R044): generated decks sometimes hold a spare Illuminati in the
  Plot deck; it is held as a Plot and can be played as an agent (+3 against that Illuminati's Power
  Structure, one per Illuminati, never your own). The interface lists it with your Plots, offers
  *Play as an agent* wherever you may act, and shows agents beside the Resources; computer players play
  one as soon as they can and keep it while a rival plays that Illuminati.
- **First-turn exception** (R001): a player attacked during a rival's first turn may answer that rival.
- **Warehouse 23 and Unique duplicates** (R041): the owner of a face-down copy is asked to show it or lose
  it whenever a rival tries to play one.
- **Link restrictions** (R042) and **gifts of used Resources** (R040): a Resource that lent a bonus or
  another benefit this turn can neither be relinked nor given away until the next turn.
- **Capturing with a duplicate** (R031): the capturer's own copy goes into play and the owner keeps his.
- **Leaving a game** (R049): `resign`, offline (a *Leave* button) and online (the same button, or *Leave*
  in the games list), counts as elimination; the host-only delete is unchanged.
- **Setup and table details**: the lead Group's Illuminati arrow is chosen (R025); a person may rearrange
  newly captured or moved puppets before any are lost (R031, R038; the unused `placeCaptured` prompt is
  now live); the Basic Goal can be agreed on the start screens (R016); a player may take a token off his
  own card, and doing so, or spending one of his own Groups' tokens, commits his attack (R009); a hidden
  Plot can be shown to one rival (R048).
- **Interface fix**: the Group buttons of the Relief picker and of *Buy a Plot (2 Group tokens)* did
  nothing when tapped (they were never wired to an action); they now select and deselect payers.

Earlier in this audit:

- Victory was checked automatically for every player at the end of each turn. It is now declared by
  the player, answered by everyone else, and decided as the rulebook describes (see *Declaring
  victory*).
- A play made illegal partway through an attack was never checked again: an attacker made Peaceful kept
  its Terrorist Nuke, and an attacker whose target gained an immunity mid-attack still attacked. Every
  play in an attack is now checked again after each play or ability and before the roll and the result,
  as the rulebook's "Cancellations, Illegal Actions, & Other Surprises" describes (R010, R009); an
  illegal Plot returns to its owner's hand, exposed. Agents used in a cancelled attack now return to
  their owner's hand, and a Plot the attacker used for one of his own aiding Groups comes back exposed.

- Immunity for a whole Power Structure (Stonehenge, Vatican City, the Discordian Society and one other
  Group) did not reach the owner's hand, decks and discard pile, as the rulebook's Immunity section says
  it must; it now does. A player is still never immune to his own Groups.
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
- **Deck ratios** (`randomDeck`, p.2's deck-building guidance): the rulebook calls a deck of 12 to 20
  Group cards and 24 to 32 Plot cards typical, out of the 44 non-Illuminati cards in a 45-card deck. The
  generator built roughly 26 Groups/Resources and 18 Plots every time, outside that range; it now picks
  a Group count spread across the book's 12-20, with Plots filling out the rest (always inside 24-32),
  keeping its theme, attacker and arrows-out guarantees and its Plot category balance (features ›
  decks.test.ts › "sits inside the rulebook's typical 12-20 Group / 24-32 Plot ranges over many seeds").
- **Buying Plots and sending Relief** were only offered by the interface during your own idle main
  phase, although both are legal at any time (see above); they are now offered wherever they are legal,
  and the player chooses which Groups pay instead of the interface always picking the weakest (or
  greedy strongest-first) set for him.
- **`abilityOptions` never filled `payWith`** for a Relief special ability (Red Cross, NATO, United
  Nations, the Center for Disease Control, the Boy Sprouts), so a helper Group's Power was never offered
  even when it was needed to reach 3× the Place's printed Power; it now searches for a working set of
  helper Groups. The Boy Sprouts' own Relief ability separately never checked the Corruption Plot's "no
  Relief yet" block that the other Relief abilities already honoured; it now does too.
- **Choosing who pays**: a Group's move, a Plot bought with 2 Group tokens, and a Group-paid Relief all
  used to pick the payer(s) for you (the weakest available, or a greedy strongest-first set); the
  interface now preselects a sensible default and lets the player change it. Fixed a bug where a free
  move (Reorganization Plot, Bermuda Triangle) was refused by the interface whenever none of the four
  possible payers happened to have a token, even though the move needs no payer at all when it is free.
- **Reachability and public information**: the interface now highlights your own Groups as legal
  targets when attacking to destroy one of them is legal (R004), and your Illuminati as a legal link
  target when relinking a Resource to it is legal (R042) — both were always legal in the engine but
  never highlighted. A rival's exposed Plots, every player's full discard and destroyed piles (browsable
  card by card, not just a top card or a count), and progress toward an Illuminati's Special Goal (not
  only the Basic Goal) are now shown for every player, and a Group's inspect popover lists the Plots and
  Resources linked to it. Inspecting a card now reads its current (post-modifier) attributes, not only
  its printed ones — the inspect popover was reading a Group's printed attributes even though its
  current Power, Resistance and alignments were already correct.
- **Voluntary discards, returns and exposing** (R048, "Returning Plots to Your Deck" and "Hidden and
  Exposed Plots", p.4-5): a player can now discard any card from his hand, return a Plot to his own
  deck at a chosen position (top, middle or bottom), or voluntarily expose a Plot, at any time — not
  only when a hand or Goal-card limit forces a discard. This closes the "Discarding or returning Plots
  at will" gap listed in an earlier audit.
