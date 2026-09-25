// The full-screen rulebook reader: contents, search, section navigation and back to top.
// It lives in its own element on <body>, outside #app, so the game can keep redrawing underneath it.
import { PARTS, RULEBOOK } from './rulebook';

let root: HTMLElement | null = null;
let lastFocus: Element | null = null;

const escText = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function readerHtml(): string {
  const toc = PARTS.map((part) => {
    const items = RULEBOOK.filter((s) => s.part === part);
    return `<li class="rb-part"><span>${escText(part)}</span><ol>${items.map((s) => `<li data-toc="${s.id}"><a href="#rb-${s.id}" data-rb-goto="${s.id}">${escText(s.title)}</a></li>`).join('')}</ol></li>`;
  }).join('');
  const sections = RULEBOOK.map((s, i) => {
    const prev = RULEBOOK[i - 1], next = RULEBOOK[i + 1];
    return `<section class="rb-sec" id="rb-${s.id}" data-sec="${s.id}">
      <div class="rb-kicker">${escText(s.part)}</div>
      <h2>${escText(s.title)}</h2>
      <div class="rb-text">${s.body}</div>
      <nav class="rb-pager" aria-label="Section navigation">
        ${prev ? `<a href="#rb-${prev.id}" data-rb-goto="${prev.id}" class="rb-prev">‹ ${escText(prev.title)}</a>` : '<span></span>'}
        <a href="#rb-contents" data-rb-goto="contents" class="rb-up">Contents</a>
        ${next ? `<a href="#rb-${next.id}" data-rb-goto="${next.id}" class="rb-next">${escText(next.title)} ›</a>` : '<span></span>'}
      </nav></section>`;
  }).join('');
  return `<header class="rb-bar">
      <button class="rb-close" data-rb-close aria-label="Close the rulebook">‹ Back</button>
      <div class="rb-brand">Rulebook</div>
      <label class="rb-search"><span class="sr-only">Search the rules</span><input type="search" id="rb-q" placeholder="Search the rules…" autocomplete="off" spellcheck="false"></label>
      <button class="rb-toc-btn" data-rb-toc aria-expanded="false" aria-controls="rb-toc">Contents</button>
    </header>
    <div class="rb-layout">
      <nav class="rb-toc" id="rb-toc" aria-label="Contents"><ol>${toc}</ol></nav>
      <main class="rb-main">
        <header class="rb-cover" id="rb-contents">
          <h1>The Rulebook</h1>
          <p>The complete rules of the card game this app is based on, in plain words, with notes wherever the app plays differently. Learn them here and you can sit down at a real table.</p>
          <ol class="rb-cover-toc">${RULEBOOK.map((s) => `<li data-toc="${s.id}"><a href="#rb-${s.id}" data-rb-goto="${s.id}"><b>${escText(s.title)}</b><span>${escText(s.blurb)}</span></a></li>`).join('')}</ol>
        </header>
        <p class="rb-found" aria-live="polite" hidden></p>
        ${sections}
        <p class="rb-end">End of the rulebook.</p>
      </main>
    </div>
    <button class="rb-top" data-rb-top aria-label="Back to top" hidden>↑ Top</button>`;
}

/** Wrap every match of the query in <mark>, touching text only (never tags or attributes). */
function highlight(el: HTMLElement, q: string) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const hits: Text[] = [];
  const lower = q.toLowerCase();
  while (walker.nextNode()) { const n = walker.currentNode as Text; if (n.data.toLowerCase().includes(lower)) hits.push(n); }
  for (const n of hits) {
    const frag = document.createDocumentFragment();
    let rest = n.data;
    for (let i = rest.toLowerCase().indexOf(lower); i >= 0; i = rest.toLowerCase().indexOf(lower)) {
      frag.append(rest.slice(0, i));
      const m = document.createElement('mark');
      m.textContent = rest.slice(i, i + q.length);
      frag.append(m);
      rest = rest.slice(i + q.length);
    }
    frag.append(rest);
    n.replaceWith(frag);
  }
}

function search(q: string) {
  if (!root) return;
  const query = q.trim();
  const found = root.querySelector<HTMLElement>('.rb-found')!;
  const cover = root.querySelector<HTMLElement>('.rb-cover')!;
  let shown = 0;
  for (const s of RULEBOOK) {
    const el = root.querySelector<HTMLElement>(`[data-sec="${s.id}"]`)!;
    const text = el.querySelector<HTMLElement>('.rb-text')!;
    text.innerHTML = s.body; // clear old highlights
    const hit = !query || `${s.title} ${s.part} ${text.textContent ?? ''}`.toLowerCase().includes(query.toLowerCase());
    el.hidden = !hit;
    root.querySelectorAll<HTMLElement>(`[data-toc="${s.id}"]`).forEach((li) => { li.hidden = !hit; });
    if (hit) { shown++; if (query) highlight(text, query); }
  }
  cover.classList.toggle('searching', !!query);
  root.querySelectorAll<HTMLElement>('.rb-part').forEach((p) => { p.hidden = !Array.from(p.querySelectorAll<HTMLElement>("[data-toc]")).some((li) => !li.hidden); });
  found.hidden = !query;
  found.textContent = query ? (shown ? `${shown} section${shown === 1 ? '' : 's'} mention “${query}”.` : `No section mentions “${query}”.`) : '';
  if (query) root.querySelector<HTMLElement>('.rb-main')!.scrollIntoView({ block: 'start' });
}

function goTo(id: string) {
  if (!root) return;
  root.classList.remove('toc-open');
  const tocBtn = root.querySelector<HTMLElement>('[data-rb-toc]');
  if (tocBtn) { tocBtn.setAttribute('aria-expanded', 'false'); tocBtn.textContent = 'Contents'; }
  const target = id === 'contents' ? root.querySelector<HTMLElement>('#rb-contents') : root.querySelector<HTMLElement>(`#rb-${id}`);
  if (!target) return;
  if (target.hidden) { (root.querySelector('#rb-q') as HTMLInputElement).value = ''; search(''); }
  target.scrollIntoView({ block: 'start' });
  root.querySelectorAll('.rb-toc a.on').forEach((a) => a.classList.remove('on'));
  root.querySelector(`.rb-toc [data-toc="${id}"] a`)?.classList.add('on');
}

/** Open the reader, optionally at one section. */
export function openRulebook(sectionId?: string) {
  if (!root) {
    lastFocus = document.activeElement;
    root = document.createElement('div');
    root.className = 'rb';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Rulebook');
    root.innerHTML = readerHtml();
    document.body.append(root);
    document.documentElement.classList.add('rb-open');
    const input = root.querySelector<HTMLInputElement>('#rb-q')!;
    let t: ReturnType<typeof setTimeout> | undefined;
    input.oninput = () => { clearTimeout(t); t = setTimeout(() => search(input.value), 120); };
    input.onkeydown = (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; search(''); } };
    const top = root.querySelector<HTMLElement>('[data-rb-top]')!;
    root.addEventListener('scroll', () => { top.hidden = root!.scrollTop < 500; }, { passive: true });
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-rb-goto],[data-rb-close],[data-rb-top],[data-rb-toc]');
      if (!el) return;
      e.preventDefault();
      if (el.dataset.rbGoto) goTo(el.dataset.rbGoto);
      else if (el.hasAttribute('data-rb-close')) closeRulebook();
      else if (el.hasAttribute('data-rb-top')) root!.scrollTo({ top: 0 });
      else { const open = root!.classList.toggle('toc-open'); el.setAttribute('aria-expanded', String(open)); el.textContent = open ? 'Close' : 'Contents'; root!.scrollTo({ top: 0 }); }
    });
    root.querySelector<HTMLElement>('.rb-close')!.focus({ preventScroll: true });
  }
  if (sectionId) goTo(sectionId); else root.scrollTo({ top: 0 });
}

export function closeRulebook() {
  root?.remove();
  root = null;
  document.documentElement.classList.remove('rb-open');
  (lastFocus as HTMLElement | null)?.focus?.({ preventScroll: true });
}

export const rulebookOpen = () => !!root;

// Any element with data-rulebook opens the reader: "" for the start, or a section id.
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-rulebook]');
    if (!el || root?.contains(el)) return;
    e.preventDefault();
    openRulebook(el.dataset.rulebook || undefined);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root) closeRulebook(); });
}
