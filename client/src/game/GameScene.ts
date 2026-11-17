import Phaser from 'phaser';
import {
  DT,
  InputBits,
  TILE,
  WEAPONS,
  ZOMBIES,
  ZOMBIE_TEXTURES,
  applyMovement,
  buildTalkessel,
  computeInteraction,
  createPlayer,
  decodeSnapshot,
  encodeInput,
  formatClock,
  lerpColor,
  quantizeAngle,
  quantizeMove,
  rectContains,
  sampleDay,
  scaleColor,
  zoneAt,
  type CollisionWorld,
  type GameEvent,
  type Input,
  type InteractionInfo,
  type Level,
  type NetPlayer,
  type NetZombie,
  type PickupInfo,
  type PlayerState,
  type Snapshot,
} from '@zkw/shared';
import type { Session } from '../net/session';
import { sfx } from '../audio';
import { controls, settings } from '../ui/state';
import { store } from '../ui/store';
import { PLAYER_COLORS, createTextures } from './textures';
import { buildTileLayers } from './tiles';
import { BulletFx, type BulletRef } from './bullets';
import { pollPad } from './gamepad';

const INTERP_DELAY_MS = 70;

interface PlayerView {
  body: Phaser.GameObjects.Sprite;
  gun: Phaser.GameObjects.Image;
  gunKey: string;
  name: Phaser.GameObjects.Text;
  flashlight: Phaser.GameObjects.Light;
  muzzle: Phaser.GameObjects.Light;
  flash: Phaser.GameObjects.Image;
  lastFire: number;
  /** Rückstoß 0…1, klingt schnell ab */
  recoil: number;
  swing: number;
}

interface ZombieView {
  body: Phaser.GameObjects.Sprite;
  eyes: Phaser.GameObjects.Image;
  hp: Phaser.GameObjects.Graphics;
  kind: number;
  lastX: number;
}

interface LampView {
  light: Phaser.GameObjects.Light;
  glow: Phaser.GameObjects.Image;
  base: number;
  kind: string;
  seed: number;
  under: boolean;
}

/** Licht setzen – ausgeschaltete Lichter unsichtbar machen, damit der Shader sie gar nicht erst durchrechnet. */
function lit(l: Phaser.GameObjects.Light, intensity: number) {
  l.setIntensity(intensity);
  l.setVisible(intensity > 0.02);
  return l;
}

const EDGE_BITS = [InputBits.Jump, InputBits.Interact, InputBits.Reload, InputBits.Heal, InputBits.Switch];

export interface HudData {
  hp: number;
  maxHp: number;
  alive: boolean;
  downed: boolean;
  revive: number;
  money: number;
  kills: number;
  clock: string;
  day: number;
  rain: number;
  night: number;
  weather: string;
  zone: string;
  inSafe: boolean;
  interaction?: InteractionInfo;
  canAfford: boolean;
  grace: boolean;
  horde: boolean;
  ping: number;
  fps: number;
  weapon: string;
  mag: number;
  reserve: number;
  melee: boolean;
  reloading: boolean;
  tier: number;
  element: number;
  level: number;
  xp: number;
  xpNext: number;
  skillPoints: number;
  heals: number;
  grenades: number;
  molotovs: number;
  radioPhase: number;
  radioTimer: number;
  radioParts: number;
  players: { id: number; name: string; hp: number; maxHp: number; color: number; downed: boolean }[];
}

/**
 * Spielszene: zeigt die Welt an, sagt den eigenen Spieler voraus und interpoliert alle anderen.
 * Ohne Session läuft sie als lebendiger Menü-Hintergrund.
 */
export class GameScene extends Phaser.Scene {
  session?: Session;
  level!: Level;
  private cw!: CollisionWorld;
  private inbox: ArrayBuffer[] = [];
  private eventInbox: GameEvent[] = [];
  private buffer: { t: number; s: Snapshot }[] = [];
  latest?: Snapshot;
  private me?: PlayerState;
  private pending: Input[] = [];
  private seq = 0;
  private inputAcc = 0;
  private renderOffset = { x: 0, y: 0 };
  private players = new Map<number, PlayerView>();
  private zombies = new Map<number, ZombieView>();
  private lamps: LampView[] = [];
  private doorTiles = new Map<number, Phaser.GameObjects.Image[]>();
  private doorLabels = new Map<number, Phaser.GameObjects.Text>();
  private pickupViews = new Map<number, Phaser.GameObjects.Image>();
  private loreViews = new Map<number, Phaser.GameObjects.Image>();
  private partViews = new Map<number, Phaser.GameObjects.Image>();
  private projViews: Phaser.GameObjects.Image[] = [];
  private truhe!: Phaser.GameObjects.Image;
  private truheLight!: Phaser.GameObjects.Light;
  private hold = new Map<number, number>();
  private padAt = -1e9;
  private padAim = 0;
  private selfLight!: Phaser.GameObjects.Light;
  private heli!: Phaser.GameObjects.Image;
  private sky!: Phaser.GameObjects.Graphics;
  private stars!: Phaser.GameObjects.TileSprite;
  private vignette?: Phaser.GameObjects.Image;
  private skyGroup: Phaser.GameObjects.GameObject[] = [];
  private moon!: Phaser.GameObjects.Image;
  private farMtn!: Phaser.GameObjects.TileSprite;
  private farSnow!: Phaser.GameObjects.TileSprite;
  private nearMtn!: Phaser.GameObjects.TileSprite;
  private city!: Phaser.GameObjects.TileSprite;
  private cityWin!: Phaser.GameObjects.TileSprite;
  private fog!: Phaser.GameObjects.TileSprite;
  private rainFx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private snowFx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private bloodFx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparkFx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private fireFx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private smokeFx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private tracers!: Phaser.GameObjects.Graphics;
  private bullets!: BulletFx;
  private recentShots: { ref: BulletRef; at: number }[] = [];
  private beams: { x1: number; y1: number; x2: number; y2: number; until: number; color: number }[] = [];
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private attractHour = 21;
  private attractRain = 0.8;
  private hudTimer = 0;
  private lightning = 0;
  private unsub?: () => void;

  constructor() {
    super('game');
  }

  init(data: { session?: Session }) {
    this.session = data?.session;
    this.inbox = [];
    this.eventInbox = [];
    this.buffer = [];
    this.latest = undefined;
    this.me = undefined;
    this.pending = [];
    this.players.clear();
    this.zombies.clear();
    this.lamps = [];
    this.doorTiles.clear();
    this.doorLabels.clear();
    this.pickupViews.clear();
    this.loreViews.clear();
    this.partViews.clear();
    this.projViews = [];
    if (this.session) {
      this.session.cb.onSnapshot = (buf) => this.inbox.push(buf);
      this.session.cb.onEvents = (list) => this.eventInbox.push(...list);
    }
  }

  create() {
    createTextures(this);
    this.level = buildTalkessel();
    this.cw = { level: this.level, doorsOpen: 0 };
    const worldW = this.level.width * TILE;
    const worldH = this.level.height * TILE;

    this.lights.enable();
    this.lights.setAmbientColor(0x1a2238);

    this.buildBackground();
    this.buildTiles();
    this.buildObjects();
    this.buildLamps();
    this.buildEffects();

    const cam = this.cameras.main;
    cam.setBounds(0, 0, worldW, worldH);
    // Kamera-Filter erzwingen ein Offscreen-Rendern mit vielen Vollbild-Durchgängen – auf Handys teuer.
    // Bloom deshalb nur auf „Ultra“ (Lampen, Mündungsfeuer und Kugeln leuchten ohnehin über Glow-Sprites),
    // die Vignette ist ein einfaches Overlay-Bild.
    if (settings.bloom) Phaser.Actions.AddEffectBloom(cam, { threshold: 0.66, blurRadius: 3, blurSteps: 2, blendAmount: 0.5 });
    if (settings.vignette) this.vignette = this.add.image(0, 0, 'vignette').setOrigin(0, 0).setScrollFactor(0).setDepth(95);

    if (this.session) {
      this.setupKeyboard();
      if (!this.scene.isActive('hud')) this.scene.launch('hud');
      this.scene.bringToTop('hud');
      this.unsub = store.subscribe(() => this.syncPickups());
      this.syncPickups();
      this.events.once('shutdown', () => this.unsub?.());
    }
    this.scale.on('resize', () => this.layoutBackground());
    this.layoutBackground();
  }

  // =================== Aufbau ===================

  private buildBackground() {
    this.sky = this.add.graphics().setScrollFactor(0).setDepth(-100);
    // Sterne einmal in eine Textur zeichnen (statt jedes Bild neu zu tessellieren)
    this.stars = this.add.tileSprite(0, 0, 10, 800, 'stars').setOrigin(0, 0).setScrollFactor(0).setDepth(-99);
    this.moon = this.add.image(0, 0, 'glow').setScrollFactor(0).setDepth(-98).setBlendMode(Phaser.BlendModes.ADD);
    const ts = (key: string, depth: number, blend = false) => {
      const t = this.add.tileSprite(0, 0, 10, 512, key).setOrigin(0, 1).setScrollFactor(0).setDepth(depth);
      if (blend) t.setBlendMode(Phaser.BlendModes.ADD);
      return t;
    };
    this.farMtn = ts('mountains-far', -95);
    this.farSnow = ts('mountains-far-snow', -94);
    this.nearMtn = ts('mountains-near', -90);
    this.city = ts('skyline', -85);
    this.cityWin = ts('skyline-win', -84, true);
    this.fog = this.add.tileSprite(0, 0, 10, 256, 'fog').setOrigin(0, 1).setScrollFactor(0).setDepth(20).setBlendMode(Phaser.BlendModes.SCREEN);
  }

  private layoutBackground() {
    const w = this.scale.width;
    for (const t of [this.farMtn, this.farSnow, this.nearMtn, this.city, this.cityWin, this.fog, this.stars]) t.setSize(w, t.height);
    this.vignette?.setDisplaySize(w, this.scale.height);
    this.skyGroup = [this.sky, this.stars, this.moon, this.farMtn, this.farSnow, this.nearMtn, this.city, this.cityWin];
  }

  private buildTiles() {
    const { back, main, ladders } = buildTileLayers(this.level);
    const mk = (data: number[][], depth: number, tint?: number) => {
      const map = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
      const set = map.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0)!;
      const layer = map.createLayer(0, set, 0, 0) as Phaser.Tilemaps.TilemapLayer;
      layer.setDepth(depth).setLighting(true);
      if (tint !== undefined) layer.forEachTile((t) => (t.tint = tint));
      return layer;
    };
    mk(back, -20, 0xb0aaa4);
    mk(ladders, -6);
    mk(main, 0);

    for (const d of this.level.doors) {
      const imgs: Phaser.GameObjects.Image[] = [];
      const horizontal = d.cells.length > 1 && d.cells[0][1] === d.cells[1][1];
      for (const [x, y] of d.cells) imgs.push(this.add.image(x * TILE, y * TILE, horizontal ? 'door-h' : 'door-v').setOrigin(0).setLighting(true).setDepth(1));
      this.doorTiles.set(d.id, imgs);
      const label = d.price > 0 ? `${d.name} · ${d.price.toLocaleString('de-DE')} ¢` : d.name;
      const ly = horizontal ? d.cy + 70 : d.cells[0][1] * TILE - 12;
      this.doorLabels.set(
        d.id,
        this.add
          .text(d.cx, ly, label, { fontFamily: 'Inter, sans-serif', fontSize: '15px', fontStyle: '700', color: '#ffb547', backgroundColor: 'rgba(11,14,20,0.75)', padding: { x: 8, y: 4 } })
          .setOrigin(0.5, horizontal ? 0 : 1)
          .setDepth(6),
      );
    }
  }

  private label(x: number, y: number, text: string, color = '#f2f4f8', size = 14) {
    return this.add
      .text(x, y, text, { fontFamily: 'Inter, sans-serif', fontSize: `${size}px`, fontStyle: '600', color, backgroundColor: 'rgba(11,14,20,0.6)', padding: { x: 6, y: 3 } })
      .setOrigin(0.5, 1)
      .setDepth(6);
  }

  private buildObjects() {
    const L = this.level;
    for (const s of L.safeZones) {
      this.add
        .text(s.rect.x + s.rect.w / 2, s.rect.y + 8, s.name.toUpperCase(), { fontFamily: '"Chakra Petch", sans-serif', fontSize: '22px', fontStyle: '700', color: '#3ddc97' })
        .setOrigin(0.5, 0)
        .setDepth(5)
        .setBlendMode(Phaser.BlendModes.ADD);
    }
    for (const wb of L.wallBuys) {
      const def = WEAPONS.find((w) => w.key === wb.weapon)!;
      this.add.image(wb.x, wb.y - 70, 'wallbuy').setDepth(-4);
      this.label(wb.x, wb.y - 100, `${def.name} · ${def.price} ¢`, '#ffb547', 13);
    }
    const names: Record<string, string> = { werkbank: 'Werkbank', labor: 'Waffenlabor', kueche: 'Küche', training: 'Training', haendler: 'Händler', schwarzmarkt: 'Schwarzmarkt', funk: 'Funk', schliessfach: 'Schließfach' };
    for (const st of L.stations) {
      this.add.image(st.x, st.y, 'station').setOrigin(0.5, 1).setLighting(true).setDepth(-3);
      this.label(st.x, st.y - 70, names[st.kind], '#6ec8ff', 13);
    }
    const g = L.generator;
    this.add.image(g.x, g.y, 'generator').setOrigin(0.5, 1).setLighting(true).setDepth(-3);
    this.label(g.x, g.y - 80, 'Generator · 2.500 ¢', '#ffb547');
    const r = L.radio;
    this.add.image(r.x, r.y, 'radio').setOrigin(0.5, 1).setLighting(true).setDepth(-3);
    this.label(r.x, r.y - 104, 'Funkstation', '#6ec8ff');
    for (const tp of L.teleports) {
      for (const side of [tp.a, tp.b]) {
        if (tp.id === 0) this.add.image(side.x, side.y - 40, 'gondel').setOrigin(0.5, 1).setLighting(true).setDepth(-3);
        this.label(side.x, side.y - 120, tp.price ? `${tp.name} · ${tp.price.toLocaleString('de-DE')} ¢` : tp.name, '#ffb547', 13);
      }
    }
    const hp = L.helipad;
    this.label(hp.x + hp.w / 2, hp.y + hp.h - 4, 'H  LANDEPLATZ', '#ff4d5e', 16);
    this.heli = this.add.image(hp.x + hp.w / 2, hp.y - 600, 'heli').setOrigin(0.5, 1).setLighting(true).setDepth(8).setVisible(false);
    for (const l of L.lore) this.loreViews.set(l.id, this.add.image(l.x, l.y - 14, 'paper').setOrigin(0.5, 1).setDepth(4));
    for (const p of L.radioParts) this.partViews.set(p.id, this.add.image(p.x, p.y, 'funkteil').setOrigin(0.5, 1).setDepth(4));
    const t0 = L.truheSpots[0];
    this.truhe = this.add.image(t0.x, t0.y, 'truhe').setOrigin(0.5, 1).setLighting(true).setDepth(-2);
    this.truheLight = this.lights.addLight(t0.x, t0.y - 50, 220, 0xb26bff, 1.3, 60);
    this.selfLight = this.lights.addLight(0, 0, 300, 0xd8e0ff, 0, 80);
  }

  private buildLamps() {
    const g = this.add.graphics().setDepth(-5);
    g.setLighting(true);
    for (const [i, l] of this.level.lamps.entries()) {
      const x = l.tx * TILE + TILE / 2;
      const y = l.ty * TILE;
      const zone = zoneAt(this.level, x, y);
      const under = zone.weather === 'under' && l.ty > 150;
      let color = 0xffcf8a;
      let radius = 460;
      let base = 1.7;
      let lx = x;
      if (l.kind === 'street') {
        let ground = l.ty;
        while (ground < this.level.height - 1 && this.level.rows[ground][l.tx] !== '#') ground++;
        g.fillStyle(0x23262c, 1);
        g.fillRect(x - 4, y, 8, ground * TILE - y);
        g.fillRect(x - 4, y - 4, 34, 6);
        g.fillStyle(0xfff0c8, 1);
        g.fillRect(x + 18, y + 2, 14, 5);
        lx = x + 25;
      } else if (l.kind === 'interior' || l.kind === 'cold') {
        color = l.kind === 'cold' ? 0xbfe6ff : 0xffd9a0;
        radius = 900;
        base = 1.6;
        g.fillStyle(0x1a1c20, 1);
        g.fillRect(x - 1, y - 30, 2, 30);
        g.fillStyle(l.kind === 'cold' ? 0xe0f4ff : 0xffe6b0, 1);
        g.fillRect(x - 16, y, 32, 5);
      } else if (l.kind === 'alarm') {
        color = 0xff3b3b;
        radius = 380;
        base = 1.2;
        g.fillStyle(0x661010, 1);
        g.fillCircle(x, y, 7);
      } else {
        color = 0xff2bd6;
        radius = 340;
        base = 1.3;
        this.add.text(x, y, 'BAR', { fontFamily: '"Chakra Petch", sans-serif', fontSize: '42px', fontStyle: '700', color: '#ff5be0' }).setOrigin(0.5).setDepth(-4).setBlendMode(Phaser.BlendModes.ADD);
      }
      const light = this.lights.addLight(lx, y + (l.kind === 'interior' || l.kind === 'cold' ? 160 : 10), radius, color, base, l.kind === 'street' ? 90 : 120);
      const glow = this.add.image(lx, y + 8, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(color).setScale(l.kind === 'neon' ? 2.4 : 1.3).setAlpha(0.5).setDepth(25);
      this.lamps.push({ light, glow, base, kind: l.kind, seed: i * 13.7, under });
    }
  }

  private buildEffects() {
    this.tracers = this.add.graphics().setDepth(40).setBlendMode(Phaser.BlendModes.ADD);
    this.bullets = new BulletFx(this);
    this.recentShots = [];
    this.beams = [];
    this.bloodFx = this.add.particles(0, 0, 'blood', {
      speed: { min: 80, max: 380 }, angle: { min: 200, max: 340 }, gravityY: 1300, lifespan: { min: 500, max: 1100 },
      scale: { start: 1.1, end: 0.4 }, alpha: { start: 1, end: 0.6 }, emitting: false,
    }).setDepth(30);
    this.sparkFx = this.add.particles(0, 0, 'spark', {
      speed: { min: 60, max: 260 }, lifespan: 260, scale: { start: 1.4, end: 0 }, blendMode: Phaser.BlendModes.ADD, emitting: false,
    }).setDepth(31);
    this.fireFx = this.add.particles(0, 0, 'fire', {
      speed: { min: 40, max: 220 }, lifespan: { min: 250, max: 600 }, scale: { start: 1.6, end: 0.2 }, alpha: { start: 0.9, end: 0 },
      gravityY: -200, blendMode: Phaser.BlendModes.ADD, emitting: false,
    }).setDepth(32);
    this.smokeFx = this.add.particles(0, 0, 'smoke', {
      speed: { min: 20, max: 120 }, lifespan: { min: 800, max: 1600 }, scale: { start: 0.8, end: 3 }, alpha: { start: 0.6, end: 0 },
      gravityY: -60, emitting: false,
    }).setDepth(29);
    this.rainFx = this.add.particles(0, 0, 'rain', {
      x: { min: -400, max: 3200 }, y: -60, speedY: { min: 1300, max: 1650 }, speedX: { min: -260, max: -200 }, rotate: 9,
      lifespan: 900, quantity: 1, frequency: 16, alpha: { start: 0.55, end: 0.25 }, scaleY: { min: 0.7, max: 1.3 }, blendMode: Phaser.BlendModes.ADD,
    }).setScrollFactor(0).setDepth(60);
    this.rainFx.stop();
    this.snowFx = this.add.particles(0, 0, 'snow', {
      x: { min: -400, max: 3200 }, y: -30, speedY: { min: 80, max: 180 }, speedX: { min: -140, max: -40 }, lifespan: 9000,
      quantity: 1, frequency: 40, scale: { min: 0.4, max: 1.2 }, alpha: { start: 0.9, end: 0.4 },
    }).setScrollFactor(0).setDepth(60);
    this.snowFx.stop();
  }

  private setupKeyboard() {
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,LEFT,RIGHT,DOWN,SPACE,E,R,Q,H,G,F,F5,ONE,TWO,THREE') as Record<string, Phaser.Input.Keyboard.Key>;
    // Sehr kurze Tastendrücke (kürzer als ein Bild) trotzdem erfassen
    const pulseKeys: [string, number][] = [['E', InputBits.Interact], ['R', InputBits.Reload], ['H', InputBits.Heal], ['Q', InputBits.Switch], ['SPACE', InputBits.Jump], ['W', InputBits.Jump | InputBits.Up], ['UP', InputBits.Jump | InputBits.Up]];
    for (const [name, bit] of pulseKeys) this.keys[name].on('down', () => (controls.pulse |= bit));
    kb.addCapture('F5,SPACE,UP,DOWN,LEFT,RIGHT');
    this.keys.F5.on('down', () => this.session?.requestSave());
    this.keys.G.on('down', () => this.throwItem('granate'));
    // Rechte Maustaste: Granate (oder Molotow, wenn keine Granate da ist)
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!controls.touch && p.rightButtonDown() && !this.game.registry.get('uiOpen')) this.throwItem((store.me?.items.granate ?? 0) > 0 ? 'granate' : 'molotow');
    });
    this.keys.F.on('down', () => this.throwItem('molotow'));
    this.keys.ONE.on('down', () => this.session?.sendAction({ a: 'select', slot: 0 }));
    this.keys.TWO.on('down', () => this.session?.sendAction({ a: 'select', slot: 1 }));
    this.keys.THREE.on('down', () => this.session?.sendAction({ a: 'select', slot: 2 }));
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (Math.abs(dy) > 10) controls.switchPulse = true;
    });
    const onThrow = (item: 'granate' | 'molotow') => this.throwItem(item);
    this.game.events.on('throw', onThrow);
    this.events.once('shutdown', () => this.game.events.off('throw', onThrow));
  }

  throwItem(item: 'granate' | 'molotow') {
    if (!this.me || this.game.registry.get('uiOpen')) return;
    this.session?.sendAction({ a: 'throw', item, aim: this.aimAngle() });
  }

  // =================== Schleife ===================

  update(time: number, delta: number) {
    const dt = Math.min(delta, 100) / 1000;
    if (this.session) {
      this.processNetwork();
      this.sampleInput(dt);
      this.renderEntities();
      this.followCamera(dt);
    } else {
      this.attract();
    }
    this.renderEnvironment(time, dt);
    this.tracers.clear();
    this.bullets.update(this.game.loop.delta);
    this.renderBeams(time);
    this.hudTimer -= dt;
    if (this.session && this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.game.events.emit('hud', this.hudData());
    }
  }

  private processNetwork() {
    const now = performance.now();
    for (const buf of this.inbox.splice(0)) {
      const s = decodeSnapshot(buf);
      if (!s) continue;
      if (this.latest && s.tick <= this.latest.tick) continue;
      this.latest = s;
      this.buffer.push({ t: now, s });
      this.reconcile(s);
    }
    while (this.buffer.length > 40) this.buffer.shift();
    for (const e of this.eventInbox.splice(0)) this.onEvent(e);
  }

  private reconcile(s: Snapshot) {
    const id = this.session!.localId;
    const net = s.players.find((p) => p.id === id);
    this.cw.doorsOpen = s.doorsOpen;
    if (!net) return;
    if (!this.me) this.me = createPlayer(id, '', net.x, net.y);
    if (store.me) this.me.skills = store.me.skills;
    const before = { x: this.me.x, y: this.me.y };
    Object.assign(this.me, {
      x: net.x, y: net.y, vx: net.vx, vy: net.vy, onGround: net.onGround, alive: net.alive, hp: net.hp, maxHp: net.maxHp,
      money: net.money, inSafe: net.inSafe, kills: net.kills, downed: net.downed, climbing: net.climbing,
    });
    const newer = (a: number, b: number) => ((a - b) & 0xffff) > 0 && ((a - b) & 0xffff) < 0x8000;
    this.pending = this.pending.filter((i) => newer(i.seq, net.lastSeq));
    for (const i of this.pending) applyMovement(this.cw, this.me, i);
    const ex = before.x - this.me.x;
    const ey = before.y - this.me.y;
    if (Math.hypot(ex, ey) < 120) {
      this.renderOffset.x += ex;
      this.renderOffset.y += ey;
    } else this.renderOffset.x = this.renderOffset.y = 0;
  }

  aimAngle(): number {
    if (!this.me) return 0;
    const o = { x: this.me.x, y: this.me.y - 38 };
    if (performance.now() - this.padAt < 3000) return settings.aimAssist ? this.assist(o.x, o.y, this.padAim) : this.padAim;
    if (controls.touch) {
      let a = Math.atan2(controls.aimY, controls.aimX);
      if (settings.aimAssist && controls.aimActive) a = this.assist(o.x, o.y, a);
      return a;
    }
    const p = this.input.activePointer;
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    return Math.atan2(wp.y - o.y, wp.x - o.x);
  }

  /** Leichte Zielhilfe für Touch: zieht zum nächsten Kopf im 12°-Kegel. */
  private assist(ox: number, oy: number, a: number): number {
    let best = a;
    let bestD = 0.21;
    for (const v of this.zombies.values()) {
      const hx = v.body.x;
      const hy = v.body.y - v.body.displayHeight + 10;
      if (Math.hypot(hx - ox, hy - oy) > 800) continue;
      const ang = Math.atan2(hy - oy, hx - ox);
      const d = Math.abs(Phaser.Math.Angle.Wrap(ang - a));
      if (d < bestD) {
        bestD = d;
        best = ang;
      }
    }
    return best;
  }

  private sampleInput(dt: number) {
    if (!this.me || this.session!.status !== 'playing') return;
    const k = this.keys;
    const uiOpen = !!this.game.registry.get('uiOpen');
    let moveX = 0;
    let bits = 0;
    const pad = pollPad();
    if (pad) {
      this.padAt = performance.now();
      if (pad.pressed.has(9)) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      if (!uiOpen) {
        moveX = pad.moveX;
        bits |= pad.bits;
        if (pad.aim !== undefined) this.padAim = pad.aim;
        if (pad.pressed.has(5)) this.throwItem((store.me?.items.granate ?? 0) > 0 ? 'granate' : 'molotow');
      }
    }
    if (!uiOpen) {
      if (controls.touch && !pad) {
        moveX = controls.moveX;
        if (controls.up) bits |= InputBits.Up | InputBits.Jump;
        if (controls.down) bits |= InputBits.Down;
        if (controls.jump) bits |= InputBits.Jump;
        if (controls.interact) bits |= InputBits.Interact;
        if (controls.fire) bits |= InputBits.Fire;
        if (controls.reload) bits |= InputBits.Reload;
        if (controls.heal) bits |= InputBits.Heal;
      } else {
        if (k.A.isDown || k.LEFT.isDown) moveX = -1;
        if (k.D.isDown || k.RIGHT.isDown) moveX = moveX < 0 ? 0 : 1;
        if (k.W.isDown || k.UP.isDown) bits |= InputBits.Up | InputBits.Jump;
        if (k.S.isDown || k.DOWN.isDown) bits |= InputBits.Down;
        if (k.SPACE.isDown) bits |= InputBits.Jump;
        if (k.E.isDown) bits |= InputBits.Interact;
        if (k.R.isDown) bits |= InputBits.Reload;
        if (k.H.isDown) bits |= InputBits.Heal;
        if (k.Q.isDown) bits |= InputBits.Switch;
        if (this.input.activePointer.leftButtonDown()) bits |= InputBits.Fire;
      }
      if (controls.switchPulse) {
        bits |= InputBits.Switch;
        controls.switchPulse = false;
      }
    }
    // Tastendruck-Bits mindestens 4 Ticks halten: übersteht verlorene Pakete und Mini-Tipper
    if (!uiOpen) {
      for (const bit of EDGE_BITS) if ((bits | controls.pulse) & bit) this.hold.set(bit, Math.max(this.hold.get(bit) ?? 0, 4));
    }
    controls.pulse = 0;
    const aim = quantizeAngle(this.aimAngle());
    this.inputAcc += dt;
    let steps = 0;
    while (this.inputAcc >= DT && steps < 5) {
      this.inputAcc -= DT;
      steps++;
      let held = bits;
      for (const [bit, n] of this.hold) {
        if (n <= 0) continue;
        held |= bit;
        this.hold.set(bit, n - 1);
      }
      const input: Input = { seq: (this.seq = (this.seq + 1) & 0xffff), moveX: quantizeMove(moveX), aim, bits: held };
      applyMovement(this.cw, this.me, input);
      this.pending.push(input);
      if (this.pending.length > 120) this.pending.shift();
      this.session!.sendInput(encodeInput(input));
    }
    if (steps >= 5) this.inputAcc = 0;
  }

  // =================== Darstellung ===================

  private gunKeyFor(weapon: number) {
    const k = WEAPONS[weapon]?.kind;
    if (k === 'melee') return 'blade';
    if (k === 'pistol' || k === 'smg' || k === 'shotgun') return 'gun';
    return 'gun-big';
  }

  private playerView(id: number): PlayerView {
    let v = this.players.get(id);
    if (v) return v;
    const color = PLAYER_COLORS[id % PLAYER_COLORS.length];
    const body = this.add.sprite(0, 0, `player-${id % PLAYER_COLORS.length}`).setOrigin(0.5, 1).setLighting(true).setDepth(10);
    const gun = this.add.image(0, 0, 'gun').setOrigin(0.15, 0.5).setLighting(true).setDepth(11);
    const name = this.add
      .text(0, 0, '', { fontFamily: 'Inter, sans-serif', fontSize: '14px', fontStyle: '600', color: `#${color.toString(16).padStart(6, '0')}`, stroke: '#0b0e14', strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setDepth(50);
    const flashlight = this.lights.addConeLight(0, 0, 760, 0xfff1d6, 0, 0, 0.42, 0.8, 70);
    const muzzle = this.lights.addLight(0, 0, 300, 0xffc46b, 0, 60);
    const flash = this.add.image(0, 0, 'flash').setBlendMode(Phaser.BlendModes.ADD).setDepth(12).setVisible(false);
    v = { body, gun, gunKey: 'gun', name, flashlight, muzzle, flash, lastFire: 0, swing: 0, recoil: 0 };
    this.players.set(id, v);
    return v;
  }

  private zombieView(z: NetZombie): ZombieView {
    let v = this.zombies.get(z.id);
    if (v && v.kind === z.kind) return v;
    if (v) this.destroyZombie(z.id);
    const body = this.add.sprite(z.x, z.y, ZOMBIE_TEXTURES[z.kind] ?? 'z-shambler').setOrigin(0.5, 1).setLighting(true).setDepth(9);
    const eyes = this.add
      .image(z.x, z.y, 'glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(z.kind === 10 ? 0x8fe0ff : z.kind === 11 ? 0xff3b5b : 0xb8ff3d)
      .setScale(z.kind === 11 ? 0.3 : 0.12)
      .setDepth(9.5);
    const hp = this.add.graphics().setDepth(48);
    v = { body, eyes, hp, kind: z.kind, lastX: z.x };
    this.zombies.set(z.id, v);
    return v;
  }

  private destroyZombie(id: number) {
    const v = this.zombies.get(id);
    if (!v) return;
    v.body.destroy();
    v.eyes.destroy();
    v.hp.destroy();
    this.zombies.delete(id);
  }

  private interpolated(): { players: Map<number, NetPlayer>; zombies: Map<number, NetZombie> } {
    const out = { players: new Map<number, NetPlayer>(), zombies: new Map<number, NetZombie>() };
    if (!this.buffer.length) return out;
    const rt = performance.now() - INTERP_DELAY_MS;
    let a = this.buffer[0];
    let b = this.buffer[this.buffer.length - 1];
    for (let i = this.buffer.length - 1; i > 0; i--) {
      if (this.buffer[i - 1].t <= rt) {
        a = this.buffer[i - 1];
        b = this.buffer[i];
        break;
      }
    }
    const t = Phaser.Math.Clamp((rt - a.t) / Math.max(1, b.t - a.t), 0, 1);
    const pa = new Map(a.s.players.map((p) => [p.id, p]));
    for (const p of b.s.players) {
      const q = pa.get(p.id);
      const far = q && Math.hypot(p.x - q.x, p.y - q.y) > 300; // Teleport: nicht interpolieren
      out.players.set(p.id, q && !far ? { ...p, x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t } : p);
    }
    const za = new Map(a.s.zombies.map((z) => [z.id, z]));
    for (const z of b.s.zombies) {
      const q = za.get(z.id);
      out.zombies.set(z.id, q ? { ...z, x: q.x + (z.x - q.x) * t, y: q.y + (z.y - q.y) * t } : z);
    }
    return out;
  }

  private nightFor(y: number) {
    const d = sampleDay(this.latest?.hour ?? this.attractHour);
    return y > 151 * TILE ? 1 : d.night;
  }

  private renderEntities() {
    const { players, zombies } = this.interpolated();
    const localId = this.session!.localId;
    if (this.me && this.latest) {
      const net = this.latest.players.find((p) => p.id === localId);
      if (net) {
        this.renderOffset.x *= 0.85;
        this.renderOffset.y *= 0.85;
        players.set(localId, {
          ...net,
          x: this.me.x + this.renderOffset.x,
          y: this.me.y + this.renderOffset.y,
          vx: this.me.vx,
          onGround: this.me.onGround,
          climbing: this.me.climbing,
          aim: this.aimAngle(),
        });
      }
    }
    const t = this.time.now;
    for (const [id, p] of players) {
      const v = this.playerView(id);
      const left = Math.cos(p.aim) < 0;
      const moving = p.onGround && Math.abs(p.vx) > 30;
      const bob = moving ? -Math.abs(Math.sin(t * 0.018)) * 3 : 0;
      const down = !p.alive || p.downed;
      v.body.setPosition(p.x, p.y + bob).setFlipX(left).setAlpha(p.alive ? 1 : 0.35);
      v.body.setRotation(down ? (left ? -1.4 : 1.4) : p.climbing ? Math.sin(t * 0.02) * 0.05 : moving ? Math.sin(t * 0.018) * 0.04 : 0);
      const key = this.gunKeyFor(p.weapon);
      if (key !== v.gunKey) {
        v.gun.setTexture(key);
        v.gunKey = key;
      }
      const sx = p.x;
      const sy = p.y - 38 + bob;
      let gunRot = p.aim;
      if (key === 'blade' && p.firing) v.swing = 1;
      v.swing = Math.max(0, v.swing - 0.12);
      if (key === 'blade') gunRot += (left ? 1 : -1) * (v.swing * 2.2 - 0.6);
      v.gun.setPosition(sx, sy).setRotation(gunRot).setFlipY(left).setVisible(!down && !p.climbing);
      v.name.setPosition(p.x, p.y - 72).setText(id === localId ? '' : `${this.session?.roster.get(id) ?? ''}${p.downed ? ' – am Boden!' : ''}`);
      const lampOn = Phaser.Math.Clamp((this.nightFor(p.y) - 0.2) / 0.5, 0, 1);
      v.flashlight.setPosition(sx + Math.cos(p.aim) * 14, sy + Math.sin(p.aim) * 14);
      lit(v.flashlight.setConeRotation(p.aim), !down ? 2.6 * lampOn : 0);
      const def = WEAPONS[p.weapon];
      const ranged = !!def && def.kind !== 'melee';
      const firingNow = p.firing && !down && !p.inSafe && ranged;
      // Mündungsfeuer und Licht kommen vom echten Schuss-Ereignis (siehe onShot)
      const flashOn = t - v.lastFire < 55 && def?.kind !== 'flamer';
      const tip = { x: sx + Math.cos(p.aim) * 44, y: sy + Math.sin(p.aim) * 44 };
      lit(v.muzzle.setPosition(tip.x, tip.y), flashOn ? 2.4 * (1 - (t - v.lastFire) / 55) : firingNow && def.kind === 'flamer' ? 2 : 0);
      v.muzzle.setColor(def?.kind === 'laser' ? 0x6ec8ff : 0xffc46b);
      v.flash.setVisible(false);
      if (firingNow && def.kind === 'flamer') this.fireFx.emitParticleAt(tip.x + Math.cos(p.aim) * 30, tip.y + Math.sin(p.aim) * 30, 2);
      // Rückstoß: Waffe ruckt kurz nach hinten
      v.recoil = Math.max(0, v.recoil - (this.game.loop.delta / 1000) * 9);
      if (v.recoil > 0) v.gun.setPosition(sx - Math.cos(p.aim) * v.recoil * 9, sy - Math.sin(p.aim) * v.recoil * 9).setRotation(gunRot - (left ? -1 : 1) * v.recoil * 0.18);
    }
    for (const [id, v] of this.players)
      if (!players.has(id)) {
        v.body.destroy();
        v.gun.destroy();
        v.name.destroy();
        v.flash.destroy();
        this.lights.removeLight(v.flashlight);
        this.lights.removeLight(v.muzzle);
        this.players.delete(id);
      }

    for (const z of zombies.values()) {
      const v = this.zombieView(z);
      const moving = Math.abs(z.x - v.lastX) > 0.2;
      v.lastX = z.x;
      const sway = moving ? Math.sin(t * (z.kind === 1 || z.kind === 7 ? 0.03 : 0.012) + z.id) * 0.08 : 0;
      v.body.setPosition(z.x, z.y).setFlipX(z.facing < 0).setRotation(sway + z.facing * 0.06);
      if (z.hitFlash) v.body.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      else if (z.burning) v.body.setTint(0xff9a5a).setTintMode(Phaser.TintModes.MULTIPLY);
      else if (z.slowed) v.body.setTint(0x9fd8ff).setTintMode(Phaser.TintModes.MULTIPLY);
      else v.body.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
      if (z.burning && Math.random() < 0.3) this.fireFx.emitParticleAt(z.x + (Math.random() - 0.5) * 20, z.y - v.body.displayHeight * 0.6, 1);
      const headY = z.y - v.body.displayHeight + 10;
      v.eyes.setPosition(z.x + z.facing * 6, headY).setAlpha(0.35 + this.nightFor(z.y) * 0.65);
      v.hp.clear();
      if (z.hpPct < 0.999) {
        const w = Math.max(30, v.body.displayWidth);
        v.hp.fillStyle(0x0b0e14, 0.7).fillRect(z.x - w / 2, z.y - v.body.displayHeight - 12, w, 4);
        v.hp.fillStyle(ZOMBIES[z.kind]?.boss ? 0xff3b5b : 0xff4d5e, 1).fillRect(z.x - w / 2, z.y - v.body.displayHeight - 12, w * z.hpPct, 4);
      }
    }
    for (const id of [...this.zombies.keys()]) if (!zombies.has(id)) this.destroyZombie(id);

    // Projektile
    const projs = this.latest?.projectiles ?? [];
    const tex = ['acid', 'loot', 'flash', 'fire', 'spark'];
    for (let i = 0; i < projs.length; i++) {
      const pr = projs[i];
      let img = this.projViews[i];
      if (!img) img = this.projViews[i] = this.add.image(0, 0, 'acid').setDepth(33).setBlendMode(Phaser.BlendModes.ADD);
      img.setTexture(tex[pr.kind] ?? 'spark').setPosition(pr.x, pr.y).setVisible(true).setScale(pr.kind === 1 ? 0.5 : pr.kind === 2 ? 0.7 : 1);
      if (pr.kind === 2 && Math.random() < 0.5) this.smokeFx.emitParticleAt(pr.x, pr.y, 1);
    }
    for (let i = projs.length; i < this.projViews.length; i++) this.projViews[i].setVisible(false);

    // Türen
    for (const [id, imgs] of this.doorTiles) {
      const open = (this.cw.doorsOpen & (1 << id)) !== 0;
      if (!open) continue;
      for (const img of imgs) if (img.visible && img.alpha === 1) this.tweens.add({ targets: img, alpha: 0, duration: 500, onComplete: () => img.setVisible(false) });
      this.doorLabels.get(id)?.setVisible(false);
    }
    // Wundertruhe, Funkteile, Tagebuchseiten, Hubschrauber
    if (this.latest) {
      const ts = this.level.truheSpots[this.latest.truheSpot];
      if (ts && (this.truhe.x !== ts.x || this.truhe.y !== ts.y)) {
        this.truhe.setPosition(ts.x, ts.y);
        this.truheLight.setPosition(ts.x, ts.y - 50);
      }
      this.truheLight.setIntensity(1.1 + Math.sin(t * 0.004) * 0.3);
      for (const [id, img] of this.partViews) img.setVisible((this.latest.radioParts & (1 << id)) === 0);
      const phase = this.latest.radioPhase;
      const pad = this.level.helipad;
      this.heli.setVisible(phase >= 3);
      if (phase === 3) this.heli.y = pad.y + pad.h - (this.latest.radioTimer / 30) * 900;
      else if (phase >= 4) this.heli.y = pad.y + pad.h;
    }
    const lore = new Set(store.me?.lore ?? []);
    for (const [id, img] of this.loreViews) img.setVisible(!lore.has(id)).setAlpha(0.75 + Math.sin(t * 0.005 + id) * 0.25);
  }

  private syncPickups() {
    const want = new Map<number, PickupInfo>(store.pickups.map((p) => [p.id, p]));
    for (const [id, img] of this.pickupViews)
      if (!want.has(id)) {
        img.destroy();
        this.pickupViews.delete(id);
      }
    for (const p of want.values()) {
      if (this.pickupViews.has(p.id)) continue;
      const img = this.add.image(p.x, p.y, p.kind === 'bag' ? 'bag' : 'loot').setOrigin(0.5, 1).setDepth(4).setLighting(true);
      this.tweens.add({ targets: img, y: p.y - 6, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut' });
      this.pickupViews.set(p.id, img);
    }
  }

  /** Laserstrahlen (Lichtbogen) – kurz aufleuchtend vom Schuss-Ereignis. */
  private renderBeams(time: number) {
    this.beams = this.beams.filter((b) => b.until > time);
    for (const b of this.beams) {
      const a = (b.until - time) / 110;
      this.tracers.lineStyle(9, b.color, 0.35 * a).lineBetween(b.x1, b.y1, b.x2, b.y2);
      this.tracers.lineStyle(3, 0xffffff, 0.9 * a).lineBetween(b.x1, b.y1, b.x2, b.y2);
    }
  }

  /** Ein echter Schuss vom Host: Kugeln mit der tatsächlichen Flugbahn, Mündungsfeuer, Hülsen, Rückstoß. */
  private onShot(e: Extract<GameEvent, { t: 'shot' }>) {
    const def = WEAPONS[e.weapon];
    if (!def) return;
    const now = this.time.now;
    const v = this.players.get(e.id);
    const local = e.id === this.session?.localId;
    // Für den eigenen Spieler die vorhergesagte Position nehmen – sonst hinkt das Mündungsfeuer hinterher
    let ox = e.x;
    let oy = e.y;
    if (v && v.gun.visible) {
      const a0 = e.a.length ? e.a[0] / 1000 : v.gun.rotation;
      ox = v.gun.x + Math.cos(a0) * 44;
      oy = v.gun.y + Math.sin(a0) * 44;
    }
    if (v) {
      v.lastFire = now;
      v.recoil = def.kind === 'sniper' || def.kind === 'shotgun' || def.kind === 'rocket' ? 1 : def.kind === 'smg' || def.kind === 'lmg' ? 0.45 : 0.7;
    }
    const ang0 = e.a.length ? e.a[0] / 1000 : (v?.gun.rotation ?? 0);
    if (def.kind !== 'flamer') this.bullets.muzzle(ox, oy, ang0, def.kind, def.kind === 'laser' ? 0x6ec8ff : 0xffc46b);
    if (def.kind === 'laser') {
      for (let i = 0; i < e.a.length; i++) {
        const a = e.a[i] / 1000;
        const d = Math.abs(e.d[i]);
        this.beams.push({ x1: ox, y1: oy, x2: ox + Math.cos(a) * d, y2: oy + Math.sin(a) * d, until: now + 110, color: def.tracer });
      }
    } else if (def.kind !== 'flamer') {
      for (let i = 0; i < e.a.length; i++) {
        const ref = this.bullets.spawn(def.kind, ox, oy, e.a[i] / 1000, e.d[i], def.tracer);
        if (ref) this.recentShots.push({ ref, at: now });
      }
      if (def.kind !== 'rocket' && v) this.bullets.casing(v.gun.x, v.gun.y - 4, Math.cos(ang0) < 0);
      if (def.kind === 'shotgun' || def.kind === 'sniper') this.smokeFx.emitParticleAt(ox, oy, 2);
    }
    if (local && settings.shake) this.cameras.main.shake(def.kind === 'sniper' || def.kind === 'rocket' ? 90 : 45, def.kind === 'rocket' || def.kind === 'sniper' || def.kind === 'shotgun' ? 0.005 : 0.0016);
    sfx.shot(e.weapon, local);
  }

  /** Treffer-Effekte erst zeigen, wenn die sichtbare Kugel ankommt. */
  private whenBulletArrives(x: number, y: number, fx: () => void) {
    const now = this.time.now;
    this.recentShots = this.recentShots.filter((r) => now - r.at < 600);
    let best: { ref: BulletRef; ms: number } | undefined;
    for (const r of this.recentShots) {
      const ms = r.ref.arrival(x, y);
      if (ms !== undefined && (!best || ms < best.ms)) best = { ref: r.ref, ms };
    }
    if (!best || best.ms <= 8) {
      best?.ref.markHit();
      fx();
      return;
    }
    best.ref.markHit();
    this.time.delayedCall(best.ms, fx);
  }

  private onEvent(e: GameEvent) {
    const local = this.session?.localId;
    switch (e.t) {
      case 'hit':
        this.whenBulletArrives(e.x, e.y, () => {
          this.bloodFx.explode(e.head ? 16 : 8, e.x, e.y);
          this.sparkFx.explode(e.elem === 2 ? 10 : e.head ? 6 : 3, e.x, e.y);
          if (e.elem === 1) this.fireFx.explode(5, e.x, e.y);
          sfx.hit(e.head);
        });
        break;
      case 'kill':
        this.whenBulletArrives(e.x, e.y, () => {
          this.bloodFx.explode(e.head ? 40 : 26, e.x, e.y);
          if (e.by === local && settings.shake) this.cameras.main.shake(90, e.head ? 0.006 : 0.003);
          sfx.zombieDeath(e.kind);
        });
        break;
      case 'shot':
        this.onShot(e);
        break;
      case 'melee':
        sfx.swing();
        break;
      case 'reload':
        if (e.id === local) sfx.reload();
        break;
      case 'explosion':
        this.fireFx.explode(30, e.x, e.y);
        this.smokeFx.explode(16, e.x, e.y);
        this.sparkFx.explode(20, e.x, e.y);
        this.flash(e.x, e.y, 0xff9a4a, 2.6, 280);
        if (settings.shake) this.cameras.main.shake(260, 0.008);
        sfx.explosion();
        break;
      case 'door':
        if (settings.shake) this.cameras.main.shake(250, 0.004);
        sfx.door();
        break;
      case 'playerDown':
        if (e.id === local) this.cameras.main.flash(300, 120, 0, 0);
        break;
      case 'lightning':
        this.lightning = 1;
        sfx.thunder();
        break;
      case 'teleport':
        if (e.id === local) {
          this.cameras.main.fadeIn(500, 0, 0, 0);
          this.pending = [];
        }
        break;
      case 'zombieAttack':
        sfx.zombieAttack();
        break;
      case 'truhe':
        sfx.chest();
        break;
      case 'generator':
        sfx.power();
        break;
      default:
        break;
    }
    this.game.events.emit('gameEvent', e);
  }

  private flash(x: number, y: number, color: number, intensity: number, ms: number) {
    const l = this.lights.addLight(x, y, 500, color, intensity, 100);
    this.tweens.addCounter({ from: intensity, to: 0, duration: ms, onUpdate: (tw) => lit(l, tw.getValue() ?? 0), onComplete: () => this.lights.removeLight(l) });
  }

  private followCamera(dt: number) {
    const cam = this.cameras.main;
    const p = this.players.get(this.session!.localId);
    if (!p) return;
    const a = p.gun.rotation;
    const look = controls.touch ? 120 : 160;
    const tx = p.body.x + Math.cos(a) * look - cam.width / 2;
    const ty = p.body.y - 80 + Math.sin(a) * 70 - cam.height / 2;
    const k = 1 - Math.pow(0.0005, dt);
    const jump = Math.abs(tx - cam.scrollX) > 1500 || Math.abs(ty - cam.scrollY) > 1000;
    cam.scrollX = jump ? tx : cam.scrollX + (tx - cam.scrollX) * k;
    cam.scrollY = jump ? ty : cam.scrollY + (ty - cam.scrollY) * k;
  }

  private attract() {
    this.attractHour = (21 + this.time.now * 0.00002) % 24;
    this.attractRain = 0.55 + Math.sin(this.time.now * 0.00005) * 0.4;
    const cam = this.cameras.main;
    // Kamerafahrt vom Bahnhof die Terrassen hinauf und zurück
    const path = [[20, 150], [70, 150], [110, 140], [165, 128], [215, 116], [255, 102], [295, 86], [325, 64]];
    const u = (this.time.now * 0.000025) % 1;
    const tri = u < 0.5 ? u * 2 : 2 - u * 2;
    const f = tri * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(f));
    const k = f - i;
    const x = (path[i][0] + (path[i + 1][0] - path[i][0]) * k) * TILE;
    const y = (path[i][1] + (path[i + 1][1] - path[i][1]) * k) * TILE;
    cam.scrollX = x - cam.width / 2;
    cam.scrollY = y - cam.height * 0.72;
  }

  private renderEnvironment(time: number, dt: number) {
    const s = this.latest;
    const hour = s?.hour ?? this.attractHour;
    const rain = this.session ? (s?.rain ?? 0) : this.attractRain;
    const horde = s?.horde ?? false;
    const d = sampleDay(hour);
    const cam = this.cameras.main;
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = cam.scrollX + w / 2;
    const cy = cam.scrollY + h / 2;
    const zone = zoneAt(this.level, cx, cy);
    const underground = zone.weather === 'under' && cy > 151 * TILE;
    // Ganz unter der Erde verdecken die Hintergrund-Kacheln den Himmel komplett: gar nicht erst zeichnen
    const skyHidden = cam.scrollY > 151 * TILE;
    for (const o of this.skyGroup) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(!skyHidden);
    const wet = rain * 0.55;
    let top = lerpColor(d.skyTop, 0x1b2129, wet);
    let bottom = lerpColor(d.skyBottom, 0x3a4250, wet);
    if (horde) {
      top = lerpColor(top, 0x2a0408, 0.6);
      bottom = lerpColor(bottom, 0x5a0a14, 0.5);
    }
    if (this.lightning > 0) {
      top = lerpColor(top, 0xdce6ff, this.lightning * 0.7);
      bottom = lerpColor(bottom, 0xdce6ff, this.lightning * 0.7);
    }
    this.sky.clear();
    this.sky.fillGradientStyle(top, top, bottom, bottom, 1);
    this.sky.fillRect(0, 0, w, h);
    this.stars.setAlpha(d.night * (1 - rain * 0.9));
    this.stars.tilePositionX = cam.scrollX * 0.02;

    const hh = ((hour % 24) + 24) % 24;
    const isDay = d.night < 0.5;
    const phase = Phaser.Math.Clamp(isDay ? (hh - 6) / 12 : ((hh - 18 + 24) % 24) / 12, 0, 1);
    this.moon.setPosition(w * (0.15 + phase * 0.7), h * 0.42 - Math.sin(phase * Math.PI) * h * 0.3);
    this.moon.setTint(isDay ? 0xfff2c8 : horde ? 0xff3b3b : 0xcfd9ff).setScale(isDay ? 1.6 : horde ? 1.4 : 0.9).setAlpha((1 - rain * 0.85) * 0.9);

    // Hintergrund-Ebenen: horizontale + vertikale Parallaxe
    const vy = (cam.scrollY + h / 2 - 9000) * 0.06;
    const lay = (ts: Phaser.GameObjects.TileSprite, fx: number, off: number, tint: number) => {
      ts.tilePositionX = cam.scrollX * fx;
      ts.y = h + off - vy * fx * 4;
      ts.setTint(tint);
    };
    lay(this.farMtn, 0.05, -40, scaleColor(lerpColor(bottom, 0x2a3446, 0.35), 0.62));
    lay(this.farSnow, 0.05, -40, scaleColor(lerpColor(0xe8f0ff, bottom, 0.35 + d.night * 0.25), 0.85 - d.night * 0.4));
    this.farSnow.setAlpha(0.85);
    lay(this.nearMtn, 0.12, 60, scaleColor(lerpColor(bottom, 0x0a0e16, 0.6), 0.55));
    lay(this.city, 0.25, 120, lerpColor(bottom, 0x000000, 0.78));
    lay(this.cityWin, 0.25, 120, 0xffffff);
    const cityVisible = cam.scrollX < 160 * TILE ? 1 : Math.max(0, 1 - (cam.scrollX - 160 * TILE) / (40 * TILE));
    this.city.setAlpha(cityVisible);
    this.cityWin.setAlpha(cityVisible * d.night * 0.85);
    this.fog.tilePositionX = cam.scrollX * 0.6 + time * 0.012;
    this.fog.y = h - 20;
    this.fog.setAlpha(underground ? 0.25 : Math.min(1, d.fog * 0.9 + rain * 0.35 + (zone.weather === 'alpine' ? 0.2 : 0)));
    this.fog.setVisible(this.fog.alpha > 0.03);

    // Licht
    let amb = underground ? 0x262b36 : scaleColor(lerpColor(d.ambient, 0x2a3240, rain * 0.35), 0.5 + 0.5 * d.ambientI);
    const meNet = s?.players.find((p) => p.id === this.registry.get('localId'));
    if (meNet?.inSafe) amb = lerpColor(amb, 0x6a5c48, 0.6);
    lit(this.selfLight.setPosition(meNet?.x ?? 0, (meNet?.y ?? 0) - 30), this.session && meNet?.alive ? 1.2 : 0);
    if (horde && !underground) amb = lerpColor(amb, 0x3a0d18, 0.5);
    if (this.lightning > 0 && !underground) amb = lerpColor(amb, 0xffffff, this.lightning * 0.8);
    this.lights.setAmbientColor(amb);
    const prev = this.lightning;
    this.lightning = Math.max(0, this.lightning - dt * 4);
    if (prev > 0.55 && this.lightning <= 0.55 && Math.random() < 0.6) this.lightning = 0.9; // Doppelblitz

    const power = s?.power ?? false;
    for (const l of this.lamps) {
      let on = 1;
      if (l.kind === 'street') on = Phaser.Math.Clamp((d.night - 0.3) / 0.3, 0, 1) * (power || l.under ? 1 : 0.75);
      if (l.kind === 'neon') on = Phaser.Math.Clamp((d.night - 0.15) / 0.3, 0, 1) * (Math.sin(time * 0.004 + l.seed) > -0.97 ? 1 : 0.2);
      if (l.kind === 'alarm') on = 0.5 + 0.5 * Math.sin(time * 0.006 + l.seed);
      const flick = l.kind === 'street' ? 0.88 + 0.12 * Math.sin(time * 0.01 + l.seed) * Math.sin(time * 0.0031 + l.seed * 2) : 1;
      lit(l.light, l.base * on * flick);
      l.glow.setAlpha((settings.bloom ? 0.45 : 0.62) * on * flick);
    }

    // Wetter: Regen im Tal, Schnee in den Bergen, unter der Erde nichts
    const alpine = zone.weather === 'alpine';
    const raining = !underground && !alpine ? rain : 0;
    const snowing = !underground && alpine ? Math.max(rain, d.night * 0.25) : 0;
    const qty = settings.rain === 'hoch' ? 7 : settings.rain === 'mittel' ? 3 : 0;
    const n = Math.round(qty * Phaser.Math.Clamp((raining - 0.08) / 0.6, 0, 1));
    if (n > 0) {
      if (!this.rainFx.emitting) this.rainFx.start();
      this.rainFx.setQuantity(n);
    } else if (this.rainFx.emitting) this.rainFx.stop();
    const sn = Math.round((settings.rain === 'aus' ? 0 : settings.rain === 'mittel' ? 2 : 4) * Phaser.Math.Clamp(snowing / 0.6, 0, 1));
    if (sn > 0) {
      if (!this.snowFx.emitting) this.snowFx.start();
      this.snowFx.setQuantity(sn);
    } else if (this.snowFx.emitting) this.snowFx.stop();
    if (this.session) sfx.ambience(underground ? 'under' : raining > 0.2 ? 'rain' : snowing > 0.3 ? 'wind' : 'night', Math.max(raining, snowing), d.night, horde);
  }

  private hudData(): HudData {
    const s = this.latest;
    const me = this.me;
    const pm = store.me;
    const hour = s?.hour ?? 0;
    const d = sampleDay(hour);
    const net = s?.players.find((p) => p.id === this.session?.localId);
    let interaction: InteractionInfo | undefined;
    let safe: (typeof this.level.safeZones)[number] | undefined;
    if (me && s) {
      safe = this.level.safeZones.find((z) => (z.door < 0 || (s.doorsOpen & (1 << z.door)) !== 0) && rectContains(z.rect, me.x, me.y - 4));
      const players = new Map(s.players.map((p) => [p.id, { id: p.id, name: this.session?.roster.get(p.id) ?? '', x: p.x, y: p.y, inSafe: p.inSafe }]));
      interaction = computeInteraction(
        { level: this.level, doorsOpen: s.doorsOpen, truheSpot: s.truheSpot, power: s.power, teleportsOpen: s.teleportsOpen, radioParts: s.radioParts, radioPhase: s.radioPhase, hour: s.hour, players },
        { id: me.id, x: me.x, y: me.y, inSafe: !!safe, safeId: safe?.id ?? -1, weapons: pm?.weapons ?? [] },
      );
    }
    const w = pm?.weapons[pm.active];
    const def = w ? WEAPONS[w.def] : undefined;
    const zone = me ? zoneAt(this.level, me.x, me.y - 10) : undefined;
    return {
      hp: net?.hp ?? 0,
      maxHp: net?.maxHp ?? 100,
      alive: net?.alive ?? true,
      downed: net?.downed ?? false,
      revive: net?.revive ?? 0,
      money: net?.money ?? 0,
      kills: net?.kills ?? 0,
      clock: formatClock(hour),
      day: s?.day ?? 1,
      rain: s?.rain ?? 0,
      night: d.night,
      weather: zone?.weather ?? 'surface',
      zone: safe ? `${safe.name} – Zuflucht` : (zone?.name ?? ''),
      inSafe: net?.inSafe ?? false,
      interaction,
      canAfford: !interaction?.price || (net?.money ?? 0) >= interaction.price,
      grace: s?.grace ?? false,
      horde: s?.horde ?? false,
      ping: this.session?.ping ?? 0,
      fps: Math.round(this.game.loop.actualFps),
      weapon: def?.name ?? '',
      mag: w?.mag ?? 0,
      reserve: w?.reserve ?? 0,
      melee: def?.kind === 'melee',
      reloading: net?.reloading ?? false,
      tier: w?.tier ?? 1,
      element: w?.element ?? 0,
      level: pm?.level ?? 1,
      xp: pm?.xp ?? 0,
      xpNext: pm?.xpNext ?? 1,
      skillPoints: pm?.skillPoints ?? 0,
      heals: (pm?.items.verband ?? 0) + (pm?.items.medkit ?? 0),
      grenades: pm?.items.granate ?? 0,
      molotovs: pm?.items.molotow ?? 0,
      radioPhase: s?.radioPhase ?? 0,
      radioTimer: s?.radioTimer ?? 0,
      radioParts: s?.radioParts ?? 0,
      players: (s?.players ?? []).map((p) => ({ id: p.id, name: this.session?.roster.get(p.id) ?? '', hp: p.hp, maxHp: p.maxHp, color: PLAYER_COLORS[p.id % PLAYER_COLORS.length], downed: p.downed })),
    };
  }

  /** Für Tests im Browser */
  debugState() {
    return {
      me: this.me && { x: Math.round(this.me.x), y: Math.round(this.me.y), zone: zoneAt(this.level, this.me.x, this.me.y - 10).name, climbing: this.me.climbing },
      zombies: this.zombies.size,
      players: this.players.size,
      tick: this.latest?.tick,
      fps: Math.round(this.game.loop.actualFps),
    };
  }
}
