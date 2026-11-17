import { TILE } from './constants';
import type { StationKind } from './items';

/**
 * Kachel-Zeichen:
 *  '#' Fels/Mauer   'c' Kiste/Container   '=' Stahlsteg (von unten durchspringbar)
 *  'D' Tür/Luke (fest, bis gekauft)       'b' Rückwand (begehbar, verdeckt den Himmel)
 *  'w' Wasser (begehbar, bremst)          '.' Luft
 * Leitern liegen in einem eigenen Raster (können auch hinter einer Luke liegen).
 */
export type TileChar = '#' | 'c' | '=' | 'D' | 'b' | 'w' | '.';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Door {
  id: number;
  name: string;
  price: number;
  cells: [number, number][];
  /** Mittelpunkt (px) für die Interaktion */
  cx: number;
  cy: number;
  /** öffnet sich automatisch, sobald der Generator läuft */
  needsPower?: boolean;
  /** Zone, die diese Tür freischaltet (Spawns) */
  unlocksZone?: number;
}

export interface Lamp {
  tx: number;
  ty: number;
  kind: 'street' | 'interior' | 'neon' | 'cold' | 'alarm';
}

export interface SafeZone {
  id: number;
  name: string;
  rect: Rect;
  spawn: { x: number; y: number };
  /** Tür, die offen sein muss, damit die Zuflucht nutzbar ist (-1 = immer) */
  door: number;
  zone: number;
}

export interface Spawn {
  x: number;
  y: number;
  zone: number;
}

export interface WallBuy {
  id: number;
  x: number;
  y: number;
  weapon: string;
}

export interface Station {
  id: number;
  kind: StationKind;
  x: number;
  y: number;
  safe: number;
}

export interface Spot {
  id: number;
  x: number;
  y: number;
}

export interface LoreSpot extends Spot {
  title: string;
  text: string;
}

export interface Teleport {
  id: number;
  name: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
  price: number;
  needsPower: boolean;
  /** nur von Seite A aus freischaltbar */
  openFromA: boolean;
}

export type WeatherKind = 'under' | 'surface' | 'alpine';

export interface ZoneDef {
  id: number;
  name: string;
  rect: Rect; // in Kacheln
  weather: WeatherKind;
  danger: number;
  kinds: number[];
  /** Tür, die diese Zone erreichbar macht (-1 = Start) */
  door: number;
  ground: number; // Kachelreihe des Bodens (Oberfläche) bzw. Boden der Zone
}

export interface Level {
  id: string;
  name: string;
  width: number;
  height: number;
  rows: TileChar[][];
  ladders: Uint8Array;
  /** Tür-Id je Kachel (-1 = keine) */
  doorIndex: Int16Array;
  doors: Door[];
  lamps: Lamp[];
  safeZones: SafeZone[];
  zones: ZoneDef[];
  zombieSpawns: Spawn[];
  wallBuys: WallBuy[];
  truheSpots: Spot[];
  stations: Station[];
  lore: LoreSpot[];
  radioParts: Spot[];
  generator: Spot;
  radio: Spot;
  helipad: Rect;
  teleports: Teleport[];
  playerSpawn: { x: number; y: number };
}

export function isLadder(level: Level, tx: number, ty: number) {
  if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height) return false;
  return level.ladders[ty * level.width + tx] === 1;
}

export function zoneAt(level: Level, x: number, y: number): ZoneDef {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  for (const z of level.zones) {
    const r = z.rect;
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return z;
  }
  return level.zones[level.zones.length - 1];
}

export function zoneNameAt(level: Level, x: number, y = 0): string {
  return zoneAt(level, x, y).name;
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// =====================================================================
// Karte "Talkessel": vom Labor ganz unten bis zum Gipfel
// =====================================================================

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LORE_TEXTS: [string, string][] = [
  ['Laborbericht 1', 'Probe U-7 reagiert auf Licht. Nachts steigt die Aktivität um das Dreifache. Wir sollten das Licht in Block C nie ausschalten.'],
  ['Laborbericht 2', 'Der Sicherheitsraum hält. Dr. Weiss sagt, die Lüftung führt direkt in die Kanalisation. Wenn sie da durchkommen …'],
  ['Notiz am Kühlschrank', 'Wer die Schleuse öffnet, zahlt die Rechnung. 750 für die Wartung. Ja, auch im Weltuntergang.'],
  ['Kanalarbeiter', 'Das Wasser steigt bei jedem Regen. Unten in den Becken hab ich etwas atmen hören. Wir gehen nicht mehr runter.'],
  ['Tagebuch, Tag 3', 'Die U-Bahn fährt nicht mehr. Im Leitstand gibt es Notstrom und einen Funkteil-Vorrat – falls jemand ein Funkgerät reparieren will.'],
  ['Fahrplan, durchgestrichen', 'Letzte Fahrt 23:40. Darunter in roter Schrift: OBEN IST ES SICHERER. GEHT ZUM GIPFEL.'],
  ['Bahnhofsdurchsage', 'Ein Zettel am Mikrofon: „Hubschrauber nur auf Funkruf von der Hohen Wacht. Drei Teile fehlen am Sender.“'],
  ['Polizeiprotokoll', 'Die Wache ist verbarrikadiert. Hintertür nur mit Code – oder mit genug Geld für den Schlosser.'],
  ['Kinderzeichnung', 'Eine Gondel über Bergen, darunter: „Papa holt uns mit der Gondel ab, wenn der Strom wieder geht.“'],
  ['Tankwart', 'Wenn die Tankstelle hochgeht, nimmt sie die halbe Straße mit. Lockt sie her. Dann schießt.'],
  ['Hotel Alpenrose', 'Zimmer 12: Der Keller hat einen alten Gang runter zum Kanal. Nur von oben zu öffnen. Gut so.'],
  ['Pfarrer', 'Die Glocke ruft sie alle. Ich habe es einmal getan. Nie wieder.'],
  ['Kraftwerk, Schichtbuch', 'Generator läuft nur mit vollem Treibstoff – 2.500 Kosten für die Notversorgung. Danach Strom für das ganze Tal.'],
  ['Elektriker', 'Die Kollegen in der Turbinenhalle leuchten jetzt. Nicht anfassen.'],
  ['Förster', 'Die Wilderer werfen ihre Fallen immer noch. Sogar jetzt.'],
  ['Wetterstation', 'Ab 2.000 Metern schneit es, sobald es im Tal regnet. Die Erfrorenen hassen Feuer.'],
  ['Funker', 'Sender braucht drei Teile: Kanal, Leitstand, Kraftwerk. Dann zwei Wellen halten, bis der Heli landet.'],
  ['Letzte Seite', 'Was immer im Labor entstanden ist – es wartet oben. Es will auch weg von hier.'],
  ['Zettel im Spind', 'Werkbank in der Wache kann Stufe 3. Für mehr braucht ihr das Labor im Kraftwerk.'],
  ['Graffiti', 'WER DAS LIEST: AB IN DIE ZUFLUCHT, WENN DER MOND ROT WIRD.'],
];

export function buildTalkessel(): Level {
  const W = 340;
  const H = 240;
  const rows: TileChar[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => '#' as TileChar));
  const ladders = new Uint8Array(W * H);
  const set = (x: number, y: number, c: TileChar) => {
    if (x >= 0 && y >= 0 && x < W && y < H) rows[y][x] = c;
  };
  const get = (x: number, y: number): TileChar => (x >= 0 && y >= 0 && x < W && y < H ? rows[y][x] : '#');
  const fill = (x0: number, y0: number, x1: number, y1: number, c: TileChar) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };
  const ladder = (x: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) {
      ladders[y * W + x] = 1;
      if (get(x, y) === '#' || get(x, y) === 'c') set(x, y, 'b');
    }
  };
  const px = (t: number) => t * TILE + TILE / 2;
  const foot = (row: number) => row * TILE; // Fußpunkt auf Bodenreihe "row"

  const doors: Door[] = [];
  const lamps: Lamp[] = [];
  const safeZones: SafeZone[] = [];
  const spawns: Spawn[] = [];
  const wallBuys: WallBuy[] = [];
  const truheSpots: Spot[] = [];
  const stations: Station[] = [];
  const lore: LoreSpot[] = [];
  const radioParts: Spot[] = [];
  const teleports: Teleport[] = [];

  const addDoor = (name: string, price: number, cells: [number, number][], extra: Partial<Door> = {}) => {
    const id = doors.length;
    for (const [x, y] of cells) set(x, y, 'D');
    const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
    const cy = cells.reduce((s, c) => s + c[1], 0) / cells.length;
    doors.push({ id, name, price, cells, cx: cx * TILE + TILE / 2, cy: cy * TILE + TILE / 2, ...extra });
    return id;
  };

  // ---------- Zonen-Geometrie ----------
  // Oberfläche: Terrassen von links (Bahnhof) nach rechts oben (Gipfel)
  const surface = [
    { id: 7, x0: 0, x1: 89, g: 150 },
    { id: 6, x0: 90, x1: 145, g: 140 },
    { id: 5, x0: 146, x1: 189, g: 128 },
    { id: 4, x0: 190, x1: 241, g: 116 },
    { id: 3, x0: 242, x1: 279, g: 102 },
    { id: 2, x0: 280, x1: 313, g: 86 },
    { id: 1, x0: 314, x1: 339, g: 64 },
  ];
  for (const s of surface) fill(s.x0, 0, s.x1, s.g - 1, '.');
  // Untergrund: Hallen unter Bahnhof und Stadt
  const under = [
    { id: 8, x0: 1, x1: 135, top: 160, bottom: 175 },
    { id: 9, x0: 1, x1: 135, top: 180, bottom: 195 },
    { id: 10, x0: 1, x1: 90, top: 200, bottom: 215 },
  ];
  for (const u of under) fill(u.x0, u.top, u.x1, u.bottom, 'b');

  // ---------- Felswand-Schächte zwischen den Terrassen ----------
  const cliffDoorNames = ['Bahnhofstor', 'Tunneltor', 'Serpentinen-Schranke', 'Werkstor', 'Forstweg-Tor', 'Gipfelpfad-Gatter'];
  const cliffPrices = [1500, 1750, 2000, 2500, 3000, 6000];
  // Untergrund-Luken zuerst (Ids 0–2), damit die Reihenfolge dem Aufstieg folgt
  // Labor → Kanal (Schacht bei x 84)
  fill(84, 196, 85, 199, 'b');
  ladder(84, 192, 215);
  ladder(85, 192, 215);
  const dLab = addDoor('Labor-Schleuse', 750, [[84, 198], [85, 198]], { unlocksZone: 9 });
  // Kanal → U-Bahn (Schacht bei x 6)
  fill(6, 176, 7, 179, 'b');
  ladder(6, 172, 195);
  ladder(7, 172, 195);
  const dKanal = addDoor('Kanaldeckel', 1000, [[6, 178], [7, 178]], { unlocksZone: 8 });
  // U-Bahn → Bahnhof (Schacht bei x 60)
  fill(60, 150, 61, 159, 'b');
  set(60, 150, '.');
  set(61, 150, '.');
  ladder(60, 149, 175);
  ladder(61, 149, 175);
  const dUbahn = addDoor('Rolltreppen-Gitter', 1250, [[60, 153], [61, 153]], { unlocksZone: 7 });
  void dLab; void dKanal; void dUbahn;

  for (let i = 1; i < surface.length; i++) {
    const lower = surface[i - 1];
    const upper = surface[i];
    const x0 = upper.x0;
    // Felsblock x0..x0+3 von upper.g bis lower.g-1 ist schon '#'; Schacht hineinschneiden
    fill(x0 + 1, upper.g, x0 + 2, lower.g - 1, 'b');
    ladder(x0 + 1, upper.g - 1, lower.g - 1);
    ladder(x0 + 2, upper.g - 1, lower.g - 1);
    set(x0 + 1, upper.g, '.');
    set(x0 + 2, upper.g, '.');
    addDoor(cliffDoorNames[i - 1], cliffPrices[i - 1], [[x0, lower.g - 3], [x0, lower.g - 2], [x0, lower.g - 1]], { unlocksZone: upper.id });
    // Tür liegt in der Felswand: davor Luft
    lamps.push({ tx: x0 - 2, ty: lower.g - 5, kind: 'street' });
  }

  // ---------- Zufluchten ----------
  const safeRoom = (name: string, zone: number, x0: number, x1: number, top: number, floor: number, door: number) => {
    const id = safeZones.length;
    fill(x0, top, x1, floor - 1, 'b');
    lamps.push({ tx: Math.floor((x0 + x1) / 2), ty: top + 1, kind: 'interior' });
    safeZones.push({ id, name, rect: { x: x0 * TILE, y: top * TILE, w: (x1 - x0 + 1) * TILE, h: (floor - top) * TILE }, spawn: { x: px(x0 + 3), y: foot(floor) }, door, zone });
    return id;
  };

  /** Zweistöckiges Haus: unten Durchgang (unsicher), oben Zuflucht, erreichbar über Außenleiter + Tür. */
  const safeHouse = (name: string, zone: number, x0: number, g: number, doorName: string, price: number, extra: Partial<Door> = {}) => {
    const x1 = x0 + 14;
    const roof = g - 13;
    const slab = g - 6;
    fill(x0, roof, x1, roof, '#'); // Dach
    fill(x0, slab, x1, slab, '#'); // Zwischendecke
    fill(x0, roof + 1, x0, slab - 1, '#'); // Außenwände oben
    fill(x1, roof + 1, x1, slab - 1, '#');
    fill(x0 + 1, slab + 1, x1 - 1, g - 1, 'b'); // Durchgang unten (Rückwand)
    // Außenleiter links neben dem Haus bis zur Tür
    ladder(x0 - 1, slab - 3, g - 1);
    const door = addDoor(doorName, price, [[x0, slab - 3], [x0, slab - 2], [x0, slab - 1]], extra);
    const sid = safeRoom(name, zone, x0 + 1, x1 - 1, roof + 1, slab, door);
    return { sid, x0, x1, slab };
  };

  // Labor-Sicherheitsraum (Start)
  fill(17, 206, 17, 212, '#'); // Wand mit Öffnung unten
  fill(1, 205, 17, 205, '#');
  const sLab = safeRoom('Labor-Sicherheitsraum', 10, 1, 16, 206, 216, -1);
  stations.push({ id: 0, kind: 'werkbank', x: px(5), y: foot(216), safe: sLab });
  stations.push({ id: 1, kind: 'training', x: px(9), y: foot(216), safe: sLab });
  stations.push({ id: 2, kind: 'schliessfach', x: px(12), y: foot(216), safe: sLab });
  stations.push({ id: 3, kind: 'funk', x: px(15), y: foot(216), safe: sLab });

  // U-Bahn-Leitstand (rechts in der U-Bahn)
  fill(118, 165, 135, 165, '#');
  fill(118, 166, 118, 175, '#');
  fill(135, 166, 135, 175, '#');
  const dLeit = addDoor('Leitstand (Notstrom)', 600, [[118, 173], [118, 174], [118, 175]]);
  const sLeit = safeRoom('U-Bahn-Leitstand', 8, 119, 134, 166, 176, dLeit);
  stations.push({ id: 4, kind: 'kueche', x: px(122), y: foot(176), safe: sLeit });
  stations.push({ id: 5, kind: 'schwarzmarkt', x: px(126), y: foot(176), safe: sLeit });
  stations.push({ id: 6, kind: 'schliessfach', x: px(129), y: foot(176), safe: sLeit });
  stations.push({ id: 7, kind: 'funk', x: px(132), y: foot(176), safe: sLeit });

  const police = safeHouse('Polizeistation', 6, 118, 140, 'Polizei-Hintertür', 1000);
  stations.push({ id: 8, kind: 'werkbank', x: px(police.x0 + 3), y: foot(police.slab), safe: police.sid });
  stations.push({ id: 9, kind: 'training', x: px(police.x0 + 6), y: foot(police.slab), safe: police.sid });
  stations.push({ id: 10, kind: 'schliessfach', x: px(police.x0 + 9), y: foot(police.slab), safe: police.sid });
  stations.push({ id: 11, kind: 'funk', x: px(police.x0 + 12), y: foot(police.slab), safe: police.sid });

  const hotel = safeHouse('Hotel Alpenrose', 4, 214, 116, 'Hotel-Lobby', 2000);
  stations.push({ id: 12, kind: 'haendler', x: px(hotel.x0 + 3), y: foot(hotel.slab), safe: hotel.sid });
  stations.push({ id: 13, kind: 'kueche', x: px(hotel.x0 + 6), y: foot(hotel.slab), safe: hotel.sid });
  stations.push({ id: 14, kind: 'schliessfach', x: px(hotel.x0 + 9), y: foot(hotel.slab), safe: hotel.sid });
  stations.push({ id: 15, kind: 'funk', x: px(hotel.x0 + 12), y: foot(hotel.slab), safe: hotel.sid });

  const control = safeHouse('Kontrollraum', 3, 258, 102, 'Kontrollraum (Strom)', 0, { needsPower: true });
  stations.push({ id: 16, kind: 'labor', x: px(control.x0 + 3), y: foot(control.slab), safe: control.sid });
  stations.push({ id: 17, kind: 'training', x: px(control.x0 + 6), y: foot(control.slab), safe: control.sid });
  stations.push({ id: 18, kind: 'schliessfach', x: px(control.x0 + 9), y: foot(control.slab), safe: control.sid });
  stations.push({ id: 19, kind: 'funk', x: px(control.x0 + 12), y: foot(control.slab), safe: control.sid });

  // ---------- Zonen-Ausgestaltung ----------
  const reserved: [number, number][] = [
    [82, 87], [4, 9], [58, 63], [116, 135], [212, 230], [256, 274], [1, 18],
    ...surface.slice(1).map((s) => [s.x0 - 3, s.x0 + 4] as [number, number]),
  ];
  const free = (a: number, b: number) => !reserved.some(([r0, r1]) => b >= r0 && a <= r1);

  // Untergrund: Stege mit Leitern, Säulen, Wasser im Kanal
  for (const u of under) {
    const r = rng(u.id * 977);
    const mid = u.top + 7;
    for (let x = u.x0 + 4; x < u.x1 - 6; ) {
      const len = 6 + Math.floor(r() * 8);
      if (free(x, x + len) && r() < 0.75) {
        fill(x, mid, x + len, mid, '=');
        ladder(x + 1, mid, u.bottom);
        if (r() < 0.5) lamps.push({ tx: x + Math.floor(len / 2), ty: u.top + 1, kind: u.id === 10 ? 'cold' : 'interior' });
      }
      x += len + 4 + Math.floor(r() * 6);
    }
    // Säulen
    for (let x = u.x0 + 10; x < u.x1 - 4; x += 22) if (free(x, x)) fill(x, u.top, x, u.top + 2, '#');
    if (u.id === 9) {
      for (let x = u.x0 + 2; x < u.x1; x++) if (free(x, x) && x % 30 < 18) set(x, u.bottom, 'w');
    }
    if (u.id === 10) {
      // Labortrennwände mit Durchgängen
      for (let x = 24; x < 80; x += 14) fill(x, u.top, x, u.bottom - 4, '#');
      lamps.push({ tx: 40, ty: u.top + 1, kind: 'alarm' });
      lamps.push({ tx: 70, ty: u.top + 1, kind: 'alarm' });
    }
    // Spawns
    for (let x = u.x0 + 12; x < u.x1 - 4; x += 16) if (free(x, x)) spawns.push({ x: px(x), y: foot(u.bottom + 1), zone: u.id });
  }

  // Oberfläche
  for (const s of surface) {
    const r = rng(s.id * 7919);
    for (let x = s.x0 + 6; x < s.x1 - 4; ) {
      const len = 3 + Math.floor(r() * 5);
      if (free(x, x + len)) {
        const roll = r();
        if (roll < 0.4) {
          const h = 3 + Math.floor(r() * 2);
          fill(x, s.g - h, x + len, s.g - h, '=');
        } else if (roll < 0.75) {
          fill(x, s.g - 1, x + 1, s.g - 1, 'c');
          if (r() < 0.5) set(x, s.g - 2, 'c');
        }
      }
      x += len + 3 + Math.floor(r() * 5);
    }
    for (let x = s.x0 + 8; x < s.x1 - 3; x += 13) if (free(x, x)) lamps.push({ tx: x, ty: s.g - 5, kind: 'street' });
    for (let x = s.x0 + 14; x < s.x1 - 3; x += 15) if (free(x - 1, x + 1)) spawns.push({ x: px(x), y: foot(s.g), zone: s.id });
  }
  lamps.push({ tx: 30, ty: 140, kind: 'neon' });
  lamps.push({ tx: 104, ty: 130, kind: 'neon' });

  // ---------- Wandkäufe, Truhe, Beute ----------
  const wb = (x: number, row: number, weapon: string) => wallBuys.push({ id: wallBuys.length, x: px(x), y: foot(row), weapon });
  wb(30, 216, 'hackebeil');
  wb(66, 216, 'wespe');
  wb(40, 196, 'donner');
  wb(100, 196, 'wespe');
  wb(30, 176, 'magnum');
  wb(90, 176, 'falke');
  wb(20, 150, 'falke');
  wb(75, 150, 'donner');
  wb(100, 140, 'kraehe');
  wb(160, 128, 'kreissaege');
  wb(200, 116, 'drachen');
  wb(250, 102, 'kraehe');
  wb(290, 86, 'falke');
  wb(325, 64, 'donner');

  const ts = (x: number, row: number) => truheSpots.push({ id: truheSpots.length, x: px(x), y: foot(row) });
  ts(50, 216); ts(110, 196); ts(70, 176); ts(45, 150); ts(108, 140); ts(205, 116); ts(298, 86);

  // Funkteile: Kanal, Leitstand, Kraftwerk
  radioParts.push({ id: 0, x: px(124), y: foot(196) });
  radioParts.push({ id: 1, x: px(134), y: foot(176) });
  radioParts.push({ id: 2, x: px(248), y: foot(102) });

  // Tagebuchseiten verteilt über alle Zonen
  const lorePos: [number, number][] = [
    [7, 216], [55, 216], [20, 196], [115, 196], [50, 176], [100, 176], [10, 150], [80, 150], [96, 140], [138, 140],
    [155, 128], [180, 128], [195, 116], [236, 116], [246, 102], [276, 102], [286, 86], [306, 86], [318, 64], [334, 64],
  ];
  lorePos.forEach(([x, row], i) => lore.push({ id: i, x: px(x), y: foot(row), title: LORE_TEXTS[i][0], text: LORE_TEXTS[i][1] }));

  // Generator im Kraftwerk, Funkstation + Landeplatz am Gipfel
  const generator = { id: 0, x: px(252), y: foot(102) };
  const radio = { id: 0, x: px(322), y: foot(64) };
  lamps.push({ tx: 329, ty: 59, kind: 'alarm' });
  lamps.push({ tx: 337, ty: 59, kind: 'alarm' });
  const helipad: Rect = { x: 328 * TILE, y: 58 * TILE, w: 10 * TILE, h: 5 * TILE };

  // Schnellwege
  teleports.push({ id: 0, name: 'Gondel', a: { x: px(238), y: foot(116) }, b: { x: px(300), y: foot(86) }, price: 3000, needsPower: true, openFromA: false });
  teleports.push({ id: 1, name: 'Seitengang Hotelkeller', a: { x: px(hotel.x0 + 7), y: foot(116) }, b: { x: px(126), y: foot(196) }, price: 1500, needsPower: false, openFromA: true });

  // Rand
  fill(0, 0, 0, H - 1, '#');
  fill(W - 1, 0, W - 1, H - 1, '#');

  const zones: ZoneDef[] = [
    { id: 10, name: 'Labor „Ursprung“', rect: { x: 0, y: 199, w: 120, h: 41 }, weather: 'under', danger: 4, kinds: [0, 0, 1], door: -1, ground: 216 },
    { id: 9, name: 'Kanalisation', rect: { x: 0, y: 177, w: 140, h: 22 }, weather: 'under', danger: 6, kinds: [0, 4, 4, 1], door: 0, ground: 196 },
    { id: 8, name: 'U-Bahn', rect: { x: 0, y: 151, w: 140, h: 26 }, weather: 'under', danger: 7, kinds: [0, 5, 5, 1, 2], door: 1, ground: 176 },
    { id: 7, name: 'Industrie & Bahnhof', rect: { x: 0, y: 0, w: 90, h: 151 }, weather: 'surface', danger: 8, kinds: [0, 1, 2, 2], door: 2, ground: 150 },
    { id: 6, name: 'Stadtplatz', rect: { x: 90, y: 0, w: 56, h: 151 }, weather: 'surface', danger: 9, kinds: [0, 1, 1, 6], door: 3, ground: 140 },
    { id: 5, name: 'Serpentinen', rect: { x: 146, y: 0, w: 44, h: 141 }, weather: 'surface', danger: 10, kinds: [1, 3, 3, 6], door: 4, ground: 128 },
    { id: 4, name: 'Bergdorf', rect: { x: 190, y: 0, w: 52, h: 129 }, weather: 'surface', danger: 11, kinds: [1, 7, 7, 2, 6], door: 5, ground: 116 },
    { id: 3, name: 'Staudamm & Kraftwerk', rect: { x: 242, y: 0, w: 38, h: 117 }, weather: 'surface', danger: 12, kinds: [8, 8, 2, 1], door: 6, ground: 102 },
    { id: 2, name: 'Bergwald', rect: { x: 280, y: 0, w: 34, h: 103 }, weather: 'alpine', danger: 13, kinds: [9, 9, 1, 6], door: 7, ground: 86 },
    { id: 1, name: 'Gipfel „Hohe Wacht“', rect: { x: 314, y: 0, w: 26, h: 87 }, weather: 'alpine', danger: 14, kinds: [10, 10, 2, 9], door: 8, ground: 64 },
  ];
  // Leitstand-Tür und Polizei/Hotel/Kontrollraum-Türen schalten keine Zone frei
  void get;

  const doorIndex = new Int16Array(W * H).fill(-1);
  for (const d of doors) for (const [x, y] of d.cells) doorIndex[y * W + x] = d.id;

  return {
    id: 'talkessel',
    name: 'Talkessel',
    width: W,
    height: H,
    rows,
    ladders,
    doorIndex,
    doors,
    lamps,
    safeZones,
    zones,
    zombieSpawns: spawns,
    wallBuys,
    truheSpots,
    stations,
    lore,
    radioParts,
    generator,
    radio,
    helipad,
    teleports,
    playerSpawn: safeZones[sLab].spawn,
  };
}

/** Kompatibilität für Tests: dieselbe Karte */
export const buildTestLevel = buildTalkessel;
