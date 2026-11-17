import type { GameEvent, PickupInfo, ReliableMsg } from '@zkw/shared';

export type SessionStatus = 'connecting' | 'waiting' | 'playing' | 'closed';

export interface SessionCallbacks {
  onSnapshot?: (buf: ArrayBuffer) => void;
  onEvents?: (list: GameEvent[]) => void;
  onStatus?: (status: SessionStatus, detail?: string) => void;
  onWait?: (safe: number, total: number) => void;
  onRoster?: (players: { id: number; name: string }[]) => void;
  onJoinWaiting?: (name: string) => void;
  onJoinState?: (waiting: number, exitsLocked: boolean) => void;
  onSaved?: (at: number) => void;
  /** Nachrichten nur für diesen Spieler (Inventar, Stationen, Handel, Meldungen) */
  onPrivate?: (msg: any) => void;
  onPickups?: (list: PickupInfo[]) => void;
}

/** Gemeinsame Schnittstelle für Host (lokaler Worker) und Client (WebRTC). */
export interface Session {
  readonly isHost: boolean;
  localId: number;
  levelId: string;
  code?: string;
  status: SessionStatus;
  roster: Map<number, string>;
  cb: SessionCallbacks;
  sendInput(buf: ArrayBuffer): void;
  sendAction(action: unknown): void;
  requestSave(auto?: boolean): void;
  close(): void;
  /** Ping zum Host in ms (Client) */
  ping: number;
}

export type { ReliableMsg };
