import Phaser from 'phaser';
import { InputBits } from '@zkw/shared';
import { sfx } from '../audio';
import { controls } from '../ui/state';

const DISPLAY = '"Chakra Petch", Inter, sans-serif';

type BtnKey = 'jump' | 'interact' | 'reload' | 'heal' | 'switch' | 'throw';

interface Btn {
  key: BtnKey;
  c: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  badge?: Phaser.GameObjects.Text;
  /** Radius in CSS-Pixeln (echte Fingergröße) */
  cssR: number;
  r: number;
  color: number;
  pointer: number;
}

interface Stick {
  pointer: number;
  ox: number;
  oy: number;
  /** Ruheposition (Geist), wenn nicht berührt */
  homeX: number;
  homeY: number;
  base: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Arc;
  knob: Phaser.GameObjects.Arc;
  hint: Phaser.GameObjects.Text;
}

/** Werte, die die Touch-Steuerung aus dem HUD braucht. */
export interface TouchState {
  interactLabel?: string;
  canInteract: boolean;
  heals: number;
  throwables: number;
  throwLabel: string;
  reloading: boolean;
  needReload: boolean;
}

/**
 * Touch-Steuerung für Handys im Querformat.
 * - Links: Bewegungs-Stick (schwebend, mit sichtbarer Ruheposition). Nach oben schnippen = springen/klettern,
 *   nach unten = Leiter runter/durch Stege fallen. Kleine Totzone, damit nichts aus Versehen auslöst.
 * - Rechts: Ziel-Stick – Richtung zielt sofort, ab etwas Auslenkung wird geschossen.
 * - Knöpfe in Daumenreichweite, Größen in echten Zentimetern (CSS-Pixel), nicht in Spielpixeln.
 */
export class TouchControls {
  private buttons: Btn[] = [];
  private move!: Stick;
  private aim!: Stick;
  private visible = false;
  /** Spielpixel pro CSS-Pixel */
  private k = 1;
  private readonly STICK_CSS = 58;

  constructor(
    private scene: Phaser.Scene,
    private uiOpen: () => boolean,
    private onThrow: () => void,
  ) {
    this.move = this.makeStick(0xffffff, 'LAUFEN');
    this.aim = this.makeStick(0xffb547, 'ZIELEN');
    this.button('jump', 'SPRUNG', 40, 0xffb547);
    this.button('interact', 'AKTION', 34, 0x6ec8ff);
    this.button('reload', 'LADEN', 26, 0xf2f4f8);
    this.button('switch', 'WAFFE', 26, 0xf2f4f8);
    this.button('heal', 'HEILEN', 26, 0x3ddc97, true);
    this.button('throw', 'WURF', 26, 0xff8a3d, true);

    const input = scene.input;
    input.on('pointerdown', (p: Phaser.Input.Pointer) => this.down(p));
    input.on('pointermove', (p: Phaser.Input.Pointer) => this.moveP(p));
    input.on('pointerup', (p: Phaser.Input.Pointer) => this.up(p));
    input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.up(p));
    this.setVisible(controls.touch);
  }

  private makeStick(color: number, hint: string): Stick {
    const s = this.scene;
    const base = s.add.circle(0, 0, 10, 0x0b0e14, 0.28).setStrokeStyle(2, color, 0.35);
    const ring = s.add.circle(0, 0, 10, 0x000000, 0).setStrokeStyle(3, color, 0.8).setAlpha(0);
    const knob = s.add.circle(0, 0, 10, color, 0.5);
    const txt = s.add.text(0, 0, hint, { fontFamily: DISPLAY, fontSize: '13px', fontStyle: '700', color: '#ffffff' }).setOrigin(0.5).setAlpha(0.35);
    return { pointer: -1, ox: 0, oy: 0, homeX: 0, homeY: 0, base, ring, knob, hint: txt };
  }

  private button(key: BtnKey, label: string, cssR: number, color: number, badge = false) {
    const s = this.scene;
    const c = s.add.container(0, 0);
    const bg = s.add.circle(0, 0, 10, 0x0b0e14, 0.42).setStrokeStyle(3, color, 0.9);
    const txt = s.add.text(0, 0, label, { fontFamily: DISPLAY, fontSize: '14px', fontStyle: '700', color: '#f2f4f8', align: 'center' }).setOrigin(0.5);
    c.add([bg, txt]);
    const btn: Btn = { key, c, bg, label: txt, cssR, r: 10, color, pointer: -1 };
    if (badge) {
      const bt = s.add.text(0, 0, '0', { fontFamily: DISPLAY, fontSize: '13px', fontStyle: '700', color: '#0b0e14', backgroundColor: '#f2f4f8', padding: { x: 5, y: 1 } }).setOrigin(0.5);
      c.add(bt);
      btn.badge = bt;
    }
    this.buttons.push(btn);
  }

  /** Größen und Positionen aus der Bildschirmgröße und den sicheren Rändern berechnen. */
  layout(safe: { l: number; r: number; t: number; b: number; k: number }) {
    const { width: w, height: h } = this.scene.scale;
    this.k = safe.k;
    const k = safe.k;
    for (const b of this.buttons) {
      b.r = b.cssR * k;
      b.bg.setRadius(b.r);
      b.label.setFontSize(Math.round(Math.max(11, b.cssR * 0.36) * k));
      b.badge?.setFontSize(Math.round(12 * k)).setPosition(b.r * 0.72, -b.r * 0.72);
    }
    const R = w - safe.r;
    const B = h - safe.b;
    const u = k; // 1 CSS-Pixel
    // Rechter Daumen: Sprung unten rechts, Aktion daneben, darüber Laden/Waffe – alles in einem Bogen
    const place: Record<BtnKey, [number, number]> = {
      jump: [R - 46 * u, B - 46 * u],
      interact: [R - 138 * u, B - 34 * u],
      reload: [R - 34 * u, B - 140 * u],
      switch: [R - 104 * u, B - 118 * u],
      heal: [safe.l + 34 * u, B - 196 * u],
      throw: [safe.l + 34 * u, B - 264 * u],
    };
    for (const b of this.buttons) b.c.setPosition(...place[b.key]);
    const sr = this.STICK_CSS * k;
    this.move.homeX = safe.l + sr + 18 * u;
    this.move.homeY = B - sr - 26 * u;
    this.aim.homeX = R - 250 * u;
    this.aim.homeY = B - sr - 40 * u;
    for (const st of [this.move, this.aim]) {
      st.base.setRadius(sr);
      st.ring.setRadius(sr);
      st.knob.setRadius(sr * 0.42);
      st.hint.setFontSize(Math.round(11 * k));
      if (st.pointer < 0) this.rest(st);
    }
  }

  private rest(st: Stick) {
    st.ox = st.homeX;
    st.oy = st.homeY;
    st.base.setPosition(st.homeX, st.homeY).setAlpha(this.visible ? 0.55 : 0);
    st.ring.setPosition(st.homeX, st.homeY).setAlpha(0);
    st.knob.setPosition(st.homeX, st.homeY).setAlpha(this.visible ? 0.45 : 0);
    st.hint.setPosition(st.homeX, st.homeY - st.base.radius - 12 * this.k).setAlpha(this.visible ? 0.35 : 0);
  }

  setVisible(v: boolean) {
    this.visible = v;
    for (const b of this.buttons) b.c.setVisible(v);
    for (const st of [this.move, this.aim]) {
      st.base.setVisible(v);
      st.ring.setVisible(v);
      st.knob.setVisible(v);
      st.hint.setVisible(v);
      if (st.pointer < 0) this.rest(st);
    }
  }

  /** Zustand aus dem HUD: Beschriftung der Aktion, Zähler, Hervorhebungen. */
  update(s: TouchState) {
    if (!this.visible) return;
    const t = this.scene.time.now;
    for (const b of this.buttons) {
      if (b.key === 'interact') {
        b.label.setText(s.canInteract ? (s.interactLabel ?? 'AKTION') : 'AKTION');
        b.c.setAlpha(s.canInteract ? 1 : 0.4);
        b.bg.setFillStyle(s.canInteract ? 0x1d4a6b : 0x0b0e14, s.canInteract ? 0.75 : 0.42);
        if (s.canInteract && b.pointer < 0) b.c.setScale(1 + Math.sin(t * 0.008) * 0.04);
      } else if (b.key === 'heal') {
        b.badge?.setText(String(s.heals));
        b.c.setAlpha(s.heals > 0 ? 1 : 0.4);
      } else if (b.key === 'throw') {
        b.badge?.setText(String(s.throwables));
        b.label.setText(s.throwLabel);
        b.c.setAlpha(s.throwables > 0 ? 1 : 0.4);
      } else if (b.key === 'reload') {
        b.label.setText(s.reloading ? '…' : 'LADEN');
        b.bg.setStrokeStyle(3, s.needReload ? 0xff4d5e : b.color, 0.9);
      }
    }
  }

  private hitButton(p: Phaser.Input.Pointer): Btn | undefined {
    // Großzügige Trefferfläche: Knopfradius + 10 CSS-Pixel
    let best: Btn | undefined;
    let bestD = Infinity;
    for (const b of this.buttons) {
      const d = Math.hypot(p.x - b.c.x, p.y - b.c.y);
      if (d < b.r + 10 * this.k && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  private down(p: Phaser.Input.Pointer) {
    sfx.unlock();
    if (p.wasTouch && !controls.touch) {
      controls.touch = true;
      this.setVisible(true);
    }
    if (!controls.touch || this.uiOpen()) return;
    const b = this.hitButton(p);
    if (b) {
      b.pointer = p.id;
      b.c.setScale(0.9);
      b.bg.setFillStyle(b.color, 0.35);
      navigator.vibrate?.(10);
      if (b.key === 'jump') (controls.jump = true), (controls.pulse |= InputBits.Jump);
      if (b.key === 'interact') (controls.interact = true), (controls.pulse |= InputBits.Interact);
      if (b.key === 'reload') (controls.reload = true), (controls.pulse |= InputBits.Reload);
      if (b.key === 'heal') (controls.heal = true), (controls.pulse |= InputBits.Heal);
      if (b.key === 'switch') controls.switchPulse = true;
      if (b.key === 'throw') this.onThrow();
      return;
    }
    const w = this.scene.scale.width;
    if (p.x < w * 0.42 && this.move.pointer < 0) this.grab(this.move, p);
    else if (p.x >= w * 0.42 && this.aim.pointer < 0) {
      this.grab(this.aim, p);
      this.aimFrom(p);
    }
  }

  private grab(st: Stick, p: Phaser.Input.Pointer) {
    st.pointer = p.id;
    // Schwebender Stick: Mitte dort, wo der Daumen aufsetzt
    st.ox = p.x;
    st.oy = p.y;
    st.base.setPosition(p.x, p.y).setAlpha(0.7);
    st.ring.setPosition(p.x, p.y).setAlpha(0);
    st.knob.setPosition(p.x, p.y).setAlpha(0.8);
    st.hint.setAlpha(0);
  }

  private moveP(p: Phaser.Input.Pointer) {
    if (p.id === this.move.pointer) {
      const st = this.move;
      const r = st.base.radius;
      let dx = p.x - st.ox;
      let dy = p.y - st.oy;
      const len = Math.hypot(dx, dy);
      // Stick folgt dem Daumen, wenn er weit über den Rand zieht – kein „Festhängen“
      if (len > r * 1.35) {
        const pull = (len - r * 1.35) / len;
        st.ox += dx * pull;
        st.oy += dy * pull;
        st.base.setPosition(st.ox, st.oy);
        dx = p.x - st.ox;
        dy = p.y - st.oy;
      }
      const cl = Math.min(1, Math.hypot(dx, dy) / r);
      const nx = dx / (Math.hypot(dx, dy) || 1);
      const ny = dy / (Math.hypot(dx, dy) || 1);
      st.knob.setPosition(st.ox + nx * cl * r, st.oy + ny * cl * r);
      // Waagerecht: analog mit kleiner Totzone, schnell auf volle Geschwindigkeit
      const ax = nx * cl;
      controls.moveX = Math.abs(ax) < 0.15 ? 0 : Math.sign(ax) * Math.min(1, (Math.abs(ax) - 0.15) / 0.55);
      // Senkrecht nur, wenn deutlich nach oben/unten gezogen (Winkel ±50° um die Senkrechte)
      const vertical = Math.abs(ny) > 0.64;
      controls.up = vertical && ny < 0 && cl > 0.55;
      controls.down = vertical && ny > 0 && cl > 0.55;
      st.ring.setAlpha(controls.up || controls.down ? 0.9 : 0);
    }
    if (p.id === this.aim.pointer) this.aimFrom(p);
  }

  private aimFrom(p: Phaser.Input.Pointer) {
    const st = this.aim;
    const r = st.base.radius;
    const dx = p.x - st.ox;
    const dy = p.y - st.oy;
    const len = Math.hypot(dx, dy);
    const cl = Math.min(1, len / r);
    if (len > 4 * this.k) {
      controls.aimX = dx / len;
      controls.aimY = dy / len;
      controls.aimActive = true;
    }
    st.knob.setPosition(st.ox + (dx / (len || 1)) * cl * r, st.oy + (dy / (len || 1)) * cl * r);
    // Schon ab einem Drittel Auslenkung feuern – zielen und schießen in einer Bewegung
    controls.fire = cl >= 0.33;
    st.ring.setAlpha(controls.fire ? 0.9 : 0);
  }

  private up(p: Phaser.Input.Pointer) {
    for (const b of this.buttons) {
      if (b.pointer !== p.id) continue;
      b.pointer = -1;
      b.c.setScale(1);
      b.bg.setFillStyle(0x0b0e14, 0.42);
      if (b.key === 'jump') controls.jump = false;
      if (b.key === 'interact') controls.interact = false;
      if (b.key === 'reload') controls.reload = false;
      if (b.key === 'heal') controls.heal = false;
    }
    if (p.id === this.move.pointer) {
      this.move.pointer = -1;
      controls.moveX = 0;
      controls.up = controls.down = false;
      this.rest(this.move);
    }
    if (p.id === this.aim.pointer) {
      this.aim.pointer = -1;
      controls.fire = false;
      controls.aimActive = false;
      this.rest(this.aim);
    }
  }

  /** Beim Öffnen eines Menüs alles loslassen, damit nichts weiterläuft. */
  releaseAll() {
    for (const st of [this.move, this.aim]) if (st.pointer >= 0) this.up({ id: st.pointer } as Phaser.Input.Pointer);
    for (const b of this.buttons) if (b.pointer >= 0) this.up({ id: b.pointer } as Phaser.Input.Pointer);
  }
}
