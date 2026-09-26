# Expansion packs: Assassins and SubGenius

This file records every rules decision taken to support the two expansion packs, with its source and
any ambiguity. How to encode the packs' cards is in `docs/CARD_SCRIPTING.md` ("Expansions").

Sources:

- **SG** — the official *INWO SubGenius* rulebook (v1.01), section names as printed there.
- **AFAQ** — *INWO Assassins Errata and FAQ*, https://www.sjgames.com/inwo/errata/assassins.erratafaq.html
- **CFAQ** — *INWO Card FAQ*, https://www.sjgames.com/inwo/errata/cardfaq.html (general topics
  "Zaps", "Paralyze", "Attribute Freeze!", "Instant Attacks")
- **RFAQ** — *INWO Rules FAQ*, https://www.sjgames.com/inwo/errata/rulesfaq.html
- **ERR** — *INWO Errata*, https://www.sjgames.com/inwo/errata/errata.html
- The card scans themselves (read for the research data; the card data paraphrases them).

## Status and switches

- Both packs are **off by default** and switched separately: `settings.expansions = { assassins?, subgenius? }`.
  `settings.subgeniusRules` selects the stand-alone SubGenius game.
- A pack is offered to players only when its flag in `EXPANSIONS_READY` (`src/engine/expansions.ts`) is
  set, which should happen only when every card of the pack is implemented
  (`tests/expansions.test.ts › pack implementation progress` prints the count and then requires 100%).
  Until then the new-game pages (offline and online) show no pack switches, and the server ignores a
  request for a pack that is not ready. The engine itself plays whatever settings it is given; that is
  how the tests force the packs on. To try the switches early in one browser, set localStorage
  `elitists-war.preview-packs` to `'1'` (offline games then use the chosen packs; the server still ignores
  unready ones). The choice itself is remembered per browser (`elitists-war.packs`, `src/ui/packs.ts`).
- Current state: Assassins 0/125 implemented, SubGenius 1/97 (the Church of the SubGenius, needed for
  the SubGenius game and carrying the Slack rule).
- Games saved before this change have no `expansions`, `common` or `freezes` fields and play on exactly
  as before; random decks for base games are built exactly as before (same seed, same deck).

## Card data

- `src/data/expansions/assassins.json` (125 cards) and `subgenius.json` (97 distinct cards; the box holds
  100 because the Church of the SubGenius comes four times). Built from the verified scan research; every
  `text` is a new paraphrase. Types follow the base data: Goals and NWOs are Plots with subtype
  `Goal` / `NWO`; Disasters and the Assassination are Plots with subtypes `Disaster` / `Assassination`;
  Resource kinds (Gadget, Artifact, Unique) go in `uniqueness` as for base Resources.
- The research's "Goal: " and "NWO: " name prefixes are dropped. **No id collides** with a base card or
  with the other pack (checked by `tests/expansions.test.ts`); the rule for a future collision is a
  `-assassins` / `-subgenius` suffix.
- `keywords` keeps the printed Plot keywords. Oil Spill and Spontaneous Combustion are Instant by their
  text (AFAQ errata for Oil Spill; every Assassination is Instant), so `Instant` is added; Drought and
  Flesh-Eating Bacteria are not Instant (AFAQ errata for Flesh-Eating Bacteria). Enough is Enough was
  tagged "Paralysis" by the research; it removes Zaps, Paralysis and Freezes and is not one itself, so
  it carries no keyword.
- Errata applied in the texts (and marked in `notes`): Alien Abduction, Blinded by Science, Flesh-Eating
  Bacteria, Global Warming (Space Places are excluded), Go Fish, The Green Party, Oil Spill, Society of
  Assassins, Swingers (AFAQ); Comet Hail-"Bob" (ERR).
- **Arrow ambiguities**: on the scans of Day Care Centers, General Disorder and Pale People in Black only
  the incoming (top) arrow is visible and the lower edge is covered; they are recorded with no outgoing
  arrow. The Society of Assassins scan shows three outgoing arrows with the fourth edge covered; like
  every Illuminati it is given four.
- Convenience Stores has the id `convenience-stores`, which the base cards Tabloids and Video Games
  already name: their +3 to take it over now works whenever the card is in play (Assassins switched on).
  Their texts were updated. Computer Security's list of Computer Plots now includes Bar Codes and
  Floating Point Error.
- Convenience Stores and Strange Bedfellows are ordinary cards of the Assassins pack (Group and Plot).

## Decks and settings

- `randomDeck(seed, illuminati, { sets })` draws only from the given sets (default: the base game).
  `enabledSets(settings)` gives them: Base plus each pack switched on; the stand-alone SubGenius game
  uses the SubGenius set alone (the rulebook allows adding other sets; the app keeps the pure game).
- Expansion cards enter random decks only once implemented (Plots also need a handler, Resources
  hooks, as for base cards). Tests may pass `unimplemented: true`: an unimplemented expansion Group then
  plays as a plain Group with its printed numbers.
- `illuminatiFor(settings)` lists the Illuminati players may pick: the base nine, plus Society of
  Assassins and Church of the SubGenius once their packs are on and they are implemented.

## Zaps (Assassins)

- A Zap is played on a rival's Illuminati, costs an Illuminati action, may be played at any moment outside
  a Privileged attack, and stays on the table linked to that Illuminati (card texts).
- It restricts the **whole Power Structure** of that player, not just the Illuminati; a "can't take over
  X Groups" Zap means such Groups cannot be taken over at all, so automatic takeovers are barred too
  (CFAQ "Zaps").
- Played during an attack it can make that attack illegal, which cancels it (CFAQ "Zaps"). The engine
  links a Zap played in an attack at once, and the attack's legality is re-checked after every play.
- Several Zaps add up (each is its own restriction).
- **Removal**: any player may spend one Illuminati action at any time to remove every Zap from one
  player (the text printed on every Zap), but not during an Instant attack (RFAQ "Instant Attacks").
  This is the engine action `removeZaps`. Decision: it happens at once and is not announced for
  responses (no card in either pack cancels it). A Zap cancelled in the attack it was played in stops
  working at once and is discarded when the attack ends.
- Zaps on an eliminated player are discarded.

## Paralysis (Assassins)

- Played at any moment outside a Privileged attack, on a Group of the alignment the card names; paid
  with an Illuminati action or with actions of the named opposite alignment whose Power totals the
  target's current Resistance (card texts).
- A Paralyzed Group cannot spend Action tokens, use its special ability or its linked Resources, and
  cannot get new puppets; its puppets are unaffected (card texts). Its tokens are held back and return
  when it is freed.
- **Goals**: the cards say its control does not count toward any Goal, and the CFAQ ("Paralyze", the
  Bobbies question) confirms that only the Group's *direct* count is lost: its indirect effects (the
  Bobbies raising a Goal) still apply. Decision: a Paralyzed Group is left out of the Basic Goal count and
  of Special Goal totals; its puppets still count. (The research summary claimed Paralyzed Groups still
  count; the cards and the official FAQ say otherwise, so the cards win.)
- It can be removed at any time, victory attempts included (CFAQ "Paralyze"): by an action of its master
  (paid by the Group's controller) or of any Illuminati (each player pays with his own). Engine action
  `freeGroup`. It also ends when the Group loses the named alignment (card texts): the Plot is then
  discarded. Decision: even a temporary alignment change frees it for good.
- Resources linked to a Paralyzed Group may be linked elsewhere (CFAQ "Paralyze").
- Decision: Paralysis played on a Group in the middle of its own action does not cancel that action
  (no source says it does).

## Attribute Freezes (Assassins)

- Until the end of the turn no Group with the frozen attribute (whoever owns it) may spend Action tokens,
  except to defend itself; alternatively the card cancels the action a matching Group has just taken
  (card texts). Hubble Trouble also freezes Satellites and the Orbital Mind Control Lasers; School Prayer
  freezes Church, Liberal and Conservative Groups.
- The CFAQ ("Attribute Freeze!") only adds that agents cards (duplicates) still work against a Frozen
  Group; the engine never blocks agents cards for a Freeze.
- Cards that need an action of that attribute cannot be paid while it is Frozen, since the tokens are
  held back.

## Instant attacks, Assassinations, killed Personalities

- The base engine already had Instant attacks, Disasters and Assassinations; they are extended, not
  duplicated: one shared `assassinationPlot` family serves the base cards and the packs, and a card
  launching an attack may now say who may help against it (`joinRule`, `joinMultiplier`: Drought,
  Flesh-Eating Bacteria and No Beer! need this).
- Only proximity and cards that name Instant attacks, Assassinations or Disasters affect an Instant
  attack; no +5 rival-Illuminati bonus (CFAQ "Instant Attacks") — unchanged base behaviour.
- "Killed" and "assassinated" mean the same (RFAQ "Killed Personalities"). A successful Assassination
  marks its Personality `killed`; `killPersonality()` does the same for cards that kill by other means
  (Moonbase, General Disorder, Count Dracula's "destroyed means killed"). A killed Personality is a
  destroyed Group like any other; the mark only matters to cards that ask for it.
- An absolute ban on attacking a Group also stops Instant attacks on it (RFAQ): unchanged
  (`forbidAttack` hooks apply to all attacks).
- A Place that cannot be destroyed (an ability or a `preventDestroy` card) is at most Devastated by a
  Disaster. An attack by a card (Instant or not) made illegal before it resolves returns its card to its
  player's hand, exposed (This Was Only A Test works on non-Instant Disasters too).

## Assassins cards as printed: rules decisions

Every Assassins card is played as printed and as the AFAQ/CFAQ word it; where a card gives a player a
choice, the engine asks him (`askChoice`), and the computer players have a default answer.

- **Go Fish** (AFAQ errata): anyone who received a Plot card from a rival, or was forced to show a rival a
  hidden Plot in his hand or deck, is immune to Go Fish until the end of his next turn. The engine records
  it wherever it happens (deals, Arms Dealers, Go Fish itself, stolen or handed-over Plots, looks at hands
  and Plot decks, exposures forced by cards). Showing a card by choice (the `showCard` action, a Goal shown
  for a claim, Arise!) does not count. Only hidden copies of the named Plot are taken (CFAQ).
- **Go, Lemmings, Go!** answers every discard paid for a Plot or a special ability, base-game cards
  included (Hoax, Secrets Man Was Not Meant to Know, the 18½ Minute Gap, Air Magic, Fnord, The Big Sellout,
  Embezzlement, March on Washington, the Flying Saucer, "Requires … Discards" costs and the packs' own).
  Extra discards from a hand are chosen by the victim.
- **Antitrust Legislation** (AFAQ errata): when played, each player in turn (its player first) may move
  Groups before it takes effect, discarding a Plot (hand or top of deck) per move or three for a complete
  reorganization; the computer players move nothing. Played during an attack, this waits until the attack
  is over. Then nested Corporate Groups lose their tokens at once and get no new ones. Decision: whether
  their abilities are off is judged from the Group's own alignments (printed, and as Plots and modifiers on
  it changed them), because other cards' ongoing alignment changes can themselves depend on which
  abilities are on.
- **Australia**: four times its printed Resistance at the weekend or after 5 p.m. in its controller's local
  time (the time zone the interface reports, else the clock of the device running the game), read at the
  start of each action and recorded on the card, so an attack keeps the value it began with. National
  holidays cannot be known by the software and are not applied.
- **Fickle Finger of Fate**: the victim is asked, whenever his Illuminati attacks while the bonus is
  unused that turn, whether this is the attack that gets the +10.
- **Grave Robbers** stands in for a Resource takeover the player is entitled to: his automatic takeover
  (played right after his start-of-turn draws) or his once-per-turn Resource play (an Illuminati action).
  He picks the Magic Groups that pay for a Magic Artifact.
- **Nutrition Nazis** may be played once in a whole game as a Plot (the card says "once per game");
  while linked, no Nutrition Nazis can come into play as a Group (CFAQ).
- **Partition**: an automatic takeover of the duplicate, or a real Attack to Control from hand (the split
  follows a success). Reuniting needs one half to control the other; duplicate links are the owner's choice.
- **Near Miss** answers any destruction of a Place (CFAQ): after the roll of an attack, or in the response
  window of a destruction by other means (the Place comes back Devastated where it was, with its puppets
  and linked cards). It does nothing for a Place that cannot be destroyed anyway.
- **Society of Assassins**: when its Fanatic Group attacks or is attacked by a Fanatic Group, its player
  may make the two Fanatic alignments the same one for that attack (either player may: CFAQ), and a
  defender may make its Fanatic the same as its master's.
- **Strange Bedfellows**: played outside an attack, the reversal lasts for the next attack; during one,
  for that attack; during the placing of Action tokens, only while they are placed.
- **Copy Shops** may copy a Goal, which counts only if it wins at once (declared then and there, like a
  Goal card); copies leave the game when used up or nullified.
- **Science Alarmists**: the automatic takeover asks their controller for permission.
- **Regi$tered Trademark**: table talk cannot be refereed by software; the two penalties are actions any
  player takes on the honour system, offered on the linked card in the interface.

## The SubGenius game (stand-alone)

What the app offers: SubGenius cards mixed into a standard game (`expansions.subgenius`), and the
stand-alone SubGenius game (`subgeniusRules`) played with the SubGenius set alone. Rules as in SG
("Beginning the Game", "Turn Sequence", "Differences Between This Game and Standard INWO"):

- Every player is a faction of the Church of the SubGenius (the Illuminati). One shared Plot deck and one
  shared Group deck; one shared face-up Plot discard pile and one for Groups; an empty deck is made again
  from its discards. Discards never go back into a deck.
- Each player is dealt 3 Plots and 3 Group cards and picks a lead among the Group cards, which may be a
  Resource. The other two go into the **uncontrolled area** at the start of that player's first turn.
- Start of turn: draw a Plot; draw a Group into the uncontrolled area only if it holds fewer than 8
  cards. Tokens may be spent at any time (1 Illuminati token or 2 other tokens) to draw a Plot, or a
  Group into the area (`drawGroup` with `payWith`).
- Automatic takeover: any one Group or Resource the player put into the area this turn. It always costs
  the Illuminati's new token (not only with two players). The rules FAQ adds that an Illuminati that
  normally gets several tokens loses just one: implemented that way.
- Main phase: anyone may attack a Group in the area, to control or to destroy it (no position bonus, no
  owner, anyone may aid or oppose by alignment). A failed attack leaves it there. A Resource in the area
  is taken with one Illuminati token, once per turn.
- A destroyed Group's puppets, and Groups that no longer fit after a move, go to the area; Resources
  linked to a Group that goes there go with it; linked Plots stay linked ("The Cards Remember").
- Basic Goal: 10 Groups, 12 with two players. The rules are otherwise the same for two players, so the
  standard two-player restriction on attacking before your own first turn is not used.
- Victories: players of the same Illuminati cannot share a victory (the existing faction rule), so in
  the SubGenius game victories are not shared (only Arise! allows it; card-level).
- +5 when attacking a rival's Group applies because every rival plays the same Illuminati (the existing
  faction rule, SG "Rival Illuminati bonus").
- The Secret attribute has no effect of its own (cards that add, remove or reward it still work).
- Elimination: the player who took the last puppet gets the eliminated player's Plot hand and Resources;
  otherwise they go to the discard piles. A player who leaves the game discards everything.
- Online, the shared decks are hidden from everyone like any deck; the area and discards are public.
- Decision/simplification: the per-player `plotDeck` / `groupDeck` arrays stay empty in this game; card
  scripts must use `plotDeckOf` / `groupDeckOf` (the engine's own deck moves do too: returning a Plot to a
  deck, Regi$tered Trademark's penalties). Base cards that read a player's own deck (few, and not
  part of the SubGenius set) see an empty deck in this game.
- Not implemented (not needed by the SubGenius cards alone): duplicates across several SubGenius sets
  (bounced leads, agents from the area).
- Card-granted extra Group draws (www.subgenius.com) are made with the normal start-of-turn draws, whatever
  the area holds (the fewer-than-8 limit is for the normal draw only); a person may decline them.
- Dallas Catacombs: every way a Group enters its controller's Power Structure (automatic takeover, capture,
  move) may use any side of the new master, up to its number of outgoing arrows (the card).

## Slack and the Church of the SubGenius

- The Church keeps its Action tokens from turn to turn and gets its new one on top; each action spends
  one (the card; SG "Place Action tokens"). Ability `{ kind: 'slack' }`.
- Its Special Goal: up to 3 Slack count as Groups toward the Basic Goal; it cannot be combined with any
  other Goal (the card; SG "Special Goal"). Decision: combining means with a Goal card, which is
  checked separately anyway; Illuminati-granted doubles do not exist for the Church.
- It and its SubGenius Groups get +2 on direct Attacks to Control SubGenius Groups (the card; SG glossary
  "Direct attacks"). The Church is encoded (`src/engine/content/subgenius.ts`), also in mixed games.
- The SubGenius attribute is plain data (SG "The SubGenius Attribute").

## "Requires ... Action"

- Many Plots of both packs name the action that powers them. Unless a card says otherwise it can only be
  powered by the actions (or discards) of the player who plays it (SG "Plot Cards", "Actions"). The
  engine checks and pays a declared cost (`requires`, `src/engine/costs.ts`) before the card acts.
- Decision: an action cancelled after it powered a Plot is not replaced by another (SG "Canceled
  Actions" allows it; no card of the packs cancels a powering action, so this is left for later).
- March on Washington cannot stand in for a declared cost (it names alignments or attributes and would
  need a separate rule; no pack card needs it).

## Links as SubGenius uses them

- A Plot that changes a Group's numbers, alignments or attributes is permanently linked; if the link
  becomes temporarily illegal it has no effect until legal again, and if it becomes illegal for good the
  Plot is discarded (SG "Links", "Canceled Actions, Alignment Changes and Other Surprises"). Engine:
  `PlotHandler.linkLegal`, re-checked after every action.
- Other links (Resources) may be moved once per turn on your own turn (SG): the base rule, unchanged.

## SubGenius cards: rulings

Every SubGenius card follows its printed text (and the official errata and FAQ). Where the text leaves a
genuine choice open, the engine reads it as follows (each also noted with the card's script):

- Sacred Stencil helps against Instant attacks only in a standard game (it names them "in standard INWO").
- Connie Dobbs protects every Group below her, her puppets' puppets included; like any undestroyable Group
  they cannot even be attacked to destroy (CFAQ "Undestroyable Groups").
- "Bobbies": nothing but a successful attack on them (a Disaster included) or the loss of their master
  removes them (errata): they are never destroyed, never moved by their controller, never chosen for a
  discard by another card; whoever takes them over may hang them on a rival's open arrow.
- Kill "Bob"!: the attacking side is the attacker and every player whose aiding Group still counted; it
  pays out once the attack is over, with the dice as they finally stood.
- Schizm replaces the result of any successful attack it was played with (control or destroy), may be
  played by a third player (CFAQ), and never with an Instant attack (only cards naming Instant attacks
  affect those).
- Dokstok's token is given away (a gift, or the player's side of a bargain struck at the table) or thrown
  away through a question its controller must answer before anything else.
- Psychic Pstench: its player picks which exposed Goal goes; Random Jesii: the victim keeps the Plot of his
  choice hidden.
- Die rolls: every attack roll, and every roll a card makes (the SubGenius cards, Flat Earthers, Nephews of
  God, Las Vegas, Suicide Squad, OPEC, Bill Clinton, Imelda Marcos, Killer Satellite), can be answered by
  Bulldada, Luck Plane, S.C.A.M., Shordurpersav and the Janor Device (a `dieRoll` event). A card rolling in
  the middle of an attack gets a response window of its own at once, and the attack goes on afterwards
  with the final roll; this happens only when some player could answer, so games without those cards play
  exactly as before. Lyndon LaRouche's start-of-turn roll still counts at once (it decides his token before
  tokens are placed).
- Time Control: an Illuminati token counts as spent when its own player's action (an attack, move, Plot,
  ability, Resource, Group purchase, aid, defense, Relief, Zap removal, freeing a Group) takes it; giving one
  away in a deal or as an answer to a card (. . . Or Kill Me!) is not spending it.

## AI

Computer players play with the packs switched on: they attack the uncontrolled area, take Resources
from it, buy Group cards when it runs short, remove Zaps on themselves and free their Paralyzed Groups
with a spare Illuminati action, and weigh the packs' Plots like any other Plot (declared costs are paid
automatically). `tests/expansionGames.test.ts` plays a few dozen games with each pack forced on (the
Assassins Zaps, Paralysis and Freezes get stand-in handlers there) to show that nothing crashes or stalls.
