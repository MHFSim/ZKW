export interface ZombieDef {
  name: string;
  hp: number;
  speed: number;
  damage: number;
  w: number;
  h: number;
  headArmor: boolean;
  xp: number;
  money: number;
  ranged?: { range: number; cooldown: number; damage: number; proj: number };
  explode?: number;
  aura?: number;
  fireWeak?: boolean;
  frostImmune?: boolean;
  boss?: boolean;
}

export const ZOMBIES: ZombieDef[] = [
  { name: 'Schlurfer', hp: 60, speed: 75, damage: 12, w: 32, h: 60, headArmor: false, xp: 12, money: 60 },
  { name: 'Renner', hp: 40, speed: 175, damage: 10, w: 30, h: 58, headArmor: false, xp: 14, money: 60 },
  { name: 'Brocken', hp: 420, speed: 55, damage: 26, w: 46, h: 72, headArmor: true, xp: 60, money: 160 },
  { name: 'Knaller', hp: 50, speed: 165, damage: 0, w: 32, h: 58, headArmor: false, xp: 20, money: 80, explode: 115 },
  { name: 'Schlammwälzer', hp: 160, speed: 70, damage: 18, w: 40, h: 62, headArmor: false, xp: 30, money: 100 },
  { name: 'Schwärmer', hp: 26, speed: 195, damage: 6, w: 26, h: 44, headArmor: false, xp: 8, money: 35 },
  { name: 'Spucker', hp: 85, speed: 80, damage: 10, w: 32, h: 60, headArmor: false, xp: 26, money: 90, ranged: { range: 560, cooldown: 2.4, damage: 14, proj: 0 } },
  { name: 'Skifahrer', hp: 60, speed: 235, damage: 14, w: 32, h: 60, headArmor: false, xp: 22, money: 80 },
  { name: 'Elektriker', hp: 130, speed: 70, damage: 16, w: 34, h: 62, headArmor: false, xp: 34, money: 110, aura: 90 },
  { name: 'Wilderer', hp: 95, speed: 90, damage: 14, w: 32, h: 60, headArmor: false, xp: 30, money: 100, ranged: { range: 620, cooldown: 2.8, damage: 16, proj: 4 } },
  { name: 'Erfrorener', hp: 210, speed: 70, damage: 22, w: 38, h: 64, headArmor: true, xp: 40, money: 130, fireWeak: true, frostImmune: true },
  { name: 'Mutant', hp: 7000, speed: 120, damage: 45, w: 74, h: 112, headArmor: true, xp: 2000, money: 3000, boss: true },
];

export const ZOMBIE_TEXTURES = [
  'z-shambler', 'z-runner', 'z-brute', 'z-bomber', 'z-mud', 'z-swarm', 'z-spitter', 'z-skier', 'z-electric', 'z-poacher', 'z-frozen', 'z-mutant',
];
