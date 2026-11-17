import { zoneAt, type Level } from '@zkw/shared';
import { T } from './textures';

const AIRISH = new Set(['.', 'b', 'w', '=']);

/** Wählt für jede Kachel die passende Grafik (je nach Zone, Nachbarn, Tiefe). */
export function buildTileLayers(level: Level) {
  const { width: W, height: H, rows } = level;
  const back: number[][] = [];
  const main: number[][] = [];
  const ladders: number[][] = [];
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? '#' : rows[y][x]);
  const inSafe = (x: number, y: number) =>
    level.safeZones.some((s) => x * 64 >= s.rect.x && x * 64 < s.rect.x + s.rect.w && y * 64 >= s.rect.y && y * 64 < s.rect.y + s.rect.h);

  for (let y = 0; y < H; y++) {
    const b: number[] = [];
    const m: number[] = [];
    const l: number[] = [];
    for (let x = 0; x < W; x++) {
      const c = rows[y][x];
      const zone = zoneAt(level, x * 64 + 32, y * 64 + 32);
      const under = zone.weather === 'under' && y > 150;
      let bt = -1;
      let mt = -1;
      if (c === 'b' || c === 'w' || c === 'D' || (c === '=' && under)) {
        if (inSafe(x, y)) bt = T.backInterior;
        else if (under) bt = zone.id === 10 ? T.backLab : zone.id === 9 ? T.backSewer : T.backConcrete;
        else bt = AIRISH.has(at(x, y - 1)) && at(x, y - 1) !== 'b' ? T.backConcrete : T.backRock;
      }
      if (c === 'c') mt = T.crate;
      else if (c === '=') mt = T.metal;
      else if (c === 'w') mt = T.water;
      else if (c === '#') {
        const n = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
        const airN = n.filter((v) => AIRISH.has(v)).length;
        const above = at(x, y - 1);
        if (under || (y > 150 && n.includes('b'))) {
          const nearB = n.includes('b') || n.includes('w') || n.includes('=');
          mt = nearB ? (zone.id === 10 ? T.labWall : zone.id === 9 ? T.sewer : T.brick) : T.rock;
        } else if (above === '.') {
          mt =
            zone.id === 1 ? T.snowTop
            : zone.id === 2 || zone.id === 4 ? T.grass
            : zone.id === 5 ? T.asphalt
            : airN >= 3 ? T.brick
            : T.street;
          if (airN >= 3 && zone.id !== 1) mt = T.brick;
        } else if ((AIRISH.has(at(x - 1, y)) && AIRISH.has(at(x + 1, y))) || (above === 'b' && at(x, y + 1) !== '#')) {
          mt = T.brick;
        } else {
          let depth = 0;
          while (depth < 4 && at(x, y - depth - 1) === '#') depth++;
          const alpine = zone.weather === 'alpine';
          mt = depth < 3 && at(x, y - depth - 1) === '.' ? (alpine ? T.snowRock : T.earth) : alpine ? T.snowRock : T.rock;
        }
      }
      b.push(bt);
      m.push(mt);
      l.push(level.ladders[y * W + x] ? T.ladder : -1);
    }
    back.push(b);
    main.push(m);
    ladders.push(l);
  }
  return { back, main, ladders };
}
