import { DT, JUMP_VELOCITY, PLAYER_ACCEL, PLAYER_H, PLAYER_MAX_HP, PLAYER_SPEED, PLAYER_W } from './constants';
import { weaponByKey, type WeaponInst } from './items';
import { isWater, ladderAt, stepBody, type CollisionWorld } from './physics';
import { InputBits, type Input, type PlayerState } from './types';

export const CLIMB_SPEED = 280;

export function createPlayer(id: number, name: string, x: number, y: number): PlayerState {
  const pistol = weaponByKey('dienstpistole');
  const start: WeaponInst = { uid: 1, def: pistol.id, tier: 1, element: 0, mag: pistol.mag, reserve: 48 };
  return {
    id,
    name,
    x,
    y,
    vx: 0,
    vy: 0,
    w: PLAYER_W,
    h: PLAYER_H,
    onGround: false,
    aim: 0,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    alive: true,
    downed: false,
    bleedOut: 0,
    reviveProgress: 0,
    respawnIn: 0,
    money: 500,
    lastSeq: 0,
    firing: false,
    fireCooldown: 0,
    reloading: 0,
    inSafe: false,
    safeId: -1,
    lastSafe: 0,
    kills: 0,
    climbing: false,
    level: 1,
    xp: 0,
    skillPoints: 0,
    skills: {},
    weapons: [start],
    active: 0,
    items: { verband: 2 },
    locker: { weapons: [], items: {} },
    lore: [],
    nextUid: 2,
    healCooldown: 0,
    burning: 0,
  };
}

function approach(v: number, target: number, maxDelta: number) {
  if (v < target) return Math.min(v + maxDelta, target);
  return Math.max(v - maxDelta, target);
}

/**
 * Eine Eingabe auf einen Spieler anwenden (ein Tick): Laufen, Springen, Leitern, Wasser.
 * Host UND Client rufen exakt diese Funktion auf – so stimmt die Vorhersage mit dem Host überein.
 */
export function applyMovement(cw: CollisionWorld, p: PlayerState, input: Input, dt = DT) {
  p.aim = input.aim;
  if (!p.alive || p.downed) {
    p.climbing = false;
    p.vx = approach(p.vx, p.downed ? Math.max(-1, Math.min(1, input.moveX)) * 40 : 0, PLAYER_ACCEL * dt);
    stepBody(cw, p, dt);
    return;
  }
  const move = Math.max(-1, Math.min(1, input.moveX));
  const up = (input.bits & InputBits.Up) !== 0;
  const down = (input.bits & InputBits.Down) !== 0;
  const jump = (input.bits & InputBits.Jump) !== 0;
  let speed = PLAYER_SPEED * (1 + 0.05 * (p.skills.tempo ?? 0));
  if (isWater(cw, p.x, p.y)) speed *= 0.65;

  const lx = ladderAt(cw, p.x, p.y, p.h);
  if (!p.climbing && lx >= 0 && (up || (down && Math.abs(lx - p.x) < 24))) {
    p.climbing = true;
    p.vx = 0;
  }
  if (p.climbing) {
    if (lx < 0) {
      p.climbing = false;
      if (up) p.vy = -260; // oben aussteigen
    } else if (jump && !up) {
      p.climbing = false;
      p.vy = JUMP_VELOCITY * 0.7;
    } else {
      p.x += (lx - p.x) * Math.min(1, dt * 12);
      p.vx = move * 90;
      p.vy = up ? -CLIMB_SPEED : down ? CLIMB_SPEED : 0;
      stepBody(cw, p, dt, { noGravity: true, dropThrough: true });
      if (down && p.onGround) p.climbing = false;
      return;
    }
  }

  p.vx = approach(p.vx, move * speed, PLAYER_ACCEL * dt);
  if (jump && p.onGround) {
    p.vy = JUMP_VELOCITY;
    p.onGround = false;
  }
  stepBody(cw, p, dt, { dropThrough: down && !jump });
}

/** Schulterhöhe – von hier gehen Schüsse und die Taschenlampe aus. */
export function muzzleOrigin(p: { x: number; y: number; aim: number }) {
  return { x: p.x + Math.cos(p.aim) * 26, y: p.y - 38 + Math.sin(p.aim) * 26 };
}

export const PLAYER_HEIGHT = PLAYER_H;
