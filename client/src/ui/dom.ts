import { sfx } from '../audio';

export const ui = () => document.getElementById('ui')!;

export const icons = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  world: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20l6-10 4 6 3-4 5 8z"/></svg>',
  load: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h6l2 2h8v10H4z"/></svg>',
  join: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M18 8v6M15 11h6"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 5l-7 7 7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h8l4 4v14H6zM14 3v4h4"/></svg>',
};

export function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let uiOpenHook: (open: boolean) => void = () => {};
export function onUiOpenChange(fn: (open: boolean) => void) {
  uiOpenHook = fn;
}
export function refreshUiOpen(base = false) {
  uiOpenHook(base || !!document.querySelector('.sheet-backdrop'));
}

let toastTimer = 0;
export function toast(msg: string, tone: 'ok' | 'warn' | 'info' = 'ok') {
  document.querySelector('.toast')?.remove();
  const t = el(`<div class="toast panel ${tone}">${esc(msg)}</div>`);
  ui().append(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 2600);
}

export interface Sheet extends HTMLElement {
  close(): void;
  body: HTMLElement;
}

/** Ein Dialog-Panel mit Titel, Zurück-Knopf und Inhalt. */
export function sheet(title: string, body: string, opts: { onClose?: () => void; wide?: boolean; id?: string } = {}): Sheet {
  if (opts.id) document.querySelector(`[data-sheet="${opts.id}"]`)?.remove();
  const s = el(`
    <div class="sheet-backdrop" ${opts.id ? `data-sheet="${opts.id}"` : ''}>
      <div class="sheet panel ${opts.wide ? 'sheet-wide' : ''}" role="dialog" aria-label="${esc(title)}">
        <div class="sheet-head">
          <button class="btn btn-icon" data-close aria-label="Schließen">${icons.close}</button>
          <h2>${esc(title)}</h2>
        </div>
        <div data-body>${body}</div>
      </div>
    </div>`) as Sheet;
  s.body = s.querySelector('[data-body]') as HTMLElement;
  let closed = false;
  s.close = () => {
    if (closed) return;
    closed = true;
    s.remove();
    refreshUiOpen();
    opts.onClose?.();
  };
  s.querySelector('[data-close]')!.addEventListener('click', () => {
    sfx.ui('tap');
    s.close();
  });
  s.addEventListener('pointerdown', (e) => e.target === s && s.close());
  ui().append(s);
  refreshUiOpen();
  return s;
}

export function closeSheets() {
  document.querySelectorAll<Sheet>('.sheet-backdrop').forEach((s) => (s.close ? s.close() : s.remove()));
}
