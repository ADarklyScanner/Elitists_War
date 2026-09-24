import { registerAbilities } from '../abilities';

// The nine Illuminati. Parts that are not encoded yet are listed as 'pending'.
registerAbilities({
  'adepts-of-hermes': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Magic'] }, value: 6, scope: 'any' },
    { kind: 'failedHandReturns' },
    { kind: 'pending', note: 'Magic Resources count as controlled Groups for victory (no Resources in this version)' },
  ],
  'bavarian-illuminati': [
    { kind: 'freePrivilegedAttack' },
    { kind: 'specialGoal', goal: 'totalPower', value: 50 },
  ],
  'bermuda-triangle': [
    { kind: 'specialGoal', goal: 'bermuda', value: 35 },
    { kind: 'pending', note: 'May reorganize its Power Structure freely at the end of its turn' },
  ],
  'discordian-society': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Weird'] }, value: 4, scope: 'any' },
    { kind: 'doubleCount', match: { alignments: ['Weird'] }, minPower: 3 },
    { kind: 'structureImmune', from: { alignments: ['Government', 'Straight'] } },
  ],
  'gnomes-of-zurich': [
    { kind: 'handLimit', value: 1 },
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Bank'] }, value: 4, scope: 'any' },
    { kind: 'doubleCount', match: { alignments: ['Corporate'] }, minPower: 4 },
    { kind: 'doubleCount', match: { attributes: ['Bank'] }, minPower: 4 },
  ],
  'the-network': [
    { kind: 'extraPlotDraw', value: 1 },
    { kind: 'doubleCount', match: { attributes: ['Computer'] }, minPower: 3 },
  ],
  'servants-of-cthulhu': [
    { kind: 'attackBonus', on: 'destroy', value: 4, scope: 'any', instant: true },
    { kind: 'drawPlotOnDestroy' },
    { kind: 'specialGoal', goal: 'destroyCount', value: 8 },
  ],
  'shangri-la': [
    { kind: 'structureDefense', value: 5, instant: true },
    { kind: 'canOnlyDestroy', match: { alignments: ['Violent'] } },
    { kind: 'specialGoal', goal: 'peacefulPower', value: 30 },
  ],
  'ufos': [
    { kind: 'extraIlluminatiToken', value: 1 },
    { kind: 'pending', note: 'May hold up to three Goal cards (no Goal cards in this version)' },
  ],
});
