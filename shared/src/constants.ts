/** Simulationstakt: 60 Ticks pro Sekunde auf dem Host. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Kachelgröße in Pixeln. */
export const TILE = 64;

export const MAX_PLAYERS = 6;
export const MAX_ZOMBIES = 40;

/** Spieler-Physik */
export const PLAYER_W = 30;
export const PLAYER_H = 58;
export const PLAYER_SPEED = 290;
export const PLAYER_ACCEL = 2600;
export const JUMP_VELOCITY = -640;
export const GRAVITY = 1600;
export const MAX_FALL = 1400;
export const PLAYER_MAX_HP = 100;

/** Zombie-Physik */
export const ZOMBIE_W = 32;
export const ZOMBIE_H = 60;
export const ZOMBIE_HEAD_H = 16;

/** Waffe im Prototyp: Sturmgewehr "Falke" */
export const WEAPON = {
  name: 'Falke',
  damage: 30,
  fireRate: 9,
  range: 950,
  spreadRad: 0.025,
} as const;

/** Wirtschaft */
export const MONEY_HIT = 10;
export const MONEY_KILL = 60;
export const MONEY_HEADSHOT_KILL = 100;
export const DEATH_MONEY_LOSS = 0.25;
export const RESPAWN_SECONDS = 3;

/** Länge eines Spieltags in Sekunden (im Prototyp kurz, damit man den Zyklus sieht). */
export const DAY_LENGTH_SECONDS = 6 * 60;

/** Schutzzeit nach dem Laden eines Spielstands: Zombies stehen still. */
export const LOAD_GRACE_SECONDS = 3;
