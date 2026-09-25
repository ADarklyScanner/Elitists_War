# Card text style guide

Every card face carries two blocks: **rules text** (what the card does) and **flavour text** (a line of
satire). Both are written fresh; nothing is taken from the original printed game. This guide keeps all
412 cards consistent.

## 1. Rules text must match the game exactly
- It says exactly what the game engine does (src/data/cards.json `text`, plus the engine code) — every
  number, condition, timing and limit. Nothing added, nothing dropped.
- If the engine and the printed intent differ, the engine wins and the difference is reported, not papered over.

## 2. Length budgets (words)
The card face has room for about 60 words in total. Rules come first; flavour gets what is left.

| Card | Rules text | Flavour | Total max |
|---|---|---|---|
| Group with no special ability | none (stats say it all) | 12–30 | 30 |
| Group with an ability | 8–35 | 6–20 | 55 |
| Illuminati | ability 15–40, then **Special Goal** line 8–25 | 6–15 | 70 |
| Resource | 10–40 | 6–18 | 55 |
| Plot (ordinary) | 8–40 | 6–18 | 55 |
| Disaster / Assassination | 10–40 | 6–15 | 55 |
| New World Order | 10–35 | 6–15 | 50 |
| Goal | 10–35 | 6–15 | 50 |

Short beats long: if a rule fits in 12 words, don't use 20.

## 3. Structure and wording
- Start Plots with their timing tag when it isn't the default: **Instant.**, **Any time.**, **During an attack.**,
  **Counter.**, **Your turn only.** Then the effect.
- Second person ("you", "your"), present tense, digits for numbers (+4, 2, 10), no hedging.
- One idea per sentence. Conditions before effects ("If the attack fails, …").
- Use the game's terms exactly and capitalised: Group, Illuminati, Plot, Resource, New World Order, Goal,
  Power, Global Power, Resistance, Power Structure, puppet, master, Action token, Attack to Control,
  Attack to Destroy, Privileged, Instant attack, Devastated, Relief, exposed, hidden, Unique, discard pile.
- Alignments and attributes capitalised (Violent, Government, Media, Magic…).
- Never refer to the original game, its publisher or its card wording.

## 4. Voice by card type
- **Group:** the organisation describing itself, or how insiders talk about it.
- **Illuminati:** grand, secretive, sure of its own destiny.
- **Resource:** a catalogue, evidence-locker or auction-lot entry for the object.
- **Plot:** a headline, a memo, or the moment it happens.
- **Disaster:** a news bulletin or insurance report. **Assassination:** a dossier or a coroner's footnote.
- **New World Order:** a decree or a new normal. **Goal:** a manifesto line.

## 5. Tone matched to power
- High Power (7+) or Illuminati: imposing, confident, a little ominous.
- Middle (4–6): professional, knowing, wry.
- Low (1–3): petty, absurd, small-time, still funny.
- Alignments colour the joke: Violent = menace, Peaceful = sanctimony, Weird = uncanny, Straight = buttoned-down,
  Government = red tape, Corporate = spin, Criminal = racket, Fanatic = zeal, Liberal/Conservative = their own clichés.

## 6. Satire rules (see ART_AND_CUSTOMIZATION.md)
Punch up, never down: mock the powerful, protect the people. No slurs, no stereotypes of peoples, faiths or
minorities, no victims as the joke, no real people's appearance, race, religion, sex or family as the joke.
No quotations credited to anyone, no song or film lines, no real slogans.

## 7. Variety
- No two flavour lines share an opening of 3+ words; no stock template sentences.
- Avoid overused words across the set (e.g. "shadow", "secret", "control" in flavour) unless the joke needs them.

## 8. Checks for every card
1. Rules text matches the engine (every number and condition present).
2. Word counts inside the budget.
3. Originality check passes (tools/check_entry.py).
4. Tone rules pass.
