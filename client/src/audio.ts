import { WEAPONS } from '@zkw/shared';
import { settings } from './ui/state';

/**
 * Alle Geräusche und die Musik entstehen per Web-Audio-Synthese – keine Audiodateien.
 * Browser erlauben Ton erst nach einer Berührung/einem Klick: unlock() wird dabei aufgerufen.
 */
class Sfx {
  private ctx?: AudioContext;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private last = new Map<string, number>();
  private amb?: { rain: GainNode; wind: GainNode; drone: GainNode; windFilter: BiquadFilterNode };
  private music?: { oscs: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode; chord: number; next: number };

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.gainTo(this.master);
      this.ambBus = this.gainTo(this.master);
      this.musicBus = this.gainTo(this.master);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = settings.volMaster;
    this.sfxBus.gain.value = settings.volSfx;
    this.ambBus.gain.value = settings.volSfx * 0.7;
    this.musicBus.gain.value = settings.volMusic * 0.6;
  }

  private gainTo(dest: AudioNode, v = 1) {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    g.connect(dest);
    return g;
  }

  private ok(key: string, minMs: number) {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    const now = performance.now();
    if (now - (this.last.get(key) ?? 0) < minMs) return false;
    this.last.set(key, now);
    return true;
  }

  /** Rauschstoß durch einen Filter mit Hüllkurve */
  private burst(opts: { type?: BiquadFilterType; freq: number; q?: number; dur: number; vol: number; sweepTo?: number; delay?: number; bus?: GainNode }) {
    const c = this.ctx!;
    const t = c.currentTime + (opts.delay ?? 0);
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + opts.dur);
    f.Q.value = opts.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f).connect(g).connect(opts.bus ?? this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + opts.dur + 0.05);
  }

  /** Ton mit Tonhöhen-Verlauf */
  private tone(opts: { type?: OscillatorType; from: number; to?: number; dur: number; vol: number; delay?: number; bus?: GainNode }) {
    const c = this.ctx!;
    const t = c.currentTime + (opts.delay ?? 0);
    const o = c.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.from, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    o.connect(g).connect(opts.bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + opts.dur + 0.05);
  }

  shot(weapon: number, local: boolean) {
    const kind = WEAPONS[weapon]?.kind ?? 'pistol';
    if (!this.ok(`shot${weapon}${local}`, kind === 'flamer' ? 120 : 45)) return;
    const v = local ? 1 : 0.45;
    switch (kind) {
      case 'shotgun':
        this.burst({ type: 'lowpass', freq: 2200, sweepTo: 300, dur: 0.35, vol: 0.9 * v });
        this.tone({ type: 'triangle', from: 110, to: 40, dur: 0.25, vol: 0.6 * v });
        break;
      case 'sniper':
        this.burst({ type: 'bandpass', freq: 1800, q: 0.7, dur: 0.5, vol: 0.9 * v });
        this.tone({ type: 'triangle', from: 140, to: 35, dur: 0.4, vol: 0.7 * v });
        break;
      case 'rocket':
        this.burst({ type: 'lowpass', freq: 600, sweepTo: 2400, dur: 0.6, vol: 0.6 * v });
        break;
      case 'flamer':
        this.burst({ type: 'lowpass', freq: 900, dur: 0.18, vol: 0.35 * v });
        break;
      case 'laser':
        this.tone({ type: 'sawtooth', from: 1800, to: 180, dur: 0.25, vol: 0.25 * v });
        break;
      case 'smg':
      case 'lmg':
        this.burst({ type: 'bandpass', freq: 1500, q: 0.9, dur: 0.09, vol: 0.55 * v });
        this.tone({ type: 'triangle', from: 120, to: 50, dur: 0.08, vol: 0.35 * v });
        break;
      default:
        this.burst({ type: 'bandpass', freq: 1300, q: 0.8, dur: 0.14, vol: 0.7 * v });
        this.tone({ type: 'triangle', from: 130, to: 45, dur: 0.12, vol: 0.45 * v });
    }
  }

  hit(head: boolean) {
    if (!this.ok('hit', 30)) return;
    this.burst({ type: 'bandpass', freq: head ? 2600 : 900, q: 2, dur: 0.06, vol: 0.25 });
    if (head) this.tone({ type: 'sine', from: 1400, to: 900, dur: 0.08, vol: 0.12 });
  }

  zombieDeath(kind: number) {
    if (!this.ok('zdeath', 60)) return;
    const base = kind === 11 ? 50 : kind === 2 ? 70 : 110;
    this.tone({ type: 'sawtooth', from: base * 1.4, to: base * 0.6, dur: 0.5, vol: 0.18 });
    this.burst({ type: 'lowpass', freq: 500, dur: 0.25, vol: 0.25 });
  }

  zombieAttack() {
    if (!this.ok('zatk', 150)) return;
    this.tone({ type: 'sawtooth', from: 90 + Math.random() * 40, to: 60, dur: 0.3, vol: 0.14 });
  }

  explosion() {
    if (!this.ok('boom', 80)) return;
    this.burst({ type: 'lowpass', freq: 1200, sweepTo: 80, dur: 1.4, vol: 1 });
    this.tone({ type: 'sine', from: 70, to: 25, dur: 0.9, vol: 0.9 });
  }

  thunder() {
    if (!this.ok('thunder', 500)) return;
    const delay = 0.3 + Math.random() * 1.5;
    this.burst({ type: 'lowpass', freq: 400, sweepTo: 60, dur: 3, vol: 0.8, delay, bus: this.ambBus });
    this.burst({ type: 'lowpass', freq: 900, sweepTo: 120, dur: 0.8, vol: 0.5, delay, bus: this.ambBus });
  }

  door() {
    if (!this.ok('door', 200)) return;
    this.tone({ type: 'square', from: 180, to: 120, dur: 0.15, vol: 0.2 });
    this.tone({ type: 'square', from: 140, to: 90, dur: 0.2, vol: 0.2, delay: 0.12 });
    this.burst({ type: 'highpass', freq: 3000, dur: 0.5, vol: 0.15, delay: 0.05 });
  }

  chest() {
    if (!this.ok('chest', 300)) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone({ type: 'triangle', from: f, dur: 0.5, vol: 0.18, delay: i * 0.09 }));
  }

  power() {
    if (!this.ok('power', 500)) return;
    this.tone({ type: 'sawtooth', from: 40, to: 120, dur: 2.5, vol: 0.25 });
    this.tone({ type: 'sine', from: 80, to: 240, dur: 2.5, vol: 0.2 });
  }

  reload() {
    if (!this.ok('reload', 200)) return;
    this.burst({ type: 'highpass', freq: 2500, dur: 0.05, vol: 0.3 });
    this.burst({ type: 'highpass', freq: 1800, dur: 0.07, vol: 0.35, delay: 0.25 });
  }

  swing() {
    if (!this.ok('swing', 80)) return;
    this.burst({ type: 'bandpass', freq: 600, sweepTo: 2400, q: 1.5, dur: 0.18, vol: 0.3 });
  }

  ui(kind: 'tap' | 'ok' | 'error' | 'level' = 'tap') {
    if (!this.ok(`ui${kind}`, 40)) return;
    if (kind === 'tap') this.tone({ type: 'sine', from: 880, to: 660, dur: 0.06, vol: 0.1 });
    if (kind === 'ok') {
      this.tone({ type: 'sine', from: 660, dur: 0.1, vol: 0.12 });
      this.tone({ type: 'sine', from: 990, dur: 0.15, vol: 0.12, delay: 0.08 });
    }
    if (kind === 'error') this.tone({ type: 'square', from: 220, to: 160, dur: 0.18, vol: 0.08 });
    if (kind === 'level') [392, 523, 659, 784].forEach((f, i) => this.tone({ type: 'triangle', from: f, dur: 0.4, vol: 0.16, delay: i * 0.1 }));
  }

  heartbeat() {
    if (!this.ok('heart', 900)) return;
    this.tone({ type: 'sine', from: 60, to: 40, dur: 0.15, vol: 0.5 });
    this.tone({ type: 'sine', from: 55, to: 38, dur: 0.15, vol: 0.4, delay: 0.22 });
  }

  /** Dauerhafte Atmosphäre: Regen, Wind, Untergrund-Brummen und eine ruhige Musikfläche. */
  ambience(kind: 'under' | 'rain' | 'wind' | 'night', intensity: number, night: number, horde = false) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx;
    if (!this.amb) {
      const loop = (filterType: BiquadFilterType, freq: number) => {
        const src = c.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        const f = c.createBiquadFilter();
        f.type = filterType;
        f.frequency.value = freq;
        const g = c.createGain();
        g.gain.value = 0;
        src.connect(f).connect(g).connect(this.ambBus);
        src.start();
        return { g, f };
      };
      const rain = loop('highpass', 1200);
      const wind = loop('lowpass', 400);
      const drone = c.createOscillator();
      drone.type = 'sine';
      drone.frequency.value = 48;
      const dg = c.createGain();
      dg.gain.value = 0;
      drone.connect(dg).connect(this.ambBus);
      drone.start();
      this.amb = { rain: rain.g, wind: wind.g, drone: dg, windFilter: wind.f };
    }
    const t = c.currentTime;
    const set = (g: GainNode, v: number) => g.gain.setTargetAtTime(v, t, 0.8);
    set(this.amb.rain, kind === 'rain' ? 0.12 + intensity * 0.25 : 0);
    set(this.amb.wind, kind === 'wind' ? 0.15 + intensity * 0.2 : kind === 'night' ? 0.04 : 0.02);
    this.amb.windFilter.frequency.setTargetAtTime(300 + Math.sin(t * 0.3) * 150, t, 1);
    set(this.amb.drone, kind === 'under' ? 0.08 : 0);
    this.updateMusic(night, horde);
  }

  private updateMusic(night: number, horde: boolean) {
    const c = this.ctx!;
    const chords = horde
      ? [[55, 58.27, 82.41], [51.91, 55, 77.78]]
      : night > 0.5
        ? [[55, 65.41, 82.41], [49, 58.27, 73.42], [43.65, 55, 65.41], [41.2, 49, 61.74]]
        : [[65.41, 82.41, 98], [58.27, 73.42, 87.31], [55, 69.3, 82.41], [49, 61.74, 73.42]];
    if (!this.music) {
      const gain = c.createGain();
      gain.gain.value = 0;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      filter.connect(gain).connect(this.musicBus);
      const oscs = [0, 1, 2, 3, 4, 5].map((i) => {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = i % 2 ? 7 : -7;
        o.connect(filter);
        o.start();
        return o;
      });
      this.music = { oscs, gain, filter, chord: 0, next: 0 };
    }
    const m = this.music;
    const t = c.currentTime;
    m.gain.gain.setTargetAtTime(horde ? 0.08 : 0.05, t, 2);
    m.filter.frequency.setTargetAtTime(horde ? 1100 : 500 + (1 - night) * 400, t, 2);
    if (t >= m.next) {
      m.chord = (m.chord + 1) % chords.length;
      const ch = chords[m.chord];
      m.oscs.forEach((o, i) => o.frequency.setTargetAtTime(ch[i % 3] * (i >= 3 ? 2 : 1), t, 1.5));
      m.next = t + (horde ? 4 : 8);
    }
  }
}

export const sfx = new Sfx();
