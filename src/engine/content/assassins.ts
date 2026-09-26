// Assassins pack (125 cards). Card agents add the pack's cards here (or in assassins2.ts, ... imported
// from src/engine/index.ts). Build Zaps, Paralysis and Freezes with the families in ./families.ts:
//
//   registerZap('brushfire-war', { noTakeover: { alignments: ['Peaceful'] } });
//   registerPlots({ 'cat-juggling': paralysisPlot({ on: { alignments: ['Peaceful'] }, pay: { alignments: ['Violent'] } }) });
//   registerPlots({ 'junk-bonds': freezePlot({ match: { attributes: ['Bank'] }, label: 'Bank' }) });
//
// See docs/CARD_SCRIPTING.md, "Expansions", and docs/EXPANSIONS.md for the rules behind them.
export {};
