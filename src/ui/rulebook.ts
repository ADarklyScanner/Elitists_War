// The complete rulebook, written for this app in our own words. It explains the tabletop rules the
// game is based on, so someone who learns here can sit down at a real table with strict players.
// Where this app plays differently, the section ends with an "In this app" note
// (see RULES_COMPLIANCE.md for the full list of choices and gaps).

export interface RuleSection {
  /** Stable id: used in links from the in-game Rules panel and in the reader's address. */
  id: string;
  title: string;
  /** Which part of the book the section belongs to (the table of contents groups by it). */
  part: string;
  /** One line shown under the title in the table of contents. */
  blurb: string;
  /** The section itself, as HTML. */
  body: string;
}

/** A clearly marked note on how this app differs from the tabletop rules. */
const app = (html: string) => `<aside class="rb-app"><b>In this app:</b> ${html}</aside>`;
/** A worked example. */
const ex = (title: string, html: string) => `<div class="rb-ex"><div class="rb-ex-h">Example — ${title}</div>${html}</div>`;
/** A reminder worth remembering at a strict table. */
const strict = (html: string) => `<p class="rb-strict"><b>Strict table:</b> ${html}</p>`;
const see = (id: string, label: string) => `<a href="#rb-${id}" data-rb-goto="${id}">${label}</a>`;

export const PARTS = ['Getting started', 'Playing a turn', 'Attacks', 'Cards and schemes', 'Winning and losing', 'Beyond the basics', 'Expansions'];

export const RULEBOOK: RuleSection[] = [
  // ------------------------------------------------------------------ Getting started
  {
    id: 'intro', part: 'Getting started', title: 'The idea of the game',
    blurb: 'Who you are, what you build, and the ways to win.',
    body: `
<p>Every player runs a secret society that pulls the strings of the world. You begin with a single card, your <b>Illuminati</b>, and over the game you hang other <b>Groups</b> from it: governments, companies, cults, clubs, cities and famous people. The tree of cards that grows out of your Illuminati is your <b>Power Structure</b>. Rivals build theirs at the same time, and everyone is trying to grab, wreck or out-grow everyone else.</p>
<p>You add Groups by taking them over from your hand or by stealing them from a rival. You harm rivals by destroying their Groups, and you bend the rules with <b>Plots</b>: dirty tricks, disasters, assassinations, secret goals and world-changing New World Orders. <b>Resources</b> (magic relics, strange machines, forbidden books) give extra powers.</p>
<h4>How you win</h4>
<ul>
<li>Control enough Groups: the <b>Basic Goal</b>, the same for everyone.</li>
<li>Meet the <b>Special Goal</b> printed on your own Illuminati.</li>
<li>Meet the condition on a <b>Goal card</b> hidden among your Plots.</li>
<li>Be the last player left, after knocking everyone else out.</li>
</ul>
<p>Victory is claimed at the end of a turn, and every rival then gets one last chance to stop you. Several players can even win together. The details are in ${see('victory', 'Goals and winning')}.</p>
<h4>Two very different games</h4>
<p>With two players the game is a fast duel where the better deck and the sharper plan usually win. With three or more it becomes a game of talk: alliances, bribes, threats and betrayals matter as much as the cards. Expect roughly 20 to 30 minutes per player at a table.</p>
<h4>What you need at a real table</h4>
<ul>
<li>Your own deck of 45 cards (see ${see('deck', 'Building a deck')}).</li>
<li>Two ordinary six-sided dice.</li>
<li>About fifteen small counters per player to use as <b>Action tokens</b> (glass beads work well).</li>
<li>A few matching pairs of markers, different from your tokens, to show <b>links</b> between cards.</li>
</ul>
<h4>Using this rulebook</h4>
<p>Words in bold are game terms; the ${see('glossary', 'Glossary')} collects them. Every section that the app handles differently from a strict tabletop game ends with a boxed <i>In this app</i> note, so you know what to do yourself when you play with real cards.</p>
${app('the game handles all the bookkeeping: tokens, bonuses, who may help, hand limits and the victory check. At a real table you and your rivals do all of that by hand, so read the sections on attacks and timing closely. The app also allows up to eight players and computer opponents; the tabletop game is written for two to six.')}
`,
  },
  {
    id: 'components', part: 'Getting started', title: 'The cards and the table',
    blurb: 'Card families, the two decks, and where everything lies.',
    body: `
<p>There are three families of cards. <b>Groups</b> make up Power Structures; the <b>Illuminati</b> are a special, stronger kind of Group. <b>Resources</b> sit beside your structure and lend it abilities. <b>Plots</b> are one-shot or lasting tricks held in your hand.</p>
<table class="rb-table"><thead><tr><th>Card</th><th>Back</th><th>Goes in</th><th>Colour of the face</th></tr></thead><tbody>
<tr><td>Group</td><td>puppet</td><td>Group deck</td><td>red title or background</td></tr>
<tr><td>Resource</td><td>puppet</td><td>Group deck</td><td>purple</td></tr>
<tr><td>Plot (all kinds)</td><td>hand</td><td>Plot deck</td><td>blue</td></tr>
<tr><td>Illuminati</td><td>hand</td><td>your starting one on the table; spares in the Plot deck</td><td>black, laid out sideways</td></tr>
</tbody></table>
<p>Because a spare Illuminati has the same back as a Plot, nobody can tell one is hiding in your Plot deck (see ${see('duplicates', 'Duplicates and agents')}).</p>
<h4>Four kinds of Group</h4>
<ul>
<li><b>Illuminati</b>: the secret masters at the centre of each structure. One per player.</li>
<li><b>Organizations</b>: most Groups. Unions, agencies, companies, sects.</li>
<li><b>Places</b>: the hidden rulers of a country, state or city. Only Places can be hit by <b>Disasters</b>.</li>
<li><b>Personalities</b>: one famous person and their entourage. Only Personalities can be hit by <b>Assassinations</b>.</li>
</ul>
<h4>Kinds of Plot</h4>
<ul>
<li>Ordinary Plots: bonuses, cancels, thefts, sudden takeovers. Read each card.</li>
<li><b>New World Orders</b> (NWOs): lasting world changes that sit in the middle of the table and affect everybody.</li>
<li><b>Disasters</b>: attacks on Places, usually Instant.</li>
<li><b>Assassinations</b>: Instant attacks on Personalities.</li>
<li><b>Goal cards</b>: secret alternative ways to win.</li>
</ul>
<h4>Your area of the table</h4>
<ul>
<li>Your <b>Illuminati</b> in front of you, with your Groups joined to it arrow to arrow.</li>
<li>Your <b>Resources</b> next to the structure.</li>
<li>Any <b>exposed Plots</b>, face up, where everyone can read them.</li>
<li>Your face-down <b>Plot deck</b> and <b>Group deck</b>.</li>
<li>Your <b>discard pile</b>, face up. Anyone may look through it.</li>
<li>Your <b>destroyed pile</b>: the Groups <i>you</i> have destroyed. Several Goals count these, so keep them apart.</li>
</ul>
<p>In your hand you hold Groups, Resources and hidden Plots. Hand cards are not in play.</p>
<h4>“In play” and “just played”</h4>
<p>A Group or Resource is <b>in play</b> while some player controls it. A Plot is in play while it stays on the table for a lasting effect (an NWO, or a Plot linked to a card). A Group you are trying to take over from your own hand is only <i>just played</i>: effects that mention Groups in play do not touch it until your takeover succeeds, although rivals may still join the fight over it. If the takeover fails and the card is discarded, it never was in play, so a copy of it can still enter the game later.</p>
<h4>Cards beat rules</h4>
<p>When a card and this rulebook disagree, follow the card. The only exceptions are the few table-wide principles listed under ${see('timing', 'Timing and card conflicts')}, which override even card text.</p>
${app('decks, piles and exposed Plots are drawn for you; tap a deck to draw from it, and open the log to see what went where. Every player can browse every discard pile, as at a real table.')}
`,
  },
  {
    id: 'anatomy', part: 'Getting started', title: 'Reading a Group card',
    blurb: 'Power, Global Power, Resistance, alignments, attributes and arrows.',
    body: `
<p>Every Group card carries the same pieces of information:</p>
<ul>
<li><b>Name</b> across the top.</li>
<li><b>Text box</b>: flavour and, above all, the Group's <b>special ability</b>. Every Group has one.</li>
<li><b>Power</b>, the big number near the bottom. Sometimes printed as two numbers such as <b>6/2</b>: the first is Power, the second is <b>Global Power</b>.</li>
<li><b>Resistance</b>, the second big number.</li>
<li><b>Alignments</b> in the bottom-left corner (none, one or several).</li>
<li><b>Attributes</b> in italics in the bottom-right corner.</li>
<li><b>Control arrows</b> on the edges.</li>
</ul>
<h4>Power</h4>
<p>Power is muscle. A Group uses it when it leads an attack, and when it aids or opposes an attack on a Group whose alignments allow it to. Power is also what defends a Group against an Attack to Destroy.</p>
<ul>
<li>Changes to Power apply everywhere unless the card that makes them says otherwise.</li>
<li>Power can never fall below 0.</li>
<li>If Power is <i>reduced</i> to 0 the Group loses its Action tokens at once and gets none until its Power climbs back above 0. A Group whose <i>printed</i> Power is 0 still gets tokens normally.</li>
<li>An asterisk beside a number means the card text explains how it works.</li>
<li>Temporary bonuses (a +10 Plot, say) never count toward a Goal.</li>
</ul>
<h4>Global Power</h4>
<p>Global Power is influence that crosses every ideological line. A Group that is not allowed to help an attack with its Power, because it lacks the right alignment, may still help with its Global Power. A card without a second number has Global Power 0 and cannot help that way at all.</p>
<ul>
<li>Effects that change Power leave Global Power alone unless they say otherwise.</li>
<li>Global Power can never be higher than Power. If Power drops below it, Global Power sinks to match for as long as that lasts.</li>
</ul>
<h4>Resistance</h4>
<p>Resistance is loyalty: how hard it is to take the Group away from whoever controls it. It defends against an Attack to Control only. The Illuminati have no Resistance, because nobody can attack them.</p>
<h4>Alignments</h4>
<p>There are ten alignments. Matching alignments make it easier to take a Group over; clashing ones make it easier to destroy it. Eight of them come in opposite pairs:</p>
<table class="rb-table"><thead><tr><th>Alignment</th><th>Roughly means</th><th>Opposite</th></tr></thead><tbody>
<tr><td>Government</td><td>part of some state apparatus</td><td>Corporate</td></tr>
<tr><td>Corporate</td><td>business and money</td><td>Government</td></tr>
<tr><td>Liberal</td><td>the political left</td><td>Conservative</td></tr>
<tr><td>Conservative</td><td>the political right</td><td>Liberal</td></tr>
<tr><td>Peaceful</td><td>against the use of force</td><td>Violent</td></tr>
<tr><td>Violent</td><td>armed, dangerous, or both</td><td>Peaceful</td></tr>
<tr><td>Straight</td><td>mainstream and respectable</td><td>Weird</td></tr>
<tr><td>Weird</td><td>odd, fringe, unlike the neighbours</td><td>Straight</td></tr>
<tr><td>Criminal</td><td>lives by crime, fraud or force</td><td><i>none</i></td></tr>
<tr><td>Fanatic</td><td>true believers in one narrow creed</td><td><i>every other Fanatic Group</i></td></tr>
</tbody></table>
<p>Two Fanatic Groups always count as opposed to each other. That is the one oddity to remember.</p>
<p>Cards can add, remove or flip alignments, for a while or for good. A Group can never hold both halves of an opposite pair: if a Violent Group becomes Peaceful, it stops being Violent. Nor can it hold an alignment twice; making a Violent Group Violent again does nothing. An alignment change follows the card. A permanent one still describes the Group after it has been destroyed, which matters for Goals that count destroyed Groups of some alignment, while a temporary one lapses at its usual time. If a destroyed Group ever comes back into play, though, it returns with only its printed values (see ${see('timing', 'cards remember')}).</p>
<h4>Attributes</h4>
<p>Attributes are labels such as <i>Computer</i>, <i>Media</i>, <i>Magic</i>, <i>Science</i>, <i>Bank</i>, <i>Church</i>, <i>Green</i>, <i>Space</i>, <i>Communist</i>, <i>Nation</i>, <i>Huge</i>, <i>Coastal</i> and <i>Secret</i>. On their own they do nothing: a Computer Group gets no bonus against another Computer Group. They only matter when a card mentions them (“+5 to control any Media Group”), and <i>Secret</i> has special rules of its own (see ${see('immunity', 'Immunity and Secret Groups')}).</p>
<h4>Control arrows</h4>
<p>An Illuminati has four outgoing arrows, one on each edge. Every other Group has one incoming arrow and between none and three outgoing ones. A Group hangs from its <b>master</b> by laying its incoming arrow against one of the master's outgoing arrows; it is then that master's <b>puppet</b>. Cards may lie upright, upside down or sideways, as long as the arrows meet and no card overlaps another.</p>
<p>An outgoing arrow is <b>open</b> when no puppet sits on it and nothing else is in the space a puppet would fill there. You need an open arrow to take a Group over.</p>
${ex('reading The Mafia', `<p>The Mafia shows Power 6 (no second number, so Global Power 0) and Resistance 7, with the alignments Criminal and Violent and three outgoing arrows. It is strong in an attack, very hard to steal, and it can carry three puppets. It can help any attack on a Criminal or Violent target with its full 6, but it cannot help on any other target at all, having no Global Power.</p>`)}
<p>The Illuminati never have alignments or attributes, and they can never be destroyed except by losing every puppet.</p>
${app('cards have real 5 × 7 shapes: a card lying sideways on a side arrow can close a neighbouring arrow, exactly as it would on a table. Global Power is the small number after the slash, Resistance is the boxed number, and tapping a card shows its attributes and full text.')}
`,
  },
  {
    id: 'setup', part: 'Getting started', title: 'Setting up',
    blurb: 'Decks, the starting hand, the lead Group and who goes first.',
    body: `
<ol>
<li><b>Bring a deck.</b> Each player needs their own 45-card deck, counting the Illuminati they will start with.</li>
<li><b>Split it by the backs.</b> Plots (and any spare Illuminati) form the Plot deck; Groups and Resources form the Group deck.</li>
<li><b>Reveal Illuminati together.</b> Everyone lays their starting Illuminati face down, then all flip at once. Two players may pick the same one; they are then rival factions of one conspiracy (see ${see('duplicates', 'Duplicates and agents')}).</li>
<li><b>Draw three Plots.</b> Shuffle the Plot deck and draw three. You may read them, but nothing can be played until the first turn starts. They are your first hidden Plots.</li>
<li><b>Choose a lead Group.</b> Everyone searches their Group deck for one Group to be the first puppet, lays it face down, and all reveal together. It must be a Group, never a Resource. If two or more players picked the same Group, those copies are set aside and those players choose again, avoiding anything already chosen, until everyone has a lead (or has nothing left to pick). Place the lead on any arrow of your Illuminati.</li>
<li><b>Draw six Groups.</b> Shuffle the Group deck and draw six cards, or all of them if fewer remain. Only then are the set-aside duplicate leads shuffled back into their owners' decks.</li>
<li><b>Hands off the decks.</b> From now on nobody may look at or give away their own undrawn cards.</li>
<li><b>Roll for first player.</b> Everyone rolls two dice; the highest total goes first. Roll again to break ties.</li>
</ol>
<h4>First-turn protection</h4>
<p>Until a player has finished their first turn, nobody may do anything to them: no attacks on their Groups, no interfering in their attacks, no card aimed at them. Effects that hit everyone (a New World Order, say) and abilities that work all the time still apply to them.</p>
<p>There is one exception. If a player attacks you during their own first turn, you are free to answer that player in any way you can.</p>
${app('your deck and the computers\' decks are generated for you (see <i>Building a deck</i>). You choose your lead Group from a list and the Illuminati arrow it hangs from (the bottom one unless you pick another); the computers pick the strongest Group they can, and identical picks are re-chosen as above. The dice for first player are rolled for you, with ties rolled again. The first-turn exception applies: once a player attacks one of your Groups during their first turn, you may answer them with anything you have, while everyone else still leaves them alone until that turn ends. The Basic Goal is set on the start screen, where the book\'s number for the table size is filled in; change it only if everyone at a real table would agree.')}
`,
  },
  // ------------------------------------------------------------------ Playing a turn
  {
    id: 'turn', part: 'Playing a turn', title: 'The turn, step by step',
    blurb: 'Beginning, main phase and end: what you may do in each.',
    body: `
<p>A turn has three stages. The player whose turn it is is the <b>active player</b>, but everyone can take part: rivals play Plots, help or hinder attacks, and buy cards whenever the rules let them.</p>
<h4>Beginning of the turn</h4>
<ol>
<li><b>Draw a Plot</b> from the top of your Plot deck, if you want to. This is also a natural moment to cash in tokens left over from last round for extra Plots (see ${see('tokens', 'Action tokens')}).</li>
<li><b>Draw a Group card</b> from the top of your Group deck, if you want to.</li>
<li><b>Make one automatic takeover</b>, if you want to. Choose one Group or Resource in your hand and put it into play with no dice at all. A Group goes on any open arrow in your structure without overlapping anything; a Resource goes beside your structure. You cannot bring in a copy of a Group that is already in play, or of a Unique Resource already in play, unless a card allows it.</li>
<li><b>Refresh tokens.</b> Every Group you control that has no Action token gets one. So does every Resource with the word <i>Action</i> at its foot. Cards that grant extra tokens add theirs now.</li>
</ol>
<p>While these four steps are going on, you may spend tokens only to buy Plots, to power a Plot or ability that deals with one of these steps, or to answer something another player has just done. Plots and abilities that need no token are not limited this way.</p>
<h4>Main phase</h4>
<p>Now you may do any of the following, in any order and as often as you like, except where something says “once per turn”:</p>
<ul>
<li><b>Attack</b> to control or to destroy a Group, spending the attacking Group's token (${see('attacks', 'How an attack works')}).</li>
<li><b>Move</b> one of your Groups to another open arrow for one token (${see('structure', 'Moving Groups')}).</li>
<li><b>Make or move links</b> between your cards (${see('resources', 'Resources and links')}).</li>
<li><b>Play a Plot</b>, following its own instructions.</li>
<li><b>Bring in a Resource</b> from your hand by spending an Illuminati token. Once per turn.</li>
<li><b>Draw a Group card</b> by spending an Illuminati token. Once per turn.</li>
<li><b>Give or trade</b> a Resource you have in play, or cards from your hand (${see('deals', 'Deals, trades and gifts')}).</li>
<li><b>Get rid of cards</b>: discard any card from your hand, or put a Plot back into your Plot deck.</li>
<li><b>Aid or oppose</b> any attack, your own or anyone else's, unless something (such as Privilege) keeps you out.</li>
</ul>
<p>Spending every token and every Plot on your own turn leaves you nothing to defend with in everyone else's. Keeping a little back is usually wise.</p>
<h4>End of the turn</h4>
<ol start="5">
<li><b>Use end-of-turn effects</b>: anything that says it happens at the end of your turn (the Bermuda Triangle's free reorganisation, for example).</li>
<li><b>Knock.</b> Rap the table so everyone knows you are finished.</li>
<li><b>Victory claims.</b> Now any player, active or not, who meets one of their Goals may declare victory, and the others may try to stop it. Nobody can make an attack at this point unless a card allows one. The whole procedure is in ${see('victory', 'Goals and winning')}.</li>
</ol>
<p>If nobody wins, the next player begins their turn, and so it goes round the table until someone, or some alliance, wins.</p>
<p>If a card says your turn ends <i>immediately</i>, skip everything left, including the victory step: nobody can win on a turn that is cut short.</p>
<h4>“Any time” moves</h4>
<p>Some things may be done during any part of any turn, yours or not, unless a rule or card forbids it:</p>
<ul>
<li><b>Buying Plots</b> with tokens (1 Illuminati token, or 2 tokens from other Groups, per card). This is not an action, so it cannot be cancelled.</li>
<li><b>Using a special ability</b> of your Group or Resource, when its text allows.</li>
<li><b>Playing a Plot</b> whose text allows it.</li>
</ul>
${strict('the printed rules name the direction of play in two different ways (“to the left” and “counterclockwise”), which point in opposite directions at a round table. Agree on a direction before the first turn.')}
${app('play passes in seat order, the order players joined. At the start of your turn you tap the Plot deck and then the Group deck to draw (both optional); computer players always draw. The takeover step is a prompt you can skip. “Any time” cards can be played in your own main phase, in any response window and at the end of every turn, but not at an arbitrary moment of a rival\'s main phase. Actions outside attacks are announced so that rivals get a chance to answer, and every player gets an end-of-turn window before victory is checked. Online, a player who does not answer before the deadline passes.')}
`,
  },
  {
    id: 'tokens', part: 'Playing a turn', title: 'Action tokens',
    blurb: 'One action per Group per turn, and what the Illuminati\'s token buys.',
    body: `
<p>An Action token on a Group means it can still act. Spend it and the Group has done its thing for this round of play; it gets a new one at the start of your next turn, provided it has none by then.</p>
<h4>What a token pays for</h4>
<ul>
<li>Leading an attack.</li>
<li>Aiding or opposing an attack, in anybody's turn.</li>
<li>Using a special ability that says it costs an action.</li>
<li>Paying for a Plot that asks for an action.</li>
<li>Moving a Group.</li>
<li>Two tokens from your other Groups buy one Plot card (see below).</li>
</ul>
<p>So an ordinary Group does one of these things per round. Cards that grant extra tokens are what break that limit. A Group with two or more tokens still may not spend more than one of them on the same attack, unless it is the target defending itself.</p>
<h4>Refreshing and losing tokens</h4>
<ul>
<li>At the start of your turn, each of your Groups without a token gets one. A Group that already has one gets no more (unless a card says so).</li>
<li>Resources marked <i>Action</i> refresh the same way, but their tokens can never be traded for Plots.</li>
<li>A Group whose Power has been reduced to 0 loses its tokens and receives none until its Power rises again.</li>
<li>A Group you just captured arrives with no token and gets none that turn. A Group brought in by the automatic takeover does get one, because the takeover happens just before tokens are handed out.</li>
<li>You may take a token off one of your own cards whenever you like, if you ever have a reason to.</li>
</ul>
<h4>The Illuminati's token</h4>
<p>Your Illuminati's token is worth more than its Power. It can:</p>
<ul>
<li>buy a Plot card on its own, at any time;</li>
<li>bring a Resource into play from your hand (main phase, once per turn);</li>
<li>draw an extra Group card (main phase, once per turn);</li>
<li>pay for the many strong Plots and abilities that demand an Illuminati action.</li>
</ul>
<h4>Buying Plots</h4>
<p>At any time you may trade 1 token from your Illuminati, or 2 tokens from your other Groups, for the top card of your Plot deck. This is not an action by those Groups, and rivals cannot cancel it. A common habit is to cash in any tokens still unspent when your next turn comes round, just before the refresh gives you new ones.</p>
${ex('the rhythm of tokens', `<p>On your turn the Pentagon leads an attack and spends its token. During the next player's turn the Pentagon has nothing left, so it cannot defend itself or help your other Groups. Meanwhile your Federal Reserve, which sat still, can oppose an attack on any Government Group of yours in that turn. Either way it holds exactly one token again when your own turn begins (a Group that kept its token gets no second one), so acting in a rival's turn costs you nothing on your own.</p>`)}
${app('tokens are the gold dots on the cards. Buying a Plot is never announced to rivals, exactly as the rules say it cannot be answered. When you pay with non-Illuminati tokens, they must come from two different Groups; the printed rule only says “two tokens from your other Groups”. To take a token off one of your own Groups for your own reasons, select the Group and use <i>Remove its token</i>.')}
`,
  },
  {
    id: 'structure', part: 'Playing a turn', title: 'Your Power Structure and moving Groups',
    blurb: 'Masters and puppets, why position matters, and how to rearrange.',
    body: `
<p>Your Illuminati sits in the middle. Groups hanging straight from it are its puppets; Groups hanging from those are one step further out, and so on. Every Group a player controls, directly or through other Groups, belongs to their Power Structure.</p>
<p>Distance from the centre matters for defence: a Group resting directly on an Illuminati arrow gets +10 when attacked, a Group one step further out gets +5, and anything further out gets nothing (see ${see('control', 'Attack to Control')}).</p>
<h4>No dropping Groups</h4>
<p>Once a Group is in your structure it stays until something removes it: an attack, a card, a move. You cannot simply discard it. (You could not, for example, throw away your Peaceful Groups to stop a rival's Peaceful-counting goal.)</p>
<h4>Moving a Group</h4>
<ul>
<li>During the main phase of your own turn you may move any Group you control to an open arrow.</li>
<li>Its puppets, and their puppets, travel with it and keep the same positions relative to their masters.</li>
<li>It costs one token, taken from whichever you prefer: the Group being moved, its old master, its new master, or your Illuminati.</li>
<li>If the move would make cards overlap, you may shift any of the travelling puppets to other arrows as long as each keeps the same master. Any card that still has no room drops out of the structure and returns, with its own puppets, to whoever controlled it before the move.</li>
<li>Moving a Group underneath a Devastated Place strips its tokens and stops it counting for victory; moving it out again frees it (see ${see('devastation', 'Devastation and Relief')}).</li>
</ul>
<h4>Handing a Group to another player</h4>
<p>If both players agree, a Group can be moved into the other player's structure during the main phase of either one's turn. It still costs a token, which may come from the Group, its old master, its new master, or either player's Illuminati.</p>
<h4>Balance</h4>
<p>A Group carrying a long chain of puppets is a single point of failure: whoever captures it captures the lot. If everything you own hangs off one Illuminati arrow, one lucky attack can knock you out. Spread out.</p>
${app('you can move a Group only within your own Power Structure (the printed rules speak of “any open arrow on any Group in play”, which the app reads as your own). Handing a Group to another player is done with a deal (see <i>Deals, gifts and trades</i>). When a move leaves puppets without room, the app first tries the other free arrows of the same master; if any Group had to change arrows or still has no room, you get an <i>Arrange the new Groups</i> panel where you may put each one on another open arrow of its own master, and anything still without room goes back to your hand when you tap Done. Computer players keep the first arrangement.')}
`,
  },
  // ------------------------------------------------------------------ Attacks
  {
    id: 'attacks', part: 'Attacks', title: 'How an attack works',
    blurb: 'Announcing, committing, the back-and-forth, and the roll of 2d6.',
    body: `
<p>An attack is one Group spending its token to try to take over, or to wipe out, another Group. Success is decided by rolling two dice: you want to roll <b>low</b>.</p>
<h4>The two kinds of attack</h4>
<ul>
<li><b>Attack to Control</b>: take a Group from a rival's structure, or bring one into play from your own hand. The target resists with its <b>Resistance</b>.</li>
<li><b>Attack to Destroy</b>: remove a Group in play from the game. The target resists with its <b>Power</b>.</li>
</ul>
<p>There is no third kind of ordinary attack. Cards add special versions: <b>Instant attacks</b>, including Disasters and Assassinations (${see('instant', 'Instant attacks')}), and <b>Privileged</b> attacks (${see('privileged', 'Privileged attacks')}).</p>
<h4>Who and what can be attacked</h4>
<ul>
<li>Any Group may attack any Group, whatever the alignments. Alignment only decides bonuses and who may join in.</li>
<li>The Illuminati may attack, but can never be attacked. The only way to destroy one is to strip away all of its puppets.</li>
<li>Resources cannot be attacked in the normal way; only cards that say so can harm them.</li>
<li>Attacks are made in the main phase of your own turn, unless a card lets you attack at another moment.</li>
</ul>
<h4>1. Announce</h4>
<p>Say which Group attacks, which kind of attack, and the target: “Wall Street attacks to control the Savings and Loans.” Then spend the attacker's token.</p>
<h4>2. The back-and-forth</h4>
<p>Now everyone may act, in any order and as many times as they are able: the defender opposes, the attacker adds aid, a third player chips in for one side, someone plays a Plot, someone cancels that Plot... Nothing is final until every player has passed: only then is the strength fixed. Who may help and how is in ${see('helping', 'Aiding, opposing and defending')}.</p>
<h4>3. Calling it off</h4>
<p>After announcing, the attacker may change their mind and call the attack off, up to the moment they <b>commit</b>: playing a Plot, playing an agents card, or taking a token off a Group. After that the attacker must go through with everything committed. Once the attack is committed, cards and tokens rivals throw in are committed too, unless the attacker lets them take them back. If the attack is called off before commitment, everyone who joined gets their cards and tokens back, and a target from the attacker's hand returns to that hand. An attack launched by a Plot card is committed from the start and can never be called off.</p>
<h4>4. The roll</h4>
<ul>
<li>Work out the <b>strength</b>: the attacking side's total minus the defending side's total, as described for each kind of attack.</li>
<li>If the strength is below 2 the attack fails at once. No dice are rolled, so cards that change dice cannot help.</li>
<li>Otherwise the attacker rolls two dice. A total equal to or below the strength succeeds.</li>
<li>An <b>11 or 12 always fails</b>, however large the strength.</li>
</ul>
<table class="rb-table rb-odds"><thead><tr><th>Strength</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th><th>8</th><th>9</th><th>10+</th></tr></thead><tbody>
<tr><td>Rolls that win (of 36)</td><td>1</td><td>3</td><td>6</td><td>10</td><td>15</td><td>21</td><td>26</td><td>30</td><td>33</td></tr>
<tr><td>Chance</td><td>3%</td><td>8%</td><td>17%</td><td>28%</td><td>42%</td><td>58%</td><td>72%</td><td>83%</td><td>92%</td></tr>
</tbody></table>
<h4>Order of arithmetic</h4>
<p>When several effects change one number, apply them in this order:</p>
<ol>
<li>anything that <b>sets</b> the number to a value (“Power becomes 6”);</li>
<li>then <b>one</b> multiplier or divider: only the single largest counts, the rest are ignored;</li>
<li>then every addition and subtraction.</li>
</ol>
<h4>Limits on doubling up</h4>
<ul>
<li>A Group spends at most one token on any one attack, unless it is the target defending itself.</li>
<li>No player may use two copies of the same Plot in one attack, on either side, even to help two different Groups. A copy that got cancelled does not count, so you may try again with another.</li>
</ul>
<h4>Bonuses: “any attempt” and “direct”</h4>
<ul>
<li>An <b>“any attempt”</b> bonus on a card helps every attack of that kind made by <i>any</i> of your Groups, even when the card with the bonus takes no part. You gain it the moment you gain that card and lose it the moment you lose it. It never helps someone else's attack, even when you aid it.</li>
<li>A <b>direct</b> bonus helps only when that very Group leads the attack, not when it merely aids.</li>
<li>If one card has both kinds for the same situation they do not add together; use the larger.</li>
<li>Ordinary attack bonuses do not affect Instant attacks unless they say so.</li>
</ul>
<h4>Forgotten bonuses</h4>
<p>Declare your bonuses. One you forget is lost once the dice have been rolled. If a player keeps quiet about a free bonus on purpose and a rival points it out, it must be counted; but nobody can be forced to use a bonus that has a cost, such as a token or a discard.</p>
<h4>No speed play</h4>
<p>You may not announce and roll in one breath. Everyone must get a real chance to react before the dice are thrown. See also ${see('timing', 'Timing')}.</p>
${app('calling off is offered until you commit: a Plot, an agents card, one of your own Groups aiding or opposing, or a token you took off a card during the attack. The app keeps every bonus that costs nothing on the scoreboard for you, so nothing is ever forgotten, and it shows the chance of success before you roll. A +10 Plot that boosts the attacker is played when you declare the attack. Every player gets a response window before the dice, and the attack meter shows the strength as it changes.')}
`,
  },
  {
    id: 'control', part: 'Attacks', title: 'Attack to Control',
    blurb: 'Stealing a Group or taking one over from your hand.',
    body: `
<p>An Attack to Control tries to put the target into your Power Structure. The target is either a Group in a rival's structure or a Group card from your own hand.</p>
<h4>Requirements</h4>
<ul>
<li>The attacking Group spends its token.</li>
<li>It must have an <b>open outgoing arrow</b> for the target to hang from. A Group with no open arrow cannot attack to control.</li>
<li>The target cannot be an Illuminati.</li>
</ul>
<h4>Working out the strength</h4>
<p>Start from the attacker's <b>Power</b> and subtract the target's <b>Resistance</b>. Then apply:</p>
<ul>
<li><b>Alignment match</b>, for the attacking Group only: <b>+4</b> for each alignment the attacker and the target share, <b>−4</b> for each opposite pair between them. Remember that two Fanatic Groups are opposed.</li>
<li><b>Loyalty to the master</b>: the target adds <b>+4 Resistance</b> for each alignment it shares with its master. Fanatic never counts here, since two Fanatics oppose each other. Opposite alignments with the master do not matter. A puppet of an Illuminati gets nothing from this, as the Illuminati have no alignments.</li>
<li><b>Position</b>: +10 to the defence if the target hangs directly from its Illuminati, +5 if it is one Group further out, 0 beyond that.</li>
<li><b>Help</b>: add aiding Power to the attack and opposing Power to the defence.</li>
<li><b>Cards</b>: special abilities, Plots and Resources as they state.</li>
</ul>
<p>A target from your hand is not in anyone's structure, so it gets no loyalty or position bonus.</p>
<h4>If it fails</h4>
<ul>
<li>A rival's Group simply stays where it was.</li>
<li>A Group from your hand: you may try again this turn with another attack, if you have actions left. If it is still not yours when your turn ends, your people inside it have been found out and the card goes to your discard pile. Because it never entered play, a copy can still be played later, by anyone. Carrying a second copy of a key Group gives you another chance.</li>
</ul>
<h4>If it succeeds</h4>
<ul>
<li>The target is captured: place it with its incoming arrow on an outgoing arrow of the Group that attacked it.</li>
<li>Its puppets, and theirs, come too, keeping the same layout. If that causes overlaps you may rearrange the newly arrived cards, each keeping its own master; any that still cannot fit are discarded.</li>
<li>Resources and Plots linked to the captured Groups come along.</li>
<li>Captured Groups lose any tokens they had and get none this turn, unless a card says otherwise.</li>
</ul>
${ex('the C.I.A. reaches for the Secret Service', `
<p>A rival's Pentagon (Straight, Violent, Government) hangs directly from their Illuminati, and the Secret Service (Power 2, Resistance 3, Violent, Government) hangs from the Pentagon. You attack to control the Secret Service with your C.I.A. (Power 6, Violent, Government), which has an open arrow.</p>
<ul>
<li>Attack: Power 6, plus 4 + 4 for the two alignments it shares with the target = <b>14</b>.</li>
<li>Defence: Resistance 3, plus 4 + 4 for sharing Violent and Government with its master, plus 5 for being one step from the Illuminati = <b>16</b>.</li>
<li>Strength 14 − 16 = −2. Hopeless as it stands.</li>
</ul>
<p>You aid with your FBI, which shares Government with the target: +4. You play Martial Law on the C.I.A. (a Government Group) for +10. The attack is now 28, strength 12. The rival opposes with the Pentagon, the target's master, adding its Power 6, and then the Secret Service spends its own token to defend itself: its Power 2 is doubled to 4. Defence is now 26, and the strength is 2. You need to roll exactly 2.</p>`)}
${app('a Group from your hand that failed its takeover stays beside you for further tries this turn and is discarded when you end the turn, just before the end-of-turn window, so cards that react to a discard can be played then. The app never lets you attack your own Group to control (you already control it).')}
`,
  },
  {
    id: 'destroy', part: 'Attacks', title: 'Attack to Destroy',
    blurb: 'Removing a Group from the game, and who gets the credit.',
    body: `
<p>An Attack to Destroy works like an Attack to Control, with these differences:</p>
<ol>
<li><b>Power against Power.</b> The target defends with its Power, not its Resistance. Its position bonus still applies, but the loyalty bonus for sharing alignments with its master does not, because that bonus raises Resistance.</li>
<li><b>Alignments reversed.</b> Groups that disagree destroy each other easily: <b>+4</b> for each opposite pair between attacker and target, <b>−4</b> for each alignment they share.</li>
<li><b>Aid needs a clash.</b> To aid, a Group needs at least one alignment <i>opposite</i> to the target's. Opposing works exactly as for control. Global Power may be used either way.</li>
<li><b>No open arrow needed.</b> The attacker has nowhere to put the target, so it needs no free arrow.</li>
<li><b>Only Groups in play.</b> You cannot destroy a card from your hand.</li>
<li><b>Your own Groups are fair game.</b> You may attack to destroy a Group in your own structure; it then gets no position bonus. A Group can never be the target of its own attack, nor help one against itself.</li>
<li><b>Illuminati are still off limits.</b></li>
</ol>
<h4>After a success</h4>
<ul>
<li>The target leaves play for good. Put it in <i>your</i> destroyed pile: many Goals count destroyed Groups, so everyone must know who destroyed what. If a card later says the Group no longer counts as destroyed, take it out of the pile.</li>
<li>Its puppets (and theirs) are not destroyed. They are stripped of their tokens and return to the hand of whoever controlled the destroyed Group.</li>
<li>Resources linked to it are destroyed too; Plots linked to it are discarded.</li>
<li>If it ever returns to play, it comes back with its printed values only.</li>
<li>A Personality destroyed this way is out of play but not <i>killed</i>; only an Assassination kills (see ${see('instant', 'Instant attacks')}).</li>
</ul>
${ex('Texas against the Anti-War Activists', `
<p>Your Texas (Power 6, Violent, Conservative, Government) attacks to destroy a rival's Anti-War Activists (Power 1, Peaceful, Liberal), which hang directly from the rival's Illuminati.</p>
<ul>
<li>Attack: 6, plus 4 for Violent against Peaceful and 4 for Conservative against Liberal = <b>14</b>. No shared alignments, so no penalty.</li>
<li>Defence: Power 1 plus 10 for position = <b>11</b>. Strength 3.</li>
<li>Your Gun Lobby (Power 1, Violent, Conservative) aids, since it clashes with the target: strength 4.</li>
<li>The rival opposes with the Democrats (Power 6, Liberal), who share Liberal with the target: strength −2. Unless you find 4 more, the attack fails without a roll.</li>
</ul>`)}
${app('destroyed Groups go to the destroyer\'s tally, which Goals and Special Goals read automatically. A destroyed Group\'s puppets return to their controller\'s hand without tokens, and its linked Resources are destroyed with it.')}
`,
  },
  {
    id: 'helping', part: 'Attacks', title: 'Aiding, opposing and defending',
    blurb: 'Who may join an attack, Global Power, and self-defence.',
    body: `
<p>Any Group except the attacker may join an attack by spending its token: <b>aiding</b> adds its Power to the attack, <b>opposing</b> adds it to the defence. It does not need an open arrow. The attacker's and defender's own Groups usually take the obvious sides, but nothing forces them to, and players who are neither attacker nor defender may join either side, unless the attack is Privileged. This is where deals are struck.</p>
<h4>Who may join with full Power</h4>
<table class="rb-table"><thead><tr><th></th><th>Attack to Control</th><th>Attack to Destroy</th></tr></thead><tbody>
<tr><td>Aid</td><td>shares at least one alignment with the target</td><td>has at least one alignment opposite to the target's</td></tr>
<tr><td>Oppose</td><td colspan="2">shares at least one alignment with the target, <i>or</i> is the target's master, <i>or</i> is one of its puppets, <i>or</i> is the target itself</td></tr>
</tbody></table>
<p>A Group that does not qualify may still join using its <b>Global Power</b>. If its Global Power is 0, it cannot join at all.</p>
<p>Helpers never get alignment bonuses or penalties. Those belong to the Group leading the attack alone. It does not matter whether a helper has one matching alignment or three, or whether it also clashes with the target: it adds its Power, and that is that.</p>
<h4>Defending yourself</h4>
<p>The target may spend its own token to oppose. An action spent in self-defence is worth more: its Power is doubled. If something already doubles that Group's Power, self-defence makes it triple instead; if it was already tripled, quadruple; and so on, always one step above the biggest multiplier in force. A target holding several tokens may spend all of them in its own defence, and each one gets the bonus.</p>
<p>A bonus that counts “for defence” is for protecting your own structure. It does not apply when you oppose an attack on somebody else's Group.</p>
<h4>Agents</h4>
<p>If you hold a copy of the attacked Group in your hand, you can play it as <b>agents</b>: +10 to the attack or −6 to it. Only one agents card per attack, and never by the player who controls the real Group. Full rules in ${see('duplicates', 'Duplicates and agents')}.</p>
${ex('Global Power', `<p>A rival attacks to control your Democrats (Liberal). Your Madison Avenue (Power 3/3, Corporate) has no alignment in common with them and is neither their master nor their puppet, so it cannot oppose with its Power, but it can oppose with its Global Power of 3. Your Multinational Oil Companies (6/4, Corporate) would add 4 the same way. Your Cattle Mutilators (2/0) could not help at all.</p>`)}
${ex('the order of arithmetic in a defence', `<p>Your Pentagon (Power 6, Straight, Violent, Government) carries Cyborg Soldiers, which double a Violent Group's Power, and Law and Order is in play, giving Straight Groups +2. Its Power is 6 × 2 + 2 = 14. A rival attacks to destroy it. If the Pentagon spends its own token to defend, that action is tripled rather than doubled (one step above the Cyborg Soldiers): 6 × 3 + 2 = 20. The Pentagon's total defence is its Power 14, plus the 20 from its own action, plus any position bonus.</p>`)}
${app('the app offers only the Groups that are allowed to help, and uses Global Power automatically (capped at the Group\'s Power) when full Power is not allowed. Self-defence raises the multiplier one step, before additions, as above.')}
`,
  },
  {
    id: 'privileged', part: 'Attacks', title: 'Privileged attacks',
    blurb: 'Closed fights between attacker and defender only.',
    body: `
<p>Some cards and abilities let an attacker keep everyone else out of a fight. The attack must be declared <b>Privileged</b> when it is first announced (say “Privilege!” out loud); it cannot be made Privileged later.</p>
<ul>
<li>Only the attacker and the defender may take part. No other player may spend actions, play Plots or use abilities for either side, not even to cancel the attack.</li>
<li>If the target comes from the attacker's own hand there is no defender, so nobody else may take part at all.</li>
<li>While it lasts, no cards may be handed or traded to the attacker or the defender.</li>
<li>New World Orders cannot be played during a Privileged attack.</li>
<li>Any player may use a card or ability that <b>removes</b> the Privilege (Deep Agent, for instance). The attack then becomes an ordinary free-for-all, and it cannot become Privileged again.</li>
<li>A few cards let particular Groups or players join a Privileged attack anyway (Interference, The Frog God, the Moonies) without removing the Privilege for everyone else.</li>
<li>Once the attack itself is over, anyone may still use cards that change the <i>die roll</i>. That does not count as interfering.</li>
</ul>
${ex('closing the door', `<p>The Bavarian Illuminati may make one Privileged attack per turn without any card. Their player announces “The Bavarian Illuminati attack to control the Supreme Court — Privilege!” Now only the Supreme Court's owner may respond. A third player holding Deep Agent can play it to throw the fight open to everyone, and from then on anybody may aid or oppose.</p>`)}
${app('Privilege is chosen when you declare the attack (a tick box appears when a card or ability allows it). Cards that negate Privilege or let someone interfere work as printed.')}
`,
  },
  {
    id: 'instant', part: 'Attacks', title: 'Instant attacks, Assassinations and Disasters',
    blurb: 'Attacks launched by cards, at almost any moment.',
    body: `
<p>An <b>Instant attack</b> is a special Attack to Destroy launched by playing a card. Assassinations and most Disasters are Instant. Unless the card says otherwise it can be played at any moment, not only in your main phase: a classic use is to knock out one of a rival's Groups while they are trying to win.</p>
<h4>How it is worked out</h4>
<ul>
<li>Strength is the <b>card's Power</b> minus the <b>target's Power as it stands at the moment the card is played</b>. Boosts to the target played afterwards are too late.</li>
<li>The target gets its usual position bonus (+10 or +5), unless the target's own controller launched the attack.</li>
<li>No other modifier applies unless it mentions Instant attacks, Assassinations or Disasters by name. But something that forbids an attack outright also forbids an Instant one.</li>
<li>No Group may spend an action to make, aid or oppose an Instant attack unless a card specifically allows it. When a card does let a Group add its action, +10 Plots and similar boosts may be used on that action.</li>
<li>The target cannot spend a single token, not even in self-defence, while the attack is being resolved.</li>
<li>Two Instant attacks cannot be combined unless a card says so.</li>
<li>The attack cannot be called off. It can be cancelled by a suitable card, and then it never happened.</li>
</ul>
<h4>Assassinations</h4>
<p>An Assassination is an Instant Attack to Destroy against a <b>Personality</b>. A Personality destroyed by an Assassination is <b>killed</b>: only cards that specifically restore killed or assassinated Personalities can save it or bring it back. A Personality destroyed by an ordinary attack is merely broken, and can come back like any destroyed Group.</p>
<h4>Disasters</h4>
<p>A Disaster attacks a <b>Place</b>, usually as an Instant attack (a few, such as Epidemic and Giant Kudzu, are ordinary attacks that anyone may join). Many only strike certain Places, such as Coastal or non-Huge ones, and their Power often depends on the target.</p>
<ul>
<li>As soon as the Disaster is played, the target loses one Action token if it has any. It gets it back if the Disaster is cancelled.</li>
<li>A success usually <b>Devastates</b> the Place (${see('devastation', 'Devastation and Relief')}). A really good roll, beating the needed number by the margin on the card, destroys it outright.</li>
</ul>
${ex('Sniper', `<p>A rival controls Ross Perot (Power 2), hanging directly from their Illuminati: his defence is 2 + 10 = 12. You play Sniper (Power 10) against him: 10 − 12 = −2, a sure failure. But Sniper lets one Government Group add its Power, so your C.I.A. (Power 6) spends its token to join: 16 − 12 = 4. Ross Perot's owner cannot spend any token to defend. Their only hope is a cancel: they play Hoax, paying with Groups of total Power 6 or more and discarding the top card of their Plot deck, and the Sniper shot never happened.</p>`)}
${ex('Earthquake', `<p>Earthquake has Power 12 against a Huge Place and 16 against any other. You play it against a rival's Canada (Power 3, Huge), one step out from their Illuminati: defence 3 + 5 = 8, strength 12 − 8 = 4. Canada loses a token the moment the card hits the table. On a roll of 4 or less Canada is Devastated. To destroy it outright you would need to beat the needed roll by more than 5, which is impossible at strength 4.</p>`)}
${app('two Instant attacks can never overlap. The target\'s Power is frozen at the moment the card is played, and a Disaster\'s token is taken at once and returned if the Disaster is cancelled.')}
`,
  },
  {
    id: 'devastation', part: 'Attacks', title: 'Devastation and Relief',
    blurb: 'What a Devastated Place loses, and how to restore it.',
    body: `
<p>When a Place is <b>Devastated</b>, mark it. From then on, until it gets Relief:</p>
<ul>
<li>It loses its Action tokens, as does every Group below it on that branch, however far down.</li>
<li>None of those Groups can get tokens.</li>
<li>None of them count toward victory.</li>
<li>Against an Attack to Destroy the Place counts only half its Power, rounded down.</li>
<li>Being Devastated again has no further effect.</li>
</ul>
<p>Moving a Group away from the Devastated Place (${see('structure', 'Moving Groups')}) frees it. Moving a Group into that branch is allowed too, but it then loses its tokens and stops counting.</p>
<p>Devastation stays with the card. A Devastated Place sent back to its owner's hand is still Devastated when it next comes into play.</p>
<h4>Relief</h4>
<p>Relief restores a Devastated Place to normal. Spend actions whose Power adds up to at least <b>three times the Place's printed Power</b>. The actions may come from one or more players, at any time, provided they are all spent together. The Place and everything below it count again and can receive tokens again at the next refresh.</p>
${ex('Relief for Canada', `<p>Canada's printed Power is 3, so Relief costs actions totalling 9 Power. The Democrats (6) and the Red Cross (2) come to 8, not enough; add the United Nations (1) and it is exactly 9. The Center for Disease Control can do the whole job alone with its special ability.</p>`)}
${app('Relief may be paid by one player or by several at once. A player who cannot pay alone uses <i>Pledge Groups</i> to offer some of their Groups toward it; nothing is spent yet. Whoever sends the Relief may include those pledges, and then every pledged Group and the sender\'s own Groups spend their tokens together. A pledge can be changed or withdrawn at any time and lapses when the turn ends. Computer players use pledges made toward their own Places but do not pledge for others. Under the Plot Corruption, the Relief just sent is cancelled, the Place stays Devastated, and no new Relief may be tried there until after that player\'s next turn (a house ruling on an unclear card).')}
`,
  },
  // ------------------------------------------------------------------ Cards and schemes
  {
    id: 'plots', part: 'Cards and schemes', title: 'Plot cards',
    blurb: 'Getting, holding, exposing and playing Plots; the hand limit.',
    body: `
<p>Plots are the schemes and dirty tricks of world domination. Each card says when it may be played, what it costs and what it does.</p>
<h4>Getting Plots</h4>
<ul>
<li>One free draw at the start of your turn.</li>
<li>Any time: 1 Illuminati token, or 2 tokens from other Groups, buys one more.</li>
<li>Some cards draw extra Plots, let you search your deck, or steal from rivals.</li>
<li>Drawing is never compulsory, and running out of cards carries no penalty.</li>
</ul>
<h4>Playing Plots</h4>
<ul>
<li>Some Plots work any time; others only at certain moments or in response to certain events. Some work automatically; some need a roll.</li>
<li>Costs (tokens, discards) are paid by the player using the Plot, unless it says otherwise.</li>
<li>A played Plot stays on the table while it works, then goes to the discard pile. A Plot used in an attack is discarded once the attack is resolved. Linked Plots and New World Orders stay until something removes them.</li>
<li>A <b>free action</b> or <b>free move</b> costs nothing at all.</li>
</ul>
<h4>Hidden and exposed</h4>
<p>Plots in your hand are <b>hidden</b>. Some cards <b>expose</b> them: an exposed Plot lies face up in front of you, where everyone can read it and where some cards can steal it or make you discard it. It stays exposed until it is played, returned to the deck, stolen, discarded, or hidden again by a card.</p>
<ul>
<li>You may expose your own Plots whenever you like.</li>
<li>You may show a hidden Plot privately to one rival and keep it hidden. They may tell others what they saw, or lie about it.</li>
<li>If anyone asks, you must say how many hidden Plots you hold.</li>
</ul>
<h4>The hand limit</h4>
<ul>
<li>When it is <b>not</b> your turn you may hold at most <b>5 Plots</b>, hidden and exposed together. During your own turn there is no limit.</li>
<li>If you go over, get rid of the excess straight away: play, give or trade them, discard them, or return them to your deck.</li>
<li>Plots you have put on the table (an NWO, a linked Plot) have left your hand and do not count.</li>
<li>Some cards raise your limit (the Gnomes of Zurich hold 6) or let certain Plots sit outside it.</li>
<li>Group and Resource cards in hand have no limit.</li>
</ul>
<h4>Getting rid of Plots</h4>
<ul>
<li>You may discard any card from your hand at any time. Discards go face up.</li>
<li>You may put a Plot back into your Plot deck, anywhere you like: top, bottom or middle, depending on when you want to see it again. Only Plots can go back; Groups and Resources cannot.</li>
<li>Neither is allowed in the middle of drawing several cards, or right after someone uses a card to look at or steal your cards. At that point the only thing you can do is play a card that counters the snooping card itself.</li>
<li>A discarded card is out of play for good, unless a card immediately fetches it back.</li>
</ul>
<h4>Families of Plots</h4>
<ul>
<li><b>+10 Plots</b> (Martial Law, Terrorist Nuke, Benefit Concert and their cousins) give one of your Groups of a certain type +10. Played as an action is announced, the +10 boosts that one action and ends when it is resolved. Played defensively, it adds to the Group's defence until the end of the turn and counts only for defence. Either way it never counts toward a Goal, and it counts only once for any single action or defence, even if the Group spends several tokens.</li>
<li><b>Power Increase Plots</b> link to a Group of a certain type and raise its Power <i>to</i> a stated value. They do nothing to a Group already at or above that value.</li>
<li><b>Attribute Freeze</b>: stops every Group with a named attribute from acting for the rest of the turn (except to defend itself), or cancels one action by such a Group.</li>
<li><b>Paralyze</b>: a paralysed Group cannot spend tokens or use its abilities or linked Resources, does not count for Goals, and cannot receive new puppets. Its existing puppets are unaffected.</li>
<li><b>Zap</b>: affects a whole Power Structure until removed. Any player may pay an Illuminati action, whenever they like, to clear every Zap off one player.</li>
<li><b>Reload</b> cards (per later corrections) need an Illuminati action and refresh at most 5 Power's worth of Groups, or any single Group. None may refresh a Group captured this turn.</li>
<li><b>Cancels</b> such as Hoax and Secrets Man Was Not Meant To Know stop another Plot as it is played (${see('timing', 'Timing and cancelling')}).</li>
</ul>
${app('rivals always see how many hidden Plots you hold, never which. The hand limit is checked the moment a player outside their own turn goes over it, even in the middle of someone else\'s action, and the extra Plots can go to the discard pile or back into the deck. At any other time you can also discard cards, return Plots to the top, middle or bottom of your deck, expose a Plot, or show one hidden Plot to a single rival, with the <i>Discard or return cards from my hand</i> button. A spare Illuminati card drawn from the Plot deck counts as one of your Plots for all of this. Buying Plots is never announced. The card set in this app contains no Zap, Paralyze or Attribute Freeze cards.')}
`,
  },
  {
    id: 'resources', part: 'Cards and schemes', title: 'Resources and links',
    blurb: 'Relics and devices beside your structure, and how links work.',
    body: `
<p>Resources are secret tools: artifacts, gadgets, forbidden knowledge. They come from your Group deck and have the same back as Groups.</p>
<h4>Bringing Resources into play</h4>
<ul>
<li>With your automatic takeover at the start of your turn.</li>
<li>Once per turn in your main phase, by spending an Illuminati token.</li>
<li>With a card that says so.</li>
</ul>
<p>Resources have no arrows and never join the Power Structure; they lie beside it. They cannot be attacked in the ordinary way, though some cards can steal or destroy them. Every Resource has a special ability; its costs are paid by its owner. A destroyed Resource stops working at once.</p>
<h4>Types of Resource</h4>
<ul>
<li><b>Artifact</b>: an ancient and mysterious object.</li>
<li><b>Gadget</b>: a device beyond ordinary technology.</li>
<li><b>Magic</b>: any attack using a Magic Group, Plot or Resource counts as a Magic attack. Some targets are immune to Magic attacks; some can be touched only by them.</li>
<li><b>Unique</b>: only one copy may ever be in play. Whoever plays it first has it. Once it is destroyed, no copy may be played again unless a card brings it back.</li>
</ul>
<p>A Resource that is not Unique may be in play any number of times, and each copy works independently. Some Resources carry an <i>Action</i> label and get tokens like Groups do.</p>
<p>If you hide a Unique Resource face down (under Warehouse 23), you must reveal it as soon as someone tries to play a copy. If you do not, they keep theirs, and you must discard yours if it is ever revealed.</p>
<h4>Links</h4>
<p>A <b>link</b> joins two cards. In the main phase of your turn you may link two cards you control that are in play; mark both with matching markers. Common links:</p>
<ul>
<li>A Resource linked to a Group other than your Illuminati: the Resource now belongs to that Group and lends it its ability. Every Resource not linked elsewhere is linked to your Illuminati.</li>
<li>A Plot that changes one Group, linked to it to show the change is in force.</li>
<li>A Personality linked to a Place, when either card rewards the pairing.</li>
</ul>
<p>What happens to linked Resources:</p>
<ul>
<li>If the Group is captured, its linked Resources go with it to the new owner.</li>
<li>If the Group is destroyed, its linked Resources are destroyed and linked Plots discarded.</li>
<li>Effects that shut down the Group also shut down Resources linked to it.</li>
</ul>
<h4>Moving links</h4>
<ul>
<li>A Plot linked to a Group is linked for good. So is a Resource whose text says its link is permanent. Neither can be moved unless a card says so.</li>
<li>Other links may be moved in the main phase of your turn, each at most once per turn.</li>
<li>Once a linked card has given its benefit this turn (an extra token, an extra draw, a bonus), it cannot be re-linked or given away until next turn.</li>
</ul>
<h4>Illegal links</h4>
<p>A link is illegal if it breaks a rule or contradicts either card's text.</p>
<ul>
<li>A link that is illegal only for now (the Group's alignment was changed until the end of the turn, say) is not lost; the card simply does nothing until the link is legal again.</li>
<li>A Plot whose link becomes illegal for good is discarded.</li>
<li>A Resource whose link becomes illegal for good stays in play. If its link was permanent it sits there inactive, waking up if the link ever becomes legal again; otherwise its owner re-links it in their next main phase.</li>
</ul>
${ex('a link that goes quiet', `<p>Cyborg Soldiers are linked to your Violent Semiconscious Liberation Army, doubling its Power. A rival uses the Orbital Mind Control Lasers to flip it from Violent to Peaceful until the end of the turn. The link is now illegal, but only for a while: the Cyborg Soldiers stay linked and do nothing, then start working again when the alignment change expires.</p>`)}
${app('Resources come into play by your takeover, once per turn for an Illuminati token, or by cards. Link restrictions on cards are enforced and each link moves at most once per turn. A Resource counts as used for the turn once one of its abilities is used or once it gives a benefit: a bonus in an attack (including Power it lends to a Group taking part), an extra token or an extra draw. After that its link cannot be moved and it cannot be given away until the next turn. When someone tries to play a Unique Resource while a copy lies face down under your Warehouse 23, the app asks you at once: show it (the play fails, and the rival pays nothing) or keep it hidden (the rival gets the Resource, and yours is discarded if you ever turn it face up). Computer players always show it.')}
`,
  },
  {
    id: 'nwo', part: 'Cards and schemes', title: 'New World Orders',
    blurb: 'Lasting changes to the rules for everyone.',
    body: `
<p>A <b>New World Order</b> (NWO) is a special Plot that changes the world. When played it goes to the middle of the table and affects every player, including the one who played it.</p>
<ul>
<li>It may be played whenever you like, with one restriction: never while an Instant or a Privileged attack is being fought.</li>
<li>Each NWO has a colour: <b>red</b>, <b>blue</b> or <b>yellow</b>. Only one of each colour may be in force, so there are never more than three.</li>
<li>Playing an NWO of a colour already in force discards the old one.</li>
<li>You may even play a card identical to the one in force; it replaces it and becomes the most recent NWO, which can matter when effects combine.</li>
<li>An NWO stays until another of its colour replaces it or a card cancels it.</li>
<li>When NWOs interact in an unclear way, resolve them one by one, oldest first.</li>
<li>Changes made by NWOs are permanent while they last, so they count toward Goals.</li>
</ul>
${ex('a change of regime', `<p>Solidarity (red) is in force, doubling every Group's Resistance: stealing anything has become very hard. You play Gun Control, another red NWO. Solidarity is discarded, Resistance returns to normal, and every Group that is both Violent and Government now gets +3 Power. Law and Order (yellow), already in play, is untouched.</p>`)}
${app('the three NWO places sit in the middle of the table, one per colour. As with other “any time” cards, you can play an NWO in your main phase, in response windows and at the end of any turn.')}
`,
  },
  {
    id: 'immunity', part: 'Cards and schemes', title: 'Immunity and Secret Groups',
    blurb: 'Who cannot touch whom, and the special shelter of Secret Groups.',
    body: `
<h4>Immunity</h4>
<p>Some abilities make a Group <b>immune</b> to certain other Groups. Those Groups cannot attack it, cannot aid an attack on it, and cannot use any special ability on it.</p>
<ul>
<li><b>Whole-structure immunity</b> covers everything you own: all your Groups, all your Resources, your hand, both your decks and your discard pile.</li>
<li><b>One way only.</b> If your attacker is immune to a Group, that Group can still defend against your attack or interfere in it.</li>
<li><b>Plots get through.</b> Immunity does not stop a Plot card, even one paid for with an action from a Group you are immune to. Plots are the work of the Illuminati themselves.</li>
<li><b>Nobody is immune to themselves.</b> You cannot trigger your own immunity by using your own cards, for instance by throwing your own Magic Resource into an attack on your Magic-immune Group.</li>
<li><b>Naming beats defences.</b> If card A mentions card B by name, A's ability overrides any protection or immunity B has.</li>
</ul>
${ex('the Discordian Society', `<p>The Discordian Society's whole structure is immune to Government and Straight Groups. A rival's Pentagon (Straight, Violent, Government) cannot attack any Discordian Group, cannot aid attacks on one, and cannot use its ability on the Discordian player's Groups, Resources, hand, decks or discards. But when a Discordian Group attacks something, the Pentagon may oppose that attack as normal.</p>`)}
<h4>Secret Groups</h4>
<p>Groups with the <i>Secret</i> attribute are hidden from the world: myths, rumours, or simply not understood. Most Groups cannot attack a Secret Group, aid or oppose an attack on one, aid an attack <i>by</i> one, or use their abilities on one. Whenever a Secret Group attacks or is attacked, special abilities that give attack bonuses, penalties or immunities are ignored.</p>
<p>The exceptions:</p>
<ul>
<li>Illuminati and other Secret Groups deal with Secret Groups normally.</li>
<li>Resources work normally, unless they are linked to a Group that is not Secret.</li>
<li>Groups whose abilities specifically mention Secret Groups follow their own text.</li>
<li>A Secret Group's own master and puppets may defend it and use their abilities on it. They may also aid its attacks if they otherwise qualify (the right alignment, or Global Power).</li>
<li>Plots affect Secret Groups normally, even when an ordinary Group paid the action to play them.</li>
</ul>
${ex('Secret Groups at work', `<p>You want to take over a rival's Clone Arrangers (Secret). Your Mafia cannot lead that attack; your Illuminati or your Men in Black (Secret) can. The Clone Arrangers' owner can oppose with their master and puppets, and with their Illuminati and any Secret Groups, but not with an ordinary Group that happens to share an alignment.</p>`)}
${app('whole-structure immunity reaches the owner\'s hand, decks and discard pile as described, and a player is never immune to their own Groups. Secret Groups can never be exposed: the rules speak of Secret Groups but never say how exposing one would work, so the app treats them as always Secret, with only the protections above.')}
`,
  },
  {
    id: 'duplicates', part: 'Cards and schemes', title: 'Duplicates and agents',
    blurb: 'Second copies of Groups, Plots, Resources and Illuminati.',
    body: `
<p>Decks are built from collections, so copies of the same card turn up. What a copy can do depends on its type.</p>
<h4>Duplicate Plots</h4>
<p>Play them freely, except that no player may use two copies of one Plot in the same action or attack. If your copy is cancelled, it never happened, and you may play another.</p>
<h4>Duplicate Groups</h4>
<ul>
<li>A Group cannot enter play while a copy of it is in play, or once a copy of it has been destroyed, unless a card brings it back or a card allows several copies.</li>
<li>A copy that was only <i>discarded</i> without ever being in play (for example after a failed takeover from hand) does not block anything.</li>
<li>If a card does allow several copies in play, each is treated separately.</li>
</ul>
<h4>Hidden agents</h4>
<p>A copy in your hand of a Group that someone else controls represents your agents inside it. You may play it whenever that Group is attacked, to control or to destroy:</p>
<ul>
<li>on the attacking side it adds <b>+10</b>;</li>
<li>on the defending side it takes <b>−6</b> off the attack.</li>
</ul>
<p>Only one agents card may be used per attack, and the controller of the real Group may not play one. The agents card is discarded afterwards, whatever the result. Agents do nothing against an automatic takeover, which is not an attack; but if a rival attacks to control a Group from their own hand and you hold a copy, you can play it to defend that Group, −6 to their attempt. Sometimes it is smarter to let them bring the Group in and use your agents to steal it, puppets and all, later.</p>
<p>When a duplicate helps you capture a Group from someone else, you put <i>your own</i> copy into your structure and they keep theirs.</p>
<h4>Duplicate Resources</h4>
<p>See ${see('resources', 'Resources')}: a Unique Resource may only be in play once; other Resources any number of times.</p>
<h4>Duplicate Illuminati: factions</h4>
<p>Several players may run the same Illuminati. They are rival factions of one conspiracy, and they hate each other more than anyone:</p>
<ul>
<li>+5 to any attack on a Group owned by another faction of your own Illuminati.</li>
<li>If you knock out another faction of your Illuminati, you take all their Resources.</li>
<li>Two factions of one Illuminati can never share a victory. The one exception: when Shangri-La's Special Goal is met, every Shangri-La player shares the win.</li>
</ul>
<h4>Spare Illuminati as agents</h4>
<p>You may shuffle extra Illuminati cards into your Plot deck. If you draw one that matches a rival's Illuminati, you may play it at any time by discarding the top card of your Plot deck and the top card of your Group deck. It is laid beside your Resources without being one, and it stands for your spies inside that conspiracy: <b>+3</b> to your attacks and defences against that Illuminati's entire Power Structure, and against every faction of it if several players run it. You may have only one agent per kind of Illuminati, and never one for the Illuminati you play yourself.</p>
${app('about one generated deck in five hides a spare Illuminati card among its Plots. It is held with your Plots (it counts toward the hand limit and can be traded, discarded or returned to the deck like one), and while a rival plays that Illuminati you can use <i>Play as an agent</i> at any time you could act: the top card of each of your decks is discarded and the card lies beside your Resources, giving +3 to your attacks on that Illuminati\'s Groups and to your defence against them (not to Instant attacks). When your own duplicate helps you capture a Group from someone else, your copy goes into your Power Structure with everything the Group carried, and the original card is set aside for its owner, out of the game. Everything else above is enforced, including the +5 between factions and the ban on replaying destroyed Groups.')}
`,
  },
  {
    id: 'timing', part: 'Cards and schemes', title: 'Timing, cancelling and card conflicts',
    blurb: 'Order of effects, cancels, illegal plays, and the table-wide principles.',
    body: `
<h4>Order of effects</h4>
<p>Effects happen in the sequence the cards hit the table, and a later card can change the result of an earlier one. A player announces an attack; a rival changes the attacker's alignment so that its bonus disappears; a third player cancels that change; the attack goes on as first planned. You may use a card to make a rival's announced action fail, or even become illegal.</p>
<p>What you may <b>not</b> do is announce a play that is illegal at the moment you announce it, hoping that the play itself would make it legal.</p>
<h4>Cancelling</h4>
<p>Some cards cancel a Plot, an ability or an action while it is under way: in the gap between its announcement and the dice (or, with no dice, its result). A cancelled play has no effect at all and is treated as though it never happened, except that the cards and actions spent on it stay spent. So a “once per turn” or “once per game” card that was cancelled may be tried again, if you can pay again. Cancelling a Disaster gives the target back the token it lost.</p>
<p>Nothing can be cancelled once its effect cannot be undone: if a card let someone look at your hand, cancelling it afterwards will not make them forget.</p>
<p>“Cancel” means stopping something in progress. Taking a token off a Group before it can be used is a different effect altogether.</p>
<h4>Actions made illegal</h4>
<ul>
<li>If the action paying for a Plot or ability is cancelled or made illegal, the Plot or ability fails and everything spent on it is lost. If several actions were paying together and one drops out, another may be substituted at once.</li>
<li>If a Plot becomes illegal before it takes effect, it goes back to its owner's hand, exposed.</li>
<li>If the <b>attacking</b> Group's action is cancelled or made illegal, the attack never happens. The attacker's token stays spent and the Plots helping the attacker are discarded. Groups that aided or opposed get their tokens back; Plots that helped them go back to their owners' hands, exposed; agents cards go back to hand.</li>
<li>If a <b>helping</b> Group's action is cancelled, the attack carries on, even if it is now doomed. Plots that helped that Group are discarded.</li>
</ul>
${ex('an attack that turns illegal', `<p>Your Violent C.I.A. attacks to destroy a Group of a player who controls Vatican City, which makes its owner's whole structure immune to Peaceful Groups. You boost the attack with Terrorist Nuke (+10 for a Violent Group), and an ally's Liberal Group aids with Benefit Concert. A rival then uses the Orbital Mind Control Lasers to make the C.I.A. Peaceful. The attack is now illegal: the C.I.A.'s token is spent and Terrorist Nuke is discarded, while your ally's Group gets its token back and Benefit Concert returns to your ally's hand, exposed.</p>`)}
<h4>Speed and threats</h4>
<ul>
<li>Nobody may rush a play through to stop others answering. There is no card type that automatically goes first.</li>
<li>Speed only matters when two plays do the same thing or exclude each other (two players reaching for the same discarded card, for instance). The first one played works. If they really were simultaneous, both roll two dice and the higher total wins, and cards that change dice may be used.</li>
<li>Saying you <i>might</i> play something is not playing it. If a rival threatens an Instant attack, you may boost the target before they commit; once they have actually played it, it is too late. If in doubt, ask whether the card is actually being played; they must then play it or let it go.</li>
<li>When someone uses a card to look at or steal your cards, you may not save them by playing, discarding, trading or returning them. You may only play a card that counters the snooping card.</li>
</ul>
<h4>Cards remember</h4>
<p>A card keeps whatever has happened to it until something reverses it. A Group moved to another structure takes its links along. A Group returned to hand or discarded keeps its links in a dormant state, active again if it returns. A Devastated Place is still Devastated if it comes back from its owner's hand. A Personality turned into a vampire stays a vampire. The exception is destruction: a destroyed Group that returns has only its printed values.</p>
<h4>Permanent and temporary changes</h4>
<ul>
<li>A <b>permanent</b> change has no built-in end (NWOs, most linked Plots). Another card can still reverse it.</li>
<li>A <b>temporary</b> change has a set lifetime: “for this action”, “until the end of the turn”.</li>
</ul>
<p>How each kind counts for victory is explained in ${see('victory', 'Goals and winning')}.</p>
<h4>Abilities and instructions</h4>
<p>Text on a card that generally helps its owner is a <b>special ability</b>, and can be cancelled. Text that generally hurts its owner is an <b>instruction</b> and can never be cancelled or switched off. If cancelling some text would leave a gaping hole in how the card works, treat it as an instruction.</p>
<h4>Principles that override even the cards</h4>
<ul>
<li>Keep track of which cards you own. If someone takes one, note it, so it comes home at the end of the game.</li>
<li>When someone steals a card from your hand or deck, you may see which card they take.</li>
<li>When you capture a Group with the help of your duplicate, your copy goes into your structure and the other player keeps theirs.</li>
<li>When two Plots conflict, the last one played wins. If B is played to cancel A and C to cancel B, A works again.</li>
<li>Arithmetic order: set values first, then the single largest multiplier (self-defence one step higher), then additions and subtractions.</li>
<li>Never combine two multipliers; use only the largest.</li>
<li>If a card says something cannot happen to it, that beats a card that would normally do it, unless the second card names the first.</li>
<li>Impossible die results cannot happen. A single die modified above 6 counts as 6, below 1 as 1; likewise a two-dice roll stays between 2 and 12.</li>
<li>Illuminati never have alignments or attributes and can only be destroyed by losing all their puppets.</li>
<li>Cards in a Power Structure may never overlap.</li>
</ul>
${app('plays are handled one at a time, so a truly simultaneous roll-off never arises. Some “any time” cards are limited so that no Group leaves play and no Illuminati is swapped in the middle of an attack (Upheaval! and Unmasked! wait until the attack is over), and Sucked Dry and Cast Aside! only boosts actions within an attack. Unclear cards follow a noted ruling: the Weather Satellite gives +10 to Tornado, Hurricane and Rain of Frogs; the Spear of Longinus adds +1 once per attack in every Attack to Destroy and Disaster; the Ark of the Covenant blames the Illuminati of whoever played a Plot that fells its Group; a Celebrity Spokesman\'s Organization may not oppose the Personality\'s alignments.')}
`,
  },
  // ------------------------------------------------------------------ Winning and losing
  {
    id: 'victory', part: 'Winning and losing', title: 'Goals and winning',
    blurb: 'The three kinds of Goal, the first round, and declaring victory.',
    body: `
<p>You win by knocking out every rival, or by meeting one of your Goals at the end of a turn and surviving the others' attempts to stop you.</p>
<h4>The three kinds of Goal</h4>
<ul>
<li><b>Basic Goal</b>: control a set number of Groups, counting your Illuminati. It is the same for everyone.</li>
<li><b>Special Goal</b>: printed on your Illuminati and different for each. Some change the Basic Goal (the Servants of Cthulhu need one Group fewer for each Group they have destroyed); others stand alone (the Bavarian Illuminati win with 50 total Power in their structure).</li>
<li><b>Goal cards</b>: Plots that set their own condition. Some change the Basic Goal (The Corporate Masters count strong Corporate Groups twice); others stand alone (Power for its Own Sake). Every hidden Plot a rival holds might be a Goal.</li>
</ul>
<table class="rb-table"><thead><tr><th>Players</th><th>Groups needed for the Basic Goal</th></tr></thead><tbody>
<tr><td>2 or 3</td><td>12</td></tr><tr><td>4</td><td>11</td></tr><tr><td>5 or more</td><td>10</td></tr>
</tbody></table>
<p>The table may agree on a different number before the game: higher makes a longer game. With two players it should never go below 12.</p>
<h4>What counts</h4>
<ul>
<li>Some Goals let certain Groups <b>count double</b>. No Group ever counts more than double, even if two Goals both favour it, and no player may count more than <b>three</b> Groups double.</li>
<li>Groups under a Devastated Place (and the Place itself) do not count. Neither do paralysed Groups.</li>
<li><b>Permanent</b> changes to a Group count: if a card has made it Peaceful for good, it is Peaceful for every Goal.</li>
<li><b>Temporary Power changes</b>, and bonuses limited to a purpose such as “for attacks”, never count. A +10 Plot never helps you win.</li>
<li><b>Temporary alignment changes</b> do count, but only while they last, which in practice means only for a claim made at the close of that same turn. If an alignment change triggers a Power change (through an NWO, say), that Power change counts too for as long as it lasts.</li>
</ul>
<h4>The first round</h4>
<p>Nobody can win during the first round of play. The earliest moment anyone can win is when the opening player finishes their second turn.</p>
<h4>Declaring victory, step by step</h4>
<ol>
<li><b>The knock.</b> The active player finishes their end-of-turn effects and knocks.</li>
<li><b>Claims.</b> Any player who meets a Goal right now may declare victory. It need not be the active player.</li>
<li><b>Show the Goal.</b> If you are claiming with a Goal card from your hand, show it. It is not played, only shown, and while the claim is being decided nobody may steal, cancel or otherwise touch it.</li>
<li><b>Resistance.</b> Everyone else, and the claimant too, may now use Plots and abilities to stop the win or to secure it: Instant attacks, cancels, alignment changes, anything the cards allow. Tokens may be spent to buy Plots or power cards. Nobody may make an ordinary attack, since it is nobody's main phase, unless a card allows it.</li>
<li><b>The verdict.</b> When every rival admits they cannot stop it and the claimant still meets the Goal, the claimant wins. If two or more claimants all survive, they share the victory.</li>
<li><b>Proof.</b> A winner must show all their Plots, to prove they were not holding more Goal cards than allowed.</li>
<li><b>Failure.</b> If the claim is stopped, a Goal card that was shown goes back to its owner's hand, exposed, and play passes to the next player.</li>
</ol>
<h4>Goal cards in hand</h4>
<ul>
<li>Before it is used in a claim, a Goal card is an ordinary Plot: rivals may look at it, steal it, expose it or make you discard it. If it is exposed you may still win with it, but everyone can see it coming.</li>
<li>You may hold only <b>one</b> Goal card in hand, unless a card allows more (the UFOs may hold three different ones). If you draw another, get rid of one at once by discarding it or returning it to the deck.</li>
<li>If your Plots are ever revealed and you hold too many Goal cards, you are out of the game.</li>
<li>Per later corrections, a Goal card may instead be played face up in front of you; it then no longer counts against your hand limit.</li>
</ul>
<h4>Shared victory</h4>
<ul>
<li>Players who meet their Goals at the same time share the win.</li>
<li>Factions of the same Illuminati can never share. If they meet their Goals together, neither wins and the game continues, unless some other player met a Goal at the same moment, in which case that player wins alone. The exception is Shangri-La's Special Goal, which all Shangri-La players share.</li>
</ul>
${ex('counting double', `<p>In a four-player game you need 11 Groups. You play the Gnomes of Zurich, whose Special Goal lets Corporate Groups and Banks with Power 4 or more count double. You control your Illuminati and seven other Groups, three of which qualify: Wall Street (Power 4, Bank), the Multinational Oil Companies (Power 6) and Tobacco Companies (Power 4). That is 8 cards counting as 11: a win at the end of the turn, if nobody stops it. A fourth qualifying Group would add only 1, because no more than three Groups may count double.</p>`)}
${app('victory works as described above: nobody wins without declaring. Use <i>End turn and declare victory</i> on your own turn, or <i>Declare victory</i> while any turn is ending, and name the Goal you claim. A claim for a Goal you do not meet is simply refused, with no penalty. In Tutorial and Guided help the app reminds you when you could declare; with help off, it stays silent, as a strict table would. Goal cards in hand are checked automatically, the Goal-card limit is enforced at all times, and no more than three Groups ever count double. The Basic Goal is the book\'s number unless you change it on the start screen (never below 12 with two players); the optional Quick game is a house rule that lowers it to 8.')}
`,
  },
  {
    id: 'elimination', part: 'Winning and losing', title: 'Elimination',
    blurb: 'When a player is knocked out, and what happens to their cards.',
    body: `
<ul>
<li>A player is <b>eliminated</b> if, at any moment after their <b>third complete turn</b>, their Illuminati has no puppets. Before that, a player stripped bare is still in the game and can rebuild.</li>
<li>An eliminated player's hand, decks and Resources all leave the game.</li>
<li>A player who leaves the table is treated as eliminated.</li>
<li>If you eliminate a player running the same Illuminati as you, you take their Resources.</li>
<li>The last player remaining wins.</li>
</ul>
<h4>The Servants of Cthulhu exception</h4>
<p>Suppose the Servants of Cthulhu already have seven kills and make their eighth by wiping out the only puppet they have left: they stay in the game and win when that turn ends.</p>
${app('the <i>Leave</i> button (or <i>Leave</i> beside an online game) takes you out for good, and counts as being eliminated: your hand, decks, Resources and agents vanish, and so does your Power Structure (cards you own leave the game; captured cards go to their owners\' discard piles). An attack you are part of ends as if it never happened, and if it was your turn, play passes on. Offline the game is then put away, since only computers would be left; online the others play on. Before the lead Groups are chosen, an online game can only be deleted by its host. Everything else above is enforced: nobody is knocked out before finishing a third turn, and an eliminated player\'s Resources leave play (or pass to the faction of the same Illuminati that knocked them out).')}
`,
  },
  {
    id: 'deals', part: 'Winning and losing', title: 'Deals, trades and gifts',
    blurb: 'Negotiation, what can change hands, and which promises bind.',
    body: `
<p>Talking is part of the game. Any agreement between players, open or secret, is allowed as long as carrying it out does not break a rule. You can always try to change someone's mind about an action they are planning, or have just announced, with promises, bribes or threats.</p>
<h4>What binds and what does not</h4>
<ul>
<li>A deal is <b>binding</b> when both sides hand over what was agreed right away.</li>
<li>A <b>promise about the future</b> is not binding. You may break it when the time comes.</li>
</ul>
${ex('a deal and a promise', `<p>“Give me your Punk Rockers from your hand now, and I'll hand you a Plot card.” If they give you the Punk Rockers, you must hand over a Plot. But “Give me the Punk Rockers now and I'll give you a Plot on my next turn” is only a promise: they may hand the card over, and next turn you are free to keep your Plot.</p>`)}
<h4>Cards from your hand</h4>
<ul>
<li>Cards in your hand, exposed Plots included, may be given away or traded at any time.</li>
<li>Not in the middle of drawing several cards, and not right after someone has tried to look at or steal your cards.</li>
<li>Not to either side of a Privileged attack while it is going on.</li>
<li>A card you give goes into the receiver's hand.</li>
<li>Undrawn cards in your decks can never be given away.</li>
</ul>
<h4>Resources in play</h4>
<p>During the main phase of either player's turn, you may hand one of your Resources in play to a rival, provided you have not used it this turn. It arrives linked to the receiver's Illuminati, and they may re-link it in their own main phase. A linked card that has already given its benefit this turn cannot be given away until next turn.</p>
<h4>Groups in play</h4>
<p>A Group can be moved into another player's structure if both agree (${see('structure', 'Moving Groups')}).</p>
<h4>Borrowed cards</h4>
<p>Cards keep their owner. If one of your cards ends up with someone else, make a note (or mark it with one of your tokens) so it comes back to you after the game.</p>
${app('use the <i>Deals</i> button to offer cards from your hand, Resources and Groups, and to ask for things in return; the other player accepts, declines or counters. Anything handed over on the spot happens for real; a promise about later is shown with the offer but never enforced. Offers lapse when the turn they were made in ends. Computer players answer offers at once, and sometimes make their own.')}
`,
  },
  // ------------------------------------------------------------------ Beyond the basics
  {
    id: 'two-player', part: 'Beyond the basics', title: 'Two-player games',
    blurb: 'The three extra rules for duels.',
    body: `
<p>Duels reward fast, focused decks that would be easy to gang up on in a bigger game. These rules are official for two-player tournaments and recommended for every two-player game:</p>
<ul>
<li>The Basic Goal is never lower than <b>12</b> Groups.</li>
<li>Neither player may attack the other until <b>both</b> have taken a full turn. The second player cannot pounce on the first straight away.</li>
<li>A player who makes an <b>automatic takeover</b> at the start of their turn gives up one of the Illuminati tokens they would receive in that turn's token step.</li>
</ul>
${app('all three rules apply automatically whenever only two players are seated.')}
`,
  },
  {
    id: 'etiquette', part: 'Beyond the basics', title: 'Playing with strict players',
    blurb: 'Table habits that keep a multiplayer game clean.',
    body: `
<p>In a multiplayer game the rules only work if everyone can see what is happening and has time to answer. These habits will make you welcome at any table:</p>
<ul>
<li><b>Announce fully.</b> Attacker, kind of attack, target. “Privilege!” at the moment you declare, never afterwards.</li>
<li><b>Pause.</b> After every announcement and before every roll, give everyone a moment to react. Rolling at once is speed play and is not allowed.</li>
<li><b>Say your bonuses aloud.</b> A bonus you forget is gone once the dice land, and quietly skipping a free one is not a trick: you will be made to count it.</li>
<li><b>Keep the table readable.</b> Tokens clearly on their cards, links clearly marked, exposed Plots face up and apart from your hand, discards face up in one pile, your destroyed pile separate.</li>
<li><b>Count honestly.</b> Tell anyone who asks how many hidden Plots you hold.</li>
<li><b>Hands off.</b> Never look at your own undrawn cards. After searching a deck, shuffle it and offer it to another player to cut.</li>
<li><b>Knock.</b> Make the end of your turn obvious; the victory step starts there.</li>
<li><b>Doing, or threatening?</b> If a rival's words are ambiguous, ask. They must either play the card or drop it.</li>
<li><b>Track ownership.</b> Note or mark cards that change hands so everyone gets their own back.</li>
<li><b>Settle house rules first.</b> Direction of play, the Basic Goal, and which printed corrections to cards you use.</li>
<li><b>Read the card.</b> When a card and the rules disagree, the card wins; when two Plots clash, the last played wins.</li>
</ul>
${app('the app does the bookkeeping and gives each player a response window before anything resolves, so these habits happen for you. They are what you will need at a real table.')}
`,
  },
  {
    id: 'deck', part: 'Beyond the basics', title: 'Building a deck',
    blurb: 'Deck size, the usual mix, and building around a theme.',
    body: `
<p>The tabletop game is played with cards from your own collection, so much of the game is decided before the first turn, when you choose what goes into your deck.</p>
<h4>The rules</h4>
<ul>
<li>Exactly <b>45 cards</b>, counting the Illuminati you start with.</li>
<li>How many Plots and how many Group-deck cards is up to you.</li>
<li>Spare Illuminati cards may go in the Plot deck (see ${see('duplicates', 'Duplicates and agents')}).</li>
</ul>
<h4>A typical shape</h4>
<table class="rb-table"><thead><tr><th>Part</th><th>Usual share of a strong deck</th></tr></thead><tbody>
<tr><td>Illuminati</td><td>1</td></tr>
<tr><td>Group deck: Groups (and Resources)</td><td>about 12 to 20</td></tr>
<tr><td>Plot deck</td><td>about 24 to 32</td></tr>
</tbody></table>
<h4>What makes a deck work</h4>
<ul>
<li>A few <b>high-Power Groups with several arrows</b> to lead attacks and carry puppets.</li>
<li>Groups and Resources whose abilities help each other, and Plots that suit them (+10 Plots for your main alignment, for example).</li>
<li>A <b>theme</b>: build around your Illuminati's Special Goal, one or two alignments that do not clash, an attribute, a Goal card, or a plan.</li>
<li>A <b>second copy</b> of a key Group: insurance against a failed takeover, and a ready-made agents card if a rival gets the first.</li>
<li>Some variety, so you can answer what rivals throw at you: cancels, defensive Plots, an Instant attack or two.</li>
<li>For duels, lean aggressive. For bigger tables, carry more defence and grow steadily; racing ahead makes everyone gang up on you.</li>
</ul>
<p>No deck is perfect. A good player who knows your deck can beat it, so vary your cards and your plans between games. Lead with the same Group every time and rivals will pack copies of it to steal it from you.</p>
${app('you cannot build your own deck yet. Each player gets a generated deck of 45 cards: the Illuminati, a Group deck of 12 to 20 cards (a few of them Resources) and 24 to 32 Plots, which is the typical shape the rules recommend. The Groups are chosen to suit the Illuminati: one or two alignments that do not clash, its favourite attribute, Groups with room to grow, and some strong attackers. About one deck in five also hides a spare copy of another Illuminati in the Plot deck, in place of one Plot, for use as an agent.')}
`,
  },
  {
    id: 'strategy', part: 'Beyond the basics', title: 'Strategy for beginners',
    blurb: 'Practical advice for your first games.',
    body: `
<ul>
<li><b>Know the odds.</b> Strength 7 wins a little more than half the time, 9 wins five times in six, and nothing beats 92%. Below 5 you are gambling. See the table in ${see('attacks', 'How an attack works')}.</li>
<li><b>Build wide, not tall.</b> Use all four Illuminati arrows. A long chain from one arrow can be captured in a single attack, taking everything below it.</li>
<li><b>Guard the hubs.</b> A Group with many puppets is your most valuable card and your rivals' favourite target. Keep it close to the Illuminati, where it gets +10.</li>
<li><b>Match alignments.</b> Attack to control Groups that share alignments with your attacker; attack to destroy ones that clash with it. Groups that share alignments with their master are hard to steal.</li>
<li><b>Keep something back.</b> A token or two and a cancel Plot in hand make you a poor target. A player who has spent everything is an open invitation.</li>
<li><b>Take over from hand early.</b> Your own hand is the safest source of Groups, and the free takeover at the start of your turn needs no dice at all.</li>
<li><b>Count everyone.</b> Keep track of how close each rival is to their Goals, and how many hidden Plots they hold. A player with a full hand can win out of nowhere.</li>
<li><b>Save the Instant attacks.</b> An Assassination or Disaster is at its best at the end of a rival's turn, when it knocks a Group out of their winning count.</li>
<li><b>Look strong, not scary.</b> You want to seem too tough to be worth attacking, but not so far ahead that everyone unites against you.</li>
<li><b>Talk.</b> Offer help, trade favours, make promises you might keep. People rarely attack a player they hope will help them to victory. Nobody is obliged to point out a threat to you, and the quiet player may already have a side deal.</li>
<li><b>Use Global Power.</b> A Group with a second number can help in fights its alignments would keep it out of.</li>
<li><b>Two copies, two chances.</b> A spare copy of a Group can be an agents card later, worth +10 when you go after the original.</li>
</ul>
${app('turn Tutorial on (top right of the table) and the app outlines in green what you can use right now, explains why other cards cannot be used, and shows the chance of every attack before you roll. Computer opponents each have a style that they stick to; the in-game Rules panel lists them.')}
`,
  },
  {
    id: 'glossary', part: 'Beyond the basics', title: 'Glossary',
    blurb: 'Every game term in one list.',
    body: `
<dl class="rb-gloss">
<dt>Action token</dt><dd>A counter on a Group or Resource showing it can still act this turn. See ${see('tokens', 'Action tokens')}.</dd>
<dt>Agents</dt><dd>A copy, held in hand, of a Group someone else controls; played in an attack on that Group for +10 or −6.</dd>
<dt>Aid</dt><dd>Adding a Group's Power (or Global Power) to an attack.</dd>
<dt>Alignment</dt><dd>One of ten political or social labels in a Group's bottom-left corner.</dd>
<dt>Any attempt</dt><dd>A bonus that helps every attack of a given kind by any of your Groups.</dd>
<dt>Any time</dt><dd>Usable in any phase of any player's turn, but still not inside a Privileged attack you are shut out of, not with tokens during the beginning of your own turn (beyond what is allowed there), and never just to keep a card from being seen or stolen.</dd>
<dt>Assassination</dt><dd>An Instant Attack to Destroy against a Personality. A Personality it destroys is killed.</dd>
<dt>Attack to Control</dt><dd>An attack that takes the target into your structure. Power against Resistance.</dd>
<dt>Attack to Destroy</dt><dd>An attack that removes the target from play. Power against Power.</dd>
<dt>Attribute</dt><dd>An italic label in a Group's bottom-right corner, such as Media or Magic. Only matters when a card mentions it.</dd>
<dt>Automatic failure</dt><dd>A card effect that makes an attack fail after everything is committed and the dice are rolled; all cards and tokens spent are lost. A natural 11 or 12 also always fails.</dd>
<dt>Automatic takeover</dt><dd>Bringing one Group or Resource from hand into play at the start of your turn, with no roll.</dd>
<dt>Basic Goal</dt><dd>Controlling a set number of Groups, counting your Illuminati.</dd>
<dt>Cancel</dt><dd>Stopping a Plot, ability or action after it is announced and before it resolves. It is treated as never having happened.</dd>
<dt>Commit</dt><dd>The point after which an attacker can no longer call off an attack.</dd>
<dt>Control arrow</dt><dd>The arrows on card edges. Puppets hang from masters' outgoing arrows.</dd>
<dt>Decks</dt><dd>Your undrawn Plot and Group cards. You may not look at them.</dd>
<dt>Defence</dt><dd>Opposing an attack on a Group of your own. A “defence” bonus applies only there.</dd>
<dt>Destroyed pile</dt><dd>The Groups a player has destroyed, kept apart for Goals that count them.</dd>
<dt>Devastated</dt><dd>A Place hit by a Disaster: it and everything below it lose their tokens and stop counting for victory until Relief.</dd>
<dt>Direct</dt><dd>A bonus that applies only when that Group itself leads the attack.</dd>
<dt>Disaster</dt><dd>A Plot that attacks a Place, usually as an Instant attack.</dd>
<dt>Discard</dt><dd>Putting a card face up on its owner's discard pile. Costs that ask for a discard come from your hand unless the card says your deck.</dd>
<dt>Draw / Choose</dt><dd>“Draw” takes the top card of a deck; “choose” lets you search the deck for the card you want (then shuffle).</dd>
<dt>Exposed</dt><dd>A Plot laid face up in front of its owner, visible to all.</dd>
<dt>Faction</dt><dd>One of several players running the same Illuminati.</dd>
<dt>Free action / free move</dt><dd>Something that costs no token, discard or other payment.</dd>
<dt>Freeze</dt><dd>An Assassins Plot that stops every Group with one attribute from spending tokens, except to defend itself, until the end of the turn.</dd>
<dt>Global Power</dt><dd>The second Power number, used to aid or oppose when alignments would not allow full Power.</dd>
<dt>Goal card</dt><dd>A Plot giving an extra way to win.</dd>
<dt>Group</dt><dd>A card that can sit in a Power Structure: Illuminati, Organizations, Places and Personalities.</dd>
<dt>Hand</dt><dd>The cards you have drawn. Not in play.</dd>
<dt>Hidden Plot</dt><dd>A Plot in your hand that rivals cannot see.</dd>
<dt>Illuminati</dt><dd>The secret master at the centre of each structure. Four arrows, cannot be attacked.</dd>
<dt>Immunity</dt><dd>Protection from named Groups: they cannot attack it, aid attacks on it, or use abilities on it.</dd>
<dt>In play / just played</dt><dd>Groups and Resources are in play while controlled. A Group being taken over from hand is only just played until the takeover succeeds.</dd>
<dt>Instant attack</dt><dd>An Attack to Destroy launched by a card, at almost any time, that Groups cannot normally join.</dd>
<dt>Instruction</dt><dd>Card text that works against its owner; it cannot be cancelled.</dd>
<dt>Interference</dt><dd>Taking part in an attack as a player who is neither attacker nor defender.</dd>
<dt>Killed</dt><dd>A Personality destroyed by an Assassination (or by a card that says it kills). Only cards that restore killed Personalities bring it back.</dd>
<dt>Link</dt><dd>A marked connection between two cards, such as a Resource and the Group that uses it.</dd>
<dt>Master / puppet</dt><dd>If Group A controls Group B directly, A is B's master and B is A's puppet.</dd>
<dt>New World Order (NWO)</dt><dd>A Plot that changes the rules for everyone while it is in force. One per colour.</dd>
<dt>Open arrow</dt><dd>An outgoing arrow with no puppet on it and room for one.</dd>
<dt>Oppose</dt><dd>Adding a Group's Power (or Global Power) to the defence against an attack.</dd>
<dt>Paralyzed</dt><dd>Unable to spend tokens or use abilities or linked Resources, and not counting for Goals (Assassins; see <a href="#rb-assassins" data-rb-goto="assassins">Assassins</a>).</dd>
<dt>Permanent change</dt><dd>A change with no built-in end. Counts for Goals.</dd>
<dt>Place</dt><dd>A Group representing a location's hidden rulers. Vulnerable to Disasters.</dd>
<dt>Personality</dt><dd>A Group representing one person. Vulnerable to Assassinations.</dd>
<dt>Plot</dt><dd>A card with a hand on the back: tricks, Disasters, Assassinations, Goals and NWOs.</dd>
<dt>Power</dt><dd>A Group's strength in attacks, and its defence against destruction.</dd>
<dt>Power Structure</dt><dd>Your Illuminati and every Group it controls directly or through other Groups.</dd>
<dt>Printed Power</dt><dd>Power before any changes (other than those that say they change printed Power).</dd>
<dt>Privileged attack</dt><dd>An attack only the attacker and defender may take part in.</dd>
<dt>Relief</dt><dd>Restoring a Devastated Place by spending actions worth three times its printed Power.</dd>
<dt>Resistance</dt><dd>A Group's defence against being taken over.</dd>
<dt>Resource</dt><dd>A card beside your structure that lends an ability: artifacts, gadgets, magic, knowledge.</dd>
<dt>Secret</dt><dd>An attribute that shelters a Group from most other Groups.</dd>
<dt>Self-defence</dt><dd>The target spending its own token to oppose; the action's Power gets an extra multiple.</dd>
<dt>Shuffle</dt><dd>Whoever searched a deck shuffles it afterwards; another player may cut.</dd>
<dt>Special ability</dt><dd>Beneficial card text; it can be cancelled.</dd>
<dt>Special Goal</dt><dd>The winning condition printed on an Illuminati.</dd>
<dt>Slack</dt><dd>The Action tokens of the Church of the SubGenius, kept from turn to turn (SubGenius).</dd>
<dt>Strength</dt><dd>Attack total minus defence total: roll that number or less on two dice.</dd>
<dt>SubGenius</dt><dd>An attribute of the SubGenius pack's Groups. It does nothing by itself; cards refer to it.</dd>
<dt>Temporary change</dt><dd>A change with a set lifetime, such as until the end of the turn.</dd>
<dt>Turn</dt><dd>When a card says “each turn”, it means each of its owner's turns. Bonuses arrive at the matching step (extra tokens with the token refresh).</dd>
<dt>Uncontrolled area</dt><dd>In the stand-alone SubGenius game, the face-up cards in the middle of the table that nobody controls and anyone may attack.</dd>
<dt>Unique</dt><dd>A Resource of which only one copy may ever be in play.</dd>
<dt>Zap</dt><dd>A Plot linked to a rival's Illuminati that restricts that player's whole Power Structure until someone spends an Illuminati action to remove it (Assassins).</dd>
</dl>
`,
  },
  // ------------------------------------------------------------------ Expansions
  {
    id: 'assassins', part: 'Expansions', title: 'Assassins',
    blurb: 'Zaps, Paralysis, Freezes, killed Personalities and the pack\'s other new cards.',
    body: `
<p>The Assassins pack adds 125 cards to the standard game: new Groups, Resources and Plots, and a new Illuminati, the <b>Society of Assassins</b>, whose Fanatic Groups help each other and whose Special Goal counts Secret Groups twice. Shuffle its cards into your decks like any others. Most of the pack follows the rules you already know; this section covers what is new. The pack is optional and switched on when a game is set up.</p>
<h4>Zaps</h4>
<p>A <b>Zap</b> is a Plot you play on a rival's Illuminati. It costs one action of your own Illuminati unless the card says otherwise, may be played at any moment except inside a Privileged attack, and then stays on the table beside that Illuminati until it is removed.</p>
<ul>
<li>A Zap restricts the <b>whole Power Structure</b> of its victim, not just the Illuminati card. If it says the player cannot take over some kind of Group, then no Group of theirs may attack to control one, and their automatic takeover cannot bring one in either.</li>
<li>Zaps add up: each is its own restriction, and a player may carry several.</li>
<li>Played in the middle of an attack, a Zap can make that attack illegal. The attack is then cancelled, as if it had never been made.</li>
<li><b>Removing Zaps:</b> any player (the victim, or anyone else) may spend one Illuminati action, at any time, to remove <i>every</i> Zap from one player at once. The only moment this is not allowed is during an Instant attack.</li>
<li>Zaps on a player who is eliminated are discarded.</li>
</ul>
${ex('Brushfire War', `<p>Your rival's Power Structure is full of Peaceful Groups and they are two short of the Basic Goal. You spend your Illuminati action and play Brushfire War on their Illuminati: from now on none of their Groups may take over a Peaceful Group, by attack or by automatic takeover. On their turn they spend their own Illuminati action to sweep the Zap away, which is exactly the action they wanted for buying a Plot. Either way, you have slowed them down.</p>`)}
<h4>Paralysis</h4>
<p>A <b>Paralysis</b> card is played on a Group of the alignment it names, at any time except in a Privileged attack. It is paid with an Illuminati action, or with actions of Groups of the named opposite alignment whose Power adds up to the target's current Resistance. It stays linked to the Group. While it lasts, the Paralyzed Group:</p>
<ul>
<li>cannot spend its Action tokens (they stay on the card and come back when it is freed);</li>
<li>cannot use its special ability or its linked Resources, and cannot take new puppets (its present puppets are not affected, and its Resources may be linked elsewhere);</li>
<li>does not count toward any Goal. Only its own count is lost: its puppets still count, and anything it does for other cards simply by being in play still applies.</li>
</ul>
<p>The Paralysis ends at once if the Group loses the named alignment, even for a moment. It can also be removed at any time, even while someone is claiming victory: the Group's <b>master</b> may spend an action to free it (paid by the Group's controller), or <b>any Illuminati</b> may, each player paying with their own.</p>
<h4>Attribute Freezes</h4>
<p>A <b>Freeze</b> names an attribute (Bank, Media, Church…). Until the end of the turn no Group with that attribute, whoever controls it, may spend Action tokens, except to defend itself. Instead of freezing, the card may be used to cancel an action a matching Group has just taken. A few Freezes reach further: one also stops the orbiting Resources, another stops Liberal and Conservative Groups too. A Plot that needs the action of a Frozen Group cannot be paid, but duplicates played as agents still work against a Frozen Group.</p>
<h4>Assassinations and killed Personalities</h4>
<p>The pack brings new Assassinations. As before, a Personality destroyed by an Assassination is <b>killed</b>, and “killed” and “assassinated” mean the same thing. Some other cards kill without an Assassination; a Personality they destroy counts as killed too. A killed Personality is a destroyed Group like any other, except that only cards which restore <i>killed</i> Personalities can bring it back.</p>
<h4>Disasters and other special cards</h4>
<ul>
<li>Not every new Disaster is an Instant attack. Drought and Flesh-Eating Bacteria are ordinary Attacks to Destroy launched without an action, and their cards name who may help the target (Coastal Places, Science Groups, Groups able to send Relief…). Some cards also make a helper count extra, such as a disease-control Group helping at triple Power.</li>
<li>Oil Spill and No Beer! are Instant, like the base game's Disasters. Only cards that mention Instant attacks, Disasters or Assassinations affect them.</li>
<li><b>Regi$tered Trademark</b> is linked to a Group, and from then on everyone must call that Group by its full printed name. Whoever slips discards a Plot; if the Group's own controller slips and a rival catches it, the controller hands that rival a Plot instead.</li>
<li><b>Partition</b> splits a Huge Place into two halves with half its Power each; a player holding both halves may put them back together.</li>
<li><b>Enough is Enough</b> clears every Zap, Paralysis and Freeze from your own Power Structure, at the cost of your Plot draw. <b>Reverse Whammy</b> sends a Zap back at whoever played it.</li>
</ul>
${app('Zaps show as a ⚡ on the Illuminati and a <i>Zapped</i> tag by the player\'s name; Paralyzed and Frozen Groups carry a band across the card, and a banner runs along the top of the table while a Freeze lasts. Tap any of them for the details and the buttons to remove Zaps or free a Group. Removing Zaps happens at once and cannot be answered (no card can cancel it). Paralysis played on a Group in the middle of its own action does not cancel that action. Naming slips for Regi$tered Trademark cannot be heard by the app, so players report them with buttons on the card. Australia reads the day and the hour from its controller\'s device clock (weekends and after 5 p.m. count; national holidays cannot be known, so they do not). Computer players remove Zaps from themselves and free their own Groups when they have an Illuminati action to spare.')}
`,
  },
  {
    id: 'subgenius-mixed', part: 'Expansions', title: 'SubGenius cards in a regular game',
    blurb: 'Slack, the SubGenius attribute and Plots that name their own cost.',
    body: `
<p>The SubGenius pack can be played on its own (see ${see('subgenius-game', 'The stand-alone SubGenius game')}) or shuffled into a standard game. Mixed in, its cards work under the standard rules, with a few additions.</p>
<h4>The Church of the SubGenius and Slack</h4>
<p>The pack's Illuminati is the <b>Church of the SubGenius</b>. It works like any other Illuminati, except for its tokens:</p>
<ul>
<li>It <b>keeps</b> its Action tokens from turn to turn. At each token refresh it gets its new one on top of whatever it still holds. These tokens are its <b>Slack</b>, and each Illuminati action spends one.</li>
<li>Its Special Goal lets up to <b>three Slack count as Groups</b> toward the Basic Goal. With a goal of 12 you could win with 10 Groups and 2 Slack. This Goal cannot be combined with any other Goal.</li>
<li>It and your SubGenius Groups get +2 on their own Attacks to Control against SubGenius Groups.</li>
</ul>
<h4>The SubGenius attribute</h4>
<p>Many of the pack's Groups carry the attribute <b>SubGenius</b>. Like every attribute it does nothing by itself; cards that name it care about it.</p>
<h4>Plots that name their cost</h4>
<p>Many Plots of both packs say which action powers them: <i>Requires a SubGenius action</i>, <i>an Illuminati action or two Church actions</i>, <i>three discards</i>, and so on. Pay with exactly one of the listed alternatives when you play the card. Unless the card says otherwise, only <b>your own</b> Groups and cards can power it. A Group that is Paralyzed or Frozen cannot pay.</p>
<h4>Links that remember</h4>
<p>A Plot that changes a Group's numbers, alignments or attributes stays linked to it and travels with it when the Group changes hands. If the link becomes illegal for a while, the Plot does nothing until it is legal again; if it becomes illegal for good, the Plot is discarded.</p>
<h4>Cards that mention the uncontrolled area</h4>
<p>Some SubGenius cards talk about the uncontrolled area, which exists only in the stand-alone game. In a regular game, a card that would go there goes into the hand of the player concerned instead, and “from your hand or the uncontrolled area” simply means from your hand.</p>
${app('the Church\'s Slack is shown on its card and beside the player\'s name, and counts in the goal bar. When you play a Plot that names its cost, the panel lists each way you can afford to pay (for example “an action of your Illuminati” or “the action of one of your SubGenius Groups”) and names the cards that will be spent; pick one. The app chooses which of your matching Groups pays (the weakest that is enough) and which Plots are discarded (exposed ones first). An action cancelled after it powered a Plot is not replaced by another.')}
`,
  },
  {
    id: 'subgenius-game', part: 'Expansions', title: 'The stand-alone SubGenius game',
    blurb: 'Everyone plays the Church: shared decks and an uncontrolled area in the middle.',
    body: `
<p>The SubGenius pack is also a complete game for two to four players. Everyone plays a faction of the Church of the SubGenius, and instead of private decks the whole table shares one Plot deck and one Group deck. Group cards are dealt face up into an <b>uncontrolled area</b> in the middle of the table, and everybody fights over them.</p>
<h4>Setting up</h4>
<ol>
<li>Give each player a Church of the SubGenius. Shuffle the Plots into one deck and the Groups (with the Resources) into another. Beside each deck goes a single face-up discard pile. When a deck runs out, shuffle its discards to make a new one.</li>
<li>Deal each player three Plots and three Group cards. Everyone chooses a lead from their Group cards (a Resource may be a lead: it goes beside the Church) and all leads are revealed together.</li>
<li>Each player keeps their other two Group cards until the start of their first turn, then lays them face up in the middle. That begins the uncontrolled area.</li>
<li>Roll to see who goes first. Until a rival has finished their first turn, you may not attack them, play cards on them or otherwise harm them, unless they did it to you first.</li>
</ol>
<h4>A turn</h4>
<ol>
<li><b>Draw a Plot.</b></li>
<li><b>Draw a Group</b> into the uncontrolled area, face up, but only if it holds fewer than eight cards.</li>
<li><b>Automatic takeover</b> (optional): one Group or Resource that <i>you</i> put into the uncontrolled area this turn. If you take one, your Church gets no new token this turn (with any number of players).</li>
<li><b>Tokens:</b> the Church adds its new token to its Slack; every other Group gets one only if it has none.</li>
<li><b>Main phase:</b> act as usual. You may attack any Group in the uncontrolled area, to control it or to destroy it, as well as rivals' Groups.</li>
<li><b>End:</b> anyone who meets a Goal may declare victory, and the others try to stop it.</li>
</ol>
<p>At any time, spend one Slack or the tokens of two other Groups to draw a card: a Plot goes to your hand, a Group card into the uncontrolled area (this is allowed however many cards already lie there).</p>
<h4>The uncontrolled area</h4>
<ul>
<li>Its cards belong to nobody. An attack on one of them gets no position bonus, and there is no defender: any player may aid or oppose with Groups whose alignments allow it. A failed attack leaves the card where it is.</li>
<li>A <b>Resource</b> in the area is taken, in your main phase, by spending one Slack; only one per turn.</li>
<li>When a Group is destroyed its puppets, stripped of their tokens, go to the uncontrolled area. So do Groups that no longer fit after a move. Resources linked to a Group that goes there go with it, and linked Plots stay linked.</li>
</ul>
<h4>Differences from the standard game</h4>
<ul>
<li>Every rival plays the same Illuminati, so the +5 for attacking a rival's Group always applies.</li>
<li>The Secret attribute has no effect of its own in this game.</li>
<li>Discards go on the shared piles and never back into a deck, except when a deck is rebuilt.</li>
<li>After your first turn you never hold Group cards: they come straight into the uncontrolled area.</li>
</ul>
<h4>Winning and losing</h4>
<ul>
<li><b>Basic Goal:</b> control 10 Groups including your Church, or 12 with two players. Up to three Slack count as Groups (the Church's Special Goal).</li>
<li>Goal cards work as usual. If two players meet a Goal at the same moment, neither wins and play goes on (a very few cards allow a shared win).</li>
<li>A player whose Church has no puppets after their third complete turn is out. The player who took or destroyed that last puppet takes their Plot hand and Resources. A player who leaves the game discards everything.</li>
</ul>
${app('the stand-alone game is played with the SubGenius cards alone. The uncontrolled area is a tray in the middle of the table that everyone can see, with the shared decks and discard piles beside it: tap a card to read it, pick one of your Groups and <i>Attack to control</i> or <i>Attack to destroy</i> to target it, or tap a Resource there to take it for one Slack. The shared decks stay face down for everyone; the discard piles can be browsed. The app offers no way to return a Plot to a deck in this game. Duplicates across several copies of the pack are not supported.')}
`,
  },
];

/** Where each tab of the in-game Rules panel leads in the full rulebook. */
export const RULES_PANEL_LINKS: Record<string, string> = {
  goal: 'victory', card: 'anatomy', turn: 'turn', tokens: 'tokens', attack: 'attacks', roll: 'attacks',
  help: 'helping', plots: 'plots', more: 'immunity', foes: 'strategy', packs: 'assassins',
};

export const sectionById = (id: string) => RULEBOOK.find((s) => s.id === id);

/** Plain text of a section, for search. */
export const plainText = (s: RuleSection) => `${s.title} ${s.blurb} ${s.body.replace(/<[^>]+>/g, ' ')}`.replace(/\s+/g, ' ');
