import Phaser from 'phaser';
import type { WeaponKind } from '@zkw/shared';

/** Flugbild je Waffenart: Geschwindigkeit (px/s), Länge des Leuchtschweifs, Dicke. */
const LOOK: Partial<Record<WeaponKind, { speed: number; len: number; thick: number }>> = {
  pistol: { speed: 3200, len: 70, thick: 1 },
  smg: { speed: 3000, len: 60, thick: 0.85 },
  shotgun: { speed: 2700, len: 42, thick: 0.75 },
  rifle: { speed: 3800, len: 95, thick: 1 },
  lmg: { speed: 3500, len: 85, thick: 1 },
  sniper: { speed: 6200, len: 240, thick: 1.4 },
};

interface Bullet {
  core: Phaser.GameObjects.Image;
  halo: Phaser.GameObjects.Image;
  active: boolean;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Strecke bis zum Ende */
  dist: number;
  /** endet an einer Wand (Funken, Staub) */
  wall: boolean;
  speed: number;
  len: number;
  /** zurückgelegte Strecke der Spitze */
  head: number;
  /** Zeit seit dem Ende (Schweif läuft nach) */
  fade: number;
  born: number;
}

export interface BulletRef {
  /** Millisekunden, bis die Kugel den Punkt (px, py) erreicht – oder undefined, wenn er nicht auf der Bahn liegt */
  arrival(px: number, py: number): number | undefined;
  /** Die Kugel hat einen Zombie getroffen: kein Wand-Einschlag am Ende */
  markHit(): void;
}

/**
 * Sichtbare Kugeln: leuchtender Kern mit Schweif, der mit echter Geschwindigkeit
 * von der Mündung bis zum Einschlag fliegt. Alles aus einem Pool – keine Objekte pro Schuss.
 */
export class BulletFx {
  private pool: Bullet[] = [];
  private casings: Phaser.GameObjects.Particles.ParticleEmitter;
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private flashes: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene) {
    this.casings = scene.add
      .particles(0, 0, 'casing', {
        speed: { min: 140, max: 280 }, gravityY: 1700, lifespan: { min: 600, max: 900 }, rotate: { start: 0, end: 900 },
        alpha: { start: 1, end: 0.7 }, emitting: false,
      })
      .setDepth(14);
    this.dust = scene.add
      .particles(0, 0, 'dust', {
        speed: { min: 20, max: 90 }, lifespan: { min: 350, max: 700 }, scale: { start: 0.5, end: 1.6 }, alpha: { start: 0.8, end: 0 },
        gravityY: -40, emitting: false,
      })
      .setDepth(29);
    this.sparks = scene.add
      .particles(0, 0, 'spark', {
        speed: { min: 140, max: 420 }, lifespan: { min: 120, max: 280 }, scale: { start: 1.3, end: 0 }, gravityY: 900,
        blendMode: Phaser.BlendModes.ADD, emitting: false,
      })
      .setDepth(31);
  }

  private get(): Bullet {
    let b = this.pool.find((x) => !x.active);
    if (!b) {
      const halo = this.scene.add.image(0, 0, 'bullet-halo').setOrigin(100 / 128, 0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(34);
      const core = this.scene.add.image(0, 0, 'bullet').setOrigin(1, 0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(35);
      b = { core, halo, active: false, x: 0, y: 0, dx: 0, dy: 0, dist: 0, wall: false, speed: 0, len: 0, head: 0, fade: 0, born: 0 };
      this.pool.push(b);
    }
    return b;
  }

  /** Neue Kugel. dist < 0: fliegt ins Leere (kein Einschlag). */
  spawn(kind: WeaponKind, x: number, y: number, ang: number, dist: number, color: number): BulletRef | undefined {
    const look = LOOK[kind];
    if (!look) return undefined;
    const b = this.get();
    b.active = true;
    b.x = x;
    b.y = y;
    b.dx = Math.cos(ang);
    b.dy = Math.sin(ang);
    b.dist = Math.max(8, Math.abs(dist));
    b.wall = dist > 0;
    b.speed = look.speed * (0.94 + Math.random() * 0.12);
    b.len = look.len;
    b.head = 0;
    b.fade = 0;
    b.born = this.scene.time.now;
    b.core.setRotation(ang).setTint(0xffffff).setScale(0, look.thick).setVisible(true).setAlpha(1);
    b.halo.setRotation(ang).setTint(color).setScale(0, look.thick).setVisible(true).setAlpha(0.55);
    const ref: BulletRef = {
      arrival: (px, py) => {
        const t = (px - b.x) * b.dx + (py - b.y) * b.dy;
        const off = Math.abs((px - b.x) * b.dy - (py - b.y) * b.dx);
        if (off > 46 || t < -20 || t > b.dist + 46) return undefined;
        return (Math.max(0, t) / b.speed) * 1000 - (this.scene.time.now - b.born);
      },
      markHit: () => {
        b.wall = false;
      },
    };
    return ref;
  }

  /** Mündungsfeuer als kurzer, eingefärbter Stern. */
  muzzle(x: number, y: number, ang: number, kind: WeaponKind, color: number) {
    let f = this.flashes.find((i) => !i.visible);
    if (!f) {
      f = this.scene.add.image(0, 0, 'muzzle').setOrigin(14 / 96, 0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(36);
      this.flashes.push(f);
    }
    const big = kind === 'shotgun' || kind === 'sniper' || kind === 'rocket' ? 1.35 : kind === 'smg' ? 0.75 : 1;
    f.setPosition(x, y)
      .setRotation(ang + (Math.random() - 0.5) * 0.15)
      .setScale(big * (0.8 + Math.random() * 0.35), big * (0.7 + Math.random() * 0.5))
      .setTint(color)
      .setAlpha(1)
      .setVisible(true);
    this.scene.tweens.add({ targets: f, alpha: 0, duration: 70, onComplete: () => f!.setVisible(false) });
  }

  /** Patronenhülse aus dem Auswurf (nach hinten oben). */
  casing(x: number, y: number, facingLeft: boolean, n = 1) {
    this.casings.setEmitterAngle(facingLeft ? { min: -60, max: -25 } : { min: -155, max: -120 });
    this.casings.emitParticleAt(x, y, n);
  }

  /** Einschlag in Wand/Boden: Funken und Staub. */
  impact(x: number, y: number, heavy: boolean) {
    this.sparks.emitParticleAt(x, y, heavy ? 9 : 4);
    this.dust.emitParticleAt(x, y, heavy ? 4 : 2);
  }

  update(dtMs: number) {
    const dt = dtMs / 1000;
    for (const b of this.pool) {
      if (!b.active) continue;
      if (b.head < b.dist) {
        b.head = Math.min(b.dist, b.head + b.speed * dt);
        if (b.head >= b.dist && b.wall) this.impact(b.x + b.dx * b.dist, b.y + b.dy * b.dist, b.len > 150);
      } else {
        b.fade += b.speed * dt; // Schweif holt die Spitze ein
      }
      const tailLen = Math.min(b.len, b.head) - b.fade;
      if (tailLen <= 0) {
        b.active = false;
        b.core.setVisible(false);
        b.halo.setVisible(false);
        continue;
      }
      const hx = b.x + b.dx * b.head;
      const hy = b.y + b.dy * b.head;
      b.core.setPosition(hx, hy).scaleX = tailLen / 96;
      b.halo.setPosition(hx, hy).scaleX = tailLen / 100;
    }
  }

  clear() {
    for (const b of this.pool) {
      b.active = false;
      b.core.setVisible(false);
      b.halo.setVisible(false);
    }
  }
}
