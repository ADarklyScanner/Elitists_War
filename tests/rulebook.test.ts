import { describe, expect, it } from 'vitest';
import { PARTS, RULEBOOK, RULES_PANEL_LINKS, plainText, sectionById } from '../src/ui/rulebook';
// @ts-expect-error: Vite's ?raw import gives the file's text (the project has no Node types).
import mainSource from '../src/ui/main.ts?raw';

const ids = new Set(RULEBOOK.map((s) => s.id));
const all = RULEBOOK.map(plainText).join(' \n ').toLowerCase();

describe('the full rulebook', () => {
  it('has unique section ids, and every section belongs to a listed part', () => {
    expect(ids.size).toBe(RULEBOOK.length);
    for (const s of RULEBOOK) {
      expect(PARTS, s.id).toContain(s.part);
      expect(s.title.length, s.id).toBeGreaterThan(3);
      expect(s.body.length, s.id).toBeGreaterThan(200);
    }
  });

  it('every section the in-game Rules panel links to exists', () => {
    for (const [tab, target] of Object.entries(RULES_PANEL_LINKS)) expect(sectionById(target), `${tab} → ${target}`).toBeDefined();
    // Every tab of the Rules panel (the nav in main.ts) has a link, and every data-rulebook target in the UI exists.
    const main = mainSource as string;
    const nav = main.match(/rule-nav">\$\{\[(.*?)\]\.map/s)?.[1] ?? '';
    const tabs = [...nav.matchAll(/\['(\w+)', '/g)].map((m) => m[1]);
    expect(tabs.length).toBeGreaterThan(5);
    for (const t of [...tabs, 'foes']) expect(RULES_PANEL_LINKS[t], `Rules tab ${t}`).toBeDefined();
    for (const m of main.matchAll(/data-rulebook="([\w-]+)"/g)) expect(ids, m[1]).toContain(m[1]);
  });

  it('internal cross-references point at real sections', () => {
    for (const s of RULEBOOK) for (const m of s.body.matchAll(/data-rb-goto="([\w-]+)"/g)) expect(ids, `${s.id} → ${m[1]}`).toContain(m[1]);
  });

  it('covers every topic a strict player expects', () => {
    const sections = ['intro', 'components', 'anatomy', 'setup', 'turn', 'tokens', 'structure', 'attacks', 'control', 'destroy', 'helping',
      'privileged', 'instant', 'devastation', 'plots', 'resources', 'nwo', 'immunity', 'duplicates', 'timing', 'victory', 'elimination',
      'deals', 'two-player', 'etiquette', 'deck', 'strategy', 'glossary'];
    for (const id of sections) expect(ids, id).toContain(id);
    const topics = [
      'illuminati', 'organization', 'place', 'personality', 'resource', 'plot', 'disaster', 'assassination', 'goal card', 'new world order',
      'power', 'global power', 'resistance', 'alignment', 'opposite', 'fanatic', 'attribute', 'control arrow', 'open arrow',
      'lead group', 'first player', 'three plots', 'six', 'first-turn protection',
      'action token', 'automatic takeover', 'buy', 'move', 'attack to control', 'attack to destroy', '11 or 12', 'below 2',
      'aid', 'oppose', 'self-defence', 'position', 'loyalty', '+10', '+5', 'privileged', 'instant attack', 'calling it off',
      'captured', 'puppets', 'destroyed pile', 'hand limit', 'exposed', 'hidden', 'cancel', 'link', 'unique', 'nwo',
      'devastated', 'relief', 'three times', 'immune', 'secret', 'agents', 'duplicate', 'faction', 'basic goal', 'special goal',
      'first round', 'declare', 'count double', 'shared', 'eliminated', 'third complete turn', 'deal', 'trade', 'gift', 'binding',
      'two-player', '45 cards', 'theme', 'strategy', 'in this app',
    ];
    for (const t of topics) expect(all, t).toContain(t);
  });

  it('has an Expansions part covering both packs, with notes on how the app plays them', () => {
    expect(PARTS[PARTS.length - 1]).toBe('Expansions');
    const exp = RULEBOOK.filter((s) => s.part === 'Expansions').map((s) => s.id);
    expect(exp).toEqual(['assassins', 'subgenius-mixed', 'subgenius-game']);
    const text = (id: string) => plainText(sectionById(id)!).toLowerCase();
    for (const t of ['zap', 'illuminati action', 'whole power structure', 'paralysis', 'free it', 'freeze', 'defend itself', 'killed', 'assassination', 'disaster', 'instant', 'society of assassins', 'australia'])
      expect(text('assassins'), t).toContain(t);
    for (const t of ['slack', 'three slack', 'subgenius attribute', 'requires', 'your own', 'uncontrolled area', 'hand'])
      expect(text('subgenius-mixed'), t).toContain(t);
    for (const t of ['shared', 'three plots', 'lead', 'fewer than eight', 'automatic takeover', 'uncontrolled area', 'one slack', 'position bonus', '10 groups', '12 with two', 'secret', 'third complete turn', 'discard'])
      expect(text('subgenius-game'), t).toContain(t);
    for (const id of exp) expect(sectionById(id)!.body, id).toContain('class="rb-app"');
    // The glossary knows the new words.
    for (const t of ['zap', 'freeze', 'slack', 'uncontrolled area', 'paralyzed']) expect(plainText(sectionById('glossary')!).toLowerCase(), t).toContain(t);
    // The in-game Rules window has an Expansions tab that leads to the pack sections.
    expect(RULES_PANEL_LINKS.packs).toBe('assassins');
    const main = mainSource as string;
    for (const id of ['assassins', 'subgenius-game', 'subgenius-mixed']) expect(main, id).toContain(`'${id}'`);
  });

  it('marks where the app differs, and never names the original game or its publisher', () => {
    expect(RULEBOOK.filter((s) => s.body.includes('class="rb-app"')).length).toBeGreaterThanOrEqual(20);
    expect(all).not.toMatch(/steve jackson|sjgames|inwo|world domination handbook/);
  });
});
