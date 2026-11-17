import type { PickupInfo, PrivateState } from '@zkw/shared';

/** Was der eigene Spieler über sich weiß – kommt privat vom Host. */
export interface Interaction {
  kind: string;
  label: string;
  price?: number;
  ref: number;
}

type Listener = () => void;

class Store {
  me?: PrivateState;
  interaction: Interaction | null = null;
  pickups: PickupInfo[] = [];
  private listeners = new Set<Listener>();

  set(patch: Partial<Pick<Store, 'me' | 'interaction' | 'pickups'>>) {
    Object.assign(this, patch);
    for (const l of this.listeners) l();
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  reset() {
    this.me = undefined;
    this.interaction = null;
    this.pickups = [];
  }
}

export const store = new Store();
