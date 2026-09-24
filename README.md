# Elitists War

A digital version of the INWO card game, built from the rules and card database in
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
