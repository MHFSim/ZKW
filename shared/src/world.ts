import { DAY_LENGTH_SECONDS, DT, LOAD_GRACE_SECONDS, MAX_ZOMBIES, PLAYER_MAX_HP, RESPAWN_SECONDS, TILE } from './constants';
import { isNight } from './day';
import {
  BUY_FACTOR, HAENDLER_STOCK, ITEMS, MATERIALS, MAX_LEVEL, RECIPES, SCHWARZMARKT_STOCK, SELL_FACTOR, SKILLS, TRUHE_PRICE, TRUHE_TABLE,
  UPGRADE_COST, WEAPONS, ZONE_LOOT, tierMagMul, tierMul, weaponByKey, xpForLevel,
  type Element, type ItemKey, type SkillKey, type StationKind, type WeaponDef, type WeaponInst,
} from './items';
import { rectContains, zoneAt, type Level, type Rect, type SafeZone } from './level';
import { ladderAt, raycastTiles, rayBox, stepBody, type CollisionWorld } from './physics';
import { applyMovement, createPlayer, muzzleOrigin } from './player';
import { InputBits, emptyInput, type GameEvent, type Input, type Pickup, type PlayerState, type Projectile, type ZombieState } from './types';
import { ZOMBIES } from './zombies';

export const SAVE_VERSION = 2;

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SaveData {
  version: number;
  levelId: string;
  savedAt: number;
  tick: number;
  hour: number;
  day: number;
  rain: number;
  rainTarget: number;
  weatherTimer: number;
  doorsOpen: number;
  power: boolean;
  teleportsOpen: number;
  radioParts: number;
  radioPhase: number;
  radioTimer: number;
  victory: boolean;
  truheSpot: number;
  seed: number;
  nextZombieId: number;
  nextPickupId: number;
  players: PlayerState[];
  absent: PlayerState[];
  zombies: ZombieState[];
  pickups: Pickup[];
  meta?: { zone: string };
}

/** Aktionen über den zuverlässigen Kanal (Client → Host). */
export type Action =
  | { a: 'craft'; recipe: string }
  | { a: 'upgrade'; uid: number }
  | { a: 'element'; uid: number; element: Element }
  | { a: 'skill'; key: SkillKey }
  | { a: 'buy'; item: ItemKey; qty: number }
  | { a: 'sell'; item: ItemKey; qty: number }
  | { a: 'travel'; safe: number }
  | { a: 'locker'; op: 'put' | 'take'; item?: ItemKey; qty?: number; uid?: number }
  | { a: 'drop'; uid: number }
  | { a: 'throw'; item: 'granate' | 'molotow'; aim: number }
  | { a: 'select'; slot: number }
  | { a: 'tradeRequest'; target: number }
  | { a: 'tradeRespond'; from: number; accept: boolean }
  | { a: 'tradeOffer'; items: Partial<Record<ItemKey, number>>; money: number; uids: number[] }
  | { a: 'tradeReady'; ready: boolean }
  | { a: 'tradeConfirm' }
  | { a: 'tradeCancel' };

export interface TradeSide {
  id: number;
  items: Partial<Record<ItemKey, number>>;
  money: number;
  uids: number[];
  ready: boolean;
  confirmed: boolean;
}

export interface Trade {
  a: TradeSide;
  b: TradeSide;
}

/** Nachricht nur an einen Spieler (Inventar, Station öffnen, Handel …) */
export interface PrivateMsg {
  id: number;
  msg: any;
}

const STATION_RANGE = 170;

/**
 * Die komplette Spielwelt. Läuft beim Host im Web Worker mit 60 Ticks/s.
 * Enthält keine Grafik – nur Regeln.
 */
export class World implements CollisionWorld {
  tick = 0;
  hour = 6.2;
  day = 1;
  rain = 0;
  rainTarget = 0;
  weatherTimer = 60;
  doorsOpen = 0;
  power = false;
  teleportsOpen = 0;
  radioParts = 0;
  radioPhase = 0;
  radioTimer = 0;
  victory = false;
  horde = false;
  grace = 0;
  truheSpot = 0;
  seed: number;
  random: () => number;
  players = new Map<number, PlayerState>();
  absent = new Map<string, PlayerState>();
  zombies = new Map<number, ZombieState>();
  projectiles = new Map<number, Projectile>();
  pickups = new Map<number, Pickup>();
  nextZombieId = 1;
  nextPickupId = 1;
  nextProjId = 1;
  events: GameEvent[] = [];
  privates: PrivateMsg[] = [];
  pickupsDirty = true;
  dirtyPlayers = new Set<number>();
  trades = new Map<number, Trade>();
  private inputs = new Map<number, Input[]>();
  private lastInput = new Map<number, Input>();
  private spawnTimer = 0;
  private lightningTimer = 20;
  readonly safeRects: Rect[];

  constructor(public level: Level, seed = Date.now() >>> 0) {
    this.seed = seed;
    this.random = rng(seed);
    this.safeRects = level.safeZones.map((z) => z.rect);
  }

  // =================== Spieler ===================

  addPlayer(id: number, name: string, at?: { x: number; y: number }): PlayerState {
    const known = this.absent.get(name);
    const sp = at ?? this.level.playerSpawn;
    const p = known ?? createPlayer(id, name, sp.x, sp.y);
    if (known) {
      this.absent.delete(name);
      p.id = id;
      p.x = sp.x;
      p.y = sp.y;
      p.vx = p.vy = 0;
      p.climbing = false;
    }
    p.maxHp = this.maxHpOf(p);
    this.players.set(id, p);
    this.inputs.set(id, []);
    this.lastInput.set(id, emptyInput());
    this.dirtyPlayers.add(id);
    this.pickupsDirty = true;
    return p;
  }

  removePlayer(id: number) {
    const p = this.players.get(id);
    this.cancelTradeOf(id);
    if (p) this.absent.set(p.name, p);
    this.players.delete(id);
    this.inputs.delete(id);
    this.lastInput.delete(id);
  }

  queueInput(id: number, input: Input) {
    const q = this.inputs.get(id);
    if (!q) return;
    q.push(input);
    if (q.length > 8) q.splice(0, q.length - 8);
  }

  safeAt(x: number, y: number): SafeZone | undefined {
    for (const s of this.level.safeZones) {
      if (s.door >= 0 && (this.doorsOpen & (1 << s.door)) === 0) continue;
      if (rectContains(s.rect, x, y)) return s;
    }
    return undefined;
  }

  inSafeZone(x: number, y: number) {
    return this.safeAt(x, y) !== undefined;
  }

  /** Beitrittsregel: nur wenn alle Spieler in einer Zuflucht sind. */
  allPlayersSafe(): boolean {
    for (const p of this.players.values()) if (!p.alive || !this.inSafeZone(p.x, p.y - 4)) return false;
    return true;
  }

  safeCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.alive && this.inSafeZone(p.x, p.y - 4)) n++;
    return n;
  }

  /** Zuflucht, in der die meisten Spieler stehen (für Beitritte). */
  mostPopulatedSafe(): SafeZone {
    const count = new Map<number, number>();
    for (const p of this.players.values()) {
      const s = this.safeAt(p.x, p.y - 4);
      if (s) count.set(s.id, (count.get(s.id) ?? 0) + (p.id === 0 ? 1.5 : 1));
    }
    let best = this.level.safeZones[0];
    let bestN = -1;
    for (const s of this.level.safeZones) if ((count.get(s.id) ?? 0) > bestN) [best, bestN] = [s, count.get(s.id) ?? 0];
    return best;
  }

  maxHpOf(p: PlayerState) {
    return PLAYER_MAX_HP + 15 * (p.skills.leben ?? 0);
  }

  private notify(id: number, text: string, tone: 'ok' | 'warn' | 'info' = 'info') {
    this.privates.push({ id, msg: { t: 'toast', text, tone } });
  }

  // =================== Simulation ===================

  step() {
    this.tick++;
    const prevHour = this.hour;
    this.hour = (this.hour + (24 / DAY_LENGTH_SECONDS) * DT) % 24;
    if (this.hour < prevHour) this.day++;
    this.updateWeather();
    this.updateHorde();
    if (this.grace > 0) this.grace = Math.max(0, this.grace - DT);

    for (const p of this.players.values()) this.updatePlayer(p);
    if (this.grace <= 0) {
      for (const z of this.zombies.values()) this.updateZombie(z);
      this.updateProjectiles();
      this.updateSpawns();
      this.updateRadio();
    }
  }

  private updateWeather() {
    this.weatherTimer -= DT;
    if (this.weatherTimer <= 0) {
      if (this.random() < 0.55) this.rainTarget = this.rainTarget > 0 ? 0 : 0.5 + this.random() * 0.5;
      this.weatherTimer = 60 + this.random() * 90;
    }
    const speed = 0.06 * DT;
    this.rain += Math.max(-speed, Math.min(speed, this.rainTarget - this.rain));
    if (this.rain > 0.75) {
      this.lightningTimer -= DT;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 8 + this.random() * 20;
        const anyPlayer = [...this.players.values()][0];
        this.events.push({ t: 'lightning', x: anyPlayer ? anyPlayer.x + (this.random() - 0.5) * 2000 : 0 });
      }
    }
  }

  private updateHorde() {
    const night = isNight(this.hour);
    const want = night && this.day % 3 === 0;
    if (want !== this.horde) {
      this.horde = want;
      this.events.push({ t: 'horde', on: want });
    }
  }

  private updatePlayer(p: PlayerState) {
    const q = this.inputs.get(p.id)!;
    const last = this.lastInput.get(p.id)!;
    const input = q.shift() ?? { ...last, bits: last.bits & ~(InputBits.Switch | InputBits.Heal) };
    const pressed = (bit: number) => (input.bits & bit) !== 0 && (last.bits & bit) === 0;
    this.lastInput.set(p.id, input);
    p.lastSeq = input.seq;

    if (!p.alive) {
      p.respawnIn -= DT;
      if (p.respawnIn <= 0) this.respawn(p);
      return;
    }
    if (p.downed) {
      applyMovement(this, p, input);
      const others = [...this.players.values()].filter((o) => o !== p && o.alive && !o.downed).length;
      p.bleedOut -= DT * (others === 0 ? 6 : 1);
      if (p.bleedOut <= 0) this.kill(p);
      return;
    }

    applyMovement(this, p, input);
    const safe = this.safeAt(p.x, p.y - 4);
    const wasSafe = p.inSafe;
    p.inSafe = !!safe;
    p.safeId = safe?.id ?? -1;
    if (safe) {
      if (!wasSafe) this.events.push({ t: 'enterSafe', id: p.id, safe: safe.id });
      p.lastSafe = safe.id;
      if (p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 4 * DT); // in Zufluchten langsam heilen
    }
    if (p.burning > 0) {
      p.burning -= DT;
      this.damagePlayer(p, 6 * DT);
    }

    // Wiederbeleben (gedrückt halten)
    let reviving = false;
    if (input.bits & InputBits.Interact) {
      for (const o of this.players.values()) {
        if (o === p || !o.downed) continue;
        if (Math.hypot(o.x - p.x, o.y - p.y) < 80) {
          reviving = true;
          o.reviveProgress += DT / (3 * (1 - 0.25 * (p.skills.retter ?? 0)));
          if (o.reviveProgress >= 1) {
            o.downed = false;
            o.hp = Math.round(o.maxHp * 0.4);
            o.reviveProgress = 0;
            this.events.push({ t: 'revived', id: o.id, by: p.id });
          }
        }
      }
    }
    if (!reviving && pressed(InputBits.Interact)) this.interact(p);

    // Waffe wechseln / heilen
    if (pressed(InputBits.Switch) && p.weapons.length > 1) {
      p.active = (p.active + 1) % p.weapons.length;
      p.reloading = 0;
      this.dirtyPlayers.add(p.id);
    }
    p.healCooldown = Math.max(0, p.healCooldown - DT);
    if (pressed(InputBits.Heal)) this.heal(p);

    // Nachladen
    const w = p.weapons[p.active];
    const def = w ? WEAPONS[w.def] : undefined;
    if (w && def && def.kind !== 'melee') {
      if (p.reloading > 0) {
        p.reloading -= DT;
        if (p.reloading <= 0) {
          const cap = Math.round(def.mag * tierMagMul(w.tier));
          const take = Math.min(cap - w.mag, w.reserve);
          w.mag += take;
          w.reserve -= take;
          p.reloading = 0;
          this.dirtyPlayers.add(p.id);
        }
      } else if ((pressed(InputBits.Reload) || (w.mag === 0 && input.bits & InputBits.Fire)) && w.reserve > 0 && w.mag < Math.round(def.mag * tierMagMul(w.tier))) {
        this.startReload(p, def);
      }
    }

    // Schießen
    p.fireCooldown = Math.max(0, p.fireCooldown - DT);
    const wantsFire = (input.bits & InputBits.Fire) !== 0 && !p.inSafe && !p.climbing;
    p.firing = false;
    if (wantsFire && w && def && p.fireCooldown <= 0 && p.reloading <= 0) {
      if (def.kind === 'melee') {
        p.fireCooldown = 1 / def.fireRate;
        p.firing = true;
        this.melee(p, w, def);
      } else if (w.mag > 0) {
        p.fireCooldown = 1 / def.fireRate;
        p.firing = true;
        w.mag--;
        this.fireWeapon(p, w, def);
        if (w.mag === 0 && w.reserve > 0) this.startReload(p, def);
        if (this.tick % 6 === 0) this.dirtyPlayers.add(p.id);
      }
    }

    // Aufsammeln
    this.collectPickups(p);
  }

  private startReload(p: PlayerState, def: WeaponDef) {
    let t = def.reload * (1 - 0.12 * (p.skills.nachladen ?? 0));
    for (const o of this.players.values()) if (o !== p && (o.skills.kameradschaft ?? 0) > 0 && Math.hypot(o.x - p.x, o.y - p.y) < 400) t *= 0.85;
    p.reloading = t;
    this.events.push({ t: 'reload', id: p.id });
  }

  private heal(p: PlayerState) {
    if (p.healCooldown > 0 || p.hp >= p.maxHp) return;
    const mul = 1 + 0.3 * (p.skills.heilung ?? 0);
    const use = (p.items.medkit ?? 0) > 0 && p.maxHp - p.hp > 30 ? 'medkit' : (p.items.verband ?? 0) > 0 ? 'verband' : (p.items.medkit ?? 0) > 0 ? 'medkit' : null;
    if (!use) return this.notify(p.id, 'Keine Verbände oder Medkits', 'warn');
    p.items[use] = (p.items[use] ?? 0) - 1;
    p.hp = Math.min(p.maxHp, p.hp + (use === 'medkit' ? 60 : 25) * mul);
    p.healCooldown = 1;
    this.dirtyPlayers.add(p.id);
  }

  private respawn(p: PlayerState) {
    const safe = this.level.safeZones[p.lastSafe] ?? this.level.safeZones[0];
    p.x = safe.spawn.x;
    p.y = safe.spawn.y;
    p.vx = p.vy = 0;
    p.hp = p.maxHp;
    p.alive = true;
    p.downed = false;
    p.climbing = false;
    p.burning = 0;
  }

  damagePlayer(p: PlayerState, dmg: number) {
    if (!p.alive || p.downed || p.inSafe) return;
    p.hp -= dmg;
    if (p.hp <= 0) {
      p.hp = 0;
      p.downed = true;
      p.bleedOut = 20;
      p.reviveProgress = 0;
      p.climbing = false;
      this.events.push({ t: 'playerDown', id: p.id });
    }
  }

  private kill(p: PlayerState) {
    p.downed = false;
    p.alive = false;
    p.respawnIn = RESPAWN_SECONDS;
    // Beutel am Todesort: 25 % Geld, die Hälfte der Materialien
    const items: Partial<Record<ItemKey, number>> = {};
    for (const k of MATERIALS) {
      const n = Math.floor((p.items[k] ?? 0) / 2);
      if (n > 0) {
        items[k] = n;
        p.items[k] = (p.items[k] ?? 0) - n;
      }
    }
    const money = Math.floor(p.money * 0.25);
    p.money -= money;
    if (money > 0 || Object.keys(items).length) this.addPickup({ kind: 'bag', x: p.x, y: p.y, items, money, owner: p.name });
    this.events.push({ t: 'playerDead', id: p.id });
    this.dirtyPlayers.add(p.id);
  }

  // =================== Interaktion ===================

  /** Was liegt in Reichweite? Gleiche Logik für Host und HUD-Anzeige. */
  interactionFor(p: PlayerState) {
    return computeInteraction(this, p);
  }

  private pay(p: PlayerState, price: number): boolean {
    if (p.money < price) {
      this.notify(p.id, `Zu wenig Geld (${price} benötigt)`, 'warn');
      return false;
    }
    p.money -= price;
    this.dirtyPlayers.add(p.id);
    return true;
  }

  private interact(p: PlayerState) {
    const it = this.interactionFor(p);
    if (!it) return;
    switch (it.kind) {
      case 'door': {
        const d = this.level.doors[it.ref];
        if (!this.pay(p, d.price)) return;
        this.doorsOpen |= 1 << d.id;
        this.events.push({ t: 'door', door: d.id, by: p.id });
        this.grantXp(p, 40);
        break;
      }
      case 'wallbuy': {
        const wb = this.level.wallBuys[it.ref];
        const def = weaponByKey(wb.weapon);
        if (!this.pay(p, def.price ?? 0)) return;
        this.giveWeapon(p, def);
        break;
      }
      case 'ammo': {
        const wb = this.level.wallBuys[it.ref];
        const def = weaponByKey(wb.weapon);
        const w = p.weapons.find((x) => x.def === def.id);
        if (!w || w.reserve >= def.reserveMax) return this.notify(p.id, 'Munition ist voll');
        if (!this.pay(p, it.price ?? 0)) return;
        w.reserve = def.reserveMax;
        break;
      }
      case 'truhe': {
        if (!this.pay(p, TRUHE_PRICE)) return;
        const owned = new Set(p.weapons.map((w) => w.def));
        const pool = TRUHE_TABLE.filter(([k]) => !owned.has(weaponByKey(k).id));
        const total = pool.reduce((s, [, w]) => s + w, 0);
        let roll = this.random() * total;
        let pick = pool[0]?.[0] ?? 'falke';
        for (const [k, wgt] of pool) if ((roll -= wgt) <= 0) {
          pick = k;
          break;
        }
        const def = weaponByKey(pick);
        this.giveWeapon(p, def);
        this.events.push({ t: 'truhe', id: p.id, weapon: def.id, spot: this.truheSpot });
        // Truhe wandert weiter
        let next = this.truheSpot;
        while (next === this.truheSpot && this.level.truheSpots.length > 1) next = Math.floor(this.random() * this.level.truheSpots.length);
        this.truheSpot = next;
        break;
      }
      case 'generator':
        if (!this.pay(p, 2500)) return;
        this.power = true;
        for (const d of this.level.doors) if (d.needsPower) this.doorsOpen |= 1 << d.id;
        this.events.push({ t: 'generator' });
        this.grantXp(p, 150);
        break;
      case 'teleport': {
        const tp = this.level.teleports[it.ref];
        const open = (this.teleportsOpen & (1 << tp.id)) !== 0;
        if (!open) {
          if (!this.pay(p, tp.price)) return;
          this.teleportsOpen |= 1 << tp.id;
          this.events.push({ t: 'notice', text: `${tp.name} freigeschaltet`, tone: 'ok' });
          return;
        }
        const atA = Math.abs(p.x - tp.a.x) < 120 && Math.abs(p.y - tp.a.y) < 120;
        const dest = atA ? tp.b : tp.a;
        p.x = dest.x;
        p.y = dest.y;
        p.vx = p.vy = 0;
        p.climbing = false;
        this.events.push({ t: 'teleport', id: p.id, tp: tp.id });
        break;
      }
      case 'radio':
        this.radioPhase = 1;
        this.radioTimer = 120;
        this.events.push({ t: 'radio', phase: 1 });
        this.events.push({ t: 'notice', text: 'Funkspruch gesendet! Haltet 2 Minuten durch, bis der Hubschrauber kommt.', tone: 'warn' });
        break;
      case 'station': {
        const st = this.level.stations[it.ref];
        this.privates.push({ id: p.id, msg: { t: 'station', kind: st.kind, station: st.id, safe: st.safe } });
        break;
      }
      case 'trade':
        this.applyAction(p.id, { a: 'tradeRequest', target: it.ref });
        break;
    }
    this.dirtyPlayers.add(p.id);
  }

  giveWeapon(p: PlayerState, def: WeaponDef) {
    const inst: WeaponInst = { uid: p.nextUid++, def: def.id, tier: 1, element: 0, mag: def.mag, reserve: def.kind === 'melee' ? 0 : Math.round(def.reserveMax / 2) };
    if (p.weapons.length >= 3) {
      // volle Hände: aktive Waffe wandert ins Schließfach
      const old = p.weapons[p.active];
      p.locker.weapons.push(old);
      p.weapons[p.active] = inst;
      this.notify(p.id, `${WEAPONS[old.def].name} liegt jetzt im Schließfach`);
    } else {
      p.weapons.push(inst);
      p.active = p.weapons.length - 1;
    }
    this.events.push({ t: 'pickup', id: p.id, kind: 'weapon', text: def.name });
    this.dirtyPlayers.add(p.id);
  }

  // =================== Kampf ===================

  private damageMul(p: PlayerState, w: WeaponInst) {
    return tierMul(w.tier) * (1 + 0.08 * (p.skills.schaden ?? 0));
  }

  private fireWeapon(p: PlayerState, w: WeaponInst, def: WeaponDef) {
    const o = muzzleOrigin(p);
    const shot = { t: 'shot' as const, id: p.id, weapon: def.id, x: Math.round(o.x), y: Math.round(o.y), a: [] as number[], d: [] as number[] };
    this.events.push(shot);
    if (def.kind === 'rocket') {
      this.spawnProjectile(2, o.x, o.y, Math.cos(p.aim) * 900, Math.sin(p.aim) * 900, p.id, def.damage * this.damageMul(p, w), 3);
      return;
    }
    const mul = this.damageMul(p, w);
    for (let i = 0; i < def.pellets; i++) {
      const ang = p.aim + (this.random() - 0.5) * 2 * def.spread;
      const dist = this.hitscan(p, o.x, o.y, ang, def, w, def.damage * mul);
      shot.a.push(Math.round(ang * 1000));
      shot.d.push(Math.round(dist));
    }
  }

  /** Liefert die Flugweite des Projektils (negativ, wenn es ohne Einschlag in der Luft endet). */
  private hitscan(p: PlayerState, ox: number, oy: number, ang: number, def: WeaponDef, w: WeaponInst, damage: number): number {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const wall = raycastTiles(this, ox, oy, dx, dy, def.range);
    const hits: { z: ZombieState; t: number; head: boolean }[] = [];
    for (const z of this.zombies.values()) {
      if (Math.abs(z.x - ox) > def.range + 80 || Math.abs(z.y - oy) > def.range + 80) continue;
      const left = z.x - z.w / 2;
      const right = z.x + z.w / 2;
      const top = z.y - z.h;
      const headH = Math.min(18, z.h * 0.25);
      const th = rayBox(ox, oy, dx, dy, left + 4, top, right - 4, top + headH);
      const tb = rayBox(ox, oy, dx, dy, left, top + headH, right, z.y);
      const t = th >= 0 && (tb < 0 || th <= tb) ? th : tb;
      if (t >= 0 && t < wall) hits.push({ z, t, head: t === th && th >= 0 });
    }
    hits.sort((a, b) => a.t - b.t);
    const pierce = def.pierce ?? 1;
    for (const h of hits.slice(0, pierce)) {
      this.damageZombie(h.z, damage, p, h.head, w.element, ox + dx * h.t, oy + dy * h.t, def.kind === 'flamer');
    }
    if (hits.length >= pierce) return hits[pierce - 1].t;
    return wall < def.range ? wall : -def.range;
  }

  private melee(p: PlayerState, w: WeaponInst, def: WeaponDef) {
    this.events.push({ t: 'melee', id: p.id });
    const dir = Math.cos(p.aim) >= 0 ? 1 : -1;
    const mul = this.damageMul(p, w);
    for (const z of this.zombies.values()) {
      const dx = (z.x - p.x) * dir;
      if (dx > -10 && dx < def.range + z.w / 2 && Math.abs(z.y - p.y) < 70) {
        this.damageZombie(z, def.damage * mul, p, false, w.element, z.x, z.y - z.h / 2, false);
        z.vx += dir * 160;
      }
    }
  }

  damageZombie(z: ZombieState, dmg: number, p: PlayerState | undefined, head: boolean, element: number, hx: number, hy: number, fire: boolean) {
    if (!this.zombies.has(z.id)) return;
    const def = ZOMBIES[z.kind];
    let d = dmg;
    if (head) d = def.headArmor ? dmg * 2 : Math.max(dmg * 3, z.hp);
    if (def.boss && head) d = dmg * 2.5;
    if ((fire || element === 1) && def.fireWeak) d *= 2.5;
    if (element === 3 && def.frostImmune) d *= 0.5;
    z.hp -= d;
    z.hitFlash = 0.08;
    if (fire || element === 1) z.burning = 3;
    if (element === 3 && !def.frostImmune) z.slowed = 2.5;
    if (element === 2) {
      // Kettenblitz auf bis zu 2 Nachbarn
      let n = 0;
      for (const o of this.zombies.values()) {
        if (o === z || n >= 2) continue;
        if (Math.hypot(o.x - z.x, o.y - z.y) < 160) {
          o.hp -= dmg * 0.5;
          o.stun = 0.4;
          o.hitFlash = 0.08;
          n++;
          if (o.hp <= 0) this.killZombie(o, p, false);
        }
      }
    }
    if (p) {
      p.money += Math.round(10 * (1 + 0.1 * (p.skills.geldsegen ?? 0)));
      this.dirtyPlayers.add(p.id);
    }
    if (z.hp <= 0) this.killZombie(z, p, head);
    else this.events.push({ t: 'hit', x: hx, y: hy, head, elem: element || (fire ? 1 : 0) });
  }

  private killZombie(z: ZombieState, p: PlayerState | undefined, head: boolean) {
    if (!this.zombies.has(z.id)) return;
    const def = ZOMBIES[z.kind];
    this.zombies.delete(z.id);
    this.events.push({ t: 'kill', x: z.x, y: z.y - z.h / 2, head, by: p?.id ?? -1, kind: z.kind });
    if (def.explode) this.explode(z.x, z.y - 30, def.explode, 40, undefined);
    if (p) {
      let money = def.money * (1 + 0.1 * (p.skills.geldsegen ?? 0));
      if (head) money *= 1.6 + 0.3 * (p.skills.kopfschuss ?? 0);
      p.money += Math.round(money);
      p.kills++;
      this.grantXp(p, Math.round(def.xp * (head ? 1.5 : 1) * (this.horde ? 2 : 1)));
    }
    // Beute
    const zone = this.level.zones.find((zz) => zz.id === z.zone);
    const lootTable = ZONE_LOOT[z.zone] ?? ZONE_LOOT[10];
    if (def.boss) {
      this.addPickup({ kind: 'loot', x: z.x, y: z.y, items: { proben: 5, elektronik: 6, pulver: 6 }, money: 1500 });
      if (this.radioPhase === 2) {
        this.radioPhase = 3;
        this.radioTimer = 30;
        this.events.push({ t: 'radio', phase: 3 });
        this.events.push({ t: 'notice', text: 'Der Mutant ist besiegt! Der Hubschrauber landet in 30 Sekunden – alle zum Landeplatz!', tone: 'ok' });
      }
    } else if (this.random() < (z.kind >= 2 ? 0.6 : 0.32)) {
      const items: Partial<Record<ItemKey, number>> = {};
      const entries = Object.entries(lootTable) as [ItemKey, number][];
      const total = entries.reduce((s, [, w]) => s + w, 0);
      const n = 1 + (this.random() < 0.3 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        let r = this.random() * total;
        for (const [k, wgt] of entries) if ((r -= wgt) <= 0) {
          items[k] = (items[k] ?? 0) + 1 + Math.floor(this.random() * 2);
          break;
        }
      }
      if (z.kind >= 2 && this.random() < 0.18) items.proben = 1;
      this.addPickup({ kind: 'loot', x: z.x, y: z.y, items });
    }
    void zone;
  }

  explode(x: number, y: number, r: number, dmg: number, by: PlayerState | undefined) {
    this.events.push({ t: 'explosion', x, y, r });
    const mul = by ? 1 + 0.25 * (by.skills.sprengmeister ?? 0) : 1;
    for (const z of [...this.zombies.values()]) {
      const d = Math.hypot(z.x - x, z.y - z.h / 2 - y);
      if (d < r) this.damageZombie(z, dmg * mul * (1 - (d / r) * 0.5), by, false, 0, z.x, z.y - z.h / 2, false);
    }
    for (const p of this.players.values()) {
      const d = Math.hypot(p.x - x, p.y - 30 - y);
      if (d < r) this.damagePlayer(p, (by ? 0.25 : 1) * dmg * 0.6 * (1 - d / r));
    }
  }

  private spawnProjectile(kind: number, x: number, y: number, vx: number, vy: number, owner: number, damage: number, life: number) {
    const id = this.nextProjId++ & 0xffff;
    this.projectiles.set(id, { id, kind, x, y, vx, vy, owner, life, damage });
  }

  private updateProjectiles() {
    for (const pr of [...this.projectiles.values()]) {
      pr.life -= DT;
      const gravity = pr.kind === 1 || pr.kind === 3 ? 1300 : pr.kind === 0 || pr.kind === 4 ? 700 : 0;
      pr.vy += gravity * DT;
      const nx = pr.x + pr.vx * DT;
      const ny = pr.y + pr.vy * DT;
      const hitWall = raycastTiles(this, pr.x, pr.y, nx - pr.x, ny - pr.y, 1) < 1;
      const owner = pr.owner >= 0 ? this.players.get(pr.owner) : undefined;
      let hit = hitWall || pr.life <= 0;
      if (!hit && pr.owner < 0) {
        for (const p of this.players.values()) {
          if (!p.alive || p.downed) continue;
          if (Math.abs(p.x - nx) < 20 && ny > p.y - p.h && ny < p.y) {
            this.damagePlayer(p, pr.damage);
            if (pr.kind === 4) p.vx *= 0.2;
            hit = true;
            break;
          }
        }
      } else if (!hit && pr.kind === 2) {
        for (const z of this.zombies.values()) if (Math.abs(z.x - nx) < z.w / 2 + 6 && ny > z.y - z.h && ny < z.y) hit = true;
      }
      if (hit) {
        this.projectiles.delete(pr.id);
        if (pr.kind === 1 || pr.kind === 2) this.explode(pr.x, pr.y, pr.kind === 2 ? 160 : 140, pr.damage, owner);
        if (pr.kind === 3) {
          this.events.push({ t: 'explosion', x: pr.x, y: pr.y, r: 120 });
          for (const z of this.zombies.values()) if (Math.hypot(z.x - pr.x, z.y - pr.y) < 150) {
            z.burning = 5;
            this.damageZombie(z, 30, owner, false, 1, z.x, z.y - 30, true);
          }
        }
        continue;
      }
      pr.x = nx;
      pr.y = ny;
    }
  }

  // =================== Zombies ===================

  private updateZombie(z: ZombieState) {
    const def = ZOMBIES[z.kind];
    z.hitFlash = Math.max(0, z.hitFlash - DT);
    z.attackCooldown = Math.max(0, z.attackCooldown - DT);
    z.slowed = Math.max(0, z.slowed - DT);
    if (z.burning > 0) {
      z.burning -= DT;
      z.hp -= 10 * DT * (def.fireWeak ? 2.5 : 1);
      if (z.hp <= 0) return this.killZombie(z, undefined, false);
    }
    if (z.stun > 0) {
      z.stun -= DT;
      z.vx *= 0.8;
      stepBody(this, z, DT, { blocked: this.safeRects });
      return;
    }
    z.retargetIn -= DT;
    if (z.retargetIn <= 0) {
      z.retargetIn = 0.5;
      z.targetId = -1;
      let bestD = def.boss ? 3000 : 1500;
      for (const p of this.players.values()) {
        if (!p.alive || p.inSafe) continue;
        const d = Math.hypot(p.x - z.x, (p.y - z.y) * 2);
        if (d < bestD) {
          bestD = d;
          z.targetId = p.id;
        }
      }
    }
    const target = this.players.get(z.targetId);
    let speed = def.speed * (isNight(this.hour) ? 1.15 : 1) * (z.slowed > 0 ? 0.5 : 1);
    if (target && target.alive && !target.inSafe) {
      const dx = target.x - z.x;
      const dy = target.y - z.y;
      z.facing = dx >= 0 ? 1 : -1;
      // Fernkämpfer halten Abstand und werfen
      if (def.ranged && Math.abs(dx) < def.ranged.range && Math.abs(dx) > 160 && Math.abs(dy) < 300) {
        speed *= 0.2;
        if (z.attackCooldown <= 0) {
          z.attackCooldown = def.ranged.cooldown;
          const t = Math.abs(dx) / 520;
          this.spawnProjectile(def.ranged.proj, z.x, z.y - z.h * 0.7, dx / t, (dy - 30) / t - 0.5 * 700 * t, -1, def.ranged.damage, 4);
          this.events.push({ t: 'zombieAttack', x: z.x, y: z.y });
        }
      }
      // Boss: Sturmangriff
      if (def.boss) {
        z.charge -= DT;
        if (z.charge <= 0 && Math.abs(dx) < 700) {
          z.charge = 6;
          z.vx = z.facing * 650;
          z.stun = 0;
        }
      }
      if (Math.abs(z.vx) < 400 || !def.boss) z.vx = Math.abs(dx) > 6 ? z.facing * speed : 0;
      if (Math.abs(dx) < z.w / 2 + 24 && Math.abs(dy) < 60 && z.attackCooldown <= 0) {
        if (def.explode) {
          return this.killZombie(z, undefined, false);
        }
        z.attackCooldown = def.boss ? 1.2 : 0.9;
        this.damagePlayer(target, def.damage);
        this.events.push({ t: 'zombieAttack', x: z.x, y: z.y });
      }
      if (def.aura) for (const p of this.players.values()) if (Math.hypot(p.x - z.x, p.y - z.y) < def.aura) this.damagePlayer(p, 8 * DT);
    } else {
      if (this.random() < 0.01) z.facing = (z.facing * -1) as 1 | -1;
      z.vx = z.facing * speed * 0.3;
    }
    if (def.boss && Math.abs(z.vx) > def.speed) z.vx *= 0.97;
    const { hitWall } = stepBody(this, z, DT, { blocked: this.safeRects });
    if (hitWall && z.onGround) z.vy = def.boss ? -700 : -620;
    // Aus der Welt gefallen?
    if (z.y > this.level.height * TILE) this.zombies.delete(z.id);
  }

  zoneUnlocked(zoneId: number) {
    const z = this.level.zones.find((x) => x.id === zoneId);
    return !!z && (z.door < 0 || (this.doorsOpen & (1 << z.door)) !== 0);
  }

  private spawnTarget(): number {
    const n = this.players.size;
    if (n === 0) return 0;
    let danger = 0;
    let outside = 0;
    for (const p of this.players.values()) {
      if (p.inSafe) continue;
      outside++;
      danger = Math.max(danger, zoneAt(this.level, p.x, p.y - 10).danger);
    }
    if (outside === 0) return 0;
    let target = 3 + danger * 0.6 + 2.5 * (n - 1);
    if (isNight(this.hour)) target *= 1.5;
    if (this.horde) target *= 1.8;
    target *= 1 + this.rain * 0.12;
    return Math.min(MAX_ZOMBIES, Math.round(target));
  }

  private updateSpawns() {
    this.spawnTimer -= DT;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = this.horde ? 0.35 : 0.7;
    // Zombies weit weg von allen Spielern verschwinden (Leistung)
    for (const z of [...this.zombies.values()]) {
      let near = false;
      for (const p of this.players.values()) if (Math.abs(p.x - z.x) < 2600 && Math.abs(p.y - z.y) < 1600) near = true;
      if (!near && !ZOMBIES[z.kind].boss) this.zombies.delete(z.id);
    }
    if (this.zombies.size >= this.spawnTarget()) return;
    const outside = [...this.players.values()].filter((p) => p.alive && !p.inSafe);
    if (!outside.length) return;
    const anchor = outside[Math.floor(this.random() * outside.length)];
    const options = this.level.zombieSpawns.filter((s) => {
      if (!this.zoneUnlocked(s.zone)) return false;
      if (Math.abs(s.x - anchor.x) > 1500 || Math.abs(s.y - anchor.y) > 700) return false;
      for (const p of this.players.values()) if (Math.abs(p.x - s.x) < 560 && Math.abs(p.y - s.y) < 400) return false;
      if (this.inSafeZone(s.x, s.y - 10)) return false;
      return true;
    });
    if (!options.length) return;
    const s = options[Math.floor(this.random() * options.length)];
    const zone = this.level.zones.find((z) => z.id === s.zone)!;
    const kind = zone.kinds[Math.floor(this.random() * zone.kinds.length)];
    const count = kind === 5 ? 3 : 1; // Schwärmer kommen in Gruppen
    for (let i = 0; i < count; i++) this.spawnZombie(kind, s.x + i * 30, s.y, s.zone);
  }

  spawnZombie(kind: number, x: number, y: number, zone = 10): ZombieState {
    const def = ZOMBIES[kind];
    const zd = this.level.zones.find((z) => z.id === zone);
    const hpMul = (isNight(this.hour) ? 1.2 : 1) * (1 + ((zd?.danger ?? 4) - 4) * 0.06) * (def.boss ? 1 + 0.3 * (this.players.size - 1) : 1);
    const z: ZombieState = {
      id: this.nextZombieId++ & 0xffff,
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      w: def.w,
      h: def.h,
      onGround: false,
      hp: Math.round(def.hp * hpMul),
      maxHp: Math.round(def.hp * hpMul),
      facing: this.random() < 0.5 ? 1 : -1,
      attackCooldown: 0.5,
      targetId: -1,
      retargetIn: 0,
      hitFlash: 0,
      zone,
      burning: 0,
      slowed: 0,
      stun: 0,
      charge: 3,
    };
    if (this.nextZombieId > 0xffff) this.nextZombieId = 1;
    this.zombies.set(z.id, z);
    return z;
  }

  // =================== Finale am Gipfel ===================

  private updateRadio() {
    if (this.radioPhase === 0 || this.radioPhase >= 5) return;
    this.radioTimer -= DT;
    const r = this.level.radio;
    if (this.radioPhase === 1) {
      // Verteidigung: zusätzliche Zombies am Gipfel
      if (this.tick % 90 === 0 && this.zombies.size < MAX_ZOMBIES) {
        const kinds = [10, 10, 1, 2, 9];
        this.spawnZombie(kinds[Math.floor(this.random() * kinds.length)], r.x - 700 - this.random() * 300, r.y, 1);
      }
      if (this.radioTimer <= 0) {
        this.radioPhase = 2;
        this.spawnZombie(11, r.x - 900, r.y, 1);
        this.events.push({ t: 'radio', phase: 2 });
        this.events.push({ t: 'notice', text: 'Etwas Großes kommt den Berg herauf …', tone: 'warn' });
      }
    } else if (this.radioPhase === 3 && this.radioTimer <= 0) {
      this.radioPhase = 4;
      this.radioTimer = 60;
      this.events.push({ t: 'radio', phase: 4 });
      this.events.push({ t: 'notice', text: 'Der Hubschrauber ist gelandet! Alle auf den Landeplatz!', tone: 'ok' });
    } else if (this.radioPhase === 4) {
      const pad = this.level.helipad;
      const alive = [...this.players.values()].filter((p) => p.alive);
      const onPad = alive.filter((p) => rectContains(pad, p.x, p.y - 10));
      if (this.radioTimer <= 0 && onPad.length === 0) {
        this.radioPhase = 3;
        this.radioTimer = 45;
        this.events.push({ t: 'notice', text: 'Der Hubschrauber musste abdrehen – er kommt in 45 Sekunden zurück!', tone: 'warn' });
      } else if ((alive.length && onPad.length === alive.length) || this.radioTimer <= 0) {
        this.radioPhase = 5;
        this.victory = true;
        for (const p of onPad) this.grantXp(p, 3000);
        this.events.push({ t: 'victory' });
      }
    }
  }

  // =================== Fortschritt ===================

  grantXp(p: PlayerState, xp: number) {
    if (p.level >= MAX_LEVEL) return;
    p.xp += xp;
    while (p.level < MAX_LEVEL && p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level);
      p.level++;
      p.skillPoints++;
      this.events.push({ t: 'levelUp', id: p.id, level: p.level });
    }
    this.dirtyPlayers.add(p.id);
  }

  // =================== Beute ===================

  addPickup(p: Omit<Pickup, 'id'>) {
    const id = this.nextPickupId++;
    this.pickups.set(id, { ...p, id });
    this.pickupsDirty = true;
    // Höchstens 120 Beutestücke gleichzeitig
    if (this.pickups.size > 120) {
      const oldest = [...this.pickups.values()].find((x) => x.kind === 'loot');
      if (oldest) this.pickups.delete(oldest.id);
    }
  }

  private collectPickups(p: PlayerState) {
    for (const pk of this.pickups.values()) {
      if (Math.abs(pk.x - p.x) > 44 || Math.abs(pk.y - p.y) > 60) continue;
      const parts: string[] = [];
      for (const [k, n] of Object.entries(pk.items ?? {}) as [ItemKey, number][]) {
        p.items[k] = (p.items[k] ?? 0) + n;
        parts.push(`${n}× ${ITEMS[k].name}`);
      }
      if (pk.money) {
        p.money += pk.money;
        parts.push(`${pk.money} ¢`);
      }
      this.pickups.delete(pk.id);
      this.pickupsDirty = true;
      this.dirtyPlayers.add(p.id);
      this.privates.push({ id: p.id, msg: { t: 'toast', text: `+ ${parts.join(', ')}`, tone: 'ok' } });
    }
    for (const l of this.level.lore) {
      if (p.lore.includes(l.id) || Math.abs(l.x - p.x) > 44 || Math.abs(l.y - p.y) > 60) continue;
      p.lore.push(l.id);
      this.grantXp(p, 25);
      this.privates.push({ id: p.id, msg: { t: 'lore', id: l.id } });
    }
    for (const r of this.level.radioParts) {
      if (this.radioParts & (1 << r.id)) continue;
      if (Math.abs(r.x - p.x) > 44 || Math.abs(r.y - p.y) > 60) continue;
      this.radioParts |= 1 << r.id;
      this.grantXp(p, 200);
      this.events.push({ t: 'notice', text: `${p.name} hat ein Funkteil gefunden (${popcount(this.radioParts)}/3)`, tone: 'ok' });
    }
  }

  // =================== Aktionen (Stationen, Handel) ===================

  private stationNear(p: PlayerState, kinds: StationKind[]) {
    if (!p.inSafe) return false;
    return this.level.stations.some((s) => kinds.includes(s.kind) && s.safe === p.safeId && Math.hypot(s.x - p.x, s.y - p.y) < STATION_RANGE);
  }

  private discount(p: PlayerState) {
    return 1 - 0.1 * (p.skills.feilschen ?? 0);
  }

  private hasItems(p: PlayerState, needs: Partial<Record<ItemKey, number>>) {
    return (Object.entries(needs) as [ItemKey, number][]).every(([k, n]) => (p.items[k] ?? 0) >= n);
  }

  private takeItems(p: PlayerState, needs: Partial<Record<ItemKey, number>>) {
    for (const [k, n] of Object.entries(needs) as [ItemKey, number][]) p.items[k] = (p.items[k] ?? 0) - n;
  }

  applyAction(id: number, act: Action) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    this.dirtyPlayers.add(id);
    switch (act.a) {
      case 'select':
        if (act.slot >= 0 && act.slot < p.weapons.length) {
          p.active = act.slot;
          p.reloading = 0;
        }
        return;
      case 'throw': {
        if (p.inSafe || (p.items[act.item] ?? 0) <= 0) return;
        p.items[act.item] = (p.items[act.item] ?? 0) - 1;
        const o = muzzleOrigin({ x: p.x, y: p.y, aim: act.aim });
        this.spawnProjectile(act.item === 'granate' ? 1 : 3, o.x, o.y, Math.cos(act.aim) * 620, Math.sin(act.aim) * 620 - 200, p.id, act.item === 'granate' ? 180 : 30, 2.2);
        return;
      }
      case 'craft': {
        const r = RECIPES.find((x) => x.key === act.recipe);
        if (!r || !this.stationNear(p, r.stations)) return this.notify(id, 'Dafür brauchst du die passende Station', 'warn');
        if ((p.skills.basteln ?? 0) < r.craftTier) return this.notify(id, 'Skill „Basteln“ zu niedrig', 'warn');
        if (!this.hasItems(p, r.needs)) return this.notify(id, 'Nicht genug Material', 'warn');
        this.takeItems(p, r.needs);
        p.items[r.out] = (p.items[r.out] ?? 0) + r.qty;
        this.grantXp(p, 15);
        this.notify(id, `${r.qty}× ${ITEMS[r.out].name} hergestellt`, 'ok');
        return;
      }
      case 'upgrade': {
        const w = p.weapons.find((x) => x.uid === act.uid) ?? p.locker.weapons.find((x) => x.uid === act.uid);
        if (!w || w.tier >= 5) return;
        const next = w.tier + 1;
        const station: StationKind[] = next >= 4 ? ['labor'] : ['werkbank', 'labor'];
        if (!this.stationNear(p, station)) return this.notify(id, next >= 4 ? 'Stufe 4–5 nur im Labor (Kontrollraum)' : 'Dafür brauchst du eine Werkbank', 'warn');
        const cost = UPGRADE_COST[next];
        const price = Math.round(cost.money * this.discount(p));
        if (!this.hasItems(p, cost.items)) return this.notify(id, 'Nicht genug Material', 'warn');
        if (!this.pay(p, price)) return;
        this.takeItems(p, cost.items);
        w.tier = next;
        this.grantXp(p, 30 * next);
        this.notify(id, `${WEAPONS[w.def].name} ist jetzt Stufe ${next}`, 'ok');
        return;
      }
      case 'element': {
        const w = p.weapons.find((x) => x.uid === act.uid);
        const core = (['', 'kern_feuer', 'kern_elektro', 'kern_frost'] as const)[act.element];
        if (!w || !core || !this.stationNear(p, ['labor'])) return this.notify(id, 'Elemente nur im Labor (Kontrollraum)', 'warn');
        if ((p.items[core] ?? 0) <= 0) return this.notify(id, `Dafür brauchst du einen ${ITEMS[core].name}`, 'warn');
        p.items[core] = (p.items[core] ?? 0) - 1;
        w.element = act.element;
        this.notify(id, 'Element eingebaut', 'ok');
        return;
      }
      case 'skill': {
        const def = SKILLS.find((s) => s.key === act.key);
        if (!def || p.skillPoints <= 0 || !this.stationNear(p, ['training'])) return this.notify(id, 'Skillpunkte verteilst du im Trainingsraum einer Zuflucht', 'warn');
        const cur = p.skills[act.key] ?? 0;
        if (cur >= def.max) return;
        p.skills[act.key] = cur + 1;
        p.skillPoints--;
        p.maxHp = this.maxHpOf(p);
        return;
      }
      case 'buy':
      case 'sell': {
        const market: StationKind = this.stationNear(p, ['schwarzmarkt']) && isNight(this.hour) ? 'schwarzmarkt' : 'haendler';
        if (!this.stationNear(p, [market])) return this.notify(id, 'Hier ist kein Händler', 'warn');
        const stock = market === 'schwarzmarkt' ? SCHWARZMARKT_STOCK : HAENDLER_STOCK;
        const qty = Math.max(1, Math.min(20, Math.floor(act.qty)));
        const val = ITEMS[act.item]?.value ?? 0;
        if (act.a === 'buy') {
          if (!stock.includes(act.item)) return;
          const price = Math.round(val * BUY_FACTOR * qty * this.discount(p) * (market === 'schwarzmarkt' ? 1.4 : 1));
          if (!this.pay(p, price)) return;
          p.items[act.item] = (p.items[act.item] ?? 0) + qty;
        } else {
          if ((p.items[act.item] ?? 0) < qty || ITEMS[act.item].kind === 'key') return;
          p.items[act.item] = (p.items[act.item] ?? 0) - qty;
          p.money += Math.round(val * SELL_FACTOR * qty);
        }
        return;
      }
      case 'travel': {
        const dest = this.level.safeZones[act.safe];
        if (!dest || !this.stationNear(p, ['funk'])) return;
        if (dest.door >= 0 && (this.doorsOpen & (1 << dest.door)) === 0) return this.notify(id, 'Diese Zuflucht ist noch verschlossen', 'warn');
        if (!this.pay(p, 100)) return;
        p.x = dest.spawn.x;
        p.y = dest.spawn.y;
        p.vx = p.vy = 0;
        this.events.push({ t: 'teleport', id, tp: -1 });
        return;
      }
      case 'locker': {
        if (!this.stationNear(p, ['schliessfach'])) return;
        if (act.uid !== undefined) {
          if (act.op === 'put') {
            const i = p.weapons.findIndex((w) => w.uid === act.uid);
            if (i < 0 || p.weapons.length <= 1) return;
            p.locker.weapons.push(...p.weapons.splice(i, 1));
            p.active = Math.min(p.active, p.weapons.length - 1);
          } else {
            const i = p.locker.weapons.findIndex((w) => w.uid === act.uid);
            if (i < 0 || p.weapons.length >= 3) return this.notify(id, 'Höchstens 3 Waffen tragen', 'warn');
            p.weapons.push(...p.locker.weapons.splice(i, 1));
          }
        } else if (act.item) {
          const qty = Math.max(1, Math.floor(act.qty ?? 1));
          const from = act.op === 'put' ? p.items : p.locker.items;
          const to = act.op === 'put' ? p.locker.items : p.items;
          const n = Math.min(qty, from[act.item] ?? 0);
          if (n <= 0) return;
          from[act.item] = (from[act.item] ?? 0) - n;
          to[act.item] = (to[act.item] ?? 0) + n;
        }
        return;
      }
      case 'drop': {
        const i = p.weapons.findIndex((w) => w.uid === act.uid);
        if (i < 0 || p.weapons.length <= 1) return;
        p.weapons.splice(i, 1);
        p.active = Math.min(p.active, p.weapons.length - 1);
        return;
      }
      default:
        this.tradeAction(p, act);
    }
  }

  // ---------- Handel zwischen Spielern ----------

  private tradeOf(id: number) {
    for (const t of this.trades.values()) if (t.a.id === id || t.b.id === id) return t;
    return undefined;
  }

  private sendTradeState(t: Trade) {
    for (const side of [t.a, t.b]) {
      const other = side === t.a ? t.b : t.a;
      const op = this.players.get(other.id);
      this.privates.push({ id: side.id, msg: { t: 'trade', me: side, other: { ...other, name: op?.name ?? '?', weapons: other.uids.map((u) => op?.weapons.find((w) => w.uid === u)).filter(Boolean) } } });
    }
  }

  cancelTradeOf(id: number) {
    const t = this.tradeOf(id);
    if (!t) return;
    this.trades.delete(t.a.id);
    for (const s of [t.a, t.b]) this.privates.push({ id: s.id, msg: { t: 'tradeClosed', done: false } });
  }

  private tradeAction(p: PlayerState, act: Action) {
    const side = (t: Trade) => (t.a.id === p.id ? t.a : t.b);
    switch (act.a) {
      case 'tradeRequest': {
        const o = this.players.get(act.target);
        if (!o || o === p || !p.inSafe || !o.inSafe) return this.notify(p.id, 'Handeln geht nur in Zufluchten', 'warn');
        if (this.tradeOf(p.id) || this.tradeOf(o.id)) return this.notify(p.id, 'Es läuft schon ein Handel', 'warn');
        this.privates.push({ id: o.id, msg: { t: 'tradeInvite', from: p.id, name: p.name } });
        this.notify(p.id, `Handelsanfrage an ${o.name} gesendet`);
        return;
      }
      case 'tradeRespond': {
        const o = this.players.get(act.from);
        if (!o) return;
        if (!act.accept) return this.notify(o.id, `${p.name} möchte gerade nicht handeln`, 'warn');
        if (this.tradeOf(p.id) || this.tradeOf(o.id) || !p.inSafe || !o.inSafe) return;
        const mk = (id: number): TradeSide => ({ id, items: {}, money: 0, uids: [], ready: false, confirmed: false });
        const t: Trade = { a: mk(o.id), b: mk(p.id) };
        this.trades.set(o.id, t);
        this.sendTradeState(t);
        return;
      }
      case 'tradeOffer': {
        const t = this.tradeOf(p.id);
        if (!t) return;
        const s = side(t);
        const items: Partial<Record<ItemKey, number>> = {};
        for (const [k, n] of Object.entries(act.items) as [ItemKey, number][]) {
          const q = Math.max(0, Math.min(Math.floor(n), p.items[k] ?? 0));
          if (q > 0 && ITEMS[k]) items[k] = q;
        }
        s.items = items;
        s.money = Math.max(0, Math.min(Math.floor(act.money), p.money));
        s.uids = act.uids.filter((u) => p.weapons.some((w) => w.uid === u) && p.weapons.length > 1).slice(0, 2);
        t.a.ready = t.b.ready = t.a.confirmed = t.b.confirmed = false; // jede Änderung setzt zurück
        this.sendTradeState(t);
        return;
      }
      case 'tradeReady': {
        const t = this.tradeOf(p.id);
        if (!t) return;
        side(t).ready = act.ready;
        if (!act.ready) t.a.confirmed = t.b.confirmed = false;
        this.sendTradeState(t);
        return;
      }
      case 'tradeConfirm': {
        const t = this.tradeOf(p.id);
        if (!t || !t.a.ready || !t.b.ready) return;
        side(t).confirmed = true;
        if (t.a.confirmed && t.b.confirmed) this.executeTrade(t);
        else this.sendTradeState(t);
        return;
      }
      case 'tradeCancel':
        this.cancelTradeOf(p.id);
        return;
    }
  }

  /** Tausch in einem Schritt: alles oder nichts, vom Host geprüft. */
  executeTrade(t: Trade): boolean {
    const a = this.players.get(t.a.id);
    const b = this.players.get(t.b.id);
    const ok = (p: PlayerState | undefined, s: TradeSide) =>
      !!p && p.inSafe && p.money >= s.money && this.hasItems(p, s.items) && s.uids.every((u) => p.weapons.some((w) => w.uid === u));
    if (!a || !b || !ok(a, t.a) || !ok(b, t.b)) {
      this.cancelTradeOf(t.a.id);
      return false;
    }
    const weaponsAfter = (p: PlayerState, give: TradeSide, get: TradeSide) => p.weapons.length - give.uids.length + get.uids.length;
    if (weaponsAfter(a, t.a, t.b) > 3 || weaponsAfter(b, t.b, t.a) > 3 || weaponsAfter(a, t.a, t.b) < 1 || weaponsAfter(b, t.b, t.a) < 1) {
      this.notify(a.id, 'Handel nicht möglich: höchstens 3 Waffen tragen', 'warn');
      this.notify(b.id, 'Handel nicht möglich: höchstens 3 Waffen tragen', 'warn');
      return false;
    }
    const move = (from: PlayerState, to: PlayerState, s: TradeSide) => {
      this.takeItems(from, s.items);
      for (const [k, n] of Object.entries(s.items) as [ItemKey, number][]) to.items[k] = (to.items[k] ?? 0) + n;
      from.money -= s.money;
      to.money += s.money;
      for (const u of s.uids) {
        const i = from.weapons.findIndex((w) => w.uid === u);
        const [w] = from.weapons.splice(i, 1);
        w.uid = to.nextUid++;
        to.weapons.push(w);
      }
      from.active = Math.min(from.active, from.weapons.length - 1);
    };
    move(a, b, t.a);
    move(b, a, t.b);
    this.trades.delete(t.a.id);
    for (const s of [t.a, t.b]) this.privates.push({ id: s.id, msg: { t: 'tradeClosed', done: true } });
    this.dirtyPlayers.add(a.id);
    this.dirtyPlayers.add(b.id);
    return true;
  }

  // =================== Ausgaben für den Host ===================

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  drainPrivates(): PrivateMsg[] {
    for (const id of this.dirtyPlayers) {
      const p = this.players.get(id);
      if (p) this.privates.push({ id, msg: { t: 'me', me: privateState(p), interaction: this.interactionFor(p) ?? null } });
    }
    this.dirtyPlayers.clear();
    const out = this.privates;
    this.privates = [];
    return out;
  }

  pickupList() {
    this.pickupsDirty = false;
    return [...this.pickups.values()].map(({ id, kind, x, y }) => ({ id, kind, x, y }));
  }

  // =================== Speichern ===================

  serialize(): SaveData {
    const host = this.players.get(0);
    return {
      version: SAVE_VERSION,
      levelId: this.level.id,
      savedAt: Date.now(),
      tick: this.tick,
      hour: this.hour,
      day: this.day,
      rain: this.rain,
      rainTarget: this.rainTarget,
      weatherTimer: this.weatherTimer,
      doorsOpen: this.doorsOpen,
      power: this.power,
      teleportsOpen: this.teleportsOpen,
      radioParts: this.radioParts,
      radioPhase: this.radioPhase >= 5 ? 5 : this.radioPhase > 0 ? 0 : 0,
      radioTimer: 0,
      victory: this.victory,
      truheSpot: this.truheSpot,
      seed: this.seed,
      nextZombieId: this.nextZombieId,
      nextPickupId: this.nextPickupId,
      players: [...this.players.values()].map((p) => structuredClone(p)),
      absent: [...this.absent.values()].map((p) => structuredClone(p)),
      zombies: [...this.zombies.values()].filter((z) => !ZOMBIES[z.kind].boss).map((z) => ({ ...z })),
      pickups: [...this.pickups.values()].map((p) => structuredClone(p)),
      meta: { zone: host ? zoneAt(this.level, host.x, host.y - 10).name : '' },
    };
  }

  static fromSave(level: Level, s: SaveData): World {
    if (s.version !== SAVE_VERSION) throw new Error(`Spielstand-Version ${s.version} wird nicht unterstützt`);
    const w = new World(level, (s.seed + s.tick) >>> 0);
    Object.assign(w, {
      tick: s.tick, hour: s.hour, day: s.day, rain: s.rain, rainTarget: s.rainTarget, weatherTimer: s.weatherTimer,
      doorsOpen: s.doorsOpen, power: s.power, teleportsOpen: s.teleportsOpen, radioParts: s.radioParts,
      radioPhase: s.radioPhase, victory: s.victory, truheSpot: s.truheSpot, nextZombieId: s.nextZombieId, nextPickupId: s.nextPickupId,
    });
    for (const z of s.zombies) w.zombies.set(z.id, { ...z });
    for (const p of s.pickups) w.pickups.set(p.id, { ...p });
    for (const p of [...s.players, ...s.absent]) w.absent.set(p.name, structuredClone(p));
    w.grace = LOAD_GRACE_SECONDS;
    return w;
  }

  /** Host-Charakter an seiner gespeicherten Position (der Host darf überall weiterspielen). */
  restoreHost(id: number, name: string): PlayerState {
    const saved = this.absent.get(name);
    const pos = saved ? { x: saved.x, y: saved.y } : undefined;
    return this.addPlayer(id, name, pos);
  }
}

/** Minimaler Weltzustand, den die Interaktions-Logik braucht (Host: World, Client: Snapshot). */
export interface InteractCtx {
  level: Level;
  doorsOpen: number;
  truheSpot: number;
  power: boolean;
  teleportsOpen: number;
  radioParts: number;
  radioPhase: number;
  hour: number;
  players: Map<number, { id: number; name: string; x: number; y: number; inSafe: boolean }>;
}

export interface InteractPlayer {
  id: number;
  x: number;
  y: number;
  inSafe: boolean;
  safeId: number;
  weapons: WeaponInst[];
}

export interface InteractionInfo {
  kind: string;
  label: string;
  price?: number;
  ref: number;
}

/** Was liegt in Reichweite? Gleiche Logik für Host (Ausführen) und Client (Anzeige). */
export function computeInteraction(w: InteractCtx, p: InteractPlayer): InteractionInfo | undefined {
  const near = (x: number, y: number, r: number) => Math.abs(p.x - x) < r && Math.abs(p.y - y) < r;
  for (const d of w.level.doors) {
    if (w.doorsOpen & (1 << d.id)) continue;
    if (near(d.cx, d.cy + 40, 150)) {
      if (d.needsPower) return { kind: 'info', label: `${d.name}: braucht Strom aus dem Generator`, ref: d.id };
      return { kind: 'door', label: `${d.name} öffnen`, price: d.price, ref: d.id };
    }
  }
  for (const wb of w.level.wallBuys) {
    if (!near(wb.x, wb.y - 30, 80)) continue;
    const def = weaponByKey(wb.weapon);
    const own = p.weapons.some((w) => w.def === def.id);
    if (own && def.kind === 'melee') return { kind: 'info', label: `${def.name} (schon im Besitz)`, ref: wb.id };
    return own ? { kind: 'ammo', label: `Munition ${def.name}`, price: Math.round((def.price ?? 0) / 2), ref: wb.id } : { kind: 'wallbuy', label: def.name, price: def.price ?? 0, ref: wb.id };
  }
  const ts = w.level.truheSpots[w.truheSpot];
  if (ts && near(ts.x, ts.y - 30, 90)) return { kind: 'truhe', label: 'Wundertruhe', price: TRUHE_PRICE, ref: ts.id };
  const g = w.level.generator;
  if (!w.power && near(g.x, g.y - 30, 100)) return { kind: 'generator', label: 'Generator starten', price: 2500, ref: 0 };
  for (const tp of w.level.teleports) {
    for (const side of ['a', 'b'] as const) {
      const pos = tp[side];
      if (!near(pos.x, pos.y - 30, 90)) continue;
      const open = (w.teleportsOpen & (1 << tp.id)) !== 0;
      if (open) return { kind: 'teleport', label: `${tp.name} benutzen`, ref: tp.id };
      if (tp.needsPower && !w.power) return { kind: 'info', label: `${tp.name}: braucht Strom`, ref: tp.id };
      if (tp.openFromA && side === 'b') return { kind: 'info', label: `${tp.name}: nur von der anderen Seite zu öffnen`, ref: tp.id };
      return { kind: 'teleport', label: `${tp.name} freischalten`, price: tp.price, ref: tp.id };
    }
  }
  const r = w.level.radio;
  if (near(r.x, r.y - 30, 110) && w.radioPhase === 0) {
    return w.radioParts === 7 ? { kind: 'radio', label: 'Funkspruch absetzen – Hubschrauber rufen', ref: 0 } : { kind: 'info', label: `Funkstation: ${popcount(w.radioParts)}/3 Funkteile`, ref: 0 };
  }
  if (p.inSafe) {
    for (const st of w.level.stations) {
      if (st.safe !== p.safeId || !near(st.x, st.y - 30, 70)) continue;
      if (st.kind === 'schwarzmarkt' && !isNight(w.hour)) return { kind: 'info', label: 'Schwarzmarkt – öffnet erst nachts', ref: st.id };
      return { kind: 'station', label: STATION_LABEL[st.kind], ref: st.id };
    }
    for (const o of w.players.values()) {
      if (o.id !== p.id && o.inSafe && near(o.x, o.y, 90)) return { kind: 'trade', label: `Mit ${o.name} handeln`, ref: o.id };
    }
  }
  return undefined;
}

export const STATION_LABEL: Record<StationKind, string> = {
  werkbank: 'Werkbank',
  labor: 'Waffenlabor',
  kueche: 'Küche',
  training: 'Trainingsraum',
  haendler: 'Händler',
  schwarzmarkt: 'Schwarzmarkt',
  funk: 'Funkgerät (Schnellreise)',
  schliessfach: 'Schließfach',
};

export function popcount(n: number) {
  let c = 0;
  while (n) {
    c += n & 1;
    n >>>= 1;
  }
  return c;
}

/** Was ein Spieler über sich selbst wissen muss (Inventar, Fortschritt). */
export function privateState(p: PlayerState) {
  return {
    level: p.level,
    xp: p.xp,
    xpNext: xpForLevel(p.level),
    skillPoints: p.skillPoints,
    skills: p.skills,
    weapons: p.weapons,
    active: p.active,
    items: p.items,
    locker: p.locker,
    lore: p.lore,
    maxHp: p.maxHp,
    money: p.money,
    lastSafe: p.lastSafe,
  };
}
export type PrivateState = ReturnType<typeof privateState>;

export const ladderNear = ladderAt;
