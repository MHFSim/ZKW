import Peer, { type DataConnection, type PeerOptions } from 'peerjs';

/**
 * Verbindungsaufbau ohne eigenen Server: Der Host-Browser meldet sich beim öffentlichen
 * PeerJS-Vermittlungsdienst unter einer ID an, die aus dem Raum-Code entsteht.
 * Mitspieler verbinden sich mit dieser ID. Danach laufen alle Spieldaten direkt
 * von Browser zu Browser (WebRTC) – der Vermittlungsdienst ist nicht mehr beteiligt.
 *
 * Kanäle pro Verbindung:
 *  - PeerJS-Verbindung: zuverlässig + geordnet (JSON) – Beitritt, Ereignisse, Handel, Speichern
 *  - eigener Kanal "fast": ungeordnet, ohne Wiederholung (wie UDP) – Eingaben und Snapshots
 */
const ID_PREFIX = 'undeadweek1-';
const FAST_CHANNEL_ID = 200;

export function peerOptions(): PeerOptions {
  const env = import.meta.env;
  const opts: PeerOptions = { debug: 0 };
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    opts.port = Number(env.VITE_PEER_PORT ?? 443);
    opts.path = env.VITE_PEER_PATH ?? '/';
    opts.secure = env.VITE_PEER_SECURE !== 'false';
  }
  return opts;
}

export const roomPeerId = (code: string) => `${ID_PREFIX}${code.toUpperCase()}`;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O und 1/I
export function newRoomCode(): string {
  let c = '';
  for (let i = 0; i < 4; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return c;
}

/** Host meldet sich mit einem freien Raum-Code an. */
export async function openHostPeer(preferred?: string): Promise<{ peer: Peer; code: string }> {
  for (let attempt = 0; attempt < 6; attempt++) {
    // Zuerst den letzten Code wiederverwenden – alte Einladungs-Links bleiben gültig
    const code = attempt === 0 && preferred && /^[A-Z2-9]{4}$/.test(preferred) ? preferred : newRoomCode();
    const peer = new Peer(roomPeerId(code), peerOptions());
    const ok = await new Promise<boolean>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Vermittlungsdienst nicht erreichbar')), 10000);
      peer.once('open', () => {
        clearTimeout(t);
        resolve(true);
      });
      peer.once('error', (e: any) => {
        clearTimeout(t);
        if (e?.type === 'unavailable-id') resolve(false);
        else reject(new Error('Vermittlungsdienst nicht erreichbar'));
      });
    });
    if (ok) return { peer, code };
    peer.destroy();
  }
  throw new Error('Kein freier Raum-Code gefunden');
}

/** Mitspieler verbindet sich mit dem Raum. */
export async function connectToRoom(code: string): Promise<{ peer: Peer; conn: DataConnection }> {
  const peer = new Peer(peerOptions());
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Vermittlungsdienst nicht erreichbar')), 10000);
    peer.once('open', () => {
      clearTimeout(t);
      resolve();
    });
    peer.once('error', () => {
      clearTimeout(t);
      reject(new Error('Vermittlungsdienst nicht erreichbar'));
    });
  });
  const conn = peer.connect(roomPeerId(code), { reliable: true, serialization: 'json' });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Raum nicht gefunden oder Host nicht erreichbar')), 30000);
    conn.once('open', () => {
      clearTimeout(t);
      resolve();
    });
    peer.once('error', (e: any) => {
      clearTimeout(t);
      reject(new Error(e?.type === 'peer-unavailable' ? 'Raum nicht gefunden' : 'Verbindung fehlgeschlagen'));
    });
  });
  return { peer, conn };
}

/**
 * Schnellen Kanal auf derselben WebRTC-Verbindung öffnen. Beide Seiten legen ihn mit
 * derselben festen ID an ("negotiated") – dafür ist keine neue Verhandlung nötig.
 */
export function openFastChannel(conn: DataConnection): RTCDataChannel {
  const ch = conn.peerConnection.createDataChannel('fast', { negotiated: true, id: FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
  ch.binaryType = 'arraybuffer';
  return ch;
}

/** Schnellen Kanal nicht verstopfen: alte Snapshots verwerfen statt anstauen. */
export function sendFast(ch: RTCDataChannel | undefined, buf: ArrayBuffer) {
  if (ch && ch.readyState === 'open' && ch.bufferedAmount < 16 * 1024) ch.send(buf);
}

export function sendReliable(conn: DataConnection | undefined, msg: object) {
  if (conn?.open) void conn.send(msg);
}
