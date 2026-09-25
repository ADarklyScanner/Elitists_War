// Elitists War — browser client for playing against the computer.
// All rules live in the engine; this file only draws the table and turns taps into actions.
import {
  type Action, type GameState, type PlotPlay, type Side,
  applyAction, attackOptions, attackStrength, cardName, CARDS, createGame, currentOutcome, def, finalRoll,
  goalCount, goalNeeded, hasResponse, ILLUMINATI, isImplemented, GROUP_ABILITIES, openArrows, outSides,
  plotOptions, plotsInHand, handLimit, power, resistance, globalPower, alignments, randomDeck,
  responseOptions, structureCards, subtree, takeoverOptions, tokenBarred, waitingFor, PLOTS, NWO_EFFECTS,
  describePlay, player, leadOptions, actionCancelled, actionSummary, abilitiesOf, abilityOptions, resourcesOf, canEnterPlay, HOOKS, goalsInHand, goalLimit,
} from '../engine';
import { attachRect, rectOf, ensureLayout, type Rect } from '../engine/geometry';
import { chooseAction, successChance } from '../ai/ai';

// ------------------------------------------------------------------ state

type Sel =
  | { kind: 'none' }
  | { kind: 'group'; iid: string }
  | { kind: 'attack'; attacker: string; type: 'control' | 'destroy' }
  | { kind: 'confirm'; attacker: string; target: string; type: 'control' | 'destroy'; side?: Side; plots: PlotPlay[]; privileged?: boolean }
  | { kind: 'move'; group: string }
  | { kind: 'plot'; card: string }
  | { kind: 'takeover'; card: string }
  | { kind: 'discard'; cards: string[] }
  | { kind: 'resource'; iid: string }
  | { kind: 'link'; resource: string };

interface Ui {
  slotChoice?: string[];
  picked?: string[];
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

type HelpMode = 'tutorial' | 'guided' | 'off';
const HELP_MODES: HelpMode[] = ['tutorial', 'guided', 'off'];
const HELP_LABEL: Record<HelpMode, string> = { tutorial: 'Tutorial', guided: 'Guided', off: 'Help off' };
const HELP_TITLE: Record<HelpMode, string> = {
  tutorial: 'Tutorial: outlines and next steps, plus why things can\'t be done, when Plots can be played, and what happens automatically. Tap for Guided.',
  guided: 'Guided: green/red outlines and the next step. Tap to turn help off.',
  off: 'Help off: the plain game. Tap for Tutorial.',
};

const ui: Ui = { game: null, me: 'p1', sel: { kind: 'none' }, autoPass: true, thinking: false, help: loadHelpPref(), guide: true };
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

// ------------------------------------------------------------------ game flow

function commit(next: GameState) {
  ui.game = next;
  ui.error = undefined;
  saveGame(next);
  render();
  schedule();
}

function act(a: Action) {
  const s = ui.game!;
  if (online) { onlineMove(a); return; }
  try {
    const next = applyAction(s, ui.me, a);
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
  if (ai) {
    ui.thinking = true;
    timer = window.setTimeout(() => {
      let a = chooseAction(s, ai.id);
      let next: GameState;
      try { next = applyAction(s, ai.id, a); } catch {
        a = s.window ? { type: 'pass' } : s.prompt?.kind === 'takeover' ? { type: 'skipTakeover' } : { type: 'endTurn' };
        next = applyAction(s, ai.id, a);
      }
      const quick = a.type === 'pass';
      ui.game = next;
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
  if (ui.autoPass && s.window && waiting.includes(ui.me) && !hasResponse(s, ui.me) && !myRoll) {
    timer = window.setTimeout(() => act({ type: 'pass' }), 250);
  }
}

function newGame(illuminati: string, quick: boolean) {
  const seed = Math.floor(Math.random() * 1e9);
  const others = ILLUMINATI.filter((c) => c.id !== illuminati);
  const rivalIll = others[Math.floor(Math.random() * others.length)].id;
  const s = createGame({
    seed,
    players: [
      { id: 'p1', name: 'You', isAI: false, deck: randomDeck(seed, illuminati) },
      { id: 'p2', name: 'Computer', isAI: true, deck: randomDeck(seed + 1, rivalIll) },
    ],
    settings: { houseRules: quick ? ['quickGame'] : [] },
    chooseLeads: true,
  });
  ui.sel = { kind: 'none' };
  ui.inspect = undefined;
  commit(s);
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

type Area = 'board' | 'rival' | 'hand' | 'console';
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
    mark(hand, (h) => def(s, h).type === 'Plot');
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
    if (sel.type === 'control') mark(hand.filter((h) => def(s, h).type === 'Group'), (h) => targets.has(h));
    g.next = [...targets].some((t) => s.cards[t].zone === 'hand') && ![...targets].some((t) => s.cards[t].zone === 'structure') ? 'hand' : 'rival';
    g.text = targets.size ? `Step 3: tap a green target to attack to ${sel.type}.` : 'No legal targets for this attack: Cancel.';
    return g;
  }
  if (sel.kind === 'move') { g.ok.add('slots'); g.next = 'board'; g.text = 'Tap a green + to move the Group there.'; return g; }
  if (sel.kind === 'link') { mark(mine, (c) => def(s, c).type !== 'Illuminati'); g.next = 'board'; g.text = 'Tap a green Group to link the Resource to it.'; return g; }
  if (sel.kind === 'group') { g.next = 'console'; g.text = 'Step 2: choose what this Group does (green buttons in the panel).'; return g; }
  if (sel.kind === 'confirm') { g.next = 'console'; g.text = 'Step 4: add any Plots, then Declare attack.'; return g; }
  if (sel.kind === 'plot' || sel.kind === 'resource') { g.next = 'console'; g.text = 'Pick how to play it in the panel, or Close.'; return g; }
  const canUse = (c: string) => s.cards[c].tokens > 0 && (attackOptions(s, ui.me, c).length > 0 || abilityOptions(s, ui.me, c).length > 0 || def(s, c).type === 'Group');
  mark(mine, canUse);
  mark(res, (r) => abilityOptions(s, ui.me, r).length > 0 || !!HOOKS[s.cards[r].cardId]?.linkTo);
  mark(hand, (h) => {
    const d = def(s, h);
    if (d.type === 'Plot') return plotOptions(s, ui.me, h).length > 0;
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
  G = computeGuide(ui.game);
  const s = ui.game;
  noticeRolls(s);
  // Open the action panel again whenever a new kind of decision comes up.
  const key = `${s.turn}|${s.prompt?.kind ?? ''}|${s.window?.kind ?? ''}|${s.attack?.id ?? ''}|${ui.sel.kind}|${waitingFor(s).includes(ui.me)}`;
  if (key !== ui.lastKey) {
    ui.lastKey = key;
    // On a phone the panel folds down to its "Next" line whenever the next step is on the table or in your hand.
    const narrow = window.innerWidth <= 900;
    if (waitingFor(s).includes(ui.me)) ui.sheetMin = narrow && (G.next === 'board' || G.next === 'rival' || G.next === 'hand');
  }
  const rivals = s.players.filter((p) => p.id !== ui.me);
  const me = player(s, ui.me);
  const recent = s.log.filter((l) => (!l.to || l.to === ui.me) && (!l.info || tutorial())).slice(-2).reverse();
  app.innerHTML = `
  <div class="shell ${ui.guide ? 'guide' : ''} ${tutorial() ? 'tutorial' : ''}">
    <header class="hud">
      <button class="linkish" data-act="home" aria-label="Back to games">‹</button>
      <div class="players">${s.players.map((p) => playerChip(s, p.id)).join('')}</div>
      <span class="turn-no">${s.phase === 'gameOver' ? 'Game over' : `Turn ${s.turn}`}</span>
      ${phaseTracker(s)}
      <button class="hud-btn" data-rules="goal">Rules</button>
      <button class="hud-btn" data-act="log">Log</button>
      <button class="guide-toggle ${ui.guide ? 'on' : ''} ${ui.help}" data-act="guide" title="${esc(HELP_TITLE[ui.help])}" aria-label="Help level: ${HELP_LABEL[ui.help]} (tap to change)">${HELP_LABEL[ui.help]}</button>
    </header>
    <main class="tablearea">
      <div class="viewport" id="vp"><div class="world" id="world">
        <div class="rivals">${rivals.map((r) => renderSide(s, r.id, false)).join('')}</div>
        ${renderNwo(s)}
        ${renderSide(s, ui.me, true)}
      </div></div>
      <div class="ticker" aria-live="polite">${recent.map((l) => `<div>${esc(youText(l.text))}</div>`).join('')}</div>
      <div class="zoom"><button data-zoom="in" aria-label="Zoom in">+</button><button data-zoom="out" aria-label="Zoom out">−</button><button data-zoom="fit">Fit</button></div>
      ${renderInspect(s)}
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
      <button class="hand-head" data-act="hand" aria-expanded="${!ui.handMin}">
        <span class="label">Your hand</span>
        <span class="muted small">${plotsInHand(s, ui.me).length} Plots (limit ${handLimit(s, ui.me)} outside your turn) · decks: ${me.plotDeck.length} Plots, ${me.groupDeck.length} Groups</span><i>${ui.handMin ? '▴' : '▾'}</i>
      </button>
      <div class="hand">${me.hand.map((iid) => handCard(s, iid)).join('') || '<span class="muted">No cards in hand.</span>'}</div>
    </footer>
    ${diceOverlay()}
    ${ui.showRules ? `<div class="modal-back" data-rules=""></div><div class="modal rules" role="dialog" aria-label="Rules">${rulesHtml(s)}<div class="btns"><button data-rules="">Close</button></div></div>` : ''}
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
  const inHand = pl === ui.me ? '' : ` · ${p.hand.filter((i) => def(s, i).type === 'Plot').length}P ${p.hand.filter((i) => def(s, i).type !== 'Plot').length}G`;
  return `<span class="pchip ${active ? 'active' : ''} ${pl === ui.me ? 'me' : ''} ${p.eliminated ? 'out' : ''}" title="${esc(p.name)}: ${n} of ${need} Groups${inHand ? `; ${inHand.slice(3)} in hand` : ''}">
    <b>${esc(pl === ui.me ? 'You' : p.name)}</b><span class="goal-bar"><span style="width:${Math.min(100, (n / need) * 100)}%"></span></span><span class="mono">${n}/${need}</span><span class="muted">${inHand}</span></span>`;
}

// The human player is called "You", so fix the verb: "You leads" -> "You lead".
const youText = (t: string) => t.replace(/(^|\s)You (has|\w+?)s\b/g, (_m, pre, v) => `${pre}You ${v === 'has' ? 'have' : v}`);

// ------------------------------------------------------------------ table pan and zoom

/** Frame the whole table, leaving room for the action panel. */
function fitView(vp: HTMLElement, world: HTMLElement) {
  const wide = vp.clientWidth > 900;
  const sheet = vp.parentElement!.querySelector<HTMLElement>('.sheet');
  const aw = vp.clientWidth - (wide ? 372 : 0) - 16;
  const ah = vp.clientHeight - (!wide && sheet ? sheet.offsetHeight + 8 : 0) - 16;
  const ww = world.offsetWidth, wh = world.offsetHeight;
  const z = Math.max(0.3, Math.min(1.5, aw / ww, ah / wh));
  ui.view = { x: 8 + (aw - ww * z) / 2, y: 8 + Math.max(0, (ah - wh * z) / 2), z, auto: true };
}

function applyView(world: HTMLElement) {
  const v = ui.view!;
  world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
}

function zoomAt(px: number, py: number, factor: number) {
  const v = ui.view!;
  const z = Math.max(0.25, Math.min(3, v.z * factor));
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
    if (z === 'fit') fitView(vp, world);
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
  return `
    <div class="side ${mine ? 'mine' : 'theirs'} ${s.players[s.active].id === pl && s.phase !== 'gameOver' ? 'active' : ''} ${gnext(mine ? 'board' : 'rival')}">
      <div class="side-head">
        <span class="who">${mine ? 'Your Power Structure' : esc(p.name)}</span>
        <span class="goal" title="Groups controlled toward the Basic Goal">
          <span class="goal-bar"><span style="width:${Math.min(100, (n / need) * 100)}%"></span></span>
          <b>${n}</b>/${need} Groups
        </span>
        ${mine ? '' : `<span class="muted">${p.hand.filter((i) => def(s, i).type === 'Plot').length} Plots · ${p.hand.filter((i) => def(s, i).type !== 'Plot').length} Groups in hand</span>`}
      </div>
      <div class="board-scroll"><div class="field" style="width:calc(var(--u) * ${maxX - minX});height:calc(var(--u) * ${maxY - minY})">${cells.join('')}</div></div>
      ${resourcesOf(s, pl).length ? `<div class="res-row"><span class="label">Resources</span>${resourcesOf(s, pl).map((r) => {
        const c = s.cards[r];
        const sel = (ui.sel.kind === 'resource' && ui.sel.iid === r) || (ui.sel.kind === 'link' && ui.sel.resource === r);
        return `<button class="res ${sel ? 'selected' : ''} ${gcls(r)}" data-res="${r}"><b>${esc(cardName(s, r))}</b>${c.tokens ? '<span class="token-inline"></span>' : ''}<span class="muted small">${c.linkedTo && s.cards[c.linkedTo] && def(s, c.linkedTo).type !== 'Illuminati' ? `linked to ${esc(cardName(s, c.linkedTo))}` : 'unlinked'}</span></button>`;
      }).join('')}</div>` : ''}
    </div>`;
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
    <button class="card ${ill ? 'ill' : ''} ${c.devastated ? 'devastated' : ''} ${highlightFor(s, iid)} ${gcls(iid)}" data-card="${iid}" title="${esc(d.name)}">
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
  const isPlot = d.type === 'Plot';
  const playable = isPlot && !!PLOTS[d.id];
  const sel = ui.sel;
  const selected = (sel.kind === 'plot' && sel.card === iid) || (sel.kind === 'takeover' && sel.card === iid) || (sel.kind === 'discard' && sel.cards.includes(iid));
  const targetable = sel.kind === 'attack' && sel.type === 'control' && attackOptions(s, ui.me, sel.attacker).some((o) => o.target === iid);
  return `
    <button class="hcard ${isPlot ? 'plot' : 'group'} ${selected ? 'selected' : ''} ${targetable ? 'targetable' : ''} ${isPlot && !playable ? 'inactive' : ''} ${gcls(iid)}" data-hand="${iid}">
      <span class="kind">${isPlot ? esc(d.subtype === 'Plot' ? 'Plot' : d.subtype) : d.type === 'Resource' ? 'Resource' : esc(d.subtype)}</span>
      <span class="name">${esc(d.name)}</span>
      ${tutorial() && isPlot && plotTiming(d.id, d.subtype, true) ? `<span class="timing">${esc(plotTiming(d.id, d.subtype, true))}</span>` : ''}
      ${isPlot || d.type === 'Resource' ? `<span class="txt">${esc(d.modifier ?? d.text)}</span>` : `
        <span class="aligns">${(d.alignments ?? []).map(chip).join('')}</span>
        <span class="stats"><span class="pw">${d.power}${d.globalPower ? `<small>/${d.globalPower}</small>` : ''}</span><span class="rs">${d.resistance}</span></span>`}
    </button>`;
}

function renderNwo(s: GameState): string {
  const list = Object.entries(s.nwo).filter(([, v]) => v);
  if (!list.length) return '';
  return `<div class="nwo-row"><span class="label">New World Order</span>${list.map(([color, iid]) => `<button class="nwo nwo-${color}" data-inspect="${iid}">${esc(cardName(s, iid!))}</button>`).join('')}</div>`;
}

/** The three parts of a turn, with the current one lit. Tapping it opens the turn rules. */
function phaseTracker(s: GameState): string {
  if (s.phase === 'gameOver' || s.phase === 'setup') return '';
  const cur = s.phase === 'beginning' ? 0 : s.phase === 'main' ? 1 : 2;
  const whose = s.players[s.active].id === ui.me ? 'Your turn' : `${player(s, s.players[s.active].id).name}'s turn`;
  return `<button class="phases" data-rules="turn" title="${esc(whose)}: tap for how a turn works"><span class="whose">${esc(whose)}</span>${['Start', 'Main', 'End'].map((n, i) => `<span class="${i === cur ? 'on' : ''}">${n}</span>`).join('<i>›</i>')}</button>`;
}

/** A plain-words summary of the real rules, so what you learn here works at a real table. */
function rulesHtml(s: GameState): string {
  const me = player(s, ui.me);
  const ill = def(s, me.illuminati);
  const goals = goalsInHand(s, ui.me).map((g) => cardName(s, g));
  const two = s.players.length === 2;
  const sec = (id: string, title: string, body: string) => `<section id="rule-${id}"><h3>${title}</h3>${body}</section>`;
  return `<h2>How to play</h2>
  <nav class="rule-nav">${[['goal', 'Your goal'], ['turn', 'A turn'], ['tokens', 'Actions'], ['attack', 'Attacks'], ['roll', 'The roll'], ['help', 'Helping'], ['plots', 'Plots'], ['more', 'More rules']].map(([id, t]) => `<button data-rules="${id}">${t}</button>`).join('')}<button class="close-rules" data-rules="" aria-label="Close rules">✕</button></nav>
  ${sec('goal', 'Your goal', `<p>You win by meeting a Goal when victory is checked, at the end of any turn (never in the first round). There are three ways:</p><ul>
    <li><b>Basic Goal:</b> control ${goalNeeded(s, ui.me)} Groups, counting your Illuminati. You have ${goalCount(s, ui.me)}.</li>
    <li><b>Your Illuminati's Special Goal</b> (${esc(ill.name)}): ${esc(ill.text.replace(/^Power [^.]+\.\s*/, ''))}</li>
    <li><b>A Goal card</b> in your hand${goals.length ? ` (you hold: ${esc(goals.join(', '))})` : ''}. You may hold only one Goal card${goalLimit(s, ui.me) > 1 ? ` (your Illuminati allows ${goalLimit(s, ui.me)})` : ''}.</li></ul>
    <p>Groups under a Devastated Place do not count. A player whose Illuminati has no Groups left after their third turn is out.</p>`)}
  ${sec('turn', 'A turn', `<ol><li><b>Start:</b> draw a Plot card, then a Group card (the rules make both draws optional; this game always takes them). Then you may make <b>one automatic takeover</b>: put a Group (or Resource) from your hand into your Power Structure with no roll, on a free arrow. Then every Group you control gets its Action token.${two ? ' <i>Two-player rule: if you took a Group over this way, your Illuminati gets no token this turn.</i>' : ''}</li>
    <li><b>Main phase:</b> spend Action tokens: attack, move a Group, buy Plots, bring in a Resource, use card abilities. Anyone may answer with Plots and help at any time.</li>
    <li><b>End:</b> you say you are done; everyone gets a last chance to play cards, then victory is checked.</li></ol>`)}
  ${sec('tokens', 'Action tokens', `<p>Each Group has one action per turn, shown by its token. Spending it lets the Group attack, aid, oppose, or pay for a card. Tokens come back at the start of your turn, so a Group that aided in a rival's turn may have none left for yours.</p>
    <p>Your <b>Illuminati</b>'s token also buys things: 1 Illuminati token (or 2 tokens from other Groups) buys a Plot card at any time; once per turn it can bring a Resource into play or draw a Group card.</p>`)}
  ${sec('attack', 'Attacks', `<p><b>Attack to Control</b> takes a Group from a rival (or from your own hand). The attacker needs an open outgoing arrow for the captured Group to hang from. Its strength is your Power minus the target's <b>Resistance</b>.</p>
    <p><b>Attack to Destroy</b> removes a Group from play. Strength is your Power minus the target's <b>Power</b>.</p>
    <p>Defense bonus by position: <b>+10</b> if the target hangs directly from its Illuminati, <b>+5</b> one step further, none beyond. Alignments matter: for control, <b>+4</b> for each alignment the attacker shares with the target and <b>−4</b> for each opposite pair; for destroy it is reversed. In an Attack to Control the target also gets <b>+4</b> Resistance for each alignment it shares with its master.</p>
    <p><b>Instant attacks</b> are cards that attack by themselves: Disasters hit Places, Assassinations hit Personalities.</p>
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
  ${sec('more', 'More rules', `<ul><li><b>Secret</b> Groups can only be attacked or helped by Illuminati and other Secret Groups.</li>
    <li>A <b>Privileged</b> attack allows only the attacker and defender to take part.</li>
    <li><b>Devastated</b> Places lose their tokens and stop counting until someone sends Relief (spending actions worth three times the Place's printed Power).</li>
    <li>You may <b>move</b> a Group (with its puppets) to another open arrow in your Power Structure in your main phase for one token. Groups cannot be dropped.</li>
    <li>When a card and a rule disagree, the card wins.</li></ul>`)}`;
}

/** When a Plot may be played, in the words of the rules. */
function plotTiming(id: string, subtype: string, short = false): string {
  if (subtype === 'Goal') return short ? '' : 'Goal card: you win if you meet it when victory is checked at the end of a turn (hold at most one).';
  if (subtype === 'NWO') return short ? '' : 'New World Order: play any time except during an Instant or Privileged attack; it affects everyone until replaced by another of its colour.';
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
      if (!PLOTS[d.id]) return d.subtype === 'Goal' ? 'Goal cards are not played: you win if you meet the Goal when victory is checked at the end of a turn.' : 'This card is not in this version yet.';
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
      <div class="vs"><b>${esc(who)}</b> <span class="muted">${ctx.instant ? 'strikes' : `attacks to ${ctx.type}`}</span> <b>${esc(cardName(s, ctx.target))}</b></div>
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
    body = `<h2 class="${won ? 'ok' : 'bad'}">${won ? (s.winners!.length > 1 ? 'Shared victory.' : 'You win.') : s.winners?.length ? 'The Computer wins.' : 'Nobody wins.'}</h2>
      <p>${esc(s.log.filter((l) => / wins/.test(l.text)).map((l) => l.text).join(' '))}</p>
      <div class="btns"><button class="primary" data-act="home">New game</button></div>`;
  } else if (s.prompt?.player === ui.me && s.prompt.kind === 'choose' && s.prompt.choice) {
    const ch = s.prompt.choice;
    const picked = ui.picked ?? [];
    const single = ch.max === 1 && ch.min === 1;
    body = `<h2>${esc(ch.source && s.cards[ch.source] ? cardName(s, ch.source) : 'Your choice')}</h2><p>${esc(ch.question)}</p>
      <div class="opts">${ch.options.map((o) => `<button class="${picked.includes(o.id) ? 'on' : ''}" data-pick-opt="${esc(o.id)}">${picked.includes(o.id) ? '✓ ' : ''}${esc(o.label)}</button>`).join('')}</div>
      ${single ? '' : `<div class="btns"><button class="primary" data-act="choose" ${picked.length >= ch.min && picked.length <= ch.max ? '' : 'disabled'}>Confirm (${picked.length})</button></div>`}`;
  } else if (s.prompt?.player === ui.me && s.prompt.kind === 'chooseLead') {
    const opts = leadOptions(s, ui.me).sort((a, b) => (def(s, b).arrowsOut?.length ?? 0) - (def(s, a).arrowsOut?.length ?? 0) || (def(s, b).power ?? 0) - (def(s, a).power ?? 0));
    body = `<h2>Choose your lead Group</h2><p>Pick a Group from your deck to start under your Illuminati. Your rival picks at the same time; if you both pick the same Group, you both pick again.</p>
      <div class="opts">${opts.map((iid) => { const d = def(s, iid); return `<button data-lead="${iid}"><b>${esc(d.name)}</b> · ${d.power}${d.globalPower ? `/${d.globalPower}` : ''} Power, ${d.resistance} Resistance, ${d.arrowsOut?.length ?? 0} arrow${(d.arrowsOut?.length ?? 0) === 1 ? '' : 's'} out${(d.alignments ?? []).length ? ' · ' + (d.alignments ?? []).join(', ') : ''}</button>`; }).join('')}</div>`;
  } else if (s.prompt?.player === ui.me && s.prompt.kind === 'takeover') {
    body = `<h2>Automatic takeover</h2><p>Pick a Group from your hand, then tap a + to place it. No roll needed.${s.players.length === 2 ? ' In a two-player game your Illuminati gets no Action token this turn if you do.' : ''}</p>
      <div class="btns"><button data-act="skipTakeover">Skip takeover</button></div>`;
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
      : s.window.kind === 'endOfTurn' ? '<p>The turn is ending. Last chance to play a card.</p>'
      : s.window.kind === 'roll' ? '<p>The dice are down. Cards that change rolls can be played now.</p>' : '';
    body = `${s.attack ? attackPanel(s) : ''}${head}
      <div class="opts">${opts.map((o, i) => `<button data-opt="${i}">${esc(o.label)}</button>`).join('')}</div>
      <div class="btns"><button class="primary" data-act="pass">${s.window.kind === 'attack' && s.attack?.attackerPlayer === ui.me ? '🎲 Roll the dice' : 'Pass'}</button>${s.window.kind === 'attack' && s.attack?.attackerPlayer === ui.me && !s.attack.instant && !s.attack.plays.some((pp) => pp.player === ui.me) ? '<button data-act="callOff">Call off the attack</button>' : ''}</div>`;
    (window as unknown as { __opts: typeof opts }).__opts = opts;
  } else if (idle(s)) {
    body = renderMainConsole(s);
  } else {
    const names = waiting.map((id) => player(s, id).name).join(', ');
    body = `${s.attack ? attackPanel(s) : ''}<p class="muted thinking">${online ? (online.busy ? 'Sending…' : `Waiting for ${esc(names)}. You'll see their move here as soon as it's made.`) : ui.thinking ? 'The Computer is thinking…' : 'Waiting…'}</p>`;
  }
  return `<div class="panel now">${err}${body}</div>`;
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
  if (sel.kind === 'resource') {
    const d = def(s, sel.iid);
    const inHand = s.cards[sel.iid].zone === 'hand';
    if (inHand) {
      const can = !s.turnFlags.resourcePlayed && s.cards[me.illuminati].tokens > 0 && canEnterPlay(s, sel.iid, ui.me);
      return `<h2>${esc(d.name)}</h2><p class="small">${esc(d.text)}</p>
        <div class="btns"><button class="primary" data-act="playResource" ${can ? '' : 'disabled'}>Put into play (Illuminati token, once per turn)</button><button class="linkish" data-act="clear">Close</button></div>`;
    }
    return `<h2>${esc(d.name)}</h2><p class="small">${esc(d.text)}</p>
      <div class="btns"><button data-act="linkStart">Link to a Group</button><button class="linkish" data-act="clear">Close</button></div>${abilityButtons(s, sel.iid)}`;
  }
  if (sel.kind === 'link') {
    return `<h2>Link ${esc(cardName(s, sel.resource))}</h2><p>Tap one of your Groups to link it to. A link can be moved once per turn.</p><div class="btns"><button class="linkish" data-act="clear">Cancel</button></div>`;
  }
  if (sel.kind === 'move') {
    return `<h2>Move ${esc(cardName(s, sel.group))}</h2><p>Tap a + to move it (and its puppets) there. Costs one Action token.</p>
      <div class="btns"><button class="linkish" data-act="clear">Cancel</button></div>`;
  }
  if (sel.kind === 'plot') {
    const d = def(s, sel.card);
    const opts = plotOptions(s, ui.me, sel.card);
    (window as unknown as { __popts: typeof opts }).__popts = opts;
    return `<h2>${esc(d.name)}</h2><p class="small">${esc(d.text)}</p>
      ${PLOTS[d.id] ? (opts.length ? `<div class="opts">${opts.map((o, i) => `<button data-popt="${i}">${esc(o.label)}</button>`).join('')}</div>` : (tutorial() ? `<p class="why">${esc(whyNot(s, sel.card) ?? 'Not playable right now.')}</p>` : '<p class="muted">Not playable right now.</p>')) : '<p class="muted">This card is not in this version of the game yet.</p>'}
      <div class="btns"><button class="linkish" data-act="clear">Close</button></div>`;
  }
  const ill = me.illuminati;
  const payers = structureCards(s, ui.me).filter((g) => g !== ill && s.cards[g].tokens > 0).sort((a, b) => power(s, a) - power(s, b));
  const reliefs = Object.values(s.cards).filter((c) => c.zone === 'structure' && c.devastated).map((c) => {
    const need = 3 * (def(s, c.iid).power ?? 0);
    const pool = structureCards(s, ui.me).filter((g) => s.cards[g].tokens > 0).sort((a, b) => power(s, b) - power(s, a));
    const pay: string[] = []; let tot = 0;
    for (const g of pool) { if (tot >= need) break; pay.push(g); tot += power(s, g); }
    return { place: c.iid, need, pay, ok: tot >= need };
  });
  (window as unknown as { __relief: typeof reliefs }).__relief = reliefs;
  return `<h2>Your turn</h2>
    <p>Tap one of your Groups with a <span class="token-inline"></span> token to attack or move it. Tap a Plot in your hand to play it.</p>
    <div class="btns">
      <button data-act="buy-ill" ${s.cards[ill].tokens && me.plotDeck.length ? '' : 'disabled'}>Buy a Plot (Illuminati token)</button>
      <button data-act="buy-two" ${payers.length >= 2 && me.plotDeck.length ? '' : 'disabled'}>Buy a Plot (2 Group tokens)</button>
      <button data-act="drawGroup" ${s.cards[ill].tokens && !s.turnFlags.illumGroupDraw && me.groupDeck.length ? '' : 'disabled'}>Draw a Group card (Illuminati token, once per turn)</button>
      <button class="primary" data-act="endTurn">End turn</button>
    </div>
    ${reliefs.length ? `<div class="label">Relief for Devastated Places (needs 3× printed Power)</div><div class="opts">${reliefs.map((r, i) => `<button data-relief="${i}" ${r.ok ? '' : 'disabled'}>Relieve ${esc(cardName(s, r.place))} (needs ${r.need})${r.ok ? ` with ${r.pay.map((g) => esc(cardName(s, g))).join(', ')}` : ' — not enough Power with tokens'}</button>`).join('')}</div>` : ''}
    ${online ? '' : `<label class="toggle"><input type="checkbox" id="autopass" ${ui.autoPass ? 'checked' : ''}> Pass for me when I have no possible response</label>`}`;
}

function abilityButtons(s: GameState, card: string): string {
  const opts = abilityOptions(s, ui.me, card);
  (window as unknown as { __abil: typeof opts }).__abil = opts;
  if (!opts.length) return (HOOKS[s.cards[card].cardId]?.actions?.length ? '<p class="muted small">Its special ability cannot be used right now.</p>' : '');
  return `<div class="label">Special abilities</div><div class="opts">${opts.map((o, i) => `<button data-abil="${i}">${esc(o.label)}</button>`).join('')}</div>`;
}

function renderInspect(s: GameState): string {
  const iid = ui.inspect;
  if (!iid || !s.cards[iid]) return '';
  const d = def(s, iid);
  const abil = GROUP_ABILITIES[d.id] ?? [];
  const pending = abil.filter((a) => a.kind === 'pending').map((a) => (a as { note: string }).note);
  const stats = d.type === 'Group' || d.type === 'Illuminati'
    ? `<div class="kv"><span>Power</span><b>${power(s, iid)}${d.globalPower ? ` / ${globalPower(s, iid)} Global` : ''}</b>${d.type === 'Group' ? `<span>Resistance</span><b>${resistance(s, iid)}</b>` : ''}</div>
       <div>${alignments(s, iid).map(chip).join(' ')} ${(d.attributes ?? []).map((a) => `<span class="attr">${a}</span>`).join(' ')}</div>` : '';
  return `<div class="panel inspect popover">
    <button class="close" data-act="closeInspect" aria-label="Close">×</button>
    <div class="label">${esc(d.subtype)}</div><h3>${esc(d.name)}</h3>${stats}
    <p class="small">${esc(d.text)}</p>
    ${d.type === 'Plot' ? `<p class="small"><span class="timing">${esc(plotTiming(d.id, d.subtype))}</span></p>` : ''}
    ${tutorial() && whyNot(s, iid) ? `<p class="why">${esc(whyNot(s, iid)!)}</p>` : ''}
    ${pending.length ? `<p class="small warn">Not active yet in this version: ${esc(pending.join('; '))}.</p>` : ''}
    ${d.type === 'Plot' && !PLOTS[d.id] ? '<p class="small warn">This Plot is not in this version yet.</p>' : ''}
    ${d.subtype === 'NWO' && NWO_EFFECTS[d.id] ? '<p class="small muted">In effect for everyone while on the table.</p>' : ''}
  </div>`;
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
  app.innerHTML = `
    <div class="start">
      <header class="hero">
        <h1>Elitists War</h1>
        <p>Build a secret Power Structure, take over the world's Groups one arrow at a time, and stop your rival doing the same.</p>
      </header>
      ${saves.length ? `<section><div class="label">Continue a game</div><div class="saves">${saves.map((sv) => `
        <div class="save"><button data-load="${sv.id}"><b>${esc(sv.summary)}</b><span class="muted">${new Date(sv.updated).toLocaleString()}</span></button>
        <button class="linkish" data-del="${sv.id}" aria-label="Delete saved game">Delete</button></div>`).join('')}</div></section>` : ''}
      <section>
        <div class="label">New game against the Computer — choose your Illuminati</div>
        <div class="ills">${ILLUMINATI.map((c) => `
          <button class="ill-pick ${pick === c.id ? 'on' : ''}" data-pick="${c.id}">
            <b>${esc(c.name)}</b><span class="pw">${c.power}/${c.globalPower}</span>
            <span class="small">${esc(c.text.replace(/^Power [^.]+\.\s*/, ''))}</span>
          </button>`).join('')}</div>
        <div class="row">
          <label class="toggle"><input type="checkbox" id="quick" ${quick ? 'checked' : ''}> Quick game: first to 8 Groups (house rule; the official two-player goal is 12)</label>
          <button class="primary" data-act="start">Start game</button>
        </div>
        <p class="muted small">Games are saved in this browser after every move, so you can stop and pick up later. Playing friends online comes next.</p>
      </section>
    </div>`;
  app.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => b.onclick = () => { (ui as Ui & { pick?: string }).pick = b.dataset.pick; renderStart(); });
  app.querySelector<HTMLInputElement>('#quick')!.onchange = (e) => { (ui as Ui & { quick?: boolean }).quick = (e.target as HTMLInputElement).checked; };
  app.querySelector<HTMLElement>('[data-act="start"]')!.onclick = () => newGame(pick, (ui as Ui & { quick?: boolean }).quick ?? false);
  app.querySelectorAll<HTMLElement>('[data-load]').forEach((b) => b.onclick = () => {
    const sv = loadSaves()[b.dataset.load!];
    if (sv) { ui.game = sv.state; ui.sel = { kind: 'none' }; ui.inspect = undefined; render(); schedule(); }
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
    if (d.type !== 'Plot') return render();
    const cards = sel.kind === 'discard' ? sel.cards : [];
    ui.sel = { kind: 'discard', cards: cards.includes(iid) ? cards.filter((c) => c !== iid) : [...cards, iid] };
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
  app.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) => b.onclick = () => {
    const choices = b.dataset.slot!.split('|');
    if (choices.length > 1) { ui.slotChoice = choices; render(); return; }
    placeAt(choices[0]);
  });
  app.querySelectorAll<HTMLElement>('[data-slotpick]').forEach((b) => b.onclick = () => { const c = b.dataset.slotpick!; ui.slotChoice = undefined; placeAt(c); });
  function placeAt(choice: string) {
    const [onto, side] = choice.split(':') as [string, Side];
    const sel = ui.sel;
    if (sel.kind === 'takeover') act({ type: 'takeover', card: sel.card, onto, side });
    else if (sel.kind === 'move') {
      const g = s.cards[sel.group];
      const payWith = [sel.group, g.master!, onto, player(s, ui.me).illuminati].find((x) => s.cards[x]?.tokens > 0);
      if (!payWith) { ui.error = 'Moving needs a token from the Group, its old or new master, or your Illuminati.'; render(); return; }
      act({ type: 'move', group: sel.group, onto, side, payWith });
    } else if (sel.kind === 'confirm') { ui.sel = { ...sel, side }; render(); }
  }
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
  app.querySelectorAll<HTMLElement>('[data-info]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); ui.info = ui.info === b.dataset.info ? undefined : b.dataset.info; render(); });
  app.querySelectorAll<HTMLElement>('[data-lead]').forEach((b) => b.onclick = () => act({ type: 'chooseLead', card: b.dataset.lead! }));
  app.querySelectorAll<HTMLElement>('[data-relief]').forEach((b) => b.onclick = () => {
    const r = (window as unknown as { __relief: { place: string; pay: string[] }[] }).__relief[Number(b.dataset.relief)];
    act({ type: 'relief', place: r.place, payWith: r.pay });
  });
  const priv = app.querySelector<HTMLInputElement>('#priv');
  if (priv) priv.onchange = () => { if (ui.sel.kind === 'confirm') { ui.sel = { ...ui.sel, privileged: priv.checked }; render(); } };
  if (online) bindOrders();
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
      case 'closeInspect': ui.inspect = undefined; render(); break;
      case 'guide':
        ui.help = HELP_MODES[(HELP_MODES.indexOf(ui.help) + 1) % HELP_MODES.length];
        ui.guide = ui.help !== 'off';
        try { localStorage.setItem('elitists-war.help', ui.help); } catch { /* storage unavailable */ }
        render(); break;
      case 'clearSlot': ui.slotChoice = undefined; render(); break;
      case 'skipTakeover': act({ type: 'skipTakeover' }); break;
      case 'pass': act({ type: 'pass' }); break;
      case 'endTurn': act({ type: 'endTurn' }); break;
      case 'discard': if (sel.kind === 'discard') act({ type: 'discard', cards: sel.cards }); break;
      case 'return': if (sel.kind === 'discard') act({ type: 'discard', cards: sel.cards, toDeck: true }); break;
      case 'callOff': act({ type: 'callOff' }); break;
      case 'choose': { const ids = ui.picked ?? []; ui.picked = undefined; act({ type: 'choose', ids }); break; }
      case 'drawGroup': act({ type: 'drawGroup' }); break;
      case 'playResource': if (sel.kind === 'resource') act({ type: 'playResource', card: sel.iid }); break;
      case 'linkStart': if (sel.kind === 'resource') { ui.sel = { kind: 'link', resource: sel.iid }; render(); } break;
      case 'buy-ill': act({ type: 'buyPlot', payWith: [player(s, ui.me).illuminati] }); break;
      case 'buy-two': {
        const ill = player(s, ui.me).illuminati;
        const payers = structureCards(s, ui.me).filter((g) => g !== ill && s.cards[g].tokens > 0).sort((a, c) => power(s, a) - power(s, c));
        act({ type: 'buyPlot', payWith: payers.slice(0, 2) });
        break;
      }
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

interface GameSummary { id: string; invite: string; seats: { id: string; name: string; isAI: boolean; joined: boolean }[]; me?: string; host?: boolean; started: boolean; finished: boolean; yourMove: boolean; progress: string; illuminati?: string; updatedAt: number }
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
}

async function onlineMove(a: Action) {
  online!.busy = true; ui.error = undefined; render();
  try { applyReply(await api({ op: 'move', gameId: online!.gameId, action: a })); ui.sel = { kind: 'none' }; }
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
    app.innerHTML = `<div class="start"><header class="hero"><h1>Elitists War</h1><p>Play online with friends, a move at a time. Sign in so your games follow you to any device.</p></header>
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
      <ul class="seats">${o.summary.seats.map((x) => `<li>${esc(x.isAI ? 'Computer' : x.name)} ${x.joined ? '✓' : '<span class="muted">(waiting)</span>'}</li>`).join('')}</ul>
      <div class="btns"><button class="danger" data-del="${o.summary.id}" data-host="${o.summary.host ? 1 : ''}">${o.summary.host ? 'Delete this game' : 'Leave this game'}</button></div></section></div>`;
    bindOnline();
    return;
  }
  const pick = (ui as Ui & { pick?: string }).pick ?? 'bavarian-illuminati';
  app.innerHTML = `<div class="start">
    <header class="bar"><div class="brand">Elitists War</div><div class="turn">${esc(o.name)} · <button class="linkish" data-o="signout">Sign out</button></div></header>
    ${msg}
    <section><div class="label">Your games</div><div class="saves">${o.games.map((g) => `
      <div class="save"><button data-open="${g.id}"><b>${g.yourMove ? '● Your move — ' : ''}${esc(g.seats.map((x) => x.isAI ? 'Computer' : x.name).join(' vs '))}</b>
      <span class="muted">${g.finished ? 'Finished' : g.started ? `${esc(g.illuminati ?? '')} · ${esc(g.progress)}` : `Waiting for players · invite ${esc(g.invite)}`}</span></button>${g.host || !g.started ? `<button class="del" data-del="${g.id}" data-host="${g.host ? 1 : ''}" aria-label="${g.host ? 'Delete game' : 'Leave game'}">${g.host ? 'Delete' : 'Leave'}</button>` : ''}</div>`).join('') || '<p class="muted">No games yet.</p>'}</div></section>
    ${alertsPanel()}
    <section class="panel"><h2>Join a friend's game</h2>
      <form id="join" class="row"><label>Invite code <input id="j-code" required maxlength="6" autocapitalize="characters"></label><button class="primary" type="submit">Join</button></form></section>
    <section><div class="label">Start a new game — choose your Illuminati</div>
      <div class="ills">${ILLUMINATI.map((c) => `<button class="ill-pick ${pick === c.id ? 'on' : ''}" data-pick="${c.id}"><b>${esc(c.name)}</b><span class="pw">${c.power}/${c.globalPower}</span><span class="small">${esc(c.text.replace(/^Power [^.]+\.\s*/, ''))}</span></button>`).join('')}</div>
      <form id="new" class="panel"><div class="row">
        <label>Players <select id="n-seats"><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
        <label>Computer players <select id="n-ai"><option>0</option><option>1</option><option>2</option><option>3</option></select></label>
        <label class="toggle"><input type="checkbox" id="n-quick"> Quick game (8 Groups, house rule)</label>
        <button class="primary" type="submit">Create game</button></div>
        <p class="muted small">With 0 computer players you get an invite code to send to friends. Everyone moves when they like; the game waits (up to 24 hours per response, 3 days per turn).</p></form>
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
  app.querySelector<HTMLFormElement>('#new')!.onsubmit = async (e) => {
    e.preventDefault();
    const seats = Number((app.querySelector('#n-seats') as HTMLSelectElement).value);
    const computerSeats = Number((app.querySelector('#n-ai') as HTMLSelectElement).value);
    const quick = (app.querySelector('#n-quick') as HTMLInputElement).checked;
    try { applyReply(await api({ op: 'new', seats, computerSeats, quick, illuminati: pick })); await openGame(online!.gameId!); } catch (err) { o.msg = (err as Error).message; render(); }
  };
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
    if (!confirm(host ? 'Delete this game for every player? This cannot be undone.' : 'Leave this game? Your seat opens up for someone else.')) return;
    try {
      await api({ op: 'delete', gameId: b.dataset.del });
      o.gameId = undefined; o.summary = undefined; o.channel?.unsubscribe(); ui.game = null;
      await loadGames();
    } catch (e) { o.msg = (e as Error).message; render(); }
  });
  app.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.onclick = () => openGame(b.dataset.open!));
  app.querySelectorAll<HTMLElement>('[data-o]').forEach((b) => b.onclick = async () => {
    const what = b.dataset.o;
    if (what === 'signout') { await o.client.auth.signOut(); o.games = []; o.alerts = undefined; }
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
