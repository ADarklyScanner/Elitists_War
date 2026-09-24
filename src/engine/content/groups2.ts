import { registerAbilities } from '../abilities';

registerAbilities({
  'voudonistas': [
    { kind: 'attackBonus', on: 'destroy', target: { subtypes: ['Personality'] }, value: 8, scope: 'direct' },
    { kind: 'pending', note: 'Assassination defenses from other cards that are not specifically anti-Magic still apply against it (only Moonbase honours this); needs defenses tagged as Magic-specific' },
  ],
  'wall-street': [],
  'wargamers': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Computer'] }, value: 2, scope: 'direct' },
  ],
  'w-i-t-c-h': [],
  'al-gore': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Green'] }, value: 8, scope: 'direct' },
  ],
  'bill-clinton': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Government'] }, value: 8, scope: 'direct' },
    { kind: 'pending', note: '+3 to control U.S. Government groups (no U.S. attribute); Liberal status determined by die roll when relevant' },
  ],
  'bjorne': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Media'] }, value: 4, scope: 'direct' },
  ],
  'count-dracula': [
    { kind: 'attackBonus', on: 'control', target: { names: ['vampires'] }, value: 10, scope: 'direct' },
    { kind: 'pending', note: 'Linked Magic Artifacts cannot be taken from him or lost while he lives (needs a hook protecting Resources from being stolen or discarded)' },
  ],
  'dan-quayle': [],
  'elvis': [
    { kind: 'attackBonus', on: 'control', target: { names: ['church-of-elvis'] }, value: 6, scope: 'direct' },
  ],
  'fidel-castro': [
    { kind: 'pending', note: 'May hide one Plot linked beneath him (unexposable); may relink after the Plot is used' },
  ],
  'george-bush': [],
  'gordo-remora': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Weird'] }, value: 10, scope: 'direct' },
  ],
  'hillary-clinton': [
    { kind: 'attackBonus', on: 'control', target: { names: ['bill-clinton', 'congressional-wives', 'democrats'] }, value: 2, scope: 'any' },
    { kind: 'attackBonus', on: 'control', target: { names: ['bill-clinton', 'congressional-wives', 'democrats'] }, value: 6, scope: 'direct' },
  ],
  'imelda-marcos': [],
  'jimmy-hoffa': [
    { kind: 'attackBonus', on: 'control', target: { names: ['cfl-aio'] }, value: 6, scope: 'direct' },
  ],
  'manuel-noriega': [
    { kind: 'attackBonus', on: 'control', target: { names: ['international-cocaine-smugglers'] }, value: 6, scope: 'direct' },
  ],
  'margaret-thatcher': [
    { kind: 'attackBonus', on: 'control', target: { names: ['england'] }, value: 10, scope: 'direct' },
  ],
  'media-sensation': [
    { kind: 'pending', note: 'Multiple copies legal with unique Personality names; destroying one does not count toward Goals' },
  ],
  'nancy-reagan': [
    { kind: 'attackBonus', on: 'control', target: { names: ['ronald-reagan'] }, value: 10, scope: 'direct' },
  ],
  'ollie-north': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Conservative'], attributes: ['Media'] }, value: 8, scope: 'direct' },
  ],
  'prince-charles': [],
  'princess-di': [],
  'ronald-reagan': [
    { kind: 'selfImmune', from: { attributes: ['Media'] } },
    { kind: 'pending', note: 'After he makes/aids an attack, Media groups cannot join the opposite side' },
  ],
  'ross-perot': [
    { kind: 'pending', note: 'Groups he controls become Straight and Conservative, losing Weird/Liberal, until they get a new master' },
  ],
  'saddam-hussein': [],
  'brazil': [],
  'california': [],
  'canada': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Green'] }, value: 10, scope: 'direct' },
  ],
  'center-for-disease-control': [
    { kind: 'attackBonus', on: 'destroy', target: { subtypes: ['Place'] }, value: 15, scope: 'direct' },
  ],
  'china': [
    { kind: 'selfDefense', value: 20, on: 'destroy', instant: true },
  ],
  'dinosaur-park': [],
  'england': [],
  'finland': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 6, scope: 'direct' },
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 2, scope: 'any' },
  ],
  'france': [],
  'germany': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Science'] }, value: 2, scope: 'direct' },
  ],
  'hawaii': [],
  'hollywood': [
    { kind: 'powerPer', per: { attributes: ['Media'], subtypes: ['Personality'] }, value: 2, global: true },
  ],
  'israel': [
    { kind: 'attackBonus', on: 'control', target: { names: ['mossad'] }, value: 8, scope: 'direct' },
  ],
  'italy': [],
  'japan': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Science', 'Computer'] }, value: 6, scope: 'direct' },
  ],
  'las-vegas': [
    { kind: 'pending', note: 'Action: wager 1-3 Plots against a rival, resolve 2d6 card-transfer gamble' },
  ],
  'moonbase': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Space'] }, value: 4, scope: 'direct' },
  ],
  'new-york': [],
  'orbit-one': [],
  'pentagon': [],
  'russia': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Communist'] }, value: 4, scope: 'direct' },
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Communist'] }, value: 2, scope: 'any' },
    { kind: 'pending', note: 'Communist +4 on direct control of Russia works only while Russia is in play, not when it is attacked from hand (hooks of a card in hand are inactive)' },
  ],
  'silicon-valley': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 4, scope: 'direct' },
  ],
  'stonehenge': [
    { kind: 'structureImmune', from: { attributes: ['Magic'] } },
    { kind: 'pending', note: 'Also immune to effects of Magic Plots and Resources' },
  ],
  'switzerland': [
    { kind: 'pending', note: 'Gnomes +15 direct control works only while Switzerland is in play, not when it is attacked from hand (hooks of a card in hand are inactive)' },
  ],
  'texas': [
    { kind: 'pending', note: 'May hide one non-Goal Plot beneath it beyond hand limit, unexposable, swappable; lost if Texas is captured/destroyed' },
  ],
  'vatican-city': [
    { kind: 'structureImmune', from: { alignments: ['Peaceful'] } },
  ],
  'the-great-pyramid': [
    { kind: 'pending', note: 'Rivals must show you the first Plot they draw each turn (needs private reveals to one player)' },
  ],
  'pyramid-marketing-schemes': [
    { kind: 'powerPer', per: { alignments: ['Fanatic'] }, value: 1 },
  ],
  'trading-card-games': [],
});
