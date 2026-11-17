import { describe, expect, it } from 'vitest';
import {
  InputBits,
  TILE,
  World,
  buildTalkessel,
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  sampleDay,
  weaponByKey,
  zoneAt,
  type Input,
} from '../src';

const level = buildTalkessel();
let seq = 0;

function run(w: World, ticks: number, id = 0, input?: Omit<Input, 'seq'>) {
  for (let i = 0; i < ticks; i++) {
    if (input) w.queueInput(id, { ...input, seq: ++seq & 0xffff });
    w.step();
  }
}

const idle = { moveX: 0, aim: 0, bits: 0 };

describe('Karte', () => {
  it('Start im Labor-Sicherheitsraum, auf festem Boden', () => {
    const w = new World(level, 1);
    const p = w.addPlayer(0, 'Host');
    run(w, 120);
    expect(p.onGround).toBe(true);
    expect(zoneAt(level, p.x, p.y - 10).id).toBe(10);
    expect(p.inSafe).toBe(true);
    expect(w.allPlayersSafe()).toBe(true);
  });

  it('alle Türen sind in der Karte eingetragen', () => {
    for (const d of level.doors) for (const [x, y] of d.cells) expect(level.rows[y][x]).toBe('D');
    expect(level.doors.slice(0, 9).reduce((s, d) => s + d.price, 0)).toBe(19750);
  });

  it('Spieler läuft aus der Zuflucht', () => {
    const w = new World(level, 1);
    const p = w.addPlayer(0, 'Host');
    run(w, 30);
    run(w, 260, 0, { moveX: 1, aim: 0, bits: 0 });
    expect(p.inSafe).toBe(false);
    expect(p.x).toBeGreaterThan(18 * TILE);
  });

  // Jeder Abschnitt des Aufstiegs ist mit offener Tür kletterbar
  const zoneById = (id: number) => level.zones.find((z) => z.id === id)!;
  for (let i = 0; i < 9; i++) {
    const door = level.doors[i];
    it(`Aufstieg durch "${door.name}"`, () => {
      const w = new World(level, 1);
      w.doorsOpen = (1 << 9) - 1;
      const p = w.addPlayer(0, 'Host');
      const target = zoneById(level.zones.find((z) => z.door === i)!.id);
      if (i < 3) {
        // Luke über einem Leiterschacht
        const lx = door.cells[0][0];
        const below = zoneAt(level, lx * TILE, (door.cells[0][1] + 6) * TILE);
        p.x = lx * TILE + TILE / 2;
        p.y = below.ground * TILE;
        run(w, 20);
        run(w, 360, 0, { moveX: 0, aim: 0, bits: InputBits.Up });
        run(w, 60, 0, { moveX: 1, aim: 0, bits: InputBits.Up });
        run(w, 60, 0, { moveX: 1, aim: 0, bits: 0 });
      } else {
        const x0 = door.cells[0][0];
        p.x = (x0 - 1) * TILE + TILE / 2;
        p.y = (door.cells[2][1] + 1) * TILE;
        run(w, 20);
        run(w, 40, 0, { moveX: 1, aim: 0, bits: 0 });
        run(w, 420, 0, { moveX: 0, aim: 0, bits: InputBits.Up });
        run(w, 90, 0, { moveX: 1, aim: 0, bits: InputBits.Up });
        run(w, 60, 0, { moveX: 1, aim: 0, bits: 0 });
      }
      expect(zoneAt(level, p.x, p.y - 10).id).toBe(target.id);
      expect(p.onGround || p.climbing).toBe(true);
    });
  }

  it('geschlossene Luke blockiert den Schacht', () => {
    const w = new World(level, 1);
    const p = w.addPlayer(0, 'Host');
    const lx = level.doors[0].cells[0][0];
    p.x = lx * TILE + TILE / 2;
    p.y = 216 * TILE;
    run(w, 20);
    run(w, 400, 0, { moveX: 0, aim: 0, bits: InputBits.Up });
    expect(zoneAt(level, p.x, p.y - 10).id).toBe(10);
  });
});

describe('Zufluchten und Beitritt', () => {
  it('Beitritt nur, wenn alle in einer Zuflucht sind', () => {
    const w = new World(level, 1);
    const p = w.addPlayer(0, 'Host');
    run(w, 30);
    expect(w.allPlayersSafe()).toBe(true);
    p.x = 40 * TILE;
    run(w, 2);
    expect(w.allPlayersSafe()).toBe(false);
  });

  it('Zombies betreten keine Zuflucht und spawnen nicht neben Spielern in Zufluchten', () => {
    const w = new World(level, 1);
    const p = w.addPlayer(0, 'Host');
    run(w, 30);
    const z = w.spawnZombie(1, 22 * TILE, 216 * TILE, 10);
    run(w, 600);
    const rect = level.safeZones[0].rect;
    expect(z.x - z.w / 2).toBeGreaterThanOrEqual(rect.x + rect.w - 1);
    expect(p.hp).toBe(p.maxHp);
  });
});

describe('Kampf', () => {
  it('Kopfschuss tötet einen Schlurfer sofort und bringt XP', () => {
    const w = new World(level, 7);
    w.doorsOpen = (1 << level.doors.length) - 1;
    const p = w.addPlayer(0, 'Host');
    p.x = 30 * TILE;
    p.y = 216 * TILE;
    run(w, 30);
    const z = w.spawnZombie(0, 36 * TILE, 216 * TILE, 10);
    z.facing = 1;
    run(w, 1);
    const ox = p.x + 26;
    const oy = p.y - 38;
    for (let i = 0; i < 40 && w.zombies.has(z.id); i++) {
      const aim = Math.atan2(z.y - z.h + 8 - oy, z.x - ox);
      run(w, 1, 0, { moveX: 0, aim, bits: InputBits.Fire });
    }
    expect(w.zombies.has(z.id)).toBe(false);
    expect(p.kills).toBe(1);
    expect(p.xp).toBeGreaterThan(0);
  });

  it('Nachladen füllt das Magazin aus der Reserve', () => {
    const w = new World(level, 1);
    const p = w.addPlayer(0, 'Host');
    p.x = 40 * TILE;
    p.y = 216 * TILE;
    run(w, 10);
    const gun = p.weapons[0];
    gun.mag = 0;
    run(w, 2, 0, { moveX: 0, aim: 0, bits: InputBits.Reload });
    run(w, 120, 0, idle);
    expect(gun.mag).toBe(12);
    expect(gun.reserve).toBe(36);
  });

  it('Spieler geht zu Boden, Mitspieler belebt wieder', () => {
    const w = new World(level, 1);
    const a = w.addPlayer(0, 'A');
    const b = w.addPlayer(1, 'B');
    for (const p of [a, b]) {
      p.x = 40 * TILE;
      p.y = 216 * TILE;
    }
    run(w, 10);
    w.damagePlayer(a, 500);
    expect(a.downed).toBe(true);
    for (let i = 0; i < 240; i++) {
      w.queueInput(1, { seq: i + 1, moveX: 0, aim: 0, bits: InputBits.Interact });
      w.step();
    }
    expect(a.downed).toBe(false);
    expect(a.alive).toBe(true);
  });
});

describe('Wirtschaft, Fortschritt, Handel', () => {
  it('Tür öffnet nur mit genug Geld', () => {
    const w = new World(level, 1);
    const p = w.addPlayer(0, 'Host');
    const d = level.doors[0];
    p.x = d.cx;
    p.y = d.cy + 100;
    p.climbing = true;
    p.money = 100;
    run(w, 5);
    run(w, 2, 0, { moveX: 0, aim: 0, bits: InputBits.Interact });
    expect(w.doorsOpen & 1).toBe(0);
    p.money = 1000;
    run(w, 1, 0, idle);
    run(w, 2, 0, { moveX: 0, aim: 0, bits: InputBits.Interact });
    expect(w.doorsOpen & 1).toBe(1);
    expect(p.money).toBe(250);
  });

  it('Wandkauf gibt eine Waffe', () => {
    const w = new World(level, 1);
    const p = w.addPlayer(0, 'Host');
    const wb = level.wallBuys.find((x) => x.weapon === 'hackebeil')!;
    p.x = wb.x;
    p.y = wb.y;
    run(w, 5);
    run(w, 2, 0, { moveX: 0, aim: 0, bits: InputBits.Interact });
    expect(p.weapons.some((x) => x.def === weaponByKey('hackebeil').id)).toBe(true);
  });

  it('Herstellen an der Werkbank und Skill im Trainingsraum', () => {
    const w = new World(level, 1);
    const p = w.addPlayer(0, 'Host');
    run(w, 30);
    const bench = level.stations.find((s) => s.kind === 'werkbank' && s.safe === 0)!;
    p.x = bench.x;
    p.items.stoff = 4;
    run(w, 2);
    w.applyAction(0, { a: 'craft', recipe: 'verband' });
    expect(p.items.verband).toBe(4);
    p.skillPoints = 1;
    const tr = level.stations.find((s) => s.kind === 'training' && s.safe === 0)!;
    p.x = tr.x;
    run(w, 2);
    w.applyAction(0, { a: 'skill', key: 'leben' });
    expect(p.skills.leben).toBe(1);
    expect(p.maxHp).toBe(115);
  });

  it('Handel tauscht alles oder nichts', () => {
    const w = new World(level, 1);
    const a = w.addPlayer(0, 'A');
    const b = w.addPlayer(1, 'B');
    run(w, 30);
    a.items.schrott = 5;
    b.money = 900;
    w.applyAction(0, { a: 'tradeRequest', target: 1 });
    w.applyAction(1, { a: 'tradeRespond', from: 0, accept: true });
    w.applyAction(0, { a: 'tradeOffer', items: { schrott: 5 }, money: 0, uids: [] });
    w.applyAction(1, { a: 'tradeOffer', items: {}, money: 300, uids: [] });
    w.applyAction(0, { a: 'tradeReady', ready: true });
    w.applyAction(1, { a: 'tradeReady', ready: true });
    w.applyAction(0, { a: 'tradeConfirm' });
    w.applyAction(1, { a: 'tradeConfirm' });
    expect(a.items.schrott).toBe(0);
    expect(b.items.schrott).toBe(5);
    expect(a.money).toBe(800);
    expect(b.money).toBe(600);
  });
});

describe('Protokoll und Speichern', () => {
  it('Eingabe übersteht Kodieren/Dekodieren', () => {
    const i = decodeInput(encodeInput({ seq: 4711, moveX: -0.5, aim: 1.2, bits: 0b10101 }))!;
    expect(i.seq).toBe(4711);
    expect(i.moveX).toBeCloseTo(-0.5, 1);
    expect(i.aim).toBeCloseTo(1.2, 1);
    expect(i.bits).toBe(0b10101);
  });

  it('Snapshot enthält Spieler, Zombies und Weltzustand', () => {
    const w = new World(level, 1);
    w.addPlayer(0, 'Host');
    w.addPlayer(3, 'Lisa');
    w.spawnZombie(2, 40 * TILE, 216 * TILE, 10);
    w.doorsOpen = 0b101;
    run(w, 5);
    const s = decodeSnapshot(encodeSnapshot(w))!;
    expect(s.players.map((p) => p.id).sort()).toEqual([0, 3]);
    expect(s.zombies.length).toBe(w.zombies.size);
    expect(s.doorsOpen).toBe(0b101);
    expect(s.tick).toBe(5);
  });

  it('Spielstand lässt sich speichern und laden, mit Schutzzeit', () => {
    const w = new World(level, 1);
    const p = w.addPlayer(0, 'Host');
    p.money = 1234;
    p.items.schrott = 7;
    w.doorsOpen = 1;
    w.spawnZombie(0, 40 * TILE, 216 * TILE, 10);
    const data = JSON.parse(JSON.stringify(w.serialize()));
    const w2 = World.fromSave(level, data);
    const p2 = w2.restoreHost(0, 'Host');
    expect(p2.money).toBe(1234);
    expect(p2.items.schrott).toBe(7);
    expect(w2.doorsOpen).toBe(1);
    expect(w2.zombies.size).toBe(1);
    expect(w2.grace).toBeGreaterThan(0);
  });

  it('Tag-Nacht-Werte sind nachts dunkel', () => {
    expect(sampleDay(23).ambientI).toBeLessThan(0.3);
    expect(sampleDay(12).ambientI).toBeGreaterThan(0.9);
  });
});

describe('Finale', () => {
  it('Funkspruch → Verteidigung → Mutant → Landeplatz → Sieg', () => {
    const w = new World(level, 7);
    w.doorsOpen = (1 << level.doors.length) - 1;
    const p = w.addPlayer(0, 'Host');
    run(w, 30);
    w.radioParts = 7;
    const r = level.radio;
    Object.assign(p, { x: r.x, y: r.y, vx: 0, vy: 0, hp: 100000, maxHp: 100000 });
    run(w, 2, 0, { moveX: 0, aim: 0, bits: InputBits.Interact });
    run(w, 2, 0, idle);
    expect(w.radioPhase).toBe(1);
    // Verteidigung überstehen (Spieler unverwundbar gemacht)
    for (let i = 0; i < 125 * 60; i++) {
      p.hp = p.maxHp;
      p.downed = false;
      run(w, 1, 0, idle);
    }
    expect(w.radioPhase).toBe(2);
    const boss = [...w.zombies.values()].find((z) => z.kind === 11);
    expect(boss).toBeTruthy();
    w.damageZombie(boss!, 1e6, p, false, 0, boss!.x, boss!.y, false);
    expect(w.radioPhase).toBe(3);
    run(w, 31 * 60);
    expect(w.radioPhase).toBe(4);
    const pad = level.helipad;
    Object.assign(p, { alive: true, downed: false, x: pad.x + pad.w / 2, y: pad.y + pad.h - 2, vx: 0, vy: 0 });
    run(w, 3);
    expect(w.victory).toBe(true);
  });
});

describe('Spawns außer Sicht', () => {
  it('kein Zombie erscheint je im Bild eines Spielers', () => {
    const w = new World(level, 11);
    const a = w.addPlayer(0, 'A');
    const b = w.addPlayer(1, 'B');
    w.doorsOpen = (1 << level.doors.length) - 1;
    w.hour = 23; // Nacht: viele Spawns
    const spots = [[40, 149], [112, 139], [205, 115], [262, 101], [300, 85], [60, 194]];
    let spawned = 0;
    for (const [i, [tx, ty]] of spots.entries()) {
      Object.assign(a, { x: tx * 64, y: ty * 64, hp: 1e6, maxHp: 1e6 });
      Object.assign(b, { x: (spots[(i + 2) % spots.length][0]) * 64, y: spots[(i + 2) % spots.length][1] * 64, hp: 1e6, maxHp: 1e6 });
      w.zombies.clear();
      for (let t = 0; t < 60 * 20; t++) {
        const before = new Set(w.zombies.keys());
        run(w, 1);
        for (const z of w.zombies.values()) {
          if (before.has(z.id)) continue;
          spawned++;
          for (const p of [a, b]) {
            const visible = Math.abs(z.x - p.x) < 1100 && z.y - p.y > -560 && z.y - p.y < 470;
            expect(visible, `Zombie bei ${Math.round(z.x)},${Math.round(z.y)} sichtbar für ${p.name}`).toBe(false);
          }
        }
        a.hp = b.hp = 1e6;
      }
    }
    expect(spawned).toBeGreaterThan(20);
  });

  it('Finale-Zombies erscheinen außer Sicht', () => {
    const w = new World(level, 3);
    w.doorsOpen = (1 << level.doors.length) - 1;
    const p = w.addPlayer(0, 'A');
    run(w, 10);
    w.radioParts = 7;
    Object.assign(p, { x: level.radio.x, y: level.radio.y, hp: 1e6, maxHp: 1e6 });
    run(w, 2, 0, { moveX: 0, aim: 0, bits: InputBits.Interact });
    run(w, 2, 0, idle);
    expect(w.radioPhase).toBe(1);
    let spawned = 0;
    for (let t = 0; t < 60 * 30; t++) {
      const before = new Set(w.zombies.keys());
      p.hp = p.maxHp;
      p.downed = false;
      Object.assign(p, { x: level.radio.x, y: level.radio.y, vx: 0 });
      run(w, 1, 0, idle);
      for (const z of w.zombies.values()) {
        if (before.has(z.id)) continue;
        spawned++;
        expect(w.visibleToAnyone(z.x, z.y)).toBe(false);
      }
    }
    expect(spawned).toBeGreaterThan(5);
    // …und sie kommen tatsächlich auf den Gipfel herauf
    for (let t = 0; t < 60 * 20; t++) {
      p.hp = p.maxHp;
      p.downed = false;
      run(w, 1, 0, idle);
    }
    const onSummit = [...w.zombies.values()].filter((z) => z.y <= level.radio.y + 4 && Math.abs(z.x - level.radio.x) < 1200);
    expect(onSummit.length).toBeGreaterThan(0);
  });
});
