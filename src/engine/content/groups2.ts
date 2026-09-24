import { registerAbilities } from '../abilities';

registerAbilities({
  'voudonistas': [
    { kind: 'attackBonus', on: 'destroy', target: { subtypes: ['Personality'] }, value: 8, scope: 'direct' },
    { kind: 'pending', note: '+4 direct Assassination; non-Magic-specific Assassination defenses do not apply' },
  ],
  'wall-street': [
    { kind: 'pending', note: 'May treat Corporate as Government or vice versa when making/aiding attacks; its puppets get +10 Resistance' },
  ],
  'wargamers': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Computer'] }, value: 2, scope: 'direct' },
    { kind: 'pending', note: 'Action: put an exposed Plot on the bottom of its owner\'s deck' },
  ],
  'w-i-t-c-h': [
    { kind: 'pending', note: 'Action after a die roll: alter the roll by 1 (by 2 if a Magic group is involved)' },
  ],
  'al-gore': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Green'] }, value: 8, scope: 'direct' },
  ],
  'bill-clinton': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Government'] }, value: 8, scope: 'direct' },
    { kind: 'pending', note: '+3 to control U.S. Government groups (no U.S. attribute); Liberal status determined by die roll when relevant' },
  ],
  'bjorne': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Media'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'Extra action per Media group directly controlled; if destroyed, destroyer draws extra Plots based on his Power' },
  ],
  'count-dracula': [
    { kind: 'attackBonus', on: 'control', target: { names: ['vampires'] }, value: 10, scope: 'direct' },
    { kind: 'pending', note: 'Can only be destroyed using Magic, then permanently dead; linked Magic Artifacts protected while he lives, lost if he dies' },
  ],
  'dan-quayle': [
    { kind: 'pending', note: 'Action: cancel a Media group\'s action' },
  ],
  'elvis': [
    { kind: 'attackBonus', on: 'control', target: { names: ['church-of-elvis'] }, value: 6, scope: 'direct' },
    { kind: 'pending', note: 'Action: cancel any action taken by a Media group' },
  ],
  'fidel-castro': [
    { kind: 'pending', note: 'May hide one Plot linked beneath him (unexposable); may relink after the Plot is used' },
  ],
  'george-bush': [
    { kind: 'pending', note: 'Controller chooses whether he counts as Conservative when relevant' },
  ],
  'gordo-remora': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Weird'] }, value: 10, scope: 'direct' },
  ],
  'hillary-clinton': [
    { kind: 'attackBonus', on: 'control', target: { names: ['bill-clinton', 'congressional-wives', 'democrats'] }, value: 2, scope: 'any' },
    { kind: 'attackBonus', on: 'control', target: { names: ['bill-clinton', 'congressional-wives', 'democrats'] }, value: 6, scope: 'direct' },
  ],
  'imelda-marcos': [
    { kind: 'pending', note: 'Vs Government/Bank targets may roll: 1-5 Power counts as 5; 6 she is destroyed and credited to target owner' },
  ],
  'jimmy-hoffa': [
    { kind: 'attackBonus', on: 'control', target: { names: ['cfl-aio'] }, value: 6, scope: 'direct' },
    { kind: 'pending', note: 'Action: cancel a Corporate group\'s action' },
  ],
  'manuel-noriega': [
    { kind: 'attackBonus', on: 'control', target: { names: ['international-cocaine-smugglers'] }, value: 6, scope: 'direct' },
    { kind: 'pending', note: 'Master may borrow any of his alignments when making/aiding an attack' },
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
  'prince-charles': [
    { kind: 'pending', note: 'He, master and puppets immune to privileged attacks; any group may aid his defense; Media has doubled Power when attacking him' },
  ],
  'princess-di': [
    { kind: 'pending', note: 'Your other Liberal groups get +1 Power; she and her puppets immune to rival Peaceful/Liberal non-Media groups' },
  ],
  'ronald-reagan': [
    { kind: 'selfImmune', from: { attributes: ['Media'] } },
    { kind: 'pending', note: 'After he makes/aids an attack, Media groups cannot join the opposite side' },
  ],
  'ross-perot': [
    { kind: 'pending', note: 'Groups he controls become Straight and Conservative, losing Weird/Liberal, until they get a new master' },
  ],
  'saddam-hussein': [
    { kind: 'pending', note: 'Action: cancel a Government group\'s action' },
  ],
  'brazil': [
    { kind: 'pending', note: 'Corporate master gets one extra Action token each turn' },
  ],
  'california': [
    { kind: 'pending', note: 'All Media groups you control get +1 Power' },
  ],
  'canada': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Green'] }, value: 10, scope: 'direct' },
  ],
  'center-for-disease-control': [
    { kind: 'attackBonus', on: 'destroy', target: { subtypes: ['Place'] }, value: 15, scope: 'direct' },
    { kind: 'pending', note: 'Failed Place destruction destroys CDC, credited to target owner; action: Relief one Devastated Place' },
  ],
  'china': [
    { kind: 'selfDefense', value: 20, on: 'destroy' },
    { kind: 'pending', note: 'Corporate master gets one extra Action token each turn; +20 defense also vs Disasters' },
  ],
  'dinosaur-park': [
    { kind: 'pending', note: 'Action: +4 to a Disaster; it and its master may aid/oppose attacks on Corporate or Science groups' },
  ],
  'england': [
    { kind: 'pending', note: 'Gets two Action tokens every turn' },
  ],
  'finland': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 6, scope: 'direct' },
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 2, scope: 'any' },
  ],
  'france': [
    { kind: 'pending', note: 'May use its Power freely to defend Liberal groups you control' },
  ],
  'germany': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Science'] }, value: 2, scope: 'direct' },
    { kind: 'pending', note: 'May save unused Action tokens, receives more while holding them, and may combine them in one attack' },
  ],
  'hawaii': [
    { kind: 'pending', note: 'Corporate master gets one extra Action token each turn' },
  ],
  'hollywood': [
    { kind: 'powerPer', per: { attributes: ['Media'], subtypes: ['Personality'] }, value: 2 },
    { kind: 'pending', note: 'Also +2 Global Power per Media Personality you control' },
  ],
  'israel': [
    { kind: 'attackBonus', on: 'control', target: { names: ['mossad'] }, value: 8, scope: 'direct' },
    { kind: 'pending', note: 'May interfere in any attack regardless of alignment, even privileged ones, negating privilege' },
  ],
  'italy': [
    { kind: 'pending', note: 'May use its Power freely to defend Weird groups you control' },
  ],
  'japan': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Science', 'Computer'] }, value: 6, scope: 'direct' },
  ],
  'las-vegas': [
    { kind: 'pending', note: 'Action: wager 1-3 Plots against a rival, resolve 2d6 card-transfer gamble' },
  ],
  'moonbase': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Space'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'Immune to Disasters except nuclear/meteor; linked Personalities +6 vs Assassination and die if Moonbase is destroyed' },
  ],
  'new-york': [
    { kind: 'pending', note: 'All your other Criminal groups get +1 Power' },
  ],
  'orbit-one': [
    { kind: 'pending', note: 'One extra Plot draw per turn per Science puppet; only nuclear/meteor Disasters affect it (errata: Nuclear yes, Earthquake no)' },
  ],
  'pentagon': [
    { kind: 'pending', note: 'One extra Plot draw per turn per Corporate puppet' },
  ],
  'russia': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Communist'] }, value: 4, scope: 'direct' },
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Communist'] }, value: 2, scope: 'any' },
    { kind: 'pending', note: 'Communist groups get +4 on direct control of Russia' },
  ],
  'silicon-valley': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'Action on your turn: draw an extra Plot' },
  ],
  'stonehenge': [
    { kind: 'structureImmune', from: { attributes: ['Magic'] } },
    { kind: 'pending', note: 'Also immune to effects of Magic Plots and Resources' },
  ],
  'switzerland': [
    { kind: 'pending', note: 'Gnomes get +15 direct control and cannot destroy it; another Illuminati controlling it gets +2 attacking the Gnomes' },
  ],
  'texas': [
    { kind: 'pending', note: 'May hide one non-Goal Plot beneath it beyond hand limit, unexposable, swappable; lost if Texas is captured/destroyed' },
  ],
  'vatican-city': [
    { kind: 'structureImmune', from: { alignments: ['Peaceful'] } },
  ],
  'the-great-pyramid': [
    { kind: 'pending', note: 'Rivals must show you their first Plot drawn each turn; immune to Tornadoes and Hurricanes' },
  ],
  'pyramid-marketing-schemes': [
    { kind: 'powerPer', per: { alignments: ['Fanatic'] }, value: 1 },
    { kind: 'pending', note: '+2 Resistance per Fanatic group in your Power Structure' },
  ],
  'trading-card-games': [
    { kind: 'pending', note: 'During your turn, replace it with a Group from hand in the same position, no roll needed' },
  ],
});
