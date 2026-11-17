/** Gemeinsamer Zustand der Steuerung (Touch-HUD schreibt, Spielszene liest). */
export const controls = {
  touch: typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches,
  moveX: 0,
  up: false,
  down: false,
  jump: false,
  interact: false,
  fire: false,
  reload: false,
  heal: false,
  switchPulse: false,
  /** Zielrichtung vom rechten Stick (nur Touch) */
  aimX: 1,
  aimY: 0,
  aimActive: false,
};

export type RainLevel = 'aus' | 'mittel' | 'hoch';

export interface Settings {
  name: string;
  bloom: boolean;
  vignette: boolean;
  rain: RainLevel;
  shake: boolean;
  fps: boolean;
  aimAssist: boolean;
  volMaster: number;
  volMusic: number;
  volSfx: number;
  preset: 'niedrig' | 'mittel' | 'hoch' | 'ultra';
}

const KEY = 'zkw.settings.v1';

const defaults: Settings = {
  name: '',
  bloom: true,
  vignette: true,
  rain: 'hoch',
  shake: true,
  fps: false,
  aimAssist: true,
  volMaster: 0.8,
  volMusic: 0.45,
  volSfx: 0.8,
  preset: 'hoch',
};

function load(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...defaults };
  }
}

export const settings: Settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* Speicher voll oder gesperrt – Einstellungen gelten dann nur für diese Sitzung */
  }
}

export function playerName(): string {
  if (!settings.name) {
    settings.name = `Überlebende ${Math.floor(100 + Math.random() * 900)}`;
    saveSettings();
  }
  return settings.name;
}
