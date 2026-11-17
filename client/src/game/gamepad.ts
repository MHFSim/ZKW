import { InputBits } from '@zkw/shared';

/**
 * Controller-Unterstützung (Standard-Layout, z. B. Xbox/PlayStation über Bluetooth).
 * Linker Stick laufen · rechter Stick zielen · RT schießen · A springen · X Aktion · B laden ·
 * Y Waffe wechseln · LB heilen · RB werfen · Start Pause.
 */
export interface PadState {
  moveX: number;
  bits: number;
  /** Zielrichtung, wenn der rechte Stick ausgelenkt ist */
  aim?: number;
  /** Knöpfe, die gerade erst gedrückt wurden */
  pressed: Set<number>;
}

const prev = new Map<number, boolean[]>();
let lastUsed = 0;

const DEAD = 0.22;
const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * Math.min(1, (Math.abs(v) - DEAD) / (1 - DEAD)));

export function pollPad(): PadState | undefined {
  const pads = navigator.getGamepads?.() ?? [];
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    const btn = (i: number) => !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.4;
    const now = pad.buttons.map((_, i) => btn(i));
    const before = prev.get(pad.index) ?? [];
    prev.set(pad.index, now);
    const pressed = new Set<number>();
    now.forEach((v, i) => v && !before[i] && pressed.add(i));
    const lx = dz(pad.axes[0] ?? 0);
    const ly = dz(pad.axes[1] ?? 0);
    const rx = pad.axes[2] ?? 0;
    const ry = pad.axes[3] ?? 0;
    const dpadX = (btn(15) ? 1 : 0) - (btn(14) ? 1 : 0);
    const active = lx || ly || Math.hypot(rx, ry) > 0.35 || now.some(Boolean);
    if (active) lastUsed = performance.now();
    if (performance.now() - lastUsed > 4000) return undefined; // Controller liegt nur herum
    let bits = 0;
    if (btn(0)) bits |= InputBits.Jump;
    if (ly < -0.6 || btn(12)) bits |= InputBits.Up;
    if (ly > 0.6 || btn(13)) bits |= InputBits.Down;
    if (btn(2)) bits |= InputBits.Interact;
    if (btn(1)) bits |= InputBits.Reload;
    if (btn(4)) bits |= InputBits.Heal;
    if (btn(7) || btn(6)) bits |= InputBits.Fire;
    if (pressed.has(3)) bits |= InputBits.Switch;
    const aim = Math.hypot(rx, ry) > 0.35 ? Math.atan2(ry, rx) : undefined;
    return { moveX: dpadX || lx, bits, aim, pressed };
  }
  return undefined;
}
