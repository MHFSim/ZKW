import { PROTOCOL_VERSION, type ReliableMsg } from '@zkw/shared';
import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { connectToRoom, openFastChannel, sendFast, sendReliable } from './rtc';
import type { Session, SessionCallbacks, SessionStatus } from './session';

/** Mitspieler: verbindet sich per Raum-Code direkt mit dem Browser des Hosts. */
export class ClientSession implements Session {
  readonly isHost = false;
  localId = -1;
  levelId = 'talkessel';
  code?: string;
  status: SessionStatus = 'connecting';
  roster = new Map<number, string>();
  cb: SessionCallbacks = {};
  ping = 0;
  private peer?: Peer;
  private conn?: DataConnection;
  private fast?: RTCDataChannel;
  private pingTimer?: number;

  static async join(code: string, name: string, cb: SessionCallbacks): Promise<ClientSession> {
    const s = new ClientSession();
    s.cb = cb;
    s.code = code.toUpperCase();
    const { peer, conn } = await connectToRoom(s.code);
    s.peer = peer;
    s.conn = conn;
    s.fast = openFastChannel(conn);
    s.fast.onmessage = (e) => {
      if (s.status === 'playing') s.cb.onSnapshot?.(e.data);
    };
    conn.on('data', (d) => s.onReliable(d as ReliableMsg));
    conn.on('close', () => s.setStatus('closed', 'Der Host hat das Spiel beendet.'));
    conn.peerConnection.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed'].includes(conn.peerConnection.connectionState)) s.setStatus('closed', 'Verbindung zum Host verloren.');
    });
    sendReliable(conn, { t: 'hello', name, version: PROTOCOL_VERSION });
    s.pingTimer = window.setInterval(() => s.measurePing(), 2000);
    return s;
  }

  private setStatus(st: SessionStatus, detail?: string) {
    if (this.status === 'closed') return;
    this.status = st;
    this.cb.onStatus?.(st, detail);
  }

  private measurePing() {
    void this.conn?.peerConnection.getStats().then((stats) => {
      stats.forEach((r: any) => {
        if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) this.ping = Math.round(r.currentRoundTripTime * 1000);
      });
    });
  }

  private onReliable(m: ReliableMsg) {
    switch (m.t) {
      case 'wait':
        this.setStatus('waiting');
        this.cb.onWait?.(m.safe, m.total);
        break;
      case 'welcome':
        this.localId = m.id;
        this.levelId = m.levelId;
        this.setStatus('playing');
        break;
      case 'roster':
        this.roster = new Map(m.players.map((p) => [p.id, p.name]));
        this.cb.onRoster?.(m.players);
        break;
      case 'events':
        this.cb.onEvents?.(m.list);
        break;
      case 'joinWaiting':
        this.cb.onJoinWaiting?.(m.name);
        break;
      case 'saved':
        this.cb.onSaved?.(m.at);
        break;
      case 'pickups':
        this.cb.onPickups?.(m.list);
        break;
      case 'reject':
        this.setStatus('closed', m.reason === 'full' ? 'Raum ist voll (6 Spieler).' : 'Andere Spielversion – bitte Seite neu laden.');
        break;
      default:
        this.cb.onPrivate?.(m);
    }
  }

  sendInput(buf: ArrayBuffer) {
    if (this.status === 'playing') sendFast(this.fast, buf);
  }

  sendAction(action: unknown) {
    sendReliable(this.conn, { t: 'action', action });
  }

  requestSave() {
    sendReliable(this.conn, { t: 'saveRequest' });
  }

  close() {
    this.status = 'closed';
    window.clearInterval(this.pingTimer);
    this.fast?.close();
    this.conn?.close();
    this.peer?.destroy();
  }
}
