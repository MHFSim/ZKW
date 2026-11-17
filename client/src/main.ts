import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/chakra-petch/700.css';
import './ui/styles.css';
import Phaser from 'phaser';
import type { GameEvent, StationKind } from '@zkw/shared';
import { sfx } from './audio';
import { GameScene } from './game/GameScene';
import { HudScene } from './game/HudScene';
import { ClientSession } from './net/client';
import { HostSession } from './net/host';
import { exportSave, importSave, listSaves, readSave, type SaveMeta } from './net/save';
import type { Session } from './net/session';
import { closeSheets, el, esc, icons, onUiOpenChange, refreshUiOpen, sheet, toast, ui } from './ui/dom';
import { closeTrade, openInventory, openMap, openStation, showTradeInvite, showVictory, updateTrade, type PanelCtx } from './ui/panels';
import { playerName, saveSettings, settings, type RainLevel, type Settings } from './ui/state';
import { store } from './ui/store';

let session: Session | undefined;

const qs = new URLSearchParams(location.search);
const benchLights = qs.has('debug') && qs.get('maxlights') ? Number(qs.get('maxlights')) : undefined;
const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  backgroundColor: '#05070f',
  scale: { mode: Phaser.Scale.EXPAND, width: 1280, height: 720, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, antialiasGL: false, maxLights: benchLights ?? (settings.preset === 'ultra' ? 24 : settings.preset === 'niedrig' ? 8 : 12), powerPreference: 'high-performance' },
  input: { activePointers: 5 },
  scene: [GameScene, HudScene],
});
(window as any).__zkw = game;
Object.defineProperty(window, '__session', { get: () => session });
if (qs.has('debug')) {
  (window as any).__debug = (msg: object) => (session as any)?.debug?.(msg);
  // Messung: reine JS-Zeit pro Bild (ohne GPU)
  const perf = ((window as any).__perf = { js: [] as number[] });
  let t0 = 0;
  game.events.on('prestep', () => (t0 = performance.now()));
  game.events.on('postrender', () => {
    perf.js.push(performance.now() - t0);
    if (perf.js.length > 600) perf.js.shift();
  });
}
onUiOpenChange((open) => game.registry.set('uiOpen', open || !session));

const gameScene = () => game.scene.getScene('game') as GameScene;
const panelCtx = (): PanelCtx => ({ session: session!, snapshot: () => gameScene().latest });

// ---------- Hauptmenü ----------

async function showMenu(message?: string) {
  ui().innerHTML = '';
  refreshUiOpen(true);
  const saves = await listSaves();
  const latest = saves[0];
  const menu = el(`
    <div class="menu">
      <div class="menu-col">
        <h1 class="logo">Undead <span>Week</span></h1>
        <p class="tagline">Vom Labor ganz unten bis zum Gipfel. Bis zu 6 Überlebende, eine Welt.</p>
        ${latest ? `<button class="btn btn-primary" data-continue>${icons.play} Weiterspielen <small class="btn-sub">${esc(latest.zone || 'Talkessel')} · Level ${latest.level}</small></button>` : ''}
        <button class="btn ${latest ? '' : 'btn-primary'}" data-play>${icons.world} Spielen</button>
        <button class="btn" data-settings>${icons.gear} Einstellungen</button>
        <div class="menu-small">
          <button class="link" data-help>Steuerung</button>
          <button class="link" data-install>Als App installieren</button>
        </div>
        <div class="error">${message ? esc(message) : ''}</div>
      </div>
      <div></div>
      <div class="side-card panel">
        <h3>${esc(playerName())}</h3>
        <p>Startet im Labor ganz unten und kämpft euch durch Kanalisation, U-Bahn, Stadt und Berge bis zur Funkstation am Gipfel.</p>
      </div>
    </div>`);
  menu.querySelector('[data-continue]')?.addEventListener('click', () => latest && startHost(latest.slot));
  menu.querySelector('[data-play]')!.addEventListener('click', showPlay);
  menu.querySelector('[data-settings]')!.addEventListener('click', () => showSettings());
  menu.querySelector('[data-help]')!.addEventListener('click', showHelp);
  menu.querySelector('[data-install]')!.addEventListener('click', showInstall);
  menu.addEventListener('click', () => sfx.ui('tap'), true);
  ui().append(menu);
}

function showPlay() {
  const s = sheet(
    'Spielen',
    `<div class="cards">
      <button class="card" data-new>${icons.world}<strong>Neue Welt</strong><span>Du bist Host. Freunde treten per Code oder Link bei.</span></button>
      <button class="card" data-load>${icons.load}<strong>Welt laden</strong><span>Gespeicherte Welt fortsetzen und hosten.</span></button>
      <button class="card" data-join>${icons.join}<strong>Beitreten</strong><span>Mit dem 4-stelligen Raum-Code eines Freundes.</span></button>
    </div>`,
  );
  s.querySelector('[data-new]')!.addEventListener('click', () => startHost());
  s.querySelector('[data-load]')!.addEventListener('click', () => {
    s.close();
    void showLoad();
  });
  s.querySelector('[data-join]')!.addEventListener('click', () => {
    s.close();
    showJoin();
  });
}

async function showLoad() {
  const saves = await listSaves();
  const row = (m: SaveMeta) => `
    <div class="lrow save-row">
      <div><strong>${esc(m.zone || 'Talkessel')}</strong> <span class="pill">${m.slot.startsWith('auto') ? 'Autosave' : 'Manuell'}</span>
        <div class="hint">${new Date(m.savedAt).toLocaleString('de-DE')} · Level ${m.level} · ${m.money.toLocaleString('de-DE')} ¢ · ${esc(m.players.join(', '))}</div></div>
      <div class="row"><button class="btn btn-small btn-primary" data-slot="${m.slot}">Laden</button><button class="btn btn-small" data-export="${m.slot}" aria-label="Als Datei sichern">${icons.file}</button></div>
    </div>`;
  const s = sheet(
    'Welt laden',
    `<div class="list">${saves.map(row).join('') || '<p class="hint">Noch keine Spielstände. Starte eine neue Welt.</p>'}</div>
     <div class="row"><label class="btn">${icons.file} Spielstand-Datei öffnen<input type="file" accept=".uwsave,application/json,application/gzip" hidden data-import /></label></div>
     <p class="hint">Spielstände liegen in diesem Browser. Sichere wichtige Welten als Datei – so kann sie auch jemand anderes hosten.</p>`,
    { wide: true },
  );
  s.body.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b?.dataset.slot) startHost(b.dataset.slot);
    if (b?.dataset.export) void exportSave(b.dataset.export);
  });
  s.querySelector<HTMLInputElement>('[data-import]')!.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const ok = await importSave(f);
    toast(ok ? 'Spielstand importiert' : 'Datei ist kein gültiger Spielstand', ok ? 'ok' : 'warn');
    s.close();
    if (ok) void showLoad();
  });
}

function showJoin(prefill = '') {
  const s = sheet(
    'Beitreten',
    `<div class="field"><label for="code">Raum-Code</label>
       <input id="code" class="input code-input" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(prefill)}" /></div>
     <div class="error" data-err></div>
     <div class="row"><button class="btn btn-primary" data-go>${icons.join} Beitreten</button>
     <span class="hint">Du kommst hinein, sobald alle Spieler in einer Zuflucht sind.</span></div>`,
  );
  const input = s.querySelector<HTMLInputElement>('#code')!;
  const err = s.querySelector<HTMLElement>('[data-err]')!;
  const go = async () => {
    const code = input.value.trim().toUpperCase();
    if (code.length !== 4) return void (err.textContent = 'Der Code hat 4 Zeichen.');
    err.textContent = '';
    try {
      await joinGame(code);
    } catch (e) {
      err.textContent = (e as Error).message;
      showMenuIfEmpty();
    }
  };
  s.querySelector('[data-go]')!.addEventListener('click', go);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  if (prefill.length === 4) void go();
  else input.focus();
}

function showMenuIfEmpty() {
  if (!document.querySelector('.menu')) void showMenu();
}

function showHelp() {
  sheet(
    'Steuerung',
    `<h3>Handy</h3>
     <div class="toggle-row"><span>Laufen</span><span class="hint">linker Daumen – der Stick erscheint, wo du tippst</span></div>
     <div class="toggle-row"><span>Springen</span><span class="hint">nur mit SPRUNG</span></div>
     <div class="toggle-row"><span>Leiter hoch</span><span class="hint">linken Stick nach oben</span></div>
     <div class="toggle-row"><span>Leiter runter · durch Stege</span><span class="hint">linken Stick nach unten</span></div>
     <div class="toggle-row"><span>Zielen und Schießen</span><span class="hint">rechter Daumen: Richtung ziehen – ab einem Drittel wird gefeuert</span></div>
     <div class="toggle-row"><span>Aktion</span><span class="hint">AKTION leuchtet, wenn etwas geht (Tür, Kauf, Station)</span></div>
     <div class="toggle-row"><span>Waffe wechseln</span><span class="hint">WAFFE oder auf die Waffenanzeige tippen</span></div>
     <h3>Tastatur und Maus</h3>
     <div class="toggle-row"><span>Laufen · Springen · Runter</span><span class="hint">A/D · Leertaste/W · S</span></div>
     <div class="toggle-row"><span>Zielen · Schießen · Werfen</span><span class="hint">Maus · Linksklick · Rechtsklick (G Granate, F Molotow)</span></div>
     <div class="toggle-row"><span>Aktion · Laden · Heilen</span><span class="hint">E · R (leer = automatisch) · H</span></div>
     <div class="toggle-row"><span>Waffe wechseln</span><span class="hint">Q · Mausrad · 1–3</span></div>
     <div class="toggle-row"><span>Inventar · Karte · Pause · Speichern</span><span class="hint">I · M · Esc · F5</span></div>
     <h3>Controller</h3>
     <div class="toggle-row"><span>Laufen · Zielen · Schießen</span><span class="hint">linker Stick · rechter Stick · RT</span></div>
     <div class="toggle-row"><span>Springen · Aktion · Laden · Waffe</span><span class="hint">A · X · B · Y</span></div>
     <div class="toggle-row"><span>Heilen · Werfen · Pause</span><span class="hint">LB · RB · Start</span></div>`,
  );
}

function showInstall() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  sheet(
    'Als App installieren',
    ios
      ? `<p>Auf dem iPhone läuft das Spiel als installierte Web-App im Vollbild:</p><ol class="steps"><li>In Safari unten auf <strong>Teilen</strong> tippen.</li><li><strong>Zum Home-Bildschirm</strong> wählen.</li><li>Undead Week vom Home-Bildschirm starten – im Querformat.</li></ol>`
      : `<p>Im Browser-Menü <strong>„App installieren“</strong> bzw. <strong>„Zum Startbildschirm hinzufügen“</strong> wählen. Danach startet Undead Week im Vollbild und im Querformat.</p>`,
  );
}

const PRESETS: Record<Settings['preset'], Partial<Settings>> = {
  niedrig: { bloom: false, vignette: false, rain: 'mittel' },
  mittel: { bloom: false, vignette: true, rain: 'mittel' },
  hoch: { bloom: false, vignette: true, rain: 'hoch' },
  ultra: { bloom: true, vignette: true, rain: 'hoch' },
};

function showSettings(inGame = false) {
  const seg = (key: string, opts: [string, string][], cur: string) =>
    `<div class="seg" data-key="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const tog = (key: keyof Settings, label: string) =>
    `<div class="toggle-row"><span>${label}</span>${seg(key, [['1', 'An'], ['0', 'Aus']], settings[key] ? '1' : '0')}</div>`;
  const slider = (key: keyof Settings, label: string) =>
    `<div class="toggle-row"><span>${label}</span><input class="range" type="range" min="0" max="1" step="0.05" value="${settings[key]}" data-range="${key}" /></div>`;
  const s = sheet(
    'Einstellungen',
    `<div class="field"><label for="name">Name</label><input id="name" class="input" maxlength="20" value="${esc(playerName())}" /></div>
     <h3>Grafik</h3>
     <div class="toggle-row"><span>Qualität<br><span class="hint">Standard: Hoch. Wird nie automatisch heruntergeregelt.</span></span>${seg('preset', [['niedrig', 'Niedrig'], ['mittel', 'Mittel'], ['hoch', 'Hoch'], ['ultra', 'Ultra']], settings.preset)}</div>
     ${tog('bloom', 'Kamera-Bloom (aufwendig, Ultra)')}
     ${tog('vignette', 'Vignette')}
     <div class="toggle-row"><span>Regen und Schnee</span>${seg('rain', [['aus', 'Aus'], ['mittel', 'Mittel'], ['hoch', 'Hoch']], settings.rain)}</div>
     ${tog('shake', 'Kamera-Wackeln')}
     ${tog('fps', 'Bildrate anzeigen')}
     <h3>Ton</h3>
     ${slider('volMaster', 'Gesamt')}
     ${slider('volSfx', 'Effekte')}
     ${slider('volMusic', 'Musik')}
     <h3>Steuerung</h3>
     ${tog('aimAssist', 'Zielhilfe (Touch)')}
     ${inGame ? '<p class="hint">Bloom, Vignette und Qualität wirken ab dem nächsten Spielstart.</p>' : ''}`,
    {
      onClose: () => {
        settings.name = s.querySelector<HTMLInputElement>('#name')!.value.trim().slice(0, 20) || settings.name;
        saveSettings();
        if (!session) {
          gameScene().scene.restart({});
          void showMenu();
        }
      },
    },
  );
  s.body.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    const segEl = b?.closest<HTMLElement>('.seg');
    if (!b || !segEl) return;
    const key = segEl.dataset.key as keyof Settings;
    const v = b.dataset.v!;
    if (key === 'preset') {
      settings.preset = v as Settings['preset'];
      Object.assign(settings, PRESETS[settings.preset]);
      s.body.querySelectorAll<HTMLElement>('.seg').forEach((sg) => {
        const k = sg.dataset.key as keyof Settings;
        const cur = k === 'preset' || k === 'rain' ? String(settings[k]) : settings[k] ? '1' : '0';
        sg.querySelectorAll<HTMLButtonElement>('button').forEach((x) => x.classList.toggle('on', x.dataset.v === cur));
      });
    } else {
      (settings as any)[key] = key === 'rain' ? (v as RainLevel) : v === '1';
      segEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    }
    saveSettings();
    sfx.ui('tap');
  });
  s.body.addEventListener('input', (e) => {
    const r = e.target as HTMLInputElement;
    if (!r.dataset.range) return;
    (settings as any)[r.dataset.range] = Number(r.value);
    saveSettings();
    sfx.applyVolumes();
  });
}

// ---------- Spielstart ----------

function enterGameChrome() {
  ui().innerHTML = '';
  const bar = el(`<div class="topbar">
    <button class="btn btn-icon panel" data-inv aria-label="Inventar (I)">${icons.bag}</button>
    <button class="btn btn-icon panel" data-map aria-label="Karte (M)">${icons.map}</button>
    <button class="btn btn-icon panel" data-pause aria-label="Pause (Esc)">${icons.pause}</button></div>`);
  bar.querySelector('[data-inv]')!.addEventListener('click', () => openInventory(panelCtx()));
  bar.querySelector('[data-map]')!.addEventListener('click', () => openMap(panelCtx()));
  bar.querySelector('[data-pause]')!.addEventListener('click', showPause);
  // Fadenkreuz als Hardware-Cursor: folgt der Maus ohne Verzögerung
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><g fill='none' stroke-linecap='round'><circle cx='16' cy='16' r='7' stroke='%23000' stroke-opacity='.55' stroke-width='4'/><circle cx='16' cy='16' r='7' stroke='%23ffb547' stroke-width='2'/><path d='M16 2v6M16 24v6M2 16h6M24 16h6' stroke='%23000' stroke-opacity='.55' stroke-width='4'/><path d='M16 2v6M16 24v6M2 16h6M24 16h6' stroke='%23fff' stroke-width='2'/></g></svg>`;
  document.getElementById('game')!.style.cursor = `url("data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/"/g, "'")}") 16 16, crosshair`;
  ui().append(bar);
  refreshUiOpen();
  if (matchMedia('(pointer: coarse)').matches) {
    document.documentElement
      .requestFullscreen?.()
      .then(() => (screen.orientation as any)?.lock?.('landscape'))
      .catch(() => {});
  }
  void (navigator as any).wakeLock?.request?.('screen').catch(() => {});
}

function wireSession(s: Session) {
  store.reset();
  game.registry.set('localId', s.localId);
  s.cb.onSaved = () => toast('Gespeichert');
  s.cb.onJoinWaiting = (name) => game.events.emit('toast', `${name} möchte beitreten`, '#6ec8ff', 'Sobald alle in einer Zuflucht sind, ist er dabei');
  s.cb.onRoster = () => {};
  s.cb.onPickups = (list) => store.set({ pickups: list });
  s.cb.onPrivate = (m: any) => {
    switch (m.t) {
      case 'me':
        store.set({ me: m.me, interaction: m.interaction });
        break;
      case 'toast':
        toast(m.text, m.tone === 'warn' ? 'warn' : 'ok');
        if (m.tone === 'warn') sfx.ui('error');
        break;
      case 'station':
        openStation(panelCtx(), m.kind as StationKind);
        break;
      case 'lore': {
        toast('Tagebuchseite gefunden – im Inventar lesen');
        sfx.ui('ok');
        void m.id;
        break;
      }
      case 'trade':
        updateTrade(panelCtx(), m);
        break;
      case 'tradeInvite':
        showTradeInvite(panelCtx(), m.from, m.name);
        break;
      case 'tradeClosed':
        closeTrade(m.done);
        break;
    }
  };
}

async function startHost(slot?: string) {
  closeSheets();
  sfx.unlock();
  const save = slot ? ((await readSave(slot)) ?? undefined) : undefined;
  const host = new HostSession(playerName(), save);
  session = host;
  wireSession(host);
  enterGameChrome();
  gameScene().scene.restart({ session: host });
  try {
    const code = await host.openRoom();
    if (session === host) showCodeChip(code);
  } catch {
    if (session === host) toast('Offline: Vermittlungsdienst nicht erreichbar – Solo-Spiel läuft', 'warn');
  }
}

function showCodeChip(code: string) {
  const link = `${location.origin}${location.pathname}#join=${code}`;
  const chip = el(`<div class="code-chip panel"><small>Raum</small><b>${code}</b><button class="btn btn-icon" data-share aria-label="Freunde einladen">${icons.share}</button></div>`);
  chip.querySelector('[data-share]')!.addEventListener('click', async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Undead Week', text: `Spiel mit! Raum ${code}`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast('Einladungs-Link kopiert');
      }
    } catch {
      /* Teilen abgebrochen */
    }
  });
  ui().append(chip);
}

async function joinGame(code: string) {
  sfx.unlock();
  const waiting = el(`
    <div class="waiting"><div class="panel">
      <div class="spinner"></div>
      <h2>Verbinde mit Raum ${esc(code)} …</h2>
      <p class="hint" data-msg>Die Verbindung wird aufgebaut.</p>
      <div class="progress"><div data-bar style="width:0%"></div></div>
      <button class="btn" data-cancel>Abbrechen</button>
    </div></div>`);
  closeSheets();
  ui().innerHTML = '';
  ui().append(waiting);
  waiting.querySelector('[data-cancel]')!.addEventListener('click', () => leave());
  const msg = waiting.querySelector<HTMLElement>('[data-msg]')!;
  const bar = waiting.querySelector<HTMLElement>('[data-bar]')!;
  let client: ClientSession | undefined;
  try {
    client = await ClientSession.join(code, playerName(), {
      onWait: (safe, total) => {
        waiting.querySelector('h2')!.textContent = 'Warte auf die Gruppe';
        msg.textContent = `${safe} von ${total} Spielern sind in einer Zuflucht. Du kommst hinein, sobald alle dort sind.`;
        bar.style.width = `${total ? (safe / total) * 100 : 0}%`;
      },
      onStatus: (st, detail) => {
        if (st === 'playing') {
          const enter = () => {
            if (!client) return void setTimeout(enter, 30);
            if (session !== client) return;
            enterGameChrome();
            wireSession(client);
            gameScene().scene.restart({ session: client });
          };
          enter();
        }
        if (st === 'closed') leave(detail ?? 'Verbindung beendet.');
      },
    });
  } catch (e) {
    waiting.remove();
    await showMenu((e as Error).message);
    throw e;
  }
  session = client;
}

function showPause() {
  const s = sheet(
    'Pause',
    `<div class="menu-col">
      <button class="btn btn-primary btn-wide" data-save>${icons.save} Speichern</button>
      <button class="btn btn-wide" data-settings>${icons.gear} Einstellungen</button>
      <button class="btn btn-wide" data-help>Steuerung</button>
      ${session?.isHost ? `<button class="btn btn-wide" data-export>${icons.file} Spielstand als Datei sichern</button>` : ''}
      <button class="btn btn-wide" data-leave>${icons.back} ${session?.isHost ? 'Speichern und beenden' : 'Spiel verlassen'}</button>
      <p class="hint">Das Spiel läuft weiter – wirklich sicher bist du nur in einer Zuflucht.</p>
    </div>`,
  );
  s.querySelector('[data-save]')!.addEventListener('click', () => {
    session?.requestSave();
    s.close();
  });
  s.querySelector('[data-settings]')!.addEventListener('click', () => showSettings(true));
  s.querySelector('[data-help]')!.addEventListener('click', showHelp);
  s.querySelector('[data-export]')?.addEventListener('click', () => {
    session?.requestSave();
    setTimeout(() => void exportSave(), 500);
  });
  s.querySelector('[data-leave]')!.addEventListener('click', () => leave());
}

function leave(message?: string) {
  document.getElementById('game')!.style.cursor = '';
  const s = session;
  session = undefined;
  s?.close();
  store.reset();
  closeSheets();
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  game.scene.stop('hud');
  gameScene().scene.restart({});
  history.replaceState(null, '', location.pathname);
  setTimeout(() => void showMenu(message), 600); // Host: Spielstand ist dann geschrieben
}

// ---------- Globale Ereignisse ----------

game.events.on('gameEvent', (e: GameEvent) => {
  if (e.t === 'victory') showVictory(() => {});
});

window.addEventListener('pagehide', () => session?.requestSave(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) session?.requestSave(true);
});
window.addEventListener('keydown', (e) => {
  sfx.unlock();
  if (!session || (e.target as HTMLElement)?.tagName === 'INPUT') return;
  const open = document.querySelector('.sheet-backdrop:last-of-type') as any;
  if (e.key === 'Escape') {
    if (open) open.close();
    else showPause();
  } else if (e.key === 'i' || e.key === 'I') {
    if (document.querySelector('[data-sheet="inventory"]')) open?.close();
    else openInventory(panelCtx());
  } else if (e.key === 'm' || e.key === 'M') {
    if (document.querySelector('[data-sheet="map"]')) open?.close();
    else openMap(panelCtx());
  }
});
window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
document.addEventListener('contextmenu', (e) => e.preventDefault());

void showMenu().then(() => {
  const joinCode = /#join=([A-Za-z0-9]{4})/.exec(location.hash)?.[1];
  if (joinCode) showJoin(joinCode.toUpperCase());
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./sw.js').catch(() => {});
}
