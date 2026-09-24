// Elitists War — browser client for playing against the computer.
// All rules live in the engine; this file only draws the table and turns taps into actions.
import {
  type Action, type GameState, type PlotPlay, type Side,
  applyAction, attackOptions, attackStrength, cardName, CARDS, createGame, currentOutcome, def, finalRoll,
  goalCount, goalNeeded, hasResponse, ILLUMINATI, isImplemented, GROUP_ABILITIES, openArrows, outSides,
  plotOptions, plotsInHand, handLimit, power, resistance, globalPower, alignments, randomDeck,
  responseOptions, structureCards, subtree, takeoverOptions, waitingFor, DELTA, PLOTS, NWO_EFFECTS,
  describePlay, player, leadOptions, abilitiesOf, abilityOptions, resourcesOf, canEnterPlay, HOOKS, goalsInHand, goalLimit,
} from '../engine';
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
}

const ui: Ui = { game: null, me: 'p1', sel: { kind: 'none' }, autoPass: true, thinking: false };
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
  if (ui.autoPass && s.window && waiting.includes(ui.me) && !hasResponse(s, ui.me)) {
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

function render() {
  if (!ui.game) { renderStart(); return; }
  const s = ui.game;
  const rival = s.players.find((p) => p.id !== ui.me)!;
  app.innerHTML = `
    <header class="bar">
      <button class="linkish" data-act="home">‹ Games</button>
      <div class="brand">Elitists War</div>
      <div class="turn">${s.phase === 'gameOver' ? 'Game over' : `Turn ${s.turn} · ${myTurn(s) ? 'your move' : 'computer\'s turn'}`}</div>
    </header>
    <main class="table">
      <section class="boards">
        ${renderSide(s, rival.id, false)}
        ${renderNwo(s)}
        ${renderSide(s, ui.me, true)}
      </section>
      <aside class="console">
        ${renderConsole(s)}
        ${online ? ordersPanel() : ''}
        ${renderInspect(s)}
        ${renderLog(s)}
      </aside>
      <section class="hand-wrap">
        <div class="hand-head">
          <span class="label">Your hand</span>
          <span class="muted">${plotsInHand(s, ui.me).length} Plots (limit ${handLimit(s, ui.me)} outside your turn) · ${player(s, ui.me).plotDeck.length} Plots and ${player(s, ui.me).groupDeck.length} Groups left in your decks</span>
        </div>
        <div class="hand">${player(s, ui.me).hand.map((iid) => handCard(s, iid)).join('') || '<span class="muted">No cards in hand.</span>'}</div>
      </section>
    </main>`;
  bind();
}

function renderSide(s: GameState, pl: string, mine: boolean): string {
  const p = player(s, pl);
  const cards = structureCards(s, pl);
  const slots = placementSlots(s, pl);
  const xs = [...cards.map((c) => s.cards[c].x!), ...slots.map((x) => x.x)];
  const ys = [...cards.map((c) => s.cards[c].y!), ...slots.map((x) => x.y)];
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cells = cards.map((iid) => {
    const c = s.cards[iid];
    return `<div class="cell" style="grid-column:${c.x! - minX + 1};grid-row:${c.y! - minY + 1}">${tableCard(s, iid)}</div>`;
  });
  // One "+" per empty space; if two open arrows point at the same space, the button offers both.
  const byCell = new Map<string, typeof slots>();
  for (const sl of slots) byCell.set(`${sl.x},${sl.y}`, [...(byCell.get(`${sl.x},${sl.y}`) ?? []), sl]);
  for (const group of byCell.values()) {
    const sl = group[0];
    cells.push(`<button class="cell slot" style="grid-column:${sl.x - minX + 1};grid-row:${sl.y - minY + 1}" data-slot="${group.map((g) => `${g.onto}:${g.side}`).join('|')}" aria-label="Place here">+</button>`);
  }
  const n = goalCount(s, pl), need = goalNeeded(s, pl);
  return `
    <div class="side ${mine ? 'mine' : 'theirs'} ${s.players[s.active].id === pl && s.phase !== 'gameOver' ? 'active' : ''}">
      <div class="side-head">
        <span class="who">${mine ? 'Your Power Structure' : 'Computer'}</span>
        <span class="goal" title="Groups controlled toward the Basic Goal">
          <span class="goal-bar"><span style="width:${Math.min(100, (n / need) * 100)}%"></span></span>
          <b>${n}</b>/${need} Groups
        </span>
        ${mine ? '' : `<span class="muted">${p.hand.filter((i) => def(s, i).type === 'Plot').length} Plots · ${p.hand.filter((i) => def(s, i).type !== 'Plot').length} Groups in hand</span>`}
      </div>
      <div class="board-scroll"><div class="grid" style="grid-template-columns:repeat(${maxX - minX + 1},var(--cell));grid-template-rows:repeat(${maxY - minY + 1},var(--cell))">${cells.join('')}</div></div>
      ${resourcesOf(s, pl).length ? `<div class="res-row"><span class="label">Resources</span>${resourcesOf(s, pl).map((r) => {
        const c = s.cards[r];
        const sel = (ui.sel.kind === 'resource' && ui.sel.iid === r) || (ui.sel.kind === 'link' && ui.sel.resource === r);
        return `<button class="res ${sel ? 'selected' : ''}" data-res="${r}"><b>${esc(cardName(s, r))}</b>${c.tokens ? '<span class="token-inline"></span>' : ''}<span class="muted small">${c.linkedTo && s.cards[c.linkedTo] && def(s, c.linkedTo).type !== 'Illuminati' ? `linked to ${esc(cardName(s, c.linkedTo))}` : 'unlinked'}</span></button>`;
      }).join('')}</div>` : ''}
    </div>`;
}

function placementSlots(s: GameState, pl: string): { x: number; y: number; onto: string; side: Side }[] {
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
  return spots.map((o) => {
    const m = s.cards[o.onto];
    return { x: m.x! + DELTA[o.side][0], y: m.y! + DELTA[o.side][1], ...o };
  });
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
    <button class="card ${ill ? 'ill' : ''} ${c.devastated ? 'devastated' : ''} ${highlightFor(s, iid)}" data-card="${iid}" title="${esc(d.name)}">
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
    <button class="hcard ${isPlot ? 'plot' : 'group'} ${selected ? 'selected' : ''} ${targetable ? 'targetable' : ''} ${isPlot && !playable ? 'inactive' : ''}" data-hand="${iid}">
      <span class="kind">${isPlot ? esc(d.subtype === 'Plot' ? 'Plot' : d.subtype) : d.type === 'Resource' ? 'Resource' : esc(d.subtype)}</span>
      <span class="name">${esc(d.name)}</span>
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

function attackPanel(s: GameState): string {
  const ctx = s.attack!;
  const st = attackStrength(s, ctx);
  const chance = successChance(st.strength);
  const who = ctx.instant ? cardName(s, ctx.instantCard!) : cardName(s, ctx.attacker!);
  const rolled = ctx.roll ? finalRoll(ctx) : undefined;
  return `
    <div class="attack">
      <div class="vs"><b>${esc(who)}</b> <span class="muted">${ctx.instant ? 'strikes' : `attacks to ${ctx.type}`}</span> <b>${esc(cardName(s, ctx.target))}</b></div>
      <div class="meter">
        <div><span class="big">${st.attack}</span><span class="muted">attack</span></div>
        <div class="minus">−</div>
        <div><span class="big">${st.defense}</span><span class="muted">defense</span></div>
        <div class="eq">=</div>
        <div><span class="big accent">${st.strength}</span><span class="muted">needs ≤ ${Math.min(10, st.strength)} on 2d6</span></div>
      </div>
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
    const evText = ev ? ({
      turnStart: `${esc(player(s, ev.player!).name)}'s turn is starting.`,
      drawn: `${esc(player(s, ev.player!).name)} has drawn cards.`,
      takeover: `${esc(player(s, ev.player!).name)} took over ${esc(cardName(s, ev.card!))} automatically.`,
      destroyed: `${esc(cardName(s, ev.card!))} was destroyed.`,
      devastated: `${esc(cardName(s, ev.card!))} was Devastated.`,
      discarded: `${esc(cardName(s, ev.card!))} was discarded.`,
      plotResolved: `${esc(cardName(s, ev.card!))} took effect.`,
      relief: `Relief was sent to ${esc(cardName(s, ev.card!))}.`,
    } as Record<string, string>)[ev.type] : '';
    const head = s.window.kind === 'event' ? `<p>${evText} You have a card that can respond.</p>`
      : s.window.kind === 'plot' ? `<p><b>${esc(cardName(s, s.window.plot!.iid))}</b> was played. You can counter it.</p>`
      : s.window.kind === 'endOfTurn' ? '<p>The turn is ending. Last chance to play a card.</p>'
      : s.window.kind === 'roll' ? '<p>The dice are down. Cards that change rolls can be played now.</p>' : '';
    body = `${s.attack ? attackPanel(s) : ''}${head}
      <div class="opts">${opts.map((o, i) => `<button data-opt="${i}">${esc(o.label)}</button>`).join('')}</div>
      <div class="btns"><button class="primary" data-act="pass">${s.window.kind === 'attack' && s.attack?.attackerPlayer === ui.me ? 'Roll the dice' : 'Pass'}</button>${s.window.kind === 'attack' && s.attack?.attackerPlayer === ui.me && !s.attack.instant && !s.attack.plays.some((pp) => pp.player === ui.me) ? '<button data-act="callOff">Call off the attack</button>' : ''}</div>`;
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
        <button class="linkish" data-act="clear">Cancel</button>
      </div>
      ${abilityButtons(s, sel.iid)}
      ${!canControl && !canDestroy && s.cards[sel.iid].tokens ? `<p class="muted">${s.players.some((p) => p.id !== ui.me && p.turnsTaken < 1) || me.turnsTaken < 1 ? 'No attacks on your rival until you have both finished a turn. You can still attack Groups in your hand to control.' : 'No legal targets right now.'}</p>` : ''}`;
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
      <p>Attack to ${sel.type}: <b>${st.attack}</b> vs <b>${st.defense}</b> → strength <b class="accent">${st.strength}</b>, ${Math.round(successChance(st.strength) * 100)}% before anyone helps or defends.</p>
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
      ${PLOTS[d.id] ? (opts.length ? `<div class="opts">${opts.map((o, i) => `<button data-popt="${i}">${esc(o.label)}</button>`).join('')}</div>` : '<p class="muted">Not playable right now. Some Plots can only be played during an attack or right after a roll.</p>') : '<p class="muted">This card is not in this version of the game yet.</p>'}
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
  return `<div class="panel inspect">
    <div class="label">${esc(d.subtype)}</div><h3>${esc(d.name)}</h3>${stats}
    <p class="small">${esc(d.text)}</p>
    ${pending.length ? `<p class="small warn">Not active yet in this version: ${esc(pending.join('; '))}.</p>` : ''}
    ${d.type === 'Plot' && !PLOTS[d.id] ? '<p class="small warn">This Plot is not in this version yet.</p>' : ''}
    ${d.subtype === 'NWO' && NWO_EFFECTS[d.id] ? '<p class="small muted">In effect for everyone while on the table.</p>' : ''}
  </div>`;
}

function renderLog(s: GameState): string {
  // Private lines (what a player saw with a card) are shown only to that player.
  const lines = s.log.filter((l) => !l.to || l.to === ui.me).slice(-40).reverse();
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
  ui.inspect = iid;
  ui.error = undefined;
  const sel = ui.sel;
  if (sel.kind === 'attack') {
    const opt = attackOptions(s, ui.me, sel.attacker).find((o) => o.target === iid && o.type === sel.type);
    if (opt) { ui.sel = { kind: 'confirm', attacker: sel.attacker, target: iid, type: sel.type, side: opt.sides[0], plots: [] }; render(); return; }
  }
  if (sel.kind === 'link' && s.cards[iid].controller === ui.me) { act({ type: 'link', resource: sel.resource, to: iid }); return; }
  if (idle(s) && s.cards[iid].controller === ui.me && sel.kind !== 'move') {
    ui.sel = { kind: 'group', iid };
  }
  render();
}

function onHandCard(iid: string) {
  const s = ui.game!;
  ui.inspect = iid;
  ui.error = undefined;
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
      case 'home': clearTimeout(timer); ui.game = null; if (online) { online.gameId = undefined; online.channel?.unsubscribe(); loadGames(); } render(); break;
      case 'clear': ui.sel = { kind: 'none' }; ui.error = undefined; render(); break;
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

interface GameSummary { id: string; invite: string; seats: { id: string; name: string; isAI: boolean; joined: boolean }[]; me?: string; started: boolean; finished: boolean; yourMove: boolean; progress: string; illuminati?: string; updatedAt: number }
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
  authMode: 'signin' | 'signup';
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
  online = { client: g.supabase!.createClient(__SB_URL__, __SB_KEY__), name: 'Player', games: [], busy: false, authMode: 'signin' };
  online.client.auth.onAuthStateChange((_e: string, session: { user: { id: string; email: string; user_metadata?: { name?: string } } } | null) => {
    online!.userId = session?.user.id;
    if (session) online!.name = session.user.user_metadata?.name || session.user.email.split('@')[0];
    if (session) loadGames(); else render();
  });
  setInterval(() => { if (online?.gameId) refreshGame(); else if (online?.userId) loadGames(); }, 45_000);
  render();
}

function renderOnline() {
  const o = online!;
  const msg = o.msg ? `<div class="error" role="alert">${esc(o.msg)}</div>` : '';
  if (!o.userId) {
    const up = o.authMode === 'signup';
    app.innerHTML = `<div class="start"><header class="hero"><h1>Elitists War</h1><p>Play online with friends, a move at a time. Sign in so your games follow you to any device.</p></header>
      <form class="panel auth" id="auth">${msg}
        <h2>${up ? 'Create an account' : 'Sign in'}</h2>
        ${up ? '<label>Your name at the table<input id="a-name" required maxlength="24" autocomplete="nickname"></label>' : ''}
        <label>Email<input id="a-email" type="email" required autocomplete="email"></label>
        <label>Password<input id="a-pass" type="password" required minlength="8" autocomplete="${up ? 'new-password' : 'current-password'}"></label>
        <div class="btns"><button class="primary" type="submit" ${o.busy ? 'disabled' : ''}>${up ? 'Create account' : 'Sign in'}</button>
        <button type="button" class="linkish" id="a-switch">${up ? 'I already have an account' : 'New here? Create an account'}</button></div>
      </form></div>`;
    app.querySelector<HTMLFormElement>('#auth')!.onsubmit = async (e) => {
      e.preventDefault();
      const email = (app.querySelector('#a-email') as HTMLInputElement).value.trim();
      const password = (app.querySelector('#a-pass') as HTMLInputElement).value;
      o.busy = true; o.msg = undefined; render();
      if (up) {
        const name = (app.querySelector('#a-name') as HTMLInputElement).value.trim();
        const { data, error } = await o.client.auth.signUp({ email, password, options: { data: { name } } });
        o.msg = error ? error.message : data.session ? undefined : 'Check your email and click the confirmation link, then sign in here.';
        if (!error && !data.session) o.authMode = 'signin';
      } else {
        const { error } = await o.client.auth.signInWithPassword({ email, password });
        if (error) o.msg = error.message === 'Email not confirmed' ? 'Confirm your email first: open the link we sent you, then sign in.' : error.message;
      }
      o.busy = false; render();
    };
    app.querySelector<HTMLElement>('#a-switch')!.onclick = () => { o.authMode = up ? 'signin' : 'signup'; o.msg = undefined; render(); };
    return;
  }
  // Waiting room for a game whose seats are not all filled.
  if (o.gameId && o.summary && !o.summary.started) {
    app.innerHTML = `<div class="start"><header class="bar"><button class="linkish" data-o="lobby">‹ Games</button><div class="brand">Elitists War</div></header>
      <section class="panel"><h2>Waiting for players</h2>
      <p>Send your friends this invite code. The game starts as soon as every seat is filled.</p>
      <div class="invite"><code id="code">${esc(o.summary.invite)}</code><button data-o="copy">Copy code</button></div>
      <ul class="seats">${o.summary.seats.map((x) => `<li>${esc(x.isAI ? 'Computer' : x.name)} ${x.joined ? '✓' : '<span class="muted">(waiting)</span>'}</li>`).join('')}</ul></section></div>`;
    bindOnline();
    return;
  }
  const pick = (ui as Ui & { pick?: string }).pick ?? 'bavarian-illuminati';
  app.innerHTML = `<div class="start">
    <header class="bar"><div class="brand">Elitists War</div><div class="turn">${esc(o.name)} · <button class="linkish" data-o="signout">Sign out</button></div></header>
    ${msg}
    <section><div class="label">Your games</div><div class="saves">${o.games.map((g) => `
      <div class="save"><button data-open="${g.id}"><b>${g.yourMove ? '● Your move — ' : ''}${esc(g.seats.map((x) => x.isAI ? 'Computer' : x.name).join(' vs '))}</b>
      <span class="muted">${g.finished ? 'Finished' : g.started ? `${esc(g.illuminati ?? '')} · ${esc(g.progress)}` : `Waiting for players · invite ${esc(g.invite)}`}</span></button></div>`).join('') || '<p class="muted">No games yet.</p>'}</div></section>
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

function bindOnline() {
  const o = online!;
  app.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.onclick = () => openGame(b.dataset.open!));
  app.querySelectorAll<HTMLElement>('[data-o]').forEach((b) => b.onclick = async () => {
    const what = b.dataset.o;
    if (what === 'signout') { await o.client.auth.signOut(); o.games = []; }
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
