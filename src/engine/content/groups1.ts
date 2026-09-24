import { registerAbilities } from '../abilities';

registerAbilities({
  'madison-avenue': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Media'] }, value: 10, scope: 'direct' },
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Media'] }, value: 2, scope: 'any' },
  ],
  'mi-5': [
    { kind: 'pending', note: 'Action: negate an attempt to expose your Plots, or turn all your exposed Plots face down' },
  ],
  'moonies': [
    { kind: 'pending', note: 'Action: interfere in a privileged attack on either side regardless of alignment, ending the privilege' },
  ],
  'moral-minority': [
    { kind: 'powerPer', per: { alignments: ['Straight'] }, value: 1 },
  ],
  'mossad': [
    { kind: 'pending', note: 'When drawing a Plot, may inspect and take the bottom card instead' },
  ],
  'multinational-oil-companies': [
    { kind: 'pending', note: 'When making/aiding an attack in multiplayer, designate one rival who cannot interfere' },
  ],
  'nasa': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Space'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'May transfer its Action token to another Government group you control lacking one (not during an attack)' },
  ],
  'nato': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Nation'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'May interfere in attacks by or against Nations; Power tripled for Relief' },
  ],
  'nephews-of-god': [
    { kind: 'pending', note: 'Before normal draw each turn roll 2d6; on 6 or less draw one extra card from either deck' },
  ],
  'ninjas': [
    { kind: 'attackBonus', on: 'destroy', value: 2, scope: 'direct' },
    { kind: 'selfDefense', value: 10, on: 'destroy', instant: true },
    { kind: 'pending', note: '+4 to Assassination attempts; failed control/destroy attempts against Ninjas give them an Action token' },
  ],
  'n-s-a': [
    { kind: 'pending', note: 'Once per turn free (or as an action) inspect top or bottom three Plots of any deck' },
  ],
  'nuclear-power-companies': [
    { kind: 'pending', note: "Action: cancel another Group's (or Illuminati) action" },
  ],
  'offshore-banks': [
    { kind: 'pending', note: 'Immune to destruction (only) by Government, Corporate or Criminal groups; once per turn freely move one of your Groups to another legal position' },
  ],
  'opec': [
    { kind: 'pending', note: 'Variable Power: 2d6-2 on takeover and each turn start, +1 if you control Texas, +1 if Multinational Oil Companies' },
  ],
  'paranoids': [
    { kind: 'structureDefense', value: 2 },
    { kind: 'pending', note: 'Structure +2 also vs Assassinations (not Disasters); no Action tokens and cannot act while Power is 0; cannot be destroyed while Power is 0' },
  ],
  'phone-company': [
    { kind: 'pending', note: 'On your turn freely inspect two random hidden rival Plots; action: expose two random hidden rival Plots' },
  ],
  'phone-phreaks': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Computer'] }, value: 6, scope: 'direct' },
    { kind: 'pending', note: "Action: move any eligible Group in any Power Structure to another legal arrow (not a rival's direct Illuminati puppet, not during an attack)" },
  ],
  'pollsters': [
    { kind: 'pending', note: 'When involved in an attack, ignore alignment modifiers that would hurt your side' },
  ],
  'post-office': [
    { kind: 'pending', note: 'On your turn freely inspect two random Group cards in a rival hand; action: expose two random rival Group cards' },
  ],
  'professional-sports': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Straight'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'A Personality linked to it gets +3 Power' },
  ],
  'psychiatrists': [
    { kind: 'pending', note: '+6 to destroy a Personality except during a privileged attack; action: force a rival to discard one exposed non-Goal Plot' },
  ],
  'punk-rockers': [
    { kind: 'pending', note: 'When their Power is used in an attack, Weird or Liberal groups may not aid the target' },
  ],
  'recording-industry': [
    { kind: 'pending', note: 'Your Media Personalities get +2 Power; your other Personalities +1 Power' },
  ],
  'red-cross': [
    { kind: 'selfDefense', value: 15, on: 'destroy', instant: true },
    { kind: 'pending', note: 'Structure +6 vs Disasters only; master gets automatic Relief after devastation; action: Relief one Place' },
  ],
  'reformed-church-of-satan': [
    { kind: 'selfDefense', value: 8, vs: { alignments: ['Straight'] } },
    { kind: 'pending', note: 'Straight groups cannot attack or aid attacks on your other groups; can only be attacked to destroy' },
  ],
  'religious-reich': [
    { kind: 'pending', note: 'May interfere in privileged attacks made or aided by Straight or Conservative groups, ending the privilege' },
  ],
  'republicans': [
    { kind: 'pending', note: '+5 direct control of Government groups that are NOT Nations (needs negated match)' },
  ],
  'rifkinites': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Green'] }, value: 6, scope: 'direct' },
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Corporate'] }, value: 2, scope: 'direct' },
    { kind: 'attackBonus', on: 'destroy', target: { attributes: ['Science'] }, value: 2, scope: 'direct' },
    { kind: 'attackBonus', on: 'destroy', target: { attributes: ['Space'] }, value: 2, scope: 'direct' },
    { kind: 'attackBonus', on: 'destroy', target: { attributes: ['Computer'] }, value: 2, scope: 'direct' },
  ],
  'robot-sea-monsters': [
    { kind: 'attackBonus', on: 'destroy', target: { names: ['japan', 'california'] }, value: 10, scope: 'direct' },
    { kind: 'pending', note: '+4 to destroy Corporate, Government or Coastal Places (OR across alignment/attribute), including qualifying Disasters except Space' },
  ],
  'rosicrucians': [
    { kind: 'pending', note: 'When entitled to draw a Plot, may instead search the Plot deck for any card and shuffle (uses their action)' },
  ],
  'saturday-morning-cartoons': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Violent'] }, value: 2, scope: 'direct' },
    { kind: 'pending', note: 'Its puppets become Violent while controlled' },
  ],
  'savings-and-loans': [
    { kind: 'pending', note: '+3 to control Corporate, Government, or Bank groups (OR across alignment/attribute); action: cancel an action by a Bank, Corporate or Government group' },
  ],
  'science-fiction-fans': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Computer'] }, value: 2, scope: 'direct' },
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Weird'] }, value: 2, scope: 'direct' },
    { kind: 'pending', note: 'Their master gets +6 to control or destroy Computer groups' },
  ],
  'secret-service': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Government'], subtypes: ['Personality'] }, value: 10, scope: 'direct' },
    { kind: 'pending', note: '+10 also applies to Assassinations of Government Personalities; specified direct-destruction modifier vs other Government groups' },
  ],
  'secular-humanists': [
    { kind: 'pending', note: 'Straight or Conservative attacks against your OTHER groups (not this one) are -3' },
  ],
  'semiconscious-liberation-army': [
    { kind: 'attackBonus', on: 'destroy', value: 3, scope: 'any' },
  ],
  's-m-o-f': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Weird'] }, value: 2, scope: 'direct' },
    { kind: 'pending', note: 'Additional +4 direct vs specified fandom groups (list unknown); once on your turn freely remove an Action token from a rival Weird group' },
  ],
  'society-for-creative-anarchism': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Straight'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'Action: force a rival to discard the top Group card of their deck' },
  ],
  'south-american-nazis': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Weird'], attributes: ['Science'] }, value: 6, scope: 'direct' },
    { kind: 'pending', note: 'Weird Science puppets get +3 Power' },
  ],
  'subliminals': [
    { kind: 'powerPer', per: { attributes: ['Media'] }, value: 1 },
    { kind: 'pending', note: 'Global Power also +1 per Media group you control' },
  ],
  'supreme-court': [
    { kind: 'pending', note: "Action: cancel a Government Group's action" },
  ],
  'survivalists': [
    { kind: 'pending', note: 'Structure +3 vs Disasters only; master and puppets get free automatic Relief the turn after devastation' },
  ],
  'tabloids': [
    { kind: 'pending', note: 'May directly attack Secret groups (target loses Secret; aid either side regardless of alignment); +3 involving Convenience Stores' },
  ],
  'telephone-psychics': [
    { kind: 'attackBonus', on: 'control', target: { names: ['ronald-reagan', 'nancy-reagan', 'tabloids'] }, value: 6, scope: 'direct' },
    { kind: 'pending', note: '+6 direct control also vs qualifying low-Power Media groups (needs Power-threshold match)' },
  ],
  'templars': [
    { kind: 'pending', note: 'Action: force discard of an exposed Plot controlled by a rival' },
  ],
  'the-mafia': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Criminal'] }, value: 4, scope: 'direct', replacesAlignmentPenalty: true },
    { kind: 'attackBonus', on: 'both', target: { alignments: ['Criminal'] }, value: 2, scope: 'any' },
  ],
  'the-men-in-black': [
    { kind: 'attackBonus', on: 'destroy', value: 4, scope: 'direct' },
    { kind: 'pending', note: 'Targets they successfully destroy are removed from the game permanently' },
  ],
  'tobacco-companies': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Government'] }, value: 8, scope: 'direct', replacesAlignmentPenalty: true },
    { kind: 'pending', note: 'Green groups get +4 to destroy Tobacco Companies' },
  ],
  'trekkies': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Media'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'Media groups get +4 to attack to control Trekkies' },
  ],
  'triliberal-commission': [
    { kind: 'pending', note: 'Counts double as Liberal for Illuminati goal calculation only' },
  ],
  'tv-preachers': [
    { kind: 'attackBonus', on: 'control', target: { allAlignments: ['Straight', 'Fanatic'] }, value: 6, scope: 'direct', replacesAlignmentPenalty: true },
    { kind: 'pending', note: 'Their puppets get +5 Resistance' },
  ],
  'underground-newspapers': [
    { kind: 'pending', note: 'Draw an extra Plot whenever they help (lead or aid) destroy a Corporate, Straight or Government group' },
  ],
  'united-nations': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Nation'] }, value: 6, scope: 'direct' },
    { kind: 'pending', note: 'Power multiplied by five for Relief' },
  ],
  'urban-gangs': [
    { kind: 'attackBonus', on: 'destroy', value: 2, scope: 'any' },
    { kind: 'pending', note: '+2 also applies to Assassinations (Instant, not Disasters)' },
  ],
  'vampires': [
    { kind: 'attackBonus', on: 'control', target: { subtypes: ['Personality'] }, value: 4, scope: 'direct' },
    { kind: 'pending', note: 'Controlled Personalities become Vampires (Magic-only destruction, permanent death rules)' },
  ],
  'video-games': [
    { kind: 'attackBonus', on: 'control', target: { names: ['convenience-stores'] }, value: 3, scope: 'direct' },
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 3, scope: 'direct' },
    { kind: 'pending', note: 'All your other Computer groups get +1 Power' },
  ],
});
