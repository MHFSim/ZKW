import type { ItemKey, SkillKey, WeaponInst } from './items';

/** Tasten-Bits der Eingabe (ein Byte). */
export const InputBits = {
  Jump: 1 << 0,
  Fire: 1 << 1,
  Interact: 1 << 2,
  Up: 1 << 3,
  Down: 1 << 4,
  Reload: 1 << 5,
  Switch: 1 << 6,
  Heal: 1 << 7,
} as const;

export interface Input {
  seq: number;
  /** -1 … 1, analog (Touch-Stick) */
  moveX: number;
  /** Zielwinkel in Radiant */
  aim: number;
  bits: number;
}

export const emptyInput = (): Input => ({ seq: 0, moveX: 0, aim: 0, bits: 0 });

export interface Body {
  x: number; // Fußpunkt x (Mitte)
  y: number; // Fußpunkt y
  vx: number;
  vy: number;
  w: number;
  h: number;
  onGround: boolean;
}

export interface PlayerState extends Body {
  id: number;
  name: string;
  aim: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** am Boden, kann wiederbelebt werden */
  downed: boolean;
  bleedOut: number;
  reviveProgress: number;
  respawnIn: number;
  money: number;
  lastSeq: number;
  firing: boolean;
  fireCooldown: number;
  reloading: number;
  inSafe: boolean;
  safeId: number;
  lastSafe: number;
  kills: number;
  climbing: boolean;
  /** Bewegungsgefühl: Zeit seit Bodenkontakt (Coyote-Time), gepufferter Sprung, Sprungtaste gehalten */
  coyote?: number;
  jumpBuf?: number;
  jumpHeld?: boolean;
  // Fortschritt
  level: number;
  xp: number;
  skillPoints: number;
  skills: Partial<Record<SkillKey, number>>;
  // Inventar
  weapons: WeaponInst[];
  active: number;
  items: Partial<Record<ItemKey, number>>;
  locker: { weapons: WeaponInst[]; items: Partial<Record<ItemKey, number>> };
  lore: number[];
  nextUid: number;
  healCooldown: number;
  burning: number;
}

/**
 * Zombie-Arten:
 * 0 Schlurfer, 1 Renner, 2 Brocken, 3 Knaller, 4 Schlammwälzer, 5 Schwärmer,
 * 6 Spucker, 7 Skifahrer, 8 Elektriker, 9 Wilderer, 10 Erfrorener, 11 Mutant (Boss)
 */
export type ZombieKind = number;

export interface ZombieState extends Body {
  id: number;
  kind: ZombieKind;
  hp: number;
  maxHp: number;
  facing: 1 | -1;
  attackCooldown: number;
  targetId: number;
  retargetIn: number;
  hitFlash: number;
  zone: number;
  burning: number;
  slowed: number;
  stun: number;
  charge: number;
}

export interface Projectile {
  id: number;
  kind: number; // 0 Säure, 1 Granate, 2 Rakete, 3 Molotow, 4 Falle
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: number; // Spieler-Id oder -1 (Zombie)
  life: number;
  damage: number;
}

export interface Pickup {
  id: number;
  kind: 'loot' | 'bag' | 'lore' | 'funkteil';
  x: number;
  y: number;
  items?: Partial<Record<ItemKey, number>>;
  money?: number;
  ref?: number;
  owner?: string;
}

/** Ereignisse für Effekte und Meldungen (Host → alle). */
export type GameEvent =
  | { t: 'hit'; x: number; y: number; head: boolean; elem?: number }
  | { t: 'kill'; x: number; y: number; head: boolean; by: number; kind: number }
  | { t: 'door'; door: number; by: number }
  | { t: 'playerDown'; id: number }
  | { t: 'playerDead'; id: number }
  | { t: 'revived'; id: number; by: number }
  | { t: 'enterSafe'; id: number; safe: number }
  | { t: 'explosion'; x: number; y: number; r: number }
  /** Schuss: Mündung (x, y) und je Projektil Winkel a[i] (rad·1000) und Flugweite d[i] in px (negativ = endet in der Luft, kein Einschlag) */
  | { t: 'shot'; id: number; weapon: number; x: number; y: number; a: number[]; d: number[] }
  | { t: 'melee'; id: number }
  | { t: 'truhe'; id: number; weapon: number; spot: number }
  | { t: 'pickup'; id: number; kind: string; text: string }
  | { t: 'levelUp'; id: number; level: number }
  | { t: 'notice'; text: string; tone?: 'ok' | 'warn' | 'info' }
  | { t: 'generator' }
  | { t: 'teleport'; id: number; tp: number }
  | { t: 'lightning'; x: number }
  | { t: 'horde'; on: boolean }
  | { t: 'radio'; phase: number }
  | { t: 'victory' }
  | { t: 'zombieAttack'; x: number; y: number }
  | { t: 'reload'; id: number };
