import type { Action, World } from './world';
import type { GameEvent, Input } from './types';

/**
 * Binärprotokoll für den schnellen (unzuverlässigen) Kanal.
 * Kein JSON: kleiner und schneller zu lesen.
 */
export const MsgType = { Snapshot: 1, Input: 2 } as const;

const TAU = Math.PI * 2;
const encAngle = (a: number) => Math.round(((((a % TAU) + TAU) % TAU) / TAU) * 255) & 255;
const decAngle = (b: number) => (b / 255) * TAU;
const u16 = (v: number) => Math.max(0, Math.min(65535, Math.round(v)));
const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

// ---------- Eingabe: 6 Byte ----------

export function encodeInput(i: Input): ArrayBuffer {
  const buf = new ArrayBuffer(6);
  const v = new DataView(buf);
  v.setUint8(0, MsgType.Input);
  v.setUint16(1, i.seq & 0xffff);
  v.setInt8(3, Math.round(Math.max(-1, Math.min(1, i.moveX)) * 127));
  v.setUint8(4, encAngle(i.aim));
  v.setUint8(5, i.bits & 255);
  return buf;
}

export function decodeInput(buf: ArrayBuffer): Input | null {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 6) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== MsgType.Input) return null;
  return { seq: v.getUint16(1), moveX: v.getInt8(3) / 127, aim: decAngle(v.getUint8(4)), bits: v.getUint8(5) };
}

/** Werte so quantisieren, wie sie über das Netz ankommen (für exakte Vorhersage). */
export const quantizeAngle = (a: number) => decAngle(encAngle(a));
export const quantizeMove = (m: number) => Math.round(Math.max(-1, Math.min(1, m)) * 127) / 127;

// ---------- Snapshot ----------

export interface NetPlayer {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  hp: number;
  maxHp: number;
  onGround: boolean;
  alive: boolean;
  firing: boolean;
  inSafe: boolean;
  downed: boolean;
  climbing: boolean;
  reloading: boolean;
  weapon: number;
  level: number;
  money: number;
  lastSeq: number;
  kills: number;
  revive: number;
}

export interface NetZombie {
  id: number;
  x: number;
  y: number;
  kind: number;
  hpPct: number;
  facing: 1 | -1;
  hitFlash: boolean;
  burning: boolean;
  slowed: boolean;
}

export interface NetProjectile {
  kind: number;
  x: number;
  y: number;
}

export interface Snapshot {
  tick: number;
  hour: number;
  day: number;
  rain: number;
  doorsOpen: number;
  grace: boolean;
  power: boolean;
  horde: boolean;
  victory: boolean;
  teleportsOpen: number;
  radioParts: number;
  radioPhase: number;
  radioTimer: number;
  truheSpot: number;
  players: NetPlayer[];
  zombies: NetZombie[];
  projectiles: NetProjectile[];
}

const HEADER = 1 + 4 + 4 + 1 + 4 + 1 + 1 + 1 + 1 + 2 + 1 + 2 + 1 + 2 + 2;
const PLAYER_BYTES = 1 + 16 + 1 + 1 + 1 + 1 + 1 + 1 + 4 + 2 + 2 + 1;
const ZOMBIE_BYTES = 2 + 2 + 2 + 1 + 1 + 1;
const PROJ_BYTES = 1 + 2 + 2;

export function encodeSnapshot(w: World): ArrayBuffer {
  const players = [...w.players.values()];
  const zombies = [...w.zombies.values()];
  const projs = [...w.projectiles.values()];
  const buf = new ArrayBuffer(HEADER + players.length * PLAYER_BYTES + zombies.length * ZOMBIE_BYTES + projs.length * PROJ_BYTES);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, MsgType.Snapshot); o += 1;
  v.setUint32(o, w.tick); o += 4;
  v.setFloat32(o, w.hour); o += 4;
  v.setUint8(o, u8(w.rain * 255)); o += 1;
  v.setUint32(o, w.doorsOpen >>> 0); o += 4;
  v.setUint8(o, (w.grace > 0 ? 1 : 0) | (w.power ? 2 : 0) | (w.horde ? 4 : 0) | (w.victory ? 8 : 0)); o += 1;
  v.setUint8(o, w.teleportsOpen & 255); o += 1;
  v.setUint8(o, w.radioParts & 255); o += 1;
  v.setUint8(o, w.radioPhase & 255); o += 1;
  v.setUint16(o, u16(w.radioTimer * 10)); o += 2;
  v.setUint8(o, w.truheSpot & 255); o += 1;
  v.setUint16(o, w.day & 0xffff); o += 2;
  v.setUint8(o, players.length); o += 1;
  v.setUint16(o, zombies.length); o += 2;
  v.setUint16(o, projs.length); o += 2;
  for (const p of players) {
    const w0 = p.weapons[p.active];
    v.setUint8(o, p.id); o += 1;
    v.setFloat32(o, p.x); o += 4;
    v.setFloat32(o, p.y); o += 4;
    v.setFloat32(o, p.vx); o += 4;
    v.setFloat32(o, p.vy); o += 4;
    v.setUint8(o, encAngle(p.aim)); o += 1;
    v.setUint8(o, u8(p.hp)); o += 1;
    v.setUint8(o, u8(p.maxHp)); o += 1;
    v.setUint8(o, (p.onGround ? 1 : 0) | (p.alive ? 2 : 0) | (p.firing ? 4 : 0) | (p.inSafe ? 8 : 0) | (p.downed ? 16 : 0) | (p.climbing ? 32 : 0) | (p.reloading > 0 ? 64 : 0)); o += 1;
    v.setUint8(o, w0 ? w0.def : 0); o += 1;
    v.setUint8(o, u8(p.level)); o += 1;
    v.setUint32(o, Math.max(0, Math.round(p.money))); o += 4;
    v.setUint16(o, p.lastSeq & 0xffff); o += 2;
    v.setUint16(o, p.kills & 0xffff); o += 2;
    v.setUint8(o, u8(p.reviveProgress * 255)); o += 1;
  }
  for (const z of zombies) {
    v.setUint16(o, z.id); o += 2;
    v.setUint16(o, u16(z.x)); o += 2;
    v.setUint16(o, u16(z.y)); o += 2;
    v.setUint8(o, z.kind); o += 1;
    v.setUint8(o, u8((z.hp / z.maxHp) * 255)); o += 1;
    v.setUint8(o, (z.facing > 0 ? 1 : 0) | (z.hitFlash > 0 ? 2 : 0) | (z.burning > 0 ? 4 : 0) | (z.slowed > 0 ? 8 : 0)); o += 1;
  }
  for (const p of projs) {
    v.setUint8(o, p.kind); o += 1;
    v.setUint16(o, u16(p.x)); o += 2;
    v.setUint16(o, u16(p.y)); o += 2;
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot | null {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < HEADER) return null;
  const v = new DataView(buf);
  let o = 0;
  if (v.getUint8(o) !== MsgType.Snapshot) return null;
  o += 1;
  const tick = v.getUint32(o); o += 4;
  const hour = v.getFloat32(o); o += 4;
  const rain = v.getUint8(o) / 255; o += 1;
  const doorsOpen = v.getUint32(o); o += 4;
  const f = v.getUint8(o); o += 1;
  const teleportsOpen = v.getUint8(o); o += 1;
  const radioParts = v.getUint8(o); o += 1;
  const radioPhase = v.getUint8(o); o += 1;
  const radioTimer = v.getUint16(o) / 10; o += 2;
  const truheSpot = v.getUint8(o); o += 1;
  const day = v.getUint16(o); o += 2;
  const np = v.getUint8(o); o += 1;
  const nz = v.getUint16(o); o += 2;
  const npr = v.getUint16(o); o += 2;
  const players: NetPlayer[] = [];
  for (let i = 0; i < np; i++) {
    const id = v.getUint8(o); o += 1;
    const x = v.getFloat32(o); o += 4;
    const y = v.getFloat32(o); o += 4;
    const vx = v.getFloat32(o); o += 4;
    const vy = v.getFloat32(o); o += 4;
    const aim = decAngle(v.getUint8(o)); o += 1;
    const hp = v.getUint8(o); o += 1;
    const maxHp = v.getUint8(o); o += 1;
    const fl = v.getUint8(o); o += 1;
    const weapon = v.getUint8(o); o += 1;
    const level = v.getUint8(o); o += 1;
    const money = v.getUint32(o); o += 4;
    const lastSeq = v.getUint16(o); o += 2;
    const kills = v.getUint16(o); o += 2;
    const revive = v.getUint8(o) / 255; o += 1;
    players.push({
      id, x, y, vx, vy, aim, hp, maxHp, weapon, level, money, lastSeq, kills, revive,
      onGround: !!(fl & 1), alive: !!(fl & 2), firing: !!(fl & 4), inSafe: !!(fl & 8), downed: !!(fl & 16), climbing: !!(fl & 32), reloading: !!(fl & 64),
    });
  }
  const zombies: NetZombie[] = [];
  for (let i = 0; i < nz; i++) {
    const id = v.getUint16(o); o += 2;
    const x = v.getUint16(o); o += 2;
    const y = v.getUint16(o); o += 2;
    const kind = v.getUint8(o); o += 1;
    const hpPct = v.getUint8(o) / 255; o += 1;
    const zf = v.getUint8(o); o += 1;
    zombies.push({ id, x, y, kind, hpPct, facing: zf & 1 ? 1 : -1, hitFlash: !!(zf & 2), burning: !!(zf & 4), slowed: !!(zf & 8) });
  }
  const projectiles: NetProjectile[] = [];
  for (let i = 0; i < npr; i++) {
    const kind = v.getUint8(o); o += 1;
    const x = v.getUint16(o); o += 2;
    const y = v.getUint16(o); o += 2;
    projectiles.push({ kind, x, y });
  }
  return {
    tick, hour, day, rain, doorsOpen, teleportsOpen, radioParts, radioPhase, radioTimer, truheSpot,
    grace: !!(f & 1), power: !!(f & 2), horde: !!(f & 4), victory: !!(f & 8),
    players, zombies, projectiles,
  };
}

// ---------- Zuverlässiger Kanal (JSON, selten) ----------

export const PROTOCOL_VERSION = 2;

export interface PickupInfo {
  id: number;
  kind: string;
  x: number;
  y: number;
}

export type ReliableMsg =
  | { t: 'hello'; name: string; version: number }
  | { t: 'welcome'; id: number; levelId: string }
  | { t: 'wait'; safe: number; total: number }
  | { t: 'roster'; players: { id: number; name: string }[] }
  | { t: 'events'; list: GameEvent[] }
  | { t: 'reject'; reason: 'full' | 'version' | 'timeout' }
  | { t: 'saveRequest' }
  | { t: 'saved'; at: number }
  | { t: 'joinWaiting'; name: string }
  | { t: 'action'; action: Action }
  | { t: 'pickups'; list: PickupInfo[] }
  | { t: 'me'; me: any; interaction: any }
  | { t: 'toast'; text: string; tone?: string }
  | { t: 'station'; kind: string; station: number; safe: number }
  | { t: 'lore'; id: number }
  | { t: 'trade'; me: any; other: any }
  | { t: 'tradeInvite'; from: number; name: string }
  | { t: 'tradeClosed'; done: boolean };
