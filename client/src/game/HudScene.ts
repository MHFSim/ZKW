import Phaser from 'phaser';
import { ELEMENT_NAMES, type GameEvent } from '@zkw/shared';
import { sfx } from '../audio';
import { controls, settings } from '../ui/state';
import type { HudData } from './GameScene';

const FONT = 'Inter, system-ui, sans-serif';
const DISPLAY = '"Chakra Petch", Inter, sans-serif';

interface Stick {
  pointerId: number;
  ox: number;
  oy: number;
  base: Phaser.GameObjects.Arc;
  knob: Phaser.GameObjects.Arc;
}

interface Btn {
  c: Phaser.GameObjects.Container;
  r: number;
  txt: Phaser.GameObjects.Text;
  key: 'jump' | 'interact' | 'reload' | 'heal' | 'switch' | 'grenade';
  pointer: number;
}

/**
 * HUD und Touch-Steuerung – eigene Szene ohne Licht und ohne Kamera-Filter,
 * damit alles immer gestochen scharf und lesbar bleibt.
 */
export class HudScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;
  private lvText!: Phaser.GameObjects.Text;
  private money!: Phaser.GameObjects.Text;
  private clock!: Phaser.GameObjects.Text;
  private zone!: Phaser.GameObjects.Text;
  private weapon!: Phaser.GameObjects.Text;
  private ammo!: Phaser.GameObjects.Text;
  private items!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private stats!: Phaser.GameObjects.Text;
  private team!: Phaser.GameObjects.Text;
  private left?: Stick;
  private right?: Stick;
  private buttons: Btn[] = [];
  private bannerUntil = 0;
  private wasSafe = false;
  private data_?: HudData;
  private hurt = 0;
  private lastHp = 100;

  constructor() {
    super('hud');
  }

  create() {
    this.input.addPointer(4);
    const t = (size: number, color = '#f2f4f8', family = FONT, weight = '600') =>
      this.add.text(0, 0, '', { fontFamily: family, fontSize: `${size}px`, fontStyle: weight, color, stroke: '#0b0e14', strokeThickness: 4 });
    this.g = this.add.graphics();
    this.hpText = t(15);
    this.lvText = t(14, '#ffb547', DISPLAY, '700');
    this.money = t(26, '#ffb547', DISPLAY, '700').setOrigin(1, 0);
    this.clock = t(15).setOrigin(1, 0);
    this.zone = t(14, '#9aa4b2').setOrigin(1, 0);
    this.team = t(13, '#f2f4f8', FONT, '500');
    this.weapon = t(15, '#f2f4f8', FONT, '600');
    this.ammo = t(28, '#f2f4f8', DISPLAY, '700');
    this.items = t(14, '#9aa4b2', FONT, '600');
    this.prompt = t(21, '#ffb547', DISPLAY, '700').setOrigin(0.5);
    this.banner = t(30, '#3ddc97', DISPLAY, '700').setOrigin(0.5).setAlpha(0);
    this.sub = t(17, '#f2f4f8', FONT, '600').setOrigin(0.5);
    this.stats = t(12, '#9aa4b2', FONT, '500');

    this.buildTouch();
    this.layout();
    this.scale.on('resize', () => this.layout());
    const onHud = (d: HudData) => this.apply(d);
    const onToast = (msg: string, color = '#3ddc97', sub = '') => this.showBanner(msg, color, sub);
    const onEvent = (e: GameEvent) => this.onGameEvent(e);
    this.game.events.on('hud', onHud);
    this.game.events.on('toast', onToast);
    this.game.events.on('gameEvent', onEvent);
    this.events.once('shutdown', () => {
      this.game.events.off('hud', onHud);
      this.game.events.off('toast', onToast);
      this.game.events.off('gameEvent', onEvent);
      this.buttons = [];
      this.left = this.right = undefined;
    });
  }

  private safe() {
    const cs = getComputedStyle(document.documentElement);
    const k = this.scale.width / Math.max(1, window.innerWidth);
    const px = (v: string) => (parseFloat(cs.getPropertyValue(v)) || 0) * k;
    return { l: px('--sal') + 20, r: px('--sar') + 20, t: px('--sat') + 16, b: px('--sab') + 16, k, bar: px('--sat') + 72 * k };
  }

  private layout() {
    const w = this.scale.width;
    const h = this.scale.height;
    const s = this.safe();
    const touch = controls.touch;
    this.hpText.setPosition(s.l, s.t + 20);
    this.lvText.setPosition(s.l + 244, s.t - 3);
    this.team.setPosition(s.l, s.t + 60);
    this.money.setPosition(w - s.r - 4, s.bar);
    this.clock.setPosition(w - s.r - 4, s.bar + 34);
    this.zone.setPosition(w - s.r - 4, s.bar + 56);
    this.weapon.setPosition(touch ? w / 2 - 110 : s.l, touch ? s.bar + 4 : h - s.b - 78);
    this.ammo.setPosition(touch ? w / 2 - 110 : s.l, touch ? s.bar + 24 : h - s.b - 58);
    this.items.setPosition(touch ? w / 2 - 110 : s.l, touch ? s.bar + 60 : h - s.b - 20);
    this.prompt.setPosition(w / 2, h - s.b - (touch ? 140 : 70));
    const by = touch ? Math.max(h * 0.3, s.bar + 120) : h * 0.26;
    this.banner.setPosition(w / 2, by);
    this.sub.setPosition(w / 2, by + 40);
    this.stats.setPosition(s.l, h - s.b - (touch ? 8 : 100));
    const R = w - s.r;
    const B = h - s.b;
    const place: Record<Btn['key'], [number, number]> = {
      jump: [R - 80, B - 80],
      interact: [R - 210, B - 62],
      reload: [R - 66, B - 222],
      switch: [R - 176, B - 186],
      heal: [s.l + 56, B - 250],
      grenade: [s.l + 56, B - 350],
    };
    for (const b of this.buttons) b.c.setPosition(...place[b.key]);
    if (this.data_) this.apply(this.data_);
  }

  private button(key: Btn['key'], label: string, r: number, color: number) {
    const c = this.add.container(0, 0);
    const bg = this.add.circle(0, 0, r, 0x141a24, 0.5).setStrokeStyle(2, color, 0.9);
    const txt = this.add.text(0, 0, label, { fontFamily: DISPLAY, fontSize: `${Math.max(12, Math.round(r * 0.32))}px`, fontStyle: '700', color: '#f2f4f8', align: 'center' }).setOrigin(0.5);
    c.add([bg, txt]);
    const b: Btn = { c, r, txt, key, pointer: -1 };
    this.buttons.push(b);
    return b;
  }

  private buildTouch() {
    this.buttons = [];
    this.button('jump', 'SPRUNG', 62, 0xffb547);
    this.button('interact', 'AKTION', 46, 0x6ec8ff);
    this.button('reload', 'LADEN', 38, 0xf2f4f8);
    this.button('switch', 'WAFFE', 38, 0xf2f4f8);
    this.button('heal', 'HEILEN', 40, 0x3ddc97);
    this.button('grenade', 'WURF', 40, 0xff8a3d);
    this.setTouchVisible(controls.touch);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      sfx.unlock();
      if (p.wasTouch && !controls.touch) {
        controls.touch = true;
        this.setTouchVisible(true);
        this.layout();
      }
      if (!controls.touch || this.game.registry.get('uiOpen')) return;
      for (const b of this.buttons) {
        if (Math.hypot(p.x - b.c.x, p.y - b.c.y) > b.r + 12) continue;
        b.pointer = p.id;
        b.c.setScale(0.92);
        navigator.vibrate?.(8);
        if (b.key === 'jump') controls.jump = true;
        if (b.key === 'interact') controls.interact = true;
        if (b.key === 'reload') controls.reload = true;
        if (b.key === 'heal') controls.heal = true;
        if (b.key === 'switch') controls.switchPulse = true;
        if (b.key === 'grenade') this.game.events.emit('throw', (this.data_?.grenades ?? 0) > 0 ? 'granate' : 'molotow');
        return;
      }
      if (p.x < this.scale.width * 0.45 && !this.left) this.left = this.stick(p, 0xffffff);
      else if (p.x >= this.scale.width * 0.45 && !this.right) this.right = this.stick(p, 0xffb547);
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.left && p.id === this.left.pointerId) {
        const dx = Phaser.Math.Clamp(p.x - this.left.ox, -70, 70);
        const dy = Phaser.Math.Clamp(p.y - this.left.oy, -70, 70);
        this.left.knob.setPosition(this.left.ox + dx, this.left.oy + dy);
        controls.moveX = Math.abs(dx) < 10 ? 0 : dx / 70;
        controls.up = dy < -38; // nach oben = klettern/springen
        controls.down = dy > 38; // nach unten = runterklettern/durchfallen
      }
      if (this.right && p.id === this.right.pointerId) {
        const dx = p.x - this.right.ox;
        const dy = p.y - this.right.oy;
        const len = Math.hypot(dx, dy);
        const cl = Math.min(len, 70);
        if (len > 6) {
          controls.aimX = dx / len;
          controls.aimY = dy / len;
          controls.aimActive = true;
        }
        this.right.knob.setPosition(this.right.ox + (dx / (len || 1)) * cl, this.right.oy + (dy / (len || 1)) * cl);
        controls.fire = cl / 70 >= 0.8; // ab 80 % Auslenkung automatisch schießen
      }
    });

    const release = (p: Phaser.Input.Pointer) => {
      for (const b of this.buttons) {
        if (b.pointer !== p.id) continue;
        b.pointer = -1;
        b.c.setScale(1);
        if (b.key === 'jump') controls.jump = false;
        if (b.key === 'interact') controls.interact = false;
        if (b.key === 'reload') controls.reload = false;
        if (b.key === 'heal') controls.heal = false;
      }
      if (this.left && p.id === this.left.pointerId) {
        this.left.base.destroy();
        this.left.knob.destroy();
        this.left = undefined;
        controls.moveX = 0;
        controls.up = controls.down = false;
      }
      if (this.right && p.id === this.right.pointerId) {
        this.right.base.destroy();
        this.right.knob.destroy();
        this.right = undefined;
        controls.fire = false;
        controls.aimActive = false;
      }
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
  }

  private stick(p: Phaser.Input.Pointer, color: number): Stick {
    const base = this.add.circle(p.x, p.y, 76, 0x141a24, 0.35).setStrokeStyle(2, color, 0.45);
    const knob = this.add.circle(p.x, p.y, 32, color, 0.55);
    return { pointerId: p.id, ox: p.x, oy: p.y, base, knob };
  }

  private setTouchVisible(v: boolean) {
    for (const b of this.buttons) b.c.setVisible(v);
  }

  showBanner(msg: string, color = '#3ddc97', sub = '') {
    this.banner.setText(msg).setColor(color).setAlpha(msg ? 1 : 0);
    this.sub.setText(sub).setAlpha(sub ? 1 : 0);
    this.bannerUntil = this.time.now + 2800;
  }

  private onGameEvent(e: GameEvent) {
    const localId = this.registry.get('localId') ?? 0;
    switch (e.t) {
      case 'levelUp':
        if (e.id === localId) {
          this.showBanner(`Level ${e.level}!`, '#ffb547', 'Neuer Skillpunkt – verteile ihn im Trainingsraum einer Zuflucht');
          sfx.ui('level');
        }
        break;
      case 'horde':
        if (e.on) this.showBanner('Horde-Nacht', '#ff4d5e', 'Doppelte XP draußen – oder ab in eine Zuflucht');
        break;
      case 'generator':
        this.showBanner('Strom ist zurück', '#6ec8ff', 'Gondel, Kontrollraum und Laternen laufen wieder');
        break;
      case 'notice': {
        const color = e.tone === 'warn' ? '#ff4d5e' : e.tone === 'ok' ? '#3ddc97' : '#6ec8ff';
        if (e.text.length > 40) this.showBanner('', color, e.text);
        else this.showBanner(e.text, color);
        break;
      }
      case 'door':
        this.showBanner('Tür geöffnet', '#ffb547');
        break;
      case 'truhe':
        if (e.id === localId) this.showBanner('Wundertruhe!', '#b26bff', 'Die Truhe wandert jetzt an einen anderen Ort');
        break;
      case 'playerDown':
        if (e.id === localId) this.showBanner('Am Boden!', '#ff4d5e', 'Mitspieler können dich wiederbeleben (Aktion gedrückt halten)');
        break;
    }
  }

  private apply(d: HudData) {
    this.data_ = d;
    const s = this.safe();
    const w = this.scale.width;
    const h = this.scale.height;
    const g = this.g;
    g.clear();
    const bw = 230;
    g.fillStyle(0x0b0e14, 0.6).fillRoundedRect(s.l, s.t, bw, 14, 7);
    const pct = Math.max(0, d.hp) / Math.max(1, d.maxHp);
    const col = pct > 0.5 ? 0x3ddc97 : pct > 0.25 ? 0xffb547 : 0xff4d5e;
    if (pct > 0) g.fillStyle(col, 1).fillRoundedRect(s.l + 2, s.t + 2, (bw - 4) * pct, 10, 5);
    g.fillStyle(0x0b0e14, 0.6).fillRect(s.l, s.t + 44, bw, 4);
    g.fillStyle(0xffb547, 0.9).fillRect(s.l, s.t + 44, bw * Math.min(1, d.xp / Math.max(1, d.xpNext)), 4);
    this.hpText.setText(d.downed ? 'AM BODEN – warte auf Hilfe' : d.alive ? `${Math.round(d.hp)} / ${d.maxHp} HP` : 'Ausgeschaltet – zurück zur Zuflucht …');
    this.lvText.setText(`LV ${d.level}${d.skillPoints ? `  +${d.skillPoints}` : ''}`);
    this.money.setText(`${d.money.toLocaleString('de-DE')} ¢`);
    const weather = d.weather === 'under' ? 'Untergrund' : d.rain > 0.15 ? (d.weather === 'alpine' ? 'Schnee' : 'Regen') : d.night > 0.5 ? 'Nacht' : 'Klar';
    this.clock.setText(`Tag ${d.day} · ${d.clock} · ${weather}${d.horde ? ' · HORDE' : ''}`).setColor(d.horde ? '#ff4d5e' : '#f2f4f8');
    this.zone.setText(d.zone).setColor(d.inSafe ? '#3ddc97' : '#9aa4b2');
    this.team.setText(d.players.length > 1 ? d.players.map((p) => `${p.downed ? '✚ ' : ''}${p.name}  ${p.hp} HP`).join('\n') : '');
    const stars = '★'.repeat(d.tier) + (d.element ? ` · ${ELEMENT_NAMES[d.element]}` : '');
    this.weapon.setText(`${d.weapon}  ${stars}`);
    this.ammo.setText(d.melee ? '∞' : d.reloading ? 'Lädt …' : `${d.mag} / ${d.reserve}`).setColor(!d.melee && d.mag === 0 && d.reserve === 0 ? '#ff4d5e' : '#f2f4f8');
    this.items.setText(`Heilung ${d.heals}  ·  Granaten ${d.grenades}  ·  Molotows ${d.molotovs}`);

    const how = controls.touch ? 'AKTION' : 'E';
    let prompt = '';
    let pc = '#ffb547';
    if (d.grace) {
      prompt = 'Spielstand geladen – gleich geht es los …';
      pc = '#6ec8ff';
    } else if (d.downed) {
      prompt = d.revive > 0 ? `Wiederbelebung ${Math.round(d.revive * 100)} %` : 'Ein Mitspieler muss dich wiederbeleben (gedrückt halten)';
      pc = '#ff4d5e';
    } else if (d.interaction) {
      const it = d.interaction;
      if (it.kind === 'info') {
        prompt = it.label;
        pc = '#9aa4b2';
      } else {
        prompt = `${it.label}${it.price ? ` · ${it.price.toLocaleString('de-DE')} ¢` : ''}   [${how}]`;
        if (!d.canAfford) pc = '#ff4d5e';
      }
    } else if (d.radioPhase === 1) {
      prompt = `Verteidigt die Funkstation: ${Math.ceil(d.radioTimer)} s`;
      pc = '#ff4d5e';
    } else if (d.radioPhase === 3) {
      prompt = `Hubschrauber landet in ${Math.ceil(d.radioTimer)} s – zum Landeplatz!`;
      pc = '#3ddc97';
    } else if (d.radioPhase === 4) {
      prompt = 'Alle auf den Landeplatz!';
      pc = '#3ddc97';
    }
    this.prompt.setText(prompt).setColor(pc);
    for (const b of this.buttons) if (b.key === 'interact') b.c.setAlpha(d.interaction && d.interaction.kind !== 'info' ? 1 : 0.5);

    if (d.inSafe && !this.wasSafe) this.showBanner('Zuflucht – sicher', '#3ddc97', 'Hier greifen dich keine Zombies an · automatisch gespeichert');
    this.wasSafe = d.inSafe;
    if (this.time.now > this.bannerUntil) {
      const fade = this.game.loop.delta / 300;
      this.banner.setAlpha(Math.max(0, this.banner.alpha - fade));
      this.sub.setAlpha(Math.max(0, this.sub.alpha - fade));
    }
    if (d.hp > 0 && this.lastHp > 0 && d.hp < this.lastHp) this.hurt = 1;
    this.lastHp = d.hp;
    this.hurt = Math.max(0, this.hurt - this.game.loop.delta / 400);
    const low = d.alive && !d.downed && pct < 0.3 ? 0.35 + Math.sin(this.time.now * 0.008) * 0.15 : 0;
    const edge = Math.max(this.hurt * 0.5, low, d.downed ? 0.4 : 0);
    if (edge > 0) {
      for (let i = 0; i < 6; i++) {
        g.lineStyle(26 - i * 4, 0xff1a2a, edge * (0.15 + i * 0.05));
        g.strokeRect(i * 4, i * 4, w - i * 8, h - i * 8);
      }
    }
    if (low) sfx.heartbeat();
    this.stats.setText([d.ping ? `Ping ${d.ping} ms` : '', settings.fps ? `${d.fps} FPS` : ''].filter(Boolean).join('  ·  '));
  }
}
