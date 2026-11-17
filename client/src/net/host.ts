import { MAX_PLAYERS, PROTOCOL_VERSION, type GameEvent, type ReliableMsg, type SaveData } from '@zkw/shared';
import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { openFastChannel, openHostPeer, sendFast, sendReliable } from './rtc';
import type { Session, SessionCallbacks, SessionStatus } from './session';
import { writeSave } from './save';

interface Guest {
  key: string;
  conn: DataConnection;
  fast: RTCDataChannel;
  id: number;
  name: string;
  joined: boolean;
}

/**
 * Host: Simulation im Worker, Raum online über WebRTC.
 * Der Host spielt selbst ganz normal mit (Spieler-ID 0) – seine Eingaben gehen ohne Netz in den Worker.
 */
export class HostSession implements Session {
  readonly isHost = true;
  localId = 0;
  levelId = 'talkessel';
  code?: string;
  status: SessionStatus = 'connecting';
  roster = new Map<number, string>();
  cb: SessionCallbacks = {};
  ping = 0;
  private worker: Worker;
  private peer?: Peer;
  private guests = new Map<string, Guest>();
  private lastAutosave = 0;
  private autosaveTimer?: number;
  private closed = false;
  private lastPickups: import('@zkw/shared').PickupInfo[] = [];

  constructor(hostName: string, save?: SaveData) {
    this.worker = new Worker(new URL('./host.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onWorker(e.data);
    this.worker.postMessage({ type: 'start', hostName, save });
    this.roster.set(0, hostName);
    this.status = 'playing';
    this.autosaveTimer = window.setInterval(() => this.requestSave(true), 180_000); // alle 3 Minuten
  }

  /** Raum online öffnen. Liefert den 4-stelligen Code. */
  async openRoom(): Promise<string> {
    const { peer, code } = await openHostPeer();
    if (this.closed) {
      peer.destroy();
      throw new Error('beendet');
    }
    this.peer = peer;
    this.code = code;
    peer.on('connection', (conn) => this.onConnection(conn));
    peer.on('disconnected', () => {
      // Verbindung zum Vermittlungsdienst verloren: bestehende Spieler bleiben verbunden,
      // für neue Beitritte wieder anmelden.
      if (!this.closed) setTimeout(() => !this.closed && peer.reconnect(), 2000);
    });
    return code;
  }

  private nextFreeId(): number {
    const used = new Set<number>([0, ...[...this.guests.values()].map((g) => g.id)]);
    for (let i = 1; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
    return -1;
  }

  private onConnection(conn: DataConnection) {
    conn.on('open', () => {
      const guest: Guest = { key: conn.connectionId, conn, fast: openFastChannel(conn), id: -1, name: '?', joined: false };
      this.guests.set(guest.key, guest);
      guest.fast.onmessage = (e) => {
        if (guest.joined) this.worker.postMessage({ type: 'input', id: guest.id, buf: e.data }, [e.data]);
      };
      conn.on('data', (d) => this.onGuestReliable(guest, d as ReliableMsg));
      conn.on('close', () => this.dropGuest(guest.key));
      conn.on('error', () => this.dropGuest(guest.key));
      conn.peerConnection.addEventListener('connectionstatechange', () => {
        if (['failed', 'closed'].includes(conn.peerConnection.connectionState)) this.dropGuest(guest.key);
      });
    });
  }

  private onGuestReliable(g: Guest, m: ReliableMsg) {
    if (m.t === 'hello') {
      if (m.version !== PROTOCOL_VERSION) return sendReliable(g.conn, { t: 'reject', reason: 'version' });
      const id = this.nextFreeId();
      if (id < 0) return sendReliable(g.conn, { t: 'reject', reason: 'full' });
      g.id = id;
      g.name = String(m.name).slice(0, 20) || `Spieler ${id + 1}`;
      this.worker.postMessage({ type: 'join', key: g.key, id, name: g.name });
      this.cb.onJoinWaiting?.(g.name);
      this.broadcast({ t: 'joinWaiting', name: g.name });
    } else if (g.joined) {
      if (m.t === 'saveRequest') this.requestSave();
      else if (m.t === 'action') this.worker.postMessage({ type: 'action', id: g.id, action: m.action });
    }
  }

  private dropGuest(key: string) {
    const g = this.guests.get(key);
    if (!g) return;
    this.guests.delete(key);
    if (g.joined) {
      this.worker.postMessage({ type: 'leave', id: g.id });
      this.roster.delete(g.id);
      this.broadcastRoster();
      this.requestSave(true); // beim Verlassen speichern
    } else {
      this.worker.postMessage({ type: 'cancelJoin', key });
    }
    try {
      g.fast.close();
      g.conn.close();
    } catch {
      /* schon geschlossen */
    }
  }

  private onWorker(m: any) {
    switch (m.type) {
      case 'snapshot':
        for (const g of this.guests.values()) if (g.joined) sendFast(g.fast, m.buf);
        this.cb.onSnapshot?.(m.buf);
        break;
      case 'events': {
        const list = m.list as GameEvent[];
        this.cb.onEvents?.(list);
        this.broadcast({ t: 'events', list });
        if (list.some((e) => e.t === 'enterSafe')) this.requestSave(true); // Autosave beim Betreten einer Zuflucht
        break;
      }
      case 'private': {
        // Nachricht nur für einen Spieler (z. B. Inventar, Handelsfenster)
        if (m.id === 0) this.cb.onPrivate?.(m.msg);
        else for (const g of this.guests.values()) if (g.id === m.id && g.joined) sendReliable(g.conn, m.msg);
        break;
      }
      case 'pickups':
        this.cb.onPickups?.(m.list);
        this.lastPickups = m.list;
        this.broadcast({ t: 'pickups', list: m.list });
        break;
      case 'error':
        this.cb.onPrivate?.({ t: 'toast', text: `Spielstand konnte nicht geladen werden: ${m.message}`, tone: 'warn' });
        break;
      case 'joinState':
        for (const key of m.waiting as string[]) {
          const g = this.guests.get(key);
          if (g) sendReliable(g.conn, { t: 'wait', safe: m.safe, total: m.total });
        }
        this.cb.onJoinState?.(m.waiting.length, m.exitsLocked);
        break;
      case 'joined': {
        const g = this.guests.get(m.key);
        if (!g) return;
        g.joined = true;
        this.roster.set(g.id, g.name);
        sendReliable(g.conn, { t: 'welcome', id: g.id, levelId: this.levelId });
        sendReliable(g.conn, { t: 'pickups', list: this.lastPickups });
        this.broadcastRoster();
        break;
      }
      case 'save': {
        void writeSave(m.data as SaveData, m.auto).then((at) => {
          if (!at) return;
          this.cb.onSaved?.(at);
          this.broadcast({ t: 'saved', at });
        });
        break;
      }
    }
  }

  private broadcast(msg: ReliableMsg) {
    for (const g of this.guests.values()) if (g.joined) sendReliable(g.conn, msg);
  }

  private broadcastRoster() {
    const players = [...this.roster].map(([id, name]) => ({ id, name }));
    this.cb.onRoster?.(players);
    this.broadcast({ t: 'roster', players });
  }

  sendInput(buf: ArrayBuffer) {
    this.worker.postMessage({ type: 'input', id: 0, buf }, [buf]);
  }

  sendAction(action: unknown) {
    this.worker.postMessage({ type: 'action', id: 0, action });
  }

  /** Speichern jederzeit; automatische Speicherungen höchstens alle 10 s. */
  requestSave(auto = false) {
    const now = performance.now();
    if (auto && now - this.lastAutosave < 10_000) return;
    this.lastAutosave = now;
    this.worker.postMessage({ type: 'save', auto });
  }

  close() {
    if (this.closed) return;
    this.requestSave();
    this.closed = true;
    window.clearInterval(this.autosaveTimer);
    setTimeout(() => {
      this.worker.terminate();
      for (const g of this.guests.values()) g.conn.close();
      this.peer?.destroy();
    }, 400);
    this.status = 'closed';
  }
}
