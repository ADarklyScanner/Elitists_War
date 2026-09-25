# Elitists War

A digital strategy card game of secret societies, built from the rules and card database in
`data/Elitists_War.xlsx`.

- `src/engine/` — the rules engine. The whole game is one JSON `GameState`; `applyAction(state, player, action)`
  checks a move against the rules and returns the next state. It can run in a browser or on a server.
  - `content/` — card behaviour: Illuminati, Group abilities (`groups*.ts`), and Plot cards (`plots.ts`).
  - `abilities.ts` — the reusable ability building blocks. Parts of a card not yet encoded are marked `pending`.
- `src/ai/` — the computer opponent.
- `src/ui/` — the browser client (play against the computer, games saved in the browser).
- `tools/export_cards.py` — regenerates `src/data/cards.json` from the workbook.

```
npm test               # rules tests + 60 computer-vs-computer games
node tools/build.mjs   # builds dist/elitists-war.html (one self-contained page)
```

## Text alerts (optional)

Players can opt in from the online lobby with a mobile number. A text goes out only when:

- a game they joined starts (the last seat fills);
- their turn begins;
- one of their Groups is the target of an Attack to Destroy.

Nobody gets more than one text every 5 minutes; the database function `ew_claim_sms` enforces this
atomically. Texts that fall inside the cooldown are dropped, not queued. The player who just moved is never texted.

Texting is off until the `ew-game` Edge Function has these secrets (Supabase dashboard → Edge Functions → Secrets):

| Secret | Value |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID (`AC…`) |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM` | A Twilio number in `+1…` form, or a Messaging Service SID (`MG…`) |
| `EW_SITE_URL` | optional; link put in each text (defaults to the GitHub Pages site) |

US numbers need A2P 10DLC registration, or a verified toll-free number, before carriers deliver texts. Twilio handles STOP replies automatically.

## Before a public release

- Add a line to the start screen saying this is an unofficial fan-made project, not affiliated with or endorsed by the publisher of the original card game.
- Decide what to do with `data/Elitists_War.xlsx`: its research notes cite the original game and publisher (keep it private, or reword the citations).
- Re-run `tools/check_originality.py` (with the local reference files) and make sure it reports 0 problems.
- Keep the game free, with no ads or sales.
