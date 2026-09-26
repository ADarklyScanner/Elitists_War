// The card library: every card in the game, searchable and filterable, with its full face.
// Like the rulebook reader it lives in its own element on <body>, so a game can keep running underneath.
import { ALL_CARDS } from '../engine/cards';
import type { CardDef, Side } from '../engine/types';
import { cardFace } from './cardFace';

let root: HTMLElement | null = null;
let lastFocus: Element | null = null;

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** The kinds a player thinks in, not the data's type/subtype pairs. */
const KINDS: { id: string; label: string; test: (d: CardDef) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'ill', label: 'Illuminati', test: (d) => d.type === 'Illuminati' },
  { id: 'group', label: 'Groups', test: (d) => d.type === 'Group' },
  { id: 'res', label: 'Resources', test: (d) => d.type === 'Resource' },
  { id: 'plot', label: 'Plots', test: (d) => d.type === 'Plot' && !['Goal', 'NWO', 'Disaster', 'Assassination'].includes(d.subtype) },
  { id: 'goal', label: 'Goals', test: (d) => d.subtype === 'Goal' },
  { id: 'nwo', label: 'New World Orders', test: (d) => d.subtype === 'NWO' },
  { id: 'hit', label: 'Disasters & Assassinations', test: (d) => d.subtype === 'Disaster' || d.subtype === 'Assassination' },
];
const kindOf = (d: CardDef) => KINDS.slice(1).find((k) => k.test(d))!;
const kindLabel = (d: CardDef) =>
  d.type === 'Group' ? (d.subtype === 'Promo' ? 'Group' : d.subtype) : d.subtype === 'NWO' ? 'New World Order' : d.subtype === 'Plot' ? 'Plot' : d.subtype || d.type;

const ALIGNS = [...new Set(ALL_CARDS.flatMap((d) => d.alignments ?? []))].sort();
const ATTRS = [...new Set(ALL_CARDS.flatMap((d) => d.attributes ?? []))].sort();
const CARDS = [...ALL_CARDS].sort((a, b) => a.name.localeCompare(b.name));

interface View { q: string; kind: string; align: string; attr: string; sort: 'name' | 'power' | 'resistance' }
const KEY = 'elitists-war.library';
let view: View = { q: '', kind: 'all', align: '', attr: '', sort: 'name' };
try { Object.assign(view, JSON.parse(localStorage.getItem(KEY) || '{}'), { q: '' }); } catch { /* storage unavailable: defaults */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ...view, q: '' })); } catch { /* ignore */ } };

let shown: CardDef[] = CARDS;
let open: string | undefined;

function matches(d: CardDef): boolean {
  if (!KINDS.find((k) => k.id === view.kind)!.test(d)) return false;
  if (view.align && !(d.alignments ?? []).includes(view.align)) return false;
  if (view.attr && !(d.attributes ?? []).includes(view.attr)) return false;
  const q = view.q.trim().toLowerCase();
  if (!q) return true;
  const f = cardFace(d.id);
  return [d.name, kindLabel(d), ...(d.alignments ?? []), ...(d.attributes ?? []), f?.rules, f?.goal, f?.flavor, d.text]
    .some((t) => t?.toLowerCase().includes(q));
}

function filtered(): CardDef[] {
  const list = CARDS.filter(matches);
  const num = (d: CardDef) => (view.sort === 'power' ? d.power : d.resistance) ?? -1;
  return view.sort === 'name' ? list : [...list].sort((a, b) => num(b) - num(a) || a.name.localeCompare(b.name));
}

/** Little triangles on the tile edges: the control arrows, pointing out (or in, for the incoming one). */
function arrows(d: CardDef): string {
  const out = new Set<Side>(d.arrowsOut ?? []);
  const sides: Side[] = ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'];
  return sides.map((s) => out.has(s) ? `<i class="cl-ar out ${s.toLowerCase()}"></i>` : d.arrowIn === s ? `<i class="cl-ar in ${s.toLowerCase()}"></i>` : '').join('');
}

const stats = (d: CardDef) => d.type === 'Illuminati'
  ? `<span class="cl-pw">${d.power}/${d.globalPower}</span>`
  : d.type === 'Group'
    ? `<span class="cl-pw">${d.power ?? '–'}${d.globalPower ? `/${d.globalPower}` : ''}</span><span class="cl-rs">${d.resistance ?? '–'}</span>`
    : '';

function tile(d: CardDef): string {
  const k = kindOf(d).id;
  return `<button class="cl-card k-${k}" data-cl-open="${d.id}" aria-label="${esc(d.name)}, ${esc(kindLabel(d))}">
    ${arrows(d)}
    <span class="cl-kind">${esc(kindLabel(d))}</span>
    <b class="cl-name">${esc(d.name)}</b>
    ${d.alignments?.length ? `<span class="cl-al">${d.alignments.map(esc).join(' · ')}</span>` : ''}
    ${d.type !== 'Group' && d.type !== 'Illuminati' ? `<span class="cl-snip">${esc(cardFace(d.id)?.rules || d.text)}</span>` : ''}
    <span class="cl-stats">${stats(d)}</span>
  </button>`;
}

function listHtml(): string {
  shown = filtered();
  return shown.length ? shown.map(tile).join('') : '<p class="cl-none">No card matches. Try fewer filters.</p>';
}

function detailHtml(d: CardDef): string {
  const f = cardFace(d.id);
  const i = shown.findIndex((c) => c.id === d.id);
  const prev = shown[i - 1], next = shown[i + 1];
  const row = (k: string, v: string | number | undefined | null) => v === undefined || v === null || v === '' ? '' : `<tr><th>${k}</th><td>${typeof v === 'number' ? v : esc(v)}</td></tr>`;
  const side = (s: Side) => s[0] + s.slice(1).toLowerCase();
  const isGroup = d.type === 'Group' || d.type === 'Illuminati';
  return `<div class="cl-sheet" role="dialog" aria-modal="true" aria-label="${esc(d.name)}">
    <div class="cl-sheet-top">
      <button class="cl-nav" data-cl-open="${prev?.id ?? ''}" ${prev ? '' : 'disabled'} aria-label="Previous card">‹</button>
      <span class="cl-pos">${i + 1} of ${shown.length}</span>
      <button class="cl-nav" data-cl-open="${next?.id ?? ''}" ${next ? '' : 'disabled'} aria-label="Next card">›</button>
      <button class="cl-x" data-cl-shut aria-label="Close card">✕</button>
    </div>
    <div class="cl-detail">
      <div class="cl-big">${tile(d).replace('<button', '<div').replace('</button>', '</div>').replace(/ data-cl-open="[^"]*"/, '')}</div>
      <div class="cl-info">
        <div class="cl-kicker">${esc(kindLabel(d))}${d.rarity && !/fixed/i.test(d.rarity) ? ` · ${esc(d.rarity)}` : ''}</div>
        <h2>${esc(d.name)}</h2>
        ${f?.rules ? `<p class="face-rules">${esc(f.rules)}</p>` : isGroup ? '<p class="face-rules muted">No special ability: its numbers say it all.</p>' : ''}
        ${f?.goal ? `<p class="face-goal"><b>Special Goal:</b> ${esc(f.goal.replace(/^Special Goal:\s*/i, ''))}</p>` : ''}
        ${f?.flavor ? `<p class="face-flavor">${esc(f.flavor)}</p>` : ''}
        ${isGroup ? `<table class="cl-table">
          ${row('Power', d.type === 'Illuminati' || d.globalPower ? `${d.power} (Global ${d.globalPower ?? 0})` : d.power)}
          ${row('Resistance', d.resistance)}
          ${row('Alignments', (d.alignments ?? []).join(', ') || 'None')}
          ${row('Attributes', (d.attributes ?? []).join(', ') || 'None')}
          ${row('Arrows', `${(d.arrowsOut ?? []).length} out${d.arrowsOut?.length ? ` (${d.arrowsOut.map(side).join(', ')})` : ''}${d.arrowIn ? `; incoming ${side(d.arrowIn)}` : ''}`)}
        </table>` : ''}
        <details class="face-exact"><summary>Exact rules wording</summary><p class="small">${esc(d.text)}</p></details>
      </div>
    </div>
  </div>`;
}

function shell(): string {
  const chip = (k: typeof KINDS[number]) => `<button class="cl-chip ${view.kind === k.id ? 'on' : ''}" data-cl-kind="${k.id}">${esc(k.label)}</button>`;
  const opt = (v: string, cur: string) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`;
  return `<header class="rb-bar">
      <button class="rb-close" data-cl-close aria-label="Close the card library">‹ Back</button>
      <div class="rb-brand">Cards</div>
      <label class="rb-search"><span class="sr-only">Search the cards</span><input type="search" id="cl-q" placeholder="Search names and card text…" autocomplete="off" spellcheck="false"></label>
    </header>
    <div class="cl-wrap">
      <div class="cl-filters">
        <div class="cl-chips" role="group" aria-label="Card kind">${KINDS.map(chip).join('')}</div>
        <div class="cl-selects">
          <label>Alignment <select id="cl-align"><option value="">Any</option>${ALIGNS.map((a) => opt(a, view.align)).join('')}</select></label>
          <label>Attribute <select id="cl-attr"><option value="">Any</option>${ATTRS.map((a) => opt(a, view.attr)).join('')}</select></label>
          <label>Sort <select id="cl-sort">${[['name', 'Name'], ['power', 'Power'], ['resistance', 'Resistance']].map(([v, t]) => `<option value="${v}" ${view.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        </div>
      </div>
      <p class="cl-count" aria-live="polite"></p>
      <div class="cl-grid"></div>
    </div>
    <div class="cl-detail-host"></div>`;
}

function refresh() {
  if (!root) return;
  root.querySelector('.cl-grid')!.innerHTML = listHtml();
  root.querySelector('.cl-count')!.textContent = `${shown.length} of ${CARDS.length} cards`;
  root.querySelectorAll<HTMLElement>('[data-cl-kind]').forEach((b) => b.classList.toggle('on', b.dataset.clKind === view.kind));
}

function showCard(id?: string) {
  if (!root) return;
  open = id || undefined;
  const host = root.querySelector<HTMLElement>('.cl-detail-host')!;
  const d = open ? CARDS.find((c) => c.id === open) : undefined;
  host.innerHTML = d ? `<div class="cl-scrim" data-cl-shut></div>${detailHtml(d)}` : '';
  root.classList.toggle('cl-has-detail', !!d);
  if (d) host.querySelector<HTMLElement>('.cl-x')!.focus({ preventScroll: true });
  else root.querySelector<HTMLElement>(`.cl-grid [data-cl-open="${CSS.escape(lastOpen ?? '')}"]`)?.focus({ preventScroll: true });
  if (d) lastOpen = d.id;
}
let lastOpen: string | undefined;

/** Open the library, optionally straight at one card. */
export function openLibrary(cardId?: string) {
  if (!root) {
    lastFocus = document.activeElement;
    root = document.createElement('div');
    root.className = 'rb cl';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Card library');
    root.innerHTML = shell();
    document.body.append(root);
    document.documentElement.classList.add('rb-open');
    const input = root.querySelector<HTMLInputElement>('#cl-q')!;
    let t: ReturnType<typeof setTimeout> | undefined;
    input.oninput = () => { clearTimeout(t); t = setTimeout(() => { view.q = input.value; refresh(); }, 120); };
    const sel = (id: string, k: 'align' | 'attr' | 'sort') => {
      root!.querySelector<HTMLSelectElement>(id)!.onchange = (e) => { (view as unknown as Record<string, string>)[k] = (e.target as HTMLSelectElement).value; save(); refresh(); };
    };
    sel('#cl-align', 'align'); sel('#cl-attr', 'attr'); sel('#cl-sort', 'sort');
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cl-kind],[data-cl-open],[data-cl-close],[data-cl-shut]');
      if (!el) return;
      if (el.dataset.clKind) { view.kind = el.dataset.clKind; save(); refresh(); }
      else if (el.dataset.clOpen !== undefined) { if (el.dataset.clOpen) showCard(el.dataset.clOpen); }
      else if (el.hasAttribute('data-cl-close')) closeLibrary();
      else showCard();
    });
    refresh();
    root.querySelector<HTMLElement>('.rb-close')!.focus({ preventScroll: true });
  }
  if (cardId) showCard(cardId);
}

export function closeLibrary() {
  root?.remove();
  root = null;
  open = undefined;
  document.documentElement.classList.remove('rb-open');
  (lastFocus as HTMLElement | null)?.focus?.({ preventScroll: true });
}

export const libraryOpen = () => !!root;

// Any element with data-cards opens the library: "" for the whole list, or a card id.
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-cards]');
    if (!el || root?.contains(el)) return;
    e.preventDefault();
    openLibrary(el.dataset.cards || undefined);
  });
  document.addEventListener('keydown', (e) => {
    if (!root) return;
    if (e.key === 'Escape') { if (open) showCard(); else closeLibrary(); }
    else if (open && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const i = shown.findIndex((c) => c.id === open);
      const n = shown[i + (e.key === 'ArrowRight' ? 1 : -1)];
      if (n) showCard(n.id);
    }
  });
}
