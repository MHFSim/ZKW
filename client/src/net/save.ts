import type { SaveData } from '@zkw/shared';

/**
 * Spielstände im Browser (IndexedDB, gzip-komprimiert).
 * Slots: "manual-1…3" für manuelles Speichern, "auto-1…3" rotierend für Autosaves.
 * "Weiterspielen" lädt immer den neuesten Stand.
 */
const DB = 'undead-week';
const STORE = 'saves';

export interface SaveMeta {
  slot: string;
  savedAt: number;
  hour: number;
  zone: string;
  players: string[];
  level: number;
  money: number;
}

interface SaveRecord {
  slot: string;
  meta: SaveMeta;
  data: Blob;
}

let dbPromise: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'slot' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

async function gzip(text: string): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return new Blob([text]);
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

async function gunzip(blob: Blob): Promise<string> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b || typeof DecompressionStream === 'undefined') return blob.text();
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

function metaOf(slot: string, data: SaveData): SaveMeta {
  const host = data.players[0] ?? data.absent[0];
  return {
    slot,
    savedAt: data.savedAt,
    hour: data.hour,
    zone: data.meta?.zone ?? '',
    players: [...data.players, ...data.absent].map((p) => p.name),
    level: host?.level ?? 1,
    money: host?.money ?? 0,
  };
}

let autoIndex = 0;

/** Speichert; automatische Saves rotieren über 3 Slots, manuelle gehen in Slot "manual-1" (oder den gewählten). */
export async function writeSave(data: SaveData, auto = false, slot?: string): Promise<number | null> {
  try {
    const s = slot ?? (auto ? `auto-${(autoIndex++ % 3) + 1}` : 'manual-1');
    const rec: SaveRecord = { slot: s, meta: metaOf(s, data), data: await gzip(JSON.stringify(data)) };
    await tx('readwrite', (st) => st.put(rec));
    void navigator.storage?.persist?.(); // Browser bitten, Spielstände nicht zu löschen
    return data.savedAt;
  } catch (e) {
    console.warn('Speichern fehlgeschlagen', e);
    return null;
  }
}

export async function listSaves(): Promise<SaveMeta[]> {
  try {
    const all = await tx<SaveRecord[]>('readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>);
    return all.map((r) => r.meta).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function readSave(slot?: string): Promise<SaveData | null> {
  try {
    const target = slot ?? (await listSaves())[0]?.slot;
    if (!target) return null;
    const rec = await tx<SaveRecord | undefined>('readonly', (s) => s.get(target) as IDBRequest<SaveRecord | undefined>);
    if (!rec) return null;
    return JSON.parse(await gunzip(rec.data)) as SaveData;
  } catch (e) {
    console.warn('Spielstand beschädigt', e);
    return null;
  }
}

export async function deleteSave(slot: string) {
  await tx('readwrite', (s) => s.delete(slot));
}

/** Spielstand als Datei herunterladen (Welt an andere weitergeben). */
export async function exportSave(slot?: string) {
  const data = await readSave(slot);
  if (!data) return;
  const blob = await gzip(JSON.stringify(data));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `undead-week-${new Date(data.savedAt).toISOString().slice(0, 10)}.uwsave`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Spielstand-Datei einlesen und als manuellen Slot ablegen. */
export async function importSave(file: File): Promise<boolean> {
  try {
    const data = JSON.parse(await gunzip(file)) as SaveData;
    if (typeof data.version !== 'number' || !Array.isArray(data.players)) return false;
    data.savedAt = Date.now();
    return (await writeSave(data, false, 'manual-3')) !== null;
  } catch {
    return false;
  }
}
