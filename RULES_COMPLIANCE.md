# Rules compliance

How the engine matches the rules it follows (version 1.2 plus the later rules update). Rule numbers are
the Core Rules tab of `data/Elitists_War.xlsx`. "Tested" means `tests/compliance.test.ts` or
`tests/rules.test.ts` checks it.

## Implemented and tested

| Rule | What is checked |
|---|---|
| R025 Setup | 45-card decks; 3 Plots and 6 Groups dealt; lead Group chosen by each player, duplicates set aside and re-picked; highest 2d6 goes first, ties re-roll |
| R001 Turn | Plot draw, Group draw, one automatic takeover, token refresh; Illuminati token can draw a Group card once per turn |
| R026 Action tokens | Only Groups without a token get one; captured Groups get none that turn; a Group reduced to 0 Power loses its tokens at once |
| R027 Plot hand limit | 5 Plots (6 with Gnomes of Zurich), counting exposed Plots, not Groups. No limit during your own turn; at the end of it, and at any moment outside it, excess Plots must go at once (discard or back into your Plot deck) |
| R027 Buying Plots | 1 Illuminati token, or tokens from 2 different other Groups |
| R003 Attack to Control | Power − Resistance; +4 per shared / −4 per opposite alignment (leading attacker only); needs an open arrow; captured Group goes on the attacker's arrow with its puppets; failed takeover from hand is discarded at end of turn |
| R004 Attack to Destroy | Power − Power; alignment modifiers reversed; puppets return to their controller's hand; destroyer gets credit |
| R006 Defense | Position +10 / +5 / 0; +4 per alignment shared with the master (control only); self-defense raises the multiplier one step (×2, or ×3 if already ×2) before additions |
| R047 Calculation order | Set-to values, then the single largest multiplier, then additions; 11–12 always fails; strength below 2 fails without a roll |
| R029 Aid / oppose | Matching alignment (or opposite, for destroy), master or puppet, or Global Power capped at Power; a Group with neither cannot join |
| R009 Cancellation | A cancelled Plot never happened (and a cancel can itself be cancelled); cancelled attacker action returns helpers' tokens and their Plots to hand; attacks can be called off before the attacker commits a Plot |
| R014 Secret Groups | Only Illuminati and Secret Groups attack or help against them (their master and puppets may defend them); abilities are ignored in attacks by or against them |
| R016 Victory | Checked at end of turn only, never in round 1; at most 3 Groups count double; Devastated Places and their puppets do not count; temporary +10s never count; same-Illuminati factions cannot share a win |
| R023 Two players | Goal 12; no attacks on each other until both have had a turn; automatic takeover costs that turn's Illuminati token |
| R001 First-turn protection | No attacks, Plots or interference against a player who has not finished a first turn |
| R030 | The same Plot cannot be used twice in one attack |
| R032 Privileged attacks | Declared only by the attacker when the attack is declared; only attacker and defender take part |
| R034–R037 Instant attacks, Disasters, Devastation | Target's Power fixed when played; target cannot spend tokens; a Disaster takes a token (returned if cancelled); Devastated Places are halved against destroy attacks; Relief needs actions totalling 3× printed Power |
| R045 NWOs | One per colour; a new one replaces the old; not playable during Instant or Privileged attacks |
| R038 Moving Groups | Own main phase; costs a token from the Group, a master or the Illuminati; moving under a Devastated Place removes tokens |
| R049 Elimination | At any moment after a player's third turn, with no puppets: out at once, hand and decks removed |
| R019 errata | Reload-type Plots cost an Illuminati action and refresh up to 5 Power of Groups (or any one Group), never a Group captured this turn |

## Deliberate choices and known gaps

- Beginning-of-turn Plot and Group draws happen automatically (the rules make them optional; drawing never hurts during your own turn).
- "Play at any time" cards can be played on your turn, in any response window, and at the end of every turn, but not at arbitrary moments in a rival's main phase (needed so the game can be played in pieces).
- +10 Plots on the attacker must be played when the attack is declared (the card text says so).
- When a captured Group's puppets no longer fit, the engine rearranges them automatically.
- Not in this version yet: Resources, Goal cards, hidden "agents" duplicates, gifts and trades between players, Relief from several players together.
