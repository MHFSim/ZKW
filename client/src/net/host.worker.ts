/// <reference lib="webworker" />
/**
 * Host-Simulation im Web Worker: fester 60-Hz-Takt, unabhängig vom Bildaufbau
 * und weniger gedrosselt, wenn der Tab im Hintergrund ist.
 */
import { DT, World, buildTalkessel, decodeInput, encodeSnapshot, type Action, type SaveData } from '@zkw/shared';

type InMsg =
  | { type: 'start'; hostName: string; save?: SaveData }
  | { type: 'input'; id: number; buf: ArrayBuffer }
  | { type: 'action'; id: number; action: Action }
  | { type: 'join'; key: string; id: number; name: string }
  | { type: 'cancelJoin'; key: string }
  | { type: 'leave'; id: number }
  | { type: 'save'; auto?: boolean };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let world: World | undefined;
const joinQueue: { key: string; id: number; name: string }[] = [];
let acc = 0;
let last = 0;
let lastJoinCheck = 0;
let lastPickups = 0;
let exitsLockedUntil = 0;

function loop() {
  if (!world) return;
  const now = performance.now();
  acc += (now - last) / 1000;
  last = now;
  if (acc > 0.25) acc = 0.25; // nach langer Pause nicht "nachrennen"
  while (acc >= DT) {
    world.step();
    acc -= DT;
    const snap = encodeSnapshot(world);
    ctx.postMessage({ type: 'snapshot', buf: snap }, [snap]);
    const events = world.drainEvents();
    if (events.length) ctx.postMessage({ type: 'events', list: events });
  }
  for (const pm of world.drainPrivates()) ctx.postMessage({ type: 'private', id: pm.id, msg: pm.msg });
  if (world.pickupsDirty && now - lastPickups > 200) {
    lastPickups = now;
    ctx.postMessage({ type: 'pickups', list: world.pickupList() });
  }
  if (now - lastJoinCheck > 1000) {
    lastJoinCheck = now;
    checkJoins(now);
  }
  setTimeout(loop, 4);
}

/** Beitrittsregel: Wartende kommen erst rein, wenn alle Spieler in einer Zuflucht sind. */
function checkJoins(now: number) {
  if (!world) return;
  const total = world.players.size;
  const safe = world.safeCount();
  if (joinQueue.length && world.allPlayersSafe()) {
    exitsLockedUntil = now + 5000;
    const room = world.mostPopulatedSafe();
    for (const j of joinQueue.splice(0)) {
      world.addPlayer(j.id, j.name, room.spawn);
      ctx.postMessage({ type: 'joined', key: j.key, id: j.id });
    }
  }
  ctx.postMessage({ type: 'joinState', safe, total, waiting: joinQueue.map((j) => j.key), exitsLocked: now < exitsLockedUntil });
}

ctx.onmessage = (e: MessageEvent<InMsg>) => {
  const m = e.data;
  switch (m.type) {
    case 'start': {
      const level = buildTalkessel();
      try {
        if (m.save) {
          world = World.fromSave(level, m.save);
          world.restoreHost(0, m.hostName);
        }
      } catch (err) {
        ctx.postMessage({ type: 'error', message: (err as Error).message });
        world = undefined;
      }
      if (!world) {
        world = new World(level);
        world.addPlayer(0, m.hostName);
      }
      last = performance.now();
      loop();
      break;
    }
    case 'input': {
      const input = decodeInput(m.buf);
      if (input && world) world.queueInput(m.id, input);
      break;
    }
    case 'action':
      world?.applyAction(m.id, m.action);
      break;
    case 'join':
      joinQueue.push({ key: m.key, id: m.id, name: m.name });
      lastJoinCheck = 0;
      break;
    case 'cancelJoin': {
      const i = joinQueue.findIndex((j) => j.key === m.key);
      if (i >= 0) joinQueue.splice(i, 1);
      break;
    }
    case 'leave':
      world?.removePlayer(m.id);
      break;
    case 'save':
      if (world) ctx.postMessage({ type: 'save', data: world.serialize(), auto: !!m.auto });
      break;
  }
};
