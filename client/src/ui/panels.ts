import {
  ELEMENT_NAMES, HAENDLER_STOCK, ITEMS, ITEM_KEYS, RECIPES, SCHWARZMARKT_STOCK, SKILLS, UPGRADE_COST, WEAPONS, BUY_FACTOR, SELL_FACTOR,
  buildTalkessel, isNight, type ItemKey, type Level, type Snapshot, type StationKind, type WeaponInst,
} from '@zkw/shared';
import { sfx } from '../audio';
import type { Session } from '../net/session';
import { el, esc, icons, refreshUiOpen, sheet, toast, type Sheet } from './dom';
import { store } from './store';

let level: Level | undefined;
const getLevel = () => (level ??= buildTalkessel());

export interface PanelCtx {
  session: Session;
  snapshot: () => Snapshot | undefined;
}

const money = (n: number) => `${Math.round(n).toLocaleString('de-DE')} ¢`;
const stars = (t: number) => '★'.repeat(t) + '☆'.repeat(5 - t);

function needsHtml(needs: Partial<Record<ItemKey, number>>, have: Partial<Record<ItemKey, number>>) {
  return (Object.entries(needs) as [ItemKey, number][])
    .map(([k, n]) => `<span class="need ${(have[k] ?? 0) >= n ? 'ok' : 'miss'}">${n}× ${esc(ITEMS[k].name)} <small>(${have[k] ?? 0})</small></span>`)
    .join(' ');
}

function weaponCard(w: WeaponInst, extra = '') {
  const def = WEAPONS[w.def];
  return `<div class="wcard">
    <div><strong>${esc(def.name)}</strong> <span class="stars">${stars(w.tier)}</span>${w.element ? ` <span class="elem e${w.element}">${ELEMENT_NAMES[w.element]}</span>` : ''}</div>
    <div class="hint">${def.kind === 'melee' ? 'Nahkampf' : `${w.mag} / ${w.reserve} Schuss`} · Schaden ${Math.round(def.damage * (1 + (w.tier - 1) * 0.12))}${def.pellets > 1 ? ` ×${def.pellets}` : ''}</div>
    ${extra}
  </div>`;
}

/** Hält ein Panel aktuell, solange es offen ist. */
function live(s: Sheet, render: () => void) {
  render();
  const unsub = store.subscribe(render);
  const obs = new MutationObserver(() => {
    if (!s.isConnected) {
      unsub();
      obs.disconnect();
    }
  });
  obs.observe(document.getElementById('ui')!, { childList: true });
}

function act(ctx: PanelCtx, action: unknown) {
  sfx.ui('tap');
  ctx.session.sendAction(action);
}

// =================== Stationen ===================

const STATION_TITLES: Record<StationKind, string> = {
  werkbank: 'Werkbank',
  labor: 'Waffenlabor',
  kueche: 'Küche',
  training: 'Trainingsraum',
  haendler: 'Händler',
  schwarzmarkt: 'Schwarzmarkt',
  funk: 'Funkgerät – Schnellreise',
  schliessfach: 'Schließfach',
};

export function openStation(ctx: PanelCtx, kind: StationKind) {
  const s = sheet(STATION_TITLES[kind], '', { wide: true, id: 'station' });
  const render = () => {
    const me = store.me;
    if (!me) return;
    let html = `<div class="row money-row"><span class="pill">${money(me.money)}</span>${kind === 'training' ? `<span class="pill ${me.skillPoints ? 'accent' : ''}">${me.skillPoints} Skillpunkt(e)${me.skillPoints ? '' : ' – mehr gibt es mit jedem Level'}</span>` : ''}</div>`;
    const discount = 1 - 0.1 * (me.skills.feilschen ?? 0);
    if (kind === 'werkbank' || kind === 'labor' || kind === 'kueche') {
      const recipes = RECIPES.filter((r) => r.stations.includes(kind));
      html += `<h3>Herstellen</h3><div class="list">${recipes
        .map((r) => {
          const can = (Object.entries(r.needs) as [ItemKey, number][]).every(([k, n]) => (me.items[k] ?? 0) >= n);
          const locked = (me.skills.basteln ?? 0) < r.craftTier;
          return `<div class="lrow"><div><strong>${r.qty}× ${esc(ITEMS[r.out].name)}</strong><div class="hint">${needsHtml(r.needs, me.items)}${locked ? ` · <span class="miss">braucht „Basteln“ Stufe ${r.craftTier}</span>` : ''}</div></div>
            <button class="btn btn-small ${can && !locked ? 'btn-primary' : ''}" data-craft="${r.key}" ${can && !locked ? '' : 'disabled'}>Herstellen</button></div>`;
        })
        .join('')}</div>`;
    }
    if (kind === 'werkbank' || kind === 'labor') {
      const all = [...me.weapons.map((w) => ({ w, where: 'Rucksack' })), ...me.locker.weapons.map((w) => ({ w, where: 'Schließfach' }))];
      html += `<h3>Waffen verbessern</h3><div class="list">${all
        .map(({ w, where }) => {
          if (w.tier >= 5) return weaponCard(w, `<div class="hint">Höchste Stufe erreicht · ${where}</div>`);
          const next = w.tier + 1;
          const cost = UPGRADE_COST[next];
          const labOnly = next >= 4 && kind !== 'labor';
          const can = !labOnly && me.money >= cost.money * discount && (Object.entries(cost.items) as [ItemKey, number][]).every(([k, n]) => (me.items[k] ?? 0) >= n);
          const elemBtns =
            kind === 'labor'
              ? `<div class="row">${([1, 2, 3] as const)
                  .map((e) => {
                    const core = (['', 'kern_feuer', 'kern_elektro', 'kern_frost'] as const)[e] as ItemKey;
                    const have = (me.items[core] ?? 0) > 0;
                    return `<button class="btn btn-small" data-elem="${w.uid}:${e}" ${have && w.element !== e && where === 'Rucksack' ? '' : 'disabled'}>${ELEMENT_NAMES[e]} (${me.items[core] ?? 0})</button>`;
                  })
                  .join('')}</div>`
              : '';
          return weaponCard(
            w,
            `<div class="hint">${where} · Stufe ${next}: ${money(cost.money * discount)} + ${needsHtml(cost.items, me.items)}${labOnly ? ' · <span class="miss">nur im Waffenlabor</span>' : ''}</div>
             <div class="row"><button class="btn btn-small ${can ? 'btn-primary' : ''}" data-up="${w.uid}" ${can ? '' : 'disabled'}>Auf Stufe ${next}</button></div>${elemBtns}`,
          );
        })
        .join('')}</div>`;
    }
    if (kind === 'training') {
      const trees = ['Kampf', 'Überleben', 'Technik', 'Team'] as const;
      html += `<div class="skill-grid">${trees
        .map(
          (tree) => `<div class="skill-col"><h3>${tree}</h3>${SKILLS.filter((k) => k.tree === tree)
            .map((k) => {
              const cur = me.skills[k.key] ?? 0;
              const can = me.skillPoints > 0 && cur < k.max;
              return `<div class="skill"><div><strong>${esc(k.name)}</strong> <span class="hint">${cur}/${k.max}</span><div class="hint">${esc(k.desc)}</div></div>
                <button class="btn btn-icon btn-small ${can ? 'btn-primary' : ''}" data-skill="${k.key}" ${can ? '' : 'disabled'} aria-label="${esc(k.name)} verbessern">+</button></div>`;
            })
            .join('')}</div>`,
        )
        .join('')}</div>`;
    }
    if (kind === 'haendler' || kind === 'schwarzmarkt') {
      const stock = kind === 'haendler' ? HAENDLER_STOCK : SCHWARZMARKT_STOCK;
      const mul = discount * (kind === 'schwarzmarkt' ? 1.4 : 1);
      const night = isNight(ctx.snapshot()?.hour ?? 12);
      if (kind === 'schwarzmarkt' && !night) html += `<p class="hint">Der Schwarzmarkt öffnet erst nachts.</p>`;
      html += `<div class="two-col"><div><h3>Kaufen</h3><div class="list">${stock
        .map((k) => {
          const price = ITEMS[k].value * BUY_FACTOR * mul;
          return `<div class="lrow"><div><strong>${esc(ITEMS[k].name)}</strong><div class="hint">${money(price)} · du hast ${me.items[k] ?? 0}</div></div>
          <div class="row"><button class="btn btn-small" data-buy="${k}:1" ${me.money >= price ? '' : 'disabled'}>1</button><button class="btn btn-small" data-buy="${k}:5" ${me.money >= price * 5 ? '' : 'disabled'}>5</button></div></div>`;
        })
        .join('')}</div></div><div><h3>Verkaufen</h3><div class="list">${ITEM_KEYS.filter((k) => (me.items[k] ?? 0) > 0 && ITEMS[k].kind !== 'key')
        .map(
          (k) => `<div class="lrow"><div><strong>${esc(ITEMS[k].name)}</strong><div class="hint">${me.items[k]}× · je ${money(ITEMS[k].value * SELL_FACTOR)}</div></div>
          <div class="row"><button class="btn btn-small" data-sell="${k}:1">1</button><button class="btn btn-small" data-sell="${k}:${me.items[k]}">Alle</button></div></div>`,
        )
        .join('') || '<p class="hint">Nichts zu verkaufen.</p>'}</div></div></div>`;
    }
    if (kind === 'funk') {
      const snap = ctx.snapshot();
      html += `<p class="hint">Reise zu einer anderen freigeschalteten Zuflucht · 100 ¢</p><div class="list">${getLevel()
        .safeZones.map((z) => {
          const open = z.door < 0 || ((snap?.doorsOpen ?? 0) & (1 << z.door)) !== 0;
          return `<div class="lrow"><div><strong>${esc(z.name)}</strong><div class="hint">${open ? 'erreichbar' : 'noch verschlossen'}</div></div>
          <button class="btn btn-small ${open ? 'btn-primary' : ''}" data-travel="${z.id}" ${open ? '' : 'disabled'}>Reisen</button></div>`;
        })
        .join('')}</div>`;
    }
    if (kind === 'schliessfach') {
      html += `<div class="two-col"><div><h3>Rucksack</h3><div class="list">${me.weapons
        .map((w) => weaponCard(w, `<button class="btn btn-small" data-wput="${w.uid}" ${me.weapons.length > 1 ? '' : 'disabled'}>Einlagern →</button>`))
        .join('')}${ITEM_KEYS.filter((k) => (me.items[k] ?? 0) > 0 && ITEMS[k].kind !== 'key')
        .map((k) => `<div class="lrow"><span>${me.items[k]}× ${esc(ITEMS[k].name)}</span><button class="btn btn-small" data-iput="${k}">→</button></div>`)
        .join('')}</div></div>
        <div><h3>Schließfach</h3><div class="list">${me.locker.weapons
          .map((w) => weaponCard(w, `<button class="btn btn-small" data-wtake="${w.uid}" ${me.weapons.length < 3 ? '' : 'disabled'}>← Nehmen</button>`))
          .join('')}${ITEM_KEYS.filter((k) => (me.locker.items[k] ?? 0) > 0)
          .map((k) => `<div class="lrow"><span>${me.locker.items[k]}× ${esc(ITEMS[k].name)}</span><button class="btn btn-small" data-itake="${k}">←</button></div>`)
          .join('') || '<p class="hint">Leer. Das Schließfach ist in jeder Zuflucht dasselbe.</p>'}</div></div></div>`;
    }
    s.body.innerHTML = html;
  };
  s.body.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.craft) act(ctx, { a: 'craft', recipe: d.craft });
    if (d.up) act(ctx, { a: 'upgrade', uid: Number(d.up) });
    if (d.elem) {
      const [uid, el2] = d.elem.split(':').map(Number);
      act(ctx, { a: 'element', uid, element: el2 });
    }
    if (d.skill) act(ctx, { a: 'skill', key: d.skill });
    if (d.buy) {
      const [item, qty] = d.buy.split(':');
      act(ctx, { a: 'buy', item, qty: Number(qty) });
    }
    if (d.sell) {
      const [item, qty] = d.sell.split(':');
      act(ctx, { a: 'sell', item, qty: Number(qty) });
    }
    if (d.travel) {
      act(ctx, { a: 'travel', safe: Number(d.travel) });
      s.close();
    }
    if (d.wput) act(ctx, { a: 'locker', op: 'put', uid: Number(d.wput) });
    if (d.wtake) act(ctx, { a: 'locker', op: 'take', uid: Number(d.wtake) });
    if (d.iput) act(ctx, { a: 'locker', op: 'put', item: d.iput, qty: store.me?.items[d.iput as ItemKey] ?? 1 });
    if (d.itake) act(ctx, { a: 'locker', op: 'take', item: d.itake, qty: store.me?.locker.items[d.itake as ItemKey] ?? 1 });
  });
  live(s, render);
}

// =================== Inventar ===================

export function openInventory(ctx: PanelCtx) {
  const s = sheet('Inventar', '', { wide: true, id: 'inventory' });
  const render = () => {
    const me = store.me;
    if (!me) return;
    const lv = getLevel();
    s.body.innerHTML = `
      <div class="row money-row"><span class="pill">Level ${me.level}</span><span class="pill">${me.xp} / ${me.xpNext} XP</span><span class="pill">${money(me.money)}</span>${me.skillPoints ? `<span class="pill accent">${me.skillPoints} Skillpunkt(e) – im Trainingsraum verteilen</span>` : ''}</div>
      <div class="two-col">
        <div><h3>Waffen (max. 3)</h3><div class="list">${me.weapons
          .map((w, i) => weaponCard(w, `<div class="row"><button class="btn btn-small ${i === me.active ? 'btn-primary' : ''}" data-select="${i}">${i === me.active ? 'Ausgerüstet' : 'Ausrüsten'}</button>${me.weapons.length > 1 ? `<button class="btn btn-small" data-drop="${w.uid}">Wegwerfen</button>` : ''}</div>`))
          .join('')}</div></div>
        <div><h3>Gegenstände</h3><div class="list">${ITEM_KEYS.filter((k) => (me.items[k] ?? 0) > 0)
          .map((k) => `<div class="lrow"><span>${esc(ITEMS[k].name)}</span><strong>${me.items[k]}</strong></div>`)
          .join('') || '<p class="hint">Noch nichts gesammelt. Zombies lassen Material fallen.</p>'}</div>
          <h3>Tagebuch (${me.lore.length}/${lv.lore.length})</h3><div class="list">${me.lore
            .map((id) => `<button class="lrow linkrow" data-lore="${id}"><span>${esc(lv.lore[id].title)}</span><span class="hint">lesen</span></button>`)
            .join('') || '<p class="hint">Finde Tagebuchseiten in der Welt.</p>'}</div>
        </div>
      </div>
      <p class="hint">Heilen: H · Waffe wechseln: Q / Mausrad / 1–3 · Granate: G · Molotow: F · Nachladen: R</p>`;
  };
  s.body.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.select) act(ctx, { a: 'select', slot: Number(b.dataset.select) });
    if (b.dataset.drop && confirm('Waffe wirklich wegwerfen?')) act(ctx, { a: 'drop', uid: Number(b.dataset.drop) });
    if (b.dataset.lore) showLore(Number(b.dataset.lore));
  });
  live(s, render);
}

export function showLore(id: number) {
  const l = getLevel().lore[id];
  if (!l) return;
  sheet(l.title, `<p class="lore">${esc(l.text)}</p>`, { id: 'lore' });
}

// =================== Handel ===================

let tradeSheet: Sheet | undefined;
let lastTrade: any;
let myOffer: { items: Partial<Record<ItemKey, number>>; money: number; uids: number[] } = { items: {}, money: 0, uids: [] };

export function showTradeInvite(ctx: PanelCtx, from: number, name: string) {
  sfx.ui('ok');
  const s = sheet('Handelsanfrage', `<p>${esc(name)} möchte mit dir handeln.</p><div class="row"><button class="btn btn-primary" data-yes>Annehmen</button><button class="btn" data-no>Ablehnen</button></div>`, { id: 'invite' });
  s.querySelector('[data-yes]')!.addEventListener('click', () => {
    act(ctx, { a: 'tradeRespond', from, accept: true });
    s.close();
  });
  s.querySelector('[data-no]')!.addEventListener('click', () => {
    act(ctx, { a: 'tradeRespond', from, accept: false });
    s.close();
  });
}

export function updateTrade(ctx: PanelCtx, msg: any) {
  lastTrade = msg;
  if (!tradeSheet || !tradeSheet.isConnected) {
    myOffer = { items: {}, money: 0, uids: [] };
    tradeSheet = sheet('Handel', '', { wide: true, id: 'trade', onClose: () => act(ctx, { a: 'tradeCancel' }) });
    tradeSheet.body.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || b.disabled) return;
      const d = b.dataset;
      const me = store.me;
      if (!me) return;
      if (d.inc) myOffer.items[d.inc as ItemKey] = Math.min(me.items[d.inc as ItemKey] ?? 0, (myOffer.items[d.inc as ItemKey] ?? 0) + 1);
      if (d.dec) myOffer.items[d.dec as ItemKey] = Math.max(0, (myOffer.items[d.dec as ItemKey] ?? 0) - 1);
      if (d.wpn) {
        const uid = Number(d.wpn);
        myOffer.uids = myOffer.uids.includes(uid) ? myOffer.uids.filter((u) => u !== uid) : [...myOffer.uids, uid].slice(0, 2);
      }
      if (d.inc || d.dec || d.wpn) act(ctx, { a: 'tradeOffer', ...myOffer });
      if (d.ready) act(ctx, { a: 'tradeReady', ready: d.ready === '1' });
      if (d.confirm) act(ctx, { a: 'tradeConfirm' });
    });
    tradeSheet.body.addEventListener('change', (e) => {
      const inp = e.target as HTMLInputElement;
      if (inp.dataset.money !== undefined) {
        myOffer.money = Math.max(0, Math.min(store.me?.money ?? 0, Math.floor(Number(inp.value) || 0)));
        act(ctx, { a: 'tradeOffer', ...myOffer });
      }
    });
    live(tradeSheet, () => renderTrade());
  }
  renderTrade();
}

function renderTrade() {
  const s = tradeSheet;
  const me = store.me;
  const t = lastTrade;
  if (!s || !me || !t) return;
  const other = t.other;
  const offerList = (items: Partial<Record<ItemKey, number>>, moneyAmount: number, weapons: WeaponInst[]) =>
    [
      ...(Object.entries(items) as [ItemKey, number][]).filter(([, n]) => n > 0).map(([k, n]) => `<div class="lrow"><span>${esc(ITEMS[k].name)}</span><strong>${n}</strong></div>`),
      moneyAmount ? `<div class="lrow"><span>Geld</span><strong>${money(moneyAmount)}</strong></div>` : '',
      ...weapons.map((w) => weaponCard(w)),
    ].join('') || '<p class="hint">Noch nichts angeboten.</p>';
  s.body.innerHTML = `
    <div class="two-col">
      <div><h3>Dein Angebot ${t.me.ready ? '✔' : ''}</h3>
        <div class="list">${ITEM_KEYS.filter((k) => (me.items[k] ?? 0) > 0 && ITEMS[k].kind !== 'key')
          .map((k) => `<div class="lrow"><span>${esc(ITEMS[k].name)} <small class="hint">(${me.items[k]})</small></span><div class="row"><button class="btn btn-small" data-dec="${k}">−</button><strong>${myOffer.items[k] ?? 0}</strong><button class="btn btn-small" data-inc="${k}">+</button></div></div>`)
          .join('')}
          <div class="lrow"><span>Geld</span><input class="input input-small" type="number" min="0" max="${me.money}" value="${myOffer.money}" data-money /></div>
          ${me.weapons.length > 1 ? me.weapons.map((w) => `<button class="lrow linkrow ${myOffer.uids.includes(w.uid) ? 'sel' : ''}" data-wpn="${w.uid}"><span>${esc(WEAPONS[w.def].name)} ${stars(w.tier)}</span><span>${myOffer.uids.includes(w.uid) ? 'angeboten' : 'anbieten'}</span></button>`).join('') : ''}
        </div>
      </div>
      <div><h3>${esc(other.name)} bietet ${other.ready ? '✔' : ''}</h3><div class="list">${offerList(other.items, other.money, other.weapons ?? [])}</div></div>
    </div>
    <div class="row trade-actions">
      <button class="btn ${t.me.ready ? '' : 'btn-primary'}" data-ready="${t.me.ready ? 0 : 1}">${t.me.ready ? 'Doch nicht bereit' : 'Bereit'}</button>
      <button class="btn ${t.me.ready && other.ready && !t.me.confirmed ? 'btn-primary' : ''}" data-confirm ${t.me.ready && other.ready && !t.me.confirmed ? '' : 'disabled'}>${t.me.confirmed ? 'Warte auf Bestätigung …' : 'Handel bestätigen'}</button>
      <span class="hint">Jede Änderung setzt „Bereit“ bei beiden zurück.</span>
    </div>`;
}

export function closeTrade(done: boolean) {
  if (tradeSheet?.isConnected) tradeSheet.remove();
  document.querySelector('[data-sheet="trade"]')?.remove();
  refreshUiOpen();
  tradeSheet = undefined;
  lastTrade = undefined;
  toast(done ? 'Handel abgeschlossen' : 'Handel abgebrochen', done ? 'ok' : 'warn');
  if (done) sfx.ui('ok');
}

// =================== Karte ===================

export function openMap(ctx: PanelCtx) {
  const s = sheet('Karte – Talkessel', `<canvas class="map-canvas"></canvas><p class="hint">Grün: Zufluchten · Gelb: verschlossene Türen (mit Preis) · Lila: Wundertruhe · Punkte: Spieler</p>`, { wide: true, id: 'map' });
  const canvas = s.querySelector('canvas')!;
  const lv = getLevel();
  const draw = () => {
    const snap = ctx.snapshot();
    const wpx = Math.min(1100, s.body.clientWidth || 900);
    const k = wpx / lv.width;
    canvas.width = wpx;
    canvas.height = lv.height * k;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#0b0e14';
    c.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < lv.height; y++)
      for (let x = 0; x < lv.width; x++) {
        const ch = lv.rows[y][x];
        if (ch === '.') continue;
        c.fillStyle = ch === '#' ? '#2a2f3a' : ch === 'b' || ch === 'w' ? '#161b24' : ch === 'c' ? '#2e4a56' : ch === '=' ? '#4a5260' : '#2a2f3a';
        c.fillRect(x * k, y * k, k + 0.5, k + 0.5);
      }
    for (const z of lv.safeZones) {
      c.fillStyle = 'rgba(61,220,151,0.45)';
      c.fillRect((z.rect.x / 64) * k, (z.rect.y / 64) * k, (z.rect.w / 64) * k, (z.rect.h / 64) * k);
    }
    c.font = `600 ${Math.max(10, k * 3)}px Inter, sans-serif`;
    for (const d of lv.doors) {
      const open = ((snap?.doorsOpen ?? 0) & (1 << d.id)) !== 0;
      c.fillStyle = open ? '#3ddc97' : '#ffb547';
      for (const [x, y] of d.cells) c.fillRect(x * k, y * k, k + 0.5, k + 0.5);
      if (!open && d.price) c.fillText(`${d.price}`, (d.cx / 64) * k + 4, (d.cy / 64) * k - 4);
    }
    for (const z of lv.zones) {
      c.fillStyle = 'rgba(242,244,248,0.75)';
      c.fillText(z.name, (z.rect.x + 2) * k, (z.ground - 6) * k);
    }
    const ts = lv.truheSpots[snap?.truheSpot ?? 0];
    if (ts) {
      c.fillStyle = '#b26bff';
      c.beginPath();
      c.arc((ts.x / 64) * k, (ts.y / 64) * k - 2, Math.max(3, k), 0, Math.PI * 2);
      c.fill();
    }
    for (const p of snap?.players ?? []) {
      c.fillStyle = p.id === ctx.session.localId ? '#ffffff' : '#6ec8ff';
      c.beginPath();
      c.arc((p.x / 64) * k, (p.y / 64) * k - 2, Math.max(4, k * 1.4), 0, Math.PI * 2);
      c.fill();
    }
  };
  requestAnimationFrame(draw);
  const t = window.setInterval(() => (s.isConnected ? draw() : clearInterval(t)), 1000);
}

// =================== Sieg ===================

export function showVictory(onContinue: () => void) {
  sfx.ui('level');
  const me = store.me;
  const s = sheet(
    'Gerettet!',
    `<div class="victory"><p class="big">Der Hubschrauber hebt ab. Unter euch versinkt der Talkessel in der Nacht.</p>
     <p class="hint">Level ${me?.level ?? 1} · ${me?.lore.length ?? 0}/20 Tagebuchseiten</p>
     <p>Ihr könnt die Welt weiterspielen – alle Freischaltungen bleiben erhalten.</p>
     <button class="btn btn-primary" data-ok>Weiterspielen</button></div>`,
    { id: 'victory' },
  );
  s.querySelector('[data-ok]')!.addEventListener('click', () => {
    s.close();
    onContinue();
  });
}

export const panelIcons = icons;
export { el };
