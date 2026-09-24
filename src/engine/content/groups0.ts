import { registerAbilities } from '../abilities';

registerAbilities({
  'a-m-a': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Science'] }, value: 5, scope: 'direct' },
    { kind: 'pending', note: '+5 when aiding the defense of a Science group' },
  ],
  'american-autoduel-association': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Violent'] }, value: 4, scope: 'direct', replacesAlignmentPenalty: true },
    { kind: 'aidBonus', on: 'destroy', target: { alignments: ['Violent'] }, value: 4 },
  ],
  'anti-nuclear-activists': [
    { kind: 'attackBonus', on: 'destroy', target: { attributes: ['Science'] }, value: 6, scope: 'direct' },
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Green'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: '+10 (instead of +6, not stacking) vs Nuclear Power Companies' },
  ],
  'anti-war-activists': [
    { kind: 'structureDefense', value: 4, vs: { alignments: ['Government'] } },
  ],
  'bank-of-england': [
    { kind: 'pending', note: 'Action (any time): draw two Plot cards' },
  ],
  'b-a-t-f': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Fanatic'] }, value: 8, scope: 'direct' },
    { kind: 'attackBonus', on: 'both', target: { names: ['gun-lobby', 'tobacco-companies', 'liquor-companies'] }, value: 6, scope: 'direct' },
  ],
  'big-media': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Media'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'May aid or oppose any attack by or against a Media group' },
  ],
  'black-activists': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Liberal'] }, value: 2, scope: 'direct' },
    { kind: 'selfDefense', value: 4, vs: { alignments: ['Liberal'] } },
  ],
  'boy-sprouts': [
    { kind: 'pending', note: 'Power counts as 12 for Relief; draw a Plot whenever they help with Relief' },
  ],
  'cable-tv': [
    { kind: 'powerPer', per: { subtypes: ['Personality'] }, value: 1, global: true },
  ],
  'cattle-mutilators': [
    { kind: 'pending', note: 'Action: expose all hidden Plots of one rival' },
  ],
  'cfl-aio': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Corporate'] }, value: 10, scope: 'direct', replacesAlignmentPenalty: true },
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Corporate'] }, value: 4, scope: 'any' },
  ],
  'church-of-elvis': [
    { kind: 'pending', note: 'Power becomes 4 while Elvis is in play, 8 while you control Elvis' },
  ],
  'c-i-a': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Government'], notSelf: true }, value: 4, scope: 'direct', replacesAlignmentPenalty: true },
    { kind: 'pending', note: 'May turn a Personality destruction attempt into an Assassination (Instant attack)' },
  ],
  'clone-arrangers': [
    { kind: 'attackBonus', on: 'control', target: { subtypes: ['Personality'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'Action: restore a just-killed Personality to an open control arrow (not counted as destroyed)' },
  ],
  'comic-books': [
    { kind: 'pending', note: 'Attacking/aiding control of a Weird group: target printed Resistance becomes 0 and no Weird-master bonus' },
  ],
  'congressional-wives': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Government'] }, value: 10, scope: 'direct' },
  ],
  'conspiracy-theorists': [
    { kind: 'handLimit', value: 1 },
  ],
  'cycle-gangs': [
    { kind: 'attackBonus', on: 'destroy', value: 2, scope: 'any' },
    { kind: 'pending', note: '+4 to any non-Space Disaster you play' },
  ],
  'democrats': [
    { kind: 'pending', note: '+4 direct control of Government groups that are not Nations (needs negated match)' },
  ],
  'dentists': [
    { kind: 'pending', note: 'Action: cancel the action(s) of a Personality' },
  ],
  'deprogrammers': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Weird', 'Fanatic'] }, value: 4, scope: 'direct' },
    { kind: 'attackBonus', on: 'destroy', target: { allAlignments: ['Weird', 'Fanatic'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'May affect Discordian-protected Straight targets' },
  ],
  'druids': [
    { kind: 'pending', note: 'May aid/oppose attacks by or against Magic groups (even Secret); link to a Place for +8 vs Disasters, destroyed with it' },
  ],
  'eco-guerrillas': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Corporate'] }, value: 6, scope: 'direct' },
    { kind: 'structureDefense', value: 2, vs: { alignments: ['Corporate'] } },
  ],
  'eff': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'When helping defend a Computer group, doubles total Power spent by defenders' },
  ],
  'elders-of-zion': [
    { kind: 'pending', note: 'Own action + Illuminati action: reorganize entire Power Structure' },
  ],
  'empty-vee': [
    { kind: 'pending', note: 'Media groups in your Power Structure immune to Straight attackers (structureImmune limited to a subset)' },
    { kind: 'pending', note: 'Each Personality you control gets +1 Power (buff to other groups)' },
  ],
  'evil-geniuses-for-a-better-tomorrow': [
    { kind: 'pending', note: 'Action: auto-take a Gadget from hand and link it; linked Resources cannot be unlinked' },
  ],
  'fast-food-chains': [
    { kind: 'attackBonus', on: 'destroy', target: { attributes: ['Green'] }, value: 6, scope: 'direct' },
    { kind: 'pending', note: 'On your turn may hide two exposed Plots for free' },
  ],
  'fbi': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Criminal'] }, value: 10, scope: 'direct' },
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Criminal'] }, value: 4, scope: 'any' },
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Criminal'] }, value: 2, scope: 'direct' },
  ],
  'federal-reserve': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Bank'] }, value: 6, scope: 'any' },
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Nation'] }, value: 2, scope: 'any' },
    { kind: 'attackBonus', on: 'both', target: { alignments: ['Corporate'] }, value: 2, scope: 'any' },
    { kind: 'pending', note: 'Nation-or-Corporate +2 should apply once; the two entries stack on Corporate Nations (needs OR match across attribute/alignment)' },
  ],
  'feminists': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Liberal'] }, value: 3, scope: 'direct' },
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Conservative'] }, value: 3, scope: 'direct' },
    { kind: 'pending', note: 'Action: draw a random rival Group card, keep only if Liberal' },
  ],
  'fiendish-fluoridators': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Straight', 'Conservative'] }, value: 5, scope: 'direct' },
    { kind: 'drawPlotOnDestroy', match: { alignments: ['Straight', 'Conservative'] } },
  ],
  'flat-earthers': [
    { kind: 'pending', note: 'Action: roll 2d6; if <= number of Places in play, draw that many Plots' },
  ],
  'fnord-motor-company': [
    { kind: 'pending', note: 'Action: discard a Plot to reroll a failed attack by another group you control' },
  ],
  'fraternal-orders': [
    { kind: 'pending', note: 'Action (any time): draw a Group card' },
  ],
  'fred-birch-society': [
    { kind: 'pending', note: 'Counts double as Conservative for Illuminated goals only' },
  ],
  'gay-activists': [
    { kind: 'pending', note: 'Action (not during an attack): reverse one alignment of any group until end of turn' },
  ],
  'girlie-magazines': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Straight'] }, value: 5, scope: 'direct' },
  ],
  'goldfish-fanciers': [
    { kind: 'structureImmune', from: { alignments: ['Fanatic'] } },
  ],
  'gun-lobby': [
    { kind: 'pending', note: 'Resistance becomes 10 vs Liberal, Weird or Communist attackers (set-to value, not a bonus)' },
    { kind: 'pending', note: 'After an attack on one of your Conservative/Violent groups resolves, draw a Plot if it stays controlled' },
  ],
  'hackers': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 4, scope: 'direct' },
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Computer'] }, value: 2, scope: 'any' },
  ],
  'intellectuals': [
    { kind: 'pending', note: 'Media master cannot be captured/destroyed except by Disaster or Assassination; master gets +1 Power' },
  ],
  'international-cocaine-smugglers': [
    { kind: 'pending', note: '+4 to control specified drug/crime/media groups and qualifying Personalities (target list unspecified)' },
  ],
  'international-communist-conspiracy': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Communist'] }, value: 3, scope: 'direct' },
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Fanatic'], attributes: ['Communist'] }, value: 4, scope: 'direct', replacesAlignmentPenalty: true },
    { kind: 'pending', note: '+3 to control puppets of Communist masters; unclear whether +3 and +4 stack on Fanatic Communist targets' },
  ],
  'international-weather-organization': [
    { kind: 'pending', note: 'Your Places +6 vs Disasters; your non-Space Disasters vs rival Places +4' },
  ],
  'i-r-s': [
    { kind: 'pending', note: 'Start of turn: may take the top Plot of one rival deck (rival sees it first)' },
  ],
  'joggers': [
    { kind: 'cannotBeDestroyed' },
    { kind: 'pending', note: '+2 to Assassinations' },
  ],
  'junk-mail': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Secret'] }, value: 6, scope: 'direct' },
    { kind: 'pending', note: 'May directly attack, aid or oppose Secret groups' },
  ],
  'kkk': [
    { kind: 'pending', note: 'Making/aiding destruction of a Peaceful group doubles Power of all Violent groups on both sides' },
  ],
  'l-4-society': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Science', 'Space'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: '+8 (not stacking with +4) on direct control of Space groups' },
  ],
  'lawyers': [
    { kind: 'structureDefense', value: 4, vs: { alignments: ['Government', 'Corporate'] } },
    { kind: 'pending', note: 'Immune to the I.R.S. tax effect' },
  ],
  'libertarians': [
    { kind: 'pending', note: 'Doubles attacking Power when taking a Group from a Government master; Power becomes that of a taken Nation/U.S. state' },
  ],
  'liquor-companies': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Media'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'Action: cancel one rival card-draw opportunity' },
  ],
  'loan-sharks': [
    { kind: 'powerPer', per: { alignments: ['Criminal'] }, value: 1 },
  ],
  'local-police-departments': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Criminal'] }, value: 4, scope: 'direct' },
    { kind: 'cannotBeDestroyed' },
    { kind: 'pending', note: 'Master gets +1 Power and +3 Resistance' },
  ],
});
