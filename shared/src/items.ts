/** Waffen, Gegenstände, Rezepte, Skills, Händlerpreise – alles reine Daten. */

export type WeaponKind = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'lmg' | 'sniper' | 'rocket' | 'flamer' | 'laser' | 'melee';

export interface WeaponDef {
  id: number;
  key: string;
  name: string;
  kind: WeaponKind;
  damage: number;
  /** Schüsse bzw. Schläge pro Sekunde */
  fireRate: number;
  pellets: number;
  spread: number;
  mag: number;
  reserveMax: number;
  reload: number;
  range: number;
  /** Preis am Wandkauf; null = nur aus der Wundertruhe */
  price: number | null;
  explosive?: number;
  pierce?: number;
  /** Spitzname der Leuchtspur-Farbe */
  tracer: number;
}

const W = (d: Omit<WeaponDef, 'id'>, id: number): WeaponDef => ({ ...d, id });

export const WEAPONS: WeaponDef[] = [
  W({ key: 'dienstpistole', name: 'Dienstpistole', kind: 'pistol', damage: 26, fireRate: 4.5, pellets: 1, spread: 0.02, mag: 12, reserveMax: 96, reload: 1.2, range: 900, price: null, tracer: 0xffd28a }, 0),
  W({ key: 'magnum', name: 'Magnum', kind: 'pistol', damage: 85, fireRate: 2, pellets: 1, spread: 0.01, mag: 6, reserveMax: 48, reload: 1.8, range: 1100, price: 900, pierce: 2, tracer: 0xffe2a8 }, 1),
  W({ key: 'wespe', name: 'Wespe (MP)', kind: 'smg', damage: 18, fireRate: 12, pellets: 1, spread: 0.06, mag: 32, reserveMax: 256, reload: 1.6, range: 800, price: 750, tracer: 0xffd28a }, 2),
  W({ key: 'donner', name: 'Donner (Schrotflinte)', kind: 'shotgun', damage: 16, fireRate: 1.4, pellets: 8, spread: 0.16, mag: 6, reserveMax: 48, reload: 2.4, range: 520, price: 1000, tracer: 0xffc070 }, 3),
  W({ key: 'falke', name: 'Falke (Sturmgewehr)', kind: 'rifle', damage: 32, fireRate: 9, pellets: 1, spread: 0.025, mag: 30, reserveMax: 240, reload: 1.9, range: 1100, price: 1500, tracer: 0xffd28a }, 4),
  W({ key: 'kraehe', name: 'Krähe (Präzisionsgewehr)', kind: 'sniper', damage: 220, fireRate: 1.1, pellets: 1, spread: 0.002, mag: 5, reserveMax: 40, reload: 2.6, range: 1800, price: 2500, pierce: 5, tracer: 0xbfe6ff }, 5),
  W({ key: 'hackebeil', name: 'Hackebeil', kind: 'melee', damage: 120, fireRate: 2, pellets: 1, spread: 0, mag: 0, reserveMax: 0, reload: 0, range: 70, price: 500, tracer: 0xffffff }, 6),
  W({ key: 'kreissaege', name: 'Kreissäge', kind: 'melee', damage: 45, fireRate: 10, pellets: 1, spread: 0, mag: 0, reserveMax: 0, reload: 0, range: 80, price: 2000, tracer: 0xffffff }, 7),
  W({ key: 'drachen', name: 'Drachen (Flammenwerfer)', kind: 'flamer', damage: 9, fireRate: 20, pellets: 1, spread: 0.12, mag: 100, reserveMax: 400, reload: 2.8, range: 330, price: 3000, pierce: 4, tracer: 0xff8a3d }, 8),
  W({ key: 'orkan', name: 'Orkan (Minigun)', kind: 'lmg', damage: 24, fireRate: 20, pellets: 1, spread: 0.07, mag: 150, reserveMax: 600, reload: 3.5, range: 1000, price: null, tracer: 0xffd28a }, 9),
  W({ key: 'feuerwerk', name: 'Feuerwerk (Raketenwerfer)', kind: 'rocket', damage: 320, fireRate: 0.8, pellets: 1, spread: 0.01, mag: 2, reserveMax: 16, reload: 2.8, range: 1400, price: null, explosive: 150, tracer: 0xff8a3d }, 10),
  W({ key: 'lichtbogen', name: 'Lichtbogen (Laser)', kind: 'laser', damage: 140, fireRate: 1.6, pellets: 1, spread: 0, mag: 8, reserveMax: 64, reload: 2.2, range: 1600, price: null, pierce: 10, tracer: 0x6ec8ff }, 11),
];

export const weaponByKey = (k: string) => WEAPONS.find((w) => w.key === k)!;

/** Gewichtung der Wundertruhe (höher = häufiger) */
export const TRUHE_TABLE: [string, number][] = [
  ['magnum', 10], ['wespe', 8], ['donner', 10], ['falke', 10], ['kraehe', 8], ['kreissaege', 8],
  ['drachen', 9], ['orkan', 7], ['feuerwerk', 6], ['lichtbogen', 5],
];
export const TRUHE_PRICE = 950;

export type Element = 0 | 1 | 2 | 3; // keins, Feuer, Elektro, Frost
export const ELEMENT_NAMES = ['–', 'Feuer', 'Elektro', 'Frost'];

export interface WeaponInst {
  uid: number;
  def: number;
  tier: number; // 1–5
  element: Element;
  mag: number;
  reserve: number;
}

/** Schaden je Stufe: +12 % pro Stufe über 1 */
export const tierMul = (tier: number) => 1 + (tier - 1) * 0.12;
export const tierMagMul = (tier: number) => 1 + (tier - 1) * 0.1;
export const UPGRADE_COST: Record<number, { money: number; items: Partial<Record<ItemKey, number>> }> = {
  2: { money: 500, items: { schrott: 4 } },
  3: { money: 1000, items: { schrott: 6, elektronik: 2 } },
  4: { money: 2000, items: { schrott: 8, elektronik: 4, pulver: 2 } },
  5: { money: 4000, items: { schrott: 10, elektronik: 6, proben: 2 } },
};

// ---------- Gegenstände ----------

export type ItemKey =
  | 'schrott' | 'stoff' | 'chemie' | 'elektronik' | 'pulver' | 'proben'
  | 'verband' | 'medkit' | 'granate' | 'molotow' | 'munition' | 'kern_feuer' | 'kern_elektro' | 'kern_frost'
  | 'funkteil';

export const ITEMS: Record<ItemKey, { name: string; kind: 'material' | 'consumable' | 'key'; value: number }> = {
  schrott: { name: 'Schrott', kind: 'material', value: 15 },
  stoff: { name: 'Stoff', kind: 'material', value: 12 },
  chemie: { name: 'Chemikalien', kind: 'material', value: 25 },
  elektronik: { name: 'Elektronik', kind: 'material', value: 40 },
  pulver: { name: 'Schießpulver', kind: 'material', value: 30 },
  proben: { name: 'Seltene Probe', kind: 'material', value: 120 },
  verband: { name: 'Verband', kind: 'consumable', value: 40 },
  medkit: { name: 'Medkit', kind: 'consumable', value: 120 },
  granate: { name: 'Granate', kind: 'consumable', value: 150 },
  molotow: { name: 'Molotow', kind: 'consumable', value: 110 },
  munition: { name: 'Munitionspack', kind: 'consumable', value: 90 },
  kern_feuer: { name: 'Feuer-Kern', kind: 'consumable', value: 400 },
  kern_elektro: { name: 'Elektro-Kern', kind: 'consumable', value: 400 },
  kern_frost: { name: 'Frost-Kern', kind: 'consumable', value: 400 },
  funkteil: { name: 'Funkteil', kind: 'key', value: 0 },
};
export const ITEM_KEYS = Object.keys(ITEMS) as ItemKey[];
export const MATERIALS: ItemKey[] = ['schrott', 'stoff', 'chemie', 'elektronik', 'pulver', 'proben'];

export type StationKind = 'werkbank' | 'labor' | 'kueche' | 'training' | 'haendler' | 'schwarzmarkt' | 'funk' | 'schliessfach';

export interface Recipe {
  key: string;
  out: ItemKey;
  qty: number;
  needs: Partial<Record<ItemKey, number>>;
  stations: StationKind[];
  /** benötigte Stufe des Skills "Basteln" */
  craftTier: number;
}

export const RECIPES: Recipe[] = [
  { key: 'verband', out: 'verband', qty: 2, needs: { stoff: 2 }, stations: ['werkbank', 'kueche', 'labor'], craftTier: 0 },
  { key: 'medkit', out: 'medkit', qty: 1, needs: { stoff: 2, chemie: 2 }, stations: ['kueche', 'labor'], craftTier: 0 },
  { key: 'munition', out: 'munition', qty: 1, needs: { schrott: 2, pulver: 2 }, stations: ['werkbank', 'labor'], craftTier: 0 },
  { key: 'molotow', out: 'molotow', qty: 1, needs: { chemie: 2, stoff: 1 }, stations: ['werkbank', 'labor'], craftTier: 0 },
  { key: 'granate', out: 'granate', qty: 1, needs: { schrott: 2, pulver: 3 }, stations: ['werkbank', 'labor'], craftTier: 1 },
  { key: 'kern_feuer', out: 'kern_feuer', qty: 1, needs: { proben: 1, chemie: 4, elektronik: 2 }, stations: ['labor'], craftTier: 2 },
  { key: 'kern_elektro', out: 'kern_elektro', qty: 1, needs: { proben: 1, elektronik: 5 }, stations: ['labor'], craftTier: 2 },
  { key: 'kern_frost', out: 'kern_frost', qty: 1, needs: { proben: 1, chemie: 3, elektronik: 3 }, stations: ['labor'], craftTier: 2 },
];

// ---------- Skills ----------

export type SkillKey =
  | 'schaden' | 'nachladen' | 'kopfschuss'
  | 'leben' | 'heilung' | 'tempo'
  | 'basteln' | 'feilschen' | 'sprengmeister'
  | 'retter' | 'geldsegen' | 'kameradschaft';

export interface SkillDef {
  key: SkillKey;
  tree: 'Kampf' | 'Überleben' | 'Technik' | 'Team';
  name: string;
  desc: string;
  max: number;
}

export const SKILLS: SkillDef[] = [
  { key: 'schaden', tree: 'Kampf', name: 'Feuerkraft', desc: '+8 % Schaden je Stufe', max: 5 },
  { key: 'nachladen', tree: 'Kampf', name: 'Schnelle Hände', desc: '−12 % Nachladezeit je Stufe', max: 3 },
  { key: 'kopfschuss', tree: 'Kampf', name: 'Scharfschütze', desc: '+30 % Geld bei Kopfschüssen je Stufe', max: 3 },
  { key: 'leben', tree: 'Überleben', name: 'Zäh', desc: '+15 maximale HP je Stufe', max: 5 },
  { key: 'heilung', tree: 'Überleben', name: 'Sanitäter', desc: '+30 % Heilung je Stufe', max: 3 },
  { key: 'tempo', tree: 'Überleben', name: 'Leichtfüßig', desc: '+5 % Lauftempo je Stufe', max: 3 },
  { key: 'basteln', tree: 'Technik', name: 'Basteln', desc: 'Schaltet bessere Rezepte frei (Granaten, Element-Kerne)', max: 2 },
  { key: 'feilschen', tree: 'Technik', name: 'Feilschen', desc: '−10 % Kosten für Upgrades und Händler je Stufe', max: 3 },
  { key: 'sprengmeister', tree: 'Technik', name: 'Sprengmeister', desc: '+25 % Explosionsschaden je Stufe', max: 2 },
  { key: 'retter', tree: 'Team', name: 'Retter', desc: '−25 % Wiederbelebungszeit je Stufe', max: 3 },
  { key: 'geldsegen', tree: 'Team', name: 'Geldsegen', desc: '+10 % Geld je Stufe', max: 3 },
  { key: 'kameradschaft', tree: 'Team', name: 'Kameradschaft', desc: 'Mitspieler in der Nähe laden 15 % schneller nach', max: 1 },
];

export const MAX_LEVEL = 50;
export const xpForLevel = (level: number) => Math.round(200 * Math.pow(level, 1.45));

/** Händlerpreise: Kaufen = Wert × 1,6; Verkaufen = Wert × 0,5 */
export const BUY_FACTOR = 1.6;
export const SELL_FACTOR = 0.5;
export const HAENDLER_STOCK: ItemKey[] = ['schrott', 'stoff', 'chemie', 'pulver', 'verband', 'medkit', 'munition', 'granate'];
export const SCHWARZMARKT_STOCK: ItemKey[] = ['elektronik', 'proben', 'kern_feuer', 'kern_elektro', 'kern_frost', 'granate', 'medkit'];

/** Beute-Tabelle je Zone (Index 1 … 10) */
export const ZONE_LOOT: Record<number, Partial<Record<ItemKey, number>>> = {
  10: { chemie: 4, stoff: 3, schrott: 2 },
  9: { schrott: 4, chemie: 3, stoff: 2 },
  8: { elektronik: 2, schrott: 4, stoff: 2 },
  7: { schrott: 5, pulver: 2, stoff: 2 },
  6: { stoff: 4, chemie: 2, pulver: 3 },
  5: { schrott: 3, pulver: 3, chemie: 2 },
  4: { stoff: 4, pulver: 3, elektronik: 1 },
  3: { elektronik: 4, schrott: 3, chemie: 1 },
  2: { pulver: 4, stoff: 3, elektronik: 1 },
  1: { elektronik: 3, pulver: 3, schrott: 3 },
};
