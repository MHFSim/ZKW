import { GRAVITY, MAX_FALL, TILE } from './constants';
import { isLadder, type Level, type Rect } from './level';
import type { Body } from './types';

export interface CollisionWorld {
  level: Level;
  /** Bitmaske geöffneter Türen */
  doorsOpen: number;
}

function doorOpenAt(cw: CollisionWorld, tx: number, ty: number) {
  const id = cw.level.doorIndex[ty * cw.level.width + tx];
  return id >= 0 && (cw.doorsOpen & (1 << id)) !== 0;
}

/** Feste Kachel (ohne Stege – die sind nur von oben fest). */
export function isSolidTile(cw: CollisionWorld, tx: number, ty: number): boolean {
  const { level } = cw;
  if (tx < 0 || tx >= level.width) return true;
  if (ty < 0) return false;
  if (ty >= level.height) return true;
  const c = level.rows[ty][tx];
  if (c === '#' || c === 'c') return true;
  if (c === 'D') return !doorOpenAt(cw, tx, ty);
  return false;
}

export function isPlatform(cw: CollisionWorld, tx: number, ty: number) {
  if (tx < 0 || ty < 0 || tx >= cw.level.width || ty >= cw.level.height) return false;
  return cw.level.rows[ty][tx] === '=';
}

export function isWater(cw: CollisionWorld, x: number, y: number) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor((y - 2) / TILE);
  if (tx < 0 || ty < 0 || tx >= cw.level.width || ty >= cw.level.height) return false;
  return cw.level.rows[ty][tx] === 'w';
}

function overlapsBlocked(left: number, top: number, right: number, bottom: number, blocked?: Rect[]): boolean {
  if (!blocked) return false;
  for (const r of blocked) if (right > r.x && left < r.x + r.w && bottom > r.y && top < r.y + r.h) return true;
  return false;
}

function collides(cw: CollisionWorld, left: number, top: number, right: number, bottom: number, blocked?: Rect[]) {
  const tx0 = Math.floor(left / TILE);
  const tx1 = Math.floor((right - 0.001) / TILE);
  const ty0 = Math.floor(top / TILE);
  const ty1 = Math.floor((bottom - 0.001) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (isSolidTile(cw, tx, ty)) return true;
  return overlapsBlocked(left, top, right, bottom, blocked);
}

/** Landet der Körper beim Fallen von oben auf einem Steg? */
function landsOnPlatform(cw: CollisionWorld, left: number, right: number, prevBottom: number, newBottom: number) {
  const rowTop = Math.floor((newBottom - 0.001) / TILE);
  const surface = rowTop * TILE;
  if (prevBottom > surface + 0.5) return false;
  const tx0 = Math.floor(left / TILE);
  const tx1 = Math.floor((right - 0.001) / TILE);
  for (let tx = tx0; tx <= tx1; tx++) if (isPlatform(cw, tx, rowTop)) return true;
  return false;
}

export interface StepOptions {
  blocked?: Rect[];
  /** durch Stege nach unten fallen */
  dropThrough?: boolean;
  /** an einer Leiter: keine Schwerkraft */
  noGravity?: boolean;
}

/**
 * Bewegt einen Körper (Fußpunkt x/y, Breite w, Höhe h) achsenweise und löst Kollisionen.
 * Läuft identisch auf Host und Client – Grundlage für die Vorhersage.
 */
export function stepBody(cw: CollisionWorld, b: Body, dt: number, opts: StepOptions = {}): { hitWall: boolean } {
  if (!opts.noGravity) b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
  const half = b.w / 2;
  let hitWall = false;
  const blocked = opts.blocked;

  const dx = b.vx * dt;
  const stepsX = Math.max(1, Math.ceil(Math.abs(dx) / 8));
  for (let i = 0; i < stepsX; i++) {
    const nx = b.x + dx / stepsX;
    if (collides(cw, nx - half, b.y - b.h, nx + half, b.y, blocked)) {
      b.vx = 0;
      hitWall = true;
      break;
    }
    b.x = nx;
  }

  const dy = b.vy * dt;
  const stepsY = Math.max(1, Math.ceil(Math.abs(dy) / 8));
  b.onGround = false;
  for (let i = 0; i < stepsY; i++) {
    const ny = b.y + dy / stepsY;
    const solidHit = collides(cw, b.x - half, ny - b.h, b.x + half, ny, blocked);
    const platformHit = !solidHit && b.vy > 0 && !opts.dropThrough && landsOnPlatform(cw, b.x - half, b.x + half, b.y, ny);
    if (solidHit || platformHit) {
      if (b.vy > 0) {
        b.onGround = true;
        const snapped = Math.floor(ny / TILE) * TILE;
        if (snapped >= b.y && !collides(cw, b.x - half, snapped - b.h, b.x + half, snapped, blocked)) b.y = snapped;
      }
      b.vy = 0;
      break;
    }
    b.y = ny;
  }
  return { hitWall };
}

/** Überlappt der Körper eine Leiter? Liefert die Leiter-Spalte (Mitte in px) oder -1. */
export function ladderAt(cw: CollisionWorld, x: number, footY: number, h: number): number {
  const tx = Math.floor(x / TILE);
  for (const cx of [tx, Math.floor((x - 14) / TILE), Math.floor((x + 14) / TILE)]) {
    for (const y of [footY - 4, footY - h / 2, footY + 2]) {
      if (isLadder(cw.level, cx, Math.floor(y / TILE))) return cx * TILE + TILE / 2;
    }
  }
  return -1;
}

/** Strahl gegen Kacheln: liefert die Entfernung bis zur ersten festen Kachel (oder maxDist). */
export function raycastTiles(cw: CollisionWorld, x: number, y: number, dirX: number, dirY: number, maxDist: number): number {
  const step = 6;
  for (let d = 0; d <= maxDist; d += step) {
    if (isSolidTile(cw, Math.floor((x + dirX * d) / TILE), Math.floor((y + dirY * d) / TILE))) return d;
  }
  return maxDist;
}

/** Strahl gegen achsenparallele Box; liefert Eintrittsdistanz oder -1. */
export function rayBox(x: number, y: number, dx: number, dy: number, left: number, top: number, right: number, bottom: number): number {
  let tmin = -Infinity;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (x < left || x > right) return -1;
  } else {
    const t1 = (left - x) / dx;
    const t2 = (right - x) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (Math.abs(dy) < 1e-9) {
    if (y < top || y > bottom) return -1;
  } else {
    const t1 = (top - y) / dy;
    const t2 = (bottom - y) / dy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (tmax < 0 || tmin > tmax) return -1;
  return Math.max(0, tmin);
}
