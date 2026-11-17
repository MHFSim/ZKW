/** Tag-Nacht-Zyklus: Schlüsselzeiten aus dem Grafik-Konzept, dazwischen weich überblendet. */
export interface DayKey {
  h: number;
  skyTop: number;
  skyBottom: number;
  ambient: number;
  /** 0 … 1: wie hell die Welt ohne Lampen ist */
  ambientI: number;
  fog: number;
  /** 0 … 1: Sterne/Nachtgefühl (Laternen an, Taschenlampen an) */
  night: number;
}

export const DAY_KEYS: DayKey[] = [
  { h: 0, skyTop: 0x05070f, skyBottom: 0x121a33, ambient: 0x1a2238, ambientI: 0.18, fog: 0.35, night: 1 },
  { h: 5, skyTop: 0x0a0f22, skyBottom: 0x1d2442, ambient: 0x20283f, ambientI: 0.22, fog: 0.55, night: 1 },
  { h: 6.5, skyTop: 0x2b3a67, skyBottom: 0xf2a65a, ambient: 0x6b6f8a, ambientI: 0.55, fog: 0.6, night: 0.4 },
  { h: 9, skyTop: 0x3f8fd8, skyBottom: 0xbfe3ff, ambient: 0xe8ecf2, ambientI: 1.0, fog: 0.1, night: 0 },
  { h: 16.5, skyTop: 0x3f8fd8, skyBottom: 0xbfe3ff, ambient: 0xe8ecf2, ambientI: 1.0, fog: 0.1, night: 0 },
  { h: 18, skyTop: 0x4a5fa8, skyBottom: 0xff9a4d, ambient: 0xc99a7a, ambientI: 0.8, fog: 0.25, night: 0.1 },
  { h: 19.5, skyTop: 0x1c2550, skyBottom: 0x5a4a8a, ambient: 0x4a5680, ambientI: 0.45, fog: 0.3, night: 0.7 },
  { h: 21, skyTop: 0x05070f, skyBottom: 0x121a33, ambient: 0x1a2238, ambientI: 0.18, fog: 0.35, night: 1 },
];

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (t: number) => t * t * (3 - 2 * t);

export function lerpColor(a: number, b: number, t: number): number {
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, t));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
  const bl = Math.round(lerp(a & 255, b & 255, t));
  return (r << 16) | (g << 8) | bl;
}

export function scaleColor(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

export interface DaySample {
  skyTop: number;
  skyBottom: number;
  ambient: number;
  ambientI: number;
  fog: number;
  night: number;
}

export function sampleDay(hour: number, keys: DayKey[] = DAY_KEYS): DaySample {
  const h = ((hour % 24) + 24) % 24;
  let i = keys.findIndex((k) => k.h > h);
  if (i < 0) i = 0; // nach dem letzten Key: Wrap auf den ersten
  const b = keys[i];
  const a = keys[(i - 1 + keys.length) % keys.length];
  const span = (b.h - a.h + 24) % 24 || 24;
  const t = smoothstep(((h - a.h + 24) % 24) / span);
  return {
    skyTop: lerpColor(a.skyTop, b.skyTop, t),
    skyBottom: lerpColor(a.skyBottom, b.skyBottom, t),
    ambient: lerpColor(a.ambient, b.ambient, t),
    ambientI: lerp(a.ambientI, b.ambientI, t),
    fog: lerp(a.fog, b.fog, t),
    night: lerp(a.night, b.night, t),
  };
}

export function isNight(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  return h >= 20 || h < 5;
}

export function formatClock(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
