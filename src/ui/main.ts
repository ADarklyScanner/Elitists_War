// Elitists War — browser client for playing against the computer.
// All rules live in the engine; this file only draws the table and turns taps into actions.
import {
  type Action, type GameState, type PlotPlay, type Side,
  applyAction, attackOptions, attackStrength, cardName, CARDS, createGame, currentOutcome, def, finalRoll,
  goalCount, goalNeeded, hasResponse, ILLUMINATI, isImplemented, GROUP_ABILITIES, openArrows, outSides,
  plotOptions, plotsInHand, handLimit, power, resistance, globalPower, alignments, attributes, randomDeck,
  responseOptions, structureCards, subtree, takeoverOptions, tokenBarred, waitingFor, PLOTS, NWO_EFFECTS,
  describePlay, player, leadOptions, type AiLevel, actionCancelled, actionSummary, abilitiesOf, abilityOptions, resourcesOf, canEnterPlay, HOOKS, goalsInHand, goalLimit,
  declareOptions, victoryReminder,
  type Deal, type DealGroup, type DealSide, dealText, dealsAllowed, offersTo, offersFrom, I_LIED, MAX_NOTE, sideEmpty,
  legal, canExpose, specialGoalProgress, agentProblem, agentsOf, reliefPledgesFor, type PlaceCapturedData,
} from '../engine';
import { attachRect, rectOf, ensureLayout, type Rect } from '../engine/geometry';
import { applyDealAnswer, chooseAction, computerDealAnswer, successChance } from '../ai/ai';
import { suggestBots, type TableLevel } from './botMix';
import { cardFace } from './cardFace';
import { mirrorName, styleById, STYLES, WILD_CARDS } from '../ai/personas';
import { foldGame, habitsIn, habitsReport, MIN_GAMES, mirrorSeats, normalizeProfile, observeHuman, type PlayProfile, type ProfileSummary } from '../ai/profile';
import { RULES_PANEL_LINKS, sectionById } from './rulebook';
import './rulebookReader';
import './cardLibrary';
import { assignIlluminati, emptyLineup, lineupRequest, lineupSize, pickId, resolveLineup, SECTIONS, specOf, type BotSpec, type Lineup, type Section } from './lineup';

// ------------------------------------------------------------------ state

type Sel =
  | { kind: 'none' }
  | { kind: 'group'; iid: string }
  | { kind: 'attack'; attacker: string; type: 'control' | 'destroy' }
  | { kind: 'confirm'; attacker: string; target: string; type: 'control' | 'destroy'; side?: Side; plots: PlotPlay[]; privileged?: boolean }
  | { kind: 'move'; group: string; payWith?: string }
  | { kind: 'plot'; card: string }
  | { kind: 'takeover'; card: string }
  | { kind: 'discard'; cards: string[] }
  | { kind: 'resource'; iid: string }
  | { kind: 'link'; resource: string }
  | { kind: 'deck'; deck: 'plot' | 'group' }
  | { kind: 'rearrange'; group: string };

interface Ui {
  slotChoice?: string[];
  picked?: string[];
  buyPick?: string[];
  reliefPick?: { place: string; groups: string[]; partners: string[] };
  /** Groups being pledged toward a Relief several players pay together (R037). */
  pledgePick?: { place: string; groups: string[] };
  /** The Illuminati arrow the lead Group will hang from (R025). */
  leadSide?: Side;
  browse?: { kind: 'discard' | 'destroyed'; player: string };
  game: GameState | null;
  me: string;
  sel: Sel;
  inspect?: string;
  error?: string;
  autoPass: boolean;
  thinking: boolean;
  /** Guide mode: green outlines on what you can use now, red on what you can't, and the next area to go to. */
  /** Follows `help`: outlines and next steps are on in Tutorial and Guided. */
  guide: boolean;
  help: HelpMode;
  view?: { x: number; y: number; z: number; auto: boolean };
  sheetMin?: boolean;
  handMin?: boolean;
  showLog?: boolean;
  /** The Deals panel: offers to answer, your own offers, and a new offer being put together. */
  showDeals?: boolean;
  draft?: DealDraft;
  answers?: Record<string, DealAnswer>;
  showStyle?: boolean;
  lastKey?: string;
  /** The latest attack roll, shown as tumbling dice. */
  dice?: { a: number; b: number; need: number; start: number };
  logSeen?: number;
  logGame?: string;
  /** Which info (i) explanation is open. */
  info?: string;
  /** Open section of the rules reference ('' = closed). */
  showRules?: string;
}

/** An offer being put together in the Deals panel. */
interface DealDraft {
  to: string;
  counterOf?: string;
  give: string[];                 // your cards in hand, Resources and Groups in play
  pay: Record<string, string>;    // your Group -> your card paying for its handover ('' = leave it to them)
  get: string[];                  // their cards you can see, their Resources and Groups
  place: Record<string, string>;  // their Group -> "onto:side" in your Power Structure
  anyPlots: number;
  anyCards: number;
  note: string;
  lie: boolean;
}
/** The choices an offer made to you leaves open. */
interface DealAnswer { choose: string[]; place: Record<string, string>; pay: Record<string, string>; lie: boolean }

type HelpMode = 'tutorial' | 'guided' | 'off';
const HELP_MODES: HelpMode[] = ['tutorial', 'guided', 'off'];
const HELP_LABEL: Record<HelpMode, string> = { tutorial: 'Tutorial', guided: 'Guided', off: 'Help off' };
const HELP_TITLE: Record<HelpMode, string> = {
  tutorial: 'Tutorial: outlines and next steps, plus why things can\'t be done, when Plots can be played, and what happens automatically. Tap for Guided.',
  guided: 'Guided: green/red outlines and the next step. Tap to turn help off.',
  off: 'Help off: the plain game. Tap for Tutorial.',
};

const ui: Ui = { game: null, me: 'p1', sel: { kind: 'none' }, autoPass: true, thinking: false, help: loadHelpPref(), guide: true };
/** The game version at which the victory reminder last stopped you ending your turn or passing. */
let remindedAt = -1;
ui.guide = ui.help !== 'off';

/** New players start in Tutorial; someone who had turned the old Guide on/off keeps Guided/Off. */
function loadHelpPref(): HelpMode {
  try {
    const m = localStorage.getItem('elitists-war.help') as HelpMode | null;
    if (m && HELP_MODES.includes(m)) return m;
    const old = localStorage.getItem('elitists-war.guide');
    return old === 'off' ? 'off' : old === 'on' ? 'guided' : 'tutorial';
  } catch { return 'tutorial'; }
}
const tutorial = () => ui.help === 'tutorial';
const app = document.getElementById('app')!;

// ------------------------------------------------------------------ saved games

interface Save { id: string; updated: number; summary: string; state: GameState }
const SAVE_KEY = 'elitists-war.saves';

function loadSaves(): Record<string, Save> {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}'); } catch { return {}; }
}
function saveGame(s: GameState) {
  try {
    const saves = loadSaves();
    const me = player(s, ui.me);
    const rival = s.players.find((p) => p.id !== ui.me)!;
    saves[s.id] = {
      id: s.id, updated: Date.now(), state: s,
      summary: s.phase === 'gameOver'
        ? `Finished — ${s.winners?.map((w) => player(s, w).name).join(' & ')} won`
        : `${cardName(s, me.illuminati)} vs ${cardName(s, rival.illuminati)} · turn ${s.turn} · you ${goalCount(s, ui.me)}/${goalNeeded(s, ui.me)}`,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(saves));
  } catch { /* storage unavailable: the game still plays, it just is not kept */ }
}
function deleteSave(id: string) {
  try { const s = loadSaves(); delete s[id]; localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ------------------------------------------------------------------ your play profile (mirrors)

/** How you play, learned from your finished games in this browser; your mirrors are made from it. */
const PROFILE_KEY = 'elitists-war.profile';
function loadProfile(): PlayProfile {
  try { return normalizeProfile(JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null')); } catch { return normalizeProfile(null); }
}
function saveProfile(p: PlayProfile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* storage unavailable: the mirror just does not learn */ }
}
/** A finished game is added to your profile once (the profile remembers which games it has). */
function foldFinished(s: GameState) {
  const me = s.players.find((p) => p.id === ui.me);
  if (online || s.phase !== 'gameOver' || !me || me.isAI) return;
  const cur = loadProfile();
  if (cur.recent.includes(s.id)) return;
  saveProfile(foldGame(cur, habitsIn(s, ui.me), { won: !!s.winners?.includes(ui.me), illuminati: s.cards[me.illuminati]?.cardId, gameId: s.id }));
}
/** Finished games your mirror is based on (offline: this browser; online: your account). */
const mirrorGames = () => (online ? online.profile?.games ?? 0 : loadProfile().games);

// ------------------------------------------------------------------ game flow

function commit(next: GameState) {
  ui.game = next;
  ui.error = undefined;
  foldFinished(next);
  saveGame(next);
  render();
  schedule();
}

function act(a: Action) {
  const s = ui.game!;
  if (online) { onlineMove(a); return; }
  try {
    const next = applyAction(s, ui.me, a);
    observeHuman(s, next, ui.me, a); // your habits, for your mirror
    ui.sel = { kind: 'none' };
    commit(next);
  } catch (e) {
    ui.error = (e as Error).message;
    render();
  }
}

let timer: number | undefined;
/** Let the computer move one step at a time so its actions can be followed in the log. */
function schedule() {
  clearTimeout(timer);
  if (online) return; // the server moves computer players and applies standing orders
  const s = ui.game;
  if (!s || s.phase === 'gameOver') { ui.thinking = false; return; }
  const waiting = waitingFor(s);
  const ai = waiting.map((id) => player(s, id)).find((p) => p.isAI);
  const diceLeft = ui.dice ? ui.dice.start + DICE_MS - Date.now() : 0;
  if (diceLeft > 0) { timer = window.setTimeout(schedule, diceLeft + 30); return; } // let everyone see the roll
  // A computer player answers an offer made to it at once, so offers never hold up the game.
  const ans = computerDealAnswer(s);
  if (ans) {
    timer = window.setTimeout(() => {
      const next = applyDealAnswer(s, ans);
      ui.game = next; foldFinished(next); saveGame(next); render();
      timer = window.setTimeout(schedule, 0);
    }, 300);
    return;
  }
  if (ai) {
    ui.thinking = true;
    timer = window.setTimeout(() => {
      let a = chooseAction(s, ai.id);
      let next: GameState;
      try { next = applyAction(s, ai.id, a); } catch {
        a = s.window ? { type: 'pass' } : s.prompt?.kind === 'takeover' ? { type: 'skipTakeover' } : { type: 'endTurn' };
        next = applyAction(s, ai.id, a);
      }
      observeHuman(s, next, ai.id, a); // notes attacks on you
      const quick = a.type === 'pass';
      ui.game = next;
      foldFinished(next);
      saveGame(next);
      render();
      timer = window.setTimeout(schedule, quick ? 60 : 0);
    }, 380);
    render();
    return;
  }
  ui.thinking = false;
  // Nothing you could do in this window? Pass for you (can be turned off).
  // Your own attack always waits for you to press "Roll the dice".
  const myRoll = s.window?.kind === 'attack' && s.attack?.attackerPlayer === ui.me;
  // A rival claiming victory is always shown to you, even when you have nothing to answer it with.
  const rivalClaim = s.window?.kind === 'endOfTurn' && !!s.claims?.some((c) => c.player !== ui.me);
  if (ui.autoPass && s.window && waiting.includes(ui.me) && !hasResponse(s, ui.me) && !myRoll && !rivalClaim) {
    timer = window.setTimeout(() => act({ type: 'pass' }), 250);
  }
}

const LEVEL_KEY = 'elitists-war.level';
function loadLevel(): AiLevel {
  try { const v = localStorage.getItem(LEVEL_KEY); return v === 'easy' || v === 'hard' ? v : 'normal'; } catch { return 'normal'; }
}
const LEVELS: [AiLevel, string, string][] = [
  ['easy', 'Easy', 'Takes only safe-looking attacks, skips clever card play, and sometimes slips up.'],
  ['normal', 'Normal', 'Plays solidly: weighs its attacks and cards, defends what matters, and gangs up on anyone about to win.'],
  ['hard', 'Hard', 'Counts all the help it can bring to each attack, joins other fights to hold the leader back, cashes in every spare token, and fights hardest when a win is close.'],
];

/** Deck styles anyone can pick: each is a pair of card backs with a table felt to match. Purely looks. */
const BACKS = [['gilded', 'Gilded Eye'], ['celestial', 'Celestial'], ['classified', 'Classified'], ['throne', 'Throne Room'], ['surveillance', 'Surveillance']] as const;
function loadBacks(): string {
  try { const v = localStorage.getItem('elitists-war.backs'); if (v && BACKS.some((x) => x[0] === v)) return v; } catch { /* storage unavailable */ }
  return BACKS[0][0];
}
function saveBacks(v: string) {
  try { localStorage.setItem('elitists-war.backs', v); } catch { /* storage unavailable */ }
}

function styleHtml(): string {
  const cur = loadBacks();
  return `<h2>Deck style</h2>
  <p class="muted small">Each deck comes with a table to match. Only changes how your game looks; other players choose their own.</p>
  <div class="style-grid">${BACKS.map(([id, name]) => `<button class="style-pick backs-${id} ${cur === id ? 'on' : ''}" data-style-backs="${id}" aria-pressed="${cur === id}">
    <span class="mini-table"><span class="cardback plot"></span><span class="cardback group"></span></span><b>${name}</b></button>`).join('')}</div>`;
}

/** Table difficulty presets: they fill the random seats with a sensible mix of levels. */
const TABLE_KEY = 'elitists-war.table-level';
const LINEUP_KEY = 'elitists-war.lineup';
const TABLE_LEVELS: [TableLevel, string, string][] = [
  ['beginner', 'Beginner', 'Mostly Easy computers'],
  ['standard', 'Standard', 'Normal computers with some Easy ones'],
  ['challenging', 'Challenging', 'A mix of Hard, Normal and Easy'],
  ['expert', 'Expert', 'Every computer on Hard'],
];
function loadTableLevel(): TableLevel | undefined {
  try { const v = localStorage.getItem(TABLE_KEY); if (TABLE_LEVELS.some((t) => t[0] === v)) return v as TableLevel; } catch { /* storage unavailable */ }
  return undefined;
}
function loadLineup(): Lineup {
  try {
    const v = JSON.parse(localStorage.getItem(LINEUP_KEY) ?? 'null');
    if (v && Array.isArray(v.picked) && v.random) return { picked: v.picked.filter((id: string) => specOf(id)), random: { ...emptyLineup().random, ...v.random } };
  } catch { /* storage unavailable */ }
  return emptyLineup();
}
function saveLineup(l: Lineup, keepPreset = false) {
  try {
    localStorage.setItem(LINEUP_KEY, JSON.stringify(l));
    if (!keepPreset) localStorage.removeItem(TABLE_KEY); // a hand-made change ends the preset
  } catch { /* storage unavailable */ }
}
/** Fill `n` random seats with the preset's mix, leaving picked players and wild cards as they are. */
function presetRandoms(l: Lineup, n: number, level: TableLevel): Lineup {
  const mix = suggestBots(Math.max(0, n), level);
  return { ...l, random: { ...l.random, easy: mix.filter((x) => x === 'easy').length, normal: mix.filter((x) => x === 'normal').length, hard: mix.filter((x) => x === 'hard').length } };
}
const goalFor = (n: number) => (n <= 3 ? 12 : n === 4 ? 11 : 10);

/**
 * The Basic Goal the players agree on before the game (R016): the book's number for the table size
 * unless changed. With two players it never goes below 12, as the two-player rules advise.
 */
function goalInput(id: string, players: number, agreed?: number): string {
  const book = goalFor(players);
  const min = players === 2 ? 12 : 4;
  return `<label class="goal-set">Basic Goal <input type="number" id="${id}" min="${min}" max="20" step="1" value="${agreed ?? book}"> Groups
    <span class="muted small">(the rulebook's number for ${players} players is ${book}; change it only if everyone agrees${players === 2 ? '; never below 12 with two players' : ''})</span></label>`;
}
function bindGoalInput(id: string) {
  const el = app.querySelector<HTMLInputElement>(`#${id}`);
  if (el) el.onchange = () => {
    const n = Math.round(Number(el.value));
    (ui as Ui & { goal?: number }).goal = Number.isFinite(n) && n >= Number(el.min) && n <= 20 ? n : undefined;
  };
}
const LEVEL_NAME: Record<AiLevel, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const SECTION_INFO: Record<Section, [string, string]> = {
  easy: ['Easy', 'Make mistakes and miss chances. Good for learning.'],
  normal: ['Normal', 'Play solidly: weigh their attacks and defend what matters.'],
  hard: ['Hard', 'Plan their help, play every takeover out, and fight hardest near a win.'],
  wild: ['Wild cards', 'No plan at all: any legal move, picked at random. Usually nonsense; once in a while, brilliant by accident.'],
};

/**
 * Choose the computer players: tick named ones in each difficulty, and/or ask for a number of random
 * ones at the bottom of each section. `humans` counts you and any friends; `minBots` is 1 offline.
 */
function botsEditor(humans: number, minBots: number): string {
  const l = loadLineup(), max = 8 - humans, n = lineupSize(l), total = humans + n, full = n >= max;
  const preset = loadTableLevel();
  const card = (id: string, name: string, style: string, blurb: string, locked = false) => {
    const on = l.picked.includes(id), off = !on && (full || locked);
    return `<label class="bot-card ${on ? 'on' : ''} ${off ? 'off' : ''}"><input type="checkbox" data-pick-bot="${id}" ${on ? 'checked' : ''} ${off ? 'disabled' : ''}>
      <span><b>${esc(name)}</b><span class="small muted">${esc(style)} · ${esc(blurb)}</span></span></label>`;
  };
  // Your mirror: a computer that plays like you, once enough of your games are known.
  const games = mirrorGames(), ready = games >= MIN_GAMES;
  const mirrorCard = (lv: AiLevel) => card(`mirror:${lv}`, mirrorName(lv), 'Mirror',
    ready ? `plays like you, based on ${games} game${games === 1 ? '' : 's'}` : `plays like you; unlocks after ${MIN_GAMES} finished games (${games} so far)`, !ready);
  const section = (sec: Section) => {
    const [title, what] = SECTION_INFO[sec];
    const cards = sec === 'wild'
      ? WILD_CARDS.map((w) => card(`wild:${w.id}`, w.name, 'Wild card', 'random moves')).join('')
      : mirrorCard(sec) + STYLES.map((st) => card(pickId(st, sec), st.names[sec], st.style, st.blurb)).join('');
    const picked = l.picked.filter((id) => (sec === 'wild' ? id.startsWith('wild:') : id.endsWith(`:${sec}`))).length;
    return `<details class="lv-sec lv-${sec}" ${picked || l.random[sec] ? 'open' : ''}><summary><b>${title}</b> <span class="muted small">${esc(what)}</span>
        ${picked + l.random[sec] ? `<span class="lv-count">${picked + l.random[sec]} at the table</span>` : ''}</summary>
      <div class="bot-grid">${cards}</div>
      <div class="rand-row"><span>Random ${title.toLowerCase().replace(/s$/, '')} players</span>
        <button type="button" data-rand="${sec}" data-d="-1" ${l.random[sec] ? '' : 'disabled'} aria-label="One fewer random ${title} player">−</button><b>${l.random[sec]}</b>
        <button type="button" data-rand="${sec}" data-d="1" ${full ? 'disabled' : ''} aria-label="One more random ${title} player">+</button></div></details>`;
  };
  return `<div class="bots" data-humans="${humans}" data-min="${minBots}">
    <div class="table-level"><span class="bot-name">Quick fill</span>
      <span class="seg" role="radiogroup" aria-label="Table difficulty">${TABLE_LEVELS.map(([id, name, what]) => `<button type="button" role="radio" aria-checked="${preset === id}" class="${preset === id ? 'on' : ''}" data-table-level="${id}" title="${esc(what)}">${name}</button>`).join('')}</span>
      <span class="muted small">${preset ? `${esc(TABLE_LEVELS.find((t) => t[0] === preset)![2])} in the random seats.` : 'Sets the random seats to a mix of levels. Or pick your own below.'}</span></div>
    <div class="table-sum"><b>${total} players</b> · you${humans > 1 ? ` + ${humans - 1} friend${humans > 2 ? 's' : ''}` : ''} + ${n} computer${n === 1 ? '' : 's'}${l.picked.length ? ` (${l.picked.map((id) => esc(specOf(id)!.name)).join(', ')}${n > l.picked.length ? ` and ${n - l.picked.length} random` : ''})` : ''} · Goal ${goalFor(total)} Groups
      ${n < minBots ? '<span class="bad"> · add at least one computer</span>' : ''}${full ? '<span class="muted"> · table full</span>' : ''}</div>
    ${recommend(humans, total)}
    ${SECTIONS.map(section).join('')}
    <p class="muted small">Each name always plays the same way; a style's Easy, Normal and Hard players share its habits, the harder ones just play them better. Random seats can also draw your mirror once it is unlocked. 7–8 players works, but rounds take longer.</p></div>`;
}

/** Players generally find 4 or 6 at the table the sweet spot; offer one tap to get there. */
const SWEET = [4, 6];
function recommend(humans: number, total: number): string {
  const l = loadLineup(), fixed = humans + l.picked.length + l.random.wild;
  const opts = SWEET.filter((t) => t >= fixed && t - humans <= 7);
  if (!opts.length) return '';
  return `<div class="sweet"><span class="small">★ Recommended: <b>4 or 6 players</b> in all.</span>
    ${opts.map((t) => t === total ? `<span class="sweet-on">✓ ${t} players</span>` : `<button type="button" class="sweet-btn" data-bot-total="${t}">Make it ${t}</button>`).join('')}</div>`;
}

function bindBots(rerender: () => void) {
  const box = app.querySelector<HTMLElement>('.bots');
  if (!box) return;
  const humans = +(box.dataset.humans ?? 1), max = 8 - humans;
  app.querySelectorAll<HTMLInputElement>('[data-pick-bot]').forEach((b) => b.onchange = () => {
    const l = loadLineup(), id = b.dataset.pickBot!;
    l.picked = b.checked ? [...l.picked.filter((x) => x !== id), id] : l.picked.filter((x) => x !== id);
    if (lineupSize(l) > max) return rerender();
    saveLineup(l); rerender();
  });
  app.querySelectorAll<HTMLElement>('[data-rand]').forEach((b) => b.onclick = () => {
    const l = loadLineup(), sec = b.dataset.rand as Section;
    l.random[sec] = Math.max(0, l.random[sec] + +b.dataset.d!);
    if (lineupSize(l) > max) return;
    saveLineup(l); rerender();
  });
  app.querySelectorAll<HTMLElement>('[data-table-level]').forEach((b) => b.onclick = () => {
    const l = loadLineup(), level = b.dataset.tableLevel as TableLevel;
    const seats = Math.max(1, l.random.easy + l.random.normal + l.random.hard) ;
    saveLineup(presetRandoms(l, Math.min(seats, max - l.picked.length - l.random.wild), level));
    try { localStorage.setItem(TABLE_KEY, level); } catch { /* storage unavailable */ }
    rerender();
  });
  app.querySelectorAll<HTMLElement>('[data-bot-total]').forEach((b) => b.onclick = () => {
    const l = loadLineup(), want = +b.dataset.botTotal! - humans - l.picked.length - l.random.wild;
    const preset = loadTableLevel();
    saveLineup(presetRandoms(l, want, preset ?? 'standard'), !!preset); rerender();
  });
}

/**
 * The computers for a new game, with at least `min` of them. Offline your mirrors join the pool;
 * online the server fills random seats and mirrors itself, from the profiles it keeps.
 */
function botsForGame(seed: number, min: number, maxBots: number): BotSpec[] {
  const l = loadLineup();
  const bots = (online ? lineupRequest(l, seed) : resolveLineup(l, seed, { mirrors: mirrorSeats(loadProfile(), seed, undefined, ILLUMINATI.map((c) => c.id)) })).slice(0, maxBots);
  return bots.length >= min ? bots : [...bots, ...resolveLineup(presetRandoms(emptyLineup(), min - bots.length, 'standard'), seed + 1)];
}

function newGame(illuminati: string, quick: boolean, basicGoal?: number) {
  const seed = Math.floor(Math.random() * 1e9);
  const bots = botsForGame(seed, 1, 7);
  // Each computer plays on an Illuminati that suits its style, when one is free.
  const others = ILLUMINATI.filter((c) => c.id !== illuminati).map((c) => c.id);
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
  const ills = assignIlluminati(bots, [illuminati], others);
  const s = createGame({
    seed,
    players: [
      { id: 'p1', name: 'You', isAI: false, deck: randomDeck(seed, illuminati) },
      ...bots.map((b, i) => ({ id: `p${i + 2}`, name: b.name, isAI: true, aiLevel: b.level, aiStyle: b.style, aiStyleData: b.data, deck: randomDeck(seed + i + 1, ills[i]) })),
    ],
    settings: { houseRules: quick ? ['quickGame'] : [], victoryReminder: ui.help !== 'off', ...(basicGoal ? { basicGoal } : {}) },
    chooseLeads: true,
  });
  ui.sel = { kind: 'none' };
  ui.inspect = undefined;
  commit(s);
}

/** Game over: what you did this game, and how far along your mirror is. */
function habitsPanel(s: GameState): string {
  const found = habitsReport(habitsIn(s, ui.me), online ? undefined : loadProfile());
  const games = mirrorGames();
  const mirror = online && !online.profile ? '' : games >= MIN_GAMES
    ? `Your mirror is now based on ${games} game${games === 1 ? '' : 's'}. Pick it in any difficulty when you start a game.`
    : `Your mirror is based on ${games} game${games === 1 ? '' : 's'} so far; it unlocks after ${MIN_GAMES}.`;
  if (!found.length && !mirror) return '';
  return `<h3>Your habits this game</h3>${found.length ? `<ul class="tells">${found.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${mirror ? `<p class="muted small">${esc(mirror)}</p>` : ''}`;
}

// ------------------------------------------------------------------ helpers

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ALIGN_ABBR: Record<string, string> = {
  Government: 'Gov', Corporate: 'Corp', Liberal: 'Lib', Conservative: 'Con', Peaceful: 'Pea',
  Violent: 'Vio', Straight: 'Str', Weird: 'Wrd', Criminal: 'Crim', Fanatic: 'Fan',
};
const myTurn = (s: GameState) => s.players[s.active].id === ui.me;
const idle = (s: GameState) => s.phase === 'main' && myTurn(s) && !s.window && !s.prompt && !s.attack;

function chip(a: string) {
  return `<span class="al al-${a.toLowerCase()}" title="${a}">${ALIGN_ABBR[a] ?? a}</span>`;
}

// ------------------------------------------------------------------ rendering

// ------------------------------------------------------------------ guide mode

type Area = 'board' | 'rival' | 'hand' | 'console' | 'decks';
interface Guide { ok: Set<string>; no: Set<string>; next?: Area; text: string }
let G: Guide = { ok: new Set(), no: new Set(), text: '' };

/** Work out, for the current moment, which cards can be used, which cannot, and where to go next. */
function computeGuide(s: GameState): Guide {
  const g: Guide = { ok: new Set(), no: new Set(), text: '' };
  if (s.phase === 'gameOver') return g; // computed even with Guide off: the "why not" reasons use it
  const me = player(s, ui.me);
  const mine = structureCards(s, ui.me);
  const res = resourcesOf(s, ui.me);
  const hand = me.hand;
  const mark = (ids: string[], ok: (id: string) => boolean) => { for (const id of ids) (ok(id) ? g.ok : g.no).add(id); };
  const sel = ui.sel;
  const pr = s.prompt?.player === ui.me ? s.prompt : undefined;
  if (ui.slotChoice) { g.next = 'console'; g.text = 'Pick which arrow the card attaches to.'; return g; }
  if (pr?.kind === 'choose' || pr?.kind === 'chooseLead') { g.next = 'console'; g.text = 'Make your choice in the panel.'; return g; }
  if (pr?.kind === 'placeCaptured') {
    if (sel.kind === 'rearrange') { g.ok.add('slots'); g.next = 'board'; g.text = 'Tap a green + beside its master to put the Group there.'; }
    else { g.next = 'console'; g.text = 'Pick a new Group to move in the panel, or tap Done.'; }
    return g;
  }
  if (pr?.kind === 'draw') {
    const d = pr.data as { plot: number; group: number };
    (d.plot > 0 ? g.ok : g.no).add('deck-plot');
    (d.group > 0 ? g.ok : g.no).add('deck-group');
    g.next = 'decks';
    g.text = d.plot > 0 ? 'Start of your turn: tap the Plot deck to draw' + (d.plot > 1 ? ` (${d.plot} cards)` : '') + ', then the Group deck.' : 'Now tap the Group deck to draw a Group card.';
    return g;
  }
  if (pr?.kind === 'takeover') {
    const opts = takeoverOptions(s, ui.me);
    if (sel.kind === 'takeover') {
      g.ok.add('slots'); mark(hand, (h) => h === sel.card);
      g.next = 'board'; g.text = 'Step 2 of 2: tap a green + in your Power Structure to place the Group.';
    } else {
      mark(hand, (h) => opts.some((o) => o.card === h) || (def(s, h).type === 'Resource' && canEnterPlay(s, h, ui.me)));
      g.next = opts.length ? 'hand' : 'console';
      g.text = opts.length ? 'Step 1 of 2: pick a green Group in your hand to take over for free (or Skip).' : 'No Group in your hand fits an open arrow: tap Skip takeover.';
    }
    return g;
  }
  if (pr?.kind === 'discardToLimit') {
    mark(hand, (h) => plotsInHand(s, ui.me).includes(h));
    g.next = 'hand'; g.text = 'Tap the green Plots you want to get rid of, then confirm in the panel.';
    return g;
  }
  if (s.window && waitingFor(s).includes(ui.me)) {
    const opts = responseOptions(s, ui.me);
    mark(hand.filter((h) => def(s, h).type === 'Plot'), (h) => opts.some((o) => o.action.type === 'playPlot' && o.action.play.card === h));
    const acting = new Set(opts.flatMap((o) => o.action.type === 'aid' || o.action.type === 'oppose' ? [o.action.group] : o.action.type === 'useAbility' ? [o.action.card] : []));
    mark(mine, (c) => acting.has(c));
    g.next = 'console';
    g.text = opts.length ? 'Green cards can respond: pick a response in the panel, or Pass when you are done.' : 'Nothing you can do here: tap Pass.';
    return g;
  }
  if (!idle(s)) { g.text = s.prompt || s.window ? 'Waiting for your rival.' : ''; return g; }
  // Your main phase.
  if (sel.kind === 'attack') {
    const opts = attackOptions(s, ui.me, sel.attacker).filter((o) => o.type === sel.type);
    const targets = new Set(opts.map((o) => o.target));
    const rivalCards = s.players.filter((p) => p.id !== ui.me).flatMap((p) => structureCards(s, p.id));
    mark(rivalCards, (c) => targets.has(c));
    // Attacking to destroy your own Group is legal (R004): mark your own Groups too.
    if (sel.type === 'destroy') mark(mine, (c) => targets.has(c));
    if (sel.type === 'control') mark(hand.filter((h) => def(s, h).type === 'Group'), (h) => targets.has(h));
    g.next = [...targets].some((t) => s.cards[t].zone === 'hand') && ![...targets].some((t) => s.cards[t].zone === 'structure') ? 'hand'
      : sel.type === 'destroy' && [...targets].every((t) => mine.includes(t)) ? 'board' : 'rival';
    g.text = targets.size ? `Step 3: tap a green target to attack to ${sel.type}.` : 'No legal targets for this attack: Cancel.';
    return g;
  }
  if (sel.kind === 'move') { g.ok.add('slots'); g.next = 'board'; g.text = 'Tap a green + to move the Group there.'; return g; }
  // A Resource may always be relinked back to your Illuminati, not only to a Group (R042).
  if (sel.kind === 'link') { mark(mine, (c) => legal(s, ui.me, { type: 'link', resource: sel.resource, to: c })); g.next = 'board'; g.text = 'Tap a green Group (or your Illuminati) to link the Resource to it.'; return g; }
  if (sel.kind === 'group') { g.next = 'console'; g.text = 'Step 2: choose what this Group does (green buttons in the panel).'; return g; }
  if (sel.kind === 'confirm') { g.next = 'console'; g.text = 'Step 4: add any Plots, then Declare attack.'; return g; }
  if (sel.kind === 'plot' || sel.kind === 'resource') { g.next = 'console'; g.text = 'Pick how to play it in the panel, or Close.'; return g; }
  if (sel.kind === 'deck') { g.next = 'console'; g.text = 'Confirm in the panel, or Cancel.'; return g; }
  const illTok = s.cards[me.illuminati].tokens > 0;
  const groupTok = mine.filter((g) => g !== me.illuminati && s.cards[g].tokens > 0).length;
  ((illTok || groupTok >= 2) && me.plotDeck.length ? g.ok : g.no).add('deck-plot');
  (illTok && !s.turnFlags.illumGroupDraw && me.groupDeck.length ? g.ok : g.no).add('deck-group');
  const canUse = (c: string) => s.cards[c].tokens > 0 && (attackOptions(s, ui.me, c).length > 0 || abilityOptions(s, ui.me, c).length > 0 || def(s, c).type === 'Group');
  mark(mine, canUse);
  mark(res, (r) => abilityOptions(s, ui.me, r).length > 0 || !!HOOKS[s.cards[r].cardId]?.linkTo);
  mark(hand, (h) => {
    const d = def(s, h);
    if (d.type === 'Plot') return plotOptions(s, ui.me, h).length > 0;
    if (d.type === 'Illuminati') return !agentProblem(s, ui.me, h);
    if (d.type === 'Resource') return !s.turnFlags.resourcePlayed && s.cards[me.illuminati].tokens > 0 && canEnterPlay(s, h, ui.me);
    return false; // Groups in hand come into play by takeover or an Attack to Control from the board
  });
  const boardOk = mine.some((c) => g.ok.has(c));
  const handOk = hand.some((h) => g.ok.has(h));
  g.next = boardOk ? 'board' : handOk ? 'hand' : 'console';
  g.text = boardOk ? 'Step 1: tap a green Group to attack or move with it' + (handOk ? ', or a green card in your hand' : '') + '. End your turn when done.'
    : handOk ? 'Step 1: play a green card from your hand, or end your turn.'
    : 'Nothing left to do this turn except buy cards: End turn.';
  return g;
}

const gcls = (id: string) => (G.ok.has(id) ? 'g-ok' : G.no.has(id) ? 'g-no' : '');
const gnext = (a: Area) => (G.next === a ? 'g-next' : '');

function render() {
  if (!ui.game) { renderStart(); return; }
  ensureLayout(ui.game); // a game saved before cards had real shapes
  // A brand-new player in Tutorial mode sees the rules once, at the start of their first game.
  if (tutorial() && !ui.showRules) {
    let seen = true;
    try { seen = localStorage.getItem('elitists-war.intro') === 'seen'; if (!seen) localStorage.setItem('elitists-war.intro', 'seen'); } catch { /* storage unavailable */ }
    if (!seen) ui.showRules = 'goal';
  }
  G = computeGuide(ui.game);
  const s = ui.game;
  noticeRolls(s);
  // Open the action panel again whenever a new kind of decision comes up.
  const key = `${s.turn}|${s.prompt?.kind ?? ''}|${s.window?.kind ?? ''}|${s.attack?.id ?? ''}|${ui.sel.kind}|${waitingFor(s).includes(ui.me)}`;
  if (key !== ui.lastKey) {
    ui.lastKey = key;
    // On a phone the panel folds down to its "Next" line whenever the next step is on the table or in your hand.
    const narrow = window.innerWidth <= 900;
    if (waitingFor(s).includes(ui.me)) ui.sheetMin = narrow && (G.next === 'board' || G.next === 'rival' || G.next === 'hand' || G.next === 'decks');
  }
  const rivals = s.players.filter((p) => p.id !== ui.me);
  const me = player(s, ui.me);
  const recent = s.log.filter((l) => (!l.to || l.to === ui.me) && (!l.info || tutorial())).slice(-2).reverse();
  app.innerHTML = `
  <div class="shell ${ui.guide ? 'guide' : ''} ${tutorial() ? 'tutorial' : ''} backs-${loadBacks()}">
    <header class="hud">
      <button class="linkish" data-act="home" aria-label="Back to games">‹</button>
      <div class="players">${s.players.map((p) => playerChip(s, p.id)).join('')}</div>
      <span class="turn-no">${s.phase === 'gameOver' ? 'Game over' : `Turn ${s.turn}`}</span>
      ${phaseTracker(s)}
      <div class="hud-actions">
      <button class="hud-btn" data-rules="goal">Rules</button>
      <button class="hud-btn" data-cards="">Cards</button>
      <button class="hud-btn" data-act="log">Log</button>
      ${dealsAllowed(s) && s.phase !== 'gameOver' ? `<button class="hud-btn ${offersTo(s, ui.me).length ? 'alert' : ''}" data-act="deals" title="Offer trades and gifts to other players">Deals${offersTo(s, ui.me).length ? ` (${offersTo(s, ui.me).length})` : ''}</button>` : ''}
      <button class="hud-btn" data-act="style" title="Deck style" aria-label="Deck style">🎨</button>
      ${s.phase !== 'gameOver' && !me.eliminated ? '<button class="hud-btn" data-act="resign" title="Leave this game for good: it counts as being eliminated">Leave</button>' : ''}
      <button class="guide-toggle ${ui.guide ? 'on' : ''} ${ui.help}" data-act="guide" title="${esc(HELP_TITLE[ui.help])}" aria-label="Help level: ${HELP_LABEL[ui.help]} (tap to change)">${HELP_LABEL[ui.help]}</button>
      </div>
    </header>
    <main class="tablearea">
      <div class="viewport" id="vp"><div class="world felt ${rivals.length > 1 ? 'ring' : 'duel'}" id="world">
        ${seating(s)}
        ${renderNwo(s)}
        ${renderSide(s, ui.me, true)}
      </div></div>
      ${renderDecks(s)}
      <div class="ticker" aria-live="polite">${recent.map((l) => `<div>${esc(youText(l.text))}</div>`).join('')}</div>
      <div class="zoom"><button data-zoom="in" aria-label="Zoom in">+</button><button data-zoom="out" aria-label="Zoom out">−</button><button data-zoom="fit" title="See the whole table">All</button><button data-zoom="me" title="Jump to your seat">You</button>${!myTurn(s) && s.phase !== 'gameOver' ? `<button data-zoom="turn" title="Jump to the player whose turn it is">${esc(player(s, s.players[s.active].id).name)}'s turn</button>` : ''}</div>
      ${renderInspect(s)}
      ${renderBrowse(s)}
      <aside class="sheet ${ui.sheetMin ? 'min' : ''} ${gnext('console')}">
        <div class="sheet-top">
          <button class="sheet-handle" data-act="sheet" aria-expanded="${!ui.sheetMin}">
            <span>${G.text && ui.guide ? `<b>Next:</b> ${esc(G.text)}` : waitingFor(s).includes(ui.me) ? '<b>Your move</b>' : esc(sheetTitle(s))}</span><i>${ui.sheetMin ? '▴' : '▾'}</i></button>
          ${ui.sheetMin ? quickButton(s) : ''}
        </div>
        <div class="sheet-body">${renderConsole(s)}${online ? ordersPanel() : ''}</div>
      </aside>
    </main>
    <footer class="dock ${gnext('hand')} ${ui.handMin ? 'min' : ''}">
      <div class="hand-head">
        <span class="label">Your hand</span>
        <button class="jump plots" data-handjump="plots">Plots ${plotsInHand(s, ui.me).length}</button>
        <button class="jump groups" data-handjump="groups">Groups ${me.hand.length - plotsInHand(s, ui.me).length}</button>
        <span class="muted small">decks: ${me.plotDeck.length} Plots, ${me.groupDeck.length} Groups</span>
        <button class="fold" data-act="hand" aria-expanded="${!ui.handMin}" aria-label="${ui.handMin ? 'Show' : 'Hide'} your hand">${ui.handMin ? '▴' : '▾'}</button>
      </div>
      <div class="hand">${handSections(s)}</div>
    </footer>
    ${diceOverlay()}
    ${ui.showRules ? `<div class="modal-back" data-rules=""></div><div class="modal rules" role="dialog" aria-label="Rules">${rulesHtml(s)}<div class="btns"><button data-rules="">Close</button></div></div>` : ''}
    ${ui.showStyle ? `<div class="modal-back" data-act="style"></div><div class="modal style" role="dialog" aria-label="Deck style">${styleHtml()}<div class="btns"><button data-act="style">Done</button></div></div>` : ''}
    ${ui.showDeals ? `<div class="modal-back" data-act="deals"></div><div class="modal deals" role="dialog" aria-label="Deals">${renderDeals(s)}<div class="btns"><button data-act="deals">Close</button></div></div>` : ''}
    ${ui.showLog ? `<div class="modal-back" data-act="log"></div><div class="modal" role="dialog" aria-label="Game log">${renderLog(s)}<div class="btns"><button data-act="log">Close</button></div></div>` : ''}
  </div>`;
  bind();
  bindTable();
}

const DICE_MS = 2300;

/** Spot new attack rolls in the log (yours, or anyone's) so the dice can be shown rolling. */
function noticeRolls(s: GameState) {
  if (ui.logGame !== s.id || ui.logSeen === undefined || ui.logSeen > s.log.length) { ui.logGame = s.id; ui.logSeen = s.log.length; return; }
  for (const l of s.log.slice(ui.logSeen)) {
    const m = l.text.match(/^Needs (-?\d+) or less on 2d6 — rolled (\d) \+ (\d)/);
    if (m) {
      ui.dice = { need: +m[1], a: +m[2], b: +m[3], start: Date.now() };
      window.setTimeout(() => { if (ui.game) render(); }, DICE_MS + 20);
    }
  }
  ui.logSeen = s.log.length;
}

const PIPS: Record<number, number[]> = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const dieFace = (n: number) => `<span class="die" aria-hidden="true">${Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[n].includes(i + 1) ? 'on' : ''}"></i>`).join('')}</span>`;

function diceOverlay(): string {
  const d = ui.dice;
  if (!d) return '';
  const t = Date.now() - d.start;
  if (t > DICE_MS) return '';
  const sum = d.a + d.b;
  const ok = sum <= d.need && sum < 11;
  return `<div class="dice-overlay" data-act="dice" style="--t:-${t}ms" role="status" aria-label="Rolled ${d.a} and ${d.b}: ${sum}">
    <div class="dice-pair">${dieFace(d.a)}${dieFace(d.b)}</div>
    <div class="dice-result ${ok ? 'ok' : 'bad'}"><b>${sum}</b> ${ok ? 'Success' : 'Failure'} <span class="muted">needed ${d.need} or less${sum >= 11 ? ' · 11 or 12 always fails' : ''}</span></div>
  </div>`;
}

/** The one main button, kept reachable while the action panel is folded. */
function quickButton(s: GameState): string {
  if (idle(s) && ui.sel.kind === 'none') return '<button class="quick primary" data-act="endTurn">End turn</button>';
  if (s.window && waitingFor(s).includes(ui.me) && !s.prompt) {
    const roll = s.window.kind === 'attack' && s.attack?.attackerPlayer === ui.me;
    return `<button class="quick primary" data-act="pass">${roll ? '🎲 Roll' : 'Pass'}</button>`;
  }
  return '';
}

/** Your two decks, face down, along the left of the table. Tap to draw (start of turn) or to buy. */
function renderDecks(s: GameState): string {
  const me = player(s, ui.me);
  const pile = (deck: 'plot' | 'group', n: number, label: string) =>
    `<button class="deck ${deck} ${gcls(`deck-${deck}`)} ${n ? '' : 'empty'}" data-deck="${deck}" aria-label="${label} deck, ${n} card${n === 1 ? '' : 's'} left">
      <span class="back" aria-hidden="true"></span><span class="deck-label">${label}</span><span class="deck-count">${n}</span></button>`;
  return `<div class="decks ${gnext('decks')}">${pile('plot', me.plotDeck.length, 'Plots')}${pile('group', me.groupDeck.length, 'Groups')}</div>`;
}

function onDeck(deck: 'plot' | 'group') {
  const s = ui.game!;
  ui.error = undefined;
  const pr = s.prompt?.player === ui.me ? s.prompt : undefined;
  if (pr?.kind === 'draw') { act({ type: 'draw', deck }); return; }
  if (idle(s)) { ui.sel = { kind: 'deck', deck }; render(); return; }
  ui.error = deck === 'plot'
    ? 'You draw from your Plot deck at the start of your turn. In your main phase you can also buy a Plot with an Action token.'
    : 'You draw from your Group deck at the start of your turn. In your main phase your Illuminati can also draw one Group card per turn.';
  render();
}

/** Your hand in two parts, as you'd hold it: secret Plots, and the Groups and Resources waiting to come into play. */
function handSections(s: GameState): string {
  const me = player(s, ui.me);
  // A spare Illuminati card came from the Plot deck and is held with the Plots (R044).
  const plots = plotsInHand(s, ui.me);
  const groups = me.hand.filter((i) => !plots.includes(i));
  const sec = (cls: string, label: string, note: string, cards: string[], empty: string) => `
    <section class="hand-sec ${cls}" aria-label="${label}">
      <div class="sec-label">${label} <b>${cards.length}</b> <span class="muted">${note}</span></div>
      <div class="sec-cards">${cards.map((iid) => handCard(s, iid)).join('') || `<span class="muted small sec-empty">${empty}</span>`}</div>
    </section>`;
  return sec('plots', 'Plots', `· limit ${handLimit(s, ui.me)} outside your turn`, plots, 'No Plots.')
    + sec('groups', 'Groups & Resources', '· no limit', groups, 'No Groups.');
}

function sheetTitle(s: GameState): string {
  if (s.phase === 'gameOver') return 'Game over';
  const w = waitingFor(s).map((id) => player(s, id).name);
  return w.length ? `Waiting for ${w.join(', ')}` : 'Actions';
}

/** One player in the top bar: name, Groups toward the goal, and whose turn it is. */
function playerChip(s: GameState, pl: string): string {
  const p = player(s, pl);
  const n = goalCount(s, pl), need = goalNeeded(s, pl);
  const active = s.players[s.active].id === pl && s.phase !== 'gameOver';
  const inHand = pl === ui.me ? '' : ` · ${plotsInHand(s, pl).length}P ${p.hand.length - plotsInHand(s, pl).length}G`;
  const who = p.isAI ? styleById(p.aiStyle) : undefined;
  return `<span class="pchip ${active ? 'active' : ''} ${pl === ui.me ? 'me' : ''} ${p.eliminated ? 'out' : ''}" title="${esc(p.name)}${who ? ` (${who.style}, ${LEVEL_NAME[p.aiLevel ?? 'normal']}): ${who.blurb}` : ''} ${n} of ${need} Groups${inHand ? `; ${inHand.slice(3)} in hand` : ''}">
    <b>${esc(pl === ui.me ? 'You' : p.name)}</b><span class="goal-bar"><span style="width:${Math.min(100, (n / need) * 100)}%"></span></span><span class="mono">${n}/${need}</span><span class="muted">${inHand}</span></span>`;
}

// The human player is called "You", so fix the verb: "You leads" -> "You lead".
const youText = (t: string) => t.replace(/\bYou's\b/g, 'Your').replace(/(^|\s)You (has|\w+?)s\b/g, (_m, pre, v) => `${pre}You ${v === 'has' ? 'have' : v}`);

// ------------------------------------------------------------------ table pan and zoom

/** Frame the whole table, leaving room for the action panel. */
/** Width of the table's brass rim, in pixels (see .felt in style.css). */
const RIM = 20;

/** The part of the screen the table can use: not under the decks rail or the action panel. */
function tableArea(vp: HTMLElement) {
  const wide = vp.clientWidth > 900;
  const sheet = vp.parentElement!.querySelector<HTMLElement>('.sheet');
  const rail = window.innerWidth <= 480 ? 58 : 84; // the decks along the left
  return { left: 8 + rail, top: 8, w: vp.clientWidth - (wide ? 372 : 0) - 16 - rail, h: vp.clientHeight - (!wide && sheet ? sheet.offsetHeight + 8 : 0) - 16 };
}

/** Smallest zoom the automatic view will use; below this cards are too small to read, so it shows your seat instead. */
const READABLE = 0.55;

function fitView(vp: HTMLElement, world: HTMLElement, force = false) {
  const a = tableArea(vp);
  // The brass rim is drawn outside the felt, so leave room for it on every side.
  const ww = world.offsetWidth + 2 * RIM, wh = world.offsetHeight + 2 * RIM;
  const z = Math.max(0.15, Math.min(1.5, a.w / ww, a.h / wh));
  if (z < READABLE && !force) { focusSeat(vp, world, ui.me, true); return; }
  ui.view = { x: a.left + (a.w - ww * z) / 2 + RIM * z, y: a.top + Math.max(0, (a.h - wh * z) / 2) + RIM * z, z, auto: !force };
}

/** Centre the view on one player's seat, zoomed so it fills the space (but stays readable). */
function focusSeat(vp: HTMLElement, world: HTMLElement, pl: string, auto = false) {
  const el = world.querySelector<HTMLElement>(`[data-seat="${pl}"]`);
  if (!el) return;
  // Measure in table coordinates: offsets are unscaled, so walk up to the table.
  let x = 0, y = 0;
  for (let n: HTMLElement | null = el; n && n !== world; n = n.offsetParent as HTMLElement | null) { x += n.offsetLeft; y += n.offsetTop; }
  const a = tableArea(vp);
  const z = Math.max(READABLE, Math.min(1.2, (a.w / el.offsetWidth) * 0.95, (a.h / el.offsetHeight) * 0.95));
  ui.view = { x: a.left + a.w / 2 - (x + el.offsetWidth / 2) * z, y: a.top + a.h / 2 - (y + el.offsetHeight / 2) * z, z, auto };
}

function applyView(world: HTMLElement) {
  const v = ui.view!;
  world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
}

function zoomAt(px: number, py: number, factor: number) {
  const v = ui.view!;
  const z = Math.max(0.15, Math.min(3, v.z * factor));
  v.x = px - ((px - v.x) * z) / v.z;
  v.y = py - ((py - v.y) * z) / v.z;
  v.z = z; v.auto = false;
}

function bindTable() {
  const vp = app.querySelector<HTMLElement>('#vp');
  const world = app.querySelector<HTMLElement>('#world');
  if (!vp || !world) return;
  // On a landscape screen the rivals sit beside you rather than above, so the cards come out bigger.
  const wide = vp.clientWidth - (vp.clientWidth > 900 ? 372 : 0) > vp.clientHeight * 1.25;
  world.classList.toggle('wide', wide);
  if (!ui.view || ui.view.auto) fitView(vp, world);
  applyView(world);
  const pts = new Map<number, { x: number; y: number }>();
  let moved = 0;
  let pinch = 0;
  vp.onpointerdown = (e) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; pinch = 0; };
  vp.onpointermove = (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pts.size === 1) {
      moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
      if (moved > 6) {
        if (!vp.hasPointerCapture(e.pointerId)) vp.setPointerCapture(e.pointerId);
        ui.view!.x += cur.x - prev.x; ui.view!.y += cur.y - prev.y; ui.view!.auto = false; applyView(world);
      }
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const other = a === prev ? b : a;
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y), d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
      const r = vp.getBoundingClientRect();
      if (d0 > 0) { zoomAt((cur.x + other.x) / 2 - r.left, (cur.y + other.y) / 2 - r.top, d1 / d0); applyView(world); }
      moved = 99; pinch = 1;
    }
    pts.set(e.pointerId, cur);
  };
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); };
  vp.onpointerup = up; vp.onpointercancel = up;
  // A drag or pinch is not a tap on the card underneath.
  vp.addEventListener('click', (e) => { if (moved > 6 || pinch) { e.stopPropagation(); e.preventDefault(); moved = 0; pinch = 0; } }, true);
  vp.onwheel = (e) => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    applyView(world);
  };
  app.querySelectorAll<HTMLElement>('[data-zoom]').forEach((b) => b.onclick = () => {
    const z = b.dataset.zoom;
    if (z === 'fit') fitView(vp, world, true);
    else if (z === 'me') focusSeat(vp, world, ui.me);
    else if (z === 'turn' && ui.game) focusSeat(vp, world, ui.game.players[ui.game.active].id);
    else zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, z === 'in' ? 1.25 : 0.8);
    applyView(world);
  });
}

function renderSide(s: GameState, pl: string, mine: boolean): string {
  const p = player(s, pl);
  const cards = structureCards(s, pl);
  const slots = placementSlots(s, pl);
  // Cards are laid out at their real shape (5 × 7, on its side when hung from a side arrow);
  // positions are card centres in half-units, drawn with --u pixels per unit.
  const rects = [...cards.map((c) => rectOf(s, c)), ...slots.map((x) => x.r)];
  const minX = Math.min(...rects.map((r) => r.x - r.w / 2)), maxX = Math.max(...rects.map((r) => r.x + r.w / 2));
  const minY = Math.min(...rects.map((r) => r.y - r.h / 2)), maxY = Math.max(...rects.map((r) => r.y + r.h / 2));
  const place = (r: { x: number; y: number; w: number; h: number }) =>
    `left:calc(var(--u) * ${r.x - r.w / 2 - minX});top:calc(var(--u) * ${r.y - r.h / 2 - minY});width:calc(var(--u) * ${r.w});height:calc(var(--u) * ${r.h})`;
  const cells = cards.map((iid) => {
    const r = rectOf(s, iid);
    return `<div class="cell ${r.w > r.h ? 'sideways' : ''}" style="${place(r)}">${tableCard(s, iid)}</div>`;
  });
  // One "+" per space; if two open arrows lead to exactly the same space, the button offers both.
  const bySpot = new Map<string, typeof slots>();
  for (const sl of slots) bySpot.set(`${sl.r.x},${sl.r.y},${sl.r.w}`, [...(bySpot.get(`${sl.r.x},${sl.r.y},${sl.r.w}`) ?? []), sl]);
  for (const group of bySpot.values()) {
    const sl = group[0];
    cells.push(`<button class="cell slot ${G.ok.has('slots') ? 'g-ok' : ''}" style="${place(sl.r)}" data-slot="${group.map((g) => `${g.onto}:${g.side}`).join('|')}" aria-label="Place here">+</button>`);
  }
  const n = goalCount(s, pl), need = goalNeeded(s, pl);
  const special = specialGoalProgress(s, pl);
  const illDef = s.cards[p.illuminati] ? def(s, p.illuminati) : undefined;
  const head = `
      <div class="side-head">
        <span class="who">${mine ? 'You' : esc(p.name)}</span>
        <span class="goal" title="Groups controlled toward the Basic Goal">
          <span class="goal-bar"><span style="width:${Math.min(100, (n / need) * 100)}%"></span></span>
          <b>${n}</b>/${need} Groups
        </span>
        ${special ? `<span class="goal" title="Progress toward ${esc(illDef?.name ?? 'the')}'s Special Goal">
          <span class="goal-bar"><span style="width:${Math.min(100, (special.current / special.target) * 100)}%"></span></span>
          <b>${special.current}</b>/${special.target} ${esc(special.label)}
        </span>` : ''}
      </div>`;
  const field = `<div class="board-scroll"><div class="field" style="width:calc(var(--u) * ${maxX - minX});height:calc(var(--u) * ${maxY - minY})">${cells.join('')}</div></div>`;
  // Seat order mirrors a real table: your nameplate at your edge, the Power Structure toward the middle.
  return `
    <div data-seat="${pl}" class="side ${mine ? 'mine' : 'theirs'} ${s.players[s.active].id === pl && s.phase !== 'gameOver' ? 'active' : ''} ${gnext(mine ? 'board' : 'rival')}">
      ${mine ? `${field}${seatRail(s, pl, mine)}${head}` : `${head}${seatRail(s, pl, mine)}${field}`}
    </div>`;
}

/** How many rivals sit on the left, across the top and on the right, by number of rivals. */
const SEATS: Record<number, [number, number, number]> = { 1: [0, 1, 0], 2: [0, 2, 0], 3: [1, 1, 1], 4: [1, 2, 1], 5: [1, 3, 1], 6: [2, 2, 2], 7: [2, 3, 2] };

/** Rivals seated around the table in turn order: the next player on your left, then round clockwise. */
function seating(s: GameState): string {
  const at = s.players.findIndex((p) => p.id === ui.me);
  const order = s.players.map((_, i) => s.players[(at + 1 + i) % s.players.length]).filter((p) => p.id !== ui.me);
  const [l, t] = SEATS[order.length] ?? [0, order.length, 0];
  const row = (cls: string, list: typeof order) => list.length ? `<div class="rivals ${cls}">${list.map((r) => renderSide(s, r.id, false)).join('')}</div>` : '';
  return row('left', order.slice(0, l)) + row('top', order.slice(l, l + t)) + row('right', order.slice(l + t));
}

/** The fixed places at each seat: decks, discard pile, cards in hand and the Resources tray. */
function seatRail(s: GameState, pl: string, mine: boolean): string {
  const p = player(s, pl);
  const spot = (label: string, body: string, cls = '') => `<div class="spot ${cls}"><div class="spot-card">${body}</div><span class="spot-label">${label}</span></div>`;
  const pile = (deck: 'plot' | 'group', n: number) => spot(deck === 'plot' ? 'Plots' : 'Groups', `<span class="cardback ${deck} ${n ? '' : 'empty'}" aria-hidden="true"></span><span class="spot-count">${n}</span>`, 'deck-spot');
  const top = p.discard[p.discard.length - 1];
  // Every player's discard pile is public and browsable, not only its top card (R012).
  const discard = spot('Discard', top
    ? `<button class="discard-top" data-browse="discard:${pl}" title="Browse the discard pile (${plural(p.discard.length, 'card')}, face up)"><b>${esc(cardName(s, top))}</b></button><span class="spot-count">${p.discard.length}</span>`
    : '<span class="spot-empty">empty</span>', 'discard-spot');
  const destroyedPile = Object.values(s.cards).filter((c) => c.owner === pl && c.zone === 'destroyed');
  const destroyedTop = destroyedPile[destroyedPile.length - 1];
  const destroyed = destroyedPile.length ? spot('Destroyed', `<button class="discard-top" data-browse="destroyed:${pl}" title="Browse the destroyed pile (${plural(destroyedPile.length, 'card')})"><b>${esc(cardName(s, destroyedTop.iid))}</b></button><span class="spot-count">${destroyedPile.length}</span>`, 'discard-spot') : '';
  const plots = plotsInHand(s, pl).length, groups = p.hand.length - plots;
  const fan = (deck: 'plot' | 'group', k: number) => Array.from({ length: Math.min(k, 6) }, () => `<span class="cardback ${deck}"></span>`).join('');
  // A player's exposed Plots are face up and public, even in a rival's hand (R048).
  const exposed = mine ? [] : exposedPlotsOf(s, pl);
  const hand = mine ? '' : `<div class="spot hand-spot" title="${plots} Plot${plots === 1 ? '' : 's'} and ${groups} Group${groups === 1 ? '' : 's'} in hand">
      <div class="fan">${fan('plot', plots)}${fan('group', groups)}</div><span class="spot-label">Hand · ${plots} Plots · ${groups} Groups</span>
      ${exposed.length ? `<div class="exposed-plots">${exposed.map((iid) => `<button class="exposed-plot" data-inspect="${iid}" title="Exposed Plot (face up)">${esc(cardName(s, iid))}</button>`).join('')}</div>` : ''}</div>`;
  const res = resourcesOf(s, pl);
  // Agents (spare Illuminati played inside a rival Illuminati) lie with the Resources, face up (R044).
  const agentCards = agentsOf(s, pl).map((a) => `<button class="res agent" data-inspect="${a}"><b>Agent: ${esc(cardName(s, a))}</b><span class="muted small">+3 against its Power Structure</span></button>`).join('');
  const tray = `<div class="spot res-tray"><div class="res-row">${agentCards}${res.map((r) => {
    const c = s.cards[r];
    const sel = (ui.sel.kind === 'resource' && ui.sel.iid === r) || (ui.sel.kind === 'link' && ui.sel.resource === r);
    return `<button class="res ${sel ? 'selected' : ''} ${gcls(r)}" data-res="${r}"><b>${esc(cardName(s, r))}</b>${c.tokens ? '<span class="token-inline"></span>' : ''}<span class="muted small">${c.hiddenUnder ? `face down under ${esc(cardName(s, c.hiddenUnder))}` : c.linkedTo && s.cards[c.linkedTo] && def(s, c.linkedTo).type !== 'Illuminati' ? `linked to ${esc(cardName(s, c.linkedTo))}` : 'unlinked'}</span></button>`;
  }).join('') || (agentCards ? '' : '<span class="spot-empty">none in play</span>')}</div><span class="spot-label">Resources</span></div>`;
  // Your own decks live on the rail at the left of the screen, where you tap to draw.
  return `<div class="seat-rail">${mine ? '' : pile('plot', p.plotDeck.length) + pile('group', p.groupDeck.length)}${discard}${destroyed}${hand}${tray}</div>`;
}

function placementSlots(s: GameState, pl: string): { r: Rect; onto: string; side: Side }[] {
  if (pl !== ui.me) return [];
  const sel = ui.sel;
  let spots: { onto: string; side: Side }[] = [];
  if (sel.kind === 'takeover') spots = takeoverOptions(s, ui.me).filter((o) => o.card === sel.card);
  else if (sel.kind === 'move') {
    const ignore = new Set(subtree(s, sel.group));
    spots = structureCards(s, ui.me).filter((m) => !ignore.has(m)).flatMap((m) => openArrows(s, m, ignore).map((side) => ({ onto: m, side })));
  } else if (sel.kind === 'confirm' && sel.type === 'control') {
    const open = openArrows(s, sel.attacker);
    if (open.length > 1) spots = open.map((side) => ({ onto: sel.attacker, side }));
  } else if (sel.kind === 'rearrange' && s.prompt?.kind === 'placeCaptured' && s.prompt.player === ui.me) {
    // A new Group keeps its master: only that master's open arrows are offered (R031, R038).
    const d = s.prompt.data as unknown as PlaceCapturedData;
    const waiting = d.pending.find((x) => x.group === sel.group);
    const master = waiting ? waiting.master : s.cards[sel.group]?.master;
    const ignore = waiting ? new Set<string>() : new Set(subtree(s, sel.group));
    spots = master && s.cards[master]?.zone === 'structure' ? openArrows(s, master, ignore).map((side) => ({ onto: master, side })) : [];
  }
  return spots.map((o) => ({ r: attachRect(s, o.onto, o.side), ...o }));
}

function highlightFor(s: GameState, iid: string): string {
  const sel = ui.sel;
  const cls: string[] = [];
  if ((sel.kind === 'group' && sel.iid === iid) || (sel.kind === 'move' && sel.group === iid)) cls.push('selected');
  if (sel.kind === 'confirm' && (sel.attacker === iid || sel.target === iid)) cls.push(sel.attacker === iid ? 'selected' : 'targeted');
  if (sel.kind === 'attack') {
    if (sel.attacker === iid) cls.push('selected');
    if (attackOptions(s, ui.me, sel.attacker).some((o) => o.target === iid && o.type === sel.type)) cls.push('targetable');
  }
  const ctx = s.attack;
  if (ctx) {
    if (ctx.attacker === iid) cls.push('attacking');
    if (ctx.target === iid) cls.push('defending');
  }
  return cls.join(' ');
}

function tableCard(s: GameState, iid: string): string {
  const d = def(s, iid);
  const c = s.cards[iid];
  const ill = d.type === 'Illuminati';
  const outs = outSides(s, iid);
  const inSide = d.arrowIn ? (['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] as Side[])[(['TOP', 'RIGHT', 'BOTTOM', 'LEFT'].indexOf(d.arrowIn) + (c.rot ?? 0)) % 4] : undefined;
  const arrows = (['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] as Side[]).map((sd) =>
    outs.includes(sd) ? `<i class="arr out ${sd.toLowerCase()}"></i>` : sd === inSide ? `<i class="arr in ${sd.toLowerCase()}"></i>` : '').join('');
  const p = power(s, iid), g = globalPower(s, iid);
  const partial = !ill && !isImplemented(d.id) && (GROUP_ABILITIES[d.id]?.length ?? 0) > 0;
  return `
    <button class="card ${ill ? 'ill' : ''} ${c.devastated ? 'devastated' : ''} ${highlightFor(s, iid)} ${gcls(iid)}" data-card="${iid}" title="${esc(`${d.name}: Power ${p}${ill ? '' : `, Global Power ${g}, Resistance ${resistance(s, iid)}`}`)}">
      ${arrows}
      <span class="name">${esc(d.name)}</span>
      <span class="aligns">${alignments(s, iid).map(chip).join('')}</span>
      <span class="stats">
        <span class="pw">${p}${g ? `<small>/${g}</small>` : ''}</span>
        ${ill ? '' : `<span class="rs">${resistance(s, iid)}</span>`}
      </span>
      ${c.tokens ? `<span class="token" title="${c.tokens} Action token${c.tokens > 1 ? 's' : ''}">${c.tokens > 1 ? c.tokens : ''}</span>` : ''}
      ${partial ? '<span class="partial" title="Part of this ability is not active yet">◐</span>' : ''}
    </button>`;
}

function handCard(s: GameState, iid: string): string {
  const d = def(s, iid);
  const spare = d.type === 'Illuminati';
  const isPlot = d.type === 'Plot' || spare;
  const playable = spare ? !agentProblem(s, ui.me, iid) : isPlot && !!PLOTS[d.id];
  const sel = ui.sel;
  const selected = (sel.kind === 'plot' && sel.card === iid) || (sel.kind === 'takeover' && sel.card === iid) || (sel.kind === 'discard' && sel.cards.includes(iid));
  const targetable = sel.kind === 'attack' && sel.type === 'control' && attackOptions(s, ui.me, sel.attacker).some((o) => o.target === iid);
  return `
    <button class="hcard ${isPlot ? 'plot' : 'group'} ${selected ? 'selected' : ''} ${targetable ? 'targetable' : ''} ${isPlot && !playable ? 'inactive' : ''} ${gcls(iid)}" data-hand="${iid}">
      <span class="kind">${spare ? 'Spare Illuminati' : isPlot ? esc(d.subtype === 'Plot' ? 'Plot' : d.subtype) : d.type === 'Resource' ? 'Resource' : esc(d.subtype)}</span>
      <span class="name">${esc(d.name)}</span>
      ${tutorial() && isPlot && !spare && plotTiming(d.id, d.subtype, true) ? `<span class="timing">${esc(plotTiming(d.id, d.subtype, true))}</span>` : ''}
      ${spare ? '<span class="txt">Play it as an agent inside a rival of this Illuminati: +3 to attack or defend against that Power Structure. Costs the top card of both your decks.</span>'
        : isPlot || d.type === 'Resource' ? `<span class="txt">${esc(cardFace(d.id)?.rules || (d.modifier ?? d.text))}</span>` : `
        <span class="aligns">${(d.alignments ?? []).map(chip).join('')}</span>
        <span class="stats"><span class="pw">${d.power}${d.globalPower ? `<small>/${d.globalPower}</small>` : ''}</span><span class="rs">${d.resistance}</span></span>`}
    </button>`;
}

const NWO_COLORS = [['red', 'Red'], ['blue', 'Blue'], ['yellow', 'Yellow']] as const;

/** The middle of the table: one place for each colour of New World Order, which changes the rules for everyone. */
function renderNwo(s: GameState): string {
  const slot = ([color, label]: readonly [string, string]) => {
    const iid = s.nwo[color];
    return iid
      ? `<button class="nwo-slot filled nwo-${color}" data-inspect="${iid}" title="${label} New World Order in play: tap to read it"><span class="nwo-tag">${label}</span><b>${esc(cardName(s, iid))}</b></button>`
      : `<div class="nwo-slot nwo-${color}" title="No ${label.toLowerCase()} New World Order in play"><span class="nwo-tag">${label}</span><span class="spot-empty">open</span></div>`;
  };
  return `<div class="nwo-center">
    <div class="emblem" aria-hidden="true">${EMBLEM}</div>
    <div class="nwo-label" title="New World Order cards stay in play and change the rules for every player. Only one of each colour can be in play; a new one replaces the old.">New World Order</div>
    <div class="nwo-slots">${NWO_COLORS.map(slot).join('')}</div>
  </div>`;
}

/** The table's centrepiece: an eye in a pyramid over a globe, drawn here from scratch. */
const EMBLEM = (() => {
  const rays = Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2, r0 = 44, r1 = i % 2 ? 70 : 82;
    const f = (n: number) => n.toFixed(1);
    return `<line x1="${f(100 + Math.cos(a) * r0)}" y1="${f(104 + Math.sin(a) * r0)}" x2="${f(100 + Math.cos(a) * r1)}" y2="${f(104 + Math.sin(a) * r1)}"/>`;
  }).join('');
  return `<svg viewBox="0 0 200 200"><defs><linearGradient id="em-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7dc92"/><stop offset=".55" stop-color="#c9973e"/><stop offset="1" stop-color="#7a5320"/></linearGradient></defs>
    <g fill="none" stroke="#c9973e" stroke-opacity=".4" stroke-width="1"><circle cx="100" cy="100" r="94"/><circle cx="100" cy="100" r="86" stroke-dasharray="2 4"/><ellipse cx="100" cy="100" rx="36" ry="86"/><ellipse cx="100" cy="100" rx="64" ry="86"/><path d="M14 100H186M22 64Q100 50 178 64M22 136Q100 150 178 136"/></g>
    <g stroke="#e8c170" stroke-opacity=".45" stroke-width=".9">${rays}</g>
    <path d="M100 44L154 138H46Z" fill="#170d22" stroke="url(#em-g)" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M100 57L142 131H58Z" fill="none" stroke="#c9973e" stroke-opacity=".55"/>
    <path d="M73 108Q100 86 127 108Q100 130 73 108Z" fill="#26170c" stroke="url(#em-g)" stroke-width="2.6"/>
    <circle cx="100" cy="108" r="10" fill="url(#em-g)"/><circle cx="100" cy="108" r="4.4" fill="#120a06"/><circle cx="96.5" cy="104.5" r="1.8" fill="#fff" opacity=".85"/></svg>`;
})();

/** The three parts of a turn, with the current one lit. Tapping it opens the turn rules. */
function phaseTracker(s: GameState): string {
  if (s.phase === 'gameOver' || s.phase === 'setup') return '';
  const cur = s.phase === 'beginning' ? 0 : s.phase === 'main' ? 1 : 2;
  const whose = s.players[s.active].id === ui.me ? 'Your turn' : `${player(s, s.players[s.active].id).name}'s turn`;
  return `<button class="phases" data-rules="turn" title="${esc(whose)}: tap for how a turn works"><span class="whose">${esc(whose)}</span>${['Start', 'Main', 'End'].map((n, i) => `<span class="${i === cur ? 'on' : ''}">${n}</span>`).join('<i>›</i>')}<em class="ph-q" aria-hidden="true">?</em></button>`;
}

/** Rules window: sections stop below the sticky tabs, and the tab of the section being read is lit. */
function rulesSpy(): void {
  const box = app.querySelector<HTMLElement>('.modal.rules');
  const nav = box?.querySelector<HTMLElement>('.rule-nav');
  if (!box || !nav) return;
  const secs = Array.from(box.querySelectorAll<HTMLElement>('section[id^="rule-"]'));
  const tabs = Array.from(nav.querySelectorAll<HTMLElement>('button[data-rules]:not(.close-rules)'));
  const light = () => {
    const edge = nav.getBoundingClientRect().bottom + 8;
    let cur = secs[0]?.id;
    for (const sec of secs) if (sec.getBoundingClientRect().top <= edge) cur = sec.id;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) cur = secs[secs.length - 1]?.id ?? cur;
    for (const t of tabs) t.classList.toggle('on', `rule-${t.dataset.rules}` === cur);
  };
  for (const sec of secs) sec.style.scrollMarginTop = `${nav.offsetHeight + 8}px`;
  if (ui.showRules) box.querySelector(`#rule-${ui.showRules}`)?.scrollIntoView({ block: 'start' });
  box.onscroll = light;
  light();
}

/** A plain-words summary of the real rules, so what you learn here works at a real table. */
function rulesHtml(s: GameState): string {
  const me = player(s, ui.me);
  const ill = def(s, me.illuminati);
  const goals = goalsInHand(s, ui.me).map((g) => cardName(s, g));
  const two = s.players.length === 2;
  const sec = (id: string, title: string, body: string) => `<section id="rule-${id}"><h3>${title}</h3>${body}${fullRules(id)}</section>`;
  return `<h2>How to play</h2>
  <nav class="rule-nav">${[['goal', 'Your goal'], ['card', 'Reading a card'], ['turn', 'A turn'], ['tokens', 'Actions'], ['attack', 'Attacks'], ['roll', 'The roll'], ['help', 'Helping'], ['plots', 'Plots'], ['more', 'More rules'], ...(s.players.some((p) => p.isAI && p.aiStyle) ? [['foes', 'Opponents']] : [])].map(([id, t]) => `<button data-rules="${id}">${t}</button>`).join('')}<button class="rb-open-btn" data-rulebook="">Full rulebook</button><button class="close-rules" data-rules="" aria-label="Close rules">✕</button></nav>
  ${sec('goal', 'Your goal', `<p>You win by <b>declaring victory</b> when you meet a Goal at the end of a turn (yours or anyone's; never in the first round), and then surviving your rivals' attempts to stop you. Nobody wins without declaring. There are three kinds of Goal:</p><ul>
    <li><b>Basic Goal:</b> control ${goalNeeded(s, ui.me)} Groups, counting your Illuminati. You have ${goalCount(s, ui.me)}.</li>
    <li><b>Your Illuminati's Special Goal</b> (${esc(ill.name)}): ${esc(goalLine(ill.id) || (cardFace(ill.id) ? 'none of its own: its ability above changes how it wins (see its card).' : ill.text.replace(/^Power [^.]+\.\s*/, '')))}</li>
    <li><b>A Goal card</b> in your hand${goals.length ? ` (you hold: ${esc(goals.join(', '))})` : ''}. You may hold only one Goal card${goalLimit(s, ui.me) > 1 ? ` (your Illuminati allows ${goalLimit(s, ui.me)})` : ''}.</li></ul>
    <p>Groups under a Devastated Place do not count. A player whose Illuminati has no Groups left after their third turn is out, and if all your rivals are out, you win at once.</p>
    <p><b>Declaring:</b> press <i>End turn and declare victory</i> on your turn, or <i>Declare victory</i> while a turn is ending. A Goal card is shown to everyone; nobody can touch it while the claim is decided. Every rival may then use Plots and abilities (including Assassinations and Disasters) to stop you. If your Goal is still met when they all pass, you win; if two players' claims both hold, they share the win. If you are stopped, the turn ends and a Goal card you showed stays exposed.</p>`)}
  ${sec('card', 'Reading a card', `<div class="card-legend">
      <div class="card legend-card" aria-label="Sample card"><i class="arr out top"></i><i class="arr out right"></i><i class="arr in bottom"></i>
        <span class="name">Sample Group</span><span class="aligns">${['Violent', 'Criminal'].map(chip).join('')}</span>
        <span class="stats"><span class="pw">6<small>/2</small></span><span class="rs">4</span></span><span class="token"></span></div>
      <ul>
        <li><b>Big gold number: Power.</b> What the Group adds when it attacks, aids or opposes, and what defends it against an Attack to Destroy.</li>
        <li><b>Small number after the slash: Global Power.</b> What it adds when helping an attack it has no matching alignment for. No slash means 0.</li>
        <li><b>Boxed number: Resistance.</b> What defends it against an Attack to Control.</li>
        <li><b>Coloured tags: alignments</b> (Government, Violent, Weird…). They decide bonuses, and who may help or defend. Tap a card for its attributes (Media, Magic, Nation…) and ability.</li>
        <li><b>Gold triangles: outgoing control arrows.</b> Each can hold one puppet. <b>Small grey notch: the incoming arrow</b>, which faces the card's master.</li>
        <li><b>Gold dot: an Action token.</b> The Group can still act this turn.</li>
      </ul></div>`)}
  ${sec('turn', 'A turn', `<ol><li><b>Start:</b> draw a Plot card, then a Group card, by tapping your decks (both draws are optional: you may skip them; computer players always draw). Then you may make <b>one automatic takeover</b>: put a Group (or Resource) from your hand into your Power Structure with no roll, on a free arrow. Then every Group you control gets its Action token.${two ? ' <i>Two-player rule: if you took a Group over this way, your Illuminati gets no token this turn.</i>' : ''}</li>
    <li><b>Main phase:</b> spend Action tokens: attack, move a Group, buy Plots, bring in a Resource, use card abilities. Anyone may answer with Plots and help at any time.</li>
    <li><b>End:</b> you say you are done. Anyone who meets a Goal may now declare victory; everyone gets a last chance to play cards, and to stop any claim.</li></ol>`)}
  ${sec('tokens', 'Action tokens', `<p>Each Group has one action per turn, shown by its token. Spending it lets the Group attack, aid, oppose, or pay for a card. Tokens come back at the start of your own turn. So a Group that acts in your turn has no token left to defend with during your rivals' turns, while helping or defending in a rival's turn costs you nothing next turn.</p>
    <p>Your <b>Illuminati</b>'s token also buys things: 1 Illuminati token (or 2 tokens from other Groups) buys a Plot card at any time; once per turn it can bring a Resource into play or draw a Group card.</p>`)}
  ${sec('attack', 'Attacks', `<p><b>Attack to Control</b> takes a Group from a rival (or from your own hand). The attacker needs an open outgoing arrow for the captured Group to hang from. Its strength is your Power minus the target's <b>Resistance</b>.</p>
    <p><b>Attack to Destroy</b> removes a Group from play. Strength is your Power minus the target's <b>Power</b>.</p>
    <p>Defense bonus by position: <b>+10</b> if the target hangs directly from its Illuminati, <b>+5</b> one step further, none beyond. Alignments matter: for control, <b>+4</b> for each alignment the attacker shares with the target and <b>−4</b> for each opposite pair; for destroy it is reversed. In an Attack to Control the target also gets <b>+4</b> Resistance for each alignment it shares with its master.</p>
    <p>Only the Group <b>making</b> the attack gets alignment bonuses; Groups that help never do. Criminal has no opposite, and any two Fanatic Groups count as opposites.</p>
    <p><b>Card bonuses:</b> an <b>"any attempt"</b> bonus helps every attack of that kind made by <i>any</i> of your Groups, even if the card with the bonus takes no part (but not another player's attack, even if you help). A <b>direct</b> bonus counts only when that Group makes the attack itself. A Group with both for the same attack uses the larger one; they don't add up.</p>
    <p><b>Puppets:</b> capturing a Group brings its puppets (and theirs) along. Destroying a Group returns its puppets, stripped of their tokens, to their controller's hand.</p>
    <p><b>Instant attacks</b> are cards that attack by themselves: Disasters hit Places, Assassinations hit Personalities. Nobody may aid or oppose them unless a card allows it, and most attack bonuses don't apply to them.</p>
    <p>Nobody can attack an Illuminati.${two ? ' Two-player rule: nobody may attack the other player until both have finished a full turn.' : ''}</p>`)}
  ${sec('roll', 'The roll', `<p>${rollHelp(7)}</p><p>Before the attacker rolls, every player may play Plots, aid, or oppose, back and forth, until nobody wants to add anything. Only then are the dice rolled.</p>`)}
  ${sec('help', 'Helping and defending', `<p>Any Group except the attacker may spend its token to <b>aid</b> (add its Power to the attack) or <b>oppose</b> (add its Power to the defense), from any player, even in someone else's turn.</p>
    <ul><li>To aid an Attack to Control it must share an alignment with the target; to aid an Attack to Destroy it must have an alignment opposite to the target.</li>
    <li>To oppose it must share an alignment with the target, or be the target's master or puppet, or be the target itself (the target defending itself counts double).</li>
    <li>A Group without the right alignment may still help using its <b>Global Power</b> (the second number).</li></ul>
    <p>A card in your hand that is a copy of the attacked Group is an <b>agent</b>: play it for +10 to the attack or −6 against it.</p>`)}
  ${sec('plots', 'Plots', `<p>Plots are your secret cards. Each says when it can be played (shown in its details, and as a tag on the card in Tutorial mode). Costs on the card are paid when you play it.</p>
    <ul><li>Outside your own turn you may hold at most <b>${handLimit(s, ui.me)}</b> Plots; in your turn there is no limit.</li>
    <li><b>New World Orders</b> sit in the middle and change the rules for everyone; only one of each colour at a time.</li>
    <li>Nobody may use two copies of the same Plot in one attack.</li></ul>`)}
  ${s.players.some((p) => p.isAI && p.aiStyle) ? sec('foes', 'Your opponents', `<p>Each computer player has a style it always plays. Learn their habits and use them.</p><ul>${s.players.filter((p) => p.isAI).map((p) => {
    const st = styleById(p.aiStyle);
    return `<li><b>${esc(p.name)}</b> (${st ? esc(st.style) : 'Computer'}, ${LEVEL_NAME[p.aiLevel ?? 'normal']})${st ? `: ${esc(st.blurb)}` : ''}</li>`;
  }).join('')}</ul>`) : ''}
  ${sec('more', 'More rules', `<ul><li><b>Secret</b> Groups can only be attacked or helped by Illuminati and other Secret Groups.</li>
    <li>A <b>Privileged</b> attack allows only the attacker and defender to take part.</li>
    <li><b>Devastated</b> Places lose their tokens and stop counting until someone sends Relief (spending actions worth three times the Place's printed Power).</li>
    <li>You may <b>move</b> a Group (with its puppets) to another open arrow in your Power Structure in your main phase for one token. Groups cannot be dropped.</li>
    <li><b>Deals:</b> use the Deals button to give or trade cards from your hand (hidden or exposed), Resources in play, or Groups in play with their puppets. An exchange made on the spot is binding; a promise about later is not, and nobody has to keep it. Groups and Resources in play change hands only in the main phase of one of the two players, and handing over a Group costs one Action token. Nobody may hand cards to a player in a Privileged attack from outside it. Offers lapse at the end of the turn.</li>
    <li>When a card and a rule disagree, the card wins.</li></ul>`)}`;
}

/** The link from a short Rules section to the matching section of the full rulebook. */
function fullRules(id: string): string {
  const target = sectionById(RULES_PANEL_LINKS[id] ?? '');
  return target ? `<button class="rb-link" data-rulebook="${target.id}">Open the full rulebook: ${esc(target.title)} ›</button>` : '';
}

/** When a Plot may be played, in the words of the rules. */
function plotTiming(id: string, subtype: string, short = false): string {
  if (subtype === 'Goal') return short ? '' : 'Goal card: not played. When you meet it at the end of a turn, declare victory and show it (hold at most one).';
  if (subtype === 'NWO') return short ? '' : 'New World Order: play any time except during an Instant or Privileged attack; it affects everyone until replaced by another of its colour.';
  if (id === I_LIED) return short ? 'With a deal' : 'Play as you accept a deal, or add it to an offer you make (Deals button at the top).';
  const t = PLOTS[id]?.timing ?? [];
  const words: Record<string, [string, string]> = {
    anytime: ['Any time', 'any time you could act'],
    declare: ['When declaring', 'when you declare an attack (announce it with the attack)'],
    attack: ['During an attack', 'during an attack, before the dice are rolled'],
    roll: ['After the roll', 'right after attack dice are rolled'],
    counter: ['Counter', 'right after another Plot is played, to answer it'],
    instant: ['Instant attack', 'as an Instant Attack (a card that attacks by itself)'],
    event: ['In response', 'right after the event named on the card'],
    nwo: ['New World Order', 'as a New World Order'],
  };
  const parts = t.map((x) => words[x]).filter(Boolean);
  if (!parts.length) return short ? '' : '';
  return short ? parts.map((p) => p[0]).join(' / ') : `Play ${parts.map((p) => p[1]).join(', or ')}.`;
}

/** Why a card cannot be used right now, in terms of the real rules (undefined when it can). */
function whyNot(s: GameState, iid: string, can?: { control: boolean; destroy: boolean }): string | undefined {
  const c = s.cards[iid];
  if (!c) return undefined;
  const d = def(s, iid);
  const me = player(s, ui.me);
  const mine = c.controller === ui.me && c.zone === 'structure';
  const myMain = idle(s);
  if (c.zone === 'structure' && c.controller !== ui.me) {
    return 'A rival\'s Group. To take it, pick one of your Groups with an Action token and make an Attack to Control (or Destroy) on it.';
  }
  if (mine) {
    if (!myMain) return 'Groups start actions only in your own turn\'s main phase. In other turns they can still aid or oppose attacks when asked.';
    if (c.tokens === 0) {
      if (c.capturedTurn === s.turn) return 'Taken over this turn: a Group you gain gets its first Action token at the start of your next turn.';
      if (tokenBarred(s, iid)) return 'It cannot hold an Action token right now (for example, it is under a Devastated Place or its Power is 0).';
      return 'No Action token left. Each Group can act once per turn; tokens come back at the start of your turn.';
    }
    if (can && !can.control && !can.destroy) {
      if (s.players.length === 2 && (me.turnsTaken < 1 || s.players.some((p) => p.id !== ui.me && p.turnsTaken < 1))) return 'Two-player rule: nobody may attack the other player until both have finished a full turn. You can still attack a Group card in your hand to control it.';
      return 'No legal target right now.';
    }
    if (can && !can.control && d.type === 'Group' && !openArrows(s, iid).length) return 'No open control arrow, so it cannot make an Attack to Control (a captured Group must have an arrow to hang from). It can still attack to destroy, aid, or oppose.';
    if (can && !can.control) return 'No legal target for an Attack to Control right now.';
    if (can && !can.destroy) return 'No legal target for an Attack to Destroy right now.';
    return undefined;
  }
  if (c.zone === 'hand' && me.hand.includes(iid)) {
    if (d.type === 'Group') return 'Groups in your hand come into play by your one automatic takeover at the start of your turn, or when one of your Groups makes an Attack to Control on the card in your hand.';
    if (d.type === 'Resource') {
      if (!myMain) return 'A Resource comes into play in your own main phase (or by your automatic takeover).';
      if (s.turnFlags.resourcePlayed) return 'Only one Resource per turn can be put into play with your Illuminati\'s action.';
      if (!s.cards[me.illuminati].tokens) return 'Putting a Resource into play costs your Illuminati\'s Action token, which is already spent.';
      if (!canEnterPlay(s, iid, ui.me)) return 'A Unique card: only one copy may be in play (or it has been destroyed).';
      return undefined;
    }
    if (d.type === 'Plot') {
      if (!PLOTS[d.id]) return d.subtype === 'Goal' ? 'Goal cards are not played: when you meet the Goal at the end of a turn, declare victory with it.' : 'This card is not in this version yet.';
      if (plotOptions(s, ui.me, iid).length) return undefined;
      const t = PLOTS[d.id].timing;
      if (!t.includes('anytime') && !t.includes('nwo')) return `${plotTiming(d.id, d.subtype)} That moment is not now.`;
      return 'Its conditions are not met right now: read the card for what it needs (a target, a cost, or a situation).';
    }
  }
  return undefined;
}

/** A small "i" button that opens a longer explanation underneath. */
function infoButton(key: string): string {
  const open = ui.info === key;
  return `<button class="info-btn ${open ? 'on' : ''}" data-info="${key}" aria-expanded="${open}" aria-label="Explain">i</button>`;
}
function infoText(key: string, html: string): string {
  return ui.info === key ? `<div class="info-text" role="note">${html}</div>` : '';
}

/** What "needs N or less" means, for someone new to the game. */
function rollHelp(need: number): string {
  const base = 'Roll two dice. If the total is the number shown or less, the attack succeeds. The number is the attack (Power, plus help) minus the defense (Resistance, plus help).';
  if (need < 2) return `${base} The lowest possible roll is 2, so right now it cannot succeed: unless someone adds Power, it fails without a roll.`;
  if (need >= 10) return `${base} A roll of 11 or 12 <b>always fails</b>, however strong the attack. So any need of 10 or more has the same, best odds: 33 of the 36 possible rolls win (92%). The extra strength still matters if the defense adds more later.`;
  return `${base} A roll of 11 or 12 always fails. The chance shown counts how many of the 36 ways two dice can land are ${need} or less.`;
}

function attackPanel(s: GameState): string {
  const ctx = s.attack!;
  const st = attackStrength(s, ctx);
  const chance = successChance(st.strength);
  const who = ctx.attacker ? cardName(s, ctx.attacker) : ctx.instantCard ? cardName(s, ctx.instantCard) : 'A card';
  const rolled = ctx.roll ? finalRoll(ctx) : undefined;
  return `
    <div class="attack">
      <div class="vs"><b>${esc(who)}</b> <span class="muted">${ctx.instant ? 'strikes' : `attacks to ${ctx.type}`}</span> <b>${esc(cardName(s, ctx.target))}</b> <button class="info-btn" data-rules="attack" aria-label="How attacks work" title="How attacks work">i</button></div>
      <div class="meter">
        <div><span class="big">${st.attack}</span><span class="muted">attack</span></div>
        <div class="minus">−</div>
        <div><span class="big">${st.defense}</span><span class="muted">defense</span></div>
        <div class="eq">=</div>
        <div><span class="big accent">${st.strength}</span><span class="muted">needs ≤ ${st.strength} on 2d6 ${infoButton('roll')}</span></div>
      </div>
      ${infoText('roll', rollHelp(st.strength))}
      <div class="odds">${st.strength < 2 ? 'Fails without a roll unless something changes.' : `${Math.round(chance * 100)}% chance to succeed`}${ctx.roll ? ` · rolled <b class="dice">${ctx.roll[0]}·${ctx.roll[1]}</b>${rolled !== ctx.roll[0] + ctx.roll[1] ? ` → ${rolled}` : ''} — ${currentOutcome(s, ctx) === 'success' ? '<b class="ok">success</b>' : '<b class="bad">failure</b>'}` : ''}</div>
      <details class="lines"><summary>How it adds up</summary><ul>${st.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>
    </div>`;
}

function renderConsole(s: GameState): string {
  const err = ui.error ? `<div class="error" role="alert">${esc(ui.error)}</div>` : '';
  if (ui.slotChoice) {
    return `<div class="panel now"><h2>Which arrow?</h2><p>Two of your cards have an open arrow pointing at that space.</p>
      <div class="opts">${ui.slotChoice.map((c) => { const [onto, side] = c.split(':'); return `<button data-slotpick="${c}">Attach to ${esc(cardName(s, onto))} (its ${side.toLowerCase()} arrow)</button>`; }).join('')}</div>
      <div class="btns"><button class="linkish" data-act="clearSlot">Cancel</button></div></div>`;
  }
  const waiting = waitingFor(s);
  let body = '';
  if (s.phase === 'gameOver') {
    const won = s.winners?.includes(ui.me);
    body = `<h2 class="${won ? 'ok' : 'bad'}">${won ? (s.winners!.length > 1 ? 'Shared victory.' : 'You win.') : s.winners?.length ? `${esc(s.winners.map((w) => player(s, w).name).join(' and '))} ${s.winners.length > 1 ? 'win' : 'wins'}.` : 'Nobody wins.'}</h2>
      <p>${esc(s.log.filter((l) => (/ wins/.test(l.text) || /share the victory/.test(l.text)) && !/roll to go first/.test(l.text)).map((l) => youText(l.text)).join(' '))}</p>
      ${s.players.some((p) => p.isAI && p.aiStyle) ? `<h3>How to beat them next time</h3><ul class="tells">${s.players.filter((p) => p.isAI && styleById(p.aiStyle)).map((p) => {
        const st = styleById(p.aiStyle)!;
        return `<li><b>${esc(p.name)}</b> (${esc(st.style)}): ${esc(st.tell)}</li>`;
      }).join('')}</ul>` : ''}
      ${habitsPanel(s)}
      <div class="btns"><button class="primary" data-act="home">New game</button></div>`;
  } else if (s.prompt?.player === ui.me && s.prompt.kind === 'choose' && s.prompt.choice) {
    const ch = s.prompt.choice;
    const picked = ui.picked ?? [];
    const single = ch.max === 1 && ch.min === 1;
    body = `<h2>${esc(ch.source && s.cards[ch.source] ? cardName(s, ch.source) : 'Your choice')}</h2><p>${esc(ch.question)}</p>
      <div class="opts">${ch.options.map((o) => `<button class="${picked.includes(o.id) ? 'on' : ''}" data-pick-opt="${esc(o.id)}">${picked.includes(o.id) ? '✓ ' : ''}${esc(o.label)}</button>`).join('')}</div>
      ${single ? '' : `<div class="btns"><button class="primary" data-act="choose" ${picked.length >= ch.min && picked.length <= ch.max ? '' : 'disabled'}>Confirm (${picked.length})</button></div>`}`;
  } else if (s.prompt?.player === ui.me && s.prompt.kind === 'draw') {
    const d = s.prompt.data as { plot: number; group: number };
    const me = player(s, ui.me);
    body = `<h2>Draw your cards</h2><p>Start of your turn: draw ${d.plot > 1 ? `${d.plot} Plot cards` : 'a Plot card'} and a Group card. Tap the decks on the left of the table, or use the buttons.</p>
      <div class="btns">
        <button class="${d.plot ? 'primary' : ''}" data-act="draw-plot" ${d.plot && me.plotDeck.length ? '' : 'disabled'}>Draw a Plot${d.plot > 1 ? ` (${d.plot} left)` : ''}</button>
        <button class="${!d.plot && d.group ? 'primary' : ''}" data-act="draw-group" ${d.group && me.groupDeck.length ? '' : 'disabled'}>Draw a Group</button>
        <button class="linkish" data-act="skipDraw">Skip the rest (drawing is optional)</button>
      </div>`;
  } else if (s.prompt?.player === ui.me && s.prompt.kind === 'chooseLead') {
    const opts = leadOptions(s, ui.me).sort((a, b) => (def(s, b).arrowsOut?.length ?? 0) - (def(s, a).arrowsOut?.length ?? 0) || (def(s, b).power ?? 0) - (def(s, a).power ?? 0));
    const leadSide = ui.leadSide ?? 'BOTTOM';
    const arrowName: Record<Side, string> = { TOP: 'Top', RIGHT: 'Right', BOTTOM: 'Bottom', LEFT: 'Left' };
    body = `<h2>Choose your lead Group</h2><p>Pick a Group from your deck to start under your Illuminati. Your rival picks at the same time; if you both pick the same Group, you both pick again.</p>
      <div class="label">Illuminati arrow it hangs from</div>
      <div class="opts">${(['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] as Side[]).map((sd) => `<button class="${sd === leadSide ? 'on' : ''}" data-lead-side="${sd}">${sd === leadSide ? '✓ ' : ''}${arrowName[sd]}</button>`).join('')}</div>
      <div class="label">Lead Group</div>
      <div class="opts">${opts.map((iid) => { const d = def(s, iid); return `<button data-lead="${iid}"><b>${esc(d.name)}</b> · ${d.power}${d.globalPower ? `/${d.globalPower}` : ''} Power, ${d.resistance} Resistance, ${d.arrowsOut?.length ?? 0} arrow${(d.arrowsOut?.length ?? 0) === 1 ? '' : 's'} out${(d.alignments ?? []).length ? ' · ' + (d.alignments ?? []).join(', ') : ''}</button>`; }).join('')}</div>`;
  } else if (s.prompt?.player === ui.me && s.prompt.kind === 'takeover') {
    body = `<h2>Automatic takeover</h2><p>Pick a Group from your hand, then tap a + to place it. No roll needed.${s.players.length === 2 ? ' In a two-player game your Illuminati gets no Action token this turn if you do.' : ''}</p>
      <div class="btns"><button data-act="skipTakeover">Skip takeover</button></div>`;
  } else if (s.prompt?.player === ui.me && s.prompt.kind === 'placeCaptured') {
    const d = s.prompt.data as unknown as PlaceCapturedData;
    const picked = ui.sel.kind === 'rearrange' ? ui.sel.group : undefined;
    const placed = d.cards.filter((g) => s.cards[g]?.zone === 'structure' && s.cards[g].controller === ui.me);
    const btn = (g: string, label: string) => `<button class="${picked === g ? 'on' : ''}" data-rearrange="${g}">${picked === g ? '✓ ' : ''}${esc(label)}</button>`;
    const masterOf = (g: string) => d.pending.find((x) => x.group === g)?.master ?? s.cards[g]?.master;
    body = `<h2>Arrange the new Groups</h2>
      <p>Some Groups that just came in could not keep their places. You may move any new Group to another open arrow of the same master.${d.pending.length ? ` Groups that still have no room when you tap Done are ${d.overflow === 'discard' ? 'discarded' : 'returned to your hand'}.` : ''}</p>
      ${d.pending.length ? `<div class="label">Still need room</div><div class="opts">${d.pending.map((x) => btn(x.group, `${cardName(s, x.group)} (under ${cardName(s, x.master)})`)).join('')}</div>` : ''}
      <div class="label">New Groups in place</div><div class="opts">${placed.map((g) => btn(g, cardName(s, g))).join('')}</div>
      ${picked ? (placementSlots(s, ui.me).length
        ? `<p class="muted">Tap a + beside ${esc(cardName(s, masterOf(picked) ?? picked))} to put ${esc(cardName(s, picked))} there.</p>`
        : `<p class="muted">${esc(cardName(s, masterOf(picked) ?? picked))} has no open arrow right now. Moving one of its other new puppets may make room.</p>`) : ''}
      <div class="btns"><button class="primary" data-act="placeDone">Done</button></div>`;
  } else if (s.prompt?.player === ui.me && s.prompt.kind === 'discardToLimit') {
    const sel = ui.sel.kind === 'discard' ? ui.sel.cards : [];
    // Goal cards: never more than the Goal limit. Plots: the hand limit applies outside your own turn.
    const goals = goalsInHand(s, ui.me);
    const goalExcess = Math.max(0, goals.length - goalLimit(s, ui.me));
    const outside = s.prompt.data?.resume === 'endTurn' || s.players[s.active].id !== ui.me;
    const plotsAfter = plotsInHand(s, ui.me).length - sel.length;
    const goalsLeft = goals.filter((g) => !sel.includes(g)).length;
    const ok = goalsLeft <= goalLimit(s, ui.me) && (!outside || plotsAfter <= handLimit(s, ui.me));
    const plotExcess = outside ? Math.max(0, plotsInHand(s, ui.me).length - handLimit(s, ui.me)) : 0;
    const parts = [
      goalExcess ? `You may hold only ${goalLimit(s, ui.me)} Goal card${goalLimit(s, ui.me) > 1 ? 's' : ''}: pick ${goalExcess} Goal${goalExcess > 1 ? 's' : ''} to get rid of.` : '',
      plotExcess ? `Outside your turn you may hold ${handLimit(s, ui.me)} Plots: pick Plots to get rid of until you are down to ${handLimit(s, ui.me)}.` : '',
    ].filter(Boolean).join(' ');
    body = `<h2>${goalExcess ? 'Too many Goal cards' : 'Too many Plots'}</h2><p>${parts} Tap the cards in your hand.</p>
      <div class="btns"><button class="primary" data-act="discard" ${ok && sel.length ? '' : 'disabled'}>Discard ${sel.length} card${sel.length === 1 ? '' : 's'}</button><button data-act="return" ${ok && sel.length ? '' : 'disabled'}>Put back in my Plot deck</button></div>`;
  } else if (ui.sel.kind === 'discard') {
    // Voluntary discard/return/expose (R048): legal at any time, not only a forced prompt.
    body = renderVoluntaryDiscard(s, ui.sel);
  } else if (s.window && waiting.includes(ui.me)) {
    const opts = responseOptions(s, ui.me);
    const ev = s.window.event;
    const cn = (iid?: string) => esc(iid && s.cards[iid] ? cardName(s, iid) : 'a card');
    const pn = (id?: string) => esc(id ? player(s, id).name : 'A player');
    const evTexts: Record<string, () => string> = {
      turnStart: () => `${pn(ev?.player)}'s turn is starting.`,
      drawn: () => `${pn(ev?.player)} has drawn cards.`,
      takeover: () => `${pn(ev?.player)} took over ${cn(ev?.card)} automatically.`,
      failedTakeover: () => `${pn(ev?.player)} failed to take over ${cn(ev?.card)}.`,
      destroyed: () => `${cn(ev?.card)} was destroyed.`,
      devastated: () => `${cn(ev?.card)} was Devastated.`,
      discarded: () => `${cn(ev?.card)} was discarded.`,
      plotResolved: () => `${cn(ev?.card)} took effect.`,
      relief: () => `Relief was sent to ${cn(ev?.card)}.`,
      action: () => {
        const who = ev?.player === ui.me ? 'You want' : `${pn(ev?.player)} wants`;
        const stopped = ev && actionCancelled(ev) || (ev?.cards?.length && ev.cards.every((c) => actionCancelled(ev, c)));
        return `${who} to ${esc(actionSummary(s, ev!))}. ${stopped ? 'It has been cancelled so far.' : 'It happens once everyone passes, unless someone cancels it.'}`;
      },
    };
    const evText = ev ? (evTexts[ev.type]?.() ?? 'Something happened.') : '';
    const head = s.window.kind === 'event' ? `<p>${evText} You have a card that can respond.</p>`
      : s.window.kind === 'plot' ? `<p><b>${esc(cardName(s, s.window.plot!.iid))}</b> was played. You can counter it.</p>`
      : s.window.kind === 'endOfTurn' && s.claims?.length ? ''
      : s.window.kind === 'endOfTurn' ? '<p>The turn is ending. Last chance to play a card.</p>'
      : s.window.kind === 'roll' ? '<p>The dice are down. Cards that change rolls can be played now.</p>' : '';
    const rivalClaim = s.window.kind === 'endOfTurn' && !!s.claims?.some((c) => c.player !== ui.me);
    body = `${s.claims?.length ? claimPanel(s, opts.length > 0) : ''}${s.attack ? attackPanel(s) : ''}${head}${declarePanel(s, false)}
      <div class="opts">${opts.map((o, i) => `<button data-opt="${i}">${esc(o.label)}</button>`).join('')}</div>
      <div class="btns"><button class="primary" data-act="pass">${s.window.kind === 'attack' && s.attack?.attackerPlayer === ui.me ? '🎲 Roll the dice' : rivalClaim ? (opts.length ? 'Pass: let the claim stand' : 'Let the claim stand') : 'Pass'}</button>${s.window.kind === 'attack' && s.attack?.attackerPlayer === ui.me && !s.attack.instant && !s.attack.committed && !s.attack.plays.some((pp) => pp.player === ui.me) && ![...s.attack.aid, ...s.attack.oppose].some((c) => c.player === ui.me) ? '<button data-act="callOff">Call off the attack</button>' : ''}</div>
      ${anyTimeBar(s)}${voluntaryBar(s)}`;
    (window as unknown as { __opts: typeof opts }).__opts = opts;
  } else if (idle(s)) {
    body = renderMainConsole(s);
  } else {
    const names = waiting.map((id) => player(s, id).name).join(', ');
    body = `${s.claims?.length && !s.attack ? claimPanel(s, false) : ''}${declarePanel(s, false)}${s.attack ? attackPanel(s) : ''}<p class="muted thinking">${online ? (online.busy ? 'Sending…' : `Waiting for ${esc(names)}. You'll see their move here as soon as it's made.`) : ui.thinking ? 'The Computer is thinking…' : 'Waiting…'}</p>
      ${anyTimeBar(s)}${voluntaryBar(s)}`;
  }
  const offers = s.phase === 'gameOver' ? [] : offersTo(s, ui.me);
  const banner = offers.length && !ui.showDeals
    ? `<div class="deal-banner"><p>${esc(player(s, offers[0].from).name)} offers you a deal${offers.length > 1 ? ` (and ${offers.length - 1} more)` : ''}. It lapses at the end of this turn.</p><div class="btns"><button class="primary" data-act="deals">See the offer</button></div></div>` : '';
  return `<div class="panel now">${err}${banner}${body}</div>`;
}

function renderMainConsole(s: GameState): string {
  const sel = ui.sel;
  const me = player(s, ui.me);
  if (sel.kind === 'group') {
    const d = def(s, sel.iid);
    const opts = attackOptions(s, ui.me, sel.iid);
    const canControl = opts.some((o) => o.type === 'control');
    const canDestroy = opts.some((o) => o.type === 'destroy');
    const canMove = d.type === 'Group';
    return `<h2>${esc(d.name)}</h2>
      <p class="muted">${s.cards[sel.iid].tokens ? 'Has an Action token.' : 'No Action token — it can still pay for nothing this turn.'}</p>
      <div class="btns">
        <button ${canControl ? '' : 'disabled'} data-act="atk-control">Attack to control</button>
        <button ${canDestroy ? '' : 'disabled'} data-act="atk-destroy">Attack to destroy</button>
        ${canMove ? `<button data-act="move">Move</button>` : ''}
        ${s.cards[sel.iid].tokens ? '<button data-act="dropToken" title="You may take a token off your own card whenever you like">Remove its token</button>' : ''}
        <button class="linkish" data-inspect="${sel.iid}">Details</button>
        <button class="linkish" data-act="clear">Cancel</button>
      </div>
      ${abilityButtons(s, sel.iid)}
      ${tutorial() && (!canControl || !canDestroy) ? `<p class="why">${esc(whyNot(s, sel.iid, { control: canControl, destroy: canDestroy }) ?? '')}</p>` : ''}`;
  }
  if (sel.kind === 'attack') {
    return `<h2>Attack to ${sel.type}</h2><p>Tap a highlighted target${sel.type === 'control' ? ' — a rival Group, or a Group card in your hand' : ''}.</p>
      <div class="btns"><button class="linkish" data-act="clear">Cancel</button></div>`;
  }
  if (sel.kind === 'confirm') {
    const probe = { id: -1, type: sel.type, instant: false, attacker: sel.attacker, attackerPlayer: ui.me, target: sel.target, targetPlayer: s.cards[sel.target].controller, fromHand: s.cards[sel.target].zone === 'hand', privileged: false, aid: [], oppose: [], attackBonus: sel.plots.map((p) => ({ player: ui.me, plot: p.card, amount: p.mode === 'power' ? 10 : 0, label: cardName(s, p.card) })), defenseBonus: [], plays: [] };
    const st = attackStrength(s, probe);
    const decl = { type: 'attack' as const, attackType: sel.type, attacker: sel.attacker, target: sel.target };
    const extra = plotsInHand(s, ui.me).flatMap((c) => plotOptions(s, ui.me, c, decl).map((o) => ({ c, o })));
    return `<h2>${esc(cardName(s, sel.attacker))} → ${esc(cardName(s, sel.target))}</h2>
      <p>Attack to ${sel.type}: <b>${st.attack}</b> vs <b>${st.defense}</b> → needs <b class="accent">${st.strength}</b> or less on two dice, ${Math.round(successChance(st.strength) * 100)}% before anyone helps or defends. ${infoButton('roll')}</p>
      ${infoText('roll', rollHelp(st.strength))}
      ${sel.type === 'control' && openArrows(s, sel.attacker).length > 1 ? `<p class="muted">Arrow for the captured Group: <b>${(sel.side ?? openArrows(s, sel.attacker)[0]).toLowerCase()}</b> (tap a + to change).</p>` : ''}
      ${extra.length ? `<div class="label">Add Plots now (they must be played when the attack is declared)</div><div class="opts">${extra.map(({ c, o }, i) => {
        const on = sel.plots.some((p) => p.card === c);
        return `<button class="${on ? 'on' : ''}" data-decl="${i}">${on ? '✓ ' : ''}${esc(cardName(s, c))}: ${esc(o.label)}</button>`;
      }).join('')}</div>` : ''}
      ${abilitiesOf(s, player(s, ui.me).illuminati).some((a) => a.kind === 'freePrivilegedAttack') && !s.turnFlags.bavarianPrivilege ? `<label class="toggle"><input type="checkbox" id="priv" ${sel.privileged ? 'checked' : ''}> Make it Privileged (your Illuminati's free Privileged attack this turn: only you and the defender can take part)</label>` : ''}
      <div class="btns"><button class="primary" data-act="declare">Declare attack</button><button class="linkish" data-act="clear">Cancel</button></div>`;
  }
  if (sel.kind === 'deck') {
    const ill = me.illuminati;
    if (sel.deck === 'plot') {
      return `<h2>Plot deck</h2><p>${plural(me.plotDeck.length, 'card')} left. Buying a Plot costs your Illuminati's Action token, or the tokens of two other Groups — at any time, not only in your own main phase.</p>
        ${anyTimeBar(s)}
        <div class="btns"><button class="linkish" data-act="clear">Close</button></div>`;
    }
    const can = s.cards[ill].tokens && !s.turnFlags.illumGroupDraw && me.groupDeck.length;
    return `<h2>Group deck</h2><p>${plural(me.groupDeck.length, 'card')} left. Once per turn your Illuminati can spend its Action token to draw a Group card.</p>
      <div class="btns"><button class="primary" data-act="drawGroup" ${can ? '' : 'disabled'}>Draw a Group card</button><button class="linkish" data-act="clear">Cancel</button></div>
      ${!can && tutorial() ? `<p class="why">${esc(s.turnFlags.illumGroupDraw ? 'Your Illuminati has already drawn a Group card this turn.' : !me.groupDeck.length ? 'Your Group deck is empty.' : 'Your Illuminati\'s Action token is already spent this turn.')}</p>` : ''}`;
  }
  if (sel.kind === 'resource') {
    const d = def(s, sel.iid);
    const inHand = s.cards[sel.iid].zone === 'hand';
    if (inHand) {
      const can = !s.turnFlags.resourcePlayed && s.cards[me.illuminati].tokens > 0 && canEnterPlay(s, sel.iid, ui.me);
      return `<h2>${esc(d.name)}</h2>${faceBlock(d.id, d.text)}
        <div class="btns"><button class="primary" data-act="playResource" ${can ? '' : 'disabled'}>Put into play (Illuminati token, once per turn)</button><button class="linkish" data-act="clear">Close</button></div>`;
    }
    return `<h2>${esc(d.name)}</h2>${faceBlock(d.id, d.text)}
      <div class="btns"><button data-act="linkStart">Link to a Group</button><button class="linkish" data-act="clear">Close</button></div>${abilityButtons(s, sel.iid)}`;
  }
  if (sel.kind === 'link') {
    return `<h2>Link ${esc(cardName(s, sel.resource))}</h2><p>Tap one of your Groups to link it to. A link can be moved once per turn.</p><div class="btns"><button class="linkish" data-act="clear">Cancel</button></div>`;
  }
  if (sel.kind === 'move') {
    const free = s.turnFlags.freeMoves === ui.me;
    const g = s.cards[sel.group];
    const candidates = [sel.group, g.master, player(s, ui.me).illuminati].filter((x): x is string => !!x && s.cards[x]?.tokens > 0);
    const payWith = sel.payWith ?? candidates[0];
    return `<h2>Move ${esc(cardName(s, sel.group))}</h2><p>Tap a + to move it (and its puppets) there.${free ? ' This move is free.' : ' Costs one Action token.'}</p>
      ${!free && candidates.length ? `<div class="label">Pay with</div><div class="opts">${candidates.map((c) => `<button class="${c === payWith ? 'on' : ''}" data-payer="${c}">${c === payWith ? '✓ ' : ''}${esc(cardName(s, c))}</button>`).join('')}</div>` : ''}
      <div class="btns"><button class="linkish" data-act="clear">Cancel</button></div>`;
  }
  if (sel.kind === 'plot') {
    const d = def(s, sel.card);
    const opts = plotOptions(s, ui.me, sel.card);
    (window as unknown as { __popts: typeof opts }).__popts = opts;
    return `<h2>${esc(d.name)}</h2>${faceBlock(d.id, d.text)}
      ${PLOTS[d.id] ? (opts.length ? `<div class="opts">${opts.map((o, i) => `<button data-popt="${i}">${esc(o.label)}</button>`).join('')}</div>` : (tutorial() ? `<p class="why">${esc(whyNot(s, sel.card) ?? 'Not playable right now.')}</p>` : '<p class="muted">Not playable right now.</p>')) : '<p class="muted">This card is not in this version of the game yet.</p>'}
      <div class="btns"><button class="linkish" data-act="clear">Close</button></div>`;
  }
  return `<h2>Your turn</h2>
    ${declarePanel(s, true)}
    <p>Tap one of your Groups with a <span class="token-inline"></span> token to attack or move it. Tap a Plot in your hand to play it.</p>
    <div class="btns">
      <button data-act="drawGroup" ${s.cards[me.illuminati].tokens && !s.turnFlags.illumGroupDraw && me.groupDeck.length ? '' : 'disabled'}>Draw a Group card (Illuminati token, once per turn)</button>
      <button class="primary" data-act="endTurn">End turn</button>
    </div>
    ${anyTimeBar(s)}
    ${voluntaryBar(s)}
    ${online ? '' : `<label class="toggle"><input type="checkbox" id="autopass" ${ui.autoPass ? 'checked' : ''}> Pass for me when I have no possible response</label>`}`;
}

/** Is the victory reminder on for you: the game's setting, or Tutorial/Guided help? */
const remindOn = (s: GameState) => ui.help !== 'off' || !!s.settings.victoryReminder;

/**
 * With the reminder on, ending your turn or passing while you could declare victory stops once to
 * tell you (tap again to go on without declaring). In strict play nothing warns you.
 */
function remindFirst(s: GameState | null): boolean {
  if (!s || !victoryReminder(s, ui.me, remindOn(s)).length || remindedAt === s.version) return false;
  remindedAt = s.version;
  ui.error = 'You meet a Goal right now. Declare victory, or the chance passes: nobody wins without declaring. Tap again to go on without declaring.';
  render();
  return true;
}

/** "Declare victory" buttons, one per Goal you could claim now. `knock`: in your main phase, declaring also ends your turn. */
function declarePanel(s: GameState, knock: boolean): string {
  const opts = declareOptions(s, ui.me);
  if (!opts.length) return '';
  const remind = victoryReminder(s, ui.me, remindOn(s)).length > 0;
  const lead = remind
    ? `<p class="claim-remind"><b>You meet a Goal.</b> Declare victory${knock ? ' (this ends your turn)' : ''}: if you do not, you do not win.</p>`
    : '';
  const teach = tutorial()
    ? `<p class="why">Declaring shows which Goal you have met${opts.some((o) => o.card) ? ' (a Goal card is shown to everyone)' : ''}. Every rival then gets a chance to stop you with Plots and abilities, including Instant attacks such as Assassinations and Disasters. If your Goal is still met when they have all passed, you win. If they stop you, the turn simply ends${opts.some((o) => o.card) ? ', and a Goal card you showed stays exposed in your hand' : ''}.</p>`
    : '';
  return `<div class="claim-box">${lead}<div class="opts">${opts.map((o) => `<button class="claim-btn" data-claim="${esc(o.id)}">${knock ? 'End turn and declare victory' : 'Declare victory'}: ${esc(o.label)}${o.why ? ` <span class="muted">(${esc(o.why)})</span>` : ''}</button>`).join('')}</div>${teach}</div>`;
}

/** The claims of victory waiting to be decided, as everyone sees them. */
function claimPanel(s: GameState, canAnswer: boolean): string {
  const claims = s.claims ?? [];
  if (!claims.length) return '';
  const mine = claims.find((c) => c.player === ui.me);
  const rivals = claims.filter((c) => c.player !== ui.me);
  const line = (c: { player: string; labels: string[] }) => `<li><b>${esc(player(s, c.player).name)}</b> is claiming victory with ${esc(c.labels.join(' and '))}.</li>`;
  const ask = rivals.length
    ? (canAnswer ? '<p><b>Respond?</b> Use a card below to stop the claim, or pass to let it stand.</p>' : '<p>You have nothing that can stop it right now.</p>')
    : '<p>Your rivals are deciding whether they can stop you. You may answer anything they do.</p>';
  const teach = tutorial()
    ? `<p class="why">A victory is only won once every other player has had the chance to stop it. Plots and special abilities may be used now, and Instant attacks (Assassinations, Disasters) may strike a claimant's Groups. If the Goal is still met when everyone has passed, the claim wins${claims.length > 1 ? '; claims that all hold share the victory, except two factions of the same Illuminati, who cancel each other out' : ''}. If not, the turn ends and play goes on.</p>`
    : '';
  return `<div class="claim-banner" role="alert"><h2>${rivals.length ? (rivals.length > 1 ? 'Victory is being claimed' : `${esc(player(s, rivals[0].player).name)} is claiming victory`) : 'You have declared victory'}</h2>
    <ul>${[...(mine ? [mine] : []), ...rivals].map((c) => c.player === ui.me ? `<li><b>You</b> are claiming victory with ${esc(c.labels.join(' and '))}.</li>` : line(c)).join('')}</ul>${ask}${teach}</div>`;
}

/** Buying Plots and sending Relief are legal at any time (your turn, a rival's, or a response window). */
function anyTimeBar(s: GameState): string {
  const me = player(s, ui.me);
  const ill = me.illuminati;
  const allPayers = structureCards(s, ui.me).filter((g) => g !== ill && s.cards[g].tokens > 0).sort((a, b) => power(s, a) - power(s, b));
  let buy = '';
  if (me.plotDeck.length) {
    if (ui.buyPick) {
      const picked = ui.buyPick;
      const ok = picked.length === 2 && new Set(picked).size === 2;
      buy = `<div class="label">Buy a Plot: choose 2 Groups to pay</div><div class="opts">${allPayers.map((g) => `<button class="${picked.includes(g) ? 'on' : ''}" data-act="buy-toggle" data-buy-toggle="${g}">${picked.includes(g) ? '✓ ' : ''}${esc(cardName(s, g))}</button>`).join('')}</div>
        <div class="btns"><button class="primary" data-act="buy-confirm" ${ok ? '' : 'disabled'}>Confirm</button><button class="linkish" data-act="buy-cancel">Cancel</button></div>`;
    } else {
      buy = `<div class="btns">
        <button data-act="buy-ill" ${s.cards[ill].tokens ? '' : 'disabled'}>Buy a Plot (Illuminati token)</button>
        <button data-act="buy-open" ${allPayers.length >= 2 ? '' : 'disabled'}>Buy a Plot (2 Group tokens)</button>
      </div>`;
    }
  }
  // Relief (R037): one player alone, or several together. Other players' Groups join through the
  // pledges they have made; a player who cannot pay alone may pledge his Groups for someone else to send.
  const pool = structureCards(s, ui.me).filter((g) => s.cards[g].tokens > 0 && !tokenBarred(s, g)).sort((a, b) => power(s, b) - power(s, a));
  const places = me.eliminated ? [] : Object.values(s.cards).filter((c) => c.zone === 'structure' && c.devastated).map((c) => c.iid);
  let relief = '';
  const rows: string[] = [];
  for (const place of places) {
    const need = 3 * (def(s, place).power ?? 0);
    const pledges = reliefPledgesFor(s, place, ui.me);
    const canSend = legal(s, ui.me, { type: 'relief', place, payWith: pool, partners: pledges.map((x) => x.player) });
    const alone = legal(s, ui.me, { type: 'relief', place, payWith: pool });
    const mine = s.reliefPledges?.find((x) => x.player === ui.me && x.place === place);
    const note = pledges.length ? `; pledged: ${pledges.map((x) => `${player(s, x.player).name} ${x.power}`).join(', ')}` : '';
    const btns = [
      canSend && ui.reliefPick?.place !== place ? `<button data-act="relief-open" data-relief-open="${place}">Relieve ${esc(cardName(s, place))} (needs ${need}${esc(note)})</button>` : '',
      !alone && pool.length && ui.pledgePick?.place !== place ? `<button data-pledge-open="${place}">${mine ? 'Change my pledge' : 'Pledge Groups'} toward Relief for ${esc(cardName(s, place))} (needs ${need}${esc(note)})</button>` : '',
      mine ? `<button class="linkish" data-pledge-withdraw="${place}">Withdraw my pledge for ${esc(cardName(s, place))}</button>` : '',
    ].filter(Boolean).join('');
    if (btns) rows.push(btns);
  }
  if (rows.length) relief = `<div class="label">Relief for Devastated Places (needs 3× printed Power, from one player or several together)</div><div class="opts">${rows.join('')}</div>`;
  if (ui.reliefPick && places.includes(ui.reliefPick.place)) {
    const place = ui.reliefPick.place;
    const need = 3 * (def(s, place).power ?? 0);
    const picked = ui.reliefPick.groups;
    const pledges = reliefPledgesFor(s, place, ui.me);
    const partners = ui.reliefPick.partners.filter((x) => pledges.some((y) => y.player === x));
    const tot = picked.reduce((n, g) => n + power(s, g), 0) + pledges.filter((x) => partners.includes(x.player)).reduce((n, x) => n + x.power, 0);
    relief += `<div class="label">Relieve ${esc(cardName(s, place))}: choose which Groups pay (${tot} of ${need} Power)</div>
      <div class="opts">${pool.map((g) => `<button class="${picked.includes(g) ? 'on' : ''}" data-act="relief-toggle" data-relief-toggle="${g}">${picked.includes(g) ? '✓ ' : ''}${esc(cardName(s, g))} (${power(s, g)})</button>`).join('')}
      ${pledges.map((x) => `<button class="${partners.includes(x.player) ? 'on' : ''}" data-relief-partner="${x.player}">${partners.includes(x.player) ? '✓ ' : ''}${esc(player(s, x.player).name)}'s pledge: ${esc(x.groups.map((g) => cardName(s, g)).join(', '))} (${x.power})</button>`).join('')}</div>
      <div class="btns"><button class="primary" data-act="relief-confirm" ${tot >= need ? '' : 'disabled'}>Send Relief</button><button class="linkish" data-act="relief-cancel">Cancel</button></div>`;
  }
  if (ui.pledgePick && places.includes(ui.pledgePick.place)) {
    const place = ui.pledgePick.place;
    const picked = ui.pledgePick.groups;
    relief += `<div class="label">Pledge toward Relief for ${esc(cardName(s, place))}: nothing is spent until someone sends the Relief with your pledge; it lapses when this turn ends</div>
      <div class="opts">${pool.map((g) => `<button class="${picked.includes(g) ? 'on' : ''}" data-pledge-toggle="${g}">${picked.includes(g) ? '✓ ' : ''}${esc(cardName(s, g))} (${power(s, g)})</button>`).join('')}</div>
      <div class="btns"><button class="primary" data-act="pledge-confirm" ${picked.length ? '' : 'disabled'}>Pledge</button><button class="linkish" data-act="pledge-cancel">Cancel</button></div>`;
  }
  // Spare Illuminati cards that can become agents now (R044).
  const spare = me.hand.filter((c) => def(s, c).type === 'Illuminati' && !agentProblem(s, ui.me, c));
  const agents = spare.length ? `<div class="label">Spare Illuminati</div><div class="opts">${spare.map((c) => `<button data-agent="${c}">Play ${esc(cardName(s, c))} as an agent (+3 against it; discards the top card of both your decks)</button>`).join('')}</div>` : '';
  return buy + relief + agents;
}

/** A button that opens the "tidy your hand" picker: discard, return a Plot to your deck, or expose a
 * Plot, all legal at any time (R048), not only when forced by a hand limit. */
function voluntaryBar(s: GameState): string {
  const me = player(s, ui.me);
  if (!me.hand.length) return '';
  return `<div class="btns"><button data-act="tidy">Discard or return cards from my hand</button></div>`;
}

/** The picker for voluntary discards/returns/exposes: tap cards in the hand strip, then a button here. */
function renderVoluntaryDiscard(s: GameState, sel: Extract<Sel, { kind: 'discard' }>): string {
  const cards = sel.cards;
  const allPlots = cards.length > 0 && cards.every((c) => plotsInHand(s, ui.me).includes(c));
  const canExposeAll = allPlots && cards.every((c) => !s.cards[c].exposed && canExpose(s, c));
  return `<h2>Tidy your hand</h2><p>Tap cards in your hand to select them, then choose what to do. Legal at any time.</p>
    <div class="btns">
      <button class="primary" data-act="voluntary-discard" ${cards.length ? '' : 'disabled'}>Discard</button>
      <button data-act="voluntary-return-top" ${allPlots ? '' : 'disabled'}>Return to deck: top</button>
      <button data-act="voluntary-return-middle" ${allPlots ? '' : 'disabled'}>Return to deck: middle</button>
      <button data-act="voluntary-return-bottom" ${allPlots ? '' : 'disabled'}>Return to deck: bottom</button>
      ${canExposeAll && cards.length === 1 ? '<button data-act="voluntary-expose">Expose</button>' : ''}
      ${canExposeAll && cards.length === 1 ? rivalsLive(s).map((r) => `<button data-show-to="${r.id}">Show it to ${esc(r.name)} only</button>`).join('') : ''}
      <button class="linkish" data-act="clear">Cancel</button>
    </div>
    ${!cards.length ? '<p class="muted small">Only Plot cards can be returned to your deck or exposed.</p>' : ''}`;
}

function abilityButtons(s: GameState, card: string): string {
  const opts = abilityOptions(s, ui.me, card);
  (window as unknown as { __abil: typeof opts }).__abil = opts;
  if (!opts.length) return (HOOKS[s.cards[card].cardId]?.actions?.length ? '<p class="muted small">Its special ability cannot be used right now.</p>' : '');
  return `<div class="label">Special abilities</div><div class="opts">${opts.map((o, i) => `<button data-abil="${i}">${esc(o.label)}</button>`).join('')}</div>`;
}

/** A card's face: its rules text, an Illuminati's Special Goal, and flavour; the engine's exact wording on request. */
/** "1 card", "2 cards". */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** An Illuminati's Special Goal without its "Special Goal:" label ('' when it has none of its own). */
const goalLine = (cardId: string) => (cardFace(cardId)?.goal ?? '').replace(/^Special Goal:\s*/i, '');
/** What an Illuminati pick button says: its card-face ability and Special Goal. */
function illPickText(cardId: string, engineText: string): string {
  const f = cardFace(cardId);
  if (!f) return engineText.replace(/^Power [^.]+\.\s*/, '');
  return goalLine(cardId) ? `${f.rules} Special Goal: ${goalLine(cardId)}` : f.rules;
}

function faceBlock(cardId: string, engineText: string): string {
  const f = cardFace(cardId);
  if (!f) return `<p class="small">${esc(engineText)}</p>`;
  return `${f.rules ? `<p class="face-rules">${esc(f.rules)}</p>` : ''}${f.goal ? `<p class="face-goal"><b>Special Goal:</b> ${esc(goalLine(cardId))}</p>` : ''}
    ${f.flavor ? `<p class="face-flavor">${esc(f.flavor)}</p>` : ''}
    <details class="face-exact"><summary>Exact rules wording</summary><p class="small">${esc(engineText)}</p></details>`;
}

function renderInspect(s: GameState): string {
  const iid = ui.inspect;
  if (!iid || !s.cards[iid]) return '';
  const d = def(s, iid);
  const abil = GROUP_ABILITIES[d.id] ?? [];
  const pending = abil.filter((a) => a.kind === 'pending').map((a) => (a as { note: string }).note);
  // Current (post-modifier) values, not just the card's printed stats (an NWO or ability can change them).
  const stats = d.type === 'Group' || d.type === 'Illuminati'
    ? `<div class="kv"><span>Power</span><b>${power(s, iid)}${d.globalPower ? ` / ${globalPower(s, iid)} Global` : ''}</b>${d.type === 'Group' ? `<span>Resistance</span><b>${resistance(s, iid)}</b>` : ''}</div>
       <div>${alignments(s, iid).map(chip).join(' ')} ${attributes(s, iid).map((a) => `<span class="attr">${a}</span>`).join(' ')}</div>` : '';
  // Plots and Resources linked to a Group (or its Illuminati) are public: everyone can see what is
  // attached to it, not just its controller.
  const linkedPlots = (d.type === 'Group' || d.type === 'Illuminati')
    ? Object.values(s.cards).filter((c) => c.zone === 'table' && c.linkedTo === iid).map((c) => c.iid) : [];
  const linkedRes = (d.type === 'Group' || d.type === 'Illuminati')
    ? Object.values(s.cards).filter((c) => c.zone === 'resources' && c.linkedTo === iid && !c.hiddenUnder).map((c) => c.iid) : [];
  return `<div class="panel inspect popover">
    <button class="close" data-act="closeInspect" aria-label="Close">×</button>
    <div class="label">${esc(d.subtype)}</div><h3>${esc(d.name)}</h3>${stats}
    ${faceBlock(d.id, d.text)}
    ${d.type === 'Plot' ? `<p class="small"><span class="timing">${esc(plotTiming(d.id, d.subtype))}</span></p>` : ''}
    ${tutorial() && whyNot(s, iid) ? `<p class="why">${esc(whyNot(s, iid)!)}</p>` : ''}
    ${pending.length ? `<p class="small warn">Not active yet in this version: ${esc(pending.join('; '))}.</p>` : ''}
    ${d.type === 'Plot' && !PLOTS[d.id] ? '<p class="small warn">This Plot is not in this version yet.</p>' : ''}
    ${d.subtype === 'NWO' && NWO_EFFECTS[d.id] ? '<p class="small muted">In effect for everyone while on the table.</p>' : ''}
    ${linkedPlots.length ? `<div class="label">Plots linked here</div><div class="opts">${linkedPlots.map((p) => `<button data-inspect="${p}">${esc(cardName(s, p))}</button>`).join('')}</div>` : ''}
    ${linkedRes.length ? `<div class="label">Resources linked here</div><div class="opts">${linkedRes.map((r) => `<button data-inspect="${r}">${esc(cardName(s, r))}</button>`).join('')}</div>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ deals, trades and gifts (R040)

const rivalsLive = (s: GameState) => s.players.filter((p) => p.id !== ui.me && !p.eliminated);
const cardKind = (s: GameState, iid: string) => {
  const c = s.cards[iid];
  return c.zone === 'resources' ? 'res' : c.zone === 'structure' ? 'group' : 'hand';
};
/** Your open arrows, as "onto:side" choices. */
function mySpots(s: GameState): { key: string; label: string }[] {
  return structureCards(s, ui.me).flatMap((m) => openArrows(s, m).map((side) => ({ key: `${m}:${side}`, label: `${cardName(s, m)} (its ${side.toLowerCase()} arrow)` })));
}
/** Your cards whose Action token could pay for a Group changing hands. */
const myPayers = (s: GameState) => structureCards(s, ui.me).filter((g) => s.cards[g].tokens > 0);
const myLie = (s: GameState) => player(s, ui.me).hand.find((c) => s.cards[c].cardId === I_LIED);
const cardLabel = (s: GameState, iid: string) => {
  const c = s.cards[iid];
  const d = def(s, iid);
  const where = c.zone === 'hand' ? (d.type === 'Plot' ? (c.exposed ? 'exposed Plot' : 'hidden Plot') : `${d.type} card in hand`) : c.zone === 'resources' ? 'Resource in play' : 'Group in play';
  const n = c.zone === 'structure' ? subtree(s, iid).length - 1 : 0;
  return `${cardName(s, iid)} (${where}${n ? `, with ${n} puppet${n === 1 ? '' : 's'}` : ''})`;
};

function newDraft(s: GameState, to?: string): DealDraft {
  return { to: to ?? rivalsLive(s)[0]?.id ?? '', give: [], pay: {}, get: [], place: {}, anyPlots: 0, anyCards: 0, note: '', lie: false };
}

/** A counter-offer starts from the offer turned around. */
function counterDraft(s: GameState, d: Deal): DealDraft {
  const spot = mySpots(s)[0]?.key ?? '';
  return {
    ...newDraft(s, d.from), counterOf: d.id,
    give: [...(d.get.cards ?? []), ...(d.get.resources ?? []), ...(d.get.groups ?? []).map((g) => g.group)],
    get: [...(d.give.cards ?? []), ...(d.give.resources ?? []), ...(d.give.groups ?? []).map((g) => g.group)],
    place: Object.fromEntries((d.give.groups ?? []).map((g) => [g.group, spot])),
  };
}

function sendDraft(s: GameState) {
  const d = ui.draft;
  if (!d) return;
  const note = app.querySelector<HTMLInputElement>('#deal-note')?.value ?? d.note;
  const mine = (k: string) => d.give.filter((c) => s.cards[c] && cardKind(s, c) === k);
  const theirs = (k: string) => d.get.filter((c) => s.cards[c] && cardKind(s, c) === k);
  const spot = mySpots(s)[0]?.key ?? '';
  const give: DealSide = { cards: mine('hand'), resources: mine('res'), groups: mine('group').map((g) => ({ group: g, payWith: d.pay[g] || undefined })) };
  const get: DealSide = {
    cards: theirs('hand'), resources: theirs('res'), anyPlots: d.anyPlots, anyCards: d.anyCards,
    groups: theirs('group').map((g): DealGroup => { const [onto, side] = (d.place[g] ?? spot).split(':'); return { group: g, onto: onto || undefined, side: (side || undefined) as Side | undefined }; }),
  };
  const lie = d.lie ? myLie(s) : undefined;
  d.note = note;
  act({ type: 'offerDeal', to: d.to, give, get, note: note.trim() || undefined, lie, counterOf: d.counterOf });
  // Offline the move is made at once; online, the reply clears the draft once the offer is through.
  if (!online && !ui.error) { ui.draft = undefined; render(); }
}

function answerFor(id: string): DealAnswer {
  return ((ui.answers ??= {})[id] ??= { choose: [], place: {}, pay: {}, lie: false });
}

function acceptDeal(s: GameState, d: Deal) {
  const a = answerFor(d.id);
  const groups: DealGroup[] = [
    ...(d.give.groups ?? []).map((g) => {
      const [onto, side] = (a.place[g.group] ?? mySpots(s)[0]?.key ?? '').split(':');
      return { group: g.group, onto, side: side as Side, payWith: g.payWith ?? (a.pay[g.group] || undefined) };
    }),
    ...(d.get.groups ?? []).filter((g) => !g.payWith).map((g) => ({ group: g.group, payWith: a.pay[g.group] || undefined })),
  ];
  act({ type: 'respondDeal', deal: d.id, accept: true, choose: a.choose, groups, lie: a.lie ? myLie(s) : undefined });
}

/** The choices an offer to you leaves open: which cards of yours, where its Groups go, who pays. */
function answerForm(s: GameState, d: Deal): string {
  const a = answerFor(d.id);
  const me = player(s, ui.me);
  const out: string[] = [];
  const pick = (kind: 'Plot' | 'other', n: number) => {
    const cards = me.hand.filter((c) => (kind === 'Plot') === (def(s, c).type === 'Plot') && !(d.get.cards ?? []).includes(c) && s.cards[c].cardId !== I_LIED);
    return `<p class="small">Choose ${n} ${kind === 'Plot' ? `Plot${n === 1 ? '' : 's'}` : `Group or Resource card${n === 1 ? '' : 's'}`} to hand over:</p>
      <div class="btns deal-picks">${cards.map((c) => `<button class="${a.choose.includes(c) ? 'on' : ''}" data-ans-pick="${d.id}|${c}">${esc(cardName(s, c))}</button>`).join('') || '<span class="muted small">You have none.</span>'}</div>`;
  };
  if (d.get.anyPlots) out.push(pick('Plot', d.get.anyPlots));
  if (d.get.anyCards) out.push(pick('other', d.get.anyCards));
  const spots = mySpots(s);
  for (const g of d.give.groups ?? []) {
    out.push(`<label class="deal-row">${esc(cardName(s, g.group))} goes onto <select data-ans-place="${d.id}|${g.group}">${spots.map((o) => `<option value="${o.key}" ${a.place[g.group] === o.key ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`);
    if (!g.payWith) out.push(`<label class="deal-row">Its handover costs an Action token, paid by <select data-ans-pay="${d.id}|${g.group}">${myPayers(s).map((x) => `<option value="${x}" ${a.pay[g.group] === x ? 'selected' : ''}>${esc(cardName(s, x))}</option>`).join('')}</select></label>`);
  }
  for (const g of (d.get.groups ?? []).filter((x) => !x.payWith)) {
    const payers = [g.group, s.cards[g.group]?.master, me.illuminati].filter((x): x is string => !!x && s.cards[x]?.tokens > 0);
    out.push(`<label class="deal-row">Handing over ${esc(cardName(s, g.group))} costs an Action token, paid by <select data-ans-pay="${d.id}|${g.group}">${payers.map((x) => `<option value="${x}" ${a.pay[g.group] === x ? 'selected' : ''}>${esc(cardName(s, x))}</option>`).join('')}</select></label>`);
  }
  if (myLie(s) && !sideEmpty(d.get)) out.push(`<label class="toggle"><input type="checkbox" data-ans-lie="${d.id}" ${a.lie ? 'checked' : ''}> Play I Lied as you accept: you get their side and keep yours (others may cancel it)</label>`);
  return out.join('');
}

function renderDeals(s: GameState): string {
  const err = ui.error ? `<div class="error" role="alert">${esc(ui.error)}</div>` : '';
  const incoming = offersTo(s, ui.me);
  const mine = offersFrom(s, ui.me);
  const offerBox = (d: Deal) => `<div class="deal">
      <p><b>From ${esc(player(s, d.from).name)}:</b> ${esc(dealText(s, d, ui.me))}.</p>
      ${answerForm(s, d)}
      <div class="btns"><button class="primary" data-deal-accept="${d.id}">Accept</button><button data-deal-decline="${d.id}">Decline</button><button data-deal-counter="${d.id}">Counter</button></div></div>`;
  const myBox = (d: Deal) => `<div class="deal"><p><b>To ${esc(player(s, d.to).name)}:</b> ${esc(dealText(s, d, ui.me))}.${d.lie ? ' You will play I Lied if it is accepted.' : ''}</p>
      <div class="btns"><button data-deal-cancel="${d.id}">Withdraw</button></div></div>`;
  return `<div class="panel deals">${err}
    <h2>Deals</h2>
    <p class="small muted">Trades and gifts take effect the moment both players agree, and cannot be undone. A promise about later is only words: nobody has to keep it. Offers are seen only by the two players and lapse at the end of the turn. You can hand over cards from your hand whenever you like, but not during a draw or a choice, nor while a Plot waits to take effect. Groups and Resources in play change hands only in the main phase of one of the two players; handing over a Group costs one Action token.</p>
    ${incoming.length ? `<h3>Offers to you</h3>${incoming.map(offerBox).join('')}` : ''}
    ${mine.length ? `<h3>Your offers</h3>${mine.map(myBox).join('')}` : ''}
    ${ui.draft ? draftForm(s, ui.draft) : `<div class="btns"><button class="primary" data-act="deal-new" ${rivalsLive(s).length ? '' : 'disabled'}>Make an offer</button></div>`}
  </div>`;
}

function draftForm(s: GameState, d: DealDraft): string {
  const me = player(s, ui.me);
  const them = s.players.find((p) => p.id === d.to);
  const pick = (attr: string, list: string[], on: string[]) => list.length
    ? `<div class="btns deal-picks">${list.map((c) => `<button class="${on.includes(c) ? 'on' : ''}" data-${attr}="${c}">${esc(cardLabel(s, c))}</button>`).join('')}</div>` : '<p class="muted small">Nothing.</p>';
  const myCards = [...me.hand.filter((c) => s.cards[c].cardId !== I_LIED || !d.lie), ...resourcesOf(s, ui.me).filter((r) => !s.cards[r].hiddenUnder), ...structureCards(s, ui.me).filter((g) => def(s, g).type === 'Group')];
  const theirCards = them ? [
    ...them.hand.filter((c) => s.cards[c].exposed || me.known?.includes(c)),
    ...resourcesOf(s, them.id).filter((r) => !s.cards[r].hiddenUnder),
    ...structureCards(s, them.id).filter((g) => def(s, g).type === 'Group'),
  ].filter((c) => s.cards[c] && !s.cards[c].cardId.startsWith('hidden')) : [];
  const spots = mySpots(s);
  const pays = d.give.filter((g) => s.cards[g]?.zone === 'structure').map((g) => {
    const payers = [g, s.cards[g].master, me.illuminati].filter((x): x is string => !!x && s.cards[x]?.tokens > 0);
    return `<label class="deal-row">Pay for handing over ${esc(cardName(s, g))} with <select data-dpay="${g}"><option value="">(leave it to them)</option>${payers.map((x) => `<option value="${x}" ${d.pay[g] === x ? 'selected' : ''}>${esc(cardName(s, x))}</option>`).join('')}</select></label>`;
  }).join('');
  const places = d.get.filter((g) => s.cards[g]?.zone === 'structure').map((g) => `<label class="deal-row">${esc(cardName(s, g))} would go onto <select data-dplace="${g}">${spots.map((o) => `<option value="${o.key}" ${(d.place[g] ?? spots[0]?.key) === o.key ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`).join('');
  const num = (id: string, v: number) => `<select id="${id}">${[0, 1, 2, 3].map((n) => `<option ${n === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  return `<h3>${d.counterOf ? 'Your counter-offer' : 'Make an offer'}</h3>
    <label class="deal-row">To <select id="deal-to" ${d.counterOf ? 'disabled' : ''}>${rivalsLive(s).map((p) => `<option value="${p.id}" ${p.id === d.to ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <h4>You give</h4>${pick('dgive', myCards, d.give)}${pays}
    <h4>You ask for</h4>
    <p class="small muted">Their hidden cards are secret: ask for exposed cards and things in play by name, or for cards of their choice.</p>
    ${pick('dget', theirCards, d.get)}${places}
    <label class="deal-row">Plots of their choice ${num('deal-anyplots', d.anyPlots)}</label>
    <label class="deal-row">Group or Resource cards of their choice ${num('deal-anycards', d.anyCards)}</label>
    <label class="deal-row">Promise (optional, not binding) <input id="deal-note" maxlength="${MAX_NOTE}" value="${esc(d.note)}" placeholder="e.g. I will not attack you next turn"></label>
    ${myLie(s) ? `<label class="toggle"><input type="checkbox" id="deal-lie" ${d.lie ? 'checked' : ''}> Play I Lied if they accept: they hand over their side, you keep yours (they will not see this coming; others may cancel it)</label>` : ''}
    <div class="btns"><button class="primary" data-act="deal-send">${!d.get.length && !d.anyPlots && !d.anyCards ? 'Send as a gift' : 'Send offer'}</button><button class="linkish" data-act="deal-drop">Cancel</button></div>`;
}

function bindDeals(s: GameState) {
  const d = ui.draft;
  const keepNote = () => { if (ui.draft) ui.draft.note = app.querySelector<HTMLInputElement>('#deal-note')?.value ?? ui.draft.note; };
  const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  app.querySelectorAll<HTMLElement>('[data-dgive]').forEach((b) => b.onclick = () => { if (!d) return; keepNote(); d.give = toggle(d.give, b.dataset.dgive!); render(); });
  app.querySelectorAll<HTMLElement>('[data-dget]').forEach((b) => b.onclick = () => { if (!d) return; keepNote(); d.get = toggle(d.get, b.dataset.dget!); render(); });
  app.querySelectorAll<HTMLSelectElement>('[data-dpay]').forEach((el) => el.onchange = () => { if (d) d.pay[el.dataset.dpay!] = el.value; });
  app.querySelectorAll<HTMLSelectElement>('[data-dplace]').forEach((el) => el.onchange = () => { if (d) d.place[el.dataset.dplace!] = el.value; });
  const to = app.querySelector<HTMLSelectElement>('#deal-to');
  if (to && d) to.onchange = () => { keepNote(); ui.draft = { ...newDraft(s, to.value), give: d.give, pay: d.pay, note: d.note }; render(); };
  const ap = app.querySelector<HTMLSelectElement>('#deal-anyplots');
  if (ap && d) ap.onchange = () => { keepNote(); d.anyPlots = Number(ap.value); render(); };
  const ac = app.querySelector<HTMLSelectElement>('#deal-anycards');
  if (ac && d) ac.onchange = () => { keepNote(); d.anyCards = Number(ac.value); render(); };
  const lie = app.querySelector<HTMLInputElement>('#deal-lie');
  if (lie && d) lie.onchange = () => { keepNote(); d.lie = lie.checked; d.give = d.give.filter((c) => s.cards[c]?.cardId !== I_LIED); render(); };
  const deal = (id: string) => (s.deals ?? []).find((x) => x.id === id);
  app.querySelectorAll<HTMLElement>('[data-ans-pick]').forEach((b) => b.onclick = () => {
    const [id, c] = b.dataset.ansPick!.split('|');
    const a = answerFor(id);
    a.choose = toggle(a.choose, c);
    render();
  });
  app.querySelectorAll<HTMLSelectElement>('[data-ans-place]').forEach((el) => el.onchange = () => { const [id, g] = el.dataset.ansPlace!.split('|'); answerFor(id).place[g] = el.value; });
  app.querySelectorAll<HTMLSelectElement>('[data-ans-pay]').forEach((el) => {
    const [id, g] = el.dataset.ansPay!.split('|');
    if (!answerFor(id).pay[g]) answerFor(id).pay[g] = el.value; // the first choice shown is the default
    el.onchange = () => { answerFor(id).pay[g] = el.value; };
  });
  app.querySelectorAll<HTMLInputElement>('[data-ans-lie]').forEach((el) => el.onchange = () => { answerFor(el.dataset.ansLie!).lie = el.checked; });
  app.querySelectorAll<HTMLElement>('[data-deal-accept]').forEach((b) => b.onclick = () => { const x = deal(b.dataset.dealAccept!); if (x) acceptDeal(s, x); });
  app.querySelectorAll<HTMLElement>('[data-deal-decline]').forEach((b) => b.onclick = () => act({ type: 'respondDeal', deal: b.dataset.dealDecline!, accept: false }));
  app.querySelectorAll<HTMLElement>('[data-deal-cancel]').forEach((b) => b.onclick = () => act({ type: 'cancelDeal', deal: b.dataset.dealCancel! }));
  app.querySelectorAll<HTMLElement>('[data-deal-counter]').forEach((b) => b.onclick = () => { const x = deal(b.dataset.dealCounter!); if (x) { ui.draft = counterDraft(s, x); ui.showDeals = true; render(); } });
}

/** A rival's exposed Plots, a player's full discard pile, or a player's destroyed pile: all public
 * information (R012, R048; exposed Plots per R048's "Hidden and Exposed Plots"), browsable card by
 * card rather than just the top or a count. */
function renderBrowse(s: GameState): string {
  const b = ui.browse;
  if (!b || !s.cards) return '';
  const p = player(s, b.player);
  const cards = b.kind === 'discard' ? p.discard : Object.values(s.cards).filter((c) => c.owner === b.player && c.zone === 'destroyed').map((c) => c.iid);
  const title = b.kind === 'discard' ? `${b.player === ui.me ? 'Your' : `${esc(p.name)}'s`} discard pile` : `${b.player === ui.me ? 'Your' : `${esc(p.name)}'s`} destroyed pile`;
  return `<div class="panel inspect popover browse">
    <button class="close" data-act="closeBrowse" aria-label="Close">×</button>
    <div class="label">${title} (${cards.length})</div>
    <div class="opts">${cards.length ? [...cards].reverse().map((iid) => `<button data-inspect="${iid}">${esc(cardName(s, iid))}</button>`).join('') : '<p class="muted small">Empty.</p>'}</div>
  </div>`;
}

/** A rival's exposed Plots, held in hand but face up: public information (R048). */
function exposedPlotsOf(s: GameState, pl: string): string[] {
  return player(s, pl).hand.filter((h) => def(s, h).type === 'Plot' && s.cards[h].exposed);
}

function renderLog(s: GameState): string {
  // Private lines (what a player saw with a card) are shown only to that player.
  const lines = s.log.filter((l) => (!l.to || l.to === ui.me) && (!l.info || tutorial())).slice(-120).reverse();
  // The human player is called "You", so fix the verb: "You leads" -> "You lead".
  const you = (t: string) => t.replace(/(^|\s)You (has|\w+?)s\b/g, (_m, pre, v) => `${pre}You ${v === 'has' ? 'have' : v}`);
  return `<div class="panel log"><div class="label">Log</div><ol>${lines.map((l) => `<li class="${l.player === ui.me ? 'me' : l.player ? 'them' : ''} ${l.text.startsWith('—') ? 'turnline' : ''}">${esc(you(l.text))}</li>`).join('')}</ol></div>`;
}

function renderStart() {
  if (online) { renderOnline(); return; }
  const saves = Object.values(loadSaves()).sort((a, b) => b.updated - a.updated);
  const pick = (ui as Ui & { pick?: string }).pick ?? 'bavarian-illuminati';
  const quick = (ui as Ui & { quick?: boolean }).quick ?? false;
  const agreed = (ui as Ui & { goal?: number }).goal;
  app.innerHTML = `
    <div class="start">
      <header class="hero">
        <h1>Elitists War</h1>
        <p>Build a secret Power Structure, take over the world's Groups one arrow at a time, and stop your rival doing the same.</p>
        <button class="rb-home-btn" data-rulebook="">Read the rulebook</button><button class="rb-home-btn cl-home-btn" data-cards="">Browse the cards</button>
      </header>
      ${saves.length ? `<section><div class="label">Continue a game</div><div class="saves">${saves.map((sv) => `
        <div class="save"><button data-load="${sv.id}"><b>${esc(sv.summary)}</b><span class="muted">${new Date(sv.updated).toLocaleString()}</span></button>
        <button class="linkish" data-del="${sv.id}" aria-label="Delete saved game">Delete</button></div>`).join('')}</div></section>` : ''}
      <section>
        <div class="label">New game against the computer — choose your Illuminati</div>
        <div class="ills">${ILLUMINATI.map((c) => `
          <button class="ill-pick ${pick === c.id ? 'on' : ''}" data-pick="${c.id}">
            <b>${esc(c.name)}</b><span class="pw">${c.power}/${c.globalPower}</span>
            <span class="small">${esc(illPickText(c.id, c.text))}</span>
          </button>`).join('')}</div>
        <div class="label">Computer players</div>
        ${botsEditor(1, 1)}
        <div class="row">
          ${goalInput('goal', 1 + Math.max(1, lineupSize(loadLineup())), agreed)}
          <label class="toggle"><input type="checkbox" id="quick" ${quick ? 'checked' : ''}> Quick game: first to 8 Groups (house rule; the official goal is ${goalFor(1 + Math.max(1, lineupSize(loadLineup())))})</label>
          <button class="primary" data-act="start">Start game</button>
        </div>
        <p class="muted small">Games are saved in this browser after every move, so you can stop and pick up later.</p>
      </section>
    </div>`;
  app.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => b.onclick = () => { (ui as Ui & { pick?: string }).pick = b.dataset.pick; renderStart(); });
  bindBots(renderStart);
  app.querySelector<HTMLInputElement>('#quick')!.onchange = (e) => { (ui as Ui & { quick?: boolean }).quick = (e.target as HTMLInputElement).checked; };
  bindGoalInput('goal');
  app.querySelector<HTMLElement>('[data-act="start"]')!.onclick = () => newGame(pick, (ui as Ui & { quick?: boolean }).quick ?? false, (ui as Ui & { goal?: number }).goal);
  app.querySelectorAll<HTMLElement>('[data-load]').forEach((b) => b.onclick = () => {
    const sv = loadSaves()[b.dataset.load!];
    if (sv) { ui.game = sv.state; ui.sel = { kind: 'none' }; ui.inspect = undefined; foldFinished(sv.state); render(); schedule(); }
  });
  app.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => b.onclick = () => { deleteSave(b.dataset.del!); renderStart(); });
}

// ------------------------------------------------------------------ interaction

function onTableCard(iid: string) {
  const s = ui.game!;
  ui.error = undefined;
  const before = JSON.stringify(ui.sel);
  const sel = ui.sel;
  if (sel.kind === 'attack') {
    const opt = attackOptions(s, ui.me, sel.attacker).find((o) => o.target === iid && o.type === sel.type);
    if (opt) { ui.sel = { kind: 'confirm', attacker: sel.attacker, target: iid, type: sel.type, side: opt.sides[0], plots: [] }; render(); return; }
  }
  if (sel.kind === 'link' && s.cards[iid].controller === ui.me) { act({ type: 'link', resource: sel.resource, to: iid }); return; }
  if (s.prompt?.player === ui.me && s.prompt.kind === 'placeCaptured' && (s.prompt.data as unknown as PlaceCapturedData).cards.includes(iid)) {
    ui.sel = { kind: 'rearrange', group: iid };
  }
  if (idle(s) && s.cards[iid].controller === ui.me && sel.kind !== 'move') {
    ui.sel = { kind: 'group', iid };
  }
  // A tap that does nothing else shows the card's details.
  ui.inspect = JSON.stringify(ui.sel) === before ? iid : undefined;
  render();
}

function onHandCard(iid: string) {
  const s = ui.game!;
  ui.error = undefined;
  const before = JSON.stringify(ui.sel);
  ui.inspect = undefined;
  const d = def(s, iid);
  const sel = ui.sel;
  if (s.prompt?.player === ui.me && s.prompt.kind === 'discardToLimit') {
    if (!plotsInHand(s, ui.me).includes(iid)) return render();
    const cards = sel.kind === 'discard' ? sel.cards : [];
    ui.sel = { kind: 'discard', cards: cards.includes(iid) ? cards.filter((c) => c !== iid) : [...cards, iid] };
  } else if (sel.kind === 'discard') {
    // Voluntary tidy-your-hand mode (R048): any card can be selected to discard or expose; only
    // Plots can be selected to return to the deck.
    ui.sel = { kind: 'discard', cards: sel.cards.includes(iid) ? sel.cards.filter((c) => c !== iid) : [...sel.cards, iid] };
  } else if (s.prompt?.player === ui.me && s.prompt.kind === 'takeover' && d.type === 'Resource') {
    if (canEnterPlay(s, iid, ui.me)) { act({ type: 'takeover', card: iid, onto: player(s, ui.me).illuminati, side: 'TOP' }); return; }
  } else if (s.prompt?.player === ui.me && s.prompt.kind === 'takeover' && d.type === 'Group') {
    ui.sel = { kind: 'takeover', card: iid };
  } else if (d.type === 'Resource' && idle(s)) {
    ui.sel = { kind: 'resource', iid };
  } else if (sel.kind === 'attack' && sel.type === 'control' && attackOptions(s, ui.me, sel.attacker).some((o) => o.target === iid)) {
    ui.sel = { kind: 'confirm', attacker: sel.attacker, target: iid, type: 'control', side: openArrows(s, sel.attacker)[0], plots: [] };
  } else if (d.type === 'Plot' && (idle(s) || (s.window && waitingFor(s).includes(ui.me)))) {
    ui.sel = idle(s) ? { kind: 'plot', card: iid } : ui.sel;
  }
  if (JSON.stringify(ui.sel) === before) ui.inspect = iid;
  render();
}

function bind() {
  const s = ui.game!;
  app.querySelectorAll<HTMLElement>('[data-card]').forEach((b) => b.onclick = () => onTableCard(b.dataset.card!));
  app.querySelectorAll<HTMLElement>('[data-hand]').forEach((b) => b.onclick = () => onHandCard(b.dataset.hand!));
  app.querySelectorAll<HTMLElement>('[data-inspect]').forEach((b) => b.onclick = () => { ui.inspect = b.dataset.inspect; render(); });
  app.querySelectorAll<HTMLElement>('[data-browse]').forEach((b) => b.onclick = () => {
    const [kind, pl] = b.dataset.browse!.split(':') as ['discard' | 'destroyed', string];
    ui.browse = { kind, player: pl };
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) => b.onclick = () => {
    const choices = b.dataset.slot!.split('|');
    if (choices.length > 1) { ui.slotChoice = choices; render(); return; }
    placeAt(choices[0]);
  });
  app.querySelectorAll<HTMLElement>('[data-slotpick]').forEach((b) => b.onclick = () => { const c = b.dataset.slotpick!; ui.slotChoice = undefined; placeAt(c); });
  app.querySelectorAll<HTMLElement>('[data-payer]').forEach((b) => b.onclick = () => { if (ui.sel.kind === 'move') { ui.sel = { ...ui.sel, payWith: b.dataset.payer }; render(); } });
  function placeAt(choice: string) {
    const [onto, side] = choice.split(':') as [string, Side];
    const sel = ui.sel;
    if (sel.kind === 'takeover') act({ type: 'takeover', card: sel.card, onto, side });
    else if (sel.kind === 'rearrange') act({ type: 'placeCaptured', group: sel.group, onto, side });
    else if (sel.kind === 'move') {
      const g = s.cards[sel.group];
      const free = s.turnFlags.freeMoves === ui.me;
      const payWith = sel.payWith ?? [sel.group, g.master!, onto, player(s, ui.me).illuminati].find((x) => s.cards[x]?.tokens > 0);
      if (!free && !payWith) { ui.error = 'Moving needs a token from the Group, its old or new master, or your Illuminati.'; render(); return; }
      act({ type: 'move', group: sel.group, onto, side, payWith: free ? undefined : payWith });
    } else if (sel.kind === 'confirm') { ui.sel = { ...sel, side }; render(); }
  }
  app.querySelectorAll<HTMLElement>('[data-claim]').forEach((b) => b.onclick = () => {
    act({ type: 'declareVictory', goal: b.dataset.claim! });
  });
  app.querySelectorAll<HTMLElement>('[data-opt]').forEach((b) => b.onclick = () => {
    const o = (window as unknown as { __opts: { action: Action }[] }).__opts[Number(b.dataset.opt)];
    act(o.action);
  });
  app.querySelectorAll<HTMLElement>('[data-popt]').forEach((b) => b.onclick = () => {
    const o = (window as unknown as { __popts: { action: Action }[] }).__popts[Number(b.dataset.popt)];
    act(o.action);
  });
  app.querySelectorAll<HTMLElement>('[data-decl]').forEach((b) => b.onclick = () => {
    const sel = ui.sel;
    if (sel.kind !== 'confirm') return;
    const decl = { type: 'attack' as const, attackType: sel.type, attacker: sel.attacker, target: sel.target };
    const all = plotsInHand(s, ui.me).flatMap((c) => plotOptions(s, ui.me, c, decl).map((o) => ({ c, o })));
    const pick = all[Number(b.dataset.decl)];
    const play = (pick.o.action as Extract<Action, { type: 'playPlot' }>).play;
    ui.sel = { ...sel, plots: sel.plots.some((p) => p.card === pick.c) ? sel.plots.filter((p) => p.card !== pick.c) : [...sel.plots.filter((p) => p.card !== pick.c), play] };
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-res]').forEach((b) => b.onclick = () => {
    const r = b.dataset.res!;
    ui.inspect = r;
    if (s.cards[r].controller === ui.me && (idle(s) || (s.window && waitingFor(s).includes(ui.me)))) ui.sel = { kind: 'resource', iid: r };
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-abil]').forEach((b) => b.onclick = () => {
    const o = (window as unknown as { __abil: { action: Action }[] }).__abil[Number(b.dataset.abil)];
    act(o.action);
  });
  app.querySelectorAll<HTMLElement>('[data-pick-opt]').forEach((b) => b.onclick = () => {
    const ch = s.prompt?.choice;
    if (!ch) return;
    const id = b.dataset.pickOpt!;
    if (ch.max === 1 && ch.min === 1) { ui.picked = undefined; act({ type: 'choose', ids: [id] }); return; }
    const cur = ui.picked ?? [];
    ui.picked = cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < ch.max ? [...cur, id] : cur;
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-rules]').forEach((b) => b.onclick = () => {
    ui.showRules = b.dataset.rules || undefined;
    render();
    if (ui.showRules) app.querySelector(`#rule-${ui.showRules}`)?.scrollIntoView({ block: 'start' });
  });
  rulesSpy();
  app.querySelectorAll<HTMLElement>('[data-handjump]').forEach((b) => b.onclick = () => {
    if (ui.handMin) { ui.handMin = false; render(); }
    app.querySelector<HTMLElement>(`.hand-sec.${b.dataset.handjump}`)?.scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'smooth' });
  });
  app.querySelectorAll<HTMLElement>('[data-style-backs]').forEach((b) => b.onclick = () => { saveBacks(b.dataset.styleBacks!); render(); });
  app.querySelectorAll<HTMLElement>('[data-deck]').forEach((b) => b.onclick = () => onDeck(b.dataset.deck as 'plot' | 'group'));
  app.querySelectorAll<HTMLElement>('[data-info]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); ui.info = ui.info === b.dataset.info ? undefined : b.dataset.info; render(); });
  app.querySelectorAll<HTMLElement>('[data-lead]').forEach((b) => b.onclick = () => act({ type: 'chooseLead', card: b.dataset.lead!, side: ui.leadSide ?? 'BOTTOM' }));
  app.querySelectorAll<HTMLElement>('[data-lead-side]').forEach((b) => b.onclick = () => { ui.leadSide = b.dataset.leadSide as Side; render(); });
  app.querySelectorAll<HTMLElement>('[data-rearrange]').forEach((b) => b.onclick = () => { ui.sel = { kind: 'rearrange', group: b.dataset.rearrange! }; render(); });
  app.querySelectorAll<HTMLElement>('[data-show-to]').forEach((b) => b.onclick = () => {
    if (ui.sel.kind === 'discard' && ui.sel.cards.length === 1) act({ type: 'showCard', card: ui.sel.cards[0], to: b.dataset.showTo! });
  });
  app.querySelectorAll<HTMLElement>('[data-agent]').forEach((b) => b.onclick = () => act({ type: 'playAgent', card: b.dataset.agent! }));
  app.querySelectorAll<HTMLElement>('[data-relief-partner]').forEach((b) => b.onclick = () => {
    if (!ui.reliefPick) return;
    const x = b.dataset.reliefPartner!;
    const cur = ui.reliefPick.partners;
    ui.reliefPick = { ...ui.reliefPick, partners: cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x] };
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-pledge-open]').forEach((b) => b.onclick = () => {
    const place = b.dataset.pledgeOpen!;
    ui.pledgePick = { place, groups: s.reliefPledges?.find((x) => x.player === ui.me && x.place === place)?.groups ?? [] };
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-pledge-toggle]').forEach((b) => b.onclick = () => {
    if (!ui.pledgePick) return;
    const g = b.dataset.pledgeToggle!;
    const cur = ui.pledgePick.groups;
    ui.pledgePick = { ...ui.pledgePick, groups: cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g] };
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-pledge-withdraw]').forEach((b) => b.onclick = () => act({ type: 'pledgeRelief', place: b.dataset.pledgeWithdraw!, payWith: [] }));
  app.querySelectorAll<HTMLElement>('[data-relief]').forEach((b) => b.onclick = () => {
    const r = (window as unknown as { __relief: { place: string; pay: string[] }[] }).__relief[Number(b.dataset.relief)];
    act({ type: 'relief', place: r.place, payWith: r.pay });
  });
  const priv = app.querySelector<HTMLInputElement>('#priv');
  if (priv) priv.onchange = () => { if (ui.sel.kind === 'confirm') { ui.sel = { ...ui.sel, privileged: priv.checked }; render(); } };
  if (online) bindOrders();
  bindDeals(s);
  const auto = app.querySelector<HTMLInputElement>('#autopass');
  if (auto) auto.onchange = () => { ui.autoPass = auto.checked; };
  app.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.onclick = () => {
    const sel = ui.sel;
    switch (b.dataset.act) {
      case 'home': clearTimeout(timer); ui.game = null; ui.view = undefined; ui.inspect = undefined; ui.showLog = false; if (online) { online.gameId = undefined; online.channel?.unsubscribe(); loadGames(); } render(); break;
      case 'clear': ui.sel = { kind: 'none' }; ui.error = undefined; render(); break;
      case 'sheet': ui.sheetMin = !ui.sheetMin; render(); break;
      case 'dice': if (ui.dice) ui.dice.start = 0; render(); schedule(); break;
      case 'hand': ui.handMin = !ui.handMin; render(); break;
      case 'log': ui.showLog = !ui.showLog; render(); break;
      case 'deals': ui.showDeals = !ui.showDeals; ui.error = undefined; render(); break;
      case 'deal-new': ui.draft = newDraft(s); render(); break;
      case 'deal-send': sendDraft(s); break;
      case 'deal-drop': ui.draft = undefined; render(); break;
      case 'style': ui.showStyle = !ui.showStyle; render(); break;
      case 'closeInspect': ui.inspect = undefined; render(); break;
      case 'closeBrowse': ui.browse = undefined; render(); break;
      case 'guide':
        ui.help = HELP_MODES[(HELP_MODES.indexOf(ui.help) + 1) % HELP_MODES.length];
        ui.guide = ui.help !== 'off';
        try { localStorage.setItem('elitists-war.help', ui.help); } catch { /* storage unavailable */ }
        // Tutorial and Guided remind you when you could declare victory; with help off you are on your own.
        if (ui.game && !online) { ui.game.settings.victoryReminder = ui.help !== 'off'; saveGame(ui.game); }
        render(); break;
      case 'clearSlot': ui.slotChoice = undefined; render(); break;
      case 'skipTakeover': act({ type: 'skipTakeover' }); break;
      case 'pass': if (!remindFirst(s)) act({ type: 'pass' }); break;
      case 'endTurn': if (!remindFirst(s)) act({ type: 'endTurn' }); break;
      case 'discard': if (sel.kind === 'discard') act({ type: 'discard', cards: sel.cards }); break;
      case 'return': if (sel.kind === 'discard') act({ type: 'discard', cards: sel.cards, toDeck: true }); break;
      case 'callOff': act({ type: 'callOff' }); break;
      case 'choose': { const ids = ui.picked ?? []; ui.picked = undefined; act({ type: 'choose', ids }); break; }
      case 'drawGroup': ui.sel = { kind: 'none' }; act({ type: 'drawGroup' }); break;
      case 'draw-plot': act({ type: 'draw', deck: 'plot' }); break;
      case 'draw-group': act({ type: 'draw', deck: 'group' }); break;
      case 'skipDraw': act({ type: 'skipDraw' }); break;
      case 'playResource': if (sel.kind === 'resource') act({ type: 'playResource', card: sel.iid }); break;
      case 'linkStart': if (sel.kind === 'resource') { ui.sel = { kind: 'link', resource: sel.iid }; render(); } break;
      case 'buy-ill': act({ type: 'buyPlot', payWith: [player(s, ui.me).illuminati] }); break;
      case 'buy-open': {
        // Choose which 2 Groups pay: default to the weakest two, but the player may change it.
        const ill = player(s, ui.me).illuminati;
        const payers = structureCards(s, ui.me).filter((g) => g !== ill && s.cards[g].tokens > 0).sort((a, c) => power(s, a) - power(s, c));
        ui.buyPick = payers.slice(0, 2);
        render(); break;
      }
      case 'buy-toggle': {
        const g = b.dataset.buyToggle!;
        const cur = ui.buyPick ?? [];
        ui.buyPick = cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g];
        render(); break;
      }
      case 'buy-confirm': if (ui.buyPick?.length === 2) { const pay = ui.buyPick; ui.buyPick = undefined; act({ type: 'buyPlot', payWith: pay }); } break;
      case 'buy-cancel': ui.buyPick = undefined; render(); break;
      case 'relief-open': {
        const place = b.dataset.reliefOpen!;
        // Other players' pledges count first; your strongest Groups make up the rest.
        const pledges = reliefPledgesFor(s, place, ui.me);
        const need = 3 * (def(s, place).power ?? 0) - pledges.reduce((n, x) => n + x.power, 0);
        const pool = structureCards(s, ui.me).filter((g) => s.cards[g].tokens > 0 && !tokenBarred(s, g)).sort((a, c) => power(s, c) - power(s, a));
        const groups: string[] = []; let tot = 0;
        for (const g of pool) { if (tot >= need) break; groups.push(g); tot += power(s, g); }
        ui.reliefPick = { place, groups, partners: pledges.map((x) => x.player) };
        ui.pledgePick = undefined;
        render(); break;
      }
      case 'pledge-confirm': if (ui.pledgePick) { const pk = ui.pledgePick; ui.pledgePick = undefined; act({ type: 'pledgeRelief', place: pk.place, payWith: pk.groups }); } break;
      case 'pledge-cancel': ui.pledgePick = undefined; render(); break;
      case 'placeDone': act({ type: 'placeCapturedDone' }); break;
      case 'dropToken': if (sel.kind === 'group') act({ type: 'removeToken', card: sel.iid }); break;
      case 'resign': {
        if (!confirm('Leave this game? At a real table this counts as being eliminated: your hand, decks, Resources and Power Structure leave play, and you cannot come back.')) break;
        if (online) { act({ type: 'resign' }); break; }
        act({ type: 'resign' });
        // Offline, the computers would only play on among themselves: the game is put away.
        clearTimeout(timer); deleteSave(s.id); ui.game = null; ui.view = undefined; ui.inspect = undefined; render();
        break;
      }
      case 'relief-toggle': {
        const g = b.dataset.reliefToggle!;
        if (!ui.reliefPick) break;
        const cur = ui.reliefPick.groups;
        ui.reliefPick = { ...ui.reliefPick, groups: cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g] };
        render(); break;
      }
      case 'relief-confirm': if (ui.reliefPick) { const r = ui.reliefPick; ui.reliefPick = undefined; act({ type: 'relief', place: r.place, payWith: r.groups, ...(r.partners.length ? { partners: r.partners } : {}) }); } break;
      case 'relief-cancel': ui.reliefPick = undefined; render(); break;
      case 'tidy': ui.sel = { kind: 'discard', cards: [] }; render(); break;
      case 'voluntary-discard': if (sel.kind === 'discard' && sel.cards.length) act({ type: 'discard', cards: sel.cards }); break;
      case 'voluntary-return-top': if (sel.kind === 'discard' && sel.cards.length) act({ type: 'discard', cards: sel.cards, toDeck: true, position: 'top' }); break;
      case 'voluntary-return-middle': if (sel.kind === 'discard' && sel.cards.length) act({ type: 'discard', cards: sel.cards, toDeck: true, position: 'middle' }); break;
      case 'voluntary-return-bottom': if (sel.kind === 'discard' && sel.cards.length) act({ type: 'discard', cards: sel.cards, toDeck: true, position: 'bottom' }); break;
      case 'voluntary-expose': if (sel.kind === 'discard' && sel.cards.length === 1) act({ type: 'exposeCard', card: sel.cards[0] }); break;
      case 'atk-control': if (sel.kind === 'group') { ui.sel = { kind: 'attack', attacker: sel.iid, type: 'control' }; render(); } break;
      case 'atk-destroy': if (sel.kind === 'group') { ui.sel = { kind: 'attack', attacker: sel.iid, type: 'destroy' }; render(); } break;
      case 'move': if (sel.kind === 'group') { ui.sel = { kind: 'move', group: sel.iid }; render(); } break;
      case 'declare':
        if (sel.kind === 'confirm') act({ type: 'attack', attackType: sel.type, attacker: sel.attacker, target: sel.target, side: sel.side, plots: sel.plots, privileged: sel.privileged || undefined });
        break;
    }
  });
}

// ------------------------------------------------------------------ boot

function start(data: { game?: GameState | null }) {
  if (__ONLINE__) { startOnline(); return; }
  if (data?.game) ui.game = data.game;
  render();
  schedule();
}

// ------------------------------------------------------------------ online play (Supabase)

declare const __ONLINE__: boolean;
declare const __SB_URL__: string;
declare const __SB_KEY__: string;

interface GameSummary { id: string; invite: string; seats: { id: string; name: string; isAI: boolean; joined: boolean }[]; me?: string; host?: boolean; started: boolean; finished: boolean; yourMove: boolean; offers?: number; progress: string; illuminati?: string; updatedAt: number }
interface Online {
  client: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  userId?: string;
  name: string;
  games: GameSummary[];
  gameId?: string;
  summary?: GameSummary;
  orders?: { passWhenNothing: boolean; passWhenUninvolved: boolean };
  channel?: { unsubscribe(): void };
  busy: boolean;
  msg?: string;
  alerts?: { available: boolean; phone: string; optIn: boolean; msg?: string };
  /** Your mirror, as the server knows it; `profileFor` is the finished game it was last read after. */
  profile?: ProfileSummary;
  profileFor?: string;
}
let online: Online | null = null;

async function api(body: Record<string, unknown>) {
  const { data, error } = await online!.client.functions.invoke('ew-game', { body: { name: online!.name, ...body } });
  if (error) {
    let msg = error.message as string;
    try { msg = (await error.context.json()).error ?? msg; } catch { /* keep generic message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function applyReply(r: { game: GameSummary; state: GameState | null; orders?: Online['orders'] }) {
  online!.summary = r.game;
  online!.gameId = r.game.id;
  online!.orders = r.orders ?? { passWhenNothing: true, passWhenUninvolved: false };
  ui.game = r.state;
  if (r.game.me) ui.me = r.game.me;
  // The server adds a finished game to your profile: read it again to show the new count.
  if (r.state?.phase === 'gameOver' && online!.profileFor !== r.game.id) { online!.profileFor = r.game.id; void loadProfileSummary(); }
}

async function loadProfileSummary() {
  try { online!.profile = (await api({ op: 'profile' })).profile; render(); } catch { /* the mirror is optional */ }
}

async function onlineMove(a: Action) {
  online!.busy = true; ui.error = undefined; render();
  try { applyReply(await api({ op: 'move', gameId: online!.gameId, action: a })); ui.sel = { kind: 'none' }; if (a.type === 'offerDeal') ui.draft = undefined; }
  catch (e) { ui.error = (e as Error).message; if (/moved first/.test(ui.error)) await refreshGame(); }
  online!.busy = false; render();
}

async function refreshGame() {
  if (!online?.gameId) return;
  try { applyReply(await api({ op: 'view', gameId: online.gameId })); render(); } catch (e) { ui.error = (e as Error).message; render(); }
}

async function loadGames() {
  try { online!.games = (await api({ op: 'list' })).games; } catch (e) { online!.msg = (e as Error).message; }
  if (!online!.alerts) try { online!.alerts = await api({ op: 'alerts' }); } catch { /* alerts are optional */ }
  if (!online!.profile) try { online!.profile = (await api({ op: 'profile' })).profile; } catch { /* the mirror is optional */ }
  render();
}

async function openGame(id: string) {
  online!.gameId = id;
  online!.channel?.unsubscribe();
  online!.channel = online!.client.channel(`ew-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ew_game_pings', filter: `game_id=eq.${id}` }, () => refreshGame())
    .subscribe();
  ui.sel = { kind: 'none' }; ui.inspect = undefined;
  await refreshGame();
  if (!ui.game) render();
}

function startOnline() {
  const g = window as unknown as { supabase?: { createClient(u: string, k: string): unknown } };
  if (!g.supabase) {
    app.innerHTML = '<div class="start"><header class="hero"><h1>Elitists War</h1><p>The game could not connect. Check your internet connection and reload the page.</p></header></div>';
    return;
  }
  online = { client: g.supabase!.createClient(__SB_URL__, __SB_KEY__), name: 'Player', games: [], busy: false };
  // A failed Google sign-in comes back with the reason in the address: show it instead of a silent bounce.
  const back = new URLSearchParams(location.hash.slice(1) + '&' + location.search.slice(1));
  const why = back.get('error_description') ?? back.get('error');
  if (why) {
    online.msg = /exchange external code|invalid_client/i.test(why)
      ? 'Google sign-in is not set up correctly yet (the server could not confirm your Google login). Please tell the game\'s host.'
      : `Sign-in did not finish: ${why.replace(/\+/g, ' ')}`;
    history.replaceState(null, '', location.pathname);
  }
  online.client.auth.onAuthStateChange((_e: string, session: { user: { id: string; email: string; user_metadata?: { name?: string; full_name?: string } } } | null) => {
    online!.userId = session?.user.id;
    if (session) online!.name = (session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email.split('@')[0]).slice(0, 24);
    if (session) loadGames(); else render();
  });
  setInterval(() => { if (online?.gameId) refreshGame(); else if (online?.userId) loadGames(); }, 45_000);
  render();
}

function renderOnline() {
  const o = online!;
  const msg = o.msg ? `<div class="error" role="alert">${esc(o.msg)}</div>` : '';
  if (!o.userId) {
    app.innerHTML = `<div class="start"><header class="hero"><h1>Elitists War</h1><p>Play online with friends, a move at a time. Sign in so your games follow you to any device.</p><button class="rb-home-btn" data-rulebook="">Read the rulebook</button><button class="rb-home-btn cl-home-btn" data-cards="">Browse the cards</button></header>
      <section class="panel auth">${msg}
        <button class="google" id="a-google" ${o.busy ? 'disabled' : ''}>
          <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Sign in with Google</button>
      </section></div>`;
    app.querySelector<HTMLButtonElement>('#a-google')!.onclick = async () => {
      o.busy = true; o.msg = undefined; render();
      const { error } = await o.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
      if (error) { o.msg = error.message; o.busy = false; render(); } // on success the browser goes to Google
    };
    return;
  }
  // Waiting room for a game whose seats are not all filled.
  if (o.gameId && o.summary && !o.summary.started) {
    app.innerHTML = `<div class="start"><header class="bar"><button class="linkish" data-o="lobby">‹ Games</button><div class="brand">Elitists War</div></header>
      <section class="panel"><h2>Waiting for players</h2>
      <p>Send your friends this invite code. The game starts as soon as every seat is filled.</p>
      <div class="invite"><code id="code">${esc(o.summary.invite)}</code><button data-o="copy">Copy code</button></div>
      <ul class="seats">${o.summary.seats.map((x) => `<li>${esc(x.name || 'Open seat')} ${x.joined ? '✓' : '<span class="muted">(waiting)</span>'}</li>`).join('')}</ul>
      <div class="btns"><button class="danger" data-del="${o.summary.id}" data-host="${o.summary.host ? 1 : ''}">${o.summary.host ? 'Delete this game' : 'Leave this game'}</button></div></section></div>`;
    bindOnline();
    return;
  }
  const pick = (ui as Ui & { pick?: string }).pick ?? 'bavarian-illuminati';
  const friends = (ui as Ui & { friends?: number }).friends ?? 1;
  app.innerHTML = `<div class="start">
    <header class="bar"><div class="brand">Elitists War</div><button class="rb-bar-btn" data-rulebook="">Rulebook</button><button class="rb-bar-btn" data-cards="">Cards</button><div class="turn">${esc(o.name)} · <button class="linkish" data-o="signout">Sign out</button></div></header>
    ${msg}
    <section><div class="label">Your games</div><div class="saves">${o.games.map((g) => `
      <div class="save"><button data-open="${g.id}"><b>${g.yourMove ? '● Your move — ' : g.offers ? '● An offer for you — ' : ''}${esc(g.seats.map((x) => x.name || 'Open seat').join(' vs '))}</b>
      <span class="muted">${g.finished ? 'Finished' : g.started ? `${esc(g.illuminati ?? '')} · ${esc(g.progress)}` : `Waiting for players · invite ${esc(g.invite)}`}</span></button>${g.host || !g.finished ? `<button class="del" data-del="${g.id}" data-host="${g.host ? 1 : ''}" data-started="${g.started ? 1 : ''}" aria-label="${g.host ? 'Delete game' : 'Leave game'}">${g.host ? 'Delete' : 'Leave'}</button>` : ''}</div>`).join('') || '<p class="muted">No games yet.</p>'}</div></section>
    ${alertsPanel()}
    ${mirrorPanel()}
    <section class="panel"><h2>Join a friend's game</h2>
      <form id="join" class="row"><label>Invite code <input id="j-code" required maxlength="6" autocapitalize="characters"></label><button class="primary" type="submit">Join</button></form></section>
    <section><div class="label">Start a new game — choose your Illuminati</div>
      <div class="ills">${ILLUMINATI.map((c) => `<button class="ill-pick ${pick === c.id ? 'on' : ''}" data-pick="${c.id}"><b>${esc(c.name)}</b><span class="pw">${c.power}/${c.globalPower}</span><span class="small">${esc(illPickText(c.id, c.text))}</span></button>`).join('')}</div>
      <form id="new" class="panel"><div class="row">
        <label>Friends to invite <select id="n-friends">${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `<option ${n === friends ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div class="label">Computer players</div>
      ${friends >= 7 ? '<p class="muted small">The table is full: 8 players.</p>' : botsEditor(1 + friends, friends ? 0 : 1)}
      <div class="row">
        ${goalInput('n-goal', 1 + friends + Math.max(friends ? 0 : 1, lineupSize(loadLineup())), (ui as Ui & { goal?: number }).goal)}
        <label class="toggle"><input type="checkbox" id="n-quick"> Quick game (8 Groups, house rule)</label>
        <button class="primary" type="submit">Create game</button></div>
        <p class="muted small">With friends invited you get an invite code to send them. Everyone moves when they like; the game waits (up to 24 hours per response, 3 days per turn).</p></form>
    </section></div>`;
  bindOnline();
  app.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => b.onclick = () => { (ui as Ui & { pick?: string }).pick = b.dataset.pick; render(); });
  const af = app.querySelector<HTMLFormElement>('#alerts');
  if (af) af.onsubmit = async (e) => {
    e.preventDefault();
    const phone = (app.querySelector('#a-phone') as HTMLInputElement).value.trim();
    const optIn = (app.querySelector('#a-opt') as HTMLInputElement).checked;
    try { o.alerts = { ...(await api({ op: 'alerts', alerts: { phone, optIn } })), msg: optIn ? 'Text alerts are on.' : 'Text alerts are off.' }; }
    catch (err) { o.alerts = { ...o.alerts!, msg: (err as Error).message }; }
    render();
  };
  app.querySelector<HTMLFormElement>('#join')!.onsubmit = async (e) => {
    e.preventDefault();
    const code = (app.querySelector('#j-code') as HTMLInputElement).value.trim().toUpperCase();
    try { applyReply(await api({ op: 'join', code, illuminati: pick })); await openGame(online!.gameId!); } catch (err) { o.msg = (err as Error).message; render(); }
  };
  bindBots(render);
  bindGoalInput('n-goal');
  app.querySelector<HTMLSelectElement>('#n-friends')!.onchange = (e) => { (ui as Ui & { friends?: number }).friends = Number((e.target as HTMLSelectElement).value); render(); };
  app.querySelector<HTMLFormElement>('#new')!.onsubmit = async (e) => {
    e.preventDefault();
    const bots = friends >= 7 ? [] : botsForGame(Math.floor(Math.random() * 1e9), friends ? 0 : 1, 7 - friends);
    const quick = (app.querySelector('#n-quick') as HTMLInputElement).checked;
    const basicGoal = (ui as Ui & { goal?: number }).goal;
    try { applyReply(await api({ op: 'new', seats: 1 + friends + bots.length, computerSeats: bots.length, bots, quick, illuminati: pick, ...(basicGoal ? { basicGoal } : {}) })); await openGame(online!.gameId!); } catch (err) { o.msg = (err as Error).message; render(); }
  };
}

/** Your mirror: how many games it has learned from and its strongest habits. */
function mirrorPanel(): string {
  const p = online?.profile;
  if (!p) return '';
  return `<section class="panel"><h2>Your mirror</h2>
    <p>${p.ready ? `A computer player that plays like you, based on ${p.games} finished game${p.games === 1 ? '' : 's'}.` : `Finish ${p.minGames} games and the game makes a computer player that plays like you (${p.games} so far).`}</p>
    ${p.traits.length ? `<p class="muted small">Your habits so far: ${esc(p.traits.join('; '))}.</p>` : ''}
    <p class="muted small">Pick it in any difficulty below. Random seats can also draw the mirror of anyone at the table.</p></section>`;
}

/** Opt-in text alerts: only for a game starting, your turn, or an Attack to Destroy on you. */
function alertsPanel(): string {
  const a = online?.alerts;
  if (!a) return '';
  return `<section class="panel"><h2>Text alerts</h2>
    <form id="alerts" class="row">
      <label>Mobile number <input id="a-phone" type="tel" autocomplete="tel" placeholder="+1 555 123 4567" value="${esc(a.phone)}"></label>
      <label class="toggle"><input type="checkbox" id="a-opt" ${a.optIn ? 'checked' : ''}> Text me when a game starts, when my turn begins, or when one of my Groups faces an Attack to Destroy</label>
      <button type="submit">Save</button></form>
    <p class="muted small">At most one text every 5 minutes. Message and data rates may apply. Reply STOP to any text to opt out.${a.available ? '' : ' Texting is not switched on for this server yet, so no messages will be sent.'}</p>
    ${a.msg ? `<p class="small">${esc(a.msg)}</p>` : ''}</section>`;
}

function bindOnline() {
  const o = online!;
  app.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => b.onclick = async () => {
    const host = !!b.dataset.host;
    const started = !!b.dataset.started;
    if (!confirm(host ? 'Delete this game for every player? This cannot be undone.'
      : started ? 'Leave this game for good? It counts as being eliminated: your cards leave play and the others play on.'
      : 'Leave this game? Your seat opens up for someone else.')) return;
    try {
      await api({ op: 'delete', gameId: b.dataset.del });
      o.gameId = undefined; o.summary = undefined; o.channel?.unsubscribe(); ui.game = null;
      await loadGames();
    } catch (e) { o.msg = (e as Error).message; render(); }
  });
  app.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.onclick = () => openGame(b.dataset.open!));
  app.querySelectorAll<HTMLElement>('[data-o]').forEach((b) => b.onclick = async () => {
    const what = b.dataset.o;
    if (what === 'signout') { await o.client.auth.signOut(); o.games = []; o.alerts = undefined; o.profile = undefined; }
    if (what === 'lobby') { o.gameId = undefined; o.summary = undefined; o.channel?.unsubscribe(); await loadGames(); }
    if (what === 'copy') {
      try { await navigator.clipboard.writeText(o.summary!.invite); b.textContent = 'Copied'; } catch { window.getSelection()?.selectAllChildren(app.querySelector('#code')!); }
      return;
    }
    render();
  });
}

/** Standing orders shown during an online game. */
export function ordersPanel(): string {
  if (!online?.orders) return '';
  return `<div class="panel"><div class="label">Standing orders</div>
    <label class="toggle"><input type="checkbox" id="o-nothing" ${online.orders.passWhenNothing ? 'checked' : ''}> Pass for me when I have no possible response</label>
    <label class="toggle"><input type="checkbox" id="o-uninvolved" ${online.orders.passWhenUninvolved ? 'checked' : ''}> Pass for me on attacks that don't involve my Groups</label>
    ${online.summary ? `<p class="muted small">Invite code: <code>${esc(online.summary.invite)}</code></p>` : ''}</div>`;
}
function bindOrders() {
  for (const [id, key] of [['o-nothing', 'passWhenNothing'], ['o-uninvolved', 'passWhenUninvolved']] as const) {
    const el = app.querySelector<HTMLInputElement>(`#${id}`);
    if (el) el.onchange = async () => { try { applyReply(await api({ op: 'orders', gameId: online!.gameId, orders: { [key]: el.checked } })); } catch (e) { ui.error = (e as Error).message; } render(); };
  }
}
const hot = (window as unknown as { claude?: { hot?: { snapshot?: (fn: () => unknown) => void; ready?: (fn: (d: unknown) => void) => void; data?: unknown } } }).claude?.hot;
hot?.snapshot?.(() => ({ game: ui.game }));
if (hot?.ready) hot.ready((d) => start((d ?? {}) as { game?: GameState }));
else start((hot?.data ?? {}) as { game?: GameState });

void CARDS; void describePlay;
